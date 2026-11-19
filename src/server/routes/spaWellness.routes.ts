/**
 * Spa & Wellness Portal API Routes
 * Appointments, treatment catalog, therapists, and treatment rooms.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { SPA_STORE_ID } from '../config/storeIds';
import { isFullAccessRole } from '../../types/erp';
import { voidLine } from '../services/folioService';
import {
  SpaError,
  applyCancellationFee,
  checkBookingResources,
  createSpaTransaction,
  dispatchComm,
  dispatchDueCommunications,
  findAppointmentConflicts,
  flagWaitlistForFreedSlot,
  guestWellnessWarnings,
  nextSpaId,
  postSpaChargeToFolio,
  providerDayStatus,
  recordAppointmentHistory,
  recordContraindicationAlert,
} from '../services/spaService';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Authorization ─────────────────────────────────────────────────────────
// Every mutating endpoint requires a spa/ops department role OR the matching
// granular permission code (registered in migration 494). Full-access roles
// (admin/gm/owner/…) always pass via isFullAccessRole.
const SPA_STAFF_ROLES = new Set([
  'spa', 'spa_manager', 'spa_director', 'wellness_manager',
  'spa_receptionist', 'spa_therapist',
  'ops_manager', 'operations', 'operations_manager',
]);
const SPA_MANAGER_ROLES = new Set([
  'spa_manager', 'spa_director', 'wellness_manager',
  'ops_manager', 'operations', 'operations_manager',
]);

// Path prefix → required permission for non-GET requests. First match wins.
const MUTATION_RULES: Array<{ pattern: RegExp; perm: string; managerOnly?: boolean }> = [
  { pattern: /^\/(transactions|gift-cards|memberships|retail|purchases)(\/|$)/, perm: 'spa:finance:manage', managerOnly: true },
  { pattern: /^\/(settings|reports)(\/|$)/, perm: 'spa:settings:manage', managerOnly: true },
  { pattern: /^\/(therapists|staff|attendance|provider-schedule)(\/|$)/, perm: 'spa:staff:manage', managerOnly: true },
  { pattern: /^\/wellness-profiles(\/|$)/, perm: 'spa:profiles:manage' },
  { pattern: /^\/communications(\/|$)/, perm: 'spa:comms:manage' },
  { pattern: /^\//, perm: 'spa:booking:manage' },
];

// Finance staff also read spa financials for reconciliation/reporting.
const FINANCE_READ_ROLES = new Set([
  'finance', 'fin_manager', 'finance_manager', 'finance_controller',
  'finance_director', 'accountant', 'auditor', 'revenue_manager', 'revenue',
]);
// Front desk / concierge read guest lookups while assisting with bookings.
const GUEST_LOOKUP_ROLES = new Set([
  ...SPA_STAFF_ROLES,
  'frontoffice', 'fo_manager', 'front_office_manager', 'front office manager',
  'receptionist', 'front_desk',
  'concierge', 'concierge_manager', 'guest_services_manager',
]);

// Sensitive GETs: authentication alone is not authorization — wellness
// profiles carry medical data, transactions/gift-cards carry financial data,
// staff/attendance carry HR data. First match wins; unlisted paths stay
// readable by any authenticated staff user (treatments, rooms, dashboard…).
const READ_RULES: Array<{ pattern: RegExp; perm: string; roles: Set<string> }> = [
  { pattern: /^\/(transactions|reports)(\/|$)/, perm: 'spa:finance:manage', roles: new Set([...SPA_STAFF_ROLES, ...FINANCE_READ_ROLES]) },
  { pattern: /^\/(gift-cards|memberships|purchases|retail\/sales)(\/|$)/, perm: 'spa:finance:manage', roles: SPA_STAFF_ROLES },
  { pattern: /^\/(staff|attendance)(\/|$)/, perm: 'spa:staff:manage', roles: SPA_STAFF_ROLES },
  { pattern: /^\/wellness-profiles(\/|$)/, perm: 'spa:profiles:manage', roles: SPA_STAFF_ROLES },
  { pattern: /^\/communications(\/|$)/, perm: 'spa:comms:manage', roles: SPA_STAFF_ROLES },
  { pattern: /^\/guests(\/|$)/, perm: 'spa:booking:manage', roles: GUEST_LOOKUP_ROLES },
];

// Authenticate once for every route (per-route `authenticate` below is kept
// for readability but is a no-op second pass).
router.use(authenticate);

router.use((req, res, next) => {
  const role = req.user?.role as string | undefined;
  if (isFullAccessRole(role)) return next();

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    const rule = READ_RULES.find(r => r.pattern.test(req.path));
    if (!rule) return next();
    if (role && rule.roles.has(role)) return next();
    return requirePermission(rule.perm)(req, res, next);
  }

  const rule = MUTATION_RULES.find(r => r.pattern.test(req.path))!;
  const allowed = rule.managerOnly ? SPA_MANAGER_ROLES : SPA_STAFF_ROLES;
  if (role && allowed.has(role)) return next();
  return requirePermission(rule.perm)(req, res, next);
});

const APPOINTMENT_STATUSES = [
  'Requested', 'Confirmed', 'Checked In', 'In Treatment',
  'Completed', 'Cancelled', 'No Show', 'Rescheduled',
];

const APPOINTMENT_SOURCES = [
  'Guest Portal', 'Front Desk', 'Concierge', 'Reception',
  'Telephone', 'Walk-in', 'Corporate Booking', 'Public Booking Request',
];

/**
 * Property scoping: rows with property_id NULL are shared/global config or
 * seeded demo data and are visible to every property. Property-owned rows
 * only show for their own property. Callers pass ?propertyId=<uuid>.
 * Non-UUID values are rejected to the shared-only scope — the value is
 * interpolated into a PostgREST `.or()` string, so validation doubles as
 * filter-injection protection.
 */
function scopeProperty(query: any, propertyId: string | undefined, req?: any) {
  // A user with 'Single' property access is locked to their assigned
  // property — the client-supplied ?propertyId is ignored so they cannot
  // read another property's rows. Multi/corporate users keep the existing
  // param-driven scope.
  const single = req?.user?.dataRestrictions?.propertyAccess === 'Single' && !isFullAccessRole(req?.user?.role);
  const userProp = req && isUuid(req.user?.propertyId) ? req.user.propertyId : null;
  const effective = single && userProp ? userProp : propertyId;
  if (!effective) return query;
  if (!isUuid(effective)) return query.is('property_id', null);
  return query.or(`property_id.is.null,property_id.eq.${effective}`);
}

/**
 * Effective property for write/report paths that take a raw propertyId
 * argument rather than going through scopeProperty (e.g. generateSpaReport,
 * insert payloads).
 */
function boundPropertyId(req: any, requested?: unknown): string | null {
  const single = req?.user?.dataRestrictions?.propertyAccess === 'Single' && !isFullAccessRole(req?.user?.role);
  const userProp = req && isUuid(req.user?.propertyId) ? req.user.propertyId : null;
  if (single && userProp) return userProp;
  return toPropertyId(requested) ?? userProp;
}

/**
 * Row-level property check for direct ID lookups (GET/PATCH/DELETE /:id) —
 * without this a Single-property user could fetch or mutate another
 * property's row by id even though list endpoints scope them out. Shared
 * (NULL property) rows are always accessible.
 */
function canAccessRowProperty(req: any, rowPropertyId: unknown): boolean {
  const single = req?.user?.dataRestrictions?.propertyAccess === 'Single' && !isFullAccessRole(req?.user?.role);
  if (!single) return true;
  const userProp = isUuid(req?.user?.propertyId) ? req.user.propertyId : null;
  if (!userProp) return !rowPropertyId; // unassigned user: shared rows only
  return !rowPropertyId || rowPropertyId === userProp;
}

/**
 * Restrict an update/delete query to rows the caller's property scope may
 * touch. For 'Single'-property users this adds a shared-or-own-property
 * filter so an id from another property simply matches nothing (the update
 * returns not-found rather than mutating a foreign row). A no-op for
 * multi/corporate/full-access users.
 */
function scopeRowWrite<T>(query: T, req: any): T {
  const single = req?.user?.dataRestrictions?.propertyAccess === 'Single' && !isFullAccessRole(req?.user?.role);
  if (!single) return query;
  const userProp = isUuid(req?.user?.propertyId) ? req.user.propertyId : null;
  if (!userProp) return (query as any).is('property_id', null);
  return (query as any).or(`property_id.is.null,property_id.eq.${userProp}`);
}

/** Coerce a body/query property id to a valid uuid or null (write paths). */
function toPropertyId(v: unknown): string | null {
  return isUuid(v) ? (v as string) : null;
}

/**
 * Escape a user-supplied term for use inside PostgREST `.or()` ilike
 * filters — strips the characters that could break out of the filter
 * expression (`,` `(` `)` `.` `:`) plus wildcard chars (`%` `_`).
 */
function orSearch(term: unknown): string {
  return String(term ?? '')
    .replace(/[,().:%_*"?\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

// ── Lookups ─────────────────────────────────────────────────────────

// GET /api/spa-wellness/treatments?category=&search=&includeInactive=&propertyId=
router.get('/treatments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, category, search, includeInactive } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_treatments').select('*').order('category').order('name'),
    propertyId, req);
  if (includeInactive !== 'true') q = q.eq('is_active', true);
  if (category) q = q.eq('category', category);
  if (search) q = q.or(`name.ilike.%${orSearch(search)}%,description.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/treatments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    name, category, duration_minutes, price, description,
    is_popular, therapist_qualifications, room_type, property_id, propertyId,
  } = req.body;

  if (!name || !category || !duration_minutes) {
    return res.status(400).json({ error: 'name, category and duration_minutes are required' });
  }

  const id = await nextSpaId('TRT-');

  const { data, error } = await supabaseAdmin
    .from('spa_treatments')
    .insert({
      id,
      name,
      category,
      duration_minutes,
      price: price ?? 0,
      description: description || null,
      is_popular: !!is_popular,
      therapist_qualifications: therapist_qualifications || [],
      room_type: room_type || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const TREATMENT_UPDATABLE_FIELDS = [
  'name', 'category', 'duration_minutes', 'price', 'description',
  'is_popular', 'is_active', 'therapist_qualifications', 'room_type',
];

router.patch('/treatments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const field of TREATMENT_UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_treatments')
    .update(updateData), req)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(404).json({ error: 'Treatment not found' });
  return res.json(data);
});

router.delete('/treatments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_treatments').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

const STAFF_ROLES = new Set([
  'Therapist', 'Stylist', 'Esthetician', 'Nail Technician',
  'Makeup Artist', 'Barber', 'Fitness Instructor', 'Receptionist', 'Supervisor',
]);
const STAFF_SHIFTS = new Set(['Morning', 'Evening', 'Night']);

// GET /api/spa-wellness/therapists?status=&role=&shift=&employmentType=&search=&withStats=&propertyId=
// withStats=true overlays live operational metrics computed from spa_appointments.
router.get('/therapists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, status, role, shift, employmentType, search, withStats } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_therapists').select('*').order('name'),
    propertyId, req);
  if (status) q = q.eq('status', status);
  if (role) q = q.eq('role', role);
  if (shift) q = q.eq('shift', shift);
  if (employmentType) q = q.eq('employment_type', employmentType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  let rows = data || [];
  if (search) {
    const term = search.toLowerCase();
    rows = rows.filter((t: any) =>
      t.name?.toLowerCase().includes(term) ||
      t.title?.toLowerCase().includes(term) ||
      (t.specialties || []).some((s: string) => s.toLowerCase().includes(term))
    );
  }

  if (withStats === 'true' && rows.length) {
    const { data: appts } = await scopeProperty(
      supabaseAdmin
        .from('spa_appointments')
        .select('therapist_id, status, amount'),
      propertyId, req);
    const byTherapist = new Map<string, { total: number; revenue: number; completed: number; countable: number }>();
    for (const a of appts || []) {
      if (!a.therapist_id) continue;
      const s = byTherapist.get(a.therapist_id) || { total: 0, revenue: 0, completed: 0, countable: 0 };
      s.total += 1;
      if (a.status !== 'Cancelled' && a.status !== 'No Show') {
        s.countable += 1;
        s.revenue += Number(a.amount) || 0;
        if (a.status === 'Completed') s.completed += 1;
      }
      byTherapist.set(a.therapist_id, s);
    }
    rows = rows.map((t: any) => {
      const s = byTherapist.get(t.id);
      return {
        ...t,
        appointments_count: s?.total ?? 0,
        revenue_generated: s?.revenue ?? 0,
        completion_rate: s && s.countable ? Math.round((s.completed / s.countable) * 100) : null,
      };
    });
  }

  return res.json(rows);
});

// POST /api/spa-wellness/therapists — add a staff member. Optionally accepts
// employeeId to link an existing HR employee, or email/phone/hire_date to
// create a new HR employee record (department 'Spa & Wellness').
router.post('/therapists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    name, title, specialties, certifications, languages, status,
    employment_type, rating, email, phone, hire_date,
    role, shift, workload, employee_id, property_id, propertyId,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (role && !STAFF_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  if (shift && !STAFF_SHIFTS.has(shift)) {
    return res.status(400).json({ error: `shift must be one of: ${[...STAFF_SHIFTS].join(', ')}` });
  }

  const resolvedRole = role || 'Therapist';
  const propId = boundPropertyId(req, property_id || propertyId);
  const idPrefix = ['Stylist', 'Barber', 'Nail Technician', 'Makeup Artist'].includes(resolvedRole) ? 'STY' : 'THP';
  const id = await nextSpaId(`${idPrefix}-`);

  // Resolve or create the linked HR employee record.
  let linkedEmployeeId = employee_id || null;
  if (linkedEmployeeId) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('id').eq('id', linkedEmployeeId).single();
    if (!emp) linkedEmployeeId = null; // invalid link — ignore
  } else if (email || phone || hire_date) {
    const empId = await nextSpaId('EMP-SPA-');
    const { data: newEmp, error: empError } = await supabaseAdmin
      .from('employees')
      .insert({
        id: empId,
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        department: 'Spa & Wellness',
        position: title || resolvedRole,
        status: 'Active',
        hire_date: hire_date || new Date().toISOString().split('T')[0],
        property_id: propId,
      })
      .select('id')
      .single();
    if (!empError && newEmp) linkedEmployeeId = empId;
  }

  const { data, error } = await supabaseAdmin
    .from('spa_therapists')
    .insert({
      id,
      name,
      title: title || null,
      specialties: specialties || [],
      certifications: certifications || [],
      languages: languages || [],
      status: status || 'Active',
      employment_type: employment_type || 'Full-time',
      rating: rating ?? 4.5,
      email: email || null,
      phone: phone || null,
      hire_date: hire_date || null,
      role: resolvedRole,
      shift: shift || 'Morning',
      workload: workload ?? 0,
      employee_id: linkedEmployeeId,
      property_id: propId,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const THERAPIST_UPDATABLE_FIELDS = [
  'name', 'title', 'specialties', 'certifications', 'languages',
  'status', 'employment_type', 'rating', 'email', 'phone', 'hire_date',
  'role', 'shift', 'workload', 'employee_id',
];

router.patch('/therapists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.role !== undefined && !STAFF_ROLES.has(req.body.role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  if (req.body.shift !== undefined && !STAFF_SHIFTS.has(req.body.shift)) {
    return res.status(400).json({ error: `shift must be one of: ${[...STAFF_SHIFTS].join(', ')}` });
  }
  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const field of THERAPIST_UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_therapists')
    .update(updateData), req)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(404).json({ error: 'Therapist not found' });
  return res.json(data);
});

router.delete('/therapists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_therapists').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// GET /api/spa-wellness/rooms?category=&status=&type=&search=&bookable=&propertyId=
router.get('/rooms', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, category, status, type, search, bookable } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_rooms').select('*').order('category').order('name'),
    propertyId, req);
  if (category) q = q.eq('category', category);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('room_type', type);
  if (bookable === 'true') q = q.eq('is_bookable', true);
  if (search) q = q.or(`name.ilike.%${orSearch(search)}%,room_type.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

const ROOM_STATUSES = ['Available', 'In Use', 'Cleaning', 'Maintenance', 'Out of Service'];
const ROOM_CATEGORIES = ['Treatment Room', 'Thermal & Hydro'];

router.post('/rooms', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    name, room_type, capacity, status, category, current_occupancy,
    equipment, features, temperature, target_temperature,
    last_maintenance, next_maintenance, last_cleaning, is_bookable,
    property_id, propertyId,
  } = req.body;

  if (!name || !room_type) {
    return res.status(400).json({ error: 'name and room_type are required' });
  }
  if (category && !ROOM_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${ROOM_CATEGORIES.join(', ')}` });
  }
  if (status && !ROOM_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${ROOM_STATUSES.join(', ')}` });
  }

  const id = await nextSpaId('SRM-');

  const { data, error } = await supabaseAdmin
    .from('spa_rooms')
    .insert({
      id, name, room_type,
      capacity: capacity ?? 1,
      status: status || 'Available',
      category: category || 'Treatment Room',
      current_occupancy: current_occupancy ?? 0,
      equipment: equipment || [],
      features: features || [],
      temperature: temperature ?? null,
      target_temperature: target_temperature ?? null,
      last_maintenance: last_maintenance || null,
      next_maintenance: next_maintenance || null,
      last_cleaning: last_cleaning || null,
      is_bookable: is_bookable ?? (category !== 'Thermal & Hydro'),
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const ROOM_FIELDS = [
  'name', 'room_type', 'capacity', 'status', 'category', 'current_occupancy',
  'equipment', 'features', 'temperature', 'target_temperature',
  'last_maintenance', 'next_maintenance', 'last_cleaning', 'is_bookable',
];

router.patch('/rooms/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.status && !ROOM_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${ROOM_STATUSES.join(', ')}` });
  }
  if (req.body.category && !ROOM_CATEGORIES.includes(req.body.category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${ROOM_CATEGORIES.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ROOM_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_rooms').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/rooms/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_rooms').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Guest picker for the booking form — searches the shared guests table.
router.get('/guests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { search, limit = 20 } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('guests')
    .select('id, name, email, phone, status')
    .order('name')
    .limit(Number(limit));
  if (search) {
    q = q.or(`name.ilike.%${orSearch(search)}%,email.ilike.%${orSearch(search)}%,phone.ilike.%${orSearch(search)}%`);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Appointments ────────────────────────────────────────────────────

// GET /api/spa-wellness/appointments?status=&source=&date=&search=&propertyId=&limit=
router.get('/appointments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, source, date, search, propertyId, limit = 200 } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin
      .from('spa_appointments')
      .select('*')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: true })
      .limit(Number(limit)),
    propertyId, req);

  if (status) q = q.eq('status', status);
  if (source) q = q.eq('source', source);
  if (date) q = q.eq('appointment_date', date);
  if (search) {
    q = q.or(`guest_name.ilike.%${orSearch(search)}%,treatment.ilike.%${orSearch(search)}%,therapist.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Recurring / series bookings (migration 497) ────────────────────────────
// Registered before /appointments/:id so 'series' isn't captured as an id.

const SERIES_FREQUENCIES = ['weekly', 'biweekly', 'monthly'];

function addOccurrence(dateStr: string, frequency: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14 * n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// (waitlist flagging lives in spaService.flagWaitlistForFreedSlot so the
// guest-portal routes share it)

// GET /api/spa-wellness/appointments/series — list series.
router.get('/appointments/series', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_appointment_series').select('*').order('created_at', { ascending: false }),
    propertyId, req);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/spa-wellness/appointments/series/:id — series + its instances.
router.get('/appointments/series/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: series } = await supabaseAdmin
    .from('spa_appointment_series').select('*').eq('id', req.params.id).maybeSingle();
  if (!series || !canAccessRowProperty(req, series.property_id)) {
    return res.status(404).json({ error: 'Series not found' });
  }
  const { data: appointments } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, appointment_date, start_time, status, therapist, room')
    .eq('series_id', series.id)
    .order('appointment_date')
    .order('start_time');
  return res.json({ ...series, appointments: appointments || [] });
});

// POST /api/spa-wellness/appointments/series — book a recurring block.
// Each instance gets the same conflict/roster checks as a single booking;
// conflicting dates are skipped and reported, not silently double-booked.
router.post('/appointments/series', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    guest_id, guest_name, treatment_id, therapist_id, room_id,
    frequency, start_date, start_time, occurrences, notes,
    property_id, propertyId,
  } = req.body;

  if (!guest_name || !treatment_id || !frequency || !start_date || !start_time || !occurrences) {
    return res.status(400).json({ error: 'guest_name, treatment_id, frequency, start_date, start_time and occurrences are required' });
  }
  if (!SERIES_FREQUENCIES.includes(frequency)) {
    return res.status(400).json({ error: `frequency must be one of: ${SERIES_FREQUENCIES.join(', ')}` });
  }
  const count = Number(occurrences);
  if (!Number.isInteger(count) || count < 2 || count > 52) {
    return res.status(400).json({ error: 'occurrences must be an integer between 2 and 52' });
  }
  if (timeToMin(start_time) === null) {
    return res.status(400).json({ error: 'start_time must be HH:MM' });
  }

  const { data: treatment } = await supabaseAdmin
    .from('spa_treatments').select('id, name, duration_minutes, price, is_active, therapist_qualifications, room_type')
    .eq('id', treatment_id).maybeSingle();
  if (!treatment || !treatment.is_active) {
    return res.status(400).json({ error: 'Unknown or inactive treatment' });
  }

  const propId = boundPropertyId(req, property_id || propertyId);
  const duration = Number(treatment.duration_minutes) || 60;

  let therapistName: string | null = null;
  if (therapist_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', therapist_id).maybeSingle();
    therapistName = th?.name ?? null;
  }
  let roomName: string | null = null;
  if (room_id) {
    const { data: rm } = await supabaseAdmin
      .from('spa_rooms').select('name').eq('id', room_id).maybeSingle();
    roomName = rm?.name ?? null;
  }

  // Guest safety flags apply to every instance.
  const warnings: string[] = [];
  if (guest_id) {
    for (const w of await guestWellnessWarnings(guest_id, propId)) warnings.push(w);
  }

  const seriesId = await nextSpaId('SRS-');
  const created: any[] = [];
  const skipped: Array<{ date: string; reason: string }> = [];

  for (let n = 0; n < count; n++) {
    const date = addOccurrence(start_date, frequency, n);

    if (therapist_id) {
      const day = await providerDayStatus(therapist_id, date, propId);
      if (day.isOff) {
        skipped.push({ date, reason: 'Provider off/inactive' });
        continue;
      }
      const start = timeToMin(start_time)!;
      if (day.window && (start < day.window.start || start + duration > day.window.end)) {
        skipped.push({ date, reason: `Outside provider's ${day.shift} shift window` });
        continue;
      }
    }

    const conflicts = await findAppointmentConflicts({
      date, startTime: start_time, durationMin: duration,
      therapistId: therapist_id, roomId: room_id, propertyId: propId,
    });
    if (conflicts.length) {
      skipped.push({ date, reason: `Conflict with ${conflicts[0].appointment_id}` });
      continue;
    }

    // Room bookability, provider qualifications and operating hours —
    // hard violations skip the occurrence, advisories join the warnings.
    try {
      for (const w of await checkBookingResources({
        treatment, therapistId: therapist_id, roomId: room_id,
        date, startTime: start_time, durationMin: duration,
      })) {
        warnings.push(`${date}: ${w}`);
      }
    } catch (e: any) {
      skipped.push({ date, reason: e?.message || 'Resource check failed' });
      continue;
    }

    const apptId = await nextSpaId('APT-');
    const { data: appt, error: insErr } = await supabaseAdmin
      .from('spa_appointments')
      .insert({
        id: apptId,
        guest_id: guest_id || null,
        guest_name,
        treatment_id,
        treatment: treatment.name,
        therapist_id: therapist_id || null,
        therapist: therapistName,
        room_id: room_id || null,
        room: roomName,
        appointment_date: date,
        start_time,
        duration_minutes: duration,
        status: 'Confirmed',
        source: 'Reception',
        amount: treatment.price,
        notes: notes || null,
        series_id: seriesId,
        property_id: propId,
      })
      .select()
      .single();
    if (insErr) {
      skipped.push({ date, reason: insErr.message });
      continue;
    }
    created.push(appt);
    await recordAppointmentHistory({
      appointmentId: apptId,
      action: 'created',
      toStatus: 'Confirmed',
      changedBy: req.user?.id,
      changedByName: req.user?.name,
      notes: `Series ${seriesId} occurrence ${n + 1}/${count}`,
      propertyId: propId,
    });
  }

  const { data: series, error: sErr } = await supabaseAdmin
    .from('spa_appointment_series')
    .insert({
      id: seriesId,
      guest_id: guest_id || null,
      guest_name,
      treatment_id,
      treatment: treatment.name,
      therapist_id: therapist_id || null,
      room_id: room_id || null,
      frequency,
      start_date,
      start_time,
      duration_minutes: duration,
      occurrences: count,
      status: created.length ? 'Active' : 'Cancelled',
      notes: notes || null,
      property_id: propId,
    })
    .select()
    .single();
  if (sErr) {
    // Orphaned appointments are still valid bookings; report them.
    warnings.push(`Series record failed to save: ${sErr.message}`);
  }

  if (guest_id && warnings.some(w => w.startsWith('Allergies') || w.startsWith('Contraindications'))) {
    await recordContraindicationAlert({
      guestId: guest_id,
      therapistId: therapist_id,
      message: `Series booking ${seriesId} for ${guest_name}: ${warnings.join(' | ')}`,
      propertyId: propId,
    });
  }

  return res.status(created.length ? 201 : 409).json({
    series: series || { id: seriesId },
    created: created.map(a => ({ id: a.id, appointment_date: a.appointment_date, start_time: a.start_time, status: a.status })),
    skipped,
    warnings,
  });
});

// PATCH /api/spa-wellness/appointments/series/:id/cancel — cancel every
// remaining bookable instance and close the series.
router.patch('/appointments/series/:id/cancel', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: series } = await supabaseAdmin
    .from('spa_appointment_series').select('*').eq('id', req.params.id).maybeSingle();
  if (!series || !canAccessRowProperty(req, series.property_id)) {
    return res.status(404).json({ error: 'Series not found' });
  }
  if (series.status === 'Cancelled') return res.status(409).json({ error: 'Series already cancelled' });

  const now = new Date().toISOString();
  const reason = req.body?.reason || 'Series cancelled';

  const { data: cancelled } = await scopeRowWrite(supabaseAdmin
    .from('spa_appointments')
    .update({ status: 'Cancelled', cancelled_at: now, cancellation_reason: reason, updated_at: now }), req)
    .eq('series_id', series.id)
    .in('status', ['Requested', 'Confirmed', 'Rescheduled'])
    .select('id');

  for (const a of cancelled || []) {
    await recordAppointmentHistory({
      appointmentId: a.id,
      action: 'cancelled',
      toStatus: 'Cancelled',
      changedBy: req.user?.id,
      changedByName: req.user?.name,
      notes: `Series ${series.id} cancelled: ${reason}`,
      propertyId: series.property_id,
    });
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_appointment_series')
    .update({ status: 'Cancelled', updated_at: now }), req)
    .eq('id', series.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ...data, cancelledCount: (cancelled || []).length });
});

