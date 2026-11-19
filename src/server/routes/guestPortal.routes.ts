import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import {
  canActForGuest,
  findAppointmentConflicts,
  guestPropertyId,
  guestWellnessWarnings,
  nextSpaId,
  providerDayStatus,
  recordAppointmentHistory,
  recordContraindicationAlert,
  timeToMin,
} from '../services/spaService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

/**
 * Legacy surface kept for compatibility — this router is not mounted, but it
 * must be safe if it ever is. Never trust a client-supplied guest_id: the
 * caller must be a staff/proxy role or present a reservationId that belongs
 * to the guest (see spaService.canActForGuest).
 */
const guestParamGuard = async (req: any, res: any, next: any) => {
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  next();
};

const guestBodyGuard = async (req: any, res: any, next: any) => {
  const guestId = req.body?.guest_id ?? req.body?.guestId;
  if (guestId && !(await canActForGuest(req, guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  next();
};

// ── Guest Portal Routes ─────────────────────────────────────────────────────

// ── Profile & Preferences ─────────────────────────────────────────────────
router.get('/profile/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.params.guestId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.put('/profile/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(req.body)
    .eq('id', req.params.guestId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('profile-*');
  return res.json(data);
});

// ── Reservations ───────────────────────────────────────────────────────────
router.get('/reservations/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('guest_id', req.params.guestId)
    .order('check_in_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ reservations: data || [] });
});

router.post('/reservations', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('reservations')
    .insert(req.body)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('reservation-*');
  return res.status(201).json(data);
});

router.put('/reservations/:id', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('reservations')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('reservation-*');
  return res.json(data);
});

router.delete('/reservations/:id', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { error } = await supabaseAdmin
    .from('reservations')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('reservation-*');
  return res.status(204).send();
});

// ── Digital Check-in ─────────────────────────────────────────────────────
router.get('/checkin/:reservationId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('digital_checkins')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/checkin', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('digital_checkins')
    .insert({
      ...req.body,
      status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/checkin/:id/status', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('digital_checkins')
    .update({ status: req.body.status })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Digital Room Key ─────────────────────────────────────────────────────
router.get('/room-keys/:reservationId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('digital_room_keys')
    .select('*')
    .eq('reservation_id', req.params.reservationId);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ keys: data || [] });
});

router.post('/room-keys', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('digital_room_keys')
    .insert({
      ...req.body,
      status: 'active',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/room-keys/:id/revoke', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('digital_room_keys')
    .update({ status: 'revoked' })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Room Service ─────────────────────────────────────────────────────────
router.get('/room-service/menu/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `room-service-menu:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('room_service_menu')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('is_available', true)
    .order('category', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const result = { menuItems: data || [] };
  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

router.post('/room-service/orders', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('room_service_orders')
    .insert({
      ...req.body,
      status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/room-service/orders/:reservationId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('room_service_orders')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ orders: data || [] });
});

// ── Restaurant Reservations ───────────────────────────────────────────────
// Backed by the real F&B book: outlets + fb_table_reservations
// (booked_via='guest'; the host assigns a table at seating). The legacy
// `restaurants`/`restaurant_reservations` tables never existed.
const LEGACY_RESTAURANT_OUTLET_TYPES = ['Restaurant', 'Bar'];

router.get('/restaurants/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `restaurants:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('outlets')
    .select('id, name, type, operating_hours')
    .eq('is_active', true)
    .in('type', LEGACY_RESTAURANT_OUTLET_TYPES);

  if (error) return res.status(500).json({ error: error.message });

  const result = {
    restaurants: (data || []).map((o: any) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      operating_hours: o.operating_hours || null,
    })),
  };
  cacheService.set(cacheKey, result, 60 * 60 * 1000);
  return res.json(result);
});

router.post('/restaurant-reservations', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    reservation_id, guest_name, party_size, special_requests, duration,
  } = req.body || {};
  const outletId = req.body?.outlet_id ?? req.body?.restaurant_id;
  const arrival = req.body?.arrival_time ?? req.body?.reservation_date ?? req.body?.date_time;

  if (!outletId || !arrival) {
    return res.status(400).json({ error: 'outlet_id and arrival_time are required' });
  }
  const arrivalDate = new Date(arrival);
  if (Number.isNaN(arrivalDate.getTime())) {
    return res.status(400).json({ error: 'Invalid arrival_time' });
  }

  const { data, error } = await supabaseAdmin
    .from('fb_table_reservations')
    .insert({
      outlet_id: outletId,
      table_id: null,
      reservation_id: reservation_id || null,
      guest_name: guest_name || null,
      party_size: Math.max(1, Number(party_size) || 2),
      arrival_time: arrivalDate.toISOString(),
      duration: Math.max(15, Number(duration) || 120),
      status: 'confirmed',
      special_requests: special_requests || null,
      booked_via: 'guest',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/restaurant-reservations/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // fb_table_reservations links to reservations, not guests — resolve the
  // guest's reservation ids first.
  const { data: resvs, error: resvErr } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('guest_id', req.params.guestId);
  if (resvErr) return res.status(500).json({ error: resvErr.message });

  const resvIds = (resvs || []).map((r: any) => r.id);
  if (resvIds.length === 0) return res.json({ reservations: [] });

  const { data, error } = await supabaseAdmin
    .from('fb_table_reservations')
    .select('*')
    .in('reservation_id', resvIds)
    .order('arrival_time', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ reservations: data || [] });
});

