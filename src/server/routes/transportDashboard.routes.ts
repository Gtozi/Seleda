/**
 * Transportation Dashboard API
 * ──────────────────────────────────────────────────────────────────────────
 * Read-only aggregation endpoint backing the Transportation executive
 * dashboard. Computes KPIs, chart series, and operational alerts live from
 * the existing transport tables — no dashboard table required.
 * Mounted at /api/transport/dashboard.
 *
 *   - GET /:propertyId   full dashboard snapshot
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { boundPropertyId } from '../services/transportScope';

const router = Router();
const CACHE_PREFIX = 'transport:dashboard:';
const CACHE_TTL = 30 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const ACTIVE_TRIP_STATUSES = ['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress'];
const EN_ROUTE_STATUSES = ['Driver En Route', 'Guest Picked Up', 'In Progress'];
const PENDING_STATUSES = ['Requested', 'Confirmed'];

function dayKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6);
  const todayKey = dayKey(now);
  const weekStartKey = dayKey(weekStart);

  const [requestsRes, transfersRes, vehiclesRes, driversRes, chargesRes, fuelRes, telemetryRes, maintRes, schedRes, contractorsRes] =
    await Promise.all([
      supabaseAdmin
        .from('transport_requests')
        .select('id, request_number, type, status, priority, scheduled_time, guest_name, room')
        .eq('property_id', propertyId)
        .gte('scheduled_time', weekStart.toISOString())
        .limit(1000),
      supabaseAdmin
        .from('transport_airport_transfers')
        .select('id, type, status, flight_status, flight_number, delay, scheduled_time')
        .eq('property_id', propertyId)
        .gte('scheduled_time', todayStart.toISOString())
        .lt('scheduled_time', todayEnd.toISOString()),
      supabaseAdmin
        .from('transport_vehicles')
        .select('id, vehicle_number, make, model, status, utilization, fuel_level, next_service')
        .eq('property_id', propertyId),
      supabaseAdmin
        .from('transport_drivers')
        .select('id, status, total_trips, performance, license_expiry, employees(name)')
        .eq('property_id', propertyId),
      supabaseAdmin
        .from('transport_billing_charges')
        .select('amount, status, charge_date')
        .eq('property_id', propertyId)
        .gte('charge_date', weekStartKey),
      supabaseAdmin
        .from('transport_fuel_purchases')
        .select('gallons, fuel_type, purchase_date, flagged, flag_reason, purchase_number')
        .eq('property_id', propertyId)
        .eq('purchase_date', todayKey),
      supabaseAdmin
        .from('transport_vehicle_telemetry')
        .select('status, last_update, transport_vehicles(vehicle_number)')
        .eq('property_id', propertyId),
      supabaseAdmin
        .from('transport_maintenance_requests')
        .select('id, request_number, status, priority, description, transport_vehicles(vehicle_number)')
        .eq('property_id', propertyId)
        .in('status', ['Pending', 'Scheduled', 'In Progress']),
      supabaseAdmin
        .from('transport_schedule_items')
        .select('id, schedule_number, status, scheduled_time, driver_id, duration_minutes')
        .eq('property_id', propertyId)
        .gte('scheduled_time', todayStart.toISOString())
        .lt('scheduled_time', todayEnd.toISOString()),
      supabaseAdmin
        .from('transport_contractors')
        .select('on_time_rate')
        .eq('property_id', propertyId)
        .eq('status', 'Active'),
    ]);

  for (const r of [requestsRes, transfersRes, vehiclesRes, driversRes, chargesRes, fuelRes, telemetryRes, maintRes, schedRes, contractorsRes]) {
    if (r.error) return res.status(500).json({ error: r.error.message });
  }

  const requests = (requestsRes.data || []) as any[];
  const transfers = (transfersRes.data || []) as any[];
  const vehicles = (vehiclesRes.data || []) as any[];
  const drivers = (driversRes.data || []) as any[];
  const charges = (chargesRes.data || []) as any[];
  const fuelPurchases = (fuelRes.data || []) as any[];
  const telemetry = (telemetryRes.data || []) as any[];
  const maintRequests = (maintRes.data || []) as any[];
  const schedItems = (schedRes.data || []) as any[];
  const contractors = (contractorsRes.data || []) as any[];

  const inWindow = (iso: string) => {
    const t = new Date(iso);
    return t >= todayStart && t < todayEnd;
  };

  // ── KPIs ──────────────────────────────────────────────────────────
  const activeTrips = requests.filter((r: any) => ACTIVE_TRIP_STATUSES.includes(r.status)).length;
  const enRoute = requests.filter((r: any) => EN_ROUTE_STATUSES.includes(r.status)).length;
  const scheduledToday = requests.filter((r: any) => inWindow(r.scheduled_time)).length;
  const completedToday = requests.filter((r: any) => r.status === 'Completed' && inWindow(r.scheduled_time)).length;
  const pendingRequests = requests.filter((r: any) => PENDING_STATUSES.includes(r.status)).length;

  // Count airport trips from transport_requests (covers transfers tab, concierge,
  // guest app and every other surface via the silo bridges) for today only.
  const isPickup = (t: string) => /Pickup|Arrival|Meet|VIP|Executive/i.test(t || '');
  const isAirportType = (t: string) => /Airport|VIP|Executive/i.test(t || '');
  const todaysAirportTrips = requests.filter((r: any) => isAirportType(r.type) && inWindow(r.scheduled_time));
  const airportPickups = todaysAirportTrips.filter((r: any) => isPickup(r.type)).length;
  const airportDropoffs = todaysAirportTrips.filter((r: any) => !isPickup(r.type)).length;

  const activeVehicles = vehicles.filter((v: any) => v.status === 'Active').length;
  const fleetUtilization =
    vehicles.length > 0 ? Math.round(vehicles.reduce((s: number, v: any) => s + (v.utilization || 0), 0) / vehicles.length) : 0;
  const driversOnDuty = drivers.filter((d: any) => d.status === 'Active').length;

  const onTimeRate =
    contractors.length > 0
      ? Math.round(contractors.reduce((s: number, c: any) => s + (c.on_time_rate || 0), 0) / contractors.length)
      : null;

  const fuelToday = fuelPurchases.reduce((s: number, p: any) => s + Number(p.gallons || 0), 0);
  const revenueToday = charges
    .filter((c: any) => c.charge_date === todayKey && c.status !== 'Refunded')
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

  // ── Charts ────────────────────────────────────────────────────────
  const typeMap = new Map<string, number>();
  for (const r of requests) typeMap.set(r.type, (typeMap.get(r.type) || 0) + 1);
  const tripsByType = [...typeMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const tripsByDay = new Map<string, number>();
  const revenueByDay = new Map<string, number>();
  for (const r of requests) {
    const k = dayKey(new Date(r.scheduled_time));
    tripsByDay.set(k, (tripsByDay.get(k) || 0) + 1);
  }
  for (const c of charges) {
    if (c.status === 'Refunded') continue;
    revenueByDay.set(c.charge_date, (revenueByDay.get(c.charge_date) || 0) + Number(c.amount || 0));
  }
  const revenueTrend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const k = dayKey(d);
    return {
      date: d.toLocaleDateString('en-US', { weekday: 'short' }),
      revenue: Math.round((revenueByDay.get(k) || 0) * 100) / 100,
      trips: tripsByDay.get(k) || 0,
    };
  });

  const vehicleUtilization = vehicles
    .slice()
    .sort((a: any, b: any) => (b.utilization || 0) - (a.utilization || 0))
    .slice(0, 8)
    .map((v: any) => ({ vehicle: v.vehicle_number, utilization: v.utilization || 0 }));

  const driverPerformance = drivers
    .slice()
    .sort((a: any, b: any) => (b.total_trips || 0) - (a.total_trips || 0))
    .slice(0, 6)
    .map((d: any) => ({
      name: d.employees?.name || 'Driver',
      trips: d.total_trips || 0,
      onTime: d.performance || 0,
    }));

  // ── Alerts derived from live data ─────────────────────────────────
  const alerts: { type: string; message: string; time: string | null; severity: 'warning' | 'critical' }[] = [];

  for (const t of transfers) {
    if (['Delayed', 'Cancelled', 'Diverted'].includes(t.flight_status)) {
      alerts.push({
        type: `Flight ${t.flight_status}`,
        message: `Flight ${t.flight_number || '—'}${t.delay ? ` — ${t.delay} delay` : ''} impacts ${t.type.toLowerCase()}`,
        time: t.scheduled_time,
        severity: t.flight_status === 'Cancelled' ? 'critical' : 'warning',
      });
    }
  }
  for (const v of vehicles) {
    if (v.status === 'Maintenance') {
      alerts.push({ type: 'Vehicle In Maintenance', message: `${v.vehicle_number} (${v.make} ${v.model}) is in the shop`, time: v.next_service || null, severity: 'critical' });
    }
    if ((v.fuel_level ?? 100) < 15 && v.status !== 'Out of Service') {
      alerts.push({ type: 'Low Fuel', message: `${v.vehicle_number} fuel level at ${v.fuel_level}%`, time: null, severity: 'warning' });
    }
  }
  for (const m of maintRequests) {
    if (m.priority === 'High') {
      alerts.push({
        type: 'Maintenance Request',
        message: `${m.request_number} — ${m.description}${m.transport_vehicles?.vehicle_number ? ` (${m.transport_vehicles.vehicle_number})` : ''}`,
        time: null,
        severity: 'critical',
      });
    }
  }
  for (const t of telemetry) {
    if (t.status === 'Offline') {
      alerts.push({
        type: 'GPS Offline',
        message: `${t.transport_vehicles?.vehicle_number || 'Vehicle'} tracking signal lost`,
        time: t.last_update || null,
        severity: 'warning',
      });
    }
  }
  for (const d of drivers) {
    if (d.license_expiry) {
      const days = Math.ceil((new Date(d.license_expiry).getTime() - now.getTime()) / 86400000);
      if (days <= 14) {
        alerts.push({
          type: days < 0 ? 'License Expired' : 'License Expiry',
          message: `${d.employees?.name || 'Driver'} license ${days < 0 ? 'expired' : `expires in ${days} day(s)`}`,
          time: d.license_expiry,
          severity: days < 0 ? 'critical' : 'warning',
        });
      }
    }
  }
  const unassigned = schedItems.filter((s: any) => s.status === 'Unassigned');
  if (unassigned.length > 0) {
    alerts.push({ type: 'Unassigned Trips', message: `${unassigned.length} scheduled item(s) today have no driver`, time: null, severity: 'warning' });
  }
  const delayed = requests.filter((r: any) => PENDING_STATUSES.includes(r.status) && new Date(r.scheduled_time) < now);
  for (const r of delayed.slice(0, 3)) {
    alerts.push({
      type: 'Delayed Pickup',
      message: `${r.request_number} — ${r.guest_name}${r.room ? ` (Room ${r.room})` : ''} scheduled ${new Date(r.scheduled_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      time: r.scheduled_time,
      severity: r.priority === 'Critical' || r.priority === 'High' ? 'critical' : 'warning',
    });
  }

  // Driver overtime: >10 scheduled hours today (spec §4 "Driver Overtime").
  const OT_LIMIT_MIN = 10 * 60;
  const driverMinutes = new Map<string, number>();
  for (const s of schedItems) {
    if (!s.driver_id || s.status === 'Cancelled') continue;
    driverMinutes.set(s.driver_id, (driverMinutes.get(s.driver_id) || 0) + (Number(s.duration_minutes) || 30));
  }
  const driverName = new Map(drivers.map((d: any) => [d.id, d.employees?.name || 'Driver']));
  for (const [driverId, mins] of driverMinutes) {
    if (mins > OT_LIMIT_MIN) {
      alerts.push({
        type: 'Driver Overtime',
        message: `${driverName.get(driverId)} scheduled ${(mins / 60).toFixed(1)}h today (limit 10h)`,
        time: null,
        severity: 'warning',
      });
    }
  }

  // Flagged fuel purchases (theft/anomaly detection, spec §19).
  for (const p of fuelPurchases) {
    if (p.flagged) {
      alerts.push({
        type: 'Fuel Anomaly',
        message: `${p.purchase_number}: ${p.flag_reason || 'flagged for review'}`,
        time: null,
        severity: 'warning',
      });
    }
  }

  const result = {
    kpis: {
      activeTrips,
      enRoute,
      scheduledToday,
      completedToday,
      airportPickups,
      airportDropoffs,
      fleetUtilization,
      vehiclesAvailable: activeVehicles,
      totalVehicles: vehicles.length,
      driversOnDuty,
      totalDrivers: drivers.length,
      pendingRequests,
      onTimeRate,
      fuelToday: Math.round(fuelToday * 100) / 100,
      revenueToday: Math.round(revenueToday * 100) / 100,
      alertsCount: alerts.length,
    },
    tripsByType,
    revenueTrend,
    vehicleUtilization,
    driverPerformance,
    alerts: alerts.slice(0, 12),
  };

  cacheService.set(cacheKey, result, CACHE_TTL);
  return res.json(result);
});

export default router;