router.get('/appointments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('spa_appointments').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Appointment not found' });
  if (!canAccessRowProperty(req, data.property_id)) {
    return res.status(404).json({ error: 'Appointment not found' });
  }
  return res.json(data);
});

router.post('/appointments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    guest_id, guest_name, treatment_id, therapist_id, room_id,
    appointment_date, start_time, duration_minutes, source, amount, notes,
    property_id, propertyId,
  } = req.body;

  if (!guest_name || !treatment_id || !appointment_date || !start_time) {
    return res.status(400).json({ error: 'guest_name, treatment_id, appointment_date and start_time are required' });
  }
  if (source && !APPOINTMENT_SOURCES.includes(source)) {
    return res.status(400).json({ error: `Invalid source. Allowed: ${APPOINTMENT_SOURCES.join(', ')}` });
  }

  // Resolve denormalized display fields from the lookup tables.
  const { data: treatment } = await supabaseAdmin
    .from('spa_treatments')
    .select('id, name, duration_minutes, price, therapist_qualifications, room_type')
    .eq('id', treatment_id)
    .single();
  if (!treatment) return res.status(400).json({ error: 'Unknown treatment' });

  let therapistName: string | null = null;
  if (therapist_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', therapist_id).single();
    therapistName = th?.name ?? null;
  }
  let roomName: string | null = null;
  if (room_id) {
    const { data: rm } = await supabaseAdmin
      .from('spa_rooms').select('name').eq('id', room_id).single();
    roomName = rm?.name ?? null;
  }

  const propId = boundPropertyId(req, property_id || propertyId);
  const duration = duration_minutes || treatment.duration_minutes;
  const warnings: string[] = [];

  // ── Conflict + availability checks ──────────────────────────────────
  try {
    const conflicts = await findAppointmentConflicts({
      date: appointment_date,
      startTime: start_time,
      durationMin: duration,
      therapistId: therapist_id,
      roomId: room_id,
      propertyId: propId,
    });
    if (conflicts.length) {
      const c = conflicts[0];
      return res.status(409).json({
        error: `Double booking — ${c.kind === 'therapist' ? 'therapist' : 'room'} already booked at ${c.start_time} (${c.appointment_id})`,
        conflicts,
      });
    }
    // Room bookability/status/maintenance, therapist qualifications, and
    // operating-hours window (migration 498).
    warnings.push(...await checkBookingResources({
      treatment,
      therapistId: therapist_id,
      roomId: room_id,
      date: appointment_date,
      startTime: start_time,
      durationMin: duration,
    }));
  } catch (e: any) {
    if (e instanceof SpaError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  // Provider must be working that day (roster 'Off' day is a hard block;
  // outside shift window is a soft warning).
  if (therapist_id) {
    const day = await providerDayStatus(therapist_id, appointment_date, propId);
    if (day.isOff) {
      return res.status(409).json({ error: 'Provider is off or inactive on that date' });
    }
    const start = timeToMin(start_time);
    if (day.window && start !== null) {
      const end = start + duration;
      if (start < day.window.start || end > day.window.end) {
        warnings.push(`Outside ${therapistName ?? 'provider'}'s ${day.shift} shift window`);
      }
    }
  }

  // Guest wellness-profile safety flags (allergies / contraindications).
  if (guest_id) {
    for (const w of await guestWellnessWarnings(guest_id, propId)) warnings.push(w);
  }

  const id = await nextSpaId('APT-');

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .insert({
      id,
      guest_id: guest_id || null,
      guest_name,
      treatment_id,
      treatment: treatment.name,
      therapist_id: therapist_id || null,
      therapist: therapistName,
      room_id: room_id || null,
      room: roomName,
      appointment_date,
      start_time,
      duration_minutes: duration,
      status: 'Requested',
      source: source || 'Reception',
      amount: amount ?? treatment.price,
      notes: notes || null,
      property_id: propId,
    })
    .select()
    .single();

  // 23P01 = exclusion-violation → the slot was taken between the conflict
  // check and the insert (migration 498 constraint).
  if (error?.code === '23P01') {
    return res.status(409).json({ error: 'Double booking — that slot was just taken. Please pick another time.' });
  }
  if (error) return res.status(500).json({ error: error.message });

  // Record the safety flags on the audit feed so the warning is traceable.
  if (guest_id && warnings.some(w => w.startsWith('Allergies') || w.startsWith('Contraindications'))) {
    await recordContraindicationAlert({
      guestId: guest_id,
      appointmentId: id,
      therapistId: therapist_id,
      message: `Booking ${id} for ${guest_name}: ${warnings.join(' | ')}`,
      propertyId: propId,
    });
  }

  await recordAppointmentHistory({
    appointmentId: id,
    action: 'created',
    toStatus: 'Requested',
    changedBy: req.user?.id,
    changedByName: req.user?.name,
    notes: `Booked via ${data.source}`,
    propertyId: propId,
  });

  return res.status(201).json({ ...data, warnings });
});

const UPDATABLE_FIELDS = [
  'guest_id', 'guest_name', 'treatment_id', 'treatment', 'therapist_id',
  'therapist', 'room_id', 'room', 'appointment_date', 'start_time',
  'duration_minutes', 'source', 'amount', 'notes',
];

// Allowed status transitions. Terminal states cannot leave; anything else
// can only move forward or to an end state.
const APPOINTMENT_TRANSITIONS: Record<string, string[]> = {
  Requested:    ['Confirmed', 'Cancelled', 'No Show'],
  Confirmed:    ['Checked In', 'Cancelled', 'No Show', 'Rescheduled'],
  'Checked In': ['In Treatment', 'Cancelled'],
  'In Treatment': ['Completed'],
  Rescheduled:  ['Requested', 'Confirmed', 'Cancelled'],
  Completed:    [],
  Cancelled:    [],
  'No Show':    [],
};

