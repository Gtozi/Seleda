/**
 * Occupancy & Forecast routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/occupancy-forecast tab (OccupancyForecastMonitor.tsx).
 * Pure live-data computation — no new tables:
 *
 *   GET /occupancy-forecast?propertyId=&days=7|30
 *       Per-day forecast built from:
 *         rooms            — sellable inventory (OOO/OOS/Maintenance excluded)
 *         reservations     — booked room-nights, arrivals, departures, rate revenue
 *         group_blocks     — blocked rooms added on top of transient bookings
 *       Plus yesterday-vs-today actuals for the KPI deltas.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 60 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-forecast] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-forecast] ${tag}: ${e?.message || e}`);
    return [];
  }
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const BLOCKED_ROOM_STATUSES = new Set(['out of order', 'out of service', 'maintenance']);
const LIVE_RES_STATUSES = ['Confirmed', 'Booked', 'CheckedIn', 'Checked In', 'InHouse', 'Pending'];

// GET /api/ops-portal/occupancy-forecast
router.get('/occupancy-forecast', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const today = new Date(`${dayStr(new Date())}T00:00:00Z`);
  const end = addDays(today, days);
  const yesterday = addDays(today, -1);
  const winStart = dayStr(yesterday);
  const winEnd = dayStr(end);

  const cacheKey = `ops-forecast:${propertyId || 'all'}:${days}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [rooms, reservations, groups] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('rooms')
        .select('id, number, type, status, rate')), 'rooms'),
      fetchRows(eqProp(supabaseAdmin!.from('reservations')
        .select('id, guest_name, room_number, room_type, check_in_date, check_out_date, status, rate, total_amount, adults, children')
        .in('status', LIVE_RES_STATUSES)
        .lt('check_in_date', winEnd)
        .gt('check_out_date', winStart)), 'reservations'),
      fetchRows(eqProp(supabaseAdmin!.from('group_blocks')
        .select('id, block_name, arrival_date, departure_date, blocked_rooms, total_rooms, status')
        .not('status', 'in', '("Closed","Cancelled","Released")')
        .lt('arrival_date', winEnd)
        .gt('departure_date', winStart)), 'group_blocks'),
    ]);

    const totalRooms = rooms.length;
    const blockedRooms = rooms.filter((r) => BLOCKED_ROOM_STATUSES.has(String(r.status || '').toLowerCase())).length;
    const sellable = Math.max(1, totalRooms - blockedRooms);
    const roomRate = new Map(rooms.map((r) => [String(r.number), Number(r.rate) || 0]));
    const avgRate = rooms.length
      ? rooms.reduce((n, r) => n + (Number(r.rate) || 0), 0) / rooms.length : 0;

    const perNightRate = (r: any): number => {
      if (r.rate != null && Number(r.rate) > 0) return Number(r.rate);
      const nights = Math.max(1, Math.round(
        (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 864e5));
      if (r.total_amount != null && Number(r.total_amount) > 0) return Number(r.total_amount) / nights;
      return roomRate.get(String(r.room_number)) ?? avgRate;
    };

    const daysArr: any[] = [];
    for (let i = -1; i < days; i++) {
      const d = addDays(today, i);
      const ds = dayStr(d);

      const staying = reservations.filter((r) => r.check_in_date <= ds && r.check_out_date > ds);
      const arrivals = reservations.filter((r) => r.check_in_date === ds);
      const departures = reservations.filter((r) => r.check_out_date === ds);
      const grp = groups.filter((g) => g.arrival_date <= ds && g.departure_date > ds);
      const grpRooms = grp.reduce((n, g) => n + (g.blocked_rooms || g.total_rooms || 0), 0);

      const bookedRooms = staying.length + grpRooms;
      const revenue =
        staying.reduce((n, r) => n + perNightRate(r), 0) + grpRooms * avgRate;

      daysArr.push({
        date: ds,
        bookedRooms,
        transientRooms: staying.length,
        groupRooms: grpRooms,
        occupancy: Math.round(Math.min(100, (bookedRooms / sellable) * 100)),
        arrivals: arrivals.length,
        departures: departures.length,
        revenue: Math.round(revenue),
        isToday: i === 0,
        isPast: i < 0,
      });
    }

    const todayRow = daysArr.find((d) => d.isToday)!;
    const yestRow = daysArr.find((d) => d.isPast)!;

    const payload = {
      generatedAt: new Date().toISOString(),
      days,
      totalRooms,
      sellableRooms: sellable,
      blockedRooms,
      avgRate: Math.round(avgRate),
      forecast: daysArr.filter((d) => !d.isPast),
      today: {
        ...todayRow,
        availableRooms: Math.max(0, sellable - todayRow.bookedRooms),
        occupancyDelta: todayRow.occupancy - yestRow.occupancy,
        arrivalsDelta: todayRow.arrivals - yestRow.arrivals,
        departuresDelta: todayRow.departures - yestRow.departures,
        availableDelta:
          Math.max(0, sellable - todayRow.bookedRooms) - Math.max(0, sellable - yestRow.bookedRooms),
      },
      upcomingGroups: groups.map((g) => ({
        id: g.id, name: g.block_name, arrival: g.arrival_date,
        departure: g.departure_date, rooms: g.blocked_rooms || g.total_rooms, status: g.status,
      })),
    };

    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to compute forecast' });
  }
});

export default router;
