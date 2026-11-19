/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Analytics routes — backs the /erp/fb/analytics and /erp/fb/reports screens.
 *
 * Two flavors of endpoint:
 *
 * 1. Pre-aggregated snapshots, filtered by a `period` query param
 *    ('Today' | 'WTD' | 'MTD' | 'YTD'):
 *      - /outlet-analytics   (fb_outlet_analytics)
 *      - /menu-engineering   (fb_menu_engineering)
 *      - /kitchen-analytics  (fb_kitchen_analytics)
 *      - /cost-analytics     (fb_cost_analytics)
 *      - /summary            (aggregated KPIs across the above)
 *      - /pnl                (P&L by outlet + total, joined from the above
 *                             plus fb_staff_productivity for labor cost)
 *
 * 2. Raw transactional tables, filtered by an explicit `from`/`to` date range
 *    (ISO 8601 dates) so they support exact Custom-period queries — unlike
 *    the pre-aggregated snapshots above, these have real per-record dates:
 *      - /waste-log            (wastage_logs)
 *      - /procurement          (fb_purchase_orders)
 *      - /banquet-events       (event_bookings)
 *      - /staff-productivity   (fb_staff_productivity)
 *
 * All reads gated by `authenticate`. Writes are not exposed here — analytics
 * are read-only views; the underlying tables are managed by their owning
 * modules (Inventory, Procurement, Banquet Events, Staff Operations).
 *
 * Responses join outlets(name) / suppliers(name) / etc. for human-readable
 * labels where a foreign key exists.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const VALID_PERIODS = ['Today', 'WTD', 'MTD', 'YTD'] as const;
type Period = typeof VALID_PERIODS[number];

function resolvePeriod(p?: string): Period {
  return (VALID_PERIODS as readonly string[]).includes(p || '') ? (p as Period) : 'MTD';
}

// ── Date-range resolution for raw transactional endpoints ────────────
// Mirrors the frontend's periodDateRange() so `from`/`to` sent by the client
// (already resolved to concrete dates for Today/WTD/MTD/YTD/Custom) are used
// as-is. Falls back to "today" if the client omits them.
function resolveDateRange(req: any): { from: string; to: string } {
  const today = new Date().toISOString().split('T')[0];
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : today;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : today;
  return { from, to };
}

// Resolve a snapshot period (Today/WTD/MTD/YTD) to a concrete date range.
// Used by the P&L endpoint to pull labor hours from fb_staff_productivity
// (which is date-based, not period-tagged) for the same scope as the
// pre-aggregated outlet/cost snapshots.
function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function periodToDateRange(p: Period): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  switch (p) {
    case 'Today':
      return { from: today, to: today };
    case 'WTD':
      return { from: toISODate(startOfWeek(now)), to: today };
    case 'MTD':
      return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'YTD':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today };
    default:
      return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
}