// ── Spa & Wellness ───────────────────────────────────────────────────────
// Guest-facing booking backed by spa_appointments with the same conflict,
// roster and wellness-safety checks as the staff portal (spaService).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

router.get('/spa/treatments/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const propId = isUuid(req.params.propertyId) ? req.params.propertyId : null;
  const cacheKey = `spa-treatments:${propId ?? 'shared'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  // Shared catalog rows (property_id NULL) plus this property's own rows.
  let q = supabaseAdmin
    .from('spa_treatments')
    .select('id, name, category, description, duration_minutes, price, is_popular, room_type')
    .eq('is_active', true);
  q = propId ? q.or(`property_id.is.null,property_id.eq.${propId}`) : q.is('property_id', null);

  const { data, error } = await q.order('is_popular', { ascending: false }).order('name');
  if (error) return res.status(500).json({ error: error.message });

  const result = {
    treatments: (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description || '',
      duration: t.duration_minutes,
      price: Number(t.price) || 0,
      popular: !!t.is_popular,
      roomType: t.room_type || null,
    })),
  };
  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

// Available providers for a treatment/time slot — lets the guest picker only
// show therapists actually working that day.
router.get('/spa/availability/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, startTime, duration } = req.query as Record<string, string>;
  if (!date || !startTime) {
    return res.status(400).json({ error: 'date and startTime query params are required' });
  }
  const propId = isUuid(req.params.propertyId) ? req.params.propertyId : null;

  let q = supabaseAdmin
    .from('spa_therapists')
    .select('id, name, title, specialties, status')
    .eq('status', 'Active');
  q = propId ? q.or(`property_id.is.null,property_id.eq.${propId}`) : q.is('property_id', null);
  const { data: therapists, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const durationMin = Math.max(15, Number(duration) || 60);
  const available: Array<{ id: string; name: string; title: string | null }> = [];

  for (const t of therapists || []) {
    const day = await providerDayStatus(t.id, date, propId);
    if (day.isOff) continue;
    const start = timeToMin(startTime);
    if (day.window && start !== null && (start < day.window.start || start + durationMin > day.window.end)) continue;
    const conflicts = await findAppointmentConflicts({
      date, startTime, durationMin, therapistId: t.id, propertyId: propId,
    });
    if (!conflicts.length) available.push({ id: t.id, name: t.name, title: t.title || null });
  }

  return res.json({ date, startTime, providers: available });
});

router.post('/spa/bookings', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    guest_id, treatment_id, therapist_id,
    appointment_date, start_time, notes,
  } = req.body || {};

  if (!guest_id || !treatment_id || !appointment_date || !start_time) {
    return res.status(400).json({ error: 'guest_id, treatment_id, appointment_date and start_time are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
    return res.status(400).json({ error: 'appointment_date must be YYYY-MM-DD' });
  }
  if (timeToMin(start_time) === null) {
    return res.status(400).json({ error: 'start_time must be HH:MM' });
  }
  if (appointment_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Cannot book a past date' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name')
    .eq('id', guest_id)
    .maybeSingle();
  if (!guest) return res.status(400).json({ error: 'Unknown guest' });
  const guest_name = guest.name;
  const propId = await guestPropertyId(guest_id);

  const { data: treatment } = await supabaseAdmin
    .from('spa_treatments')
    .select('id, name, duration_minutes, price, is_active')
    .eq('id', treatment_id)
    .maybeSingle();
  if (!treatment || !treatment.is_active) {
    return res.status(400).json({ error: 'Unknown or unavailable treatment' });
  }

  const duration = Number(treatment.duration_minutes) || 60;
  const warnings: string[] = [];

  // Same enforcement as the staff portal: therapist must be working and free.
  if (therapist_id) {
    const day = await providerDayStatus(therapist_id, appointment_date, propId);
    if (day.isOff) {
      return res.status(409).json({ error: 'Selected provider is not working on that date' });
    }
    const start = timeToMin(start_time)!;
    if (day.window && (start < day.window.start || start + duration > day.window.end)) {
      return res.status(409).json({ error: `Selected time is outside the provider's ${day.shift} shift` });
    }
    const conflicts = await findAppointmentConflicts({
      date: appointment_date, startTime: start_time,
      durationMin: duration, therapistId: therapist_id, propertyId: propId,
    });
    if (conflicts.length) {
      return res.status(409).json({ error: 'Selected provider is already booked at that time' });
    }
  }

  for (const w of await guestWellnessWarnings(guest_id, propId)) warnings.push(w);

  let therapistName: string | null = null;
  if (therapist_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', therapist_id).maybeSingle();
    therapistName = th?.name ?? null;
  }

  const id = await nextSpaId('APT-');
  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .insert({
      id,
      guest_id,
      guest_name,
      treatment_id,
      treatment: treatment.name,
      therapist_id: therapist_id || null,
      therapist: therapistName,
      appointment_date,
      start_time,
      duration_minutes: duration,
      status: 'Requested',
      source: 'Guest Portal',
      amount: treatment.price,
      notes: notes || null,
      property_id: propId,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (warnings.some(w => w.startsWith('Allergies') || w.startsWith('Contraindications'))) {
    await recordContraindicationAlert({
      guestId: guest_id,
      appointmentId: id,
      therapistId: therapist_id,
      message: `Guest-portal booking ${id} for ${guest_name}: ${warnings.join(' | ')}`,
      propertyId: propId,
    });
  }

  return res.status(201).json({ ...data, warnings });
});