router.patch('/appointments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;

  const { data: current } = await supabaseAdmin
    .from('spa_appointments').select('*').eq('id', id).maybeSingle();
  if (!current) return res.status(404).json({ error: 'Appointment not found' });
  if (!canAccessRowProperty(req, current.property_id)) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  const warnings: string[] = [];
  const newStatus = req.body.status as string | undefined;
  if (newStatus !== undefined) {
    if (!APPOINTMENT_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${APPOINTMENT_STATUSES.join(', ')}` });
    }
    if (newStatus !== current.status) {
      const allowed = APPOINTMENT_TRANSITIONS[current.status] || [];
      if (!allowed.includes(newStatus)) {
        return res.status(409).json({
          error: `Cannot move ${current.status} → ${newStatus}. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
        });
      }
      updateData.status = newStatus;
      if (newStatus === 'Checked In') updateData.checked_in_at = new Date().toISOString();
      if (newStatus === 'Completed') updateData.completed_at = new Date().toISOString();
      if (newStatus === 'Cancelled' || newStatus === 'No Show') {
        updateData.cancelled_at = new Date().toISOString();
        if (req.body.cancellation_reason !== undefined) {
          updateData.cancellation_reason = req.body.cancellation_reason;
        }
      }
    }
  }

  // Re-validate slot conflicts when the schedule or resources change.
  const scheduleChanged =
    updateData.appointment_date !== undefined || updateData.start_time !== undefined ||
    updateData.duration_minutes !== undefined || updateData.therapist_id !== undefined ||
    updateData.room_id !== undefined;

  if (scheduleChanged) {
    const date = updateData.appointment_date ?? current.appointment_date;
    const startTime = updateData.start_time ?? current.start_time;
    const dur = Number(updateData.duration_minutes ?? current.duration_minutes);
    const thId = updateData.therapist_id !== undefined ? updateData.therapist_id : current.therapist_id;
    const rmId = updateData.room_id !== undefined ? updateData.room_id : current.room_id;
    try {
      const conflicts = await findAppointmentConflicts({
        date, startTime, durationMin: dur,
        therapistId: thId, roomId: rmId, excludeId: id,
        propertyId: current.property_id,
      });
      if (conflicts.length) {
        const c = conflicts[0];
        return res.status(409).json({
          error: `Double booking — ${c.kind === 'therapist' ? 'therapist' : 'room'} already booked at ${c.start_time} (${c.appointment_id})`,
          conflicts,
        });
      }
      if (thId) {
        const day = await providerDayStatus(thId, date, current.property_id);
        if (day.isOff) {
          return res.status(409).json({ error: 'Provider is off or inactive on that date' });
        }
        const start = timeToMin(startTime);
        if (day.window && start !== null && (start < day.window.start || start + dur > day.window.end)) {
          warnings.push(`Outside provider's ${day.shift} shift window`);
        }
      }
      // Room bookability/status/maintenance, therapist qualifications, and
      // operating-hours window for the rescheduled slot (migration 498).
      const trId = updateData.treatment_id !== undefined ? updateData.treatment_id : current.treatment_id;
      const { data: tr } = await supabaseAdmin
        .from('spa_treatments')
        .select('therapist_qualifications, room_type')
        .eq('id', trId)
        .maybeSingle();
      warnings.push(...await checkBookingResources({
        treatment: tr || {},
        therapistId: thId,
        roomId: rmId,
        date,
        startTime,
        durationMin: dur,
      }));
    } catch (e: any) {
      if (e instanceof SpaError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_appointments')
    .update(updateData), req)
    .eq('id', id)
    .select()
    .single();

  if (error?.code === '23P01') {
    return res.status(409).json({ error: 'Double booking — that slot was just taken. Please pick another time.' });
  }
  if (error) return res.status(404).json({ error: 'Appointment not found' });

  // ── Side effects on completion ──────────────────────────────────────
  // 1. Raise a deferred (Unpaid/Pending) transaction so the charge reaches
  //    Billing & Payments — unless one already exists for this appointment.
  // 2. Decrement a limited-visit membership for this guest.
  if (newStatus === 'Completed' && current.status !== 'Completed') {
    try {
      const { data: existingTxn } = await supabaseAdmin
        .from('spa_transactions').select('id').eq('appointment_id', id).limit(1).maybeSingle();
      if (!existingTxn) {
        await createSpaTransaction({
          guest_id: data.guest_id,
          guest_name: data.guest_name,
          appointment_id: id,
          therapist_id: data.therapist_id,
          description: `${data.treatment} (${data.duration_minutes} min)`,
          amount: Number(data.amount) || 0,
          payment_method: 'Unpaid',
          status: 'Pending',
          property_id: data.property_id,
          source: 'appointment',
        });
      }

      if (data.guest_id) {
        const { data: membership } = await supabaseAdmin
          .from('spa_memberships')
          .select('id, visits_remaining')
          .eq('guest_id', data.guest_id)
          .eq('status', 'Active')
          .gt('visits_remaining', 0)
          .order('end_date', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (membership) {
          await scopeRowWrite(supabaseAdmin
            .from('spa_memberships')
            .update({
              visits_remaining: (membership.visits_remaining || 0) - 1,
              updated_at: new Date().toISOString(),
            }), req)
            .eq('id', membership.id);
        }
      }
    } catch (sideErr) {
      // Side effects must not fail the status change; surface as a warning.
      console.error('Appointment completion side-effects failed:', sideErr);
      warnings.push('Charge/membership update failed — check Billing manually');
    }
  }

  // ── No-show fee (migration 497) ──────────────────────────────────────
  // Configurable % of the appointment amount raised as a Pending charge.
  // Request body may override with an explicit no_show_fee amount; the
  // 'No-Show Fee Percent' spa_settings row provides the default (0 = off).
  if (newStatus === 'No Show' && current.status !== 'No Show') {
    try {
      let feeAmount = req.body.no_show_fee !== undefined ? Number(req.body.no_show_fee) : null;
      if (feeAmount === null) {
        const { data: setting } = await supabaseAdmin
          .from('spa_settings')
          .select('value')
          .eq('name', 'No-Show Fee Percent')
          .eq('status', 'Configured')
          .maybeSingle();
        const pct = Number(setting?.value?.percent ?? 50);
        feeAmount = Math.round((Number(data.amount) || 0) * (pct / 100) * 100) / 100;
      }
      if (feeAmount > 0) {
        await createSpaTransaction({
          guest_id: data.guest_id,
          guest_name: data.guest_name,
          appointment_id: id,
          description: `No-show fee — ${data.treatment}`,
          amount: feeAmount,
          payment_method: 'Unpaid',
          status: 'Pending',
          property_id: data.property_id,
          source: 'no_show_fee',
        });
      }
    } catch (feeErr) {
      console.error('No-show fee creation failed:', feeErr);
      warnings.push('No-show fee could not be charged — check Billing manually');
    }
  }

  // ── Late-cancellation fee (migration 498) ────────────────────────────
  // 'Cancellation Fee' spa_setting {percent, window_hours}; charged when the
  // booking is cancelled inside the notice window. 0% disables.
  if (newStatus === 'Cancelled' && current.status !== 'Cancelled') {
    try {
      const fee = await applyCancellationFee(data);
      if (fee > 0) warnings.push(`Late-cancellation fee of $${fee.toFixed(2)} charged`);
    } catch (feeErr) {
      console.error('Cancellation fee creation failed:', feeErr);
      warnings.push('Cancellation fee could not be charged — check Billing manually');
    }
  }

  // ── Audit trail (migration 495) ──────────────────────────────────────
  if (newStatus && newStatus !== current.status) {
    await recordAppointmentHistory({
      appointmentId: id,
      action: newStatus === 'Cancelled' ? 'cancelled' : 'status_change',
      fromStatus: current.status,
      toStatus: newStatus,
      changedBy: req.user?.id,
      changedByName: req.user?.name,
      notes: updateData.cancellation_reason || null,
      propertyId: data.property_id,
    });
  }
  if (updateData.appointment_date !== undefined || updateData.start_time !== undefined) {
    const moved =
      updateData.appointment_date !== current.appointment_date ||
      updateData.start_time !== current.start_time;
    if (moved) {
      await recordAppointmentHistory({
        appointmentId: id,
        action: 'rescheduled',
        changedBy: req.user?.id,
        changedByName: req.user?.name,
        notes: `${current.appointment_date} ${current.start_time} → ${data.appointment_date} ${data.start_time}`,
        propertyId: data.property_id,
      });
    }
  }

  // A cancellation frees the slot — flag matching waitlist entries for
  // staff follow-up (same date, same treatment or therapist when specified).
  if (newStatus === 'Cancelled' || newStatus === 'No Show') {
    await flagWaitlistForFreedSlot(current);
  }
  // A reschedule frees the *old* slot — flag waitlist for that date too.
  if (updateData.appointment_date !== undefined || updateData.start_time !== undefined) {
    const moved =
      updateData.appointment_date !== current.appointment_date ||
      updateData.start_time !== current.start_time;
    if (moved) await flagWaitlistForFreedSlot(current);
  }

  return res.json({ ...data, warnings });
});

// GET /api/spa-wellness/appointments/:id/history — audit trail for a booking.
router.get('/appointments/:id/history', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await scopeProperty(supabaseAdmin
    .from('spa_appointment_history')
    .select('*')
    .eq('appointment_id', req.params.id)
    .order('created_at', { ascending: false }), undefined, req);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// DELETE /api/spa-wellness/appointments/:id — hard delete for erroneous
// entries only. In-progress/completed appointments must be cancelled so the
// financial and visit side-effects stay consistent; the audit trail survives
// the delete (migration 501 dropped the history FK cascade).
router.delete('/appointments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: appt } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, status, property_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  if (!canAccessRowProperty(req, appt.property_id)) {
    return res.status(404).json({ error: 'Appointment not found' });
  }
  if (['Completed', 'In Treatment', 'Checked In'].includes(appt.status)) {
    return res.status(409).json({
      error: `Cannot delete a ${appt.status} appointment — cancel it instead so charges and audit stay consistent`,
    });
  }

  await recordAppointmentHistory({
    appointmentId: appt.id,
    action: 'deleted',
    fromStatus: appt.status,
    changedBy: req.user?.id,
    changedByName: req.user?.name,
    notes: req.body?.reason || 'Deleted by staff',
    propertyId: appt.property_id,
  });

  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_appointments').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Staff Operations (mirror the HK staff management pattern) ──────────────

// List HR employees in 'Spa & Wellness' not yet linked to a roster row —
// for the "Link HR" dropdown.
router.get('/staff/available-employees', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: linkedRows } = await supabaseAdmin
    .from('spa_therapists').select('employee_id').not('employee_id', 'is', null);
  const linkedIds = (linkedRows || []).map((r: any) => r.employee_id);

  let q = supabaseAdmin
    .from('employees')
    .select('id, name, email, phone, position, hire_date, salary, department')
    .eq('status', 'Active')
    .eq('department', 'Spa & Wellness')
    .order('name');
  if (linkedIds.length > 0) {
    q = q.filter('id', 'not.in', `(${linkedIds.join(',')})`);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// Generic CRUD helper for the small ops tables.
function opsRoutes(path: string, table: string, updatable: string[], columnMap: Record<string, string> = {}) {
  router.get(`/staff/${path}`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { propertyId } = req.query as Record<string, string>;
    const { data, error } = await scopeProperty(
      supabaseAdmin.from(table).select('*').order('created_at'),
      propertyId, req);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  });

  router.post(`/staff/${path}`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const record: Record<string, any> = {};
    for (const field of updatable) {
      if (req.body[field] !== undefined) record[columnMap[field] || field] = req.body[field];
    }
    record.property_id = boundPropertyId(req, req.body.property_id || req.body.propertyId);
    const { data, error } = await supabaseAdmin.from(table).insert(record).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  });

  router.put(`/staff/${path}/:id`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of updatable) {
      if (req.body[field] !== undefined) patch[columnMap[field] || field] = req.body[field];
    }
    const { data, error } = await scopeRowWrite(supabaseAdmin
      .from(table).update(patch), req).eq('id', req.params.id).select().single();
    if (error) return res.status(404).json({ error: 'Record not found' });
    return res.json(data);
  });

  router.delete(`/staff/${path}/:id`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { error } = await scopeRowWrite(supabaseAdmin.from(table).delete(), req).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  });
}

opsRoutes('shifts', 'spa_shift_requirements',
  ['name', 'start_time', 'end_time', 'assigned_staff', 'required_staff']);
opsRoutes('staffing', 'spa_staffing_requirements',
  ['work_area', 'role', 'required_count', 'assigned_count', 'shift']);
opsRoutes('training', 'spa_staff_training',
  ['course', 'employee_id', 'staff_id', 'due_date', 'status']);
opsRoutes('productivity', 'spa_staff_productivity',
  ['employee_id', 'staff_id', 'treatments_completed', 'hours', 'guest_satisfaction', 'productivity_score', 'period_date']);

// ── Attendance (shared staff_attendance table, SPA scope) ──────────────────

const ATT_STATUSES = new Set([
  'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day',
  'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day',
]);

function shapeAttendance(row: any) {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    departmentScope: row.department_scope,
    employeeId: row.employee_id || null,
    attendanceDate: row.attendance_date,
    shift: row.shift,
    checkIn: row.check_in || null,
    checkOut: row.check_out || null,
    status: row.status,
    hoursWorked: Number(row.hours_worked) || 0,
    overtimeHours: Number(row.overtime_hours) || 0,
    notes: row.notes || null,
  };
}

// GET /api/spa-wellness/attendance/summary?propertyId= — per-staff rollup.
router.get('/attendance/summary', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('department_scope', 'SPA')
    .order('staff_name')
    .order('attendance_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const byStaff: Record<string, any> = {};
  for (const row of data || []) {
    if (!byStaff[row.staff_id]) {
      byStaff[row.staff_id] = {
        staffId: row.staff_id,
        staffName: row.staff_name,
        employeeId: row.employee_id || null,
        records: [],
        present: 0, late: 0, absent: 0, onLeave: 0, sick: 0, halfDay: 0,
        dayOff: 0, publicHoliday: 0, workFromHome: 0, mission: 0, trainingDay: 0,
        totalHours: 0, totalOvertime: 0, totalDays: 0,
      };
    }
    const s = byStaff[row.staff_id];
    s.totalDays++;
    s.totalHours += Number(row.hours_worked) || 0;
    s.totalOvertime += Number(row.overtime_hours) || 0;
    s.records.push(shapeAttendance(row));
    switch (row.status) {
      case 'Present': s.present++; break;
      case 'Late': s.late++; break;
      case 'Absent': s.absent++; break;
      case 'On Leave': s.onLeave++; break;
      case 'Sick': s.sick++; break;
      case 'Half Day': s.halfDay++; break;
      case 'Day Off': s.dayOff++; break;
      case 'Public Holiday': s.publicHoliday++; break;
      case 'Work From Home': s.workFromHome++; break;
      case 'Mission': s.mission++; break;
      case 'Training Day': s.trainingDay++; break;
    }
  }

  const summary = Object.values(byStaff).map((s: any) => ({
    ...s,
    attendanceRate: s.totalDays > 0
      ? Math.round(((s.present + s.late) / s.totalDays) * 100) : 0,
  }));

  return res.json({ summary });
});

// GET /api/spa-wellness/attendance?propertyId=&date= — flat record list.
router.get('/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, date } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('department_scope', 'SPA')
    .order('attendance_date', { ascending: false })
    .order('staff_name');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (date) q = q.eq('attendance_date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map(shapeAttendance));
});

// POST /api/spa-wellness/attendance — check in / record today for a staff member.
router.post('/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, property_id, staffId, staffName, shift, status, checkIn, notes } = req.body || {};
  const propId = propertyId || property_id;
  if (!propId || !staffId || !staffName) {
    return res.status(400).json({ error: 'propertyId, staffId, staffName are required' });
  }
  if (shift && !STAFF_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });
  if (status && !ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });

  const today = new Date().toISOString().split('T')[0];
  const id = `ATT-SPA-${staffId}-${today}`;

  let employeeId: string | null = null;
  const { data: staffRow } = await supabaseAdmin
    .from('spa_therapists').select('employee_id').eq('id', staffId).single();
  if (staffRow?.employee_id) employeeId = staffRow.employee_id;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').upsert({
      id, property_id: propId, staff_id: staffId, staff_name: staffName,
      department_scope: 'SPA', attendance_date: today,
      shift: shift || 'Morning', status: status || 'Present',
      check_in: checkIn || new Date().toISOString(),
      hours_worked: 0, overtime_hours: 0, notes: notes || null,
      employee_id: employeeId,
    }, { onConflict: 'staff_id,attendance_date' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(shapeAttendance(data));
});

// PUT /api/spa-wellness/attendance/:id — check out, correct status/hours.
router.put('/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, shift, notes } = req.body || {};
  if (status && !ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
  if (shift && !STAFF_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (checkIn !== undefined) patch.check_in = checkIn;
  if (checkOut !== undefined) patch.check_out = checkOut;
  if (hoursWorked !== undefined) patch.hours_worked = Number(hoursWorked);
  if (overtimeHours !== undefined) patch.overtime_hours = Number(overtimeHours);
  if (shift !== undefined) patch.shift = shift;
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('staff_attendance').update(patch), req).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Attendance record not found' });
  return res.json(shapeAttendance(data));
});

router.delete('/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(scopeRowWrite(supabaseAdmin.from('staff_attendance').delete(), req), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: req.params.id });
});

// ── Guest wellness profiles ─────────────────────────────────────

const SKIN_TYPES = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];
const PRESSURES = ['Light', 'Medium', 'Firm', 'Extra Firm'];
const COMM_PREFS = ['Email', 'SMS', 'Phone', 'In-Person'];

// GET /api/spa-wellness/wellness-profiles?search=&skinType=&guestId=&propertyId=&withStats=
router.get('/wellness-profiles', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, skinType, guestId, withStats } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_wellness_profiles').select('*').order('guest_name'),
    propertyId, req);
  if (skinType) q = q.eq('skin_type', skinType);
  if (guestId) q = q.eq('guest_id', guestId);
  if (search) q = q.or(`guest_name.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows: any[] = data || [];

  if (withStats === 'true' && rows.length) {
    const guestIds = rows.map(r => r.guest_id);
    const { data: appts } = await supabaseAdmin
      .from('spa_appointments')
      .select('guest_id, treatment, appointment_date, amount, status')
      .in('guest_id', guestIds)
      .order('appointment_date', { ascending: false });

    const byGuest = new Map<string, { visits: number; spent: number; lastVisit: string | null; history: { treatment: string; date: string }[] }>();
    for (const a of appts || []) {
      if (a.status === 'Cancelled' || a.status === 'No Show') continue;
      let s = byGuest.get(a.guest_id);
      if (!s) {
        s = { visits: 0, spent: 0, lastVisit: null, history: [] };
        byGuest.set(a.guest_id, s);
      }
      s.visits += 1;
      s.spent += Number(a.amount) || 0;
      if (!s.lastVisit) s.lastVisit = a.appointment_date;
      if (a.status === 'Completed' && s.history.length < 10) {
        s.history.push({ treatment: a.treatment, date: a.appointment_date });
      }
    }
    rows = rows.map(p => {
      const s = byGuest.get(p.guest_id);
      return {
        ...p,
        total_visits: s?.visits ?? 0,
        total_spent: s?.spent ?? 0,
        last_visit: s?.lastVisit ?? null,
        previous_treatments: s?.history ?? [],
      };
    });
  }

  return res.json(rows);
});

router.post('/wellness-profiles', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    guest_id, guest_name, wellness_goals, medical_notes, allergies, skin_type,
    treatment_preferences, contraindications, favorite_therapist_id,
    preferred_pressure, communication_preference, property_id, propertyId,
  } = req.body;

  if (!guest_id) return res.status(400).json({ error: 'guest_id is required' });
  if (skin_type && !SKIN_TYPES.includes(skin_type)) {
    return res.status(400).json({ error: `Invalid skin_type. Must be one of: ${SKIN_TYPES.join(', ')}` });
  }
  if (preferred_pressure && !PRESSURES.includes(preferred_pressure)) {
    return res.status(400).json({ error: `Invalid preferred_pressure. Must be one of: ${PRESSURES.join(', ')}` });
  }
  if (communication_preference && !COMM_PREFS.includes(communication_preference)) {
    return res.status(400).json({ error: `Invalid communication_preference. Must be one of: ${COMM_PREFS.join(', ')}` });
  }

  // Resolve display names from the lookup tables.
  const { data: guest } = await supabaseAdmin
    .from('guests').select('name').eq('id', guest_id).single();
  if (!guest) return res.status(404).json({ error: `Guest ${guest_id} not found` });

  let therapistName: string | null = null;
  if (favorite_therapist_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', favorite_therapist_id).single();
    therapistName = th?.name || null;
  }

  const id = await nextSpaId('WLP-');

  const { data, error } = await supabaseAdmin
    .from('spa_wellness_profiles')
    .insert({
      id,
      guest_id,
      guest_name: guest.name || guest_name || guest_id,
      wellness_goals: wellness_goals || [],
      medical_notes: medical_notes || null,
      allergies: allergies || [],
      skin_type: skin_type || null,
      treatment_preferences: treatment_preferences || [],
      contraindications: contraindications || [],
      favorite_therapist_id: favorite_therapist_id || null,
      favorite_therapist: therapistName,
      preferred_pressure: preferred_pressure || null,
      communication_preference: communication_preference || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A wellness profile already exists for this guest' });
    return res.status(500).json({ error: error.message });
  }
  return res.status(201).json(data);
});

const PROFILE_FIELDS = [
  'guest_name', 'wellness_goals', 'medical_notes', 'allergies', 'skin_type',
  'treatment_preferences', 'contraindications', 'favorite_therapist_id',
  'preferred_pressure', 'communication_preference',
];

router.patch('/wellness-profiles/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.skin_type && !SKIN_TYPES.includes(req.body.skin_type)) {
    return res.status(400).json({ error: `Invalid skin_type. Must be one of: ${SKIN_TYPES.join(', ')}` });
  }
  if (req.body.preferred_pressure && !PRESSURES.includes(req.body.preferred_pressure)) {
    return res.status(400).json({ error: `Invalid preferred_pressure. Must be one of: ${PRESSURES.join(', ')}` });
  }
  if (req.body.communication_preference && !COMM_PREFS.includes(req.body.communication_preference)) {
    return res.status(400).json({ error: `Invalid communication_preference. Must be one of: ${COMM_PREFS.join(', ')}` });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of PROFILE_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  // Keep the denormalized therapist name in sync.
  if (req.body.favorite_therapist_id !== undefined) {
    if (req.body.favorite_therapist_id) {
      const { data: th } = await supabaseAdmin
        .from('spa_therapists').select('name').eq('id', req.body.favorite_therapist_id).single();
      updates.favorite_therapist = th?.name || null;
    } else {
      updates.favorite_therapist = null;
    }
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_wellness_profiles').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/wellness-profiles/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_wellness_profiles').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Wellness programs + enrollments ─────────────────────────────

const PROGRAM_STATUSES = ['Active', 'Upcoming', 'Completed', 'Suspended'];
const PROGRAM_TYPES = [
  'Weight Management', 'Detox Program', 'Stress Relief', 'Fitness Transformation',
  'Corporate Wellness', 'Holistic Wellness', 'Senior Wellness',
  // Group class types (Fitness Center classes managed as wellness programs)
  'Yoga', 'Pilates', 'Spin', 'HIIT', 'Strength Training', 'Zumba', 'CrossFit',
];
const ENROLLMENT_STATUSES = ['Enrolled', 'Completed', 'Withdrawn'];

// GET /api/spa-wellness/wellness-programs?search=&status=&type=&propertyId=
router.get('/wellness-programs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, status, type } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_wellness_programs').select('*').order('start_date'),
    propertyId, req);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('program_type', type);
  if (search) q = q.or(`name.ilike.%${orSearch(search)}%,description.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows: any[] = data || [];

  // Live enrollment counts.
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const { data: enr } = await supabaseAdmin
      .from('spa_program_enrollments')
      .select('program_id')
      .in('program_id', ids)
      .eq('status', 'Enrolled');
    const counts = new Map<string, number>();
    for (const e of enr || []) counts.set(e.program_id, (counts.get(e.program_id) || 0) + 1);
    for (const r of rows) r.enrolled_count = counts.get(r.id) || 0;
  }

  return res.json(rows);
});

