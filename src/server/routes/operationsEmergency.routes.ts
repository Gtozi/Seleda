/**
 * Emergency Coordination routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/emergency tab (EmergencyCoordination.tsx).
 * Shares the Security portal's own emergency tables so anything raised or
 * updated here is immediately visible in /erp/security SOC Emergency:
 *
 *   GET  /emergency?propertyId=
 *        sec_emergency_notifications (+ sec_emergency_responses timeline)
 *        plus a critical-incidents watch list from sec_incidents.
 *   POST /emergency                      — raise an emergency notification
 *   PATCH /emergency/:id                 — status/priority/commander/team/
 *                                          evacuation (auto response log)
 *   POST /emergency/:id/responses        — manual response-timeline entry
 *   POST /emergency/escalate-incident    — promote a sec_incidents row to a
 *                                          full emergency notification
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 15 * 1000;

// sec_emergency_notifications CHECK constraints (verified live).
const EMERGENCY_STATUSES = ['Active', 'In Progress', 'Scheduled', 'Resolved'] as const;
const EVACUATION_STATES = ['Not Required', 'Standby', 'In Progress', 'Complete'] as const;
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
// sec_emergency_responses.action CHECK constraint.
const RESPONSE_ACTIONS = ['Alert Raised', 'Team Dispatched', 'Commander Assigned', 'Evacuation Ordered', 'Evacuation Complete', 'Status Update', 'All Clear', 'Resolved', 'Note'] as const;
const OPEN_INCIDENT_STATUSES = ['Draft', 'Reported', 'Classified', 'Assigned', 'In Progress', 'Investigation', 'Corrective Action', 'Active', 'Pending'];

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function logResponse(emergencyId: string, action: string, detail: string | null, actor?: string) {
  const { error } = await supabaseAdmin!.from('sec_emergency_responses')
    .insert({ emergency_id: emergencyId, action, detail, actor: actor || null });
  if (error) console.warn(`[ops-emergency] response log failed for ${emergencyId}:`, error.message);
}

// GET /api/ops-portal/emergency
router.get('/emergency', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-emergency:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [emgR, respR, incR] = await Promise.all([
      eqProp(supabaseAdmin.from('sec_emergency_notifications')
        .select('*').order('occurred_at', { ascending: false })),
      supabaseAdmin.from('sec_emergency_responses')
        .select('*').order('created_at', { ascending: false }),
      eqProp(supabaseAdmin.from('sec_incidents')
        .select('id, incident_type, location, priority, status, reported_at, assigned_to, description, reported_by')
        .in('priority', ['Critical', 'High'])
        .in('status', OPEN_INCIDENT_STATUSES)
        .order('reported_at', { ascending: false })),
    ]);

    if (emgR.error) console.warn('[ops-emergency] emergencies:', emgR.error.message);
    if (respR.error) console.warn('[ops-emergency] responses:', respR.error.message);
    if (incR.error) console.warn('[ops-emergency] incidents:', incR.error.message);

    const respByEmg = new Map<string, any[]>();
    for (const r of (respR.data || []) as any[]) {
      const arr = respByEmg.get(r.emergency_id) || [];
      arr.push(r);
      respByEmg.set(r.emergency_id, arr);
    }

    const emergencies = ((emgR.data || []) as any[]).map((e) => ({
      id: e.id,
      type: e.emergency_type,
      location: e.location,
      status: e.status,
      priority: e.priority,
      description: e.description,
      commander: e.commander,
      responseTeam: e.response_team,
      evacuation: e.evacuation,
      occurredAt: e.occurred_at,
      resolvedAt: e.resolved_at,
      responses: (respByEmg.get(e.id) || []).map((r) => ({
        id: r.id, action: r.action, detail: r.detail, actor: r.actor, at: r.created_at,
      })),
    }));

    const today = new Date().toISOString().slice(0, 10);
      const active = emergencies.filter((e) => e.status !== 'Resolved');

    const payload = {
      generatedAt: new Date().toISOString(),
      emergencies,
      criticalIncidents: ((incR.data || []) as any[]).map((i) => ({
        id: i.id,
        type: i.incident_type,
        location: i.location,
        priority: i.priority,
        status: i.status,
        reportedAt: i.reported_at,
        assignedTo: i.assigned_to,
        reportedBy: i.reported_by,
        description: i.description,
      })),
      stats: {
        active: active.length,
        critical: active.filter((e) => e.priority === 'Critical').length,
        evacuationInProgress: active.filter((e) => e.evacuation === 'In Progress').length,
        resolvedToday: emergencies.filter((e) => e.status === 'Resolved' && String(e.resolvedAt || '').startsWith(today)).length,
        openCriticalIncidents: (incR.data || []).length,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load emergencies' });
  }
});

// POST /api/ops-portal/emergency — raise an emergency (shared with Sec SOC).
router.post('/emergency', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, emergencyType, location, status, priority,
          description, commander, responseTeam, evacuation } = req.body || {};
  if (!emergencyType?.trim()) return res.status(400).json({ error: 'emergencyType is required' });
  if (!location?.trim()) return res.status(400).json({ error: 'location is required' });
  if (status && !EMERGENCY_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${EMERGENCY_STATUSES.join(', ')}` });
  }
  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin.from('sec_emergency_notifications').insert({
    id: `EMG-OPS-${Date.now()}`,
    property_id: propertyId || null,
    emergency_type: emergencyType.trim(),
    location: location.trim(),
    status: status || 'Active',
    priority: priority || 'High',
    description: description || null,
    commander: commander || req.user?.name || null,
    response_team: responseTeam || null,
    evacuation: evacuation || 'Not Required',
    created_by: req.user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logResponse(data.id, 'Alert Raised', `${data.emergency_type} — ${data.location} (via Operations)`, req.user?.name);
  cacheService.invalidate('ops-emergency:*');
  cacheService.invalidate('sec-*');
  return res.status(201).json({ ok: true, emergency: data });
});

// PATCH /api/ops-portal/emergency/:id
router.patch('/emergency/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, priority, description, commander, responseTeam, evacuation, location } = req.body || {};
  const patch: Record<string, any> = {};
  const logs: Array<{ action: string; detail?: string | null }> = [];

  if (typeof location === 'string' && location.trim()) patch.location = location.trim();
  if (typeof priority === 'string') {
    if (!PRIORITIES.includes(priority as any)) {
      return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    }
    patch.priority = priority;
    logs.push({ action: 'Note', detail: `Priority set to ${priority}` });
  }
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
    if (!EVACUATION_STATES.includes(evacuation)) {
      return res.status(400).json({ error: `evacuation must be one of: ${EVACUATION_STATES.join(', ')}` });
    }
    patch.evacuation = evacuation;
    if (evacuation === 'In Progress') logs.push({ action: 'Evacuation Ordered', detail: 'Evacuation in progress' });
    if (evacuation === 'Complete') logs.push({ action: 'Evacuation Complete', detail: 'Evacuation sweep complete' });
    if (evacuation === 'Standby') logs.push({ action: 'Note', detail: 'Evacuation on standby' });
  }
  if (typeof status === 'string') {
    if (!EMERGENCY_STATUSES.includes(status as any)) {
      return res.status(400).json({ error: `status must be one of: ${EMERGENCY_STATUSES.join(', ')}` });
    }
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

  const { data, error } = await supabaseAdmin.from('sec_emergency_notifications')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Emergency not found' });
  for (const l of logs) await logResponse(req.params.id, l.action, l.detail || null, req.user?.name);
  cacheService.invalidate('ops-emergency:*');
  cacheService.invalidate('sec-*');
  return res.json({ ok: true, emergency: data });
});

// POST /api/ops-portal/emergency/:id/responses — manual timeline entry.
// Free-form text is logged as action 'Note' (sec_emergency_responses.action
// has a fixed CHECK vocabulary).
router.post('/emergency/:id/responses', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, detail } = req.body || {};
  if (!action?.trim() && !detail?.trim()) return res.status(400).json({ error: 'action or detail is required' });
  const actionName = RESPONSE_ACTIONS.includes(action) ? action : 'Note';
  const detailText = actionName === 'Note' && action && !RESPONSE_ACTIONS.includes(action)
    ? [action, detail].filter(Boolean).join(' — ')
    : detail || null;
  const { data, error } = await supabaseAdmin.from('sec_emergency_responses').insert({
    emergency_id: req.params.id,
    action: actionName,
    detail: detailText,
    actor: req.user?.name || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-emergency:*');
  cacheService.invalidate('sec-*');
  return res.status(201).json({ ok: true, response: data });
});

// POST /api/ops-portal/emergency/escalate-incident — promote a sec_incidents
// row into a full emergency notification.
router.post('/emergency/escalate-incident', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { incidentId } = req.body || {};
  if (!incidentId) return res.status(400).json({ error: 'incidentId is required' });

  const { data: inc, error: incErr } = await supabaseAdmin
    .from('sec_incidents')
    .select('id, incident_type, location, priority, description, property_id')
    .eq('id', incidentId).single();
  if (incErr || !inc) return res.status(404).json({ error: 'incident not found' });

  const { data, error } = await supabaseAdmin.from('sec_emergency_notifications').insert({
    id: `EMG-OPS-${Date.now()}`,
    property_id: req.body?.propertyId || inc.property_id || null,
    emergency_type: inc.incident_type || 'Security',
    location: inc.location || 'Unspecified',
    status: 'Active',
    priority: inc.priority || 'High',
    description: inc.description ? `Escalated from incident ${inc.id}: ${inc.description}` : `Escalated from incident ${inc.id}`,
    commander: req.user?.name || null,
    evacuation: 'Not Required',
    created_by: req.user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin.from('sec_incidents')
    .update({ status: 'In Progress', updated_at: new Date().toISOString() }).eq('id', inc.id);
  await logResponse(data.id, 'Alert Raised', `Escalated from incident ${inc.id} — ${inc.incident_type} @ ${inc.location}`, req.user?.name);
  cacheService.invalidate('ops-emergency:*');
  cacheService.invalidate('sec-*');
  return res.status(201).json({ ok: true, emergency: data });
});

export default router;