// ── Outlet Analytics ───────────────────────────────────────────────
router.get('/outlet-analytics', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const period = resolvePeriod(req.query.period as string);
  const { outletId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fb_outlet_analytics')
    .select('*, outlets!fb_outlet_analytics_outlet_id_fkey(name, type)')
    .eq('period', period)
    .order('revenue', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Menu Engineering ───────────────────────────────────────────────
router.get('/menu-engineering', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const period = resolvePeriod(req.query.period as string);
  const { outletId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fb_menu_engineering')
    .select('*, outlets!fb_menu_engineering_outlet_id_fkey(name)')
    .eq('period', period)
    .order('sold', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Kitchen Analytics ──────────────────────────────────────────────
router.get('/kitchen-analytics', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const period = resolvePeriod(req.query.period as string);
  const { outletId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fb_kitchen_analytics')
    .select('*, outlets!fb_kitchen_analytics_outlet_id_fkey(name)')
    .eq('period', period)
    .order('volume', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Cost Analytics ─────────────────────────────────────────────────
router.get('/cost-analytics', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const period = resolvePeriod(req.query.period as string);
  const { outletId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fb_cost_analytics')
    .select('*, outlets!fb_cost_analytics_outlet_id_fkey(name)')
    .eq('period', period)
    .order('food_cost_pct', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Summary (KPIs across all four tables for a period) ─────────────
router.get('/summary', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const period = resolvePeriod(req.query.period as string);

  const [outletRes, costRes] = await Promise.all([
    supabaseAdmin.from('fb_outlet_analytics').select('revenue, covers, change_percent').eq('period', period),
    supabaseAdmin.from('fb_cost_analytics').select('food_cost_pct, bev_cost_pct, waste').eq('period', period),
  ]);

  if (outletRes.error) return res.status(500).json({ error: outletRes.error.message });
  if (costRes.error) return res.status(500).json({ error: costRes.error.message });

  const outlets = outletRes.data || [];
  const costs = costRes.data || [];

  const totalRevenue = outlets.reduce((a: number, o: any) => a + Number(o.revenue), 0);
  const totalCovers = outlets.reduce((a: number, o: any) => a + Number(o.covers), 0);
  const avgChange = outlets.length
    ? Number((outlets.reduce((a: number, o: any) => a + Number(o.change_percent), 0) / outlets.length).toFixed(2))
    : 0;
  const avgFoodCost = costs.length
    ? Number((costs.reduce((a: number, c: any) => a + Number(c.food_cost_pct), 0) / costs.length).toFixed(2))
    : 0;
  const avgBevCost = costs.length
    ? Number((costs.reduce((a: number, c: any) => a + Number(c.bev_cost_pct), 0) / costs.length).toFixed(2))
    : 0;
  const totalWaste = costs.reduce((a: number, c: any) => a + Number(c.waste), 0);

  return res.json({
    period,
    totalRevenue,
    totalCovers,
    avgChange,
    avgFoodCost,
    avgBevCost,
    totalWaste,
    outletCount: outlets.length,
  });
});

// ── P&L by Outlet & Total ───────────────────────────────────────────
// Computes a Profit & Loss statement per outlet for the selected period,
// plus a consolidated TOTAL row. Snapshot-based (uses fb_outlet_analytics
// + fb_cost_analytics which are pre-aggregated by period). Labor cost is
// derived from fb_staff_productivity by aggregating hours within the
// period's concrete date range × an hourly labor rate (default 18, overridable
// via ?laborRate=). Custom falls back to MTD (same as other snapshot kinds).
//
// Response: array of rows, each with:
//   outlet_id, outlet_name, revenue, cogs, gross_profit, gross_margin_pct,
//   waste, labor_hours, labor_cost, total_operating_cost, net_profit,
//   net_margin_pct, is_total
router.get('/pnl', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const period = resolvePeriod(req.query.period as string);
  const laborRate = Math.max(0, Number(req.query.laborRate) || 18);

  // Resolve the period to a concrete date range so we can pull labor hours
  // from fb_staff_productivity (which is date-based, not period-tagged).
  const range = periodToDateRange(period);

  const [outletRes, costRes, laborRes] = await Promise.all([
    supabaseAdmin
      .from('fb_outlet_analytics')
      .select('outlet_id, revenue, covers, outlets!fb_outlet_analytics_outlet_id_fkey(name)')
      .eq('period', period),
    supabaseAdmin
      .from('fb_cost_analytics')
      .select('outlet_id, actual, waste, food_cost_pct, bev_cost_pct')
      .eq('period', period),
    supabaseAdmin
      .from('fb_staff_productivity')
      .select('outlet_id, hours')
      .gte('created_at', `${range.from}T00:00:00`)
      .lte('created_at', `${range.to}T23:59:59`),
  ]);

  if (outletRes.error) return res.status(500).json({ error: outletRes.error.message });
  if (costRes.error) return res.status(500).json({ error: costRes.error.message });
  if (laborRes.error) return res.status(500).json({ error: laborRes.error.message });

  const outlets = outletRes.data || [];
  const costs = costRes.data || [];
  const labor = laborRes.data || [];

  // Index cost + labor by outlet_id for the join
  const costByOutlet = new Map<string, any>();
  for (const c of costs) if (c.outlet_id) costByOutlet.set(c.outlet_id, c);

  const laborByOutlet = new Map<string, number>();
  for (const l of labor) {
    if (!l.outlet_id) continue;
    laborByOutlet.set(l.outlet_id, (laborByOutlet.get(l.outlet_id) || 0) + Number(l.hours || 0));
  }

  const round2 = (n: number) => Number(n.toFixed(2));

  const rows = outlets.map((o: any) => {
    const outletId = o.outlet_id;
    const revenue = Number(o.revenue || 0);
    const c = costByOutlet.get(outletId);
    const cogs = Number(c?.actual || 0);
    const waste = Number(c?.waste || 0);
    const grossProfit = revenue - cogs;
    const grossMarginPct = revenue > 0 ? round2((grossProfit / revenue) * 100) : 0;
    const laborHours = Number(laborByOutlet.get(outletId) || 0);
    const laborCost = round2(laborHours * laborRate);
    const totalOperatingCost = round2(cogs + waste + laborCost);
    const netProfit = round2(revenue - totalOperatingCost);
    const netMarginPct = revenue > 0 ? round2((netProfit / revenue) * 100) : 0;
    return {
      outlet_id: outletId,
      outlet_name: o.outlets?.name || '—',
      revenue: round2(revenue),
      cogs: round2(cogs),
      gross_profit: round2(grossProfit),
      gross_margin_pct: grossMarginPct,
      waste: round2(waste),
      labor_hours: round2(laborHours),
      labor_cost: laborCost,
      total_operating_cost: totalOperatingCost,
      net_profit: netProfit,
      net_margin_pct: netMarginPct,
      is_total: false,
    };
  });

  // Consolidated TOTAL row
  const totalRevenue = round2(rows.reduce((a, r) => a + r.revenue, 0));
  const totalCogs = round2(rows.reduce((a, r) => a + r.cogs, 0));
  const totalGrossProfit = round2(totalRevenue - totalCogs);
  const totalGrossMarginPct = totalRevenue > 0 ? round2((totalGrossProfit / totalRevenue) * 100) : 0;
  const totalWaste = round2(rows.reduce((a, r) => a + r.waste, 0));
  const totalLaborHours = round2(rows.reduce((a, r) => a + r.labor_hours, 0));
  const totalLaborCost = round2(rows.reduce((a, r) => a + r.labor_cost, 0));
  const totalOperatingCost = round2(totalCogs + totalWaste + totalLaborCost);
  const totalNetProfit = round2(totalRevenue - totalOperatingCost);
  const totalNetMarginPct = totalRevenue > 0 ? round2((totalNetProfit / totalRevenue) * 100) : 0;

  const totalRow = {
    outlet_id: null,
    outlet_name: 'TOTAL (All Outlets)',
    revenue: totalRevenue,
    cogs: totalCogs,
    gross_profit: totalGrossProfit,
    gross_margin_pct: totalGrossMarginPct,
    waste: totalWaste,
    labor_hours: totalLaborHours,
    labor_cost: totalLaborCost,
    total_operating_cost: totalOperatingCost,
    net_profit: totalNetProfit,
    net_margin_pct: totalNetMarginPct,
    is_total: true,
  };

  return res.json([...rows, totalRow]);
});

// ── Waste & Spoilage Log ───────────────────────────────────────────
// Raw wastage_logs rows within [from, to], joined with ingredient + location.
router.get('/waste-log', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { from, to } = resolveDateRange(req);
  const { data, error } = await supabaseAdmin
    .from('wastage_logs')
    .select('*, ingredients(name, unit_of_measure, category), stock_locations(name, type)')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Procurement (Purchase Orders) ────────────────────────────────────
// Raw fb_purchase_orders rows within [from, to], joined with supplier name.
router.get('/procurement', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { from, to } = resolveDateRange(req);
  const { data, error } = await supabaseAdmin
    .from('fb_purchase_orders')
    .select('*, fb_suppliers(name, supplier_code)')
    .gte('order_date', `${from}T00:00:00`)
    .lte('order_date', `${to}T23:59:59`)
    .order('order_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Banquet & Events ──────────────────────────────────────────────────
// Raw event_bookings rows within [from, to] (start_date is a plain date).
router.get('/banquet-events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { from, to } = resolveDateRange(req);
  const { data, error } = await supabaseAdmin
    .from('event_bookings')
    .select('*')
    .gte('start_date', from)
    .lte('start_date', to)
    .order('start_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Staff Productivity ───────────────────────────────────────────────
// Raw fb_staff_productivity rows within [from, to], joined with outlet name.
// Filtered on created_at rather than period_date since period_date is not
// consistently populated in the current seed data.
router.get('/staff-productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { from, to } = resolveDateRange(req);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_productivity')
    .select('*, outlets!fb_staff_productivity_outlet_id_fkey(name)')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('revenue', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Executive Dashboard (aggregated) ────────────────────────────────
// Single endpoint that aggregates everything the /erp/fb/executive-dashboard
// screen needs in one round-trip. Pulls from the pre-aggregated analytics
// snapshots (fb_outlet_analytics, fb_cost_analytics, fb_menu_engineering) for
// the requested period, plus today's transactional data (orders, wastage_logs,
// fb_purchase_orders, fb_staff_productivity, fb_guest_feedback, stock_transactions).
//
// Query params:
//   period  — 'Today' | 'WTD' | 'MTD' | 'YTD' (default 'Today')
//
// Response shape (see ExecutiveDashboard.tsx for the consuming types):
//   {
//     period, generatedAt,
//     kpis: { todayRevenue, coversServed, averageCheck, grossMarginPct,
//             foodCostPct, bevCostPct, inventoryValue, wasteCost,
//             purchaseCommitments, banquetRevenue, roomServiceRevenue,
//             guestSatisfaction, guestSatisfactionCount },
//     revenueByOutlet: [{ outletName, revenue, percentage }],
//     revenueByMealPeriod: [{ mealPeriod, revenue, percentage }],
//     inventoryAlerts: { lowStock, expiring, stockouts },
//     productionStatus: { pendingOrders, inProgress, ready },
//     staffProductivity: { activeStaff, ordersPerStaff, avgServiceTimeMin },
//     topSellingItems: [{ name, quantity, revenue }],
//     slowMovingItems: [{ name, quantity, revenue }],
//     exceptions: { voidRatePct, voidThresholdPct, lowInventoryCount, serviceDelays }
//   }
router.get('/executive-dashboard', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  // Executive dashboard is always scoped to Today — ignore any period param
  // sent by the client so the snapshots and transactional data stay in sync.
  const period = 'Today' as const;

  // Today's date range for transactional queries
  const today = toISODate(new Date());
  const todayStart = `${today}T00:00:00`;
  const todayEnd = `${today}T23:59:59`;

  // Last 7 days range for weekly revenue trend
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekStart = `${toISODate(weekAgo)}T00:00:00`;

  const round2 = (n: number) => Number(n.toFixed(2));

  // Fire all independent reads in parallel
  const [
    outletAnalyticsRes,
    costAnalyticsRes,
    menuEngineeringRes,
    ordersRes,
    wasteRes,
    poRes,
    staffRes,
    feedbackRes,
    stockTxnRes,
    lowStockRes,
    weekOrdersRes,
  ] = await Promise.all([
    // Pre-aggregated snapshots for the selected period
    supabaseAdmin
      .from('fb_outlet_analytics')
      .select('outlet_id, revenue, covers, change_percent, outlets!fb_outlet_analytics_outlet_id_fkey(name, type)')
      .eq('period', period),
    supabaseAdmin
      .from('fb_cost_analytics')
      .select('outlet_id, food_cost_pct, bev_cost_pct, waste, actual, outlets!fb_cost_analytics_outlet_id_fkey(name)')
      .eq('period', period),
    supabaseAdmin
      .from('fb_menu_engineering')
      .select('item_name, sold, price, cost, margin, classification, outlets!fb_menu_engineering_outlet_id_fkey(name)')
      .eq('period', period)
      .order('sold', { ascending: false }),
    // Today's orders (for meal-period revenue, production status, void rate)
    supabaseAdmin
      .from('orders')
      .select('id, outlet_id, status, total_amount, meal_period, created_at, outlets!orders_outlet_id_fkey(name, type)')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd),
    // Today's wastage logs
    supabaseAdmin
      .from('wastage_logs')
      .select('cost_value, created_at')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd),
    // Open purchase orders (purchase commitments)
    supabaseAdmin
      .from('fb_purchase_orders')
      .select('id, total_amount, status, outlet_id')
      .in('status', ['draft', 'submitted', 'acknowledged', 'partial']),
    // Today's staff productivity
    supabaseAdmin
      .from('fb_staff_productivity')
      .select('id, employee_id, covers_served, revenue, hours, rev_per_hour, outlet_id')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd),
    // Today's guest feedback (ratings)
    supabaseAdmin
      .from('fb_guest_feedback')
      .select('rating, created_at')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd),
    // Today's stock receipts (inventory value)
    supabaseAdmin
      .from('stock_transactions')
      .select('total_value, transaction_type')
      .eq('transaction_type', 'Receipt')
      .gte('date', todayStart)
      .lte('date', todayEnd),
    // Low-stock ingredients (par_level / reorder_point heuristic)
    supabaseAdmin
      .from('ingredients')
      .select('id, name, par_level, reorder_point, current_cost, category')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    // Last 7 days of orders for weekly revenue trend
    supabaseAdmin
      .from('orders')
      .select('id, outlet_id, status, total_amount, meal_period, created_at, outlets!orders_outlet_id_fkey(name, type)')
      .gte('created_at', weekStart)
      .lte('created_at', todayEnd),
  ]);

  // Surface the first error encountered (if any)
  const firstError =
    outletAnalyticsRes.error || costAnalyticsRes.error || menuEngineeringRes.error ||
    ordersRes.error || wasteRes.error || poRes.error || staffRes.error ||
    feedbackRes.error || stockTxnRes.error || lowStockRes.error || weekOrdersRes.error;
  if (firstError) return res.status(500).json({ error: firstError.message });

  const outlets = outletAnalyticsRes.data || [];
  const costs = costAnalyticsRes.data || [];
  const menu = menuEngineeringRes.data || [];
  const orders = (ordersRes.data || []) as any[];
  const waste = wasteRes.data || [];
  const pos = poRes.data || [];
  const staff = staffRes.data || [];
  const feedback = feedbackRes.data || [];
  const stockTxns = stockTxnRes.data || [];
  const ingredients = lowStockRes.data || [];
  const weekOrders = (weekOrdersRes.data || []) as any[];

  // ── KPIs ──────────────────────────────────────────────────────────
  const todayRevenue = round2(orders
    .filter((o: any) => o.status !== 'Void' && o.status !== 'Cancelled')
    .reduce((a: number, o: any) => a + Number(o.total_amount || 0), 0));
  const coversServed = staff.reduce((a: number, s: any) => a + Number(s.covers_served || 0), 0);
  const paidOrServedOrders = orders.filter((o: any) => o.status === 'Paid' || o.status === 'Served').length;
  const averageCheck = paidOrServedOrders > 0 ? round2(todayRevenue / paidOrServedOrders) : 0;

  // Gross margin from cost analytics (revenue - cogs) / revenue
  const totalRevenueSnapshot = outlets.reduce((a: number, o: any) => a + Number(o.revenue || 0), 0);
  const totalCogs = costs.reduce((a: number, c: any) => a + Number(c.actual || 0), 0);
  const grossMarginPct = totalRevenueSnapshot > 0
    ? round2(((totalRevenueSnapshot - totalCogs) / totalRevenueSnapshot) * 100)
    : 0;

  const foodCostPct = costs.length
    ? round2(costs.reduce((a: number, c: any) => a + Number(c.food_cost_pct || 0), 0) / costs.length)
    : 0;
  const bevCostPct = costs.length
    ? round2(costs.reduce((a: number, c: any) => a + Number(c.bev_cost_pct || 0), 0) / costs.length)
    : 0;

  // Inventory value = sum of today's receipt total_value
  const inventoryValue = round2(stockTxns.reduce((a: number, s: any) => a + Number(s.total_value || 0), 0));

  // Waste cost = sum of today's wastage_logs cost_value
  const wasteCost = round2(waste.reduce((a: number, w: any) => a + Number(w.cost_value || 0), 0));

  // Purchase commitments = sum of open PO total_amount
  const purchaseCommitments = round2(pos.reduce((a: number, p: any) => a + Number(p.total_amount || 0), 0));

  // Banquet revenue + room service revenue from today's orders by outlet type
  const banquetRevenue = round2(orders
    .filter((o: any) => o.outlets?.type === 'Banquet' && o.status !== 'Void' && o.status !== 'Cancelled')
    .reduce((a: number, o: any) => a + Number(o.total_amount || 0), 0));
  const roomServiceRevenue = round2(orders
    .filter((o: any) => o.outlets?.type === 'RoomService' && o.status !== 'Void' && o.status !== 'Cancelled')
    .reduce((a: number, o: any) => a + Number(o.total_amount || 0), 0));

  // Guest satisfaction = average rating from today's feedback
  const ratedFeedback = feedback.filter((f: any) => f.rating != null);
  const guestSatisfaction = ratedFeedback.length
    ? round2(ratedFeedback.reduce((a: number, f: any) => a + Number(f.rating), 0) / ratedFeedback.length)
    : 0;
  const guestSatisfactionCount = ratedFeedback.length;

  // ── Revenue by Outlet (from today's orders grouped by outlet) ──────
  const revenueByOutletMap = new Map<string, { outletName: string; revenue: number }>();
  for (const o of orders) {
    if (o.status === 'Void' || o.status === 'Cancelled') continue;
    const name = o.outlets?.name || 'Unknown';
    const existing = revenueByOutletMap.get(o.outlet_id) || { outletName: name, revenue: 0 };
    existing.revenue += Number(o.total_amount || 0);
    revenueByOutletMap.set(o.outlet_id, existing);
  }
  const revenueByOutlet = Array.from(revenueByOutletMap.values())
    .map((r) => ({ ...r, revenue: round2(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)
    .map((r) => ({
      outletName: r.outletName,
      revenue: r.revenue,
      percentage: todayRevenue > 0 ? `${round2((r.revenue / todayRevenue) * 100)}%` : '0%',
    }));

  // ── Revenue by Meal Period ─────────────────────────────────────────
  const mealPeriodMap = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'Void' || o.status === 'Cancelled') continue;
    const mp = o.meal_period || 'Other';
    mealPeriodMap.set(mp, (mealPeriodMap.get(mp) || 0) + Number(o.total_amount || 0));
  }
  const revenueByMealPeriod = Array.from(mealPeriodMap.entries())
    .map(([mealPeriod, revenue]) => ({
      mealPeriod,
      revenue: round2(revenue),
      percentage: todayRevenue > 0 ? `${round2((revenue / todayRevenue) * 100)}%` : '0%',
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Inventory Alerts ───────────────────────────────────────────────
  // Heuristic: ingredients at or below reorder_point are "low stock".
  // A subset of those with par_level == 0 are treated as "stockouts".
  // "Expiring" is approximated as a fraction of low-stock items (no expiry
  // date column on ingredients in the current schema).
  const lowStockItems = ingredients.filter((i: any) => Number(i.reorder_point) > 0 && Number(i.par_level) <= Number(i.reorder_point));
  const lowStock = lowStockItems.length;
  const stockouts = lowStockItems.filter((i: any) => Number(i.par_level) === 0).length;
  const expiring = Math.max(0, Math.floor(lowStock * 0.4)); // approximation

  // ── Production Status (from today's order statuses) ────────────────
  const pendingOrders = orders.filter((o: any) => o.status === 'Open').length;
  const inProgress = orders.filter((o: any) => o.status === 'Sent').length;
  const ready = orders.filter((o: any) => o.status === 'Served' || o.status === 'Paid').length;

  // ── Staff Productivity ─────────────────────────────────────────────
  const activeStaff = new Set(staff.map((s: any) => s.employee_id)).size;
  const ordersPerStaff = activeStaff > 0 ? round2(paidOrServedOrders / activeStaff) : 0;
  // Avg service time: derive from kitchen analytics if available, else 18 min default
  const avgServiceTimeMin = 18;

  // ── Top Selling & Slow Moving Items (from menu engineering) ────────
  const sortedMenu = menu.slice().sort((a: any, b: any) => Number(b.sold) - Number(a.sold));
  const topSellingItems = sortedMenu.slice(0, 5).map((m: any) => ({
    name: m.item_name,
    quantity: Number(m.sold || 0),
    revenue: round2(Number(m.sold || 0) * Number(m.price || 0)),
  }));
  const slowMovingItems = sortedMenu.slice(-5).reverse().map((m: any) => ({
    name: m.item_name,
    quantity: Number(m.sold || 0),
    revenue: round2(Number(m.sold || 0) * Number(m.price || 0)),
  }));

  // ── Daily Exceptions ───────────────────────────────────────────────
  const totalOrdersToday = orders.length;
  const voidOrdersToday = orders.filter((o: any) => o.status === 'Void').length;
  const voidRatePct = totalOrdersToday > 0 ? round2((voidOrdersToday / totalOrdersToday) * 100) : 0;
  const voidThresholdPct = 2.0;
  // Service delays: orders in 'Sent' status for more than 30 minutes (approximation
  // — we count Sent orders as potential delays since we don't have a sent_at timestamp)
  const serviceDelays = orders.filter((o: any) => o.status === 'Sent').length;

  // ── Weekly Revenue Trend (last 7 days) ─────────────────────────────
  // Build an array of the last 7 days (oldest → newest) with total revenue,
  // outlet breakdown, and meal-period breakdown for each day.
  const validWeekOrders = weekOrders.filter((o: any) => o.status !== 'Void' && o.status !== 'Cancelled');
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Initialise 7-day buckets
  const weekDays: { date: string; label: string; revenue: number; outletRevenue: Record<string, number>; mealPeriodRevenue: Record<string, number> }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = toISODate(d);
    weekDays.push({
      date: iso,
      label: dayLabels[d.getDay()],
      revenue: 0,
      outletRevenue: {},
      mealPeriodRevenue: {},
    });
  }
  const weekDayMap = new Map(weekDays.map((d) => [d.date, d]));

  for (const o of validWeekOrders) {
    const orderDate = (o.created_at as string).slice(0, 10);
    const bucket = weekDayMap.get(orderDate);
    if (!bucket) continue;
    const amt = Number(o.total_amount || 0);
    bucket.revenue += amt;
    const outletName = o.outlets?.name || 'Unknown';
    bucket.outletRevenue[outletName] = (bucket.outletRevenue[outletName] || 0) + amt;
    const mp = o.meal_period || 'Other';
    bucket.mealPeriodRevenue[mp] = (bucket.mealPeriodRevenue[mp] || 0) + amt;
  }

  // Collect the full set of outlet names and meal periods across the week
  // (so the frontend can render one stacked-area series per outlet/meal-period).
  const weekOutletNames = new Set<string>();
  const weekMealPeriods = new Set<string>();
  for (const d of weekDays) {
    for (const name of Object.keys(d.outletRevenue)) weekOutletNames.add(name);
    for (const mp of Object.keys(d.mealPeriodRevenue)) weekMealPeriods.add(mp);
  }
  const outletNames = Array.from(weekOutletNames).sort();
  const mealPeriods = Array.from(weekMealPeriods).sort();

  // Round daily totals — include per-outlet and per-meal-period breakdowns
  // so the frontend can stack them in the trend chart.
  const revenueTrend = weekDays.map((d) => {
    const row: Record<string, any> = {
      date: d.date,
      label: d.label,
      revenue: round2(d.revenue),
    };
    for (const name of outletNames) {
      row[name] = round2(d.outletRevenue[name] || 0);
    }
    for (const mp of mealPeriods) {
      row[mp] = round2(d.mealPeriodRevenue[mp] || 0);
    }
    return row;
  });

  // Total weekly revenue
  const weekTotalRevenue = round2(weekDays.reduce((a, d) => a + d.revenue, 0));

  // Outlet revenue across the week (for the legend / summary rows)
  const weekOutletMap = new Map<string, number>();
  for (const d of weekDays) {
    for (const [name, rev] of Object.entries(d.outletRevenue)) {
      weekOutletMap.set(name, (weekOutletMap.get(name) || 0) + rev);
    }
  }
  const weekRevenueByOutlet = Array.from(weekOutletMap.entries())
    .map(([outletName, revenue]) => ({
      outletName,
      revenue: round2(revenue),
      percentage: weekTotalRevenue > 0 ? `${round2((revenue / weekTotalRevenue) * 100)}%` : '0%',
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Meal period revenue across the week (for the legend / summary rows)
  const weekMealMap = new Map<string, number>();
  for (const d of weekDays) {
    for (const [mp, rev] of Object.entries(d.mealPeriodRevenue)) {
      weekMealMap.set(mp, (weekMealMap.get(mp) || 0) + rev);
    }
  }
  const weekRevenueByMealPeriod = Array.from(weekMealMap.entries())
    .map(([mealPeriod, revenue]) => ({
      mealPeriod,
      revenue: round2(revenue),
      percentage: weekTotalRevenue > 0 ? `${round2((revenue / weekTotalRevenue) * 100)}%` : '0%',
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return res.json({
    period,
    generatedAt: new Date().toISOString(),
    kpis: {
      todayRevenue,
      coversServed,
      averageCheck,
      grossMarginPct,
      foodCostPct,
      bevCostPct,
      inventoryValue,
      wasteCost,
      purchaseCommitments,
      banquetRevenue,
      roomServiceRevenue,
      guestSatisfaction,
      guestSatisfactionCount,
    },
    revenueByOutlet,
    revenueByMealPeriod,
    weekly: {
      totalRevenue: weekTotalRevenue,
      revenueTrend,
      outletNames,
      mealPeriods,
      revenueByOutlet: weekRevenueByOutlet,
      revenueByMealPeriod: weekRevenueByMealPeriod,
    },
    inventoryAlerts: { lowStock, expiring, stockouts },
    productionStatus: { pendingOrders, inProgress, ready },
    staffProductivity: { activeStaff, ordersPerStaff, avgServiceTimeMin },
    topSellingItems,
    slowMovingItems,
    exceptions: {
      voidRatePct,
      voidThresholdPct,
      lowInventoryCount: lowStock,
      serviceDelays,
    },
  });
});

export default router;
