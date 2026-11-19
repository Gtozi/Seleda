import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { snakeToCamelRecord, camelToSnakeRecord } from '../services/sharedServices';
import { isFullAccessRole } from '../../types/erp';
import { dispatchEmail, dispatchSMS } from '../services/salesMessageDispatch';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// Resolve the property scope for a request. Order: the authenticated user's
// assigned property (system_users.property_id, mapped to req.user.propertyId),
// then the client-selected property sent as the X-Property-Id header, query
// param, or body field — matching the codebase convention of passing
// propertyId through the request.
function resolvePropertyId(req: any): string | undefined {
  return (
    req.user?.propertyId ||
    (req.headers['x-property-id'] as string | undefined) ||
    (req.query?.propertyId as string | undefined) ||
    req.body?.propertyId ||
    undefined
  );
}

// Config is property-level setup (deposits, tax, integrations). Restrict writes
// to banquet/operations managers and full-access roles — plain `authenticate`
// let any signed-in user (guest, member, …) overwrite it.
const CONFIG_WRITE_ROLES = ['banquet', 'ops_manager', 'operations', 'sales'];
function canWriteBanquetConfig(user: any): boolean {
  return isFullAccessRole(user?.role) || CONFIG_WRITE_ROLES.includes(user?.role);
}

// Minimal required-field guard. Sends a 400 and returns true when any listed
// body field is missing or empty; callers do `if (requireFields(...)) return;`.
function requireFields(res: any, body: any, fields: string[]): boolean {
  const missing = fields.filter(f => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) {
    res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    return true;
  }
  return false;
}

// ── Events ─────────────────────────────────────────────────────────
// Canonical entity is `event_bookings` (migration 444). It replaced the former
// split between `events` (Sales portal) and `banquet_events` (this portal), and
// the shadow-row hack that used to bridge them.
//
// Lifecycle is a single forward-only ladder enforced in the database by
// advance_event_status():
//   Inquiry -> Tentative -> Confirmed -> Planning -> InProgress -> Completed
// with Cancelled reachable from any pre-Completed state.
//
// All monetary fields other than quotedAmount / depositRequired are DERIVED from
// event_charges by recalc_event_totals(). Never write them from here.

const EVENT_SELECT = '*';

// Venue blackout check (migration 469): returns the conflicting blackout row
// if any of the venues is out of service over [startDate, endDate].
async function findVenueBlackout(venueIds: string[], startDate?: string, endDate?: string) {
  if (!venueIds?.length || !startDate) return null;
  const { data } = await supabaseAdmin.from('banquet_venue_blackouts')
    .select('*, banquet_venues!left(venue_name)')
    .in('venue_id', venueIds)
    .lte('start_date', endDate || startDate)
    .gte('end_date', startDate);
  return data?.[0] || null;
}

function blackoutMessage(b: any) {
  const name = b.banquet_venues?.venue_name || b.venue_id;
  return `Venue "${name}" is unavailable ${b.start_date} → ${b.end_date}${b.reason ? ` (${b.reason})` : ''}`;
}

function mapEvent(row: any) {
  return {
    ...snakeToCamelRecord(row),
    eventId: row.id,
    eventCode: row.event_code,
    eventName: row.event_name,
    eventType: row.event_type,
    clientId: row.client_id,
    clientName: row.client_name,
    organizerName: row.organizer_name,
    corporateAccountId: row.corporate_account_id,
    contractId: row.contract_id,
    startDate: row.start_date,
    endDate: row.end_date,
    venueIds: row.venue_ids || [],
    expectedAttendance: row.expected_attendance,
    actualAttendance: row.actual_attendance,
    packageId: row.package_id,
    status: row.status,
    notes: row.notes,

    // Money — all derived except quotedAmount / depositRequired.
    quotedAmount: Number(row.quoted_amount || 0),
    contractedAmount: Number(row.contracted_amount || 0),
    chargesSubtotal: Number(row.charges_subtotal || 0),
    discountTotal: Number(row.discount_total || 0),
    serviceChargeTotal: Number(row.service_charge_total || 0),
    taxTotal: Number(row.tax_total || 0),
    grandTotal: Number(row.grand_total || 0),
    depositRequired: Number(row.deposit_required || 0),
    depositPaidAmount: Number(row.deposit_paid_amount || 0),
    paidTotal: Number(row.paid_total || 0),
    balanceDue: Number(row.balance_due || 0),
    actualRevenue: Number(row.actual_revenue || 0),
    currency: row.currency || 'ETB',

    billingMode: row.billing_mode,
    billingStatus: row.billing_status,
    folioId: row.folio_id,
    invoiceId: row.invoice_id,
    beoGenerated: row.beo_generated,
    satisfactionScore: row.satisfaction_score != null ? Number(row.satisfaction_score) : null,
    feedback: row.feedback,

    // Legacy aliases so existing UI bindings keep resolving. `estimatedRevenue`
    // now prefers the derived grand total and falls back to the quote.
    estimatedRevenue: Number(row.grand_total || 0) || Number(row.quoted_amount || 0),
    depositAmount: Number(row.deposit_required || 0),
    depositPaid: Number(row.deposit_required || 0) > 0
      && Number(row.deposit_paid_amount || 0) >= Number(row.deposit_required || 0),
    finalBalance: Number(row.balance_due || 0),
    finalPaid: row.billing_status === 'Paid',
  };
}

router.get('/events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  const { status, from, to } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('event_bookings').select(EVENT_SELECT)
    .order('start_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('start_date', from);
  if (to) q = q.lte('start_date', to);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json((data || []).map(mapEvent));
});

router.get('/events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('event_bookings')
    .select(EVENT_SELECT).eq('id', req.params.id).single();
  if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });

  return res.json(mapEvent(data));
});

router.post('/events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  if (!body.eventName) return res.status(400).json({ error: 'eventName is required' });
  if (!body.startDate) return res.status(400).json({ error: 'startDate is required' });

  const record: any = {
    property_id: resolvePropertyId(req),
    event_name: body.eventName,
    event_type: body.eventType,
    client_id: body.clientId || null,
    client_name: body.clientName || 'Unassigned',
    organizer_name: body.organizerName,
    contact_email: body.contactEmail,
    contact_phone: body.contactPhone,
    corporate_account_id: body.corporateAccountId || null,
    start_date: body.startDate,
    end_date: body.endDate || body.startDate,
    venue_ids: body.venueIds || [],
    expected_attendance: Number(body.expectedAttendance) || 0,
    service_style: body.serviceStyle,
    package_id: body.packageId || null,
    special_requirements: body.specialRequirements,
    notes: body.notes,
    // The quote is an input; everything else is derived from event_charges.
    quoted_amount: Number(body.quotedAmount ?? body.estimatedRevenue) || 0,
    deposit_required: Number(body.depositRequired ?? body.depositAmount) || 0,
    billing_mode: body.corporateAccountId ? 'corporate' : 'direct',
    // New bookings always enter at the front of the ladder. Advancing beyond
    // this point goes through advance_event_status so the gates are applied.
    status: 'Inquiry',
    created_by: (req as any).user?.id,
    risk_level: body.riskLevel || 'Low',
    risk_notes: body.riskNotes,
  };

  // Reject bookings on venues that are out of service over the event dates.
  const blackout = await findVenueBlackout(record.venue_ids, record.start_date, record.end_date);
  if (blackout) return res.status(409).json({ error: blackoutMessage(blackout) });

  const { data, error } = await supabaseAdmin.from('event_bookings')
    .insert(record).select(EVENT_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json(mapEvent(data));
});

// Editable event details. Money columns are intentionally not writable here.
router.put('/events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  const editable: Record<string, any> = {
    event_name: body.eventName,
    event_type: body.eventType,
    client_id: body.clientId,
    client_name: body.clientName,
    organizer_name: body.organizerName,
    contact_email: body.contactEmail,
    contact_phone: body.contactPhone,
    corporate_account_id: body.corporateAccountId,
    start_date: body.startDate,
    end_date: body.endDate,
    setup_time: body.setupTime,
    event_start_time: body.eventStartTime,
    event_end_time: body.eventEndTime,
    breakdown_time: body.breakdownTime,
    venue_ids: body.venueIds,
    expected_attendance: body.expectedAttendance,
    actual_attendance: body.actualAttendance,
    service_style: body.serviceStyle,
    package_id: body.packageId,
    special_requirements: body.specialRequirements,
    notes: body.notes,
    quoted_amount: body.quotedAmount,
    deposit_required: body.depositRequired ?? body.depositAmount,
    billing_mode: body.billingMode,
    satisfaction_score: body.satisfactionScore,
    feedback: body.feedback,
    risk_level: body.riskLevel,
    risk_notes: body.riskNotes,
  };

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(editable)) {
    if (value !== undefined) updates[key] = value;
  }

  // If venues or dates are moving, re-check blackout windows before writing.
  if (updates.venue_ids !== undefined || updates.start_date !== undefined || updates.end_date !== undefined) {
    const { data: existing } = await supabaseAdmin.from('event_bookings')
      .select('venue_ids, start_date, end_date').eq('id', req.params.id).single();
    const blackout = await findVenueBlackout(
      updates.venue_ids ?? existing?.venue_ids,
      updates.start_date ?? existing?.start_date,
      updates.end_date ?? existing?.end_date
    );
    if (blackout) return res.status(409).json({ error: blackoutMessage(blackout) });
  }

  const { data, error } = await supabaseAdmin.from('event_bookings')
    .update(updates).eq('id', req.params.id).select(EVENT_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });

  // Venue, headcount and date changes all move the price, so re-derive.
  await supabaseAdmin.rpc('rebuild_event_charges', { p_event_id: req.params.id });

  const { data: fresh } = await supabaseAdmin.from('event_bookings')
    .select(EVENT_SELECT).eq('id', req.params.id).single();
  return res.json(mapEvent(fresh || data));
});

// Status transitions go through the database so the ladder, the venue
// double-booking check and the confirmation gates are always applied — the old
// handler blindly wrote whatever status the client sent.
router.put('/events/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Confirming onto a blacked-out venue is rejected before the ladder runs.
  if (req.body.status === 'Confirmed') {
    const { data: evt } = await supabaseAdmin.from('event_bookings')
      .select('venue_ids, start_date, end_date').eq('id', req.params.id).single();
    const blackout = await findVenueBlackout(evt?.venue_ids, evt?.start_date, evt?.end_date);
    if (blackout) return res.status(409).json({ error: blackoutMessage(blackout) });
  }

  const { data, error } = await supabaseAdmin.rpc('advance_event_status', {
    p_event_id: req.params.id,
    p_status: req.body.status,
    p_user_id: (req as any).user?.id || null,
    p_reason: req.body.reason || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error || 'Transition rejected' });

  // Entering InProgress/Completed is the point at which charges must be final.
  if (['InProgress', 'Completed'].includes(req.body.status)) {
    await supabaseAdmin.rpc('rebuild_event_charges', { p_event_id: req.params.id });
  }

  const { data: event } = await supabaseAdmin.from('event_bookings')
    .select(EVENT_SELECT).eq('id', req.params.id).single();

  // Notify the client (guest portal feed) when their event changes state.
  if (event?.client_id) {
    try {
      const status = String(req.body.status);
      await supabaseAdmin.from('guest_notifications').insert({
        property_id: event.property_id || null,
        guest_id: event.client_id,
        reservation_id: null,
        category: 'general',
        title: `Event ${status === 'Confirmed' ? 'confirmed' : 'update'}`,
        message: `${event.event_name || 'Your event'} (${event.event_date || ''}) is now ${status}.`,
        priority: status === 'Confirmed' ? 'high' : 'normal',
      });
    } catch (e: any) {
      console.warn('event guest notification failed:', e?.message);
    }
  }

  return res.json({ ...data, event: event ? mapEvent(event) : null });
});

// Event -> BEO. Single entry point; idempotent, and advances Confirmed to
// Planning so the ops stage follows automatically.
router.post('/events/:id/beo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.rpc('generate_beo_for_event', {
    p_event_id: req.params.id,
    p_user_id: (req as any).user?.id || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error });

  return res.status(data.created ? 201 : 200).json(data);
});

// Manual checklist seeding for an event (idempotent — safe to call anytime).
// Auto-seeding happens on Planning transition; this endpoint lets users
// re-seed after templates are added/changed in Configuration.
router.post('/events/:id/seed-checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.rpc('seed_checklists_for_event', {
    p_event_id: req.params.id,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Event-Type Details (per event) ────────────────────────────────
// Unified endpoint to fetch/save type-specific enrichment details for an
// event (wedding, conference, meeting, social). Room blocks are managed
// separately in the Pipeline tab. This replaces the removed Event Types tab
// — the details now live in the Planning view's expanded row.
router.get('/events/:id/type-details', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('banquet_event_type_items')
    .select('id, item_type, item_data, created_at, updated_at')
    .eq('event_id', req.params.id)
    .neq('item_type', 'roomblock')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    itemId: row.id,
    itemType: row.item_type,
    itemData: row.item_data || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return res.json(items);
});

