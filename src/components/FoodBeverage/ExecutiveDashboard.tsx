/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Executive Dashboard — centralized operational view across all F&B outlets.
 *
 * All data is served from the single aggregated endpoint
 *   GET /api/fb/analytics/executive-dashboard
 * (see src/server/routes/fbAnalytics.routes.ts). The endpoint pulls from the
 * pre-aggregated analytics snapshots (fb_outlet_analytics, fb_cost_analytics,
 * fb_menu_engineering) plus today's transactional data (orders, wastage_logs,
 * fb_purchase_orders, fb_staff_productivity, fb_guest_feedback, stock_transactions)
 * and the last 7 days of orders for the weekly revenue trend.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  DollarSign,
  Users,
  Utensils,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Star,
  ChefHat,
  ShoppingCart,
  BarChart3,
  RefreshCw,
  XCircle,
  AlertCircle,
  Coffee,
  Wine,
  Cake,
  Flame,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

const API = '/api/fb/analytics';

type TrendView = 'total' | 'outlet' | 'mealPeriod';
const SERIES_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];

interface ExecutiveDashboardData {
  period: string;
  generatedAt: string;
  kpis: {
    todayRevenue: number;
    coversServed: number;
    averageCheck: number;
    grossMarginPct: number;
    foodCostPct: number;
    bevCostPct: number;
    inventoryValue: number;
    wasteCost: number;
    purchaseCommitments: number;
    banquetRevenue: number;
    roomServiceRevenue: number;
    guestSatisfaction: number;
    guestSatisfactionCount: number;
  };
  revenueByOutlet: { outletName: string; revenue: number; percentage: string }[];
  revenueByMealPeriod: { mealPeriod: string; revenue: number; percentage: string }[];
  weekly: {
    totalRevenue: number;
    revenueTrend: { date: string; label: string; revenue: number; [key: string]: any }[];
    outletNames: string[];
    mealPeriods: string[];
    revenueByOutlet: { outletName: string; revenue: number; percentage: string }[];
    revenueByMealPeriod: { mealPeriod: string; revenue: number; percentage: string }[];
  };
  inventoryAlerts: { lowStock: number; expiring: number; stockouts: number };
  productionStatus: { pendingOrders: number; inProgress: number; ready: number };
  staffProductivity: { activeStaff: number; ordersPerStaff: number; avgServiceTimeMin: number };
  topSellingItems: { name: string; quantity: number; revenue: number }[];
  slowMovingItems: { name: string; quantity: number; revenue: number }[];
  exceptions: {
    voidRatePct: number;
    voidThresholdPct: number;
    lowInventoryCount: number;
    serviceDelays: number;
  };
}

