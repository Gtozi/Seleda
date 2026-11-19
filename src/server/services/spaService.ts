/**
 * Spa & Wellness shared service layer.
 *
 * Shared by spaWellness.routes.ts and guestMobilePortal.routes.ts so booking
 * validation (conflicts, provider availability, contraindication warnings) is
 * enforced identically no matter where the appointment is created.
 */

import { supabaseAdmin, hasSupabaseAdminConfig } from '../supabaseAdmin';
import { postCharge } from './folioService';
import { dispatchEmail, dispatchSMS } from './salesMessageDispatch';
import { isFullAccessRole } from '../../types/erp';

export class SpaError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

export function ensureDb() {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    throw new SpaError(503, 'Database not configured');
  }
  return supabaseAdmin;
}

// ── IDs ───────────────────────────────────────────────────────────────────

let fallbackSeq = 0;

/** Atomic sequence-backed ID (migration 494): next_spa_seq() row-locks. */
export async function nextSpaId(prefix: string, pad = 3): Promise<string> {
  const db = ensureDb();
  const { data, error } = await db.rpc('next_spa_seq', { p_prefix: prefix });
  if (error || data == null) {
    // Fallback for environments where migration 494 hasn't run yet.
    // Timestamp alone collides for same-ms calls — add a process-local
    // counter plus randomness so concurrent fallbacks stay unique.
    const counter = (fallbackSeq++ % 46656).toString(36).padStart(3, '0');
    const rand = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
    return `${prefix}${Date.now().toString(36).toUpperCase()}${counter}${rand}`.toUpperCase();
  }
  return `${prefix}${String(Number(data)).padStart(pad, '0')}`;
}

// ── Time helpers ──────────────────────────────────────────────────────────

