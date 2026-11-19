/**
 * Operations Morning Meeting routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/morning-meeting tab (MorningMeetingDashboard.tsx).
 *
 * Endpoints:
 *   GET    /morning-meeting?propertyId=&date=YYYY-MM-DD
 *          Returns live performance metrics (yesterday's occupancy /
 *          revenue / ADR / satisfaction, today's expected occupancy /
 *          arrivals / departures / VIP arrivals) plus the persisted
 *          agenda checklist. On first view of a date the standard
 *          10-item agenda is auto-generated (source='template') with
 *          descriptions filled from live data.
 *   POST   /morning-meeting/items            create an agenda item
 *   PATCH  /morning-meeting/items/:id        update status/fields
 *   DELETE /morning-meeting/items/:id        delete an agenda item
 *
 * Metrics are aggregated live from the other portals' real tables
 * (reservations, guests, guest_feedback, guest_requests, work_orders,
 * corrective_maintenance_tasks, housekeeping_task_mgmt, banquet_events,
 * department shift-requirement tables, orders, spa_appointments,
 * ops_command_alerts). Every source query is non-fatal: a missing table
 * degrades that metric rather than 500ing the endpoint.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

const CACHE_TTL_MS = 20 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Fetch helper — a missing/renamed table is non-fatal ──────────────────

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-morning-meeting] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-morning-meeting] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// ── Shared predicates ────────────────────────────────────────────────────

const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
const CM_CLOSED = new Set(['Completed', 'Verified']);
const HK_TASK_CLOSED = new Set(['Completed', 'Verified']);
const EVENT_CLOSED = new Set(['Completed', 'Cancelled']);
const ORDER_EXCLUDE = new Set(['Voided', 'Cancelled']);
const RES_EXCLUDE = new Set(['Cancelled', 'NoShow', 'No Show']);
const GREQ_CLOSED = new Set(['completed', 'cancelled', 'closed', 'resolved']);
const CRIT_PRI = new Set(['urgent', 'emergency', 'critical']);
const HIGH_PRI = new Set(['high', 'urgent', 'emergency', 'critical']);

const isOpenGreq = (g: any) => !GREQ_CLOSED.has(String(g.status || '').toLowerCase());

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const datePart = (v: any): string => String(v || '').slice(0, 10);

const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString()}`;

// ── Metrics computation ──────────────────────────────────────────────────

async function computeMetrics(date: string, propertyId: string | undefined) {
  const eqProp = (q: any): any =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const prevDate = addDays(date, -1);
  const feedbackWindow = addDays(date, -30);

  const [
    rooms, reservations, vipGuests, feedback, guestRequests,
    workOrders, correctiveTasks, hkTasks, events,
    hkShifts, foShifts, fbShifts, engShifts,
    yesterdayOrders, spaYesterday, activeAlerts,
  ] = await Promise.all([
    fetchRows(eqProp(supabaseAdmin!.from('rooms')
      .select('id, number')), 'rooms'),
    fetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, guest_name, room_number, room_type, check_in_date, check_out_date, status, adults, children, total_amount, rate, guest_id'))
      .gte('check_out_date', prevDate), 'reservations'),
    fetchRows(eqProp(supabaseAdmin!.from('guests')
      .select('id, name, status'))
      .eq('status', 'VIP'), 'guests'),
    fetchRows(eqProp(supabaseAdmin!.from('guest_feedback')
      .select('id, rating, submitted_at, created_at'))
      .gte('created_at', `${feedbackWindow}T00:00:00`), 'guest_feedback'),
    fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('id, request_type, status, priority, room_number, guest_name')), 'guest_requests'),
    fetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, status, priority')), 'work_orders'),
    fetchRows(eqProp(supabaseAdmin!.from('corrective_maintenance_tasks')
      .select('id, status, priority')), 'corrective_maintenance_tasks'),
    fetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
      .select('id, status, due_date')), 'housekeeping_task_mgmt'),
    fetchRows(eqProp(supabaseAdmin!.from('banquet_events')
      .select('id, event_name, event_date, end_date, status, actual_revenue'))
      .gte('event_date', addDays(date, -30)), 'banquet_events'),
    fetchRows(eqProp(supabaseAdmin!.from('hk_shift_requirements')
      .select('assigned_staff, required_staff')), 'hk_shift_requirements'),
    fetchRows(eqProp(supabaseAdmin!.from('fo_shift_requirements')
      .select('assigned_staff, required_staff')), 'fo_shift_requirements'),
    fetchRows(eqProp(supabaseAdmin!.from('fb_shift_requirements')
      .select('assigned_staff, required_staff')), 'fb_shift_requirements'),
    fetchRows(eqProp(supabaseAdmin!.from('eng_tech_shifts')
      .select('assigned_staff, required_staff')), 'eng_tech_shifts'),
    fetchRows(eqProp(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, is_complimentary'))
      .gte('created_at', `${prevDate}T00:00:00`)
      .lt('created_at', `${date}T00:00:00`), 'orders_yesterday'),
    fetchRows(eqProp(supabaseAdmin!.from('spa_appointments')
      .select('id, status, appointment_date, amount'))
      .eq('appointment_date', prevDate), 'spa_yesterday'),
    fetchRows(eqProp(supabaseAdmin!.from('ops_command_alerts')
      .select('id, severity'))
      .eq('status', 'Active'), 'ops_command_alerts'),
  ]);

  // ── Yesterday's performance ─────────────────────────────────────────
  const roomsTotal = rooms.length;
  const occupiedYesterday = reservations.filter(r =>
    !RES_EXCLUDE.has(r.status) &&
    datePart(r.check_in_date) <= prevDate && datePart(r.check_out_date) > prevDate);
  const occupiedYesterdayCount = new Set(
    occupiedYesterday.map(r => r.room_number || r.id)
  ).size;
  const yesterdayOccupancy = roomsTotal > 0
    ? Math.round((occupiedYesterdayCount / roomsTotal) * 100)
    : 0;
  const adr = occupiedYesterday.length > 0
    ? Math.round(
        occupiedYesterday.reduce((s, r) => s + num(r.rate), 0) / occupiedYesterday.length)
    : 0;

  const fnbRevenue = yesterdayOrders
    .filter(o => !ORDER_EXCLUDE.has(o.status) && !o.is_complimentary)
    .reduce((s, o) => s + num(o.total_amount), 0);
  const spaRevenue = spaYesterday
    .filter(a => a.status === 'Completed')
    .reduce((s, a) => s + num(a.amount), 0);
  const eventsRevenue = events
    .filter(e => datePart(e.event_date) === prevDate && !EVENT_CLOSED.has(e.status))
    .reduce((s, e) => s + num(e.actual_revenue), 0);
  const yesterdayRevenue = Math.round(fnbRevenue + spaRevenue + eventsRevenue);

  const ratings = feedback.map(f => num(f.rating)).filter(r => r > 0);
  const satisfaction = ratings.length > 0
    ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
    : null;

  // ── Today's occupancy ────────────────────────────────────────────────
  const occupiedToday = new Set(
    reservations
      .filter(r => r.status === 'CheckedIn' &&
        datePart(r.check_in_date) <= date && datePart(r.check_out_date) > date)
      .map(r => r.room_number || r.id)
  ).size;
  const pendingArrivals = reservations.filter(r =>
    datePart(r.check_in_date) === date && r.status === 'Confirmed').length;
  const expectedOccupancy = roomsTotal > 0
    ? Math.min(100, Math.round(((occupiedToday + pendingArrivals) / roomsTotal) * 100))
    : 0;
  const arrivals = reservations.filter(r =>
    datePart(r.check_in_date) === date && !RES_EXCLUDE.has(r.status)).length;
  const departures = reservations.filter(r =>
    datePart(r.check_out_date) === date && !RES_EXCLUDE.has(r.status)).length;

  const vipIds = new Set(vipGuests.map(g => g.id));
  const vipNames = new Set(vipGuests.map(g => String(g.name || '').toLowerCase()));
  const vipArrivals = reservations.filter(r =>
    datePart(r.check_in_date) === date && !RES_EXCLUDE.has(r.status) &&
    (vipIds.has(r.guest_id) || vipNames.has(String(r.guest_name || '').toLowerCase())));

  // ── Agenda context counts ────────────────────────────────────────────
  const openGreqs = guestRequests.filter(isOpenGreq);
  const complaints = openGreqs.filter(g =>
    String(g.request_type || '').toLowerCase().includes('complaint'));
  const openWOs = workOrders.filter(w => !WO_CLOSED.has(w.status));
  const openCMs = correctiveTasks.filter(c => !CM_CLOSED.has(c.status));
  const now = Date.now();
  const openHkTasks = hkTasks.filter(t => !HK_TASK_CLOSED.has(t.status));
  const overdueHkTasks = openHkTasks.filter(t =>
    t.due_date && !isNaN(new Date(t.due_date).getTime()) && new Date(t.due_date).getTime() < now);
  const todayEvents = events.filter(e => {
    const start = datePart(e.event_date);
    const end = datePart(e.end_date) || start;
    return start <= date && end >= date && !EVENT_CLOSED.has(e.status);
  });

  const staffingGaps: string[] = [];
  const gapOf = (name: string, rows: any[]) => {
    const req = rows.reduce((s, r) => s + num(r.required_staff), 0);
    const asg = rows.reduce((s, r) => s + num(r.assigned_staff), 0);
    const gap = req - asg;
    if (req > 0 && gap > 0) staffingGaps.push(`${name} ${gap}`);
  };
  gapOf('FO', foShifts);
  gapOf('HK', hkShifts);
  gapOf('F&B', fbShifts);
  gapOf('Eng', engShifts);

  return {
    metrics: {
      previousDayPerformance: {
        occupancy: yesterdayOccupancy,
        revenue: yesterdayRevenue,
        adr,
        satisfaction,
      },
      todaysOccupancy: {
        expected: expectedOccupancy,
        arrivals,
        departures,
        vipArrivals: vipArrivals.length,
      },
    },
    agendaContext: {
      yesterdayOccupancy,
      yesterdayRevenue,
      adr,
      satisfaction,
      feedbackCount: ratings.length,
      expectedOccupancy,
      arrivals,
      departures,
      vipCount: vipArrivals.length,
      vipNamesList: vipArrivals.map(r => r.guest_name).filter(Boolean).slice(0, 3),
      openComplaints: complaints.length || openGreqs.length,
      urgentRequests: openGreqs.filter(g => HIGH_PRI.has(String(g.priority || '').toLowerCase())).length,
      openWOs: openWOs.length,
      criticalWOs: openWOs.filter(w => CRIT_PRI.has(String(w.priority || '').toLowerCase())).length,
      openCMs: openCMs.length,
      openHkTasks: openHkTasks.length,
      overdueHkTasks: overdueHkTasks.length,
      eventCount: todayEvents.length,
      eventNames: todayEvents.map(e => e.event_name).filter(Boolean).slice(0, 3),
      staffingGaps,
      activeAlerts: activeAlerts.length,
      criticalAlerts: activeAlerts.filter(a => a.severity === 'critical').length,
    },
  };
}

// ── Template agenda — the standard 10 items, descriptions from live data ─

function buildTemplateItems(ctx: any) {
  const items = [
    {
      category: 'Performance', priority: 'high', estimatedTime: 10,
      title: 'Previous Day Performance Review',
      description: `Yesterday: ${ctx.yesterdayOccupancy}% occupancy · ${fmtMoney(ctx.yesterdayRevenue)} revenue · ADR ${fmtMoney(ctx.adr)}` +
        (ctx.satisfaction !== null ? ` · ${ctx.satisfaction}/5 satisfaction (${ctx.feedbackCount} responses, 30d)` : ' · no recent guest feedback'),
    },
    {
      category: 'Operations', priority: 'high', estimatedTime: 5,
      title: "Today's Occupancy",
      description: `${ctx.expectedOccupancy}% expected — ${ctx.arrivals} arrivals, ${ctx.departures} departures`,
    },
    {
      category: 'VIP', priority: 'high', estimatedTime: 5,
      title: 'VIP Guests',
      description: ctx.vipCount > 0
        ? `${ctx.vipCount} VIP arrival${ctx.vipCount === 1 ? '' : 's'} today${ctx.vipNamesList.length ? `: ${ctx.vipNamesList.join(', ')}` : ''}`
        : 'No VIP arrivals on the books today',
    },
    {
      category: 'Guest Experience', priority: 'high', estimatedTime: 10,
      title: 'Guest Complaints & Requests',
      description: `${ctx.openComplaints} open guest request${ctx.openComplaints === 1 ? '' : 's'}` +
        (ctx.urgentRequests > 0 ? ` (${ctx.urgentRequests} high-priority)` : ''),
    },
    {
      category: 'Maintenance', priority: 'medium', estimatedTime: 5,
      title: 'Maintenance Updates',
      description: `${ctx.openWOs} open work order${ctx.openWOs === 1 ? '' : 's'}` +
        (ctx.criticalWOs > 0 ? ` (${ctx.criticalWOs} critical)` : '') +
        `, ${ctx.openCMs} corrective task${ctx.openCMs === 1 ? '' : 's'}`,
    },
    {
      category: 'Housekeeping', priority: 'medium', estimatedTime: 5,
      title: 'Housekeeping Status',
      description: `${ctx.openHkTasks} task${ctx.openHkTasks === 1 ? '' : 's'} in flight` +
        (ctx.overdueHkTasks > 0 ? `, ${ctx.overdueHkTasks} overdue` : ', none overdue'),
    },
    {
      category: 'Events', priority: 'medium', estimatedTime: 5,
      title: 'Event Schedule',
      description: ctx.eventCount > 0
        ? `${ctx.eventCount} event${ctx.eventCount === 1 ? '' : 's'} today${ctx.eventNames.length ? `: ${ctx.eventNames.join(', ')}` : ''}`
        : 'No events scheduled today',
    },
    {
      category: 'Staffing', priority: 'medium', estimatedTime: 5,
      title: 'Staffing Issues',
      description: ctx.staffingGaps.length > 0
        ? `Coverage gaps: ${ctx.staffingGaps.join(', ')}`
        : 'All tracked departments fully staffed',
    },
    {
      category: 'Revenue', priority: 'high', estimatedTime: 5,
      title: 'Revenue Update',
      description: `Yesterday ${fmtMoney(ctx.yesterdayRevenue)} (F&B + spa + events)`,
    },
    {
      category: 'Action Items', priority: 'high', estimatedTime: 10,
      title: 'Action Items',
      description: `${ctx.activeAlerts} active ops alert${ctx.activeAlerts === 1 ? '' : 's'}` +
        (ctx.criticalAlerts > 0 ? ` (${ctx.criticalAlerts} critical)` : '') +
        ' — assign owners and confirm follow-ups',
    },
  ];
  return items;
}

// ── Routes ───────────────────────────────────────────────────────────────

// GET /api/ops-portal/morning-meeting — live metrics + persisted agenda.
router.get('/morning-meeting', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const date = (req.query as Record<string, string>).date || todayStr();
  const cacheKey = `ops-morning-meeting:${propertyId || 'all'}:${date}`;

  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { metrics, agendaContext } = await computeMetrics(date, propertyId);

    // Load persisted items; on first view of a date, seed the standard
    // template agenda (deterministic ids make concurrent seeding safe).
    let itemsQ = supabaseAdmin.from('ops_meeting_agenda_items')
      .select('*')
      .eq('meeting_date', date)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (propertyId) itemsQ = itemsQ.eq('property_id', propertyId);
    let { data: items, error: itemsErr } = await itemsQ;
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    if (!items || items.length === 0) {
      const scope = propertyId || 'all';
      const rows = buildTemplateItems(agendaContext).map((t, i) => ({
        id: `mtg-${scope}-${date}-tpl-${i}`,
        property_id: propertyId || null,
        meeting_date: date,
        category: t.category,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: 'pending',
        estimated_time: t.estimatedTime,
        sort_order: i,
        source: 'template',
        created_by: req.user?.name || req.user?.id || null,
      }));
      await supabaseAdmin.from('ops_meeting_agenda_items')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

      let refetch = supabaseAdmin.from('ops_meeting_agenda_items')
        .select('*')
        .eq('meeting_date', date)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (propertyId) refetch = refetch.eq('property_id', propertyId);
      const { data: seeded } = await refetch;
      items = seeded || [];
    }

    const agendaItems = (items || []).map((it: any) => ({
      id: it.id,
      category: it.category,
      title: it.title,
      description: it.description || '',
      status: it.status,
      priority: it.priority,
      assignedTo: it.assigned_to || null,
      estimatedTime: it.estimated_time ?? null,
      notes: it.notes || null,
      sortOrder: it.sort_order,
      source: it.source,
    }));

    const payload = { date, ...metrics, agendaItems, generatedAt: new Date().toISOString() };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load morning meeting' });
  }
});

function invalidateMeetingCache(propertyId: string | undefined, date: string) {
  cacheService.invalidate(`ops-morning-meeting:${propertyId || 'all'}:${date}`);
}

// POST /api/ops-portal/morning-meeting/items — add an agenda item.
router.post('/morning-meeting/items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const propertyId = (b.propertyId as string) || undefined;
  const date = (b.meetingDate as string) || todayStr();
  if (!b.title) return res.status(400).json({ error: 'title is required' });

  try {
    const id = `mtg-${propertyId || 'all'}-${date}-m-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('ops_meeting_agenda_items')
      .insert({
        id,
        property_id: propertyId || null,
        meeting_date: date,
        category: b.category || 'General',
        title: b.title,
        description: b.description || null,
        priority: b.priority || 'medium',
        status: 'pending',
        assigned_to: b.assignedTo || null,
        estimated_time: b.estimatedTime ?? null,
        notes: b.notes || null,
        sort_order: b.sortOrder ?? 100,
        source: 'manual',
        created_by: req.user?.name || req.user?.id || null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    invalidateMeetingCache(propertyId, date);
    return res.status(201).json({ id: data.id });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to create agenda item' });
  }
});

// PATCH /api/ops-portal/morning-meeting/items/:id — update an item.
router.patch('/morning-meeting/items/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};

  const patch: Record<string, any> = {};
  if (b.category !== undefined) patch.category = b.category;
  if (b.title !== undefined) patch.title = b.title;
  if (b.description !== undefined) patch.description = b.description;
  if (b.priority !== undefined) patch.priority = b.priority;
  if (b.status !== undefined) patch.status = b.status;
  if (b.assignedTo !== undefined) patch.assigned_to = b.assignedTo;
  if (b.estimatedTime !== undefined) patch.estimated_time = b.estimatedTime;
  if (b.notes !== undefined) patch.notes = b.notes;
  if (b.sortOrder !== undefined) patch.sort_order = b.sortOrder;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });

  try {
    const { data, error } = await supabaseAdmin
      .from('ops_meeting_agenda_items')
      .update(patch)
      .eq('id', req.params.id)
      .select('meeting_date, property_id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Agenda item not found' });

    invalidateMeetingCache(data.property_id || undefined, datePart(data.meeting_date));
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update agenda item' });
  }
});

// DELETE /api/ops-portal/morning-meeting/items/:id — remove an item.
router.delete('/morning-meeting/items/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { data, error } = await supabaseAdmin
      .from('ops_meeting_agenda_items')
      .delete()
      .eq('id', req.params.id)
      .select('meeting_date, property_id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Agenda item not found' });

    invalidateMeetingCache(data.property_id || undefined, datePart(data.meeting_date));
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to delete agenda item' });
  }
});

export default router;
