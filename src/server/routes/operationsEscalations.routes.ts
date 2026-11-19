/**
 * Escalation Center routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/escalation tab (EscalationCenter.tsx).
 * Two layers:
 *   1. Persisted `ops_escalations` rows with a real lifecycle
 *      (open → acknowledged → in-progress → resolved).
 *   2. Live "auto-detected" candidates computed from the other portals:
 *      Emergency/open work_orders (equipment-failure), Urgent or stale High
 *      guest_requests (guest-complaint), Critical sec_incidents
 *      (high-risk-incident), overdue Critical/High housekeeping_task_mgmt
 *      (delayed-task), and stale ops_recovery_cases (guest-complaint).
 *      Adopting a candidate persists it (source_ref dedup) so it becomes a
 *      tracked escalation.
 *
 *   GET    /escalations?propertyId=          — escalations + candidates
 *   POST   /escalations                      — manual escalation
 *   POST   /escalations/adopt                — adopt a live candidate
 *   PATCH  /escalations/:id                  — status/escalatedTo/dueBy/resolution
 *   DELETE /escalations/:id
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 15 * 1000;

const ESC_TYPES = ['sla-violation', 'guest-complaint', 'delayed-task', 'equipment-failure', 'staff-shortage', 'high-risk-incident', 'other'] as const;
const ESC_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
const ESC_STATUSES = ['open', 'acknowledged', 'in-progress', 'resolved'] as const;

const OPEN_WO = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor'];
const OPEN_GR = ['Open', 'Assigned', 'In Progress'];
const OPEN_INCIDENT = ['Draft', 'Reported', 'Classified', 'Assigned', 'In Progress', 'Investigation', 'Corrective Action', 'Active', 'Pending'];
const OPEN_HK = ['Pending', 'In Progress'];
const STALE_RECOVERY = ['logged', 'investigating', 'compensation-pending', 'corrective-action'];

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-escalations] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-escalations] ${tag}: ${e?.message || e}`);
    return [];
  }
}

interface Candidate {
  sourceRef: string;
  type: string;
  severity: string;
  description: string;
  source: string;
  escalatedTo: string;
  ageHours: number;
  detectedAt: string;
}

const ageHours = (ts: string | null | undefined) =>
  ts ? Math.max(0, (Date.now() - new Date(ts).getTime()) / 3_600_000) : 0;

// GET /api/ops-portal/escalations
router.get('/escalations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-escalations:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [persisted, wos, grs, incs, hks, recs] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('ops_escalations').select('*').order('created_at', { ascending: false })), 'ops_escalations'),
      fetchRows(eqProp(supabaseAdmin!.from('work_orders')
        .select('id, wo_number, title, description, priority, status, assigned_to, room_number, created_date, scheduled_date')
        .in('priority', ['Emergency', 'High']).in('status', OPEN_WO)), 'work_orders'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
        .select('id, request_type, description, priority, status, room_number, guest_name, created_at')
        .in('priority', ['Urgent', 'High']).in('status', OPEN_GR)), 'guest_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
        .select('id, incident_type, location, priority, status, description, reported_at, assigned_to')
        .eq('priority', 'Critical').in('status', OPEN_INCIDENT)), 'sec_incidents'),
      fetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
        .select('id, type, location, priority, status, due_date, assigned_to, created_at')
        .in('priority', ['Critical', 'High']).in('status', OPEN_HK)), 'hk_tasks'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_recovery_cases')
        .select('id, guest_name, complaint, status, created_at')
        .in('status', STALE_RECOVERY)), 'recovery_cases'),
    ]);

    const adopted = new Set(persisted.map((e: any) => e.source_ref).filter(Boolean));

    // ── Live auto-detection ──────────────────────────────────────────────
    const candidates: Candidate[] = [];
    for (const w of wos) {
      const emergency = w.priority === 'Emergency';
      const stale = ageHours(w.created_date) >= 24;
      if (!emergency && !stale) continue;
      candidates.push({
        sourceRef: `work_orders/${w.id}`,
        type: 'equipment-failure',
        severity: emergency ? 'critical' : 'major',
        description: `${w.title || w.wo_number || w.id}${w.room_number ? ` — Room ${w.room_number}` : ''} (${w.priority} WO open ${Math.round(ageHours(w.created_date))}h, status ${w.status})`,
        source: 'Engineering',
        escalatedTo: 'General Manager',
        ageHours: ageHours(w.created_date),
        detectedAt: w.created_date,
      });
    }
    for (const g of grs) {
      const urgent = g.priority === 'Urgent';
      const stale = ageHours(g.created_at) >= 4;
      if (!urgent && !stale) continue;
      candidates.push({
        sourceRef: `guest_requests/${g.id}`,
        type: 'guest-complaint',
        severity: urgent ? 'major' : 'moderate',
        description: `${g.request_type || 'Guest request'}${g.room_number ? ` — Room ${g.room_number}` : ''}${g.guest_name ? ` (${g.guest_name})` : ''}: ${(g.description || '').slice(0, 140)} — open ${Math.round(ageHours(g.created_at))}h`,
        source: 'Front Office',
        escalatedTo: 'Hotel Manager',
        ageHours: ageHours(g.created_at),
        detectedAt: g.created_at,
      });
    }
    for (const i of incs) {
      candidates.push({
        sourceRef: `sec_incidents/${i.id}`,
        type: 'high-risk-incident',
        severity: 'critical',
        description: `${i.incident_type} at ${i.location || 'unspecified'} — Critical incident, status ${i.status}`,
        source: 'Security',
        escalatedTo: 'General Manager',
        ageHours: ageHours(i.reported_at),
        detectedAt: i.reported_at,
      });
    }
    for (const t of hks) {
      const due = t.due_date ? new Date(t.due_date).getTime() : NaN;
      const overdue = !Number.isNaN(due) && due < Date.now();
      if (!overdue && t.priority !== 'Critical') continue;
      candidates.push({
        sourceRef: `housekeeping_task_mgmt/${t.id}`,
        type: overdue ? 'sla-violation' : 'delayed-task',
        severity: t.priority === 'Critical' ? 'major' : 'moderate',
        description: `${t.type || 'HK task'} at ${t.location || 'unspecified'} — ${t.priority} task ${overdue ? `overdue since ${t.due_date}` : 'still pending'}`,
        source: 'Housekeeping',
        escalatedTo: 'Rooms Division Manager',
        ageHours: ageHours(t.due_date || t.created_at),
        detectedAt: t.created_at,
      });
    }
    for (const r of recs) {
      if (ageHours(r.created_at) < 24) continue;
      candidates.push({
        sourceRef: `ops_recovery_cases/${r.id}`,
        type: 'guest-complaint',
        severity: 'major',
        description: `Recovery case for ${r.guest_name || 'guest'} still at "${r.status}" after ${Math.round(ageHours(r.created_at))}h — ${(r.complaint || '').slice(0, 120)}`,
        source: 'Guest Recovery',
        escalatedTo: 'Hotel Manager',
        ageHours: ageHours(r.created_at),
        detectedAt: r.created_at,
      });
    }

    const openCandidates = candidates
      .filter((c) => !adopted.has(c.sourceRef))
      .sort((a, b) => b.ageHours - a.ageHours);

    const openEsc = persisted.filter((e: any) => e.status !== 'resolved');
    const payload = {
      generatedAt: new Date().toISOString(),
      escalations: persisted,
      candidates: openCandidates,
      stats: {
        open: persisted.filter((e: any) => e.status === 'open').length,
        acknowledged: persisted.filter((e: any) => e.status === 'acknowledged').length,
        inProgress: persisted.filter((e: any) => e.status === 'in-progress').length,
        resolved: persisted.filter((e: any) => e.status === 'resolved').length,
        detected: openCandidates.length,
        overdue: openEsc.filter((e: any) => e.due_by && new Date(e.due_by).getTime() < Date.now()).length,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load escalations' });
  }
});

// POST /api/ops-portal/escalations — manual escalation.
router.post('/escalations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.description?.trim()) return res.status(400).json({ error: 'description is required' });
  if (b.type && !ESC_TYPES.includes(b.type)) return res.status(400).json({ error: `type must be one of: ${ESC_TYPES.join(', ')}` });
  if (b.severity && !ESC_SEVERITIES.includes(b.severity)) return res.status(400).json({ error: `severity must be one of: ${ESC_SEVERITIES.join(', ')}` });

  const { data, error } = await supabaseAdmin.from('ops_escalations').insert({
    id: `esc-${Date.now()}`,
    property_id: b.propertyId || null,
    type: b.type || 'other',
    severity: b.severity || 'moderate',
    description: b.description.trim(),
    source: b.source || 'Operations',
    escalated_to: b.escalatedTo || 'General Manager',
    status: 'open',
    due_by: b.dueBy || null,
    created_by: req.user?.name || 'manager',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-escalations:*');
  return res.status(201).json({ ok: true, escalation: data });
});

// POST /api/ops-portal/escalations/adopt — persist a detected candidate.
router.post('/escalations/adopt', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const c = req.body || {};
  if (!c.sourceRef || !c.description) return res.status(400).json({ error: 'sourceRef and description are required' });

  const { data: existing } = await supabaseAdmin
    .from('ops_escalations').select('id').eq('source_ref', c.sourceRef).maybeSingle();
  if (existing) return res.status(409).json({ error: 'already adopted', escalationId: existing.id });

  const { data, error } = await supabaseAdmin.from('ops_escalations').insert({
    id: `esc-${Date.now()}`,
    property_id: c.propertyId || null,
    type: ESC_TYPES.includes(c.type) ? c.type : 'other',
    severity: ESC_SEVERITIES.includes(c.severity) ? c.severity : 'moderate',
    description: c.description,
    source: c.source || null,
    source_ref: c.sourceRef,
    escalated_to: c.escalatedTo || 'General Manager',
    status: 'open',
    due_by: new Date(Date.now() + 2 * 3_600_000).toISOString(), // 2h SLA
    created_by: req.user?.name || 'auto-detect',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-escalations:*');
  return res.status(201).json({ ok: true, escalation: data });
});

// PATCH /api/ops-portal/escalations/:id — lifecycle + fields.
router.patch('/escalations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const patch: Record<string, any> = {};

  if (b.status !== undefined) {
    if (!ESC_STATUSES.includes(b.status)) return res.status(400).json({ error: `status must be one of: ${ESC_STATUSES.join(', ')}` });
    patch.status = b.status;
    if (b.status === 'acknowledged') patch.acknowledged_at = new Date().toISOString();
    if (b.status === 'resolved') {
      patch.resolved_at = new Date().toISOString();
      if (b.resolution !== undefined) patch.resolution = b.resolution;
    }
  }
  if (b.severity !== undefined) {
    if (!ESC_SEVERITIES.includes(b.severity)) return res.status(400).json({ error: `severity must be one of: ${ESC_SEVERITIES.join(', ')}` });
    patch.severity = b.severity;
  }
  if (b.escalatedTo !== undefined) patch.escalated_to = b.escalatedTo;
  if (b.dueBy !== undefined) patch.due_by = b.dueBy;
  if (b.resolution !== undefined && b.status !== 'resolved') patch.resolution = b.resolution;

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });

  const { data, error } = await supabaseAdmin.from('ops_escalations')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-escalations:*');
  return res.json({ ok: true, escalation: data });
});

// DELETE /api/ops-portal/escalations/:id
router.delete('/escalations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('ops_escalations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-escalations:*');
  return res.json({ ok: true });
});

export default router;
