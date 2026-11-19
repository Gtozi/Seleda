/**
 * GPS Tracking API
 * ──────────────────────────────────────────────────────────────────────────
 * Latest vehicle telemetry (position, speed, status) joined to the fleet and
 * active trips. Mounted at /api/transport/gps.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, isUuid, scopeRowWrite } from '../services/transportScope';
import { geofenceTransitions, type GeofenceShape } from '../services/transportOps';

const router = Router();

/**
 * Evaluate geofence transitions for a vehicle ping: logs enter/exit events,
 * maintains the per-vehicle inside-set, and raises an in-app notification for
 * alerting fences. Fire-and-forget — never blocks the ingest path.
 */
async function processGeofences(propertyId: string, vehicleId: string, lat: number, lng: number, tripId: string | null) {
  try {
    const [{ data: fences }, { data: stateRow }] = await Promise.all([
      supabaseAdmin!.from('transport_geofences').select('*').eq('property_id', propertyId).eq('active', true),
      supabaseAdmin!.from('transport_geofence_state').select('inside').eq('vehicle_id', vehicleId).maybeSingle(),
    ]);
    if (!fences?.length) return;

    const previousInside = (stateRow?.inside || []) as string[];
    const { transitions, nowInside } = geofenceTransitions(lat, lng, fences as GeofenceShape[], previousInside);

    await supabaseAdmin!.from('transport_geofence_state')
      .upsert({ vehicle_id: vehicleId, inside: nowInside, updated_at: new Date().toISOString() }, { onConflict: 'vehicle_id' });

    const { data: vehicle } = await supabaseAdmin!
      .from('transport_vehicles').select('vehicle_number').eq('id', vehicleId).maybeSingle();

    for (const t of transitions) {
      await supabaseAdmin!.from('transport_geofence_events').insert({
        property_id: propertyId,
        geofence_id: t.geofence.id,
        geofence_name: t.geofence.name,
        vehicle_id: vehicleId,
        trip_id: tripId || null,
        event_type: t.eventType,
        latitude: lat,
        longitude: lng,
      });
      if (t.alert) {
        await supabaseAdmin!.from('notifications').insert({
          id: crypto.randomUUID(),
          property_id: propertyId,
          message: `${vehicle?.vehicle_number || 'Vehicle'} ${t.eventType === 'enter' ? 'entered' : 'left'} geofence "${t.geofence.name}"`,
          type: t.eventType === 'exit' ? 'warning' : 'info',
          department: 'Transportation',
          read: false,
          created_at: new Date().toISOString(),
        });
      }
    }
  } catch (e: any) {
    console.warn('[transport-gps] geofence processing failed:', e?.message);
  }
}

/** Resolve a vehicle id to its property, enforcing the caller's scope. */
async function scopedVehicleProperty(req: any, vehicleId: string): Promise<string | null> {
  if (!isUuid(vehicleId)) return null;
  const { data: vehicle } = await supabaseAdmin!
    .from('transport_vehicles')
    .select('id, property_id')
    .eq('id', vehicleId)
    .maybeSingle();
  if (!vehicle) return null;
  const propertyId = boundPropertyId(req, vehicle.property_id);
  return propertyId === vehicle.property_id ? propertyId : null;
}

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-gps:';
const TELEMETRY_STATUSES = ['In Transit', 'Parked', 'Waiting', 'Offline'];

const SELECT = `*,
  transport_vehicles(vehicle_number, make, model, status, current_location,
    transport_drivers(employees(name, phone))),
  transport_requests(request_number, pickup_location, destination, status, scheduled_time)`;

// ── Latest telemetry for a property's fleet ──────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status } = req.query as { status?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_vehicle_telemetry')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('last_update', { ascending: false })
    .limit(500);
  if (status && TELEMETRY_STATUSES.includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { positions: data || [] };
  cacheService.set(cacheKey, result, 10 * 1000);
  return res.json(result);
});

