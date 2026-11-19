/**
 * Transportation Reports API
 * ──────────────────────────────────────────────────────────────────────────
 * Report registry — mirrors the HK reports pattern (hk_reports /
 * /api/hk-portal/reports). Mounted at /api/transport/reports.
 *
 *   - GET   /:propertyId           list reports (optional ?category=)
 *   - GET   /:propertyId/stats     aggregated KPI counts
 *   - GET   /report/:id            fetch a single report
 *   - POST  /report/:id/run        re-run a single report (status Ready + last_run = now)
 *   - POST  /:propertyId/run-all   queue all reports for refresh
 *   - PATCH /report/:id            update frequency / format / status
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { boundPropertyId, scopeRowWrite } from '../services/transportScope';
import { computeSafetyScore } from '../services/transportOps';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const REPORT_CATEGORIES = ['Operational', 'Fleet', 'Financial', 'Performance'] as const;
const REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

const REPORT_SELECT = 'id, property_id, category, name, description, last_run, generated_by, status, format, frequency, size, updated_at';

// ── Report content generation ────────────────────────────────────────────────
// Each catalog report maps to a real dataset; output is CSV.

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: any[], columns: { key: string; label: string }[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(',')).join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

async function generateReportCsv(propertyId: string, report: any): Promise<string> {
  const db = supabaseAdmin!;
  const name: string = report?.name || '';
  const today = new Date().toISOString().slice(0, 10);

  if (/daily trip/i.test(name)) {
    const { data } = await db.from('transport_requests')
      .select('request_number, guest_name, type, pickup_location, destination, scheduled_time, status, driver_id, assigned_vehicle, amount')
      .eq('property_id', propertyId).gte('scheduled_time', `${today}T00:00:00`)
      .order('scheduled_time').limit(2000);
    return toCsv(data || [], [
      { key: 'request_number', label: 'Request #' }, { key: 'guest_name', label: 'Guest' },
      { key: 'type', label: 'Type' }, { key: 'pickup_location', label: 'Pickup' },
      { key: 'destination', label: 'Destination' }, { key: 'scheduled_time', label: 'Scheduled' },
      { key: 'status', label: 'Status' }, { key: 'assigned_vehicle', label: 'Vehicle' },
      { key: 'amount', label: 'Amount' },
    ]);
  }
  if (/airport transfer/i.test(name)) {
    const { data } = await db.from('transport_airport_transfers')
      .select('transfer_number, guest_name, type, flight_number, airline, scheduled_time, flight_status, status, passenger_count')
      .eq('property_id', propertyId).order('scheduled_time', { ascending: false }).limit(2000);
    return toCsv(data || [], [
      { key: 'transfer_number', label: 'Transfer #' }, { key: 'guest_name', label: 'Guest' },
      { key: 'type', label: 'Type' }, { key: 'flight_number', label: 'Flight' },
      { key: 'airline', label: 'Airline' }, { key: 'scheduled_time', label: 'Scheduled' },
      { key: 'flight_status', label: 'Flight Status' }, { key: 'status', label: 'Status' },
      { key: 'passenger_count', label: 'Pax' },
    ]);
  }
  if (/driver performance|driver utilization|on.?time performance|driver safety/i.test(name)) {
    const [{ data: driverRows }, { data: incidentRows }] = await Promise.all([
      db.from('transport_drivers')
        .select('id, license_number, assigned_vehicle, shift, total_trips, performance, incidents, status, employees(name)')
        .eq('property_id', propertyId).limit(1000),
      db.from('transport_incidents')
        .select('driver_id, severity, status')
        .eq('property_id', propertyId).limit(5000),
    ]);
    const incidentsByDriver = new Map<string, { severity: string; status?: string }[]>();
    for (const i of incidentRows || []) {
      if (!i.driver_id) continue;
      const list = incidentsByDriver.get(i.driver_id) || [];
      list.push(i);
      incidentsByDriver.set(i.driver_id, list);
    }
    const rows = (driverRows || []).map((d: any) => ({
      driver: d.employees?.name || d.id, license_number: d.license_number,
      assigned_vehicle: d.assigned_vehicle, shift: d.shift, total_trips: d.total_trips,
      performance: d.performance, incidents: Number(d.incidents) || 0,
      safety_score: computeSafetyScore(incidentsByDriver.get(d.id) || []),
      status: d.status,
    }));
    return toCsv(rows, [
      { key: 'driver', label: 'Driver' }, { key: 'license_number', label: 'License' },
      { key: 'assigned_vehicle', label: 'Vehicle' }, { key: 'shift', label: 'Shift' },
      { key: 'total_trips', label: 'Trips' }, { key: 'performance', label: 'Performance %' },
      { key: 'incidents', label: 'Incidents' }, { key: 'safety_score', label: 'Safety Score' },
      { key: 'status', label: 'Status' },
    ]);
  }
  if (/no.?show/i.test(name)) {
    const { data } = await db.from('transport_requests')
      .select('request_number, guest_name, type, pickup_location, destination, scheduled_time, source')
      .eq('property_id', propertyId).eq('status', 'No Show')
      .order('scheduled_time', { ascending: false }).limit(2000);
    return toCsv(data || [], [
      { key: 'request_number', label: 'Request #' }, { key: 'guest_name', label: 'Guest' },
      { key: 'type', label: 'Type' }, { key: 'pickup_location', label: 'Pickup' },
      { key: 'scheduled_time', label: 'Scheduled' }, { key: 'source', label: 'Source' },
    ]);
  }
  if (/maintenance|downtime/i.test(name)) {
    const { data } = await db.from('transport_maintenance_requests')
      .select('request_number, type, priority, status, requested_date, scheduled_date, completed_date, estimated_cost, actual_cost, vendor, transport_vehicles(vehicle_number)')
      .eq('property_id', propertyId).order('requested_date', { ascending: false }).limit(2000);
    const rows = (data || []).map((m: any) => ({
      ...m,
      vehicle_number: m.transport_vehicles?.vehicle_number || '',
      downtime_days: m.completed_date && m.requested_date
        ? Math.max(0, Math.round((new Date(m.completed_date).getTime() - new Date(m.requested_date).getTime()) / 86400000))
        : null,
    }));
    return toCsv(rows, [
      { key: 'request_number', label: 'Request #' }, { key: 'vehicle_number', label: 'Vehicle' },
      { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'requested_date', label: 'Requested' }, { key: 'completed_date', label: 'Completed' },
      { key: 'downtime_days', label: 'Downtime (days)' }, { key: 'actual_cost', label: 'Cost' },
      { key: 'vendor', label: 'Vendor' },
    ]);
  }
  if (/contractor/i.test(name)) {
    const { data } = await db.from('transport_contractor_invoices')
      .select('invoice_number, period_start, period_end, trip_count, amount, expected_amount, variance, status, submitted_date, paid_at, transport_contractors(name)')
      .eq('property_id', propertyId).order('submitted_date', { ascending: false }).limit(2000);
    const rows = (data || []).map((i: any) => ({ ...i, contractor: i.transport_contractors?.name || '' }));
    return toCsv(rows, [
      { key: 'invoice_number', label: 'Invoice #' }, { key: 'contractor', label: 'Contractor' },
      { key: 'period_start', label: 'From' }, { key: 'period_end', label: 'To' },
      { key: 'trip_count', label: 'Trips' }, { key: 'amount', label: 'Amount' },
      { key: 'expected_amount', label: 'Expected' }, { key: 'variance', label: 'Variance' },
      { key: 'status', label: 'Status' }, { key: 'paid_at', label: 'Paid' },
    ]);
  }
  if (/incident|safety/i.test(name)) {
    const { data } = await db.from('transport_incidents')
      .select('incident_number, occurred_at, type, severity, location, status, transport_drivers(employees(name)), transport_vehicles(vehicle_number)')
      .eq('property_id', propertyId).order('occurred_at', { ascending: false }).limit(2000);
    const rows = (data || []).map((i: any) => ({
      ...i,
      driver: i.transport_drivers?.employees?.name || '',
      vehicle_number: i.transport_vehicles?.vehicle_number || '',
    }));
    return toCsv(rows, [
      { key: 'incident_number', label: 'Incident #' }, { key: 'occurred_at', label: 'When' },
      { key: 'type', label: 'Type' }, { key: 'severity', label: 'Severity' },
      { key: 'driver', label: 'Driver' }, { key: 'vehicle_number', label: 'Vehicle' },
      { key: 'location', label: 'Location' }, { key: 'status', label: 'Status' },
    ]);
  }
  if (/profitability|cost per (kilometer|km|mile)/i.test(name)) {
    const { data } = await db.from('transport_requests')
      .select('request_number, type, guest_name, scheduled_time, status, amount, actual_distance, estimated_distance')
      .eq('property_id', propertyId).eq('status', 'Completed')
      .order('scheduled_time', { ascending: false }).limit(5000);
    const rows = (data || []).map((r: any) => {
      const km = Number(r.actual_distance ?? r.estimated_distance) || 0;
      return {
        ...r,
        cost_per_km: km > 0 ? Math.round((Number(r.amount || 0) / km) * 100) / 100 : null,
      };
    });
    return toCsv(rows, [
      { key: 'request_number', label: 'Trip #' }, { key: 'type', label: 'Type' },
      { key: 'guest_name', label: 'Guest' }, { key: 'scheduled_time', label: 'Date' },
      { key: 'amount', label: 'Revenue' },
      { key: 'actual_distance', label: 'Distance (km)' }, { key: 'cost_per_km', label: 'Revenue/km' },
    ]);
  }
  if (/expense|cost/i.test(name) && report?.category === 'Financial') {
    const [fuel, maint] = await Promise.all([
      db.from('transport_fuel_purchases')
        .select('purchase_number, purchase_date, total_cost, transport_vehicles(vehicle_number)')
        .eq('property_id', propertyId).order('purchase_date', { ascending: false }).limit(2000),
      db.from('transport_maintenance_requests')
        .select('request_number, requested_date, actual_cost, estimated_cost, transport_vehicles(vehicle_number)')
        .eq('property_id', propertyId).order('requested_date', { ascending: false }).limit(2000),
    ]);
    const rows = [
      ...(fuel.data || []).map((f: any) => ({
        ref: f.purchase_number, date: f.purchase_date, kind: 'Fuel',
        vehicle: f.transport_vehicles?.vehicle_number || '', amount: f.total_cost,
      })),
      ...(maint.data || []).map((m: any) => ({
        ref: m.request_number, date: m.requested_date, kind: 'Maintenance',
        vehicle: m.transport_vehicles?.vehicle_number || '', amount: m.actual_cost ?? m.estimated_cost,
      })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return toCsv(rows, [
      { key: 'ref', label: 'Ref #' }, { key: 'date', label: 'Date' },
      { key: 'kind', label: 'Expense' }, { key: 'vehicle', label: 'Vehicle' },
      { key: 'amount', label: 'Amount' },
    ]);
  }
  if (/revenue|financial/i.test(name) || report?.category === 'Financial') {
    const { data } = await db.from('transport_billing_charges')
      .select('charge_number, guest_name, type, billing_type, amount, status, charge_date, payment_method')
      .eq('property_id', propertyId).order('charge_date', { ascending: false }).limit(5000);
    return toCsv(data || [], [
      { key: 'charge_number', label: 'Charge #' }, { key: 'guest_name', label: 'Guest' },
      { key: 'type', label: 'Type' }, { key: 'billing_type', label: 'Billing' },
      { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' },
      { key: 'charge_date', label: 'Date' }, { key: 'payment_method', label: 'Payment' },
    ]);
  }
  if (/fuel/i.test(name)) {
    const { data } = await db.from('transport_fuel_purchases')
      .select('purchase_number, purchase_date, station, fuel_type, gallons, price_per_gallon, total_cost, odometer, efficiency, transport_vehicles(vehicle_number)')
      .eq('property_id', propertyId).order('purchase_date', { ascending: false }).limit(5000);
    const rows = (data || []).map((p: any) => ({ ...p, vehicle_number: p.transport_vehicles?.vehicle_number || '' }));
    return toCsv(rows, [
      { key: 'purchase_number', label: 'Purchase #' }, { key: 'purchase_date', label: 'Date' },
      { key: 'vehicle_number', label: 'Vehicle' }, { key: 'station', label: 'Station' },
      { key: 'fuel_type', label: 'Fuel' }, { key: 'gallons', label: 'Gallons' },
      { key: 'total_cost', label: 'Total' }, { key: 'efficiency', label: 'MPG' },
    ]);
  }
  if (/shuttle/i.test(name)) {
    const { data } = await db.from('transport_shuttles')
      .select('shuttle_number, name, type, route, frequency, capacity, current_occupancy, status')
      .eq('property_id', propertyId).limit(1000);
    return toCsv(data || [], [
      { key: 'shuttle_number', label: 'Shuttle #' }, { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' }, { key: 'route', label: 'Route' },
      { key: 'frequency', label: 'Frequency' }, { key: 'capacity', label: 'Capacity' },
      { key: 'current_occupancy', label: 'Occupancy' }, { key: 'status', label: 'Status' },
    ]);
  }
  // Fleet / utilization / generic fallback
  const { data } = await db.from('transport_vehicles')
    .select('vehicle_number, make, model, category, status, mileage, fuel_level, utilization, condition, last_service, next_service')
    .eq('property_id', propertyId).order('vehicle_number').limit(2000);
  return toCsv(data || [], [
    { key: 'vehicle_number', label: 'Vehicle #' }, { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' }, { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' }, { key: 'mileage', label: 'Mileage' },
    { key: 'fuel_level', label: 'Fuel %' }, { key: 'utilization', label: 'Utilization %' },
    { key: 'condition', label: 'Condition' }, { key: 'next_service', label: 'Next Service' },
  ]);
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── List reports for a property ──────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const category = req.query.category as string;
  let q = supabaseAdmin
    .from('transport_reports')
    .select(REPORT_SELECT)
    .eq('property_id', propertyId)
    .order('id', { ascending: true });
  if (category && (REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Aggregated KPI counts ────────────────────────────────────────────────────
router.get('/:propertyId/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { data, error } = await supabaseAdmin
    .from('transport_reports')
    .select('category, status')
    .eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = { Operational: 0, Fleet: 0, Financial: 0, Performance: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({
    total: rows.length,
    ready: rows.filter((r: any) => r.status === 'Ready').length,
    scheduled: rows.filter((r: any) => r.status === 'Scheduled').length,
    failed: rows.filter((r: any) => r.status === 'Failed').length,
    byCategory,
  });
});

// ── Run all reports for a property ───────────────────────────────────────────
router.post('/:propertyId/run-all', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const { data: reports, error } = await supabaseAdmin
    .from('transport_reports')
    .select(REPORT_SELECT)
    .eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });

  const refreshed: any[] = [];
  for (const report of reports || []) {
    const update = await runOneReport(report);
    if (update) refreshed.push(update);
  }
  return res.json({ refreshed: refreshed.length, reports: refreshed });
});

async function runOneReport(report: any): Promise<any | null> {
  try {
    const csv = await generateReportCsv(report.property_id, report);
    const size = formatSize(Buffer.byteLength(csv, 'utf8'));
    const { data } = await supabaseAdmin!
      .from('transport_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), size })
      .eq('id', report.id)
      .select(REPORT_SELECT)
      .maybeSingle();
    return data;
  } catch (e: any) {
    await supabaseAdmin!
      .from('transport_reports')
      .update({ status: 'Failed', last_run: new Date().toISOString() })
      .eq('id', report.id);
    return null;
  }
}

// ── Fetch a single report ────────────────────────────────────────────────────
router.get('/report/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_reports').select(REPORT_SELECT).eq('id', req.params.id), req
  ).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ── Download generated report content (CSV) ──────────────────────────────────
router.get('/report/:id/download', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_reports').select('*').eq('id', req.params.id), req
  ).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });

  try {
    const csv = await generateReportCsv(data.property_id, data);
    const filename = `${String(data.id).replace(/[^a-z0-9_-]/gi, '')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Report generation failed' });
  }
});

// ── Re-run a single report (generates real content, updates size) ────────────
router.post('/report/:id/run', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: report, error: fetchErr } = await scopeRowWrite(
    supabaseAdmin.from('transport_reports').select('*').eq('id', req.params.id), req
  ).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const data = await runOneReport(report);
  if (!data) return res.status(500).json({ error: 'Report generation failed' });
  return res.json(data);
});

// ── Update frequency / format / status ───────────────────────────────────────
router.patch('/report/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  let has = false;
  if (typeof body.frequency === 'string' && body.frequency.trim()) { updates.frequency = body.frequency.trim(); has = true; }
  if (typeof body.format === 'string' && (REPORT_FORMATS as readonly string[]).includes(body.format)) { updates.format = body.format; has = true; }
  if (typeof body.status === 'string' && (REPORT_STATUSES as readonly string[]).includes(body.status)) { updates.status = body.status; has = true; }
  if (!has) return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  const { data, error } = await scopeRowWrite(
    supabaseAdmin.from('transport_reports').update(updates).eq('id', req.params.id), req
  ).select(REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

export default router;
