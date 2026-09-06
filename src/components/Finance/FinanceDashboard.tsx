/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finance Dashboard — Finance Portal.
 * Backs /erp/finance/dashboard.
 *
 * DB-integrated: loads KPIs, charts, alerts, bank accounts and ratios
 * from /api/fin-portal/dashboard and renders with the F&B/HK shared
 * FrontOffice design system (PageHeader, SectionCard, StatCard, Badge).
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  TrendingUp,
  DollarSign,
  Wallet,
  Banknote,
  Building2,
  AlertCircle,
  Activity,
  AlertTriangle,
  Clock,
  FileWarning,
  CheckSquare,
  Scale,
  RefreshCw,
  Loader2,
  Landmark,
  Calendar,
  Bell,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { fetchFinanceDashboard, type FinDashboardSnapshotFE } from '../../services/financePortalService';

type Tone = 'success' | 'danger' | 'warning' | 'info' | 'accent' | 'neutral';

const ICON_MAP: Record<string, LucideIcon> = {
  TrendingUp,
  DollarSign,
  Wallet,
  Banknote,
  Building2,
  AlertCircle,
  Activity,
  AlertTriangle,
  Clock,
  FileWarning,
  CheckSquare,
  Scale,
  Bell,
};

const SEVERITY_TONE: Record<string, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

function toneFromColorClass(colorClass?: string): Tone {
  if (!colorClass) return 'accent';
  if (colorClass.includes('emerald')) return 'success';
  if (colorClass.includes('rose')) return 'danger';
  if (colorClass.includes('indigo')) return 'info';
  if (colorClass.includes('blue')) return 'info';
  if (colorClass.includes('purple')) return 'accent';
  if (colorClass.includes('amber')) return 'warning';
  if (colorClass.includes('orange')) return 'warning';
  return 'accent';
}

function parseTrend(trend?: string): { change?: number; isPositive?: boolean } {
  if (!trend) return {};
  const m = trend.match(/([+-]?)([\d.]+)%/);
  if (!m) return {};
  const change = Number(m[2]);
  const sign = m[1] === '-' ? -1 : 1;
  return { change: change * sign, isPositive: sign >= 0 };
}