export function timeToMin(t: unknown): number | null {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ── Guest-acting authorization ─────────────────────────────────────────────

// Roles allowed to act on a guest's behalf (book/manage their bookings)
// without reservation proof — front desk, concierge and spa staff.
export const SPA_GUEST_PROXY_ROLES = new Set([
  'spa', 'spa_manager', 'spa_director', 'wellness_manager',
  'spa_receptionist', 'spa_therapist',
  'frontoffice', 'fo_manager', 'front_office_manager', 'front office manager',
  'receptionist', 'front_desk',
  'concierge', 'concierge_manager', 'guest_services_manager',
  'ops_manager', 'operations', 'operations_manager',
]);

const RESERVATION_ACCESSIBLE_STATUSES = new Set([
  'Reserved', 'Confirmed', 'CheckedIn', 'Checked In', 'InHouse', 'In House',
]);

/**
 * Authorization for guest-facing endpoints. The request may act on
 * `guestId` when EITHER:
 *   a) the session belongs to a staff/proxy role (spa, front office,
 *      concierge, ops — staff acting on a guest's behalf), or
 *   b) the request carries a reservationId (body or query) that belongs to
 *      the guest and is in a bookable status — the reservation id is the
 *      bearer credential used across the public guest surfaces.
 * Never trusts a client-supplied guest_id on its own.
 */
export async function canActForGuest(req: any, guestId: unknown): Promise<boolean> {
  if (typeof guestId !== 'string' || !guestId) return false;
  const role = req.user?.role as string | undefined;
  if (role && (isFullAccessRole(role) || SPA_GUEST_PROXY_ROLES.has(role))) return true;
  // A guest logged in via the guest portal session may act on their own record.
  if (role === 'guest' && req.user?.id === guestId) return true;

  const reservationId =
    req.body?.reservation_id || req.body?.reservationId ||
    req.query?.reservation_id || req.query?.reservationId;
  if (typeof reservationId !== 'string' || !reservationId) return false;

  const db = ensureDb();
  const { data } = await db
    .from('reservations')
    .select('guest_id, status')
    .eq('id', reservationId)
    .maybeSingle();
  return !!data && data.guest_id === guestId && RESERVATION_ACCESSIBLE_STATUSES.has(String(data.status));
}

/**
 * Resolve the guest's home property. Deployed schemas have guests.property_id
 * (added post-443); where that column is absent, fall back to the guest's
 * reservations — prefer a current in-house stay, then the next upcoming
 * confirmed booking, then the most recent stay.
 */
export async function guestPropertyId(guestId: string): Promise<string | null> {
  const db = ensureDb();
  const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

  const { data: guest } = await db
    .from('guests')
    .select('property_id')
    .eq('id', guestId)
    .maybeSingle();
  if (typeof guest?.property_id === 'string' && UUID.test(guest.property_id)) {
    return guest.property_id;
  }

  const { data } = await db
    .from('reservations')
    .select('property_id, status, check_in_date')
    .eq('guest_id', guestId)
    .order('check_in_date', { ascending: false })
    .limit(10);
  const rows = data || [];
  const active = rows.find((r: any) => ['CheckedIn', 'Checked In', 'InHouse', 'In House'].includes(String(r.status)))
    || rows.find((r: any) => ['Confirmed', 'Reserved'].includes(String(r.status)))
    || rows[0];
  return typeof active?.property_id === 'string' && UUID.test(active.property_id)
    ? active.property_id
    : null;
}

// Statuses that still occupy a therapist/room slot.
const SLOT_BLOCKING = ['Requested', 'Confirmed', 'Checked In', 'In Treatment', 'Rescheduled'];

export interface AppointmentConflict {
  kind: 'therapist' | 'room';
  appointment_id: string;
  guest_name: string;
  start_time: string;
  duration_minutes: number;
  status: string;
}

/**
 * Overlap check against existing appointments for the same therapist and/or
 * room on the same date. [start, start+duration) intersects an existing slot.
 */
export async function findAppointmentConflicts(opts: {
  date: string;
  startTime: string;
  durationMin: number;
  therapistId?: string | null;
  roomId?: string | null;
  excludeId?: string;
  propertyId?: string | null;
}): Promise<AppointmentConflict[]> {
  const db = ensureDb();
  const start = timeToMin(opts.startTime);
  if (start === null) throw new SpaError(400, `Invalid start_time "${opts.startTime}"`);
  const end = start + (opts.durationMin || 0);

  const conflicts: AppointmentConflict[] = [];

  for (const [kind, id] of [['therapist', opts.therapistId], ['room', opts.roomId]] as const) {
    if (!id) continue;
    let q = db
      .from('spa_appointments')
      .select('id, guest_name, start_time, duration_minutes, status')
      .eq('appointment_date', opts.date)
      .eq(kind === 'therapist' ? 'therapist_id' : 'room_id', id)
      .in('status', SLOT_BLOCKING);
    if (opts.excludeId) q = q.neq('id', opts.excludeId);

    const { data, error } = await q;
    if (error) throw new SpaError(500, error.message);

    for (const a of data || []) {
      const aStart = timeToMin(a.start_time);
      if (aStart === null) continue;
      const aEnd = aStart + (Number(a.duration_minutes) || 0);
      if (start < aEnd && aStart < end) {
        conflicts.push({
          kind: kind as 'therapist' | 'room',
          appointment_id: a.id,
          guest_name: a.guest_name,
          start_time: a.start_time,
          duration_minutes: a.duration_minutes,
          status: a.status,
        });
      }
    }
  }
  return conflicts;
}

export const SHIFT_WINDOWS: Record<string, { start: number; end: number }> = {
  Morning: { start: 8 * 60, end: 16 * 60 },
  Evening: { start: 12 * 60, end: 20 * 60 },
  Night: { start: 16 * 60, end: 24 * 60 },
};

export interface ProviderDayStatus {
  isOff: boolean;
  shift: string | null;
  window: { start: number; end: number } | null;
}

/**
 * Provider availability for a date: hr_team_roster wins, therapist default
 * shift is the fallback. 'Off' or Inactive therapist = not bookable.
 */
export async function providerDayStatus(
  therapistId: string,
  date: string,
  propertyId?: string | null,
): Promise<ProviderDayStatus> {
  const db = ensureDb();
  const { data: t } = await db
    .from('spa_therapists')
    .select('id, status, shift, employee_id')
    .eq('id', therapistId)
    .maybeSingle();
  if (!t) return { isOff: true, shift: null, window: null };
  if (t.status === 'Inactive') return { isOff: true, shift: null, window: null };

  let shift = t.shift || 'Morning';
  let shiftTypeId: string | null = null;

  if (t.employee_id) {
    let rq = db
      .from('hr_team_roster')
      .select('shift, shift_type_id')
      .eq('employee_id', t.employee_id)
      .eq('roster_date', date);
    if (propertyId) rq = rq.eq('property_id', propertyId);
    const { data: r } = await rq.maybeSingle();
    if (r) {
      shift = r.shift;
      shiftTypeId = r.shift_type_id || null;
    }
  }

  if (shift === 'Off') return { isOff: true, shift, window: null };

  let window = SHIFT_WINDOWS[shift] || SHIFT_WINDOWS.Morning;
  if (propertyId) {
    const { data: shiftTypes } = await db
      .from('hr_shift_types')
      .select('id, name, start_time, end_time')
      .eq('property_id', propertyId)
      .eq('is_active', true);
    const st = (shiftTypes || []).find((x: any) => x.id === shiftTypeId || x.name === shift);
    const s = timeToMin(st?.start_time);
    const e = timeToMin(st?.end_time);
    if (s !== null && e !== null) window = { start: s, end: e };
  }

  return { isOff: false, shift, window };
}

// ── Wellness-profile safety warnings ────────────────────────────────────────

/**
 * Booking-time safety check: surfaces a guest's allergies/contraindications so
 * the caller can warn the operator, and records a spa_alert so the warning is
 * auditable. Returns [] when the guest has no profile or no flags.
 */
export async function guestWellnessWarnings(
  guestId: string | null | undefined,
  propertyId?: string | null,
): Promise<string[]> {
  if (!guestId) return [];
  const db = ensureDb();
  let q = db
    .from('spa_wellness_profiles')
    .select('allergies, contraindications, medical_notes, guest_name')
    .eq('guest_id', guestId);
  if (propertyId) q = q.or(`property_id.is.null,property_id.eq.${propertyId}`);
  const { data } = await q.limit(1).maybeSingle();
  if (!data) return [];

  const warnings: string[] = [];
  if ((data.allergies || []).length) {
    warnings.push(`Allergies: ${(data.allergies as string[]).join(', ')}`);
  }
  if ((data.contraindications || []).length) {
    warnings.push(`Contraindications: ${(data.contraindications as string[]).join(', ')}`);
  }
  if (data.medical_notes) {
    warnings.push(`Medical notes: ${data.medical_notes}`);
  }
  return warnings;
}

/** Persist a contraindication alert so the warning is auditable. */
export async function recordContraindicationAlert(opts: {
  guestId: string;
  appointmentId?: string | null;
  therapistId?: string | null;
  message: string;
  propertyId?: string | null;
}): Promise<void> {
  const db = ensureDb();
  try {
    const id = await nextSpaId('SPA-ALT-');
    await db.from('spa_alerts').insert({
      id,
      alert_type: 'Contraindication',
      message: opts.message,
      severity: 'Warning',
      guest_id: opts.guestId,
      appointment_id: opts.appointmentId || null,
      therapist_id: opts.therapistId || null,
      property_id: opts.propertyId || null,
    });
  } catch {
    // Alert logging must never block a booking.
  }
}

// ── Appointment history ───────────────────────────────────────────────────

/**
 * Append an audit row to spa_appointment_history (migration 495). Never
 * throws — audit logging must not block the operation being recorded.
 */
export async function recordAppointmentHistory(opts: {
  appointmentId: string;
  action: 'created' | 'status_change' | 'rescheduled' | 'cancelled' | 'deleted' | 'note';
  fromStatus?: string | null;
  toStatus?: string | null;
  changedBy?: string | null;
  changedByName?: string | null;
  notes?: string | null;
  propertyId?: string | null;
}): Promise<void> {
  const db = ensureDb();
  try {
    const id = await nextSpaId('AH-');
    await db.from('spa_appointment_history').insert({
      id,
      appointment_id: opts.appointmentId,
      action: opts.action,
      from_status: opts.fromStatus || null,
      to_status: opts.toStatus || null,
      changed_by: opts.changedBy || 'system',
      changed_by_name: opts.changedByName || null,
      notes: opts.notes || null,
      property_id: opts.propertyId || null,
    });
  } catch {
    // Non-fatal by design.
  }
}

// ── Transactions ──────────────────────────────────────────────────────────

export interface SpaTransactionInput {
  guest_id?: string | null;
  guest_name?: string | null;
  appointment_id?: string | null;
  therapist_id?: string | null;
  description: string;
  amount: number;
  tax?: number;
  service_charge?: number;
  tip?: number;
  payment_method: string;
  status?: string;
  transaction_date?: string;
  room_number?: string | null;
  property_id?: string | null;
  source?: string;
  folio_id?: string | null;
  folio_line_id?: string | null;
}

/** Create a spa_transactions row with a sequence-backed TXN- id. */
export async function createSpaTransaction(input: SpaTransactionInput): Promise<any> {
  const db = ensureDb();
  const amt = Number(input.amount) || 0;
  const tx = Number(input.tax) || 0;
  const sc = Number(input.service_charge) || 0;
  const tp = Number(input.tip) || 0;
  const id = await nextSpaId('TXN-');

  const { data, error } = await db
    .from('spa_transactions')
    .insert({
      id,
      guest_id: input.guest_id || null,
      guest_name: input.guest_name || null,
      appointment_id: input.appointment_id || null,
      therapist_id: input.therapist_id || null,
      description: input.description,
      amount: amt,
      tax: tx,
      service_charge: sc,
      tip: tp,
      total: amt + tx + sc + tp,
      payment_method: input.payment_method,
      status: input.status || 'Pending',
      transaction_date: input.transaction_date || new Date().toISOString().slice(0, 10),
      room_number: input.room_number || null,
      property_id: input.property_id || null,
      source: input.source || 'manual',
      folio_id: input.folio_id || null,
      folio_line_id: input.folio_line_id || null,
    })
    .select()
    .single();
  if (error) throw new SpaError(500, error.message);
  return data;
}

// ── Guest folio posting ───────────────────────────────────────────────────

/**
 * Resolve the guest's open Guest folio. Folios link to reservations via
 * folios.reservation_id (folio_type 'Guest', status 'Open') — the same
 * convention the HK minibar charge flow uses.
 */
async function findOpenGuestFolio(
  reservationId: string,
): Promise<{ folioId: string; reservationId: string } | null> {
  const db = ensureDb();
  const { data } = await db
    .from('folios')
    .select('id, reservation_id')
    .eq('reservation_id', reservationId)
    .eq('folio_type', 'Guest')
    .eq('status', 'Open')
    .maybeSingle();
  return data ? { folioId: data.id, reservationId: data.reservation_id } : null;
}

export async function resolveGuestFolio(
  guestId?: string | null,
  roomNumber?: string | null,
): Promise<{ folioId: string; reservationId: string } | null> {
  const db = ensureDb();
  const activeStatuses = ['CheckedIn', 'Checked In', 'InHouse', 'In House'];

  if (guestId) {
    const { data } = await db
      .from('reservations')
      .select('id')
      .eq('guest_id', guestId)
      .in('status', activeStatuses)
      .order('check_in_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const folio = await findOpenGuestFolio(data.id);
      if (folio) return folio;
    }
  }

  if (roomNumber) {
    const { data } = await db
      .from('reservations')
      .select('id')
      .ilike('room_number', String(roomNumber).trim())
      .in('status', activeStatuses)
      .order('check_in_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const folio = await findOpenGuestFolio(data.id);
      if (folio) return folio;
    }
  }

  return null;
}

/**
 * Post a charge to a guest folio through folioService.postCharge (handles tax,
 * routing rules, audit log). Returns the folio/line ids for linking.
 */
export async function postSpaChargeToFolio(opts: {
  guestId?: string | null;
  roomNumber?: string | null;
  description: string;
  amount: number;
  taxAmount?: number;
  reference?: string;
  user?: any;
}): Promise<{ folioId: string; lineId: string } | null> {
  const folio = await resolveGuestFolio(opts.guestId, opts.roomNumber);
  if (!folio) return null;
  const result = await postCharge(folio.folioId, {
    description: opts.description,
    amount: opts.amount,
    lineType: 'Spa',
    department: 'Spa & Wellness',
    reference: opts.reference,
    taxAmount: opts.taxAmount ?? 0,
    reservationId: folio.reservationId,
  }, opts.user);
  return { folioId: folio.folioId, lineId: result.lineId };
}

// ── Communications dispatch ───────────────────────────────────────────────

/**
 * Dispatch a communication row through the configured email/SMS provider.
 * Resolves the guest's contact address from `guests` when recipient_id is
 * set; broadcast labels (e.g. "All Members") resolve to guests with a stay
 * at the communication's property (guests has no property_id — reservations
 * carry it). Guests whose preferences mark a *_opt_out flag are excluded.
 * Push notifications have no provider — they report Failed so the UI never
 * claims a send that didn't happen.
 */
export async function dispatchComm(comm: {
  comm_type: string;
  recipient_id?: string | null;
  recipient_name?: string | null;
  subject?: string | null;
  message: string;
  property_id?: string | null;
}): Promise<{ status: string; failure_reason?: string | null }> {
  const db = ensureDb();
  if (comm.comm_type === 'Push Notification') {
    return { status: 'Failed', failure_reason: 'No push notification provider configured' };
  }

  const targets: string[] = [];
  if (comm.recipient_id) {
    const { data: g } = await db
      .from('guests').select('email, phone, preferences').eq('id', comm.recipient_id).maybeSingle();
    const prefs = g?.preferences || {};
    if (prefs.marketing_opt_out || prefs.spa_opt_out || prefs.communications_opt_out) {
      return { status: 'Failed', failure_reason: 'Recipient has opted out of communications' };
    }
    const addr = comm.comm_type === 'Email' ? g?.email : g?.phone;
    if (addr) targets.push(addr);
  } else {
    // Broadcast: scope to guests with a stay at this property (guests has
    // no property_id — reservations carry it) and honor opt-out preferences.
    let guestIds: string[] | null = null;
    if (comm.property_id) {
      const { data: res } = await db
        .from('reservations').select('guest_id').eq('property_id', comm.property_id).limit(2000);
      guestIds = [...new Set((res || []).map((r: any) => r.guest_id).filter(Boolean))];
      if (!guestIds.length) {
        return { status: 'Failed', failure_reason: 'No guests on record for this property' };
      }
    }
    let q = db.from('guests').select('email, phone, preferences').limit(500);
    if (guestIds) q = q.in('id', guestIds);
    const { data: gs } = await q;
    for (const g of gs || []) {
      const prefs = g.preferences || {};
      if (prefs.marketing_opt_out || prefs.spa_opt_out || prefs.communications_opt_out) continue;
      const addr = comm.comm_type === 'Email' ? g.email : g.phone;
      if (addr) targets.push(addr);
    }
  }

  if (targets.length === 0) {
    return { status: 'Failed', failure_reason: `No ${comm.comm_type === 'Email' ? 'email address' : 'phone number'} on file for recipient` };
  }

  const result = comm.comm_type === 'Email'
    ? await dispatchEmail(comm.subject || 'Spa & Wellness', comm.message, targets)
    : await dispatchSMS(comm.message, targets);

  if (result.failed > 0 && result.delivered === 0) {
    return { status: 'Failed', failure_reason: `Provider ${result.provider} failed for all ${result.failed} recipient(s)` };
  }
  return {
    status: 'Sent',
    failure_reason: result.failed > 0 ? `Partial delivery: ${result.delivered} sent, ${result.failed} failed` : null,
  };
}

/**
 * Send every Scheduled communication whose scheduled_for has passed.
 * Returns per-row outcomes; used by the dispatch-due endpoint and the
 * scheduler's spa_maintenance job.
 */
export async function dispatchDueCommunications(limit = 50): Promise<Array<{ id: string; status: string }>> {
  const db = ensureDb();
  const { data: due, error } = await db
    .from('spa_communications')
    .select('*')
    .eq('status', 'Scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .limit(limit);
  if (error) throw new SpaError(500, error.message);

  const results: Array<{ id: string; status: string }> = [];
  for (const comm of due || []) {
    // Claim the row first: clearing scheduled_for under a status guard means
    // a concurrent sweep sees nothing to send — no double dispatch.
    const { data: claimed } = await db
      .from('spa_communications')
      .update({ scheduled_for: null, updated_at: new Date().toISOString() })
      .eq('id', comm.id)
      .eq('status', 'Scheduled')
      .not('scheduled_for', 'is', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    const outcome = await dispatchComm(comm);
    await db
      .from('spa_communications')
      .update({
        status: outcome.status,
        failure_reason: outcome.failure_reason ?? null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', comm.id);
    results.push({ id: comm.id, status: outcome.status });
  }
  return results;
}

/**
 * Automated appointment reminders (migration 504). Finds Requested/Confirmed
 * appointments starting within the configured window
 * (general.appointment_reminder: {"enabled", "hours_ahead", "channel"}) that
 * haven't been reminded, claims each by stamping reminder_sent_at under a
 * NULL guard, then dispatches a comm row through the same channel as manual
 * sends — so opt-outs and provider config are honored identically.
 */
export async function sendAppointmentReminders(limit = 100): Promise<Array<{ appointmentId: string; status: string }>> {
  const db = ensureDb();
  const { data: setting } = await db
    .from('spa_settings')
    .select('value')
    .eq('id', 'general.appointment_reminder')
    .eq('status', 'Configured')
    .maybeSingle();
  const cfg = setting?.value || {};
  if (cfg.enabled === false) return [];
  const hoursAhead = Number(cfg.hours_ahead) || 24;
  const channel = cfg.channel === 'SMS' ? 'SMS' : 'Email';

  const now = Date.now();
  const horizon = now + hoursAhead * 3600000;
  const today = new Date(now).toISOString().slice(0, 10);
  const maxDate = new Date(horizon + 86400000).toISOString().slice(0, 10);

  // Over-fetch by date, then filter on the computed start timestamp —
  // start_time is free text so the DB can't compare it directly.
  const { data: appts, error } = await db
    .from('spa_appointments')
    .select('id, guest_id, guest_name, treatment, therapist, appointment_date, start_time, property_id')
    .is('reminder_sent_at', null)
    .in('status', ['Requested', 'Confirmed'])
    .gte('appointment_date', today)
    .lte('appointment_date', maxDate)
    .order('appointment_date')
    .order('start_time')
    .limit(limit * 3);
  if (error) throw new SpaError(500, error.message);

  const results: Array<{ appointmentId: string; status: string }> = [];
  for (const a of appts || []) {
    if (results.length >= limit) break;
    const startMin = timeToMin(a.start_time);
    if (startMin === null) continue;
    const startTs = new Date(`${a.appointment_date}T00:00:00`).getTime() + startMin * 60000;
    if (startTs < now || startTs > horizon) continue;

    // Claim first: a concurrent sweep sees reminder_sent_at set and skips.
    const { data: claimed } = await db
      .from('spa_appointments')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', a.id)
      .is('reminder_sent_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    const commId = await nextSpaId('COM-');
    const comm = {
      comm_type: channel,
      recipient_id: a.guest_id,
      recipient_name: a.guest_name,
      subject: `Appointment reminder — ${a.treatment}`,
      message:
        `Dear ${a.guest_name}, this is a reminder of your ${a.treatment} appointment ` +
        `on ${a.appointment_date} at ${a.start_time}` +
        `${a.therapist ? ` with ${a.therapist}` : ''}. We look forward to seeing you.`,
      property_id: a.property_id,
    };
    const outcome = await dispatchComm(comm);
    await db.from('spa_communications').insert({
      id: commId,
      ...comm,
      category: 'Appointment Reminder',
      status: outcome.status,
      failure_reason: outcome.failure_reason ?? null,
      sent_at: new Date().toISOString(),
    });
    results.push({ appointmentId: a.id, status: outcome.status });
  }
  return results;
}

// ── Booking-time resource enforcement (migration 498) ─────────────────────

/**
 * Shared resource checks for every create/reschedule path (staff portal,
 * guest portal, series):
 *   - room must exist, be bookable, and not be Cleaning/Maintenance/Out of
 *     Service; a due maintenance date is a warning
 *   - when the treatment lists therapist_qualifications, the provider's
 *     certifications must cover them (unverifiable → warning, mismatch → 409)
 *   - the booking must fall inside the 'Operating Hours' spa_setting window
 *     when one is configured
 * Hard violations throw SpaError(409); advisory issues come back as warnings.
 */
export async function checkBookingResources(opts: {
  treatment: { therapist_qualifications?: string[] | null; room_type?: string | null };
  therapistId?: string | null;
  roomId?: string | null;
  date: string;
  startTime: string;
  durationMin: number;
}): Promise<string[]> {
  const db = ensureDb();
  const warnings: string[] = [];

  if (opts.roomId) {
    const { data: room } = await db
      .from('spa_rooms')
      .select('name, room_type, status, is_bookable, next_maintenance')
      .eq('id', opts.roomId)
      .maybeSingle();
    if (!room) throw new SpaError(400, 'Unknown room');
    if (room.is_bookable === false) {
      throw new SpaError(409, `${room.name} is marked not bookable`);
    }
    if (room.status && !['Available', 'In Use'].includes(room.status)) {
      throw new SpaError(409, `${room.name} is ${room.status} — cannot be booked`);
    }
    if (room.next_maintenance && String(room.next_maintenance).slice(0, 10) <= opts.date) {
      warnings.push(`${room.name} is due for maintenance on ${String(room.next_maintenance).slice(0, 10)}`);
    }
    if (opts.treatment.room_type && room.room_type && room.room_type !== opts.treatment.room_type) {
      warnings.push(`${room.name} is a ${room.room_type} room; treatment expects ${opts.treatment.room_type}`);
    }
  }

  const required = (opts.treatment.therapist_qualifications || []).filter(Boolean);
  if (opts.therapistId && required.length) {
    const { data: th } = await db
      .from('spa_therapists')
      .select('name, certifications')
      .eq('id', opts.therapistId)
      .maybeSingle();
    if (th) {
      const held = new Set((th.certifications || []).map((c: string) => c.toLowerCase()));
      const missing = required.filter((q: string) => !held.has(q.toLowerCase()));
      if (missing.length && (th.certifications || []).length) {
        throw new SpaError(409, `${th.name} lacks required qualification(s): ${missing.join(', ')}`);
      }
      if (missing.length) {
        warnings.push(`Could not verify ${th.name}'s qualification(s): ${missing.join(', ')} — no certifications on file`);
      }
    }
  }

  const { data: hoursSetting } = await db
    .from('spa_settings')
    .select('value')
    .eq('id', 'general.operating_hours')
    .eq('status', 'Configured')
    .maybeSingle();
  const open = timeToMin(hoursSetting?.value?.open);
  const close = timeToMin(hoursSetting?.value?.close);
  if (open !== null && close !== null && close > open) {
    const start = timeToMin(opts.startTime);
    if (start !== null && (start < open || start + opts.durationMin > close)) {
      throw new SpaError(409, `Outside spa operating hours (${hoursSetting!.value.open}–${hoursSetting!.value.close})`);
    }
  }

  return warnings;
}

/**
 * Late-cancellation fee from the 'Cancellation Fee' spa_setting
 * ({"percent":N,"window_hours":H}). Charged when the appointment starts
 * within H hours of now; percent=0 disables. Returns the fee applied (0 when
 * none). Best-effort: failures surface as SpaError for the caller to warn on.
 */
export async function applyCancellationFee(appt: {
  id: string;
  guest_id?: string | null;
  guest_name?: string | null;
  treatment?: string | null;
  therapist_id?: string | null;
  appointment_date: string;
  start_time: string;
  amount?: number | null;
  property_id?: string | null;
}): Promise<number> {
  const db = ensureDb();
  const { data: setting } = await db
    .from('spa_settings')
    .select('value')
    .eq('id', 'general.cancellation_fee')
    .eq('status', 'Configured')
    .maybeSingle();
  const percent = Number(setting?.value?.percent) || 0;
  const windowHours = Number(setting?.value?.window_hours) || 0;
  if (percent <= 0) return 0;

  const startMin = timeToMin(appt.start_time);
  if (startMin === null) return 0;
  const startTs = new Date(`${appt.appointment_date}T00:00:00`).getTime() + startMin * 60000;
  const hoursUntilStart = (startTs - Date.now()) / 3600000;
  // Past appointments and cancellations outside the notice window are free.
  if (hoursUntilStart < 0 || hoursUntilStart >= windowHours) return 0;

  const fee = Math.round((Number(appt.amount) || 0) * (percent / 100) * 100) / 100;
  if (fee <= 0) return 0;

  await createSpaTransaction({
    guest_id: appt.guest_id,
    guest_name: appt.guest_name,
    appointment_id: appt.id,
    therapist_id: appt.therapist_id,
    description: `Cancellation fee — ${appt.treatment || 'appointment'}`,
    amount: fee,
    payment_method: 'Unpaid',
    status: 'Pending',
    property_id: appt.property_id,
    source: 'cancellation_fee',
  });
  return fee;
}

/**
 * Flag 'Waiting' waitlist entries that match a freed slot (same preferred
 * date; treatment/therapist when the entry specifies one). Best-effort —
 * never throws.
 */
export async function flagWaitlistForFreedSlot(appt: {
  appointment_date: string;
  treatment_id?: string | null;
  therapist_id?: string | null;
  property_id?: string | null;
}): Promise<void> {
  try {
    const db = ensureDb();
    const matchTerms = ['treatment_id.is.null'];
    if (appt.treatment_id) matchTerms.push(`treatment_id.eq.${appt.treatment_id}`);
    if (appt.therapist_id) matchTerms.push(`therapist_id.eq.${appt.therapist_id}`);
    let wq = db
      .from('spa_waitlist')
      .update({ status: 'Notified', updated_at: new Date().toISOString() })
      .eq('preferred_date', appt.appointment_date)
      .eq('status', 'Waiting')
      .or(matchTerms.join(','));
    if (appt.property_id) wq = wq.or(`property_id.is.null,property_id.eq.${appt.property_id}`);
    await wq;
  } catch { /* waitlist flagging is best-effort */ }
}