router.post('/events/:id/type-details', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const itemType = req.body.itemType;
  if (!['wedding', 'conference', 'meeting', 'social'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid item type' });
  }

  const body = { ...req.body.itemData };
  const record = {
    property_id: resolvePropertyId(req),
    event_id: req.params.id,
    item_type: itemType,
    item_data: body
  };

  const { data, error } = await supabaseAdmin.from('banquet_event_type_items').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ itemId: data.id, ...data });
});

router.put('/type-details/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('banquet_event_type_items')
    .update({ item_data: req.body.itemData, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/type-details/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin.from('banquet_event_type_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Venues ─────────────────────────────────────────────────────────
router.get('/venues', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_venues').select('*').order('venue_name');
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const venues = (data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    venueId: row.id,
    venueName: row.venue_name,
    venueType: row.venue_type,
    hourlyRate: row.hourly_rate,
    dailyRate: row.daily_rate,
    isActive: row.is_active,
    capacity: row.capacity,
    area: row.area,
    floor: row.floor,
    features: row.features || [],
    layouts: row.layouts || [],
  }));

  return res.json(venues);
});

router.post('/venues', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.venueId;
  if (requireFields(res, body, ['venueName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_venues').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/venues/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.venueId;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_venues').update(record).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Schedules ──────────────────────────────────────────────────────
router.get('/schedules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_schedules').select('*').order('start_time', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const schedules = (data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    scheduleId: row.id,
    startTime: row.start_time,
    endTime: row.end_time,
    taskName: row.task_name,
    assignedTo: row.assigned_to,
    eventId: row.event_id,
    notes: row.notes
  }));

  return res.json(schedules);
});

router.post('/schedules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.scheduleId;
  if (requireFields(res, body, ['eventId', 'taskName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_schedules').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Checklists ─────────────────────────────────────────────────────
router.get('/checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_checklists').select('*').order('due_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const checklists = (data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    checklistId: row.id,
    itemName: row.item_name,
    dueDate: row.due_date,
    assignedTo: row.assigned_to,
    isCompleted: row.is_completed,
    eventId: row.event_id
  }));

  return res.json(checklists);
});

router.post('/checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.checklistId;
  if (requireFields(res, body, ['eventId', 'itemName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;
  record.is_completed = false;

  const { data, error } = await supabaseAdmin.from('banquet_checklists').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/checklists/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates = {
    is_completed: req.body.isCompleted,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseAdmin.from('banquet_checklists').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── BEOs ───────────────────────────────────────────────────────────
async function getEventForBeo(eventId: string) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from('event_bookings')
    .select('event_name, client_name, start_date, venue_ids, property_id')
    .eq('id', eventId)
    .single();
  if (error || !data) return null;
  return { ...data, event_date: data.start_date };
}

// When a BEO is distributed, push the catering work to the F&B kitchen:
// a fb_banquet_production_requirements row for the event plus one
// fb_banquet_production_menu_items line per banquet menu item, so the
// kitchen Production Coordination module can plan and track the prep.
// Idempotent — skips if a requirement already exists for the event.
async function pushBeoToKitchenProduction(beo: any) {
  if (!supabaseAdmin || !beo?.event_id) return;

  const { data: existing } = await supabaseAdmin.from('fb_banquet_production_requirements')
    .select('id').eq('banquet_event_id', beo.event_id).maybeSingle();
  if (existing) return;

  // Prep lead time from the BEO schedule (setup → event start), in hours.
  const toHours = (a?: string | null, b?: string | null) => {
    const pa = a ? Date.parse(a) : NaN;
    const pb = b ? Date.parse(b) : NaN;
    return Number.isFinite(pa) && Number.isFinite(pb) && pb > pa
      ? Math.round(((pb - pa) / 3600000) * 10) / 10
      : 4;
  };

  const { data: reqRow, error: reqErr } = await supabaseAdmin
    .from('fb_banquet_production_requirements')
    .insert({
      banquet_event_id: beo.event_id,
      preparation_area: 'Banquet Kitchen',
      prep_start_hours_before: toHours(beo.setup_time, beo.event_start_time),
      prep_duration_minutes: 120,
      staff_count: Array.isArray(beo.staffing) ? beo.staffing.length : 0,
      equipment_needed: Array.isArray(beo.equipment) ? beo.equipment.join(', ') : (beo.equipment || null),
      special_instructions: Array.isArray(beo.special_requests) ? beo.special_requests.join('; ') : (beo.special_requests || null),
    })
    .select('id')
    .single();
  if (reqErr || !reqRow) {
    console.error('Failed to create banquet production requirement:', reqErr?.message);
    return;
  }

  const { data: menuItems } = await supabaseAdmin.from('banquet_menu_items')
    .select('menu_item_id, dish_name, quantity')
    .eq('event_id', beo.event_id);

  const lines = (menuItems || [])
    .filter((mi: any) => mi.menu_item_id)
    .map((mi: any) => ({
      production_requirement_id: reqRow.id,
      menu_item_id: mi.menu_item_id,
      quantity_per_guest: 1,
      total_quantity: Number(mi.quantity) || 0,
      prep_status: 'Pending',
    }));
  if (lines.length) {
    const { error: linesErr } = await supabaseAdmin.from('fb_banquet_production_menu_items').insert(lines);
    if (linesErr) console.error('Failed to create production menu item lines:', linesErr.message);
  }
}

router.get('/beos', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_beos').select('*').order('event_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const beos = (data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    beoId: row.id,
    eventName: row.event_name,
    clientName: row.client_name,
    eventDate: row.event_date,
    venueIds: row.venue_ids || [],
    setupTime: row.setup_time,
    eventStartTime: row.event_start_time,
    eventEndTime: row.event_end_time,
    breakdownTime: row.breakdown_time,
    menuItems: row.menu_items || [],
    beverageItems: row.beverage_items || [],
    specialRequests: row.special_requests || [],
    vipInformation: row.vip_information || [],
    distributedTo: row.distributed_to || [],
    distributedAt: row.distributed_at
  }));

  return res.json(beos);
});

router.post('/beos', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  const event = await getEventForBeo(body.eventId);
  if (!event) return res.status(400).json({ error: 'Invalid event' });

  const record = {
    property_id: resolvePropertyId(req) || event.property_id,
    event_id: body.eventId,
    event_name: event.event_name,
    client_name: event.client_name,
    event_date: event.event_date,
    venue_ids: event.venue_ids || [],
    setup_time: body.setupTime,
    event_start_time: body.eventStartTime,
    event_end_time: body.eventEndTime,
    breakdown_time: body.breakdownTime,
    menu_items: body.menuItems || [],
    beverage_items: body.beverageItems || [],
    equipment: body.equipment || [],
    staffing: body.staffing || [],
    special_requests: body.specialRequests || [],
    vip_information: body.vipInformation || [],
    status: body.status
  };

  const { data, error } = await supabaseAdmin.from('banquet_beos').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/beos/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.beoId;
  let record: any = camelToSnakeRecord(body);

  if (record.event_id) {
    const event = await getEventForBeo(record.event_id);
    if (event) {
      record = {
        ...record,
        event_name: event.event_name,
        client_name: event.client_name,
        event_date: event.event_date,
        venue_ids: event.venue_ids || []
      };
    }
  }

  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_beos').update(record).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// BEO lifecycle: Draft -> Review -> Approved -> Distributed -> Final -> Completed.
// Distribution is delegated to distribute_beo(), which additionally materialises
// department schedule rows — previously "Distributed" only stamped a timestamp
// and no department was ever actually told about the event.
router.put('/beos/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const status = req.body.status;

  if (status === 'Distributed') {
    const { data, error } = await supabaseAdmin.rpc('distribute_beo', {
      p_beo_id: req.params.id,
      p_user_id: (req as any).user?.id || null,
    });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.success) return res.status(409).json({ error: data?.error });

    const { data: beo } = await supabaseAdmin.from('banquet_beos')
      .select('*').eq('id', req.params.id).single();

    // Bridge to kitchen: distribute also creates a banquet production
    // requirement + per-dish lines so the F&B Production Coordination
    // module picks the prep work up (push-to-production-plan endpoint).
    try {
      await pushBeoToKitchenProduction(beo);
    } catch (e) {
      console.error('BEO kitchen production bridge failed:', e);
    }

    return res.json({ ...beo, tasksCreated: data.tasksCreated });
  }

  const { data, error } = await supabaseAdmin.from('banquet_beos')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // A Final BEO means the event is being executed; a Completed BEO means the
  // event is over. Both go through advance_event_status so the ladder holds.
  const nextEventStatus = status === 'Final' ? 'InProgress'
    : status === 'Completed' ? 'Completed'
    : null;

  if (nextEventStatus && data?.event_id) {
    await supabaseAdmin.rpc('advance_event_status', {
      p_event_id: data.event_id,
      p_status: nextEventStatus,
      p_user_id: (req as any).user?.id || null,
      p_reason: null,
    });
  }

  return res.json(data);
});

// ── Event Type Items (Weddings, Conferences, Meetings, Social, Room Blocks) ──
const eventTypeRoutes: { type: string; path: string }[] = [
  { type: 'wedding', path: 'wedding-details' },
  { type: 'conference', path: 'conference-sessions' },
  { type: 'meeting', path: 'meeting-agenda' },
  { type: 'social', path: 'social-details' },
  { type: 'roomblock', path: 'room-blocks' }
];

function flattenEventTypeItem(row: any) {
  const event = row.event_bookings || {};
  return {
    itemId: row.id,
    eventId: row.event_id,
    eventName: event.event_name || row.event_id,
    clientName: event.client_name,
    eventType: event.event_type,
    startDate: event.start_date,
    endDate: event.end_date,
    status: event.status,
    expectedAttendance: event.expected_attendance,
    estimatedRevenue: Number(event.quoted_amount || 0) || Number(event.grand_total || 0),
    venueIds: event.venue_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...row.item_data
  };
}

eventTypeRoutes.forEach(({ type, path }) => {
  router.get(`/${path}`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

    const propertyId = resolvePropertyId(req);
    let q = supabaseAdmin.from('banquet_event_type_items')
      .select('*, event_bookings!left(event_name, client_name, start_date, end_date, event_type, status, expected_attendance, quoted_amount, venue_ids)')
      .eq('item_type', type)
      .order('created_at', { ascending: true });
    if (propertyId) q = q.eq('property_id', propertyId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json((data || []).map(flattenEventTypeItem));
  });

  router.post(`/${path}`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

    const body = { ...req.body };
    const eventId = body.eventId;
    delete body.eventId;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });

    const record = {
      property_id: resolvePropertyId(req),
      event_id: eventId,
      item_type: type,
      item_data: body
    };

    const { data, error } = await supabaseAdmin.from('banquet_event_type_items').insert(record).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  });
});

// ── Event Type Checklists ──────────────────────────────────────────
router.get('/event-type-checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  const type = req.query.type as string;
  let q = supabaseAdmin.from('banquet_event_type_checklists')
    .select('*, event_bookings!left(event_name, client_name)')
    .order('due_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (type) q = q.eq('item_type', type);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const checklists = (data || []).map((row: any) => ({
    checklistId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    clientName: row.event_bookings?.client_name,
    itemType: row.item_type,
    itemName: row.item_name,
    isCompleted: row.is_completed,
    dueDate: row.due_date,
    assignedTo: row.assigned_to
  }));
  return res.json(checklists);
});

