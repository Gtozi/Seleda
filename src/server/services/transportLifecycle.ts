/**
 * Transport trip lifecycle side effects
 * ──────────────────────────────────────────────────────────────────────────
 * Everything that must happen when a transport request completes or is
 * released lives here, so every write path (Trip Management, Dispatch Center,
 * Requests tab, API clients) produces the same result:
 *
 *   Completed  → driver total_trips++, vehicle released, billing charge
 *                auto-created, Guest Folio charges posted to the PMS folio
 *   Cancelled / No Show → assigned vehicle released back to Active
 *
 * All side effects are fire-and-forget-safe: a failure must never block the
 * status transition itself.
 */
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { postCharge } from './folioService';
import crypto from 'crypto';

const RELEASE_STATUSES = ['Completed', 'Cancelled', 'No Show'];

const BILLING_TYPE_BY_PAYMENT: Record<string, string> = {
  'Guest Folio': 'Guest Folio',
  'Corporate Billing': 'Corporate Account',
  'Event Billing': 'Event Master Account',
  'Internal Department Charge': 'Internal Cost Center',
};

function chargeNumber(): string {
  return `BL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

/** Release the assigned vehicle back to Active (only if it is In Use). */
async function releaseVehicle(request: any) {
  if (!request?.assigned_vehicle) return;
  await supabaseAdmin!
    .from('transport_vehicles')
    .update({ status: 'Active', updated_at: new Date().toISOString() })
    .eq('property_id', request.property_id)
    .eq('vehicle_number', request.assigned_vehicle)
    .eq('status', 'In Use');
}

async function incrementDriverTrips(request: any) {
  if (!request?.driver_id) return;
  const { data: driver } = await supabaseAdmin!
    .from('transport_drivers')
    .select('id, total_trips')
    .eq('id', request.driver_id)
    .maybeSingle();
  if (!driver) return;
  await supabaseAdmin!
    .from('transport_drivers')
    .update({ total_trips: (driver.total_trips || 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', driver.id);
}

/**
 * Find the guest's open guest folio via their current (checked-in)
 * reservation. Returns null when the guest has no open folio.
 */
async function findOpenGuestFolio(request: any) {
  if (!request?.guest_id) return null;
  const { data: reservation } = await supabaseAdmin!
    .from('reservations')
    .select('id')
    .eq('guest_id', request.guest_id)
    .in('status', ['CheckedIn', 'Checked In', 'InHouse', 'In-House'])
    .order('check_in_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!reservation) return null;
  const { data: folio } = await supabaseAdmin!
    .from('folios')
    .select('id')
    .eq('reservation_id', reservation.id)
    .eq('folio_type', 'Guest')
    .eq('status', 'Open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return folio ? { folioId: folio.id as string, reservationId: reservation.id as string } : null;
}

/**
 * Post a Guest Folio billing charge to the PMS folio ledger. Returns the
 * folio line reference, or null when no open folio exists / posting failed.
 */
export async function postTransportChargeToFolio(charge: any, request?: any): Promise<string | null> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return null;
  try {
    const req = request || (charge.trip_id
      ? (await supabaseAdmin.from('transport_requests').select('*').eq('id', charge.trip_id).maybeSingle()).data
      : null);
    const target = await findOpenGuestFolio(req);
    if (!target) return null;

    const result = await postCharge(target.folioId, {
      description: `Transport — ${charge.type || req?.type || 'Transfer'} (${req?.request_number || charge.charge_number})`,
      amount: Number(charge.amount) || 0,
      lineType: 'Other',
      department: 'Transportation',
      reference: charge.charge_number,
      reservationId: target.reservationId,
    });
    return result?.lineId || null;
  } catch (e: any) {
    console.warn('[transport] folio posting failed:', e?.message);
    return null;
  }
}

/**
 * Auto-create a billing charge for a completed trip when none exists yet,
 * then post it to the folio when the payment method is Guest Folio.
 */
async function autoCreateBillingCharge(request: any) {
  const amount = Number(request.amount) || 0;
  if (amount <= 0) return;

  const { data: existing } = await supabaseAdmin!
    .from('transport_billing_charges')
    .select('id')
    .eq('trip_id', request.id)
    .limit(1);
  if (existing && existing.length > 0) return;

  const billingType = BILLING_TYPE_BY_PAYMENT[request.payment_method] || 'Guest Folio';
  const { data: charge } = await supabaseAdmin!
    .from('transport_billing_charges')
    .insert({
      id: crypto.randomUUID(),
      property_id: request.property_id,
      charge_number: chargeNumber(),
      trip_id: request.id,
      guest_name: request.guest_name || null,
      room: request.room || null,
      type: request.type || null,
      billing_type: billingType,
      amount,
      status: 'Pending',
      charge_date: new Date().toISOString().slice(0, 10),
      payment_method: billingType === 'Guest Folio' ? 'Room Charge'
        : billingType === 'Internal Cost Center' ? 'Internal Transfer' : 'Corporate Credit',
      reference: request.request_number || null,
    })
    .select()
    .single();
  if (!charge) return;

  if (billingType === 'Guest Folio') {
    const lineId = await postTransportChargeToFolio(charge, request);
    if (lineId) {
      await supabaseAdmin!
        .from('transport_billing_charges')
        .update({ status: 'Posted', reference: lineId, updated_at: new Date().toISOString() })
        .eq('id', charge.id);
    }
  }
}

// ── Guest notifications ──────────────────────────────────────────────────────

const GUEST_NOTIFY: Record<string, (r: any) => { title: string; message: string }> = {
  Confirmed: (r) => ({
    title: 'Transportation confirmed',
    message: `Your ${r.type || 'transfer'} ${r.request_number} is confirmed for ${new Date(r.scheduled_time).toLocaleString()}.`,
  }),
  Assigned: (r) => ({
    title: 'Driver assigned',
    message: `A driver has been assigned to your ${r.type || 'transfer'} ${r.request_number}.`,
  }),
  'Driver En Route': (r) => ({
    title: 'Driver on the way',
    message: `Your driver is en route to ${r.pickup_location}.`,
  }),
  'Guest Picked Up': (r) => ({
    title: 'Pickup confirmed',
    message: `You're on the way to ${r.destination}.`,
  }),
  Completed: (r) => ({
    title: 'Trip completed',
    message: `Your ${r.type || 'transfer'} ${r.request_number} is complete. Thank you.`,
  }),
  Cancelled: (r) => ({
    title: 'Transportation cancelled',
    message: `Your ${r.type || 'transfer'} ${r.request_number} has been cancelled. Contact the front desk to rebook.`,
  }),
};