// ── Telemetry history for a vehicle (trip replay) ────────────────────────────
router.get('/vehicle/:vehicleId/history', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = await scopedVehicleProperty(req, req.params.vehicleId);
  if (!propertyId) return res.status(404).json({ error: 'Vehicle not found' });

  const { from, to, tripId, limit } = req.query as { from?: string; to?: string; tripId?: string; limit?: string };
  let query = supabaseAdmin
    .from('transport_vehicle_telemetry_history')
    .select('*')
    .eq('vehicle_id', req.params.vehicleId)
    .eq('property_id', propertyId)
    .order('recorded_at', { ascending: true })
    .limit(Math.min(Number(limit) || 1000, 5000));
  if (from) query = query.gte('recorded_at', from);
  if (to) query = query.lte('recorded_at', to);
  if (tripId && isUuid(tripId)) query = query.eq('trip_id', tripId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ history: data || [] });
});

// ── Upsert telemetry for a vehicle ───────────────────────────────────────────
router.put('/vehicle/:vehicleId', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { vehicleId } = req.params;
  const b = req.body || {};

  if (b.status !== undefined && !TELEMETRY_STATUSES.includes(b.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const propertyId = await scopedVehicleProperty(req, vehicleId);
  if (!propertyId) return res.status(404).json({ error: 'Vehicle not found' });

  const now = new Date().toISOString();
  const row: any = { vehicle_id: vehicleId, property_id: propertyId, last_update: now, updated_at: now };
  const map: Record<string, string> = {
    latitude: 'latitude', longitude: 'longitude', speedKmh: 'speed_kmh', heading: 'heading',
    status: 'status', locationLabel: 'location_label', destination: 'destination',
    etaMinutes: 'eta_minutes', tripId: 'trip_id', routeDeviation: 'route_deviation',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) row[col] = b[key];
  }
  if (row.heading === undefined && b.heading !== undefined) row.heading = b.heading;

  const { data, error } = await supabaseAdmin
    .from('transport_vehicle_telemetry')
    .upsert(row, { onConflict: 'vehicle_id' })
    .select(SELECT)
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Append to position history for trip replay (non-fatal on failure).
  if (row.latitude != null && row.longitude != null) {
    supabaseAdmin.from('transport_vehicle_telemetry_history').insert({
      property_id: propertyId, vehicle_id: vehicleId, trip_id: row.trip_id || null,
      latitude: row.latitude, longitude: row.longitude, speed_kmh: row.speed_kmh ?? null,
      heading: row.heading ?? null, status: row.status || null,
      location_label: row.location_label || null, recorded_at: now,
    }).then(({ error: histErr }: any) => {
      if (histErr) console.warn('[transport-gps] history insert failed:', histErr.message);
    });
    processGeofences(propertyId, vehicleId, Number(row.latitude), Number(row.longitude), row.trip_id || null);
  }

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── GPS device ping (ingest). Accepts a single ping or an array of pings. ────
// Devices authenticate with the staff bearer token for now; each ping's
// vehicle must belong to the caller's scoped property.
router.post('/ingest', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const pings = Array.isArray(req.body?.pings) ? req.body.pings : [req.body];
  const inserted: any[] = [];
  const rejected: any[] = [];

  for (const p of pings) {
    const vehicleId = p?.vehicleId || p?.vehicle_id;
    const lat = Number(p?.latitude);
    const lng = Number(p?.longitude);
    if (!isUuid(vehicleId) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      rejected.push({ vehicleId, reason: 'vehicleId, latitude and longitude required' });
      continue;
    }
    const propertyId = await scopedVehicleProperty(req, vehicleId);
    if (!propertyId) { rejected.push({ vehicleId, reason: 'Vehicle not found' }); continue; }

    const recordedAt = p?.recordedAt || p?.recorded_at || new Date().toISOString();
    const status = TELEMETRY_STATUSES.includes(p?.status) ? p.status : 'In Transit';

    const { error: histErr } = await supabaseAdmin.from('transport_vehicle_telemetry_history').insert({
      property_id: propertyId, vehicle_id: vehicleId, trip_id: p.tripId || p.trip_id || null,
      latitude: lat, longitude: lng, speed_kmh: p.speedKmh ?? p.speed_kmh ?? null,
      heading: p.heading ?? null, status, location_label: p.locationLabel || p.location_label || null,
      recorded_at: recordedAt,
    });
    if (histErr) { rejected.push({ vehicleId, reason: histErr.message }); continue; }

    processGeofences(propertyId, vehicleId, lat, lng, p.tripId || p.trip_id || null);

    await supabaseAdmin.from('transport_vehicle_telemetry').upsert({
      vehicle_id: vehicleId, property_id: propertyId, latitude: lat, longitude: lng,
      speed_kmh: p.speedKmh ?? p.speed_kmh ?? null, heading: p.heading ?? null,
      status, location_label: p.locationLabel || p.location_label || null,
      trip_id: p.tripId || p.trip_id || null, last_update: recordedAt, updated_at: new Date().toISOString(),
    }, { onConflict: 'vehicle_id' });
    inserted.push(vehicleId);
  }

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(rejected.length && !inserted.length ? 400 : 200).json({ ingested: inserted.length, rejected });
});

// ── Remove telemetry for a vehicle ───────────────────────────────────────────
router.delete('/vehicle/:vehicleId', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = await scopedVehicleProperty(req, req.params.vehicleId);
  if (!propertyId) return res.status(404).json({ error: 'Vehicle not found' });
  const { error } = await supabaseAdmin
    .from('transport_vehicle_telemetry')
    .delete()
    .eq('vehicle_id', req.params.vehicleId)
    .eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// Geofences (spec §18 "Geofencing")
// ════════════════════════════════════════════════════════════════════════════

// ── List geofences ───────────────────────────────────────────────────────────
router.get('/geofences/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { data, error } = await supabaseAdmin
    .from('transport_geofences')
    .select('*')
    .eq('property_id', propertyId)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ geofences: data || [] });
});

