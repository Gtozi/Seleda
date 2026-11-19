/**
 * Operations Portal — Executive Dashboard route.
 *
 *   GET /dashboard?period=today|week|month&propertyId=
 *       — live KPI groups (rooms / revenue / guest / operations) with
 *         previous-period deltas, plus a real cross-portal alerts feed
 *         (emergencies, critical incidents, emergency WOs, overdue
 *         escalations, OOO rooms, VIP arrivals, stale urgent requests).
 *
 * No new tables — aggregates existing portal tables only.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { cacheService } from '../services/cacheService';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: PromiseLike<any>, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-dash] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-dash] ${tag}: ${e?.message || e}`);
    return [];
  }
}

function scoped(query: any, propertyId: string | null) {
  return propertyId ? query.eq('property_id', propertyId) : query;
}

const OPEN_WO = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor'];
const OPEN_INCIDENT = ['Draft', 'Reported', 'Classified', 'Assigned', 'In Progress', 'Investigation', 'Corrective Action', 'Active', 'Pending'];
const OPEN_REQ = ['Open', 'In Progress', 'Assigned'];
const DONE_TASK = /completed|verified|inspected/i;
const ACTIVE_RES = ['Confirmed', 'CheckedIn', 'Booked', 'InHouse'];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const inRange = (dateStr: string | null | undefined, start: string, end: string) =>
  !!dateStr && dateStr >= start && dateStr <= end;
const pctChange = (cur: number, prev: number) =>
  prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;
const trendOf = (change: number) => (change > 0 ? 'up' : change < 0 ? 'down' : 'stable');
const nightsBetween = (a: string, b: string) =>
  Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

interface PeriodWindow { start: Date; end: Date; prevStart: Date; prevEnd: Date; nextStart: Date; nextEnd: Date; days: number }

function periodWindow(period: string): PeriodWindow {
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') {
    const day = now.getDay();
    start.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  } else if (period === 'month') {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  const elapsed = Math.max(now.getTime() - start.getTime(), 3600000);
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - elapsed);
  const nextStart = new Date(now);
  const nextEnd = new Date(now.getTime() + elapsed);
  return { start, end: now, prevStart, prevEnd, nextStart, nextEnd, days: Math.max(1, Math.ceil(elapsed / 86400000)) };
}

router.get('/dashboard', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query.propertyId as string) || null;
  const period = ['today', 'week', 'month'].includes(String(req.query.period)) ? String(req.query.period) : 'today';
  const cacheKey = `ops-dash:${propertyId || 'all'}:${period}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const w = periodWindow(period);
    const s = isoDay(w.start); const e = isoDay(w.end);
    const ps = isoDay(w.prevStart); const pe = isoDay(w.prevEnd);
    const ns = isoDay(w.nextStart); const ne = isoDay(w.nextEnd);

    const [
      rooms, reservations, vipGuests, hkTasks, workOrders, guestRequests,
      incidents, emergencies, escalations, recoveryCases, feedback,
      attendance, events,
    ] = await Promise.all([
      fetchRows(scoped(supabaseAdmin!.from('rooms').select('id, number, status, rate'), propertyId), 'rooms'),
      fetchRows(scoped(supabaseAdmin!.from('reservations')
        .select('id, guest_name, check_in_date, check_out_date, status, rate, total_amount, created_at'), propertyId), 'reservations'),
      fetchRows(scoped(supabaseAdmin!.from('guests').select('id, name').in('status', ['VIP', 'Loyalty Member']), propertyId), 'vip_guests'),
      fetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt').select('id, status, created_at, due_date'), propertyId), 'hk_tasks'),
      fetchRows(scoped(supabaseAdmin!.from('work_orders').select('id, status, priority, title, room_number, created_date'), propertyId), 'work_orders'),
      fetchRows(scoped(supabaseAdmin!.from('guest_requests').select('id, status, priority, request_type, guest_name, created_at'), propertyId), 'guest_requests'),
      fetchRows(scoped(supabaseAdmin!.from('sec_incidents').select('id, incident_type, location, status, priority, reported_at'), propertyId), 'incidents'),
      fetchRows(scoped(supabaseAdmin!.from('sec_emergency_notifications').select('id, emergency_type, location, status, priority, created_at'), propertyId), 'emergencies'),
      fetchRows(scoped(supabaseAdmin!.from('ops_escalations').select('id, type, description, severity, status, due_by, created_at'), propertyId), 'escalations'),
      fetchRows(scoped(supabaseAdmin!.from('ops_recovery_cases').select('id, guest_name, complaint, status, created_at'), propertyId), 'recovery'),
      fetchRows(scoped(supabaseAdmin!.from('guest_feedback').select('id, rating, submitted_at, created_at'), propertyId), 'feedback'),
      fetchRows(scoped(supabaseAdmin!.from('staff_attendance').select('id, staff_name, department_scope, status, attendance_date').eq('attendance_date', e), propertyId), 'attendance'),
      fetchRows(scoped(supabaseAdmin!.from('banquet_events').select('id, event_name, event_date, estimated_revenue, status'), propertyId), 'events'),
    ]);

    // ── Rooms ──
    const occupied = rooms.filter(r => /^occupied/i.test(r.status || ''));
    const ooo = rooms.filter(r => /out.?of.?(order|service)|maintenance/i.test(r.status || ''));
    const sellable = Math.max(rooms.length - ooo.length, 0);
    const available = rooms.filter(r => /^vacant|inspected/i.test(r.status || '')).length;
    const occPct = sellable ? Math.round((occupied.length / sellable) * 100) : 0;
    const activeRes = reservations.filter(r => ACTIVE_RES.includes(r.status));
    const arrivals = activeRes.filter(r => inRange(r.check_in_date, s, e));
    const departures = activeRes.filter(r => inRange(r.check_out_date, s, e));
    const arrivalsPrev = activeRes.filter(r => inRange(r.check_in_date, ps, pe)).length;
    const departuresPrev = activeRes.filter(r => inRange(r.check_out_date, ps, pe)).length;
    const vipNames = new Set(vipGuests.map(g => String(g.name || '').toLowerCase()));
    const vipArrivals = arrivals.filter(r => vipNames.has(String(r.guest_name || '').toLowerCase()));

    // ── Revenue (room overlap nights + events) ──
    const resRate = (r: any) => {
      const rate = Number(r.rate);
      if (rate > 0) return rate;
      const total = Number(r.total_amount);
      return total > 0 ? total / nightsBetween(r.check_in_date, r.check_out_date) : 0;
    };
    const overlapNights = (r: any, from: string, to: string) => {
      const a = r.check_in_date > from ? r.check_in_date : from;
      const b = r.check_out_date < to ? r.check_out_date : to;
      return a <= b ? nightsBetween(a, b) : 0;
    };
    const revIn = (from: string, to: string) => {
      const room = activeRes
        .filter(r => r.check_in_date <= to && r.check_out_date >= from)
        .reduce((n, r) => n + resRate(r) * overlapNights(r, from, to), 0);
      const ev = events
        .filter(x => inRange(x.event_date, from, to) && !/cancelled/i.test(x.status || ''))
        .reduce((n, x) => n + (Number(x.estimated_revenue) || 0), 0);
      return { room, event: ev, total: room + ev };
    };
    const revCur = revIn(s, e);
    const revPrev = revIn(ps, pe);
    const revNext = revIn(ns, ne);
    const inhouse = activeRes.filter(r => r.check_in_date <= e && r.check_out_date >= s);
    const occupiedNights = inhouse.reduce((n, r) => n + overlapNights(r, s, e), 0);
    const adr = occupiedNights ? Math.round(revCur.room / occupiedNights) : 0;
    const revpar = sellable ? Math.round(revCur.room / (sellable * w.days)) : 0;

    // ── Guest experience ──
    const openReqs = guestRequests.filter(r => OPEN_REQ.includes(r.status));
    const complaints = openReqs.filter(r => /complaint|issue|problem/i.test(r.request_type || ''));
    const openRecovery = recoveryCases.filter(r => r.status !== 'closed');
    const openComplaints = complaints.length + openRecovery.length;
    const complaintsPrev = guestRequests.filter(r => /complaint|issue|problem/i.test(r.request_type || '') && inRange(String(r.created_at || '').slice(0, 10), ps, pe)).length
      + recoveryCases.filter(r => inRange(String(r.created_at || '').slice(0, 10), ps, pe)).length;
    const fbIn = (from: string, to: string) => feedback.filter(f => inRange(String(f.submitted_at || f.created_at || '').slice(0, 10), from, to));
    const fbCur = fbIn(s, e); const fbPrev = fbIn(ps, pe);
    const avgOf = (rows: any[]) => {
      const rated = rows.map(f => Number(f.rating)).filter(v => v > 0);
      return rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null;
    };
    const satisfaction = avgOf(fbCur) ?? avgOf(feedback) ?? null;
    const satPrev = avgOf(fbPrev);

    // ── Operations ──
    const openWOs = workOrders.filter(x => OPEN_WO.includes(x.status));
    const woPrevCreated = workOrders.filter(x => inRange(String(x.created_date || '').slice(0, 10), ps, pe)).length;
    const woCurCreated = workOrders.filter(x => inRange(String(x.created_date || '').slice(0, 10), s, e)).length;
    const hkPeriod = hkTasks.filter(t => inRange(String(t.created_at || '').slice(0, 10), s, e) || inRange(t.due_date, s, e));
    const hkDone = hkPeriod.filter(t => DONE_TASK.test(t.status || '')).length;
    const hkPct = hkPeriod.length ? Math.round((hkDone / hkPeriod.length) * 100) : 0;
    const openIncidents = incidents.filter(i => OPEN_INCIDENT.includes(i.status));
    const incidentsPrev = incidents.filter(i => inRange(String(i.reported_at || '').slice(0, 10), ps, pe)).length;
    const incidentsCur = incidents.filter(i => inRange(String(i.reported_at || '').slice(0, 10), s, e)).length;
    const presentStaff = attendance.filter(a => /present|checked.?in|on.?duty|late/i.test(a.status || '')).length;
    const staffPct = attendance.length ? Math.round((presentStaff / attendance.length) * 100) : null;

    const kpi = (title: string, value: string | number, change: number, extra?: any) =>
      ({ title, value, change, trend: trendOf(change), ...extra });

    const groups = {
      rooms: [
        kpi('Occupancy', `${occPct}%`, 0, { caption: `${occupied.length}/${sellable} rooms` }),
        kpi('Available Rooms', available, 0),
        kpi('Out of Order', ooo.length, 0),
        kpi('Arrivals', arrivals.length, pctChange(arrivals.length, arrivalsPrev)),
        kpi('Departures', departures.length, pctChange(departures.length, departuresPrev)),
        kpi('VIP Arrivals', vipArrivals.length, 0, { caption: 'in period' }),
        kpi('In-House Guests', inhouse.length, 0),
        kpi('Events', events.filter(x => inRange(x.event_date, s, e) && !/cancelled/i.test(x.status || '')).length, 0, { caption: 'in period' }),
      ],
      revenue: [
        kpi('Revenue', Math.round(revCur.total), pctChange(revCur.total, revPrev.total), { money: true, caption: `rooms ${Math.round(revCur.room)} · events ${Math.round(revCur.event)}` }),
        kpi('ADR', adr, 0, { money: true }),
        kpi('RevPAR', revpar, 0, { money: true }),
        kpi('Forecast (next)', Math.round(revNext.total), 0, { money: true }),
      ],
      guest: [
        kpi('Open Complaints', openComplaints, -pctChange(openComplaints, complaintsPrev), { caption: `${openRecovery.length} recovery case(s)` }),
        kpi('Guest Satisfaction', satisfaction != null ? `${satisfaction}/5` : '—', satPrev != null && satisfaction != null ? Math.round((satisfaction - satPrev) * 10) : 0),
        kpi('Service Recovery', openRecovery.length, 0),
        kpi('Feedback Received', fbCur.length, pctChange(fbCur.length, fbPrev.length)),
      ],
      operations: [
        kpi('Open Work Orders', openWOs.length, -pctChange(woCurCreated, woPrevCreated), { caption: `${openWOs.filter(x => x.priority === 'Emergency').length} emergency` }),
        kpi('Housekeeping Done', `${hkPct}%`, 0, { caption: `${hkDone}/${hkPeriod.length} tasks` }),
        kpi('Open Incidents', openIncidents.length, -pctChange(incidentsCur, incidentsPrev)),
        kpi('Staffing Today', staffPct != null ? `${staffPct}%` : '—', 0, { caption: `${presentStaff}/${attendance.length} present` }),
      ],
    };

    // ── Alerts (real rows, severity-ordered) ──
    type Alert = { id: string; type: 'critical' | 'warning' | 'info'; title: string; description: string; time: string | null; department: string; acknowledgeable?: string };
    const alerts: Alert[] = [];
    const now = Date.now();

    for (const x of emergencies.filter(v => ['Active', 'In Progress'].includes(v.status))) {
      alerts.push({ id: `emg-${x.id}`, type: 'critical', title: `${x.emergency_type || 'Emergency'} — ${x.location || 'property'}`, description: `Priority ${x.priority || '—'} · status ${x.status}`, time: x.created_at, department: 'Security' });
    }
    for (const i of openIncidents.filter(v => ['Critical', 'High'].includes(v.priority))) {
      alerts.push({ id: `inc-${i.id}`, type: i.priority === 'Critical' ? 'critical' : 'warning', title: i.incident_type || `Incident ${i.id}`, description: `${i.priority} incident @ ${i.location || '—'} · ${i.status}`, time: i.reported_at, department: 'Security' });
    }
    for (const w2 of openWOs.filter(v => v.priority === 'Emergency')) {
      alerts.push({ id: `wo-${w2.id}`, type: 'critical', title: w2.title || 'Emergency work order', description: `Room ${w2.room_number || '—'} · status ${w2.status}`, time: w2.created_date, department: 'Engineering' });
    }
    for (const x of escalations.filter(v => v.status !== 'resolved' && v.due_by && new Date(v.due_by).getTime() < now)) {
      alerts.push({ id: `esc-${x.id}`, type: 'warning', title: x.description || `${x.type || 'Escalation'} overdue`, description: `Severity ${x.severity || '—'} · SLA breached`, time: x.due_by, department: 'Operations', acknowledgeable: x.status === 'open' ? x.id : undefined });
    }
    for (const r of ooo) {
      alerts.push({ id: `room-${r.id}`, type: 'warning', title: `Room ${r.number} out of order`, description: `Status: ${r.status}`, time: null, department: 'Engineering' });
    }
    for (const r of arrivals.filter(v => vipNames.has(String(v.guest_name || '').toLowerCase()))) {
      alerts.push({ id: `vip-${r.id}`, type: 'info', title: `VIP arrival — ${r.guest_name}`, description: `Checks in ${r.check_in_date}`, time: r.check_in_date, department: 'Front Office' });
    }
    for (const r of openReqs.filter(v => /urgent|critical/i.test(v.priority || '') && new Date(v.created_at).getTime() < now - 4 * 3600000)) {
      alerts.push({ id: `req-${r.id}`, type: 'warning', title: `Stale ${r.request_type || 'guest'} request`, description: `${r.guest_name || 'Guest'} · open since ${String(r.created_at).slice(0, 16)}`, time: r.created_at, department: 'Front Office' });
    }
    for (const r of openRecovery.filter(v => new Date(v.created_at).getTime() < now - 48 * 3600000)) {
      alerts.push({ id: `rec-${r.id}`, type: 'warning', title: `Recovery case stale — ${r.guest_name || 'guest'}`, description: String(r.complaint || '').slice(0, 80), time: r.created_at, department: 'Guest Relations' });
    }

    // ── Room status distribution (pie) ──
    const bucket = (status: string) => {
      const s2 = status || '';
      if (/^occupied/i.test(s2)) return 'Occupied';
      if (/out.?of.?(order|service)|maintenance/i.test(s2)) return 'OOO / OOS';
      if (/vacant.?clean|inspected/i.test(s2)) return 'Vacant Ready';
      if (/vacant/i.test(s2)) return 'Vacant Dirty';
      return 'Other';
    };
    const distMap: Record<string, number> = {};
    for (const r of rooms) distMap[bucket(r.status)] = (distMap[bucket(r.status)] || 0) + 1;
    const DIST_COLORS: Record<string, string> = {
      'Occupied': '#6366f1',
      'Vacant Ready': '#10b981',
      'Vacant Dirty': '#f59e0b',
      'OOO / OOS': '#ef4444',
      'Other': '#94a3b8',
    };
    const roomStatusDist = Object.entries(distMap).map(([name, value]) => ({ name, value, color: DIST_COLORS[name] || '#94a3b8' }));

    // ── 7-day flow (arrivals vs departures vs events) ──
    const flow7d = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(w.end.getTime() - (6 - i) * 86400000);
      const day = isoDay(d);
      return {
        name: d.toLocaleDateString(undefined, { weekday: 'short' }),
        arrivals: activeRes.filter(r => r.check_in_date === day).length,
        departures: activeRes.filter(r => r.check_out_date === day).length,
        events: events.filter(x => x.event_date === day && !/cancelled/i.test(x.status || '')).length,
      };
    });

    const order = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => order[a.type] - order[b.type] || String(b.time || '').localeCompare(String(a.time || '')));

    const payload = { period, generatedAt: new Date().toISOString(), groups, roomStatusDist, flow7d, alerts: alerts.slice(0, 12) };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (e: any) {
    console.error('[ops-dash] failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Dashboard query failed' });
  }
});

export default router;