router.post('/event-type-checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.checklistId;
  if (requireFields(res, body, ['eventId', 'itemName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;
  record.is_completed = false;

  const { data, error } = await supabaseAdmin.from('banquet_event_type_checklists').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/event-type-checklists/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates = {
    is_completed: req.body.isCompleted,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseAdmin.from('banquet_event_type_checklists').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Unified checklists: combines banquet_checklists (general planning) and
// banquet_event_type_checklists (per-type) into a single list so the portal
// can render all checklist items in one place. Both tables are kept for
// backward compatibility; this endpoint is the single read source going
// forward. Optional ?eventId= filters to a single event; ?type= filters the
// event-type portion.
router.get('/checklists/unified', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  const eventId = req.query.eventId as string | undefined;

  // All checklists now live in banquet_checklists (consolidated).
  // source column: 'manual' | 'event-type' | 'template'
  let q = supabaseAdmin.from('banquet_checklists').select('*');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    checklistId: row.id,
    source: row.source || 'manual',
    eventId: row.event_id,
    itemType: row.item_type || null,
    itemName: row.item_name,
    isCompleted: row.is_completed,
    dueDate: row.due_date,
    assignedTo: row.assigned_to
  }));

  return res.json(items);
});

// ── Staff Management ────────────────────────────────────────────────
// GET /staff — list all banquet staff
router.get('/staff', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_staff').select('*').order('name');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /staff/employees/:propertyId — list HR employees for linking
router.get('/staff/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('employees')
    .select('id, name, email, phone, position, department, status')
    .eq('property_id', req.params.propertyId)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /staff — create staff assignment
router.post('/staff', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['name'])) return;
  const { employeeId, name, email, phone, role, shift, functionArea, status, workload, eventsHandled, ytdRevenue, propertyId } = req.body;
  const { data, error } = await supabaseAdmin.from('banquet_staff')
    .insert({
      employee_id: employeeId || null, name, email: email || null, phone: phone || null,
      role: role || 'Banquet Server', shift: shift || 'Morning', function_area: functionArea || 'Ballroom',
      status: status || 'Active Duty', workload: workload || 0, events_handled: eventsHandled || 0,
      ytd_revenue: ytdRevenue || 0, property_id: propertyId || resolvePropertyId(req) || null,
      created_by: (req as any).user?.id || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ success: true, staff: data });
});

// PATCH /staff/:id — update staff assignment
router.patch('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, email, phone, role, shift, functionArea, status, workload, eventsHandled, ytdRevenue } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  if (role !== undefined) updateData.role = role;
  if (shift !== undefined) updateData.shift = shift;
  if (functionArea !== undefined) updateData.function_area = functionArea;
  if (status !== undefined) updateData.status = status;
  if (workload !== undefined) updateData.workload = workload;
  if (eventsHandled !== undefined) updateData.events_handled = eventsHandled;
  if (ytdRevenue !== undefined) updateData.ytd_revenue = ytdRevenue;
  const { data, error } = await supabaseAdmin.from('banquet_staff').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, staff: data });
});

// DELETE /staff/:id
router.delete('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_staff').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Staff Attendance ────────────────────────────────────────────────
router.get('/staff/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_staff_attendance').select('*, banquet_staff(name, role)').order('attendance_date', { ascending: false });
  // No property_id on this table — scope via the parent staff row.
  if (propertyId) {
    const { data: staff } = await supabaseAdmin.from('banquet_staff').select('id').eq('property_id', propertyId);
    const ids = (staff || []).map((s: any) => s.id);
    if (!ids.length) return res.json([]);
    q = q.in('staff_id', ids);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { staffId, attendanceDate, status, checkIn, checkOut, hoursWorked, overtimeHours, notes } = req.body;
  if (requireFields(res, req.body, ['staffId', 'attendanceDate', 'status'])) return;

  // Load the staff row — needed for the HR mirror and to derive property.
  const { data: staffRow } = await supabaseAdmin.from('banquet_staff')
    .select('id, name, role, shift, employee_id, property_id')
    .eq('id', staffId).maybeSingle();

  const { data, error } = await supabaseAdmin.from('banquet_staff_attendance')
    .insert({ staff_id: staffId, attendance_date: attendanceDate, status, check_in: checkIn || null, check_out: checkOut || null, hours_worked: hoursWorked || 0, overtime_hours: overtimeHours || 0, notes: notes || null })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Mirror to the shared HR staff_attendance table so payroll/labor cost
  // picks up banquet hours. Only when the staff member is linked to an
  // HR employee record.
  let hrAttendanceId: string | null = null;
  if (staffRow?.employee_id && staffRow?.property_id) {
    const { data: hrRow, error: hrErr } = await supabaseAdmin.from('staff_attendance').insert({
      property_id: staffRow.property_id,
      staff_id: staffRow.employee_id,
      staff_name: staffRow.name,
      employee_id: staffRow.employee_id,
      department_scope: 'Banquet',
      attendance_date: attendanceDate,
      shift: staffRow.shift || 'Morning',
      check_in: checkIn || null,
      check_out: checkOut || null,
      status,
      hours_worked: hoursWorked !== undefined ? Number(hoursWorked) : null,
      overtime_hours: Number(overtimeHours) || 0,
      notes: notes || null,
      source: 'Banquet',
      approval_status: 'Pending',
      missing_punch: (checkIn || checkOut) ? !(checkIn && checkOut) : false,
      created_by: (req as any).user?.id || null,
    }).select('id').single();
    if (hrErr) console.error('HR attendance mirror failed:', hrErr.message);
    else hrAttendanceId = hrRow?.id || null;
  }

  if (hrAttendanceId) {
    await supabaseAdmin.from('banquet_staff_attendance')
      .update({ hr_attendance_id: hrAttendanceId }).eq('id', data.id);
  }

  return res.status(201).json({ success: true, attendance: data });
});

router.patch('/staff/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, notes } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) updateData.status = status;
  if (checkIn !== undefined) updateData.check_in = checkIn;
  if (checkOut !== undefined) updateData.check_out = checkOut;
  if (hoursWorked !== undefined) updateData.hours_worked = hoursWorked;
  if (overtimeHours !== undefined) updateData.overtime_hours = overtimeHours;
  if (notes !== undefined) updateData.notes = notes;
  const { data, error } = await supabaseAdmin.from('banquet_staff_attendance').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Propagate corrections to the mirrored HR attendance row, if any.
  if (data?.hr_attendance_id) {
    const hrPatch: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) hrPatch.status = status;
    if (checkIn !== undefined) hrPatch.check_in = checkIn;
    if (checkOut !== undefined) hrPatch.check_out = checkOut;
    if (hoursWorked !== undefined) hrPatch.hours_worked = hoursWorked;
    if (overtimeHours !== undefined) hrPatch.overtime_hours = overtimeHours;
    if (notes !== undefined) hrPatch.notes = notes;
    await supabaseAdmin.from('staff_attendance').update(hrPatch).eq('id', data.hr_attendance_id);
  }

  return res.json({ success: true, attendance: data });
});

router.delete('/staff/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: row } = await supabaseAdmin.from('banquet_staff_attendance')
    .select('hr_attendance_id').eq('id', req.params.id).maybeSingle();
  const { error } = await supabaseAdmin.from('banquet_staff_attendance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  if (row?.hr_attendance_id) {
    await supabaseAdmin.from('staff_attendance').delete().eq('id', row.hr_attendance_id);
  }
  return res.json({ success: true });
});

// ── Staff Training ───────────────────────────────────────────────────
router.get('/staff/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_staff_training').select('*, banquet_staff(name, role)').order('due_date', { ascending: true });
  if (propertyId) {
    const { data: staff } = await supabaseAdmin.from('banquet_staff').select('id').eq('property_id', propertyId);
    const ids = (staff || []).map((s: any) => s.id);
    if (!ids.length) return res.json([]);
    q = q.in('staff_id', ids);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { staffId, course, dueDate, status } = req.body;
  if (requireFields(res, req.body, ['staffId', 'course'])) return;
  const { data, error } = await supabaseAdmin.from('banquet_staff_training')
    .insert({ staff_id: staffId, course, due_date: dueDate || null, status: status || 'Not Started' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ success: true, training: data });
});

router.patch('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { course, dueDate, status } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (course !== undefined) updateData.course = course;
  if (dueDate !== undefined) updateData.due_date = dueDate;
  if (status !== undefined) updateData.status = status;
  const { data, error } = await supabaseAdmin.from('banquet_staff_training').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, training: data });
});

router.delete('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_staff_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Staff Productivity ───────────────────────────────────────────────
router.get('/staff/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_staff_productivity').select('*, banquet_staff(name, role)').order('revenue', { ascending: false });
  if (propertyId) {
    const { data: staff } = await supabaseAdmin.from('banquet_staff').select('id').eq('property_id', propertyId);
    const ids = (staff || []).map((s: any) => s.id);
    if (!ids.length) return res.json([]);
    q = q.in('staff_id', ids);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staff/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['staffId'])) return;
  const { staffId, period, eventsWorked, setupHours, serviceHours, guestSatisfaction, revenue } = req.body;
  const { data, error } = await supabaseAdmin.from('banquet_staff_productivity')
    .insert({ staff_id: staffId, period: period || 'MTD', events_worked: eventsWorked || 0, setup_hours: setupHours || 0, service_hours: serviceHours || 0, guest_satisfaction: guestSatisfaction || 0, revenue: revenue || 0 })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ success: true, productivity: data });
});

router.patch('/staff/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { period, eventsWorked, setupHours, serviceHours, guestSatisfaction, revenue } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (period !== undefined) updateData.period = period;
  if (eventsWorked !== undefined) updateData.events_worked = eventsWorked;
  if (setupHours !== undefined) updateData.setup_hours = setupHours;
  if (serviceHours !== undefined) updateData.service_hours = serviceHours;
  if (guestSatisfaction !== undefined) updateData.guest_satisfaction = guestSatisfaction;
  if (revenue !== undefined) updateData.revenue = revenue;
  const { data, error } = await supabaseAdmin.from('banquet_staff_productivity').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, productivity: data });
});

router.delete('/staff/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_staff_productivity').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Shift Requirements ───────────────────────────────────────────────
router.get('/staff/shift-reqs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_staff_shift_reqs').select('*').order('role').order('shift');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.patch('/staff/shift-reqs/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { requiredCount, assignedCount } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (requiredCount !== undefined) updateData.required_count = requiredCount;
  if (assignedCount !== undefined) updateData.assigned_count = assignedCount;
  const { data, error } = await supabaseAdmin.from('banquet_staff_shift_reqs').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, shiftReq: data });
});

// ── Staffing Requirements ───────────────────────────────────────────
router.get('/staff/staffing-reqs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_staff_staffing_reqs').select('*').order('function_area').order('role');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.patch('/staff/staffing-reqs/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { requiredCount, assignedCount } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (requiredCount !== undefined) updateData.required_count = requiredCount;
  if (assignedCount !== undefined) updateData.assigned_count = assignedCount;
  const { data, error } = await supabaseAdmin.from('banquet_staff_staffing_reqs').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, staffingReq: data });
});

// ── Configuration (key/value store, property-scoped) ────────────────
// GET /config — returns all config rows as a { key: value } object
router.get('/config', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_event_config').select('config_key, config_value, updated_at, updated_by');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const map: Record<string, string> = {};
  for (const row of data || []) map[row.config_key] = row.config_value;
  return res.json(map);
});

// POST /config — upserts one or more config keys (body: { key: value, ... })
router.post('/config', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!canWriteBanquetConfig(req.user)) {
    return res.status(403).json({ error: 'Insufficient privileges to modify banquet configuration' });
  }
  const propertyId = resolvePropertyId(req);
  if (!propertyId) return res.status(400).json({ error: 'property_id required' });
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length === 0) return res.status(400).json({ error: 'No config keys provided' });
  const rows = keys.map(k => ({
    property_id: propertyId,
    config_key: k,
    config_value: String(body[k] ?? ''),
    updated_by: (req as any).user?.id || 'user',
    updated_at: new Date().toISOString(),
  }));
  const { data, error } = await supabaseAdmin.from('banquet_event_config')
    .upsert(rows, { onConflict: 'property_id,config_key' })
    .select('config_key, config_value, updated_at, updated_by');
  if (error) return res.status(500).json({ error: error.message });
  const map: Record<string, string> = {};
  for (const row of data || []) map[row.config_key] = row.config_value;
  return res.json({ saved: keys.length, config: map });
});

// ── Checklist Templates (configurable in Configuration tab) ───────
// Templates auto-seed checklists when an event enters Planning.
router.get('/checklist-templates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_checklist_templates')
    .select('*')
    .order('category', { ascending: true })
    .order('due_offset_days', { ascending: false });
  if (propertyId) q = q.or(`property_id.eq.${propertyId},property_id.is.null`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const templates = (data || []).map((row: any) => ({
    templateId: row.id,
    itemName: row.item_name,
    category: row.category,
    dueOffsetDays: row.due_offset_days,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return res.json(templates);
});

router.post('/checklist-templates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const record = {
    property_id: resolvePropertyId(req),
    item_name: req.body.itemName,
    category: req.body.category || null,
    due_offset_days: parseInt(req.body.dueOffsetDays) || 0,
    is_active: req.body.isActive !== false
  };

  const { data, error } = await supabaseAdmin.from('banquet_checklist_templates').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ templateId: data.id, ...data });
});