// ── Recent geofence events ───────────────────────────────────────────────────
router.get('/geofence-events/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { data, error } = await supabaseAdmin
    .from('transport_geofence_events')
    .select('*, transport_vehicles(vehicle_number)')
    .eq('property_id', propertyId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 100, 500));
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ events: data || [] });
});

// ── Create geofence ──────────────────────────────────────────────────────────
router.post('/geofences', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, centerLatitude, centerLongitude, radiusKm, alertOnEnter, alertOnExit } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);
  const lat = Number(centerLatitude);
  const lng = Number(centerLongitude);
  if (!propertyId || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'propertyId, name, centerLatitude and centerLongitude are required' });
  }
  const { data, error } = await supabaseAdmin.from('transport_geofences').insert({
    property_id: propertyId,
    name,
    center_latitude: lat,
    center_longitude: lng,
    radius_km: Number(radiusKm) || 1,
    alert_on_enter: alertOnEnter !== false,
    alert_on_exit: alertOnExit === true,
  }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'geofence.create', 'transport_geofence', data.id, { name });
  return res.status(201).json(data);
});

// ── Update geofence ──────────────────────────────────────────────────────────
router.put('/geofences/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    name: 'name', centerLatitude: 'center_latitude', centerLongitude: 'center_longitude',
    radiusKm: 'radius_km', alertOnEnter: 'alert_on_enter', alertOnExit: 'alert_on_exit', active: 'active',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_geofences').update(patch).eq('id', req.params.id), req
  ).select('*').single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'geofence.update', 'transport_geofence', data.id);
  return res.json(data);
});

// ── Delete geofence ──────────────────────────────────────────────────────────
router.delete('/geofences/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(
    supabaseAdmin.from('transport_geofences').delete().eq('id', req.params.id), req
  );
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'geofence.delete', 'transport_geofence', req.params.id);
  return res.json({ success: true });
});

export default router;
