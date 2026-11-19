/**
 * Security Portal routes — mounted at /api/sec-portal.
 *
 * Backs the /erp/security/soc tab (SecurityOperationsCenter.tsx), the
 * /erp/security/staff tab (StaffManagement.tsx), the /erp/security/incidents
 * tab (IncidentManagement.tsx) and the /erp/security/investigations tab
 * (Investigations.tsx).
 *
 * Mimics the engineering portal pattern (engineeringPortal.routes.ts):
 * `authenticate` only (no requirePermission), supabaseAdmin queries,
 * cacheService.invalidate('sec-*') on mutations, dbNotConfigured guard.
 *
 * Resources:
 *   GET  /soc/overview            — aggregate fetch for the SOC board
 *   CRUD /soc/incidents           — sec_incidents
 *   CRUD /soc/patrols             — sec_patrols
 *   CRUD /soc/cctv                — sec_cctv_cameras
 *   CRUD /soc/alarms              — sec_alarms
 *   CRUD /soc/access-events       — sec_access_events
 *   CRUD /soc/emergency           — sec_emergency_notifications
 *   CRUD /staff                   — sec_staff (roster & availability)
 *   CRUD /investigations          — sec_investigations (+ nested
 *                                   /:id/witnesses, /:id/evidence, /:id/notes)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { writeAuditEvent } from '../services/sessionService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Central audit trail ──────────────────────────────────────────────────
// Log every mutating request (POST/PUT/PATCH/DELETE) to audit_events so
// Security operations are visible in the Admin Audit Center. Entity type/id
// are derived from the URL path; outcome reflects the response status. The
// request body is intentionally NOT logged — domain tables hold the content.
const SEC_AUDIT_NOUNS = new Set([
  'access-events', 'access-grants', 'actions', 'alarms', 'alerts', 'assets',
  'attendance', 'bcp', 'cctv', 'compliance-audits', 'compliance-items',
  'config', 'coverage', 'crises', 'custody', 'dashboard', 'emergency',
  'events', 'evidence', 'exercises', 'fire-activities', 'fire-equipment',
  'found', 'fraud-alerts', 'fraud-cases', 'incidents', 'investigations',
  'keys', 'logs', 'lostfound', 'messages', 'notes', 'patrols', 'performance',
  'plans', 'reports', 'responses', 'risks', 'safety-hazards',
  'safety-inspections', 'shifts', 'staff', 'training', 'updates', 'visitors',
  'witnesses',
]);
const SEC_AUDIT_VERBS = new Set([
  'ack', 'acknowledge', 'check', 'escalate', 'overview', 'run', 'run-all',
  'scan', 'snooze', 'stats', 'summary',
]);
const SEC_AUDIT_ACTION: Record<string, string> = {
  POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE',
};

router.use((req, res, next) => {
  // /ingest endpoints write their own audit events (they carry API-key context)
  if (!SEC_AUDIT_ACTION[req.method] || req.path.startsWith('/ingest')) return next();
  res.on('finish', () => {
    const segs = req.path.split('/').filter(Boolean);
    // First segment may be the 'soc' group prefix — skip it to find the noun.
    const nounIdx = segs.findIndex((s, i) => s !== 'soc' && SEC_AUDIT_NOUNS.has(s));
    const entityType = nounIdx >= 0 ? segs[nounIdx] : segs[0];
    const entityId = segs.slice(nounIdx + 1).find(
      (s) => !SEC_AUDIT_NOUNS.has(s) && !SEC_AUDIT_VERBS.has(s),
    );
    writeAuditEvent({
      req,
      user: (req as any).user ?? null,
      action: SEC_AUDIT_ACTION[req.method],
      module: 'security',
      entityType,
      entityId,
      outcome: res.statusCode < 400 ? 'success' : 'failure',
      details: {
        method: req.method,
        path: req.originalUrl,
        propertyId: (req.query as any)?.propertyId ?? (req.body as any)?.propertyId ?? null,
      },
    }).catch(() => {});
  });
  next();
});


const genId = (prefix: string) =>
  `${prefix}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

// ── SOC overview — one aggregate fetch for the operations board ──────────
// GET /api/sec-portal/soc/overview?propertyId=
router.get('/soc/overview', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  const scoped = (q: any) => (propertyId ? q.eq('property_id', propertyId) : q);
  const [incidents, patrols, cameras, alarms, accessEvents, emergencies] = await Promise.all([
    scoped(supabaseAdmin.from('sec_incidents').select('*').order('reported_at', { ascending: false })),
    scoped(supabaseAdmin.from('sec_patrols').select('*').order('started_at', { ascending: false })),
    scoped(supabaseAdmin.from('sec_cctv_cameras').select('*').order('name', { ascending: true })),
    scoped(supabaseAdmin.from('sec_alarms').select('*').order('triggered_at', { ascending: false })),
    scoped(supabaseAdmin.from('sec_access_events').select('*').order('occurred_at', { ascending: false })),
    scoped(supabaseAdmin.from('sec_emergency_notifications').select('*').order('occurred_at', { ascending: false })),
  ]);
  const firstError = [incidents, patrols, cameras, alarms, accessEvents, emergencies].find(r => r.error)?.error;
  if (firstError) return res.status(500).json({ error: firstError.message });
  return res.json({
    incidents: incidents.data || [],
    patrols: patrols.data || [],
    cameras: cameras.data || [],
    alarms: alarms.data || [],
    accessEvents: accessEvents.data || [],
    emergencies: emergencies.data || [],
  });
});

// ── Incidents ────────────────────────────────────────────────────────────

// GET /api/sec-portal/soc/incidents?propertyId=&status=&priority=
router.get('/soc/incidents', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_incidents').select('*').order('reported_at', { ascending: false });
  const { propertyId, status, priority } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/soc/incidents
router.post('/soc/incidents', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, incidentType, category, location, priority, status, reportedBy, assignedTo, description } = req.body || {};
  if (!incidentType?.trim() && !category?.trim()) return res.status(400).json({ error: 'incidentType or category is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  const { data, error } = await supabaseAdmin.from('sec_incidents').insert({
    id: genId('INC'),
    property_id: propertyId || null,
    incident_type: (incidentType || category).trim(),
    category: category || incidentType || null,
    location: location.trim(),
    priority: priority || 'Medium',
    status: status || 'Reported',
    reported_by: reportedBy || null,
    assigned_to: assignedTo || null,
    description: description || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/soc/incidents/:id
router.patch('/soc/incidents/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { incidentType, category, location, priority, status, reportedBy, assignedTo, description } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof incidentType === 'string') patch.incident_type = incidentType;
  if (category !== undefined) patch.category = category || null;
  if (typeof location === 'string') patch.location = location;
  if (typeof priority === 'string') patch.priority = priority;
  if (typeof status === 'string') patch.status = status;
  if (reportedBy !== undefined) patch.reported_by = reportedBy || null;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (description !== undefined) patch.description = description || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_incidents').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Incident not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, incident: data });
});

// DELETE /api/sec-portal/soc/incidents/:id
router.delete('/soc/incidents/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_incidents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Patrols ──────────────────────────────────────────────────────────────

// GET /api/sec-portal/soc/patrols?propertyId=&status=
router.get('/soc/patrols', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_patrols').select('*').order('started_at', { ascending: false });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/soc/patrols — creates patrol + optional checkpoint list
router.post('/soc/patrols', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, officer, route, status, progress, lastCheckpoint,
          scheduledStart, scheduledEnd, shift, notes, checkpoints } = req.body || {};
  if (!officer?.trim()) return res.status(400).json({ error: 'officer is required' });
  if (!route?.trim()) return res.status(400).json({ error: 'route is required' });
  const cps: Array<{ name: string; location?: string }> = Array.isArray(checkpoints) ? checkpoints : [];
  const { data, error } = await supabaseAdmin.from('sec_patrols').insert({
    id: genId('PAT'),
    property_id: propertyId || null,
    officer: officer.trim(),
    route: route.trim(),
    status: status || 'Scheduled',
    progress: progress ?? 0,
    last_checkpoint: lastCheckpoint || null,
    scheduled_start: scheduledStart || null,
    scheduled_end: scheduledEnd || null,
    shift: shift || null,
    notes: notes || null,
    checkpoint_total: cps.length,
    checkpoint_done: 0,
    started_at: status === 'In Progress' ? new Date().toISOString() : null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (cps.length > 0) {
    await supabaseAdmin.from('sec_patrol_checkpoints').insert(
      cps.filter(c => c.name?.trim()).map((c, i) => ({
        patrol_id: data.id,
        name: c.name.trim(),
        location: c.location || route.trim(),
        order_no: i + 1,
      }))
    );
  }
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/soc/patrols/:id — patrol + checkpoints
router.get('/soc/patrols/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [p, cps] = await Promise.all([
    supabaseAdmin.from('sec_patrols').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_patrol_checkpoints').select('*').eq('patrol_id', req.params.id).order('order_no', { ascending: true }),
  ]);
  if (p.error) return res.status(p.error.code === 'PGRST116' ? 404 : 500).json({ error: p.error.code === 'PGRST116' ? 'Patrol not found' : p.error.message });
  return res.json({ patrol: p.data, checkpoints: cps.data || [] });
});

// PATCH /api/sec-portal/soc/patrols/:id
router.patch('/soc/patrols/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { officer, route, status, progress, lastCheckpoint,
          scheduledStart, scheduledEnd, shift, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof officer === 'string') patch.officer = officer;
  if (typeof route === 'string') patch.route = route;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Completed') { patch.progress = 100; patch.ended_at = new Date().toISOString(); }
    if (status === 'In Progress') patch.started_at = new Date().toISOString();
  }
  if (progress !== undefined) patch.progress = progress;
  if (lastCheckpoint !== undefined) patch.last_checkpoint = lastCheckpoint || null;
  if (scheduledStart !== undefined) patch.scheduled_start = scheduledStart || null;
  if (scheduledEnd !== undefined) patch.scheduled_end = scheduledEnd || null;
  if (shift !== undefined) patch.shift = shift || null;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_patrols').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Patrol not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, patrol: data });
});

// POST /api/sec-portal/soc/patrols/:id/scan — QR/NFC checkpoint scan
router.post('/soc/patrols/:id/scan', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { checkpointId } = req.body || {};
  if (!checkpointId) return res.status(400).json({ error: 'checkpointId is required' });
  const { data: cp, error: cpErr } = await supabaseAdmin
    .from('sec_patrol_checkpoints')
    .update({ scanned_at: new Date().toISOString(), scanned_by: actorName(req) })
    .eq('id', checkpointId)
    .eq('patrol_id', req.params.id)
    .is('scanned_at', null)
    .select()
    .single();
  if (cpErr) {
    if (cpErr.code === 'PGRST116') return res.status(404).json({ error: 'Checkpoint not found or already scanned' });
    return res.status(500).json({ error: cpErr.message });
  }
  const { count } = await supabaseAdmin
    .from('sec_patrol_checkpoints')
    .select('*', { count: 'exact', head: true })
    .eq('patrol_id', req.params.id)
    .not('scanned_at', 'is', null);
  const { data: patrol } = await supabaseAdmin.from('sec_patrols').select('checkpoint_total').eq('id', req.params.id).single();
  const total = patrol?.checkpoint_total || 0;
  const done = count || 0;
  const patch: Record<string, any> = {
    checkpoint_done: done,
    last_checkpoint: cp.name,
    progress: total > 0 ? Math.round((done / total) * 100) : 0,
    status: done >= total && total > 0 ? 'Completed' : 'In Progress',
  };
  if (patch.status === 'Completed') patch.ended_at = new Date().toISOString();
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('sec_patrols').update(patch).eq('id', req.params.id).select().single();
  if (upErr) return res.status(500).json({ error: upErr.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, patrol: updated, checkpoint: cp });
});

// DELETE /api/sec-portal/soc/patrols/:id
router.delete('/soc/patrols/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_patrols').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── CCTV cameras ─────────────────────────────────────────────────────────

// GET /api/sec-portal/soc/cctv?propertyId=&status=
router.get('/soc/cctv', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_cctv_cameras').select('*').order('name', { ascending: true });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/soc/cctv
router.post('/soc/cctv', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, location, status, recording, ipAddress, health,
          retentionDays, resolution, model } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  const { data, error } = await supabaseAdmin.from('sec_cctv_cameras').insert({
    id: genId('CAM'),
    property_id: propertyId || null,
    name: name.trim(),
    location: location.trim(),
    status: status || 'Online',
    recording: recording ?? false,
    ip_address: ipAddress || null,
    health: health || 'Good',
    retention_days: retentionDays ?? 30,
    resolution: resolution || '1080p',
    model: model || null,
    last_motion_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/soc/cctv/:id — camera + event log
router.get('/soc/cctv/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [c, events] = await Promise.all([
    supabaseAdmin.from('sec_cctv_cameras').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_cctv_events').select('*').eq('camera_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (c.error) return res.status(c.error.code === 'PGRST116' ? 404 : 500).json({ error: c.error.code === 'PGRST116' ? 'Camera not found' : c.error.message });
  return res.json({ camera: c.data, events: events.data || [] });
});

// PATCH /api/sec-portal/soc/cctv/:id
router.patch('/soc/cctv/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, location, status, recording, ipAddress, health,
          retentionDays, resolution, model, lastMotionAt } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof location === 'string') patch.location = location;
  if (typeof status === 'string') patch.status = status;
  if (typeof recording === 'boolean') patch.recording = recording;
  if (ipAddress !== undefined) patch.ip_address = ipAddress || null;
  if (typeof health === 'string') patch.health = health;
  if (retentionDays !== undefined) patch.retention_days = retentionDays;
  if (typeof resolution === 'string') patch.resolution = resolution;
  if (model !== undefined) patch.model = model || null;
  if (lastMotionAt !== undefined) patch.last_motion_at = lastMotionAt || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_cctv_cameras').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Camera not found' });
  if (typeof recording === 'boolean') {
    await logCctvEvent(req.params.id, recording ? 'Recording Started' : 'Recording Stopped', null, actorName(req));
  } else if (typeof status === 'string') {
    await logCctvEvent(req.params.id, 'Status Change', `Status changed to ${status}`, actorName(req));
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, camera: data });
});

// POST /api/sec-portal/soc/cctv/:id/events — log Motion/Snapshot/Playback/etc
router.post('/soc/cctv/:id/events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { eventType, detail } = req.body || {};
  const { data, error } = await supabaseAdmin.from('sec_cctv_events').insert({
    camera_id: req.params.id,
    event_type: eventType || 'Note',
    detail: detail || null,
    actor: actorName(req),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (eventType === 'Motion Detected') {
    await supabaseAdmin.from('sec_cctv_cameras')
      .update({ last_motion_at: data.created_at })
      .eq('id', req.params.id);
  }
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

function logCctvEvent(cameraId: string, eventType: string, detail: string | null, actor?: string) {
  if (!supabaseAdmin) return Promise.resolve();
  return supabaseAdmin.from('sec_cctv_events').insert({
    camera_id: cameraId, event_type: eventType, detail, actor: actor || null,
  }).then(({ error }: any) => {
    if (error) console.warn(`[sec-portal] cctv event log failed for ${cameraId}:`, error.message);
  });
}

// DELETE /api/sec-portal/soc/cctv/:id
router.delete('/soc/cctv/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_cctv_cameras').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Alarms ───────────────────────────────────────────────────────────────

// GET /api/sec-portal/soc/alarms?propertyId=&status=
router.get('/soc/alarms', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_alarms').select('*').order('triggered_at', { ascending: false });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/soc/alarms
router.post('/soc/alarms', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, alarmType, location, status } = req.body || {};
  if (!alarmType?.trim()) return res.status(400).json({ error: 'alarmType is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  const { data, error } = await supabaseAdmin.from('sec_alarms').insert({
    id: genId('ALM'),
    property_id: propertyId || null,
    alarm_type: alarmType.trim(),
    location: location.trim(),
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/soc/alarms/:id
router.patch('/soc/alarms/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { alarmType, location, status, acknowledged } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof alarmType === 'string') patch.alarm_type = alarmType;
  if (typeof location === 'string') patch.location = location;
  if (typeof status === 'string') patch.status = status;
  if (typeof acknowledged === 'boolean') {
    patch.acknowledged = acknowledged;
    patch.acknowledged_at = acknowledged ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_alarms').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alarm not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, alarm: data });
});

// DELETE /api/sec-portal/soc/alarms/:id
router.delete('/soc/alarms/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_alarms').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Access control events ────────────────────────────────────────────────

// GET /api/sec-portal/soc/access-events?propertyId=&status=
router.get('/soc/access-events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_access_events').select('*').order('occurred_at', { ascending: false });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/soc/access-events
router.post('/soc/access-events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, eventType, userName, location, status } = req.body || {};
  if (!eventType?.trim()) return res.status(400).json({ error: 'eventType is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  const { data, error } = await supabaseAdmin.from('sec_access_events').insert({
    id: genId('ACC'),
    property_id: propertyId || null,
    event_type: eventType.trim(),
    user_name: userName || null,
    location: location.trim(),
    status: status || 'Normal',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/soc/access-events/:id
router.patch('/soc/access-events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { eventType, userName, location, status } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof eventType === 'string') patch.event_type = eventType;
  if (userName !== undefined) patch.user_name = userName || null;
  if (typeof location === 'string') patch.location = location;
  if (typeof status === 'string') patch.status = status;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_access_events').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Access event not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, event: data });
});

// DELETE /api/sec-portal/soc/access-events/:id
router.delete('/soc/access-events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_access_events').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Hardware / IoT ingestion ─────────────────────────────────────────────
// External systems (access-control panels, alarm gateways, CCTV NVRs) push
// events here instead of going through the browser session. They authenticate
// with an `x-api-key` header — keys are issued in Admin → API Management and
// must carry the `security:ingest` scope (or `*`).
//
// Both endpoints accept a single object OR { events: [...] } for batched
// gateway pushes. snake_case and camelCase field names are both accepted.
// When `externalId` is supplied, ingestion is idempotent: a row with the same
// (source, external_id) already in the table is skipped (migration 625).

const ingestRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  key: (req: any) => String(req.headers['x-api-key'] || req.ip || 'unknown'),
  message: 'Ingestion rate limit exceeded — max 120 requests/min per API key',
});

async function requireIngestKey(req: any, res: any, next: any) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const raw = req.headers['x-api-key'];
  if (typeof raw !== 'string' || !raw.trim()) {
    return res.status(401).json({ error: 'x-api-key header is required' });
  }
  const keyHash = crypto.createHash('sha256').update(raw.trim()).digest('hex');
  const { data: key, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, name, scopes, disabled, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!key || key.disabled) return res.status(401).json({ error: 'Invalid API key' });
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return res.status(401).json({ error: 'API key expired' });
  }
  const scopes: string[] = key.scopes || [];
  if (!scopes.includes('*') && !scopes.includes('security:ingest')) {
    return res.status(403).json({ error: 'API key lacks the security:ingest scope' });
  }
  req.apiKey = key;
  // Best-effort last_used bookkeeping — never block ingestion on it.
  supabaseAdmin.from('api_keys').update({ last_used: new Date().toISOString() }).eq('id', key.id).then(() => {});
  next();
}

// Normalize one ingested payload (snake_case or camelCase) to a table row.
// `required` lists the camelCase field names that must be non-empty.
function normalizeIngestItem(raw: any, map: Record<string, string>, required: string[], defaults: Record<string, any>) {
  if (!raw || typeof raw !== 'object') return { error: 'item must be an object' };
  const row: Record<string, any> = {};
  for (const [col, field] of Object.entries(map)) {
    const snake = col;
    const v = raw[field] ?? raw[snake];
    if (v !== undefined && v !== null) row[col] = typeof v === 'string' ? v.trim() : v;
  }
  for (const [col, v] of Object.entries(defaults)) {
    if (row[col] === undefined || row[col] === null || row[col] === '') row[col] = v;
  }
  for (const [col, field] of Object.entries(map)) {
    if (required.includes(field) && (!row[col] || row[col] === '')) {
      return { error: `${field} is required` };
    }
  }
  return { row };
}

// Insert a batch into `table`, deduplicating on (source, external_id).
async function ingestBatch(table: string, prefix: string, map: Record<string, string>, required: string[], req: any, res: any) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body;
  const items = Array.isArray(body) ? body : (Array.isArray(body?.events) ? body.events : [body]);
  const source = req.apiKey?.name || 'external';

  const rows: { row: Record<string, any>; idx: number }[] = [];
  const invalid: { index: number; error: string }[] = [];
  items.forEach((item: any, i: number) => {
    const { row, error } = normalizeIngestItem(item, map, required, { source });
    if (error || !row) invalid.push({ index: i, error: error || 'invalid item' });
    else {
      row.id = genId(prefix);
      if (!row.triggered_at && !row.occurred_at) {
        row[table === 'sec_alarms' ? 'triggered_at' : 'occurred_at'] = new Date().toISOString();
      }
      rows.push({ row, idx: i });
    }
  });
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No valid items to ingest', invalid });
  }

  // Pre-filter rows whose (source, external_id) already exists.
  let toInsert = rows;
  let skipped = 0;
  const extIds = rows.map(r => r.row.external_id).filter(Boolean);
  if (extIds.length > 0) {
    const { data: existing } = await supabaseAdmin
      .from(table).select('source, external_id')
      .eq('source', source).in('external_id', extIds);
    const seen = new Set((existing || []).map((e: any) => e.external_id));
    toInsert = rows.filter(r => !r.row.external_id || !seen.has(r.row.external_id));
    skipped = rows.length - toInsert.length;
  }

  // Per-row insert so one bad row can't sink the batch; a unique-violation
  // (concurrent retry) counts as skipped.
  let inserted = 0;
  const failed: { index: number; error: string }[] = [];
  for (const { row, idx } of toInsert) {
    const { error } = await supabaseAdmin.from(table).insert(row);
    if (!error) inserted++;
    else if (error.code === '23505') skipped++;
    else failed.push({ index: idx, error: error.message });
  }

  cacheService.invalidate('sec-*');
  writeAuditEvent({
    req,
    user: null,
    action: 'ingest.batch',
    module: 'security',
    entityType: table.replace('sec_', ''),
    outcome: failed.length === 0 ? 'success' : 'failure',
    details: {
      apiKey: req.apiKey?.name || null,
      received: items.length,
      inserted,
      skipped,
      invalid: invalid.length,
      failed: failed.length,
    },
  }).catch(() => {});

  return res.status(failed.length > 0 ? 207 : 201).json({
    inserted,
    skipped,
    ...(invalid.length > 0 && { invalid }),
    ...(failed.length > 0 && { failed }),
  });
}

// POST /api/sec-portal/ingest/alarms
// Body: { alarmType, location, status?, triggeredAt?, propertyId?, externalId?, source? }
//    or { events: [...] } / [ ... ] for batches.
router.post('/ingest/alarms', ingestRateLimit, requireIngestKey, (req, res) =>
  ingestBatch('sec_alarms', 'ALM', {
    alarm_type: 'alarmType',
    location: 'location',
    status: 'status',
    triggered_at: 'triggeredAt',
    property_id: 'propertyId',
    source: 'source',
    external_id: 'externalId',
  }, ['alarmType', 'location'], req, res));

// POST /api/sec-portal/ingest/access-events
// Body: { eventType, location, userName?, status?, occurredAt?, propertyId?, externalId?, source? }
router.post('/ingest/access-events', ingestRateLimit, requireIngestKey, (req, res) =>
  ingestBatch('sec_access_events', 'ACC', {
    event_type: 'eventType',
    user_name: 'userName',
    location: 'location',
    status: 'status',
    occurred_at: 'occurredAt',
    property_id: 'propertyId',
    source: 'source',
    external_id: 'externalId',
  }, ['eventType', 'location'], req, res));

// ── Emergency notifications ──────────────────────────────────────────────

// GET /api/sec-portal/soc/emergency?propertyId=&status=
router.get('/soc/emergency', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_emergency_notifications').select('*').order('occurred_at', { ascending: false });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/soc/emergency
router.post('/soc/emergency', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, emergencyType, location, status, priority,
          description, commander, responseTeam, evacuation } = req.body || {};
  if (!emergencyType?.trim()) return res.status(400).json({ error: 'emergencyType is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  const { data, error } = await supabaseAdmin.from('sec_emergency_notifications').insert({
    id: genId('EMG'),
    property_id: propertyId || null,
    emergency_type: emergencyType.trim(),
    location: location.trim(),
    status: status || 'Active',
    priority: priority || 'High',
    description: description || null,
    commander: commander || null,
    response_team: responseTeam || null,
    evacuation: evacuation || 'Not Required',
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logEmergencyResponse(data.id, 'Alert Raised', `${data.emergency_type} — ${data.location}`, actorName(req));
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/soc/emergency/:id — emergency + response log
router.get('/soc/emergency/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [e, log] = await Promise.all([
    supabaseAdmin.from('sec_emergency_notifications').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_emergency_responses').select('*').eq('emergency_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (e.error) return res.status(e.error.code === 'PGRST116' ? 404 : 500).json({ error: e.error.code === 'PGRST116' ? 'Emergency not found' : e.error.message });
  return res.json({ emergency: e.data, responses: log.data || [] });
});

// PATCH /api/sec-portal/soc/emergency/:id
router.patch('/soc/emergency/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { emergencyType, location, status, priority,
          description, commander, responseTeam, evacuation } = req.body || {};
  const patch: Record<string, any> = {};
  const logs: Array<{ action: string; detail?: string | null }> = [];
  if (typeof emergencyType === 'string') patch.emergency_type = emergencyType;
  if (typeof location === 'string') patch.location = location;
  if (typeof priority === 'string') patch.priority = priority;
  if (description !== undefined) patch.description = description || null;
  if (responseTeam !== undefined) {
    patch.response_team = responseTeam || null;
    logs.push({ action: 'Team Dispatched', detail: responseTeam ? `Response team: ${responseTeam}` : 'Response team cleared' });
  }
  if (commander !== undefined) {
    patch.commander = commander || null;
    if (commander) logs.push({ action: 'Commander Assigned', detail: `Incident commander: ${commander}` });
  }
  if (evacuation !== undefined) {
    patch.evacuation = evacuation;
    if (evacuation === 'In Progress') logs.push({ action: 'Evacuation Ordered', detail: 'Evacuation in progress' });
    if (evacuation === 'Complete') logs.push({ action: 'Evacuation Complete', detail: 'Evacuation sweep complete' });
  }
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Resolved') {
      patch.resolved_at = new Date().toISOString();
      logs.push({ action: 'Resolved', detail: 'Emergency resolved' });
    } else {
      logs.push({ action: 'Status Update', detail: `Status changed to ${status}` });
    }
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_emergency_notifications').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Emergency notification not found' });
  for (const l of logs) await logEmergencyResponse(req.params.id, l.action, l.detail || null, actorName(req));
  cacheService.invalidate('sec-*');
  return res.json({ success: true, emergency: data });
});

// POST /api/sec-portal/soc/emergency/:id/responses — manual response log entry
router.post('/soc/emergency/:id/responses', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, detail } = req.body || {};
  if (!action?.trim()) return res.status(400).json({ error: 'action is required' });
  const { data, error } = await supabaseAdmin.from('sec_emergency_responses').insert({
    emergency_id: req.params.id,
    action: action.trim(),
    detail: detail || null,
    actor: actorName(req),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

function logEmergencyResponse(emergencyId: string, action: string, detail: string | null, actor?: string) {
  if (!supabaseAdmin) return Promise.resolve();
  return supabaseAdmin.from('sec_emergency_responses').insert({
    emergency_id: emergencyId, action, detail, actor: actor || null,
  }).then(({ error }: any) => {
    if (error) console.warn(`[sec-portal] emergency response log failed for ${emergencyId}:`, error.message);
  });
}

// DELETE /api/sec-portal/soc/emergency/:id
router.delete('/soc/emergency/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_emergency_notifications').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Security staff ───────────────────────────────────────────────────────
// Backs the /erp/security/staff tab (StaffManagement.tsx).

// GET /api/sec-portal/staff?propertyId=&role=&shift=&status=
router.get('/staff', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_staff').select('*').eq('is_active', true).order('name', { ascending: true });
  const { propertyId, role, shift, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (role) q = q.eq('role', role);
  if (shift) q = q.eq('shift', shift);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/staff
router.post('/staff', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, role, status, shift, location, radioChannel, phone, email, employeeId, hireDate } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const avatar = name.trim().split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
  const { data, error } = await supabaseAdmin.from('sec_staff').insert({
    id: genId('STF'),
    property_id: propertyId || null,
    name: name.trim(),
    avatar,
    role: role || 'Security Officer',
    status: status || 'Off Duty',
    is_active: true,
    location: location || null,
    shift: shift || 'Day',
    radio_channel: radioChannel || null,
    phone: phone || null,
    email: email || null,
    employee_id: employeeId || null,
    hire_date: hireDate || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/staff/:id
router.patch('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, role, status, shift, location, radioChannel, phone, email, employeeId, isActive } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') { patch.name = name; patch.avatar = name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(); }
  if (typeof role === 'string') patch.role = role;
  if (typeof status === 'string') patch.status = status;
  if (typeof shift === 'string') patch.shift = shift;
  if (location !== undefined) patch.location = location || null;
  if (radioChannel !== undefined) patch.radio_channel = radioChannel || null;
  if (phone !== undefined) patch.phone = phone || null;
  if (email !== undefined) patch.email = email || null;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (typeof isActive === 'boolean') patch.is_active = isActive;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_staff').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Staff member not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, staff: data });
});

// DELETE /api/sec-portal/staff/:id — soft delete (is_active = false)
router.delete('/staff/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('sec_staff')
    .update({ is_active: false }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Staff member not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Investigations ───────────────────────────────────────────────────────
// Backs the /erp/security/investigations tab (Investigations.tsx).
// Cases link to sec_incidents via incident_id (nullable FK). Witness and
// evidence counts are embedded via PostgREST (count) embeds.

const actorName = (req: any) => req.user?.name || req.user?.email || 'Security';

function logCaseActivity(caseId: string, activityType: string, description: string, actor?: string) {
  if (!supabaseAdmin) return Promise.resolve();
  return supabaseAdmin.from('sec_investigation_activities').insert({
    case_id: caseId, activity_type: activityType, description, actor: actor || null,
  }).then(({ error }: any) => {
    if (error) console.warn(`[sec-portal] activity log failed for ${caseId}:`, error.message);
  });
}

// GET /api/sec-portal/investigations?propertyId=&status=&priority=
router.get('/investigations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_investigations')
    .select('*, witnesses:sec_investigation_witnesses(count), evidence:sec_investigation_evidence(count)')
    .order('created_at', { ascending: false });
  const { propertyId, status, priority } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    witness_count: r.witnesses?.[0]?.count ?? 0,
    evidence_count: r.evidence?.[0]?.count ?? 0,
    witnesses: undefined,
    evidence: undefined,
  }));
  return res.json(rows);
});

// GET /api/sec-portal/investigations/:id — case + witnesses + evidence + timeline
router.get('/investigations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const id = req.params.id;
  const [c, witnesses, evidence, activities] = await Promise.all([
    supabaseAdmin.from('sec_investigations').select('*').eq('id', id).single(),
    supabaseAdmin.from('sec_investigation_witnesses').select('*').eq('case_id', id).order('created_at', { ascending: true }),
    supabaseAdmin.from('sec_investigation_evidence').select('*').eq('case_id', id).order('collected_at', { ascending: true }),
    supabaseAdmin.from('sec_investigation_activities').select('*').eq('case_id', id).order('created_at', { ascending: true }),
  ]);
  if (c.error) return res.status(c.error.code === 'PGRST116' ? 404 : 500).json({ error: c.error.code === 'PGRST116' ? 'Case not found' : c.error.message });
  return res.json({
    case: c.data,
    witnesses: witnesses.data || [],
    evidence: evidence.data || [],
    activities: activities.data || [],
  });
});

// POST /api/sec-portal/investigations
router.post('/investigations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, incidentId, description, leadInvestigator, priority, status, targetDate } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_investigations').insert({
    id: genId('INV'),
    property_id: propertyId || null,
    title: title.trim(),
    incident_id: incidentId || null,
    description: description || null,
    lead_investigator: leadInvestigator || null,
    priority: priority || 'Medium',
    status: status || 'Open',
    target_date: targetDate || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logCaseActivity(data.id, 'Case Opened', `Case opened — ${data.title}`, actorName(req));
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/investigations/:id
router.patch('/investigations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const id = req.params.id;
  const { title, incidentId, description, leadInvestigator, priority, status, targetDate } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (incidentId !== undefined) patch.incident_id = incidentId || null;
  if (description !== undefined) patch.description = description || null;
  if (leadInvestigator !== undefined) patch.lead_investigator = leadInvestigator || null;
  if (typeof priority === 'string') patch.priority = priority;
  if (typeof status === 'string') patch.status = status;
  if (targetDate !== undefined) patch.target_date = targetDate || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_investigations').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Case not found' });
  if (typeof status === 'string') {
    await logCaseActivity(
      id,
      status === 'Closed' ? 'Case Closed' : 'Status Change',
      `Status changed to ${status}`,
      actorName(req),
    );
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, case: data });
});

// DELETE /api/sec-portal/investigations/:id — child rows cascade
router.delete('/investigations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_investigations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// POST /api/sec-portal/investigations/:id/witnesses
router.post('/investigations/:id/witnesses', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, contact, statement } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin.from('sec_investigation_witnesses').insert({
    case_id: req.params.id,
    name: name.trim(),
    contact: contact || null,
    statement: statement || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logCaseActivity(req.params.id, 'Witness Added', `Witness added — ${data.name}`, actorName(req));
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/investigations/:id/witnesses/:witnessId
router.delete('/investigations/:id/witnesses/:witnessId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_investigation_witnesses')
    .delete().eq('id', req.params.witnessId).eq('case_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// POST /api/sec-portal/investigations/:id/evidence
router.post('/investigations/:id/evidence', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { itemType, description, collectedBy } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
  const { data, error } = await supabaseAdmin.from('sec_investigation_evidence').insert({
    case_id: req.params.id,
    item_type: itemType || 'Document',
    description: description.trim(),
    collected_by: collectedBy || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logCaseActivity(req.params.id, 'Evidence Added', `Evidence added — ${data.description}`, actorName(req));
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/investigations/:id/evidence/:evidenceId
router.delete('/investigations/:id/evidence/:evidenceId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_investigation_evidence')
    .delete().eq('id', req.params.evidenceId).eq('case_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// POST /api/sec-portal/investigations/:id/notes — append a Note to the timeline
router.post('/investigations/:id/notes', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { note } = req.body || {};
  if (!note?.trim()) return res.status(400).json({ error: 'note is required' });
  const { data, error } = await supabaseAdmin.from('sec_investigation_activities').insert({
    case_id: req.params.id,
    activity_type: 'Note',
    description: note.trim(),
    actor: actorName(req),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Visitors ─────────────────────────────────────────────────────────────
// Backs the /erp/security/visitors tab (VisitorManagement.tsx).
// Check-in/check-out also logs a sec_access_events row so visitor movements
// surface in the SOC access-control feed.

function logVisitorAccessEvent(propertyId: string | null, eventType: string, visitorName: string, status: string) {
  if (!supabaseAdmin) return Promise.resolve();
  return supabaseAdmin.from('sec_access_events').insert({
    id: genId('ACC'),
    property_id: propertyId,
    event_type: eventType,
    user_name: visitorName,
    location: 'Main Entrance',
    status,
  }).then(({ error }: any) => {
    if (error) console.warn('[sec-portal] visitor access event log failed:', error.message);
  });
}

// GET /api/sec-portal/visitors?propertyId=&status=&type=
router.get('/visitors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_visitors').select('*').order('created_at', { ascending: false });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('visitor_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/visitors — register (auto-assigns a badge number)
router.post('/visitors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, company, visitorType, host, purpose, phone, email,
          expectedArrivalAt, expectedDepartureAt } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { count } = await supabaseAdmin.from('sec_visitors')
    .select('id', { count: 'exact', head: true });
  const badgeNumber = `BG-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(3, '0')}`;
  const { data, error } = await supabaseAdmin.from('sec_visitors').insert({
    id: genId('VIS'),
    property_id: propertyId || null,
    name: name.trim(),
    company: company || null,
    visitor_type: visitorType || 'General Visitor',
    host: host || null,
    purpose: purpose || null,
    status: 'Pre-registered',
    badge_number: badgeNumber,
    phone: phone || null,
    email: email || null,
    expected_arrival_at: expectedArrivalAt || null,
    expected_departure_at: expectedDepartureAt || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/visitors/:id — field edits + lifecycle transitions
router.patch('/visitors/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, company, visitorType, host, purpose, phone, email, status,
          expectedArrivalAt, expectedDepartureAt, blacklistStatus } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') patch.name = name;
  if (company !== undefined) patch.company = company || null;
  if (typeof visitorType === 'string') patch.visitor_type = visitorType;
  if (host !== undefined) patch.host = host || null;
  if (purpose !== undefined) patch.purpose = purpose || null;
  if (phone !== undefined) patch.phone = phone || null;
  if (email !== undefined) patch.email = email || null;
  if (expectedArrivalAt !== undefined) patch.expected_arrival_at = expectedArrivalAt || null;
  if (expectedDepartureAt !== undefined) patch.expected_departure_at = expectedDepartureAt || null;
  if (blacklistStatus !== undefined) patch.blacklist_status = blacklistStatus || 'Clear';
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Checked In') patch.check_in_at = new Date().toISOString();
    if (status === 'Checked Out') patch.check_out_at = new Date().toISOString();
    if (status === 'Blacklisted' && blacklistStatus === undefined) patch.blacklist_status = 'Blacklisted';
    if (status !== 'Blacklisted' && blacklistStatus === undefined) patch.blacklist_status = 'Clear';
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_visitors').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Visitor not found' });
  if (status === 'Checked In' || status === 'Checked Out') {
    await logVisitorAccessEvent(data.property_id, `Visitor ${status}`, data.name, 'Normal');
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, visitor: data });
});

// DELETE /api/sec-portal/visitors/:id
router.delete('/visitors/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_visitors').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Access grants ────────────────────────────────────────────────────────
// Backs the /erp/security/access-control tab (AccessControl.tsx).
// This is the access *permissions* register — distinct from
// sec_access_events (the SOC access event log).

// GET /api/sec-portal/access-grants?propertyId=&status=&type=
router.get('/access-grants', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_access_grants').select('*').order('created_at', { ascending: false });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('access_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/access-grants
router.post('/access-grants', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, userRef, userName, accessType, role, zones, doorCount,
          schedule, status, validFrom, validUntil } = req.body || {};
  if (!userName?.trim()) return res.status(400).json({ error: 'userName is required' });
  const { data, error } = await supabaseAdmin.from('sec_access_grants').insert({
    id: genId('AGR'),
    property_id: propertyId || null,
    user_ref: userRef || null,
    user_name: userName.trim(),
    access_type: accessType || 'Employee Access',
    role: role || null,
    zones: Array.isArray(zones) ? zones : [],
    door_count: doorCount ?? (Array.isArray(zones) ? zones.length : 0),
    schedule: schedule || '24-7',
    status: status || 'Active',
    valid_from: validFrom || null,
    valid_until: validUntil || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/access-grants/:id — edits + Suspend/Revoke/Reactivate
router.patch('/access-grants/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { userRef, userName, accessType, role, zones, doorCount, schedule,
          status, validFrom, validUntil, lastAccessAt, accessCount } = req.body || {};
  const patch: Record<string, any> = {};
  if (userRef !== undefined) patch.user_ref = userRef || null;
  if (typeof userName === 'string') patch.user_name = userName;
  if (typeof accessType === 'string') patch.access_type = accessType;
  if (role !== undefined) patch.role = role || null;
  if (Array.isArray(zones)) {
    patch.zones = zones;
    if (doorCount === undefined) patch.door_count = zones.length;
  }
  if (doorCount !== undefined) patch.door_count = doorCount;
  if (typeof schedule === 'string') patch.schedule = schedule;
  if (typeof status === 'string') patch.status = status;
  if (validFrom !== undefined) patch.valid_from = validFrom || null;
  if (validUntil !== undefined) patch.valid_until = validUntil || null;
  if (lastAccessAt !== undefined) patch.last_access_at = lastAccessAt || null;
  if (accessCount !== undefined) patch.access_count = accessCount;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_access_grants').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Access grant not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, grant: data });
});

// DELETE /api/sec-portal/access-grants/:id
router.delete('/access-grants/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_access_grants').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Keys & keycards ──────────────────────────────────────────────────────
// Backs the /erp/security/keys tab (KeyKeycardManagement.tsx).
// Lifecycle transitions (Issue/Return/Lost/Found/Damaged/Decommission)
// stamp dates server-side and append rows to sec_key_logs (audit trail).

function logKeyAction(keyId: string, action: string, detail: string | null, actor?: string) {
  if (!supabaseAdmin) return Promise.resolve();
  return supabaseAdmin.from('sec_key_logs').insert({
    key_id: keyId, action, detail, actor: actor || null,
  }).then(({ error }: any) => {
    if (error) console.warn(`[sec-portal] key log failed for ${keyId}:`, error.message);
  });
}

// GET /api/sec-portal/keys?propertyId=&status=&type=
router.get('/keys', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_keys').select('*').order('created_at', { ascending: false });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('key_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/sec-portal/keys/:id — key + audit trail
router.get('/keys/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [k, logs] = await Promise.all([
    supabaseAdmin.from('sec_keys').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_key_logs').select('*').eq('key_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (k.error) return res.status(k.error.code === 'PGRST116' ? 404 : 500).json({ error: k.error.code === 'PGRST116' ? 'Key not found' : k.error.message });
  return res.json({ key: k.data, logs: logs.data || [] });
});

// POST /api/sec-portal/keys — register a new key/card
router.post('/keys', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, keyType, keyNumber, assignedTo, department, accessLevel,
          status, location, returnDate } = req.body || {};
  if (!keyNumber?.trim()) return res.status(400).json({ error: 'keyNumber is required' });
  const { data, error } = await supabaseAdmin.from('sec_keys').insert({
    id: genId('KEY'),
    property_id: propertyId || null,
    key_type: keyType || 'Department Key',
    key_number: keyNumber.trim(),
    assigned_to: assignedTo || null,
    department: department || null,
    access_level: accessLevel || null,
    status: status || 'Available',
    issued_date: status === 'Issued' ? new Date().toISOString().slice(0, 10) : null,
    return_date: returnDate || null,
    last_audit_date: new Date().toISOString().slice(0, 10),
    location: location || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logKeyAction(data.id, 'Registered', `Key ${data.key_number} added to register`, actorName(req));
  if (data.status === 'Issued' && data.assigned_to) {
    await logKeyAction(data.id, 'Issued', `Issued to ${data.assigned_to}`, actorName(req));
  }
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/keys/:id — edits + lifecycle transitions
router.patch('/keys/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const id = req.params.id;
  const { keyType, keyNumber, assignedTo, department, accessLevel, status,
          location, returnDate, lastAuditDate, transitionNote } = req.body || {};
  const today = new Date().toISOString().slice(0, 10);
  const patch: Record<string, any> = {};
  const logs: { action: string; detail: string }[] = [];
  if (typeof keyType === 'string') patch.key_type = keyType;
  if (typeof keyNumber === 'string') patch.key_number = keyNumber;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (department !== undefined) patch.department = department || null;
  if (accessLevel !== undefined) patch.access_level = accessLevel || null;
  if (location !== undefined) patch.location = location || null;
  if (returnDate !== undefined) patch.return_date = returnDate || null;
  if (lastAuditDate !== undefined) {
    patch.last_audit_date = lastAuditDate || null;
    logs.push({ action: 'Audited', detail: 'Key audit completed' });
  }
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Issued') {
      patch.issued_date = today;
      patch.return_date = null;
      logs.push({ action: 'Issued', detail: `Issued to ${patch.assigned_to || 'holder'}${transitionNote ? ` — ${transitionNote}` : ''}` });
    } else if (status === 'Available') {
      patch.return_date = today;
      patch.assigned_to = null;
      logs.push({ action: 'Returned', detail: transitionNote || 'Key returned' });
    } else if (status === 'Lost') {
      logs.push({ action: 'Reported Lost', detail: transitionNote || 'Key reported lost' });
    } else if (status === 'Damaged') {
      logs.push({ action: 'Marked Damaged', detail: transitionNote || 'Key marked damaged' });
    } else if (status === 'Decommissioned') {
      logs.push({ action: 'Decommissioned', detail: transitionNote || 'Key decommissioned' });
    }
  } else if (Object.keys(patch).length > 0 && logs.length === 0) {
    logs.push({ action: 'Edited', detail: transitionNote || 'Key details updated' });
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_keys').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Key not found' });
  for (const l of logs) await logKeyAction(id, l.action, l.detail, actorName(req));
  cacheService.invalidate('sec-*');
  return res.json({ success: true, key: data });
});

// POST /api/sec-portal/keys/:id/found — Lost → Available (Reported Found log)
router.post('/keys/:id/found', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from('sec_keys').update({
    status: 'Available', assigned_to: null, return_date: today,
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Key not found' });
  await logKeyAction(req.params.id, 'Reported Found', 'Key reported found — returned to Available', actorName(req));
  cacheService.invalidate('sec-*');
  return res.json({ success: true, key: data });
});

// DELETE /api/sec-portal/keys/:id — audit rows cascade
router.delete('/keys/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_keys').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Lost & Found ─────────────────────────────────────────────────────────
// Backs the /erp/security/lost-found tab (LostFoundOversight.tsx).
// Cases carry a chain-of-custody log in sec_lostfound_custody (CASCADE).
// Status lifecycle: Reported → Found → In Storage → Claim Pending →
// Returned | Disposed. Lifecycle transitions auto-log custody actions.

function logCustody(caseId: string, action: string, fields?: { from?: string | null; to?: string | null; location?: string | null; note?: string | null; actor?: string | null }) {
  if (!supabaseAdmin) return Promise.resolve();
  return supabaseAdmin.from('sec_lostfound_custody').insert({
    case_id: caseId,
    action,
    from_person: fields?.from || null,
    to_person: fields?.to || null,
    location: fields?.location || null,
    note: fields?.note || null,
    actor: fields?.actor || null,
  }).then(({ error }: any) => {
    if (error) console.warn(`[sec-portal] custody log failed for ${caseId}:`, error.message);
  });
}

const CUSTODY_ACTION_BY_STATUS: Record<string, string> = {
  'Found': 'Item Found',
  'In Storage': 'Placed in Storage',
  'Claim Pending': 'Claim Submitted',
  'Returned': 'Released to Owner',
  'Disposed': 'Disposed',
};

// GET /api/sec-portal/lostfound?propertyId=&status=&category=
router.get('/lostfound', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_lostfound_cases').select('*').order('reported_at', { ascending: false });
  const { propertyId, status, category } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/lostfound
router.post('/lostfound', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, itemName, description, category, status,
          locationLost, locationFound, storageLocation,
          reportedBy, reporterContact, finderName,
          estimatedValue } = req.body || {};
  if (!itemName?.trim()) return res.status(400).json({ error: 'itemName is required' });
  const st = status || 'Reported';
  const { data, error } = await supabaseAdmin.from('sec_lostfound_cases').insert({
    id: genId('LF'),
    property_id: propertyId || null,
    item_name: itemName.trim(),
    description: description || null,
    category: category || 'Other',
    status: st,
    location_lost: locationLost || null,
    location_found: locationFound || null,
    storage_location: storageLocation || null,
    reported_by: reportedBy || null,
    reporter_contact: reporterContact || null,
    finder_name: finderName || null,
    estimated_value: estimatedValue ?? null,
    found_at: ['Found', 'In Storage', 'Claim Pending', 'Returned'].includes(st) ? new Date().toISOString() : null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logCustody(data.id, 'Registered', { note: `Case opened — ${st}`, actor: actorName(req) });
  if (st !== 'Reported') {
    await logCustody(data.id, CUSTODY_ACTION_BY_STATUS[st] || 'Note', { actor: actorName(req) });
  }
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/lostfound/:id — case + custody log
router.get('/lostfound/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [c, log] = await Promise.all([
    supabaseAdmin.from('sec_lostfound_cases').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_lostfound_custody').select('*').eq('case_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (c.error) return res.status(c.error.code === 'PGRST116' ? 404 : 500).json({ error: c.error.code === 'PGRST116' ? 'Case not found' : c.error.message });
  return res.json({ case: c.data, custody: log.data || [] });
});

// PATCH /api/sec-portal/lostfound/:id — field edits + lifecycle transitions
router.patch('/lostfound/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { itemName, description, category, status,
          locationLost, locationFound, storageLocation,
          reportedBy, reporterContact, finderName, claimedBy, claimNotes,
          estimatedValue, custodyNote } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof itemName === 'string') patch.item_name = itemName;
  if (description !== undefined) patch.description = description || null;
  if (typeof category === 'string') patch.category = category;
  if (locationLost !== undefined) patch.location_lost = locationLost || null;
  if (locationFound !== undefined) patch.location_found = locationFound || null;
  if (storageLocation !== undefined) patch.storage_location = storageLocation || null;
  if (reportedBy !== undefined) patch.reported_by = reportedBy || null;
  if (reporterContact !== undefined) patch.reporter_contact = reporterContact || null;
  if (finderName !== undefined) patch.finder_name = finderName || null;
  if (claimedBy !== undefined) patch.claimed_by = claimedBy || null;
  if (claimNotes !== undefined) patch.claim_notes = claimNotes || null;
  if (estimatedValue !== undefined) patch.estimated_value = estimatedValue;
  const custodyLogs: Array<{ action: string; fields?: any }> = [];
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Found' || status === 'In Storage') patch.found_at = new Date().toISOString();
    if (status === 'Claim Pending') patch.claimed_at = new Date().toISOString();
    if (status === 'Returned') patch.returned_at = new Date().toISOString();
    custodyLogs.push({
      action: CUSTODY_ACTION_BY_STATUS[status] || 'Note',
      fields: { note: custodyNote || `Status changed to ${status}`, actor: actorName(req) },
    });
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_lostfound_cases').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Case not found' });
  for (const l of custodyLogs) await logCustody(req.params.id, l.action, l.fields);
  cacheService.invalidate('sec-*');
  return res.json({ success: true, case: data });
});

// POST /api/sec-portal/lostfound/:id/custody — manual custody/note entry
router.post('/lostfound/:id/custody', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, from, to, location, note } = req.body || {};
  if (!action?.trim()) return res.status(400).json({ error: 'action is required' });
  const { data, error } = await supabaseAdmin.from('sec_lostfound_custody').insert({
    case_id: req.params.id,
    action: action.trim(),
    from_person: from || null,
    to_person: to || null,
    location: location || null,
    note: note || null,
    actor: actorName(req),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/lostfound/:id — custody rows cascade
router.delete('/lostfound/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_lostfound_cases').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Fire & Life Safety ───────────────────────────────────────────────────
// Backs the /erp/security/fire-safety tab (FireLifeSafety.tsx).
// sec_fire_equipment = register; sec_fire_activities = inspections, alarm
// tests, drills, maintenance. Completing an equipment-linked activity
// updates last_inspection/next_due and derives equipment status from result.

// GET /api/sec-portal/fire-equipment?propertyId=&status=&type=
router.get('/fire-equipment', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_fire_equipment').select('*').order('name', { ascending: true });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('equipment_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/fire-equipment
router.post('/fire-equipment', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, equipmentType, location, zone, status,
          serialNumber, model, installedDate, lastInspection, nextDue, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  const { data, error } = await supabaseAdmin.from('sec_fire_equipment').insert({
    id: genId('FE'),
    property_id: propertyId || null,
    name: name.trim(),
    equipment_type: equipmentType || 'Other',
    location: location.trim(),
    zone: zone || null,
    status: status || 'Operational',
    serial_number: serialNumber || null,
    model: model || null,
    installed_date: installedDate || null,
    last_inspection: lastInspection || null,
    next_due: nextDue || null,
    notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/fire-equipment/:id
router.patch('/fire-equipment/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, equipmentType, location, zone, status,
          serialNumber, model, installedDate, lastInspection, nextDue, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof equipmentType === 'string') patch.equipment_type = equipmentType;
  if (typeof location === 'string') patch.location = location;
  if (zone !== undefined) patch.zone = zone || null;
  if (typeof status === 'string') patch.status = status;
  if (serialNumber !== undefined) patch.serial_number = serialNumber || null;
  if (model !== undefined) patch.model = model || null;
  if (installedDate !== undefined) patch.installed_date = installedDate || null;
  if (lastInspection !== undefined) patch.last_inspection = lastInspection || null;
  if (nextDue !== undefined) patch.next_due = nextDue || null;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_fire_equipment').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Equipment not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, equipment: data });
});

// DELETE /api/sec-portal/fire-equipment/:id
router.delete('/fire-equipment/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_fire_equipment').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/fire-activities?propertyId=&status=&type=&equipmentId=
router.get('/fire-activities', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_fire_activities').select('*, sec_fire_equipment(name)').order('scheduled_at', { ascending: false });
  const { propertyId, status, type, equipmentId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('activity_type', type);
  if (equipmentId) q = q.eq('equipment_id', equipmentId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/fire-activities
router.post('/fire-activities', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, equipmentId, activityType, title, scope, status,
          inspector, scheduledAt, participants, evacuationTimeSec, findings } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!activityType) return res.status(400).json({ error: 'activityType is required' });
  const { data, error } = await supabaseAdmin.from('sec_fire_activities').insert({
    id: genId('FA'),
    property_id: propertyId || null,
    equipment_id: equipmentId || null,
    activity_type: activityType,
    title: title.trim(),
    scope: scope || null,
    status: status || 'Scheduled',
    inspector: inspector || null,
    scheduled_at: scheduledAt || null,
    participants: participants ?? null,
    evacuation_time_sec: evacuationTimeSec ?? null,
    findings: findings || null,
    created_by: req.user?.id,
  }).select('*, sec_fire_equipment(name)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/fire-activities/:id
router.patch('/fire-activities/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { equipmentId, activityType, title, scope, status, result,
          inspector, scheduledAt, participants, evacuationTimeSec, findings } = req.body || {};
  const patch: Record<string, any> = {};
  if (equipmentId !== undefined) patch.equipment_id = equipmentId || null;
  if (typeof activityType === 'string') patch.activity_type = activityType;
  if (typeof title === 'string') patch.title = title;
  if (scope !== undefined) patch.scope = scope || null;
  if (result !== undefined) patch.result = result || null;
  if (inspector !== undefined) patch.inspector = inspector || null;
  if (scheduledAt !== undefined) patch.scheduled_at = scheduledAt || null;
  if (participants !== undefined) patch.participants = participants;
  if (evacuationTimeSec !== undefined) patch.evacuation_time_sec = evacuationTimeSec;
  if (findings !== undefined) patch.findings = findings || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Completed') patch.completed_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_fire_activities').update(patch).eq('id', req.params.id).select('*, sec_fire_equipment(name)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Activity not found' });
  // Completing an equipment-linked inspection updates the equipment record
  if (patch.status === 'Completed' && data.equipment_id && (data.activity_type === 'Inspection' || data.activity_type === 'Alarm Test')) {
    const today = new Date().toISOString().slice(0, 10);
    const eqPatch: Record<string, any> = {
      last_inspection: today,
      status: patch.result === 'Fail' ? 'Needs Service' : 'Operational',
    };
    const { data: eq } = await supabaseAdmin.from('sec_fire_equipment').select('next_due').eq('id', data.equipment_id).single();
    if (eq?.next_due) {
      // roll next_due forward by its prior interval (default ~90 days)
      const next = new Date(today);
      next.setDate(next.getDate() + 90);
      eqPatch.next_due = next.toISOString().slice(0, 10);
    }
    await supabaseAdmin.from('sec_fire_equipment').update(eqPatch).eq('id', data.equipment_id);
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, activity: data });
});

// DELETE /api/sec-portal/fire-activities/:id
router.delete('/fire-activities/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_fire_activities').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Risk Management ──────────────────────────────────────────────────────
// Backs the /erp/security/risk tab (RiskManagement.tsx).
// sec_risks = enterprise risk register; risk_score = likelihood × impact and
// risk_level is derived server-side (1–4 Low, 5–9 Medium, 10–15 High,
// 16–25 Critical). sec_risk_actions = per-risk mitigation checklist +
// review log, CASCADE on risk delete.

function riskLevel(score: number): string {
  if (score >= 16) return 'Critical';
  if (score >= 10) return 'High';
  if (score >= 5) return 'Medium';
  return 'Low';
}

// GET /api/sec-portal/risks?propertyId=&status=&level=&category=
router.get('/risks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_risks').select('*').order('risk_score', { ascending: false });
  const { propertyId, status, level, category } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (level) q = q.eq('risk_level', level);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/risks
router.post('/risks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, description, category, likelihood, impact,
          status, owner, mitigationPlan, nextReview } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const l = Math.min(5, Math.max(1, likelihood ?? 2));
  const i = Math.min(5, Math.max(1, impact ?? 2));
  const score = l * i;
  const { data, error } = await supabaseAdmin.from('sec_risks').insert({
    id: genId('RSK'),
    property_id: propertyId || null,
    title: title.trim(),
    description: description || null,
    category: category || 'Operational',
    likelihood: l,
    impact: i,
    risk_score: score,
    risk_level: riskLevel(score),
    status: status || 'Open',
    owner: owner || null,
    mitigation_plan: mitigationPlan || null,
    next_review: nextReview || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/risks/:id — risk + mitigation actions
router.get('/risks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [r, actions] = await Promise.all([
    supabaseAdmin.from('sec_risks').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_risk_actions').select('*').eq('risk_id', req.params.id).order('created_at', { ascending: true }),
  ]);
  if (r.error) return res.status(r.error.code === 'PGRST116' ? 404 : 500).json({ error: r.error.code === 'PGRST116' ? 'Risk not found' : r.error.message });
  return res.json({ risk: r.data, actions: actions.data || [] });
});

// PATCH /api/sec-portal/risks/:id
router.patch('/risks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, description, category, likelihood, impact,
          status, owner, mitigationPlan, nextReview } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (description !== undefined) patch.description = description || null;
  if (typeof category === 'string') patch.category = category;
  if (owner !== undefined) patch.owner = owner || null;
  if (mitigationPlan !== undefined) patch.mitigation_plan = mitigationPlan || null;
  if (nextReview !== undefined) patch.next_review = nextReview || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Closed') patch.closed_at = new Date().toISOString();
    if (status !== 'Closed') patch.closed_at = null;
  }
  if (likelihood !== undefined || impact !== undefined) {
    const { data: cur } = await supabaseAdmin.from('sec_risks').select('likelihood, impact').eq('id', req.params.id).single();
    if (!cur) return res.status(404).json({ error: 'Risk not found' });
    const l = Math.min(5, Math.max(1, likelihood ?? cur.likelihood));
    const i = Math.min(5, Math.max(1, impact ?? cur.impact));
    patch.likelihood = l;
    patch.impact = i;
    patch.risk_score = l * i;
    patch.risk_level = riskLevel(patch.risk_score);
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_risks').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Risk not found' });
  if (typeof status === 'string') {
    await supabaseAdmin.from('sec_risk_actions').insert({
      risk_id: req.params.id,
      action: 'Status Change',
      description: `Status changed to ${status}`,
      actor: actorName(req),
      done: true,
      completed_at: new Date().toISOString(),
    });
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, risk: data });
});

// POST /api/sec-portal/risks/:id/actions — add mitigation action / note
router.post('/risks/:id/actions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, description, owner, dueDate } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
  const { data, error } = await supabaseAdmin.from('sec_risk_actions').insert({
    risk_id: req.params.id,
    action: action || 'Mitigation Action',
    description: description.trim(),
    owner: owner || null,
    due_date: dueDate || null,
    actor: actorName(req),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/risks/:id/actions/:actionId — toggle done
router.patch('/risks/:id/actions/:actionId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { done } = req.body || {};
  if (typeof done !== 'boolean') return res.status(400).json({ error: 'done (boolean) is required' });
  const { data, error } = await supabaseAdmin.from('sec_risk_actions').update({
    done,
    completed_at: done ? new Date().toISOString() : null,
  }).eq('id', req.params.actionId).eq('risk_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Action not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, action: data });
});

// DELETE /api/sec-portal/risks/:id — action rows cascade
router.delete('/risks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_risks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Business Continuity ──────────────────────────────────────────────────
// Backs the /erp/security/business-continuity tab (BusinessContinuity.tsx).
// sec_bcp_plans = continuity/DR plan register; sec_bcp_exercises = test log,
// CASCADE on plan delete. Completing an exercise stamps last_tested and
// rolls next_test_due +365 days on the parent plan.

// GET /api/sec-portal/bcp/plans?propertyId=&status=&type=
router.get('/bcp/plans', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_bcp_plans').select('*').order('criticality', { ascending: true });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('plan_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/bcp/plans
router.post('/bcp/plans', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, planType, criticality, status, owner,
          scope, activationTrigger, recoverySteps, rtoHours, rpoHours,
          version, nextTestDue, reviewDate } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_bcp_plans').insert({
    id: genId('BCP'),
    property_id: propertyId || null,
    title: title.trim(),
    plan_type: planType || 'Business Continuity',
    criticality: criticality || 'Medium',
    status: status || 'Draft',
    owner: owner || null,
    scope: scope || null,
    activation_trigger: activationTrigger || null,
    recovery_steps: recoverySteps || null,
    rto_hours: rtoHours ?? null,
    rpo_hours: rpoHours ?? null,
    version: version || '1.0',
    next_test_due: nextTestDue || null,
    review_date: reviewDate || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/bcp/plans/:id — plan + exercises
router.get('/bcp/plans/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [p, ex] = await Promise.all([
    supabaseAdmin.from('sec_bcp_plans').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_bcp_exercises').select('*').eq('plan_id', req.params.id).order('scheduled_at', { ascending: false }),
  ]);
  if (p.error) return res.status(p.error.code === 'PGRST116' ? 404 : 500).json({ error: p.error.code === 'PGRST116' ? 'Plan not found' : p.error.message });
  return res.json({ plan: p.data, exercises: ex.data || [] });
});

// PATCH /api/sec-portal/bcp/plans/:id
router.patch('/bcp/plans/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, planType, criticality, status, owner,
          scope, activationTrigger, recoverySteps, rtoHours, rpoHours,
          version, lastTested, nextTestDue, reviewDate } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof planType === 'string') patch.plan_type = planType;
  if (typeof criticality === 'string') patch.criticality = criticality;
  if (typeof status === 'string') patch.status = status;
  if (owner !== undefined) patch.owner = owner || null;
  if (scope !== undefined) patch.scope = scope || null;
  if (activationTrigger !== undefined) patch.activation_trigger = activationTrigger || null;
  if (recoverySteps !== undefined) patch.recovery_steps = recoverySteps || null;
  if (rtoHours !== undefined) patch.rto_hours = rtoHours;
  if (rpoHours !== undefined) patch.rpo_hours = rpoHours;
  if (typeof version === 'string') patch.version = version;
  if (lastTested !== undefined) patch.last_tested = lastTested || null;
  if (nextTestDue !== undefined) patch.next_test_due = nextTestDue || null;
  if (reviewDate !== undefined) patch.review_date = reviewDate || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_bcp_plans').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Plan not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, plan: data });
});

// DELETE /api/sec-portal/bcp/plans/:id — exercises cascade
router.delete('/bcp/plans/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_bcp_plans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/bcp/exercises?propertyId=&status=&planId=
router.get('/bcp/exercises', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_bcp_exercises').select('*, sec_bcp_plans(title)').order('scheduled_at', { ascending: false });
  const { propertyId, status, planId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/bcp/plans/:id/exercises
router.post('/bcp/plans/:id/exercises', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, exerciseType, title, conductedBy, scheduledAt, findings } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!exerciseType) return res.status(400).json({ error: 'exerciseType is required' });
  const { data, error } = await supabaseAdmin.from('sec_bcp_exercises').insert({
    id: genId('BCE'),
    property_id: propertyId || null,
    plan_id: req.params.id,
    exercise_type: exerciseType,
    title: title.trim(),
    conducted_by: conductedBy || null,
    scheduled_at: scheduledAt || null,
    findings: findings || null,
    created_by: req.user?.id,
  }).select('*, sec_bcp_plans(title)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/bcp/exercises/:id
router.patch('/bcp/exercises/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { exerciseType, title, status, result, conductedBy,
          scheduledAt, participants, findings } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof exerciseType === 'string') patch.exercise_type = exerciseType;
  if (typeof title === 'string') patch.title = title;
  if (result !== undefined) patch.result = result || null;
  if (conductedBy !== undefined) patch.conducted_by = conductedBy || null;
  if (scheduledAt !== undefined) patch.scheduled_at = scheduledAt || null;
  if (participants !== undefined) patch.participants = participants;
  if (findings !== undefined) patch.findings = findings || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Completed') patch.completed_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_bcp_exercises').update(patch).eq('id', req.params.id).select('*, sec_bcp_plans(title)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Exercise not found' });
  // Completing an exercise stamps the plan's test schedule
  if (patch.status === 'Completed' && data.plan_id) {
    const today = new Date().toISOString().slice(0, 10);
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    await supabaseAdmin.from('sec_bcp_plans').update({
      last_tested: today,
      next_test_due: next.toISOString().slice(0, 10),
    }).eq('id', data.plan_id);
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, exercise: data });
});

// DELETE /api/sec-portal/bcp/exercises/:id
router.delete('/bcp/exercises/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_bcp_exercises').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Crisis Management ────────────────────────────────────────────────────
// Backs the /erp/security/crisis tab (CrisisManagement.tsx).
// sec_crises = crisis register (optional links to sec_incidents and
// sec_bcp_plans); sec_crisis_updates = comms + decision log, CASCADE on
// crisis delete. Status/lead/BCP changes auto-log update entries.

// GET /api/sec-portal/crises?propertyId=&status=&severity=
router.get('/crises', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_crises').select('*, sec_bcp_plans(title), sec_incidents(description)').order('activated_at', { ascending: false });
  const { propertyId, status, severity } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (severity) q = q.eq('severity', severity);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/crises
router.post('/crises', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, crisisType, severity, status, location,
          crisisLead, commsChannel, summary, incidentId, bcpPlanId } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const id = genId('CRI');
  const { data, error } = await supabaseAdmin.from('sec_crises').insert({
    id,
    property_id: propertyId || null,
    title: title.trim(),
    crisis_type: crisisType || 'Other',
    severity: severity || 'High',
    status: status || 'Monitoring',
    location: location || null,
    crisis_lead: crisisLead || null,
    comms_channel: commsChannel || null,
    summary: summary || null,
    incident_id: incidentId || null,
    bcp_plan_id: bcpPlanId || null,
    activated_at: new Date().toISOString(),
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabaseAdmin.from('sec_crisis_updates').insert({
    id: genId('CRU'),
    crisis_id: id,
    update_type: 'Crisis Declared',
    message: `Crisis declared — ${title.trim()}${crisisLead ? ` (lead: ${crisisLead})` : ''}.`,
    actor: req.user?.id || null,
  });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/crises/:id — crisis + update log
router.get('/crises/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [c, u] = await Promise.all([
    supabaseAdmin.from('sec_crises').select('*, sec_bcp_plans(title), sec_incidents(description)').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_crisis_updates').select('*').eq('crisis_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (c.error) return res.status(c.error.code === 'PGRST116' ? 404 : 500).json({ error: c.error.code === 'PGRST116' ? 'Crisis not found' : c.error.message });
  return res.json({ crisis: c.data, updates: u.data || [] });
});

// PATCH /api/sec-portal/crises/:id — lifecycle + fields, auto-logged
router.patch('/crises/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, crisisType, severity, status, location, crisisLead,
          commsChannel, summary, incidentId, bcpPlanId } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof crisisType === 'string') patch.crisis_type = crisisType;
  if (typeof severity === 'string') patch.severity = severity;
  if (location !== undefined) patch.location = location || null;
  if (crisisLead !== undefined) patch.crisis_lead = crisisLead || null;
  if (commsChannel !== undefined) patch.comms_channel = commsChannel || null;
  if (summary !== undefined) patch.summary = summary || null;
  if (incidentId !== undefined) patch.incident_id = incidentId || null;
  if (bcpPlanId !== undefined) patch.bcp_plan_id = bcpPlanId || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Resolved' || status === 'Debrief') patch.resolved_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_crises').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Crisis not found' });
  // Auto-log transitions after the update succeeds
  const logs: Array<Record<string, any>> = [];
  if (typeof status === 'string') {
    logs.push({
      update_type: status === 'Resolved' ? 'Resolved' : 'Status Update',
      message: `Status → ${status}.`,
    });
  }
  if (bcpPlanId !== undefined && bcpPlanId) {
    logs.push({ update_type: 'BCP Activated', message: `Continuity plan ${bcpPlanId} linked/activated.` });
  }
  if (crisisLead !== undefined && crisisLead && typeof status !== 'string') {
    logs.push({ update_type: 'Team Mobilized', message: `Crisis lead assigned: ${crisisLead}.` });
  }
  if (logs.length > 0) {
    await supabaseAdmin.from('sec_crisis_updates').insert(
      logs.map(l => ({ id: genId('CRU'), crisis_id: req.params.id, ...l, actor: req.user?.id || null }))
    );
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, crisis: data });
});

// POST /api/sec-portal/crises/:id/updates — manual comms/decision entries
router.post('/crises/:id/updates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { updateType, message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
  const { data, error } = await supabaseAdmin.from('sec_crisis_updates').insert({
    id: genId('CRU'),
    crisis_id: req.params.id,
    update_type: updateType || 'Note',
    message: message.trim(),
    actor: req.user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/crises/:id — updates cascade
router.delete('/crises/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_crises').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Health & Safety Coordination ─────────────────────────────────────────
// Backs the /erp/security/health-safety tab (HealthSafetyCoordination.tsx).
// sec_safety_inspections = inspection register; sec_safety_hazards =
// hazard register with corrective-action lifecycle, optionally linked to
// the inspection that found it (inspection_id, SET NULL on delete).

// GET /api/sec-portal/safety-inspections?propertyId=&status=&type=
router.get('/safety-inspections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_safety_inspections').select('*').order('scheduled_at', { ascending: false });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('inspection_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/safety-inspections
router.post('/safety-inspections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, inspectionType, area, inspector, scheduledAt, findings } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_safety_inspections').insert({
    id: genId('HSI'),
    property_id: propertyId || null,
    title: title.trim(),
    inspection_type: inspectionType || 'Routine',
    area: area || null,
    inspector: inspector || null,
    scheduled_at: scheduledAt || null,
    findings: findings || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/safety-inspections/:id — completing stamps completed_at
router.patch('/safety-inspections/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, inspectionType, area, inspector, status, result,
          findings, scheduledAt } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof inspectionType === 'string') patch.inspection_type = inspectionType;
  if (area !== undefined) patch.area = area || null;
  if (inspector !== undefined) patch.inspector = inspector || null;
  if (result !== undefined) patch.result = result || null;
  if (findings !== undefined) patch.findings = findings || null;
  if (scheduledAt !== undefined) patch.scheduled_at = scheduledAt || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Completed') patch.completed_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_safety_inspections').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Inspection not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, inspection: data });
});

// DELETE /api/sec-portal/safety-inspections/:id — hazards keep, inspection_id → NULL
router.delete('/safety-inspections/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_safety_inspections').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/safety-hazards?propertyId=&status=&severity=&type=
router.get('/safety-hazards', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_safety_hazards').select('*, sec_safety_inspections(title)').order('identified_at', { ascending: false });
  const { propertyId, status, severity, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (severity) q = q.eq('severity', severity);
  if (type) q = q.eq('hazard_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/safety-hazards
router.post('/safety-hazards', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, hazardType, severity, location, description,
          correctiveAction, reportedBy, assignedTo, inspectionId } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_safety_hazards').insert({
    id: genId('HAZ'),
    property_id: propertyId || null,
    title: title.trim(),
    hazard_type: hazardType || 'Other',
    severity: severity || 'Medium',
    location: location || null,
    description: description || null,
    corrective_action: correctiveAction || null,
    reported_by: reportedBy || null,
    assigned_to: assignedTo || null,
    inspection_id: inspectionId || null,
    created_by: req.user?.id,
  }).select('*, sec_safety_inspections(title)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/safety-hazards/:id — Resolved/Closed stamp resolved_at
router.patch('/safety-hazards/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, hazardType, severity, status, location, description,
          correctiveAction, reportedBy, assignedTo, inspectionId } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof hazardType === 'string') patch.hazard_type = hazardType;
  if (typeof severity === 'string') patch.severity = severity;
  if (location !== undefined) patch.location = location || null;
  if (description !== undefined) patch.description = description || null;
  if (correctiveAction !== undefined) patch.corrective_action = correctiveAction || null;
  if (reportedBy !== undefined) patch.reported_by = reportedBy || null;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (inspectionId !== undefined) patch.inspection_id = inspectionId || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Resolved' || status === 'Closed') patch.resolved_at = new Date().toISOString();
    if (status === 'Reported') patch.resolved_at = null;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_safety_hazards').update(patch).eq('id', req.params.id).select('*, sec_safety_inspections(title)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Hazard not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, hazard: data });
});

// DELETE /api/sec-portal/safety-hazards/:id
router.delete('/safety-hazards/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_safety_hazards').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Compliance Management ────────────────────────────────────────────────
// Backs the /erp/security/compliance tab (ComplianceManagement.tsx).
// sec_compliance_items = license/cert/permit register — status is
// auto-derived from expiry_date on write (Expired < today, Expiring Soon
// <= 30 days) unless explicitly Pending/Non-Compliant.
// sec_compliance_audits = internal/external/regulatory audit register.

// Derive item status from expiry unless an explicit manual status applies
function deriveComplianceStatus(expiryDate: string | null | undefined, requested?: string): string {
  if (requested === 'Non-Compliant' || requested === 'Pending') return requested;
  if (expiryDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryDate);
    if (exp < today) return 'Expired';
    const soon = new Date(today); soon.setDate(soon.getDate() + 30);
    if (exp <= soon) return 'Expiring Soon';
    return 'Compliant';
  }
  return requested || 'Compliant';
}

// GET /api/sec-portal/compliance-items?propertyId=&status=&category=
router.get('/compliance-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_compliance_items').select('*').order('expiry_date', { ascending: true, nullsFirst: false });
  const { propertyId, status, category } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/compliance-items
router.post('/compliance-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, category, authority, referenceNo, status,
          issueDate, expiryDate, lastAudit, responsible, notes } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_compliance_items').insert({
    id: genId('CMP'),
    property_id: propertyId || null,
    title: title.trim(),
    category: category || 'Regulatory',
    authority: authority || null,
    reference_no: referenceNo || null,
    status: deriveComplianceStatus(expiryDate, status),
    issue_date: issueDate || null,
    expiry_date: expiryDate || null,
    last_audit: lastAudit || null,
    responsible: responsible || null,
    notes: notes || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/compliance-items/:id
router.patch('/compliance-items/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, category, authority, referenceNo, status,
          issueDate, expiryDate, lastAudit, responsible, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof category === 'string') patch.category = category;
  if (authority !== undefined) patch.authority = authority || null;
  if (referenceNo !== undefined) patch.reference_no = referenceNo || null;
  if (issueDate !== undefined) patch.issue_date = issueDate || null;
  if (expiryDate !== undefined) patch.expiry_date = expiryDate || null;
  if (lastAudit !== undefined) patch.last_audit = lastAudit || null;
  if (responsible !== undefined) patch.responsible = responsible || null;
  if (notes !== undefined) patch.notes = notes || null;
  // Status: explicit manual statuses win; otherwise derive from the effective expiry
  if (typeof status === 'string' && (status === 'Non-Compliant' || status === 'Pending')) {
    patch.status = status;
  } else if (expiryDate !== undefined || typeof status === 'string') {
    // Need the effective expiry — use supplied value or fall back to stored
    let effectiveExpiry = patch.expiry_date;
    if (effectiveExpiry === undefined) {
      const { data: cur } = await supabaseAdmin.from('sec_compliance_items').select('expiry_date').eq('id', req.params.id).single();
      effectiveExpiry = cur?.expiry_date;
    }
    patch.status = deriveComplianceStatus(effectiveExpiry, typeof status === 'string' ? status : undefined);
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_compliance_items').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Compliance item not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, item: data });
});

// DELETE /api/sec-portal/compliance-items/:id
router.delete('/compliance-items/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_compliance_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/compliance-audits?propertyId=&status=&type=
router.get('/compliance-audits', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_compliance_audits').select('*').order('scheduled_at', { ascending: false });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('audit_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/compliance-audits
router.post('/compliance-audits', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, auditType, auditor, scope, scheduledAt, findings } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_compliance_audits').insert({
    id: genId('AUD'),
    property_id: propertyId || null,
    title: title.trim(),
    audit_type: auditType || 'Internal',
    auditor: auditor || null,
    scope: scope || null,
    scheduled_at: scheduledAt || null,
    findings: findings || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/compliance-audits/:id — completing stamps completed_at
router.patch('/compliance-audits/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, auditType, auditor, scope, status, result,
          findings, scheduledAt } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof auditType === 'string') patch.audit_type = auditType;
  if (auditor !== undefined) patch.auditor = auditor || null;
  if (scope !== undefined) patch.scope = scope || null;
  if (result !== undefined) patch.result = result || null;
  if (findings !== undefined) patch.findings = findings || null;
  if (scheduledAt !== undefined) patch.scheduled_at = scheduledAt || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Completed') patch.completed_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_compliance_audits').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Audit not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, audit: data });
});

// DELETE /api/sec-portal/compliance-audits/:id
router.delete('/compliance-audits/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_compliance_audits').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Asset Protection ─────────────────────────────────────────────────────
// Backs the /erp/security/asset-protection tab (AssetProtection.tsx).
// sec_assets = high-value asset register; sec_asset_logs = movement/review
// trail, CASCADE on asset delete. Status changes and location moves
// auto-log; POST /:id/check stamps last_check and rolls next_check_due.

// GET /api/sec-portal/assets?propertyId=&status=&type=&level=
router.get('/assets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_assets').select('*').order('estimated_value', { ascending: false, nullsFirst: false });
  const { propertyId, status, type, level } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('asset_type', type);
  if (level) q = q.eq('security_level', level);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/assets
router.post('/assets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, assetType, location, estimatedValue, serialNo,
          custodian, securityLevel, status, protectionMeasures,
          nextCheckDue, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const id = genId('AST');
  const { data, error } = await supabaseAdmin.from('sec_assets').insert({
    id,
    property_id: propertyId || null,
    name: name.trim(),
    asset_type: assetType || 'Other',
    location: location || null,
    estimated_value: estimatedValue ?? null,
    serial_no: serialNo || null,
    custodian: custodian || null,
    security_level: securityLevel || 'Standard',
    status: status || 'Secured',
    protection_measures: protectionMeasures || null,
    next_check_due: nextCheckDue || null,
    notes: notes || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabaseAdmin.from('sec_asset_logs').insert({
    id: genId('ASL'),
    asset_id: id,
    action: 'Registered',
    detail: `Asset registered${securityLevel ? ` — ${securityLevel} security level` : ''}.`,
    location: location || null,
    actor: req.user?.id || null,
  });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// GET /api/sec-portal/assets/:id — asset + log trail
router.get('/assets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [a, l] = await Promise.all([
    supabaseAdmin.from('sec_assets').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_asset_logs').select('*').eq('asset_id', req.params.id).order('created_at', { ascending: false }),
  ]);
  if (a.error) return res.status(a.error.code === 'PGRST116' ? 404 : 500).json({ error: a.error.code === 'PGRST116' ? 'Asset not found' : a.error.message });
  return res.json({ asset: a.data, logs: l.data || [] });
});

// PATCH /api/sec-portal/assets/:id — auto-logs status change / move
router.patch('/assets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, assetType, location, estimatedValue, serialNo, custodian,
          securityLevel, status, protectionMeasures, nextCheckDue, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof assetType === 'string') patch.asset_type = assetType;
  if (location !== undefined) patch.location = location || null;
  if (estimatedValue !== undefined) patch.estimated_value = estimatedValue;
  if (serialNo !== undefined) patch.serial_no = serialNo || null;
  if (custodian !== undefined) patch.custodian = custodian || null;
  if (typeof securityLevel === 'string') patch.security_level = securityLevel;
  if (protectionMeasures !== undefined) patch.protection_measures = protectionMeasures || null;
  if (nextCheckDue !== undefined) patch.next_check_due = nextCheckDue || null;
  if (notes !== undefined) patch.notes = notes || null;
  if (typeof status === 'string') patch.status = status;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_assets').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Asset not found' });
  const logs: Array<Record<string, any>> = [];
  if (typeof status === 'string') {
    logs.push({ action: 'Status Change', detail: `Status → ${status}.` });
  }
  if (location !== undefined && location) {
    logs.push({ action: 'Moved', detail: `Location updated → ${location}.`, location });
  }
  if (logs.length > 0) {
    await supabaseAdmin.from('sec_asset_logs').insert(
      logs.map(l => ({ id: genId('ASL'), asset_id: req.params.id, ...l, actor: req.user?.id || null }))
    );
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, asset: data });
});

// POST /api/sec-portal/assets/:id/check — stamp check, roll next_due +30d
router.post('/assets/:id/check', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { detail } = req.body || {};
  const next = new Date();
  next.setDate(next.getDate() + 30);
  const { data, error } = await supabaseAdmin.from('sec_assets').update({
    last_check: new Date().toISOString(),
    next_check_due: next.toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Asset not found' });
  await supabaseAdmin.from('sec_asset_logs').insert({
    id: genId('ASL'),
    asset_id: req.params.id,
    action: 'Check Performed',
    detail: detail || 'Security check performed.',
    location: data.location,
    actor: req.user?.id || null,
  });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, asset: data });
});

// POST /api/sec-portal/assets/:id/logs — manual log entries
router.post('/assets/:id/logs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, detail, location } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });
  const { data, error } = await supabaseAdmin.from('sec_asset_logs').insert({
    id: genId('ASL'),
    asset_id: req.params.id,
    action,
    detail: detail || null,
    location: location || null,
    actor: req.user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/assets/:id — logs cascade
router.delete('/assets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_assets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Fraud Prevention ─────────────────────────────────────────────────────
// Backs the /erp/security/fraud-prevention tab (FraudPrevention.tsx).
// sec_fraud_cases = case register (optional FK → sec_investigations);
// sec_fraud_alerts = payment/transaction alert feed — POST /:id/escalate
// creates a case from the alert and links it (case_id, SET NULL on delete).

// GET /api/sec-portal/fraud-cases?propertyId=&status=&type=&severity=
router.get('/fraud-cases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_fraud_cases').select('*, sec_investigations(id, title)').order('reported_at', { ascending: false });
  const { propertyId, status, type, severity } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('fraud_type', type);
  if (severity) q = q.eq('severity', severity);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/fraud-cases
router.post('/fraud-cases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, fraudType, amount, severity, status, source,
          description, assignedTo, investigationId } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_fraud_cases').insert({
    id: genId('FRD'),
    property_id: propertyId || null,
    title: title.trim(),
    fraud_type: fraudType || 'Other',
    amount: amount ?? null,
    severity: severity || 'Medium',
    status: status || 'Flagged',
    source: source || 'Manual Report',
    description: description || null,
    assigned_to: assignedTo || null,
    investigation_id: investigationId || null,
    created_by: req.user?.id,
  }).select('*, sec_investigations(id, title)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/fraud-cases/:id — resolved statuses stamp resolved_at
router.patch('/fraud-cases/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, fraudType, amount, severity, status, source,
          description, assignedTo, investigationId, resolution } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof fraudType === 'string') patch.fraud_type = fraudType;
  if (amount !== undefined) patch.amount = amount;
  if (typeof severity === 'string') patch.severity = severity;
  if (typeof source === 'string') patch.source = source;
  if (description !== undefined) patch.description = description || null;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (investigationId !== undefined) patch.investigation_id = investigationId || null;
  if (resolution !== undefined) patch.resolution = resolution || null;
  if (typeof status === 'string') {
    patch.status = status;
    if (['Substantiated', 'Unfounded', 'Closed'].includes(status)) patch.resolved_at = new Date().toISOString();
    if (status === 'Flagged' || status === 'Under Review' || status === 'Investigating') patch.resolved_at = null;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_fraud_cases').update(patch).eq('id', req.params.id).select('*, sec_investigations(id, title)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Case not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, case: data });
});

// DELETE /api/sec-portal/fraud-cases/:id — linked alerts keep, case_id → NULL
router.delete('/fraud-cases/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_fraud_cases').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/fraud-alerts?propertyId=&status=&type=&severity=
router.get('/fraud-alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_fraud_alerts').select('*, sec_fraud_cases(id, title)').order('created_at', { ascending: false });
  const { propertyId, status, type, severity } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('alert_type', type);
  if (severity) q = q.eq('severity', severity);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/fraud-alerts — manual alert entry
router.post('/fraud-alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, alertType, title, description, amount, source, severity } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('sec_fraud_alerts').insert({
    id: genId('FAL'),
    property_id: propertyId || null,
    alert_type: alertType || 'Other',
    title: title.trim(),
    description: description || null,
    amount: amount ?? null,
    source: source || null,
    severity: severity || 'Medium',
  }).select('*, sec_fraud_cases(id, title)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/fraud-alerts/:id — review/dismiss/link
router.patch('/fraud-alerts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, alertType, description, amount, source, severity, status, caseId } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof alertType === 'string') patch.alert_type = alertType;
  if (description !== undefined) patch.description = description || null;
  if (amount !== undefined) patch.amount = amount;
  if (source !== undefined) patch.source = source || null;
  if (typeof severity === 'string') patch.severity = severity;
  if (typeof status === 'string') patch.status = status;
  if (caseId !== undefined) {
    patch.case_id = caseId || null;
    if (caseId) patch.status = 'Escalated';
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_fraud_alerts').update(patch).eq('id', req.params.id).select('*, sec_fraud_cases(id, title)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, alert: data });
});

// POST /api/sec-portal/fraud-alerts/:id/escalate — create a case + link
router.post('/fraud-alerts/:id/escalate', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: alert, error: aErr } = await supabaseAdmin.from('sec_fraud_alerts').select('*').eq('id', req.params.id).single();
  if (aErr || !alert) return res.status(404).json({ error: 'Alert not found' });
  if (alert.case_id) return res.status(400).json({ error: 'Alert already escalated to a case' });
  const { assignedTo, fraudType } = req.body || {};
  const { data: created, error: cErr } = await supabaseAdmin.from('sec_fraud_cases').insert({
    id: genId('FRD'),
    property_id: alert.property_id,
    title: alert.title,
    fraud_type: fraudType || 'Other',
    amount: alert.amount,
    severity: alert.severity,
    status: 'Under Review',
    source: 'System Alert',
    description: `Escalated from alert ${alert.id} (${alert.alert_type}). ${alert.description || ''}`.trim(),
    assigned_to: assignedTo || null,
    created_by: req.user?.id,
  }).select('*, sec_investigations(id, title)').single();
  if (cErr) return res.status(500).json({ error: cErr.message });
  await supabaseAdmin.from('sec_fraud_alerts').update({ case_id: created.id, status: 'Escalated' }).eq('id', req.params.id);
  cacheService.invalidate('sec-*');
  return res.status(201).json({ success: true, case: created });
});

// DELETE /api/sec-portal/fraud-alerts/:id
router.delete('/fraud-alerts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_fraud_alerts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Evidence Management ──────────────────────────────────────────────────
// Backs the /erp/security/evidence tab (EvidenceManagement.tsx).
// sec_evidence = item register (nullable FKs → sec_incidents,
// sec_investigations, sec_fraud_cases — all SET NULL); sec_evidence_custody
// is the real chain-of-custody log (CASCADE). Status transitions auto-log
// custody entries; POST /:id/custody adds manual entries.

const EVIDENCE_EMBED = '*, sec_incidents(id, description), sec_investigations(id, title), sec_fraud_cases(id, title)';

// GET /api/sec-portal/evidence?propertyId=&status=&type=
router.get('/evidence', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_evidence').select(EVIDENCE_EMBED).order('collected_at', { ascending: false });
  const { propertyId, status, type } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('evidence_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/sec-portal/evidence/:id — item + ordered custody log
router.get('/evidence/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [item, custody] = await Promise.all([
    supabaseAdmin.from('sec_evidence').select(EVIDENCE_EMBED).eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_evidence_custody').select('*').eq('evidence_id', req.params.id).order('created_at', { ascending: true }).order('id', { ascending: true }),
  ]);
  if (item.error || !item.data) return res.status(404).json({ error: 'Evidence not found' });
  if (custody.error) return res.status(500).json({ error: custody.error.message });
  return res.json({ evidence: item.data, custody: custody.data || [] });
});

// POST /api/sec-portal/evidence — auto-logs a 'Collected' custody entry
router.post('/evidence', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, evidenceType, description, location, storageLocation,
          collectedBy, collectedAt, source, incidentId, investigationId, caseId, notes } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const id = genId('EVD');
  const { data, error } = await supabaseAdmin.from('sec_evidence').insert({
    id,
    property_id: propertyId || null,
    title: title.trim(),
    evidence_type: evidenceType || 'Other',
    description: description || null,
    location: location || null,
    storage_location: storageLocation || null,
    collected_by: collectedBy || null,
    collected_at: collectedAt || new Date().toISOString(),
    source: source || null,
    incident_id: incidentId || null,
    investigation_id: investigationId || null,
    case_id: caseId || null,
    notes: notes || null,
    created_by: req.user?.id,
  }).select(EVIDENCE_EMBED).single();
  if (error) return res.status(500).json({ error: error.message });
  await supabaseAdmin.from('sec_evidence_custody').insert({
    evidence_id: id, action: 'Collected', actor: collectedBy || actorName(req),
    location: location || null, detail: `Evidence item ${id} collected`,
  });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/evidence/:id — status transitions auto-log custody
router.patch('/evidence/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, evidenceType, status, description, location, storageLocation,
          collectedBy, collectedAt, source, incidentId, investigationId, caseId,
          releasedTo, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof title === 'string') patch.title = title;
  if (typeof evidenceType === 'string') patch.evidence_type = evidenceType;
  if (description !== undefined) patch.description = description || null;
  if (location !== undefined) patch.location = location || null;
  if (storageLocation !== undefined) patch.storage_location = storageLocation || null;
  if (collectedBy !== undefined) patch.collected_by = collectedBy || null;
  if (collectedAt !== undefined) patch.collected_at = collectedAt || null;
  if (source !== undefined) patch.source = source || null;
  if (incidentId !== undefined) patch.incident_id = incidentId || null;
  if (investigationId !== undefined) patch.investigation_id = investigationId || null;
  if (caseId !== undefined) patch.case_id = caseId || null;
  if (releasedTo !== undefined) patch.released_to = releasedTo || null;
  if (notes !== undefined) patch.notes = notes || null;
  let custodyAction: string | null = null;
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Released') {
      patch.released_at = new Date().toISOString();
      custodyAction = 'Released';
    } else if (status === 'Secured') custodyAction = 'Logged';
    else if (status === 'In Analysis') custodyAction = 'Analysis Started';
    else if (status === 'Archived') custodyAction = 'Archived';
    else patch.released_at = null;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_evidence').update(patch).eq('id', req.params.id).select(EVIDENCE_EMBED).single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Evidence not found' });
  if (custodyAction) {
    await supabaseAdmin.from('sec_evidence_custody').insert({
      evidence_id: req.params.id, action: custodyAction, actor: actorName(req),
      recipient: custodyAction === 'Released' ? (data.released_to || null) : null,
      location: data.storage_location || null,
      detail: `Status → ${data.status}`,
    });
  }
  cacheService.invalidate('sec-*');
  return res.json({ success: true, evidence: data });
});

// POST /api/sec-portal/evidence/:id/custody — manual custody entry
router.post('/evidence/:id/custody', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, recipient, location, detail } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });
  const { data, error } = await supabaseAdmin.from('sec_evidence_custody').insert({
    evidence_id: req.params.id,
    action,
    actor: actorName(req),
    recipient: recipient || null,
    location: location || null,
    detail: detail || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/evidence/:id — custody log cascades
router.delete('/evidence/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_evidence').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Communication Center ─────────────────────────────────────────────────
// Backs the /erp/security/communication tab (CommunicationCenter.tsx).
// sec_messages = dispatch/internal/broadcast register; sec_message_acks =
// per-person acknowledgement log (CASCADE). POST /:id/ack records an ack
// and derives status → Acknowledged when a Sent message gets its first ack.

// GET /api/sec-portal/messages?propertyId=&status=&type=&priority=
router.get('/messages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_messages')
    .select('*, acks:sec_message_acks(count)')
    .order('sent_at', { ascending: false });
  const { propertyId, status, type, priority } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('msg_type', type);
  if (priority) q = q.eq('priority', priority);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map((m: any) => ({ ...m, ack_count: m.acks?.[0]?.count ?? 0, acks: undefined })));
});

// GET /api/sec-portal/messages/:id — message + acknowledgement list
router.get('/messages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const [msg, acks] = await Promise.all([
    supabaseAdmin.from('sec_messages').select('*').eq('id', req.params.id).single(),
    supabaseAdmin.from('sec_message_acks').select('*').eq('message_id', req.params.id).order('created_at', { ascending: true }),
  ]);
  if (msg.error || !msg.data) return res.status(404).json({ error: 'Message not found' });
  if (acks.error) return res.status(500).json({ error: acks.error.message });
  return res.json({ message: msg.data, acks: acks.data || [] });
});

// POST /api/sec-portal/messages — send a message/broadcast
router.post('/messages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, msgType, priority, channel, audience, recipient,
          subject, body, sender, expiresAt } = req.body || {};
  if (!subject?.trim()) return res.status(400).json({ error: 'subject is required' });
  const { data, error } = await supabaseAdmin.from('sec_messages').insert({
    id: genId('MSG'),
    property_id: propertyId || null,
    msg_type: msgType || 'Internal',
    priority: priority || 'Routine',
    channel: channel || 'App',
    audience: audience || 'All Security',
    recipient: recipient || null,
    subject: subject.trim(),
    body: body || null,
    sender: sender || actorName(req),
    expires_at: expiresAt || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/messages/:id — edit or recall/expire
router.patch('/messages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { msgType, priority, channel, audience, recipient, subject, body, status, expiresAt } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof msgType === 'string') patch.msg_type = msgType;
  if (typeof priority === 'string') patch.priority = priority;
  if (typeof channel === 'string') patch.channel = channel;
  if (typeof audience === 'string') patch.audience = audience;
  if (recipient !== undefined) patch.recipient = recipient || null;
  if (typeof subject === 'string') patch.subject = subject;
  if (body !== undefined) patch.body = body || null;
  if (typeof status === 'string') patch.status = status;
  if (expiresAt !== undefined) patch.expires_at = expiresAt || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('sec_messages').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Message not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, message: data });
});

// POST /api/sec-portal/messages/:id/ack — acknowledge; Sent → Acknowledged
router.post('/messages/:id/ack', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { ackedBy, note } = req.body || {};
  if (!ackedBy?.trim()) return res.status(400).json({ error: 'ackedBy is required' });
  const { data: msg } = await supabaseAdmin.from('sec_messages').select('id, status').eq('id', req.params.id).single();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const { data, error } = await supabaseAdmin.from('sec_message_acks').insert({
    message_id: req.params.id,
    acked_by: ackedBy.trim(),
    note: note || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (msg.status === 'Sent') {
    await supabaseAdmin.from('sec_messages').update({ status: 'Acknowledged', updated_at: new Date().toISOString() }).eq('id', req.params.id);
  }
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// DELETE /api/sec-portal/messages/:id — acks cascade
router.delete('/messages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_messages').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Staff Management sub-modules ─────────────────────────────────────────
// Backs the /erp/security/staff sub-tabs (StaffManagement.tsx), mirroring
// the HK StaffManagementModule: Roster (existing /staff CRUD) + Shifts +
// Coverage + Training + Attendance + Performance. Assigned counts are
// derived live from sec_staff at read time; training status derives
// Expired from expires_at; attendance summary is computed server-side.

// GET /api/sec-portal/staff/shifts?propertyId= — defs + live assigned counts
router.get('/staff/shifts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('sec_shift_defs').select('*').order('start_time', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Live assigned counts from the roster
  let sq = supabaseAdmin.from('sec_staff').select('shift').eq('is_active', true);
  if (propertyId) sq = sq.eq('property_id', propertyId);
  const { data: staffRows } = await sq;
  const counts = new Map<string, number>();
  (staffRows || []).forEach((s: any) => counts.set(s.shift, (counts.get(s.shift) || 0) + 1));
  return res.json((data || []).map((d: any) => ({ ...d, assigned_staff: counts.get(d.name) || 0 })));
});

// POST /api/sec-portal/staff/shifts
router.post('/staff/shifts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, startTime, endTime, requiredStaff, notes } = req.body || {};
  if (!name?.trim() || !startTime || !endTime) return res.status(400).json({ error: 'name, startTime and endTime are required' });
  const { data, error } = await supabaseAdmin.from('sec_shift_defs').insert({
    id: genId('SHF'), property_id: propertyId || null,
    name: name.trim(), start_time: startTime, end_time: endTime,
    required_staff: requiredStaff ?? 1, notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/staff/shifts/:id
router.patch('/staff/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, startTime, endTime, requiredStaff, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') patch.name = name;
  if (startTime !== undefined) patch.start_time = startTime;
  if (endTime !== undefined) patch.end_time = endTime;
  if (requiredStaff !== undefined) patch.required_staff = requiredStaff;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_shift_defs').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Shift not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, shift: data });
});

// DELETE /api/sec-portal/staff/shifts/:id
router.delete('/staff/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_shift_defs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/staff/coverage?propertyId= — reqs + live assigned counts
router.get('/staff/coverage', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('sec_staffing_reqs').select('*').order('post', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let sq = supabaseAdmin.from('sec_staff').select('role, shift').eq('is_active', true);
  if (propertyId) sq = sq.eq('property_id', propertyId);
  const { data: staffRows } = await sq;
  const counts = new Map<string, number>();
  (staffRows || []).forEach((s: any) => {
    const k = `${s.role}|${s.shift}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return res.json((data || []).map((r: any) => ({ ...r, assigned_count: counts.get(`${r.role}|${r.shift}`) || 0 })));
});

// POST /api/sec-portal/staff/coverage
router.post('/staff/coverage', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, post, role, shift, requiredCount, notes } = req.body || {};
  if (!post?.trim() || !role || !shift) return res.status(400).json({ error: 'post, role and shift are required' });
  const { data, error } = await supabaseAdmin.from('sec_staffing_reqs').insert({
    id: genId('REQ'), property_id: propertyId || null,
    post: post.trim(), role, shift,
    required_count: requiredCount ?? 1, notes: notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/staff/coverage/:id
router.patch('/staff/coverage/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { post, role, shift, requiredCount, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof post === 'string') patch.post = post;
  if (typeof role === 'string') patch.role = role;
  if (typeof shift === 'string') patch.shift = shift;
  if (requiredCount !== undefined) patch.required_count = requiredCount;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_staffing_reqs').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Requirement not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, requirement: data });
});

// DELETE /api/sec-portal/staff/coverage/:id
router.delete('/staff/coverage/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_staffing_reqs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/staff/training?propertyId= — embeds staff name,
// derives Expired from expires_at on Completed records
router.get('/staff/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_training').select('*, sec_staff(id, name, role)').order('expires_at', { ascending: true, nullsFirst: false });
  const { propertyId, staffId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (staffId) q = q.eq('staff_id', staffId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data || []).map((t: any) => ({
    ...t,
    status: t.status === 'Completed' && t.expires_at && t.expires_at < today ? 'Expired' : t.status,
  }));
  return res.json(status ? rows.filter((t: any) => t.status === status) : rows);
});

// POST /api/sec-portal/staff/training
router.post('/staff/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, staffId, course, provider, completedAt, expiresAt, status, notes } = req.body || {};
  if (!staffId || !course?.trim()) return res.status(400).json({ error: 'staffId and course are required' });
  const { data, error } = await supabaseAdmin.from('sec_training').insert({
    id: genId('TRN'), property_id: propertyId || null, staff_id: staffId,
    course: course.trim(), provider: provider || null,
    completed_at: completedAt || null, expires_at: expiresAt || null,
    status: status || 'Scheduled', notes: notes || null,
  }).select('*, sec_staff(id, name, role)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/staff/training/:id
router.patch('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { staffId, course, provider, completedAt, expiresAt, status, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof staffId === 'string') patch.staff_id = staffId;
  if (typeof course === 'string') patch.course = course;
  if (provider !== undefined) patch.provider = provider || null;
  if (completedAt !== undefined) patch.completed_at = completedAt || null;
  if (expiresAt !== undefined) patch.expires_at = expiresAt || null;
  if (typeof status === 'string') patch.status = status;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_training').update(patch).eq('id', req.params.id).select('*, sec_staff(id, name, role)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Training record not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, training: data });
});

// DELETE /api/sec-portal/staff/training/:id
router.delete('/staff/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/staff/attendance?propertyId=&date=&staffId=
router.get('/staff/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_attendance').select('*, sec_staff(id, name, role)').order('attendance_date', { ascending: false });
  const { propertyId, date, staffId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (date) q = q.eq('attendance_date', date);
  if (staffId) q = q.eq('staff_id', staffId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/sec-portal/staff/attendance/summary?propertyId= — per-staff rollup
router.get('/staff/attendance/summary', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('sec_attendance').select('*, sec_staff(id, name, role)');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const byStaff = new Map<string, any>();
  (data || []).forEach((r: any) => {
    const key = r.staff_id;
    if (!byStaff.has(key)) {
      byStaff.set(key, {
        staffId: key,
        staffName: r.sec_staff?.name || key,
        role: r.sec_staff?.role || null,
        records: [], present: 0, late: 0, absent: 0, onLeave: 0, sick: 0,
        halfDay: 0, dayOff: 0, trainingDay: 0,
        totalHours: 0, totalOvertime: 0, totalDays: 0,
      });
    }
    const s = byStaff.get(key);
    s.records.push(r);
    s.totalDays += 1;
    s.totalHours += Number(r.hours_worked) || 0;
    s.totalOvertime += Number(r.overtime_hours) || 0;
    const k = { Present: 'present', Late: 'late', Absent: 'absent', 'On Leave': 'onLeave', Sick: 'sick', 'Half Day': 'halfDay', 'Day Off': 'dayOff', 'Training Day': 'trainingDay' }[r.status as string];
    if (k) s[k] += 1;
  });
  const summary = Array.from(byStaff.values()).map(s => ({
    ...s,
    attendanceRate: s.totalDays > 0
      ? Math.round(((s.present + s.late + s.halfDay) / s.totalDays) * 100)
      : 0,
  }));
  return res.json({ summary });
});

// POST /api/sec-portal/staff/attendance — check-in / mark day (upserts by staff+date)
router.post('/staff/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, staffId, date, shift, status, checkIn, notes } = req.body || {};
  if (!staffId) return res.status(400).json({ error: 'staffId is required' });
  const { data, error } = await supabaseAdmin.from('sec_attendance').upsert({
    property_id: propertyId || null,
    staff_id: staffId,
    attendance_date: date || new Date().toISOString().slice(0, 10),
    shift: shift || 'Day',
    status: status || 'Present',
    check_in: checkIn || new Date().toISOString(),
    notes: notes || null,
    created_by: req.user?.id,
  }, { onConflict: 'staff_id,attendance_date' }).select('*, sec_staff(id, name, role)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/staff/attendance/:id — check-out / correct record
router.patch('/staff/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, shift, status, checkIn, checkOut, hoursWorked, overtimeHours, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof date === 'string') patch.attendance_date = date;
  if (typeof shift === 'string') patch.shift = shift;
  if (typeof status === 'string') patch.status = status;
  if (checkIn !== undefined) patch.check_in = checkIn || null;
  if (checkOut !== undefined) patch.check_out = checkOut || null;
  if (hoursWorked !== undefined) patch.hours_worked = hoursWorked;
  if (overtimeHours !== undefined) patch.overtime_hours = overtimeHours;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_attendance').update(patch).eq('id', req.params.id).select('*, sec_staff(id, name, role)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Attendance record not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, record: data });
});

// DELETE /api/sec-portal/staff/attendance/:id
router.delete('/staff/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_attendance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// GET /api/sec-portal/staff/performance?propertyId=&staffId=
router.get('/staff/performance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('sec_performance').select('*, sec_staff(id, name, role)').order('period_date', { ascending: false }).order('score', { ascending: false });
  const { propertyId, staffId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (staffId) q = q.eq('staff_id', staffId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/sec-portal/staff/performance — upserts by staff+period
router.post('/staff/performance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, staffId, periodDate, patrolsCompleted, incidentsResponded, reportsFiled, hours, score, notes } = req.body || {};
  if (!staffId || !periodDate) return res.status(400).json({ error: 'staffId and periodDate are required' });
  const { data, error } = await supabaseAdmin.from('sec_performance').upsert({
    property_id: propertyId || null,
    staff_id: staffId,
    period_date: periodDate,
    patrols_completed: patrolsCompleted ?? 0,
    incidents_responded: incidentsResponded ?? 0,
    reports_filed: reportsFiled ?? 0,
    hours: hours ?? 0,
    score: score ?? 0,
    notes: notes || null,
  }, { onConflict: 'staff_id,period_date' }).select('*, sec_staff(id, name, role)').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.status(201).json(data);
});

// PATCH /api/sec-portal/staff/performance/:id
router.patch('/staff/performance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { periodDate, patrolsCompleted, incidentsResponded, reportsFiled, hours, score, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof periodDate === 'string') patch.period_date = periodDate;
  if (patrolsCompleted !== undefined) patch.patrols_completed = patrolsCompleted;
  if (incidentsResponded !== undefined) patch.incidents_responded = incidentsResponded;
  if (reportsFiled !== undefined) patch.reports_filed = reportsFiled;
  if (hours !== undefined) patch.hours = hours;
  if (score !== undefined) patch.score = score;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('sec_performance').update(patch).eq('id', req.params.id).select('*, sec_staff(id, name, role)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Performance record not found' });
  cacheService.invalidate('sec-*');
  return res.json({ success: true, record: data });
});

// DELETE /api/sec-portal/staff/performance/:id
router.delete('/staff/performance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('sec_performance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ success: true });
});

// ── Security Reports Registry (migration 621) ─────────────────────────────
// Backs /erp/security/reports. Mimics the HK reports pattern
// (hk_reports + /api/hk-portal/reports). Read/write over `sec_reports`:
//   - GET  /reports           list reports (optional ?category= ?propertyId=)
//   - GET  /reports/stats     aggregated KPI counts
//   - GET  /reports/:id       fetch a single report
//   - POST /reports/:id/run   re-run a single report (status Ready + last_run = now)
//   - POST /reports/run-all   queue all reports for refresh
//   - PATCH /reports/:id      update frequency / format / status

const SEC_REPORT_CATEGORIES = ['operational', 'staff', 'compliance', 'executive'] as const;
const SEC_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const SEC_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

const SEC_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, updated_at';

// GET /api/sec-portal/reports — list reports (optional ?category= ?propertyId=)
router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('sec_reports').select(SEC_REPORT_SELECT).order('id', { ascending: true });
  if (category && (SEC_REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/sec-portal/reports/stats — aggregated KPI counts
router.get('/reports/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('sec_reports').select('category, status');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = { operational: 0, staff: 0, compliance: 0, executive: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({
    total: rows.length,
    ready: rows.filter((r: any) => r.status === 'Ready').length,
    scheduled: rows.filter((r: any) => r.status === 'Scheduled').length,
    failed: rows.filter((r: any) => r.status === 'Failed').length,
    byCategory,
  });
});

// GET /api/sec-portal/reports/:id — fetch a single report
router.get('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('sec_reports').select(SEC_REPORT_SELECT).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// POST /api/sec-portal/reports/:id/run — re-run a single report
router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('sec_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .eq('id', req.params.id)
    .select(SEC_REPORT_SELECT)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  cacheService.invalidate('sec-*');
  return res.json(data);
});

// POST /api/sec-portal/reports/run-all — queue all reports for refresh
router.post('/reports/run-all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('sec_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .neq('status', 'Ready');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q.select(SEC_REPORT_SELECT);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json({ refreshed: data?.length || 0, reports: data || [] });
});

// PATCH /api/sec-portal/reports/:id — update frequency / format / status
router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (SEC_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (SEC_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin
    .from('sec_reports').update(updates).eq('id', req.params.id).select(SEC_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  cacheService.invalidate('sec-*');
  return res.json(data);
});

// ── Security Configuration (migration 622) ────────────────────────────────
// Backs /erp/security/configuration. Mimics the HK hk_config pattern:
// JSON-blob config per property per section (zones, patrols, incidents,
// access). GET returns {} when unset; PUT upserts the whole section blob.

const SEC_CONFIG_SECTIONS = ['zones', 'patrols', 'incidents', 'access'] as const;

// GET /api/sec-portal/config/:propertyId/:section — fetch a section's config.
router.get('/config/:propertyId/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.params;
  if (!(SEC_CONFIG_SECTIONS as readonly string[]).includes(section)) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  const { data, error } = await supabaseAdmin
    .from('sec_config')
    .select('data')
    .eq('property_id', propertyId)
    .eq('section', section)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data?.data || {});
});

// PUT /api/sec-portal/config/:propertyId/:section — upsert a section's config.
router.put('/config/:propertyId/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.params;
  if (!(SEC_CONFIG_SECTIONS as readonly string[]).includes(section)) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  const data = req.body || {};
  const id = `sec-cfg-${propertyId}-${section}`;
  const { data: result, error } = await supabaseAdmin
    .from('sec_config')
    .upsert({ id, property_id: propertyId, section, data }, { onConflict: 'id' })
    .select('data')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('sec-*');
  return res.json(result.data || {});
});

// ── Security Dashboard (migration 623) ────────────────────────────────────
// Backs /erp/security/dashboard. Mimics the HK Smart Alert Engine
// (hk_dashboard_alerts): GET /dashboard/overview scans the live sec_* tables,
// upserts alerts into sec_dashboard_alerts, resolves cleared triggers, and
// returns KPIs + chart series + the active alert feed in one call.
//   - GET  /dashboard/overview?propertyId=
//   - POST /dashboard/alerts/:id/acknowledge
//   - POST /dashboard/alerts/:id/snooze   (body: { hours? })

const ACTIVE_INCIDENT_STATUSES = ['Active', 'In Progress', 'Pending', 'Draft', 'Reported', 'Classified', 'Assigned', 'Investigation', 'Corrective Action'];
const CLOSED_INCIDENT_STATUSES = ['Resolved', 'Closed'];
const OPEN_INVESTIGATION_STATUSES = ['Open', 'In Progress', 'Evidence Collection', 'Interviews', 'Analysis', 'Review'];
const OPEN_LF_STATUSES = ['Reported', 'Found', 'In Storage', 'Claim Pending'];

function scoped(q: any, propertyId?: string) {
  return propertyId ? q.eq('property_id', propertyId) : q;
}

async function regenerateSecAlerts(propertyId?: string): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayAgo = new Date(now.getTime() - 86400000).toISOString();

  const [alarmsR, emergR, incR, fireR, cctvR, risksR, trainR, accessR, keysR, visitorsR, patrolsR] = await Promise.all([
    scoped(supabaseAdmin.from('sec_alarms').select('id, alarm_type, location, status'), propertyId),
    scoped(supabaseAdmin.from('sec_emergency_notifications').select('id, emergency_type, location, status'), propertyId),
    scoped(supabaseAdmin.from('sec_incidents').select('id, incident_type, category, location, priority, status'), propertyId),
    scoped(supabaseAdmin.from('sec_fire_equipment').select('id, name, location, status, next_due'), propertyId),
    scoped(supabaseAdmin.from('sec_cctv_cameras').select('id, name, location, status'), propertyId),
    scoped(supabaseAdmin.from('sec_risks').select('id, title, risk_level, status, next_review'), propertyId),
    scoped(supabaseAdmin.from('sec_training').select('id, staff_id, course, expires_at, status, sec_staff(name)'), propertyId),
    scoped(supabaseAdmin.from('sec_access_events').select('id, event_type, location, status, occurred_at'), propertyId),
    scoped(supabaseAdmin.from('sec_keys').select('id, key_number, key_type, assigned_to, location, status'), propertyId),
    scoped(supabaseAdmin.from('sec_visitors').select('id, name, status, blacklist_status'), propertyId),
    scoped(supabaseAdmin.from('sec_patrols').select('id, officer, route, status, created_at'), propertyId),
  ]);

  type Draft = { id: string; type: string; message: string; priority: 'Critical' | 'High' | 'Medium' | 'Low'; ref_id: string | null; location: string | null };
  const drafts: Draft[] = [];

  for (const a of alarmsR.data || []) {
    if (a.status === 'Active') drafts.push({ id: `sec-alert-alarm-${a.id}`, type: 'Active Alarm', message: `${a.alarm_type} at ${a.location} — unacknowledged.`, priority: 'Critical', ref_id: a.id, location: a.location });
  }
  for (const e of emergR.data || []) {
    if (e.status === 'Active' || e.status === 'In Progress') drafts.push({ id: `sec-alert-emerg-${e.id}`, type: 'Emergency Active', message: `${e.emergency_type} at ${e.location} (${e.status}).`, priority: 'Critical', ref_id: e.id, location: e.location });
  }
  for (const i of incR.data || []) {
    if (!ACTIVE_INCIDENT_STATUSES.includes(i.status)) continue;
    if (i.priority === 'Critical') drafts.push({ id: `sec-alert-inc-${i.id}`, type: 'Critical Incident', message: `${i.incident_type} at ${i.location} (${i.id}).`, priority: 'Critical', ref_id: i.id, location: i.location });
    else if (i.priority === 'High') drafts.push({ id: `sec-alert-inc-${i.id}`, type: 'Critical Incident', message: `High-priority ${i.incident_type} at ${i.location} (${i.id}).`, priority: 'High', ref_id: i.id, location: i.location });
  }
  for (const f of fireR.data || []) {
    if (f.status === 'Out of Service') drafts.push({ id: `sec-alert-firedown-${f.id}`, type: 'Fire Equipment Down', message: `${f.name} at ${f.location} is out of service.`, priority: 'Critical', ref_id: f.id, location: f.location });
    else if (f.next_due && f.next_due < today) drafts.push({ id: `sec-alert-firedue-${f.id}`, type: 'Fire Equipment Overdue', message: `${f.name} at ${f.location} — inspection overdue since ${f.next_due}.`, priority: 'High', ref_id: f.id, location: f.location });
  }
  for (const c of cctvR.data || []) {
    if (c.status === 'Offline' || c.status === 'Maintenance') drafts.push({ id: `sec-alert-cctv-${c.id}`, type: 'CCTV Offline', message: `Camera ${c.name} at ${c.location} is ${c.status.toLowerCase()}.`, priority: 'High', ref_id: c.id, location: c.location });
  }
  for (const r of risksR.data || []) {
    if (r.status === 'Closed') continue;
    if (r.risk_level === 'Critical') drafts.push({ id: `sec-alert-riskcrit-${r.id}`, type: 'Risk Review Overdue', message: `Critical open risk: ${r.title} (${r.id}).`, priority: 'High', ref_id: r.id, location: null });
    if (r.next_review && r.next_review < today) drafts.push({ id: `sec-alert-riskrev-${r.id}`, type: 'Risk Review Overdue', message: `Risk review overdue for "${r.title}" (${r.id}).`, priority: 'Medium', ref_id: r.id, location: null });
  }
  for (const t of trainR.data || []) {
    const expired = t.status === 'Expired' || (t.expires_at && t.expires_at < today);
    if (expired) drafts.push({ id: `sec-alert-train-${t.id}`, type: 'Training Expired', message: `${t.course} expired for ${t.sec_staff?.name || t.staff_id}.`, priority: 'Medium', ref_id: t.id, location: null });
  }
  for (const a of accessR.data || []) {
    if (a.status === 'Flagged' && a.occurred_at >= dayAgo) drafts.push({ id: `sec-alert-access-${a.id}`, type: 'Access Violation', message: `${a.event_type} flagged at ${a.location}.`, priority: 'High', ref_id: a.id, location: a.location });
  }
  for (const k of keysR.data || []) {
    if (k.status === 'Lost') drafts.push({ id: `sec-alert-key-${k.id}`, type: 'Key Lost', message: `${k.key_type} ${k.key_number}${k.assigned_to ? ` issued to ${k.assigned_to}` : ''} reported lost.`, priority: 'High', ref_id: k.id, location: k.location });
  }
  for (const v of visitorsR.data || []) {
    if (v.status === 'Blacklisted' || v.blacklist_status === 'Blacklisted') drafts.push({ id: `sec-alert-visitor-${v.id}`, type: 'Blacklisted Visitor', message: `Blacklisted visitor on record: ${v.name} (${v.id}).`, priority: 'Critical', ref_id: v.id, location: null });
  }
  for (const p of patrolsR.data || []) {
    if (p.status === 'Scheduled' && p.created_at && p.created_at < dayAgo) drafts.push({ id: `sec-alert-patrol-${p.id}`, type: 'Patrol Missed', message: `Scheduled patrol "${p.route}" (${p.officer}) never started.`, priority: 'Medium', ref_id: p.id, location: p.route });
  }

  let existingQ = supabaseAdmin.from('sec_dashboard_alerts')
    .select('id, status')
    .in('status', ['Active', 'Acknowledged', 'Snoozed']);
  if (propertyId) existingQ = existingQ.eq('property_id', propertyId);
  const { data: existing } = await existingQ;
  const existingMap = new Map((existing || []).map((e: any) => [e.id, e.status]));
  const draftIds = new Set(drafts.map(d => d.id));

  // Upsert rather than insert: alert ids are deterministic, so a previously
  // Resolved alert whose trigger fires again collides on the PK — flip it
  // back to Active (clearing any stale snooze) instead of silently failing
  // the whole batch.
  const toInsert = drafts.filter(d => !existingMap.has(d.id));
  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from('sec_dashboard_alerts').upsert(toInsert.map(d => ({
      id: d.id, property_id: propertyId || null, type: d.type, message: d.message,
      priority: d.priority, status: 'Active', ref_id: d.ref_id, location: d.location,
      snoozed_until: null,
    })), { onConflict: 'id' });
    if (error) console.error('[sec-portal] dashboard alert upsert failed:', error.message);
  }

  const toResolve = [...existingMap.keys()].filter(id => !draftIds.has(id));
  if (toResolve.length > 0) {
    await supabaseAdmin.from('sec_dashboard_alerts')
      .update({ status: 'Resolved' })
      .in('id', toResolve)
      .in('status', ['Active', 'Acknowledged', 'Snoozed']);
  }
}

// GET /api/sec-portal/dashboard/overview — KPIs + charts + alert feed
router.get('/dashboard/overview', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = req.query.propertyId as string | undefined;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayAgo = new Date(now.getTime() - 86400000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  try {
    await regenerateSecAlerts(propertyId);
  } catch {
    // Non-fatal — alerts regenerate best-effort.
  }

  const [incR, invR, patrolsR, alarmsR, accessR, visitorsR, lfR, fireR, cctvR, risksR, staffR, keysR, alertsR] = await Promise.all([
    scoped(supabaseAdmin.from('sec_incidents').select('id, incident_type, category, priority, status, reported_at, updated_at'), propertyId),
    scoped(supabaseAdmin.from('sec_investigations').select('id, priority, status'), propertyId),
    scoped(supabaseAdmin.from('sec_patrols').select('id, officer, status, progress, created_at'), propertyId),
    scoped(supabaseAdmin.from('sec_alarms').select('id, status, acknowledged'), propertyId),
    scoped(supabaseAdmin.from('sec_access_events').select('id, status, occurred_at'), propertyId),
    scoped(supabaseAdmin.from('sec_visitors').select('id, status'), propertyId),
    scoped(supabaseAdmin.from('sec_lostfound_cases').select('id, status'), propertyId),
    scoped(supabaseAdmin.from('sec_fire_equipment').select('id, status, next_due'), propertyId),
    scoped(supabaseAdmin.from('sec_cctv_cameras').select('id, status'), propertyId),
    scoped(supabaseAdmin.from('sec_risks').select('id, category, risk_score, risk_level, status'), propertyId),
    scoped(supabaseAdmin.from('sec_staff').select('id, status, is_active'), propertyId),
    scoped(supabaseAdmin.from('sec_keys').select('id, status, key_type'), propertyId),
    scoped(supabaseAdmin.from('sec_dashboard_alerts').select('*').in('status', ['Active', 'Acknowledged', 'Snoozed']).order('created_at', { ascending: false }), propertyId),
  ]);

  const qerr = [incR, invR, patrolsR, alarmsR, accessR, visitorsR, lfR, fireR, cctvR, risksR, staffR, keysR, alertsR].find(r => r.error);
  if (qerr?.error) return res.status(500).json({ error: qerr.error.message });

  const incidents = incR.data || [];
  const investigations = invR.data || [];
  const patrols = patrolsR.data || [];
  const alarms = alarmsR.data || [];
  const access = accessR.data || [];
  const visitors = visitorsR.data || [];
  const lostFound = lfR.data || [];
  const fire = fireR.data || [];
  const cctv = cctvR.data || [];
  const risks = risksR.data || [];
  const staff = staffR.data || [];
  const keys = keysR.data || [];
  const alerts = alertsR.data || [];

  // ── KPIs ────────────────────────────────────────────────────────────
  const activeIncidents = incidents.filter((i: any) => ACTIVE_INCIDENT_STATUSES.includes(i.status));
  const patrolsToday = patrols.filter((p: any) => (p.created_at || '').slice(0, 10) === today);
  const patrolsDone = patrolsToday.filter((p: any) => p.status === 'Completed').length;
  const cctvOnline = cctv.filter((c: any) => c.status === 'Online').length;
  const openRisks = risks.filter((r: any) => r.status !== 'Closed');
  const levelRank: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  const topRisk = openRisks.reduce((m: any, r: any) => (levelRank[r.risk_level] || 0) > (levelRank[m?.risk_level] || 0) ? r : m, null);

  const kpis = {
    activeIncidents: activeIncidents.length,
    criticalIncidents: activeIncidents.filter((i: any) => i.priority === 'Critical' || i.priority === 'High').length,
    openInvestigations: investigations.filter((i: any) => OPEN_INVESTIGATION_STATUSES.includes(i.status)).length,
    highPriorityInvestigations: investigations.filter((i: any) => OPEN_INVESTIGATION_STATUSES.includes(i.status) && (i.priority === 'Critical' || i.priority === 'High')).length,
    patrolCompletion: patrolsToday.length ? Math.round((patrolsDone / patrolsToday.length) * 100) : 100,
    patrolsToday: patrolsToday.length,
    activeAlarms: alarms.filter((a: any) => a.status === 'Active').length,
    unacknowledgedAlarms: alarms.filter((a: any) => a.status === 'Active' && !a.acknowledged).length,
    accessViolations: access.filter((a: any) => a.status !== 'Normal' && a.occurred_at >= dayAgo).length,
    visitorsOnProperty: visitors.filter((v: any) => v.status === 'Checked In').length,
    lostFoundOpen: lostFound.filter((l: any) => OPEN_LF_STATUSES.includes(l.status)).length,
    lostFoundPendingClaims: lostFound.filter((l: any) => l.status === 'Claim Pending').length,
    fireIssues: fire.filter((f: any) => f.status === 'Needs Service' || f.status === 'Out of Service').length,
    fireOverdue: fire.filter((f: any) => f.next_due && f.next_due < today).length,
    cctvOnlinePct: cctv.length ? Math.round((cctvOnline / cctv.length) * 100) : 100,
    cctvTotal: cctv.length,
    topRiskLevel: topRisk?.risk_level || 'None',
    highCriticalRisks: openRisks.filter((r: any) => r.risk_level === 'High' || r.risk_level === 'Critical').length,
    staffOnDuty: staff.filter((s: any) => s.is_active && s.status !== 'Off Duty').length,
    staffTotal: staff.filter((s: any) => s.is_active).length,
    keysIssued: keys.filter((k: any) => k.status === 'Issued').length,
  };

  // ── Incidents by category (pie) ─────────────────────────────────────
  const catMap = new Map<string, number>();
  for (const i of incidents) {
    const cat = i.category || i.incident_type || 'Other';
    catMap.set(cat, (catMap.get(cat) || 0) + 1);
  }
  const incidentCategories = [...catMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // ── Incident trend — last 7 days ────────────────────────────────────
  const incidentTrend: { date: string; label: string; incidents: number; resolved: number }[] = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400000);
    const key = day.toISOString().slice(0, 10);
    incidentTrend.push({
      date: key,
      label: day.toLocaleDateString('en-US', { weekday: 'short' }),
      incidents: incidents.filter((i: any) => (i.reported_at || '').slice(0, 10) === key).length,
      resolved: incidents.filter((i: any) => CLOSED_INCIDENT_STATUSES.includes(i.status) && (i.updated_at || '').slice(0, 10) === key).length,
    });
  }

  // ── Avg risk score by category (bar) ────────────────────────────────
  const riskMap = new Map<string, { sum: number; n: number }>();
  for (const r of openRisks) {
    const cat = r.category || 'Other';
    const cur = riskMap.get(cat) || { sum: 0, n: 0 };
    cur.sum += Number(r.risk_score) || 0; cur.n += 1;
    riskMap.set(cat, cur);
  }
  const riskByCategory = [...riskMap.entries()]
    .map(([name, v]) => ({ name, risk: Math.round((v.sum / v.n) * 10) / 10 }))
    .sort((a, b) => b.risk - a.risk);

  // ── Patrol activity per officer — last 7 days ───────────────────────
  const patrolMap = new Map<string, { total: number; done: number }>();
  for (const p of patrols) {
    if ((p.created_at || '') < weekAgo) continue;
    const cur = patrolMap.get(p.officer) || { total: 0, done: 0 };
    cur.total += 1;
    if (p.status === 'Completed') cur.done += 1;
    patrolMap.set(p.officer, cur);
  }
  const patrolActivity = [...patrolMap.entries()]
    .map(([name, v]) => ({ name, patrols: v.done, completion: v.total ? Math.round((v.done / v.total) * 100) : 0 }))
    .sort((a, b) => b.patrols - a.patrols)
    .slice(0, 8);

  return res.json({ kpis, incidentCategories, incidentTrend, riskByCategory, patrolActivity, alerts });
});

// POST /api/sec-portal/dashboard/alerts/:id/acknowledge
router.post('/dashboard/alerts/:id/acknowledge', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('sec_dashboard_alerts')
    .update({ status: 'Acknowledged' })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

// POST /api/sec-portal/dashboard/alerts/:id/snooze — body: { hours? }
router.post('/dashboard/alerts/:id/snooze', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const hours = Number(req.body?.hours) || 4;
  const until = new Date(Date.now() + hours * 3600000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('sec_dashboard_alerts')
    .update({ status: 'Snoozed', snoozed_until: until })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

export default router;