router.put('/checklist-templates/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates: any = { updated_at: new Date().toISOString() };
  if (req.body.itemName !== undefined) updates.item_name = req.body.itemName;
  if (req.body.category !== undefined) updates.category = req.body.category;
  if (req.body.dueOffsetDays !== undefined) updates.due_offset_days = parseInt(req.body.dueOffsetDays);
  if (req.body.isActive !== undefined) updates.is_active = req.body.isActive;

  const { data, error } = await supabaseAdmin.from('banquet_checklist_templates').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/checklist-templates/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin.from('banquet_checklist_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Room Blocks (moved from Event Types to Pipeline) ────────────────
router.get('/room-blocks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_event_type_items')
    .select('*, event_bookings!left(event_name, client_name, start_date, end_date, status)')
    .eq('item_type', 'roomblock')
    .order('created_at', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const blocks = (data || []).map((row: any) => {
    const event = row.event_bookings || {};
    return {
      blockId: row.id,
      eventId: row.event_id,
      eventName: event.event_name || row.event_id,
      clientName: event.client_name,
      eventStatus: event.status,
      startDate: event.start_date,
      endDate: event.end_date,
      ...row.item_data
    };
  });
  return res.json(blocks);
});

router.post('/room-blocks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  const eventId = body.eventId;
  delete body.eventId;
  if (requireFields(res, body, ['roomType'])) return;
  if (!eventId) return res.status(400).json({ error: 'eventId is required' });

  const propertyId = resolvePropertyId(req);
  const roomCount = parseInt(body.roomCount) || 0;

  // Bridge to PMS: create a group_bookings row so Front Office sees the block
  // in Reservations / group check-in, and store the link back on the item.
  const { data: event } = await supabaseAdmin.from('event_bookings')
    .select('event_name, client_name, contact_email, contact_phone')
    .eq('id', eventId)
    .maybeSingle();

  const groupId = 'GRP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const { error: gbErr } = await supabaseAdmin.from('group_bookings').insert({
    id: groupId,
    group_name: event?.event_name || 'Event Room Block',
    contact_name: event?.client_name || null,
    contact_email: event?.contact_email || null,
    contact_phone: event?.contact_phone || null,
    room_type_needed: body.roomType || null,
    room_count: roomCount,
    check_in_date: body.checkInDate || null,
    check_out_date: body.checkOutDate || null,
    discount_percent: 0,
    status: 'Confirmed',
    property_id: propertyId || null,
  });
  if (gbErr) return res.status(500).json({ error: gbErr.message });

  const record = {
    property_id: propertyId,
    event_id: eventId,
    item_type: 'roomblock',
    item_data: {
      roomType: body.roomType,
      roomCount,
      ratePerRoom: parseFloat(body.ratePerRoom) || 0,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      specialRequests: body.specialRequests || '',
      groupBookingId: groupId
    }
  };

  const { data, error } = await supabaseAdmin.from('banquet_event_type_items').insert(record).select().single();
  if (error) {
    // Roll back the group booking so the two stores don't drift.
    await supabaseAdmin.from('group_bookings').delete().eq('id', groupId);
    return res.status(500).json({ error: error.message });
  }
  return res.status(201).json(data);
});

router.delete('/room-blocks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: row } = await supabaseAdmin.from('banquet_event_type_items')
    .select('item_data').eq('id', req.params.id).eq('item_type', 'roomblock').maybeSingle();
  const groupBookingId = row?.item_data?.groupBookingId;

  const { error } = await supabaseAdmin.from('banquet_event_type_items').delete().eq('id', req.params.id).eq('item_type', 'roomblock');
  if (error) return res.status(500).json({ error: error.message });

  if (groupBookingId) {
    await supabaseAdmin.from('group_bookings').delete().eq('id', groupBookingId);
  }
  return res.json({ success: true });
});

// ── Stubs for other portal tabs (to prevent 404s) ──────────────────
// ── Tasks (unified view of schedules + checklists) ──────────────────
// The Execution tab's "Task Management" previously called a dead stub.
// Schedules (Planning) and Tasks (Execution) are the same concept, so we
// expose a combined read endpoint and redirect task creation to the
// schedules table — the working "to-do" store. This eliminates the split
// where the Execution tab showed empty data while schedules lived in Planning.
router.get('/tasks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);

  let schedQ = supabaseAdmin.from('banquet_schedules').select('*');
  if (propertyId) schedQ = schedQ.eq('property_id', propertyId);
  const { data: schedRows, error: sErr } = await schedQ;
  if (sErr) return res.status(500).json({ error: sErr.message });

  let chkQ = supabaseAdmin.from('banquet_checklists').select('*');
  if (propertyId) chkQ = chkQ.eq('property_id', propertyId);
  const { data: chkRows, error: cErr } = await chkQ;
  if (cErr) return res.status(500).json({ error: cErr.message });

  const scheduleTasks = (schedRows || []).map((row: any) => ({
    taskId: row.id,
    eventId: row.event_id,
    title: row.task_name,
    description: row.notes || '',
    assignedTo: row.assigned_to || '',
    department: row.department || '',
    dueDate: row.end_time || row.start_time || null,
    // Real columns since migration 461 — no longer hardcoded.
    status: row.status || 'Pending',
    priority: row.priority || 'Normal',
    dependsOn: row.depends_on || null,
    source: 'schedule',
    createdAt: row.created_at,
    completedAt: row.completed_at || null,
  }));

  const checklistTasks = (chkRows || []).map((row: any) => ({
    taskId: row.id,
    eventId: row.event_id,
    title: row.item_name,
    description: '',
    assignedTo: row.assigned_to || '',
    department: row.category || '',
    dueDate: row.due_date || null,
    status: row.is_completed ? 'Completed' : 'Pending',
    priority: 'Normal',
    source: 'checklist',
    createdAt: row.created_at,
    completedAt: row.is_completed ? row.updated_at : null,
  }));

  return res.json([...scheduleTasks, ...checklistTasks]);
});

// Task creation redirects to the schedules table (the working "to-do" store).
router.post('/tasks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  if (requireFields(res, body, ['eventId'])) return;
  if (!body.taskName && !body.title) {
    return res.status(400).json({ error: 'taskName is required' });
  }
  const record: any = {
    property_id: resolvePropertyId(req),
    event_id: body.eventId,
    task_name: body.taskName || body.title,
    assigned_to: body.assignedTo,
    department: body.department || '',
    notes: body.description || '',
    start_time: body.dueDate || null,
    end_time: body.dueDate || null,
    priority: body.priority || 'Normal',
    depends_on: body.dependsOn || null,
  };

  const { data, error } = await supabaseAdmin.from('banquet_schedules').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({
    taskId: data.id,
    eventId: data.event_id,
    title: data.task_name,
    description: data.notes || '',
    assignedTo: data.assigned_to || '',
    department: data.department || '',
    dueDate: data.end_time || data.start_time || null,
    status: data.status || 'Pending',
    priority: data.priority || 'Normal',
    dependsOn: data.depends_on || null,
    source: 'schedule',
    createdAt: data.created_at,
    completedAt: data.completed_at || null,
  });
});

// Schedule task status — sets completed_at when a task is marked done.
router.put('/schedules/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const status = req.body.status;
  if (!['Pending', 'InProgress', 'Completed', 'Cancelled'].includes(status)) {
    return res.status(400).json({ error: 'status must be Pending | InProgress | Completed | Cancelled' });
  }

  const { data, error } = await supabaseAdmin.from('banquet_schedules')
    .update({
      status,
      completed_at: status === 'Completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Event Execution: Issues ───────────────────────────────────────
// On-event-day issue tracking. Issues are logged during execution and
// feed into post-event review and billing adjustments.
router.get('/events/:id/issues', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('banquet_event_issues')
    .select('*')
    .eq('event_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const issues = (data || []).map((row: any) => ({
    issueId: row.id,
    eventId: row.event_id,
    issueText: row.issue_text,
    severity: row.severity,
    status: row.status,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at
  }));
  return res.json(issues);
});

router.post('/events/:id/issues', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const record = {
    property_id: resolvePropertyId(req),
    event_id: req.params.id,
    issue_text: req.body.issueText,
    severity: req.body.severity || 'Medium'
  };

  const { data, error } = await supabaseAdmin.from('banquet_event_issues').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ issueId: data.id, ...data });
});

router.put('/issues/:id/resolve', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('banquet_event_issues')
    .update({ status: 'Resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Event Execution: Actuals ───────────────────────────────────────
// Capture actual attendance, actual timing, and actual revenue on event day.
router.put('/events/:id/actuals', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates: any = { updated_at: new Date().toISOString() };
  if (req.body.actualAttendance !== undefined) updates.actual_attendance = parseInt(req.body.actualAttendance) || 0;
  if (req.body.actualRevenue !== undefined) updates.actual_revenue = parseFloat(req.body.actualRevenue) || 0;
  if (req.body.actualStartTime !== undefined) updates.actual_start_time = req.body.actualStartTime || null;
  if (req.body.actualEndTime !== undefined) updates.actual_end_time = req.body.actualEndTime || null;

  const { data, error } = await supabaseAdmin.from('event_bookings')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, actual_attendance, actual_revenue, actual_start_time, actual_end_time')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    eventId: data.id,
    actualAttendance: data.actual_attendance,
    actualRevenue: data.actual_revenue,
    actualStartTime: data.actual_start_time,
    actualEndTime: data.actual_end_time
  });
});

// ── Guest Experience: Guests, Registrations, Seating ──────────────
// Replaces the hardcoded mock data with real DB-backed CRUD.

// ── Guests ──
router.get('/guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const eventId = req.query.eventId as string | undefined;
  let q = supabaseAdmin.from('banquet_event_guests')
    .select('*, event_bookings!left(event_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const items = (data || []).map((r: any) => ({
    guestId: r.id, eventId: r.event_id, eventName: r.event_bookings?.event_name || r.event_id,
    guestName: r.guest_name, email: r.email, phone: r.phone,
    dietaryRestrictions: r.dietary_restrictions, specialRequirements: r.special_requirements,
    rsvpStatus: r.rsvp_status, createdAt: r.created_at
  }));
  return res.json(items);
});

router.post('/guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['eventId', 'guestName'])) return;
  const record = {
    property_id: resolvePropertyId(req),
    event_id: req.body.eventId,
    guest_name: req.body.guestName,
    email: req.body.email,
    phone: req.body.phone,
    dietary_restrictions: req.body.dietaryRestrictions,
    special_requirements: req.body.specialRequirements,
    rsvp_status: req.body.rsvpStatus || 'Pending'
  };
  const { data, error } = await supabaseAdmin.from('banquet_event_guests').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ guestId: data.id, ...data });
});

router.put('/guests/:id/rsvp', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('banquet_event_guests')
    .update({ rsvp_status: req.body.rsvpStatus })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Registrations ──
router.get('/registrations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const eventId = req.query.eventId as string | undefined;
  let q = supabaseAdmin.from('banquet_event_registrations')
    .select('*, event_bookings!left(event_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const items = (data || []).map((r: any) => ({
    registrationId: r.id, eventId: r.event_id, eventName: r.event_bookings?.event_name || r.event_id,
    attendeeName: r.attendee_name, email: r.email, phone: r.phone, organization: r.organization,
    registrationType: r.registration_type, paymentStatus: r.payment_status,
    registrationCode: r.registration_code,
    checkedIn: !!r.checked_in, checkedInAt: r.checked_in_at, checkedInBy: r.checked_in_by,
    isWalkIn: !!r.is_walk_in,
    createdAt: r.created_at
  }));
  return res.json(items);
});

// Registration codes are the QR/badge payload. Short, unique, human-readable.
function generateRegistrationCode() {
  return 'REG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

router.post('/registrations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['eventId', 'attendeeName'])) return;
  const record = {
    property_id: resolvePropertyId(req),
    event_id: req.body.eventId,
    attendee_name: req.body.attendeeName,
    email: req.body.email,
    phone: req.body.phone,
    organization: req.body.organization,
    registration_type: req.body.registrationType || 'Standard',
    payment_status: req.body.paymentStatus || 'Unpaid',
    registration_code: generateRegistrationCode(),
    is_walk_in: !!req.body.isWalkIn
  };
  let { data, error } = await supabaseAdmin.from('banquet_event_registrations').insert(record).select().single();
  // Retry once on the (rare) code collision against uq_banquet_registrations_code.
  if (error?.code === '23505') {
    record.registration_code = generateRegistrationCode();
    ({ data, error } = await supabaseAdmin.from('banquet_event_registrations').insert(record).select().single());
  }
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ registrationId: data.id, ...data });
});

