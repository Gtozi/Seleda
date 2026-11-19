/**
 * Event & Group Coordination routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/event-coordination tab (EventGroupCoordination.tsx).
 * The Events portal's own tables are the source of truth:
 *
 *   GET   /event-coordination?propertyId=
 *         banquet_events (venues resolved via banquet_venues, per-event
 *         banquet_checklists rollup, linked ops_cross_dept_tasks for
 *         department coverage) + group_blocks as group check-in/out entries.
 *
 *   POST  /event-coordination/events                    — create a real
 *         banquet_events row (visible in the Events portal)
 *   PATCH /event-coordination/events/:id                — banquet_events status
 *   POST  /event-coordination/events/:id/coordination-task — create a linked
 *         ops_cross_dept_tasks row (shows up in the Cross-Dept tab)
 *   PATCH /event-coordination/checklists/:id            — toggle a
 *         banquet_checklists item (Events portal sees it)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 20 * 1000;

// banquet_events status vocabulary (live values observed in the Events portal).
const EVENT_STATUSES = ['Inquiry', 'Tentative', 'Planning', 'Confirmed', 'InProgress', 'Completed', 'Cancelled'] as const;

const TYPE_DEPT_DEFAULTS: Record<string, string[]> = {
  wedding: ['F&B', 'Events', 'Housekeeping', 'Engineering'],
  conference: ['Front Office', 'F&B', 'Events', 'Engineering', 'Security'],
  banquet: ['F&B', 'Events', 'Housekeeping'],
  'group-checkin': ['Front Office', 'Housekeeping', 'Bell Services'],
  'group-checkout': ['Front Office', 'Housekeeping', 'Bell Services'],
  event: ['Events', 'F&B'],
};

const eventType = (et: any): string => {
  const v = String(et || '').toLowerCase();
  if (v.includes('wedding')) return 'wedding';
  if (['conference', 'meeting', 'corporateevent', 'productlaunch', 'exhibition', 'seminar'].includes(v)) return 'conference';
  if (v.includes('banquet') || v.includes('dinner') || v.includes('gala')) return 'banquet';
  return 'event';
};

const boardStatus = (s: any): string => {
  const v = String(s || '').toLowerCase();
  if (v === 'inprogress' || v === 'in progress') return 'in-progress';
  if (v === 'confirmed') return 'setup';
  if (v === 'completed') return 'completed';
  if (v === 'cancelled') return 'completed';
  return 'planning'; // Inquiry / Tentative / Planning
};

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-events] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-events] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// GET /api/ops-portal/event-coordination
router.get('/event-coordination', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-events:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [events, venues, checklists, tasks, groups] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('banquet_events')
        .select('id, event_name, event_type, event_date, end_date, client_name, organizer_name, guest_count, expected_attendees, venue_ids, status, estimated_revenue, menu_package, notes')
        .not('status', 'in', '("Cancelled")')
        .order('event_date')), 'banquet_events'),
      fetchRows(supabaseAdmin!.from('banquet_venues').select('id, venue_name'), 'venues'),
      fetchRows(supabaseAdmin!.from('banquet_checklists')
        .select('id, event_id, item_name, category, due_date, assigned_to, is_completed'), 'checklists'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_cross_dept_tasks')
        .select('id, title, departments, status, source_ref')), 'tasks'),
      fetchRows(eqProp(supabaseAdmin!.from('group_blocks')
        .select('id, block_name, arrival_date, departure_date, blocked_rooms, total_rooms, status')
        .not('status', 'in', '("Closed","Cancelled","Released")')
        .order('arrival_date')), 'group_blocks'),
    ]);

    const venueName = new Map(venues.map((v: any) => [v.id, v.venue_name]));
    const clByEvent = new Map<string, any[]>();
    for (const c of checklists) {
      const arr = clByEvent.get(c.event_id) || [];
      arr.push(c);
      clByEvent.set(c.event_id, arr);
    }
    const taskByRef = new Map(tasks.map((t: any) => [t.source_ref, t]));

    const out: any[] = [];
    for (const e of events) {
      const type = eventType(e.event_type);
      const cl = clByEvent.get(e.id) || [];
      const done = cl.filter((c) => c.is_completed).length;
      const task = taskByRef.get(`banquet/${e.id}`);
      const depts = task?.departments?.length
        ? (task.departments as any[]).map((d) => d.department)
        : TYPE_DEPT_DEFAULTS[type] || TYPE_DEPT_DEFAULTS.event;

      out.push({
        id: e.id,
        name: e.event_name,
        type,
        date: e.event_date,
        endDate: e.end_date || undefined,
        location: (e.venue_ids || []).map((id: string) => venueName.get(id)).filter(Boolean).join(', ') || undefined,
        attendees: e.guest_count || e.expected_attendees || 0,
        status: boardStatus(e.status),
        rawStatus: e.status,
        departments: depts,
        coordinator: e.organizer_name || e.client_name || 'Unassigned',
        menuPackage: e.menu_package || undefined,
        revenue: e.estimated_revenue != null ? Number(e.estimated_revenue) : undefined,
        checklist: { total: cl.length, done, items: cl.map((c) => ({ id: c.id, name: c.item_name, category: c.category, dueDate: c.due_date, assignedTo: c.assigned_to, completed: !!c.is_completed })) },
        linkedTask: task ? { id: task.id, status: task.status, progress: task.status === 'Completed' ? 100 : task.status === 'In Progress' ? 50 : 0 } : null,
        source: 'banquet' as const,
      });
    }

    for (const g of groups) {
      for (const kind of ['group-checkin', 'group-checkout'] as const) {
        const date = kind === 'group-checkin' ? g.arrival_date : g.departure_date;
        if (!date) continue;
        out.push({
          id: `grp-${g.id}-${kind}`,
          name: `${g.block_name} — Group ${kind === 'group-checkin' ? 'Check-in' : 'Check-out'} (${g.blocked_rooms || g.total_rooms || '?'} rooms)`,
          type: kind,
          date,
          location: 'Front Desk',
          attendees: (g.blocked_rooms || g.total_rooms || 0) * 2,
          status: boardStatus(g.status === 'CheckedIn' ? 'InProgress' : g.status),
          rawStatus: g.status,
          departments: TYPE_DEPT_DEFAULTS[kind],
          coordinator: 'Front Office',
          checklist: { total: 0, done: 0, items: [] },
          linkedTask: null,
          source: 'group' as const,
        });
      }
    }

    out.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const payload = {
      generatedAt: new Date().toISOString(),
      events: out,
      stats: {
        total: out.length,
        upcoming: out.filter((e) => e.date >= new Date().toISOString().slice(0, 10)).length,
        inProgress: out.filter((e) => e.status === 'in-progress').length,
        attendees: out.reduce((n, e) => n + (e.attendees || 0), 0),
        checklistDone: out.reduce((n, e) => n + e.checklist.done, 0),
        checklistTotal: out.reduce((n, e) => n + e.checklist.total, 0),
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load events' });
  }
});

// POST /api/ops-portal/event-coordination/events — create a banquet_events row.
router.post('/event-coordination/events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.name?.trim() || !b.date) return res.status(400).json({ error: 'name and date are required' });

  // banquet_events is a VIEW over event_bookings — omit rather than null out
  // fields that map to NOT NULL columns (estimated_revenue → quoted_amount etc.),
  // since an explicit NULL bypasses the underlying column default.
  const record: Record<string, any> = {
    id: `EVT-OPS-${Date.now()}`,
    property_id: b.propertyId || null,
    event_name: b.name.trim(),
    event_type: b.eventType || 'Banquet',
    event_date: b.date,
    end_date: b.endDate || b.date,
    client_name: b.clientName || null,
    organizer_name: b.coordinator || req.user?.name || null,
    status: 'Inquiry',
    notes: b.notes || null,
  };
  if (b.attendees != null) record.guest_count = Number(b.attendees);
  if (b.revenue != null) record.estimated_revenue = Number(b.revenue);

  const { data, error } = await supabaseAdmin.from('banquet_events').insert(record).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-events:*');
  return res.status(201).json({ ok: true, event: data });
});

// PATCH /api/ops-portal/event-coordination/events/:id — banquet_events fields.
router.patch('/event-coordination/events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const update: Record<string, any> = {};
  if (b.status !== undefined) {
    if (!EVENT_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of: ${EVENT_STATUSES.join(', ')}` });
    }
    update.status = b.status;
  }
  if (b.coordinator !== undefined) update.organizer_name = b.coordinator;
  if (b.attendees !== undefined) update.guest_count = b.attendees;
  if (b.notes !== undefined) update.notes = b.notes;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'nothing to update' });
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('banquet_events').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-events:*');
  return res.json({ ok: true, event: data });
});

// POST /api/ops-portal/event-coordination/events/:id/coordination-task —
// create a linked ops_cross_dept_tasks row (source_ref = banquet/{id}).
router.post('/event-coordination/events/:id/coordination-task', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const ref = `banquet/${req.params.id}`;

  const { data: existing } = await supabaseAdmin
    .from('ops_cross_dept_tasks').select('id').eq('source_ref', ref).maybeSingle();
  if (existing) return res.status(409).json({ error: 'coordination task already exists', taskId: existing.id });

  const { data: ev, error: evErr } = await supabaseAdmin
    .from('banquet_events').select('id, event_name, event_type, event_date, end_date, property_id').eq('id', req.params.id).single();
  if (evErr || !ev) return res.status(404).json({ error: 'event not found' });

  const type = eventType(ev.event_type);
  const depts = (req.body?.departments?.length ? req.body.departments : TYPE_DEPT_DEFAULTS[type] || TYPE_DEPT_DEFAULTS.event)
    .map((d: string) => ({ department: d, status: 'pending', lead: null }));

  const { data, error } = await supabaseAdmin.from('ops_cross_dept_tasks').insert({
    id: `cdt-${Date.now()}`,
    property_id: req.body?.propertyId || ev.property_id || null,
    title: `${type === 'wedding' ? 'Wedding' : type === 'conference' ? 'Conference' : 'Event'} — ${ev.event_name}`,
    description: `Cross-department coordination for banquet event ${ev.id} on ${ev.event_date}.`,
    type,
    priority: 'medium',
    status: 'planning',
    departments: depts,
    start_at: `${ev.event_date}T00:00:00Z`,
    end_at: `${ev.end_date || ev.event_date}T23:59:59Z`,
    source_ref: ref,
    created_by: req.user?.name || 'manager',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-events:*');
  cacheService.invalidate('ops-crossdept:*');
  return res.status(201).json({ ok: true, task: data });
});

// PATCH /api/ops-portal/event-coordination/checklists/:id — toggle item.
router.patch('/event-coordination/checklists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('banquet_checklists')
    .update({ is_completed: !!req.body?.completed, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, event_id, item_name, is_completed').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-events:*');
  return res.json({ ok: true, item: data });
});

export default router;