router.post('/wellness-programs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    name, program_type, description, duration_days, sessions, price, capacity,
    status, start_date, end_date, instructor_id, instructor, progress_tracking,
    milestones, schedule, location, property_id, propertyId,
  } = req.body;

  if (!name || !program_type) {
    return res.status(400).json({ error: 'name and program_type are required' });
  }
  if (status && !PROGRAM_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${PROGRAM_STATUSES.join(', ')}` });
  }
  if (program_type && !PROGRAM_TYPES.includes(program_type)) {
    return res.status(400).json({ error: `Invalid program_type. Must be one of: ${PROGRAM_TYPES.join(', ')}` });
  }

  let instructorName = instructor || null;
  if (instructor_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', instructor_id).single();
    if (th) instructorName = th.name;
  }

  const id = await nextSpaId('PRG-');

  const { data, error } = await supabaseAdmin
    .from('spa_wellness_programs')
    .insert({
      id, name, program_type,
      description: description || null,
      duration_days: duration_days ?? 1,
      sessions: sessions ?? 1,
      price: price ?? 0,
      capacity: capacity ?? 10,
      status: status || 'Upcoming',
      start_date: start_date || null,
      end_date: end_date || null,
      instructor_id: instructor_id || null,
      instructor: instructorName,
      progress_tracking: progress_tracking ?? true,
      milestones: milestones || [],
      schedule: schedule || null,
      location: location || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const PROGRAM_FIELDS = [
  'name', 'program_type', 'description', 'duration_days', 'sessions', 'price',
  'capacity', 'status', 'start_date', 'end_date', 'instructor_id', 'instructor',
  'progress_tracking', 'milestones', 'schedule', 'location',
];

router.patch('/wellness-programs/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.status && !PROGRAM_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${PROGRAM_STATUSES.join(', ')}` });
  }
  if (req.body.program_type && !PROGRAM_TYPES.includes(req.body.program_type)) {
    return res.status(400).json({ error: `Invalid program_type. Must be one of: ${PROGRAM_TYPES.join(', ')}` });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of PROGRAM_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (req.body.instructor_id !== undefined) {
    if (req.body.instructor_id) {
      const { data: th } = await supabaseAdmin
        .from('spa_therapists').select('name').eq('id', req.body.instructor_id).single();
      if (th) updates.instructor = th.name;
    }
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_wellness_programs').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/wellness-programs/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_wellness_programs').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Program enrollments ─────────────────────────────────────────

// GET /api/spa-wellness/wellness-programs/:id/enrollments
router.get('/wellness-programs/:id/enrollments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await scopeProperty(supabaseAdmin
    .from('spa_program_enrollments')
    .select('*')
    .eq('program_id', req.params.id)
    .order('enrolled_date', { ascending: false }), undefined, req);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/spa-wellness/wellness-programs/:id/enrollments — enroll a guest
router.post('/wellness-programs/:id/enrollments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const programId = req.params.id;
  const { guest_id, notes, property_id, propertyId } = req.body;
  if (!guest_id) return res.status(400).json({ error: 'guest_id is required' });

  const { data: program } = await supabaseAdmin
    .from('spa_wellness_programs').select('id, capacity').eq('id', programId).single();
  if (!program) return res.status(404).json({ error: `Program ${programId} not found` });

  const { count } = await supabaseAdmin
    .from('spa_program_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', programId)
    .eq('status', 'Enrolled');
  if (count != null && program.capacity && count >= program.capacity) {
    return res.status(409).json({ error: 'Program is at full capacity' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests').select('name').eq('id', guest_id).single();
  if (!guest) return res.status(404).json({ error: `Guest ${guest_id} not found` });

  const id = await nextSpaId('ENR-');
  const { data, error } = await supabaseAdmin
    .from('spa_program_enrollments')
    .insert({
      id,
      program_id: programId,
      guest_id,
      guest_name: guest.name,
      status: 'Enrolled',
      progress: 0,
      notes: notes || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Guest is already enrolled in this program' });
    return res.status(500).json({ error: error.message });
  }
  return res.status(201).json(data);
});

router.patch('/enrollments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, progress, notes } = req.body;
  if (status && !ENROLLMENT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${ENROLLMENT_STATUSES.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) updates.status = status;
  if (progress !== undefined) updates.progress = progress;
  if (notes !== undefined) updates.notes = notes;
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_program_enrollments').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/enrollments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_program_enrollments').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Memberships ─────────────────────────────────────────────────

const MEMBERSHIP_TYPES = ['Monthly', 'Quarterly', 'Annual', 'Family', 'Corporate', 'VIP'];
const MEMBERSHIP_STATUSES = ['Active', 'Expired', 'Frozen', 'Pending', 'Cancelled'];
const PAYMENT_METHODS = ['Credit Card', 'Bank Transfer', 'Cash', 'Corporate Billing', 'Direct Debit'];

// GET /api/spa-wellness/memberships?search=&status=&type=&propertyId=
router.get('/memberships', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, status, type } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_memberships').select('*').order('member_name'),
    propertyId, req);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('membership_type', type);
  if (search) q = q.or(`member_name.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%,guest_id.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows: any[] = data || [];

  // Lazy expiry — mark past-due non-renewing memberships Expired on read so
  // the list is accurate even when the daily job hasn't run yet.
  const today = new Date().toISOString().slice(0, 10);
  const expiredIds = rows
    .filter(r => r.status === 'Active' && r.end_date && r.end_date < today && !r.auto_renew)
    .map(r => r.id);
  if (expiredIds.length) {
    await scopeRowWrite(supabaseAdmin
      .from('spa_memberships')
      .update({ status: 'Expired', updated_at: new Date().toISOString() }), req)
      .in('id', expiredIds);
    for (const r of rows) if (expiredIds.includes(r.id)) r.status = 'Expired';
  }

  // Live visit counts: appointments since membership start (non-cancelled).
  if (rows.length) {
    const guestIds = [...new Set(rows.map(r => r.guest_id))];
    const { data: appts } = await supabaseAdmin
      .from('spa_appointments')
      .select('guest_id, appointment_date, status')
      .in('guest_id', guestIds);
    const byGuest = new Map<string, { date: string; status: string }[]>();
    for (const a of appts || []) {
      const list = byGuest.get(a.guest_id) || [];
      list.push({ date: a.appointment_date, status: a.status });
      byGuest.set(a.guest_id, list);
    }
    for (const r of rows) {
      const guestAppts = byGuest.get(r.guest_id) || [];
      r.total_visits = guestAppts.filter(a =>
        a.date >= r.start_date && a.status !== 'Cancelled' && a.status !== 'No Show'
      ).length;
    }
  }

  return res.json(rows);
});

router.post('/memberships', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    guest_id, membership_type, status, start_date, end_date, price, benefits,
    visits_remaining, auto_renew, payment_method, property_id, propertyId,
  } = req.body;

  if (!guest_id || !membership_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'guest_id, membership_type, start_date and end_date are required' });
  }
  if (!MEMBERSHIP_TYPES.includes(membership_type)) {
    return res.status(400).json({ error: `Invalid membership_type. Must be one of: ${MEMBERSHIP_TYPES.join(', ')}` });
  }
  if (status && !MEMBERSHIP_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${MEMBERSHIP_STATUSES.join(', ')}` });
  }
  if (payment_method && !PAYMENT_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: `Invalid payment_method. Must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests').select('name').eq('id', guest_id).single();
  if (!guest) return res.status(404).json({ error: `Guest ${guest_id} not found` });

  const id = await nextSpaId('MBR-');

  const { data, error } = await supabaseAdmin
    .from('spa_memberships')
    .insert({
      id,
      guest_id,
      member_name: guest.name,
      membership_type,
      status: status || 'Pending',
      start_date,
      end_date,
      price: price ?? 0,
      benefits: benefits || [],
      visits_remaining: visits_remaining ?? null,
      auto_renew: auto_renew ?? false,
      payment_method: payment_method || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Membership fee reaches Billing & Payments as a Pending transaction.
  if (Number(price) > 0) {
    try {
      await createSpaTransaction({
        guest_id,
        guest_name: guest.name,
        description: `Membership — ${membership_type} (${id})`,
        amount: Number(price),
        payment_method: 'Unpaid',
        status: 'Pending',
        property_id: data.property_id,
        source: 'membership',
      });
    } catch (e) {
      console.error('Membership transaction failed:', e);
    }
  }
  return res.status(201).json(data);
});

const MEMBERSHIP_FIELDS = [
  'membership_type', 'status', 'start_date', 'end_date', 'price', 'benefits',
  'visits_remaining', 'auto_renew', 'payment_method',
];

router.patch('/memberships/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.membership_type && !MEMBERSHIP_TYPES.includes(req.body.membership_type)) {
    return res.status(400).json({ error: `Invalid membership_type. Must be one of: ${MEMBERSHIP_TYPES.join(', ')}` });
  }
  if (req.body.status && !MEMBERSHIP_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${MEMBERSHIP_STATUSES.join(', ')}` });
  }
  if (req.body.payment_method && !PAYMENT_METHODS.includes(req.body.payment_method)) {
    return res.status(400).json({ error: `Invalid payment_method. Must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of MEMBERSHIP_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_memberships').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/memberships/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_memberships').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Wellness packages + purchases ───────────────────────────────

const PACKAGE_TYPES = [
  'Couples Retreat', 'Weekend Spa Package', 'Honeymoon Package',
  'Bridal Package', 'Executive Wellness', 'Family Wellness',
];
const PURCHASE_STATUSES = ['Active', 'Redeemed', 'Expired', 'Refunded'];

// GET /api/spa-wellness/wellness-packages?search=&type=&status=&propertyId=
router.get('/wellness-packages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, type, status } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_wellness_packages').select('*').order('name'),
    propertyId, req);
  if (type) q = q.eq('package_type', type);
  if (status === 'Active') q = q.eq('is_active', true);
  if (status === 'Inactive') q = q.eq('is_active', false);
  if (search) q = q.or(`name.ilike.%${orSearch(search)}%,description.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows: any[] = data || [];

  if (rows.length) {
    const ids = rows.map(r => r.id);
    const { data: purchases } = await supabaseAdmin
      .from('spa_package_purchases')
      .select('package_id')
      .in('package_id', ids)
      .neq('status', 'Refunded');
    const counts = new Map<string, number>();
    for (const p of purchases || []) counts.set(p.package_id, (counts.get(p.package_id) || 0) + 1);
    for (const r of rows) r.purchase_count = counts.get(r.id) || 0;
  }

  return res.json(rows);
});

router.post('/wellness-packages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    name, package_type, description, price, original_price, duration_minutes,
    sessions, validity_days, included_treatments, amenities, is_active,
    property_id, propertyId,
  } = req.body;

  if (!name || !package_type) {
    return res.status(400).json({ error: 'name and package_type are required' });
  }
  if (!PACKAGE_TYPES.includes(package_type)) {
    return res.status(400).json({ error: `Invalid package_type. Must be one of: ${PACKAGE_TYPES.join(', ')}` });
  }

  const id = await nextSpaId('PKG-');

  const { data, error } = await supabaseAdmin
    .from('spa_wellness_packages')
    .insert({
      id, name, package_type,
      description: description || null,
      price: price ?? 0,
      original_price: original_price ?? null,
      duration_minutes: duration_minutes ?? 60,
      sessions: sessions ?? 1,
      validity_days: validity_days ?? 90,
      included_treatments: included_treatments || [],
      amenities: amenities || [],
      is_active: is_active ?? true,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const PACKAGE_FIELDS = [
  'name', 'package_type', 'description', 'price', 'original_price',
  'duration_minutes', 'sessions', 'validity_days', 'included_treatments',
  'amenities', 'is_active',
];

router.patch('/wellness-packages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.package_type && !PACKAGE_TYPES.includes(req.body.package_type)) {
    return res.status(400).json({ error: `Invalid package_type. Must be one of: ${PACKAGE_TYPES.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of PACKAGE_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_wellness_packages').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/wellness-packages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_wellness_packages').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Package purchases ───────────────────────────────────────────

// GET /api/spa-wellness/wellness-packages/:id/purchases
router.get('/wellness-packages/:id/purchases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await scopeProperty(supabaseAdmin
    .from('spa_package_purchases')
    .select('*')
    .eq('package_id', req.params.id)
    .order('purchase_date', { ascending: false }), undefined, req);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/spa-wellness/wellness-packages/:id/purchases — sell a package
router.post('/wellness-packages/:id/purchases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const packageId = req.params.id;
  const { guest_id, amount_paid, property_id, propertyId } = req.body;
  if (!guest_id) return res.status(400).json({ error: 'guest_id is required' });

  const { data: pkg } = await supabaseAdmin
    .from('spa_wellness_packages').select('id, price, is_active').eq('id', packageId).single();
  if (!pkg) return res.status(404).json({ error: `Package ${packageId} not found` });
  if (!pkg.is_active) return res.status(409).json({ error: 'Package is not active' });

  const { data: guest } = await supabaseAdmin
    .from('guests').select('name').eq('id', guest_id).single();
  if (!guest) return res.status(404).json({ error: `Guest ${guest_id} not found` });

  const id = await nextSpaId('PUR-');
  const { data, error } = await supabaseAdmin
    .from('spa_package_purchases')
    .insert({
      id,
      package_id: packageId,
      guest_id,
      guest_name: guest.name,
      amount_paid: amount_paid ?? pkg.price,
      sessions_used: 0,
      status: 'Active',
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Package sale reaches Billing & Payments as a Pending transaction.
  try {
    await createSpaTransaction({
      guest_id,
      guest_name: guest.name,
      description: `Package purchase — ${packageId} (${id})`,
      amount: Number(amount_paid ?? pkg.price) || 0,
      payment_method: 'Unpaid',
      status: 'Pending',
      property_id: data.property_id,
      source: 'package_purchase',
    });
  } catch (e) {
    console.error('Package purchase transaction failed:', e);
  }
  return res.status(201).json(data);
});

// PATCH /api/spa-wellness/purchases/:id — update status, or redeem a session
// via { redeem: true } (increments sessions_used, auto-completes at capacity).
router.patch('/purchases/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, sessions_used, notes, redeem } = req.body;
  if (status && !PURCHASE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${PURCHASE_STATUSES.join(', ')}` });
  }

  const { data: purchase } = await supabaseAdmin
    .from('spa_package_purchases').select('*, spa_wellness_packages(sessions)').eq('id', req.params.id).single();
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (sessions_used !== undefined) updates.sessions_used = sessions_used;

  if (redeem) {
    if (purchase.status !== 'Active') {
      return res.status(409).json({ error: `Purchase is ${purchase.status.toLowerCase()} — cannot redeem` });
    }
    const totalSessions = purchase.spa_wellness_packages?.sessions ?? 1;
    const next = (purchase.sessions_used || 0) + 1;
    if (next > totalSessions) {
      return res.status(409).json({ error: 'All sessions already redeemed' });
    }
    updates.sessions_used = next;
    if (next >= totalSessions) updates.status = 'Redeemed';
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_package_purchases').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/purchases/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_package_purchases').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Retail Shop: products + sales ───────────────────────────────

const RETAIL_CATEGORIES = [
  'Skincare', 'Haircare', 'Massage Oils', 'Supplements', 'Wellness Products', 'Gift Items',
];
const RETAIL_PAYMENT_METHODS = ['Cash', 'Card', 'Room Charge'];

// GET /api/spa-wellness/retail/products?search=&category=&stock=&status=&propertyId=
// stock=low|in, status=active|inactive; includes live sold_this_month count.
router.get('/retail/products', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, category, stock, status } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_retail_products').select('*').order('name'),
    propertyId, req);
  if (category) q = q.eq('category', category);
  if (status === 'active') q = q.eq('is_active', true);
  if (status === 'inactive') q = q.eq('is_active', false);
  if (search) q = q.or(`name.ilike.%${orSearch(search)}%,sku.ilike.%${orSearch(search)}%,brand.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows: any[] = data || [];

  if (rows.length) {
    const ids = rows.map(r => r.id);
    const monthStart = new Date();
    monthStart.setDate(1);
    const { data: sales } = await supabaseAdmin
      .from('spa_retail_sales')
      .select('product_id, quantity')
      .in('product_id', ids)
      .gte('sale_date', monthStart.toISOString().slice(0, 10));
    const counts = new Map<string, number>();
    for (const s of sales || []) {
      counts.set(s.product_id, (counts.get(s.product_id) || 0) + (s.quantity || 1));
    }
    for (const r of rows) r.sold_this_month = counts.get(r.id) || 0;
  }

  if (stock === 'low') rows = rows.filter(r => r.stock <= r.min_stock);
  if (stock === 'in') rows = rows.filter(r => r.stock > r.min_stock);

  return res.json(rows);
});

router.post('/retail/products', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    name, category, sku, price, cost, stock, min_stock,
    description, brand, is_active, property_id, propertyId,
  } = req.body;

  if (!name || !category || !sku) {
    return res.status(400).json({ error: 'name, category and sku are required' });
  }
  if (!RETAIL_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${RETAIL_CATEGORIES.join(', ')}` });
  }

  const { data: dup } = await supabaseAdmin
    .from('spa_retail_products').select('id').eq('sku', sku).maybeSingle();
  if (dup) return res.status(409).json({ error: `SKU ${sku} already in use` });

  const id = await nextSpaId('RTL-');

  const { data, error } = await supabaseAdmin
    .from('spa_retail_products')
    .insert({
      id, name, category, sku,
      price: price ?? 0,
      cost: cost ?? 0,
      stock: stock ?? 0,
      min_stock: min_stock ?? 5,
      description: description || null,
      brand: brand || null,
      is_active: is_active ?? true,
      uinv_item_id: req.body.uinv_item_id || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const RETAIL_FIELDS = [
  'name', 'category', 'sku', 'price', 'cost', 'stock', 'min_stock',
  'description', 'brand', 'is_active', 'uinv_item_id',
];

router.patch('/retail/products/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.category && !RETAIL_CATEGORIES.includes(req.body.category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${RETAIL_CATEGORIES.join(', ')}` });
  }
  if (req.body.sku) {
    const { data: dup } = await supabaseAdmin
      .from('spa_retail_products').select('id').eq('sku', req.body.sku).neq('id', req.params.id).maybeSingle();
    if (dup) return res.status(409).json({ error: `SKU ${req.body.sku} already in use` });
  }
  // Restock shortcut: { adjust: +N } increments stock.
  if (req.body.adjust !== undefined) {
    const delta = Number(req.body.adjust);
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'adjust must be a non-zero integer' });
    }
    // Atomic via RPC — sell guards against going below zero.
    const rpc = delta > 0 ? 'spa_retail_restock' : 'spa_retail_sell';
    const { data: newStock, error: rpcErr } = await supabaseAdmin
      .rpc(rpc, { p_product_id: req.params.id, p_qty: Math.abs(delta) });
    if (rpcErr) return res.status(500).json({ error: rpcErr.message });
    if (newStock === null || newStock === undefined) {
      const { data: cur } = await supabaseAdmin
        .from('spa_retail_products').select('id').eq('id', req.params.id).maybeSingle();
      return res.status(cur ? 409 : 404).json({ error: cur ? 'Stock cannot go below zero' : 'Product not found' });
    }
    const { data, error } = await supabaseAdmin
      .from('spa_retail_products').select().eq('id', req.params.id).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of RETAIL_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_retail_products').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/retail/products/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_retail_products').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Retail sales ────────────────────────────────────────────────