// Walk a registration through the door: badge scan or manual toggle.
router.put('/registrations/:id/check-in', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const checkedIn = req.body.checkedIn !== false;
  const { data, error } = await supabaseAdmin.from('banquet_event_registrations')
    .update({
      checked_in: checkedIn,
      checked_in_at: checkedIn ? new Date().toISOString() : null,
      checked_in_by: checkedIn ? ((req as any).user?.id || null) : null,
    })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Code-based check-in (the QR/badge scan path). Finds by registration_code
// and flips checked_in in one shot; idempotent — re-scanning an
// already-checked-in attendee returns the record with alreadyCheckedIn.
router.post('/registrations/check-in-by-code', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'code is required' });

  const { data: reg, error } = await supabaseAdmin.from('banquet_event_registrations')
    .select('*, event_bookings!left(event_name)')
    .eq('registration_code', code)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!reg) return res.status(404).json({ error: 'Registration code not found' });
  if (req.body.eventId && reg.event_id !== req.body.eventId) {
    return res.status(409).json({ error: 'Code belongs to a different event' });
  }
  if (reg.checked_in) {
    return res.json({ alreadyCheckedIn: true, registration: reg });
  }

  const { data, error: upErr } = await supabaseAdmin.from('banquet_event_registrations')
    .update({
      checked_in: true,
      checked_in_at: new Date().toISOString(),
      checked_in_by: (req as any).user?.id || null,
    })
    .eq('id', reg.id).select().single();
  if (upErr) return res.status(500).json({ error: upErr.message });
  return res.json({ alreadyCheckedIn: false, registration: data });
});

router.put('/registrations/:id/payment', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('banquet_event_registrations')
    .update({ payment_status: req.body.paymentStatus })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Seating ──
router.get('/seating', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const eventId = req.query.eventId as string | undefined;
  let q = supabaseAdmin.from('banquet_event_seating')
    .select('*, event_bookings!left(event_name)')
    .order('table_name', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const items = (data || []).map((r: any) => ({
    seatingId: r.id, eventId: r.event_id, eventName: r.event_bookings?.event_name || r.event_id,
    tableName: r.table_name, tableType: r.table_type, capacity: r.capacity,
    location: r.location, assignedTo: r.assigned_to, specialRequests: r.special_requests,
    isReserved: r.is_reserved, isVip: r.is_vip, createdAt: r.created_at
  }));
  return res.json(items);
});

router.post('/seating', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['eventId', 'tableName'])) return;
  const record = {
    property_id: resolvePropertyId(req),
    event_id: req.body.eventId,
    table_name: req.body.tableName,
    table_type: req.body.tableType || 'Round',
    capacity: parseInt(req.body.capacity) || 8,
    location: req.body.location,
    assigned_to: req.body.assignedTo,
    special_requests: req.body.specialRequests,
    is_reserved: !!req.body.isReserved,
    is_vip: !!req.body.isVip
  };
  const { data, error } = await supabaseAdmin.from('banquet_event_seating').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ seatingId: data.id, ...data });
});

router.put('/seating/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates: any = {};
  if (req.body.tableName !== undefined) updates.table_name = req.body.tableName;
  if (req.body.tableType !== undefined) updates.table_type = req.body.tableType;
  if (req.body.capacity !== undefined) updates.capacity = parseInt(req.body.capacity) || 8;
  if (req.body.location !== undefined) updates.location = req.body.location;
  if (req.body.assignedTo !== undefined) updates.assigned_to = req.body.assignedTo;
  if (req.body.specialRequests !== undefined) updates.special_requests = req.body.specialRequests;
  if (req.body.isReserved !== undefined) updates.is_reserved = !!req.body.isReserved;
  if (req.body.isVip !== undefined) updates.is_vip = !!req.body.isVip;
  const { data, error } = await supabaseAdmin.from('banquet_event_seating')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/seating/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_event_seating').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Department Coordination ───────────────────────────────────────
router.get('/department-coordination', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  const eventId = req.query.eventId as string | undefined;
  let q = supabaseAdmin.from('banquet_dept_coordination')
    .select('*, event_bookings!left(event_name, client_name)')
    .order('deadline', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    coordId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    clientName: row.event_bookings?.client_name,
    department: row.department,
    contactPerson: row.contact_person,
    requirements: row.requirements,
    deadline: row.deadline,
    status: row.status,
    createdAt: row.created_at
  }));
  return res.json(items);
});

router.post('/department-coordination', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['eventId', 'department'])) return;

  const record = {
    property_id: resolvePropertyId(req),
    event_id: req.body.eventId,
    department: req.body.department,
    contact_person: req.body.contactPerson,
    requirements: req.body.requirements,
    deadline: req.body.deadline,
    status: 'Pending'
  };

  const { data, error } = await supabaseAdmin.from('banquet_dept_coordination').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ coordId: data.id, ...data });
});

router.put('/department-coordination/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('banquet_dept_coordination')
    .update({ status: req.body.status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Communications ─────────────────────────────────────────────────
router.get('/communications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  const eventId = req.query.eventId as string | undefined;
  let q = supabaseAdmin.from('banquet_communications')
    .select('*, event_bookings!left(event_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    commId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    recipient: row.recipient,
    recipientType: row.recipient_type,
    subject: row.subject,
    message: row.message,
    communicationType: row.communication_type,
    priority: row.priority,
    status: row.status,
    parentId: row.parent_id || null,
    createdAt: row.created_at
  }));
  return res.json(items);
});

router.post('/communications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['recipient', 'message'])) return;

  const propertyId = resolvePropertyId(req);
  const commType = req.body.communicationType || 'Email';
  const recipientType = req.body.recipientType || 'Guest';

  // Resolve the actual addresses to dispatch to. 'All' fans out to the
  // event's guest list; other recipient types use the supplied address.
  let addresses: string[] = [];
  if (recipientType === 'All' && req.body.eventId) {
    const { data: guests } = await supabaseAdmin.from('banquet_event_guests')
      .select('email, phone')
      .eq('event_id', req.body.eventId);
    const isEmail = commType === 'Email';
    addresses = (guests || [])
      .map((g: any) => (isEmail ? g.email : g.phone))
      .filter(Boolean);
  } else if (req.body.recipient) {
    addresses = [req.body.recipient];
  }

  // Dispatch through the configured provider (log-only fallback in dev).
  let status = 'Pending';
  if (addresses.length > 0 && commType !== 'In-App') {
    try {
      const result = commType === 'Email'
        ? await dispatchEmail(req.body.subject || '', req.body.message || '', addresses)
        : await dispatchSMS(`${req.body.subject ? req.body.subject + ': ' : ''}${req.body.message || ''}`, addresses);
      status = result.failed > 0 && result.delivered === 0 ? 'Failed' : 'Sent';
    } catch {
      status = 'Failed';
    }
  } else if (commType === 'In-App') {
    status = 'Sent';
  }

  const record = {
    property_id: propertyId,
    event_id: req.body.eventId,
    recipient: req.body.recipient,
    recipient_type: recipientType,
    subject: req.body.subject,
    message: req.body.message,
    communication_type: commType,
    priority: req.body.priority || 'Normal',
    parent_id: req.body.parentId || null,
    status
  };

  const { data, error } = await supabaseAdmin.from('banquet_communications').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ commId: data.id, ...data });
});

// ── Per-guest feedback & complaints (472) ──────────────────────────
router.get('/feedback', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const { eventId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('banquet_event_feedback')
    .select('*, event_bookings!left(event_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => ({
    ...snakeToCamelRecord(r),
    feedbackId: r.id,
    eventName: r.event_bookings?.event_name || r.event_id
  })));
});

router.post('/feedback', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['eventId'])) return;
  const record = camelToSnakeRecord({ ...req.body });
  delete record.feedback_id;
  record.property_id = resolvePropertyId(req) || record.property_id;
  const { data, error } = await supabaseAdmin.from('banquet_event_feedback')
    .insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/feedback/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['feedbackId']);
  const { data, error } = await supabaseAdmin.from('banquet_event_feedback')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/feedback/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_event_feedback').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Dashboard: KPIs & Alerts ───────────────────────────────────────
// Both were hardcoded stubs (`[]` and `{}`) so the executive dashboard and the
// alert bell were permanently empty. They now read the derived views added in
// migration 446.
router.get('/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  const userId = (req as any).user?.id;
  let q = supabaseAdmin.from('event_alerts').select('*')
    .order('severity', { ascending: true })
    .order('due_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Per-user read state lives in banquet_alert_acks (465) — the view only
  // knows which exceptions exist.
  let acked = new Set<string>();
  if (userId && (data || []).length) {
    const { data: acks } = await supabaseAdmin.from('banquet_alert_acks')
      .select('alert_id')
      .eq('user_id', userId)
      .in('alert_id', (data || []).map((r: any) => r.alert_id));
    acked = new Set((acks || []).map((a: any) => a.alert_id));
  }

  return res.json((data || []).map((row: any) => ({
    alertId: row.alert_id,
    type: row.alert_type,
    eventId: row.event_id,
    eventName: row.event_name,
    message: row.message,
    severity: row.severity,
    dueDate: row.due_date,
    isRead: acked.has(row.alert_id),
    createdAt: row.created_at,
  })));
});

// Acknowledge / un-acknowledge an alert for the current user. Acks are
// idempotent (unique alert_id+user_id) and survive view refreshes because
// alert ids are deterministic (deposit-<eventId>, beo-<eventId>, …).
router.put('/alerts/:alertId/ack', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'No user on request' });

  const alertId = req.params.alertId;
  const read = req.body.read !== false;

  if (!read) {
    const { error } = await supabaseAdmin.from('banquet_alert_acks')
      .delete().eq('alert_id', alertId).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ alertId, isRead: false });
  }

  const { error } = await supabaseAdmin.from('banquet_alert_acks')
    .upsert({
      property_id: resolvePropertyId(req) || null,
      alert_id: alertId,
      user_id: userId,
      acked_at: new Date().toISOString(),
    }, { onConflict: 'alert_id,user_id' });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ alertId, isRead: true });
});

router.get('/kpis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('event_kpis').select('*');
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const sum = (key: string) => rows.reduce((acc: number, r: any) => acc + Number(r[key] || 0), 0);
  const avg = (key: string) => (rows.length ? sum(key) / rows.length : 0);

  return res.json({
    eventsToday: sum('events_today'),
    eventsThisWeek: sum('events_this_week'),
    eventsThisMonth: sum('events_this_month'),
    inquiryBookings: sum('inquiry_bookings'),
    tentativeBookings: sum('tentative_bookings'),
    confirmedBookings: sum('confirmed_bookings'),
    planningBookings: sum('planning_bookings'),
    inProgressBookings: sum('in_progress_bookings'),
    completedBookings: sum('completed_bookings'),
    cancelledBookings: sum('cancelled_bookings'),
    totalRevenue: sum('total_revenue'),
    realisedRevenue: sum('realised_revenue'),
    collectedRevenue: sum('collected_revenue'),
    pendingDeposits: sum('pending_deposits'),
    outstandingBalance: sum('outstanding_balance'),
    averageEventValue: Math.round(avg('average_event_value') * 100) / 100,
    averageSatisfaction: Math.round(avg('average_satisfaction') * 100) / 100,
    conversionRate: Math.round(avg('conversion_rate') * 10) / 10,
    beoCompletion: Math.round(avg('beo_completion') * 10) / 10,
    taskCompletion: Math.round(avg('task_completion') * 10) / 10,
    departmentReadiness: Math.round(avg('task_completion') * 10) / 10,
  });
});

// ── Billing: charges, payments, settlement ─────────────────────────
// The Billing tab used to POST to a non-existent /payments route and read three
// columns that did not exist. The money path is now:
//   event_charges -> folio_lines -> folio_payments -> invoice_documents -> AR
// with every figure derived, never hand-typed.

// Billing summary for the whole portfolio (backs the Billing & Deposits tab).
router.get('/billing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('event_billing_summary').select('*')
    .order('start_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    eventId: row.event_id,
  }));

  const sum = (key: string) => rows.reduce((acc: number, r: any) => acc + Number(r[key] || 0), 0);

  return res.json({
    events: rows,
    summary: {
      totalContracted: sum('grandTotal'),
      totalDepositsRequired: sum('depositRequired'),
      totalDepositsCollected: sum('depositPaidAmount'),
      totalCollected: sum('paidTotal'),
      totalOutstanding: sum('balanceDue'),
      totalTax: sum('taxTotal'),
      totalServiceCharge: sum('serviceChargeTotal'),
      unpostedLines: sum('unpostedLineCount'),
    },
  });
});

// Charge lines for one event.
router.get('/events/:id/charges', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.from('event_charges').select('*')
    .eq('event_id', req.params.id)
    .order('charge_type', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  return res.json((data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    chargeId: row.id,
    isPosted: row.folio_line_id !== null,
  })));
});

// Re-derive charge lines from the catering / logistics rows the ops team
// captured. Idempotent — safe to call after any change.
router.post('/events/:id/charges/rebuild', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.rpc('rebuild_event_charges', {
    p_event_id: req.params.id,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error });

  return res.json(data);
});

