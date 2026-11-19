/**
 * Transport Incidents API
 * ──────────────────────────────────────────────────────────────────────────
 * Safety incident log for drivers/vehicles (spec §15 "Incident History",
 * §26 Security & Risk integration). A DB trigger keeps
 * transport_drivers.incidents in sync; driver safety scores are computed
 * from open incident severities.
 * Mounted at /api/transport/incidents.
 *
 *   - GET    /:propertyId           list incidents (?status=, ?driverId=)
 *   - GET    /safety/:propertyId    per-driver computed safety scores
 *   - POST   /                      report an incident
 *   - PUT    /:id                   update / resolve
 *   - DELETE /:id                   remove
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import { computeSafetyScore } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-incidents:';
const INCIDENT_TYPES = ['Accident', 'Traffic Violation', 'Speeding', 'Breakdown', 'Passenger Complaint', 'Vehicle Damage', 'Other'];
const SEVERITIES = ['Minor', 'Moderate', 'Major', 'Critical'];
const INCIDENT_STATUSES = ['Reported', 'Under Review', 'Resolved', 'Closed'];

const SELECT = `*,
  transport_drivers(id, employees(name)),
  transport_vehicles(vehicle_number, make, model),
  transport_requests(request_number, guest_name)`;

// ── Computed safety scores per driver ────────────────────────────────────────
// NOTE: must be registered before /:propertyId or 'safety' binds as a prop id.
router.get('/safety/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const [incidentsRes, driversRes] = await Promise.all([
    supabaseAdmin
      .from('transport_incidents')
      .select('driver_id, severity, status')
      .eq('property_id', propertyId),
    supabaseAdmin
      .from('transport_drivers')
      .select('id, employees(name)')
      .eq('property_id', propertyId),
  ]);
  if (incidentsRes.error) return res.status(500).json({ error: incidentsRes.error.message });
  if (driversRes.error) return res.status(500).json({ error: driversRes.error.message });

  const byDriver = new Map<string, { severity: string; status?: string }[]>();
  for (const i of incidentsRes.data || []) {
    if (!i.driver_id) continue;
    const list = byDriver.get(i.driver_id) || [];
    list.push(i);
    byDriver.set(i.driver_id, list);
  }

  const scores = (driversRes.data || []).map((d: any) => ({
    driverId: d.id,
    name: d.employees?.name || 'Driver',
    incidentCount: (byDriver.get(d.id) || []).length,
    safetyScore: computeSafetyScore(byDriver.get(d.id) || []),
  }));
  return res.json({ scores });
});

// ── List incidents ───────────────────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { status, driverId } = req.query as { status?: string; driverId?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${status || 'all'}:${driverId || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_incidents')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('occurred_at', { ascending: false })
    .limit(500);
  if (status && INCIDENT_STATUSES.includes(status)) query = query.eq('status', status);
  if (driverId) query = query.eq('driver_id', driverId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const result = { incidents: data || [] };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Report an incident ───────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { driverId, vehicleId, tripId, occurredAt, type, severity, location,
    description, status, reportedBy } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  if (type && !INCIDENT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  if (severity && !SEVERITIES.includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
  if (status && !INCIDENT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const incidentNumber = `INC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_incidents').insert({
    property_id: propertyId,
    incident_number: incidentNumber,
    driver_id: driverId || null,
    vehicle_id: vehicleId || null,
    trip_id: tripId || null,
    occurred_at: occurredAt || new Date().toISOString(),
    type: type || 'Other',
    severity: severity || 'Minor',
    location: location || null,
    description: description || null,
    status: status || 'Reported',
    reported_by: reportedBy || req.user?.name || null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'incident.create', 'transport_incident', data.id, { incidentNumber, type: data.type, severity: data.severity });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update / resolve ─────────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !INCIDENT_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });
  if (b.severity !== undefined && !SEVERITIES.includes(b.severity)) return res.status(400).json({ error: 'Invalid severity' });
  if (b.status !== undefined && !INCIDENT_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });

  const patch: any = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    driverId: 'driver_id', vehicleId: 'vehicle_id', tripId: 'trip_id',
    occurredAt: 'occurred_at', type: 'type', severity: 'severity', location: 'location',
    description: 'description', status: 'status', reportedBy: 'reported_by',
    resolutionNotes: 'resolution_notes',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }

  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_incidents').update(patch).eq('id', req.params.id), req
  ).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  auditTransport(req, 'incident.update', 'transport_incident', data.id, { status: data.status });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(
    supabaseAdmin.from('transport_incidents').delete().eq('id', req.params.id), req
  );
  if (error) return res.status(500).json({ error: error.message });
  auditTransport(req, 'incident.delete', 'transport_incident', req.params.id);
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