function parseCurrency(value?: string): number {
  if (!value) return 0;
  const n = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

// Empty snapshot used when the backend has no data yet, so the UI still renders.
const EMPTY_SNAPSHOT: FinDashboardSnapshotFE = {
  id: '',
  property_id: null,
  snapshot_date: new Date().toISOString().split('T')[0],
  kpis: [],
  revenue_expense_trend: [],
  dept_revenue: [],
  ar_aging: [],
  alerts: [],
  bank_accounts: [],
  ratios: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Default KPI tile definitions — always rendered as StatCards. When the DB
// snapshot has data, matching labels are merged in; otherwise the cards show
// a zero/— value so the dashboard layout is always visible.
const DEFAULT_KPI_DEFS: { label: string; icon: LucideIcon; tone: Tone }[] = [
  { label: 'Total Revenue', icon: DollarSign, tone: 'success' },
  { label: 'Total Expenses', icon: Wallet, tone: 'danger' },
  { label: 'Gross Profit', icon: TrendingUp, tone: 'info' },
  { label: 'Operating Profit', icon: Activity, tone: 'info' },
  { label: 'Net Profit', icon: Banknote, tone: 'success' },
  { label: 'EBITDA', icon: Building2, tone: 'accent' },
  { label: 'Cash Position', icon: Wallet, tone: 'success' },
  { label: 'Bank Balance', icon: Banknote, tone: 'info' },
  { label: 'AR Aging (0-30)', icon: Wallet, tone: 'info' },
  { label: 'AP Aging (0-30)', icon: Wallet, tone: 'danger' },
  { label: 'Daily Cash Flow', icon: TrendingUp, tone: 'success' },
  { label: 'Budget vs Actual', icon: Activity, tone: 'warning' },
];

export default function FinanceDashboard() {
  const { currentPropertyId, addNotification } = useERP();
  const [snapshot, setSnapshot] = useState<FinDashboardSnapshotFE | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState<'mtd' | 'ytd' | 'custom'>('mtd');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFinanceDashboard({ propertyId: currentPropertyId || undefined });
      setSnapshot(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      // Keep the UI rendered with empty state — don't blank out the page.
      setSnapshot(prev => prev ?? EMPTY_SNAPSHOT);
      addNotification(err.message || 'No finance dashboard snapshot found — showing empty state', 'warning', 'Finance');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    addNotification('Dashboard refreshed', 'success', 'Finance');
  };

  const kpiTiles = useMemo(() => snapshot?.kpis || [], [snapshot]);
  // Merge DB KPIs over the default definitions so StatCards always render.
  const mergedKpis = useMemo(() => {
    const byLabel = new Map(kpiTiles.map(k => [k.label, k]));
    return DEFAULT_KPI_DEFS.map(def => {
      const db = byLabel.get(def.label);
      return {
        label: def.label,
        value: db?.value ?? '—',
        trend: db?.trend,
        is_positive: db?.is_positive ?? true,
        icon: def.icon,
        tone: def.tone,
        change: db ? parseTrend(db.trend).change : undefined,
      };
    });
  }, [kpiTiles]);
  const trendData = useMemo(() => snapshot?.revenue_expense_trend || [], [snapshot]);
  const deptData = useMemo(() => snapshot?.dept_revenue || [], [snapshot]);
  const arAging = useMemo(() => snapshot?.ar_aging || [], [snapshot]);
  const alerts = useMemo(() => snapshot?.alerts || [], [snapshot]);
  const bankAccounts = useMemo(() => snapshot?.bank_accounts || [], [snapshot]);
  const ratios = useMemo(() => snapshot?.ratios || [], [snapshot]);

  const totalAr = useMemo(() => arAging.reduce((sum, b) => sum + (b.amount || 0), 0), [arAging]);
  const maxAr = useMemo(() => Math.max(...arAging.map(b => b.amount || 0), 1), [arAging]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Dashboard"
        subtitle="Financial performance, cash position, AR aging, and operational alerts"
        icon={Landmark}
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="hidden sm:block text-xs text-gray-500 dark:text-gray-400">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            >
              <option value="mtd">Month to Date</option>
              <option value="ytd">Year to Date</option>
              <option value="custom">Custom</option>
            </select>
            {dateRange === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
                />
                <span className="text-xs text-gray-500">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
                />
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 text-sm font-medium transition disabled:opacity-50"
            >
              {refreshing || loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
        }
      />

      {loading && !snapshot ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-10 h-10 animate-spin text-[var(--color-accent-operations)]" />
        </div>
      ) : (
        <>
          {/* KPI grid — always renders StatCards, even with zero data */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {mergedKpis.map((kpi, i) => (
              <StatCard
                key={i}
                title={kpi.label}
                value={kpi.value}
                icon={kpi.icon}
                tone={kpi.tone}
                change={kpi.change}
                changeLabel="vs prior period"
              />
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <SectionCard
              title="Revenue & Expense Trend"
              subtitle="First Half Year Analysis"
              icon={TrendingUp}
              tone="info"
              className="lg:col-span-8"
              pad="md"
            >
              <div className="h-72 w-full">
                {trendData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                    No revenue/expense trend data available.
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={10} fontWeight={700} tick={{ fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} fontSize={10} fontWeight={700} tick={{ fill: '#94a3b8' }} tickFormatter={(v) => `$${Number(v) / 1000}k`} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                    <Area type="monotone" dataKey="expense" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="5 5" fill="none" />
                  </AreaChart>
                </ResponsiveContainer>
                )}
              </div>
              <div className="flex items-center gap-4 mt-4">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" /> Revenue
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" /> Expenses
                </span>
              </div>
            </SectionCard>

            <SectionCard
              title="Revenue by Dept."
              subtitle="Department Mix"
              icon={Building2}
              tone="accent"
              className="lg:col-span-4"
              pad="md"
            >
              <div className="h-64 w-full">
                {deptData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                    No department revenue data available.
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={deptData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value">
                      {deptData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
                )}
              </div>
              <div className="space-y-2 mt-4">
                {deptData.map((dept, i) => (
                  <div key={i} className="flex justify-between items-center text-[10px] font-bold">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dept.color }} />
                      <span className="text-slate-500">{dept.name}</span>
                    </div>
                    <span className="text-slate-900 dark:text-white">${Number(dept.value).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* AR Aging */}
            <SectionCard
              title="AR Aging Buckets"
              subtitle={`Total Outstanding $${totalAr.toLocaleString()}`}
              icon={DollarSign}
              tone="info"
              className="lg:col-span-4"
              pad="md"
            >
              <div className="space-y-4">
                {arAging.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-400 dark:text-gray-500">
                    No AR aging data available.
                  </div>
                ) : (
                arAging.map((bucket, i) => {
                  const pct = (bucket.amount / maxAr) * 100;
                  return (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between items-end">
                        <span className="text-[10px] font-black text-slate-400 uppercase">{bucket.range}</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">${Number(bucket.amount).toLocaleString()}</span>
                      </div>
                      <div className="h-2 w-full bg-slate-50 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${i === 0 ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
                )}
              </div>
              <div className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl border border-indigo-100 dark:border-indigo-500/20">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-1">
                  <AlertCircle size={14} />
                  <span className="text-[10px] font-black uppercase">Outstanding Alert</span>
                </div>
                <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                  {totalAr > 100000
                    ? 'High outstanding AR — prioritize collection action on 60+ day buckets.'
                    : 'AR aging is within acceptable thresholds for the current period.'}
                </p>
              </div>
            </SectionCard>

            {/* Alerts */}
            <SectionCard
              title={`Financial Alerts (${alerts.length} Active)`}
              subtitle="Operational & Compliance Alerts"
              icon={AlertTriangle}
              tone="warning"
              className="lg:col-span-8"
              bodyClassName="max-h-[340px] overflow-y-auto"
            >
              {alerts.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500">
                  <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  No active alerts.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {alerts.map((alert, idx) => {
                    const AlertIcon = ICON_MAP[alert.icon] || Bell;
                    return (
                      <div key={idx} className={`p-3.5 rounded-2xl border ${alert.bg} ${alert.border} transition hover:scale-[1.02] cursor-pointer`}>
                        <div className="flex items-start gap-2.5">
                          <div className={`shrink-0 p-1.5 rounded-lg bg-white dark:bg-slate-900 ${alert.color}`}>
                            <AlertIcon size={14} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[9px] font-black uppercase tracking-widest ${alert.color}`}>{alert.type}</span>
                              <Badge tone={SEVERITY_TONE[alert.severity] || 'info'}>{alert.severity}</Badge>
                            </div>
                            <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">{alert.message}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Bank accounts & ratios */}
          <SectionCard
            title="Bank Accounts & Cash Position"
            subtitle="Liquidity snapshot"
            icon={Banknote}
            tone="success"
          >
            <div className="grid md:grid-cols-3 gap-4">
              {bankAccounts.length === 0 ? (
                <div className="col-span-full text-center py-6 text-sm text-gray-400 dark:text-gray-500">
                  No bank account data available.
                </div>
              ) : (
              bankAccounts.map((acc, i) => (
                <div key={i} className={`p-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border-l-[3px] ${acc.color}`}>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{acc.bank}</p>
                  <p className="text-[9px] text-slate-500 font-bold mb-3 uppercase tracking-tighter">{acc.acc} · {acc.type}</p>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white leading-none">{acc.bal}</h4>
                </div>
              ))
              )}
            </div>

            <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-8">
                {ratios.length === 0 ? (
                  <span className="text-sm text-gray-400 dark:text-gray-500">No ratio data available.</span>
                ) : (
                ratios.map((ratio, i) => (
                  <div key={i}>
                    <span className="text-[10px] font-black text-slate-400 uppercase block mb-1">{ratio.name}</span>
                    <span className={`text-sm font-black ${ratio.name === 'Current Ratio' ? 'text-emerald-500' : ratio.name === 'Burn Rate' ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>{ratio.value}</span>
                  </div>
                ))
                )}
              </div>
              <button className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase px-6 py-2.5 rounded-lg transition">
                Download Exec. Summary
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