// Manual charge line (labour, decoration, ad-hoc extras, negative adjustments).
router.post('/events/:id/charges', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  if (!body.description) return res.status(400).json({ error: 'description is required' });

  const { data: event, error: eventError } = await supabaseAdmin.from('event_bookings')
    .select('property_id').eq('id', req.params.id).single();
  if (eventError) return res.status(404).json({ error: 'Event not found' });

  const { data, error } = await supabaseAdmin.from('event_charges').insert({
    property_id: event.property_id,
    event_id: req.params.id,
    charge_type: body.chargeType || 'Other',
    description: body.description,
    quantity: Number(body.quantity) || 1,
    unit_price: Number(body.unitPrice) || 0,
    discount_percent: Number(body.discountPercent) || 0,
    is_taxable: body.isTaxable !== false,
    is_service_charged: body.isServiceCharged !== false,
    revenue_account_code: body.revenueAccountCode || '4050',
    is_manual: true,
    created_by: (req as any).user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Pricing (discount -> service charge -> VAT) is applied in the database so
  // it matches how room charges are taxed.
  await supabaseAdmin.rpc('price_event_charge', { p_charge_id: data.id });

  const { data: priced } = await supabaseAdmin.from('event_charges')
    .select('*').eq('id', data.id).single();
  return res.status(201).json(snakeToCamelRecord(priced || data));
});

// Void a charge line. Posted lines cannot be voided here — reverse them on the
// folio instead, so the folio and the event never disagree.
router.delete('/charges/:chargeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: charge } = await supabaseAdmin.from('event_charges')
    .select('folio_line_id').eq('id', req.params.chargeId).single();
  if (!charge) return res.status(404).json({ error: 'Charge not found' });
  if (charge.folio_line_id) {
    return res.status(409).json({
      error: 'Charge is already posted to the folio. Reverse it on the folio instead.',
    });
  }

  const { data, error } = await supabaseAdmin.from('event_charges')
    .update({
      is_voided: true,
      voided_at: new Date().toISOString(),
      void_reason: req.body?.reason || 'Voided from Banquet portal',
    })
    .eq('id', req.params.chargeId).select().single();
  if (error) return res.status(500).json({ error: error.message });

  return res.json(snakeToCamelRecord(data));
});

// Push unposted charges onto the event folio (creating the folio on first use).
router.post('/events/:id/post-charges', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.rpc('post_event_charges_to_folio', {
    p_event_id: req.params.id,
    p_user_id: (req as any).user?.id || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error });

  return res.json(data);
});

// Record a deposit or a settlement payment. This is the route the Billing tab
// was already calling — it simply never existed.
router.post('/payments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { eventId, amount, paymentMethod, isDeposit, referenceNumber, notes } = req.body || {};

  if (!eventId) return res.status(400).json({ error: 'eventId is required' });
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: 'amount must be greater than zero' });
  }

  // The portal sends UI labels; folio_payments has its own CHECK constraint.
  const methodMap: Record<string, string> = {
    CreditCard: 'Credit Card',
    DebitCard: 'Debit Card',
    BankTransfer: 'Bank Transfer',
    Cash: 'Cash',
    Check: 'Cheque',
    Cheque: 'Cheque',
    MobileMoney: 'Mobile Money',
    CorporateBill: 'Corporate Bill',
  };
  const method = methodMap[paymentMethod] || paymentMethod || 'Cash';

  const { data, error } = await supabaseAdmin.rpc('record_event_payment', {
    p_event_id: eventId,
    p_amount: value,
    p_payment_method: method,
    p_is_deposit: Boolean(isDeposit),
    p_reference: referenceNumber || null,
    p_notes: notes || null,
    p_user_id: (req as any).user?.id || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error });

  return res.status(201).json(data);
});

// Payment history for an event, read off its folio.
router.get('/events/:id/payments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: event } = await supabaseAdmin.from('event_bookings')
    .select('folio_id').eq('id', req.params.id).single();
  if (!event?.folio_id) return res.json([]);

  const { data, error } = await supabaseAdmin.from('folio_payments')
    .select('*').eq('folio_id', event.folio_id)
    .order('payment_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  return res.json((data || []).map((row: any) => ({
    ...snakeToCamelRecord(row),
    paymentId: row.id,
    isDeposit: row.payment_sub_type === 'EventDeposit',
  })));
});

// Record a refund against an event. folio_payments.amount is stored negative
// with is_refund=true so recompute_folio_totals reduces total_payments and
// raises the balance — then recalc_event_totals syncs the event.
router.post('/events/:id/refund', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { amount, paymentMethod, reason, referenceNumber } = req.body || {};
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: 'amount must be greater than zero' });
  }

  const { data: event } = await supabaseAdmin.from('event_bookings')
    .select('id, folio_id, paid_total, status')
    .eq('id', req.params.id).single();
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!event.folio_id) return res.status(409).json({ error: 'Event has no folio — nothing to refund' });
  if (Number(event.paid_total || 0) < value) {
    return res.status(409).json({ error: `Refund exceeds amount paid (${event.paid_total || 0})` });
  }

  const paymentId = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: payment, error: insErr } = await supabaseAdmin.from('folio_payments').insert({
    id: paymentId,
    folio_id: event.folio_id,
    payment_date: new Date().toISOString(),
    amount: -value,
    payment_method: paymentMethod || 'Cash',
    payment_sub_type: 'EventRefund',
    reference_number: referenceNumber || null,
    is_refund: true,
    created_by: (req as any).user?.id || null,
    notes: reason || null,
  }).select().single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  await supabaseAdmin.rpc('recompute_folio_totals', { p_folio_id: event.folio_id });
  const { data: totals } = await supabaseAdmin.rpc('recalc_event_totals', { p_event_id: event.id });

  return res.status(201).json({ success: true, payment, totals });
});

// Void a payment that was recorded in error (keeps an audit trail, unlike
// delete). Posted-to-GL payments cannot be voided — reverse them in Finance.
router.post('/payments/:paymentId/void', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: payment } = await supabaseAdmin.from('folio_payments')
    .select('id, folio_id, is_voided, posted_to_gl, is_refund')
    .eq('id', req.params.paymentId).maybeSingle();
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.is_voided) return res.status(409).json({ error: 'Payment is already voided' });
  if (payment.posted_to_gl) {
    return res.status(409).json({ error: 'Payment is posted to GL — reverse it in Finance instead' });
  }

  const { data, error } = await supabaseAdmin.from('folio_payments')
    .update({
      is_voided: true,
      voided_at: new Date().toISOString(),
      voided_by: (req as any).user?.id || null,
      void_reason: req.body?.reason || 'Voided from Banquet portal',
    })
    .eq('id', req.params.paymentId).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin.rpc('recompute_folio_totals', { p_folio_id: payment.folio_id });
  // Recalc the owning event too — folio → event via event_bookings.folio_id.
  const { data: ev } = await supabaseAdmin.from('event_bookings')
    .select('id').eq('folio_id', payment.folio_id).maybeSingle();
  if (ev) await supabaseAdmin.rpc('recalc_event_totals', { p_event_id: ev.id });

  return res.json({ success: true, payment: data });
});

// Terminal step: invoice the event and, for corporate billing, post the residual
// balance to AR against the corporate account.
router.post('/events/:id/settle', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.rpc('settle_event', {
    p_event_id: req.params.id,
    p_user_id: (req as any).user?.id || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error });

  return res.json(data);
});

// ── Reports (catalog registry — mirrors fb_reports pattern) ────────
// Every report definition exists as a row in banquet_event_report_catalog,
// even if it has never been run (last_run = NULL, status = 'Scheduled').
// The list always returns all reports. Running updates last_run + status.

const REPORT_CATEGORIES = ['event_summary', 'revenue', 'occupancy', 'vendor', 'resource', 'guest_feedback'] as const;
const REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

// GET /reports — list all catalog reports (optional ?category=)
router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const category = req.query.category as string;
  let q = supabaseAdmin.from('banquet_event_report_catalog')
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .order('id', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (category && REPORT_CATEGORIES.includes(category as any)) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /reports/stats — aggregated KPI counts
router.get('/reports/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_event_report_catalog').select('category, status');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const total = rows.length;
  const ready = rows.filter((r: any) => r.status === 'Ready').length;
  const scheduled = rows.filter((r: any) => r.status === 'Scheduled').length;
  const failed = rows.filter((r: any) => r.status === 'Failed').length;
  const byCategory: Record<string, number> = {};
  for (const c of REPORT_CATEGORIES) byCategory[c] = 0;
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({ total, ready, scheduled, failed, byCategory });
});

// ── Report generation ─────────────────────────────────────────────
// Running a catalog entry computes a live summary from event_bookings /
// event_charges and persists a banquet_event_reports row — so generated
// reports are real output, not just a status flip on the catalog.

const REPORT_TYPE_LABELS: Record<string, string> = {
  event_summary: 'Event Summary',
  revenue: 'Revenue Report',
  occupancy: 'Occupancy Analysis',
  vendor: 'Vendor Performance',
  resource: 'Resource Utilization',
  guest_feedback: 'Guest Feedback',
};

function reportDateRange(frequency: string): { start: string; end: string } {
  const days: Record<string, number> = { Daily: 1, Weekly: 7, Monthly: 30, Quarterly: 90, Annual: 365 };
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days[frequency] ?? 30));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function generateReportSummary(category: string, propertyId: string | undefined, start: string, end: string) {
  let evQ = supabaseAdmin!.from('event_bookings')
    .select('id, status, event_type, expected_attendance, actual_attendance, grand_total, paid_total, balance_due, satisfaction_score, feedback, start_date, venue_ids')
    .gte('start_date', start).lte('start_date', end);
  if (propertyId) evQ = evQ.eq('property_id', propertyId);
  const { data: evts } = await evQ;
  const rows: any[] = evts || [];
  const num = (v: any) => Number(v || 0);

  switch (category) {
    case 'event_summary': {
      const byType: Record<string, number> = {};
      for (const e of rows) byType[e.event_type || 'Other'] = (byType[e.event_type || 'Other'] || 0) + 1;
      return {
        totalEvents: rows.length,
        completed: rows.filter(e => e.status === 'Completed').length,
        inProgress: rows.filter(e => e.status === 'InProgress').length,
        upcoming: rows.filter(e => ['Inquiry', 'Tentative', 'Confirmed', 'Planning'].includes(e.status)).length,
        cancelled: rows.filter(e => e.status === 'Cancelled').length,
        totalAttendance: rows.reduce((s, e) => s + num(e.expected_attendance), 0),
        byType,
      };
    }
    case 'revenue': {
      const eventIds = rows.map(e => e.id);
      const byCategory: Record<string, number> = {};
      if (eventIds.length) {
        const { data: charges } = await supabaseAdmin!.from('event_charges')
          .select('charge_type, total_amount, is_voided')
          .in('event_id', eventIds);
        for (const c of charges || []) {
          if (c.is_voided) continue;
          byCategory[c.charge_type || 'Other'] = (byCategory[c.charge_type || 'Other'] || 0) + num(c.total_amount);
        }
      }
      return {
        totalRevenue: rows.reduce((s, e) => s + num(e.grand_total), 0),
        totalCollected: rows.reduce((s, e) => s + num(e.paid_total), 0),
        totalOutstanding: rows.reduce((s, e) => s + num(e.balance_due), 0),
        byCategory,
      };
    }
    case 'occupancy': {
      const withActual = rows.filter(e => e.actual_attendance != null);
      const expectedTotal = rows.reduce((s, e) => s + num(e.expected_attendance), 0);
      const actualTotal = withActual.reduce((s, e) => s + num(e.actual_attendance), 0);
      const byDay: Record<string, number> = {};
      for (const e of rows) byDay[e.start_date] = (byDay[e.start_date] || 0) + num(e.expected_attendance);
      const peak = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
      return {
        avgAttendance: rows.length ? Math.round(expectedTotal / rows.length) : 0,
        expectedTotal,
        actualTotal,
        utilizationRate: expectedTotal ? Math.round((actualTotal / expectedTotal) * 1000) / 10 : 0,
        peakDay: peak?.[0] || null,
        peakAttendance: peak?.[1] || 0,
      };
    }
    case 'vendor': {
      const eventIds = rows.map(e => e.id);
      let vQ = supabaseAdmin!.from('banquet_vendors')
        .select('id, status, vendor_type, contract_value, event_id');
      if (propertyId) vQ = vQ.eq('property_id', propertyId);
      if (eventIds.length) vQ = vQ.in('event_id', eventIds);
      const { data: vendors } = await vQ;
      const vrows = vendors || [];
      const byType: Record<string, number> = {};
      for (const v of vrows) byType[v.vendor_type || 'Other'] = (byType[v.vendor_type || 'Other'] || 0) + 1;
      return {
        totalVendors: vrows.length,
        confirmedVendors: vrows.filter((v: any) => ['Active', 'Confirmed', 'Booked'].includes(v.status)).length,
        totalContractValue: vrows.reduce((s: number, v: any) => s + num(v.contract_value), 0),
        byType,
        eventsInPeriod: rows.length,
      };
    }
    case 'resource': {
      const venueIds = new Set<string>();
      for (const e of rows) for (const vid of e.venue_ids || []) venueIds.add(vid);
      let eqQ = supabaseAdmin!.from('banquet_equipment').select('id', { count: 'exact', head: true });
      if (propertyId) eqQ = eqQ.eq('property_id', propertyId);
      const { count: equipmentCount } = await eqQ;
      return {
        venuesUsed: venueIds.size,
        eventsInPeriod: rows.length,
        equipmentItems: equipmentCount || 0,
      };
    }
    case 'guest_feedback': {
      const scored = rows.filter(e => e.satisfaction_score != null);
      return {
        totalResponses: scored.length,
        avgRating: scored.length ? Math.round((scored.reduce((s, e) => s + num(e.satisfaction_score), 0) / scored.length) * 100) / 100 : null,
        satisfactionScore: scored.length ? Math.round((scored.reduce((s, e) => s + num(e.satisfaction_score), 0) / (scored.length * 5)) * 1000) / 10 : null,
        commentsCount: rows.filter(e => e.feedback).length,
      };
    }
    default:
      return { eventsInPeriod: rows.length };
  }
}

