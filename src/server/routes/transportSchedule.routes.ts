/**
 * Transportation Schedule API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed dispatch schedule items linking drivers and vehicles.
 * Mounted at /api/transport/schedule.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { findBridgedRequest, runBridgedRequestSideEffects } from '../services/transportLifecycle';
import { pickAutoAssign, type DriverLike, type ScheduleLike } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-schedule:';
const SCHEDULE_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Unassigned', 'Cancelled'];

const SELECT = '*, transport_drivers(id, assigned_vehicle, employees(name, phone))';

// ── List schedule items for a property (optionally date-ranged) ──────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { from, to, status } = req.query as { from?: string; to?: string; status?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${from || ''}:${to || ''}:${status || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_schedule_items')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('scheduled_time', { ascending: true })
    .limit(1000);
  if (from) query = query.gte('scheduled_time', from);
  if (to) query = query.lt('scheduled_time', to);
  if (status && SCHEDULE_STATUSES.includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { items: data || [] };
  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// ── Create schedule item ─────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { scheduledTime, durationMinutes, driverId, assignedVehicle,
    type, route, status, passengerCount } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !scheduledTime || !type) {
    return res.status(400).json({ error: 'propertyId, scheduledTime and type are required' });
  }
  if (status && !SCHEDULE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const scheduleNumber = `SCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_schedule_items').insert({
    property_id: propertyId,
    schedule_number: scheduleNumber,
    scheduled_time: scheduledTime,
    duration_minutes: Number(durationMinutes) || 30,
    driver_id: driverId || null,
    assigned_vehicle: assignedVehicle || null,
    type,
    route: route || null,
    status: status || (driverId ? 'Scheduled' : 'Unassigned'),
    passenger_count: Number(passengerCount) || 1,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'schedule.create', 'transport_schedule_item', data.id, { scheduleNumber, type });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Auto-assign unassigned items ─────────────────────────────────────────────
// Server-side scheduling (spec §17 "Auto Scheduling"): for each Unassigned
// item in the date range, pick the first Active driver with no overlapping
// assignment and their bound vehicle (or a free Active one).
router.post('/auto-assign', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });

  const from = req.body?.from || new Date().toISOString();
  const to = req.body?.to || new Date(Date.now() + 7 * 86400000).toISOString();

  const [itemsRes, driversRes, vehiclesRes] = await Promise.all([
    supabaseAdmin.from('transport_schedule_items').select('*')
      .eq('property_id', propertyId)
      .gte('scheduled_time', from).lt('scheduled_time', to)
      .order('scheduled_time', { ascending: true }),
    supabaseAdmin.from('transport_drivers').select('id, status, assigned_vehicle')
      .eq('property_id', propertyId).order('performance', { ascending: false }),
    supabaseAdmin.from('transport_vehicles').select('vehicle_number, status')
      .eq('property_id', propertyId),
  ]);
  if (itemsRes.error) return res.status(500).json({ error: itemsRes.error.message });
  if (driversRes.error) return res.status(500).json({ error: driversRes.error.message });
  if (vehiclesRes.error) return res.status(500).json({ error: vehiclesRes.error.message });

  const items = (itemsRes.data || []) as ScheduleLike[];
  const drivers = (driversRes.data || []) as DriverLike[];
  const vehicles = vehiclesRes.data || [];

  const assigned: any[] = [];
  const skipped: any[] = [];

  for (const item of items.filter((i) => i.status === 'Unassigned')) {
    const pick = pickAutoAssign(item, drivers, items, vehicles);
    if (!pick) { skipped.push(item.id); continue; }
    const { data, error } = await supabaseAdmin
      .from('transport_schedule_items')
      .update({
        driver_id: pick.driverId,
        assigned_vehicle: pick.vehicle,
        status: 'Scheduled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'Unassigned')  // optimistic guard against concurrent edits
      .select(SELECT)
      .single();
    if (!error && data) {
      // Reflect the tentative assignment so later items can't reuse the slot.
      item.driver_id = pick.driverId;
      item.assigned_vehicle = pick.vehicle;
      item.status = 'Scheduled';
      assigned.push(data);
    } else {
      skipped.push(item.id);
    }
  }

  auditTransport(req, 'schedule.auto_assign', 'transport_schedule_items', undefined, { assigned: assigned.length, skipped: skipped.length });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ assigned, skipped });
});

// ── Update schedule item ─────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.status !== undefined && !SCHEDULE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    scheduledTime: 'scheduled_time', durationMinutes: 'duration_minutes',
    driverId: 'driver_id', assignedVehicle: 'assigned_vehicle', type: 'type',
    route: 'route', status: 'status', passengerCount: 'passenger_count',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.driverId !== undefined) patch.driver_id = b.driverId || null;

  // Snapshot the bridged transport_requests row before the update so the
  // status transition is detectable after the trigger syncs it.
  const bridged = await findBridgedRequest(`si:${req.params.id}`);

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_schedule_items').update(patch).eq('id', req.params.id), req).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'schedule.update', 'transport_schedule_item', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  await runBridgedRequestSideEffects(bridged);
  return res.json(data);
});

// ── Delete schedule item ─────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_schedule_items').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'schedule.delete', 'transport_schedule_item', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