router.get('/spa/bookings/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, guest_id, guest_name, treatment, therapist, appointment_date, start_time, duration_minutes, status, amount, source, created_at')
    .eq('guest_id', req.params.guestId)
    .order('appointment_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookings: data || [] });
});

// Guests may cancel only their own Requested/Confirmed bookings.
router.patch('/spa/bookings/:id/cancel', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guest_id, reason } = req.body || {};
  if (!guest_id) return res.status(400).json({ error: 'guest_id is required' });

  const { data: appt } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, guest_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!appt) return res.status(404).json({ error: 'Booking not found' });
  if (appt.guest_id !== guest_id) {
    return res.status(403).json({ error: 'You can only cancel your own bookings' });
  }
  if (!['Requested', 'Confirmed'].includes(appt.status)) {
    return res.status(409).json({ error: `Cannot cancel a booking that is ${appt.status}` });
  }

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || 'Cancelled by guest',
      updated_at: new Date().toISOString(),
    })
    .eq('id', appt.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await recordAppointmentHistory({
    appointmentId: appt.id,
    action: 'cancelled',
    fromStatus: appt.status,
    toStatus: 'Cancelled',
    changedBy: 'guest',
    changedByName: guest_id,
    notes: reason || 'Cancelled by guest',
    propertyId: data.property_id,
  });
  return res.json(data);
});