async function runCatalogReport(catalogRow: any, propertyId: string | undefined, userId: string | undefined) {
  const { start, end } = reportDateRange(catalogRow.frequency);
  const summary = await generateReportSummary(catalogRow.category, propertyId || catalogRow.property_id, start, end);

  await supabaseAdmin!.from('banquet_event_reports').insert({
    property_id: propertyId || catalogRow.property_id || null,
    report_type: REPORT_TYPE_LABELS[catalogRow.category] || catalogRow.category,
    report_name: `${catalogRow.name} — ${start} to ${end}`,
    date_range_start: start,
    date_range_end: end,
    status: 'Completed',
    generated_by: userId || 'user',
    summary,
  });

  const { data, error } = await supabaseAdmin!.from('banquet_event_report_catalog')
    .update({ status: 'Ready', last_run: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', catalogRow.id)
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { catalog: data, summary, dateRange: { start, end } };
}

// GET /reports/generated — persisted report outputs
router.get('/reports/generated', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_event_reports')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(100);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /reports/generated/:id/export?format=csv — download a generated report
// as CSV. The summary JSONB is flattened: scalar keys become rows, nested
// objects (byType, byCategory, byDay) expand to one row per member.
router.get('/reports/generated/:id/export', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: report, error } = await supabaseAdmin.from('banquet_event_reports')
    .select('*').eq('id', req.params.id).single();
  if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });

  const esc = (v: any) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [
    'Report,Type,Period Start,Period End,Generated',
    [report.report_name, report.report_type, report.date_range_start, report.date_range_end, report.generated_at].map(esc).join(','),
    '',
    'Metric,Key,Value'
  ];
  const summary = (report.summary || {}) as Record<string, any>;
  for (const [key, value] of Object.entries(summary)) {
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        lines.push([key, k, v].map(esc).join(','));
      }
    } else {
      lines.push([key, '', value].map(esc).join(','));
    }
  }

  const filename = `${(report.report_name || 'report').replace(/[^a-z0-9]+/gi, '_')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(lines.join('\n'));
});

// POST /reports/:id/run — generate a real report from live data
router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: row, error: loadErr } = await supabaseAdmin.from('banquet_event_report_catalog')
    .select('id, property_id, category, name, frequency')
    .eq('id', req.params.id)
    .maybeSingle();
  if (loadErr) return res.status(500).json({ error: loadErr.message });
  if (!row) return res.status(404).json({ error: 'Report not found' });
  try {
    const result = await runCatalogReport(row, resolvePropertyId(req), (req as any).user?.id);
    return res.json(result.catalog);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Report generation failed' });
  }
});

// POST /reports/run-all — regenerate all non-Ready reports
router.post('/reports/run-all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_event_report_catalog')
    .select('id, property_id, category, name, frequency')
    .neq('status', 'Ready');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data: rows, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const refreshed: any[] = [];
  for (const row of rows || []) {
    try {
      const r = await runCatalogReport(row, propertyId, (req as any).user?.id);
      if (r.catalog) refreshed.push(r.catalog);
    } catch { /* keep going — one bad report shouldn't fail the batch */ }
  }
  return res.json({ refreshed: refreshed.length, reports: refreshed });
});

// PATCH /reports/:id — update frequency / format / status
router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && REPORT_FORMATS.includes(body.format as any)) updates.format = body.format;
  if (typeof body.status === 'string' && REPORT_STATUSES.includes(body.status as any)) updates.status = body.status;
  if (Object.keys(updates).length <= 1) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin.from('banquet_event_report_catalog')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ── F&B Menu Catalog (selection source for banquet catering) ──────────
router.get('/fb-menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { category, beverage } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('menu_items')
    .select('id, name, category, selling_price, outlet_id, is_active, meal_periods, tax_code')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const isBeverage = (cat: string) => ['Beer', 'Wine', 'Cocktail', 'Spirits', 'Soft Drinks', 'SoftDrinks', 'Juice', 'Water', 'Coffee', 'Tea', 'Beverage'].includes(cat);

  const items = (data || []).filter((row: any) => {
    if (beverage === 'true') return isBeverage(row.category);
    if (beverage === 'false') return !isBeverage(row.category);
    return true;
  }).map((row: any) => ({
    menuItemId: row.id,
    name: row.name,
    category: row.category,
    sellingPrice: row.selling_price,
    outletId: row.outlet_id,
    isActive: row.is_active,
    mealPeriods: row.meal_periods || [],
    taxCode: row.tax_code
  }));

  return res.json(items);
});

// ── Menu Items ──────────────────────────────────────────────────────
router.get('/menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_menu_items')
    .select('*, event_bookings!left(event_name, client_name), menu_items(id, name, category, selling_price)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    itemId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    clientName: row.event_bookings?.client_name,
    menuItemId: row.menu_item_id,
    fbItemName: row.menu_items?.name,
    fbCategory: row.menu_items?.category,
    fbSellingPrice: row.menu_items?.selling_price,
    unitPrice: row.unit_price,
    menuType: row.menu_type,
    courseType: row.course_type,
    dishName: row.dish_name,
    dietary: row.dietary,
    quantity: row.quantity,
    specialNotes: row.special_notes,
    approvalStatus: row.approval_status || 'Pending'
  }));
  return res.json(items);
});

router.post('/menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.itemId;
  if (requireFields(res, body, ['eventId'])) return;

  if (body.menuItemId) {
    const { data: fbItem, error: fbError } = await supabaseAdmin.from('menu_items')
      .select('name, category, selling_price')
      .eq('id', body.menuItemId)
      .maybeSingle();
    if (fbError) return res.status(500).json({ error: fbError.message });
    if (fbItem) {
      if (!body.dishName) body.dishName = fbItem.name;
      if (!body.courseType && fbItem.category) body.courseType = fbItem.category;
      if (!body.unitPrice && fbItem.selling_price) body.unitPrice = fbItem.selling_price;
    }
  }

  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_menu_items').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Beverages ───────────────────────────────────────────────────────
router.get('/beverages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_beverages')
    .select('*, event_bookings!left(event_name, client_name), menu_items(id, name, category, selling_price)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    itemId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    clientName: row.event_bookings?.client_name,
    menuItemId: row.menu_item_id,
    fbItemName: row.menu_items?.name,
    fbCategory: row.menu_items?.category,
    fbSellingPrice: row.menu_items?.selling_price,
    unitPrice: row.unit_price,
    beverageType: row.beverage_type,
    category: row.category,
    name: row.name,
    quantity: row.quantity,
    serviceType: row.service_type,
    specialNotes: row.special_notes
  }));
  return res.json(items);
});

router.post('/beverages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.itemId;
  if (requireFields(res, body, ['eventId'])) return;

  if (body.menuItemId) {
    const { data: fbItem, error: fbError } = await supabaseAdmin.from('menu_items')
      .select('name, category, selling_price')
      .eq('id', body.menuItemId)
      .maybeSingle();
    if (fbError) return res.status(500).json({ error: fbError.message });
    if (fbItem) {
      if (!body.name) body.name = fbItem.name;
      if (!body.category && fbItem.category) body.category = fbItem.category;
      if (!body.unitPrice && fbItem.selling_price) body.unitPrice = fbItem.selling_price;
    }
  }

  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_beverages').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Resources ───────────────────────────────────────────────────────
router.get('/resources', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_resources')
    .select('*, event_bookings!left(event_name, client_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    resourceId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    resourceType: row.resource_type,
    resourceName: row.resource_name,
    quantity: row.quantity,
    allocatedTo: row.allocated_to,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes
  }));
  return res.json(items);
});

router.post('/resources', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.resourceId;
  if (requireFields(res, body, ['eventId', 'resourceName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_resources').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Equipment ───────────────────────────────────────────────────────
router.get('/equipment', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_equipment')
    .select('*, event_bookings!left(event_name, client_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    equipmentId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    equipmentName: row.equipment_name,
    equipmentType: row.equipment_type,
    quantity: row.quantity,
    specifications: row.specifications,
    assignedTo: row.assigned_to,
    status: row.status,
    catalogItemId: row.catalog_item_id || null
  }));
  return res.json(items);
});

router.post('/equipment', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.equipmentId;
  if (requireFields(res, body, ['eventId', 'equipmentName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_equipment').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Vendors ─────────────────────────────────────────────────────────
router.get('/vendors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_vendors')
    .select('*, event_bookings!left(event_name, client_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    vendorId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    vendorName: row.vendor_name,
    vendorType: row.vendor_type,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    services: row.services,
    contractValue: row.contract_value,
    status: row.status
  }));
  return res.json(items);
});

router.post('/vendors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.vendorId;

  // Registry pick: copy master details onto the event row so the contract
  // keeps working even if the vendor is later edited in the registry.
  if (body.registryId) {
    const { data: reg } = await supabaseAdmin.from('banquet_vendor_registry')
      .select('vendor_name, vendor_type, contact_person, phone, email, services')
      .eq('id', body.registryId).single();
    if (reg) {
      body.vendorName = body.vendorName || reg.vendor_name;
      body.vendorType = body.vendorType || reg.vendor_type;
      body.contactPerson = body.contactPerson || reg.contact_person;
      body.phone = body.phone || reg.phone;
      body.email = body.email || reg.email;
      body.services = body.services || reg.services;
    }
  }

  if (requireFields(res, body, ['eventId', 'vendorName'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_vendors').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Transportation ──────────────────────────────────────────────────
router.get('/transportation', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_transportation')
    .select('*, event_bookings!left(event_name, client_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((row: any) => ({
    transportId: row.id,
    eventId: row.event_id,
    eventName: row.event_bookings?.event_name || row.event_id,
    guestName: row.guest_name,
    pickupLocation: row.pickup_location,
    dropoffLocation: row.dropoff_location,
    pickupTime: row.pickup_time,
    vehicleType: row.vehicle_type,
    passengerCount: row.passenger_count,
    specialRequests: row.special_requests,
    driverName: row.driver_name,
    contactNumber: row.contact_number
  }));
  return res.json(items);
});

router.post('/transportation', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const body = { ...req.body };
  delete body.transportId;
  if (requireFields(res, body, ['eventId'])) return;
  const record = camelToSnakeRecord(body);
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_transportation').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Update & Delete for operational entities ───────────────────────
// These entities were previously create-only: a typo or a cancelled
// allocation could never be corrected. Every table gets a generic
// PUT (camelCase body -> snake_case columns) and a DELETE.

// Helper: generic PATCH-style update that only writes keys present in the body.
function buildUpdate(body: any, idKeys: string[]) {
  const record = { ...body };
  for (const k of idKeys) delete record[k];
  const snake = camelToSnakeRecord(record);
  snake.updated_at = new Date().toISOString();
  return snake;
}

const updatableTables: { path: string; table: string; idKeys: string[] }[] = [
  { path: 'menu-items',        table: 'banquet_menu_items',       idKeys: ['itemId'] },
  { path: 'beverages',         table: 'banquet_beverages',        idKeys: ['itemId'] },
  { path: 'resources',         table: 'banquet_resources',        idKeys: ['resourceId'] },
  { path: 'equipment',         table: 'banquet_equipment',        idKeys: ['equipmentId'] },
  { path: 'vendors',           table: 'banquet_vendors',          idKeys: ['vendorId'] },
  { path: 'transportation',    table: 'banquet_transportation',   idKeys: ['transportId'] },
  { path: 'schedules',         table: 'banquet_schedules',        idKeys: ['scheduleId'] },
  { path: 'communications',    table: 'banquet_communications',   idKeys: ['commId'] },
  { path: 'department-coordination', table: 'banquet_dept_coordination', idKeys: ['coordId'] },
  { path: 'venues',            table: 'banquet_venues',           idKeys: ['venueId'] },
];

for (const { path, table, idKeys } of updatableTables) {
  router.put(`/${path}/:id`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

    const updates = buildUpdate(req.body, idKeys);
    if (Object.keys(updates).length <= 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabaseAdmin.from(table)
      .update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  });

  router.delete(`/${path}/:id`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

    const { error } = await supabaseAdmin.from(table).delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  });
}

// ── Guests: full edit + delete (RSVP update already exists) ────────
router.put('/guests/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates = buildUpdate(req.body, ['guestId']);
  const { data, error } = await supabaseAdmin.from('banquet_event_guests')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/guests/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin.from('banquet_event_guests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Registrations: full edit + delete ──────────────────────────────
router.put('/registrations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates = buildUpdate(req.body, ['registrationId']);
  const { data, error } = await supabaseAdmin.from('banquet_event_registrations')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/registrations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin.from('banquet_event_registrations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Checklists: edit + delete (status toggle already exists) ───────
router.put('/checklists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const updates = buildUpdate(req.body, ['checklistId']);
  const { data, error } = await supabaseAdmin.from('banquet_checklists')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/checklists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin.from('banquet_checklists').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── BEO delete: only Draft BEOs may be removed ─────────────────────
router.delete('/beos/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: beo } = await supabaseAdmin.from('banquet_beos')
    .select('status, event_id').eq('id', req.params.id).single();
  if (!beo) return res.status(404).json({ error: 'BEO not found' });
  if (beo.status !== 'Draft') {
    return res.status(409).json({ error: 'Only Draft BEOs can be deleted' });
  }

  const { error } = await supabaseAdmin.from('banquet_beos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  // The event's beo_generated flag is now stale — clear it so a fresh BEO
  // can be generated from the current catering/logistics data.
  if (beo.event_id) {
    await supabaseAdmin.from('event_bookings')
      .update({ beo_generated: false, updated_at: new Date().toISOString() })
      .eq('id', beo.event_id);
  }
  return res.json({ success: true });
});

// ── Issues: delete ─────────────────────────────────────────────────
router.delete('/issues/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin.from('banquet_event_issues').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Menu approval (462) ────────────────────────────────────────────
// Event-level menu decision. 'Approved' also stamps every item so the
// BEO and the MenuApprovalPending alert agree. Item-level approval goes
// through the generic PUT /menu-items/:id (approvalStatus).
const MENU_STATUSES = ['Draft', 'Proposed', 'Approved', 'Rejected'];

router.put('/events/:id/menu-status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const status = req.body.status;
  if (!MENU_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${MENU_STATUSES.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin.from('event_bookings')
    .update({
      menu_status: status,
      menu_approved_by: status === 'Approved' ? ((req as any).user?.id || null) : null,
      menu_approved_at: status === 'Approved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id).select('id, menu_status, menu_approved_by, menu_approved_at').single();
  if (error) return res.status(500).json({ error: error.message });

  // Keep item state consistent with the event-level decision.
  if (status === 'Approved') {
    await supabaseAdmin.from('banquet_menu_items')
      .update({ approval_status: 'Approved' })
      .eq('event_id', req.params.id);
  } else if (status === 'Rejected') {
    await supabaseAdmin.from('banquet_menu_items')
      .update({ approval_status: 'Rejected' })
      .eq('event_id', req.params.id)
      .eq('approval_status', 'Pending');
  }

  return res.json(data);
});

// ── Equipment catalog (463) ────────────────────────────────────────
// Central rentable stock. banquet_equipment rows link via catalogItemId;
// committed demand is the sum across live (Confirmed/Planning/InProgress)
// events — GET returns both so the UI can flag shortages inline.
router.get('/equipment-catalog', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);

  let q = supabaseAdmin.from('banquet_equipment_catalog')
    .select('*').order('item_name', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Committed quantity across live events, from the demand view.
  const ids = (data || []).map((c: any) => c.id);
  const committed: Record<string, number> = {};
  if (ids.length) {
    let dQ = supabaseAdmin.from('event_equipment_demand')
      .select('catalog_item_id, quantity_committed')
      .in('catalog_item_id', ids);
    if (propertyId) dQ = dQ.eq('property_id', propertyId);
    const { data: demand } = await dQ;
    for (const d of demand || []) {
      committed[d.catalog_item_id] = (committed[d.catalog_item_id] || 0) + Number(d.quantity_committed || 0);
    }
  }

  return res.json((data || []).map((c: any) => ({
    catalogItemId: c.id,
    itemName: c.item_name,
    category: c.category,
    totalQuantity: c.total_quantity,
    committed: committed[c.id] || 0,
    available: c.total_quantity - (committed[c.id] || 0),
    isActive: c.is_active,
    notes: c.notes,
  })));
});

router.post('/equipment-catalog', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['itemName'])) return;
  const record = camelToSnakeRecord({ ...req.body });
  delete record.catalog_item_id;
  record.property_id = resolvePropertyId(req) || record.property_id;

  const { data, error } = await supabaseAdmin.from('banquet_equipment_catalog')
    .insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/equipment-catalog/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['catalogItemId']);
  const { data, error } = await supabaseAdmin.from('banquet_equipment_catalog')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/equipment-catalog/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_equipment_catalog')
    .delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Deposit schedule + progressive billing (464) ───────────────────
// Schedule rows are the plan; paid status is derived in
// event_deposit_schedule_status from EventDeposit folio payments.
router.get('/events/:id/deposit-schedule', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('event_deposit_schedule_status')
    .select('*').eq('event_id', req.params.id)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((row: any) => ({
    scheduleId: row.id,
    eventId: row.event_id,
    label: row.label,
    dueDate: row.due_date,
    amount: Number(row.amount || 0),
    amountPaid: Number(row.amount_paid || 0),
    eventDepositsTotal: Number(row.event_deposits_total || 0),
    status: row.status,
    notes: row.notes,
  })));
});

router.post('/events/:id/deposit-schedule', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['amount'])) return;

  const { data: event, error: evErr } = await supabaseAdmin.from('event_bookings')
    .select('property_id').eq('id', req.params.id).single();
  if (evErr) return res.status(404).json({ error: 'Event not found' });

  const { data, error } = await supabaseAdmin.from('event_deposit_schedule')
    .insert({
      property_id: event.property_id,
      event_id: req.params.id,
      label: req.body.label || 'Deposit',
      due_date: req.body.dueDate || null,
      amount: Number(req.body.amount) || 0,
      notes: req.body.notes || null,
    }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/deposit-schedule/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['scheduleId']);
  const { data, error } = await supabaseAdmin.from('event_deposit_schedule')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/deposit-schedule/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('event_deposit_schedule')
    .delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Progressive billing: invoice the unbilled delta on the event folio.
router.post('/events/:id/invoice-interim', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.rpc('issue_event_interim_invoice', {
    p_event_id: req.params.id,
    p_user_id: (req as any).user?.id || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.success) return res.status(409).json({ error: data?.error });
  return res.status(201).json(data);
});

// All invoices for an event — interim + final — via the event folio.
router.get('/events/:id/invoices', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: event, error: evErr } = await supabaseAdmin.from('event_bookings')
    .select('folio_id').eq('id', req.params.id).single();
  if (evErr) return res.status(404).json({ error: 'Event not found' });

  const orFilter = [`event_id.eq.${req.params.id}`];
  if (event.folio_id) orFilter.push(`folio_id.eq.${event.folio_id}`);

  const { data, error } = await supabaseAdmin.from('invoice_documents')
    .select('id, invoice_number, invoice_type, issue_date, due_date, total, amount_paid, status, is_voided')
    .or(orFilter.join(','))
    .order('issue_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((i: any) => snakeToCamelRecord(i)));
});

// ── Audit log (466) ────────────────────────────────────────────────
// Read-only; rows are written by trg_banquet_audit on every banquet table.
router.get('/audit-log', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const { eventId, table, recordId, limit } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('banquet_audit_log')
    .select('id, table_name, record_id, event_id, action, old_data, new_data, changed_by, changed_at')
    .order('changed_at', { ascending: false })
    .limit(Math.min(Number(limit) || 200, 1000));
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  if (table) q = q.eq('table_name', table);
  if (recordId) q = q.eq('record_id', recordId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => snakeToCamelRecord(r)));
});

// ── BEO revision history (467) ─────────────────────────────────────
router.get('/beos/:id/versions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('banquet_beo_versions')
    .select('id, version_no, status, snapshot, changed_by, created_at')
    .eq('beo_id', req.params.id)
    .order('version_no', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => snakeToCamelRecord(r)));
});

// ── Event budgets + risk (468) ─────────────────────────────────────
router.get('/events/:id/budget', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('event_budgets')
    .select('*').eq('event_id', req.params.id).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => snakeToCamelRecord(r)));
});

router.get('/events/:id/budget-variance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('event_budget_variance')
    .select('*').eq('event_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => snakeToCamelRecord(r)));
});

router.post('/events/:id/budget', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['category', 'budgetedAmount'])) return;

  const { data: event, error: evErr } = await supabaseAdmin.from('event_bookings')
    .select('property_id').eq('id', req.params.id).single();
  if (evErr) return res.status(404).json({ error: 'Event not found' });

  const { data, error } = await supabaseAdmin.from('event_budgets')
    .insert({
      property_id: event.property_id,
      event_id: req.params.id,
      category: req.body.category,
      item: req.body.item || null,
      budgeted_amount: Number(req.body.budgetedAmount) || 0,
      notes: req.body.notes || null,
    }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/budgets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['budgetId']);
  const { data, error } = await supabaseAdmin.from('event_budgets')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/budgets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('event_budgets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Venue blackouts (469) ──────────────────────────────────────────
router.get('/venue-blackouts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_venue_blackouts')
    .select('*, banquet_venues!left(venue_name)')
    .order('start_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => ({
    blackoutId: r.id,
    venueId: r.venue_id,
    venueName: r.banquet_venues?.venue_name,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason,
  })));
});

router.post('/venue-blackouts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['venueId', 'startDate', 'endDate'])) return;
  const { data, error } = await supabaseAdmin.from('banquet_venue_blackouts')
    .insert({
      property_id: resolvePropertyId(req),
      venue_id: req.body.venueId,
      start_date: req.body.startDate,
      end_date: req.body.endDate,
      reason: req.body.reason || null,
    }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/venue-blackouts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['blackoutId']);
  const { data, error } = await supabaseAdmin.from('banquet_venue_blackouts')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/venue-blackouts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_venue_blackouts')
    .delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Vendor registry (470) ──────────────────────────────────────────
router.get('/vendor-registry', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  let q = supabaseAdmin.from('banquet_vendor_registry')
    .select('*').eq('is_active', true).order('vendor_name', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => snakeToCamelRecord(r)));
});

router.post('/vendor-registry', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['vendorName'])) return;
  const record = camelToSnakeRecord({ ...req.body });
  delete record.registry_id;
  record.property_id = resolvePropertyId(req) || record.property_id;
  const { data, error } = await supabaseAdmin.from('banquet_vendor_registry')
    .insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/vendor-registry/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['registryId']);
  const { data, error } = await supabaseAdmin.from('banquet_vendor_registry')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/vendor-registry/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  // Soft-delete: deactivate so event vendor rows keep their registry link.
  const { data, error } = await supabaseAdmin.from('banquet_vendor_registry')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Rooming lists (471) ────────────────────────────────────────────
router.get('/rooming-list', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = resolvePropertyId(req);
  const { eventId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('banquet_rooming_list')
    .select('*').order('check_in', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((r: any) => snakeToCamelRecord(r)));
});

router.post('/rooming-list', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (requireFields(res, req.body, ['eventId', 'guestName'])) return;
  const record = camelToSnakeRecord({ ...req.body });
  delete record.rooming_id;
  record.property_id = resolvePropertyId(req) || record.property_id;
  const { data, error } = await supabaseAdmin.from('banquet_rooming_list')
    .insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/rooming-list/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates = buildUpdate(req.body, ['roomingId']);
  const { data, error } = await supabaseAdmin.from('banquet_rooming_list')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/rooming-list/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('banquet_rooming_list').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;