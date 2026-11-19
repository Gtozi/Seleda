/**
 * Transportation Airport Transfers API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed flight-tracked airport transfers. Optionally links to shared
 * guests and transport_drivers. Mounted at /api/transport/airport-transfers.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { findBridgedRequest, runBridgedRequestSideEffects } from '../services/transportLifecycle';
import { isFlightTrackingConfigured, lookupFlight } from '../services/flightTracking';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-airport:';
const TRANSFER_TYPES = ['Arrival Pickup', 'Departure Drop-off', 'Meet & Greet', 'VIP Pickup', 'Group Transfer', 'Executive Transfer'];
const TRANSFER_SERVICES = ['Standard', 'VIP Meet & Greet', 'Group', 'Executive'];
const FLIGHT_STATUSES = ['Scheduled', 'In Flight', 'Landed', 'Delayed', 'Cancelled', 'Diverted'];
const TRANSFER_STATUSES = ['Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show'];

const SELECT = '*, guests(name), transport_drivers(id, assigned_vehicle, employees(name, phone))';

// ── List transfers for a property ────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, type } = req.query as { status?: string; type?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${type || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_airport_transfers')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('scheduled_time', { ascending: false })
    .limit(500);
  if (status && TRANSFER_STATUSES.includes(status)) query = query.eq('status', status);
  if (type && TRANSFER_TYPES.includes(type)) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { transfers: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Create transfer ──────────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, guestName, room, type, service, flightNumber, airline, terminal,
    scheduledTime, estimatedLanding, actualLanding, flightStatus, delay, pickupLocation,
    destination, status, meetGreet, passengerCount, luggageCount, assignedVehicle, driverId } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !guestName || !type || !flightNumber || !pickupLocation || !destination || !scheduledTime) {
    return res.status(400).json({ error: 'propertyId, guestName, type, flightNumber, pickupLocation, destination and scheduledTime are required' });
  }
  if (!TRANSFER_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid transfer type' });
  if (service && !TRANSFER_SERVICES.includes(service)) return res.status(400).json({ error: 'Invalid service' });
  if (flightStatus && !FLIGHT_STATUSES.includes(flightStatus)) return res.status(400).json({ error: 'Invalid flight status' });
  if (status && !TRANSFER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const transferNumber = `AT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_airport_transfers').insert({
    property_id: propertyId,
    transfer_number: transferNumber,
    guest_id: guestId || null,
    guest_name: guestName,
    room: room || null,
    type,
    service: service || 'Standard',
    flight_number: flightNumber,
    airline: airline || null,
    terminal: terminal || null,
    scheduled_time: scheduledTime,
    estimated_landing: estimatedLanding || null,
    actual_landing: actualLanding || null,
    flight_status: flightStatus || 'Scheduled',
    delay: delay || null,
    pickup_location: pickupLocation,
    destination,
    status: status || 'Requested',
    meet_greet: Boolean(meetGreet),
    passenger_count: Number(passengerCount) || 1,
    luggage_count: Number(luggageCount) || 0,
    assigned_vehicle: assignedVehicle || null,
    driver_id: driverId || null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'airport_transfer.create', 'transport_airport_transfer', data.id, { transferNumber, flightNumber });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Refresh one transfer's flight status from the tracking provider ──────────
// No-op safe: reports configured:false and leaves the row untouched when no
// FLIGHT_API_KEY is set — manual status entry remains the fallback.
async function refreshTransferFlight(id: string, req: any) {
  const { data: transfer, error } = await scopeRowWrite(
    supabaseAdmin!.from('transport_airport_transfers').select('*').eq('id', id), req
  ).maybeSingle();
  if (error || !transfer) return { status: 404, body: { error: 'Transfer not found' } };
  if (!isFlightTrackingConfigured()) {
    return { status: 200, body: { configured: false, transfer } };
  }
  const date = (transfer.scheduled_time || '').slice(0, 10);
  const flight = await lookupFlight(transfer.flight_number, date);
  if (!flight) return { status: 502, body: { configured: true, error: 'Flight lookup failed or returned no data' } };

  const patch: any = {
    flight_status: flight.flightStatus,
    last_flight_check: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (flight.estimatedLanding) patch.estimated_landing = flight.estimatedLanding;
  if (flight.actualLanding) patch.actual_landing = flight.actualLanding;
  if (flight.terminal) patch.terminal = flight.terminal;
  if (flight.delayMinutes != null && flight.delayMinutes > 0) patch.delay = `+${flight.delayMinutes} min`;

  const { data: updated, error: updErr } = await supabaseAdmin!
    .from('transport_airport_transfers').update(patch).eq('id', transfer.id).select(SELECT).single();
  if (updErr) return { status: 500, body: { error: updErr.message } };

  // Delayed/cancelled flights raise an in-app alert for dispatch.
  if (['Delayed', 'Cancelled', 'Diverted'].includes(flight.flightStatus) && flight.flightStatus !== transfer.flight_status) {
    supabaseAdmin!.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: transfer.property_id,
      message: `Flight ${transfer.flight_number} now ${flight.flightStatus.toLowerCase()} — affects transfer ${transfer.transfer_number} (${transfer.guest_name})`,
      type: flight.flightStatus === 'Cancelled' ? 'critical' : 'warning',
      department: 'Transportation',
      read: false,
      created_at: new Date().toISOString(),
    }).then(({ error: nErr }: any) => {
      if (nErr) console.warn('[transport] flight alert failed:', nErr.message);
    });
  }
  return { status: 200, body: { configured: true, transfer: updated } };
}

router.post('/:id/refresh-flight', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, body } = await refreshTransferFlight(req.params.id, req);
  if (status === 200) cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(status).json(body);
});

// ── Refresh all upcoming transfers (dispatch "refresh flights" sweep) ────────
router.post('/refresh-flights/:propertyId', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  if (!isFlightTrackingConfigured()) return res.json({ configured: false, refreshed: 0 });

  const { data: upcoming } = await supabaseAdmin
    .from('transport_airport_transfers')
    .select('id')
    .eq('property_id', propertyId)
    .in('flight_status', ['Scheduled', 'In Flight', 'Delayed'])
    .gte('scheduled_time', new Date(Date.now() - 12 * 3600 * 1000).toISOString())
    .lte('scheduled_time', new Date(Date.now() + 48 * 3600 * 1000).toISOString())
    .limit(50);

  let refreshed = 0;
  for (const t of upcoming || []) {
    const { status } = await refreshTransferFlight(t.id, req);
    if (status === 200) refreshed++;
  }
  auditTransport(req, 'flights.refresh', 'transport_airport_transfer', undefined, { scanned: (upcoming || []).length, refreshed });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ configured: true, refreshed, scanned: (upcoming || []).length });
});

// ── Update transfer ──────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, guestName, room, type, service, flightNumber, airline, terminal, scheduledTime,
    estimatedLanding, actualLanding, flightStatus, delay, pickupLocation, destination, status,
    meetGreet, passengerCount, luggageCount, assignedVehicle, driverId } = req.body || {};

  if (type !== undefined && !TRANSFER_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid transfer type' });
  if (service !== undefined && !TRANSFER_SERVICES.includes(service)) return res.status(400).json({ error: 'Invalid service' });
  if (flightStatus !== undefined && !FLIGHT_STATUSES.includes(flightStatus)) return res.status(400).json({ error: 'Invalid flight status' });
  if (status !== undefined && !TRANSFER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  // Snapshot the bridged transport_requests row before the update so the
  // status transition is detectable after the trigger syncs it.
  const bridged = await findBridgedRequest(`at:${req.params.id}`);

  const patch: any = { updated_at: new Date().toISOString() };
  if (guestId !== undefined) patch.guest_id = guestId || null;
  if (guestName !== undefined) patch.guest_name = guestName;
  if (room !== undefined) patch.room = room;
  if (type !== undefined) patch.type = type;
  if (service !== undefined) patch.service = service;
  if (flightNumber !== undefined) patch.flight_number = flightNumber;
  if (airline !== undefined) patch.airline = airline;
  if (terminal !== undefined) patch.terminal = terminal;
  if (scheduledTime !== undefined) patch.scheduled_time = scheduledTime;
  if (estimatedLanding !== undefined) patch.estimated_landing = estimatedLanding;
  if (actualLanding !== undefined) patch.actual_landing = actualLanding;
  if (flightStatus !== undefined) patch.flight_status = flightStatus;
  if (delay !== undefined) patch.delay = delay;
  if (pickupLocation !== undefined) patch.pickup_location = pickupLocation;
  if (destination !== undefined) patch.destination = destination;
  if (status !== undefined) patch.status = status;
  if (meetGreet !== undefined) patch.meet_greet = Boolean(meetGreet);
  if (passengerCount !== undefined) patch.passenger_count = Number(passengerCount) || 1;
  if (luggageCount !== undefined) patch.luggage_count = Number(luggageCount) || 0;
  if (assignedVehicle !== undefined) patch.assigned_vehicle = assignedVehicle;
  if (driverId !== undefined) patch.driver_id = driverId || null;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_airport_transfers').update(patch).eq('id', req.params.id), req).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'airport_transfer.update', 'transport_airport_transfer', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  await runBridgedRequestSideEffects(bridged);
  return res.json(data);
});

// ── Delete transfer ──────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_airport_transfers').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'airport_transfer.delete', 'transport_airport_transfer', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
