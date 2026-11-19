/**
 * Transportation Guest Transports API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed guest-facing local transfers (restaurant, tour, medical, special
 * assistance). Links to shared guests and transport_drivers.
 * Mounted at /api/transport/guest-transports.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { findBridgedRequest, runBridgedRequestSideEffects } from '../services/transportLifecycle';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-guest:';
const TRANSPORT_TYPES = ['Local Transfer', 'Restaurant Transfer', 'Tour Transportation', 'Medical Transportation', 'Special Assistance'];
const TRANSPORT_STATUSES = ['Requested', 'Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'];

const SELECT = '*, guests(name), transport_drivers(id, assigned_vehicle, employees(name, phone))';

// ── List transports for a property ───────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, type } = req.query as { status?: string; type?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${type || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_guest_transports')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('scheduled_time', { ascending: false })
    .limit(500);
  if (status && TRANSPORT_STATUSES.includes(status)) query = query.eq('status', status);
  if (type && TRANSPORT_TYPES.includes(type)) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { transports: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create transport ─────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, guestName, room, type, subtype, pickup, destination,
    scheduledTime, assignedVehicle, driverId, passengerCount, status,
    specialRequests, estimatedDuration, amount } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !guestName || !type || !pickup || !destination || !scheduledTime) {
    return res.status(400).json({ error: 'propertyId, guestName, type, pickup, destination and scheduledTime are required' });
  }
  if (!TRANSPORT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid transport type' });
  if (status && !TRANSPORT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const transportNumber = `GT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_guest_transports').insert({
    property_id: propertyId,
    transport_number: transportNumber,
    guest_id: guestId || null,
    guest_name: guestName,
    room: room || null,
    type,
    subtype: subtype || null,
    pickup,
    destination,
    scheduled_time: scheduledTime,
    assigned_vehicle: assignedVehicle || null,
    driver_id: driverId || null,
    passenger_count: Number(passengerCount) || 1,
    status: status || 'Requested',
    special_requests: specialRequests || null,
    estimated_duration: estimatedDuration || null,
    amount: amount !== undefined && amount !== null && amount !== '' ? Number(amount) : null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'guest_transport.create', 'transport_guest_transport', data.id, { type, guestName });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update transport ─────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !TRANSPORT_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid transport type' });
  if (b.status !== undefined && !TRANSPORT_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    guestId: 'guest_id', guestName: 'guest_name', room: 'room', type: 'type',
    subtype: 'subtype', pickup: 'pickup', destination: 'destination',
    scheduledTime: 'scheduled_time', assignedVehicle: 'assigned_vehicle',
    driverId: 'driver_id', passengerCount: 'passenger_count', status: 'status',
    specialRequests: 'special_requests', estimatedDuration: 'estimated_duration', amount: 'amount',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.guestId !== undefined) patch.guest_id = b.guestId || null;
  if (b.driverId !== undefined) patch.driver_id = b.driverId || null;
  if (b.amount !== undefined) patch.amount = b.amount === null || b.amount === '' ? null : Number(b.amount);

  // Snapshot the bridged transport_requests row before the update so the
  // status transition is detectable after the trigger syncs it.
  const bridged = await findBridgedRequest(`gt:${req.params.id}`);

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_guest_transports').update(patch).eq('id', req.params.id), req).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'guest_transport.update', 'transport_guest_transport', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  await runBridgedRequestSideEffects(bridged);
  return res.json(data);
});

// ── Delete transport ─────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_guest_transports').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'guest_transport.delete', 'transport_guest_transport', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