/**
 * Mirror a retail stock movement into the unified inventory ledger when the
 * product is linked to a uinv item (spa_retail_products.uinv_item_id,
 * migration 495). Best-effort: retail stock stays authoritative, failures
 * are returned as a warning rather than failing the sale.
 */
async function recordRetailUinvMovement(opts: {
  itemId: string;
  qty: number;
  direction: 'out' | 'in';
  reference: string;
  performedBy?: string;
  propertyId?: string | null;
}): Promise<string | null> {
  try {
    const { data: balance } = await supabaseAdmin!
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', opts.itemId)
      .eq('store_id', SPA_STORE_ID)
      .is('location_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // No balance row → the linked item isn't stocked in the spa store; skip
    // silently rather than inventing balances.
    if (!balance) return null;

    const now = new Date().toISOString();
    const signed = opts.direction === 'out' ? -opts.qty : opts.qty;
    const newQty = Math.max(0, (Number(balance.on_hand) || 0) + signed);

    await supabaseAdmin!
      .from('uinv_stock_balances')
      .update({ on_hand: newQty, last_movement_date: now, updated_at: now })
      .eq('id', balance.id);

    const unitCost = Number(balance.unit_cost || 0);
    await supabaseAdmin!.from('uinv_stock_ledger').insert({
      property_id: opts.propertyId || null,
      item_id: opts.itemId,
      store_id: SPA_STORE_ID,
      transaction_type: opts.direction === 'out' ? 'Retail Sale' : 'Retail Void',
      reference: opts.reference,
      quantity_in: opts.direction === 'in' ? opts.qty : 0,
      quantity_out: opts.direction === 'out' ? opts.qty : 0,
      balance: newQty,
      unit_cost: unitCost,
      value: opts.qty * unitCost,
      performed_by: isUuid(opts.performedBy) ? opts.performedBy! : 'system',
      reason: opts.reference,
      transaction_date: now,
    });
    return null;
  } catch (e: any) {
    return e?.message || 'Unified-inventory ledger write failed';
  }
}

// GET /api/spa-wellness/retail/sales?productId=&propertyId=
router.get('/retail/sales', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { productId, propertyId } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_retail_sales').select('*').order('sale_date', { ascending: false }),
    propertyId, req);
  if (productId) q = q.eq('product_id', productId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/spa-wellness/retail/sales — record a sale; decrements stock.
router.post('/retail/sales', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    product_id, guest_id, quantity, unit_price, payment_method,
    sold_by, sale_date, room_number, property_id, propertyId,
  } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id is required' });
  const qty = Number(quantity) || 1;
  if (qty < 1) return res.status(400).json({ error: 'quantity must be >= 1' });
  if (payment_method && !RETAIL_PAYMENT_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: `Invalid payment_method. Must be one of: ${RETAIL_PAYMENT_METHODS.join(', ')}` });
  }
  if (payment_method === 'Room Charge' && !guest_id && !room_number) {
    return res.status(400).json({ error: 'Room Charge requires guest_id or room_number' });
  }

  const { data: product } = await supabaseAdmin
    .from('spa_retail_products').select('id, name, price, stock, is_active, uinv_item_id').eq('id', product_id).single();
  if (!product) return res.status(404).json({ error: `Product ${product_id} not found` });
  if (!product.is_active) return res.status(409).json({ error: 'Product is inactive' });

  let guestName: string | null = null;
  if (guest_id) {
    const { data: guest } = await supabaseAdmin
      .from('guests').select('name').eq('id', guest_id).single();
    if (!guest) return res.status(404).json({ error: `Guest ${guest_id} not found` });
    guestName = guest.name;
  }

  const price = unit_price ?? product.price;
  const saleTotal = price * qty;
  const saleId = await nextSpaId('SAL-');

  // Room Charge posts a real line to the guest's open folio before stock
  // moves — a failed post rejects the sale rather than stranding stock.
  let saleFolio: { folioId: string; lineId: string } | null = null;
  if (payment_method === 'Room Charge') {
    try {
      saleFolio = await postSpaChargeToFolio({
        guestId: guest_id,
        roomNumber: room_number,
        description: `Spa retail — ${product.name || product_id} ×${qty}`,
        amount: saleTotal,
        reference: saleId,
        user: req.user,
      });
    } catch (folioErr: any) {
      return res.status(502).json({ error: `Folio posting failed: ${folioErr.message}` });
    }
    if (!saleFolio) {
      return res.status(409).json({
        error: 'No open folio found for this guest/room — post to a checked-in reservation or choose another payment method',
      });
    }
  }

  // Atomic stock decrement — single UPDATE ... WHERE stock >= qty removes
  // the read-then-write oversell race (migration 494).
  const { data: newStock, error: stockErr } = await supabaseAdmin
    .rpc('spa_retail_sell', { p_product_id: product_id, p_qty: qty });
  if (stockErr) return res.status(500).json({ error: stockErr.message });
  if (newStock === null || newStock === undefined) {
    return res.status(409).json({ error: `Insufficient stock — only ${product.stock} left` });
  }

  const { data, error } = await supabaseAdmin
    .from('spa_retail_sales')
    .insert({
      id: saleId,
      product_id,
      guest_id: guest_id || null,
      guest_name: guestName,
      quantity: qty,
      unit_price: price,
      total: saleTotal,
      payment_method: payment_method || null,
      sold_by: sold_by || null,
      sale_date: sale_date || new Date().toISOString().slice(0, 10),
      folio_id: saleFolio?.folioId || null,
      folio_line_id: saleFolio?.lineId || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) {
    // Roll the stock back if the sale row failed to persist; void the
    // folio line too when a Room Charge was already posted.
    await supabaseAdmin.rpc('spa_retail_restock', { p_product_id: product_id, p_qty: qty });
    if (saleFolio) {
      try { await voidLine(saleFolio.lineId, `Spa retail sale ${saleId} failed to save`, req.user); }
      catch (e: any) { console.warn(`[spa] orphan folio line ${saleFolio.lineId} void failed:`, e?.message); }
    }
    return res.status(500).json({ error: error.message });
  }

  // Mirror the sale into Billing & Payments so retail revenue is visible
  // alongside appointment charges.
  try {
    await createSpaTransaction({
      guest_id: guest_id || null,
      guest_name: guestName,
      description: `Retail — ${product.name || product_id} ×${qty} (${saleId})`,
      amount: saleTotal,
      payment_method: payment_method === 'Room Charge' ? 'Guest Folio' : (payment_method || 'Cash'),
      status: 'Completed',
      property_id: boundPropertyId(req, property_id || propertyId),
      source: 'retail',
      folio_id: saleFolio?.folioId || null,
      folio_line_id: saleFolio?.lineId || null,
    });
  } catch (txnErr) {
    console.error('Retail sale transaction mirror failed:', txnErr);
  }

  const propId = boundPropertyId(req, property_id || propertyId);
  let uinvWarning: string | null = null;
  if (product.uinv_item_id) {
    uinvWarning = await recordRetailUinvMovement({
      itemId: product.uinv_item_id,
      qty,
      direction: 'out',
      reference: `Spa retail sale ${saleId}`,
      performedBy: req.user?.id,
      propertyId: propId,
    });
  }

  return res.status(201).json(uinvWarning ? { ...data, warnings: [uinvWarning] } : data);
});

// DELETE /api/spa-wellness/retail/sales/:id — void a sale; restores stock.
router.delete('/retail/sales/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: sale } = await supabaseAdmin
    .from('spa_retail_sales')
    .select('product_id, quantity, property_id, folio_line_id')
    .eq('id', req.params.id)
    .single();
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  // Void the folio line first — once the sale row is gone the linkage is lost.
  if (sale.folio_line_id) {
    try {
      await voidLine(sale.folio_line_id, `Spa retail sale ${req.params.id} voided`, req.user);
    } catch (e: any) {
      return res.status(502).json({ error: `Cannot void sale — folio line void failed: ${e.message}` });
    }
  }

  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_retail_sales').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin
    .rpc('spa_retail_restock', { p_product_id: sale.product_id, p_qty: sale.quantity || 1 });

  const { data: product } = await supabaseAdmin
    .from('spa_retail_products').select('uinv_item_id').eq('id', sale.product_id).maybeSingle();
  if (product?.uinv_item_id) {
    await recordRetailUinvMovement({
      itemId: product.uinv_item_id,
      qty: sale.quantity || 1,
      direction: 'in',
      reference: `Spa retail void ${req.params.id}`,
      performedBy: req.user?.id,
      propertyId: sale.property_id,
    });
  }
  return res.json({ success: true });
});

// ── Fitness Center equipment bookings (migration 494) ───────────
// Backs the Fitness Center module — equipment reservations persisted in
// spa_equipment_bookings. Trainers live in Therapist Management and group
// classes in Wellness Programs.

const EQUIPMENT_STATUSES = ['Confirmed', 'In Use', 'Completed', 'Cancelled', 'No Show'];

// GET /api/spa-wellness/equipment-bookings?date=&equipment=&status=&propertyId=
router.get('/equipment-bookings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, equipment, status, propertyId } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin
      .from('spa_equipment_bookings')
      .select('*')
      .order('booking_date', { ascending: false })
      .order('start_time'),
    propertyId, req);
  if (date) q = q.eq('booking_date', date);
  if (equipment) q = q.eq('equipment', equipment);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/equipment-bookings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    equipment, guest_id, guest_name, booking_date, start_time,
    duration_minutes, notes, property_id, propertyId,
  } = req.body;
  if (!equipment || !guest_name || !booking_date || !start_time) {
    return res.status(400).json({ error: 'equipment, guest_name, booking_date and start_time are required' });
  }
  if (guest_id) {
    const { data: g } = await supabaseAdmin.from('guests').select('id').eq('id', guest_id).maybeSingle();
    if (!g) return res.status(404).json({ error: `Guest ${guest_id} not found` });
  }

  // Overlap check — same equipment, same date, intersecting time slot.
  const start = timeToMin(start_time);
  if (start === null) return res.status(400).json({ error: `Invalid start_time "${start_time}"` });
  const end = start + (Number(duration_minutes) || 30);
  const { data: sameDay } = await supabaseAdmin
    .from('spa_equipment_bookings')
    .select('id, guest_name, start_time, duration_minutes')
    .eq('equipment', equipment)
    .eq('booking_date', booking_date)
    .in('status', ['Confirmed', 'In Use']);
  for (const b of sameDay || []) {
    const bStart = timeToMin(b.start_time);
    if (bStart === null) continue;
    if (start < bStart + (Number(b.duration_minutes) || 30) && bStart < end) {
      return res.status(409).json({
        error: `Equipment already booked at ${b.start_time} (${b.id} — ${b.guest_name})`,
      });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('spa_equipment_bookings')
    .insert({
      id: await nextSpaId('EQB-'),
      equipment,
      guest_id: guest_id || null,
      guest_name,
      booking_date,
      start_time,
      duration_minutes: Number(duration_minutes) || 30,
      status: 'Confirmed',
      notes: notes || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const EQUIPMENT_FIELDS = [
  'equipment', 'guest_id', 'guest_name', 'booking_date', 'start_time',
  'duration_minutes', 'status', 'notes',
];

router.patch('/equipment-bookings/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.status && !EQUIPMENT_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${EQUIPMENT_STATUSES.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of EQUIPMENT_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_equipment_bookings').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Booking not found' });
  return res.json(data);
});

router.delete('/equipment-bookings/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_equipment_bookings').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Waitlist (migration 496) ──────────────────────────────────────────────
// Guests register interest for fully-booked slots; a cancelled appointment on
// the same date auto-flags matching rows 'Notified' for staff follow-up.

const WAITLIST_STATUSES = ['Waiting', 'Notified', 'Booked', 'Cancelled', 'Expired'];

// GET /api/spa-wellness/waitlist?date=&status=&propertyId=
router.get('/waitlist', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, status, propertyId } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin
      .from('spa_waitlist')
      .select('*')
      .order('preferred_date')
      .order('created_at'),
    propertyId, req);
  if (date) q = q.eq('preferred_date', date);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/waitlist', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    guest_id, guest_name, contact, treatment_id, therapist_id,
    preferred_date, preferred_time, notes, property_id, propertyId,
  } = req.body;
  if (!guest_name || !preferred_date) {
    return res.status(400).json({ error: 'guest_name and preferred_date are required' });
  }
  if (preferred_time && timeToMin(preferred_time) === null) {
    return res.status(400).json({ error: 'preferred_time must be HH:MM' });
  }

  let treatmentName: string | null = null;
  if (treatment_id) {
    const { data: t } = await supabaseAdmin
      .from('spa_treatments').select('name').eq('id', treatment_id).maybeSingle();
    if (!t) return res.status(404).json({ error: `Treatment ${treatment_id} not found` });
    treatmentName = t.name;
  }

  const { data, error } = await supabaseAdmin
    .from('spa_waitlist')
    .insert({
      id: await nextSpaId('WLT-'),
      guest_id: guest_id || null,
      guest_name,
      contact: contact || null,
      treatment_id: treatment_id || null,
      treatment: treatmentName || 'Any treatment',
      therapist_id: therapist_id || null,
      preferred_date,
      preferred_time: preferred_time || null,
      status: 'Waiting',
      notes: notes || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const WAITLIST_FIELDS = [
  'guest_id', 'guest_name', 'contact', 'treatment_id', 'treatment',
  'therapist_id', 'preferred_date', 'preferred_time', 'status',
  'booked_appointment_id', 'notes',
];

router.patch('/waitlist/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.status && !WAITLIST_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${WAITLIST_STATUSES.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of WAITLIST_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_waitlist').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Waitlist entry not found' });
  return res.json(data);
});

