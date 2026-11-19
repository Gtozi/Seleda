/**
 * Operations Cross-Department Task Center routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/cross-department-tasks tab
 * (CrossDepartmentTaskCenter.tsx).
 *
 *   GET    /cross-dept-tasks?propertyId=
 *          Returns persisted coordination tasks (ops_cross_dept_tasks,
 *          migration 634, seeded with the former mock rows) plus a live
 *          "suggested tasks" feed detected across the other portals:
 *            - upcoming banquet_events (weddings, conferences, galas)
 *            - VIP arrivals (reservations join guests.status='VIP')
 *            - group_blocks checking in within 3 days
 *            - Emergency-priority work_orders
 *          Suggestions carry a `sourceRef`; a suggestion is suppressed
 *          once a task with that source_ref exists (adopted).
 *
 *   POST   /cross-dept-tasks            — create a task
 *   POST   /cross-dept-tasks/adopt      — adopt a suggestion {sourceRef}
 *   PATCH  /cross-dept-tasks/:id        — update status/priority/dates or
 *          a single department's status ({departmentUpdate})
 *   DELETE /cross-dept-tasks/:id
 *
 * Task `progress` is derived server-side from the departments array
 * (% of assigned departments completed).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

const CACHE_TTL_MS = 15 * 1000;
const TASK_TYPES = ['vip-arrival', 'wedding', 'conference', 'emergency', 'maintenance', 'renovation', 'other'] as const;
const TASK_STATUS = ['planning', 'in-progress', 'completed', 'on-hold'] as const;
const DEPT_STATUS = ['pending', 'in-progress', 'completed', 'on-hold'] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-cross-dept] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-cross-dept] ${tag}: ${e?.message || e}`);
    return [];
  }
}

interface DeptAssignment { department: string; status: string; lead?: string }

function normTask(r: any) {
  const departments: DeptAssignment[] = Array.isArray(r.departments) ? r.departments : [];
  const done = departments.filter(d => d.status === 'completed').length;
  const progress = departments.length ? Math.round((done / departments.length) * 100) : 0;
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    type: r.type,
    priority: r.priority,
    status: r.status,
    departments: departments.map(d => d.department),
    assignedDepartments: departments,
    startDate: r.start_at,
    endDate: r.end_at,
    progress,
    sourceRef: r.source_ref,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

// ── Live suggestions across portals ──────────────────────────────────────

const eventTypeToTaskType = (et: any): string => {
  const v = String(et || '').toLowerCase();
  if (v.includes('wedding')) return 'wedding';
  if (['conference', 'meeting', 'corporateevent', 'productlaunch', 'exhibition'].includes(v)) return 'conference';
  return 'other';
};

async function buildSuggestions(propertyId: string | undefined, adoptedRefs: Set<string>) {
  const eqProp = (q: any): any => propertyId ? q.eq('property_id', propertyId) : q;
  const today = new Date().toISOString().slice(0, 10);
  const plus3 = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

  const [events, vipGuests, arrivingRes, blocks, emergencyWOs] = await Promise.all([
    fetchRows(eqProp(supabaseAdmin!.from('banquet_events')
      .select('id, event_name, event_type, event_date, end_date, guest_count, client_name, status')
      .gte('event_date', today)
      .in('status', ['Confirmed', 'InProgress', 'Planning', 'Tentative'])
      .order('event_date', { ascending: true }).limit(10)), 'banquet_events'),
    fetchRows(supabaseAdmin!.from('guests')
      .select('id, first_name, last_name').eq('status', 'VIP'), 'vip guests'),
    fetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, guest_id, guest_name, check_in_date, room_type')
      .gte('check_in_date', today).lte('check_in_date', plus3)
      .not('status', 'in', '("Cancelled","NoShow","CheckedOut")')), 'arriving reservations'),
    fetchRows(eqProp(supabaseAdmin!.from('group_blocks')
      .select('id, block_name, arrival_date, departure_date, total_rooms, blocked_rooms, status')
      .gte('arrival_date', today).lte('arrival_date', plus3)
      .not('status', 'in', '("Closed","Cancelled","Released")')), 'group_blocks'),
    fetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, wo_number, title, description, room_number, priority, status, created_date')
      .eq('priority', 'Emergency')
      .not('status', 'in', '("Completed","Verified","Closed","Cancelled")')), 'emergency work orders'),
  ]);

  const vipIds = new Set(vipGuests.map((g: any) => g.id));
  const suggestions: any[] = [];

  for (const e of events) {
    const ref = `banquet/${e.id}`;
    if (adoptedRefs.has(ref)) continue;
    const depts = ['Events', 'F&B', 'Housekeeping', 'Engineering'];
    if ((e.guest_count || 0) >= 150) depts.push('Security');
    suggestions.push({
      sourceRef: ref,
      title: `${e.event_type || 'Event'} — ${e.event_name}`,
      description: `${e.event_type || 'Event'} for ${e.client_name || 'client'} · ${e.guest_count || '?'} guests · status ${e.status}. Requires cross-department coordination.`,
      type: eventTypeToTaskType(e.event_type),
      priority: e.status === 'InProgress' ? 'critical' : 'high',
      suggestedDepartments: depts,
      startDate: e.event_date,
      endDate: e.end_date || e.event_date,
      source: 'Events portal',
    });
  }

  for (const r of arrivingRes) {
    if (!vipIds.has(r.guest_id)) continue;
    const ref = `reservation/${r.id}`;
    if (adoptedRefs.has(ref)) continue;
    suggestions.push({
      sourceRef: ref,
      title: `VIP Arrival — ${r.guest_name || 'Guest'}`,
      description: `VIP guest arriving ${r.check_in_date} (${r.room_type || 'room TBD'}). Coordinate suite readiness, amenities, security and transport.`,
      type: 'vip-arrival',
      priority: 'critical',
      suggestedDepartments: ['Front Office', 'Housekeeping', 'Engineering', 'Security', 'F&B', 'Transportation'],
      startDate: r.check_in_date,
      endDate: r.check_in_date,
      source: 'Front Office',
    });
  }

  for (const g of blocks) {
    const ref = `group-block/${g.id}`;
    if (adoptedRefs.has(ref)) continue;
    suggestions.push({
      sourceRef: ref,
      title: `Group Check-in — ${g.block_name}`,
      description: `Group arriving ${g.arrival_date} · ${g.blocked_rooms || g.total_rooms || '?'} rooms blocked. Coordinate rooming, welcome desk and F&B.`,
      type: 'conference',
      priority: 'high',
      suggestedDepartments: ['Front Office', 'Housekeeping', 'F&B', 'Events'],
      startDate: g.arrival_date,
      endDate: g.departure_date || g.arrival_date,
      source: 'Front Office',
    });
  }

  for (const w of emergencyWOs) {
    const ref = `work-order/${w.id}`;
    if (adoptedRefs.has(ref)) continue;
    suggestions.push({
      sourceRef: ref,
      title: `Emergency — ${w.title || w.wo_number}`,
      description: `${w.description || 'Emergency work order'}${w.room_number ? ` · Room ${w.room_number}` : ''} · WO status ${w.status}. May require guest relocation and HK support.`,
      type: 'emergency',
      priority: 'critical',
      suggestedDepartments: ['Engineering', 'Front Office', 'Housekeeping'],
      startDate: w.created_date,
      endDate: null,
      source: 'Engineering portal',
    });
  }

  return suggestions;
}

// ── Routes ───────────────────────────────────────────────────────────────

router.get('/cross-dept-tasks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const cacheKey = `ops-tasks:${propertyId || 'all'}`;

  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const eqProp = (q: any): any => propertyId ? q.eq('property_id', propertyId) : q;
    const rows = await fetchRows(
      eqProp(supabaseAdmin!.from('ops_cross_dept_tasks').select('*').order('created_at', { ascending: false })),
      'ops_cross_dept_tasks',
    );

    const adoptedRefs = new Set(rows.map(r => r.source_ref).filter(Boolean));
    const suggestions = await buildSuggestions(propertyId, adoptedRefs);
    const tasks = rows.map(normTask);

    const payload = {
      generatedAt: new Date().toISOString(),
      tasks,
      suggestions,
      stats: {
        total: tasks.length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        critical: tasks.filter(t => t.priority === 'critical' && t.status !== 'completed').length,
        suggested: suggestions.length,
      },
    };

    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load tasks' });
  }
});

// POST /api/ops-portal/cross-dept-tasks — create a task.
router.post('/cross-dept-tasks', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!TASK_TYPES.includes(b.type)) return res.status(400).json({ error: 'invalid type' });

  const departments: DeptAssignment[] = (Array.isArray(b.departments) ? b.departments : [])
    .map((d: any) => typeof d === 'string'
      ? { department: d, status: 'pending' }
      : { department: d.department, status: d.status || 'pending', lead: d.lead })
    .filter((d: DeptAssignment) => d.department);

  const { data, error } = await supabaseAdmin.from('ops_cross_dept_tasks').insert({
    id: crypto.randomUUID(),
    property_id: b.propertyId || null,
    title: b.title.trim(),
    description: b.description || null,
    type: b.type,
    priority: ['low', 'medium', 'high', 'critical'].includes(b.priority) ? b.priority : 'medium',
    status: 'planning',
    departments,
    start_at: b.startDate || null,
    end_at: b.endDate || null,
    source_ref: b.sourceRef || null,
    created_by: req.user?.name || 'manager',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-tasks:*');
  return res.status(201).json({ ok: true, task: normTask(data) });
});

// POST /api/ops-portal/cross-dept-tasks/adopt — turn a live suggestion into
// a persisted task.
router.post('/cross-dept-tasks/adopt', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, sourceRef } = req.body || {};
  if (!sourceRef) return res.status(400).json({ error: 'sourceRef is required' });

  // Re-derive the suggestion so the adopted data comes from the live row.
  const existing = await fetchRows(
    supabaseAdmin!.from('ops_cross_dept_tasks').select('source_ref').eq('source_ref', sourceRef),
    'adopt check',
  );
  if (existing.length) return res.status(409).json({ error: 'Already adopted as a task' });

  const suggestions = await buildSuggestions(propertyId, new Set());
  const s = suggestions.find(x => x.sourceRef === sourceRef);
  if (!s) return res.status(404).json({ error: 'Suggestion no longer available' });

  const { data, error } = await supabaseAdmin.from('ops_cross_dept_tasks').insert({
    id: crypto.randomUUID(),
    property_id: propertyId || null,
    title: s.title,
    description: s.description,
    type: s.type,
    priority: s.priority,
    status: 'planning',
    departments: s.suggestedDepartments.map((d: string) => ({ department: d, status: 'pending' })),
    start_at: s.startDate,
    end_at: s.endDate,
    source_ref: sourceRef,
    created_by: req.user?.name || 'manager',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-tasks:*');
  return res.status(201).json({ ok: true, task: normTask(data) });
});

// PATCH /api/ops-portal/cross-dept-tasks/:id — update fields or one
// department's status.
router.patch('/cross-dept-tasks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const update: Record<string, any> = {};

  if (b.status !== undefined) {
    if (!TASK_STATUS.includes(b.status)) return res.status(400).json({ error: 'invalid status' });
    update.status = b.status;
  }
  if (b.priority !== undefined) {
    if (!['low', 'medium', 'high', 'critical'].includes(b.priority)) return res.status(400).json({ error: 'invalid priority' });
    update.priority = b.priority;
  }
  if (b.title !== undefined) update.title = b.title;
  if (b.description !== undefined) update.description = b.description;
  if (b.startDate !== undefined) update.start_at = b.startDate;
  if (b.endDate !== undefined) update.end_at = b.endDate;

  if (b.departmentUpdate) {
    const { department, status, lead } = b.departmentUpdate;
    if (!department || !DEPT_STATUS.includes(status)) {
      return res.status(400).json({ error: 'departmentUpdate requires department + valid status' });
    }
    const { data: row, error: readErr } = await supabaseAdmin
      .from('ops_cross_dept_tasks').select('departments').eq('id', req.params.id).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (!row) return res.status(404).json({ error: 'Task not found' });
    const departments: DeptAssignment[] = Array.isArray(row.departments) ? row.departments : [];
    const idx = departments.findIndex(d => d.department === department);
    if (idx === -1) return res.status(404).json({ error: `Department '${department}' not assigned` });
    departments[idx] = { ...departments[idx], status, lead: lead ?? departments[idx].lead };
    update.departments = departments;
  }

  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'nothing to update' });

  const { data, error } = await supabaseAdmin
    .from('ops_cross_dept_tasks').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-tasks:*');
  return res.json({ ok: true, task: normTask(data) });
});

// DELETE /api/ops-portal/cross-dept-tasks/:id
router.delete('/cross-dept-tasks/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('ops_cross_dept_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-tasks:*');
  return res.json({ ok: true });
});

export default router;
