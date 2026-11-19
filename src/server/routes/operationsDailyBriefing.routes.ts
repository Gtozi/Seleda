/**
 * Operations Daily Briefing routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/daily-briefing tab (DailyBriefing.tsx).
 *
 * Two endpoints:
 *   GET  /daily-briefing?propertyId=&date=YYYY-MM-DD
 *        Returns the persisted snapshot for that date if one was generated
 *        (ops_daily_briefings, migration 628); otherwise computes the
 *        briefing live and marks it persisted=false.
 *   POST /daily-briefing/generate   { propertyId, date }
 *        Recomputes the briefing from live data and upserts the snapshot
 *        so the date can be revisited later.
 *
 * The briefing is aggregated live from the *real* tables of the other
 * portals — reservations/guests (Front Office), housekeeping VIP-prep
 * tasks, engineering work orders + corrective tasks, banquet events +
 * venues, airport transfers, department shift-requirement tables,
 * F&B orders, spa appointments, and the ops_command_alerts feed — so the
 * briefing reflects the whole system instead of a static fixture.
 * Every source query is non-fatal: a missing table degrades that section
 * to empty rather than 500ing the endpoint.
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
      console.warn(`[ops-daily-briefing] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-daily-briefing] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// ── Shared predicates ────────────────────────────────────────────────────

const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
const CM_CLOSED = new Set(['Completed', 'Verified']);
const HK_TASK_CLOSED = new Set(['Completed', 'Verified']);
const EVENT_CLOSED = new Set(['Completed', 'Cancelled']);
const ORDER_EXCLUDE = new Set(['Voided', 'Cancelled']);
const RES_CLOSED = new Set(['CheckedOut', 'Cancelled', 'NoShow', 'No Show']);

const PRIORITY_RANK: Record<string, number> = {
  emergency: 0, critical: 0, urgent: 1, high: 2, medium: 3, normal: 3, low: 4,
};
const priorityRank = (p: any) => PRIORITY_RANK[String(p || '').toLowerCase()] ?? 5;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const datePart = (v: any): string => String(v || '').slice(0, 10);
const timePart = (v: any): string => {
  const t = new Date(v);
  return isNaN(t.getTime()) ? '' : t.toTimeString().slice(0, 5);
};

const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

// ── Briefing computation ─────────────────────────────────────────────────

async function computeBriefing(date: string, propertyId: string | undefined) {
  const eqProp = (q: any): any =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const prevDate = addDays(date, -1);
  const windowStart = addDays(date, -30);

  const [
    rooms, reservations, vipGuests, hkVipTasks, groupBlocks,
    events, venues, workOrders, correctiveTasks, transfers,
    hkShifts, foShifts, fbShifts, engShifts, secShifts,
    yesterdayOrders, spaYesterday, spaToday, alerts,
  ] = await Promise.all([
    fetchRows(eqProp(supabaseAdmin!.from('rooms')
      .select('id, number, status')), 'rooms'),
    fetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, guest_name, room_number, room_type, check_in_date, check_out_date, status, adults, children, is_group, group_name, total_amount, notes, guest_id'))
      .gte('check_out_date', windowStart), 'reservations'),
    fetchRows(eqProp(supabaseAdmin!.from('guests')
      .select('id, name, status'))
      .eq('status', 'VIP'), 'guests'),
    fetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
      .select('id, type, status, location, due_date'))
      .eq('type', 'VIP Preparation'), 'hk_vip_tasks'),
    fetchRows(eqProp(supabaseAdmin!.from('group_blocks')
      .select('id, block_name, arrival_date, departure_date, total_rooms, picked_up_rooms, status')), 'group_blocks'),
    fetchRows(eqProp(supabaseAdmin!.from('banquet_events')
      .select('id, event_name, event_type, event_date, end_date, venue_ids, guest_count, expected_attendees, status, estimated_revenue, actual_revenue'))
      .gte('event_date', windowStart), 'banquet_events'),
    fetchRows(eqProp(supabaseAdmin!.from('banquet_venues')
      .select('id, venue_name')), 'banquet_venues'),
    fetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, wo_number, title, status, priority, room_number, assigned_to')), 'work_orders'),
    fetchRows(eqProp(supabaseAdmin!.from('corrective_maintenance_tasks')
      .select('id, cm_number, type, description, status, priority, location, room_number')), 'corrective_maintenance_tasks'),
    fetchRows(eqProp(supabaseAdmin!.from('transport_airport_transfers')
      .select('id, guest_name, room, type, flight_number, airline, terminal, scheduled_time, flight_status, delay, passenger_count, status'))
      .gte('scheduled_time', `${date}T00:00:00`)
      .lt('scheduled_time', `${addDays(date, 1)}T00:00:00`), 'transport_airport_transfers'),
    fetchRows(eqProp(supabaseAdmin!.from('hk_shift_requirements')
      .select('id, name, assigned_staff, required_staff')), 'hk_shift_requirements'),
    fetchRows(eqProp(supabaseAdmin!.from('fo_shift_requirements')
      .select('id, name, assigned_staff, required_staff')), 'fo_shift_requirements'),
    fetchRows(eqProp(supabaseAdmin!.from('fb_shift_requirements')
      .select('id, name, assigned_staff, required_staff')), 'fb_shift_requirements'),
    fetchRows(eqProp(supabaseAdmin!.from('eng_tech_shifts')
      .select('id, name, assigned_staff, required_staff')), 'eng_tech_shifts'),
    fetchRows(eqProp(supabaseAdmin!.from('sec_shift_defs')
      .select('id, name, required_staff')), 'sec_shift_defs'),
    fetchRows(eqProp(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, is_complimentary'))
      .gte('created_at', `${prevDate}T00:00:00`)
      .lt('created_at', `${date}T00:00:00`), 'orders_yesterday'),
    fetchRows(eqProp(supabaseAdmin!.from('spa_appointments')
      .select('id, status, appointment_date, amount'))
      .eq('appointment_date', prevDate), 'spa_yesterday'),
    fetchRows(eqProp(supabaseAdmin!.from('spa_appointments')
      .select('id, status, appointment_date, amount'))
      .eq('appointment_date', date), 'spa_today'),
    fetchRows(eqProp(supabaseAdmin!.from('ops_command_alerts')
      .select('id, severity, message, department, created_at'))
      .eq('status', 'Active'), 'ops_command_alerts'),
  ]);

  // ── Occupancy ──────────────────────────────────────────────────────
  const roomsTotal = rooms.length;
  const occupiedRooms = new Set(
    reservations
      .filter(r => r.status === 'CheckedIn' && datePart(r.check_in_date) <= date && datePart(r.check_out_date) > date)
      .map(r => r.room_number || r.id)
  ).size;
  const pendingArrivals = reservations.filter(r =>
    datePart(r.check_in_date) === date && r.status === 'Confirmed').length;
  const departuresToday = reservations.filter(r =>
    datePart(r.check_out_date) === date && !RES_CLOSED.has(r.status)).length;
  const inHouseGuests = reservations
    .filter(r => r.status === 'CheckedIn' && datePart(r.check_in_date) <= date && datePart(r.check_out_date) > date)
    .reduce((s, r) => s + num(r.adults) + num(r.children), 0);

  const pct = (n: number) => roomsTotal > 0 ? Math.round((n / roomsTotal) * 100) : 0;
  const currentOcc = pct(occupiedRooms);
  const expectedOcc = Math.min(100, pct(occupiedRooms + pendingArrivals));

  // ── VIP arrivals — VIP guests checking in today + HK VIP-prep rooms ──
  const vipIds = new Set(vipGuests.map(g => g.id));
  const vipNames = new Set(vipGuests.map(g => String(g.name || '').toLowerCase()));
  const vipArrivals = reservations
    .filter(r => datePart(r.check_in_date) === date && !RES_CLOSED.has(r.status))
    .filter(r => vipIds.has(r.guest_id) || vipNames.has(String(r.guest_name || '').toLowerCase()))
    .map(r => ({
      name: r.guest_name || 'VIP Guest',
      room: r.room_number || r.room_type || 'Unassigned',
      status: r.status,
      notes: r.notes || '',
      source: 'Reservation',
    }));
  const vipRooms = new Set(vipArrivals.map(v => v.room));
  for (const t of hkVipTasks) {
    if (HK_TASK_CLOSED.has(t.status) || datePart(t.due_date) !== date) continue;
    const room = String(t.location || '');
    if (room && vipRooms.has(room)) continue;
    vipArrivals.push({
      name: `VIP Arrival — ${room || 'room TBD'}`,
      room: room || 'TBD',
      status: t.status,
      notes: `Housekeeping VIP preparation ${String(t.status || '').toLowerCase()}`,
      source: 'Housekeeping',
    });
  }

  // ── Group arrivals — group_blocks + grouped group reservations ──────
  const groupArrivals: Array<{ name: string; rooms: number; guests: number; source: string }> =
    groupBlocks
      .filter(b => datePart(b.arrival_date) === date)
      .map(b => ({
        name: b.block_name || 'Group Block',
        rooms: num(b.total_rooms) || num(b.picked_up_rooms),
        guests: 0,
        source: 'Group Block',
      }));
  const groupResMap = new Map<string, { rooms: number; guests: number }>();
  for (const r of reservations) {
    if (!r.is_group || datePart(r.check_in_date) !== date || RES_CLOSED.has(r.status)) continue;
    const key = r.group_name || 'Group Booking';
    const agg = groupResMap.get(key) || { rooms: 0, guests: 0 };
    agg.rooms += 1;
    agg.guests += num(r.adults) + num(r.children);
    groupResMap.set(key, agg);
  }
  for (const [name, agg] of groupResMap) {
    const existing = groupArrivals.find(g => g.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.guests = agg.guests;
      existing.rooms = Math.max(existing.rooms, agg.rooms);
    } else {
      groupArrivals.push({ name, rooms: agg.rooms, guests: agg.guests, source: 'Reservations' });
    }
  }

  // ── Events today (incl. multi-day events spanning the date) ─────────
  const venueName = new Map(venues.map(v => [v.id, v.venue_name]));
  const todayEventRows = events.filter(e => {
    const start = datePart(e.event_date);
    const end = datePart(e.end_date) || start;
    return start <= date && end >= date && !EVENT_CLOSED.has(e.status);
  });
  const todayEvents = todayEventRows
    .map(e => ({
      name: e.event_name || 'Event',
      type: e.event_type || 'Event',
      location: Array.isArray(e.venue_ids) && e.venue_ids.length > 0
        ? e.venue_ids.map((id: string) => venueName.get(id) || id).join(', ')
        : 'Venue TBD',
      attendees: num(e.expected_attendees) || num(e.guest_count),
      status: e.status,
      dateRange: datePart(e.end_date) && datePart(e.end_date) !== datePart(e.event_date)
        ? `${datePart(e.event_date)} → ${datePart(e.end_date)}`
        : datePart(e.event_date),
    }));

  // ── Maintenance impacts — open work orders + corrective tasks ───────
  const maintenance = [
    ...workOrders
      .filter(w => !WO_CLOSED.has(w.status))
      .map(w => ({
        task: w.title || w.wo_number || 'Work order',
        location: w.room_number ? `Room ${w.room_number}` : 'Unlocated',
        priority: w.priority || 'Normal',
        status: w.status,
        source: w.wo_number || 'WO',
      })),
    ...correctiveTasks
      .filter(c => !CM_CLOSED.has(c.status))
      .map(c => ({
        task: c.description || c.type || c.cm_number || 'Corrective task',
        location: c.location || (c.room_number ? `Room ${c.room_number}` : 'Unlocated'),
        priority: c.priority || 'Normal',
        status: c.status,
        source: c.cm_number || 'CM',
      })),
  ]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 8);

  // ── Airport transfers & flight status ────────────────────────────────
  const flights = transfers.map(t => ({
    airline: t.airline || '—',
    flight: t.flight_number || '—',
    scheduledTime: timePart(t.scheduled_time),
    flightStatus: t.flight_status || 'Scheduled',
    delay: t.delay ? String(t.delay) : null,
    guests: num(t.passenger_count),
    guestName: t.guest_name || '',
    direction: t.type || 'Transfer',
  }));

  // ── Staffing coverage per department ────────────────────────────────
  const staffingDept = (name: string, rows: any[], tracked = true) => {
    const required = rows.reduce((s, r) => s + num(r.required_staff), 0);
    const assigned = tracked ? rows.reduce((s, r) => s + num(r.assigned_staff), 0) : null;
    const gap = assigned === null ? null : Math.max(0, required - assigned);
    return {
      name, required, assigned, gap,
      status: assigned === null
        ? 'Not tracked'
        : required === 0
          ? 'No requirement'
          : gap === 0 ? 'Fully Staffed' : `Gap of ${gap}`,
    };
  };
  const staffingDepts = [
    staffingDept('Front Office', foShifts),
    staffingDept('Housekeeping', hkShifts),
    staffingDept('Food & Beverage', fbShifts),
    staffingDept('Engineering', engShifts),
    staffingDept('Security', secShifts, false),
  ];
  const tracked = staffingDepts.filter(d => d.assigned !== null && d.required > 0);
  const staffingOverall = tracked.length > 0
    ? Math.round(
        (tracked.reduce((s, d) => s + num(d.assigned), 0) /
         tracked.reduce((s, d) => s + d.required, 0)) * 100)
    : null;

  // ── Revenue — yesterday actual vs. today forecast ────────────────────
  const fnbYesterday = yesterdayOrders
    .filter(o => !ORDER_EXCLUDE.has(o.status) && !o.is_complimentary)
    .reduce((s, o) => s + num(o.total_amount), 0);
  const spaYesterdayTotal = spaYesterday
    .filter(a => a.status === 'Completed')
    .reduce((s, a) => s + num(a.amount), 0);
  const eventsYesterdayTotal = events
    .filter(e => datePart(e.event_date) === prevDate && !EVENT_CLOSED.has(e.status))
    .reduce((s, e) => s + num(e.actual_revenue) || num(e.estimated_revenue), 0);

  const roomsForecast = reservations
    .filter(r => datePart(r.check_in_date) === date && !RES_CLOSED.has(r.status))
    .reduce((s, r) => s + num(r.total_amount), 0);
  const eventsForecast = todayEventRows
    .reduce((s, e) => s + num(e.estimated_revenue), 0);
  const spaForecast = spaToday
    .filter(a => a.status !== 'Cancelled')
    .reduce((s, a) => s + num(a.amount), 0);

  const yesterday = Math.round(fnbYesterday + spaYesterdayTotal + eventsYesterdayTotal);
  const forecast = Math.round(roomsForecast + eventsForecast + spaForecast);

  // ── Outstanding issues — active ops command alerts ───────────────────
  const sevRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const outstandingIssues = alerts
    .sort((a, b) =>
      (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3) ||
      String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 10)
    .map(a => ({
      issue: a.message,
      department: a.department,
      priority: a.severity,
    }));

  return {
    date,
    generatedAt: new Date().toISOString(),
    occupancy: {
      current: currentOcc,
      expected: expectedOcc,
      pickup: expectedOcc - currentOcc,
      roomsTotal,
      occupied: occupiedRooms,
      arrivals: reservations.filter(r => datePart(r.check_in_date) === date && !RES_CLOSED.has(r.status)).length,
      departures: departuresToday,
      inHouseGuests,
    },
    vipArrivals,
    groupArrivals,
    events: todayEvents,
    maintenance,
    flights,
    staffing: { overall: staffingOverall, departments: staffingDepts },
    revenue: {
      yesterday,
      forecast,
      variance: forecast - yesterday,
      yesterdayBreakdown: [
        { label: 'F&B orders', amount: Math.round(fnbYesterday) },
        { label: 'Spa (completed)', amount: Math.round(spaYesterdayTotal) },
        { label: 'Events (actual)', amount: Math.round(eventsYesterdayTotal) },
      ],
      forecastBreakdown: [
        { label: 'Rooms (arrivals)', amount: Math.round(roomsForecast) },
        { label: 'Events (estimated)', amount: Math.round(eventsForecast) },
        { label: 'Spa (booked)', amount: Math.round(spaForecast) },
      ],
    },
    outstandingIssues,
  };
}

function snapshotId(propertyId: string | undefined, date: string): string {
  return `brief-${propertyId || 'all'}-${date}`;
}

// ── Routes ───────────────────────────────────────────────────────────────

// GET /api/ops-portal/daily-briefing — persisted snapshot, else live.
router.get('/daily-briefing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const date = (req.query as Record<string, string>).date || todayStr();
  const cacheKey = `ops-daily-briefing:${propertyId || 'all'}:${date}`;

  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data: row, error } = await supabaseAdmin
      .from('ops_daily_briefings')
      .select('id, data, generated_by, updated_at')
      .eq('id', snapshotId(propertyId, date))
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    const payload = row
      ? { ...(row.data as object), persisted: true, generatedBy: row.generated_by, generatedAt: row.updated_at }
      : { ...(await computeBriefing(date, propertyId)), persisted: false, generatedBy: null };

    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to build daily briefing' });
  }
});

// POST /api/ops-portal/daily-briefing/generate — recompute + persist.
router.post('/daily-briefing/generate', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.body?.propertyId as string) || undefined;
  const date = (req.body?.date as string) || todayStr();

  try {
    const briefing = await computeBriefing(date, propertyId);
    const generatedBy = req.user?.name || req.user?.id || null;

    const { error } = await supabaseAdmin
      .from('ops_daily_briefings')
      .upsert({
        id: snapshotId(propertyId, date),
        property_id: propertyId || null,
        briefing_date: date,
        data: briefing,
        generated_by: generatedBy,
      }, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });

    cacheService.invalidate(`ops-daily-briefing:${propertyId || 'all'}:${date}`);

    return res.json({ ...briefing, persisted: true, generatedBy });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to generate daily briefing' });
  }
});

export default router;