/**
 * Push an in-app guest notification for guest-facing status transitions.
 * Writes to guest_notifications (migration 653) — the feed the guest portal
 * notifications tab reads.
 */
async function notifyGuest(request: any) {
  if (!request?.guest_id) return;
  const builder = GUEST_NOTIFY[request.status];
  if (!builder) return;
  const { title, message } = builder(request);
  const { error } = await supabaseAdmin!.from('guest_notifications').insert({
    property_id: request.property_id,
    guest_id: request.guest_id,
    reservation_id: request.reservation_id || null,
    category: 'transportation',
    title,
    message,
    priority: request.status === 'Driver En Route' || request.status === 'Guest Picked Up' ? 'high' : 'normal',
  });
  if (error) console.warn('[transport] guest notification failed:', error.message);
}

const ATTENDANCE_SHIFTS = ['Morning', 'Evening', 'Night'];

/**
 * HR attendance bridge: when a staff trip (transport_trips) completes, mark
 * the employee Present for that date. Uses ON CONFLICT DO NOTHING so an
 * existing HK/FO/FB/ENG attendance record for the day is never clobbered.
 */
export async function markStaffAttendanceFromTrip(trip: any): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !trip?.employee_id) return;
  try {
    const anchor = trip.actual_at || trip.scheduled_at || new Date().toISOString();
    const attendanceDate = new Date(anchor).toISOString().slice(0, 10);
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('name')
      .eq('id', trip.employee_id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from('staff_attendance').upsert({
      id: crypto.randomUUID(),
      property_id: trip.property_id,
      staff_id: trip.employee_id,
      staff_name: emp?.name || trip.employee_id,
      employee_id: trip.employee_id,
      department_scope: 'TR',
      attendance_date: attendanceDate,
      shift: ATTENDANCE_SHIFTS.includes(trip.shift) ? trip.shift : 'Morning',
      check_in: anchor,
      status: 'Present',
      notes: `Staff transport ${trip.id}`,
    }, { onConflict: 'staff_id,attendance_date', ignoreDuplicates: true });
    if (error) console.warn('[transport] staff attendance bridge failed:', error.message);
  } catch (e: any) {
    console.warn('[transport] staff attendance bridge failed:', e?.message);
  }
}

