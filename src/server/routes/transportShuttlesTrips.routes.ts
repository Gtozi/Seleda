/**
 * Transportation Shuttles & Trips API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed staff shuttles and trips. Links to shared HR employees and
 * transport_drivers. Mounted at /api/transport/shuttles-trips.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { findBridgedRequest, markStaffAttendanceFromTrip, runBridgedRequestSideEffects } from '../services/transportLifecycle';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-shuttle:';
const SHUTTLE_STATUSES = ['Active', 'Scheduled', 'Completed', 'Cancelled', 'Standby', 'In Transit', 'Maintenance'];
const BOARDING_STATUSES = ['Confirmed', 'Waiting', 'Checked In', 'Boarded', 'No Show', 'Cancelled'];

// ── Aggregated shuttle + trip snapshot for a property ────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [shuttleRes, tripRes, boardingRes] = await Promise.all([
    supabaseAdmin
      .from('transport_shuttles')
      .select('*, transport_drivers(id, employees(name))')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('transport_trips')
      .select('*, employees!inner(name, department), transport_drivers!inner(id, employees(name))')
      .eq('property_id', propertyId)
      .order('scheduled_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('transport_shuttle_boarding')
      .select('*, transport_shuttles(name, shuttle_number)')
      .eq('property_id', propertyId)
      .order('scheduled_time', { ascending: true })
      .limit(200),
  ]);

  if (shuttleRes.error) return res.status(500).json({ error: shuttleRes.error.message });
  if (tripRes.error) return res.status(500).json({ error: tripRes.error.message });
  if (boardingRes.error) return res.status(500).json({ error: boardingRes.error.message });

  const result = { shuttles: shuttleRes.data || [], trips: tripRes.data || [], boarding: boardingRes.data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create shuttle ───────────────────────────────────────────────────────────
router.post('/shuttles', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, route, stops, schedule, nextDeparture, frequency, assignedVehicle, driverId, capacity, currentOccupancy, status, department } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name required' });
  if (status && !SHUTTLE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid shuttle status' });

  const shuttleNumber = `SH-${Math.floor(1000 + Math.random() * 9000)}`;

  const { data, error } = await supabaseAdmin.from('transport_shuttles').insert({
    property_id: propertyId, shuttle_number: shuttleNumber, name, type: type || 'Staff Shuttle', route: route || '',
    stops: stops || [], schedule, next_departure: nextDeparture || null, frequency: frequency || null,
    assigned_vehicle: assignedVehicle, driver_id: driverId || null,
    capacity: Number(capacity) || 0, current_occupancy: Number(currentOccupancy) || 0,
    status: status || 'Active', department,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'shuttle.create', 'transport_shuttle', data.id, { shuttleNumber, name });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update shuttle ───────────────────────────────────────────────────────────
router.put('/shuttles/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !SHUTTLE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid shuttle status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    name: 'name', type: 'type', route: 'route', stops: 'stops', schedule: 'schedule',
    nextDeparture: 'next_departure', frequency: 'frequency', assignedVehicle: 'assigned_vehicle',
    driverId: 'driver_id', capacity: 'capacity', currentOccupancy: 'current_occupancy',
    status: 'status', department: 'department', shuttleNumber: 'shuttle_number',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.driverId !== undefined) patch.driver_id = b.driverId || null;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_shuttles').update(patch).eq('id', req.params.id), req).select().single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'shuttle.update', 'transport_shuttle', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete shuttle ───────────────────────────────────────────────────────────
router.delete('/shuttles/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_shuttles').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'shuttle.delete', 'transport_shuttle', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Create boarding entry ────────────────────────────────────────────────────
router.post('/boarding', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { shuttleId, guestId, guestName, room, pickup, destination, scheduledTime, status } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId || !shuttleId || !guestName || !pickup || !destination) {
    return res.status(400).json({ error: 'propertyId, shuttleId, guestName, pickup and destination are required' });
  }
  if (status && !BOARDING_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid boarding status' });

  const { data, error } = await supabaseAdmin.from('transport_shuttle_boarding').insert({
    property_id: propertyId, shuttle_id: shuttleId, guest_id: guestId || null,
    guest_name: guestName, room: room || null, pickup, destination,
    scheduled_time: scheduledTime || null, status: status || 'Confirmed',
  }).select('*, transport_shuttles(name, shuttle_number)').single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'boarding.create', 'transport_shuttle_boarding', data.id, { shuttleId, guestName });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update boarding entry ────────────────────────────────────────────────────
router.put('/boarding/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !BOARDING_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid boarding status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    shuttleId: 'shuttle_id', guestId: 'guest_id', guestName: 'guest_name', room: 'room',
    pickup: 'pickup', destination: 'destination', scheduledTime: 'scheduled_time', status: 'status',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_shuttle_boarding').update(patch).eq('id', req.params.id), req).select('*, transport_shuttles(name, shuttle_number)').single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'boarding.update', 'transport_shuttle_boarding', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete boarding entry ────────────────────────────────────────────────────
router.delete('/boarding/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_shuttle_boarding').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'boarding.delete', 'transport_shuttle_boarding', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Create trip ──────────────────────────────────────────────────────────────
router.post('/trips', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeId, type, pickup, destination, scheduledAt, actualAt, vehicle, driverId, status, shift } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId || !employeeId || !pickup || !destination || !scheduledAt) return res.status(400).json({ error: 'propertyId, employeeId, pickup, destination, scheduledAt required' });

  const { data, error } = await supabaseAdmin.from('transport_trips').insert({
    property_id: propertyId, employee_id: employeeId, type, pickup, destination,
    scheduled_at: scheduledAt, actual_at: actualAt || null,
    vehicle, driver_id: driverId, status: status || 'Scheduled', shift,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'staff_trip.create', 'transport_trip', data.id, { employeeId, type });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update trip ──────────────────────────────────────────────────────────────
router.put('/trips/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: any = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(req.body || {})) {
    if (v !== undefined) patch[k] = v;
  }
  delete patch.id; delete patch.property_id; delete patch.created_at;

  // Snapshot the bridged transport_requests row before the update so the
  // status transition is detectable after the trigger syncs it.
  const bridged = await findBridgedRequest(`tp:${req.params.id}`);

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_trips').update(patch).eq('id', req.params.id), req).select().single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'staff_trip.update', 'transport_trip', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  if (data.status === 'Completed') await markStaffAttendanceFromTrip(data);
  await runBridgedRequestSideEffects(bridged);
  return res.json(data);
});

// ── Delete trip ──────────────────────────────────────────────────────────────
router.delete('/trips/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_trips').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'staff_trip.delete', 'transport_trip', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