/** Render <linearGradient> defs for the area chart based on the selected view. */
function renderGradientDefs(view: TrendView, outletNames: string[], mealPeriods: string[]) {
  if (view === 'total') {
    return (
      <linearGradient id="grad-revenue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
      </linearGradient>
    );
  }
  const names = view === 'outlet' ? outletNames : mealPeriods;
  const prefix = view === 'outlet' ? 'grad-outlet' : 'grad-mp';
  return names.map((name, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    return (
      <linearGradient key={name} id={`${prefix}-${i}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
        <stop offset="95%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    );
  });
}

export default function ExecutiveDashboard() {
  const { formatAmount, addNotification } = useERP();
  const [data, setData] = useState<ExecutiveDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trendView, setTrendView] = useState<TrendView>('total');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/executive-dashboard?period=Today`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${r.status})`);
      }
      const json = await r.json();
      setData(json as ExecutiveDashboardData);
    } catch (e: any) {
      setError(e.message || 'Failed to load executive dashboard');
      addNotification(e.message || 'Failed to load executive dashboard', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    fetchData();
    addNotification('Executive dashboard refreshed', 'info', 'F&B');
  };

  const k = data?.kpis;

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Executive Dashboard"
        subtitle={
          data
            ? `Today's operational view across all F&B outlets · Updated ${new Date(data.generatedAt).toLocaleTimeString()}`
            : "Today's operational view across all F&B outlets"
        }
        icon={BarChart3}
        actions={
          <button onClick={handleRefresh} disabled={loading} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="rounded-xl border-l-4 border-red-400 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-accent-operations)]" />
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading executive dashboard…</span>
        </div>
      )}

      {data && k && (
        <>
          {/* KPI Cards */}
          <div className={layout.kpiGrid}>
            <StatCard title="Today's Revenue" value={formatAmount(k.todayRevenue)} icon={DollarSign} tone="accent" />
            <StatCard title="Covers Served" value={String(k.coversServed)} icon={Users} tone="success" />
            <StatCard title="Average Check" value={formatAmount(k.averageCheck)} icon={TrendingUp} tone="info" />
            <StatCard title="Gross Margin" value={`${k.grossMarginPct}%`} icon={BarChart3} tone="warning" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Food Cost %" value={`${k.foodCostPct}%`} icon={Utensils} tone="danger" />
            <StatCard title="Beverage Cost %" value={`${k.bevCostPct}%`} icon={Wine} tone="info" />
            <StatCard title="Inventory Value" value={formatAmount(k.inventoryValue)} icon={Package} tone="neutral" />
            <StatCard title="Waste Cost" value={formatAmount(k.wasteCost)} icon={AlertTriangle} tone="danger" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Purchase Commitments" value={formatAmount(k.purchaseCommitments)} icon={ShoppingCart} tone="neutral" />
            <StatCard title="Banquet Revenue" value={formatAmount(k.banquetRevenue)} icon={Cake} tone="accent" />
            <StatCard title="Room Service Revenue" value={formatAmount(k.roomServiceRevenue)} icon={Coffee} tone="info" />
            <StatCard
              title={`Guest Satisfaction (${k.guestSatisfactionCount})`}
              value={k.guestSatisfaction > 0 ? `${k.guestSatisfaction}/5` : '—'}
              icon={Star}
              tone="success"
            />
          </div>

          {/* Weekly Revenue Trend (with Total / By Outlet / By Meal Period toggle) */}
          <SectionCard
            title="Weekly Revenue Trend"
            subtitle="Last 7 days"
            icon={TrendingUp}
            tone="accent"
            actions={
              <div className="flex items-center gap-3">
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                  {(['total', 'outlet', 'mealPeriod'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setTrendView(v)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        trendView === v
                          ? 'bg-[var(--color-accent-operations)] text-white'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {v === 'total' ? 'Total' : v === 'outlet' ? 'By Outlet' : 'By Meal Period'}
                    </button>
                  ))}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-500">Total (7 days)</p>
                  <p className="text-lg font-bold text-[var(--color-accent-operations)]">
                    {formatAmount(data.weekly.totalRevenue)}
                  </p>
                </div>
              </div>
            }
            pad="md"
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.weekly.revenueTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  {renderGradientDefs(trendView, data.weekly.outletNames, data.weekly.mealPeriods)}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => formatAmount(v)} width={90} />
                <Tooltip
                  formatter={(v: number) => formatAmount(v)}
                  labelFormatter={(l) => `Day: ${l}`}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                />
                {trendView !== 'total' && <Legend wrapperStyle={{ fontSize: '12px' }} />}
                {trendView === 'total' && (
                  <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#grad-revenue)" name="Revenue" />
                )}
                {trendView === 'outlet' && data.weekly.outletNames.map((name, i) => (
                  <Area
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stackId="1"
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={1.5}
                    fill={`url(#grad-outlet-${i})`}
                    name={name}
                  />
                ))}
                {trendView === 'mealPeriod' && data.weekly.mealPeriods.map((mp, i) => (
                  <Area
                    key={mp}
                    type="monotone"
                    dataKey={mp}
                    stackId="1"
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={1.5}
                    fill={`url(#grad-mp-${i})`}
                    name={mp}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>

            {/* Summary rows under the chart */}
            {trendView !== 'total' && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                {trendView === 'outlet' && data.weekly.revenueByOutlet.map((r) => (
                  <SummaryRow key={r.outletName} label={r.outletName} value={formatAmount(r.revenue)} percentage={r.percentage} />
                ))}
                {trendView === 'mealPeriod' && data.weekly.revenueByMealPeriod.map((r) => (
                  <SummaryRow key={r.mealPeriod} label={r.mealPeriod} value={formatAmount(r.revenue)} percentage={r.percentage} />
                ))}
              </div>
            )}
          </SectionCard>

          {/* Today's Revenue Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Today's Revenue by Outlet" icon={Utensils} tone="accent" pad="md">
              <div className="space-y-3">
                {data.revenueByOutlet.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-500">No outlet revenue for this period.</p>
                )}
                {data.revenueByOutlet.map((r) => (
                  <SummaryRow key={r.outletName} label={r.outletName} value={formatAmount(r.revenue)} percentage={r.percentage} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Today's Revenue by Meal Period" icon={Coffee} tone="info" pad="md">
              <div className="space-y-3">
                {data.revenueByMealPeriod.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-500">No meal-period revenue for this period.</p>
                )}
                {data.revenueByMealPeriod.map((r) => (
                  <SummaryRow key={r.mealPeriod} label={r.mealPeriod} value={formatAmount(r.revenue)} percentage={r.percentage} />
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Alerts & Status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SectionCard title="Inventory Alerts" icon={AlertTriangle} tone="warning" pad="md">
              <div className="space-y-3">
                <StatusTile label="Low Stock Items" count={data.inventoryAlerts.lowStock} icon={AlertTriangle} tone="warning" />
                <StatusTile label="Expiring Inventory" count={data.inventoryAlerts.expiring} icon={Clock} tone="danger" />
                <StatusTile label="Stockouts" count={data.inventoryAlerts.stockouts} icon={XCircle} tone="danger" />
              </div>
            </SectionCard>

            <SectionCard title="Production Status" icon={ChefHat} tone="info" pad="md">
              <div className="space-y-3">
                <StatusTile label="Pending Orders" count={data.productionStatus.pendingOrders} icon={ChefHat} tone="info" />
                <StatusTile label="In Progress" count={data.productionStatus.inProgress} icon={Flame} tone="warning" />
                <StatusTile label="Ready" count={data.productionStatus.ready} icon={CheckCircle2} tone="success" />
              </div>
            </SectionCard>

            <SectionCard title="Staff Productivity" icon={Users} tone="success" pad="md">
              <div className="space-y-3">
                <StatusTile label="Active Staff" count={data.staffProductivity.activeStaff} icon={Users} tone="success" />
                <StatusTile label="Orders per Staff" count={data.staffProductivity.ordersPerStaff} icon={Utensils} tone="info" />
                <StatusTile label="Avg Service Time" count={`${data.staffProductivity.avgServiceTimeMin} min`} icon={Clock} tone="warning" />
              </div>
            </SectionCard>
          </div>

          {/* Top Selling & Slow Moving */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Top Selling Items" icon={TrendingUp} tone="success" pad="md">
              <div className="space-y-3">
                {data.topSellingItems.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-500">No menu data for this period.</p>
                )}
                {data.topSellingItems.map((item, idx) => (
                  <ItemRow key={`${item.name}-${idx}`} name={item.name} quantity={item.quantity} revenue={formatAmount(item.revenue)} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Slow Moving Items" icon={Clock} tone="warning" pad="md">
              <div className="space-y-3">
                {data.slowMovingItems.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-500">No menu data for this period.</p>
                )}
                {data.slowMovingItems.map((item, idx) => (
                  <ItemRow key={`${item.name}-${idx}`} name={item.name} quantity={item.quantity} revenue={formatAmount(item.revenue)} />
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Daily Exceptions */}
          <SectionCard title="Daily Exceptions" icon={AlertCircle} tone="warning" pad="md">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ExceptionTile
                title="High Void Rate"
                value={`${data.exceptions.voidRatePct}%`}
                threshold={`${data.exceptions.voidThresholdPct}%`}
                isWarning={data.exceptions.voidRatePct > data.exceptions.voidThresholdPct}
              />
              <ExceptionTile
                title="Low Inventory"
                value={String(data.exceptions.lowInventoryCount)}
                isWarning={data.exceptions.lowInventoryCount > 0}
              />
              <ExceptionTile
                title="Service Delays"
                value={String(data.exceptions.serviceDelays)}
                isWarning={data.exceptions.serviceDelays > 0}
              />
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ── Helper Components (portal-consistent) ──────────────────────────────────

function SummaryRow({ label, value, percentage }: { label: string; value: string; percentage?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{value}</span>
        {percentage && <span className="text-xs text-gray-500 dark:text-gray-500">{percentage}</span>}
      </div>
    </div>
  );
}

function StatusTile({ label, count, icon: Icon, tone }: { label: string; count: number | string; icon: LucideIcon; tone: StatusTone }) {
  const toneStyles = statusTone[tone];
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
      <div className="flex items-center gap-3">
        <div className={`shrink-0 p-1.5 rounded-lg ${toneStyles.soft}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{count}</span>
    </div>
  );
}

function ItemRow({ name, quantity, revenue }: { name: string; quantity: number; revenue: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-500">{quantity} sold</p>
      </div>
      <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums shrink-0 ml-3">{revenue}</span>
    </div>
  );
}

function ExceptionTile({ title, value, threshold, isWarning }: { title: string; value: string; threshold?: string; isWarning: boolean }) {
  const tone: StatusTone = isWarning ? 'warning' : 'success';
  const toneStyles = statusTone[tone];
  return (
    <div className={`p-4 rounded-xl border ${isWarning ? 'border-amber-200 dark:border-amber-800' : 'border-green-200 dark:border-green-800'} ${isWarning ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-lg font-bold tabular-nums ${toneStyles.text}`}>{value}</span>
        {threshold && <span className="text-xs text-gray-500 dark:text-gray-500">/ {threshold}</span>}
      </div>
      <div className="mt-1">
        <Badge tone={isWarning ? 'warning' : 'success'}>
          {isWarning ? 'Action required' : 'Within threshold'}
        </Badge>
      </div>
    </div>
  );
}