/**
 * Run lifecycle side effects for a status transition.
 * previousStatus → nextStatus on the given (already-updated) request row.
 */
export async function runTransportStatusSideEffects(
  request: any,
  previousStatus?: string | null,
  options?: { skipBilling?: boolean }
): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !request) return;
  const next = request.status;
  if (!next || next === previousStatus) return;
  try {
    if (RELEASE_STATUSES.includes(next)) {
      await releaseVehicle(request);
    }
    if (next === 'Completed') {
      await incrementDriverTrips(request);
      // transport_billing_charges.trip_id FKs to transport_requests — only
      // auto-charge rows that actually live in that table.
      if (!options?.skipBilling) await autoCreateBillingCharge(request);
    }
    await notifyGuest(request);
  } catch (e: any) {
    console.warn('[transport] status side effects failed:', e?.message);
  }
}

/**
 * Fetch the transport_requests row bridged from a silo table (source_ref like
 * 'at:<id>', 'gt:<id>', 'ct:<id>', 'asr:<id>'). Call BEFORE updating the silo
 * row so `status` captures the pre-update value.
 */
export async function findBridgedRequest(sourceRef: string) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from('transport_requests')
    .select('*')
    .eq('source_ref', sourceRef)
    .maybeSingle();
  return data;
}

/**
 * After a silo row is updated (its status already synced to the bridged
 * request by trigger), run lifecycle side effects on the bridged
 * transport_requests row using the pre-update snapshot for transition
 * detection. Runs full billing since trip_id points at a real request.
 */
export async function runBridgedRequestSideEffects(before: any | null): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !before?.id) return;
  const { data: after } = await supabaseAdmin
    .from('transport_requests')
    .select('*')
    .eq('id', before.id)
    .maybeSingle();
  if (!after) return;
  await runTransportStatusSideEffects(after, before.status);
}

/**
 * Check for a driver/vehicle double-booking. Returns the conflicting request
 * when the same driver or vehicle already has an active trip within
 * ±windowMinutes of the requested scheduled time.
 */
export async function findAssignmentConflict(params: {
  propertyId: string;
  excludeId?: string | null;
  driverId?: string | null;
  assignedVehicle?: string | null;
  scheduledTime?: string | null;
  windowMinutes?: number;
}) {
  const { propertyId, excludeId, driverId, assignedVehicle, scheduledTime } = params;
  if (!propertyId || (!driverId && !assignedVehicle)) return null;

  const windowMinutes = params.windowMinutes ?? 120;
  const ACTIVE = ['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress'];

  let query = supabaseAdmin!
    .from('transport_requests')
    .select('id, request_number, guest_name, scheduled_time, driver_id, assigned_vehicle, status')
    .eq('property_id', propertyId)
    .in('status', ACTIVE);
  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error || !data) return null;

  const center = scheduledTime ? new Date(scheduledTime).getTime() : null;
  const windowMs = windowMinutes * 60 * 1000;

  for (const r of data) {
    const driverHit = driverId && r.driver_id === driverId;
    const vehicleHit = assignedVehicle && r.assigned_vehicle === assignedVehicle;
    if (!driverHit && !vehicleHit) continue;
    if (center === null) return r;
    const t = new Date(r.scheduled_time).getTime();
    if (Math.abs(t - center) <= windowMs) return r;
  }
  return null;
}