router.delete('/waitlist/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_waitlist').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// POST /api/spa-wellness/maintenance/run — manually invoke the daily
// maintenance job (membership renewal/expiry, gift-card + package expiry).
// Normally scheduled via pg_cron; this endpoint is the fallback trigger.
router.post('/maintenance/run', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.rpc('spa_daily_maintenance');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Gift Cards & Vouchers ───────────────────────────────────────

const CARD_TYPES = ['Spa Gift Card', 'Treatment Voucher', 'Promotional Coupon', 'Membership Credit'];
const CARD_STATUSES = ['Active', 'Redeemed', 'Expired', 'Suspended'];

// GET /api/spa-wellness/gift-cards?search=&status=&type=&propertyId=
router.get('/gift-cards', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, status, type } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_gift_cards').select('*').order('issue_date', { ascending: false }),
    propertyId, req);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('card_type', type);
  if (search) q = q.or(`code.ilike.%${orSearch(search)}%,purchaser_name.ilike.%${orSearch(search)}%,recipient_name.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/gift-cards', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    card_type, code, value, purchaser_id, recipient_id, recipient_name,
    issue_date, expiry_date, applicable_treatments, notes,
    property_id, propertyId,
  } = req.body;

  if (!card_type || value == null) {
    return res.status(400).json({ error: 'card_type and value are required' });
  }
  if (!CARD_TYPES.includes(card_type)) {
    return res.status(400).json({ error: `Invalid card_type. Must be one of: ${CARD_TYPES.join(', ')}` });
  }
  if (Number(value) <= 0) return res.status(400).json({ error: 'value must be > 0' });

  let purchaserName: string | null = null;
  if (purchaser_id) {
    const { data: g } = await supabaseAdmin.from('guests').select('name').eq('id', purchaser_id).single();
    if (!g) return res.status(404).json({ error: `Guest ${purchaser_id} not found` });
    purchaserName = g.name;
  }
  let resolvedRecipient = recipient_name || null;
  if (recipient_id) {
    const { data: g } = await supabaseAdmin.from('guests').select('name').eq('id', recipient_id).single();
    if (!g) return res.status(404).json({ error: `Guest ${recipient_id} not found` });
    resolvedRecipient = g.name;
  }

  const id = await nextSpaId('GFT-');
  const autoCode = `SPA-${card_type.split(' ')[0].toUpperCase()}-${new Date().getFullYear()}-${id.replace('GFT-', '')}`;

  if (code) {
    const { data: dup } = await supabaseAdmin
      .from('spa_gift_cards').select('id').eq('code', code).maybeSingle();
    if (dup) return res.status(409).json({ error: `Code ${code} already in use` });
  }

  const { data, error } = await supabaseAdmin
    .from('spa_gift_cards')
    .insert({
      id,
      card_type,
      code: code || autoCode,
      value: Number(value),
      remaining_balance: Number(value),
      status: 'Active',
      purchaser_id: purchaser_id || null,
      purchaser_name: purchaserName || req.body.purchaser_name || null,
      recipient_id: recipient_id || null,
      recipient_name: resolvedRecipient,
      issue_date: issue_date || new Date().toISOString().slice(0, 10),
      expiry_date: expiry_date || null,
      applicable_treatments: applicable_treatments || ['All Services'],
      notes: notes || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Gift-card sale is revenue — record a Pending transaction so it reaches
  // Billing & Payments (and the spaRevenue KPI once settled).
  try {
    await createSpaTransaction({
      guest_id: purchaser_id || null,
      guest_name: purchaserName || req.body.purchaser_name || null,
      description: `Gift card sale — ${card_type} (${code || autoCode})`,
      amount: Number(value),
      payment_method: req.body.sale_payment_method || 'Unpaid',
      status: 'Pending',
      property_id: data.property_id,
      source: 'gift_card_sale',
    });
  } catch (e) {
    console.error('Gift-card sale transaction failed:', e);
  }

  return res.status(201).json(data);
});

const CARD_FIELDS = [
  'card_type', 'code', 'status', 'recipient_id', 'recipient_name',
  'expiry_date', 'applicable_treatments', 'notes',
];

// PATCH /api/spa-wellness/gift-cards/:id — field updates, plus
// { redeem: <amount> } to deduct balance (auto-Redeemed at zero).
router.patch('/gift-cards/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.card_type && !CARD_TYPES.includes(req.body.card_type)) {
    return res.status(400).json({ error: `Invalid card_type. Must be one of: ${CARD_TYPES.join(', ')}` });
  }
  if (req.body.status && !CARD_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${CARD_STATUSES.join(', ')}` });
  }

  const { data: card } = await supabaseAdmin
    .from('spa_gift_cards').select('*').eq('id', req.params.id).single();
  if (!card) return res.status(404).json({ error: 'Gift card not found' });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of CARD_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  if (req.body.redeem !== undefined) {
    const amount = Number(req.body.redeem);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'redeem amount must be > 0' });
    }
    if (card.status !== 'Active') {
      return res.status(409).json({ error: `Card is ${card.status.toLowerCase()} — cannot redeem` });
    }
    if (card.expiry_date && new Date(card.expiry_date) < new Date()) {
      return res.status(409).json({ error: 'Card is past its expiry date' });
    }
    if (amount > Number(card.remaining_balance)) {
      return res.status(409).json({ error: `Insufficient balance — only $${card.remaining_balance} left` });
    }
    const next = Number(card.remaining_balance) - amount;
    updates.remaining_balance = next;
    if (next <= 0) {
      updates.status = 'Redeemed';
      updates.redeemed_at = new Date().toISOString();
    }

    // Ledger entry — redemptions were previously untracked (migration 494).
    await supabaseAdmin.from('spa_gift_card_redemptions').insert({
      id: await nextSpaId('GCR-'),
      card_id: card.id,
      amount,
      appointment_id: req.body.appointment_id || null,
      transaction_id: req.body.transaction_id || null,
      redeemed_by: req.user?.name || req.user?.id || null,
      notes: req.body.redemption_notes || null,
      property_id: card.property_id || null,
    });
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_gift_cards').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// GET /api/spa-wellness/gift-cards/:id/redemptions — redemption ledger.
router.get('/gift-cards/:id/redemptions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await scopeProperty(supabaseAdmin
    .from('spa_gift_card_redemptions')
    .select('*')
    .eq('card_id', req.params.id)
    .order('created_at', { ascending: false }), undefined, req);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.delete('/gift-cards/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_gift_cards').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Billing & Payments ──────────────────────────────────────────

const TXN_PAYMENT_METHODS = [
  'Guest Folio', 'Credit/Debit Card', 'Mobile Wallet', 'Cash',
  'Corporate Billing', 'Gift Voucher', 'Membership Credit', 'Unpaid',
];
const TXN_STATUSES = ['Pending', 'Completed', 'Refunded', 'Failed'];

// GET /api/spa-wellness/transactions?search=&status=&method=&dateFrom=&dateTo=&propertyId=
// Returns { transactions, summary } — summary aggregates for the KPI strip.
router.get('/transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, status, method, dateFrom, dateTo } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_transactions').select('*').order('transaction_date', { ascending: false }),
    propertyId, req);
  if (status) q = q.eq('status', status);
  if (method) q = q.eq('payment_method', method);
  if (dateFrom) q = q.gte('transaction_date', dateFrom);
  if (dateTo) q = q.lte('transaction_date', dateTo);
  if (search) q = q.or(`guest_name.ilike.%${orSearch(search)}%,description.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%,room_number.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows: any[] = data || [];

  const summary = {
    revenue: rows.filter(t => t.status === 'Completed').reduce((n, t) => n + Number(t.total || 0), 0),
    pending: rows.filter(t => t.status === 'Pending').reduce((n, t) => n + Number(t.total || 0), 0),
    refunded: rows.filter(t => t.status === 'Refunded').reduce((n, t) => n + Number(t.total || 0), 0),
    count: rows.length,
  };

  return res.json({ transactions: rows, summary });
});

router.post('/transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    guest_id, appointment_id, therapist_id, description, amount, tax,
    service_charge, tip, payment_method, status, transaction_date,
    room_number, source, property_id, propertyId,
  } = req.body;

  if (!description || !payment_method) {
    return res.status(400).json({ error: 'description and payment_method are required' });
  }
  if (!TXN_PAYMENT_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: `Invalid payment_method. Must be one of: ${TXN_PAYMENT_METHODS.join(', ')}` });
  }
  if (status && !TXN_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${TXN_STATUSES.join(', ')}` });
  }

  let guestName: string | null = null;
  if (guest_id) {
    const { data: g } = await supabaseAdmin.from('guests').select('name').eq('id', guest_id).single();
    if (!g) return res.status(404).json({ error: `Guest ${guest_id} not found` });
    guestName = g.name;
  }
  if (appointment_id) {
    const { data: apt } = await supabaseAdmin
      .from('spa_appointments').select('id').eq('id', appointment_id).maybeSingle();
    if (!apt) return res.status(404).json({ error: `Appointment ${appointment_id} not found` });
  }
  if (therapist_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('id').eq('id', therapist_id).maybeSingle();
    if (!th) return res.status(404).json({ error: `Therapist ${therapist_id} not found` });
  }

  const amt = Number(amount) || 0;
  const tx = Number(tax) || 0;
  const sc = Number(service_charge) || 0;
  const tp = Number(tip) || 0;
  const grandTotal = amt + tx + sc + tp;

  // Guest Folio charges post a real line to the guest's open folio.
  let folio: { folioId: string; lineId: string } | null = null;
  if (payment_method === 'Guest Folio') {
    try {
      folio = await postSpaChargeToFolio({
        guestId: guest_id,
        roomNumber: room_number,
        description: `Spa — ${description}`,
        amount: grandTotal,
        taxAmount: tx,
        reference: 'spa-transaction',
        user: req.user,
      });
    } catch (folioErr: any) {
      return res.status(502).json({ error: `Folio posting failed: ${folioErr.message}` });
    }
    if (!folio) {
      return res.status(409).json({
        error: 'No open folio found for this guest/room — post to a checked-in reservation or choose another payment method',
      });
    }
  }

  // ── Gift Voucher payment: validate and debit the card ─────────────
  // Requires gift_card_code (or gift_card_id); the card must be Active,
  // unexpired, and carry enough balance for the grand total.
  let giftCard: any = null;
  if (payment_method === 'Gift Voucher') {
    const cardRef = req.body.gift_card_code || req.body.gift_card_id;
    if (!cardRef) {
      return res.status(400).json({ error: 'gift_card_code (or gift_card_id) is required for Gift Voucher payments' });
    }
    const { data: card } = await supabaseAdmin
      .from('spa_gift_cards')
      .select('id, code, remaining_balance, status, expiry_date')
      .or(`id.eq.${cardRef},code.eq.${cardRef}`)
      .maybeSingle();
    if (!card) return res.status(404).json({ error: `Gift card ${cardRef} not found` });
    if (card.status !== 'Active') return res.status(409).json({ error: `Gift card ${card.code} is ${card.status}` });
    if (card.expiry_date && card.expiry_date < new Date().toISOString().slice(0, 10)) {
      return res.status(409).json({ error: `Gift card ${card.code} expired on ${card.expiry_date}` });
    }
    if (Number(card.remaining_balance) < grandTotal) {
      return res.status(409).json({ error: `Insufficient gift-card balance — ${card.code} has $${Number(card.remaining_balance).toFixed(2)}` });
    }
    giftCard = card;
  }

  // ── Membership Credit payment: charge against the member's visits ──
  // Requires guest_id; resolves the guest's active membership and consumes
  // one visit when the plan is visit-limited (NULL = unlimited).
  let membership: any = null;
  if (payment_method === 'Membership Credit') {
    if (!guest_id) {
      return res.status(400).json({ error: 'guest_id is required for Membership Credit payments' });
    }
    const { data: m } = await supabaseAdmin
      .from('spa_memberships')
      .select('id, status, visits_remaining, end_date')
      .eq('guest_id', guest_id)
      .eq('status', 'Active')
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!m) return res.status(409).json({ error: 'Guest has no active membership' });
    if (m.end_date && m.end_date < new Date().toISOString().slice(0, 10)) {
      return res.status(409).json({ error: `Membership ${m.id} ended on ${m.end_date}` });
    }
    if (m.visits_remaining !== null && m.visits_remaining <= 0) {
      return res.status(409).json({ error: `Membership ${m.id} has no visits remaining` });
    }
    membership = m;
  }

  const id = await nextSpaId('TXN-');

  const { data, error } = await supabaseAdmin
    .from('spa_transactions')
    .insert({
      id,
      guest_id: guest_id || null,
      guest_name: guestName,
      appointment_id: appointment_id || null,
      therapist_id: therapist_id || null,
      description,
      amount: amt,
      tax: tx,
      service_charge: sc,
      tip: tp,
      total: grandTotal,
      payment_method,
      status: status || 'Pending',
      transaction_date: transaction_date || new Date().toISOString().slice(0, 10),
      room_number: room_number || null,
      folio_id: folio?.folioId || null,
      folio_line_id: folio?.lineId || null,
      gift_card_id: giftCard?.id || null,
      membership_id: membership?.id || null,
      source: source || 'manual',
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Debit the backing instrument now that the charge row persisted.
  if (giftCard) {
    const newBalance = Math.round((Number(giftCard.remaining_balance) - grandTotal) * 100) / 100;
    // Guard on the balance we validated — if it moved concurrently the
    // update matches no row and the charge is marked Failed, not debited.
    const { data: debited } = await scopeRowWrite(supabaseAdmin
      .from('spa_gift_cards')
      .update({
        remaining_balance: newBalance,
        status: newBalance <= 0 ? 'Redeemed' : 'Active',
        redeemed_at: newBalance <= 0 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }), req)
      .eq('id', giftCard.id)
      .eq('remaining_balance', giftCard.remaining_balance)
      .select('id')
      .maybeSingle();
    if (!debited) {
      await scopeRowWrite(supabaseAdmin.from('spa_transactions').update({ status: 'Failed' }), req).eq('id', id);
      return res.status(409).json({ error: 'Gift-card balance changed while processing — please retry' });
    }
    await supabaseAdmin.from('spa_gift_card_redemptions').insert({
      id: await nextSpaId('GCR-'),
      card_id: giftCard.id,
      amount: grandTotal,
      appointment_id: appointment_id || null,
      transaction_id: id,
      redeemed_by: req.user?.name || req.user?.id || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    });
  }
  if (membership && membership.visits_remaining !== null) {
    await scopeRowWrite(supabaseAdmin
      .from('spa_memberships')
      .update({
        visits_remaining: membership.visits_remaining - 1,
        updated_at: new Date().toISOString(),
      }), req)
      .eq('id', membership.id)
      .eq('visits_remaining', membership.visits_remaining);
  }

  return res.status(201).json(data);
});

const TXN_FIELDS = [
  'guest_id', 'guest_name', 'appointment_id', 'therapist_id', 'description',
  'amount', 'tax', 'service_charge', 'tip', 'payment_method', 'status',
  'transaction_date', 'room_number',
];

// Terminal transaction states that block mutation unless refunding.
const TXN_TERMINAL = new Set(['Completed', 'Refunded', 'Failed']);