// ── Concierge Services ───────────────────────────────────────────────────
// Writes into the shared guest_requests queue (assigned_department='Concierge')
// — the same table the staff Concierge portal reads.
router.post('/concierge/requests', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    guest_id, reservation_id, request_type, description, priority, notes
  } = req.body || {};
  if (!description) return res.status(400).json({ error: 'description is required' });

  let resv: any = null;
  if (reservation_id) {
    const { data } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_name, room_number, property_id')
      .eq('id', reservation_id)
      .maybeSingle();
    resv = data || null;
  }
  let guestName = resv?.guest_name || null;
  if (!guestName && guest_id) {
    const { data: g } = await supabaseAdmin.from('guests').select('name').eq('id', guest_id).maybeSingle();
    guestName = g?.name || null;
  }

  const requestNumber = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .insert({
      request_number: requestNumber,
      property_id: resv?.property_id || null,
      reservation_id: reservation_id || null,
      room_number: resv?.room_number || null,
      guest_name: guestName || 'Guest',
      request_type: request_type || 'Concierge',
      description,
      priority: priority || 'Normal',
      status: 'Open',
      assigned_department: 'Concierge',
      notes: notes || null,
      submitted_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/concierge/requests/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('guest_id', req.params.guestId);
  const reservationIds = (resv || []).map((r: any) => r.id);
  if (reservationIds.length === 0) return res.json({ requests: [] });

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .select('*')
    .in('reservation_id', reservationIds)
    .eq('assigned_department', 'Concierge')
    .order('submitted_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// ── Transportation ─────────────────────────────────────────────────────────
router.get('/transportation/vehicles/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `transportation-vehicles:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('transportation_vehicles')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('is_available', true);

  if (error) return res.status(500).json({ error: error.message });

  const result = { vehicles: data || [] };
  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

router.post('/transportation/bookings', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('transportation_bookings')
    .insert({
      ...req.body,
      status: 'confirmed',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Housekeeping Requests ─────────────────────────────────────────────────
router.post('/housekeeping/requests', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('housekeeping_requests')
    .insert({
      ...req.body,
      status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/housekeeping/requests/:reservationId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('housekeeping_requests')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// ── Maintenance Requests ─────────────────────────────────────────────────
router.post('/maintenance/requests', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('maintenance_requests')
    .insert({
      ...req.body,
      status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/maintenance/requests/:reservationId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('maintenance_requests')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// ── Events & Activities ───────────────────────────────────────────────────
router.get('/activities/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `activities:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('hotel_activities')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('is_available', true);

  if (error) return res.status(500).json({ error: error.message });

  const result = { activities: data || [] };
  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

router.post('/activity-bookings', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('activity_bookings')
    .insert({
      ...req.body,
      status: 'confirmed',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Loyalty Program ───────────────────────────────────────────────────────
router.get('/loyalty/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('loyalty_programs')
    .select('*')
    .eq('guest_id', req.params.guestId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.get('/loyalty/rewards/:tier', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const cacheKey = `loyalty-rewards:${req.params.tier}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('loyalty_rewards')
    .select('*')
    .eq('required_tier', req.params.tier)
    .eq('is_active', true);

  if (error) return res.status(500).json({ error: error.message });

  const result = { rewards: data || [] };
  cacheService.set(cacheKey, result, 60 * 60 * 1000);
  return res.json(result);
});

// ── Wallet & Payments ───────────────────────────────────────────────────
router.get('/wallet/payment-methods/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('guest_id', req.params.guestId)
    .eq('is_active', true);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ paymentMethods: data || [] });
});

router.post('/wallet/payment-methods', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .insert(req.body)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/wallet/payments/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_payments')
    .select('*')
    .eq('guest_id', req.params.guestId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ payments: data || [] });
});

// ── Billing & Folio ───────────────────────────────────────────────────────
router.get('/billing/folio/:reservationId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('reservation_folios')
    .select('*, folio_charges(*)')
    .eq('reservation_id', req.params.reservationId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/billing/payments', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('folio_payments')
    .insert({
      ...req.body,
      status: 'completed',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Messaging Center ───────────────────────────────────────────────────
router.get('/messaging/conversations/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_conversations')
    .select('*, guest_messages(*)')
    .eq('guest_id', req.params.guestId)
    .order('updated_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ conversations: data || [] });
});

router.post('/messaging/messages', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_messages')
    .insert({
      ...req.body,
      sender: 'guest',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Notifications ───────────────────────────────────────────────────────
router.get('/notifications/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_notifications')
    .select('*')
    .eq('guest_id', req.params.guestId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notifications: data || [] });
});

router.put('/notifications/:id/read', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_notifications')
    .update({ read: true })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Feedback & Reviews ───────────────────────────────────────────────────
router.post('/feedback', authenticate, guestBodyGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_feedback')
    .insert({
      ...req.body,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.get('/feedback/:guestId', authenticate, guestParamGuard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { data, error } = await supabaseAdmin
    .from('guest_feedback')
    .select('*')
    .eq('guest_id', req.params.guestId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ feedback: data || [] });
});

export default router;
