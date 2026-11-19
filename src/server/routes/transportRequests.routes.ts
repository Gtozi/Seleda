/**
 * Transportation Requests API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for guest/staff transport requests feeding dispatch.
 * Optionally links to shared guests and transport_drivers for assignment.
 * Mounted at /api/transport/requests.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { findAssignmentConflict, runTransportStatusSideEffects } from '../services/transportLifecycle';
import { computeQuote, type PricingRule } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-requests:';
const REQUEST_TYPES = ['Airport Pickup', 'Airport Drop-off', 'City Transfer', 'Hotel Shuttle', 'Sightseeing Tour', 'VIP Transport', 'Staff Shuttle', 'Courier Service'];
const REQUEST_SOURCES = ['Front Office', 'Concierge', 'Guest Mobile App', 'Website', 'Reservation System', 'Corporate Account', 'Events & Banquets', 'Staff Portal'];
const REQUEST_STATUSES = ['Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show'];
const REQUEST_PRIORITIES = ['Critical', 'High', 'Normal', 'Low'];
const PAYMENT_METHODS = ['Guest Folio', 'Corporate Billing', 'Event Billing', 'Cash Payment', 'Credit Card', 'Complimentary', 'Internal Department Charge'];

const SELECT = '*, guests(name), transport_drivers(id, assigned_vehicle, employees(name, phone))';

// ── List requests for a property ─────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, type } = req.query as { status?: string; type?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${type || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_requests')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('scheduled_time', { ascending: false })
    .limit(500);
  if (status && REQUEST_STATUSES.includes(status)) query = query.eq('status', status);
  if (type && REQUEST_TYPES.includes(type)) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { requests: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create request ───────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, guestName, room, type, source, pickupLocation, destination,
    scheduledTime, passengerCount, luggageCount, status, priority, specialInstructions,
    assignedVehicle, driverId, estimatedDuration, estimatedDistance, amount, paymentMethod } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !guestName || !type || !pickupLocation || !destination || !scheduledTime) {
    return res.status(400).json({ error: 'propertyId, guestName, type, pickupLocation, destination and scheduledTime are required' });
  }
  if (!REQUEST_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid request type' });
  if (source && !REQUEST_SOURCES.includes(source)) return res.status(400).json({ error: 'Invalid source' });
  if (status && !REQUEST_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (priority && !REQUEST_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: 'Invalid payment method' });

  if (driverId || assignedVehicle) {
    const conflict = await findAssignmentConflict({ propertyId, driverId, assignedVehicle, scheduledTime });
    if (conflict) {
      return res.status(409).json({
        error: `Assignment conflict: ${conflict.driver_id === driverId ? 'driver' : 'vehicle'} already on ${conflict.request_number} at ${conflict.scheduled_time}`,
        conflict,
      });
    }
  }

  const requestNumber = `TR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  // Auto-price from pricing rules when no amount was supplied (spec §22).
  let resolvedAmount = Number(amount) || 0;
  if (!resolvedAmount) {
    const { data: rules } = await supabaseAdmin
      .from('transport_pricing_rules')
      .select('*')
      .eq('property_id', propertyId)
      .eq('active', true);
    if (rules?.length) {
      resolvedAmount = computeQuote(rules as PricingRule[], {
        type,
        distanceKm: estimatedDistance != null ? Number(estimatedDistance) : null,
        pickupLocation,
        destination,
      }).amount;
    }
  }

  const { data, error } = await supabaseAdmin.from('transport_requests').insert({
    property_id: propertyId,
    request_number: requestNumber,
    guest_id: guestId || null,
    guest_name: guestName,
    room: room || null,
    type,
    source: source || 'Front Office',
    pickup_location: pickupLocation,
    destination,
    scheduled_time: scheduledTime,
    passenger_count: Number(passengerCount) || 1,
    luggage_count: Number(luggageCount) || 0,
    status: status || 'Requested',
    priority: priority || 'Normal',
    special_instructions: specialInstructions || null,
    assigned_vehicle: assignedVehicle || null,
    driver_id: driverId || null,
    estimated_duration: estimatedDuration || null,
    estimated_distance: estimatedDistance != null ? Number(estimatedDistance) : null,
    amount: resolvedAmount,
    payment_method: paymentMethod || null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'request.create', 'transport_request', data.id, { requestNumber, type });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update request ───────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, guestName, room, type, source, pickupLocation, destination, scheduledTime,
    passengerCount, luggageCount, status, priority, specialInstructions, assignedVehicle,
    driverId, estimatedDuration, estimatedDistance, actualDuration, actualDistance,
    actualStartTime, actualEndTime, amount, paymentMethod } = req.body || {};

  if (type !== undefined && !REQUEST_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid request type' });
  if (source !== undefined && !REQUEST_SOURCES.includes(source)) return res.status(400).json({ error: 'Invalid source' });
  if (status !== undefined && !REQUEST_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (priority !== undefined && !REQUEST_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (paymentMethod !== undefined && paymentMethod !== null && !PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: 'Invalid payment method' });

  const { data: existing, error: loadError } = await scopeRowWrite(
    supabaseAdmin.from('transport_requests').select('*').eq('id', req.params.id), req
  ).maybeSingle();
  if (loadError) return res.status(500).json({ error: loadError.message });
  if (!existing) return res.status(404).json({ error: 'Request not found' });

  const patch: any = { updated_at: new Date().toISOString() };
  if (guestId !== undefined) patch.guest_id = guestId || null;
  if (guestName !== undefined) patch.guest_name = guestName;
  if (room !== undefined) patch.room = room;
  if (type !== undefined) patch.type = type;
  if (source !== undefined) patch.source = source;
  if (pickupLocation !== undefined) patch.pickup_location = pickupLocation;
  if (destination !== undefined) patch.destination = destination;
  if (scheduledTime !== undefined) patch.scheduled_time = scheduledTime;
  if (passengerCount !== undefined) patch.passenger_count = Number(passengerCount) || 1;
  if (luggageCount !== undefined) patch.luggage_count = Number(luggageCount) || 0;
  if (status !== undefined) patch.status = status;
  if (priority !== undefined) patch.priority = priority;
  if (specialInstructions !== undefined) patch.special_instructions = specialInstructions;
  if (assignedVehicle !== undefined) patch.assigned_vehicle = assignedVehicle;
  if (driverId !== undefined) patch.driver_id = driverId || null;
  if (estimatedDuration !== undefined) patch.estimated_duration = estimatedDuration;
  if (estimatedDistance !== undefined) patch.estimated_distance = estimatedDistance != null ? Number(estimatedDistance) : null;
  if (actualDuration !== undefined) patch.actual_duration = actualDuration;
  if (actualDistance !== undefined) patch.actual_distance = actualDistance != null ? Number(actualDistance) : null;
  if (actualStartTime !== undefined) patch.actual_start_time = actualStartTime;
  if (actualEndTime !== undefined) patch.actual_end_time = actualEndTime;
  if (amount !== undefined) patch.amount = Number(amount) || 0;
  if (paymentMethod !== undefined) patch.payment_method = paymentMethod;

  const nextDriver = patch.driver_id !== undefined ? patch.driver_id : existing.driver_id;
  const nextVehicle = patch.assigned_vehicle !== undefined ? patch.assigned_vehicle : existing.assigned_vehicle;
  const nextStatus = patch.status !== undefined ? patch.status : existing.status;
  const assignmentChanged = patch.driver_id !== undefined || patch.assigned_vehicle !== undefined || patch.status !== undefined || patch.scheduled_time !== undefined;
  if (assignmentChanged && (nextDriver || nextVehicle) && nextStatus !== 'Cancelled' && nextStatus !== 'No Show' && nextStatus !== 'Completed') {
    const conflict = await findAssignmentConflict({
      propertyId: existing.property_id,
      excludeId: existing.id,
      driverId: nextDriver,
      assignedVehicle: nextVehicle,
      scheduledTime: patch.scheduled_time ?? existing.scheduled_time,
    });
    if (conflict) {
      return res.status(409).json({
        error: `Assignment conflict: ${conflict.driver_id === nextDriver ? 'driver' : 'vehicle'} already on ${conflict.request_number} at ${conflict.scheduled_time}`,
        conflict,
      });
    }
  }

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_requests').update(patch).eq('id', req.params.id), req
  ).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'request.update', 'transport_request', data.id, { status: data.status, previousStatus: existing.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  await runTransportStatusSideEffects(data, existing.status);
  return res.json(data);
});

// ── Driver self-service ─────────────────────────────────────────────────────
// Lets a driver (system_users → employees → transport_drivers) see and advance
// their own assigned trips without holding transport:write.

const DRIVER_STATUSES = ['Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'No Show', 'Cancelled'];
const DRIVER_ACTIVE_STATUSES = ['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Confirmed'];

async function callerDriver(req: any): Promise<{ id: string; property_id: string } | null> {
  const { data: su } = await supabaseAdmin!
    .from('system_users')
    .select('employee_id, linked_employee_id, email')
    .eq('id', req.user.id)
    .maybeSingle();
  let empId = su?.employee_id || su?.linked_employee_id || null;
  if (!empId && su?.email) {
    const { data: emp } = await supabaseAdmin!
      .from('employees')
      .select('id')
      .ilike('email', su.email)
      .maybeSingle();
    empId = emp?.id || null;
  }
  if (!empId) return null;
  const { data: driver } = await supabaseAdmin!
    .from('transport_drivers')
    .select('id, property_id')
    .eq('employee_id', empId)
    .eq('status', 'Active')
    .maybeSingle();
  return driver;
}

// The caller's assigned trips (driver view).
router.get('/driver/mine', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const driver = await callerDriver(req);
  if (!driver) return res.status(403).json({ error: 'No active driver profile for this account' });

  const { data, error } = await supabaseAdmin
    .from('transport_requests')
    .select(SELECT)
    .eq('driver_id', driver.id)
    .in('status', DRIVER_ACTIVE_STATUSES)
    .order('scheduled_time', { ascending: true })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// Advance the status of a trip assigned to the calling driver.
router.patch('/driver/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const driver = await callerDriver(req);
  if (!driver) return res.status(403).json({ error: 'No active driver profile for this account' });

  const { status } = req.body || {};
  if (!DRIVER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${DRIVER_STATUSES.join(', ')}` });
  }

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('transport_requests')
    .select('*')
    .eq('id', req.params.id)
    .eq('driver_id', driver.id)
    .maybeSingle();
  if (loadError) return res.status(500).json({ error: loadError.message });
  if (!existing) return res.status(404).json({ error: 'Trip not found or not assigned to you' });

  const now = new Date().toISOString();
  const patch: any = { status, updated_at: now };
  if (status === 'In Progress' || status === 'Guest Picked Up') patch.actual_start_time = existing.actual_start_time || now;
  if (status === 'Completed' || status === 'No Show') patch.actual_end_time = existing.actual_end_time || now;

  const { data, error } = await supabaseAdmin
    .from('transport_requests')
    .update(patch)
    .eq('id', existing.id)
    .select(SELECT)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'request.driver_status', 'transport_request', data.id, { status, driverId: driver.id });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  await runTransportStatusSideEffects(data, existing.status);
  return res.json(data);
});

// ── Delete request ───────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(
    supabaseAdmin.from('transport_requests').delete().eq('id', req.params.id), req
  );
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'request.delete', 'transport_request', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