router.patch('/transactions/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.payment_method && !TXN_PAYMENT_METHODS.includes(req.body.payment_method)) {
    return res.status(400).json({ error: `Invalid payment_method. Must be one of: ${TXN_PAYMENT_METHODS.join(', ')}` });
  }
  if (req.body.status && !TXN_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${TXN_STATUSES.join(', ')}` });
  }

  const { data: current } = await supabaseAdmin
    .from('spa_transactions').select('*').eq('id', req.params.id).maybeSingle();
  if (!current) return res.status(404).json({ error: 'Transaction not found' });

  const wantsRefund = req.body.status === 'Refunded' && current.status !== 'Refunded';
  const changesMoney = ['amount', 'tax', 'service_charge', 'tip', 'payment_method', 'guest_id', 'appointment_id']
    .some(f => req.body[f] !== undefined);

  // Completed/Refunded/Failed transactions are immutable except for the
  // Completed → Refunded transition (financial audit trail).
  if (TXN_TERMINAL.has(current.status) && !wantsRefund) {
    return res.status(409).json({
      error: `Transaction is ${current.status} — only a refund transition is allowed`,
    });
  }
  if (wantsRefund && current.status !== 'Completed') {
    return res.status(409).json({ error: `Only Completed transactions can be refunded (current: ${current.status})` });
  }
  if (wantsRefund && changesMoney) {
    return res.status(400).json({ error: 'Cannot change amounts while refunding' });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of TXN_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  // Settling a charge to Guest Folio posts a real line to the open folio —
  // covers Pending 'Unpaid' appointment charges collected at checkout.
  const nextStatus = updates.status ?? current.status;
  const nextMethod = updates.payment_method ?? current.payment_method;
  if (nextStatus === 'Completed' && nextMethod === 'Guest Folio' && !current.folio_line_id) {
    const guestId = updates.guest_id ?? current.guest_id;
    const roomNumber = updates.room_number ?? current.room_number;
    const total =
      Number(updates.amount ?? current.amount) +
      Number(updates.tax ?? current.tax) +
      Number(updates.service_charge ?? current.service_charge) +
      Number(updates.tip ?? current.tip);
    try {
      const folio = await postSpaChargeToFolio({
        guestId,
        roomNumber,
        description: `Spa — ${updates.description ?? current.description}`,
        amount: total,
        taxAmount: Number(updates.tax ?? current.tax) || 0,
        reference: current.id,
        user: req.user,
      });
      if (!folio) {
        return res.status(409).json({
          error: 'No open folio found for this guest/room — check the guest in first or choose another payment method',
        });
      }
      updates.folio_id = folio.folioId;
      updates.folio_line_id = folio.lineId;
    } catch (folioErr: any) {
      return res.status(502).json({ error: `Folio posting failed: ${folioErr.message}` });
    }
  }

  if (wantsRefund) {
    updates.refunded_at = new Date().toISOString();
    if (req.body.refund_reason !== undefined) updates.refund_reason = req.body.refund_reason;
    // Void the folio line if this charge was posted to a guest folio.
    if (current.folio_line_id) {
      try {
        await voidLine(current.folio_line_id, req.body.refund_reason || `Spa transaction ${current.id} refund`, req.user);
      } catch (e: any) {
        console.warn(`[spa] folio line void failed for ${current.folio_line_id}:`, e?.message);
      }
    }
    // Restore the backing instrument for instrument-paid charges:
    // re-credit the gift card, give the member their visit back.
    if (current.gift_card_id) {
      const { data: card } = await supabaseAdmin
        .from('spa_gift_cards')
        .select('id, remaining_balance')
        .eq('id', current.gift_card_id)
        .maybeSingle();
      if (card) {
        await scopeRowWrite(supabaseAdmin
          .from('spa_gift_cards')
          .update({
            remaining_balance: Math.round((Number(card.remaining_balance) + Number(current.total)) * 100) / 100,
            status: 'Active',
            redeemed_at: null,
            updated_at: new Date().toISOString(),
          }), req)
          .eq('id', card.id);
      }
    }
    if (current.membership_id) {
      const { data: m } = await supabaseAdmin
        .from('spa_memberships')
        .select('id, visits_remaining')
        .eq('id', current.membership_id)
        .maybeSingle();
      if (m && m.visits_remaining !== null) {
        await scopeRowWrite(supabaseAdmin
          .from('spa_memberships')
          .update({ visits_remaining: m.visits_remaining + 1, updated_at: new Date().toISOString() }), req)
          .eq('id', m.id);
      }
    }
  }

  // Recompute total whenever a money field changes.
  const moneyChanged = ['amount', 'tax', 'service_charge', 'tip'].some(f => req.body[f] !== undefined);
  if (moneyChanged) {
    updates.total =
      Number(updates.amount ?? current.amount) +
      Number(updates.tax ?? current.tax) +
      Number(updates.service_charge ?? current.service_charge) +
      Number(updates.tip ?? current.tip);
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_transactions').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/transactions/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: txn } = await supabaseAdmin
    .from('spa_transactions').select('status').eq('id', req.params.id).maybeSingle();
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  if (TXN_TERMINAL.has(txn.status)) {
    return res.status(409).json({ error: `Cannot delete a ${txn.status} transaction — refund it instead` });
  }
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_transactions').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Communication Center ────────────────────────────────────────

const COMM_TYPES = ['SMS', 'Email', 'Push Notification'];
const COMM_CATEGORIES = [
  'Appointment Reminder', 'Wellness Tips', 'Promotional Campaign',
  'Membership Notice', 'Service Update',
];
const COMM_STATUSES = ['Sent', 'Delivered', 'Opened', 'Failed', 'Scheduled', 'Cancelled'];

// GET /api/spa-wellness/communications?search=&status=&type=&category=&propertyId=
router.get('/communications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, search, status, type, category } = req.query as Record<string, string>;

  let q = scopeProperty(
    supabaseAdmin.from('spa_communications').select('*').order('sent_at', { ascending: false, nullsFirst: false }),
    propertyId, req);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('comm_type', type);
  if (category) q = q.eq('category', category);
  if (search) q = q.or(`recipient_name.ilike.%${orSearch(search)}%,message.ilike.%${orSearch(search)}%,subject.ilike.%${orSearch(search)}%,id.ilike.%${orSearch(search)}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/communications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    comm_type, recipient_id, recipient_name, subject, message, category,
    scheduled_for, property_id, propertyId,
  } = req.body;

  if (!comm_type || !message || !category) {
    return res.status(400).json({ error: 'comm_type, message and category are required' });
  }
  if (!COMM_TYPES.includes(comm_type)) {
    return res.status(400).json({ error: `Invalid comm_type. Must be one of: ${COMM_TYPES.join(', ')}` });
  }
  if (!COMM_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${COMM_CATEGORIES.join(', ')}` });
  }

  // Resolve recipient: specific guest or a broadcast label.
  let resolvedRecipient = recipient_name || null;
  if (recipient_id) {
    const { data: g } = await supabaseAdmin.from('guests').select('name').eq('id', recipient_id).single();
    if (!g) return res.status(404).json({ error: `Guest ${recipient_id} not found` });
    resolvedRecipient = g.name;
  }
  if (!resolvedRecipient) return res.status(400).json({ error: 'recipient_id or recipient_name is required' });

  const id = await nextSpaId('COM-');

  const isScheduled = !!scheduled_for;
  const comm = {
    comm_type,
    recipient_id: recipient_id || null,
    recipient_name: resolvedRecipient,
    subject: subject || null,
    message,
    property_id: boundPropertyId(req, property_id || propertyId),
  };

  // Immediate sends dispatch now; scheduled rows wait for the sweep.
  let sentStatus = 'Scheduled';
  let failureReason: string | null = null;
  if (!isScheduled) {
    const outcome = await dispatchComm(comm);
    sentStatus = outcome.status;
    failureReason = outcome.failure_reason ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from('spa_communications')
    .insert({
      id,
      ...comm,
      category,
      status: sentStatus,
      failure_reason: failureReason,
      sent_at: isScheduled ? null : new Date().toISOString(),
      scheduled_for: scheduled_for || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

const COMM_FIELDS = ['comm_type', 'subject', 'message', 'category', 'scheduled_for', 'status'];

// PATCH /api/spa-wellness/communications/:id — field updates, plus
// { send: true } to dispatch a Scheduled message now.
router.patch('/communications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.comm_type && !COMM_TYPES.includes(req.body.comm_type)) {
    return res.status(400).json({ error: `Invalid comm_type. Must be one of: ${COMM_TYPES.join(', ')}` });
  }
  if (req.body.category && !COMM_CATEGORIES.includes(req.body.category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${COMM_CATEGORIES.join(', ')}` });
  }
  if (req.body.status && !COMM_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${COMM_STATUSES.join(', ')}` });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of COMM_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  // Cancelling a Scheduled send must not also be re-dispatched by send:true.
  if (updates.status === 'Cancelled' && req.body.send) {
    return res.status(400).json({ error: 'Cannot cancel and send in the same request' });
  }

  if (req.body.send) {
    const { data: comm } = await supabaseAdmin
      .from('spa_communications').select('*').eq('id', req.params.id).single();
    if (!comm) return res.status(404).json({ error: 'Communication not found' });
    if (comm.status !== 'Scheduled' && comm.status !== 'Failed') {
      return res.status(409).json({ error: 'Only Scheduled or Failed messages can be sent' });
    }
    const outcome = await dispatchComm(comm);
    updates.status = outcome.status;
    updates.failure_reason = outcome.failure_reason ?? null;
    updates.sent_at = new Date().toISOString();
    updates.scheduled_for = null;
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_communications').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// POST /api/spa-wellness/communications/dispatch-due — send every Scheduled
// message whose scheduled_for has passed. Called by the scheduler job (or
// manually) to process the queue.
router.post('/communications/dispatch-due', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const results = await dispatchDueCommunications();
    return res.json({ dispatched: results.length, results });
  } catch (e: any) {
    return res.status(e instanceof SpaError ? e.status : 500).json({ error: e.message });
  }
});

router.delete('/communications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_communications').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Spa Reports Registry (mirrors hk_reports pattern, migration 486) ──
//   - GET  /reports           list reports (optional ?category=, ?propertyId=)
//   - GET  /reports/stats     aggregated KPI counts
//   - GET  /reports/:id       fetch a single report
//   - POST /reports/:id/run   re-run a single report (status Ready + last_run = now)
//   - POST /reports/run-all   queue all reports for refresh
//   - PATCH /reports/:id      update frequency / format / status

const SPA_REPORT_CATEGORIES = ['operational', 'financial', 'inventory', 'performance', 'executive'] as const;
const SPA_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const SPA_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

const SPA_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, property_id, updated_at';

/**
 * Execute the actual data query behind a report and return a JSON result
 * ({ generated_at, summary, rows }). Each seeded report id maps to a
 * generator; unknown ids get a generic category-level summary.
 */
async function generateSpaReport(reportId: string, propertyId?: string): Promise<any> {
  const db = supabaseAdmin!;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prop = propertyId && isUuid(propertyId) ? propertyId : null;
  const scope = (q: any) => (prop ? q.or(`property_id.is.null,property_id.eq.${prop}`) : q);
  const generated_at = new Date().toISOString();

  switch (reportId) {
    case 'spa-daily-appointment': {
      const { data } = await scope(db.from('spa_appointments').select('*').eq('appointment_date', today));
      const rows = data || [];
      const byStatus: Record<string, number> = {};
      for (const a of rows) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      return { generated_at, period: today, summary: { total: rows.length, byStatus }, rows };
    }
    case 'spa-therapist-schedule': {
      const { data } = await scope(
        db.from('spa_appointments').select('id, therapist_id, therapist, guest_name, treatment, start_time, duration_minutes, status').eq('appointment_date', today)
      );
      const byTherapist: Record<string, any[]> = {};
      for (const a of data || []) (byTherapist[a.therapist || 'Unassigned'] ??= []).push(a);
      return { generated_at, period: today, summary: { therapistsBooked: Object.keys(byTherapist).length }, rows: byTherapist };
    }
    case 'spa-room-utilization': {
      const { data: rooms } = await scope(db.from('spa_rooms').select('id, name, is_bookable'));
      const { data: appts } = await scope(db.from('spa_appointments').select('room_id, duration_minutes, status').gte('appointment_date', monthStart).in('status', SLOT_ACTIVE));
      const usage: Record<string, { bookings: number; minutes: number }> = {};
      for (const a of appts || []) {
        const k = a.room_id || 'unassigned';
        usage[k] = usage[k] || { bookings: 0, minutes: 0 };
        usage[k].bookings++; usage[k].minutes += Number(a.duration_minutes) || 0;
      }
      const rows = (rooms || []).map((r: any) => ({
        room: r.name, room_id: r.id, bookable: r.is_bookable,
        bookings: usage[r.id]?.bookings || 0, minutes_used: usage[r.id]?.minutes || 0,
      }));
      return { generated_at, period: monthStart, summary: { rooms: rows.length }, rows };
    }
    case 'spa-attendance-report': {
      const { data } = await scope(db.from('spa_program_enrollments').select('*'));
      const rows = data || [];
      const byStatus: Record<string, number> = {};
      for (const e of rows) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      return { generated_at, summary: { enrollments: rows.length, byStatus }, rows };
    }
    case 'spa-cancellation-report': {
      const { data } = await scope(
        db.from('spa_appointments').select('*').in('status', ['Cancelled', 'No Show']).gte('appointment_date', monthStart)
      );
      const rows = data || [];
      return { generated_at, period: monthStart, summary: { cancellations: rows.length, lostRevenue: rows.reduce((s: number, a: any) => s + Number(a.amount || 0), 0) }, rows };
    }
    case 'spa-revenue':
    case 'spa-revenue-by-service': {
      const { data } = await scope(db.from('spa_transactions').select('*').eq('status', 'Completed').gte('transaction_date', monthStart));
      const rows = data || [];
      const byMethod: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      for (const t of rows) {
        byMethod[t.payment_method] = (byMethod[t.payment_method] || 0) + Number(t.total || 0);
        bySource[t.source || 'manual'] = (bySource[t.source || 'manual'] || 0) + Number(t.total || 0);
      }
      return { generated_at, period: monthStart, summary: { revenue: rows.reduce((s: number, t: any) => s + Number(t.total || 0), 0), transactions: rows.length, byMethod, bySource }, rows };
    }
    case 'spa-membership-revenue': {
      const { data: txns } = await scope(db.from('spa_transactions').select('*').eq('source', 'membership').gte('transaction_date', monthStart));
      const { data: mbrs } = await scope(db.from('spa_memberships').select('*'));
      return {
        generated_at, period: monthStart,
        summary: {
          membershipRevenue: (txns || []).filter((t: any) => t.status === 'Completed').reduce((s: number, t: any) => s + Number(t.total || 0), 0),
          activeMembers: (mbrs || []).filter((m: any) => m.status === 'Active').length,
        },
        rows: txns || [],
      };
    }
    case 'spa-package-revenue': {
      const { data: purchases } = await scope(db.from('spa_package_purchases').select('*').gte('purchase_date', monthStart));
      const rows = purchases || [];
      return { generated_at, period: monthStart, summary: { sold: rows.length, revenue: rows.reduce((s: number, p: any) => s + Number(p.amount_paid || 0), 0) }, rows };
    }
    case 'spa-retail-revenue':
    case 'spa-product-sales': {
      const { data } = await scope(db.from('spa_retail_sales').select('*, spa_retail_products(name, category)').gte('sale_date', monthStart));
      const rows = data || [];
      const byProduct: Record<string, { qty: number; revenue: number }> = {};
      for (const s of rows) {
        const k = s.spa_retail_products?.name || s.product_id;
        byProduct[k] = byProduct[k] || { qty: 0, revenue: 0 };
        byProduct[k].qty += Number(s.quantity) || 0;
        byProduct[k].revenue += Number(s.total) || 0;
      }
      return { generated_at, period: monthStart, summary: { revenue: rows.reduce((s: number, r: any) => s + Number(r.total || 0), 0), units: rows.reduce((s: number, r: any) => s + Number(r.quantity || 0), 0), byProduct }, rows };
    }
    case 'spa-product-consumption': {
      const { data } = await db.from('uinv_stock_ledger')
        .select('*').eq('store_id', SPA_STORE_ID).eq('movement_type', 'Issue')
        .gte('created_at', monthStart).limit(500);
      const rows = data || [];
      return { generated_at, period: monthStart, summary: { issueMovements: rows.length, units: rows.reduce((s: number, r: any) => s + Math.abs(Number(r.quantity || 0)), 0) }, rows };
    }
    case 'spa-low-stock': {
      const { data } = await scope(db.from('spa_retail_products').select('*').eq('is_active', true));
      const rows = (data || []).filter((p: any) => Number(p.stock) <= Number(p.min_stock));
      return { generated_at, summary: { lowStockItems: rows.length }, rows };
    }
    case 'spa-retail-stock': {
      const { data } = await scope(db.from('spa_retail_products').select('*').eq('is_active', true).order('name'));
      return { generated_at, summary: { products: (data || []).length }, rows: data || [] };
    }
    case 'spa-inventory-valuation': {
      const { data } = await scope(db.from('spa_retail_products').select('id, name, stock, cost, price').eq('is_active', true));
      const rows = data || [];
      return {
        generated_at,
        summary: {
          costValue: rows.reduce((s: number, p: any) => s + Number(p.stock || 0) * Number(p.cost || 0), 0),
          retailValue: rows.reduce((s: number, p: any) => s + Number(p.stock || 0) * Number(p.price || 0), 0),
        },
        rows,
      };
    }
    case 'spa-therapist-productivity': {
      const { data } = await scope(db.from('spa_appointments').select('therapist_id, therapist, status, amount, duration_minutes').gte('appointment_date', monthStart));
      const stats: Record<string, { appointments: number; completed: number; revenue: number; minutes: number }> = {};
      for (const a of data || []) {
        const k = a.therapist || 'Unassigned';
        stats[k] = stats[k] || { appointments: 0, completed: 0, revenue: 0, minutes: 0 };
        stats[k].appointments++;
        if (a.status === 'Completed') { stats[k].completed++; stats[k].revenue += Number(a.amount) || 0; stats[k].minutes += Number(a.duration_minutes) || 0; }
      }
      const rows = Object.entries(stats).map(([therapist, s]) => ({ therapist, ...s }));
      return { generated_at, period: monthStart, summary: { therapists: rows.length }, rows };
    }
    case 'spa-guest-satisfaction': {
      // Real satisfaction data lives in guest_feedback (migration 505);
      // spa-tagged rows first, falling back to all feedback for the period.
      const { data } = await scope(db.from('guest_feedback')
        .select('id, category, rating, comments, submitted_at')
        .gte('submitted_at', monthStart));
      const all = data || [];
      const spaRows = all.filter((f: any) => /spa|wellness|massage|treatment/i.test(String(f.category)));
      const rows = spaRows.length ? spaRows : all;
      const ratings = rows.map((f: any) => Number(f.rating)).filter((n: number) => n >= 1 && n <= 5);
      const avg = ratings.length ? Math.round((ratings.reduce((s: number, n: number) => s + n, 0) / ratings.length) * 100) / 100 : null;
      const dist: Record<string, number> = {};
      for (const r of ratings) dist[String(r)] = (dist[String(r)] || 0) + 1;
      return {
        generated_at, period: monthStart,
        summary: {
          responses: rows.length,
          spaSpecific: spaRows.length,
          avgRating: avg,
          distribution: dist,
          note: spaRows.length ? undefined : 'No spa-tagged feedback this period — showing all guest feedback',
        },
        rows,
      };
    }
    case 'spa-popular-treatments':
    case 'spa-treatment-trends': {
      const { data } = await scope(db.from('spa_appointments').select('treatment, status, amount, appointment_date'));
      const stats: Record<string, { bookings: number; completed: number; revenue: number }> = {};
      for (const a of data || []) {
        const k = a.treatment || 'Unknown';
        stats[k] = stats[k] || { bookings: 0, completed: 0, revenue: 0 };
        stats[k].bookings++;
        if (a.status === 'Completed') { stats[k].completed++; stats[k].revenue += Number(a.amount) || 0; }
      }
      const rows = Object.entries(stats).map(([treatment, s]) => ({ treatment, ...s })).sort((a, b) => b.bookings - a.bookings);
      return { generated_at, summary: { treatments: rows.length }, rows };
    }
    case 'spa-occupancy': {
      const { data: rooms } = await scope(db.from('spa_rooms').select('id').eq('is_bookable', true));
      const { data: appts } = await scope(db.from('spa_appointments').select('room_id').eq('appointment_date', today).in('status', SLOT_ACTIVE));
      const occupied = new Set((appts || []).map((a: any) => a.room_id).filter(Boolean));
      const total = (rooms || []).length;
      return { generated_at, period: today, summary: { rooms: total, occupied: occupied.size, occupancyPct: total ? Math.round((occupied.size / total) * 100) : 0 }, rows: [...occupied] };
    }
    case 'spa-membership-growth': {
      const { data } = await scope(db.from('spa_memberships').select('id, membership_type, status, created_at, start_date'));
      const byMonth: Record<string, number> = {};
      for (const m of data || []) {
        const k = String(m.created_at || m.start_date || '').slice(0, 7) || 'unknown';
        byMonth[k] = (byMonth[k] || 0) + 1;
      }
      const rows = Object.entries(byMonth).map(([month, count]) => ({ month, new_memberships: count })).sort((a, b) => a.month.localeCompare(b.month));
      return { generated_at, summary: { totalMemberships: (data || []).length }, rows };
    }
    case 'spa-monthly-performance':
    case 'spa-profitability': {
      const [appts, txns, retail] = await Promise.all([
        scope(db.from('spa_appointments').select('status, amount').gte('appointment_date', monthStart)),
        scope(db.from('spa_transactions').select('status, total, source').gte('transaction_date', monthStart)),
        scope(db.from('spa_retail_sales').select('total').gte('sale_date', monthStart)),
      ]);
      const a = appts.data || []; const t = txns.data || []; const r = retail.data || [];
      const completed = a.filter((x: any) => x.status === 'Completed');
      const serviceRevenue = t.filter((x: any) => x.status === 'Completed').reduce((s: number, x: any) => s + Number(x.total || 0), 0);
      const retailRevenue = r.reduce((s: number, x: any) => s + Number(x.total || 0), 0);
      return {
        generated_at, period: monthStart,
        summary: {
          appointments: a.length, completed: completed.length,
          serviceRevenue, retailRevenue, totalRevenue: serviceRevenue + retailRevenue,
        },
        rows: [],
      };
    }
    default: {
      const { data } = await scope(db.from('spa_appointments').select('status, amount').gte('appointment_date', monthStart));
      return { generated_at, period: monthStart, summary: { appointments: (data || []).length, note: `No dedicated generator for ${reportId}` }, rows: [] };
    }
  }
}

const SLOT_ACTIVE = ['Requested', 'Confirmed', 'Checked In', 'In Treatment', 'Rescheduled'];

router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const category = req.query.category as string;
  let q = scopeProperty(
    supabaseAdmin.from('spa_reports').select(SPA_REPORT_SELECT).order('id', { ascending: true }),
    req.query.propertyId as string, req);
  if (category && (SPA_REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/reports/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const q = scopeProperty(
    supabaseAdmin.from('spa_reports').select('category, status'),
    req.query.propertyId as string, req);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = { operational: 0, financial: 0, inventory: 0, performance: 0, executive: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({
    total: rows.length,
    ready: rows.filter((r: any) => r.status === 'Ready').length,
    scheduled: rows.filter((r: any) => r.status === 'Scheduled').length,
    failed: rows.filter((r: any) => r.status === 'Failed').length,
    byCategory,
  });
});

router.get('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('spa_reports').select(`${SPA_REPORT_SELECT}, last_result`).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data || !canAccessRowProperty(req, data.property_id)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  return res.json(data);
});

router.post('/reports/run-all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.body?.propertyId ?? req.query.propertyId) as string | undefined;
  const { data: reports, error } = await scopeProperty(
    supabaseAdmin.from('spa_reports').select('id, status'), propertyId, req);
  if (error) return res.status(500).json({ error: error.message });

  const results: Array<{ id: string; status: string }> = [];
  for (const r of reports || []) {
    try {
      const last_result = await generateSpaReport(r.id, boundPropertyId(req, propertyId) ?? undefined);
      await scopeRowWrite(supabaseAdmin.from('spa_reports')
        .update({ status: 'Ready', last_run: new Date().toISOString(), last_result }), req)
        .eq('id', r.id);
      results.push({ id: r.id, status: 'Ready' });
    } catch (e: any) {
      await scopeRowWrite(supabaseAdmin.from('spa_reports')
        .update({ status: 'Failed', last_result: { error: e?.message } }), req)
        .eq('id', r.id);
      results.push({ id: r.id, status: 'Failed' });
    }
  }
  return res.json({ refreshed: results.filter(r => r.status === 'Ready').length, results });
});

router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: report } = await supabaseAdmin
    .from('spa_reports').select('id').eq('id', req.params.id).maybeSingle();
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const propertyId = (req.body?.propertyId ?? req.query.propertyId) as string | undefined;
  try {
    const last_result = await generateSpaReport(report.id, boundPropertyId(req, propertyId) ?? undefined);
    const { data, error } = await scopeRowWrite(supabaseAdmin
      .from('spa_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), last_result }), req)
      .eq('id', report.id)
      .select(`${SPA_REPORT_SELECT}, last_result`)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e: any) {
    await scopeRowWrite(supabaseAdmin.from('spa_reports')
      .update({ status: 'Failed', last_result: { error: e?.message } }), req)
      .eq('id', report.id);
    return res.status(500).json({ error: `Report generation failed: ${e?.message}` });
  }
});

router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (SPA_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (SPA_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_reports').update(updates), req).eq('id', req.params.id).select(SPA_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ── Configuration / Settings store ──────────────────────────────

const SETTING_SECTIONS = ['general', 'treatments', 'memberships', 'facilities'];
const SETTING_STATUSES = ['Configured', 'Not Configured'];

// GET /api/spa-wellness/settings?section=&propertyId=
router.get('/settings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_settings').select('*').order('id'),
    propertyId, req);
  if (section) q = q.eq('section', section);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/settings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { section, name, description, value, status, property_id, propertyId } = req.body;
  if (!section || !name) return res.status(400).json({ error: 'section and name are required' });
  if (!SETTING_SECTIONS.includes(section)) {
    return res.status(400).json({ error: `Invalid section. Must be one of: ${SETTING_SECTIONS.join(', ')}` });
  }
  if (status && !SETTING_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${SETTING_STATUSES.join(', ')}` });
  }

  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `${section}.${slug}`;
  const { data: dup } = await supabaseAdmin.from('spa_settings').select('id').eq('id', id).maybeSingle();
  if (dup) return res.status(409).json({ error: `Setting ${id} already exists` });

  const { data, error } = await supabaseAdmin
    .from('spa_settings')
    .insert({
      id, section, name,
      description: description || '',
      value: value || (section === 'general' ? { value: '' } : { fields: {} }),
      status: status || 'Not Configured',
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/settings/:id(*)', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (req.body.status && !SETTING_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${SETTING_STATUSES.join(', ')}` });
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'description', 'value', 'status']) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_settings').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Setting not found' });
  return res.json(data);
});

