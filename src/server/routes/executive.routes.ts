import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { dispatchExecReportSchedule } from '../services/execReporting';

const router = Router();

/**
 * Read-side authorization for the whole executive surface: every GET
 * requires 'exec:view'. Full-access roles (executive/gm/owner/admin)
 * bypass granular checks via userCan(); other users need the permission
 * granted through a role. Mutations keep their own exec:* permissions.
 *
 * Director-tier roles are routed to /erp/executive by ROLE_TO_DEPT, so they
 * are granted read-only access here even without an explicit exec:view grant.
 * This only unlocks GET endpoints — every mutation on this router still
 * requires its own granular exec:* permission.
 * NOTE: keep in sync with EXEC_PORTAL_VIEW_ROLES in src/lib/permissions.ts.
 */
const EXEC_VIEW_ROLES = new Set([
  'director',
  'managing_director',
  'managing director',
  'exec',
  'general manager',
]);
const execViewPermission = requirePermission('exec:view');
const execView = (req: Request, res: Response, next: NextFunction) => {
  const role = String(req.user?.role || '').trim().toLowerCase();
  if (EXEC_VIEW_ROLES.has(role)) return next();
  return execViewPermission(req, res, next);
};

/**
 * 60s response cache for the heavy read-only exec endpoints. The key
 * embeds the full sorted query string so property/period variants never
 * collide. Mutations invalidate via cacheService.invalidate('exec-*').
 */
const execCache = (tag: string, ttlMs = 60_000) => (req: Request, res: Response, next: NextFunction) => {
  const qs = Object.keys(req.query).sort().map(k => `${k}=${req.query[k]}`).join('&');
  const key = `exec-${tag}:${qs}`;
  const hit = cacheService.get(key);
  if (hit !== null) { res.json(hit); return; }
  const orig = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode < 400) cacheService.set(key, body, ttlMs);
    return orig(body);
  }) as any;
  next();
};

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Enterprise KPI Center ─────────────────────────────────────────────
// GET /kpi-center?propertyId=&days=30
// Aggregates live KPIs across every portal's real tables (Front Office,
// Housekeeping, F&B, Engineering, HR, Procurement, Inventory, Sales,
// Security, Sustainability) — no fixture data. Each KPI carries a current
// and previous-period value so the UI can render real trends.

type KpiStatus = 'on-track' | 'at-risk' | 'off-track';

interface EnterpriseKpi {
  id: string;
  name: string;
  /** Portal-aligned grouping shown in the category cards. */
  category: string;
  /** Portal the data is sourced from (shown on the card). */
  source: string;
  currentValue: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  /** 'currency' | '%' | '/5' | 'count' | 'kWh' | 'L' | 't' | 'days' | 'hrs' | 'x' */
  unit: string;
  lowerIsBetter: boolean;
  /** % change vs the previous period; null when there is no baseline. */
  trend: number | null;
  owner: string;
  status: KpiStatus;
  lastUpdated: string;
  /** Daily history from the metric_history data mart (sparkline series). */
  history?: { date: string; value: number }[];
}

async function kpiFetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[exec-kpi-center] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[exec-kpi-center] ${tag}: ${e?.message || e}`);
    return [];
  }
}

function kpiStatus(value: number, target: number, threshold: number, lowerIsBetter: boolean): KpiStatus {
  if (lowerIsBetter) return value <= target ? 'on-track' : value <= threshold ? 'at-risk' : 'off-track';
  return value >= target ? 'on-track' : value >= threshold ? 'at-risk' : 'off-track';
}

function kpiTrend(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Resolve the rolling-window length (in days) from query params.
 * Supports `days=N` and calendar presets `period=today|wtd|mtd|qtd|ytd`.
 * Presets return the fractional days elapsed since the calendar boundary,
 * so `now - days` lands exactly on midnight / week / month / quarter / year start.
 */
function resolveDays(params: any, fallback = 30): number {
  const period = String(params?.period || '').toLowerCase();
  if (period) {
    const now = new Date();
    const start = new Date(now);
    switch (period) {
      case 'today': start.setHours(0, 0, 0, 0); break;
      case 'wtd': {
        const dow = (start.getDay() + 6) % 7; // Monday = week start
        start.setDate(start.getDate() - dow);
        start.setHours(0, 0, 0, 0);
        break;
      }
      case 'mtd': start.setDate(1); start.setHours(0, 0, 0, 0); break;
      case 'qtd': {
        start.setDate(1);
        start.setMonth(Math.floor(start.getMonth() / 3) * 3);
        start.setHours(0, 0, 0, 0);
        break;
      }
      case 'ytd': start.setMonth(0); start.setDate(1); start.setHours(0, 0, 0, 0); break;
      default: break;
    }
    if (start.getTime() !== now.getTime()) {
      return Math.min(Math.max((now.getTime() - start.getTime()) / 86400000, 1 / 24), 366);
    }
  }
  const n = Number(params?.days);
  return Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : fallback, 1), 365);
}

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True when an ISO date/timestamp falls inside [start, end). */
function inWindow(value: any, start: Date, end: Date): boolean {
  if (!value) return false;
  const t = new Date(value).getTime();
  return !isNaN(t) && t >= start.getTime() && t < end.getTime();
}

// ── Configured KPI targets ────────────────────────────────────────────
// metric_definitions.target_value is editable via PATCH /configuration.
// Each endpoint still computes with a built-in default; this overlay
// replaces the target (and recomputes status) when a configured value
// exists for the metric name, so Configuration actually drives the
// dashboards. Cached 60s; invalidated on configuration writes.
let metricTargetCache: { at: number; map: Map<string, number> } | null = null;

async function getMetricTargets(): Promise<Map<string, number>> {
  if (metricTargetCache && Date.now() - metricTargetCache.at < 60_000) return metricTargetCache.map;
  const rows = await kpiFetchRows(
    supabaseAdmin!.from('metric_definitions').select('name, target_value'),
    'metric_definitions_targets',
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.target_value !== null && r.target_value !== undefined) {
      map.set(String(r.name).toLowerCase().trim(), Number(r.target_value));
    }
  }
  metricTargetCache = { at: Date.now(), map };
  return map;
}

/**
 * Overlay configured targets onto a metrics array (matched by metric name,
 * case-insensitive). Recomputes `status` when the metric carries
 * value/currentValue + threshold + lowerIsBetter. No-op when
 * metric_definitions is empty.
 */
async function applyConfiguredTargets<T extends Record<string, any>>(metrics: T[]): Promise<T[]> {
  const targets = await getMetricTargets();
  if (targets.size === 0) return metrics;
  for (const m of metrics) {
    const mo = m as Record<string, any>;
    const cfg = targets.get(String(mo.name || '').toLowerCase().trim());
    if (cfg === undefined || cfg === mo.target) continue;
    mo.target = cfg;
    const value = mo.value ?? mo.currentValue;
    if (mo.status !== undefined && typeof value === 'number' && typeof mo.lowerIsBetter === 'boolean') {
      const threshold = typeof mo.threshold === 'number'
        ? mo.threshold
        : cfg; // fall back to the new target when no band exists
      mo.status = kpiStatus(value, cfg, threshold, mo.lowerIsBetter);
    }
  }
  return metrics;
}

// ── Role-based dashboard views (dashboard_views table) ──────────────────
// Maps app roles to the seeded owner_role values so GM/Owner/Finance/
// Auditor/DeptManager users each get their intended tile layout.
function dashboardRoleFor(userRole?: string | null): string {
  const r = (userRole || '').toLowerCase();
  if (r === 'owner') return 'Owner';
  if (r.includes('finance') || r === 'accountant' || r === 'controller') return 'Finance';
  if (r.includes('audit')) return 'Auditor';
  if (r === 'gm' || r === 'general_manager' || r === 'executive'
      || r === 'system_admin' || r === 'admin' || r === 'director') return 'GM';
  if (r.includes('manager') || r.includes('head') || r.includes('chief')
      || r.includes('supervisor')) return 'DepartmentManager';
  return 'GM';
}

async function fetchDashboardView(userRole?: string | null) {
  const rows = await kpiFetchRows(
    supabaseAdmin!.from('dashboard_views')
      .select('name, owner_role, tile_layout, default_date_range')
      .eq('owner_role', dashboardRoleFor(userRole))
      .eq('is_default', true)
      .limit(1),
    'dashboard_views',
  );
  const v = rows[0];
  if (!v) return null;
  return {
    name: v.name as string,
    ownerRole: v.owner_role as string,
    tileLayout: (v.tile_layout || {}) as Record<string, { row?: number; col?: number; size?: string }>,
    defaultDateRange: (v.default_date_range || null) as string | null,
  };
}

router.get('/kpi-center', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-kpi-center:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  // One parallel batch — a missing table degrades to [] via kpiFetchRows.
  const [
    rooms, reservations, fbOrders, hkTasks, workOrders, pmSchedules,
    fixedAssets, guestRequests, guestFeedbacks, salesGuestFeedback,
    employees, staffAttendance, salesLeads, purchaseOrders, suppliers,
    uinvBalances, uinvItems, inventoryItems, secIncidents, energyMetrics,
  ] = await Promise.all([
    kpiFetchRows(eqProp(supabaseAdmin!.from('rooms')
      .select('id, status, rate, property_id')), 'rooms'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, check_out_date, status, rate, total_amount, adults, children, channel, created_at, property_id')
      .or(`check_out_date.gte.${windowStart},created_at.gte.${windowStart}`)), 'reservations'),
    kpiFetchRows(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, created_at')
      .gte('created_at', prevStart.toISOString()), 'orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
      .select('id, status, created_at, completed_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'housekeeping_task_mgmt'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, status, priority, created_date, completed_at, property_id')
      .gte('created_date', prevStart.toISOString())), 'work_orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('pm_schedules')
      .select('id, status, next_due_date, property_id')), 'pm_schedules'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fixed_assets')
      .select('id, status, property_id')), 'fixed_assets'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('id, status, submitted_at, completed_at, property_id')
      .gte('submitted_at', prevStart.toISOString())), 'guest_requests'),
    kpiFetchRows(supabaseAdmin!.from('guest_feedbacks')
      .select('id, rating, feedback_date'), 'guest_feedbacks'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('sales_guest_feedback')
      .select('id, rating, feedback_date, property_id')), 'sales_guest_feedback'),
    kpiFetchRows(supabaseAdmin!.from('employees')
      .select('id, status, department'), 'employees'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('staff_attendance')
      .select('id, status, attendance_date, overtime_hours, property_id')
      .gte('attendance_date', windowStart)), 'staff_attendance'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('sales_leads')
      .select('id, stage, opportunity_value, conversion_date, created_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'sales_leads'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('proc_purchase_orders')
      .select('id, status, total_amount, order_date, property_id')
      .gte('order_date', prevStart.toISOString())), 'proc_purchase_orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('proc_suppliers')
      .select('id, status, property_id')), 'proc_suppliers'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('uinv_stock_balances')
      .select('item_id, on_hand, unit_cost, property_id')), 'uinv_stock_balances'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('uinv_items')
      .select('id, reorder_point, min_stock, is_active, property_id')), 'uinv_items'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('inventory_items')
      .select('id, current_quantity, reorder_point, unit_cost, is_active, property_id')), 'inventory_items'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
      .select('id, status, priority, reported_at, property_id')
      .gte('reported_at', prevStart.toISOString())), 'sec_incidents'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('energy_metrics')
      .select('id, metric_date, electricity_kwh, water_liters, carbon_footprint_tons, property_id')
      .gte('metric_date', windowStart)), 'energy_metrics'),
  ]);

  const generatedAt = now.toISOString();
  const CANCELLED = new Set(['Cancelled']);
  const RES_ACTIVE = new Set(['Confirmed', 'CheckedIn', 'CheckedOut', 'Waitlisted']);
  const HK_CLOSED = new Set(['Completed', 'Verified']);
  const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
  const SEC_CLOSED = new Set(['Resolved', 'Closed']);
  const PO_EXCLUDED = new Set(['Draft', 'Rejected', 'Cancelled', 'Expired']);
  const PO_OPEN = new Set(['Pending Approval', 'Approved', 'Sent to Supplier', 'Supplier Acknowledged', 'Partially Received']);
  const LEAD_DEAD = new Set(['Lost', 'Closed Lost', 'Converted', 'Won', 'Closed Won']);

  // ── Rooms / Front Office ────────────────────────────────────────────
  const totalRooms = rooms.length;
  const resActive = reservations.filter(r => RES_ACTIVE.has(r.status));

  const roomNightsIn = (start: Date, end: Date) =>
    resActive.reduce((sum, r) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      const nights = (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000;
      return sum + Math.max(0, nights);
    }, 0);

  const roomRevenueIn = (start: Date, end: Date) =>
    resActive.reduce((sum, r) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      const nights = Math.max(0, (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000);
      return sum + nights * (Number(r.rate) || 0);
    }, 0);

  const curNights = roomNightsIn(curStart, now);
  const prevNights = roomNightsIn(prevStart, prevEnd);
  const curRoomRev = roomRevenueIn(curStart, now);
  const prevRoomRev = roomRevenueIn(prevStart, prevEnd);
  const roomDenominator = totalRooms * daysCount;

  const occupancyRate = roomDenominator > 0 ? (curNights / roomDenominator) * 100 : 0;
  const prevOccupancy = roomDenominator > 0 ? (prevNights / roomDenominator) * 100 : 0;
  const adr = curNights > 0 ? curRoomRev / curNights : 0;
  const prevAdr = prevNights > 0 ? prevRoomRev / prevNights : 0;
  const revpar = roomDenominator > 0 ? curRoomRev / roomDenominator : 0;
  const prevRevpar = roomDenominator > 0 ? prevRoomRev / roomDenominator : 0;

  const staysCur = resActive.filter(r => inWindow(r.check_in_date, curStart, now));
  const staysPrev = resActive.filter(r => inWindow(r.check_in_date, prevStart, prevEnd));
  const alos = staysCur.length > 0
    ? staysCur.reduce((s, r) => s + Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000), 0) / staysCur.length
    : 0;
  const prevAlos = staysPrev.length > 0
    ? staysPrev.reduce((s, r) => s + Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000), 0) / staysPrev.length
    : 0;

  const newBookingsCur = reservations.filter(r => inWindow(r.created_at, curStart, now)).length;
  const newBookingsPrev = reservations.filter(r => inWindow(r.created_at, prevStart, prevEnd)).length;
  const cancelledCur = reservations.filter(r => CANCELLED.has(r.status) && inWindow(r.created_at, curStart, now)).length;
  const cancelledPrev = reservations.filter(r => CANCELLED.has(r.status) && inWindow(r.created_at, prevStart, prevEnd)).length;
  const cancellationRate = newBookingsCur > 0 ? (cancelledCur / newBookingsCur) * 100 : 0;
  const prevCancellationRate = newBookingsPrev > 0 ? (cancelledPrev / newBookingsPrev) * 100 : 0;
  const outOfOrderRooms = rooms.filter(r => r.status === 'Out of Order').length;

  // ── F&B ─────────────────────────────────────────────────────────────
  const paidCur = fbOrders.filter(o => o.status === 'Paid' && inWindow(o.created_at, curStart, now));
  const paidPrev = fbOrders.filter(o => o.status === 'Paid' && inWindow(o.created_at, prevStart, prevEnd));
  const fbRevenue = paidCur.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const prevFbRevenue = paidPrev.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const avgCheck = paidCur.length > 0 ? fbRevenue / paidCur.length : 0;
  const prevAvgCheck = paidPrev.length > 0 ? prevFbRevenue / paidPrev.length : 0;

  // ── Housekeeping ────────────────────────────────────────────────────
  const hkCur = hkTasks.filter(t => inWindow(t.created_at, curStart, now));
  const hkPrev = hkTasks.filter(t => inWindow(t.created_at, prevStart, prevEnd));
  const hkCompletion = hkCur.length > 0 ? (hkCur.filter(t => HK_CLOSED.has(t.status)).length / hkCur.length) * 100 : 0;
  const prevHkCompletion = hkPrev.length > 0 ? (hkPrev.filter(t => HK_CLOSED.has(t.status)).length / hkPrev.length) * 100 : 0;
  const openHkTasks = hkTasks.filter(t => !HK_CLOSED.has(t.status)).length;

  // ── Engineering ─────────────────────────────────────────────────────
  const woCur = workOrders.filter(w => inWindow(w.created_date, curStart, now));
  const woPrev = workOrders.filter(w => inWindow(w.created_date, prevStart, prevEnd));
  const woCompletion = woCur.length > 0 ? (woCur.filter(w => WO_CLOSED.has(w.status)).length / woCur.length) * 100 : 0;
  const prevWoCompletion = woPrev.length > 0 ? (woPrev.filter(w => WO_CLOSED.has(w.status)).length / woPrev.length) * 100 : 0;
  const openWorkOrders = workOrders.filter(w => !WO_CLOSED.has(w.status)).length;

  const activePm = pmSchedules.filter(p => p.status === 'Active');
  const pmDue = activePm.filter(p => p.next_due_date && p.next_due_date < dayStr(now));
  const pmCompliance = activePm.length > 0 ? ((activePm.length - pmDue.length) / activePm.length) * 100 : 0;
  const liveAssets = fixedAssets.filter(a => a.status !== 'Disposed' && a.status !== 'Written Off');
  const assetAvailability = liveAssets.length > 0
    ? (liveAssets.filter(a => a.status === 'Active').length / liveAssets.length) * 100
    : 0;

  // ── Guest Experience ────────────────────────────────────────────────
  const feedbackRows = [
    ...guestFeedbacks.map(f => ({ rating: Number(f.rating) || 0, at: f.feedback_date })),
    ...salesGuestFeedback.map(f => ({ rating: Number(f.rating) || 0, at: f.feedback_date })),
  ].filter(f => f.rating > 0);
  const fbCur = feedbackRows.filter(f => inWindow(f.at, curStart, now));
  const fbPrev = feedbackRows.filter(f => inWindow(f.at, prevStart, prevEnd));
  const guestSatisfaction = fbCur.length > 0 ? fbCur.reduce((s, f) => s + f.rating, 0) / fbCur.length : 0;
  const prevSatisfaction = fbPrev.length > 0 ? fbPrev.reduce((s, f) => s + f.rating, 0) / fbPrev.length : 0;
  const complaintRate = fbCur.length > 0 ? (fbCur.filter(f => f.rating <= 2).length / fbCur.length) * 100 : 0;
  const prevComplaintRate = fbPrev.length > 0 ? (fbPrev.filter(f => f.rating <= 2).length / fbPrev.length) * 100 : 0;

  const greqCur = guestRequests.filter(g => inWindow(g.submitted_at, curStart, now));
  const greqPrev = guestRequests.filter(g => inWindow(g.submitted_at, prevStart, prevEnd));
  const greqDone = new Set(['completed', 'closed', 'resolved', 'Completed', 'Closed', 'Resolved']);
  const greqResolution = greqCur.length > 0
    ? (greqCur.filter(g => greqDone.has(g.status) || g.completed_at).length / greqCur.length) * 100
    : 0;
  const prevGreqResolution = greqPrev.length > 0
    ? (greqPrev.filter(g => greqDone.has(g.status) || g.completed_at).length / greqPrev.length) * 100
    : 0;

  // ── Human Resources ─────────────────────────────────────────────────
  const activeEmployees = employees.filter(e => e.status === 'Active').length;
  const totalEmployees = employees.length;
  const turnover = totalEmployees > 0
    ? (employees.filter(e => e.status === 'Terminated' || e.status === 'Inactive').length / totalEmployees) * 100
    : 0;
  const attCur = staffAttendance.filter(a => inWindow(a.attendance_date, curStart, now));
  const attPrev = staffAttendance.filter(a => inWindow(a.attendance_date, prevStart, prevEnd));
  const attendanceRate = attCur.length > 0
    ? (attCur.filter(a => a.status === 'Present' || a.status === 'Late' || a.status === 'Half Day').length / attCur.length) * 100
    : 0;
  const prevAttendanceRate = attPrev.length > 0
    ? (attPrev.filter(a => a.status === 'Present' || a.status === 'Late' || a.status === 'Half Day').length / attPrev.length) * 100
    : 0;
  const overtimeHours = attCur.reduce((s, a) => s + (Number(a.overtime_hours) || 0), 0);
  const prevOvertimeHours = attPrev.reduce((s, a) => s + (Number(a.overtime_hours) || 0), 0);

  // ── Procurement ─────────────────────────────────────────────────────
  const poCur = purchaseOrders.filter(p => !PO_EXCLUDED.has(p.status) && inWindow(p.order_date, curStart, now));
  const poPrev = purchaseOrders.filter(p => !PO_EXCLUDED.has(p.status) && inWindow(p.order_date, prevStart, prevEnd));
  const poSpend = poCur.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
  const prevPoSpend = poPrev.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
  const openPos = purchaseOrders.filter(p => PO_OPEN.has(p.status)).length;
  const activeSuppliers = suppliers.filter(s => !s.status || s.status === 'Active').length;

  // ── Inventory ───────────────────────────────────────────────────────
  const stockValue = uinvBalances.reduce((s, b) => s + (Number(b.on_hand) || 0) * (Number(b.unit_cost) || 0), 0)
    || inventoryItems.reduce((s, i) => s + (Number(i.current_quantity) || 0) * (Number(i.unit_cost) || 0), 0);
  const onHandByItem = new Map<string, number>();
  for (const b of uinvBalances) {
    onHandByItem.set(b.item_id, (onHandByItem.get(b.item_id) || 0) + (Number(b.on_hand) || 0));
  }
  let lowStockItems = uinvItems.filter(i =>
    i.is_active !== false && Number(i.reorder_point) > 0 && (onHandByItem.get(i.id) || 0) <= Number(i.reorder_point)).length;
  if (uinvItems.length === 0) {
    lowStockItems = inventoryItems.filter(i =>
      i.is_active !== false && Number(i.reorder_point) > 0 && Number(i.current_quantity) <= Number(i.reorder_point)).length;
  }

  // ── Sales & Marketing ───────────────────────────────────────────────
  const leadsCur = salesLeads.filter(l => inWindow(l.created_at, curStart, now));
  const leadsPrev = salesLeads.filter(l => inWindow(l.created_at, prevStart, prevEnd));
  const isConverted = (l: any) => l.conversion_date || ['Converted', 'Won', 'Closed Won'].includes(l.stage);
  const leadConversion = leadsCur.length > 0 ? (leadsCur.filter(isConverted).length / leadsCur.length) * 100 : 0;
  const prevLeadConversion = leadsPrev.length > 0 ? (leadsPrev.filter(isConverted).length / leadsPrev.length) * 100 : 0;
  const pipelineValue = salesLeads
    .filter(l => !LEAD_DEAD.has(l.stage) && !l.conversion_date)
    .reduce((s, l) => s + (Number(l.opportunity_value) || 0), 0);

  // ── Security & Risk ─────────────────────────────────────────────────
  const incCur = secIncidents.filter(i => inWindow(i.reported_at, curStart, now));
  const incPrev = secIncidents.filter(i => inWindow(i.reported_at, prevStart, prevEnd));
  const openIncidents = secIncidents.filter(i => !SEC_CLOSED.has(i.status)).length;
  const incResolution = incCur.length > 0
    ? (incCur.filter(i => SEC_CLOSED.has(i.status)).length / incCur.length) * 100
    : 0;
  const prevIncResolution = incPrev.length > 0
    ? (incPrev.filter(i => SEC_CLOSED.has(i.status)).length / incPrev.length) * 100
    : 0;

  // ── Sustainability ──────────────────────────────────────────────────
  const enCur = energyMetrics.filter(e => inWindow(e.metric_date, curStart, now));
  const enPrev = energyMetrics.filter(e => inWindow(e.metric_date, prevStart, prevEnd));
  const electricityKwh = enCur.reduce((s, e) => s + (Number(e.electricity_kwh) || 0), 0);
  const prevElectricityKwh = enPrev.reduce((s, e) => s + (Number(e.electricity_kwh) || 0), 0);
  const waterLiters = enCur.reduce((s, e) => s + (Number(e.water_liters) || 0), 0);
  const prevWaterLiters = enPrev.reduce((s, e) => s + (Number(e.water_liters) || 0), 0);
  const carbonTons = enCur.reduce((s, e) => s + (Number(e.carbon_footprint_tons) || 0), 0);
  const prevCarbonTons = enPrev.reduce((s, e) => s + (Number(e.carbon_footprint_tons) || 0), 0);

  const totalRevenue = curRoomRev + fbRevenue;
  const prevTotalRevenue = prevRoomRev + prevFbRevenue;

  const kpi = (
    id: string, name: string, category: string, source: string,
    currentValue: number, previousValue: number | null,
    target: number, threshold: number, unit: string,
    owner: string, lowerIsBetter = false,
  ): EnterpriseKpi => ({
    id, name, category, source,
    currentValue: Math.round(currentValue * 100) / 100,
    previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
    target, threshold, unit, lowerIsBetter,
    trend: kpiTrend(currentValue, previousValue),
    owner,
    status: kpiStatus(currentValue, target, threshold, lowerIsBetter),
    lastUpdated: generatedAt,
  });

  const kpis: EnterpriseKpi[] = [
    // Financial — Finance portal
    kpi('total_revenue', 'Total Revenue', 'Financial', 'Finance', totalRevenue, prevTotalRevenue, 0, 0, 'currency', 'CFO'),
    kpi('room_revenue', 'Room Revenue', 'Financial', 'Front Office', curRoomRev, prevRoomRev, 0, 0, 'currency', 'Front Office Manager'),
    kpi('fb_revenue', 'F&B Revenue', 'Financial', 'F&B', fbRevenue, prevFbRevenue, 0, 0, 'currency', 'F&B Director'),
    kpi('procurement_spend', 'Procurement Spend', 'Financial', 'Procurement', poSpend, prevPoSpend, 0, 0, 'currency', 'Procurement Manager', true),

    // Rooms & Operations — Front Office
    kpi('occupancy_rate', 'Occupancy Rate', 'Rooms & Operations', 'Front Office', occupancyRate, prevOccupancy, 75, 60, '%', 'Front Office Manager'),
    kpi('adr', 'Average Daily Rate', 'Rooms & Operations', 'Front Office', adr, prevAdr, 0, 0, 'currency', 'Revenue Manager'),
    kpi('revpar', 'RevPAR', 'Rooms & Operations', 'Revenue', revpar, prevRevpar, 0, 0, 'currency', 'Revenue Manager'),
    kpi('avg_length_of_stay', 'Avg Length of Stay', 'Rooms & Operations', 'Front Office', alos, prevAlos, 0, 0, 'days', 'Front Office Manager'),
    kpi('booking_pace', 'New Bookings', 'Rooms & Operations', 'Front Office', newBookingsCur, newBookingsPrev, 0, 0, 'count', 'Reservations Manager'),
    kpi('cancellation_rate', 'Cancellation Rate', 'Rooms & Operations', 'Front Office', cancellationRate, prevCancellationRate, 10, 20, '%', 'Front Office Manager', true),
    kpi('rooms_out_of_order', 'Rooms Out of Order', 'Rooms & Operations', 'Engineering', outOfOrderRooms, null, 2, 5, 'count', 'Chief Engineer', true),

    // Guest Experience — Front Office / Concierge / Sales
    kpi('guest_satisfaction', 'Guest Satisfaction', 'Guest Experience', 'Front Office', guestSatisfaction, prevSatisfaction, 4, 3.5, '/5', 'Front Office Manager'),
    kpi('request_resolution', 'Guest Request Resolution', 'Guest Experience', 'Concierge', greqResolution, prevGreqResolution, 90, 75, '%', 'Concierge Manager'),
    kpi('complaint_rate', 'Complaint Rate', 'Guest Experience', 'Front Office', complaintRate, prevComplaintRate, 15, 30, '%', 'Front Office Manager', true),

    // Housekeeping
    kpi('hk_completion', 'HK Task Completion', 'Housekeeping', 'Housekeeping', hkCompletion, prevHkCompletion, 90, 75, '%', 'Executive Housekeeper'),
    kpi('hk_open_tasks', 'Open HK Tasks', 'Housekeeping', 'Housekeeping', openHkTasks, null, 10, 25, 'count', 'Executive Housekeeper', true),

    // Engineering & Assets
    kpi('wo_completion', 'Work Order Completion', 'Engineering', 'Engineering', woCompletion, prevWoCompletion, 85, 65, '%', 'Chief Engineer'),
    kpi('open_work_orders', 'Open Work Orders', 'Engineering', 'Engineering', openWorkOrders, null, 15, 40, 'count', 'Chief Engineer', true),
    kpi('pm_compliance', 'PM Compliance', 'Engineering', 'Engineering', pmCompliance, null, 90, 75, '%', 'Chief Engineer'),
    kpi('asset_availability', 'Asset Availability', 'Engineering', 'Engineering', assetAvailability, null, 92, 80, '%', 'Chief Engineer'),

    // F&B
    kpi('fb_paid_orders', 'Paid F&B Orders', 'Food & Beverage', 'F&B', paidCur.length, paidPrev.length, 0, 0, 'count', 'F&B Director'),
    kpi('fb_avg_check', 'Average Check', 'Food & Beverage', 'F&B', avgCheck, prevAvgCheck, 0, 0, 'currency', 'F&B Director'),

    // Human Resources
    kpi('headcount', 'Active Headcount', 'Human Resources', 'HR', activeEmployees, null, 0, 0, 'count', 'HR Director'),
    kpi('attendance_rate', 'Attendance Rate', 'Human Resources', 'HR', attendanceRate, prevAttendanceRate, 92, 80, '%', 'HR Director'),
    kpi('turnover_rate', 'Employee Turnover', 'Human Resources', 'HR', turnover, null, 15, 25, '%', 'HR Director', true),
    kpi('overtime_hours', 'Overtime Hours', 'Human Resources', 'HR', overtimeHours, prevOvertimeHours, 100, 250, 'hrs', 'HR Director', true),

    // Procurement
    kpi('open_pos', 'Open Purchase Orders', 'Procurement', 'Procurement', openPos, null, 10, 30, 'count', 'Procurement Manager', true),
    kpi('active_suppliers', 'Active Suppliers', 'Procurement', 'Procurement', activeSuppliers, null, 0, 0, 'count', 'Procurement Manager'),

    // Inventory
    kpi('stock_value', 'Inventory Stock Value', 'Inventory', 'Inventory', stockValue, null, 0, 0, 'currency', 'Inventory Manager'),
    kpi('low_stock_items', 'Low Stock Items', 'Inventory', 'Inventory', lowStockItems, null, 5, 15, 'count', 'Inventory Manager', true),

    // Sales & Marketing
    kpi('lead_conversion', 'Lead Conversion', 'Sales & Marketing', 'Sales', leadConversion, prevLeadConversion, 25, 15, '%', 'Sales Director'),
    kpi('pipeline_value', 'Pipeline Value', 'Sales & Marketing', 'Sales', pipelineValue, null, 0, 0, 'currency', 'Sales Director'),
    kpi('new_leads', 'New Leads', 'Sales & Marketing', 'Sales', leadsCur.length, leadsPrev.length, 0, 0, 'count', 'Sales Director'),

    // Security & Risk
    kpi('security_incidents', 'Security Incidents', 'Security & Risk', 'Security', incCur.length, incPrev.length, 3, 8, 'count', 'Security Manager', true),
    kpi('open_incidents', 'Open Incidents', 'Security & Risk', 'Security', openIncidents, null, 3, 10, 'count', 'Security Manager', true),
    kpi('incident_resolution', 'Incident Resolution', 'Security & Risk', 'Security', incResolution, prevIncResolution, 85, 65, '%', 'Security Manager'),

    // Sustainability — Engineering energy metrics
    kpi('electricity', 'Electricity Consumption', 'Sustainability', 'Engineering', electricityKwh, prevElectricityKwh, 0, 0, 'kWh', 'Chief Engineer', true),
    kpi('water', 'Water Consumption', 'Sustainability', 'Engineering', waterLiters, prevWaterLiters, 0, 0, 'L', 'Chief Engineer', true),
    kpi('carbon', 'Carbon Footprint', 'Sustainability', 'Engineering', carbonTons, prevCarbonTons, 0, 0, 't', 'Chief Engineer', true),
  ];

  await applyConfiguredTargets(kpis);

  // Attach real daily history from the metric_history data mart (written by
  // the exec_reporting_snapshot job) as sparkline series for the headline
  // KPIs it tracks. Best-effort — absence of history never fails the route.
  const KPI_HISTORY_METRIC: Record<string, string> = {
    total_revenue: 'total revenue',
    occupancy_rate: 'occupancy rate',
    adr: 'average daily rate',
    revpar: 'revpar',
    open_work_orders: 'open work orders',
    headcount: 'headcount',
    pipeline_value: 'pipeline value',
  };
  try {
    const metricDefs = await kpiFetchRows(
      supabaseAdmin!.from('metric_definitions').select('metric_id, name'), 'metric_definitions');
    const idByName = new Map(metricDefs.map(m => [String(m.name).toLowerCase().trim(), m.metric_id]));
    const wanted = new Map<string, string>(); // metric_id → kpi id
    for (const [kpiId, metricName] of Object.entries(KPI_HISTORY_METRIC)) {
      const mid = idByName.get(metricName);
      if (mid) wanted.set(mid, kpiId);
    }
    if (wanted.size > 0) {
      const histProp = propertyId || '00000000-0000-0000-0000-000000000001';
      const since = new Date(now.getTime() - 30 * 86400e3).toISOString().slice(0, 10);
      const hist = await kpiFetchRows(
        supabaseAdmin!.from('metric_history')
          .select('metric_id, date, value')
          .eq('property_id', histProp)
          .gte('date', since)
          .order('date', { ascending: true }), 'metric_history');
      const byKpi = new Map<string, { date: string; value: number }[]>();
      for (const h of hist) {
        const kpiId = wanted.get(h.metric_id);
        if (!kpiId) continue;
        const arr = byKpi.get(kpiId) || [];
        arr.push({ date: h.date, value: Number(h.value) });
        byKpi.set(kpiId, arr);
      }
      for (const k of kpis) {
        const s = byKpi.get(k.id);
        if (s && s.length > 0) k.history = s;
      }
    }
  } catch (e: any) {
    console.warn(`[exec-kpi-center] metric_history: ${e?.message || e}`);
  }

  const result = {
    propertyId: propertyId || null,
    days: daysCount,
    generatedAt,
    kpis,
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Executive Dashboard ─────────────────────────────────────────────────
// GET /api/executive/dashboard?days=30&propertyId=...
// Headline KPI snapshot grouped by executive category. Every value is
// computed from live portal tables — rooms/reservations (Front Office),
// orders + fb_cost_analytics + fb_kitchen_analytics (F&B), guests +
// guest_feedbacks + loyalty_transactions (Guest Experience),
// expense_requests + bank_accounts (Finance), employees + staff_attendance +
// hr_labor_cost_analysis (HR), work_orders + pm_schedules + fixed_assets +
// energy_metrics (Engineering), proc_* + uinv_* (Procurement/Inventory),
// sec_incidents (Security), banquet_events + spa_appointments +
// transport_trips (Leisure & Events). Each KPI carries the real previous-
// period value so the trend badge is computed, not hardcoded.

interface DashKpi {
  id: string;
  name: string;
  category: string;
  source: string;
  value: number | null;
  previousValue: number | null;
  unit: string;
  lowerIsBetter: boolean;
  detail?: string;
}

router.get('/dashboard', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-dashboard:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  const view = await fetchDashboardView(req.user?.role);
  if (cached) return res.json({ ...cached, view });

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [
    rooms, reservations, fbOrders, fbCost, fbKitchen, guests, guestFeedbacks,
    salesGuestFeedback, loyaltyTxns, expenseRequests, bankAccounts, employees,
    staffAttendance, laborAnalysis, hkTasks, workOrders, pmSchedules,
    fixedAssets, purchaseOrders, suppliers, uinvBalances, uinvItems,
    inventoryItems, secIncidents, energyMetrics, banquetEvents,
    spaAppointments, transportTrips, guestRequests,
  ] = await Promise.all([
    kpiFetchRows(eqProp(supabaseAdmin!.from('rooms')
      .select('id, status, rate, property_id')), 'rooms'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, guest_id, check_in_date, check_out_date, status, rate, created_at, property_id')
      .or(`check_out_date.gte.${windowStart},created_at.gte.${windowStart}`)), 'reservations'),
    kpiFetchRows(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, created_at')
      .gte('created_at', prevStart.toISOString()), 'orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fb_cost_analytics')
      .select('outlet_id, period, food_cost_pct, bev_cost_pct, property_id')), 'fb_cost_analytics'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fb_kitchen_analytics')
      .select('station, period, avg_ticket_time_min, accuracy, property_id')), 'fb_kitchen_analytics'),
    kpiFetchRows(supabaseAdmin!.from('guests').select('id, created_at'), 'guests'),
    kpiFetchRows(supabaseAdmin!.from('guest_feedbacks')
      .select('id, rating, feedback_date'), 'guest_feedbacks'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('sales_guest_feedback')
      .select('id, rating, feedback_date, property_id')), 'sales_guest_feedback'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('loyalty_transactions')
      .select('id, guest_id, created_at, property_id')), 'loyalty_transactions'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('expense_requests')
      .select('id, amount, status, department, request_date, property_id')
      .gte('request_date', windowStart)), 'expense_requests'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('bank_accounts')
      .select('id, current_balance, is_active, property_id')), 'bank_accounts'),
    kpiFetchRows(supabaseAdmin!.from('employees')
      .select('id, status'), 'employees'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('staff_attendance')
      .select('id, status, attendance_date, overtime_hours, property_id')
      .gte('attendance_date', windowStart)), 'staff_attendance'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('hr_labor_cost_analysis')
      .select('department, budget, actual, period, property_id')), 'hr_labor_cost_analysis'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
      .select('id, status, created_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'housekeeping_task_mgmt'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, status, created_date, property_id')
      .gte('created_date', prevStart.toISOString())), 'work_orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('pm_schedules')
      .select('id, status, next_due_date, property_id')), 'pm_schedules'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fixed_assets')
      .select('id, status, property_id')), 'fixed_assets'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('proc_purchase_orders')
      .select('id, status, total_amount, order_date, property_id')
      .gte('order_date', prevStart.toISOString())), 'proc_purchase_orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('proc_suppliers')
      .select('id, status, property_id')), 'proc_suppliers'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('uinv_stock_balances')
      .select('item_id, on_hand, unit_cost, property_id')), 'uinv_stock_balances'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('uinv_items')
      .select('id, reorder_point, is_active, property_id')), 'uinv_items'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('inventory_items')
      .select('id, current_quantity, reorder_point, unit_cost, is_active, property_id')), 'inventory_items'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
      .select('id, status, reported_at, property_id')
      .gte('reported_at', prevStart.toISOString())), 'sec_incidents'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('energy_metrics')
      .select('id, metric_date, electricity_kwh, water_liters, property_id')
      .gte('metric_date', windowStart)), 'energy_metrics'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('banquet_events')
      .select('id, status, event_date, actual_revenue, estimated_revenue, property_id')
      .gte('event_date', windowStart)), 'banquet_events'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('spa_appointments')
      .select('id, status, appointment_date, amount, property_id')
      .gte('appointment_date', windowStart)), 'spa_appointments'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('transport_trips')
      .select('id, status, scheduled_at, actual_at, property_id')
      .gte('scheduled_at', prevStart.toISOString())), 'transport_trips'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('id, status, submitted_at, completed_at, property_id')
      .gte('submitted_at', prevStart.toISOString())), 'guest_requests'),
  ]);

  const generatedAt = now.toISOString();
  const RES_ACTIVE = new Set(['Confirmed', 'CheckedIn', 'CheckedOut', 'Waitlisted']);
  const CANCELLED = new Set(['Cancelled']);
  const HK_CLOSED = new Set(['Completed', 'Verified']);
  const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
  const SEC_CLOSED = new Set(['Resolved', 'Closed']);
  const PO_EXCLUDED = new Set(['Draft', 'Rejected', 'Cancelled', 'Expired']);
  const PO_OPEN = new Set(['Pending Approval', 'Approved', 'Sent to Supplier', 'Supplier Acknowledged', 'Partially Received']);
  const SPA_DONE = new Set(['Completed', 'Checked-out', 'Checked Out']);
  const TRIP_DONE = new Set(['Completed', 'Closed']);
  const BANQUET_DONE = new Set(['Completed', 'Confirmed', 'In Progress']);

  // ── Rooms / revenue ────────────────────────────────────────────────
  const totalRooms = rooms.length;
  const resActive = reservations.filter(r => RES_ACTIVE.has(r.status));
  const roomNightsIn = (start: Date, end: Date) =>
    resActive.reduce((sum, r) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      return sum + Math.max(0, (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000);
    }, 0);
  const roomRevenueIn = (start: Date, end: Date) =>
    resActive.reduce((sum, r) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      return sum + Math.max(0, (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000) * (Number(r.rate) || 0);
    }, 0);

  const curNights = roomNightsIn(curStart, now);
  const prevNights = roomNightsIn(prevStart, prevEnd);
  const curRoomRev = roomRevenueIn(curStart, now);
  const prevRoomRev = roomRevenueIn(prevStart, prevEnd);
  const roomDenominator = totalRooms * daysCount;
  const occupancyRate = roomDenominator > 0 ? (curNights / roomDenominator) * 100 : 0;
  const prevOccupancy = roomDenominator > 0 ? (prevNights / roomDenominator) * 100 : 0;
  const adr = curNights > 0 ? curRoomRev / curNights : 0;
  const prevAdr = prevNights > 0 ? prevRoomRev / prevNights : 0;
  const revpar = roomDenominator > 0 ? curRoomRev / roomDenominator : 0;
  const prevRevpar = roomDenominator > 0 ? prevRoomRev / roomDenominator : 0;

  const staysCur = resActive.filter(r => inWindow(r.check_in_date, curStart, now));
  const staysPrev = resActive.filter(r => inWindow(r.check_in_date, prevStart, prevEnd));
  const alos = staysCur.length > 0
    ? staysCur.reduce((s, r) => s + Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000), 0) / staysCur.length : 0;
  const prevAlos = staysPrev.length > 0
    ? staysPrev.reduce((s, r) => s + Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000), 0) / staysPrev.length : 0;
  const newBookingsCur = reservations.filter(r => inWindow(r.created_at, curStart, now)).length;
  const newBookingsPrev = reservations.filter(r => inWindow(r.created_at, prevStart, prevEnd)).length;
  const cancelledCur = reservations.filter(r => CANCELLED.has(r.status) && inWindow(r.created_at, curStart, now)).length;
  const cancelledPrev = reservations.filter(r => CANCELLED.has(r.status) && inWindow(r.created_at, prevStart, prevEnd)).length;
  const cancellationRate = newBookingsCur > 0 ? (cancelledCur / newBookingsCur) * 100 : 0;
  const prevCancellationRate = newBookingsPrev > 0 ? (cancelledPrev / newBookingsPrev) * 100 : 0;
  const oooRooms = rooms.filter(r => r.status === 'Out of Order').length;

  // Repeat guests: guests with 2+ active reservations in the window
  const stayCountByGuest = new Map<string, number>();
  for (const r of staysCur) {
    if (!r.guest_id) continue;
    stayCountByGuest.set(r.guest_id, (stayCountByGuest.get(r.guest_id) || 0) + 1);
  }
  const repeatGuests = [...stayCountByGuest.values()].filter(n => n > 1).length;

  // ── F&B ────────────────────────────────────────────────────────────
  const paidCur = fbOrders.filter(o => o.status === 'Paid' && inWindow(o.created_at, curStart, now));
  const paidPrev = fbOrders.filter(o => o.status === 'Paid' && inWindow(o.created_at, prevStart, prevEnd));
  const fbRevenue = paidCur.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const prevFbRevenue = paidPrev.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const avgCheck = paidCur.length > 0 ? fbRevenue / paidCur.length : 0;
  const prevAvgCheck = paidPrev.length > 0 ? prevFbRevenue / paidPrev.length : 0;

  const fbCostMtd = fbCost.filter(r => r.period === 'MTD');
  const fbCostRows = fbCostMtd.length ? fbCostMtd : fbCost;
  const foodCostPct = fbCostRows.length
    ? fbCostRows.reduce((s, r) => s + (Number(r.food_cost_pct) || 0), 0) / fbCostRows.length : null;
  const bevCostPct = fbCostRows.length
    ? fbCostRows.reduce((s, r) => s + (Number(r.bev_cost_pct) || 0), 0) / fbCostRows.length : null;
  const kitchenMtd = fbKitchen.filter(r => r.period === 'MTD');
  const kitchenRows = kitchenMtd.length ? kitchenMtd : fbKitchen;
  const ticketTime = kitchenRows.length
    ? kitchenRows.reduce((s, r) => s + (Number(r.avg_ticket_time_min) || 0), 0) / kitchenRows.length : null;

  // ── Other outlets ──────────────────────────────────────────────────
  const banquetCur = banquetEvents.filter(e => inWindow(e.event_date, curStart, now));
  const banquetPrev = banquetEvents.filter(e => inWindow(e.event_date, prevStart, prevEnd));
  const banquetRev = banquetCur.filter(e => BANQUET_DONE.has(e.status))
    .reduce((s, e) => s + (Number(e.actual_revenue) || Number(e.estimated_revenue) || 0), 0);
  const prevBanquetRev = banquetPrev.filter(e => BANQUET_DONE.has(e.status))
    .reduce((s, e) => s + (Number(e.actual_revenue) || Number(e.estimated_revenue) || 0), 0);
  const upcomingEvents = banquetEvents.filter(e => e.event_date >= dayStr(now)).length;

  const spaCur = spaAppointments.filter(a => inWindow(a.appointment_date, curStart, now));
  const spaPrev = spaAppointments.filter(a => inWindow(a.appointment_date, prevStart, prevEnd));
  const spaRev = spaCur.filter(a => SPA_DONE.has(a.status)).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const prevSpaRev = spaPrev.filter(a => SPA_DONE.has(a.status)).reduce((s, a) => s + (Number(a.amount) || 0), 0);

  const tripsCur = transportTrips.filter(t => inWindow(t.scheduled_at, curStart, now));
  const tripsPrev = transportTrips.filter(t => inWindow(t.scheduled_at, prevStart, prevEnd));
  const tripsDone = tripsCur.filter(t => TRIP_DONE.has(t.status) || t.actual_at).length;
  const prevTripsDone = tripsPrev.filter(t => TRIP_DONE.has(t.status) || t.actual_at).length;

  const otherRev = banquetRev + spaRev;
  const prevOtherRev = prevBanquetRev + prevSpaRev;
  const totalRevenue = curRoomRev + fbRevenue + otherRev;
  const prevTotalRevenue = prevRoomRev + prevFbRevenue + prevOtherRev;
  const trevpar = roomDenominator > 0 ? totalRevenue / roomDenominator : 0;
  const prevTrevpar = roomDenominator > 0 ? prevTotalRevenue / roomDenominator : 0;

  // ── Finance ────────────────────────────────────────────────────────
  const expCur = expenseRequests.filter(e => e.status === 'Paid' && inWindow(e.request_date, curStart, now));
  const expPrev = expenseRequests.filter(e => e.status === 'Paid' && inWindow(e.request_date, prevStart, prevEnd));
  const opex = expCur.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const prevOpex = expPrev.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const gop = totalRevenue - opex;
  const prevGop = prevTotalRevenue - prevOpex;
  const goppar = roomDenominator > 0 ? gop / roomDenominator : 0;
  const prevGoppar = roomDenominator > 0 ? prevGop / roomDenominator : 0;
  const opMargin = totalRevenue > 0 ? (gop / totalRevenue) * 100 : 0;
  const prevOpMargin = prevTotalRevenue > 0 ? (prevGop / prevTotalRevenue) * 100 : 0;
  const cashPosition = bankAccounts
    .filter(a => a.is_active !== false)
    .reduce((s, a) => s + (Number(a.current_balance) || 0), 0);

  // ── Guest experience ───────────────────────────────────────────────
  const feedbackRows = [
    ...guestFeedbacks.map(f => ({ rating: Number(f.rating) || 0, at: f.feedback_date })),
    ...salesGuestFeedback.map(f => ({ rating: Number(f.rating) || 0, at: f.feedback_date })),
  ].filter(f => f.rating > 0);
  const fbkCur = feedbackRows.filter(f => inWindow(f.at, curStart, now));
  const fbkPrev = feedbackRows.filter(f => inWindow(f.at, prevStart, prevEnd));
  const satisfaction = fbkCur.length ? fbkCur.reduce((s, f) => s + f.rating, 0) / fbkCur.length : null;
  const prevSatisfaction = fbkPrev.length ? fbkPrev.reduce((s, f) => s + f.rating, 0) / fbkPrev.length : null;
  const complaintRate = fbkCur.length ? (fbkCur.filter(f => f.rating <= 2).length / fbkCur.length) * 100 : null;
  const prevComplaintRate = fbkPrev.length ? (fbkPrev.filter(f => f.rating <= 2).length / fbkPrev.length) * 100 : null;
  const loyaltyMembers = new Set(loyaltyTxns.map(t => t.guest_id).filter(Boolean)).size;
  const greqCur = guestRequests.filter(g => inWindow(g.submitted_at, curStart, now));
  const greqDone = greqCur.filter(g => ['completed', 'closed', 'resolved'].includes(String(g.status).toLowerCase()) || g.completed_at).length;
  const greqRate = greqCur.length ? (greqDone / greqCur.length) * 100 : null;

  // ── Workforce ──────────────────────────────────────────────────────
  const activeEmployees = employees.filter(e => e.status === 'Active').length;
  const turnover = employees.length
    ? (employees.filter(e => e.status === 'Terminated' || e.status === 'Inactive').length / employees.length) * 100 : null;
  const attCur = staffAttendance.filter(a => inWindow(a.attendance_date, curStart, now));
  const attPrev = staffAttendance.filter(a => inWindow(a.attendance_date, prevStart, prevEnd));
  const attRate = attCur.length
    ? (attCur.filter(a => ['Present', 'Late', 'Half Day'].includes(a.status)).length / attCur.length) * 100 : null;
  const prevAttRate = attPrev.length
    ? (attPrev.filter(a => ['Present', 'Late', 'Half Day'].includes(a.status)).length / attPrev.length) * 100 : null;
  const overtimeHrs = attCur.reduce((s, a) => s + (Number(a.overtime_hours) || 0), 0);
  const prevOvertimeHrs = attPrev.reduce((s, a) => s + (Number(a.overtime_hours) || 0), 0);
  // hr_labor_cost_analysis stores one row per TEXT period — keep only the
  // latest so multiple periods don't inflate the total.
  const periodKey = (p: any): number => {
    const s = String(p ?? '').trim().toLowerCase();
    const q = s.match(/q([1-4])\s*(\d{4})/);
    if (q) return Number(q[2]) * 10 + Number(q[1]);
    const y = s.match(/(\d{4})/);
    const m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    if (y && m) return Number(y[1]) * 100 + months.indexOf(m[1]) + 1;
    if (y) return Number(y[1]) * 100 + 12;
    return 0;
  };
  const latestPeriodRows = (rows: any[]) => {
    if (!rows.length) return rows;
    const max = Math.max(...rows.map(r => periodKey(r.period)));
    return max > 0 ? rows.filter(r => periodKey(r.period) === max) : rows;
  };
  const laborActual = latestPeriodRows(laborAnalysis).reduce((s, r) => s + (Number(r.actual) || 0), 0);
  const laborCostPct = laborActual > 0 && totalRevenue > 0 ? (laborActual / totalRevenue) * 100 : null;
  const revPerEmployee = activeEmployees > 0 ? totalRevenue / activeEmployees : null;

  // ── Engineering ────────────────────────────────────────────────────
  const woCur = workOrders.filter(w => inWindow(w.created_date, curStart, now));
  const woPrev = workOrders.filter(w => inWindow(w.created_date, prevStart, prevEnd));
  const woCompletion = woCur.length ? (woCur.filter(w => WO_CLOSED.has(w.status)).length / woCur.length) * 100 : null;
  const prevWoCompletion = woPrev.length ? (woPrev.filter(w => WO_CLOSED.has(w.status)).length / woPrev.length) * 100 : null;
  const openWorkOrders = workOrders.filter(w => !WO_CLOSED.has(w.status)).length;
  const activePm = pmSchedules.filter(p => p.status === 'Active');
  const pmDue = activePm.filter(p => p.next_due_date && p.next_due_date < dayStr(now));
  const pmCompliance = activePm.length ? ((activePm.length - pmDue.length) / activePm.length) * 100 : null;
  const liveAssets = fixedAssets.filter(a => a.status !== 'Disposed' && a.status !== 'Written Off');
  const assetAvailability = liveAssets.length
    ? (liveAssets.filter(a => a.status === 'Active').length / liveAssets.length) * 100 : null;
  const enCur = energyMetrics.filter(e => inWindow(e.metric_date, curStart, now));
  const enPrev = energyMetrics.filter(e => inWindow(e.metric_date, prevStart, prevEnd));
  const electricityKwh = enCur.reduce((s, e) => s + (Number(e.electricity_kwh) || 0), 0);
  const prevElectricityKwh = enPrev.reduce((s, e) => s + (Number(e.electricity_kwh) || 0), 0);

  // ── Procurement / inventory ────────────────────────────────────────
  const poCur = purchaseOrders.filter(p => !PO_EXCLUDED.has(p.status) && inWindow(p.order_date, curStart, now));
  const poPrev = purchaseOrders.filter(p => !PO_EXCLUDED.has(p.status) && inWindow(p.order_date, prevStart, prevEnd));
  const poSpend = poCur.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
  const prevPoSpend = poPrev.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
  const openPos = purchaseOrders.filter(p => PO_OPEN.has(p.status)).length;
  const activeSuppliers = suppliers.filter(s => !s.status || s.status === 'Active').length;
  const stockValue = uinvBalances.reduce((s, b) => s + (Number(b.on_hand) || 0) * (Number(b.unit_cost) || 0), 0)
    || inventoryItems.reduce((s, i) => s + (Number(i.current_quantity) || 0) * (Number(i.unit_cost) || 0), 0);
  const onHandByItem = new Map<string, number>();
  for (const b of uinvBalances) {
    onHandByItem.set(b.item_id, (onHandByItem.get(b.item_id) || 0) + (Number(b.on_hand) || 0));
  }
  const lowStock = uinvItems.length
    ? uinvItems.filter(i => i.is_active !== false && Number(i.reorder_point) > 0 && (onHandByItem.get(i.id) || 0) <= Number(i.reorder_point)).length
    : inventoryItems.filter(i => i.is_active !== false && Number(i.reorder_point) > 0 && Number(i.current_quantity) <= Number(i.reorder_point)).length;

  // ── Security ───────────────────────────────────────────────────────
  const incCur = secIncidents.filter(i => inWindow(i.reported_at, curStart, now));
  const incPrev = secIncidents.filter(i => inWindow(i.reported_at, prevStart, prevEnd));
  const openIncidents = secIncidents.filter(i => !SEC_CLOSED.has(i.status)).length;
  const incResolution = incCur.length ? (incCur.filter(i => SEC_CLOSED.has(i.status)).length / incCur.length) * 100 : null;
  const prevIncResolution = incPrev.length ? (incPrev.filter(i => SEC_CLOSED.has(i.status)).length / incPrev.length) * 100 : null;

  // ── Housekeeping ───────────────────────────────────────────────────
  const hkCur = hkTasks.filter(t => inWindow(t.created_at, curStart, now));
  const hkPrev = hkTasks.filter(t => inWindow(t.created_at, prevStart, prevEnd));
  const hkCompletion = hkCur.length ? (hkCur.filter(t => HK_CLOSED.has(t.status)).length / hkCur.length) * 100 : null;
  const prevHkCompletion = hkPrev.length ? (hkPrev.filter(t => HK_CLOSED.has(t.status)).length / hkPrev.length) * 100 : null;

  const d = (id: string, name: string, category: string, source: string,
    value: number | null, prev: number | null, unit: string,
    lowerIsBetter = false, detail?: string): DashKpi => ({
      id, name, category, source, unit, lowerIsBetter, detail,
      value: value === null ? null : Math.round(value * 100) / 100,
      previousValue: prev === null ? null : Math.round(prev * 100) / 100,
    });

  const kpis: DashKpi[] = [
    // Financial — Finance portal
    d('total_revenue', 'Total Revenue', 'financial', 'Finance', totalRevenue, prevTotalRevenue, 'currency'),
    d('room_revenue', 'Room Revenue', 'financial', 'Front Office', curRoomRev, prevRoomRev, 'currency'),
    d('operating_expenses', 'Operating Expenses', 'financial', 'Finance', opex, prevOpex, 'currency', true),
    d('gop', 'Gross Operating Profit', 'financial', 'Finance', gop, prevGop, 'currency'),
    d('goppar', 'GOPPAR', 'financial', 'Finance', goppar, prevGoppar, 'currency'),
    d('operating_margin', 'Operating Margin', 'financial', 'Finance', opMargin, prevOpMargin, '%'),
    d('cash_position', 'Cash Position', 'financial', 'Finance', cashPosition, null, 'currency', false, `${bankAccounts.filter(a => a.is_active !== false).length} active accounts`),

    // Rooms — Front Office / PMS
    d('occupancy', 'Occupancy Rate', 'rooms', 'Front Office', occupancyRate, prevOccupancy, '%', false, `${Math.round(curNights)} room nights`),
    d('adr', 'Average Daily Rate', 'rooms', 'Front Office', adr, prevAdr, 'currency'),
    d('revpar', 'RevPAR', 'rooms', 'Revenue', revpar, prevRevpar, 'currency'),
    d('trevpar', 'TRevPAR', 'rooms', 'Revenue', trevpar, prevTrevpar, 'currency'),
    d('alos', 'Avg Length of Stay', 'rooms', 'Front Office', alos, prevAlos, 'days'),
    d('new_bookings', 'New Bookings', 'rooms', 'Front Office', newBookingsCur, newBookingsPrev, 'count'),
    d('cancellation_rate', 'Cancellation Rate', 'rooms', 'Front Office', cancellationRate, prevCancellationRate, '%', true),
    d('ooo_rooms', 'Rooms Out of Order', 'rooms', 'Engineering', oooRooms, null, 'count', true),

    // Guests — Front Office / Concierge
    d('satisfaction', 'Guest Satisfaction', 'guests', 'Front Office', satisfaction, prevSatisfaction, '/5'),
    d('complaint_rate', 'Complaint Rate', 'guests', 'Front Office', complaintRate, prevComplaintRate, '%', true),
    d('request_resolution', 'Request Resolution', 'guests', 'Concierge', greqRate, null, '%'),
    d('repeat_guests', 'Repeat Guests', 'guests', 'Front Office', repeatGuests, null, 'count'),
    d('loyalty_members', 'Loyalty Members', 'guests', 'CRM', loyaltyMembers, null, 'count'),
    d('total_guests', 'Guest Profiles', 'guests', 'PMS', guests.length, null, 'count'),

    // F&B
    d('fb_revenue', 'F&B Revenue', 'fb', 'F&B', fbRevenue, prevFbRevenue, 'currency'),
    d('fb_orders', 'Paid Orders', 'fb', 'F&B', paidCur.length, paidPrev.length, 'count'),
    d('avg_check', 'Average Check', 'fb', 'F&B', avgCheck, prevAvgCheck, 'currency'),
    d('food_cost', 'Food Cost %', 'fb', 'F&B', foodCostPct, null, '%', true),
    d('bev_cost', 'Beverage Cost %', 'fb', 'F&B', bevCostPct, null, '%', true),
    d('ticket_time', 'Avg Ticket Time', 'fb', 'Kitchen', ticketTime, null, 'min', true),

    // Workforce — HR
    d('headcount', 'Active Headcount', 'workforce', 'HR', activeEmployees, null, 'count'),
    d('labor_cost_pct', 'Labor Cost %', 'workforce', 'HR', laborCostPct, null, '%', true),
    d('attendance', 'Attendance Rate', 'workforce', 'HR', attRate, prevAttRate, '%'),
    d('turnover', 'Employee Turnover', 'workforce', 'HR', turnover, null, '%', true),
    d('overtime', 'Overtime Hours', 'workforce', 'HR', overtimeHrs, prevOvertimeHrs, 'hrs', true),
    d('rev_per_employee', 'Revenue per Employee', 'workforce', 'HR', revPerEmployee, null, 'currency'),

    // Engineering
    d('wo_completion', 'Work Order Completion', 'engineering', 'Engineering', woCompletion, prevWoCompletion, '%'),
    d('open_wos', 'Open Work Orders', 'engineering', 'Engineering', openWorkOrders, null, 'count', true),
    d('pm_compliance', 'PM Compliance', 'engineering', 'Engineering', pmCompliance, null, '%'),
    d('asset_availability', 'Asset Availability', 'engineering', 'Engineering', assetAvailability, null, '%'),
    d('electricity', 'Electricity Consumption', 'engineering', 'Engineering', electricityKwh, prevElectricityKwh, 'kWh', true),
    d('hk_completion', 'HK Task Completion', 'engineering', 'Housekeeping', hkCompletion, prevHkCompletion, '%'),

    // Procurement & Inventory
    d('po_spend', 'Purchase Spend', 'procurement', 'Procurement', poSpend, prevPoSpend, 'currency', true),
    d('open_pos', 'Open Purchase Orders', 'procurement', 'Procurement', openPos, null, 'count', true),
    d('suppliers', 'Active Suppliers', 'procurement', 'Procurement', activeSuppliers, null, 'count'),
    d('stock_value', 'Inventory Stock Value', 'procurement', 'Inventory', stockValue, null, 'currency'),
    d('low_stock', 'Low Stock Items', 'procurement', 'Inventory', lowStock, null, 'count', true),

    // Security
    d('incidents', 'Security Incidents', 'security', 'Security', incCur.length, incPrev.length, 'count', true),
    d('open_incidents', 'Open Incidents', 'security', 'Security', openIncidents, null, 'count', true),
    d('inc_resolution', 'Incident Resolution', 'security', 'Security', incResolution, prevIncResolution, '%'),

    // Leisure & Events — Banquets / Spa / Transport
    d('banquet_revenue', 'Event Revenue', 'leisure', 'Banquets', banquetRev, prevBanquetRev, 'currency'),
    d('upcoming_events', 'Upcoming Events', 'leisure', 'Banquets', upcomingEvents, null, 'count'),
    d('spa_revenue', 'Spa Revenue', 'leisure', 'Spa', spaRev, prevSpaRev, 'currency'),
    d('spa_appointments', 'Spa Appointments', 'leisure', 'Spa', spaCur.length, spaPrev.length, 'count'),
    d('trips_completed', 'Trips Completed', 'leisure', 'Transportation', tripsDone, prevTripsDone, 'count'),
  ];

  await applyConfiguredTargets(kpis);

  const result = { propertyId: propertyId || null, days: daysCount, generatedAt, kpis };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json({ ...result, view });
});

// ── Operational Intelligence ────────────────────────────────────────────
// GET /api/executive/operational-intelligence?days=30&propertyId=...
// Per-department operational metrics computed from each portal's real
// tables: Front Office, Housekeeping (incl. Laundry), F&B + Kitchen,
// Engineering, Security, Transportation, Concierge, Banquet & Events,
// Staffing, and the Operations command tables. Departments with no data
// source (e.g. Spa & Wellness) return hasData=false instead of mock values.

interface OpsMetric {
  metric: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

interface OpsDepartment {
  name: string;
  hasData: boolean;
  metrics: OpsMetric[];
}

router.get('/operational-intelligence', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-ops-intel:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [
    rooms, reservations, guestRequests, hkTasks, orders, kitchenAnalytics,
    workOrders, pmSchedules, fixedAssets, secIncidents, laundryJobs,
    transportRequests, transportTrips, transportVehicles, banquetEvents,
    opsEscalations, opsAlerts, opsCrossTasks, staffAttendance, employees,
  ] = await Promise.all([
    kpiFetchRows(eqProp(supabaseAdmin!.from('rooms')
      .select('id, status, property_id')), 'rooms'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, check_out_date, status, rate, created_at, property_id')
      .or(`check_out_date.gte.${windowStart},created_at.gte.${windowStart}`)), 'reservations'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('id, status, submitted_at, completed_at, assigned_department, property_id')
      .gte('submitted_at', prevStart.toISOString())), 'guest_requests'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
      .select('id, status, created_at, completed_at, actual_duration, property_id')
      .gte('created_at', prevStart.toISOString())), 'housekeeping_task_mgmt'),
    kpiFetchRows(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, created_at')
      .gte('created_at', prevStart.toISOString()), 'orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fb_kitchen_analytics')
      .select('station, avg_ticket_time_min, accuracy, downtime_min, period, property_id')
      .eq('period', 'Today')), 'fb_kitchen_analytics'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, status, created_date, completed_at, property_id')
      .gte('created_date', prevStart.toISOString())), 'work_orders'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('pm_schedules')
      .select('id, status, next_due_date, property_id')), 'pm_schedules'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fixed_assets')
      .select('id, status, property_id')), 'fixed_assets'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
      .select('id, status, reported_at, updated_at, property_id')
      .gte('reported_at', prevStart.toISOString())), 'sec_incidents'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('hk_laundry_jobs')
      .select('id, status, pieces, created_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'hk_laundry_jobs'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('transport_requests')
      .select('id, status, scheduled_time, created_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'transport_requests'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('transport_trips')
      .select('id, status, scheduled_at, actual_at, property_id')
      .gte('scheduled_at', prevStart.toISOString())), 'transport_trips'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('transport_vehicles')
      .select('id, status, property_id')), 'transport_vehicles'),
    kpiFetchRows(supabaseAdmin!.from('banquet_events')
      .select('id, status, event_date, guest_count, actual_revenue')
      .gte('event_date', windowStart), 'banquet_events'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_escalations')
      .select('id, status, created_at, resolved_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'ops_escalations'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_command_alerts')
      .select('id, status, severity, property_id')), 'ops_command_alerts'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_cross_dept_tasks')
      .select('id, status, property_id')), 'ops_cross_dept_tasks'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('staff_attendance')
      .select('id, status, attendance_date, overtime_hours, property_id')
      .gte('attendance_date', windowStart)), 'staff_attendance'),
    kpiFetchRows(supabaseAdmin!.from('employees')
      .select('id, status'), 'employees'),
  ]);

  const metric = (
    name: string, value: number, previousValue: number | null,
    target: number, threshold: number, unit: string, lowerIsBetter = false,
  ): OpsMetric => {
    const v = Math.round(value * 100) / 100;
    return {
      metric: name,
      value: v,
      previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
      target, threshold, unit, lowerIsBetter,
      trend: kpiTrend(v, previousValue),
      status: kpiStatus(v, target, threshold, lowerIsBetter),
    };
  };

  const departments: OpsDepartment[] = [];

  // ── Front Office ────────────────────────────────────────────────────
  const RES_ACTIVE = new Set(['Confirmed', 'CheckedIn', 'CheckedOut', 'Waitlisted']);
  const resActive = reservations.filter(r => RES_ACTIVE.has(r.status));
  const checkinsCur = resActive.filter(r => inWindow(r.check_in_date, curStart, now)).length;
  const checkinsPrev = resActive.filter(r => inWindow(r.check_in_date, prevStart, prevEnd)).length;
  const checkoutsCur = resActive.filter(r => inWindow(r.check_out_date, curStart, now)).length;
  const checkoutsPrev = resActive.filter(r => inWindow(r.check_out_date, prevStart, prevEnd)).length;

  const totalRooms = rooms.length;
  const roomNightsIn = (start: Date, end: Date) =>
    resActive.reduce((sum, r) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      return sum + Math.max(0, (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000);
    }, 0);
  const roomDenominator = totalRooms * daysCount;
  const occupancy = roomDenominator > 0 ? (roomNightsIn(curStart, now) / roomDenominator) * 100 : 0;
  const prevOccupancy = roomDenominator > 0 ? (roomNightsIn(prevStart, prevEnd) / roomDenominator) * 100 : 0;

  const greqDone = new Set(['completed', 'closed', 'resolved', 'Completed', 'Closed', 'Resolved']);
  const isGreqDone = (g: any) => greqDone.has(g.status) || !!g.completed_at;
  const greqCur = guestRequests.filter(g => inWindow(g.submitted_at, curStart, now));
  const greqPrev = guestRequests.filter(g => inWindow(g.submitted_at, prevStart, prevEnd));
  const greqRes = greqCur.length > 0 ? (greqCur.filter(isGreqDone).length / greqCur.length) * 100 : 0;
  const prevGreqRes = greqPrev.length > 0 ? (greqPrev.filter(isGreqDone).length / greqPrev.length) * 100 : 0;

  departments.push({
    name: 'Front Office', hasData: true,
    metrics: [
      metric('Check-ins', checkinsCur, checkinsPrev, 0, 0, 'count'),
      metric('Check-outs', checkoutsCur, checkoutsPrev, 0, 0, 'count'),
      metric('Occupancy Rate', occupancy, prevOccupancy, 75, 60, '%'),
      metric('Guest Request Resolution', greqRes, prevGreqRes, 90, 75, '%'),
    ],
  });

  // ── Housekeeping ────────────────────────────────────────────────────
  const HK_CLOSED = new Set(['Completed', 'Verified']);
  const hkCur = hkTasks.filter(t => inWindow(t.created_at, curStart, now));
  const hkPrev = hkTasks.filter(t => inWindow(t.created_at, prevStart, prevEnd));
  const hkCompletion = hkCur.length > 0 ? (hkCur.filter(t => HK_CLOSED.has(t.status)).length / hkCur.length) * 100 : 0;
  const prevHkCompletion = hkPrev.length > 0 ? (hkPrev.filter(t => HK_CLOSED.has(t.status)).length / hkPrev.length) * 100 : 0;
  const hkDoneCur = hkCur.filter(t => HK_CLOSED.has(t.status));
  const durations = hkDoneCur.map(t => Number(t.actual_duration)).filter(d => d > 0);
  const avgTurnaround = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const hkDonePrev = hkPrev.filter(t => HK_CLOSED.has(t.status));
  const prevDurations = hkDonePrev.map(t => Number(t.actual_duration)).filter(d => d > 0);
  const prevAvgTurnaround = prevDurations.length > 0 ? prevDurations.reduce((s, d) => s + d, 0) / prevDurations.length : null;
  const ROOM_READY = new Set(['Vacant Clean', 'Inspected', 'Occupied']);
  const roomReadiness = totalRooms > 0 ? (rooms.filter(r => ROOM_READY.has(r.status)).length / totalRooms) * 100 : 0;
  const openHkTasks = hkTasks.filter(t => !HK_CLOSED.has(t.status)).length;

  departments.push({
    name: 'Housekeeping', hasData: true,
    metrics: [
      metric('Task Completion', hkCompletion, prevHkCompletion, 90, 75, '%'),
      metric('Avg Turnaround', avgTurnaround, prevAvgTurnaround, 30, 45, 'min', true),
      metric('Room Readiness', roomReadiness, null, 90, 70, '%'),
      metric('Open Tasks', openHkTasks, null, 15, 40, 'count', true),
    ],
  });

  // ── Food & Beverage ─────────────────────────────────────────────────
  const paidCur = orders.filter(o => o.status === 'Paid' && inWindow(o.created_at, curStart, now));
  const paidPrev = orders.filter(o => o.status === 'Paid' && inWindow(o.created_at, prevStart, prevEnd));
  const fbRevenue = paidCur.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const prevFbRevenue = paidPrev.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const ordersPerDay = paidCur.length / daysCount;
  const prevOrdersPerDay = paidPrev.length / daysCount;
  const avgCheck = paidCur.length > 0 ? fbRevenue / paidCur.length : 0;
  const prevAvgCheck = paidPrev.length > 0 ? prevFbRevenue / paidPrev.length : 0;

  departments.push({
    name: 'Food & Beverage', hasData: true,
    metrics: [
      metric('Orders / Day', ordersPerDay, prevOrdersPerDay, 0, 0, 'count'),
      metric('Paid Orders', paidCur.length, paidPrev.length, 0, 0, 'count'),
      metric('Average Check', avgCheck, prevAvgCheck, 0, 0, 'currency'),
      metric('F&B Revenue', fbRevenue, prevFbRevenue, 0, 0, 'currency'),
    ],
  });

  // ── Kitchen ─────────────────────────────────────────────────────────
  const kaRows = kitchenAnalytics;
  const avgTicket = kaRows.length > 0 ? kaRows.reduce((s, k) => s + (Number(k.avg_ticket_time_min) || 0), 0) / kaRows.length : 0;
  const avgAccuracy = kaRows.length > 0 ? kaRows.reduce((s, k) => s + (Number(k.accuracy) || 0), 0) / kaRows.length : 0;
  const totalDowntime = kaRows.reduce((s, k) => s + (Number(k.downtime_min) || 0), 0);

  departments.push({
    name: 'Kitchen', hasData: kaRows.length > 0,
    metrics: [
      metric('Avg Ticket Time', avgTicket, null, 15, 20, 'min', true),
      metric('Order Accuracy', avgAccuracy, null, 95, 85, '%'),
      metric('Station Downtime', totalDowntime, null, 30, 90, 'min', true),
    ],
  });

  // ── Engineering ─────────────────────────────────────────────────────
  const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
  const woCur = workOrders.filter(w => inWindow(w.created_date, curStart, now));
  const woPrev = workOrders.filter(w => inWindow(w.created_date, prevStart, prevEnd));
  const woCompletion = woCur.length > 0 ? (woCur.filter(w => WO_CLOSED.has(w.status)).length / woCur.length) * 100 : 0;
  const prevWoCompletion = woPrev.length > 0 ? (woPrev.filter(w => WO_CLOSED.has(w.status)).length / woPrev.length) * 100 : 0;
  const woHours = (w: any) => {
    const a = new Date(w.created_date).getTime();
    const b = new Date(w.completed_at).getTime();
    return isNaN(a) || isNaN(b) ? 0 : Math.max(0, (b - a) / 3600000);
  };
  const woDoneCur = woCur.filter(w => WO_CLOSED.has(w.status) && w.completed_at);
  const avgWoResolution = woDoneCur.length > 0 ? woDoneCur.reduce((s, w) => s + woHours(w), 0) / woDoneCur.length : 0;
  const woDonePrev = woPrev.filter(w => WO_CLOSED.has(w.status) && w.completed_at);
  const prevAvgWoResolution = woDonePrev.length > 0 ? woDonePrev.reduce((s, w) => s + woHours(w), 0) / woDonePrev.length : null;
  const activePm = pmSchedules.filter(p => p.status === 'Active');
  const pmDue = activePm.filter(p => p.next_due_date && p.next_due_date < dayStr(now));
  const pmCompliance = activePm.length > 0 ? ((activePm.length - pmDue.length) / activePm.length) * 100 : 0;
  const liveAssets = fixedAssets.filter(a => a.status !== 'Disposed' && a.status !== 'Written Off');
  const assetAvailability = liveAssets.length > 0
    ? (liveAssets.filter(a => a.status === 'Active').length / liveAssets.length) * 100 : 0;

  departments.push({
    name: 'Engineering', hasData: true,
    metrics: [
      metric('Work Order Completion', woCompletion, prevWoCompletion, 85, 65, '%'),
      metric('Avg Resolution', avgWoResolution, prevAvgWoResolution, 24, 72, 'hrs', true),
      metric('PM Compliance', pmCompliance, null, 90, 75, '%'),
      metric('Asset Availability', assetAvailability, null, 92, 80, '%'),
    ],
  });

  // ── Security ────────────────────────────────────────────────────────
  const SEC_CLOSED = new Set(['Resolved', 'Closed']);
  const isSecClosed = (i: any) => SEC_CLOSED.has(i.status);
  const incCur = secIncidents.filter(i => inWindow(i.reported_at, curStart, now));
  const incPrev = secIncidents.filter(i => inWindow(i.reported_at, prevStart, prevEnd));
  const incPerDay = incCur.length / daysCount;
  const prevIncPerDay = incPrev.length / daysCount;
  const incRes = incCur.length > 0 ? (incCur.filter(isSecClosed).length / incCur.length) * 100 : 0;
  const prevIncRes = incPrev.length > 0 ? (incPrev.filter(isSecClosed).length / incPrev.length) * 100 : 0;
  // sec_incidents has no resolved_at; updated_at approximates resolution time
  // for incidents that reached a closed status.
  const incHours = (i: any) => {
    const a = new Date(i.reported_at).getTime();
    const b = new Date(i.updated_at).getTime();
    return isNaN(a) || isNaN(b) ? 0 : Math.max(0, (b - a) / 3600000);
  };
  const incDoneCur = incCur.filter(i => isSecClosed(i));
  const avgIncResponse = incDoneCur.length > 0 ? incDoneCur.reduce((s, i) => s + incHours(i), 0) / incDoneCur.length : 0;
  const openIncidents = secIncidents.filter(i => !isSecClosed(i)).length;

  departments.push({
    name: 'Security', hasData: true,
    metrics: [
      metric('Incidents / Day', incPerDay, prevIncPerDay, 0.5, 1.5, '/day', true),
      metric('Incident Resolution', incRes, prevIncRes, 85, 65, '%'),
      metric('Avg Response', avgIncResponse, null, 4, 24, 'hrs', true),
      metric('Open Incidents', openIncidents, null, 3, 10, 'count', true),
    ],
  });

  // ── Laundry ─────────────────────────────────────────────────────────
  const launCur = laundryJobs.filter(j => inWindow(j.created_at, curStart, now));
  const launPrev = laundryJobs.filter(j => inWindow(j.created_at, prevStart, prevEnd));
  const launCompletion = launCur.length > 0 ? (launCur.filter(j => j.status === 'Delivered').length / launCur.length) * 100 : 0;
  const prevLaunCompletion = launPrev.length > 0 ? (launPrev.filter(j => j.status === 'Delivered').length / launPrev.length) * 100 : 0;
  const piecesProcessed = launCur.reduce((s, j) => s + (Number(j.pieces) || 0), 0);
  const prevPiecesProcessed = launPrev.reduce((s, j) => s + (Number(j.pieces) || 0), 0);
  const activeJobs = laundryJobs.filter(j => !['Delivered', 'Collected'].includes(j.status)).length;

  departments.push({
    name: 'Laundry', hasData: true,
    metrics: [
      metric('Job Completion', launCompletion, prevLaunCompletion, 90, 75, '%'),
      metric('Pieces Processed', piecesProcessed, prevPiecesProcessed, 0, 0, 'count'),
      metric('Active Jobs', activeJobs, null, 10, 30, 'count', true),
    ],
  });

  // ── Transportation ──────────────────────────────────────────────────
  const TRIP_DONE = new Set(['Completed']);
  const TRIP_DEAD = new Set(['Cancelled', 'No Show']);
  const treqCur = transportRequests.filter(t => inWindow(t.created_at, curStart, now));
  const treqPrev = transportRequests.filter(t => inWindow(t.created_at, prevStart, prevEnd));
  const treqRes = (rows: any[]) => {
    const valid = rows.filter(t => !TRIP_DEAD.has(t.status));
    return valid.length > 0 ? (valid.filter(t => TRIP_DONE.has(t.status)).length / valid.length) * 100 : 0;
  };
  const tripsCur = transportTrips.filter(t => inWindow(t.scheduled_at, curStart, now));
  const tripsPrev = transportTrips.filter(t => inWindow(t.scheduled_at, prevStart, prevEnd));
  const onTime = (rows: any[]) => {
    const done = rows.filter(t => TRIP_DONE.has(t.status) && t.actual_at && t.scheduled_at);
    if (done.length === 0) return 0;
    const ok = done.filter(t => new Date(t.actual_at).getTime() <= new Date(t.scheduled_at).getTime() + 15 * 60000);
    return (ok.length / done.length) * 100;
  };
  const activeVehicles = transportVehicles.filter(v => v.status === 'Active').length;
  const fleetAvailability = transportVehicles.length > 0 ? (activeVehicles / transportVehicles.length) * 100 : 0;

  departments.push({
    name: 'Transportation', hasData: true,
    metrics: [
      metric('Request Completion', treqRes(treqCur), treqRes(treqPrev), 90, 75, '%'),
      metric('On-time Trips', onTime(tripsCur), onTime(tripsPrev), 90, 75, '%'),
      metric('Trips Completed', tripsCur.filter(t => TRIP_DONE.has(t.status)).length,
        tripsPrev.filter(t => TRIP_DONE.has(t.status)).length, 0, 0, 'count'),
      metric('Fleet Availability', fleetAvailability, null, 90, 75, '%'),
    ],
  });

  // ── Concierge ───────────────────────────────────────────────────────
  const concCur = greqCur.filter(g => g.assigned_department === 'Concierge');
  const concPrev = greqPrev.filter(g => g.assigned_department === 'Concierge');
  const concRes = concCur.length > 0 ? (concCur.filter(isGreqDone).length / concCur.length) * 100 : 0;
  const prevConcRes = concPrev.length > 0 ? (concPrev.filter(isGreqDone).length / concPrev.length) * 100 : 0;
  const concHours = (g: any) => {
    const a = new Date(g.submitted_at).getTime();
    const b = new Date(g.completed_at).getTime();
    return isNaN(a) || isNaN(b) ? 0 : Math.max(0, (b - a) / 3600000);
  };
  const concDone = concCur.filter(g => isGreqDone(g) && g.completed_at);
  const avgConcResolution = concDone.length > 0 ? concDone.reduce((s, g) => s + concHours(g), 0) / concDone.length : 0;

  departments.push({
    name: 'Concierge', hasData: true,
    metrics: [
      metric('Requests Handled', concCur.length, concPrev.length, 0, 0, 'count'),
      metric('Resolution Rate', concRes, prevConcRes, 90, 75, '%'),
      metric('Avg Resolution', avgConcResolution, null, 4, 24, 'hrs', true),
    ],
  });

  // ── Banquet & Events ────────────────────────────────────────────────
  const EVENT_LIVE = new Set(['Confirmed', 'InProgress', 'Completed']);
  const evCur = banquetEvents.filter(e => inWindow(e.event_date, curStart, now));
  const evPrev = banquetEvents.filter(e => inWindow(e.event_date, prevStart, prevEnd));
  const evRevenue = evCur.reduce((s, e) => s + (Number(e.actual_revenue) || 0), 0);
  const prevEvRevenue = evPrev.reduce((s, e) => s + (Number(e.actual_revenue) || 0), 0);
  const evGuests = evCur.reduce((s, e) => s + (Number(e.guest_count) || 0), 0);
  const prevEvGuests = evPrev.reduce((s, e) => s + (Number(e.guest_count) || 0), 0);

  departments.push({
    name: 'Banquet & Events', hasData: true,
    metrics: [
      metric('Events', evCur.length, evPrev.length, 0, 0, 'count'),
      metric('Confirmed Events', evCur.filter(e => EVENT_LIVE.has(e.status)).length,
        evPrev.filter(e => EVENT_LIVE.has(e.status)).length, 0, 0, 'count'),
      metric('Event Revenue', evRevenue, prevEvRevenue, 0, 0, 'currency'),
      metric('Guests Served', evGuests, prevEvGuests, 0, 0, 'count'),
    ],
  });

  // ── Staffing ────────────────────────────────────────────────────────
  const attCur = staffAttendance.filter(a => inWindow(a.attendance_date, curStart, now));
  const attPrev = staffAttendance.filter(a => inWindow(a.attendance_date, prevStart, prevEnd));
  const ATT_OK = new Set(['Present', 'Late', 'Half Day']);
  const attendanceRate = attCur.length > 0 ? (attCur.filter(a => ATT_OK.has(a.status)).length / attCur.length) * 100 : 0;
  const prevAttendanceRate = attPrev.length > 0 ? (attPrev.filter(a => ATT_OK.has(a.status)).length / attPrev.length) * 100 : 0;
  const overtimeHours = attCur.reduce((s, a) => s + (Number(a.overtime_hours) || 0), 0);
  const prevOvertimeHours = attPrev.reduce((s, a) => s + (Number(a.overtime_hours) || 0), 0);
  const activeEmployees = employees.filter(e => e.status === 'Active').length;

  departments.push({
    name: 'Staffing', hasData: true,
    metrics: [
      metric('Attendance Rate', attendanceRate, prevAttendanceRate, 92, 80, '%'),
      metric('Overtime Hours', overtimeHours, prevOvertimeHours, 100, 250, 'hrs', true),
      metric('Active Headcount', activeEmployees, null, 0, 0, 'count'),
    ],
  });

  // ── Operations Command ──────────────────────────────────────────────
  const escCur = opsEscalations.filter(e => inWindow(e.created_at, curStart, now));
  const escPrev = opsEscalations.filter(e => inWindow(e.created_at, prevStart, prevEnd));
  const openEscalations = opsEscalations.filter(e => e.status !== 'resolved').length;
  const escRes = escCur.length > 0 ? (escCur.filter(e => e.status === 'resolved').length / escCur.length) * 100 : 0;
  const prevEscRes = escPrev.length > 0 ? (escPrev.filter(e => e.status === 'resolved').length / escPrev.length) * 100 : 0;
  const activeAlerts = opsAlerts.filter(a => a.status === 'Active').length;
  const activeCrossTasks = opsCrossTasks.filter(t => ['planning', 'in-progress'].includes(t.status)).length;

  departments.push({
    name: 'Operations Command', hasData: true,
    metrics: [
      metric('Open Escalations', openEscalations, null, 3, 10, 'count', true),
      metric('Escalation Resolution', escRes, prevEscRes, 85, 65, '%'),
      metric('Active Alerts', activeAlerts, null, 5, 15, 'count', true),
      metric('Active Cross-Dept Tasks', activeCrossTasks, null, 0, 0, 'count'),
    ],
  });

  // ── Spa & Wellness — no operational tables yet ──────────────────────
  departments.push({ name: 'Spa & Wellness', hasData: false, metrics: [] });

  for (const d of departments) await applyConfiguredTargets(d.metrics);

  const result = {
    propertyId: propertyId || null,
    days: daysCount,
    generatedAt: now.toISOString(),
    departments,
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Financial Intelligence ──────────────────────────────────────────────
// GET /api/executive/financial-intelligence?days=30&propertyId=...
// Real P&L, balance-sheet, cash-flow, budget, cost-center and ratio metrics
// computed from journal_entries (lines JSONB), usali_chart_of_accounts,
// bank_accounts, ap_bills, ar_ledger, fixed_assets, uinv stock and the
// operational revenue tables (reservations, orders, banquet_events).

type FinCategory = 'pnl' | 'balance' | 'cashflow' | 'budget' | 'costcenters' | 'ratios';

interface FinMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold?: number;
  unit: string;
  category: FinCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

interface FinDeptProfit {
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
}

interface FinExpenseTrend {
  name: string;
  value: number;
  previousValue: number;
  change: number | null;
}

// USALI-style account code → type when the chart row is missing.
function accountTypeFromCode(code: string): string {
  const n = parseInt(code, 10);
  if (n >= 1000 && n < 2000) return 'Asset';
  if (n >= 2000 && n < 3000) return 'Liability';
  if (n >= 3000 && n < 4000) return 'Equity';
  if (n >= 4000 && n < 5000) return 'Revenue';
  if (n >= 5000) return 'Expense';
  return 'Other';
}

router.get('/financial-intelligence', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-fin-intel:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [
    journalEntries, chartOfAccounts, bankAccounts, apBills, arLedger,
    fixedAssets, laborBudgets, uinvBalances, reservations, orders,
    banquetEvents,
  ] = await Promise.all([
    kpiFetchRows(eqProp(supabaseAdmin!.from('journal_entries')
      .select('id, entry_date, status, department, source, lines, property_id')
      .gte('entry_date', windowStart)), 'journal_entries'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('usali_chart_of_accounts')
      .select('code, name, account_type, category, subcategory, department, balance, property_id')), 'usali_chart_of_accounts'),
    kpiFetchRows(supabaseAdmin!.from('bank_accounts')
      .select('id, account_name, current_balance, is_active'), 'bank_accounts'),
    kpiFetchRows(supabaseAdmin!.from('ap_bills')
      .select('id, status, amount_due, net_payable, amount, total_amount'), 'ap_bills'),
    kpiFetchRows(supabaseAdmin!.from('ar_ledger')
      .select('id, debit_amount, credit_amount, is_reconciled, posting_date'), 'ar_ledger'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fixed_assets')
      .select('id, net_book_value, purchase_cost, status, property_id')), 'fixed_assets'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_department_labor_budget')
      .select('department, fiscal_year, month, budget_amount, actual_spent, property_id')), 'ops_department_labor_budget'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('uinv_stock_balances')
      .select('item_id, on_hand, unit_cost, property_id')), 'uinv_stock_balances'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, check_out_date, status, rate, created_at, property_id')
      .or(`check_out_date.gte.${windowStart},created_at.gte.${windowStart}`)), 'reservations'),
    kpiFetchRows(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, created_at')
      .gte('created_at', prevStart.toISOString()), 'orders'),
    kpiFetchRows(supabaseAdmin!.from('banquet_events')
      .select('id, status, event_date, actual_revenue')
      .gte('event_date', windowStart), 'banquet_events'),
  ]);

  // ── Journal lines → typed postings ────────────────────────────────────
  const coaByCode = new Map<string, any>(chartOfAccounts.map(a => [String(a.code), a]));

  interface Posting {
    date: Date;
    type: string;
    dept: string;
    isCash: boolean;
    debit: number;
    credit: number;
  }

  const postings: Posting[] = [];
  for (const e of journalEntries) {
    if (e.status === 'Reversed') continue;
    const entryDate = new Date(e.entry_date);
    if (isNaN(entryDate.getTime())) continue;
    const lines: any[] = Array.isArray(e.lines)
      ? e.lines
      : (typeof e.lines === 'string' ? JSON.parse(e.lines || '[]') : []);
    for (const l of lines) {
      const code = String(l.accountId || l.account_id || l.accountCode || l.account_code || '');
      const acc = coaByCode.get(code);
      const type = acc?.account_type || accountTypeFromCode(code);
      const name = String(l.accountName || acc?.name || '');
      const isCash = acc?.subcategory === 'Cash' || /cash|bank/i.test(name) || code.startsWith('10');
      postings.push({
        date: entryDate,
        type,
        dept: e.department || acc?.department || 'Unallocated',
        isCash,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      });
    }
  }

  const inCur = (p: Posting) => p.date >= curStart && p.date < now;
  const inPrev = (p: Posting) => p.date >= prevStart && p.date < prevEnd;

  const sumBy = (rows: Posting[], type: string) =>
    rows.filter(p => p.type === type)
      .reduce((s, p) => s + (type === 'Revenue' || type === 'Liability' || type === 'Equity'
        ? p.credit - p.debit : p.debit - p.credit), 0);

  const curPostings = postings.filter(inCur);
  const prevPostings = postings.filter(inPrev);

  // ── Operational revenue (fallback + dept split) ───────────────────────
  const RES_ACTIVE = new Set(['Confirmed', 'CheckedIn', 'CheckedOut', 'Waitlisted']);
  const resActive = reservations.filter(r => RES_ACTIVE.has(r.status));
  const roomRevIn = (start: Date, end: Date) =>
    resActive.reduce((sum, r) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      const nights = Math.max(0, (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000);
      return sum + nights * (Number(r.rate) || 0);
    }, 0);
  const roomRevCur = roomRevIn(curStart, now);
  const roomRevPrev = roomRevIn(prevStart, prevEnd);

  const fbRevIn = (start: Date, end: Date) =>
    orders.filter(o => o.status === 'Paid' && inWindow(o.created_at, start, end))
      .reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const fbRevCur = fbRevIn(curStart, now);
  const fbRevPrev = fbRevIn(prevStart, prevEnd);

  const evRevIn = (start: Date, end: Date) =>
    banquetEvents.filter(e => inWindow(e.event_date, start, end))
      .reduce((s, e) => s + (Number(e.actual_revenue) || 0), 0);
  const evRevCur = evRevIn(curStart, now);
  const evRevPrev = evRevIn(prevStart, prevEnd);

  const journalRevenue = sumBy(curPostings, 'Revenue');
  const prevJournalRevenue = sumBy(prevPostings, 'Revenue');
  const journalExpenses = sumBy(curPostings, 'Expense');
  const prevJournalExpenses = sumBy(prevPostings, 'Expense');
  const opsRevenue = roomRevCur + fbRevCur + evRevCur;
  const prevOpsRevenue = roomRevPrev + fbRevPrev + evRevPrev;

  // Prefer the general ledger; fall back to operational revenue only when
  // no revenue has been posted to GL for the period.
  const totalRevenue = journalRevenue > 0 ? journalRevenue : opsRevenue;
  const prevTotalRevenue = prevJournalRevenue > 0 ? prevJournalRevenue : prevOpsRevenue;
  const totalExpenses = journalExpenses;
  const prevTotalExpenses = prevJournalExpenses;
  const netProfit = totalRevenue - totalExpenses;
  const prevNetProfit = prevTotalRevenue - prevTotalExpenses;
  const operatingMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const prevOperatingMargin = prevTotalRevenue > 0 ? (prevNetProfit / prevTotalRevenue) * 100 : 0;

  // Departmental (direct) expenses = lines whose department is set.
  const directExpenses = curPostings
    .filter(p => p.type === 'Expense' && p.dept !== 'Unallocated')
    .reduce((s, p) => s + p.debit - p.credit, 0);
  const grossProfit = totalRevenue - directExpenses;
  const prevDirectExpenses = prevPostings
    .filter(p => p.type === 'Expense' && p.dept !== 'Unallocated')
    .reduce((s, p) => s + p.debit - p.credit, 0);
  const prevGrossProfit = prevTotalRevenue - prevDirectExpenses;

  // ── Balance sheet ─────────────────────────────────────────────────────
  const chartSum = (type: string) =>
    chartOfAccounts.filter(a => a.account_type === type)
      .reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const cashPosition = bankAccounts
    .filter(b => b.is_active !== false)
    .reduce((s, b) => s + (Number(b.current_balance) || 0), 0);
  // Live ap_bills schemas vary across deployments — use whichever
  // outstanding-amount column exists.
  const billDue = (b: any) =>
    Number(b.amount_due ?? b.net_payable ?? b.amount ?? b.total_amount ?? 0) || 0;
  const apOutstanding = apBills
    .filter(b => !['Paid', 'Voided'].includes(b.status))
    .reduce((s, b) => s + billDue(b), 0);
  const arOutstanding = arLedger
    .filter(l => !l.is_reconciled)
    .reduce((s, l) => s + (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0), 0);
  const inventoryValue = uinvBalances
    .reduce((s, b) => s + (Number(b.on_hand) || 0) * (Number(b.unit_cost) || 0), 0);
  const fixedAssetNbv = fixedAssets
    .filter(a => a.status !== 'Disposed' && a.status !== 'Written Off')
    .reduce((s, a) => s + (Number(a.net_book_value) || 0), 0);

  const chartAssets = Math.abs(chartSum('Asset'));
  const chartLiabilities = Math.abs(chartSum('Liability'));
  const chartEquity = Math.abs(chartSum('Equity'));
  const computedAssets = cashPosition + Math.max(0, arOutstanding) + inventoryValue + fixedAssetNbv;
  const totalAssets = chartAssets > 0 ? chartAssets : computedAssets;
  const totalLiabilities = chartLiabilities > 0 ? chartLiabilities : apOutstanding;
  const equity = chartEquity > 0 ? chartEquity : totalAssets - totalLiabilities;
  const currentAssets = cashPosition + Math.max(0, arOutstanding) + inventoryValue;
  const currentLiabilities = apOutstanding;
  const workingCapital = currentAssets - currentLiabilities;

  // ── Cash flow (movement on cash/bank accounts in the window) ──────────
  const cashIn = (rows: Posting[]) => rows.filter(p => p.isCash).reduce((s, p) => s + p.debit, 0);
  const cashOut = (rows: Posting[]) => rows.filter(p => p.isCash).reduce((s, p) => s + p.credit, 0);
  const cashCollected = cashIn(curPostings);
  const prevCashCollected = cashIn(prevPostings);
  const cashDisbursed = cashOut(curPostings);
  const prevCashDisbursed = cashOut(prevPostings);
  const netCashMovement = cashCollected - cashDisbursed;
  const prevNetCashMovement = prevCashCollected - prevCashDisbursed;

  // ── Budget (labor budgets) + period variance ──────────────────────────
  const budgetTotal = laborBudgets.reduce((s, b) => s + (Number(b.budget_amount) || 0), 0);
  const budgetSpent = laborBudgets.reduce((s, b) => s + (Number(b.actual_spent) || 0), 0);
  const laborBudgetUsed = budgetTotal > 0 ? (budgetSpent / budgetTotal) * 100 : 0;
  const revenueVariance = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 : 0;
  const expenseVariance = prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : 0;

  // ── Ratios ────────────────────────────────────────────────────────────
  // With zero current liabilities, coverage is effectively unlimited —
  // report 99x rather than a misleading 0 that reads as insolvency.
  const noLiab = currentLiabilities <= 0;
  const currentRatio = noLiab ? (currentAssets > 0 ? 99 : 0) : currentAssets / currentLiabilities;
  const quickRatio = noLiab ? (cashPosition + Math.max(0, arOutstanding) > 0 ? 99 : 0)
    : (cashPosition + Math.max(0, arOutstanding)) / currentLiabilities;
  const debtToEquity = equity > 0 ? totalLiabilities / equity : 0;
  const roa = totalAssets > 0 ? (netProfit / totalAssets) * 100 : 0;
  const prevRoa = totalAssets > 0 ? (prevNetProfit / totalAssets) * 100 : 0;

  const fin = (
    id: string, name: string, value: number, previousValue: number | null,
    target: number, unit: string, category: FinCategory, lowerIsBetter = false,
  ): FinMetric => {
    const v = Math.round(value * 100) / 100;
    return {
      id, name, value: v,
      previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
      target, unit, category, lowerIsBetter,
      trend: kpiTrend(v, previousValue),
      status: target === 0 ? 'on-track' : kpiStatus(v, target, target * 0.75, lowerIsBetter),
    };
  };

  const metrics: FinMetric[] = [
    // P&L
    fin('total_revenue', 'Total Revenue', totalRevenue, prevTotalRevenue, 0, 'currency', 'pnl'),
    fin('gross_profit', 'Gross Profit', grossProfit, prevGrossProfit, 0, 'currency', 'pnl'),
    fin('net_profit', 'Net Profit', netProfit, prevNetProfit, 0, 'currency', 'pnl'),
    fin('total_expenses', 'Total Expenses', totalExpenses, prevTotalExpenses, 0, 'currency', 'pnl', true),
    fin('operating_margin', 'Operating Margin', operatingMargin, prevOperatingMargin, 30, '%', 'pnl'),
    // Balance sheet
    fin('total_assets', 'Total Assets', totalAssets, null, 0, 'currency', 'balance'),
    fin('total_liabilities', 'Total Liabilities', totalLiabilities, null, 0, 'currency', 'balance'),
    fin('equity', 'Shareholder Equity', equity, null, 0, 'currency', 'balance'),
    fin('working_capital', 'Working Capital', workingCapital, null, 0, 'currency', 'balance'),
    fin('cash_position', 'Cash Position', cashPosition, null, 0, 'currency', 'balance'),
    fin('ar_outstanding', 'AR Outstanding', arOutstanding, null, 0, 'currency', 'balance', true),
    fin('ap_outstanding', 'AP Outstanding', apOutstanding, null, 0, 'currency', 'balance', true),
    // Cash flow
    fin('cash_collected', 'Cash Collected', cashCollected, prevCashCollected, 0, 'currency', 'cashflow'),
    fin('cash_disbursed', 'Cash Disbursed', cashDisbursed, prevCashDisbursed, 0, 'currency', 'cashflow', true),
    fin('net_cash_movement', 'Net Cash Movement', netCashMovement, prevNetCashMovement, 0, 'currency', 'cashflow'),
    fin('operating_cash_flow', 'Operating Cash Flow', netProfit, prevNetProfit, 0, 'currency', 'cashflow'),
    // Budget & variance
    fin('revenue_variance', 'Revenue vs Prev Period', revenueVariance, null, 0, '%', 'budget'),
    fin('expense_variance', 'Expense vs Prev Period', expenseVariance, null, 0, '%', 'budget', true),
    // labor_budget_used is pushed below only when budgets are configured —
    // a missing ops_department_labor_budget table must not read as "0% spent".
    // Ratios
    fin('current_ratio', 'Current Ratio', currentRatio, null, 1.5, 'x', 'ratios'),
    fin('quick_ratio', 'Quick Ratio', quickRatio, null, 1, 'x', 'ratios'),
    fin('debt_to_equity', 'Debt to Equity', debtToEquity, null, 2, 'x', 'ratios', true),
    fin('return_on_assets', 'Return on Assets', roa, prevRoa, 10, '%', 'ratios'),
    fin('profit_margin', 'Profit Margin', operatingMargin, prevOperatingMargin, 25, '%', 'ratios'),
  ];

  if (budgetTotal > 0) {
    metrics.push(fin('labor_budget_used', 'Labor Budget Used', laborBudgetUsed, null, 95, '%', 'budget', true));
  }

  // Cost centers — top departmental expense postings become metrics.
  const ccPre = (rows: Posting[]) => {
    const m = new Map<string, number>();
    for (const p of rows) {
      if (p.type !== 'Expense') continue;
      m.set(p.dept, (m.get(p.dept) || 0) + p.debit - p.credit);
    }
    return m;
  };
  const ccCur = ccPre(curPostings);
  const ccPrev = ccPre(prevPostings);
  [...ccCur.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([dept, value]) => {
      metrics.push(fin(
        `cost_${dept.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        `${dept} Cost`, value, ccPrev.get(dept) ?? null, 0, 'currency', 'costcenters', true,
      ));
    });

  // ── Department profitability ──────────────────────────────────────────
  // Revenue per department: GL revenue lines by department, falling back to
  // the operational source systems. Expenses per department: GL expense lines.
  const deptExpenses = new Map<string, number>();
  const deptRevenueGl = new Map<string, number>();
  for (const p of curPostings) {
    const d = p.dept || 'Unallocated';
    if (p.type === 'Expense') deptExpenses.set(d, (deptExpenses.get(d) || 0) + p.debit - p.credit);
    if (p.type === 'Revenue') deptRevenueGl.set(d, (deptRevenueGl.get(d) || 0) + p.credit - p.debit);
  }

  const deptMap = new Map<string, { revenue: number; expenses: number }>();
  const addDept = (name: string, rev: number, exp: number) => {
    const cur = deptMap.get(name) || { revenue: 0, expenses: 0 };
    cur.revenue += rev; cur.expenses += exp;
    deptMap.set(name, cur);
  };
  addDept('Rooms Division', deptRevenueGl.get('Rooms') || deptRevenueGl.get('Front Office') || roomRevCur,
    deptExpenses.get('Rooms') || deptExpenses.get('Front Office') || 0);
  addDept('Food & Beverage', deptRevenueGl.get('F&B') || deptRevenueGl.get('Food & Beverage') || fbRevCur,
    deptExpenses.get('F&B') || deptExpenses.get('Food & Beverage') || 0);
  addDept('Banquet & Events', deptRevenueGl.get('Banquet') || evRevCur,
    deptExpenses.get('Banquet') || deptExpenses.get('Banquet & Events') || 0);
  for (const [dept, exp] of deptExpenses) {
    if (!deptMap.has(dept) && exp > 0) addDept(dept, deptRevenueGl.get(dept) || 0, exp);
  }
  const departmentProfitability: FinDeptProfit[] = [...deptMap.entries()]
    .map(([name, d]) => ({
      name,
      revenue: Math.round(d.revenue * 100) / 100,
      expenses: Math.round(d.expenses * 100) / 100,
      profit: Math.round((d.revenue - d.expenses) * 100) / 100,
      margin: d.revenue > 0 ? Math.round(((d.revenue - d.expenses) / d.revenue) * 1000) / 10 : 0,
    }))
    .filter(d => d.revenue > 0 || d.expenses > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // ── Expense trends (by GL department / cost center) ───────────────────
  const expByDept = (rows: Posting[]) => {
    const m = new Map<string, number>();
    for (const p of rows) {
      if (p.type !== 'Expense') continue;
      m.set(p.dept, (m.get(p.dept) || 0) + p.debit - p.credit);
    }
    return m;
  };
  const curExpByDept = expByDept(curPostings);
  const prevExpByDept = expByDept(prevPostings);
  const expenseTrends: FinExpenseTrend[] = [...curExpByDept.entries()]
    .map(([name, value]) => {
      const prev = prevExpByDept.get(name) || 0;
      return {
        name,
        value: Math.round(value * 100) / 100,
        previousValue: Math.round(prev * 100) / 100,
        change: prev > 0 ? Math.round(((value - prev) / prev) * 1000) / 10 : (value > 0 ? 100 : null),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  await applyConfiguredTargets(metrics);

  const result = {
    propertyId: propertyId || null,
    days: daysCount,
    generatedAt: now.toISOString(),
    metrics,
    departmentProfitability,
    expenseTrends,
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Revenue Intelligence ────────────────────────────────────────────────
// GET /api/executive/revenue-intelligence?days=30&propertyId=...
// Occupancy / ADR / RevPAR / TRevPAR / GOPPAR, booking pace & pickup,
// demand forecasts, channel mix and market-segment mix — computed from
// reservations, rooms, channel_performance, demand_forecasts,
// market_segments, orders, banquet_events and GL expense postings.

type RevCategory = 'occupancy' | 'adr' | 'revpar' | 'booking' | 'forecast' | 'channel';

interface RevMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold?: number;
  unit: string;
  category: RevCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

interface RevChannelMix {
  name: string;
  sharePct: number;
  revenue: number;
  bookings: number;
}

interface RevDemandForecast {
  horizon: string;
  forecastOccupancy: number;
  confidence: number;
  forecastDemand: number;
}

interface RevSegmentMix {
  name: string;
  guests: number;
  sharePct: number;
}

router.get('/revenue-intelligence', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-rev-intel:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);
  const todayStr = dayStr(now);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [
    rooms, reservations, channelPerf, channelConnections, demandForecasts,
    marketSegments, guestSegments, journalEntries, orders, banquetEvents,
  ] = await Promise.all([
    kpiFetchRows(eqProp(supabaseAdmin!.from('rooms')
      .select('id, status, rate, property_id')), 'rooms'),
    // Unbounded forward window — future stays drive pickup & pace.
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, check_out_date, status, rate, total_amount, channel, created_at, property_id')), 'reservations'),
    kpiFetchRows(supabaseAdmin!.from('channel_performance')
      .select('channel_id, date, bookings_received, bookings_confirmed, gross_revenue, net_revenue, commission_amount, average_rate, average_lead_time_days')
      .gte('date', windowStart), 'channel_performance'),
    kpiFetchRows(supabaseAdmin!.from('channel_connections')
      .select('id, channel_name, channel_code, channel_type'), 'channel_connections'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('demand_forecasts')
      .select('forecast_occupancy, forecast_demand, confidence_score, target_date, forecast_horizon_days, property_id')
      .gte('target_date', todayStr)), 'demand_forecasts'),
    kpiFetchRows(supabaseAdmin!.from('market_segments')
      .select('id, segment_name, is_active'), 'market_segments'),
    kpiFetchRows(supabaseAdmin!.from('guest_market_segments')
      .select('guest_id, segment_id, is_primary'), 'guest_market_segments'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('journal_entries')
      .select('id, entry_date, status, department, lines, property_id')
      .gte('entry_date', windowStart)), 'journal_entries'),
    kpiFetchRows(supabaseAdmin!.from('orders')
      .select('id, status, total_amount, created_at')
      .gte('created_at', prevStart.toISOString()), 'orders'),
    kpiFetchRows(supabaseAdmin!.from('banquet_events')
      .select('id, status, event_date, actual_revenue')
      .gte('event_date', windowStart), 'banquet_events'),
  ]);

  const RES_ACTIVE = new Set(['Confirmed', 'CheckedIn', 'CheckedOut', 'Waitlisted']);
  const resActive = reservations.filter(r => RES_ACTIVE.has(r.status));

  const nightsBetween = (r: any, start: Date, end: Date) => {
    const ci = new Date(r.check_in_date).getTime();
    const co = new Date(r.check_out_date).getTime();
    if (isNaN(ci) || isNaN(co)) return 0;
    return Math.max(0, (Math.min(co, end.getTime()) - Math.max(ci, start.getTime())) / 86400000);
  };
  const roomNightsIn = (s: Date, e: Date) => resActive.reduce((sum, r) => sum + nightsBetween(r, s, e), 0);
  const roomRevIn = (s: Date, e: Date) =>
    resActive.reduce((sum, r) => sum + nightsBetween(r, s, e) * (Number(r.rate) || 0), 0);

  const totalRooms = rooms.length;
  const roomDenominator = totalRooms * daysCount;
  const curNights = roomNightsIn(curStart, now);
  const prevNights = roomNightsIn(prevStart, prevEnd);
  const curRoomRev = roomRevIn(curStart, now);
  const prevRoomRev = roomRevIn(prevStart, prevEnd);

  const occupancy = roomDenominator > 0 ? (curNights / roomDenominator) * 100 : 0;
  const prevOccupancy = roomDenominator > 0 ? (prevNights / roomDenominator) * 100 : 0;
  const adr = curNights > 0 ? curRoomRev / curNights : 0;
  const prevAdr = prevNights > 0 ? prevRoomRev / prevNights : 0;
  const revpar = roomDenominator > 0 ? curRoomRev / roomDenominator : 0;
  const prevRevpar = roomDenominator > 0 ? prevRoomRev / roomDenominator : 0;

  // ALOS from stays starting in the window.
  const staysCur = resActive.filter(r => inWindow(r.check_in_date, curStart, now));
  const staysPrev = resActive.filter(r => inWindow(r.check_in_date, prevStart, prevEnd));
  const stayLen = (r: any) =>
    Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000);
  const alos = staysCur.length > 0 ? staysCur.reduce((s, r) => s + stayLen(r), 0) / staysCur.length : 0;
  const prevAlos = staysPrev.length > 0 ? staysPrev.reduce((s, r) => s + stayLen(r), 0) / staysPrev.length : 0;

  // TRevPAR — total property revenue (rooms + F&B + events) per available room-night.
  const fbRevIn = (s: Date, e: Date) =>
    orders.filter(o => o.status === 'Paid' && inWindow(o.created_at, s, e))
      .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
  const evRevIn = (s: Date, e: Date) =>
    banquetEvents.filter(x => inWindow(x.event_date, s, e))
      .reduce((sum, x) => sum + (Number(x.actual_revenue) || 0), 0);
  const totalRevCur = curRoomRev + fbRevIn(curStart, now) + evRevIn(curStart, now);
  const totalRevPrev = prevRoomRev + fbRevIn(prevStart, prevEnd) + evRevIn(prevStart, prevEnd);
  const trevpar = roomDenominator > 0 ? totalRevCur / roomDenominator : 0;
  const prevTrevpar = roomDenominator > 0 ? totalRevPrev / roomDenominator : 0;

  // GOPPAR — (total revenue − GL expense postings) per available room-night.
  let expensesCur = 0;
  let expensesPrev = 0;
  for (const e of journalEntries) {
    if (e.status === 'Reversed') continue;
    const d = new Date(e.entry_date);
    if (isNaN(d.getTime())) continue;
    const lines: any[] = Array.isArray(e.lines)
      ? e.lines
      : (typeof e.lines === 'string' ? JSON.parse(e.lines || '[]') : []);
    const exp = lines
      .filter(l => String(l.accountId || l.accountCode || l.account_code || '').charAt(0) >= '5')
      .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    if (d >= curStart && d < now) expensesCur += exp;
    else if (d >= prevStart && d < prevEnd) expensesPrev += exp;
  }
  const goppar = roomDenominator > 0 ? (totalRevCur - expensesCur) / roomDenominator : 0;
  const prevGoppar = roomDenominator > 0 ? (totalRevPrev - expensesPrev) / roomDenominator : 0;

  // Booking pace, pickup, lead time, cancellations.
  const bookedCur = reservations.filter(r => inWindow(r.created_at, curStart, now));
  const bookedPrev = reservations.filter(r => inWindow(r.created_at, prevStart, prevEnd));
  const newBookings = bookedCur.length;
  const prevNewBookings = bookedPrev.length;
  const pickupNights = bookedCur.reduce((s, r) => s + stayLen(r), 0);
  const prevPickupNights = bookedPrev.reduce((s, r) => s + stayLen(r), 0);
  const leadTimes = bookedCur
    .map(r => (new Date(r.check_in_date).getTime() - new Date(r.created_at).getTime()) / 86400000)
    .filter(d => !isNaN(d) && d >= 0);
  const avgLeadTime = leadTimes.length > 0 ? leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length : 0;
  const leadTimesPrev = bookedPrev
    .map(r => (new Date(r.check_in_date).getTime() - new Date(r.created_at).getTime()) / 86400000)
    .filter(d => !isNaN(d) && d >= 0);
  const prevAvgLeadTime = leadTimesPrev.length > 0 ? leadTimesPrev.reduce((s, d) => s + d, 0) / leadTimesPrev.length : null;
  const cancelledCur = bookedCur.filter(r => r.status === 'Cancelled').length;
  const cancelledPrev = bookedPrev.filter(r => r.status === 'Cancelled').length;
  const cancellationRate = newBookings > 0 ? (cancelledCur / newBookings) * 100 : 0;
  const prevCancellationRate = prevNewBookings > 0 ? (cancelledPrev / prevNewBookings) * 100 : 0;

  // Channel mix — prefer channel_performance (per-channel daily aggregates),
  // fall back to reservations.channel when the channel manager has no data.
  const channelNameById = new Map<string, string>(
    channelConnections.map(c => [String(c.id), c.channel_name || c.channel_code]),
  );
  const perfCur = channelPerf.filter(p => inWindow(p.date, curStart, now));
  let channelMix: RevChannelMix[] = [];
  if (perfCur.length > 0) {
    const byChannel = new Map<string, { revenue: number; bookings: number }>();
    for (const p of perfCur) {
      const name = channelNameById.get(String(p.channel_id)) || 'Unknown';
      const cur = byChannel.get(name) || { revenue: 0, bookings: 0 };
      cur.revenue += Number(p.net_revenue) || Number(p.gross_revenue) || 0;
      cur.bookings += Number(p.bookings_confirmed) || Number(p.bookings_received) || 0;
      byChannel.set(name, cur);
    }
    const total = [...byChannel.values()].reduce((s, c) => s + c.revenue, 0);
    channelMix = [...byChannel.entries()]
      .map(([name, c]) => ({
        name,
        revenue: Math.round(c.revenue * 100) / 100,
        bookings: c.bookings,
        sharePct: total > 0 ? Math.round((c.revenue / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  } else {
    const byChannel = new Map<string, { revenue: number; bookings: number }>();
    for (const r of resActive.filter(x => inWindow(x.check_in_date, curStart, now) || inWindow(x.created_at, curStart, now))) {
      const name = r.channel || 'Direct';
      const cur = byChannel.get(name) || { revenue: 0, bookings: 0 };
      cur.revenue += stayLen(r) * (Number(r.rate) || 0);
      cur.bookings += 1;
      byChannel.set(name, cur);
    }
    const total = [...byChannel.values()].reduce((s, c) => s + c.revenue, 0);
    channelMix = [...byChannel.entries()]
      .map(([name, c]) => ({
        name,
        revenue: Math.round(c.revenue * 100) / 100,
        bookings: c.bookings,
        sharePct: total > 0 ? Math.round((c.revenue / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  const channelShare = (match: RegExp) =>
    channelMix.filter(c => match.test(c.name)).reduce((s, c) => s + c.sharePct, 0);
  const directShare = channelShare(/direct|walk|web|phone/i);
  const otaShare = channelShare(/ota|booking|expedia|agoda|airbnb/i);

  // Market-segment mix (guest portfolio, not window-scoped).
  const segmentNameById = new Map<string, string>(marketSegments.map(s => [String(s.id), s.segment_name]));
  const segCounts = new Map<string, number>();
  for (const gs of guestSegments) {
    const name = segmentNameById.get(String(gs.segment_id)) || 'Unclassified';
    segCounts.set(name, (segCounts.get(name) || 0) + 1);
  }
  const totalSegmented = [...segCounts.values()].reduce((s, n) => s + n, 0);
  const segmentMix: RevSegmentMix[] = [...segCounts.entries()]
    .map(([name, guests]) => ({
      name, guests,
      sharePct: totalSegmented > 0 ? Math.round((guests / totalSegmented) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.guests - a.guests)
    .slice(0, 8);

  // Demand forecasts — average forecast occupancy per horizon.
  const forecastFor = (horizonDays: number) => {
    const horizonEnd = new Date(now); horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
    const rows = demandForecasts.filter(f => {
      const t = new Date(f.target_date).getTime();
      return !isNaN(t) && t >= now.getTime() && t <= horizonEnd.getTime();
    });
    if (rows.length === 0) return null;
    return {
      occupancy: rows.reduce((s, f) => s + (Number(f.forecast_occupancy) || 0), 0) / rows.length,
      demand: rows.reduce((s, f) => s + (Number(f.forecast_demand) || 0), 0) / rows.length,
      confidence: rows.reduce((s, f) => s + (Number(f.confidence_score) || 0), 0) / rows.length,
    };
  };
  const demandForecast: RevDemandForecast[] = ([7, 30, 90] as const)
    .map(h => {
      const f = forecastFor(h);
      return f ? {
        horizon: `${h}d`,
        forecastOccupancy: Math.round(f.occupancy * 100) / 100,
        forecastDemand: Math.round(f.demand * 100) / 100,
        confidence: Math.round(f.confidence * 100) / 100,
      } : null;
    })
    .filter((f): f is RevDemandForecast => f !== null);

  const rev = (
    id: string, name: string, value: number, previousValue: number | null,
    target: number, unit: string, category: RevCategory, lowerIsBetter = false,
  ): RevMetric => {
    const v = Math.round(value * 100) / 100;
    return {
      id, name, value: v,
      previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
      target, unit, category, lowerIsBetter,
      trend: kpiTrend(v, previousValue),
      status: target === 0 ? 'on-track' : kpiStatus(v, target, target * 0.75, lowerIsBetter),
    };
  };

  const metrics: RevMetric[] = [
    // Occupancy
    rev('occupancy', 'Occupancy Rate', occupancy, prevOccupancy, 75, '%', 'occupancy'),
    rev('avg_los', 'Avg Length of Stay', alos, prevAlos, 3, 'nights', 'occupancy'),
    rev('room_nights_sold', 'Room Nights Sold', curNights, prevNights, 0, 'count', 'occupancy'),
    // ADR
    rev('adr', 'Average Daily Rate', adr, prevAdr, 0, 'currency', 'adr'),
    rev('adr_change', 'ADR Change', prevAdr > 0 ? ((adr - prevAdr) / prevAdr) * 100 : 0, null, 5, '%', 'adr'),
    // RevPAR family
    rev('revpar', 'RevPAR', revpar, prevRevpar, 0, 'currency', 'revpar'),
    rev('trevpar', 'TRevPAR', trevpar, prevTrevpar, 0, 'currency', 'revpar'),
    rev('goppar', 'GOPPAR', goppar, prevGoppar, 0, 'currency', 'revpar'),
    // Booking pace & pickup
    rev('new_bookings', 'New Bookings', newBookings, prevNewBookings, 0, 'count', 'booking'),
    rev('booking_pace', 'Booking Pace', newBookings / daysCount, prevNewBookings / daysCount, 1, '/day', 'booking'),
    rev('pickup_nights', 'Pickup (Room Nights)', pickupNights, prevPickupNights, 0, 'count', 'booking'),
    rev('avg_lead_time', 'Avg Lead Time', avgLeadTime, prevAvgLeadTime, 14, 'days', 'booking'),
    rev('cancellation_rate', 'Cancellation Rate', cancellationRate, prevCancellationRate, 10, '%', 'booking', true),
    // Channel mix
    rev('direct_share', 'Direct Booking Share', directShare, null, 30, '%', 'channel'),
    rev('ota_share', 'OTA Share', otaShare, null, 50, '%', 'channel'),
    rev('channels_active', 'Active Channels', channelMix.length, null, 4, 'count', 'channel'),
  ];

  // Forecast metrics only when the RMS forecast table has rows.
  for (const f of demandForecast) {
    metrics.push(rev(
      `demand_forecast_${f.horizon}`, `Demand Forecast (${f.horizon})`,
      f.forecastOccupancy, null, 75, '%', 'forecast',
    ));
  }

  await applyConfiguredTargets(metrics);

  const result = {
    propertyId: propertyId || null,
    days: daysCount,
    generatedAt: now.toISOString(),
    metrics,
    channelMix,
    demandForecast,
    segmentMix,
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Guest Intelligence ──────────────────────────────────────────────────
// GET /api/executive/guest-intelligence?days=30&propertyId=...
// Demographics, loyalty, lifetime value, stay patterns, satisfaction and
// segmentation — from guests, reservations, loyalty_transactions,
// ops_vip_profiles, ops_recovery_cases, sales_guest_feedback,
// guest_feedbacks, guest_requests and market segments.

type GuestCategory = 'demographics' | 'loyalty' | 'lifetime' | 'patterns' | 'satisfaction' | 'segmentation';

interface GuestMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold?: number;
  unit: string;
  category: GuestCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

interface GuestReview {
  guestName: string;
  rating: number;
  comment: string;
  date: string;
}

interface GuestComplaint {
  complaint: string;
  category: string;
  status: string;
  priority: string;
  date: string;
}

router.get('/guest-intelligence', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-guest-intel:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [
    guests, reservations, loyaltyTxns, vipProfiles, recoveryCases,
    salesFeedback, guestFeedbacks, _guestRequests, marketSegments, guestSegments,
  ] = await Promise.all([
    kpiFetchRows(supabaseAdmin!.from('guests')
      .select('id, country, date_of_birth, gender, created_at'), 'guests'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, guest_id, check_in_date, check_out_date, status, rate, total_amount, adults, children, created_at, property_id')), 'reservations'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('loyalty_transactions')
      .select('id, guest_id, transaction_type, points, created_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'loyalty_transactions'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_vip_profiles')
      .select('id, guest_id, category, property_id')), 'ops_vip_profiles'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_recovery_cases')
      .select('id, complaint, category, status, priority, compensation_amount, created_at, closed_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'ops_recovery_cases'),
    kpiFetchRows(supabaseAdmin!.from('sales_guest_feedback')
      .select('id, guest_name, rating, comments, feedback_type, status, feedback_date')
      .order('feedback_date', { ascending: false })
      .limit(100), 'sales_guest_feedback'),
    kpiFetchRows(supabaseAdmin!.from('guest_feedbacks')
      .select('id, rating, feedback_date')
      .gte('feedback_date', windowStart), 'guest_feedbacks'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('id, status, submitted_at, completed_at, property_id')
      .gte('submitted_at', prevStart.toISOString())), 'guest_requests'),
    kpiFetchRows(supabaseAdmin!.from('market_segments')
      .select('id, segment_name'), 'market_segments'),
    kpiFetchRows(supabaseAdmin!.from('guest_market_segments')
      .select('guest_id, segment_id'), 'guest_market_segments'),
  ]);

  const RES_ACTIVE = new Set(['Reserved', 'Confirmed', 'CheckedIn', 'CheckedOut', 'Waitlisted']);
  const resActive = reservations.filter(r => RES_ACTIVE.has(r.status));

  // ── Demographics ──────────────────────────────────────────────────────
  const totalGuests = guests.length;
  const newGuestsCur = guests.filter(g => inWindow(g.created_at, curStart, now)).length;
  const newGuestsPrev = guests.filter(g => inWindow(g.created_at, prevStart, prevEnd)).length;
  const ages = guests
    .map(g => g.date_of_birth ? (now.getTime() - new Date(g.date_of_birth).getTime()) / (365.25 * 86400000) : 0)
    .filter(a => a > 0 && a < 120);
  const avgAge = ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : 0;
  const countryCounts = new Map<string, number>();
  for (const g of guests) {
    const c = (g.country || '').trim() || 'Unknown';
    countryCounts.set(c, (countryCounts.get(c) || 0) + 1);
  }
  const countriesRepresented = [...countryCounts.keys()].filter(c => c !== 'Unknown').length;
  const topCountries = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([country, count]) => ({
      country, guests: count,
      sharePct: totalGuests > 0 ? Math.round((count / totalGuests) * 1000) / 10 : 0,
    }));

  // ── Loyalty ───────────────────────────────────────────────────────────
  const loyaltyMembers = new Set(
    loyaltyTxns.filter(t => t.transaction_type === 'accrual').map(t => t.guest_id),
  ).size;
  const pointsIssuedCur = loyaltyTxns
    .filter(t => t.transaction_type === 'accrual' && inWindow(t.created_at, curStart, now))
    .reduce((s, t) => s + (Number(t.points) || 0), 0);
  const pointsIssuedPrev = loyaltyTxns
    .filter(t => t.transaction_type === 'accrual' && inWindow(t.created_at, prevStart, prevEnd))
    .reduce((s, t) => s + (Number(t.points) || 0), 0);
  const pointsRedeemedCur = Math.abs(loyaltyTxns
    .filter(t => t.transaction_type === 'redemption' && inWindow(t.created_at, curStart, now))
    .reduce((s, t) => s + (Number(t.points) || 0), 0));
  const pointsRedeemedPrev = Math.abs(loyaltyTxns
    .filter(t => t.transaction_type === 'redemption' && inWindow(t.created_at, prevStart, prevEnd))
    .reduce((s, t) => s + (Number(t.points) || 0), 0));
  const vipGuests = vipProfiles.length;
  const enrollmentsCur = new Set(
    loyaltyTxns.filter(t => inWindow(t.created_at, curStart, now)).map(t => t.guest_id),
  ).size;
  const enrollmentsPrev = new Set(
    loyaltyTxns.filter(t => inWindow(t.created_at, prevStart, prevEnd)).map(t => t.guest_id),
  ).size;

  // ── Lifetime value & repeat guests ────────────────────────────────────
  const staysByGuest = new Map<string, { stays: number; spend: number }>();
  for (const r of resActive) {
    if (!r.guest_id) continue;
    const cur = staysByGuest.get(r.guest_id) || { stays: 0, spend: 0 };
    cur.stays += 1;
    cur.spend += Number(r.total_amount) || 0;
    staysByGuest.set(r.guest_id, cur);
  }
  const guestsWithStays = staysByGuest.size;
  const repeatGuests = [...staysByGuest.values()].filter(g => g.stays > 1).length;
  const repeatRate = guestsWithStays > 0 ? (repeatGuests / guestsWithStays) * 100 : 0;
  const totalGuestSpend = [...staysByGuest.values()].reduce((s, g) => s + g.spend, 0);
  const glv = guestsWithStays > 0 ? totalGuestSpend / guestsWithStays : 0;
  const repeatSpend = [...staysByGuest.values()].filter(g => g.stays > 1).reduce((s, g) => s + g.spend, 0);
  const repeatGuestValue = repeatGuests > 0 ? repeatSpend / repeatGuests : 0;

  // ── Stay patterns ─────────────────────────────────────────────────────
  const stayLen = (r: any) =>
    Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000);
  const staysCur = resActive.filter(r => inWindow(r.check_in_date, curStart, now));
  const staysPrev = resActive.filter(r => inWindow(r.check_in_date, prevStart, prevEnd));
  const alos = staysCur.length > 0 ? staysCur.reduce((s, r) => s + stayLen(r), 0) / staysCur.length : 0;
  const prevAlos = staysPrev.length > 0 ? staysPrev.reduce((s, r) => s + stayLen(r), 0) / staysPrev.length : 0;
  const weekendCheckins = staysCur.filter(r => {
    const d = new Date(r.check_in_date).getDay();
    return d === 5 || d === 6;
  }).length;
  const prevWeekendCheckins = staysPrev.filter(r => {
    const d = new Date(r.check_in_date).getDay();
    return d === 5 || d === 6;
  }).length;
  const weekendShare = staysCur.length > 0 ? (weekendCheckins / staysCur.length) * 100 : 0;
  const prevWeekendShare = staysPrev.length > 0 ? (prevWeekendCheckins / staysPrev.length) * 100 : 0;
  const partySizes = staysCur
    .map(r => (Number(r.adults) || 0) + (Number(r.children) || 0))
    .filter(n => n > 0);
  const avgPartySize = partySizes.length > 0 ? partySizes.reduce((s, n) => s + n, 0) / partySizes.length : 0;

  // ── Satisfaction ──────────────────────────────────────────────────────
  const ratingRows = [
    ...guestFeedbacks.map(f => ({ rating: Number(f.rating) || 0, at: f.feedback_date })),
    ...salesFeedback.map(f => ({ rating: Number(f.rating) || 0, at: f.feedback_date })),
  ].filter(f => f.rating > 0);
  const fbCur = ratingRows.filter(f => inWindow(f.at, curStart, now));
  const fbPrev = ratingRows.filter(f => inWindow(f.at, prevStart, prevEnd));
  const avgRating = fbCur.length > 0 ? fbCur.reduce((s, f) => s + f.rating, 0) / fbCur.length : 0;
  const prevAvgRating = fbPrev.length > 0 ? fbPrev.reduce((s, f) => s + f.rating, 0) / fbPrev.length : 0;
  // NPS on a 5-point scale: 5 = promoter, <=3 = detractor.
  const nps = fbCur.length > 0
    ? ((fbCur.filter(f => f.rating >= 5).length - fbCur.filter(f => f.rating <= 3).length) / fbCur.length) * 100
    : 0;
  const prevNps = fbPrev.length > 0
    ? ((fbPrev.filter(f => f.rating >= 5).length - fbPrev.filter(f => f.rating <= 3).length) / fbPrev.length) * 100
    : 0;

  const RC_OPEN = new Set(['logged', 'open', 'acknowledged', 'in-progress']);
  const recCur = recoveryCases.filter(c => inWindow(c.created_at, curStart, now));
  const recPrev = recoveryCases.filter(c => inWindow(c.created_at, prevStart, prevEnd));
  const complaintRate = staysCur.length > 0 ? (recCur.length / staysCur.length) * 100 : 0;
  const prevComplaintRate = staysPrev.length > 0 ? (recPrev.length / staysPrev.length) * 100 : 0;
  const openCases = recoveryCases.filter(c => RC_OPEN.has(c.status)).length;
  const closedCur = recCur.filter(c => c.closed_at);
  const avgRecoveryHrs = closedCur.length > 0
    ? closedCur.reduce((s, c) => s + Math.max(0, (new Date(c.closed_at).getTime() - new Date(c.created_at).getTime()) / 3600000), 0) / closedCur.length
    : 0;
  const compensationTotal = recCur.reduce((s, c) => s + (Number(c.compensation_amount) || 0), 0);

  // ── Segmentation ──────────────────────────────────────────────────────
  const segmentNameById = new Map<string, string>(marketSegments.map(s => [String(s.id), s.segment_name]));
  const segCounts = new Map<string, number>();
  for (const gs of guestSegments) {
    const name = segmentNameById.get(String(gs.segment_id)) || 'Unclassified';
    segCounts.set(name, (segCounts.get(name) || 0) + 1);
  }
  const totalSegmented = [...segCounts.values()].reduce((s, n) => s + n, 0);
  const segmentMix = [...segCounts.entries()]
    .map(([name, guestsInSeg]) => ({
      name, guests: guestsInSeg,
      sharePct: totalSegmented > 0 ? Math.round((guestsInSeg / totalSegmented) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.guests - a.guests)
    .slice(0, 8);

  // ── Reviews & complaints lists ────────────────────────────────────────
  const recentReviews: GuestReview[] = salesFeedback
    .filter(f => Number(f.rating) > 0 || f.comments)
    .slice(0, 5)
    .map(f => ({
      guestName: f.guest_name || 'Guest',
      rating: Number(f.rating) || 0,
      comment: f.comments || '',
      date: f.feedback_date || '',
    }));

  const complaintList: GuestComplaint[] = recoveryCases
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)
    .map(c => ({
      complaint: c.complaint || '',
      category: c.category || 'Other',
      status: c.status || 'logged',
      priority: c.priority || 'medium',
      date: c.created_at || '',
    }));

  const gm = (
    id: string, name: string, value: number, previousValue: number | null,
    target: number, unit: string, category: GuestCategory, lowerIsBetter = false,
  ): GuestMetric => {
    const v = Math.round(value * 100) / 100;
    return {
      id, name, value: v,
      previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
      target, unit, category, lowerIsBetter,
      trend: kpiTrend(v, previousValue),
      status: target === 0 ? 'on-track' : kpiStatus(v, target, target * 0.75, lowerIsBetter),
    };
  };

  const metrics: GuestMetric[] = [
    // Demographics
    gm('total_guests', 'Total Guests', totalGuests, null, 0, 'count', 'demographics'),
    gm('new_guests', 'New Guests', newGuestsCur, newGuestsPrev, 0, 'count', 'demographics'),
    gm('avg_age', 'Average Age', avgAge, null, 0, 'years', 'demographics'),
    gm('countries', 'Countries Represented', countriesRepresented, null, 0, 'count', 'demographics'),
    // Loyalty
    gm('loyalty_members', 'Loyalty Members', loyaltyMembers, null, 0, 'count', 'loyalty'),
    gm('new_enrollments', 'New Enrollments', enrollmentsCur, enrollmentsPrev, 0, 'count', 'loyalty'),
    gm('points_issued', 'Points Issued', pointsIssuedCur, pointsIssuedPrev, 0, 'count', 'loyalty'),
    gm('points_redeemed', 'Points Redeemed', pointsRedeemedCur, pointsRedeemedPrev, 0, 'count', 'loyalty'),
    gm('vip_guests', 'VIP Guests', vipGuests, null, 0, 'count', 'loyalty'),
    // Lifetime value
    gm('glv', 'Guest Lifetime Value', glv, null, 0, 'currency', 'lifetime'),
    gm('repeat_guest_rate', 'Repeat Guest Rate', repeatRate, null, 25, '%', 'lifetime'),
    gm('repeat_guest_value', 'Repeat Guest Value', repeatGuestValue, null, 0, 'currency', 'lifetime'),
    gm('revenue_per_guest', 'Revenue per Guest', glv, null, 0, 'currency', 'lifetime'),
    // Stay patterns
    gm('avg_los', 'Avg Length of Stay', alos, prevAlos, 3, 'nights', 'patterns'),
    gm('weekend_share', 'Weekend Check-in Share', weekendShare, prevWeekendShare, 35, '%', 'patterns'),
    gm('avg_party_size', 'Avg Party Size', avgPartySize, null, 0, 'guests', 'patterns'),
    gm('unique_guests_stayed', 'Unique Guests Stayed', guestsWithStays, null, 0, 'count', 'patterns'),
    // Satisfaction
    gm('guest_satisfaction', 'Guest Satisfaction', avgRating, prevAvgRating, 4, '/5', 'satisfaction'),
    gm('nps', 'Net Promoter Score', nps, prevNps, 50, 'count', 'satisfaction'),
    gm('review_count', 'Reviews Received', fbCur.length, fbPrev.length, 0, 'count', 'satisfaction'),
    gm('complaint_rate', 'Complaint Rate', complaintRate, prevComplaintRate, 10, '%', 'satisfaction', true),
    gm('open_cases', 'Open Recovery Cases', openCases, null, 3, 'count', 'satisfaction', true),
    gm('avg_recovery_time', 'Avg Recovery Time', avgRecoveryHrs, null, 24, 'hrs', 'satisfaction', true),
    gm('compensation_paid', 'Compensation Paid', compensationTotal, null, 0, 'currency', 'satisfaction', true),
  ];

  // Segment share metrics — emitted only when segments exist.
  for (const seg of segmentMix.slice(0, 4)) {
    metrics.push(gm(
      `seg_${seg.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      `${seg.name} Share`, seg.sharePct, null, 0, '%', 'segmentation',
    ));
  }

  await applyConfiguredTargets(metrics);

  const result = {
    propertyId: propertyId || null,
    days: daysCount,
    generatedAt: now.toISOString(),
    metrics,
    recentReviews,
    complaints: complaintList,
    segmentMix,
    topCountries,
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Sales & Marketing Intelligence ──────────────────────────────────────
// GET /api/executive/sales-marketing-intelligence?days=30&propertyId=...
// Pipeline, conversion, corporate production, OTA performance, campaign ROI,
// segment mix and acquisition — from sales_leads, sales_proposals,
// sales_contracts, sales_campaigns, sales_activities, corporate_accounts,
// channel_performance, reservations and market segments.
// CRM tables are enterprise-level (no property_id) so they are not
// property-scoped.

type SalesCategory = 'pipeline' | 'conversion' | 'corporate' | 'ota' | 'campaign' | 'segments' | 'acquisition';

interface SalesMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold?: number;
  unit: string;
  category: SalesCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

interface PipelineStage {
  stage: string;
  count: number;
  value: number;
  sharePct: number;
}

interface CampaignRow {
  name: string;
  type: string;
  status: string;
  budget: number;
  spent: number;
  leads: number;
  conversions: number;
}

router.get('/sales-marketing-intelligence', authenticate, execView, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const daysCount = resolveDays(req.query);

  const cacheKey = `exec-sales-intel:${propertyId || 'all'}:${daysCount}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const now = new Date();
  const curStart = new Date(now.getTime() - daysCount * 86400e3);
  const prevStart = new Date(curStart.getTime() - daysCount * 86400e3);
  const prevEnd = curStart;
  const windowStart = dayStr(prevStart);

  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [
    salesLeads, salesProposals, salesContracts, salesCampaigns,
    salesActivities, corporateAccounts, channelPerf, channelConnections,
    reservations, marketSegments, guestSegments,
  ] = await Promise.all([
    kpiFetchRows(supabaseAdmin!.from('sales_leads')
      .select('id, lead_name, company, source, stage, opportunity_value, conversion_date, corporate_account_id, created_at')
      .gte('created_at', prevStart.toISOString()), 'sales_leads'),
    kpiFetchRows(supabaseAdmin!.from('sales_proposals')
      .select('id, status, proposed_revenue, sent_date, accepted_date, rejected_date, lead_id, created_at')
      .gte('created_at', prevStart.toISOString()), 'sales_proposals'),
    kpiFetchRows(supabaseAdmin!.from('sales_contracts')
      .select('id, status, total_value, start_date, corporate_account_id, created_at'), 'sales_contracts'),
    kpiFetchRows(supabaseAdmin!.from('sales_campaigns')
      .select('id, campaign_name, campaign_type, status, budget, spent, leads, conversions, start_date, end_date'), 'sales_campaigns'),
    kpiFetchRows(supabaseAdmin!.from('sales_activities')
      .select('id, activity_type, status, due_date, created_at')
      .gte('created_at', prevStart.toISOString()), 'sales_activities'),
    kpiFetchRows(supabaseAdmin!.from('corporate_accounts')
      .select('id, company_name, active_bookings, unpaid_balance, credit_limit, created_at'), 'corporate_accounts'),
    kpiFetchRows(supabaseAdmin!.from('channel_performance')
      .select('channel_id, date, bookings_confirmed, gross_revenue, net_revenue, commission_amount')
      .gte('date', windowStart), 'channel_performance'),
    kpiFetchRows(supabaseAdmin!.from('channel_connections')
      .select('id, channel_name, channel_type'), 'channel_connections'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, check_out_date, status, rate, total_amount, channel, created_at, property_id')
      .gte('created_at', prevStart.toISOString())), 'reservations'),
    kpiFetchRows(supabaseAdmin!.from('market_segments')
      .select('id, segment_name'), 'market_segments'),
    kpiFetchRows(supabaseAdmin!.from('guest_market_segments')
      .select('guest_id, segment_id'), 'guest_market_segments'),
  ]);

  // ── Pipeline ──────────────────────────────────────────────────────────
  const LEAD_DEAD = new Set(['Lost', 'Closed Lost']);
  const LEAD_WON = new Set(['Converted', 'Won', 'Closed Won']);
  const isWon = (l: any) => LEAD_WON.has(l.stage) || !!l.conversion_date;
  const openLeads = salesLeads.filter(l => !LEAD_DEAD.has(l.stage) && !isWon(l));
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.opportunity_value) || 0), 0);
  const leadsCur = salesLeads.filter(l => inWindow(l.created_at, curStart, now));
  const leadsPrev = salesLeads.filter(l => inWindow(l.created_at, prevStart, prevEnd));

  const stageOrder = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Converted'];
  const stageOf = (l: any) => {
    if (isWon(l)) return 'Converted';
    if (LEAD_DEAD.has(l.stage)) return 'Lost';
    return l.stage || 'Prospect';
  };
  const stageAgg = new Map<string, { count: number; value: number }>();
  for (const l of salesLeads) {
    const s = stageOf(l);
    if (s === 'Lost') continue;
    const cur = stageAgg.get(s) || { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(l.opportunity_value) || 0;
    stageAgg.set(s, cur);
  }
  const totalPipelineCount = [...stageAgg.values()].reduce((s, a) => s + a.count, 0);
  const pipelineFunnel: PipelineStage[] = stageOrder
    .map(stage => ({
      stage,
      count: stageAgg.get(stage)?.count || 0,
      value: Math.round((stageAgg.get(stage)?.value || 0) * 100) / 100,
      sharePct: totalPipelineCount > 0
        ? Math.round(((stageAgg.get(stage)?.count || 0) / totalPipelineCount) * 1000) / 10 : 0,
    }));

  // ── Conversion ────────────────────────────────────────────────────────
  const leadConversion = leadsCur.length > 0 ? (leadsCur.filter(isWon).length / leadsCur.length) * 100 : 0;
  const prevLeadConversion = leadsPrev.length > 0 ? (leadsPrev.filter(isWon).length / leadsPrev.length) * 100 : 0;

  const propSent = salesProposals.filter(p => p.sent_date || ['Sent', 'Accepted', 'Rejected'].includes(p.status));
  const propAccepted = propSent.filter(p => p.accepted_date || p.status === 'Accepted');
  const proposalAcceptance = propSent.length > 0 ? (propAccepted.length / propSent.length) * 100 : 0;
  const proposalsInWindow = salesProposals.filter(p => inWindow(p.created_at, curStart, now)).length;
  const prevProposalsInWindow = salesProposals.filter(p => inWindow(p.created_at, prevStart, prevEnd)).length;

  const actCur = salesActivities.filter(a => inWindow(a.created_at, curStart, now));
  const actDone = actCur.filter(a => ['Completed', 'Done'].includes(a.status)).length;
  const activityCompletion = actCur.length > 0 ? (actDone / actCur.length) * 100 : 0;
  const pendingActivities = salesActivities.filter(a => !['Completed', 'Done', 'Cancelled'].includes(a.status)).length;

  // ── Corporate production ──────────────────────────────────────────────
  const corpRes = (start: Date, end: Date) =>
    reservations.filter(r =>
      r.channel === 'Corporate' && inWindow(r.created_at, start, end) && r.status !== 'Cancelled');
  const corpResCur = corpRes(curStart, now);
  const corpResPrev = corpRes(prevStart, prevEnd);
  const corpRevenue = corpResCur.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const prevCorpRevenue = corpResPrev.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const contractValue = salesContracts
    .filter(c => c.status === 'Active')
    .reduce((s, c) => s + (Number(c.total_value) || 0), 0);
  const avgContractValue = salesContracts.filter(c => c.status === 'Active').length > 0
    ? contractValue / salesContracts.filter(c => c.status === 'Active').length : 0;
  const corpUnpaid = corporateAccounts.reduce((s, a) => s + (Number(a.unpaid_balance) || 0), 0);

  // ── OTA performance ───────────────────────────────────────────────────
  const otaChannelIds = new Set(
    channelConnections.filter(c => /ota/i.test(c.channel_type || '')).map(c => String(c.id)),
  );
  const perfCur = channelPerf.filter(p => inWindow(p.date, curStart, now));
  const perfPrev = channelPerf.filter(p => inWindow(p.date, prevStart, prevEnd));
  const otaPerf = perfCur.filter(p => otaChannelIds.has(String(p.channel_id)));
  const otaPerfPrev = perfPrev.filter(p => otaChannelIds.has(String(p.channel_id)));
  const otaRevenue = otaPerf.reduce((s, p) => s + (Number(p.net_revenue) || Number(p.gross_revenue) || 0), 0);
  const prevOtaRevenue = otaPerfPrev.reduce((s, p) => s + (Number(p.net_revenue) || Number(p.gross_revenue) || 0), 0);
  const otaGross = otaPerf.reduce((s, p) => s + (Number(p.gross_revenue) || 0), 0);
  const otaCommission = otaPerf.reduce((s, p) => s + (Number(p.commission_amount) || 0), 0);
  const otaCommissionRate = otaGross > 0 ? (otaCommission / otaGross) * 100 : 0;
  const otaBookings = otaPerf.reduce((s, p) => s + (Number(p.bookings_confirmed) || 0), 0);

  // Fallback OTA share from reservation channels when channel manager is empty.
  const resOtaCur = reservations.filter(r =>
    /booking|expedia|agoda|airbnb|ota/i.test(r.channel || '') && inWindow(r.created_at, curStart, now));
  const resOtaRevenue = resOtaCur.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const effectiveOtaRevenue = otaRevenue > 0 ? otaRevenue : resOtaRevenue;

  // ── Campaigns ─────────────────────────────────────────────────────────
  const campaigns: CampaignRow[] = salesCampaigns.map(c => ({
    name: c.campaign_name,
    type: c.campaign_type || 'General',
    status: c.status || 'Draft',
    budget: Number(c.budget) || 0,
    spent: Number(c.spent) || 0,
    leads: Number(c.leads) || 0,
    conversions: Number(c.conversions) || 0,
  }));
  const campaignSpend = campaigns.reduce((s, c) => s + c.spent, 0);
  const campaignBudget = campaigns.reduce((s, c) => s + c.budget, 0);
  const campaignLeads = campaigns.reduce((s, c) => s + c.leads, 0);
  const campaignConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
  const budgetUtilization = campaignBudget > 0 ? (campaignSpend / campaignBudget) * 100 : 0;
  const costPerConversion = campaignConversions > 0 ? campaignSpend / campaignConversions : 0;
  const costPerLead = campaignLeads > 0 ? campaignSpend / campaignLeads : 0;

  // ── Segments ──────────────────────────────────────────────────────────
  const segmentNameById = new Map<string, string>(marketSegments.map(s => [String(s.id), s.segment_name]));
  const segCounts = new Map<string, number>();
  for (const gs of guestSegments) {
    const name = segmentNameById.get(String(gs.segment_id)) || 'Unclassified';
    segCounts.set(name, (segCounts.get(name) || 0) + 1);
  }
  const totalSegmented = [...segCounts.values()].reduce((s, n) => s + n, 0);
  const segmentMix = [...segCounts.entries()]
    .map(([name, count]) => ({
      name, guests: count,
      sharePct: totalSegmented > 0 ? Math.round((count / totalSegmented) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.guests - a.guests)
    .slice(0, 8);

  // ── Acquisition ───────────────────────────────────────────────────────
  const newCorpAccounts = corporateAccounts.filter(a => inWindow(a.created_at, curStart, now)).length;
  const prevNewCorpAccounts = corporateAccounts.filter(a => inWindow(a.created_at, prevStart, prevEnd)).length;
  const cac = leadsCur.length > 0 && campaignSpend > 0 ? campaignSpend / leadsCur.length : costPerLead;

  const sm = (
    id: string, name: string, value: number, previousValue: number | null,
    target: number, unit: string, category: SalesCategory, lowerIsBetter = false,
  ): SalesMetric => {
    const v = Math.round(value * 100) / 100;
    return {
      id, name, value: v,
      previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
      target, unit, category, lowerIsBetter,
      trend: kpiTrend(v, previousValue),
      status: target === 0 ? 'on-track' : kpiStatus(v, target, target * 0.75, lowerIsBetter),
    };
  };

  const metrics: SalesMetric[] = [
    // Pipeline
    sm('pipeline_value', 'Pipeline Value', pipelineValue, null, 0, 'currency', 'pipeline'),
    sm('open_leads', 'Open Leads', openLeads.length, null, 0, 'count', 'pipeline'),
    sm('proposals_sent', 'Proposals Sent', proposalsInWindow, prevProposalsInWindow, 0, 'count', 'pipeline'),
    sm('pending_activities', 'Pending Activities', pendingActivities, null, 15, 'count', 'pipeline', true),
    // Conversion
    sm('lead_conversion', 'Lead Conversion Rate', leadConversion, prevLeadConversion, 25, '%', 'conversion'),
    sm('proposal_acceptance', 'Proposal Acceptance', proposalAcceptance, null, 50, '%', 'conversion'),
    sm('activity_completion', 'Activity Completion', activityCompletion, null, 80, '%', 'conversion'),
    // Corporate
    sm('corporate_revenue', 'Corporate Revenue', corpRevenue, prevCorpRevenue, 0, 'currency', 'corporate'),
    sm('corporate_bookings', 'Corporate Bookings', corpResCur.length, corpResPrev.length, 0, 'count', 'corporate'),
    sm('active_contracts_value', 'Active Contracts Value', contractValue, null, 0, 'currency', 'corporate'),
    sm('avg_contract_value', 'Avg Contract Value', avgContractValue, null, 0, 'currency', 'corporate'),
    sm('corporate_unpaid', 'Corporate Unpaid Balance', corpUnpaid, null, 0, 'currency', 'corporate', true),
    // OTA
    sm('ota_revenue', 'OTA Revenue', effectiveOtaRevenue, otaRevenue > 0 ? prevOtaRevenue : null, 0, 'currency', 'ota'),
    sm('ota_commission_rate', 'OTA Commission Rate', otaCommissionRate, null, 18, '%', 'ota', true),
    sm('ota_bookings', 'OTA Bookings', otaBookings, null, 0, 'count', 'ota'),
    // Campaign
    sm('campaign_spend', 'Campaign Spend', campaignSpend, null, 0, 'currency', 'campaign'),
    sm('budget_utilization', 'Budget Utilization', budgetUtilization, null, 90, '%', 'campaign'),
    sm('campaign_leads', 'Campaign Leads', campaignLeads, null, 0, 'count', 'campaign'),
    sm('cost_per_conversion', 'Cost per Conversion', costPerConversion, null, 0, 'currency', 'campaign', true),
    // Acquisition
    sm('new_leads', 'New Leads', leadsCur.length, leadsPrev.length, 0, 'count', 'acquisition'),
    sm('cost_per_lead', 'Cost per Lead', cac, null, 100, 'currency', 'acquisition', true),
    sm('new_corporate_accounts', 'New Corporate Accounts', newCorpAccounts, prevNewCorpAccounts, 0, 'count', 'acquisition'),
    sm('total_corporate_accounts', 'Corporate Accounts', corporateAccounts.length, null, 0, 'count', 'acquisition'),
  ];

  for (const seg of segmentMix.slice(0, 4)) {
    metrics.push(sm(
      `seg_${seg.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      `${seg.name} Segment`, seg.sharePct, null, 0, '%', 'segments',
    ));
  }

  await applyConfiguredTargets(metrics);

  const result = {
    propertyId: propertyId || null,
    days: daysCount,
    generatedAt: now.toISOString(),
    metrics,
    pipelineFunnel,
    campaigns,
    segmentMix,
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ─── F&B Intelligence ────────────────────────────────────────────────────────

type FbCategory = 'revenue' | 'outlet' | 'menu' | 'cost' | 'waste' | 'efficiency';

interface FbMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: FbCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/fb-intelligence?days=&propertyId=
// Revenue/covers/avg check from orders + outlets; outlet performance, menu
// engineering (Star/Plow Horse/Puzzle/Dog), cost analytics and kitchen
// efficiency from the fb_*_analytics period tables; minibar from
// fb_minibar_consumption.
// outlets/orders/menu_items have no property_id (enterprise-level); the
// fb_*_analytics tables are property-scoped.
router.get('/fb-intelligence', authenticate, execView, execCache('fb-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const now = new Date();
    const prevFrom = dayStr(prevStart);

    const ordersQ = () => {
      let q = supabaseAdmin!.from('orders')
        .select('id,outlet_id,customer_type,status,subtotal,total_amount,discount_amount,service_charge,meal_period,is_complimentary,created_at')
        .gte('created_at', prevFrom);
      return q;
    };
    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      orders, outlets, menuItems, minibar,
      outletAnalytics, menuEngineering, costAnalytics, kitchenAnalytics,
    ] = await Promise.all([
      kpiFetchRows(ordersQ(), 'orders'),
      kpiFetchRows(supabaseAdmin!.from('outlets').select('id,name,type,is_active'), 'outlets'),
      kpiFetchRows(supabaseAdmin!.from('menu_items').select('id,name,category,selling_price,is_active,outlet_id'), 'menu_items'),
      kpiFetchRows(supabaseAdmin!.from('fb_minibar_consumption')
        .select('quantity,unit_price,total_amount,consumed_at').gte('consumed_at', prevFrom), 'fb_minibar_consumption'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_outlet_analytics')
        .select('outlet_id,period,revenue,covers,avg_check,rev_pash,turnover')), 'fb_outlet_analytics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_menu_engineering')
        .select('period,item_name,category,sold,price,cost,margin,food_cost_pct,classification')), 'fb_menu_engineering'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_cost_analytics')
        .select('outlet_id,period,food_cost_pct,bev_cost_pct,waste,variance,theoretical,actual')), 'fb_cost_analytics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_kitchen_analytics')
        .select('outlet_id,period,station,avg_ticket_time_min,volume,accuracy,downtime_min')), 'fb_kitchen_analytics'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const activeOrders = orders.filter((o: any) => !['Void', 'Cancelled'].includes(o.status));
    const curOrders = activeOrders.filter((o: any) => inWindow(o.created_at, curStart, now));
    const prevOrders = activeOrders.filter((o: any) => inWindow(o.created_at, prevStart, curStart));
    const curRevenue = sum(curOrders, 'total_amount');
    const prevRevenue = sum(prevOrders, 'total_amount');
    const curMinibar = sum(minibar.filter((m: any) => inWindow(m.consumed_at, curStart, now)), 'total_amount');
    const prevMinibar = sum(minibar.filter((m: any) => inWindow(m.consumed_at, prevStart, curStart)), 'total_amount');

    const outletName: Record<string, string> = {};
    const outletType: Record<string, string> = {};
    outlets.forEach((o: any) => { outletName[o.id] = o.name; outletType[o.id] = o.type; });
    const revByType = (list: any[]) => {
      const t: Record<string, number> = {};
      list.forEach((o: any) => { t[outletType[o.outlet_id] || 'Other'] = (t[outletType[o.outlet_id] || 'Other'] || 0) + (Number(o.total_amount) || 0); });
      return t;
    };
    const curByType = revByType(curOrders);
    const prevByType = revByType(prevOrders);

    // Outlet performance: order revenue in window per outlet, enriched with fb_outlet_analytics (MTD)
    const oaMtd = outletAnalytics.filter((r: any) => r.period === 'MTD');
    const oaByOutlet: Record<string, any> = {};
    oaMtd.forEach((r: any) => { oaByOutlet[r.outlet_id] = r; });
    const ordersByOutlet: Record<string, { revenue: number; orders: number }> = {};
    curOrders.forEach((o: any) => {
      const e = ordersByOutlet[o.outlet_id] || (ordersByOutlet[o.outlet_id] = { revenue: 0, orders: 0 });
      e.revenue += Number(o.total_amount) || 0; e.orders += 1;
    });
    const outletIds = new Set([...Object.keys(ordersByOutlet), ...Object.keys(oaByOutlet), ...outlets.map((o: any) => o.id)]);
    const outletPerformance = [...outletIds]
      .filter(id => outletName[id])
      .map(id => {
        const o = ordersByOutlet[id] || { revenue: 0, orders: 0 };
        const a = oaByOutlet[id] || {};
        return {
          name: outletName[id],
          type: outletType[id] || 'Restaurant',
          revenue: o.revenue || Number(a.revenue) || 0,
          orders: o.orders,
          covers: Number(a.covers) || 0,
          avgCheck: o.orders ? o.revenue / o.orders : Number(a.avg_check) || 0,
          turnover: Number(a.turnover) || 0,
        };
      })
      .filter(o => o.revenue > 0 || o.orders > 0 || o.covers > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // Menu engineering — prefer MTD period rows
    const meRows = menuEngineering.filter((r: any) => r.period === 'MTD');
    const meSource = meRows.length ? meRows : menuEngineering;
    const classCount = (c: string) => meSource.filter((r: any) => r.classification === c).length;
    const menuEng = ['Star', 'Plow Horse', 'Puzzle', 'Dog'].map(c => {
      const rows = meSource.filter((r: any) => r.classification === c);
      return { classification: c, count: rows.length, sold: sum(rows, 'sold'), margin: sum(rows, 'margin') };
    });
    const topMenuItems = [...meSource]
      .sort((a: any, b: any) => (Number(b.margin) || 0) - (Number(a.margin) || 0))
      .slice(0, 10)
      .map((r: any) => ({
        name: r.item_name, category: r.category, classification: r.classification,
        sold: Number(r.sold) || 0, price: Number(r.price) || 0,
        margin: Number(r.margin) || 0, foodCostPct: Number(r.food_cost_pct) || 0,
      }));

    // Cost analytics — MTD rows aggregated
    const caMtd = costAnalytics.filter((r: any) => r.period === 'MTD');
    const ca = caMtd.length ? caMtd : costAnalytics;
    const avgOf = (arr: any[], f: string) => arr.length ? sum(arr, f) / arr.length : 0;
    const foodCostPct = avgOf(ca.filter((r: any) => Number(r.food_cost_pct) > 0), 'food_cost_pct');
    const bevCostPct = avgOf(ca.filter((r: any) => Number(r.bev_cost_pct) > 0), 'bev_cost_pct');
    const wasteVal = sum(ca, 'waste');
    const theoretical = sum(ca, 'theoretical');
    const actual = sum(ca, 'actual');

    // Kitchen analytics — MTD rows, weighted by volume
    const kaMtd = kitchenAnalytics.filter((r: any) => r.period === 'MTD');
    const ka = kaMtd.length ? kaMtd : kitchenAnalytics;
    const totalVolume = sum(ka, 'volume');
    const weightedAvg = (f: string) => totalVolume
      ? ka.reduce((s: number, r: any) => s + (Number(r[f]) || 0) * (Number(r.volume) || 0), 0) / totalVolume : 0;
    const avgTicketMin = weightedAvg('avg_ticket_time_min');
    const accuracy = weightedAvg('accuracy');
    const downtime = sum(ka, 'downtime_min');
    const avgTurnover = avgOf(ca.length ? outletPerformance.filter(o => o.turnover > 0) : [], 'turnover');

    // Meal period mix
    const mealPeriodMix = ['Breakfast', 'Lunch', 'Dinner', 'Brunch', 'Tea Time', 'Morning Snack', 'Afternoon Snack']
      .map(p => {
        const rows = curOrders.filter((o: any) => o.meal_period === p);
        return { period: p, orders: rows.length, revenue: sum(rows, 'total_amount') };
      }).filter(m => m.orders > 0);

    const metrics: FbMetric[] = [];
    const push = (id: string, name: string, category: FbCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Revenue
    push('fb_revenue', 'F&B Revenue', 'revenue', curRevenue, 300000, 200000, 'currency', false, prevRevenue);
    push('fb_restaurant_rev', 'Restaurant Revenue', 'revenue', curByType.Restaurant || 0, 200000, 120000, 'currency', false, prevByType.Restaurant ?? null);
    push('fb_bar_rev', 'Bar Revenue', 'revenue', curByType.Bar || 0, 80000, 50000, 'currency', false, prevByType.Bar ?? null);
    push('fb_roomservice_rev', 'Room Service Revenue', 'revenue', curByType.RoomService || 0, 20000, 10000, 'currency', false, prevByType.RoomService ?? null);
    push('fb_minibar_rev', 'Minibar Revenue', 'revenue', curMinibar, 10000, 5000, 'currency', false, prevMinibar);
    push('fb_covers', 'Covers Served', 'revenue', sum(oaMtd, 'covers') || curOrders.length, 5000, 3000, 'count', false, null);
    push('fb_avg_check', 'Average Check', 'revenue',
      curOrders.length ? curRevenue / curOrders.length : 0, 50, 30, 'currency', false,
      prevOrders.length ? prevRevenue / prevOrders.length : null);

    // Outlet
    push('fb_active_outlets', 'Active Outlets', 'outlet', outlets.filter((o: any) => o.is_active).length, 5, 3, 'count');
    push('fb_top_outlet', 'Top Outlet Revenue', 'outlet', outletPerformance[0]?.revenue || 0, 150000, 80000, 'currency');
    push('fb_table_turnover', 'Table Turnover', 'outlet', avgTurnover, 2.5, 1.8, 'x');
    push('fb_discounts', 'Discounts Given', 'outlet', sum(curOrders, 'discount_amount'), 5000, 10000, 'currency', true,
      prevOrders.length ? sum(prevOrders, 'discount_amount') : null);

    // Menu
    push('fb_menu_items', 'Active Menu Items', 'menu', menuItems.filter((m: any) => m.is_active).length, 150, 100, 'count');
    push('fb_star_items', 'Star Items', 'menu', classCount('Star'), 20, 10, 'count');
    push('fb_plowhorse_items', 'Plow Horse Items', 'menu', classCount('Plow Horse'), 30, 15, 'count');
    push('fb_dog_items', 'Dog Items', 'menu', classCount('Dog'), 10, 25, 'count', true);

    // Cost
    push('fb_food_cost', 'Food Cost %', 'cost', foodCostPct, 35, 40, '%', true);
    push('fb_bev_cost', 'Beverage Cost %', 'cost', bevCostPct, 30, 38, '%', true);
    push('fb_actual_cost', 'Actual F&B Cost', 'cost', actual || theoretical, 105000, 130000, 'currency', true);
    push('fb_cost_variance', 'Cost Variance', 'cost', avgOf(ca.filter((r: any) => Number(r.variance) !== 0), 'variance'), 2, 5, '%', true);

    // Waste
    push('fb_waste_value', 'Food & Beverage Waste', 'waste', wasteVal, 8000, 15000, 'currency', true);
    push('fb_waste_pct', 'Waste % of Revenue', 'waste', curRevenue ? (wasteVal / curRevenue) * 100 : 0, 3, 5, '%', true);

    // Efficiency
    push('fb_ticket_time', 'Avg Ticket Time', 'efficiency', avgTicketMin, 15, 20, 'min', true);
    push('fb_kitchen_volume', 'Kitchen Volume', 'efficiency', totalVolume, 3000, 1500, 'count');
    push('fb_order_accuracy', 'Order Accuracy', 'efficiency', accuracy, 95, 90, '%');
    push('fb_station_downtime', 'Station Downtime', 'efficiency', downtime, 60, 180, 'min', true);

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, outletPerformance, menuEngineering: menuEng, topMenuItems, mealPeriodMix,
    });
  } catch (err: any) {
    console.error('[exec-fb-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute F&B intelligence' });
  }
});

// ─── Housekeeping Intelligence ───────────────────────────────────────────────

type HkCategory = 'productivity' | 'turnaround' | 'quality' | 'linen' | 'costs' | 'status';

interface HkMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: HkCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/hk-intelligence?days=&propertyId=
// Productivity/turnaround from housekeeping_task_mgmt durations, quality from
// room_inspections + hk_staff_productivity, linen from hk_linen_stock/log,
// laundry from hk_laundry_jobs, room status from rooms, issues from
// housekeeping_maintenance_issues, alerts from hk_dashboard_alerts.
router.get('/hk-intelligence', authenticate, execView, execCache('hk-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const now = new Date();
    const prevFrom = dayStr(prevStart);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      tasks, inspections, productivity, linenStock, linenLog,
      laundryJobs, maintIssues, rooms, hkAlerts,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt')
        .select('id,type,status,priority,location,assigned_to,due_date,progress,estimated_duration,actual_duration,started_at,completed_at,created_at')
        .gte('created_at', prevFrom)), 'housekeeping_task_mgmt'),
      kpiFetchRows(scoped(supabaseAdmin!.from('room_inspections')
        .select('id,room_number,inspector,inspection_date,result')
        .gte('inspection_date', prevFrom)), 'room_inspections'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_staff_productivity')
        .select('employee_id,staff_id,rooms_cleaned,hours,inspection_score,productivity_score,period_date')
        .gte('period_date', prevFrom)), 'hk_staff_productivity'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_linen_stock')
        .select('type,par,in_stock,in_use,at_laundry,damaged,lost')), 'hk_linen_stock'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_linen_log')
        .select('operation,type,quantity,location,created_at')
        .gte('created_at', prevFrom)), 'hk_linen_log'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_laundry_jobs')
        .select('id,category,service_type,pieces,status,requested_at,created_at')
        .gte('created_at', prevFrom)), 'hk_laundry_jobs'),
      kpiFetchRows(scoped(supabaseAdmin!.from('housekeeping_maintenance_issues')
        .select('id,type,room,reported_by,reported_at,stage')
        .gte('created_at', prevFrom)), 'housekeeping_maintenance_issues'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id,status')), 'rooms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_dashboard_alerts')
        .select('id,status').eq('status', 'Active')), 'hk_dashboard_alerts'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const isDone = (s: string) => ['Completed', 'Verified'].includes(s);
    const curTasks = tasks.filter((t: any) => inWindow(t.created_at, curStart, now));
    const completedCur = tasks.filter((t: any) => isDone(t.status) && inWindow(t.completed_at, curStart, now));
    const completedPrev = tasks.filter((t: any) => isDone(t.status) && inWindow(t.completed_at, prevStart, curStart));

    // Duration helpers: prefer actual_duration (minutes), fall back to started→completed
    const durationMin = (t: any): number | null => {
      if (Number(t.actual_duration) > 0) return Number(t.actual_duration);
      if (t.started_at && t.completed_at) {
        const ms = new Date(t.completed_at).getTime() - new Date(t.started_at).getTime();
        if (ms > 0) return ms / 60000;
      }
      return null;
    };
    const avgDuration = (list: any[]) => {
      const ds = list.map(durationMin).filter((d): d is number => d !== null);
      return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
    };
    // Turnaround: Checkout Cleaning tasks — created_at (checkout time) → completed_at
    const checkoutTasks = completedCur.filter((t: any) => /checkout/i.test(t.type || ''));
    const checkoutPrev = completedPrev.filter((t: any) => /checkout/i.test(t.type || ''));
    const turnaround = (list: any[]) => {
      const ds = list.map((t: any) => new Date(t.completed_at).getTime() - new Date(t.created_at).getTime())
        .filter(ms => ms > 0).map(ms => ms / 60000);
      return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
    };

    const curInsp = inspections.filter((i: any) => inWindow(i.inspection_date, curStart, now));
    const prevInsp = inspections.filter((i: any) => inWindow(i.inspection_date, prevStart, curStart));
    const passOf = (list: any[]) => {
      const done = list.filter((i: any) => !/pending/i.test(i.result || ''));
      return done.length ? (done.filter((i: any) => /pass/i.test(i.result || '')).length / done.length) * 100 : 0;
    };
    const curProd = productivity.filter((p: any) => inWindow(p.period_date, curStart, now));
    const prevProd = productivity.filter((p: any) => inWindow(p.period_date, prevStart, curStart));
    const avgScore = (list: any[], f: string) => list.length ? sum(list, f) / list.length : 0;

    const linenTotal = linenStock.reduce((s, l: any) => s + (Number(l.in_stock) || 0) + (Number(l.in_use) || 0) + (Number(l.at_laundry) || 0), 0);
    const linenBelowPar = linenStock.filter((l: any) => Number(l.in_stock) < Number(l.par)).length;
    const linenLossQty = linenStock.reduce((s, l: any) => s + (Number(l.lost) || 0) + (Number(l.damaged) || 0), 0);
    const curLinenLog = linenLog.filter((l: any) => inWindow(l.created_at, curStart, now));
    const prevLinenLog = linenLog.filter((l: any) => inWindow(l.created_at, prevStart, curStart));
    const linenEvents = (list: any[], ops: string[]) =>
      sum(list.filter((l: any) => ops.some(op => l.operation?.includes(op))), 'quantity');

    const curLaundry = laundryJobs.filter((j: any) => inWindow(j.created_at, curStart, now));
    const prevLaundry = laundryJobs.filter((j: any) => inWindow(j.created_at, prevStart, curStart));
    const activeLaundry = laundryJobs.filter((j: any) => !['Delivered', 'Cancelled'].includes(j.status)).length;

    const openIssues = maintIssues.filter((i: any) => !['Room Released', 'Verified'].includes(i.stage)).length;
    const curIssues = maintIssues.filter((i: any) => inWindow(i.created_at, curStart, now)).length;
    const prevIssues = maintIssues.filter((i: any) => inWindow(i.created_at, prevStart, curStart)).length;

    // Room status board — group live statuses into display buckets
    const bucket = (s: string): string => {
      const v = (s || '').toLowerCase();
      if (v.includes('out of')) return 'Out of Service';
      if (v.includes('inspect')) return 'Inspected';
      if (v.includes('dirty')) return 'Dirty';
      if (v.includes('clean')) return 'Clean';
      if (v.includes('occup')) return 'Occupied';
      return 'Other';
    };
    const statusBuckets = ['Clean', 'Inspected', 'Dirty', 'Occupied', 'Out of Service'];
    const roomStatus = statusBuckets.map(b => ({ status: b, count: rooms.filter((r: any) => bucket(r.status) === b).length }));
    const oosRooms = roomStatus.find(r => r.status === 'Out of Service')?.count || 0;
    const dirtyRooms = roomStatus.find(r => r.status === 'Dirty')?.count || 0;
    const availablePct = rooms.length ? ((rooms.length - oosRooms) / rooms.length) * 100 : 0;

    // Staff leaderboard from completed tasks
    const staffMap: Record<string, { tasks: number; mins: number }> = {};
    completedCur.forEach((t: any) => {
      const who = t.assigned_to || 'Unassigned';
      const e = staffMap[who] || (staffMap[who] = { tasks: 0, mins: 0 });
      e.tasks += 1; e.mins += durationMin(t) || 0;
    });
    const staffLeaderboard = Object.entries(staffMap)
      .filter(([name]) => name !== 'Unassigned')
      .map(([name, e]) => ({
        name, tasksCompleted: e.tasks,
        roomsPerDay: Math.round((e.tasks / days) * 100) / 100,
        avgMinutes: e.tasks ? Math.round((e.mins / e.tasks) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.tasksCompleted - a.tasksCompleted).slice(0, 8);

    // Task type breakdown
    const typeMap: Record<string, { total: number; done: number }> = {};
    curTasks.forEach((t: any) => {
      const e = typeMap[t.type] || (typeMap[t.type] = { total: 0, done: 0 });
      e.total += 1; if (isDone(t.status)) e.done += 1;
    });
    const taskTypes = Object.entries(typeMap)
      .map(([type, e]) => ({ type, total: e.total, completed: e.done, completionPct: e.total ? Math.round((e.done / e.total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.total - a.total).slice(0, 8);

    const metrics: HkMetric[] = [];
    const push = (id: string, name: string, category: HkCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Productivity
    push('hk_tasks_completed', 'Tasks Completed', 'productivity', completedCur.length, 30, 15, 'count', false, completedPrev.length);
    push('hk_rooms_per_day', 'Rooms per Day', 'productivity', completedCur.length / days, 2, 1, 'count');
    push('hk_cleaning_time', 'Avg Cleaning Time', 'productivity', avgDuration(completedCur), 30, 45, 'min', true, completedPrev.length ? avgDuration(completedPrev) : null);
    push('hk_productivity_score', 'Staff Productivity Score', 'productivity', avgScore(curProd, 'productivity_score'), 80, 60, '%', false, prevProd.length ? avgScore(prevProd, 'productivity_score') : null);
    push('hk_open_tasks', 'Open Tasks', 'productivity', curTasks.filter((t: any) => !isDone(t.status)).length, 10, 25, 'count', true);

    // Turnaround
    push('hk_turnaround', 'Checkout Turnaround', 'turnaround', turnaround(checkoutTasks), 45, 90, 'min', true, checkoutPrev.length ? turnaround(checkoutPrev) : null);
    push('hk_on_time', 'On-Time Completion', 'turnaround',
      completedCur.length ? (completedCur.filter((t: any) => !t.due_date || !t.completed_at || new Date(t.completed_at) <= new Date(new Date(t.due_date).getTime() + 86400000)).length / completedCur.length) * 100 : 0,
      90, 70, '%');
    push('hk_est_accuracy', 'Estimate Accuracy', 'turnaround',
      (() => { const withEst = completedCur.filter((t: any) => Number(t.estimated_duration) > 0 && durationMin(t) !== null);
        return withEst.length ? (withEst.filter((t: any) => (durationMin(t) || 0) <= Number(t.estimated_duration) * 1.25).length / withEst.length) * 100 : 0; })(),
      85, 65, '%');

    // Quality
    push('hk_inspection_score', 'Avg Inspection Score', 'quality', avgScore(curProd, 'inspection_score'), 95, 85, '/100', false, prevProd.length ? avgScore(prevProd, 'inspection_score') : null);
    push('hk_pass_rate', 'Inspection Pass Rate', 'quality', passOf(curInsp), 90, 75, '%', false, prevInsp.length ? passOf(prevInsp) : null);
    push('hk_inspections', 'Inspections Done', 'quality', curInsp.length, 20, 8, 'count', false, prevInsp.length);
    push('hk_maint_issues', 'Open Maintenance Issues', 'quality', openIssues, 3, 8, 'count', true, prevIssues);
    push('hk_active_alerts', 'Active Dashboard Alerts', 'quality', hkAlerts.length, 3, 10, 'count', true);

    // Linen
    push('hk_linen_stock', 'Linen In Stock', 'linen', linenTotal, sum(linenStock, 'par'), sum(linenStock, 'par') * 0.7, 'count');
    push('hk_below_par', 'Below-Par Linen Items', 'linen', linenBelowPar, 2, 6, 'count', true);
    push('hk_linen_loss', 'Linen Loss Rate', 'linen', linenTotal ? (linenLossQty / linenTotal) * 100 : 0, 3, 6, '%', true);
    push('hk_linen_damaged', 'Damaged/Lost (Period)', 'linen', linenEvents(curLinenLog, ['Damaged', 'Lost']), 10, 25, 'count', true, prevLinenLog.length ? linenEvents(prevLinenLog, ['Damaged', 'Lost']) : null);

    // Costs (laundry volume — no cost field exists on hk_laundry_jobs)
    push('hk_laundry_pieces', 'Laundry Pieces', 'costs', sum(curLaundry, 'pieces'), 400, 150, 'count', false, prevLaundry.length ? sum(prevLaundry, 'pieces') : null);
    push('hk_laundry_jobs', 'Laundry Jobs', 'costs', curLaundry.length, 40, 15, 'count', false, prevLaundry.length);
    push('hk_laundry_active', 'Active Laundry Jobs', 'costs', activeLaundry, 10, 20, 'count', true);

    // Status
    push('hk_oos_rooms', 'Out of Service Rooms', 'status', oosRooms, 3, 8, 'count', true);
    push('hk_dirty_rooms', 'Dirty Rooms', 'status', dirtyRooms, 10, 25, 'count', true);
    push('hk_room_availability', 'Room Availability', 'status', availablePct, 95, 85, '%');

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, roomStatus, staffLeaderboard, taskTypes,
      issuesReported: curIssues,
    });
  } catch (err: any) {
    console.error('[exec-hk-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute housekeeping intelligence' });
  }
});

// ─── Engineering Intelligence ────────────────────────────────────────────────

type EngCategory = 'assets' | 'downtime' | 'maintenance' | 'pm' | 'energy' | 'utilities';

interface EngMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: EngCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/eng-intelligence?days=&propertyId=
// Assets from fixed_assets; downtime/maintenance from work_orders +
// corrective_maintenance_tasks + work_requests; PM compliance from pm_schedules;
// energy/utilities from energy_metrics.
router.get('/eng-intelligence', authenticate, execView, execCache('eng-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const now = new Date();
    const prevFrom = prevStart.toISOString();
    const prevFromDate = dayStr(prevStart);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      workOrders, pmSchedules, assets, energy, corrective, workRequests, rooms,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('work_orders')
        .select('id,wo_number,title,type,priority,status,assigned_to,room_number,labor_hours,cost_estimate,actual_cost,created_date,scheduled_date,started_at,completed_at,pm_schedule_id,asset_id')
        .gte('created_date', prevFrom)), 'work_orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('pm_schedules')
        .select('id,schedule_name,frequency,interval_days,next_due_date,last_completed_date,status,priority')), 'pm_schedules'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fixed_assets')
        .select('id,asset_code,asset_name,asset_category,location,purchase_date,purchase_cost,net_book_value,status')), 'fixed_assets'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_metrics')
        .select('metric_date,electricity_kwh,water_liters,gas_m3,diesel_liters,solar_kwh,total_cost,carbon_footprint_tons')
        .gte('metric_date', prevFromDate)), 'energy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('corrective_maintenance_tasks')
        .select('id,cm_number,type,category,priority,status,estimated_cost,actual_cost,reported_date,completed_at')
        .gte('reported_date', prevFrom)), 'corrective_maintenance_tasks'),
      kpiFetchRows(scoped(supabaseAdmin!.from('work_requests')
        .select('id,wr_number,source,priority,type,status,request_date')
        .gte('request_date', prevFrom)), 'work_requests'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id,status')), 'rooms'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const woDone = (s: string) => ['Completed', 'Verified', 'Closed'].includes(s);
    const woOpen = (s: string) => !woDone(s) && s !== 'Cancelled';
    const curWOs = workOrders.filter((w: any) => inWindow(w.created_date, curStart, now));
    const prevWOs = workOrders.filter((w: any) => inWindow(w.created_date, prevStart, curStart));
    const doneCur = workOrders.filter((w: any) => woDone(w.status) && inWindow(w.completed_at, curStart, now));
    const donePrev = workOrders.filter((w: any) => woDone(w.status) && inWindow(w.completed_at, prevStart, curStart));
    const openWOs = workOrders.filter((w: any) => woOpen(w.status));
    const criticalOpen = openWOs.filter((w: any) => ['Critical', 'Urgent', 'High', 'Emergency'].includes(w.priority));

    const resHours = (list: any[]) => {
      const hs = list.map((w: any) => {
        if (w.started_at && w.completed_at) {
          const ms = new Date(w.completed_at).getTime() - new Date(w.started_at).getTime();
          if (ms > 0) return ms / 3600000;
        }
        if (w.created_date && w.completed_at) {
          const ms = new Date(w.completed_at).getTime() - new Date(w.created_date).getTime();
          if (ms > 0) return ms / 3600000;
        }
        return null;
      }).filter((h): h is number => h !== null);
      return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 0;
    };

    // Assets
    const liveAssets = assets.filter((a: any) => !['Disposed', 'Written Off'].includes(a.status));
    const underMaint = assets.filter((a: any) => a.status === 'Under Maintenance').length;
    const assetAvailability = assets.length ? (liveAssets.length - underMaint) / assets.length * 100 : 0;
    const avgAge = liveAssets.length
      ? liveAssets.reduce((s: number, a: any) => s + (a.purchase_date ? (now.getTime() - new Date(a.purchase_date).getTime()) / (365.25 * 86400000) : 0), 0) / liveAssets.length
      : 0;
    const nbv = sum(liveAssets, 'net_book_value');
    const assetCategories = Object.entries(
      liveAssets.reduce((m: Record<string, { count: number; nbv: number }>, a: any) => {
        const c = a.asset_category || 'Other';
        const e = m[c] || (m[c] = { count: 0, nbv: 0 });
        e.count += 1; e.nbv += Number(a.net_book_value) || 0;
        return m;
      }, {}))
      .map(([category, e]) => ({ category, count: e.count, nbv: Math.round(e.nbv * 100) / 100 }))
      .sort((a, b) => b.nbv - a.nbv).slice(0, 8);

    // Corrective / reactive
    const curCorr = corrective.filter((c: any) => inWindow(c.reported_date, curStart, now));
    const prevCorr = corrective.filter((c: any) => inWindow(c.reported_date, prevStart, curStart));
    const openCorr = corrective.filter((c: any) => !['Completed', 'Verified'].includes(c.status)).length;
    const reactiveCost = sum(curCorr, 'actual_cost') + sum(curWOs.filter((w: any) => w.type !== 'Preventive'), 'actual_cost');
    const prevReactiveCost = sum(prevCorr, 'actual_cost') + sum(prevWOs.filter((w: any) => w.type !== 'Preventive'), 'actual_cost');

    // Work requests
    const pendingWRs = workRequests.filter((w: any) => ['Pending', 'Reviewed'].includes(w.status)).length;
    const curWRs = workRequests.filter((w: any) => inWindow(w.request_date, curStart, now)).length;

    // PM compliance
    const activePMs = pmSchedules.filter((p: any) => p.status === 'Active');
    const today = dayStr(now);
    const overduePMs = activePMs.filter((p: any) => p.next_due_date && p.next_due_date < today).length;
    const compliantPMs = activePMs.filter((p: any) => {
      if (!p.last_completed_date || !p.next_due_date) return false;
      const interval = Number(p.interval_days) || 30;
      const lastDone = new Date(p.last_completed_date).getTime();
      return (now.getTime() - lastDone) <= interval * 1.25 * 86400000;
    }).length;
    const pmCompliance = activePMs.length ? (compliantPMs / activePMs.length) * 100 : 0;
    const pmWOsDone = doneCur.filter((w: any) => w.pm_schedule_id).length;

    // Work order status board
    const woStatusOrder = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor', 'Completed', 'Verified', 'Closed'];
    const woStatusBoard = woStatusOrder
      .map(s => ({ status: s, count: workOrders.filter((w: any) => w.status === s).length }))
      .filter(s => s.count > 0);

    // Energy / utilities (window sums)
    const curEnergy = energy.filter((e: any) => inWindow(e.metric_date, curStart, now));
    const prevEnergy = energy.filter((e: any) => inWindow(e.metric_date, prevStart, curStart));
    const eSum = (list: any[], f: string) => sum(list, f);
    const energyBreakdown = [
      { type: 'Electricity', unit: 'kWh', usage: eSum(curEnergy, 'electricity_kwh'), prevUsage: eSum(prevEnergy, 'electricity_kwh') },
      { type: 'Water', unit: 'liters', usage: eSum(curEnergy, 'water_liters'), prevUsage: eSum(prevEnergy, 'water_liters') },
      { type: 'Natural Gas', unit: 'm³', usage: eSum(curEnergy, 'gas_m3'), prevUsage: eSum(prevEnergy, 'gas_m3') },
      { type: 'Diesel/Fuel', unit: 'liters', usage: eSum(curEnergy, 'diesel_liters'), prevUsage: eSum(prevEnergy, 'diesel_liters') },
      { type: 'Solar', unit: 'kWh', usage: eSum(curEnergy, 'solar_kwh'), prevUsage: eSum(prevEnergy, 'solar_kwh') },
    ];
    const utilCost = eSum(curEnergy, 'total_cost');
    const prevUtilCost = prevEnergy.length ? eSum(prevEnergy, 'total_cost') : null;

    const metrics: EngMetric[] = [];
    const push = (id: string, name: string, category: EngCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Assets
    push('eng_asset_avail', 'Asset Availability', 'assets', assetAvailability, 95, 85, '%');
    push('eng_assets_total', 'Active Assets', 'assets', liveAssets.length, 50, 20, 'count');
    push('eng_asset_age', 'Avg Asset Age', 'assets', avgAge, 10, 15, 'years', true);
    push('eng_nbv', 'Asset Net Book Value', 'assets', nbv, 0, 0, 'currency');

    // Downtime / reliability
    push('eng_mttr', 'Mean Time to Repair', 'downtime', resHours(doneCur), 8, 24, 'hrs', true, donePrev.length ? resHours(donePrev) : null);
    push('eng_failures', 'Failures Reported', 'downtime', curCorr.length, 5, 15, 'count', true, prevCorr.length);
    push('eng_open_corrective', 'Open Corrective Tasks', 'downtime', openCorr, 5, 15, 'count', true);
    push('eng_labor_hours', 'Labor Hours Logged', 'downtime', sum(doneCur, 'labor_hours'), 200, 400, 'hrs', false, donePrev.length ? sum(donePrev, 'labor_hours') : null);

    // Maintenance
    push('eng_open_wos', 'Open Work Orders', 'maintenance', openWOs.length, 15, 30, 'count', true);
    push('eng_critical_wos', 'Critical Orders', 'maintenance', criticalOpen.length, 3, 8, 'count', true);
    push('eng_resolution', 'Avg Resolution Time', 'maintenance', resHours(doneCur), 24, 48, 'hrs', true, donePrev.length ? resHours(donePrev) : null);
    push('eng_maint_cost', 'Maintenance Cost', 'maintenance', sum(curWOs, 'actual_cost'), 50000, 80000, 'currency', true, prevWOs.length ? sum(prevWOs, 'actual_cost') : null);
    push('eng_reactive_cost', 'Reactive Cost', 'maintenance', reactiveCost, 20000, 40000, 'currency', true, prevReactiveCost || null);
    push('eng_cost_per_room', 'Cost per Room', 'maintenance', rooms.length ? sum(curWOs, 'actual_cost') / rooms.length : 0, 40, 80, 'currency', true);
    push('eng_pending_wrs', 'Pending Work Requests', 'maintenance', pendingWRs, 5, 15, 'count', true);
    push('eng_wrs_received', 'Work Requests Received', 'maintenance', curWRs, 0, 0, 'count');

    // PM
    push('eng_pm_compliance', 'PM Compliance', 'pm', pmCompliance, 85, 60, '%');
    push('eng_pm_overdue', 'Overdue PM Schedules', 'pm', overduePMs, 2, 8, 'count', true);
    push('eng_pm_completed', 'PM Work Orders Done', 'pm', pmWOsDone, 10, 4, 'count');

    // Energy
    push('eng_electricity', 'Electricity', 'energy', eSum(curEnergy, 'electricity_kwh'), 100000, 150000, 'kWh', true, prevEnergy.length ? eSum(prevEnergy, 'electricity_kwh') : null);
    push('eng_gas', 'Natural Gas', 'energy', eSum(curEnergy, 'gas_m3'), 5000, 8000, 'm³', true, prevEnergy.length ? eSum(prevEnergy, 'gas_m3') : null);
    push('eng_solar', 'Solar Generated', 'energy', eSum(curEnergy, 'solar_kwh'), 5000, 1000, 'kWh', false, prevEnergy.length ? eSum(prevEnergy, 'solar_kwh') : null);
    push('eng_carbon', 'Carbon Footprint', 'energy', eSum(curEnergy, 'carbon_footprint_tons'), 50, 100, 'tons', true, prevEnergy.length ? eSum(prevEnergy, 'carbon_footprint_tons') : null);

    // Utilities
    push('eng_water', 'Water Consumption', 'utilities', eSum(curEnergy, 'water_liters'), 500000, 800000, 'liters', true, prevEnergy.length ? eSum(prevEnergy, 'water_liters') : null);
    push('eng_diesel', 'Diesel/Fuel', 'utilities', eSum(curEnergy, 'diesel_liters'), 5000, 10000, 'liters', true, prevEnergy.length ? eSum(prevEnergy, 'diesel_liters') : null);
    push('eng_utility_cost', 'Utility Cost', 'utilities', utilCost, 30000, 50000, 'currency', true, prevUtilCost);
    push('eng_cost_room_util', 'Utility Cost per Room', 'utilities', rooms.length ? utilCost / rooms.length : 0, 200, 400, 'currency', true);

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, woStatusBoard, energyBreakdown, assetCategories,
    });
  } catch (err: any) {
    console.error('[exec-eng-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute engineering intelligence' });
  }
});

// ─── Human Capital Intelligence ──────────────────────────────────────────────

type HcCategory = 'headcount' | 'labor' | 'payroll' | 'attendance' | 'turnover' | 'recruitment' | 'performance' | 'training';

interface HcMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: HcCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/hc-intelligence?days=&propertyId=
// Headcount/payroll from employees; attendance/OT from staff_attendance +
// hr_overtime_requests; labor cost from hr_labor_cost_analysis; turnover from
// hr_offboarding_cases; recruitment from hr_job_openings/candidates/offers;
// performance from hr_performance_reviews + hr_recent_recognition; training
// from hr_training_sessions.
router.get('/hc-intelligence', authenticate, execView, execCache('hc-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const now = new Date();
    const prevFrom = prevStart.toISOString();
    const prevFromDate = dayStr(prevStart);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      employees, attendance, overtimeReqs, laborCost, offboarding,
      jobOpenings, candidates, offers, perfReviews, recognitions,
      trainingSessions, leaveRequests,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('employees')
        .select('id,status,department,position,salary,hire_date,employment_type')), 'employees'),
      kpiFetchRows(scoped(supabaseAdmin!.from('staff_attendance')
        .select('staff_id,staff_name,department_scope,attendance_date,status,hours_worked,overtime_hours')
        .gte('attendance_date', prevFromDate)), 'staff_attendance'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_overtime_requests')
        .select('employee_name,department,hours,status,overtime_date')
        .gte('overtime_date', prevFromDate)), 'hr_overtime_requests'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
        .select('department,period,budget,actual,overtime_hours,overtime_cost')), 'hr_labor_cost_analysis'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_offboarding_cases')
        .select('employee_name,department,termination_date,reason,clearance_status')
        .gte('termination_date', prevFromDate)), 'hr_offboarding_cases'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_job_openings')
        .select('id,title,department,priority,status,posted_at')), 'hr_job_openings'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_candidates')
        .select('id,job_opening_id,name,position,department,stage,status,rating,applied_date')
        .gte('applied_date', prevFromDate)), 'hr_candidates'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_offers')
        .select('candidate_name,position,department,salary,status,sent_date,response_date')
        .gte('sent_date', prevFromDate)), 'hr_offers'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_performance_reviews')
        .select('employee_name,period,due_date,status,goals,completed')), 'hr_performance_reviews'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_recent_recognition')
        .select('id,created_at').gte('created_at', prevFrom)), 'hr_recent_recognition'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_training_sessions')
        .select('title,type,staff_count,session_date,status')
        .gte('session_date', prevFromDate)), 'hr_training_sessions'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_leave_requests')
        .select('employee_name,leave_type,start_date,end_date,days,status,created_at')
        .gte('created_at', prevFrom)), 'hr_leave_requests'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);

    // Headcount
    const active = employees.filter((e: any) => e.status === 'Active');
    const headcount = active.length;
    const byType = (t: string) => active.filter((e: any) => e.employment_type === t).length;
    const newHires = active.filter((e: any) => inWindow(e.hire_date, curStart, now)).length;
    const prevHires = employees.filter((e: any) => inWindow(e.hire_date, prevStart, curStart)).length;

    // Department headcount + labor budget merge
    const deptMap: Record<string, { headcount: number; payroll: number; budget: number; actual: number }> = {};
    active.forEach((e: any) => {
      const d = e.department || 'Unassigned';
      const x = deptMap[d] || (deptMap[d] = { headcount: 0, payroll: 0, budget: 0, actual: 0 });
      x.headcount += 1; x.payroll += Number(e.salary) || 0;
    });
    laborCost.forEach((l: any) => {
      const d = l.department || 'Other';
      const x = deptMap[d] || (deptMap[d] = { headcount: 0, payroll: 0, budget: 0, actual: 0 });
      x.budget += Number(l.budget) || 0; x.actual += Number(l.actual) || 0;
    });
    const deptLabor = Object.entries(deptMap)
      .map(([department, e]) => ({
        department, headcount: e.headcount,
        payroll: Math.round(e.payroll), budget: Math.round(e.budget), actual: Math.round(e.actual),
        variancePct: e.budget ? Math.round(((e.actual - e.budget) / e.budget) * 1000) / 10 : null,
      }))
      .sort((a, b) => b.headcount - a.headcount).slice(0, 10);

    // Payroll
    const totalPayroll = sum(active, 'salary');
    const avgSalary = headcount ? totalPayroll / headcount : 0;
    const laborActual = sum(laborCost, 'actual');
    const laborBudget = sum(laborCost, 'budget');
    const laborVariance = laborBudget ? ((laborActual - laborBudget) / laborBudget) * 100 : 0;

    // Attendance
    const curAtt = attendance.filter((a: any) => inWindow(a.attendance_date, curStart, now));
    const prevAtt = attendance.filter((a: any) => inWindow(a.attendance_date, prevStart, curStart));
    const attRate = (list: any[]) => list.length
      ? (list.filter((a: any) => ['Present', 'Late', 'Half Day'].includes(a.status)).length / list.length) * 100 : 0;
    const absentRate = (list: any[]) => list.length
      ? (list.filter((a: any) => a.status === 'Absent').length / list.length) * 100 : 0;
    const punctuality = (list: any[]) => {
      const present = list.filter((a: any) => ['Present', 'Late'].includes(a.status));
      return present.length ? (present.filter((a: any) => a.status === 'Present').length / present.length) * 100 : 0;
    };
    const otHours = sum(curAtt, 'overtime_hours') + sum(overtimeReqs.filter((o: any) => inWindow(o.overtime_date, curStart, now) && o.status === 'Approved'), 'hours');
    const prevOtHours = sum(prevAtt, 'overtime_hours') + sum(overtimeReqs.filter((o: any) => inWindow(o.overtime_date, prevStart, curStart) && o.status === 'Approved'), 'hours');
    const otCost = sum(laborCost, 'overtime_cost');

    // Turnover
    const curTerms = offboarding.filter((o: any) => inWindow(o.termination_date, curStart, now));
    const prevTerms = offboarding.filter((o: any) => inWindow(o.termination_date, prevStart, curStart));
    const voluntary = curTerms.filter((o: any) => /resign|voluntary|retire/i.test(o.reason || '')).length;
    const turnoverRate = headcount ? (curTerms.length / headcount) * (365 / days) * 100 : 0;
    const prevTurnoverRate = headcount && prevTerms.length ? (prevTerms.length / headcount) * (365 / days) * 100 : null;

    // Recruitment
    const openReqs = jobOpenings.filter((j: any) => ['Open', 'Active'].includes(j.status)).length;
    const curCands = candidates.filter((c: any) => inWindow(c.applied_date, curStart, now));
    const prevCands = candidates.filter((c: any) => inWindow(c.applied_date, prevStart, curStart));
    const curOffers = offers.filter((o: any) => inWindow(o.sent_date, curStart, now));
    const accepted = curOffers.filter((o: any) => /accept/i.test(o.status || '')).length;
    const respondedOffers = curOffers.filter((o: any) => o.response_date);
    const offerAcceptance = respondedOffers.length ? (accepted / respondedOffers.length) * 100 : 0;
    const daysToOffer = respondedOffers.length
      ? respondedOffers.reduce((s: number, o: any) => s + (new Date(o.response_date).getTime() - new Date(o.sent_date).getTime()) / 86400000, 0) / respondedOffers.length
      : 0;
    const funnelStages = ['Application Received', 'Screening', 'Interview', 'Offer', 'Hired'];
    const recruitmentFunnel = funnelStages.map(stage => ({
      stage,
      count: candidates.filter((c: any) => (c.stage || '').toLowerCase().includes(stage.split(' ')[0].toLowerCase())).length,
    }));

    // Performance
    const reviewsDone = perfReviews.filter((r: any) => /completed|done/i.test(r.status || ''));
    const reviewCompletion = perfReviews.length ? (reviewsDone.length / perfReviews.length) * 100 : 0;
    const goalCompletion = sum(perfReviews, 'goals') ? (sum(perfReviews, 'completed') / sum(perfReviews, 'goals')) * 100 : 0;
    const curRecog = recognitions.filter((r: any) => inWindow(r.created_at, curStart, now)).length;

    // Training
    const curTraining = trainingSessions.filter((t: any) => inWindow(t.session_date, curStart, now));
    const prevTraining = trainingSessions.filter((t: any) => inWindow(t.session_date, prevStart, curStart));
    const trainedStaff = sum(curTraining.filter((t: any) => /completed|done|held/i.test(t.status || '')), 'staff_count')
      || sum(curTraining, 'staff_count');
    const upcomingSessions = trainingSessions.filter((t: any) => /upcoming|scheduled/i.test(t.status || '')).length;

    // Leave
    const pendingLeave = leaveRequests.filter((l: any) => l.status === 'Pending').length;
    const leaveDaysCur = sum(leaveRequests.filter((l: any) => inWindow(l.start_date, curStart, now) && /approved/i.test(l.status || '')), 'days');

    const metrics: HcMetric[] = [];
    const push = (id: string, name: string, category: HcCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Headcount
    push('hc_headcount', 'Total Headcount', 'headcount', headcount, 70, 40, 'count');
    push('hc_fulltime', 'Full-Time', 'headcount', byType('Full-time'), 50, 30, 'count');
    push('hc_parttime', 'Part-Time', 'headcount', byType('Part-time'), 15, 30, 'count');
    push('hc_contract', 'Contract Staff', 'headcount', byType('Contract'), 0, 0, 'count');
    push('hc_new_hires', 'New Hires', 'headcount', newHires, 5, 1, 'count', false, prevHires);

    // Labor
    push('hc_labor_cost', 'Labor Cost (Actual)', 'labor', laborActual || totalPayroll, laborBudget || 400000, (laborBudget || 400000) * 1.2, 'currency', true);
    push('hc_labor_variance', 'Budget Variance', 'labor', laborVariance, 0, 10, '%', true);
    push('hc_cost_per_emp', 'Cost per Employee', 'labor', headcount ? (laborActual || totalPayroll) / headcount : 0, 6000, 9000, 'currency', true);

    // Payroll
    push('hc_total_payroll', 'Total Payroll', 'payroll', totalPayroll, 0, 0, 'currency');
    push('hc_avg_salary', 'Avg Salary', 'payroll', avgSalary, 5000, 3000, 'currency');
    push('hc_payroll_depts', 'Departments on Payroll', 'payroll', deptLabor.filter(d => d.payroll > 0).length, 0, 0, 'count');

    // Attendance
    push('hc_attendance', 'Attendance Rate', 'attendance', attRate(curAtt), 95, 85, '%', false, prevAtt.length ? attRate(prevAtt) : null);
    push('hc_absenteeism', 'Absenteeism Rate', 'attendance', absentRate(curAtt), 3, 8, '%', true, prevAtt.length ? absentRate(prevAtt) : null);
    push('hc_punctuality', 'Punctuality Rate', 'attendance', punctuality(curAtt), 92, 80, '%', false, prevAtt.length ? punctuality(prevAtt) : null);
    push('hc_overtime', 'Overtime Hours', 'attendance', otHours, 100, 250, 'hrs', true, prevAtt.length ? prevOtHours : null);
    push('hc_ot_cost', 'Overtime Cost', 'attendance', otCost, 0, 0, 'currency', true);
    push('hc_leave_days', 'Approved Leave Days', 'attendance', leaveDaysCur, 0, 0, 'count');
    push('hc_pending_leave', 'Pending Leave Requests', 'attendance', pendingLeave, 5, 15, 'count', true);

    // Turnover
    push('hc_turnover', 'Turnover Rate (annualized)', 'turnover', turnoverRate, 15, 25, '%', true, prevTurnoverRate);
    push('hc_terminations', 'Separations', 'turnover', curTerms.length, 3, 8, 'count', true, prevTerms.length);
    push('hc_voluntary', 'Voluntary Exits', 'turnover', voluntary, 2, 6, 'count', true);

    // Recruitment
    push('hc_open_reqs', 'Open Requisitions', 'recruitment', openReqs, 5, 15, 'count', true);
    push('hc_candidates', 'New Candidates', 'recruitment', curCands.length, 20, 5, 'count', false, prevCands.length);
    push('hc_offer_accept', 'Offer Acceptance', 'recruitment', offerAcceptance, 80, 60, '%');
    push('hc_days_to_offer', 'Avg Days to Offer Response', 'recruitment', daysToOffer, 14, 30, 'days', true);

    // Performance
    push('hc_review_completion', 'Review Completion', 'performance', reviewCompletion, 90, 60, '%');
    push('hc_goal_completion', 'Goal Completion', 'performance', goalCompletion, 75, 50, '%');
    push('hc_recognitions', 'Recognitions Given', 'performance', curRecog, 10, 3, 'count');

    // Training
    push('hc_sessions', 'Training Sessions Held', 'training', curTraining.length, 5, 2, 'count', false, prevTraining.length);
    push('hc_staff_trained', 'Staff Trained', 'training', trainedStaff, 50, 20, 'count');
    push('hc_upcoming', 'Upcoming Sessions', 'training', upcomingSessions, 3, 0, 'count');

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, deptLabor, recruitmentFunnel,
    });
  } catch (err: any) {
    console.error('[exec-hc-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute human capital intelligence' });
  }
});

// ─── Procurement Intelligence ────────────────────────────────────────────────

type ProcCategory = 'spend' | 'vendor' | 'leadtime' | 'contract' | 'savings' | 'trends';

interface ProcMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: ProcCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/procurement-intelligence?days=&propertyId=
// Spend/lead time from proc_purchase_orders + dept POs (fb_/hk_/eng_),
// vendors from proc_suppliers + proc_supplier_evaluations, contracts from
// proc_contracts, requisitions from proc_requisitions.
router.get('/procurement-intelligence', authenticate, execView, execCache('proc-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const now = new Date();
    const prevFrom = prevStart.toISOString();

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      procPOs, fbPOs, hkPOs, engPOs, suppliers, fbSuppliers,
      evaluations, contracts, requisitions,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_purchase_orders')
        .select('id,po_number,supplier_id,department,order_date,required_delivery_date,fully_received_at,status,subtotal,discount,total_amount,contract_id')
        .gte('order_date', prevFrom)), 'proc_purchase_orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_purchase_orders')
        .select('id,po_number,supplier_id,status,order_date,expected_delivery_date,actual_delivery_date,discount_amount,total_amount')
        .gte('order_date', prevFrom)), 'fb_purchase_orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_purchase_orders')
        .select('id,po_number,supplier_id,status,priority,order_date,expected_delivery_date,actual_delivery_date,total_amount')
        .gte('order_date', prevFrom)), 'hk_purchase_orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('eng_purchase_orders')
        .select('id,po_number,supplier_id,status,priority,order_date,expected_delivery_date,actual_delivery_date,total_amount')
        .gte('order_date', prevFrom)), 'eng_purchase_orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_suppliers')
        .select('id,supplier_code,legal_name,trading_name,supplier_type,supplier_category,status')), 'proc_suppliers'),
      kpiFetchRows(supabaseAdmin!.from('fb_suppliers')
        .select('id,name'), 'fb_suppliers'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_supplier_evaluations')
        .select('supplier_id,evaluation_date,quality_score,delivery_score,price_score,overall_score,rating')), 'proc_supplier_evaluations'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_contracts')
        .select('id,contract_number,supplier_id,category,contract_type,start_date,end_date,renewal_date,contract_value,status')), 'proc_contracts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_requisitions')
        .select('id,pr_number,department,requester,request_date,priority,status,estimated_total')
        .gte('request_date', prevFrom)), 'proc_requisitions'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const cancelled = (s: string) => /cancel/i.test(s || '');
    const inCur = (d: any) => inWindow(d, curStart, now);
    const inPrev = (d: any) => inWindow(d, prevStart, curStart);

    // Unified PO rows across procurement systems
    type Po = { dept: string; orderDate: any; expected: any; received: any; total: number; discount: number; status: string; supplierId: string | null; contractId: string | null; priority: string };
    const allPOs: Po[] = [
      ...procPOs.filter((p: any) => !cancelled(p.status)).map((p: any) => ({
        dept: p.department || 'Central', orderDate: p.order_date, expected: p.required_delivery_date,
        received: p.fully_received_at, total: Number(p.total_amount) || 0, discount: Number(p.discount) || 0,
        status: p.status, supplierId: p.supplier_id, contractId: p.contract_id, priority: 'Normal',
      })),
      ...fbPOs.filter((p: any) => !cancelled(p.status)).map((p: any) => ({
        dept: 'Food & Beverage', orderDate: p.order_date, expected: p.expected_delivery_date,
        received: p.actual_delivery_date, total: Number(p.total_amount) || 0, discount: Number(p.discount_amount) || 0,
        status: p.status, supplierId: p.supplier_id, contractId: null, priority: p.priority || 'medium',
      })),
      ...hkPOs.filter((p: any) => !cancelled(p.status)).map((p: any) => ({
        dept: 'Housekeeping', orderDate: p.order_date, expected: p.expected_delivery_date,
        received: p.actual_delivery_date, total: Number(p.total_amount) || 0, discount: 0,
        status: p.status, supplierId: p.supplier_id, contractId: null, priority: p.priority || 'medium',
      })),
      ...engPOs.filter((p: any) => !cancelled(p.status)).map((p: any) => ({
        dept: 'Engineering', orderDate: p.order_date, expected: p.expected_delivery_date,
        received: p.actual_delivery_date, total: Number(p.total_amount) || 0, discount: 0,
        status: p.status, supplierId: p.supplier_id, contractId: null, priority: p.priority || 'medium',
      })),
    ];
    const curPOs = allPOs.filter(p => inCur(p.orderDate));
    const prevPOs = allPOs.filter(p => inPrev(p.orderDate));
    const curSpend = curPOs.reduce((s, p) => s + p.total, 0);
    const prevSpend = prevPOs.reduce((s, p) => s + p.total, 0);
    const deptSpend = (d: string, list = curPOs) => list.filter(p => p.dept === d).reduce((s, p) => s + p.total, 0);
    const openPOValue = allPOs.filter(p => !/closed|fully received|received/i.test(p.status)).reduce((s, p) => s + p.total, 0);

    // Lead time & on-time
    const delivered = allPOs.filter(p => p.received && p.orderDate);
    const leadTimes = delivered.map(p => (new Date(p.received).getTime() - new Date(p.orderDate).getTime()) / 86400000).filter(d => d >= 0);
    const avgLead = leadTimes.length ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : 0;
    const onTime = delivered.filter(p => p.expected && new Date(p.received) <= new Date(p.expected)).length;
    const onTimePct = delivered.length ? (onTime / delivered.length) * 100 : 0;
    const urgentShare = curPOs.length ? (curPOs.filter(p => /urgent|high|critical/i.test(p.priority)).length / curPOs.length) * 100 : 0;

    // Vendors
    const supplierName: Record<string, string> = {};
    suppliers.forEach((s: any) => { supplierName[s.id] = s.trading_name || s.legal_name; });
    fbSuppliers.forEach((s: any) => { if (!supplierName[s.id]) supplierName[s.id] = s.name; });
    const activeSuppliers = suppliers.filter((s: any) => ['Active', 'Approved'].includes(s.status)).length
      || fbSuppliers.length;
    // overall_score scale varies by evaluator — normalize to /100
    const normScore = (s: number) => s <= 5 ? s * 20 : s <= 10 ? s * 10 : s;
    const avgScore = evaluations.length
      ? evaluations.reduce((s: number, e: any) => s + normScore(Number(e.overall_score) || 0), 0) / evaluations.length : 0;
    const topRated = evaluations.filter((e: any) => ['Excellent', 'Good'].includes(e.rating)).length;
    const atRisk = evaluations.filter((e: any) => ['Poor', 'Critical'].includes(e.rating)).length;
    const spendBySupplier: Record<string, number> = {};
    allPOs.forEach(p => { if (p.supplierId) spendBySupplier[p.supplierId] = (spendBySupplier[p.supplierId] || 0) + p.total; });
    const latestEval: Record<string, any> = {};
    evaluations.forEach((e: any) => {
      if (!latestEval[e.supplier_id] || new Date(e.evaluation_date) > new Date(latestEval[e.supplier_id].evaluation_date)) {
        latestEval[e.supplier_id] = e;
      }
    });
    const topVendors = Object.keys({ ...spendBySupplier, ...latestEval })
      .map(id => ({
        name: supplierName[id] || 'Unknown Supplier',
        spend: Math.round((spendBySupplier[id] || 0) * 100) / 100,
        score: latestEval[id] ? Math.round(normScore(Number(latestEval[id].overall_score) || 0) * 10) / 10 : null,
        rating: latestEval[id]?.rating || null,
      }))
      .sort((a, b) => b.spend - a.spend).slice(0, 8);

    // Contracts
    const activeContracts = contracts.filter((c: any) => /active/i.test(c.status || '') || (c.start_date <= dayStr(now) && c.end_date >= dayStr(now)));
    const contractValue = sum(activeContracts, 'contract_value');
    const in60 = new Date(now.getTime() + 60 * 86400000);
    const expiring = activeContracts.filter((c: any) => c.end_date && new Date(c.end_date) <= in60).length;
    const contractedPOs = curPOs.filter(p => p.contractId).length;
    const coverage = curPOs.length ? (contractedPOs / curPOs.length) * 100 : 0;

    // Savings = discounts taken
    const curDiscounts = curPOs.reduce((s, p) => s + p.discount, 0);
    const curSubtotal = curSpend + curDiscounts;
    const savingsPct = curSubtotal ? (curDiscounts / curSubtotal) * 100 : 0;

    // Requisitions
    const curReqs = requisitions.filter((r: any) => inCur(r.request_date));
    const pendingReqs = requisitions.filter((r: any) => ['Submitted', 'Pending', 'Pending Approval'].includes(r.status)).length;

    // Spend-by-department panel
    const deptSpendMap: Record<string, { spend: number; orders: number }> = {};
    curPOs.forEach(p => {
      const e = deptSpendMap[p.dept] || (deptSpendMap[p.dept] = { spend: 0, orders: 0 });
      e.spend += p.total; e.orders += 1;
    });
    const spendByDept = Object.entries(deptSpendMap)
      .map(([department, e]) => ({
        department, spend: Math.round(e.spend * 100) / 100, orders: e.orders,
        sharePct: curSpend ? Math.round((e.spend / curSpend) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    const metrics: ProcMetric[] = [];
    const push = (id: string, name: string, category: ProcCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Spend
    push('pr_total_spend', 'Total Purchase Spend', 'spend', curSpend, 300000, 450000, 'currency', true, prevSpend);
    push('pr_fb_spend', 'F&B Spend', 'spend', deptSpend('Food & Beverage'), 125000, 190000, 'currency', true, deptSpend('Food & Beverage', prevPOs));
    push('pr_hk_spend', 'Housekeeping Spend', 'spend', deptSpend('Housekeeping'), 70000, 110000, 'currency', true, deptSpend('Housekeeping', prevPOs));
    push('pr_eng_spend', 'Engineering Spend', 'spend', deptSpend('Engineering'), 55000, 85000, 'currency', true, deptSpend('Engineering', prevPOs));
    push('pr_open_po', 'Open PO Value', 'spend', openPOValue, 150000, 300000, 'currency', true);

    // Vendor
    push('pr_active_vendors', 'Active Suppliers', 'vendor', activeSuppliers, 20, 8, 'count');
    push('pr_vendor_score', 'Avg Vendor Score', 'vendor', avgScore, 80, 60, '%');
    push('pr_top_vendors', 'Top-Rated Vendors', 'vendor', evaluations.length ? (topRated / evaluations.length) * 100 : 0, 60, 30, '%');
    push('pr_at_risk', 'At-Risk Vendors', 'vendor', atRisk, 2, 6, 'count', true);

    // Lead time
    push('pr_lead_time', 'Avg Lead Time', 'leadtime', avgLead, 7, 14, 'days', true);
    push('pr_on_time', 'On-Time Delivery', 'leadtime', onTimePct, 90, 70, '%');
    push('pr_urgent', 'Urgent Orders', 'leadtime', urgentShare, 10, 25, '%', true);
    push('pr_pending_reqs', 'Pending Requisitions', 'leadtime', pendingReqs, 5, 15, 'count', true);

    // Contract
    push('pr_contract_coverage', 'Contract Coverage', 'contract', coverage, 60, 30, '%');
    push('pr_active_contracts', 'Active Contracts', 'contract', activeContracts.length, 5, 2, 'count');
    push('pr_contract_value', 'Contract Value', 'contract', contractValue, 0, 0, 'currency');
    push('pr_expiring', 'Expiring Contracts (60d)', 'contract', expiring, 3, 8, 'count', true);

    // Savings
    push('pr_savings', 'Negotiated Savings', 'savings', curDiscounts, 15000, 5000, 'currency');
    push('pr_savings_pct', 'Savings Rate', 'savings', savingsPct, 8, 3, '%');
    push('pr_req_pipeline', 'Requisition Pipeline', 'savings', sum(curReqs, 'estimated_total'), 0, 0, 'currency');

    // Trends
    push('pr_pos', 'Purchase Orders', 'trends', curPOs.length, 40, 15, 'count', false, prevPOs.length);
    push('pr_avg_order', 'Avg Order Value', 'trends', curPOs.length ? curSpend / curPOs.length : 0, 0, 0, 'currency', false, prevPOs.length ? prevSpend / prevPOs.length : null);
    push('pr_requisitions', 'Requisitions Raised', 'trends', curReqs.length, 20, 8, 'count');

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, spendByDept, topVendors,
      expiringContracts: activeContracts
        .filter((c: any) => c.end_date && new Date(c.end_date) <= in60)
        .map((c: any) => ({
          number: c.contract_number, supplier: supplierName[c.supplier_id] || c.supplier_id,
          category: c.category, endDate: c.end_date, value: Number(c.contract_value) || 0,
        })),
    });
  } catch (err: any) {
    console.error('[exec-procurement-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute procurement intelligence' });
  }
});

// ─── Inventory Intelligence ──────────────────────────────────────────────────

type InvCategory = 'value' | 'turnover' | 'deadstock' | 'slowmoving' | 'fastmoving' | 'variance' | 'accuracy';

interface InvMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: InvCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/inventory-intelligence?days=&propertyId=
// Unified inventory: uinv_stock_balances × unit_cost for value, uinv_stock_ledger
// for movement/COGS, uinv_consumption_stats for velocity classification,
// uinv_counts for variance/accuracy, uinv_batches for expiry, uinv_stores for
// store-level value.
router.get('/inventory-intelligence', authenticate, execView, execCache('inv-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const now = new Date();
    const prevFrom = prevStart.toISOString();

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      items, balances, ledger, stores, counts, consumptionStats, batches,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_items')
        .select('id,item_code,item_name,category,unit_of_measure,reorder_point,min_stock,par_level,is_active')), 'uinv_items'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stock_balances')
        .select('item_id,store_id,on_hand,damaged,quarantined,expired,unit_cost,status')), 'uinv_stock_balances'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stock_ledger')
        .select('item_id,store_id,transaction_type,quantity_in,quantity_out,unit_cost,value,created_at')
        .gte('created_at', prevFrom)), 'uinv_stock_ledger'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stores')
        .select('id,store_name,store_type,is_active')), 'uinv_stores'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_counts')
        .select('id,count_number,count_type,store_id,total_variance,status,completed_at,created_at')
        .gte('created_at', prevFrom)), 'uinv_counts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_consumption_stats')
        .select('item_id,store_id,avg_daily_consumption,total_consumed,lookback_days')), 'uinv_consumption_stats'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_batches')
        .select('item_id,batch_number,expiry_date,quantity,unit_cost,status')
        .not('expiry_date', 'is', null)), 'uinv_batches'),
    ]);

    // Low stock: on_hand below reorder point (fall back to min_stock / par_level)
    const itemReorder: Record<string, number> = {};
    items.forEach((i: any) => {
      itemReorder[i.id] = Number(i.reorder_point) || Number(i.min_stock) || Number(i.par_level) || 0;
    });
    const onHandByItem: Record<string, number> = {};
    balances.forEach((b: any) => { onHandByItem[b.item_id] = (onHandByItem[b.item_id] || 0) + (Number(b.on_hand) || 0); });
    const lowStock = items.filter((i: any) => i.is_active !== false
      && itemReorder[i.id] > 0 && (onHandByItem[i.id] || 0) < itemReorder[i.id]);

    const itemName: Record<string, string> = {};
    const itemCat: Record<string, string> = {};
    items.forEach((i: any) => { itemName[i.id] = i.item_name; itemCat[i.id] = i.category || 'Other'; });
    const storeName: Record<string, string> = {};
    stores.forEach((s: any) => { storeName[s.id] = s.store_name; });

    const balVal = (b: any) => (Number(b.on_hand) || 0) * (Number(b.unit_cost) || 0);
    const stockValue = balances.reduce((s, b) => s + balVal(b), 0);
    const damagedVal = balances.reduce((s, b) => s + (Number(b.damaged) || 0) * (Number(b.unit_cost) || 0), 0);
    const expiredVal = balances.reduce((s, b) => s + (Number(b.expired) || 0) * (Number(b.unit_cost) || 0), 0)
      + batches.filter((b: any) => b.expiry_date && b.expiry_date < dayStr(now))
        .reduce((s, b) => s + (Number(b.quantity) || 0) * (Number(b.unit_cost) || 0), 0);

    // Movement: outflow value = consumption/issues/waste in window
    const isOut = (t: string) => /consume|issue|waste|transfer|sale|write|adjust|count/i.test(t || '');
    const curLedger = ledger.filter((l: any) => inWindow(l.created_at, curStart, now));
    const prevLedger = ledger.filter((l: any) => inWindow(l.created_at, prevStart, curStart));
    const outValue = (list: any[]) => list
      .filter(l => isOut(l.transaction_type))
      .reduce((s, l) => s + (Math.abs(Number(l.value)) || (Number(l.quantity_out) || 0) * (Number(l.unit_cost) || 0)), 0);
    const cogsCur = outValue(curLedger);
    const cogsPrev = outValue(prevLedger);
    const dailyCogs = cogsCur / days;
    const turnover = stockValue > 0 ? (cogsCur / stockValue) * (365 / days) : 0;
    const daysOnHand = dailyCogs > 0 ? stockValue / dailyCogs : 0;

    // Velocity classification: ledger outflows in window are the source of
    // truth (consumption_stats is only populated once replenishment jobs run —
    // merged in where present).
    const statsByItem: Record<string, { daily: number; consumed: number }> = {};
    consumptionStats.forEach((c: any) => {
      const e = statsByItem[c.item_id] || (statsByItem[c.item_id] = { daily: 0, consumed: 0 });
      e.daily += Number(c.avg_daily_consumption) || 0;
      e.consumed += Number(c.total_consumed) || 0;
    });
    curLedger.filter(l => isOut(l.transaction_type)).forEach((l: any) => {
      const qty = Number(l.quantity_out) || 0;
      const e = statsByItem[l.item_id] || (statsByItem[l.item_id] = { daily: 0, consumed: 0 });
      e.consumed += qty;
      e.daily = Math.max(e.daily, e.consumed / days);
    });
    Object.values(statsByItem).forEach(e => {
      if (e.daily === 0 && e.consumed > 0) e.daily = e.consumed / days;
    });
    const balByItem: Record<string, number> = {};
    balances.forEach((b: any) => { balByItem[b.item_id] = (balByItem[b.item_id] || 0) + balVal(b); });
    const heldItems = Object.entries(balByItem).filter(([, v]) => v > 0);
    let deadItems = 0, deadVal = 0, slowItems = 0, slowVal = 0, fastItems = 0, fastVal = 0;
    heldItems.forEach(([id, v]) => {
      const daily = statsByItem[id]?.daily || 0;
      if (daily === 0) { deadItems += 1; deadVal += v; }
      else if (daily < 0.5) { slowItems += 1; slowVal += v; }
      else { fastItems += 1; fastVal += v; }
    });
    const topMovers = Object.entries(statsByItem)
      .sort((a, b) => b[1].consumed - a[1].consumed)
      .slice(0, 8)
      .map(([id, e]) => ({
        name: itemName[id] || 'Unknown Item', category: itemCat[id] || 'Other',
        consumed: Math.round(e.consumed * 100) / 100,
        dailyRate: Math.round(e.daily * 1000) / 1000,
        stockValue: Math.round((balByItem[id] || 0) * 100) / 100,
      }));

    // Store-level value
    const storeValMap: Record<string, number> = {};
    balances.forEach((b: any) => { storeValMap[b.store_id] = (storeValMap[b.store_id] || 0) + balVal(b); });
    const stockByStore = Object.entries(storeValMap)
      .map(([id, v]) => ({ store: storeName[id] || id, value: Math.round(v * 100) / 100, sharePct: stockValue ? Math.round((v / stockValue) * 1000) / 10 : 0 }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value).slice(0, 8);

    // Category-level value
    const catValMap: Record<string, number> = {};
    balances.forEach((b: any) => {
      const c = itemCat[b.item_id] || 'Other';
      catValMap[c] = (catValMap[c] || 0) + balVal(b);
    });
    const stockByCategory = Object.entries(catValMap)
      .map(([category, v]) => ({ category, value: Math.round(v * 100) / 100, sharePct: stockValue ? Math.round((v / stockValue) * 1000) / 10 : 0 }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value).slice(0, 8);

    // Counts → variance/accuracy
    const completedCounts = counts.filter((c: any) => /completed|approved|posted|closed/i.test(c.status || '') && inWindow(c.completed_at || c.created_at, curStart, now));
    const prevCounts = counts.filter((c: any) => /completed|approved|posted|closed/i.test(c.status || '') && inWindow(c.completed_at || c.created_at, prevStart, curStart));
    const varianceVal = completedCounts.reduce((s, c) => s + Math.abs(Number(c.total_variance) || 0), 0);
    const prevVarianceVal = prevCounts.reduce((s, c) => s + Math.abs(Number(c.total_variance) || 0), 0);
    const variancePct = stockValue ? (varianceVal / stockValue) * 100 : 0;
    const accuracy = stockValue ? Math.max(0, 100 - variancePct) : 0;

    // Expiry
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const expiringBatches = batches
      .filter((b: any) => b.expiry_date && new Date(b.expiry_date) > now && new Date(b.expiry_date) <= in30)
      .map((b: any) => ({
        item: itemName[b.item_id] || b.item_id, batch: b.batch_number,
        expiryDate: b.expiry_date, quantity: Number(b.quantity) || 0,
        value: Math.round((Number(b.quantity) || 0) * (Number(b.unit_cost) || 0) * 100) / 100,
      }))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).slice(0, 10);
    const expiringVal = expiringBatches.reduce((s, b) => s + b.value, 0);

    const metrics: InvMetric[] = [];
    const push = (id: string, name: string, category: InvCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Value
    push('inv_stock_value', 'Total Stock Value', 'value', stockValue, 0, 0, 'currency');
    push('inv_items_held', 'Items in Stock', 'value', heldItems.length, 0, 0, 'count');
    push('inv_damaged', 'Damaged Stock Value', 'value', damagedVal, 2000, 8000, 'currency', true);
    push('inv_expired', 'Expired Stock Value', 'value', expiredVal, 2000, 8000, 'currency', true);
    push('inv_low_stock', 'Low-Stock Items', 'value', lowStock.length, 5, 15, 'count', true);

    // Turnover
    push('inv_cogs', 'Consumption (COGS)', 'turnover', cogsCur, 0, 0, 'currency', false, cogsPrev);
    push('inv_turnover', 'Inventory Turnover (ann.)', 'turnover', turnover, 8, 4, 'x');
    push('inv_days_on_hand', 'Days of Inventory', 'turnover', daysOnHand, 45, 90, 'days', true);
    push('inv_movements', 'Stock Movements', 'turnover', curLedger.length, 0, 0, 'count', false, prevLedger.length);

    // Dead stock
    push('inv_dead_value', 'Dead Stock Value', 'deadstock', deadVal, 10000, 25000, 'currency', true);
    push('inv_dead_pct', 'Dead Stock %', 'deadstock', stockValue ? (deadVal / stockValue) * 100 : 0, 5, 15, '%', true);
    push('inv_dead_items', 'Dead Stock Items', 'deadstock', deadItems, 30, 80, 'count', true);

    // Slow moving
    push('inv_slow_value', 'Slow-Moving Value', 'slowmoving', slowVal, 25000, 60000, 'currency', true);
    push('inv_slow_pct', 'Slow-Moving %', 'slowmoving', stockValue ? (slowVal / stockValue) * 100 : 0, 15, 35, '%', true);
    push('inv_slow_items', 'Slow-Moving Items', 'slowmoving', slowItems, 50, 150, 'count', true);

    // Fast moving
    push('inv_fast_value', 'Fast-Moving Value', 'fastmoving', fastVal, 100000, 50000, 'currency');
    push('inv_fast_pct', 'Fast-Moving %', 'fastmoving', stockValue ? (fastVal / stockValue) * 100 : 0, 70, 40, '%');
    push('inv_fast_items', 'Fast-Moving Items', 'fastmoving', fastItems, 100, 40, 'count');

    // Variance
    push('inv_variance_val', 'Count Variance Value', 'variance', varianceVal, 5000, 15000, 'currency', true, prevCounts.length ? prevVarianceVal : null);
    push('inv_variance_pct', 'Stock Variance %', 'variance', variancePct, 3, 8, '%', true);
    push('inv_counts_done', 'Counts Completed', 'variance', completedCounts.length, 4, 1, 'count', false, prevCounts.length);

    // Accuracy
    push('inv_accuracy', 'Inventory Accuracy', 'accuracy', accuracy, 95, 85, '%');
    push('inv_expiring', 'Expiring Batches (30d)', 'accuracy', expiringBatches.length, 5, 15, 'count', true);
    push('inv_expiring_val', 'Expiring Stock Value', 'accuracy', expiringVal, 5000, 15000, 'currency', true);

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, stockByStore, stockByCategory, topMovers, expiringBatches,
      movementSplit: [
        { type: 'Fast Moving', value: Math.round(fastVal), items: fastItems },
        { type: 'Slow Moving', value: Math.round(slowVal), items: slowItems },
        { type: 'Dead Stock', value: Math.round(deadVal), items: deadItems },
      ],
    });
  } catch (err: any) {
    console.error('[exec-inventory-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute inventory intelligence' });
  }
});

type SecCategory = 'incidents' | 'risk' | 'fraud' | 'access' | 'emergency' | 'compliance';

interface SecMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: SecCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/security-intelligence?days=&propertyId=
// Security domain tables: sec_incidents, sec_risks, sec_fraud_cases,
// sec_access_events, sec_alarms, sec_emergency_notifications + responses,
// sec_patrols + checkpoints, sec_cctv_cameras, sec_keys, sec_visitors,
// sec_compliance_audits/items, sec_safety_inspections, sec_investigations.
router.get('/security-intelligence', authenticate, execView, execCache('sec-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const prevFrom = prevStart.toISOString();
    const now = new Date();
    const in60 = new Date(now); in60.setDate(in60.getDate() + 60);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      incidents, risks, fraudCases, accessEvents, alarms, emergencies,
      emergResponses, patrols, checkpoints, cameras, cctvEvents, keys,
      visitors, audits, complianceItems, inspections, investigations,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_incidents')
        .select('id,incident_type,location,priority,status,reported_at,updated_at')
        .gte('reported_at', prevFrom)), 'sec_incidents'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_risks')
        .select('id,title,category,likelihood,impact,risk_score,risk_level,status,identified_at')), 'sec_risks'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_fraud_cases')
        .select('id,title,fraud_type,amount,severity,status,reported_at')
        .gte('reported_at', prevFrom)), 'sec_fraud_cases'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_access_events')
        .select('id,event_type,location,status,occurred_at')
        .gte('occurred_at', prevFrom)), 'sec_access_events'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_alarms')
        .select('id,alarm_type,location,status,triggered_at,acknowledged,acknowledged_at')
        .gte('triggered_at', prevFrom)), 'sec_alarms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_emergency_notifications')
        .select('id,emergency_type,location,status,priority,occurred_at')
        .gte('occurred_at', prevFrom)), 'sec_emergency_notifications'),
      kpiFetchRows(supabaseAdmin!.from('sec_emergency_responses')
        .select('emergency_id,action,created_at')
        .gte('created_at', prevFrom), 'sec_emergency_responses'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_patrols')
        .select('id,officer,route,status,progress,started_at,ended_at,created_at')
        .gte('created_at', prevFrom)), 'sec_patrols'),
      kpiFetchRows(supabaseAdmin!.from('sec_patrol_checkpoints')
        .select('patrol_id,scanned_at')
        .not('scanned_at', 'is', null)
        .gte('scanned_at', prevFrom), 'sec_patrol_checkpoints'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_cctv_cameras')
        .select('id,name,location,status,recording,last_motion_at')), 'sec_cctv_cameras'),
      kpiFetchRows(supabaseAdmin!.from('sec_cctv_events')
        .select('camera_id,event_type,created_at')
        .gte('created_at', prevFrom), 'sec_cctv_events'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_keys')
        .select('id,key_type,key_number,assigned_to,department,status,issued_date,return_date')), 'sec_keys'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_visitors')
        .select('id,name,visitor_type,status,blacklist_status,check_in_at,check_out_at,expected_arrival_at')
        .gte('expected_arrival_at', prevFrom)), 'sec_visitors'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_compliance_audits')
        .select('id,title,audit_type,status,result,scheduled_at,completed_at')
        .gte('created_at', prevFrom)), 'sec_compliance_audits'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_compliance_items')
        .select('id,title,category,status,expiry_date')), 'sec_compliance_items'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_safety_inspections')
        .select('id,title,area,status,result,scheduled_at,completed_at')
        .gte('created_at', prevFrom)), 'sec_safety_inspections'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_investigations')
        .select('id,title,priority,status,target_date,created_at')), 'sec_investigations'),
    ]);

    const inCur = (r: any, f: string) => { const d = r[f] ? new Date(r[f]) : null; return d && d >= curStart; };
    const inPrev = (r: any, f: string) => { const d = r[f] ? new Date(r[f]) : null; return d && d >= prevStart && d < curStart; };

    // --- Incidents ---
    const curInc = incidents.filter(i => inCur(i, 'reported_at'));
    const prevInc = incidents.filter(i => inPrev(i, 'reported_at'));
    const openInc = incidents.filter(i => i.status !== 'Resolved');
    const resolvedCur = curInc.filter(i => i.status === 'Resolved');
    const respTimes = resolvedCur
      .map(i => (new Date(i.updated_at).getTime() - new Date(i.reported_at).getTime()) / 3600000)
      .filter(h => h >= 0 && h < 24 * 365);
    const avgRespHrs = respTimes.length ? respTimes.reduce((a, b) => a + b, 0) / respTimes.length : 0;
    const criticalInc = curInc.filter(i => i.priority === 'Critical' || i.priority === 'High');

    // --- Risk register ---
    const openRisks = risks.filter(r => r.status !== 'Closed');
    const highRisks = openRisks.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical');
    const avgRiskScore = openRisks.length
      ? openRisks.reduce((s, r) => s + (Number(r.risk_score) || 0), 0) / openRisks.length : 0;
    const newRisks = risks.filter(r => inCur(r, 'identified_at'));
    const closedRisks = risks.filter(r => r.status === 'Closed');

    // --- Fraud ---
    const curFraud = fraudCases.filter(f => inCur(f, 'reported_at'));
    const prevFraud = fraudCases.filter(f => inPrev(f, 'reported_at'));
    const fraudVal = curFraud.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const openFraud = fraudCases.filter(f => !['Closed', 'Resolved'].includes(f.status));
    const openInvest = investigations.filter(i => !['Closed', 'Completed'].includes(i.status));

    // --- Access control ---
    const curAccess = accessEvents.filter(e => inCur(e, 'occurred_at'));
    const prevAccess = accessEvents.filter(e => inPrev(e, 'occurred_at'));
    const violations = curAccess.filter(e => e.status && e.status !== 'Normal');
    const keysOut = keys.filter(k => ['Issued', 'Lost'].includes(k.status));
    const lostKeys = keys.filter(k => k.status === 'Lost');
    const curVisitors = visitors.filter(v => inCur(v, 'check_in_at'));
    const blacklisted = visitors.filter(v => v.blacklist_status && v.blacklist_status !== 'Clear');
    const curPatrols = patrols.filter(p => inCur(p, 'created_at'));
    const prevPatrols = patrols.filter(p => inPrev(p, 'created_at'));
    const donePatrols = curPatrols.filter(p => p.status === 'Completed');
    const curScans = checkpoints.filter(c => inCur(c, 'scanned_at'));

    // --- Emergency ---
    const curEmerg = emergencies.filter(e => inCur(e, 'occurred_at'));
    const prevEmerg = emergencies.filter(e => inPrev(e, 'occurred_at'));
    const respByEmerg: Record<string, number> = {};
    emergResponses.forEach(r => {
      const t = new Date(r.created_at).getTime();
      if (!respByEmerg[r.emergency_id] || t < respByEmerg[r.emergency_id]) respByEmerg[r.emergency_id] = t;
    });
    const emergRespMins = curEmerg
      .filter(e => respByEmerg[e.id])
      .map(e => (respByEmerg[e.id] - new Date(e.occurred_at).getTime()) / 60000)
      .filter(m => m >= 0 && m < 24 * 60);
    const avgEmergRespMin = emergRespMins.length
      ? emergRespMins.reduce((a, b) => a + b, 0) / emergRespMins.length : 0;
    const activeAlarms = alarms.filter(a => a.status === 'Active');
    const curAlarms = alarms.filter(a => inCur(a, 'triggered_at'));
    const prevAlarms = alarms.filter(a => inPrev(a, 'triggered_at'));
    const ackMins = curAlarms
      .filter(a => a.acknowledged && a.acknowledged_at)
      .map(a => (new Date(a.acknowledged_at).getTime() - new Date(a.triggered_at).getTime()) / 60000)
      .filter(m => m >= 0 && m < 24 * 60);
    const avgAckMin = ackMins.length ? ackMins.reduce((a, b) => a + b, 0) / ackMins.length : 0;
    const camsOnline = cameras.filter(c => c.status === 'Online').length;
    const camPct = cameras.length ? (camsOnline / cameras.length) * 100 : 0;
    const curCctvEvents = cctvEvents.filter(e => inCur(e, 'created_at'));

    // --- Compliance ---
    const doneAudits = audits.filter(a => inCur(a, 'completed_at'));
    const prevAudits = audits.filter(a => inPrev(a, 'completed_at'));
    const auditsWithResult = doneAudits.filter(a => a.result);
    const auditPassRate = auditsWithResult.length
      ? (auditsWithResult.filter(a => a.result !== 'Fail').length / auditsWithResult.length) * 100 : 0;
    const compOk = complianceItems.filter(c => c.status === 'Compliant').length;
    const compPct = complianceItems.length ? (compOk / complianceItems.length) * 100 : 0;
    const expiringComp = complianceItems.filter(c => {
      if (!c.expiry_date) return false;
      const d = new Date(c.expiry_date);
      return d >= now && d <= in60;
    });
    const doneInspections = inspections.filter(i => inCur(i, 'completed_at'));
    const inspWithResult = doneInspections.filter(i => i.result);
    const inspPassRate = inspWithResult.length
      ? (inspWithResult.filter(i => i.result !== 'Fail').length / inspWithResult.length) * 100 : 0;

    const metrics: SecMetric[] = [];
    const push = (id: string, name: string, category: SecCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Incidents
    push('sec_total', 'Total Incidents', 'incidents', curInc.length, 10, 20, 'count', true, prevInc.length);
    push('sec_open', 'Open Incidents', 'incidents', openInc.length, 3, 8, 'count', true);
    push('sec_resolved', 'Resolved This Period', 'incidents', resolvedCur.length, 8, 3, 'count');
    push('sec_rate', 'Incident Rate', 'incidents', curInc.length / days, 0.3, 0.7, '/day', true, prevInc.length / days);
    push('sec_resp_hrs', 'Avg Resolution Time', 'incidents', avgRespHrs, 8, 24, 'hrs', true);
    push('sec_critical', 'High/Critical Incidents', 'incidents', criticalInc.length, 2, 6, 'count', true);

    // Risk
    push('sec_risks_open', 'Open Risks', 'risk', openRisks.length, 10, 25, 'count', true);
    push('sec_risk_score', 'Avg Risk Score', 'risk', avgRiskScore, 6, 12, '/25', true);
    push('sec_risks_high', 'High/Critical Risks', 'risk', highRisks.length, 2, 6, 'count', true);
    push('sec_risks_new', 'New Risks Identified', 'risk', newRisks.length, 5, 15, 'count', true);
    push('sec_risks_closed', 'Risks Closed', 'risk', closedRisks.length, 5, 1, 'count');

    // Fraud
    push('sec_fraud_cases', 'Fraud Cases', 'fraud', curFraud.length, 2, 5, 'count', true, prevFraud.length);
    push('sec_fraud_value', 'Fraud Value', 'fraud', fraudVal, 5000, 20000, 'currency', true);
    push('sec_fraud_open', 'Open Fraud Cases', 'fraud', openFraud.length, 2, 6, 'count', true);
    push('sec_investigations', 'Open Investigations', 'fraud', openInvest.length, 3, 8, 'count', true);

    // Access
    push('sec_access_events', 'Access Events', 'access', curAccess.length, 500, 1000, 'count', false, prevAccess.length);
    push('sec_violations', 'Access Violations', 'access', violations.length, 5, 15, 'count', true);
    push('sec_keys_out', 'Keys Issued', 'access', keysOut.length, 20, 40, 'count', true);
    push('sec_keys_lost', 'Lost Keys', 'access', lostKeys.length, 0, 3, 'count', true);
    push('sec_visitors', 'Visitor Check-Ins', 'access', curVisitors.length, 100, 30, 'count');
    push('sec_blacklist', 'Blacklisted Visitors', 'access', blacklisted.length, 0, 3, 'count', true);
    push('sec_patrols', 'Patrols Completed', 'access', donePatrols.length, 20, 5, 'count', false, prevPatrols.length);
    push('sec_checkpoints', 'Checkpoints Scanned', 'access', curScans.length, 100, 30, 'count');

    // Emergency
    push('sec_emergencies', 'Emergency Events', 'emergency', curEmerg.length, 2, 6, 'count', true, prevEmerg.length);
    push('sec_emerg_resp', 'Avg First Response', 'emergency', avgEmergRespMin, 5, 15, 'min', true);
    push('sec_alarms', 'Alarms Triggered', 'emergency', curAlarms.length, 10, 30, 'count', true, prevAlarms.length);
    push('sec_alarms_active', 'Active Alarms', 'emergency', activeAlarms.length, 0, 5, 'count', true);
    push('sec_ack_time', 'Avg Alarm Ack Time', 'emergency', avgAckMin, 5, 15, 'min', true);
    push('sec_cctv_up', 'CCTV Cameras Online', 'emergency', camPct, 98, 90, '%');
    push('sec_cctv_events', 'CCTV Events Logged', 'emergency', curCctvEvents.length, 200, 50, 'count');

    // Compliance
    push('sec_audits', 'Audits Completed', 'compliance', doneAudits.length, 4, 1, 'count', false, prevAudits.length);
    push('sec_audit_pass', 'Audit Pass Rate', 'compliance', auditPassRate, 95, 80, '%');
    push('sec_comp_items', 'Compliant Items', 'compliance', compPct, 95, 80, '%');
    push('sec_comp_expiring', 'Expiring Certifications (60d)', 'compliance', expiringComp.length, 2, 8, 'count', true);
    push('sec_insp_pass', 'Safety Inspection Pass', 'compliance', inspPassRate, 95, 80, '%');

    // --- Panels ---
    const grp = (rows: any[], f: string) => {
      const m: Record<string, number> = {};
      rows.forEach(r => { const k = r[f] || 'Other'; m[k] = (m[k] || 0) + 1; });
      return m;
    };
    const incidentByType = Object.entries(grp(curInc, 'incident_type'))
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const hotspotMap: Record<string, number> = {};
    curInc.forEach(i => { if (i.location) hotspotMap[i.location] = (hotspotMap[i.location] || 0) + 2; });
    curAlarms.forEach(a => { if (a.location) hotspotMap[a.location] = (hotspotMap[a.location] || 0) + 1; });
    violations.forEach(v => { if (v.location) hotspotMap[v.location] = (hotspotMap[v.location] || 0) + 1; });
    const locationHotspots = Object.entries(hotspotMap)
      .map(([location, score]) => ({ location, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const riskRegister = openRisks
      .sort((a, b) => (Number(b.risk_score) || 0) - (Number(a.risk_score) || 0))
      .slice(0, 8)
      .map(r => ({
        title: r.title, category: r.category, level: r.risk_level,
        score: Number(r.risk_score) || 0, status: r.status,
      }));

    const recentIncidents = curInc
      .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
      .slice(0, 8)
      .map(i => ({
        type: i.incident_type, location: i.location, priority: i.priority,
        status: i.status, at: i.reported_at,
      }));

    const patrolSummary = {
      total: curPatrols.length,
      completed: donePatrols.length,
      inProgress: curPatrols.filter(p => p.status === 'In Progress').length,
      checkpointsScanned: curScans.length,
    };

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, incidentByType, locationHotspots, riskRegister, recentIncidents, patrolSummary,
    });
  } catch (err: any) {
    console.error('[exec-security-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute security intelligence' });
  }
});

type SusCategory = 'energy' | 'water' | 'fuel' | 'carbon' | 'waste' | 'esg';

interface SusMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  unit: string;
  category: SusCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

// GET /api/executive/sustainability-intelligence?days=&propertyId=
// Utilities from energy_metrics, efficiency/projects from energy_* tables,
// supplier ESG from proc_sustainability, waste aggregated across uinv_waste +
// fb_waste_records + kitchen_waste + bar_waste (all department portals).
router.get('/sustainability-intelligence', authenticate, execView, execCache('sus-intel'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const prevFrom = prevStart.toISOString().slice(0, 10);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      energyMetrics, equipment, projects, sustSuppliers, suppliers,
      uinvWaste, fbWaste, kitchenWaste, barWaste, rooms, reservations,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_metrics')
        .select('metric_date,electricity_kwh,water_liters,gas_m3,diesel_liters,solar_kwh,total_cost,carbon_footprint_tons')
        .gte('metric_date', prevFrom)), 'energy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_equipment_efficiency')
        .select('equipment_name,category,current_efficiency,target_efficiency,status')), 'energy_equipment_efficiency'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_projects')
        .select('name,type,status,estimated_savings,actual_savings,investment,roi,completion_date')), 'energy_projects'),
      kpiFetchRows(supabaseAdmin!.from('proc_sustainability')
        .select('supplier_id,is_local,is_sustainable,eco_certification,environmental_score,carbon_footprint'), 'proc_sustainability'),
      kpiFetchRows(supabaseAdmin!.from('proc_suppliers').select('id,legal_name,trading_name'), 'proc_suppliers'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_waste')
        .select('quantity,total_cost,waste_type,department,status,created_at')
        .gte('created_at', prevStart.toISOString())), 'uinv_waste'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_waste_records')
        .select('record_date,type,item,quantity,unit,cost')
        .gte('record_date', prevFrom)), 'fb_waste_records'),
      kpiFetchRows(supabaseAdmin!.from('kitchen_waste')
        .select('quantity,unit,cost_value,reason,status,created_at')
        .eq('is_deleted', false)
        .gte('created_at', prevStart.toISOString()), 'kitchen_waste'),
      kpiFetchRows(supabaseAdmin!.from('bar_waste')
        .select('quantity,unit,cost_value,reason,status,created_at')
        .eq('is_deleted', false)
        .gte('created_at', prevStart.toISOString()), 'bar_waste'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id,status')), 'rooms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
        .select('id,check_in_date,check_out_date,status')
        .gte('check_out_date', prevFrom)
        .lte('check_in_date', new Date().toISOString().slice(0, 10))), 'reservations'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const inCurD = (r: any, f: string) => { const d = r[f] ? new Date(r[f]) : null; return d && d >= curStart; };
    const inPrevD = (r: any, f: string) => { const d = r[f] ? new Date(r[f]) : null; return d && d >= prevStart && d < curStart; };

    const curE = energyMetrics.filter(m => inCurD(m, 'metric_date'));
    const prevE = energyMetrics.filter(m => inPrevD(m, 'metric_date'));
    const roomCount = rooms.length || 1;

    // Occupied room nights in window for intensity metrics
    const roomNights = reservations.reduce((s, r) => {
      const ci = new Date(r.check_in_date);
      const co = new Date(r.check_out_date);
      const s_ = ci < curStart ? curStart : ci;
      const e = co > new Date() ? new Date() : co;
      const n = Math.max(0, Math.round((e.getTime() - s_.getTime()) / 86400000));
      return s + n;
    }, 0) || 1;

    const util = (f: string) => ({ cur: sum(curE, f), prev: sum(prevE, f) });
    const elec = util('electricity_kwh');
    const water = util('water_liters');
    const gas = util('gas_m3');
    const diesel = util('diesel_liters');
    const solar = util('solar_kwh');
    const cost = util('total_cost');
    const carbon = util('carbon_footprint_tons');
    const solarShare = elec.cur + solar.cur > 0 ? (solar.cur / (elec.cur + solar.cur)) * 100 : 0;
    const carbonRed = carbon.prev > 0 ? ((carbon.prev - carbon.cur) / carbon.prev) * 100 : 0;

    // Equipment efficiency
    const effGap = equipment.map(e => ({
      name: e.equipment_name, category: e.category,
      current: Number(e.current_efficiency) || 0,
      target: Number(e.target_efficiency) || 0,
      status: e.status,
    }));
    const avgEff = effGap.length ? effGap.reduce((s, e) => s + e.current, 0) / effGap.length : 0;
    const critEquip = effGap.filter(e => e.status === 'Critical' || e.status === 'Warning');

    // Energy projects
    const projList = projects.map(p => ({
      name: p.name, type: p.type, status: p.status,
      estSavings: Number(p.estimated_savings) || 0,
      actSavings: Number(p.actual_savings) || 0,
      investment: Number(p.investment) || 0,
      roi: Number(p.roi) || 0,
    }));
    const doneProj = projList.filter(p => p.status === 'Completed');
    const projSavings = doneProj.reduce((s, p) => s + (p.actSavings || p.estSavings), 0);

    // Waste across all portals
    const curUinv = uinvWaste.filter(w => inCurD(w, 'created_at'));
    const prevUinv = uinvWaste.filter(w => inPrevD(w, 'created_at'));
    const curFb = fbWaste.filter(w => inCurD(w, 'record_date'));
    const prevFb = fbWaste.filter(w => inPrevD(w, 'record_date'));
    const curK = kitchenWaste.filter(w => inCurD(w, 'created_at'));
    const curB = barWaste.filter(w => inCurD(w, 'created_at'));
    const wasteCost = sum(curUinv, 'total_cost') + sum(curFb, 'cost') + sum(curK, 'cost_value') + sum(curB, 'cost_value');
    const prevWasteCost = sum(prevUinv, 'total_cost') + sum(prevFb, 'cost');
    const wasteQty = sum(curUinv, 'quantity') + sum(curFb, 'quantity') + sum(curK, 'quantity') + sum(curB, 'quantity');

    const wasteByDeptMap: Record<string, number> = {};
    curUinv.forEach(w => { const d = w.department || 'General'; wasteByDeptMap[d] = (wasteByDeptMap[d] || 0) + (Number(w.total_cost) || 0); });
    if (sum(curFb, 'cost') > 0) wasteByDeptMap['F&B Outlets'] = (wasteByDeptMap['F&B Outlets'] || 0) + sum(curFb, 'cost');
    if (sum(curK, 'cost_value') > 0) wasteByDeptMap['Kitchen'] = (wasteByDeptMap['Kitchen'] || 0) + sum(curK, 'cost_value');
    if (sum(curB, 'cost_value') > 0) wasteByDeptMap['Bar'] = (wasteByDeptMap['Bar'] || 0) + sum(curB, 'cost_value');
    const wasteByDept = Object.entries(wasteByDeptMap)
      .map(([dept, val]) => ({ department: dept, value: Math.round(val * 100) / 100, sharePct: wasteCost ? Math.round((val / wasteCost) * 1000) / 10 : 0 }))
      .sort((a, b) => b.value - a.value);

    // Supplier ESG
    const supplierName: Record<string, string> = {};
    suppliers.forEach(s => { supplierName[s.id] = s.trading_name || s.legal_name || s.id; });
    const assessed = sustSuppliers.length;
    const sustCount = sustSuppliers.filter(s => s.is_sustainable).length;
    const localCount = sustSuppliers.filter(s => s.is_local).length;
    const ecoCert = sustSuppliers.filter(s => s.eco_certification).length;
    const avgEnvScore = assessed ? sustSuppliers.reduce((s, r) => s + (Number(r.environmental_score) || 0), 0) / assessed : 0;
    const topSuppliers = sustSuppliers
      .filter(s => s.is_sustainable || s.eco_certification)
      .map(s => ({
        name: supplierName[s.supplier_id] || s.supplier_id,
        score: Number(s.environmental_score) || 0,
        local: !!s.is_local, cert: s.eco_certification || null,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const metrics: SusMetric[] = [];
    const push = (id: string, name: string, category: SusCategory, value: number, target: number, threshold: number,
      unit: string, lowerIsBetter = false, previousValue: number | null = null) => {
      metrics.push({
        id, name, category,
        value: Math.round(value * 100) / 100,
        previousValue: previousValue === null ? null : Math.round(previousValue * 100) / 100,
        unit, target, threshold, lowerIsBetter,
        trend: kpiTrend(value, previousValue),
        status: kpiStatus(value, target, threshold, lowerIsBetter),
      });
    };

    // Energy
    push('sus_elec', 'Electricity Consumption', 'energy', elec.cur, 0, 0, 'kWh', true, elec.prev);
    push('sus_energy_cost', 'Utility Cost', 'energy', cost.cur, 0, 0, 'currency', true, cost.prev);
    push('sus_elec_room', 'Energy per Room', 'energy', elec.cur / roomCount, 0, 0, 'kWh', true, elec.prev / roomCount);
    push('sus_elec_occupied', 'Energy per Occupied Room', 'energy', elec.cur / roomNights, 30, 60, 'kWh', true);
    push('sus_solar_share', 'Solar Share', 'energy', solarShare, 20, 5, '%');
    push('sus_avg_eff', 'Avg Equipment Efficiency', 'energy', avgEff, 90, 75, '%');
    push('sus_crit_equip', 'Equipment Below Target', 'energy', critEquip.length, 0, 3, 'count', true);
    push('sus_proj_done', 'Projects Completed', 'energy', doneProj.length, 2, 0, 'count');
    push('sus_proj_savings', 'Realized Project Savings', 'energy', projSavings, 10000, 2000, 'currency');

    // Water
    push('sus_water', 'Water Consumption', 'water', water.cur, 0, 0, 'liters', true, water.prev);
    push('sus_water_room', 'Water per Room', 'water', water.cur / roomCount, 0, 0, 'liters', true, water.prev / roomCount);
    push('sus_water_occ', 'Water per Occupied Room', 'water', water.cur / roomNights, 300, 600, 'liters', true);
    push('sus_water_day', 'Water per Day', 'water', water.cur / days, 0, 0, 'liters', true, water.prev / days);

    // Fuel
    push('sus_gas', 'Gas Consumption', 'fuel', gas.cur, 0, 0, 'm³', true, gas.prev);
    push('sus_diesel', 'Diesel Consumption', 'fuel', diesel.cur, 0, 0, 'liters', true, diesel.prev);
    push('sus_fuel_day', 'Fuel per Day', 'fuel', (gas.cur + diesel.cur) / days, 0, 0, 'units', true);

    // Carbon
    push('sus_carbon', 'Carbon Emissions', 'carbon', carbon.cur, 0, 0, 'tons', true, carbon.prev);
    push('sus_carbon_room', 'Carbon per Occupied Room', 'carbon', carbon.cur / roomNights, 0.02, 0.05, 'tons', true);
    push('sus_carbon_red', 'Carbon Reduction vs Prior', 'carbon', carbonRed, 5, 0, '%');
    push('sus_carbon_day', 'Carbon per Day', 'carbon', carbon.cur / days, 0, 0, 'tons', true, carbon.prev / days);

    // Waste
    push('sus_waste_cost', 'Total Waste Cost', 'waste', wasteCost, 3000, 10000, 'currency', true, prevWasteCost);
    push('sus_waste_qty', 'Waste Quantity', 'waste', wasteQty, 0, 0, 'units', true);
    push('sus_waste_records', 'Waste Records', 'waste', curUinv.length + curFb.length + curK.length + curB.length, 0, 0, 'count', true,
      prevUinv.length + prevFb.length);
    push('sus_fb_waste', 'F&B Waste Cost', 'waste', sum(curFb, 'cost') + sum(curK, 'cost_value') + sum(curB, 'cost_value'),
      2000, 6000, 'currency', true, sum(prevFb, 'cost'));

    // ESG
    push('sus_sust_sup', 'Sustainable Suppliers', 'esg', assessed ? (sustCount / assessed) * 100 : 0, 60, 30, '%');
    push('sus_local_sup', 'Local Suppliers', 'esg', assessed ? (localCount / assessed) * 100 : 0, 50, 25, '%');
    push('sus_eco_cert', 'Eco-Certified Suppliers', 'esg', ecoCert, 5, 1, 'count');
    push('sus_env_score', 'Avg Supplier Env Score', 'esg', avgEnvScore, 70, 40, '/100');
    push('sus_proj_active', 'Green Projects Active', 'esg', projList.filter(p => p.status === 'In Progress').length, 3, 1, 'count');

    await applyConfiguredTargets(metrics);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics,
      utilityBreakdown: [
        { utility: 'Electricity', cur: elec.cur, prev: elec.prev, unit: 'kWh' },
        { utility: 'Solar', cur: solar.cur, prev: solar.prev, unit: 'kWh' },
        { utility: 'Water', cur: water.cur, prev: water.prev, unit: 'liters' },
        { utility: 'Gas', cur: gas.cur, prev: gas.prev, unit: 'm³' },
        { utility: 'Diesel', cur: diesel.cur, prev: diesel.prev, unit: 'liters' },
      ],
      energyProjects: projList,
      wasteByDept,
      equipmentBelowTarget: critEquip.slice(0, 8),
      topSuppliers,
      roomNights,
    });
  } catch (err: any) {
    console.error('[exec-sustainability-intelligence]', err);
    res.status(500).json({ error: 'Failed to compute sustainability intelligence' });
  }
});

type BenchCategory = 'revenue' | 'occupancy' | 'adr' | 'revpar' | 'cost' | 'satisfaction' | 'productivity';
type BenchBasis = 'prev_period' | 'prev_year' | 'forecast' | 'competitor' | 'industry' | 'budget';

interface BenchMetric {
  id: string;
  name: string;
  category: BenchCategory;
  unit: string;
  value: number;
  lowerIsBetter: boolean;
  comparisons: Partial<Record<BenchBasis, number>>;
}

// GET /api/executive/benchmarking?days=&propertyId=
// Each metric returns its live value plus every comparison baseline that
// actually has data: previous period (computed), previous year (rms_bi_yoy_metrics),
// forecast (demand_forecasts), competitor (competitor_rates), industry
// (fb_benchmarking_data quartiles). Panels: comp set, industry benchmarks,
// outlet benchmarks, YoY metrics, market trends, forecast accuracy.
router.get('/benchmarking', authenticate, execView, execCache('benchmarking'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const now = new Date();
    const curStart = new Date(now.getTime() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const yearAgoStart = new Date(curStart); yearAgoStart.setFullYear(yearAgoStart.getFullYear() - 1);
    const yearAgoEnd = new Date(now); yearAgoEnd.setFullYear(yearAgoEnd.getFullYear() - 1);
    const todayStr = now.toISOString().slice(0, 10);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      rooms, reservations, orders, banquets, costAn, laborAn, energyM,
      feedback, employees, competitors, compRates, industryBench,
      outletBench, outlets, yoyRows, marketTrends, forecastAcc, forecasts,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id,status')), 'rooms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
        .select('id,check_in_date,check_out_date,status,rate,total_amount')
        .gte('check_out_date', yearAgoStart.toISOString().slice(0, 10))), 'reservations'),
      kpiFetchRows(supabaseAdmin!.from('orders')
        .select('id,status,total_amount,created_at')
        .gte('created_at', prevStart.toISOString()), 'orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('banquet_events')
        .select('id,status,event_date,actual_revenue')
        .gte('event_date', yearAgoStart.toISOString().slice(0, 10))), 'banquet_events'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_cost_analytics')
        .select('food_cost_pct,bev_cost_pct,waste,actual,period')), 'fb_cost_analytics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
        .select('department,budget,actual')), 'hr_labor_cost_analysis'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_metrics')
        .select('metric_date,total_cost')
        .gte('metric_date', prevStart.toISOString().slice(0, 10))), 'energy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sales_guest_feedback')
        .select('rating,feedback_date')
        .gte('feedback_date', yearAgoStart.toISOString().slice(0, 10))), 'sales_guest_feedback'),
      kpiFetchRows(scoped(supabaseAdmin!.from('employees')
        .select('id,status')), 'employees'),
      kpiFetchRows(supabaseAdmin!.from('competitors')
        .select('id,name,star_rating,proximity_km,competitor_type,active')
        .eq('active', true), 'competitors'),
      kpiFetchRows(supabaseAdmin!.from('competitor_rates')
        .select('competitor_id,date,rate,availability,collected_at')
        .gte('date', curStart.toISOString().slice(0, 10))
        .order('date', { ascending: false }), 'competitor_rates'),
      kpiFetchRows(supabaseAdmin!.from('fb_benchmarking_data')
        .select('metric_name,metric_category,industry_average,top_quartile,bottom_quartile,region,year'), 'fb_benchmarking_data'),
      kpiFetchRows(supabaseAdmin!.from('fb_outlet_benchmarks')
        .select('outlet_id,metric_name,actual_value,benchmark_value,variance_percent,percentile,trend,benchmark_date')
        .order('benchmark_date', { ascending: false }), 'fb_outlet_benchmarks'),
      kpiFetchRows(supabaseAdmin!.from('outlets').select('id,name'), 'outlets'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_bi_yoy_metrics')
        .select('metric,current_value,previous_value,growth,display_order')
        .order('display_order')), 'rms_bi_yoy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_bi_market_trends')
        .select('trend,impact,confidence,display_order')
        .order('display_order')), 'rms_bi_market_trends'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_bi_forecast_accuracy')
        .select('period,accuracy,variance,display_order')
        .order('display_order')), 'rms_bi_forecast_accuracy'),
      kpiFetchRows(scoped(supabaseAdmin!.from('demand_forecasts')
        .select('target_date,forecast_occupancy,forecast_demand')
        .gte('target_date', todayStr)), 'demand_forecasts'),
    ]);

    const inCur = (d: any, f: string) => { const t = d[f] ? new Date(d[f]) : null; return t && t >= curStart && t <= now; };
    const inPrev = (d: any, f: string) => { const t = d[f] ? new Date(d[f]) : null; return t && t >= prevStart && t < curStart; };
    const inYoY = (d: any, f: string) => { const t = d[f] ? new Date(d[f]) : null; return t && t >= yearAgoStart && t <= yearAgoEnd; };

    const resActive = reservations.filter(r => !['Cancelled', 'No Show'].includes(r.status));
    const nightsBetween = (r: any, s: Date, e: Date) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return 0;
      return Math.max(0, (Math.min(co, e.getTime()) - Math.max(ci, s.getTime())) / 86400000);
    };
    const roomNightsIn = (s: Date, e: Date) => resActive.reduce((sum, r) => sum + nightsBetween(r, s, e), 0);
    const roomRevIn = (s: Date, e: Date) =>
      resActive.reduce((sum, r) => sum + nightsBetween(r, s, e) * (Number(r.rate) || 0), 0);

    const totalRooms = rooms.length;
    const roomDenom = totalRooms * days;
    const curNights = roomNightsIn(curStart, now);
    const prevNights = roomNightsIn(prevStart, curStart);
    const yoyNights = roomNightsIn(yearAgoStart, yearAgoEnd);
    const curRoomRev = roomRevIn(curStart, now);
    const prevRoomRev = roomRevIn(prevStart, curStart);
    const yoyRoomRev = roomRevIn(yearAgoStart, yearAgoEnd);

    const occupancy = roomDenom > 0 ? (curNights / roomDenom) * 100 : 0;
    const prevOccupancy = roomDenom > 0 ? (prevNights / roomDenom) * 100 : 0;
    const yoyOccupancy = roomDenom > 0 ? (yoyNights / roomDenom) * 100 : 0;
    const adr = curNights > 0 ? curRoomRev / curNights : 0;
    const prevAdr = prevNights > 0 ? prevRoomRev / prevNights : 0;
    const yoyAdr = yoyNights > 0 ? yoyRoomRev / yoyNights : 0;
    const revpar = roomDenom > 0 ? curRoomRev / roomDenom : 0;
    const prevRevpar = roomDenom > 0 ? prevRoomRev / roomDenom : 0;
    const yoyRevpar = roomDenom > 0 ? yoyRoomRev / roomDenom : 0;

    const liveOrders = orders.filter(o => !['Cancelled', 'Void'].includes(o.status));
    const curFbRev = liveOrders.filter(o => inCur(o, 'created_at')).reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const prevFbRev = liveOrders.filter(o => inPrev(o, 'created_at')).reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const liveBanquets = banquets.filter(b => !['Cancelled'].includes(b.status));
    const curBanq = liveBanquets.filter(b => inCur(b, 'event_date')).reduce((s, b) => s + (Number(b.actual_revenue) || 0), 0);
    const prevBanq = liveBanquets.filter(b => inPrev(b, 'event_date')).reduce((s, b) => s + (Number(b.actual_revenue) || 0), 0);
    const yoyBanq = liveBanquets.filter(b => inYoY(b, 'event_date')).reduce((s, b) => s + (Number(b.actual_revenue) || 0), 0);
    const totalRev = curRoomRev + curFbRev + curBanq;
    const prevTotalRev = prevRoomRev + prevFbRev + prevBanq;
    const yoyTotalRev = yoyRoomRev + yoyBanq;

    // Costs
    const foodCostPct = costAn.length
      ? costAn.reduce((s, c) => s + (Number(c.food_cost_pct) || 0), 0) / costAn.length : 0;
    const bevCostPct = costAn.length
      ? costAn.reduce((s, c) => s + (Number(c.bev_cost_pct) || 0), 0) / costAn.length : 0;
    const laborActual = laborAn.reduce((s, l) => s + (Number(l.actual) || 0), 0);
    const laborCostPct = totalRev > 0 ? (laborActual / totalRev) * 100 : 0;
    const curEnergy = energyM.filter(e => inCur(e, 'metric_date')).reduce((s, e) => s + (Number(e.total_cost) || 0), 0);
    const prevEnergy = energyM.filter(e => inPrev(e, 'metric_date')).reduce((s, e) => s + (Number(e.total_cost) || 0), 0);

    // Satisfaction
    const curFb_ = feedback.filter(f => inCur(f, 'feedback_date'));
    const prevFb_ = feedback.filter(f => inPrev(f, 'feedback_date'));
    const avgRating = curFb_.length ? curFb_.reduce((s, f) => s + (Number(f.rating) || 0), 0) / curFb_.length : 0;
    const prevRating = prevFb_.length ? prevFb_.reduce((s, f) => s + (Number(f.rating) || 0), 0) / prevFb_.length : 0;
    const nps = curFb_.length
      ? (curFb_.filter(f => Number(f.rating) >= 5).length - curFb_.filter(f => Number(f.rating) <= 3).length) / curFb_.length * 100 : 0;
    const prevNps = prevFb_.length
      ? (prevFb_.filter(f => Number(f.rating) >= 5).length - prevFb_.filter(f => Number(f.rating) <= 3).length) / prevFb_.length * 100 : 0;

    // Productivity
    const headcount = employees.filter(e => e.status !== 'Inactive' && e.status !== 'Terminated').length || 1;
    const revPerEmp = totalRev / headcount;
    const prevRevPerEmp = prevTotalRev / headcount;
    const roomsPerStaff = headcount > 0 ? totalRooms / headcount : 0;

    // Competitor set
    const latestRate: Record<string, { rate: number; date: string; avail: boolean | null }> = {};
    compRates.forEach(r => {
      if (!latestRate[r.competitor_id] || r.date > latestRate[r.competitor_id].date) {
        latestRate[r.competitor_id] = { rate: Number(r.rate) || 0, date: r.date, avail: r.availability };
      }
    });
    const compMembers = competitors.map(c => ({
      name: c.name,
      starRating: c.star_rating,
      proximityKm: c.proximity_km !== null ? Number(c.proximity_km) : null,
      type: c.competitor_type,
      latestRate: latestRate[c.id]?.rate ?? null,
      rateDate: latestRate[c.id]?.date ?? null,
      available: latestRate[c.id]?.avail ?? null,
    }));
    const compRatesList = compMembers.filter(m => m.latestRate !== null).map(m => m.latestRate as number);
    const avgCompRate = compRatesList.length ? compRatesList.reduce((a, b) => a + b, 0) / compRatesList.length : 0;
    const compPosition = avgCompRate > 0 && adr > 0
      ? compRatesList.filter(r => r >= adr).length + 1 : 0;

    // Forecast baseline
    const fcOcc = forecasts.length
      ? forecasts.reduce((s, f) => s + (Number(f.forecast_occupancy) || 0), 0) / forecasts.length : null;

    // Industry benchmark lookup
    const matchIndustry = (keywords: string[]): number | null => {
      const row = industryBench.find(b =>
        keywords.some(k => (b.metric_name || '').toLowerCase().includes(k)));
      return row ? Number(row.industry_average) : null;
    };

    // YoY lookup
    const matchYoy = (keywords: string[]): number | null => {
      const row = yoyRows.find(y =>
        keywords.some(k => (y.metric || '').toLowerCase().includes(k)));
      return row ? Number(row.previous_value) : null;
    };

    const cmp = (basis: BenchBasis, v: number | null): Partial<Record<BenchBasis, number>> =>
      v === null || v === undefined || isNaN(v) ? {} : { [basis]: Math.round(v * 100) / 100 };

    const metrics: BenchMetric[] = [];
    const push = (id: string, name: string, category: BenchCategory, unit: string,
      value: number, lowerIsBetter: boolean, comparisons: Partial<Record<BenchBasis, number>>) => {
      metrics.push({ id, name, category, unit, lowerIsBetter, value: Math.round(value * 100) / 100, comparisons });
    };

    // Revenue
    push('total_revenue', 'Total Revenue', 'revenue', 'currency', totalRev, false,
      { ...cmp('prev_period', prevTotalRev), ...cmp('prev_year', yoyTotalRev || matchYoy(['revenue', 'total'])) });
    push('rooms_revenue', 'Rooms Revenue', 'revenue', 'currency', curRoomRev, false,
      { ...cmp('prev_period', prevRoomRev), ...cmp('prev_year', yoyRoomRev || matchYoy(['room'])) });
    push('fb_revenue', 'F&B + Events Revenue', 'revenue', 'currency', curFbRev + curBanq, false,
      { ...cmp('prev_period', prevFbRev + prevBanq), ...cmp('prev_year', matchYoy(['f&b', 'food', 'banquet'])) });

    // Occupancy
    push('occupancy', 'Occupancy Rate', 'occupancy', '%', occupancy, false,
      { ...cmp('prev_period', prevOccupancy), ...cmp('prev_year', yoyOccupancy || matchYoy(['occup'])),
        ...cmp('forecast', fcOcc), ...cmp('industry', matchIndustry(['occup'])) });
    push('room_nights', 'Room Nights Sold', 'occupancy', 'count', curNights, false,
      { ...cmp('prev_period', prevNights), ...cmp('prev_year', yoyNights) });

    // ADR
    push('adr', 'Average Daily Rate', 'adr', 'currency', adr, false,
      { ...cmp('prev_period', prevAdr), ...cmp('prev_year', yoyAdr || matchYoy(['adr', 'rate'])),
        ...cmp('competitor', compRatesList.length ? avgCompRate : null),
        ...cmp('industry', matchIndustry(['adr', 'rate'])) });
    push('adr_index', 'ADR vs Comp Set', 'adr', '%', avgCompRate > 0 ? (adr / avgCompRate) * 100 : 0, false,
      { ...cmp('competitor', compRatesList.length ? 100 : null) });

    // RevPAR
    push('revpar', 'RevPAR', 'revpar', 'currency', revpar, false,
      { ...cmp('prev_period', prevRevpar), ...cmp('prev_year', yoyRevpar || matchYoy(['revpar'])),
        ...cmp('industry', matchIndustry(['revpar'])) });
    push('trevpar', 'TRevPAR (incl. F&B/Events)', 'revpar', 'currency',
      roomDenom > 0 ? totalRev / roomDenom : 0, false,
      { ...cmp('prev_period', roomDenom > 0 ? prevTotalRev / roomDenom : null) });

    // Cost
    push('food_cost', 'Food Cost %', 'cost', '%', foodCostPct, true,
      { ...cmp('industry', matchIndustry(['food cost', 'food_cost', 'food'])),
        ...cmp('prev_period', matchYoy(['food'])) });
    push('bev_cost', 'Beverage Cost %', 'cost', '%', bevCostPct, true,
      { ...cmp('industry', matchIndustry(['beverage', 'bev'])) });
    push('labor_cost', 'Labor Cost %', 'cost', '%', laborCostPct, true,
      { ...cmp('industry', matchIndustry(['labor', 'labour', 'payroll'])) });
    push('energy_cost', 'Energy & Utility Cost', 'cost', 'currency', curEnergy, true,
      { ...cmp('prev_period', prevEnergy), ...cmp('industry', matchIndustry(['energy', 'utility'])) });

    // Satisfaction
    push('guest_sat', 'Guest Satisfaction', 'satisfaction', '/5', avgRating, false,
      { ...cmp('prev_period', prevFb_.length ? prevRating : null), ...cmp('industry', matchIndustry(['satisf', 'rating', 'review'])) });
    push('nps', 'Net Promoter Score', 'satisfaction', 'score', nps, false,
      { ...cmp('prev_period', prevFb_.length ? prevNps : null), ...cmp('industry', matchIndustry(['nps', 'promoter'])) });

    // Productivity
    push('rev_per_emp', 'Revenue per Employee', 'productivity', 'currency', revPerEmp, false,
      { ...cmp('prev_period', prevRevPerEmp), ...cmp('industry', matchIndustry(['employee', 'productivity'])) });
    push('rooms_per_staff', 'Rooms per Staff', 'productivity', 'ratio', roomsPerStaff, false, {});
    push('rev_per_room', 'Revenue per Room', 'productivity', 'currency',
      totalRooms > 0 ? totalRev / totalRooms : 0, false,
      { ...cmp('prev_period', totalRooms > 0 ? prevTotalRev / totalRooms : null) });

    // Panels
    const industryBenchmarks = industryBench.map(b => {
      const name = (b.metric_name || '').toLowerCase();
      let ourValue: number | null = null;
      if (name.includes('food')) ourValue = foodCostPct || null;
      else if (name.includes('beverage') || name.includes('bev')) ourValue = bevCostPct || null;
      else if (name.includes('labor') || name.includes('labour') || name.includes('payroll')) ourValue = laborCostPct || null;
      else if (name.includes('occup')) ourValue = occupancy || null;
      else if (name.includes('adr') || name.includes('rate')) ourValue = adr || null;
      else if (name.includes('revpar')) ourValue = revpar || null;
      else if (name.includes('energy') || name.includes('utility')) ourValue = curEnergy || null;
      else if (name.includes('satisf') || name.includes('rating')) ourValue = avgRating || null;
      return {
        metric: b.metric_name, category: b.metric_category, region: b.region, year: b.year,
        industryAvg: Number(b.industry_average) || 0,
        topQuartile: Number(b.top_quartile) || 0,
        bottomQuartile: Number(b.bottom_quartile) || 0,
        ourValue: ourValue === null ? null : Math.round(ourValue * 100) / 100,
      };
    });

    const outletName: Record<string, string> = {};
    outlets.forEach(o => { outletName[o.id] = o.name; });
    const outletBenchmarks = outletBench.slice(0, 20).map(b => ({
      outlet: outletName[b.outlet_id] || b.outlet_id,
      metric: b.metric_name,
      actual: Number(b.actual_value) || 0,
      benchmark: Number(b.benchmark_value) || 0,
      variancePct: Number(b.variance_percent) || 0,
      percentile: b.percentile !== null ? Number(b.percentile) : null,
      trend: b.trend,
    }));

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics,
      compSet: {
        ourAdr: Math.round(adr * 100) / 100,
        avgCompRate: Math.round(avgCompRate * 100) / 100,
        position: compPosition,
        total: compMembers.length,
        members: compMembers,
      },
      industryBenchmarks,
      outletBenchmarks,
      yoyMetrics: yoyRows.map(y => ({
        metric: y.metric,
        current: Number(y.current_value) || 0,
        previous: Number(y.previous_value) || 0,
        growth: Number(y.growth) || 0,
      })),
      marketTrends: marketTrends.map(t => ({
        trend: t.trend, impact: t.impact, confidence: Number(t.confidence) || 0,
      })),
      forecastAccuracy: forecastAcc.map(f => ({
        period: f.period, accuracy: Number(f.accuracy) || 0, variance: Number(f.variance) || 0,
      })),
    });
  } catch (err: any) {
    console.error('[exec-benchmarking]', err);
    res.status(500).json({ error: 'Failed to compute benchmarking' });
  }
});

type FcCategory = 'revenue' | 'occupancy' | 'cashflow' | 'payroll' | 'purchase' | 'utility' | 'labor' | 'demand';

interface FcMetric {
  id: string;
  name: string;
  forecast: number;
  actual: number | null;
  accuracy: number | null;
  unit: string;
  category: FcCategory;
  confidence: number | null;
}

// GET /api/executive/forecasting?days=&propertyId=
// Forecast sources across portals: demand_forecasts + forecast_accuracy (rooms),
// fb_sales_forecasts + fb_labor_forecast (F&B), ops_housekeeping_demand_forecast +
// ops_labor_cost_forecast (ops), proc_demand_forecasts (procurement),
// fin_bi_forecasts + treasury_cash_forecasts/liquidity (finance),
// rms_bi_heat_map + demand_events + rms_bi_forecast_accuracy (RMS).
router.get('/forecasting', authenticate, execView, execCache('forecasting'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
    const in90 = new Date(now); in90.setDate(in90.getDate() + 90);
    const s7 = in7.toISOString().slice(0, 10);
    const s30 = in30.toISOString().slice(0, 10);
    const s90 = in90.toISOString().slice(0, 10);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      demandFc, fcAccuracy, demandEvents, fbSales, fbLabor, hkDemand,
      laborCost, procDemand, finFc, cashFc, liqFc, heatMap, rmsAcc, energyM,
      hrLabor, employees,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('demand_forecasts')
        .select('room_type_id,target_date,forecast_demand,forecast_occupancy,confidence_score,forecast_horizon_days')
        .gte('target_date', todayStr).lte('target_date', s90)), 'demand_forecasts'),
      kpiFetchRows(supabaseAdmin!.from('forecast_accuracy')
        .select('forecast_id,actual_demand,actual_occupancy,error_percent'), 'forecast_accuracy'),
      kpiFetchRows(supabaseAdmin!.from('demand_events')
        .select('name,event_type,start_date,end_date,impact_score,expected_attendees,room_demand_impact')
        .eq('active', true).gte('end_date', todayStr), 'demand_events'),
      kpiFetchRows(supabaseAdmin!.from('fb_sales_forecasts')
        .select('outlet_id,forecast_date,meal_period,predicted_revenue,predicted_orders,confidence,actual_revenue')
        .gte('forecast_date', todayStr).lte('forecast_date', s30), 'fb_sales_forecasts'),
      kpiFetchRows(supabaseAdmin!.from('fb_labor_forecast')
        .select('outlet_id,forecast_date,expected_revenue,expected_orders,expected_guests,recommended_staff_count,recommended_hours')
        .gte('forecast_date', todayStr).lte('forecast_date', s30), 'fb_labor_forecast'),
      kpiFetchRows(supabaseAdmin!.from('ops_housekeeping_demand_forecast')
        .select('forecast_date,expected_checkouts,expected_checkins,expected_occupancy,predicted_staff_required,predicted_tasks_total,confidence_level')
        .gte('forecast_date', todayStr).lte('forecast_date', s30), 'ops_housekeeping_demand_forecast'),
      kpiFetchRows(scoped(supabaseAdmin!.from('ops_labor_cost_forecast')
        .select('department,period_start,period_end,projected_labor_cost,budget,variance_percent,forecast_confidence')
        .gte('period_end', todayStr)), 'ops_labor_cost_forecast'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_demand_forecasts')
        .select('department,category,forecast_date,forecast_quantity,unit_of_measure,confidence_level,forecast_source')
        .gte('forecast_date', todayStr).lte('forecast_date', s90)), 'proc_demand_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fin_bi_forecasts')
        .select('metric,forecast,actual,variance,accuracy,period,unit')), 'fin_bi_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('treasury_cash_forecasts')
        .select('period,opening_balance,inflows,outflows,net_cash_flow,closing_balance')), 'treasury_cash_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('treasury_liquidity_forecasts')
        .select('week_label,opening,inflows,outflows,closing,status')), 'treasury_liquidity_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_bi_heat_map')
        .select('room_type,month,intensity')
        .order('month')), 'rms_bi_heat_map'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_bi_forecast_accuracy')
        .select('period,accuracy,variance,display_order')
        .order('display_order')), 'rms_bi_forecast_accuracy'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_metrics')
        .select('metric_date,total_cost')
        .gte('metric_date', new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10))), 'energy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
        .select('department,period,budget,actual')), 'hr_labor_cost_analysis'),
      kpiFetchRows(scoped(supabaseAdmin!.from('employees')
        .select('id,department,salary,status')), 'employees'),
    ]);

    const sum = (arr: any[], f: string) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const avg = (arr: any[], f: string) => arr.length ? sum(arr, f) / arr.length : 0;
    const inRange = (d: string, end: string) => d >= todayStr && d <= end;

    const fc7 = demandFc.filter(f => inRange(f.target_date, s7));
    const fc30 = demandFc.filter(f => inRange(f.target_date, s30));
    const fc90 = demandFc;

    // Accuracy: forecast_accuracy rows (rooms) + rms_bi_forecast_accuracy
    const accRows = fcAccuracy.map(a => 100 - (Number(a.error_percent) || 0)).filter(a => a >= 0 && a <= 100);
    const roomAcc = accRows.length ? accRows.reduce((a, b) => a + b, 0) / accRows.length : null;
    const rmsAccAvg = rmsAcc.length ? rmsAcc.reduce((s, r) => s + (Number(r.accuracy) || 0), 0) / rmsAcc.length : null;
    const overallAcc = roomAcc ?? rmsAccAvg;

    // F&B forecast vs actual
    const fbPredRev = sum(fbSales, 'predicted_revenue');
    const fbActRev = sum(fbSales, 'actual_revenue');
    const fbAcc = fbPredRev > 0 && fbActRev > 0
      ? Math.max(0, 100 - Math.abs(fbActRev - fbPredRev) / fbPredRev * 100) : null;

    // fin_bi_forecasts by metric keyword
    const finByMetric = (kw: string[]) =>
      finFc.filter(f => kw.some(k => (f.metric || '').toLowerCase().includes(k)));
    const finRev = finByMetric(['revenue', 'revpar', 'adr']);
    const finUtil = finByMetric(['utility', 'energy', 'utilities']);

    // Treasury
    const nextCash = cashFc.slice(0, 4);
    const cashNet = nextCash.reduce((s, c) => s + (Number(c.net_cash_flow) || 0), 0);
    const liqWatch = liqFc.filter(l => l.status !== 'Surplus').length;

    // Labor — ops_labor_cost_forecast when deployed, else hr_labor_cost_analysis
    // actuals + employees.salary as the forward payroll exposure baseline.
    let projLabor = laborCost.reduce((s, l) => s + (Number(l.projected_labor_cost) || 0), 0);
    let laborBudget = laborCost.reduce((s, l) => s + (Number(l.budget) || 0), 0);
    const activeEmps = employees.filter(e => !['Inactive', 'Terminated'].includes(e.status));
    const monthlyPayroll = activeEmps.reduce((s, e) => s + (Number(e.salary) || 0), 0);
    if (projLabor === 0 && monthlyPayroll > 0) {
      projLabor = monthlyPayroll;
      laborBudget = hrLabor.reduce((s, l) => s + (Number(l.budget) || 0), 0);
    }
    const hkStaffNeeded = sum(hkDemand, 'predicted_staff_required');
    const hkTasks = sum(hkDemand, 'predicted_tasks_total');
    const fbStaffHours = sum(fbLabor, 'recommended_hours');
    const fbStaffCount = sum(fbLabor, 'recommended_staff_count');

    // Procurement
    const procQty = sum(procDemand, 'forecast_quantity');
    const procByDept: Record<string, { qty: number; items: number }> = {};
    procDemand.forEach(p => {
      const d = p.department || 'General';
      if (!procByDept[d]) procByDept[d] = { qty: 0, items: 0 };
      procByDept[d].qty += Number(p.forecast_quantity) || 0;
      procByDept[d].items += 1;
    });

    // Utility projection from trailing avg daily cost
    const energyDaily = energyM.length ? sum(energyM, 'total_cost') / energyM.length : 0;
    const util30 = energyDaily * 30;

    const metrics: FcMetric[] = [];
    const push = (id: string, name: string, category: FcCategory, forecast: number,
      unit: string, actual: number | null = null, accuracy: number | null = null,
      confidence: number | null = null) => {
      metrics.push({
        id, name, category, unit,
        forecast: Math.round(forecast * 100) / 100,
        actual: actual === null ? null : Math.round(actual * 100) / 100,
        accuracy: accuracy === null ? null : Math.round(accuracy * 10) / 10,
        confidence: confidence === null ? null : Math.round(confidence * 10) / 10,
      });
    };

    // Revenue
    const revFc = finRev.length ? sum(finRev, 'forecast') : null;
    const revAct = finRev.length ? sum(finRev, 'actual') : null;
    const revAcc = finRev.length ? avg(finRev, 'accuracy') : null;
    push('fc_revenue_30d', 'Revenue Forecast (30d)', 'revenue',
      revFc ?? fbPredRev, 'currency', revAct ?? (fbActRev || null), revAcc ?? fbAcc,
      fbSales.length ? avg(fbSales, 'confidence') * (avg(fbSales, 'confidence') <= 1 ? 100 : 1) : null);
    push('fc_fb_rev', 'F&B Revenue Forecast (30d)', 'revenue', fbPredRev, 'currency',
      fbActRev || null, fbAcc);
    push('fc_fb_orders', 'F&B Orders Forecast (30d)', 'revenue', sum(fbSales, 'predicted_orders'),
      'count', null, null, fbSales.length ? avg(fbSales, 'confidence') * (avg(fbSales, 'confidence') <= 1 ? 100 : 1) : null);

    // Occupancy
    push('fc_occ_7', 'Occupancy Forecast (7d)', 'occupancy', avg(fc7, 'forecast_occupancy'),
      '%', null, overallAcc, avg(fc7, 'confidence_score') * (avg(fc7, 'confidence_score') <= 1 ? 100 : 1) || null);
    push('fc_occ_30', 'Occupancy Forecast (30d)', 'occupancy', avg(fc30, 'forecast_occupancy'),
      '%', null, overallAcc, avg(fc30, 'confidence_score') * (avg(fc30, 'confidence_score') <= 1 ? 100 : 1) || null);
    push('fc_occ_90', 'Occupancy Forecast (90d)', 'occupancy', avg(fc90, 'forecast_occupancy'),
      '%', null, overallAcc, avg(fc90, 'confidence_score') * (avg(fc90, 'confidence_score') <= 1 ? 100 : 1) || null);

    // Demand
    push('fc_demand_7', 'Room Demand (7d)', 'demand', sum(fc7, 'forecast_demand'), 'room-nights', null, overallAcc);
    push('fc_demand_30', 'Room Demand (30d)', 'demand', sum(fc30, 'forecast_demand'), 'room-nights', null, overallAcc);
    push('fc_events', 'Upcoming Demand Events', 'demand', demandEvents.length, 'count');
    push('fc_event_rooms', 'Event Room-Night Impact', 'demand', sum(demandEvents, 'room_demand_impact'), 'room-nights');

    // Cash flow
    push('fc_cash_net', 'Net Cash Flow (next periods)', 'cashflow', cashNet, 'currency');
    push('fc_cash_in', 'Projected Inflows', 'cashflow', nextCash.reduce((s, c) => s + (Number(c.inflows) || 0), 0), 'currency');
    push('fc_cash_out', 'Projected Outflows', 'cashflow', nextCash.reduce((s, c) => s + (Number(c.outflows) || 0), 0), 'currency');
    push('fc_liq_watch', 'Liquidity Watch/Deficit Weeks', 'cashflow', liqWatch, 'count', null, null);

    // Payroll — variance only meaningful when both sides come from the same
    // forecast table; the employees.salary fallback is monthly exposure vs a
    // period budget, so a ratio there would be misleading.
    const laborFromForecast = laborCost.length > 0;
    push('fc_labor_cost', laborFromForecast ? 'Projected Labor Cost' : 'Monthly Payroll Exposure',
      'payroll', projLabor, 'currency',
      null, null, laborFromForecast ? avg(laborCost, 'forecast_confidence') * (avg(laborCost, 'forecast_confidence') <= 1 ? 100 : 1) : null);
    push('fc_labor_budget', 'Labor Budget', 'payroll', laborBudget, 'currency');
    if (laborFromForecast && laborBudget > 0) {
      push('fc_labor_var', 'Labor Variance', 'payroll',
        ((projLabor - laborBudget) / laborBudget) * 100, '%');
    }

    // Purchase
    push('fc_proc_qty', 'Forecast Purchase Qty (90d)', 'purchase', procQty, 'units');
    push('fc_proc_lines', 'Procurement Forecast Lines', 'purchase', procDemand.length, 'count');
    push('fc_proc_depts', 'Departments Covered', 'purchase', Object.keys(procByDept).length, 'count');

    // Utility
    push('fc_util_30', 'Utility Cost Forecast (30d)', 'utility',
      finUtil.length ? sum(finUtil, 'forecast') : util30, 'currency',
      finUtil.length ? sum(finUtil, 'actual') : null,
      finUtil.length ? avg(finUtil, 'accuracy') : null);
    push('fc_util_day', 'Avg Daily Utility Cost', 'utility', energyDaily, 'currency');

    // Labor demand
    push('fc_hk_staff', 'HK Staff Required (30d)', 'labor', hkStaffNeeded, 'staff-days',
      null, null, hkDemand.length ? avg(hkDemand, 'confidence_level') * (avg(hkDemand, 'confidence_level') <= 1 ? 100 : 1) : null);
    push('fc_hk_tasks', 'HK Tasks Forecast (30d)', 'labor', hkTasks, 'count');
    push('fc_hk_checkouts', 'Expected Checkouts (30d)', 'labor', sum(hkDemand, 'expected_checkouts'), 'count');
    push('fc_fb_staff', 'F&B Staff Hours (30d)', 'labor', fbStaffHours, 'hrs');
    push('fc_fb_shifts', 'F&B Staff Needed (30d)', 'labor', fbStaffCount, 'staff-days');

    // Panels
    const accuracyBySource = [
      ...rmsAcc.map(r => ({ source: `RMS ${r.period}`, accuracy: Number(r.accuracy) || 0, variance: Number(r.variance) || 0 })),
      ...(roomAcc !== null ? [{ source: 'Demand Forecasts', accuracy: Math.round(roomAcc * 10) / 10, variance: 100 - roomAcc }] : []),
      ...(fbAcc !== null ? [{ source: 'F&B Sales', accuracy: Math.round(fbAcc * 10) / 10, variance: Math.round((100 - fbAcc) * 10) / 10 }] : []),
    ];

    const upcomingEvents = demandEvents
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 8)
      .map(e => ({
        name: e.name, type: e.event_type, start: e.start_date, end: e.end_date,
        impact: Number(e.impact_score) || 0,
        roomNights: Number(e.room_demand_impact) || 0,
        attendees: Number(e.expected_attendees) || 0,
      }));

    const heatMapByType: Record<string, Record<number, number>> = {};
    heatMap.forEach(h => {
      if (!heatMapByType[h.room_type]) heatMapByType[h.room_type] = {};
      heatMapByType[h.room_type][Number(h.month)] = Number(h.intensity) || 0;
    });

    const cashForecast = nextCash.map(c => ({
      period: c.period,
      inflows: Number(c.inflows) || 0,
      outflows: Number(c.outflows) || 0,
      net: Number(c.net_cash_flow) || 0,
      closing: Number(c.closing_balance) || 0,
    }));

    const deptLabor = laborCost.length > 0
      ? laborCost.map(l => ({
          department: l.department,
          projected: Number(l.projected_labor_cost) || 0,
          budget: Number(l.budget) || 0,
          variancePct: Number(l.variance_percent) || 0,
          confidence: Number(l.forecast_confidence) || 0,
        }))
      : hrLabor.map(l => ({
          department: l.department,
          projected: Number(l.actual) || 0,
          budget: Number(l.budget) || 0,
          variancePct: Number(l.budget) > 0
            ? ((Number(l.actual) - Number(l.budget)) / Number(l.budget)) * 100 : 0,
          confidence: 0,
        }));

    const procForecast = Object.entries(procByDept)
      .map(([department, v]) => ({ department, qty: Math.round(v.qty * 100) / 100, items: v.items }))
      .sort((a, b) => b.qty - a.qty);

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      metrics, accuracyBySource, upcomingEvents, heatMapByType,
      cashForecast, deptLabor, procForecast,
      liquidityWeeks: liqFc.map(l => ({
        week: l.week_label, closing: Number(l.closing) || 0, status: l.status,
      })),
    });
  } catch (err: any) {
    console.error('[exec-forecasting]', err);
    res.status(500).json({ error: 'Failed to compute forecasting' });
  }
});

type AiCategory = 'revenue' | 'cost' | 'staffing' | 'purchasing' | 'energy'
  | 'upselling' | 'crossselling' | 'retention' | 'maintenance' | 'risk';
type AiStatus = 'pending' | 'in_progress' | 'implemented' | 'dismissed';

interface AiRecommendation {
  id: string;
  title: string;
  description: string;
  /** Monetary impact — null when no real calculation exists. Never fabricated. */
  impact: number | null;
  /** True when impact is a calculated estimate rather than a measured amount. */
  impactEstimated?: boolean;
  confidence: number;
  category: AiCategory;
  status: AiStatus;
  source: string;
  department?: string;
  createdAt?: string;
}

// GET /api/executive/ai-decision-support?days=&propertyId=
// Normalizes recommendations from every portal: rms_ai_recommendations +
// rms_pricing_recommendations + pricing_recommendations (revenue/RMS),
// alert_instances + ops/eng/sec/hk/proc/spa alert tables (risk/ops),
// sec_fraud_alerts, rms_parity/restriction alerts, energy_projects,
// plus rule-engine recommendations derived from live uinv/energy/occupancy KPIs.
router.get('/ai-decision-support', authenticate, execView, execCache('ai-support'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const curStart = new Date(Date.now() - days * 86400e3);
    const todayStr = new Date().toISOString().slice(0, 10);
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      aiRecs, rmsPricRecs, pricRecs, aiInsights, alertInst, alertRules,
      opsAlerts, engAlerts, secAlerts, hkAlerts, procAlerts, spaAlerts,
      fraudAlerts, parityAlerts, restrAlerts, energyProjects,
      items, balances, uinvWaste, demandFc,
      workOrders, pmSchedules, laborCost,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_ai_recommendations')
        .select('id,rec_type,priority,title,description,potential_revenue,confidence,timeframe,status,room_type,channel,created_at')
        .order('created_at', { ascending: false }).limit(50)), 'rms_ai_recommendations'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_pricing_recommendations')
        .select('id,room_type,recommendation_date,current_rate,recommended_rate,confidence,reason,demand_score')
        .gte('recommendation_date', todayStr).order('recommendation_date').limit(30)), 'rms_pricing_recommendations'),
      kpiFetchRows(supabaseAdmin!.from('pricing_recommendations')
        .select('id,room_type_id,date,recommended_rate,current_rate,confidence,recommendation_type,status')
        .gte('date', todayStr).order('date').limit(30), 'pricing_recommendations'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_ai_insights')
        .select('title,description,icon,color,display_order').order('display_order')), 'rms_ai_insights'),
      kpiFetchRows(supabaseAdmin!.from('alert_instances')
        .select('instance_id,rule_id,triggered_at,value,status')
        .gte('triggered_at', curStart.toISOString()), 'alert_instances'),
      kpiFetchRows(supabaseAdmin!.from('alert_rules')
        .select('rule_id,condition,threshold,severity,metric_id'), 'alert_rules'),
      kpiFetchRows(scoped(supabaseAdmin!.from('ops_command_alerts')
        .select('id,severity,category,message,department,status,created_at')
        .gte('created_at', curStart.toISOString())), 'ops_command_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('eng_dashboard_alerts')
        .select('id,type,message,priority,status,created_at')
        .gte('created_at', curStart.toISOString())), 'eng_dashboard_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_dashboard_alerts')
        .select('id,type,message,priority,status,location,created_at')
        .gte('created_at', curStart.toISOString())), 'sec_dashboard_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_dashboard_alerts')
        .select('id,type,message,priority,status,room,created_at')
        .gte('created_at', curStart.toISOString())), 'hk_dashboard_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_alerts')
        .select('id,alert_type,severity,title,description,is_resolved,created_at')
        .gte('created_at', curStart.toISOString())), 'proc_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('spa_alerts')
        .select('id,alert_type,message,severity,is_read,created_at')
        .gte('created_at', curStart.toISOString())), 'spa_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_fraud_alerts')
        .select('id,alert_type,title,description,amount,severity,status,created_at')
        .gte('created_at', curStart.toISOString())), 'sec_fraud_alerts'),
      kpiFetchRows(supabaseAdmin!.from('rms_parity_alerts')
        .select('id,channel,our_rate,competitor_rate,variance_pct,severity,resolved,created_at')
        .eq('resolved', false), 'rms_parity_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_restriction_alerts')
        .select('id,alert_type,message,date_range,active,created_at')
        .eq('active', true)), 'rms_restriction_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_projects')
        .select('name,type,status,estimated_savings,investment,roi')
        .neq('status', 'Completed')), 'energy_projects'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_items')
        .select('id,item_name,reorder_point,min_stock,par_level,is_active')), 'uinv_items'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stock_balances')
        .select('item_id,on_hand,unit_cost')), 'uinv_stock_balances'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_waste')
        .select('department,total_cost,created_at')
        .gte('created_at', curStart.toISOString())), 'uinv_waste'),
      kpiFetchRows(scoped(supabaseAdmin!.from('demand_forecasts')
        .select('target_date,forecast_occupancy,forecast_demand')
        .gte('target_date', todayStr).lte('target_date', in30.toISOString().slice(0, 10))), 'demand_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('work_orders')
        .select('id,status,priority')
        .in('status', ['Open', 'Assigned'])), 'work_orders'),
      kpiFetchRows(scoped(supabaseAdmin!.from('pm_schedules')
        .select('id,interval_days,last_completed_date,status')
        .eq('status', 'Active')), 'pm_schedules'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
        .select('department,budget,actual')), 'hr_labor_cost_analysis'),
    ]);

    const recs: AiRecommendation[] = [];
    const statusMap = (s: string): AiStatus =>
      s === 'applied' || s === 'implemented' || s === 'Resolved' ? 'implemented'
      : s === 'dismissed' ? 'dismissed'
      : s === 'Acknowledged' || s === 'in_progress' || s === 'In Progress' ? 'in_progress'
      : 'pending';

    const sevToConf = (sev: string) =>
      sev === 'Critical' || sev === 'critical' ? 95 : sev === 'High' || sev === 'high' ? 85
      : sev === 'Medium' || sev === 'medium' ? 70 : 55;
    // NOTE: severity alone is never converted to a currency figure — an
    // invented impact shown to owners is worse than showing none. Alerts
    // carry impact=null unless a source table provides a real amount.

    const recTypeMap: Record<string, AiCategory> = {
      pricing: 'revenue', inventory: 'purchasing', distribution: 'crossselling',
      promotional: 'upselling', revenue: 'revenue',
    };

    aiRecs.forEach(r => recs.push({
      id: `rms-${r.id}`,
      title: r.title,
      description: r.description || `${r.rec_type} recommendation${r.room_type ? ` for ${r.room_type}` : ''}${r.channel ? ` via ${r.channel}` : ''}${r.timeframe ? ` · ${r.timeframe}` : ''}`,
      impact: r.potential_revenue != null ? Number(r.potential_revenue) : null,
      impactEstimated: true,
      confidence: Number(r.confidence) || 70,
      category: recTypeMap[r.rec_type] || 'revenue',
      status: statusMap(r.status),
      source: 'RMS AI',
      createdAt: r.created_at,
    }));

    rmsPricRecs.forEach(r => {
      const delta = (Number(r.recommended_rate) || 0) - (Number(r.current_rate) || 0);
      recs.push({
        id: `rmspr-${r.id}`,
        title: `Adjust ${r.room_type} rate to ${Number(r.recommended_rate).toLocaleString()}`,
        description: r.reason || `Current ${Number(r.current_rate).toLocaleString()} → recommended ${Number(r.recommended_rate).toLocaleString()} (${delta >= 0 ? '+' : ''}${Math.round(delta)}) · demand score ${r.demand_score ?? '—'} · for ${r.recommendation_date}`,
        impact: delta * 30, // heuristic: rate delta × ~30 room-nights
        impactEstimated: true,
        confidence: Number(r.confidence) || 70,
        category: 'revenue',
        status: 'pending',
        source: 'RMS Pricing',
        createdAt: r.recommendation_date,
      });
    });

    pricRecs.forEach(r => {
      const delta = (Number(r.recommended_rate) || 0) - (Number(r.current_rate) || 0);
      recs.push({
        id: `pr-${r.id}`,
        title: `${r.recommendation_type}: rate ${Number(r.current_rate).toLocaleString()} → ${Number(r.recommended_rate).toLocaleString()}`,
        description: `Pricing recommendation for ${r.date} · ${Math.round(Number(r.confidence))}% model confidence`,
        impact: delta * 30, // heuristic: rate delta × ~30 room-nights
        impactEstimated: true,
        confidence: Number(r.confidence) || 70,
        category: 'revenue',
        status: statusMap(r.status),
        source: 'Pricing Engine',
        createdAt: r.date,
      });
    });

    parityAlerts.forEach(a => recs.push({
      id: `par-${a.id}`,
      title: `Rate parity gap on ${a.channel}`,
      description: `Our rate ${Number(a.our_rate).toLocaleString()} vs competitor ${Number(a.competitor_rate).toLocaleString()} (${Number(a.variance_pct)}% variance) — realign channel pricing.`,
      impact: null,
      confidence: sevToConf(a.severity),
      category: 'revenue',
      status: 'pending',
      source: 'Rate Parity',
      createdAt: a.created_at,
    }));

    restrAlerts.forEach(a => recs.push({
      id: `rst-${a.id}`,
      title: `Restriction alert${a.date_range ? ` (${a.date_range})` : ''}`,
      description: a.message,
      impact: null,
      confidence: 75,
      category: 'revenue',
      status: 'pending',
      source: 'RMS Restrictions',
      createdAt: a.created_at,
    }));

    const ruleById: Record<string, any> = {};
    alertRules.forEach(r => { ruleById[r.rule_id] = r; });
    alertInst.filter(a => a.status === 'Open').forEach(a => {
      const rule = ruleById[a.rule_id] || {};
      recs.push({
        id: `alr-${a.instance_id}`,
        title: `${rule.severity || 'Alert'}: metric ${rule.condition || 'threshold breach'}`,
        description: `Alert rule triggered at ${new Date(a.triggered_at).toLocaleString()} — value ${a.value ?? '—'} vs threshold ${rule.threshold ?? '—'} (${rule.condition || 'n/a'}).`,
        impact: null,
        confidence: sevToConf(rule.severity),
        category: 'risk',
        status: 'pending',
        source: 'Alert Engine',
        createdAt: a.triggered_at,
      });
    });

    const alertToRec = (a: any, source: string, category: AiCategory, dept?: string) => ({
      id: `${source}-${a.id}`,
      title: a.title || `${a.type || a.alert_type || 'Alert'} — ${dept || source}`,
      description: a.message || a.description || '',
      impact: null,
      confidence: sevToConf(a.priority || a.severity),
      category,
      status: statusMap(a.status),
      source,
      department: dept || a.department,
      createdAt: a.created_at,
    });

    opsAlerts.filter(a => a.status === 'Active').forEach(a =>
      recs.push(alertToRec(a, 'Ops Command', a.category === 'maintenance' ? 'maintenance' : a.category === 'staffing' ? 'staffing' : 'risk', a.department)));
    engAlerts.filter(a => a.status === 'Active').forEach(a =>
      recs.push(alertToRec(a, 'Engineering', 'maintenance', 'Engineering')));
    secAlerts.filter(a => a.status === 'Active').forEach(a =>
      recs.push(alertToRec(a, 'Security', 'risk', 'Security')));
    hkAlerts.filter(a => a.status === 'Active').forEach(a =>
      recs.push(alertToRec(a, 'Housekeeping', 'staffing', 'Housekeeping')));
    procAlerts.filter(a => !a.is_resolved).forEach(a =>
      recs.push(alertToRec(a, 'Procurement', 'purchasing', 'Procurement')));
    spaAlerts.filter(a => !a.is_read).forEach(a =>
      recs.push(alertToRec(a, 'Spa', 'retention', 'Spa')));
    fraudAlerts.filter(a => a.status === 'New' || a.status === 'Open').forEach(a => recs.push({
      ...alertToRec(a, 'Fraud Detection', 'risk', 'Security'),
      impact: Number(a.amount) ? -Number(a.amount) : null, // real flagged amount when present
    }));

    energyProjects.forEach(p => recs.push({
      id: `enp-${p.name}`,
      title: `${p.status === 'In Progress' ? 'Complete' : 'Start'}: ${p.name}`,
      description: `${p.type} project · investment ${Number(p.investment).toLocaleString()} · projected ROI ${p.roi}%`,
      impact: Number(p.estimated_savings) || null,
      impactEstimated: true,
      confidence: 80,
      category: 'energy',
      status: p.status === 'In Progress' ? 'in_progress' : 'pending',
      source: 'Energy Projects',
      department: 'Engineering',
    }));

    // --- Rule-engine recommendations derived from live KPIs ---
    const onHand: Record<string, number> = {};
    balances.forEach(b => { onHand[b.item_id] = (onHand[b.item_id] || 0) + (Number(b.on_hand) || 0); });
    const lowItems = items.filter(i => i.is_active !== false
      && (Number(i.reorder_point) || Number(i.min_stock) || Number(i.par_level) || 0) > 0
      && (onHand[i.id] || 0) < (Number(i.reorder_point) || Number(i.min_stock) || Number(i.par_level)));
    if (lowItems.length > 0) {
      const estValue = lowItems.reduce((s, i) => {
        const thr = Number(i.reorder_point) || Number(i.min_stock) || Number(i.par_level) || 0;
        const bal = balances.find(b => b.item_id === i.id);
        return s + (thr - (onHand[i.id] || 0)) * (Number(bal?.unit_cost) || 0);
      }, 0);
      recs.push({
        id: 'rule-lowstock',
        title: `Reorder ${lowItems.length} low-stock items`,
        description: `${lowItems.length} items are below reorder point (e.g. ${lowItems.slice(0, 3).map(i => i.item_name).join(', ')}${lowItems.length > 3 ? '…' : ''}). Stockouts risk service disruption.`,
        impact: -Math.round(estValue),
        impactEstimated: true,
        confidence: 90,
        category: 'purchasing',
        status: 'pending',
        source: 'Inventory Rules',
        department: 'Procurement',
      });
    }

    const wasteByDept: Record<string, number> = {};
    uinvWaste.forEach(w => { const d = w.department || 'General'; wasteByDept[d] = (wasteByDept[d] || 0) + (Number(w.total_cost) || 0); });
    const topWasteDept = Object.entries(wasteByDept).sort((a, b) => b[1] - a[1])[0];
    const totalWaste = Object.values(wasteByDept).reduce((a, b) => a + b, 0);
    if (topWasteDept && totalWaste > 500) {
      recs.push({
        id: 'rule-waste',
        title: `Reduce ${topWasteDept[0]} waste`,
        description: `${topWasteDept[0]} accounts for ${Math.round(topWasteDept[1]).toLocaleString()} (${Math.round(topWasteDept[1] / totalWaste * 100)}%) of ${Math.round(totalWaste).toLocaleString()} waste cost this period. Review prep quantities and FIFO rotation.`,
        impact: Math.round(topWasteDept[1] * 0.3),
        impactEstimated: true,
        confidence: 75,
        category: 'cost',
        status: 'pending',
        source: 'Waste Analytics',
        department: topWasteDept[0],
      });
    }

    const overduePM = pmSchedules.filter(p => {
      if (!p.last_completed_date) return true;
      const due = new Date(p.last_completed_date);
      due.setDate(due.getDate() + (Number(p.interval_days) || 30));
      return due < new Date();
    });
    if (overduePM.length > 0) {
      recs.push({
        id: 'rule-pm',
        title: `${overduePM.length} PM schedules overdue`,
        description: `Preventive maintenance overdue on ${overduePM.length} schedules — unplanned failures cost multiples of planned maintenance.`,
        impact: null,
        confidence: 85,
        category: 'maintenance',
        status: 'pending',
        source: 'PM Rules',
        department: 'Engineering',
      });
    }

    const critWO = workOrders.filter(w => w.priority === 'Critical' || w.priority === 'High');
    if (critWO.length >= 3) {
      recs.push({
        id: 'rule-wo',
        title: `${critWO.length} high-priority work orders open`,
        description: 'Critical/High work orders are accumulating — consider temporary contractor support or schedule rebalancing.',
        impact: null,
        confidence: 80,
        category: 'maintenance',
        status: 'pending',
        source: 'WO Rules',
        department: 'Engineering',
      });
    }

    if (demandFc.length > 0) {
      const avgOcc = demandFc.reduce((s, f) => s + (Number(f.forecast_occupancy) || 0), 0) / demandFc.length;
      if (avgOcc < 40) {
        recs.push({
          id: 'rule-lowocc',
          title: 'Low occupancy forecast — push promotions',
          description: `Forecasted occupancy averages ${avgOcc.toFixed(1)}% over the next ${demandFc.length} days. Consider OTA promotions or corporate rate incentives.`,
          impact: null,
          confidence: 75,
          category: 'revenue',
          status: 'pending',
          source: 'Demand Forecast',
          department: 'Sales',
        });
      }
    }

    const laborOver = laborCost.filter(l => Number(l.budget) > 0 && Number(l.actual) > Number(l.budget));
    if (laborOver.length > 0) {
      const dept = laborOver.sort((a, b) => (Number(b.actual) - Number(b.budget)) - (Number(a.actual) - Number(a.budget)))[0];
      recs.push({
        id: 'rule-labor',
        title: `${dept.department} labor over budget`,
        description: `${dept.department} actual ${Number(dept.actual).toLocaleString()} vs budget ${Number(dept.budget).toLocaleString()} (+${Math.round((Number(dept.actual) - Number(dept.budget)) / Number(dept.budget) * 100)}%). Review scheduling and overtime.`,
        impact: -(Number(dept.actual) - Number(dept.budget)),
        confidence: 85,
        category: 'staffing',
        status: 'pending',
        source: 'Labor Analytics',
        department: dept.department,
      });
    }

    // ── Apply executive dispositions (in_progress/implemented/dismissed) ──
    const recOverrides = await kpiFetchRows(
      supabaseAdmin!.from('exec_item_overrides')
        .select('item_id,status,note,updated_by')
        .eq('item_kind', 'recommendation'), 'exec_item_overrides');
    const recOvr = new Map(recOverrides.map((o: any) => [o.item_id, o]));
    for (const r of recs) {
      const o = recOvr.get(r.id);
      if (o) {
        r.status = o.status as AiStatus;
        (r as any).note = o.note;
        (r as any).updatedBy = o.updated_by;
      }
    }

    const sortVal = (r: AiRecommendation) =>
      r.status === 'dismissed' || r.status === 'implemented' ? 0 : Math.abs(r.impact ?? 0) * (r.confidence / 100);
    recs.sort((a, b) => sortVal(b) - sortVal(a));

    const summary = {
      totalImpact: recs.filter(r => r.status === 'pending' || r.status === 'in_progress')
        .reduce((s, r) => s + (r.impact ?? 0), 0),
      unpriced: recs.filter(r => r.impact === null).length,
      pending: recs.filter(r => r.status === 'pending').length,
      inProgress: recs.filter(r => r.status === 'in_progress').length,
      implemented: recs.filter(r => r.status === 'implemented').length,
      dismissed: recs.filter(r => r.status === 'dismissed').length,
      bySource: Object.entries(
        recs.reduce((m: Record<string, number>, r) => { m[r.source] = (m[r.source] || 0) + 1; return m; }, {}),
      ).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    };

    res.json({
      propertyId, days, generatedAt: new Date().toISOString(),
      recommendations: recs,
      insights: aiInsights.map(i => ({ title: i.title, description: i.description, icon: i.icon, color: i.color })),
      summary,
    });
  } catch (err: any) {
    console.error('[exec-ai-decision-support]', err);
    res.status(500).json({ error: 'Failed to compute AI decision support' });
  }
});

// PATCH /api/executive/ai-decision-support/:id
// Status transition on an AI recommendation — stored as an override in
// exec_item_overrides. status='pending' deletes the override (reset).
router.patch('/ai-decision-support/:id', authenticate, requirePermission('exec:recommendations:update'), async (req: Request, res: Response) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status, note } = req.body || {};
    if (!['pending', 'in_progress', 'implemented', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: "status must be 'pending', 'in_progress', 'implemented' or 'dismissed'" });
    }
    if (status === 'pending') {
      const { error } = await supabaseAdmin!.from('exec_item_overrides')
        .delete().eq('item_kind', 'recommendation').eq('item_id', req.params.id);
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('exec-ai-support:*');
      return res.json({ ok: true, cleared: true });
    }
    const { data, error } = await supabaseAdmin!.from('exec_item_overrides').upsert({
      item_kind: 'recommendation',
      item_id: req.params.id,
      property_id: (req.body?.propertyId as string) || null,
      status,
      note: note ?? null,
      updated_by: (req.user as any)?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'item_kind,item_id' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    cacheService.invalidate('exec-ai-support:*');
    res.json({ ok: true, override: data });
  } catch (err: any) {
    console.error('[exec-ai-patch]', err);
    res.status(500).json({ error: err?.message || 'Failed to update recommendation' });
  }
});

// GET /api/executive/strategic-planning?days=&propertyId=
type StratCategory = 'business_plan' | 'objectives' | 'okrs' | 'kpi_targets' | 'department_goals' | 'capital_projects' | 'growth';
type StratStatus = 'on_track' | 'at_risk' | 'behind' | 'completed';
const STRAT_CATEGORIES_META: { id: StratCategory }[] = [
  { id: 'business_plan' }, { id: 'objectives' }, { id: 'okrs' }, { id: 'kpi_targets' },
  { id: 'department_goals' }, { id: 'capital_projects' }, { id: 'growth' },
];
interface StrategicItem {
  id: string;
  title: string;
  description: string;
  progress: number;
  /** What `progress` measures — the number means different things per category. */
  metric: 'completion' | 'attainment' | 'confidence' | 'utilization' | 'adherence' | 'elapsed' | 'pipeline';
  status: StratStatus;
  category: StratCategory;
  dueDate: string | null;
  source: string;
  department?: string;
  detail?: string;
  /** true for user-authored rows from exec_strategic_items (editable). */
  custom?: boolean;
  /** Raw exec_strategic_items.id for edit/delete (custom items only). */
  rawId?: string;
  owner?: string;
  unit?: string;
  targetValue?: number | null;
  currentValue?: number | null;
  startDate?: string | null;
}

router.get('/strategic-planning', authenticate, execView, async (req: Request, res: Response) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const days = resolveDays(req.query, 90);
    const propertyId = (req.query.propertyId as string) || null;
    const cacheKey = `exec-strategic-planning:${propertyId || 'all'}:${days}`;
    const cached = cacheService.get(cacheKey);
    if (cached) return res.json(cached);
    const now = new Date();
    const curStart = new Date(now.getTime() - days * 86400e3);
    const curStartStr = curStart.toISOString().slice(0, 10);
    const todayStr = now.toISOString().slice(0, 10);
    const in60 = new Date(now); in60.setDate(in60.getDate() + 60);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      rooms, reservations, budgetPlans, procBudgets, engProjects, engPhases,
      energyProjects, finForecasts, yoyRows, campaigns, contracts, banquets,
      hkTasks, hkProductivity, pmSchedules, laborAnalysis, attendance,
      audits, fbCost, customItems,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id,status')), 'rooms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
        .select('id,check_in_date,check_out_date,status,rate')
        .gte('check_out_date', curStartStr)), 'reservations'),
      kpiFetchRows(scoped(supabaseAdmin!.from('budget_forecasts')
        .select('id,department,q3_forecast,q4_forecast,fy_total,trend,confidence,period')), 'budget_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_budgets')
        .select('id,budget_code,department,category,budget_type,fiscal_year,period_end,budgeted_amount,committed_amount,actual_spend')
        .gte('period_end', curStartStr)), 'proc_budgets'),
      kpiFetchRows(scoped(supabaseAdmin!.from('eng_projects')
        .select('id,prj_number,name,type,category,location,description,status,priority,start_date,target_completion_date,project_manager,budget,spent,progress')), 'eng_projects'),
      kpiFetchRows(supabaseAdmin!.from('eng_project_phases')
        .select('id,project_id,name,status,sort_order').order('sort_order'), 'eng_project_phases'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_projects')
        .select('id,name,type,status,estimated_savings,actual_savings,investment,roi,completion_date')), 'energy_projects'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fin_bi_forecasts')
        .select('id,metric,forecast,actual,variance,accuracy,period,unit')), 'fin_bi_forecasts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_bi_yoy_metrics')
        .select('metric,current_value,previous_value,growth,display_order').order('display_order')), 'rms_bi_yoy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sales_campaigns')
        .select('id,campaign_name,campaign_type,status,budget,spent,leads,conversions,start_date,end_date')), 'sales_campaigns'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sales_contracts')
        .select('id,title,event_type,start_date,end_date,total_value,room_nights,guest_count')), 'sales_contracts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('banquet_events')
        .select('id,event_name,event_date,client_name,guest_count,status,estimated_revenue,actual_revenue')
        .gte('event_date', todayStr)), 'banquet_events'),
      kpiFetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt')
        .select('id,status,due_date,completed_at')
        .or(`created_at.gte.${curStart.toISOString()},due_date.gte.${curStartStr},completed_at.gte.${curStart.toISOString()}`)), 'housekeeping_task_mgmt'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_staff_productivity')
        .select('inspection_score,productivity_score,period_date')
        .gte('period_date', curStart.toISOString().slice(0, 10))), 'hk_staff_productivity'),
      kpiFetchRows(scoped(supabaseAdmin!.from('pm_schedules')
        .select('id,next_due_date,last_completed_date,status')), 'pm_schedules'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
        .select('department,budget,actual,period')), 'hr_labor_cost_analysis'),
      kpiFetchRows(scoped(supabaseAdmin!.from('staff_attendance')
        .select('id,status,attendance_date')
        .gte('attendance_date', curStart.toISOString().slice(0, 10))), 'staff_attendance'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_compliance_audits')
        .select('id,title,status,result,completed_at')), 'sec_compliance_audits'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_cost_analytics')
        .select('food_cost_pct,bev_cost_pct,period')), 'fb_cost_analytics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('exec_strategic_items')
        .select('id,title,description,category,department,owner,target_value,current_value,unit,metric,progress,status,start_date,due_date')
        .order('created_at', { ascending: false })), 'exec_strategic_items'),
    ]);

    const statusIn = (v: any, ...set: string[]) => set.includes(String(v ?? '').trim().toLowerCase());
    // `period` columns are TEXT ('Q2 2024', 'June 2024', '2024') — keep only the
    // most recent period so multiple periods don't double-count.
    const periodKey = (p: any): number => {
      const s = String(p ?? '').trim().toLowerCase();
      const q = s.match(/q([1-4])\s*(\d{4})/);
      if (q) return Number(q[2]) * 10 + Number(q[1]);
      const y = s.match(/(\d{4})/);
      const m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      if (y && m) return Number(y[1]) * 100 + months.indexOf(m[1]) + 1;
      if (y) return Number(y[1]) * 100 + 12;
      return 0;
    };
    const latestPeriod = (rows: any[]) => {
      if (!rows.length) return rows;
      const max = Math.max(...rows.map(r => periodKey(r.period)));
      return max > 0 ? rows.filter(r => periodKey(r.period) === max) : rows;
    };

    // `days` is the analysis window: keep rows that overlap it or are still open.
    const budgetPlansW = latestPeriod(budgetPlans);
    const finForecastsW = latestPeriod(finForecasts);
    const laborAnalysisW = latestPeriod(laborAnalysis);
    const campaignsW = campaigns.filter((c: any) => !c.end_date || c.end_date >= curStartStr);
    const contractsW = contracts.filter((c: any) => !c.end_date || c.end_date >= curStartStr);
    const engProjectsW = engProjects.filter((p: any) =>
      !statusIn(p.status, 'completed') || !p.target_completion_date || p.target_completion_date >= curStartStr);
    const energyProjectsW = energyProjects.filter((p: any) =>
      !statusIn(p.status, 'completed') || !p.completion_date || p.completion_date >= curStartStr);
    // fb_cost_analytics stores one row per outlet per period (Today/MTD/YTD) —
    // averaging all of them triple-counts each outlet; prefer MTD.
    const fbCostMtd = fbCost.filter((r: any) => statusIn(r.period, 'mtd'));
    const fbCostRows = fbCostMtd.length ? fbCostMtd : fbCost;

    const items: StrategicItem[] = [];
    const clamp = (n: number) => Math.round(Math.min(Math.max(n, 0), 100) * 10) / 10;
    const statusOf = (progress: number, dueDate: string | null, done = false): StratStatus => {
      if (done || progress >= 100) return 'completed';
      if (dueDate) {
        if (dueDate < todayStr) return 'behind';
        const daysLeft = (new Date(dueDate).getTime() - now.getTime()) / 86400000;
        if (daysLeft <= 30 && progress < 60) return 'behind';
        return progress >= 70 ? 'on_track' : 'at_risk';
      }
      if (progress >= 70) return 'on_track';
      if (progress >= 40) return 'at_risk';
      return 'behind';
    };

    // ── Live KPI computations for targets ──
    const resActive = reservations.filter((r: any) => !statusIn(r.status, 'cancelled', 'canceled', 'no show', 'no-show'));
    const roomNights = resActive.reduce((s: number, r: any) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return s;
      return s + Math.max(0, (Math.min(co, now.getTime()) - Math.max(ci, curStart.getTime())) / 86400000);
    }, 0);
    const roomRev = resActive.reduce((s: number, r: any) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return s;
      const n = Math.max(0, (Math.min(co, now.getTime()) - Math.max(ci, curStart.getTime())) / 86400000);
      return s + n * (Number(r.rate) || 0);
    }, 0);
    const roomDenom = rooms.length * days;
    const occupancy = roomDenom > 0 ? (roomNights / roomDenom) * 100 : 0;
    const adr = roomNights > 0 ? roomRev / roomNights : 0;
    const revpar = roomDenom > 0 ? roomRev / roomDenom : 0;

    const hkDone = hkTasks.filter((t: any) => statusIn(t.status, 'completed')).length;
    const hkCompletion = hkTasks.length ? (hkDone / hkTasks.length) * 100 : 0;
    const inspScore = hkProductivity.length
      ? hkProductivity.reduce((s: number, p: any) => s + (Number(p.inspection_score) || 0), 0) / hkProductivity.length : 0;
    const pmDue = pmSchedules.filter((p: any) => statusIn(p.status, 'active') && p.next_due_date && p.next_due_date <= todayStr);
    const pmCompliance = pmSchedules.length ? ((pmSchedules.length - pmDue.length) / pmSchedules.length) * 100 : 0;
    const attPresent = attendance.filter((a: any) => statusIn(a.status, 'present', 'late')).length;
    const attRate = attendance.length ? (attPresent / attendance.length) * 100 : 0;
    // Pass rate covers audits completed inside the window; 'Pass with Findings' counts as a pass.
    const auditsDone = audits.filter((a: any) =>
      statusIn(a.status, 'completed') && (!a.completed_at || a.completed_at >= curStart.toISOString()));
    const auditsPass = auditsDone.filter((a: any) => String(a.result || '').toLowerCase().startsWith('pass')).length;
    const auditRate = auditsDone.length ? (auditsPass / auditsDone.length) * 100 : 0;
    const foodCost = fbCostRows.length
      ? fbCostRows.reduce((s: number, r: any) => s + (Number(r.food_cost_pct) || 0), 0) / fbCostRows.length : 0;
    const laborBudget = laborAnalysisW.reduce((s: number, r: any) => s + (Number(r.budget) || 0), 0);
    const laborActual = laborAnalysisW.reduce((s: number, r: any) => s + (Number(r.actual) || 0), 0);

    // ── business_plan: department annual plans (budget_forecasts, latest period) ──
    for (const b of budgetPlansW) {
      const fy = Number(b.fy_total) || 0;
      const progress = clamp(Number(b.confidence) || 0);
      items.push({
        id: `bp_${b.id}`,
        title: `${b.department} FY${b.period} Plan`,
        description: `Annual plan ${fy.toLocaleString()} · Q3 ${Number(b.q3_forecast || 0).toLocaleString()} · Q4 ${Number(b.q4_forecast || 0).toLocaleString()} · trend ${b.trend}`,
        progress,
        metric: 'confidence',
        status: statusOf(progress, `${b.period}-12-31`),
        category: 'business_plan',
        dueDate: `${b.period}-12-31`,
        source: 'Budget Forecasts',
        department: b.department,
        detail: `Plan confidence ${progress}%`,
      });
    }

    // ── objectives: financial forecast attainment (fin_bi_forecasts, latest period) ──
    for (const f of finForecastsW) {
      const forecast = Number(f.forecast) || 0;
      const actual = Number(f.actual) || 0;
      const progress = forecast > 0 ? clamp((actual / forecast) * 100) : 0;
      items.push({
        id: `obj_${f.id}`,
        title: `Achieve ${String(f.metric).replace(/_/g, ' ')}`,
        description: `Forecast ${forecast.toLocaleString()} · actual ${actual.toLocaleString()} · accuracy ${Number(f.accuracy || 0).toFixed(1)}% (${f.period})`,
        progress,
        metric: 'attainment',
        status: statusOf(progress, null),
        category: 'objectives',
        dueDate: null,
        source: 'Finance BI',
        detail: `Variance ${(Number(f.variance) || 0).toLocaleString()}`,
      });
    }

    // ── okrs: YoY growth key results (rms_bi_yoy_metrics) ──
    for (const [i, m] of yoyRows.entries()) {
      const growth = Number(m.growth) || 0;
      const progress = clamp((growth / 10) * 100); // 10% YoY growth = full achievement
      items.push({
        id: `okr_${i}`,
        title: `${m.metric} YoY Growth`,
        description: `Current ${Number(m.current_value || 0).toLocaleString()} vs prior ${Number(m.previous_value || 0).toLocaleString()} — ${growth >= 0 ? '+' : ''}${growth}% YoY (target +10%)`,
        progress,
        metric: 'attainment',
        status: statusOf(progress, null),
        category: 'okrs',
        dueDate: null,
        source: 'RMS BI',
      });
    }

    // ── kpi_targets: live KPIs vs targets ──
    const kpiTarget = (id: string, title: string, value: number, target: number, unit: string, lowerBetter = false) => {
      const progress = lowerBetter
        ? (value > 0 ? clamp((target / value) * 100) : 100)
        : (target > 0 ? clamp((value / target) * 100) : 0);
      items.push({
        id, title,
        description: `Actual ${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit} vs target ${target}${unit}`,
        progress,
        metric: 'attainment',
        status: statusOf(progress, null),
        category: 'kpi_targets',
        dueDate: null,
        source: 'Live KPIs',
      });
    };
    // Only emit a KPI target when the underlying source has rows — otherwise
    // missing data would masquerade as 0% (or 100% for lower-is-better metrics).
    if (rooms.length) {
      kpiTarget('kpi_occ', 'Occupancy Target', occupancy, 70, '%');
      kpiTarget('kpi_adr', 'ADR Target', adr, 2000, '');
      kpiTarget('kpi_revpar', 'RevPAR Target', revpar, 1400, '');
    }
    if (hkProductivity.length) kpiTarget('kpi_insp', 'Inspection Score', inspScore, 90, '/100');
    if (hkTasks.length) kpiTarget('kpi_task', 'HK Task Completion', hkCompletion, 85, '%');
    if (attendance.length) kpiTarget('kpi_att', 'Attendance Rate', attRate, 90, '%');
    if (auditsDone.length) kpiTarget('kpi_audit', 'Audit Pass Rate', auditRate, 90, '%');
    if (pmSchedules.length) kpiTarget('kpi_pm', 'PM Compliance', pmCompliance, 80, '%');
    if (fbCostRows.length) kpiTarget('kpi_food', 'Food Cost Ceiling', foodCost, 30, '%', true);
    if (laborBudget > 0 && laborActual > 0) kpiTarget('kpi_labor', 'Labor Cost Budget', laborActual, laborBudget, '', true);

    // ── department_goals: procurement budget utilization + labor adherence ──
    const deptBudgets = new Map<string, { budgeted: number; committed: number; actual: number }>();
    for (const b of procBudgets) {
      const d = b.department || 'General';
      const e = deptBudgets.get(d) || { budgeted: 0, committed: 0, actual: 0 };
      e.budgeted += Number(b.budgeted_amount) || 0;
      e.committed += Number(b.committed_amount) || 0;
      e.actual += Number(b.actual_spend) || 0;
      deptBudgets.set(d, e);
    }
    for (const [dept, e] of deptBudgets) {
      const util = e.budgeted > 0 ? ((e.committed + e.actual) / e.budgeted) * 100 : 0;
      items.push({
        id: `dept_budget_${dept}`,
        title: `${dept} Budget Discipline`,
        description: `Budget ${e.budgeted.toLocaleString()} · committed ${e.committed.toLocaleString()} · spent ${e.actual.toLocaleString()} — ${util.toFixed(0)}% utilized`,
        progress: clamp(util),
        metric: 'utilization',
        status: util > 110 ? 'behind' : util > 95 ? 'at_risk' : 'on_track',
        category: 'department_goals',
        dueDate: null,
        source: 'Procurement',
        department: dept,
      });
    }
    for (const l of laborAnalysisW) {
      const budget = Number(l.budget) || 0;
      const actual = Number(l.actual) || 0;
      if (!budget) continue;
      const util = (actual / budget) * 100;
      items.push({
        id: `dept_labor_${l.department}`,
        title: `${l.department} Labor Budget`,
        description: `Actual ${actual.toLocaleString()} vs budget ${budget.toLocaleString()} — ${util >= 100 ? '+' : ''}${(util - 100).toFixed(1)}% variance`,
        progress: clamp((budget / Math.max(actual, 1)) * 100),
        metric: 'adherence',
        status: util > 110 ? 'behind' : util > 100 ? 'at_risk' : 'on_track',
        category: 'department_goals',
        dueDate: null,
        source: 'HR Analytics',
        department: l.department,
      });
    }

    // ── capital_projects: eng_projects + energy_projects ──
    const capitalProjects: any[] = [];
    for (const p of engProjectsW) {
      const phases = engPhases.filter((ph: any) => ph.project_id === p.id);
      const phasesDone = phases.filter((ph: any) => statusIn(ph.status, 'completed')).length;
      const progress = Number(p.progress) || (phases.length ? (phasesDone / phases.length) * 100 : 0);
      const done = statusIn(p.status, 'completed');
      items.push({
        id: `cap_${p.id}`,
        title: p.name,
        description: `${p.type} · ${p.category} · ${p.location} — budget ${Number(p.budget || 0).toLocaleString()}, spent ${Number(p.spent || 0).toLocaleString()}${p.project_manager ? ` · PM: ${p.project_manager}` : ''}`,
        progress: clamp(progress),
        metric: 'completion',
        status: statusOf(progress, p.target_completion_date, done),
        category: 'capital_projects',
        dueDate: p.target_completion_date,
        source: 'Engineering Projects',
        department: 'Engineering',
        detail: p.status,
      });
      capitalProjects.push({ name: p.name, status: p.status, progress: clamp(progress), budget: Number(p.budget) || 0, spent: Number(p.spent) || 0, dueDate: p.target_completion_date, source: 'Engineering' });
    }
    for (const p of energyProjectsW) {
      const progress = statusIn(p.status, 'completed') ? 100 : statusIn(p.status, 'in progress') ? 50 : 10;
      items.push({
        id: `cap_energy_${p.id}`,
        title: p.name,
        description: `${p.type} — investment ${Number(p.investment || 0).toLocaleString()}, est. savings ${Number(p.estimated_savings || 0).toLocaleString()}, ROI ${Number(p.roi || 0).toFixed(1)}%`,
        progress,
        metric: 'completion',
        status: statusOf(progress, p.completion_date, statusIn(p.status, 'completed')),
        category: 'capital_projects',
        dueDate: p.completion_date,
        source: 'Energy Projects',
        department: 'Engineering',
        detail: p.status,
      });
      capitalProjects.push({ name: p.name, status: p.status, progress, budget: Number(p.investment) || 0, spent: statusIn(p.status, 'completed') ? Number(p.investment) || 0 : 0, dueDate: p.completion_date, source: 'Energy' });
    }

    // ── growth: campaigns, contracts pipeline, banquet events ──
    for (const c of campaignsW) {
      const budget = Number(c.budget) || 0;
      const spent = Number(c.spent) || 0;
      const done = statusIn(c.status, 'completed');
      // Progress = elapsed share of the campaign run; spend/budget is burn, not progress.
      let progress: number;
      if (done) progress = 100;
      else if (c.start_date && c.end_date && c.end_date > c.start_date) {
        const s = new Date(c.start_date).getTime();
        const e = new Date(c.end_date).getTime();
        progress = clamp(((now.getTime() - s) / (e - s)) * 100);
      } else progress = statusIn(c.status, 'active', 'in progress') ? 50 : 10;
      items.push({
        id: `growth_${c.id}`,
        title: c.campaign_name,
        description: `${c.campaign_type || 'Campaign'} — ${c.leads || 0} leads, ${c.conversions || 0} conversions, spend ${spent.toLocaleString()}/${budget.toLocaleString()}`,
        progress,
        metric: 'elapsed',
        status: statusOf(progress, c.end_date, done),
        category: 'growth',
        dueDate: c.end_date,
        source: 'Sales Campaigns',
        department: 'Sales & Marketing',
        detail: c.status,
      });
    }
    const upcomingContracts = contractsW.filter((c: any) => c.start_date && c.start_date >= todayStr);
    if (upcomingContracts.length) {
      const val = upcomingContracts.reduce((s: number, c: any) => s + (Number(c.total_value) || 0), 0);
      const rn = upcomingContracts.reduce((s: number, c: any) => s + (Number(c.room_nights) || 0), 0);
      items.push({
        id: 'growth_contracts',
        title: 'Signed Contract Pipeline',
        description: `${upcomingContracts.length} upcoming contracts worth ${val.toLocaleString()} · ${rn} room nights committed`,
        progress: 50,
        metric: 'pipeline',
        status: 'on_track',
        category: 'growth',
        dueDate: upcomingContracts.map((c: any) => c.start_date).sort()[0],
        source: 'Sales Contracts',
        department: 'Sales & Marketing',
      });
    }
    const upcomingEvents = banquets.filter((e: any) => statusIn(e.status, 'confirmed', 'inprogress', 'in progress'));
    if (upcomingEvents.length) {
      const est = upcomingEvents.reduce((s: number, e: any) => s + (Number(e.estimated_revenue) || 0), 0);
      items.push({
        id: 'growth_events',
        title: 'Upcoming Events Pipeline',
        description: `${upcomingEvents.length} confirmed events · est. revenue ${est.toLocaleString()} · ${upcomingEvents.reduce((s: number, e: any) => s + (e.guest_count || 0), 0)} guests`,
        progress: 60,
        metric: 'pipeline',
        status: 'on_track',
        category: 'growth',
        dueDate: upcomingEvents.map((e: any) => e.event_date).sort()[0],
        source: 'Banquets',
        department: 'F&B / Events',
      });
    }

    // ── User-authored items (exec_strategic_items) — editable plans ──
    const STRAT_STATUSES: StratStatus[] = ['on_track', 'at_risk', 'behind', 'completed'];
    for (const c of customItems) {
      const target = Number(c.target_value) || 0;
      const current = Number(c.current_value) || 0;
      // attainment when a target exists, otherwise the stored manual progress
      const progress = target > 0 ? clamp((current / target) * 100) : clamp(Number(c.progress) || 0);
      const status: StratStatus = STRAT_STATUSES.includes(c.status) ? c.status : statusOf(progress, c.due_date);
      items.push({
        id: `custom_${c.id}`,
        title: c.title,
        description: c.description || '',
        progress,
        metric: c.metric || 'completion',
        status,
        category: c.category,
        dueDate: c.due_date,
        source: 'Strategic Plan',
        department: c.department || undefined,
        detail: c.owner ? `Owner: ${c.owner}` : undefined,
        custom: true,
        rawId: c.id,
        owner: c.owner || undefined,
        unit: c.unit || undefined,
        targetValue: c.target_value ?? null,
        currentValue: c.current_value ?? null,
        startDate: c.start_date,
      });
    }

    // ── Summary + panels ──
    const byCat = STRAT_CATEGORIES_META.map(c => {
      const list = items.filter(i => i.category === c.id);
      return {
        category: c.id, count: list.length,
        avgProgress: list.length ? Math.round(list.reduce((s, i) => s + i.progress, 0) / list.length) : 0,
      };
    });
    const upcomingDeadlines = items
      .filter(i => i.dueDate && i.dueDate >= todayStr && i.dueDate <= in60.toISOString().slice(0, 10) && i.status !== 'completed')
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
      .slice(0, 8)
      .map(i => ({ title: i.title, dueDate: i.dueDate, status: i.status, progress: i.progress, category: i.category, source: i.source }));

    const payload = {
      propertyId, days, generatedAt: now.toISOString(),
      items,
      summary: {
        total: items.length,
        onTrack: items.filter(i => i.status === 'on_track').length,
        atRisk: items.filter(i => i.status === 'at_risk').length,
        behind: items.filter(i => i.status === 'behind').length,
        completed: items.filter(i => i.status === 'completed').length,
        avgProgress: items.length ? Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length) : 0,
        byCategory: byCat,
      },
      panels: {
        capitalProjects,
        campaigns: campaignsW.map((c: any) => ({
          name: c.campaign_name, type: c.campaign_type, status: c.status,
          budget: Number(c.budget) || 0, spent: Number(c.spent) || 0,
          leads: c.leads || 0, conversions: c.conversions || 0, endDate: c.end_date,
        })),
        departmentBudgets: [...deptBudgets.entries()].map(([department, e]) => ({
          department, budgeted: e.budgeted, committed: e.committed, actual: e.actual,
          utilization: e.budgeted > 0 ? Math.round(((e.committed + e.actual) / e.budgeted) * 1000) / 10 : 0,
        })),
        deptLabor: laborAnalysisW.map((l: any) => ({
          department: l.department, budget: Number(l.budget) || 0, actual: Number(l.actual) || 0,
          variance: Number(l.budget) ? Math.round(((Number(l.actual) / Number(l.budget)) - 1) * 1000) / 10 : 0,
        })),
        upcomingDeadlines,
      },
    };
    cacheService.set(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err: any) {
    console.error('[exec-strategic-planning]', err);
    res.status(500).json({ error: 'Failed to compute strategic planning' });
  }
});

// ── User-authored strategic items (exec_strategic_items) ─────────────
const STRAT_ITEM_CATEGORIES = ['business_plan', 'objectives', 'okrs', 'kpi_targets', 'department_goals', 'capital_projects', 'growth'] as const;
const STRAT_ITEM_STATUSES = ['on_track', 'at_risk', 'behind', 'completed'] as const;
const STRAT_ITEM_METRICS = ['completion', 'attainment', 'confidence', 'utilization', 'adherence', 'elapsed', 'pipeline'] as const;
const stratNum = (v: any): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const stratDate = (v: any): string | null => (v ? String(v).slice(0, 10) : null);

function stratProgress(target: number | null, current: number | null, manual: number | null): number {
  const clampP = (n: number) => Math.round(Math.min(Math.max(n, 0), 100) * 10) / 10;
  if (target && target > 0) return clampP(((current ?? 0) / target) * 100);
  return clampP(manual ?? 0);
}

function stratDeriveStatus(progress: number, dueDate: string | null, explicit?: string | null): string {
  if (explicit && (STRAT_ITEM_STATUSES as readonly string[]).includes(explicit)) return explicit;
  const today = new Date().toISOString().slice(0, 10);
  if (progress >= 100) return 'completed';
  if (dueDate) {
    if (dueDate < today) return 'behind';
    const daysLeft = (new Date(dueDate).getTime() - Date.now()) / 86400000;
    if (daysLeft <= 30 && progress < 60) return 'behind';
    return progress >= 70 ? 'on_track' : 'at_risk';
  }
  return progress >= 70 ? 'on_track' : progress >= 40 ? 'at_risk' : 'behind';
}

// POST /api/executive/strategic-planning/items — create a user-authored item
router.post('/strategic-planning/items', authenticate, requirePermission('exec:strategic:manage'), async (req: Request, res: Response) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const b = req.body || {};
    if (!b.title || !b.category) return res.status(400).json({ error: 'title and category are required' });
    if (!(STRAT_ITEM_CATEGORIES as readonly string[]).includes(b.category)) {
      return res.status(400).json({ error: `category must be one of: ${STRAT_ITEM_CATEGORIES.join(', ')}` });
    }
    if (b.metric && !(STRAT_ITEM_METRICS as readonly string[]).includes(b.metric)) {
      return res.status(400).json({ error: `metric must be one of: ${STRAT_ITEM_METRICS.join(', ')}` });
    }
    const target = stratNum(b.targetValue);
    const current = stratNum(b.currentValue);
    const progress = stratProgress(target, current, stratNum(b.progress));
    const dueDate = stratDate(b.dueDate);
    const { data, error } = await supabaseAdmin!.from('exec_strategic_items').insert({
      property_id: b.propertyId || null,
      title: String(b.title),
      description: b.description || '',
      category: b.category,
      department: b.department || null,
      owner: b.owner || null,
      target_value: target,
      current_value: current ?? 0,
      unit: b.unit || '%',
      metric: b.metric || 'completion',
      progress,
      status: stratDeriveStatus(progress, dueDate, b.status),
      start_date: stratDate(b.startDate),
      due_date: dueDate,
      created_by: req.user?.id || null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    cacheService.invalidate('exec-strategic-planning:*');
    return res.status(201).json(data);
  } catch (err: any) {
    console.error('[exec-strategic-planning:create]', err);
    res.status(500).json({ error: 'Failed to create strategic item' });
  }
});

// PATCH /api/executive/strategic-planning/items/:id — update fields/progress/status
router.patch('/strategic-planning/items/:id', authenticate, requirePermission('exec:strategic:manage'), async (req: Request, res: Response) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const b = req.body || {};
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (b.title !== undefined) updates.title = String(b.title);
    if (b.description !== undefined) updates.description = String(b.description);
    if (b.department !== undefined) updates.department = b.department || null;
    if (b.owner !== undefined) updates.owner = b.owner || null;
    if (b.unit !== undefined) updates.unit = b.unit || '%';
    if (b.category !== undefined) {
      if (!(STRAT_ITEM_CATEGORIES as readonly string[]).includes(b.category)) {
        return res.status(400).json({ error: `category must be one of: ${STRAT_ITEM_CATEGORIES.join(', ')}` });
      }
      updates.category = b.category;
    }
    if (b.metric !== undefined) {
      if (!(STRAT_ITEM_METRICS as readonly string[]).includes(b.metric)) {
        return res.status(400).json({ error: `metric must be one of: ${STRAT_ITEM_METRICS.join(', ')}` });
      }
      updates.metric = b.metric;
    }
    if (b.targetValue !== undefined) updates.target_value = stratNum(b.targetValue);
    if (b.currentValue !== undefined) updates.current_value = stratNum(b.currentValue);
    if (b.progress !== undefined) updates.progress = stratNum(b.progress) ?? 0;
    if (b.startDate !== undefined) updates.start_date = stratDate(b.startDate);
    if (b.dueDate !== undefined) updates.due_date = stratDate(b.dueDate);
    if (b.propertyId !== undefined) updates.property_id = b.propertyId || null;

    // Recompute against the merged row: a client may send only currentValue
    // while the target lives in the DB.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('exec_strategic_items').select('target_value,current_value,due_date,progress')
      .eq('id', req.params.id).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: 'Strategic item not found' });

    const effTarget = updates.target_value !== undefined ? updates.target_value : stratNum(existing.target_value);
    const effCurrent = updates.current_value !== undefined ? updates.current_value : stratNum(existing.current_value);
    const effDue = updates.due_date !== undefined ? updates.due_date : existing.due_date;
    if (b.targetValue !== undefined || b.currentValue !== undefined || b.progress !== undefined) {
      updates.progress = stratProgress(effTarget, effCurrent, updates.progress ?? stratNum(existing.progress));
    }
    if (b.status !== undefined) {
      if (!(STRAT_ITEM_STATUSES as readonly string[]).includes(b.status)) {
        return res.status(400).json({ error: `status must be one of: ${STRAT_ITEM_STATUSES.join(', ')}` });
      }
      updates.status = b.status;
    } else {
      updates.status = stratDeriveStatus(updates.progress ?? stratNum(existing.progress) ?? 0, effDue ?? null, null);
    }

    const { data, error } = await supabaseAdmin!.from('exec_strategic_items')
      .update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Strategic item not found' });
    cacheService.invalidate('exec-strategic-planning:*');
    return res.json(data);
  } catch (err: any) {
    console.error('[exec-strategic-planning:update]', err);
    res.status(500).json({ error: 'Failed to update strategic item' });
  }
});

// DELETE /api/executive/strategic-planning/items/:id
router.delete('/strategic-planning/items/:id', authenticate, requirePermission('exec:strategic:manage'), async (req: Request, res: Response) => {
  try {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { error } = await supabaseAdmin!.from('exec_strategic_items').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    cacheService.invalidate('exec-strategic-planning:*');
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[exec-strategic-planning:delete]', err);
    res.status(500).json({ error: 'Failed to delete strategic item' });
  }
});

// GET /api/executive/alerts-exceptions?days=&propertyId=
type AlertSev = 'critical' | 'high' | 'medium' | 'low';
type AlertCat = 'revenue' | 'occupancy' | 'cost' | 'budget' | 'satisfaction' | 'labor' | 'inventory' | 'fraud' | 'energy' | 'compliance';
type AlertSt = 'active' | 'acknowledged' | 'resolved';
interface ExecAlert {
  id: string;
  title: string;
  description: string;
  severity: AlertSev;
  category: AlertCat;
  status: AlertSt;
  timestamp: string | null;
  value: number | null;
  threshold: number | null;
  source: string;
  department?: string;
}
const ALERT_CATS: AlertCat[] = ['revenue', 'occupancy', 'cost', 'budget', 'satisfaction', 'labor', 'inventory', 'fraud', 'energy', 'compliance'];

router.get('/alerts-exceptions', authenticate, execView, execCache('alerts'), async (req: Request, res: Response) => {
  try {
    const days = resolveDays(req.query);
    const propertyId = (req.query.propertyId as string) || null;
    const now = new Date();
    const curStart = new Date(now.getTime() - days * 86400e3);
    const prevStart = new Date(curStart.getTime() - days * 86400e3);
    const todayStr = now.toISOString().slice(0, 10);
    const in60 = new Date(now); in60.setDate(in60.getDate() + 60);

    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      opsAlerts, engAlerts, utilAlerts, iotAlerts, secAlerts, fraudAlerts,
      hkAlerts, procAlerts, spaAlerts, parityAlerts, restrAlerts,
      alertInst, alertRules, healthAlerts, transportIncidents, alarms,
      complianceItems, reservations, rooms, laborAnalysis, procBudgets,
      items, balances, energyM, feedback, fbCost, pmSchedules, hkTasks,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('ops_command_alerts')
        .select('id,severity,category,message,department,status,created_at')
        .gte('created_at', prevStart.toISOString())), 'ops_command_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('eng_dashboard_alerts')
        .select('id,type,message,priority,status,created_at')
        .gte('created_at', prevStart.toISOString())), 'eng_dashboard_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('eng_utility_alerts')
        .select('id,alert_type,severity,sector,description,status,detected_at')
        .gte('detected_at', prevStart.toISOString())), 'eng_utility_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('ops_maintenance_alerts')
        .select('alert_id,alert_type,severity,alert_message,alert_value,threshold_value,location,acknowledged,created_at')
        .gte('created_at', prevStart.toISOString())), 'ops_maintenance_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_dashboard_alerts')
        .select('id,type,message,priority,status,location,created_at')
        .gte('created_at', prevStart.toISOString())), 'sec_dashboard_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_fraud_alerts')
        .select('id,alert_type,title,description,amount,severity,status,created_at')
        .gte('created_at', prevStart.toISOString())), 'sec_fraud_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_dashboard_alerts')
        .select('id,type,message,priority,status,room,created_at')
        .gte('created_at', prevStart.toISOString())), 'hk_dashboard_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_alerts')
        .select('id,alert_type,severity,title,description,is_resolved,created_at')
        .gte('created_at', prevStart.toISOString())), 'proc_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('spa_alerts')
        .select('id,alert_type,message,severity,is_read,created_at')
        .gte('created_at', prevStart.toISOString())), 'spa_alerts'),
      kpiFetchRows(supabaseAdmin!.from('rms_parity_alerts')
        .select('id,channel,our_rate,competitor_rate,variance_pct,severity,resolved,created_at'), 'rms_parity_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_restriction_alerts')
        .select('id,alert_type,message,date_range,active,created_at')), 'rms_restriction_alerts'),
      kpiFetchRows(supabaseAdmin!.from('alert_instances')
        .select('instance_id,rule_id,triggered_at,value,status')
        .gte('triggered_at', prevStart.toISOString()), 'alert_instances'),
      kpiFetchRows(supabaseAdmin!.from('alert_rules')
        .select('rule_id,condition,threshold,severity,metric_id'), 'alert_rules'),
      kpiFetchRows(supabaseAdmin!.from('health_alerts')
        .select('id,check_type,check_name,status,severity,message,acknowledged,created_at')
        .gte('created_at', prevStart.toISOString()), 'health_alerts'),
      kpiFetchRows(scoped(supabaseAdmin!.from('transport_incidents')
        .select('id,incident_number,type,severity,location,description,status,occurred_at')
        .gte('occurred_at', prevStart.toISOString())), 'transport_incidents'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_alarms')
        .select('id,alarm_type,location,status,triggered_at,acknowledged')
        .gte('triggered_at', prevStart.toISOString())), 'sec_alarms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_compliance_items')
        .select('id,title,category,status,expiry_date')), 'sec_compliance_items'),
      kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
        .select('id,check_in_date,check_out_date,status,rate')
        .gte('check_out_date', prevStart.toISOString().slice(0, 10))), 'reservations'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id,status')), 'rooms'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
        .select('department,budget,actual')), 'hr_labor_cost_analysis'),
      kpiFetchRows(scoped(supabaseAdmin!.from('proc_budgets')
        .select('id,department,category,budgeted_amount,committed_amount,actual_spend')), 'proc_budgets'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_items')
        .select('id,item_name,reorder_point,min_stock,par_level,is_active')), 'uinv_items'),
      kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stock_balances')
        .select('item_id,on_hand')), 'uinv_stock_balances'),
      kpiFetchRows(scoped(supabaseAdmin!.from('energy_metrics')
        .select('metric_date,total_cost,electricity_kwh')
        .gte('metric_date', prevStart.toISOString().slice(0, 10))), 'energy_metrics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sales_guest_feedback')
        .select('rating,feedback_date')
        .gte('feedback_date', curStart.toISOString().slice(0, 10))), 'sales_guest_feedback'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_cost_analytics')
        .select('food_cost_pct,period')), 'fb_cost_analytics'),
      kpiFetchRows(scoped(supabaseAdmin!.from('pm_schedules')
        .select('id,next_due_date,status').eq('status', 'Active')), 'pm_schedules'),
      kpiFetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt')
        .select('id,status')
        .gte('created_at', curStart.toISOString())), 'housekeeping_task_mgmt'),
    ]);

    const alerts: ExecAlert[] = [];
    const sev = (s: string): AlertSev => {
      const v = (s || '').toLowerCase();
      if (v === 'critical' || v === 'emergency') return 'critical';
      if (v === 'high' || v === 'warning') return 'high';
      if (v === 'medium' || v === 'minor') return 'medium';
      return 'low';
    };
    const st = (s: any, acked?: boolean, resolved?: boolean): AlertSt => {
      const v = String(s || '').toLowerCase();
      if (resolved === true || ['resolved', 'closed', 'completed', 'cleared'].includes(v)) return 'resolved';
      if (acked === true || ['acknowledged', 'in progress', 'in_progress', 'investigating'].includes(v)) return 'acknowledged';
      return 'active';
    };
    const push = (a: ExecAlert) => alerts.push(a);

    // ── Dept alert tables → categories ──
    const opsCat = (a: any): AlertCat => {
      const v = `${a.category || ''} ${a.department || ''}`.toLowerCase();
      if (/revenue|pricing|rate|parity/.test(v)) return 'revenue';
      if (/occupancy|front office|room|arrival|vip/.test(v)) return 'occupancy';
      if (/staff|labor|housekeeping|shortage|schedule/.test(v)) return 'labor';
      if (/inventory|stock|linen|amenity|shortage/.test(v)) return 'inventory';
      if (/procurement|budget|vendor|purchase/.test(v)) return 'budget';
      if (/guest|satisfaction|escalation|complaint|spa/.test(v)) return 'satisfaction';
      if (/security|fraud|theft|access/.test(v)) return 'fraud';
      if (/energy|utility|power|water|hvac/.test(v)) return 'energy';
      if (/transport|safety|compliance|emergency|medical/.test(v)) return 'compliance';
      if (/equipment|maintenance|engineering|failure|repair/.test(v)) return 'cost';
      return 'cost';
    };
    opsAlerts.forEach((a: any) => push({
      id: `ops-${a.id}`, title: a.message?.slice(0, 80) || 'Ops alert',
      description: a.message || '', severity: sev(a.severity),
      category: opsCat(a),
      status: st(a.status), timestamp: a.created_at, value: null, threshold: null,
      source: 'Ops Command', department: a.department || undefined,
    }));

    engAlerts.forEach((a: any) => push({
      id: `eng-${a.id}`, title: `${a.type || 'Maintenance'} alert`,
      description: a.message || '', severity: sev(a.priority),
      category: 'cost', status: st(a.status), timestamp: a.created_at,
      value: null, threshold: null, source: 'Engineering', department: 'Engineering',
    }));

    utilAlerts.forEach((a: any) => push({
      id: `util-${a.id}`, title: `${a.alert_type || 'Utility'}${a.sector ? ` — ${a.sector}` : ''}`,
      description: a.description || '', severity: sev(a.severity),
      category: 'energy', status: st(a.status), timestamp: a.detected_at,
      value: null, threshold: null, source: 'Utility Monitoring', department: 'Engineering',
    }));

    iotAlerts.forEach((a: any) => push({
      id: `iot-${a.alert_id}`, title: `Sensor ${String(a.alert_type || '').replace(/_/g, ' ')}${a.location ? ` — ${a.location}` : ''}`,
      description: a.alert_message || '', severity: sev(a.severity),
      category: 'cost', status: st(null, a.acknowledged), timestamp: a.created_at,
      value: a.alert_value != null ? Number(a.alert_value) : null,
      threshold: a.threshold_value != null ? Number(a.threshold_value) : null,
      source: 'IoT Sensors', department: 'Engineering',
    }));

    secAlerts.forEach((a: any) => push({
      id: `sec-${a.id}`, title: `${a.type || 'Security'} alert${a.location ? ` — ${a.location}` : ''}`,
      description: a.message || '', severity: sev(a.priority),
      category: 'fraud', status: st(a.status), timestamp: a.created_at,
      value: null, threshold: null, source: 'Security', department: 'Security',
    }));

    fraudAlerts.forEach((a: any) => push({
      id: `fraud-${a.id}`, title: a.title || `${a.alert_type} alert`,
      description: a.description || '', severity: sev(a.severity),
      category: 'fraud', status: st(a.status), timestamp: a.created_at,
      value: a.amount != null ? Number(a.amount) : null, threshold: null,
      source: 'Fraud Detection', department: 'Security',
    }));

    const hkCat = (t: string): AlertCat => {
      const v = (t || '').toLowerCase();
      if (v.includes('linen') || v.includes('stock') || v.includes('amenity') || v.includes('minibar')) return 'inventory';
      if (v.includes('staff') || v.includes('task') || v.includes('workload')) return 'labor';
      return 'labor';
    };
    hkAlerts.forEach((a: any) => push({
      id: `hk-${a.id}`, title: `${a.type || 'HK'} alert${a.room ? ` — Room ${a.room}` : ''}`,
      description: a.message || '', severity: sev(a.priority),
      category: hkCat(a.type), status: st(a.status), timestamp: a.created_at,
      value: null, threshold: null, source: 'Housekeeping', department: 'Housekeeping',
    }));

    procAlerts.forEach((a: any) => {
      const v = (a.alert_type || '').toLowerCase();
      push({
        id: `proc-${a.id}`, title: a.title || `${a.alert_type} alert`,
        description: a.description || '', severity: sev(a.severity),
        category: v.includes('stock') || v.includes('shortage') || v.includes('reorder') ? 'inventory' : 'budget',
        status: st(null, false, a.is_resolved === true), timestamp: a.created_at,
        value: null, threshold: null, source: 'Procurement', department: 'Procurement',
      });
    });

    spaAlerts.forEach((a: any) => push({
      id: `spa-${a.id}`, title: `${a.alert_type || 'Spa'} alert`,
      description: a.message || '', severity: sev(a.severity),
      category: 'satisfaction', status: st(null, a.is_read), timestamp: a.created_at,
      value: null, threshold: null, source: 'Spa & Wellness', department: 'Spa',
    }));

    parityAlerts.forEach((a: any) => push({
      id: `par-${a.id}`, title: `Rate parity gap — ${a.channel}`,
      description: `Our rate ${Number(a.our_rate || 0).toLocaleString()} vs competitor ${Number(a.competitor_rate || 0).toLocaleString()}`,
      severity: sev(a.severity), category: 'revenue',
      status: st(null, false, a.resolved === true), timestamp: a.created_at,
      value: a.our_rate != null ? Number(a.our_rate) : null,
      threshold: a.competitor_rate != null ? Number(a.competitor_rate) : null,
      source: 'Rate Parity', department: 'Revenue',
    }));

    restrAlerts.filter((a: any) => a.active !== false).forEach((a: any) => push({
      id: `rst-${a.id}`, title: `Restriction ${a.alert_type || ''}${a.date_range ? ` (${a.date_range})` : ''}`,
      description: a.message || '', severity: 'medium', category: 'revenue',
      status: 'active', timestamp: a.created_at, value: null, threshold: null,
      source: 'RMS Restrictions', department: 'Revenue',
    }));

    const ruleById: Record<string, any> = {};
    alertRules.forEach((r: any) => { ruleById[r.rule_id] = r; });
    alertInst.forEach((a: any) => {
      const rule = ruleById[a.rule_id] || {};
      push({
        id: `rule-${a.instance_id}`,
        title: `Rule breach${rule.metric_id ? ` — ${rule.metric_id}` : ''}`,
        description: `${rule.condition || 'threshold breach'} · severity ${rule.severity || 'n/a'}`,
        severity: sev(rule.severity || 'medium'), category: 'budget',
        status: st(a.status), timestamp: a.triggered_at,
        value: a.value != null ? Number(a.value) : null,
        threshold: rule.threshold != null ? Number(rule.threshold) : null,
        source: 'Alert Rules',
      });
    });

    healthAlerts.forEach((a: any) => push({
      id: `hlth-${a.id}`, title: a.check_name || `${a.check_type} check`,
      description: a.message || '', severity: sev(a.severity),
      category: 'compliance', status: st(a.status === 'resolved' ? 'resolved' : null, a.acknowledged),
      timestamp: a.created_at, value: null, threshold: null, source: 'Health Checks',
    }));

    transportIncidents.forEach((a: any) => push({
      id: `trn-${a.id}`, title: `Transport ${a.type || 'incident'}${a.location ? ` — ${a.location}` : ''}`,
      description: a.description || `Incident ${a.incident_number}`, severity: sev(a.severity),
      category: 'compliance', status: st(a.status), timestamp: a.occurred_at,
      value: null, threshold: null, source: 'Transportation', department: 'Transportation',
    }));

    alarms.forEach((a: any) => push({
      id: `alrm-${a.id}`, title: `${a.alarm_type} — ${a.location}`,
      description: `Alarm triggered at ${a.location}`, severity: 'high',
      category: 'fraud', status: st(a.status, a.acknowledged), timestamp: a.triggered_at,
      value: null, threshold: null, source: 'Alarm System', department: 'Security',
    }));

    complianceItems.filter((c: any) =>
      c.status !== 'Compliant' || (c.expiry_date && c.expiry_date <= in60.toISOString().slice(0, 10))
    ).forEach((c: any) => push({
      id: `comp-${c.id}`, title: c.title,
      description: `${c.category} · ${c.status}${c.expiry_date ? ` · expires ${c.expiry_date}` : ''}`,
      severity: c.status !== 'Compliant' ? 'high' : (c.expiry_date && c.expiry_date <= todayStr ? 'critical' : 'medium'),
      category: 'compliance', status: c.status === 'Compliant' ? 'active' : st(null, false, false),
      timestamp: c.expiry_date, value: null, threshold: null,
      source: 'Compliance Register', department: 'Security',
    }));

    // ── Computed threshold exceptions (real value vs threshold) ──
    const resActive = reservations.filter((r: any) => !['Cancelled', 'No Show'].includes(r.status));
    const roomRevIn = (s: Date, e: Date) => resActive.reduce((sum: number, r: any) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      const n = Math.max(0, (Math.min(co, e.getTime()) - Math.max(ci, s.getTime())) / 86400000);
      return sum + n * (Number(r.rate) || 0);
    }, 0);
    const nightsIn = (s: Date, e: Date) => resActive.reduce((sum: number, r: any) => {
      const ci = new Date(r.check_in_date).getTime();
      const co = new Date(r.check_out_date).getTime();
      if (isNaN(ci) || isNaN(co)) return sum;
      return sum + Math.max(0, (Math.min(co, e.getTime()) - Math.max(ci, s.getTime())) / 86400000);
    }, 0);

    const curRev = roomRevIn(curStart, now);
    const prevRev = roomRevIn(prevStart, curStart);
    if (prevRev > 0 && curRev < prevRev * 0.85) {
      push({ id: 'exc-rev', title: 'Revenue Drop Exception', severity: 'high', category: 'revenue',
        description: `Room revenue ${Math.round(curRev).toLocaleString()} is ${((1 - curRev / prevRev) * 100).toFixed(0)}% below prior period ${Math.round(prevRev).toLocaleString()}`,
        status: 'active', timestamp: now.toISOString(), value: Math.round(curRev), threshold: Math.round(prevRev * 0.85),
        source: 'Computed Exception', department: 'Revenue' });
    }

    const roomDenom = rooms.length * days;
    const occ = roomDenom > 0 ? (nightsIn(curStart, now) / roomDenom) * 100 : 0;
    if (rooms.length > 0 && occ < 50) {
      push({ id: 'exc-occ', title: 'Occupancy Below Threshold', severity: occ < 30 ? 'critical' : 'high', category: 'occupancy',
        description: `Occupancy at ${occ.toFixed(1)}% vs 50% floor (${Math.round(nightsIn(curStart, now))} room nights over ${days}d)`,
        status: 'active', timestamp: now.toISOString(), value: Math.round(occ * 10) / 10, threshold: 50,
        source: 'Computed Exception', department: 'Front Office' });
    }

    const laborB = laborAnalysis.reduce((s: number, r: any) => s + (Number(r.budget) || 0), 0);
    const laborA = laborAnalysis.reduce((s: number, r: any) => s + (Number(r.actual) || 0), 0);
    if (laborB > 0 && laborA > laborB) {
      push({ id: 'exc-labor', title: 'Labor Cost Overrun', severity: laborA > laborB * 1.1 ? 'high' : 'medium', category: 'labor',
        description: `Labor actual ${laborA.toLocaleString()} exceeds budget ${laborB.toLocaleString()} by ${(((laborA / laborB) - 1) * 100).toFixed(1)}%`,
        status: 'active', timestamp: now.toISOString(), value: laborA, threshold: laborB,
        source: 'Computed Exception', department: 'HR' });
    }

    procBudgets.forEach((b: any) => {
      const used = (Number(b.committed_amount) || 0) + (Number(b.actual_spend) || 0);
      const budgeted = Number(b.budgeted_amount) || 0;
      if (budgeted > 0 && used > budgeted) {
        push({ id: `exc-bud-${b.id}`, title: `Budget overrun — ${b.department} ${b.category}`, severity: 'high', category: 'budget',
          description: `Committed + spent ${Math.round(used).toLocaleString()} vs budget ${budgeted.toLocaleString()} (${((used / budgeted - 1) * 100).toFixed(0)}% over)`,
          status: 'active', timestamp: now.toISOString(), value: Math.round(used), threshold: budgeted,
          source: 'Computed Exception', department: b.department });
      }
    });

    const onHand = new Map<string, number>();
    balances.forEach((b: any) => onHand.set(b.item_id, (onHand.get(b.item_id) || 0) + (Number(b.on_hand) || 0)));
    const lowStock = items.filter((i: any) => {
      if (i.is_active === false) return false;
      const reorder = Number(i.reorder_point ?? i.min_stock ?? i.par_level ?? 0);
      return reorder > 0 && (onHand.get(i.id) || 0) <= reorder;
    });
    if (lowStock.length) {
      push({ id: 'exc-inv', title: 'Inventory Shortage', severity: lowStock.length >= 10 ? 'high' : 'medium', category: 'inventory',
        description: `${lowStock.length} items at or below reorder point (${lowStock.slice(0, 3).map((i: any) => i.item_name).join(', ')}${lowStock.length > 3 ? '…' : ''})`,
        status: 'active', timestamp: now.toISOString(), value: lowStock.length, threshold: 0,
        source: 'Computed Exception', department: 'Inventory' });
    }

    const curEnergy = energyM.filter((e: any) => e.metric_date >= curStart.toISOString().slice(0, 10))
      .reduce((s: number, e: any) => s + (Number(e.total_cost) || 0), 0);
    const prevEnergy = energyM.filter((e: any) => e.metric_date < curStart.toISOString().slice(0, 10))
      .reduce((s: number, e: any) => s + (Number(e.total_cost) || 0), 0);
    if (prevEnergy > 0 && curEnergy > prevEnergy * 1.2) {
      push({ id: 'exc-energy', title: 'Energy Cost Spike', severity: 'high', category: 'energy',
        description: `Utility cost ${Math.round(curEnergy).toLocaleString()} is ${((curEnergy / prevEnergy - 1) * 100).toFixed(0)}% above prior period`,
        status: 'active', timestamp: now.toISOString(), value: Math.round(curEnergy), threshold: Math.round(prevEnergy * 1.2),
        source: 'Computed Exception', department: 'Engineering' });
    }

    const avgRating = feedback.length
      ? feedback.reduce((s: number, f: any) => s + (Number(f.rating) || 0), 0) / feedback.length : null;
    if (avgRating !== null && avgRating < 4) {
      push({ id: 'exc-sat', title: 'Guest Satisfaction Decline', severity: avgRating < 3.5 ? 'critical' : 'high', category: 'satisfaction',
        description: `Average rating ${avgRating.toFixed(1)}/5 across ${feedback.length} feedback entries — below 4.0 threshold`,
        status: 'active', timestamp: now.toISOString(), value: Math.round(avgRating * 10) / 10, threshold: 4,
        source: 'Computed Exception', department: 'Guest Relations' });
    }

    const avgFoodCost = fbCost.length
      ? fbCost.reduce((s: number, r: any) => s + (Number(r.food_cost_pct) || 0), 0) / fbCost.length : null;
    if (avgFoodCost !== null && avgFoodCost > 30) {
      push({ id: 'exc-food', title: 'Food Cost Above Ceiling', severity: avgFoodCost > 35 ? 'high' : 'medium', category: 'cost',
        description: `Food cost ${avgFoodCost.toFixed(1)}% exceeds 30% ceiling`,
        status: 'active', timestamp: now.toISOString(), value: Math.round(avgFoodCost * 10) / 10, threshold: 30,
        source: 'Computed Exception', department: 'F&B' });
    }

    const pmOverdue = pmSchedules.filter((p: any) => p.next_due_date && p.next_due_date <= todayStr);
    if (pmOverdue.length) {
      push({ id: 'exc-pm', title: 'PM Schedules Overdue', severity: pmOverdue.length >= 5 ? 'high' : 'medium', category: 'compliance',
        description: `${pmOverdue.length} preventive maintenance schedules past due`,
        status: 'active', timestamp: now.toISOString(), value: pmOverdue.length, threshold: 0,
        source: 'Computed Exception', department: 'Engineering' });
    }

    const hkDone = hkTasks.filter((t: any) => t.status === 'Completed').length;
    if (hkTasks.length && hkDone / hkTasks.length < 0.7) {
      push({ id: 'exc-hk', title: 'HK Task Backlog', severity: 'medium', category: 'labor',
        description: `Only ${hkDone}/${hkTasks.length} tasks completed (${((hkDone / hkTasks.length) * 100).toFixed(0)}%) — below 70% target`,
        status: 'active', timestamp: now.toISOString(), value: Math.round((hkDone / hkTasks.length) * 100), threshold: 70,
        source: 'Computed Exception', department: 'Housekeeping' });
    }

    // ── Apply executive dispositions (acknowledge/resolve overrides) ──
    const alertOverrides = await kpiFetchRows(
      supabaseAdmin!.from('exec_item_overrides')
        .select('item_id,status,note,updated_by')
        .eq('item_kind', 'alert'), 'exec_item_overrides');
    const ovrMap = new Map(alertOverrides.map((o: any) => [o.item_id, o]));
    for (const a of alerts) {
      const o = ovrMap.get(a.id);
      if (o) {
        a.status = o.status as AlertSt;
        (a as any).note = o.note;
        (a as any).updatedBy = o.updated_by;
      }
    }

    // ── Sort & summary ──
    const sevRank: Record<AlertSev, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const stRank: Record<AlertSt, number> = { active: 0, acknowledged: 1, resolved: 2 };
    alerts.sort((a, b) =>
      stRank[a.status] - stRank[b.status] ||
      sevRank[a.severity] - sevRank[b.severity] ||
      String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    res.json({
      propertyId, days, generatedAt: now.toISOString(),
      alerts,
      summary: {
        total: alerts.length,
        active: alerts.filter(a => a.status === 'active').length,
        acknowledged: alerts.filter(a => a.status === 'acknowledged').length,
        resolved: alerts.filter(a => a.status === 'resolved').length,
        critical: alerts.filter(a => a.severity === 'critical' && a.status === 'active').length,
        byCategory: ALERT_CATS.map(c => ({
          category: c,
          count: alerts.filter(a => a.category === c).length,
          active: alerts.filter(a => a.category === c && a.status === 'active').length,
        })),
        bySource: Object.entries(
          alerts.reduce((m: Record<string, number>, a) => { m[a.source] = (m[a.source] || 0) + 1; return m; }, {}),
        ).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      },
    });
  } catch (err: any) {
    console.error('[exec-alerts-exceptions]', err);
    res.status(500).json({ error: 'Failed to compute alerts & exceptions' });
  }
});

// PATCH /api/executive/alerts-exceptions/:id
// Executive disposition on an aggregated alert — stored as an override in
// exec_item_overrides (the alerts are read-only rollups of ~27 source
// tables, so status can't be written back generically). status='active'
// deletes the override (reopens the alert).
router.patch('/alerts-exceptions/:id', authenticate, requirePermission('exec:alerts:update'), async (req: Request, res: Response) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status, note } = req.body || {};
    if (!['acknowledged', 'resolved', 'active'].includes(status)) {
      return res.status(400).json({ error: "status must be 'acknowledged', 'resolved' or 'active'" });
    }
    if (status === 'active') {
      const { error } = await supabaseAdmin!.from('exec_item_overrides')
        .delete().eq('item_kind', 'alert').eq('item_id', req.params.id);
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('exec-alerts:*');
      return res.json({ ok: true, cleared: true });
    }
    const { data, error } = await supabaseAdmin!.from('exec_item_overrides').upsert({
      item_kind: 'alert',
      item_id: req.params.id,
      property_id: (req.body?.propertyId as string) || null,
      status,
      note: note ?? null,
      updated_by: (req.user as any)?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'item_kind,item_id' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    cacheService.invalidate('exec-alerts:*');
    res.json({ ok: true, override: data });
  } catch (err: any) {
    console.error('[exec-alerts-patch]', err);
    res.status(500).json({ error: err?.message || 'Failed to update alert' });
  }
});

// GET /api/executive/reports-center?days=&propertyId=
type ReportCat = 'executive' | 'financial' | 'operational' | 'forecast' | 'custom';
type ReportStatus = 'ready' | 'generating' | 'scheduled' | 'failed';
interface ExecReport {
  id: string;
  rawId?: string;
  sourceKey?: string;
  name: string;
  description: string;
  category: ReportCat;
  frequency: string;
  lastRun: string | null;
  status: ReportStatus;
  format: string;
  source: string;
  queryId?: string | null;
  /** Recipient emails — only populated for report_schedules rows. */
  recipients?: string[];
  /** day_of_week_or_month — only populated for report_schedules rows. */
  sendDay?: string | null;
}

// Maps a report definition to an executable data-explorer query by name/source
// keywords. Order matters — specific topics are matched before broad ones.
const REPORT_QUERY_MAP: [RegExp, string][] = [
  [/occupancy|room.?night|house count|rooms (division|forecast|pickup)/i, 'occupancy-trend'],
  [/channel|booking source|market segment|distribution|pace|pickup/i, 'channel-performance'],
  [/housekeep|\bhk\b|room clean|linen|inspection|task/i, 'hk-task-mix'],
  [/staff|employee|productiv|labor|payroll|hr |human|turnover/i, 'staff-productivity'],
  [/inventory|stock|store|par level|minibar|usage/i, 'inventory-by-store'],
  [/budget|variance|departmental|cost control/i, 'dept-budget-vs-actual'],
  [/work.?order|maintenance|engineer|pm |asset|equipment|downtime/i, 'work-orders-by-status'],
  [/incident|security|fraud|risk|loss prevent|theft|cctv|access control|patrol/i, 'incidents-by-type'],
  [/vendor|supplier|spend|procurement|purchase|\bpo\b|payable/i, 'spend-by-vendor'],
  [/campaign|lead|marketing|pipeline|sales/i, 'campaign-funnel'],
  [/energy|utilit|electric|water|gas|diesel|carbon/i, 'energy-usage-daily'],
  [/waste|sustainab|green/i, 'waste-by-department'],
  [/outlet|restaurant|f&b|food|beverage|bar|banquet|event|catering|menu|covers/i, 'outlet-performance'],
  [/reservation|folio|arrival|departure|guest|no.?show|cancel/i, 'reservation-status-mix'],
  [/revenue|income|p&l|profit|financ|cash|expense|adr|revpar|trevpar|ledger|receivab/i, 'revenue-by-department'],
];
const queryForReport = (name: string, category: string, source: string): string | null => {
  const v = `${name} ${category} ${source}`;
  for (const [re, q] of REPORT_QUERY_MAP) if (re.test(v)) return q;
  return null;
};

router.get('/reports-center', authenticate, execView, execCache('reports-center'), async (req: Request, res: Response) => {
  try {
    const propertyId = (req.query.propertyId as string) || null;
    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const [
      finReports, fbReports, hkReports, engReports, opsReports, rmsReports,
      salesReports, secReports, hrReports, conciergeReports, banquetReports,
      schedules, finRuns, fbExecs, flashReports, snapshots,
      spaReports, transportReports, banquetCatalog, opsDefs, opsFinDefs,
      opsSchedules, opsGenerated, fbTemplates,
    ] = await Promise.all([
      kpiFetchRows(scoped(supabaseAdmin!.from('fin_reports')
        .select('id,report_key,title,category,period,status,format,frequency,last_run_at,last_run_by,description')), 'fin_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fb_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'fb_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hk_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'hk_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('eng_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'eng_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('ops_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'ops_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('rms_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'rms_reports'),
      kpiFetchRows(supabaseAdmin!.from('sales_reports')
        .select('id,name,category,description,status,last_run'), 'sales_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('sec_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'sec_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('hr_reports')
        .select('id,name,description,category,last_generated,generated_by')), 'hr_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('concierge_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'concierge_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('banquet_event_reports')
        .select('id,report_type,report_name,date_range_start,date_range_end,status,generated_by,generated_at')
        .order('generated_at', { ascending: false }).limit(30)), 'banquet_event_reports'),
      kpiFetchRows(supabaseAdmin!.from('report_schedules')
        .select('schedule_id,name,frequency,day_of_week_or_month,format,last_sent_at,is_active,recipient_list'), 'report_schedules'),
      kpiFetchRows(scoped(supabaseAdmin!.from('fin_report_runs')
        .select('id,report_title,generated_by,status,format,created_at')
        .order('created_at', { ascending: false }).limit(20)), 'fin_report_runs'),
      kpiFetchRows(supabaseAdmin!.from('fb_report_executions')
        .select('id,executed_by,execution_date,status,row_count,file_format')
        .order('execution_date', { ascending: false }).limit(20), 'fb_report_executions'),
      kpiFetchRows(scoped(supabaseAdmin!.from('ops_flash_reports')
        .select('id,name,type,period_date,generated_by,status,created_at')
        .order('created_at', { ascending: false }).limit(20)), 'ops_flash_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('reporting_snapshots')
        .select('module,snapshot_date,data_quality_flag,generated_at')
        .order('snapshot_date', { ascending: false }).limit(40)), 'reporting_snapshots'),
      kpiFetchRows(scoped(supabaseAdmin!.from('spa_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'spa_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('transport_reports')
        .select('id,category,name,description,last_run,status,format,frequency')), 'transport_reports'),
      kpiFetchRows(scoped(supabaseAdmin!.from('banquet_event_report_catalog')
        .select('id,category,name,description,last_run,status,format,frequency')), 'banquet_event_report_catalog'),
      kpiFetchRows(supabaseAdmin!.from('operations_report_definition')
        .select('report_id,name,category,description,default_date_range,fields,output_formats,updated_at'), 'operations_report_definition'),
      kpiFetchRows(supabaseAdmin!.from('operations_financial_report_definition')
        .select('report_id,name,type,department_scope,output_formats,updated_at'), 'operations_financial_report_definition'),
      kpiFetchRows(supabaseAdmin!.from('operations_report_schedule')
        .select('schedule_id,report_id,recipient_list,frequency,format,is_active,last_sent_at')
        .eq('is_active', true), 'operations_report_schedule'),
      kpiFetchRows(supabaseAdmin!.from('operations_generated_report')
        .select('generated_report_id,report_id,generated_by,date_range_used,generated_at,format,status')
        .order('generated_at', { ascending: false }).limit(20), 'operations_generated_report'),
      kpiFetchRows(supabaseAdmin!.from('fb_report_templates')
        .select('id,template_name,description,report_type,is_public,created_by'), 'fb_report_templates'),
    ]);

    const reports: ExecReport[] = [];
    const catOf = (portal: ReportCat, name: string, cat?: string | null): ReportCat => {
      const v = `${name} ${cat || ''}`.toLowerCase();
      if (/forecast|projection|demand|pace|pickup/.test(v)) return 'forecast';
      if (/executive|owner|board|gm |summary|multi-property/.test(v)) return 'executive';
      if (/p&l|profit|revenue|budget|financial|cash|cost|expense|adr|revpar|folio|tax|audit/.test(v)) return 'financial';
      if (/custom|template|builder|schedule/.test(v)) return 'custom';
      return portal;
    };
    const statusOf = (s: string | null): ReportStatus => {
      const v = (s || '').toLowerCase();
      if (v === 'generating' || v === 'running' || v === 'pending') return 'generating';
      if (v === 'failed') return 'failed';
      if (v === 'scheduled' || v === 'active') return 'scheduled';
      return 'ready';
    };
    const freqOf = (f: string | null): string => {
      const v = (f || '').toLowerCase().replace(/[^a-z_]/g, '');
      return ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(v) ? v : 'on_demand';
    };

    const addCatalog = (rows: any[], portal: ReportCat, source: string,
      nameF = 'name', lastF = 'last_run', fmtF = 'format', freqF = 'frequency') => {
      const sourceKey = source.toLowerCase().replace(/[^a-z]/g, '');
      rows.forEach(r => reports.push({
        id: `${sourceKey}-${r.id}`,
        rawId: String(r.id),
        sourceKey,
        name: r[nameF] || 'Untitled Report',
        description: r.description || `${source} report`,
        category: catOf(portal, r[nameF] || '', r.category),
        frequency: freqOf(r[freqF]),
        lastRun: r[lastF] || null,
        status: statusOf(r.status),
        format: r[fmtF] || 'PDF',
        source,
      }));
    };

    addCatalog(finReports, 'financial', 'Finance', 'title', 'last_run_at');
    addCatalog(fbReports, 'operational', 'F&B');
    addCatalog(hkReports, 'operational', 'Housekeeping');
    addCatalog(engReports, 'operational', 'Engineering');
    addCatalog(opsReports, 'operational', 'Operations');
    addCatalog(rmsReports, 'forecast', 'Revenue Mgmt');
    addCatalog(salesReports, 'executive', 'Sales');
    addCatalog(secReports, 'operational', 'Security');
    addCatalog(hrReports, 'operational', 'HR', 'name', 'last_generated');
    addCatalog(conciergeReports, 'operational', 'Concierge');
    addCatalog(spaReports, 'operational', 'Spa');
    addCatalog(transportReports, 'operational', 'Transportation');
    addCatalog(banquetCatalog, 'operational', 'Banquets Catalog');
    // Operations report definitions (PK is report_id, no last_run — updated_at marks config changes)
    opsDefs.forEach((r: any) => reports.push({
      id: `opsdef-${r.report_id}`,
      rawId: String(r.report_id),
      sourceKey: 'opsdef',
      name: r.name,
      description: r.description || `Operations report · ${(r.fields || []).length} fields · default ${r.default_date_range}`,
      category: catOf('operational', r.name, r.category),
      frequency: 'on_demand',
      lastRun: r.updated_at,
      status: 'ready',
      format: r.output_formats?.[0] || 'PDF',
      source: 'Ops Definitions',
    }));
    const OPS_FIN_FREQ: Record<string, string> = { Monthly: 'monthly', Quarterly: 'quarterly', YearOverYear: 'yearly' };
    opsFinDefs.forEach((r: any) => reports.push({
      id: `opsfindef-${r.report_id}`,
      rawId: String(r.report_id),
      sourceKey: 'opsfindef',
      name: r.name,
      description: `${r.type} financial report · scope ${r.department_scope}`,
      category: 'financial',
      frequency: OPS_FIN_FREQ[r.type] || 'on_demand',
      lastRun: r.updated_at,
      status: 'ready',
      format: r.output_formats?.[0] || 'PDF',
      source: 'Ops Financial',
    }));
    fbTemplates.forEach((r: any) => reports.push({
      id: `fbtemplates-${r.id}`,
      rawId: String(r.id),
      name: r.template_name,
      description: r.description || `F&B ${r.report_type} template${r.is_public ? ' · public' : ''} · by ${r.created_by}`,
      category: 'custom',
      frequency: 'on_demand',
      lastRun: null,
      status: 'ready',
      format: 'PDF',
      source: 'F&B Templates',
    }));
    banquetReports.forEach((r: any) => reports.push({
      id: `banquets-${r.id}`,
      rawId: String(r.id),
      sourceKey: 'banquets',
      name: r.report_name,
      description: `${r.report_type}${r.date_range_start ? ` · ${r.date_range_start} → ${r.date_range_end || ''}` : ''}${r.generated_by ? ` · by ${r.generated_by}` : ''}`,
      category: catOf('operational', r.report_name, r.report_type),
      frequency: 'on_demand',
      lastRun: r.generated_at,
      status: statusOf(r.status),
      format: 'PDF',
      source: 'Banquets',
    }));
    schedules.forEach((s: any, i: number) => reports.push({
      id: `reportschedules-${s.schedule_id || i}`,
      rawId: String(s.schedule_id),
      sourceKey: 'reportschedules',
      name: s.name,
      description: `Scheduled ${s.frequency} delivery to ${(s.recipient_list || []).length} recipient(s)${s.day_of_week_or_month ? ` · on ${s.day_of_week_or_month}` : ''}`,
      category: 'custom',
      frequency: freqOf(s.frequency),
      lastRun: s.last_sent_at,
      status: s.is_active ? 'scheduled' : 'ready',
      format: s.format || 'PDF',
      source: 'Report Scheduler',
      recipients: s.recipient_list || [],
      sendDay: s.day_of_week_or_month || null,
    }));
    const opsDefName = new Map<string, string>(opsDefs.map((d: any) => [d.report_id, d.name]));
    opsSchedules.forEach((s: any) => reports.push({
      id: `opssched-${s.schedule_id}`,
      rawId: String(s.schedule_id),
      name: opsDefName.get(s.report_id) || `Ops report schedule`,
      description: `Scheduled ${s.frequency} delivery to ${(s.recipient_list || []).length} recipient(s)`,
      category: 'custom',
      frequency: freqOf(s.frequency),
      lastRun: s.last_sent_at,
      status: 'scheduled',
      format: s.format || 'PDF',
      source: 'Ops Scheduler',
    }));

    // Recent executions across portals
    const recentRuns = [
      ...finRuns.map((r: any) => ({ name: r.report_title || r.report_key || 'Finance report', source: 'Finance', by: r.generated_by, status: r.status, format: r.format, at: r.created_at })),
      ...fbExecs.map((r: any) => ({ name: `F&B report execution${r.row_count ? ` (${r.row_count} rows)` : ''}`, source: 'F&B', by: r.executed_by, status: r.status, format: r.file_format, at: r.execution_date })),
      ...flashReports.map((r: any) => ({ name: r.name, source: 'Operations', by: r.generated_by, status: r.status, format: 'PDF', at: r.created_at })),
      ...banquetReports.slice(0, 10).map((r: any) => ({ name: r.report_name, source: 'Banquets', by: r.generated_by, status: r.status, format: 'PDF', at: r.generated_at })),
      ...opsGenerated.map((r: any) => ({ name: opsDefName.get(r.report_id) || 'Ops report', source: 'Operations', by: r.generated_by, status: r.status, format: r.format, at: r.generated_at })),
    ].filter(r => r.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15);

    // Departments with no report catalog table still get live, query-backed
    // report definitions — every portal is represented and every one of these
    // executes a real data-explorer query on Run/Download/Print.
    const LIVE_QUERY_REPORTS: { name: string; source: string; cat: ReportCat; queryId: string; desc: string }[] = [
      { name: 'Occupancy Trend Report', source: 'Front Office', cat: 'operational', queryId: 'occupancy-trend', desc: 'Weekly occupied room nights, ADR and RevPAR trend' },
      { name: 'Reservation Status Mix', source: 'Front Office', cat: 'operational', queryId: 'reservation-status-mix', desc: 'Reservations and revenue by booking status' },
      { name: 'Channel Performance Report', source: 'Front Office', cat: 'executive', queryId: 'channel-performance', desc: 'Bookings, revenue and avg rate by channel' },
      { name: 'Inventory Valuation by Store', source: 'Inventory', cat: 'financial', queryId: 'inventory-by-store', desc: 'SKUs, on-hand units and stock value per store' },
      { name: 'Stock Levels & Movement', source: 'Inventory', cat: 'operational', queryId: 'inventory-by-store', desc: 'Current stock balances across all stores' },
      { name: 'Vendor Spend Report', source: 'Procurement', cat: 'financial', queryId: 'spend-by-vendor', desc: 'PO count and spend share per supplier' },
      { name: 'Department Budget Utilization', source: 'Procurement', cat: 'financial', queryId: 'dept-budget-vs-actual', desc: 'Labor and procurement actuals vs budget per department' },
      { name: 'Daily Utility Consumption', source: 'Sustainability', cat: 'operational', queryId: 'energy-usage-daily', desc: 'Electricity, water, gas, diesel and solar per day' },
      { name: 'Waste by Department', source: 'Sustainability', cat: 'operational', queryId: 'waste-by-department', desc: 'Waste records and cost share per department' },
    ];
    LIVE_QUERY_REPORTS.forEach((r, i) => reports.push({
      id: `live-${r.queryId}-${i}`,
      name: r.name,
      description: `${r.desc} · live query report`,
      category: r.cat,
      frequency: 'on_demand',
      lastRun: null,
      status: 'ready',
      format: 'PDF',
      source: r.source,
      queryId: r.queryId,
    }));

    // Link each report to an executable query where the name maps to one
    reports.forEach(r => { if (!r.queryId) r.queryId = queryForReport(r.name, r.category, r.source); });

    // Latest snapshot per module
    const latestSnap = new Map<string, any>();
    snapshots.forEach((s: any) => {
      const cur = latestSnap.get(s.module);
      if (!cur || String(s.snapshot_date) > String(cur.snapshot_date)) latestSnap.set(s.module, s);
    });

    res.json({
      propertyId,
      generatedAt: new Date().toISOString(),
      reports,
      summary: {
        total: reports.length,
        ready: reports.filter(r => r.status === 'ready').length,
        scheduled: reports.filter(r => r.status === 'scheduled').length,
        generating: reports.filter(r => r.status === 'generating').length,
        failed: reports.filter(r => r.status === 'failed').length,
        byCategory: (['executive', 'financial', 'operational', 'forecast', 'custom'] as ReportCat[])
          .map(c => ({ category: c, count: reports.filter(r => r.category === c).length })),
        bySource: Object.entries(
          reports.reduce((m: Record<string, number>, r) => { m[r.source] = (m[r.source] || 0) + 1; return m; }, {}),
        ).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      },
      panels: {
        recentRuns,
        scheduledReports: schedules.map((s: any) => ({
          name: s.name, frequency: s.frequency, format: s.format,
          recipients: (s.recipient_list || []).length, lastSent: s.last_sent_at,
        })),
        snapshots: [...latestSnap.values()].map(s => ({
          module: s.module, date: s.snapshot_date, quality: s.data_quality_flag,
        })),
      },
    });
  } catch (err: any) {
    console.error('[exec-reports-center]', err);
    res.status(500).json({ error: 'Failed to compute reports center' });
  }
});

// Per-source catalog config for run/patch mutations (mirrors the HK reports pattern).
const REPORT_SOURCE_TABLES: Record<string, {
  table: string; idCol: string; lastRunCol: string | null; statusCol: string | null;
  formatCol: string | null; freqCol: string | null; runStatus: string | null;
}> = {
  finance: { table: 'fin_reports', idCol: 'id', lastRunCol: 'last_run_at', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  fb: { table: 'fb_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  housekeeping: { table: 'hk_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  engineering: { table: 'eng_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  operations: { table: 'ops_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  revenuemgmt: { table: 'rms_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  sales: { table: 'sales_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: null, freqCol: null, runStatus: 'Ready' },
  security: { table: 'sec_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  hr: { table: 'hr_reports', idCol: 'id', lastRunCol: 'last_generated', statusCol: null, formatCol: null, freqCol: null, runStatus: null },
  concierge: { table: 'concierge_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  banquets: { table: 'banquet_event_reports', idCol: 'id', lastRunCol: 'generated_at', statusCol: 'status', formatCol: null, freqCol: null, runStatus: 'Completed' },
  spa: { table: 'spa_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  transportation: { table: 'transport_reports', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  banquetscatalog: { table: 'banquet_event_report_catalog', idCol: 'id', lastRunCol: 'last_run', statusCol: 'status', formatCol: 'format', freqCol: 'frequency', runStatus: 'Ready' },
  opsdef: { table: 'operations_report_definition', idCol: 'report_id', lastRunCol: 'updated_at', statusCol: null, formatCol: null, freqCol: null, runStatus: null },
  opsfindef: { table: 'operations_financial_report_definition', idCol: 'report_id', lastRunCol: 'updated_at', statusCol: null, formatCol: null, freqCol: null, runStatus: null },
};

const EXEC_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'];
const EXEC_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'];

// POST /api/executive/reports-center/:source/:id/run — mark report refreshed
// and, when the report maps to an executable query, return real result rows.
// source 'reportschedules' dispatches the schedule to its recipients now.
router.post('/reports-center/:source/:id/run', authenticate, requirePermission('exec:reports:run'), async (req: Request, res: Response) => {
  try {
    if (req.params.source === 'reportschedules') {
      const r = await dispatchExecReportSchedule(req.params.id);
      cacheService.invalidate('exec-reports-center:*');
      return res.json({ ok: true, lastRun: r.lastSent, status: 'scheduled', dispatch: r });
    }
    const cfg = REPORT_SOURCE_TABLES[req.params.source];
    if (!cfg) return res.status(404).json({ error: 'Unknown report source' });
    const updates: Record<string, any> = {};
    if (cfg.lastRunCol) updates[cfg.lastRunCol] = new Date().toISOString();
    if (cfg.statusCol && cfg.runStatus) updates[cfg.statusCol] = cfg.runStatus;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Report source is read-only' });
    const { data, error } = await supabaseAdmin!.from(cfg.table)
      .update(updates).eq(cfg.idCol, req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Report not found' });

    // Execute the mapped data-explorer query so Run produces real output
    const days = resolveDays(req.body);
    const propertyId = (req.body?.propertyId as string) || null;
    const reportName = data.name || data.title || data.report_name || data.template_name || '';
    const queryId = queryForReport(reportName, data.category || data.report_type || '', req.params.source);
    let query = null;
    if (queryId) {
      const started = Date.now();
      const result = await execExplorerQueryCompared(queryId, days, propertyId);
      if (result) query = { id: queryId, columns: result.columns, rows: result.rows, rowCount: result.rows.length, tookMs: Date.now() - started, comparison: result.comparison };
    }

    cacheService.invalidate('exec-reports-center:*');
    res.json({ ok: true, lastRun: updates[cfg.lastRunCol!] ?? null, status: cfg.runStatus, queryId, query });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to run report' });
  }
});

// POST /api/executive/reports-center/run-all — refresh all stale reports
router.post('/reports-center/run-all', authenticate, requirePermission('exec:reports:run'), async (_req: Request, res: Response) => {
  try {
    const nowIso = new Date().toISOString();
    let refreshed = 0;
    const errors: string[] = [];
    for (const cfg of Object.values(REPORT_SOURCE_TABLES)) {
      if (!cfg.statusCol || !cfg.runStatus || !cfg.lastRunCol) continue;
      const { data, error } = await supabaseAdmin!.from(cfg.table)
        .update({ [cfg.lastRunCol]: nowIso, [cfg.statusCol]: cfg.runStatus })
        .neq(cfg.statusCol, cfg.runStatus).select('id');
      if (error) { errors.push(`${cfg.table}: ${error.message}`); continue; }
      refreshed += data?.length || 0;
    }
    cacheService.invalidate('exec-reports-center:*');
    res.json({ refreshed, errors });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to run all reports' });
  }
});

// PATCH /api/executive/reports-center/:source/:id — update frequency/format/status
// source 'reportschedules' maps to report_schedules (frequency/format/status/
// recipients/sendDay) — the table the hourly dispatch job actually reads.
router.patch('/reports-center/:source/:id', authenticate, requirePermission('exec:reports:manage'), async (req: Request, res: Response) => {
  try {
    if (req.params.source === 'reportschedules') {
      const body = req.body || {};
      const updates: Record<string, any> = {};
      if (typeof body.frequency === 'string' && body.frequency.trim()) {
        const fmap: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
        const f = fmap[body.frequency.trim().toLowerCase()];
        if (!f) return res.status(400).json({ error: 'Scheduled reports support daily/weekly/monthly/quarterly only' });
        updates.frequency = f;
      }
      if (body.format !== undefined) {
        if (!['PDF', 'Excel', 'Both'].includes(body.format)) {
          return res.status(400).json({ error: 'Schedule format must be PDF, Excel or Both' });
        }
        updates.format = body.format;
      }
      if (body.status !== undefined) {
        updates.is_active = String(body.status).toLowerCase() === 'scheduled';
      }
      if (body.recipients !== undefined) {
        const list = Array.isArray(body.recipients) ? body.recipients : String(body.recipients).split(',');
        const emails = list.map((e: any) => String(e).trim()).filter((e: string) => e.includes('@'));
        if (emails.length === 0) return res.status(400).json({ error: 'At least one valid recipient email is required' });
        updates.recipient_list = emails;
      }
      if (body.sendDay !== undefined) {
        updates.day_of_week_or_month = body.sendDay ? String(body.sendDay).slice(0, 50) : null;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update (frequency, format, status, recipients, sendDay)' });
      }
      const { data, error } = await supabaseAdmin!.from('report_schedules')
        .update(updates).eq('schedule_id', req.params.id).select('schedule_id').maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Schedule not found' });
      cacheService.invalidate('exec-reports-center:*');
      return res.json({ ok: true, updates });
    }
    const cfg = REPORT_SOURCE_TABLES[req.params.source];
    if (!cfg) return res.status(404).json({ error: 'Unknown report source' });
    const body = req.body || {};
    const updates: Record<string, any> = {};
    if (cfg.freqCol && typeof body.frequency === 'string' && body.frequency.trim()) updates[cfg.freqCol] = body.frequency.trim();
    if (cfg.formatCol && EXEC_REPORT_FORMATS.includes(body.format)) updates[cfg.formatCol] = body.format;
    if (cfg.statusCol && EXEC_REPORT_STATUSES.includes(body.status)) updates[cfg.statusCol] = body.status;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
    }
    const { data, error } = await supabaseAdmin!.from(cfg.table)
      .update(updates).eq(cfg.idCol, req.params.id).select(cfg.idCol).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Report not found' });
    cacheService.invalidate('exec-reports-center:*');
    res.json({ ok: true, updates });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update report' });
  }
});

// GET /api/executive/data-explorer?propertyId=
// Live census of every portal's data + catalog of executable queries.

const EXPLORER_SOURCES: { key: string; name: string; tables: string[] }[] = [
  { key: 'pms', name: 'Front Office / PMS', tables: ['reservations', 'rooms', 'guest_requests'] },
  { key: 'fb', name: 'F&B', tables: ['orders', 'menu_items', 'outlets'] },
  { key: 'hk', name: 'Housekeeping', tables: ['housekeeping_task_mgmt', 'room_inspections', 'hk_linen_stock'] },
  { key: 'eng', name: 'Engineering', tables: ['work_orders', 'fixed_assets', 'pm_schedules'] },
  { key: 'hr', name: 'HR', tables: ['employees', 'staff_attendance'] },
  { key: 'inventory', name: 'Inventory', tables: ['uinv_items', 'uinv_stock_ledger', 'uinv_stock_balances'] },
  { key: 'procurement', name: 'Procurement', tables: ['proc_purchase_orders', 'proc_suppliers', 'proc_requisitions'] },
  { key: 'sales', name: 'Sales & Marketing', tables: ['sales_leads', 'sales_campaigns', 'sales_contracts'] },
  { key: 'security', name: 'Security', tables: ['sec_incidents', 'sec_access_events', 'sec_patrols'] },
  { key: 'finance', name: 'Finance', tables: ['journal_entries'] },
  { key: 'spa', name: 'Spa & Wellness', tables: ['spa_appointments', 'spa_memberships'] },
  { key: 'banquets', name: 'Banquets & Events', tables: ['banquet_events'] },
  { key: 'transport', name: 'Transportation', tables: ['transport_requests', 'transport_incidents'] },
  { key: 'rms', name: 'Revenue Mgmt', tables: ['demand_forecasts', 'competitor_rates'] },
];

router.get('/data-explorer', authenticate, execView, execCache('data-explorer'), async (req: Request, res: Response) => {
  try {
    const propertyId = (req.query.propertyId as string) || null;
    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    const count = async (table: string) => {
      try {
        const { count: c, error } = await scoped(
          supabaseAdmin!.from(table).select('*', { count: 'exact', head: true }));
        return error ? 0 : (c || 0);
      } catch { return 0; }
    };

    const sources = await Promise.all(EXPLORER_SOURCES.map(async s => {
      const counts = await Promise.all(s.tables.map(count));
      return {
        key: s.key, name: s.name,
        tables: s.tables.length,
        records: counts.reduce((a, b) => a + b, 0),
        tableCounts: s.tables.map((t, i) => ({ table: t, rows: counts[i] })),
      };
    }));

    res.json({
      propertyId,
      generatedAt: new Date().toISOString(),
      sources,
      queries: EXPLORER_QUERIES.map(q => ({ ...q, executable: true })),
      summary: {
        totalRecords: sources.reduce((s, x) => s + x.records, 0),
        totalTables: sources.reduce((s, x) => s + x.tables, 0),
        portals: sources.length,
        queries: EXPLORER_QUERIES.length,
      },
    });
  } catch (err: any) {
    console.error('[exec-data-explorer]', err);
    res.status(500).json({ error: 'Failed to load data explorer' });
  }
});

// ── Executable query catalog ────────────────────────────────────────────
type QueryType = 'kpi' | 'pivot' | 'drilldown' | 'cross_dept';
interface ExplorerQueryDef {
  id: string; name: string; description: string; type: QueryType; source: string;
}
const EXPLORER_QUERIES: ExplorerQueryDef[] = [
  { id: 'revenue-by-department', name: 'Revenue by Department', description: 'Rooms, F&B, banquets & events revenue in the period', type: 'cross_dept', source: 'PMS · F&B · Banquets' },
  { id: 'occupancy-trend', name: 'Occupancy Trend', description: 'Weekly occupied room nights and occupancy rate', type: 'drilldown', source: 'PMS' },
  { id: 'channel-performance', name: 'Channel Performance', description: 'Bookings, revenue and avg rate per channel', type: 'kpi', source: 'PMS' },
  { id: 'reservation-status-mix', name: 'Reservation Status Mix', description: 'Reservations pivoted by status', type: 'pivot', source: 'PMS' },
  { id: 'outlet-performance', name: 'F&B Outlet Performance', description: 'Orders, revenue and avg check per outlet', type: 'kpi', source: 'F&B' },
  { id: 'hk-task-mix', name: 'HK Task Completion', description: 'Housekeeping tasks by type and status', type: 'drilldown', source: 'Housekeeping' },
  { id: 'staff-productivity', name: 'Staff Productivity', description: 'Rooms cleaned, hours and productivity score per staff', type: 'cross_dept', source: 'Housekeeping' },
  { id: 'work-orders-by-status', name: 'Work Orders by Status', description: 'Maintenance WOs grouped by status and priority', type: 'kpi', source: 'Engineering' },
  { id: 'inventory-by-store', name: 'Inventory by Store', description: 'On-hand value and item count per store', type: 'pivot', source: 'Inventory' },
  { id: 'dept-budget-vs-actual', name: 'Dept Budget vs Actual', description: 'Labor and procurement budgets vs actuals per department', type: 'cross_dept', source: 'HR · Procurement' },
  { id: 'spend-by-vendor', name: 'Spend by Vendor', description: 'Purchase order spend grouped by supplier', type: 'cross_dept', source: 'Procurement' },
  { id: 'incidents-by-type', name: 'Security Incidents by Type', description: 'Incidents grouped by type, priority and status', type: 'kpi', source: 'Security' },
  { id: 'campaign-funnel', name: 'Campaign Funnel', description: 'Leads → conversions per sales campaign', type: 'kpi', source: 'Sales' },
  { id: 'energy-usage-daily', name: 'Energy Usage', description: 'Daily utility consumption and cost', type: 'drilldown', source: 'Engineering' },
  { id: 'waste-by-department', name: 'Waste by Department', description: 'Waste cost per department from unified inventory', type: 'pivot', source: 'Inventory' },
];

// POST /api/executive/data-explorer/query  { id, days, propertyId }
// The executor is a standalone function so reports-center/run can reuse it.
async function execExplorerQuery(id: string, days: number, propertyId: string | null, until?: Date): Promise<{ columns: string[]; rows: any[] } | null> {
    const now = until ? new Date(until) : new Date();
    const curStart = new Date(now.getTime() - days * 86400e3);
    const curStr = curStart.toISOString();
    const curDate = curStr.slice(0, 10);
    const endStr = now.toISOString();
    const endDate = endStr.slice(0, 10);
    const scoped = <T>(q: T): T => propertyId ? (q as any).eq('property_id', propertyId) : q;

    let columns: string[] = [];
    let rows: any[] = [];

    const groupSum = (rowsIn: any[], keyF: (r: any) => string, valF: (r: any) => number) => {
      const m = new Map<string, { count: number; total: number }>();
      rowsIn.forEach(r => {
        const k = keyF(r) || 'Unknown';
        const e = m.get(k) || { count: 0, total: 0 };
        e.count += 1; e.total += valF(r);
        m.set(k, e);
      });
      return [...m.entries()].map(([k, e]) => ({ key: k, count: e.count, total: Math.round(e.total * 100) / 100 }))
        .sort((a, b) => b.total - a.total);
    };

    switch (id) {
      case 'revenue-by-department': {
        const [res2, orders, banquets] = await Promise.all([
          kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
            .select('id,check_in_date,check_out_date,status,rate')
            .gte('check_out_date', curDate).lt('check_out_date', endDate)), 'reservations'),
          kpiFetchRows(supabaseAdmin!.from('orders')
            .select('id,status,total_amount,created_at')
            .gte('created_at', curStr).lt('created_at', endStr), 'orders'),
          kpiFetchRows(scoped(supabaseAdmin!.from('banquet_events')
            .select('id,status,event_date,actual_revenue,estimated_revenue')
            .gte('event_date', curDate).lt('event_date', endDate)), 'banquet_events'),
        ]);
        const roomRev = res2.filter((r: any) => !['Cancelled', 'No Show'].includes(r.status))
          .reduce((s: number, r: any) => {
            const ci = new Date(r.check_in_date).getTime();
            const co = new Date(r.check_out_date).getTime();
            if (isNaN(ci) || isNaN(co)) return s;
            const n = Math.max(0, (Math.min(co, now.getTime()) - Math.max(ci, curStart.getTime())) / 86400000);
            return s + n * (Number(r.rate) || 0);
          }, 0);
        const fbRev = orders.filter((o: any) => !['Cancelled', 'Void'].includes(o.status))
          .reduce((s: number, o: any) => s + (Number(o.total_amount) || 0), 0);
        const bqRev = banquets.filter((b: any) => b.status !== 'Cancelled')
          .reduce((s: number, b: any) => s + (Number(b.actual_revenue) || Number(b.estimated_revenue) || 0), 0);
        const total = roomRev + fbRev + bqRev;
        columns = ['Department', 'Revenue', 'Records', 'Share %'];
        rows = [
          { Department: 'Rooms (PMS)', Revenue: Math.round(roomRev), Records: res2.length, 'Share %': total ? Math.round(roomRev / total * 1000) / 10 : 0 },
          { Department: 'F&B Outlets', Revenue: Math.round(fbRev), Records: orders.length, 'Share %': total ? Math.round(fbRev / total * 1000) / 10 : 0 },
          { Department: 'Banquets & Events', Revenue: Math.round(bqRev), Records: banquets.length, 'Share %': total ? Math.round(bqRev / total * 1000) / 10 : 0 },
        ];
        break;
      }

      case 'occupancy-trend': {
        const [res2, rooms2] = await Promise.all([
          kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
            .select('check_in_date,check_out_date,status')
            .gte('check_out_date', curDate).lt('check_out_date', endDate)), 'reservations'),
          kpiFetchRows(scoped(supabaseAdmin!.from('rooms').select('id')), 'rooms'),
        ]);
        const active = res2.filter((r: any) => !['Cancelled', 'No Show'].includes(r.status));
        const weeks = Math.ceil(days / 7);
        columns = ['Week', 'Room Nights', 'Occupancy %'];
        rows = [];
        for (let w = 0; w < weeks; w++) {
          const ws = new Date(curStart); ws.setDate(ws.getDate() + w * 7);
          const we = new Date(ws); we.setDate(we.getDate() + 7);
          if (we > now) we.setTime(now.getTime());
          const nights = active.reduce((s: number, r: any) => {
            const ci = new Date(r.check_in_date).getTime();
            const co = new Date(r.check_out_date).getTime();
            if (isNaN(ci) || isNaN(co)) return s;
            return s + Math.max(0, (Math.min(co, we.getTime()) - Math.max(ci, ws.getTime())) / 86400000);
          }, 0);
          const denom = rooms2.length * Math.max(1, (we.getTime() - ws.getTime()) / 86400000);
          rows.push({
            Week: `${ws.toISOString().slice(0, 10)} → ${we.toISOString().slice(0, 10)}`,
            'Room Nights': Math.round(nights),
            'Occupancy %': denom > 0 ? Math.round(nights / denom * 1000) / 10 : 0,
          });
        }
        break;
      }

      case 'channel-performance': {
        const res2 = await kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
          .select('channel,status,rate,total_amount')
          .gte('created_at', curStr).lt('created_at', endStr)), 'reservations');
        const g = groupSum(res2.filter((r: any) => !['Cancelled', 'No Show'].includes(r.status)),
          (r: any) => r.channel || 'Direct', (r: any) => Number(r.total_amount) || 0);
        columns = ['Channel', 'Bookings', 'Revenue', 'Avg Booking Value'];
        rows = g.map(x => ({ Channel: x.key, Bookings: x.count, Revenue: x.total, 'Avg Booking Value': x.count ? Math.round(x.total / x.count) : 0 }));
        break;
      }

      case 'reservation-status-mix': {
        const res2 = await kpiFetchRows(scoped(supabaseAdmin!.from('reservations')
          .select('status,total_amount')
          .gte('created_at', curStr).lt('created_at', endStr)), 'reservations');
        const g = groupSum(res2, (r: any) => r.status, (r: any) => Number(r.total_amount) || 0);
        columns = ['Status', 'Reservations', 'Value', 'Share %'];
        const tot = res2.length || 1;
        rows = g.map(x => ({ Status: x.key, Reservations: x.count, Value: x.total, 'Share %': Math.round(x.count / tot * 1000) / 10 }));
        break;
      }

      case 'outlet-performance': {
        const [orders, outlets] = await Promise.all([
          kpiFetchRows(supabaseAdmin!.from('orders')
            .select('outlet_id,status,total_amount')
            .gte('created_at', curStr).lt('created_at', endStr), 'orders'),
          kpiFetchRows(supabaseAdmin!.from('outlets').select('id,name'), 'outlets'),
        ]);
        const nameOf = new Map(outlets.map((o: any) => [o.id, o.name]));
        const g = groupSum(orders.filter((o: any) => !['Cancelled', 'Void'].includes(o.status)),
          (o: any) => String(nameOf.get(o.outlet_id) || o.outlet_id), (o: any) => Number(o.total_amount) || 0);
        columns = ['Outlet', 'Orders', 'Revenue', 'Avg Check'];
        rows = g.map(x => ({ Outlet: x.key, Orders: x.count, Revenue: x.total, 'Avg Check': x.count ? Math.round(x.total / x.count) : 0 }));
        break;
      }

      case 'hk-task-mix': {
        const tasks = await kpiFetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt')
          .select('type,status')
          .gte('created_at', curStr).lt('created_at', endStr)), 'housekeeping_task_mgmt');
        const m = new Map<string, { total: number; done: number }>();
        tasks.forEach((t: any) => {
          const k = t.type || 'Other';
          const e = m.get(k) || { total: 0, done: 0 };
          e.total += 1; if (t.status === 'Completed') e.done += 1;
          m.set(k, e);
        });
        columns = ['Task Type', 'Total', 'Completed', 'Completion %'];
        rows = [...m.entries()].map(([k, e]) => ({
          'Task Type': k, Total: e.total, Completed: e.done,
          'Completion %': e.total ? Math.round(e.done / e.total * 1000) / 10 : 0,
        })).sort((a, b) => b.Total - a.Total);
        break;
      }

      case 'staff-productivity': {
        const prod = await kpiFetchRows(scoped(supabaseAdmin!.from('hk_staff_productivity')
          .select('staff_id,rooms_cleaned,hours,productivity_score,inspection_score')
          .gte('period_date', curDate).lt('period_date', endDate)), 'hk_staff_productivity');
        const m = new Map<string, { rooms: number; hours: number; scores: number[]; insp: number[] }>();
        prod.forEach((p: any) => {
          const k = p.staff_id || 'Unassigned';
          const e = m.get(k) || { rooms: 0, hours: 0, scores: [], insp: [] };
          e.rooms += Number(p.rooms_cleaned) || 0;
          e.hours += Number(p.hours) || 0;
          if (p.productivity_score != null) e.scores.push(Number(p.productivity_score));
          if (p.inspection_score != null) e.insp.push(Number(p.inspection_score));
          m.set(k, e);
        });
        columns = ['Staff', 'Rooms Cleaned', 'Hours', 'Rooms/Hour', 'Avg Productivity', 'Avg Inspection'];
        rows = [...m.entries()].map(([k, e]) => ({
          Staff: k, 'Rooms Cleaned': e.rooms, Hours: Math.round(e.hours * 10) / 10,
          'Rooms/Hour': e.hours > 0 ? Math.round(e.rooms / e.hours * 100) / 100 : 0,
          'Avg Productivity': e.scores.length ? Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length * 10) / 10 : null,
          'Avg Inspection': e.insp.length ? Math.round(e.insp.reduce((a, b) => a + b, 0) / e.insp.length * 10) / 10 : null,
        })).sort((a, b) => b['Rooms Cleaned'] - a['Rooms Cleaned']);
        break;
      }

      case 'work-orders-by-status': {
        const wos = await kpiFetchRows(scoped(supabaseAdmin!.from('work_orders')
          .select('status,priority,actual_cost,cost_estimate')), 'work_orders');
        const m = new Map<string, { count: number; cost: number; crit: number }>();
        wos.forEach((w: any) => {
          const k = w.status || 'Unknown';
          const e = m.get(k) || { count: 0, cost: 0, crit: 0 };
          e.count += 1;
          e.cost += Number(w.actual_cost ?? w.cost_estimate) || 0;
          if (['Critical', 'High'].includes(w.priority)) e.crit += 1;
          m.set(k, e);
        });
        columns = ['Status', 'Work Orders', 'High/Critical', 'Cost'];
        rows = [...m.entries()].map(([k, e]) => ({
          Status: k, 'Work Orders': e.count, 'High/Critical': e.crit, Cost: Math.round(e.cost),
        })).sort((a, b) => b['Work Orders'] - a['Work Orders']);
        break;
      }

      case 'inventory-by-store': {
        const [bals, stores] = await Promise.all([
          kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stock_balances')
            .select('store_id,item_id,on_hand,unit_cost')), 'uinv_stock_balances'),
          kpiFetchRows(scoped(supabaseAdmin!.from('uinv_stores')
            .select('id,store_name,store_type')), 'uinv_stores'),
        ]);
        const storeName = new Map(stores.map((s: any) => [s.id, s.store_name]));
        const m = new Map<string, { qty: number; value: number; skus: Set<string> }>();
        bals.forEach((b: any) => {
          const k = String(storeName.get(b.store_id) || b.store_id || 'Unassigned');
          const e = m.get(k) || { qty: 0, value: 0, skus: new Set() };
          const qty = Number(b.on_hand) || 0;
          e.qty += qty; e.value += qty * (Number(b.unit_cost) || 0); e.skus.add(b.item_id);
          m.set(k, e);
        });
        columns = ['Store', 'SKUs', 'On-Hand Qty', 'Stock Value'];
        rows = [...m.entries()].map(([k, e]) => ({
          Store: k, SKUs: e.skus.size, 'On-Hand Qty': Math.round(e.qty), 'Stock Value': Math.round(e.value * 100) / 100,
        })).sort((a, b) => b['Stock Value'] - a['Stock Value']);
        break;
      }

      case 'dept-budget-vs-actual': {
        const [labor, budgets] = await Promise.all([
          kpiFetchRows(scoped(supabaseAdmin!.from('hr_labor_cost_analysis')
            .select('department,budget,actual')), 'hr_labor_cost_analysis'),
          kpiFetchRows(scoped(supabaseAdmin!.from('proc_budgets')
            .select('department,budgeted_amount,committed_amount,actual_spend')), 'proc_budgets'),
        ]);
        const m = new Map<string, { lb: number; la: number; pb: number; ps: number }>();
        labor.forEach((l: any) => {
          const k = l.department || 'General';
          const e = m.get(k) || { lb: 0, la: 0, pb: 0, ps: 0 };
          e.lb += Number(l.budget) || 0; e.la += Number(l.actual) || 0;
          m.set(k, e);
        });
        budgets.forEach((b: any) => {
          const k = b.department || 'General';
          const e = m.get(k) || { lb: 0, la: 0, pb: 0, ps: 0 };
          e.pb += Number(b.budgeted_amount) || 0;
          e.ps += (Number(b.committed_amount) || 0) + (Number(b.actual_spend) || 0);
          m.set(k, e);
        });
        columns = ['Department', 'Labor Budget', 'Labor Actual', 'Labor Var %', 'Proc Budget', 'Proc Committed+Spent', 'Proc Var %'];
        rows = [...m.entries()].map(([k, e]) => ({
          Department: k,
          'Labor Budget': e.lb, 'Labor Actual': e.la,
          'Labor Var %': e.lb > 0 ? Math.round((e.la / e.lb - 1) * 1000) / 10 : null,
          'Proc Budget': e.pb, 'Proc Committed+Spent': e.ps,
          'Proc Var %': e.pb > 0 ? Math.round((e.ps / e.pb - 1) * 1000) / 10 : null,
        })).sort((a, b) => (b['Labor Actual'] + b['Proc Committed+Spent']) - (a['Labor Actual'] + a['Proc Committed+Spent']));
        break;
      }

      case 'spend-by-vendor': {
        const [pos, suppliers] = await Promise.all([
          kpiFetchRows(scoped(supabaseAdmin!.from('proc_purchase_orders')
            .select('supplier_id,total_amount,order_date')
            .gte('order_date', curStr).lt('order_date', endStr)), 'proc_purchase_orders'),
          kpiFetchRows(scoped(supabaseAdmin!.from('proc_suppliers')
            .select('id,legal_name,trading_name')), 'proc_suppliers'),
        ]);
        const nameOf = new Map(suppliers.map((s: any) => [s.id, s.trading_name || s.legal_name]));
        const g = groupSum(pos, (p: any) => String(nameOf.get(p.supplier_id) || p.supplier_id),
          (p: any) => Number(p.total_amount) || 0);
        columns = ['Vendor', 'POs', 'Spend', 'Share %'];
        const tot = g.reduce((s, x) => s + x.total, 0) || 1;
        rows = g.map(x => ({ Vendor: x.key, POs: x.count, Spend: x.total, 'Share %': Math.round(x.total / tot * 1000) / 10 }));
        break;
      }

      case 'incidents-by-type': {
        const inc = await kpiFetchRows(scoped(supabaseAdmin!.from('sec_incidents')
          .select('incident_type,priority,status,reported_at')
          .gte('reported_at', curStr).lt('reported_at', endStr)), 'sec_incidents');
        const m = new Map<string, { count: number; open: number; crit: number }>();
        inc.forEach((i: any) => {
          const k = i.incident_type || 'Other';
          const e = m.get(k) || { count: 0, open: 0, crit: 0 };
          e.count += 1;
          if (i.status !== 'Resolved' && i.status !== 'Closed') e.open += 1;
          if (['Critical', 'High'].includes(i.priority)) e.crit += 1;
          m.set(k, e);
        });
        columns = ['Incident Type', 'Total', 'Open', 'High/Critical'];
        rows = [...m.entries()].map(([k, e]) => ({
          'Incident Type': k, Total: e.count, Open: e.open, 'High/Critical': e.crit,
        })).sort((a, b) => b.Total - a.Total);
        break;
      }

      case 'campaign-funnel': {
        const camps = await kpiFetchRows(supabaseAdmin!.from('sales_campaigns')
          .select('campaign_name,status,budget,spent,leads,conversions'), 'sales_campaigns');
        columns = ['Campaign', 'Status', 'Leads', 'Conversions', 'Conv %', 'Spend', 'Budget'];
        rows = camps.map((c: any) => ({
          Campaign: c.campaign_name, Status: c.status,
          Leads: c.leads || 0, Conversions: c.conversions || 0,
          'Conv %': c.leads ? Math.round((c.conversions || 0) / c.leads * 1000) / 10 : 0,
          Spend: Number(c.spent) || 0, Budget: Number(c.budget) || 0,
        })).sort((a, b) => b.Leads - a.Leads);
        break;
      }

      case 'energy-usage-daily': {
        const em = await kpiFetchRows(scoped(supabaseAdmin!.from('energy_metrics')
          .select('metric_date,electricity_kwh,water_liters,gas_m3,diesel_liters,solar_kwh,total_cost')
          .gte('metric_date', curDate).lt('metric_date', endDate).order('metric_date')), 'energy_metrics');
        columns = ['Date', 'Electricity kWh', 'Water L', 'Gas m³', 'Diesel L', 'Solar kWh', 'Cost'];
        rows = em.map((e: any) => ({
          Date: e.metric_date,
          'Electricity kWh': Number(e.electricity_kwh) || 0,
          'Water L': Number(e.water_liters) || 0,
          'Gas m³': Number(e.gas_m3) || 0,
          'Diesel L': Number(e.diesel_liters) || 0,
          'Solar kWh': Number(e.solar_kwh) || 0,
          Cost: Number(e.total_cost) || 0,
        }));
        break;
      }

      case 'waste-by-department': {
        const waste = await kpiFetchRows(scoped(supabaseAdmin!.from('uinv_waste')
          .select('department,total_cost,created_at')
          .gte('created_at', curStr).lt('created_at', endStr)), 'uinv_waste');
        const g = groupSum(waste, (w: any) => w.department || 'Unassigned', (w: any) => Number(w.total_cost) || 0);
        columns = ['Department', 'Records', 'Waste Cost', 'Share %'];
        const tot = g.reduce((s, x) => s + x.total, 0) || 1;
        rows = g.map(x => ({ Department: x.key, Records: x.count, 'Waste Cost': x.total, 'Share %': Math.round(x.total / tot * 1000) / 10 }));
        break;
      }

      default:
        return null;
    }

    return { columns, rows };
}

// Snapshot-style queries have no date filter — a previous-period run would
// return identical rows, so comparison is skipped for them.
const EXPLORER_SNAPSHOT_QUERIES = new Set([
  'work-orders-by-status', 'inventory-by-store', 'dept-budget-vs-actual',
  'campaign-funnel', 'waste-by-department',
]);

// Which configured KPI metric_definitions count as benchmarks per query.
const QUERY_BENCH_RE: Record<string, RegExp> = {
  'occupancy-trend': /occup/i,
  'revenue-by-department': /revenue|revpar|adr|goppar|income/i,
  'channel-performance': /channel|booking|adr|revpar/i,
  'reservation-status-mix': /reservation|cancel|booking/i,
  'outlet-performance': /f&b|food|beverage|outlet|restaurant/i,
  'hk-task-mix': /housekeep|task|inspect|clean/i,
  'staff-productivity': /productiv|labor|staff|attendance/i,
  'work-orders-by-status': /maintenance|work order|downtime|pm /i,
  'inventory-by-store': /inventory|stock/i,
  'dept-budget-vs-actual': /budget|cost|expense|labor/i,
  'spend-by-vendor': /procure|spend|vendor|supplier/i,
  'incidents-by-type': /incident|security|risk|fraud/i,
  'campaign-funnel': /campaign|lead|conversion|marketing/i,
  'energy-usage-daily': /energy|utilit|electric|water/i,
  'waste-by-department': /waste|sustain/i,
};

let metricDefsCache: any[] | null = null;
async function benchmarksForQuery(id: string): Promise<{ metric: string; module: string; department: string; target: number | null; unit: string; direction: string }[]> {
  const re = QUERY_BENCH_RE[id];
  if (!re) return [];
  if (!metricDefsCache) {
    metricDefsCache = await kpiFetchRows(
      supabaseAdmin!.from('metric_definitions').select('name,module,department,unit,direction,target_value'),
      'metric_definitions_bench');
  }
  return metricDefsCache
    .filter((m: any) => re.test(`${m.name} ${m.module} ${m.department}`))
    .map((m: any) => ({ metric: m.name, module: m.module, department: m.department, target: m.target_value, unit: m.unit, direction: m.direction }));
}

/** Executes a query plus its previous-period window and benchmark targets. */
async function execExplorerQueryCompared(id: string, days: number, propertyId: string | null) {
  const cur = await execExplorerQuery(id, days, propertyId);
  if (!cur) return null;
  let previousRows: any[] | null = null;
  if (!EXPLORER_SNAPSHOT_QUERIES.has(id)) {
    const prevEnd = new Date(Date.now() - days * 86400e3);
    previousRows = (await execExplorerQuery(id, days, propertyId, prevEnd).catch(() => null))?.rows ?? null;
  }
  const benchmarks = await benchmarksForQuery(id);
  return { ...cur, comparison: { previousRows, benchmarks } };
}

router.post('/data-explorer/query', authenticate, execView, async (req: Request, res: Response) => {
  try {
    const id = String(req.body?.id || '');
    const days = resolveDays(req.body);
    const propertyId = (req.body?.propertyId as string) || null;
    const started = Date.now();
    const result = req.body?.compare === false
      ? await execExplorerQuery(id, days, propertyId)
      : await execExplorerQueryCompared(id, days, propertyId);
    if (!result) return res.status(404).json({ error: `Unknown query: ${id}` });
    res.json({ id, days, propertyId, ...result, rowCount: result.rows.length, tookMs: Date.now() - started });
  } catch (err: any) {
    console.error('[exec-data-explorer-query]', err);
    res.status(500).json({ error: 'Failed to execute query' });
  }
});

// GET /api/executive/configuration?propertyId=
// Executive-owned configuration only: KPI metric definitions, KPI alert rules,
// and data-health checks. Module registry, property/org settings, report
// schedules and per-portal section configs (hk_config, eng_config, bar_settings,
// concierge_settings, fb_dashboard_configurations) are owned by Admin / the
// department portals and are intentionally excluded.
router.get('/configuration', authenticate, execView, execCache('configuration', 30_000), async (_req: Request, res: Response) => {
  try {
    const [metrics, alertRules, healthRules, snapshots, props] = await Promise.all([
      kpiFetchRows(supabaseAdmin!.from('metric_definitions').select('metric_id, name, module, unit, direction, target_value, formula, department, is_computed, updated_at'), 'metric_definitions'),
      kpiFetchRows(supabaseAdmin!.from('alert_rules').select('rule_id, metric_id, condition, threshold, severity, notify_roles, notify_channel, is_active, updated_at'), 'alert_rules'),
      kpiFetchRows(supabaseAdmin!.from('health_alert_rules').select('id, check_type, check_name, condition, threshold_value, alert_severity, is_active, updated_at'), 'health_alert_rules'),
      kpiFetchRows(supabaseAdmin!.from('reporting_snapshots').select('module, snapshot_date').order('snapshot_date', { ascending: false }).limit(100), 'reporting_snapshots'),
      kpiFetchRows(supabaseAdmin!.from('properties').select('id, name').limit(20), 'properties'),
    ]);

    interface CfgItem {
      id: string; name: string; description: string; category: 'dashboard' | 'kpi' | 'analytics';
      status: 'active' | 'inactive'; lastModified: string | null; source: string; meta?: string;
      kind?: 'metric' | 'rule' | 'health'; rawId?: string;
    }
    const items: CfgItem[] = [];
    const push = (i: CfgItem) => items.push(i);
    const mod = (r: any) => r.updated_at || r.created_at || null;

    // KPI Setup — metric definitions + alert rules
    const rulesByMetric = new Map<string, any[]>();
    for (const r of alertRules) {
      const arr = rulesByMetric.get(r.metric_id) || []; arr.push(r); rulesByMetric.set(r.metric_id, arr);
    }
    const kpiMetrics = metrics.map((m: any) => ({
      id: m.metric_id, name: m.name, module: m.module, department: m.department,
      unit: m.unit, direction: m.direction, target: m.target_value, formula: m.formula,
      isComputed: !!m.is_computed, ruleCount: (rulesByMetric.get(m.metric_id) || []).length,
      lastModified: mod(m),
    }));
    for (const m of kpiMetrics) {
      push({ id: `kpi-${m.id}`, name: m.name, description: `${m.module} KPI · ${m.unit} · ${m.direction}${m.target != null ? ` · target ${m.target}` : ''}`,
        category: 'kpi', status: 'active', lastModified: m.lastModified, source: 'Metric Definitions', meta: m.department,
        kind: 'metric', rawId: m.id });
    }
    const metricName = new Map(metrics.map((m: any) => [m.metric_id, m.name]));
    const kpiRules = alertRules.map((r: any) => ({ id: r.rule_id, name: metricName.get(r.metric_id) || 'Metric rule',
      condition: r.condition, threshold: r.threshold, severity: r.severity,
      channel: r.notify_channel, roles: r.notify_roles, isActive: r.is_active !== false, source: 'Alert Rules', lastModified: mod(r) }));
    const healthChecks = healthRules.map((r: any) => ({ id: r.id, name: r.check_name, condition: `${r.check_type}:${r.condition}`,
      threshold: r.threshold_value, severity: r.alert_severity, channel: (r.notification_channels || []).join(', ') || 'InApp',
      roles: [], isActive: r.is_active !== false, source: 'Health Checks', lastModified: mod(r) }));
    for (const r of kpiRules) {
      push({ id: `rule-${r.id}`, name: `${r.name} — ${r.condition}`, description: `Threshold ${r.threshold} · ${r.severity} · notify ${r.channel}`,
        category: 'kpi', status: r.isActive ? 'active' : 'inactive', lastModified: r.lastModified, source: r.source,
        kind: 'rule', rawId: r.id });
    }

    // Analytics Setup — data-health monitoring rules
    for (const r of healthChecks) {
      push({ id: `hc-${r.id}`, name: `${r.name} — ${r.condition}`, description: `Threshold ${r.threshold} · ${r.severity} · notify ${r.channel}`,
        category: 'analytics', status: r.isActive ? 'active' : 'inactive', lastModified: r.lastModified, source: r.source,
        kind: 'health', rawId: r.id });
    }

    // snapshot freshness per module
    const snapByModule = new Map<string, string>();
    for (const s of snapshots) {
      const prev = snapByModule.get(s.module);
      if (!prev || s.snapshot_date > prev) snapByModule.set(s.module, s.snapshot_date);
    }

    res.json({
      items,
      summary: {
        total: items.length,
        dashboard: 0,
        kpi: items.filter(i => i.category === 'kpi').length,
        analytics: items.filter(i => i.category === 'analytics').length,
        active: items.filter(i => i.status === 'active').length,
        inactive: items.filter(i => i.status === 'inactive').length,
      },
      kpiMetrics,
      alertRules: [...kpiRules, ...healthChecks],
      snapshotFreshness: [...snapByModule.entries()].map(([module, latest]) => ({ module, latest })),
      properties: props,
      sources: [
        { name: 'Metric Definitions', table: 'metric_definitions', count: metrics.length },
        { name: 'Alert Rules', table: 'alert_rules', count: alertRules.length },
        { name: 'Health Checks', table: 'health_alert_rules', count: healthRules.length },
        { name: 'Snapshots', table: 'reporting_snapshots', count: snapshots.length },
      ],
    });
  } catch (err: any) {
    console.error('[exec-configuration]', err);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// PATCH /api/executive/configuration/:kind/:id — edit executive-owned config.
// kind: 'metric' → metric_definitions (target, direction)
//       'rule'   → alert_rules (threshold, severity, is_active, notify_channel)
//       'health' → health_alert_rules (threshold_value, alert_severity, is_active)
const CFG_EDITABLE: Record<string, { table: string; idCol: string; fields: Record<string, (v: any) => any> }> = {
  metric: {
    table: 'metric_definitions', idCol: 'metric_id',
    fields: {
      target_value: v => (v === null || v === '' || v === undefined ? null : Number(v)),
      direction: v => (['HigherIsBetter', 'LowerIsBetter', 'Neutral'].includes(v) ? v : undefined),
    },
  },
  rule: {
    table: 'alert_rules', idCol: 'rule_id',
    fields: {
      threshold: v => (v === null || v === '' || v === undefined ? null : Number(v)),
      severity: v => (['Info', 'Warning', 'Critical'].includes(v) ? v : undefined),
      is_active: v => (typeof v === 'boolean' ? v : undefined),
      notify_channel: v => (['InApp', 'Email', 'SMS', 'Both'].includes(v) ? v : undefined),
    },
  },
  health: {
    table: 'health_alert_rules', idCol: 'id',
    fields: {
      threshold_value: v => (v === null || v === undefined ? null : String(v)),
      alert_severity: v => (['info', 'warning', 'critical'].includes(v) ? v : undefined),
      is_active: v => (typeof v === 'boolean' ? v : undefined),
    },
  },
};

router.patch('/configuration/:kind/:id', authenticate, requirePermission('exec:config:manage'), async (req: Request, res: Response) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const cfg = CFG_EDITABLE[req.params.kind];
    if (!cfg) return res.status(404).json({ error: 'Unknown config kind' });
    const body = req.body || {};
    const updates: Record<string, any> = {};
    for (const [field, coerce] of Object.entries(cfg.fields)) {
      if (!(field in body)) continue;
      const v = coerce(body[field]);
      if (v === undefined) return res.status(400).json({ error: `Invalid value for ${field}` });
      updates[field] = v;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin!.from(cfg.table)
      .update(updates).eq(cfg.idCol, req.params.id).select(cfg.idCol).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Configuration not found' });
    // Config changes must be visible immediately: drop the metric-target
    // overlay cache and every cached executive payload.
    metricTargetCache = null;
    cacheService.invalidatePattern('exec-');
    res.json({ ok: true, updates });
  } catch (err: any) {
    console.error('[exec-configuration-patch]', err);
    res.status(500).json({ error: err?.message || 'Failed to update configuration' });
  }
});

// ── Executive Approvals Queue ───────────────────────────────────────────
// GET /api/executive/approvals?propertyId=
// Aggregates pending decision items across approval sources
// (ops_approval_requests, fin_approval_requests, expense_requests) into one
// normalized queue so GM/owner users see everything awaiting sign-off.
router.get('/approvals', authenticate, execView, execCache('approvals'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    propertyId ? q.eq('property_id', propertyId) : q;

  const [ops, fin, expenses] = await Promise.all([
    kpiFetchRows(eqProp(supabaseAdmin!.from('ops_approval_requests')
      .select('id, type, category, department, title, description, amount, requested_by, urgency, status, created_at, property_id')
      .in('status', ['pending', 'escalated'])
      .order('created_at', { ascending: false })
      .limit(200)), 'ops_approval_requests'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('fin_approval_requests')
      .select('id, type, title, description, amount, requested_by_name, status, created_at, property_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200)), 'fin_approval_requests'),
    kpiFetchRows(eqProp(supabaseAdmin!.from('expense_requests')
      .select('id, amount, status, department, category, description, requested_by, priority, request_date, property_id')
      .in('status', ['Pending', 'Under Review'])
      .order('request_date', { ascending: false })
      .limit(200)), 'expense_requests'),
  ]);

  interface ApprovalItem {
    id: string;
    source: 'operations' | 'finance' | 'expenses';
    title: string;
    department: string | null;
    amount: number | null;
    urgency: string;
    status: string;
    requestedBy: string | null;
    createdAt: string | null;
    drillPath: string;
  }

  const items: ApprovalItem[] = [
    ...ops.map((o: any): ApprovalItem => ({
      id: `ops-${o.id}`,
      source: 'operations',
      title: o.title || `${o.type} request`,
      department: o.department || null,
      amount: o.amount === null || o.amount === undefined ? null : Number(o.amount),
      urgency: o.urgency || 'medium',
      status: o.status,
      requestedBy: o.requested_by || null,
      createdAt: o.created_at || null,
      drillPath: '/erp/operations/approvals',
    })),
    ...fin.map((f: any): ApprovalItem => ({
      id: `fin-${f.id}`,
      source: 'finance',
      title: f.title || `${f.type} approval`,
      department: 'Finance',
      amount: f.amount === null || f.amount === undefined ? null : Number(f.amount),
      urgency: 'medium',
      status: f.status,
      requestedBy: f.requested_by_name || null,
      createdAt: f.created_at || null,
      drillPath: '/erp/finance/dashboard',
    })),
    ...expenses.map((e: any): ApprovalItem => ({
      id: `exp-${e.id}`,
      source: 'expenses',
      title: e.description || `Expense request ${e.id}`,
      department: e.department || null,
      amount: e.amount === null || e.amount === undefined ? null : Number(e.amount),
      urgency: String(e.priority || 'Medium').toLowerCase(),
      status: String(e.status || 'pending').toLowerCase(),
      requestedBy: e.requested_by || null,
      createdAt: e.request_date || null,
      drillPath: '/erp/finance/dashboard',
    })),
  ];

  const urgencyRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) =>
    (urgencyRank[a.urgency] ?? 2) - (urgencyRank[b.urgency] ?? 2)
    || new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const summary = {
    total: items.length,
    escalated: items.filter(i => i.status === 'escalated').length,
    critical: items.filter(i => i.urgency === 'critical' || i.urgency === 'high').length,
    pendingAmount: Math.round(items.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100,
    bySource: {
      operations: items.filter(i => i.source === 'operations').length,
      finance: items.filter(i => i.source === 'finance').length,
      expenses: items.filter(i => i.source === 'expenses').length,
    },
  };

  res.json({ propertyId: propertyId || null, generatedAt: new Date().toISOString(), items, summary });
});

// POST /api/executive/approvals/:itemId/decide — record an executive-level
// decision on an aggregated approval item. Writes back to the *source*
// table using that table's own status vocabulary so the owning portal sees
// the request resolved. Requires exec:approvals:decide (migration 649).
// :itemId is the composite id emitted by GET /approvals (ops-/fin-/exp-).
router.post('/approvals/:itemId/decide', authenticate, requirePermission('exec:approvals:decide'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { itemId } = req.params;
  const decision = String(req.body?.decision || '').toLowerCase();
  const notes = req.body?.notes || null;
  const userName = req.user?.name || req.user?.id || 'executive';
  const userId = req.user?.id || null;
  const now = new Date().toISOString();

  if (!['approve', 'reject', 'escalate'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approve', 'reject' or 'escalate'" });
  }

  const source = itemId.startsWith('ops-') ? 'ops'
    : itemId.startsWith('fin-') ? 'fin'
    : itemId.startsWith('exp-') ? 'exp' : null;
  const id = itemId.slice(4);
  if (!source || !id) {
    return res.status(400).json({ error: 'itemId must be a composite id from GET /approvals (ops-*, fin-*, exp-*)' });
  }

  try {
    let error: any = null;

    if (source === 'ops') {
      ({ error } = await supabaseAdmin!.from('ops_approval_requests')
        .update({
          status: decision === 'escalate' ? 'escalated' : decision === 'approve' ? 'approved' : 'rejected',
          decided_by: userName,
          decided_at: now,
          decision_notes: notes,
        })
        .eq('id', id));
    } else if (source === 'fin') {
      if (decision === 'escalate') {
        const { data: row } = await supabaseAdmin!.from('fin_approval_requests')
          .select('current_level, total_levels').eq('id', id).maybeSingle();
        if (!row) return res.status(404).json({ error: 'Request not found' });
        if (Number(row.current_level) >= Number(row.total_levels)) {
          return res.status(400).json({ error: 'Already at final approval level' });
        }
        ({ error } = await supabaseAdmin!.from('fin_approval_requests')
          .update({ current_level: Number(row.current_level) + 1 })
          .eq('id', id));
      } else {
        ({ error } = await supabaseAdmin!.from('fin_approval_requests')
          .update(decision === 'approve'
            ? { status: 'approved', approved_by: userName, approved_at: now, notes }
            : { status: 'rejected', rejected_by: userName, rejected_at: now, rejection_reason: notes })
          .eq('id', id));
      }
    } else {
      // expense_requests uses title-case statuses; no escalation model.
      if (decision === 'escalate') {
        ({ error } = await supabaseAdmin!.from('expense_requests')
          .update({ status: 'Under Review', updated_at: now })
          .eq('id', id));
      } else {
        ({ error } = await supabaseAdmin!.from('expense_requests')
          .update({
            status: decision === 'approve' ? 'Approved' : 'Rejected',
            approved_by: userId,
            updated_at: now,
          })
          .eq('id', id));
      }
    }

    if (error) return res.status(500).json({ error: error.message });

    cacheService.invalidate('ops-approvals:*');
    cacheService.invalidate('exec-approvals:*');
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to record decision' });
  }
});

export default router;