router.delete('/settings/:id(*)', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin
    .from('spa_settings').delete(), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Inventory Consumption (theoretical vs actual — mirrors HK) ─────────────
// POST {propertyId, treatmentsCompleted, entries:[{itemId, actualQty}]}
// Theoretical usage = item par (min_stock) × treatments completed. Deducts
// the actual counted usage from the spa store and writes a Consumption
// ledger row carrying theoretical_qty/actual_qty for variance analysis.
router.post('/inventory/consumption', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { treatmentsCompleted, entries } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId) return res.status(400).json({ error: 'A valid propertyId (uuid) is required' });
  if (!treatmentsCompleted || Number(treatmentsCompleted) <= 0) return res.status(400).json({ error: 'treatmentsCompleted must be positive' });
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array is required' });

  const now = new Date().toISOString();
  const treatments = Number(treatmentsCompleted);
  let transactionsCreated = 0;

  for (const e of entries) {
    const { itemId, actualQty } = e;
    if (!itemId || actualQty === undefined) continue;

    const { data: item } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name, unit_of_measure, subcategory, min_stock, property_id')
      .eq('id', itemId)
      .maybeSingle();

    if (!item) continue;

    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', item.id)
      .eq('store_id', SPA_STORE_ID)
      .is('location_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!balance) continue;

    const actual = Number(actualQty) || 0;
    const theoretical = Number(item.min_stock || 0) * treatments;
    const newQty = Math.max(0, (Number(balance.on_hand) || 0) - actual);

    await scopeRowWrite(supabaseAdmin
      .from('uinv_stock_balances')
      .update({ on_hand: newQty, last_movement_date: now, updated_at: now }), req)
      .eq('id', balance.id);

    await supabaseAdmin.from('uinv_stock_ledger').insert({
      property_id: propertyId,
      item_id: item.id,
      store_id: SPA_STORE_ID,
      transaction_type: 'Consumption',
      reference: `Spa Consumption — ${treatments} treatments`,
      quantity_in: 0,
      quantity_out: actual,
      balance: newQty,
      unit_cost: Number(balance.unit_cost || 0),
      value: actual * Number(balance.unit_cost || 0),
      performed_by: isUuid(req.user?.id) ? req.user!.id : 'system',
      reason: `Consumption: ${actual} ${item.unit_of_measure} (par ${item.min_stock} × ${treatments} treatments)`,
      transaction_date: now,
      theoretical_qty: theoretical,
      actual_qty: actual,
    });

    transactionsCreated += 1;
  }

  return res.json({ transactionsCreated, treatmentsCompleted: treatments });
});

// ── Dashboard: live KPIs + persisted alert feed ─────────────────────────────
// GET /api/spa-wellness/dashboard?propertyId= — aggregates computed from the
// real operational tables (appointments, treatments, therapists, rooms,
// memberships, retail sales, transactions, enrollments) plus spa_alerts.
router.get('/dashboard', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [apptRes, trtRes, thRes, roomRes, mbrRes, retailRes, txnRes, enrRes, alertRes] = await Promise.all([
    scopeProperty(
      supabaseAdmin.from('spa_appointments')
        .select('id, status, therapist_id, room_id, amount, appointment_date'),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_treatments').select('id').eq('is_active', true),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_therapists').select('id').eq('status', 'Active'),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_rooms').select('id').eq('is_bookable', true),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_memberships').select('id').eq('status', 'Active'),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_retail_sales').select('total, sale_date').gte('sale_date', monthStart),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_transactions').select('total, status, transaction_date'),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_program_enrollments').select('id').eq('status', 'Enrolled'),
      propertyId, req),
    scopeProperty(
      supabaseAdmin.from('spa_alerts').select('*').order('created_at', { ascending: false }).limit(50),
      propertyId, req),
  ]);

  const appts: any[] = apptRes.data || [];
  const todays = appts.filter((a: any) => a.appointment_date === today);
  const liveToday = todays.filter((a: any) => a.status !== 'Cancelled' && a.status !== 'No Show');
  const cancelled = appts.filter((a: any) => a.status === 'Cancelled' || a.status === 'No Show').length;
  const txns = (txnRes.data || []).filter((t: any) => String(t.transaction_date).slice(0, 10) >= monthStart && t.status === 'Completed');

  const therapistIds = new Set(liveToday.map((a: any) => a.therapist_id).filter(Boolean));
  const roomIds = new Set(liveToday.map((a: any) => a.room_id).filter(Boolean));
  const therapistCount = (thRes.data || []).length;
  const roomCount = (roomRes.data || []).length;
  const pricedAppts = appts.filter((a: any) => a.status === 'Completed' && Number(a.amount) > 0);

  return res.json({
    kpis: {
      todaysAppointments: todays.length,
      activeTreatments: (trtRes.data || []).length,
      therapistUtilization: therapistCount ? Math.min(100, Math.round((therapistIds.size / therapistCount) * 100)) : 0,
      treatmentRoomOccupancy: roomCount ? Math.min(100, Math.round((roomIds.size / roomCount) * 100)) : 0,
      membershipCount: (mbrRes.data || []).length,
      retailRevenue: (retailRes.data || []).reduce((s: number, r: any) => s + Number(r.total || 0), 0),
      spaRevenue: txns.reduce((s: number, t: any) => s + Number(t.total || 0), 0),
      programsEnrolled: (enrRes.data || []).length,
      averageTreatmentValue: pricedAppts.length
        ? Math.round(pricedAppts.reduce((s: number, a: any) => s + Number(a.amount || 0), 0) / pricedAppts.length)
        : 0,
      cancellationRate: appts.length ? Math.round((cancelled / appts.length) * 1000) / 10 : 0,
    },
    alerts: alertRes.data || [],
  });
});

// ── Alerts ──────────────────────────────────────────────────────────────────
const ALERT_SEVERITIES = ['Info', 'Warning', 'Critical'];

router.get('/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, unread } = req.query as Record<string, string>;
  let q = scopeProperty(
    supabaseAdmin.from('spa_alerts').select('*').order('created_at', { ascending: false }).limit(100),
    propertyId, req);
  if (unread === 'true') q = q.eq('is_read', false);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { alert_type, message, severity, guest_id, appointment_id, therapist_id, property_id, propertyId } = req.body || {};
  if (!alert_type || !message) return res.status(400).json({ error: 'alert_type and message are required' });
  if (severity && !ALERT_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: `Invalid severity. Must be one of: ${ALERT_SEVERITIES.join(', ')}` });
  }

  const id = await nextSpaId('SPA-ALT-');

  const { data, error } = await supabaseAdmin
    .from('spa_alerts')
    .insert({
      id,
      alert_type, message,
      severity: severity || 'Info',
      guest_id: guest_id || null,
      appointment_id: appointment_id || null,
      therapist_id: therapist_id || null,
      property_id: boundPropertyId(req, property_id || propertyId),
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/alerts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const updates: Record<string, unknown> = {};
  for (const f of ['alert_type', 'message', 'is_read', 'guest_id', 'appointment_id', 'therapist_id']) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (req.body.severity !== undefined) {
    if (!ALERT_SEVERITIES.includes(req.body.severity)) {
      return res.status(400).json({ error: `Invalid severity. Must be one of: ${ALERT_SEVERITIES.join(', ')}` });
    }
    updates.severity = req.body.severity;
  }
  const { data, error } = await scopeRowWrite(supabaseAdmin
    .from('spa_alerts').update(updates), req).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

router.delete('/alerts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(scopeRowWrite(supabaseAdmin.from('spa_alerts').delete(), req), req).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Provider schedules: HR roster integration ──────────────────────────────
// Providers are spa_therapists linked to HR employees (employee_id). Their
// daily availability comes from hr_team_roster (the same table the HR shift
// manager edits) — shift 'Off' = day off. Shift windows resolve through
// hr_shift_types when the property defines times, else fall back to these.
const SHIFT_WINDOWS: Record<string, { start: number; end: number }> = {
  Morning: { start: 8 * 60, end: 16 * 60 },
  Evening: { start: 12 * 60, end: 20 * 60 },
  Night: { start: 16 * 60, end: 24 * 60 },
};
const ROSTER_SHIFTS = ['Morning', 'Evening', 'Night', 'Off'];

const timeToMin = (t: any): number | null => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// GET /api/spa-wellness/provider-schedule?date=YYYY-MM-DD&propertyId=
router.get('/provider-schedule', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, propertyId } = req.query as Record<string, string>;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const { data: providers, error: pErr } = await scopeProperty(
    supabaseAdmin.from('spa_therapists').select('id, name, title, shift, employee_id, status'),
    propertyId, req);
  if (pErr) return res.status(500).json({ error: pErr.message });

  const empIds = (providers || []).map((t: any) => t.employee_id).filter(Boolean);

  let roster: any[] = [];
  if (empIds.length > 0) {
    let rq = supabaseAdmin
      .from('hr_team_roster')
      .select('id, employee_id, roster_date, shift, role, shift_type_id')
      .in('employee_id', empIds)
      .eq('roster_date', date);
    if (propertyId) rq = rq.eq('property_id', propertyId);
    const { data } = await rq;
    roster = data || [];
  }

  let shiftTypes: any[] = [];
  if (propertyId) {
    const { data } = await supabaseAdmin
      .from('hr_shift_types')
      .select('id, name, start_time, end_time')
      .eq('property_id', propertyId)
      .eq('is_active', true);
    shiftTypes = data || [];
  }

  const windowFor = (shift: string | null, shiftTypeId: string | null) => {
    if (!shift || shift === 'Off') return null;
    const t = shiftTypes.find((x: any) => x.id === shiftTypeId)
      || shiftTypes.find((x: any) => x.name === shift);
    const s = timeToMin(t?.start_time);
    const e = timeToMin(t?.end_time);
    if (s !== null && e !== null) return { start: s, end: e };
    return SHIFT_WINDOWS[shift] || SHIFT_WINDOWS.Morning;
  };

  const rows = (providers || []).map((t: any) => {
    const r = roster.find((x: any) => x.employee_id === t.employee_id);
    // Roster row wins; otherwise fall back to the therapist's default shift.
    const shift = r ? r.shift : (t.shift || 'Morning');
    const win = windowFor(shift, r?.shift_type_id || null);
    return {
      therapist_id: t.id,
      name: t.name,
      title: t.title,
      status: t.status,
      employee_id: t.employee_id,
      rostered: Boolean(r),
      roster_id: r?.id || null,
      shift,
      is_off: shift === 'Off' || t.status === 'Inactive',
      window: win,
    };
  });

  return res.json({ date, providers: rows });
});

// PUT /api/spa-wellness/provider-schedule — upsert a provider's roster entry
// for a date (writes into hr_team_roster, the shared staff-management grid).
router.put('/provider-schedule', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { therapistId, date, shift } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!therapistId || !date || !shift) {
    return res.status(400).json({ error: 'therapistId, date and shift are required' });
  }
  if (!ROSTER_SHIFTS.includes(shift)) {
    return res.status(400).json({ error: `shift must be one of: ${ROSTER_SHIFTS.join(', ')}` });
  }
  if (!propertyId) {
    return res.status(400).json({ error: 'A valid propertyId (uuid) is required for roster entries' });
  }

  const { data: provider } = await scopeProperty(
    supabaseAdmin.from('spa_therapists').select('id, name, title, employee_id').eq('id', therapistId),
    propertyId, req).maybeSingle();
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  if (!provider.employee_id) {
    return res.status(400).json({ error: 'Provider is not linked to an HR employee record' });
  }
  if (!propertyId) {
    return res.status(400).json({ error: 'propertyId is required for roster entries' });
  }

  const { data: existing } = await supabaseAdmin
    .from('hr_team_roster')
    .select('id')
    .eq('property_id', propertyId)
    .eq('employee_id', provider.employee_id)
    .eq('roster_date', date)
    .maybeSingle();

  if (existing) {
    const { data, error } = await scopeRowWrite(supabaseAdmin
      .from('hr_team_roster')
      .update({ shift, updated_at: new Date().toISOString() }), req)
      .eq('id', existing.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await supabaseAdmin
    .from('hr_team_roster')
    .insert({
      property_id: propertyId,
      employee_id: provider.employee_id,
      employee_name: provider.name,
      department: 'Spa & Wellness',
      roster_date: date,
      shift,
      role: provider.title || '-',
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

export default router;
