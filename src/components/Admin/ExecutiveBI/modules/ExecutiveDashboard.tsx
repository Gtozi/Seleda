/**
 * Executive Dashboard Module
 * Live headline KPIs across every hotel portal — all values computed
 * server-side from real tables via GET /api/executive/dashboard.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bed, DollarSign, TrendingUp, TrendingDown, Minus, Users, Utensils,
  Briefcase, Wrench, ShoppingCart, Shield, Sparkles, RefreshCw,
  Loader2, AlertCircle, Download, Search, ArrowRight,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { drillTargetFor } from '../../../../config/execDrilldown';
import {
  fetchExecDashboard,
  fetchExecApprovals,
  type ExecDashboardResponse,
  type ExecApprovalsResponse,
  type DashKpi,
  type ExecWindow,
} from '../../../../services/executiveService';
import { ExecPeriodSelector, windowLabel } from '../ExecPeriodSelector';

/** dashboard_views tile keys → /dashboard KPI ids where they differ. */
const LAYOUT_ID_ALIASES: Record<string, string> = {
  occupancy_rate: 'occupancy',
  turnover_rate: 'turnover',
  labor_cost_percent: 'labor_cost_pct',
  food_cost_percent: 'food_cost',
  open_work_orders: 'open_wos',
  pm_compliance_rate: 'pm_compliance',
  ooo_room_count: 'ooo_rooms',
};

const RANGE_TO_PERIOD: Record<string, ExecWindow> = { WTD: 'wtd', MTD: 'mtd', QTD: 'qtd', YTD: 'ytd' };

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(rate|percent|pct|count|time)$/, '');

const CATEGORY_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  financial:   { label: 'Financial',           icon: DollarSign,   color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  rooms:       { label: 'Rooms',               icon: Bed,          color: 'text-indigo-600',  bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
  guests:      { label: 'Guests',              icon: Users,        color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-500/10' },
  fb:          { label: 'Food & Beverage',     icon: Utensils,     color: 'text-orange-600',  bg: 'bg-orange-50 dark:bg-orange-500/10' },
  workforce:   { label: 'Workforce',           icon: Briefcase,    color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-500/10' },
  engineering: { label: 'Engineering & HK',    icon: Wrench,       color: 'text-teal-600',    bg: 'bg-teal-50 dark:bg-teal-500/10' },
  procurement: { label: 'Procurement & Inventory', icon: ShoppingCart, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-500/10' },
  security:    { label: 'Security',            icon: Shield,       color: 'text-rose-600',    bg: 'bg-rose-50 dark:bg-rose-500/10' },
  leisure:     { label: 'Leisure & Events',    icon: Sparkles,     color: 'text-cyan-600',    bg: 'bg-cyan-50 dark:bg-cyan-500/10' },
};
const CATEGORY_ORDER = ['financial', 'rooms', 'guests', 'fb', 'workforce', 'engineering', 'procurement', 'security', 'leisure'];

const ExecutiveDashboard = () => {
  const navigate = useNavigate();
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<ExecDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<ExecWindow>(30);
  const [search, setSearch] = useState('');
  const [approvals, setApprovals] = useState<ExecApprovalsResponse | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchExecDashboard(currentPropertyId, days));
      fetchExecApprovals(currentPropertyId).then(setApprovals).catch(() => setApprovals(null));
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentPropertyId, days]);

  const fmt = (k: DashKpi): string => {
    if (k.value === null) return '—';
    switch (k.unit) {
      case 'currency': return formatAmount(k.value);
      case '%': return `${k.value}%`;
      case '/5': return `${k.value.toFixed(1)}/5`;
      case 'days': return `${k.value} days`;
      case 'hrs': return `${k.value} hrs`;
      case 'min': return `${k.value} min`;
      case 'kWh': return `${formatAmount(k.value)} kWh`;
      case 'L': return `${formatAmount(k.value)} L`;
      case 't': return `${k.value} t`;
      default: return formatAmount(k.value);
    }
  };

  /** Real % change vs previous window; null when there's no comparison base. */
  const delta = (k: DashKpi): number | null => {
    if (k.value === null || k.previousValue === null || k.previousValue === 0) return null;
    return ((k.value - k.previousValue) / Math.abs(k.previousValue)) * 100;
  };

  // Role-based layout: KPIs present in the user's dashboard_views
  // tile_layout are promoted to the front, ordered by row/col.
  const layoutRank = useMemo(() => {
    const layout = data?.view?.tileLayout;
    if (!layout || !data) return null;
    const keys = Object.keys(layout).sort((a, b) =>
      (layout[a].row ?? 0) - (layout[b].row ?? 0) || (layout[a].col ?? 0) - (layout[b].col ?? 0));
    const rank = new Map<string, number>();
    for (const kpi of data.kpis) {
      const idx = keys.findIndex(k =>
        k === kpi.id || LAYOUT_ID_ALIASES[k] === kpi.id || normKey(k) === normKey(kpi.id));
      if (idx >= 0) rank.set(kpi.id, idx);
    }
    return rank;
  }, [data]);

  // Apply the view's default_date_range as the initial period once.
  const appliedDefaultRange = useRef(false);
  useEffect(() => {
    if (appliedDefaultRange.current || !data?.view?.defaultDateRange) return;
    const d = RANGE_TO_PERIOD[data.view.defaultDateRange];
    if (d && d !== days) {
      appliedDefaultRange.current = true;
      setDays(d);
    }
  }, [data?.view?.defaultDateRange]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const list = !q ? data.kpis : data.kpis.filter(k =>
      k.name.toLowerCase().includes(q) || k.source.toLowerCase().includes(q) ||
      (CATEGORY_META[k.category]?.label || k.category).toLowerCase().includes(q));
    if (!layoutRank) return list;
    return [...list].sort((a, b) =>
      (layoutRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (layoutRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [data, search, layoutRank]);

  const categories = CATEGORY_ORDER.filter(c => filtered.some(k => k.category === c));

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [
      ['KPI', 'Category', 'Source', 'Value', 'Previous', 'Unit', 'Delta %'],
      ...filtered.map(k => [
        k.name, CATEGORY_META[k.category]?.label || k.category, k.source,
        k.value === null ? '' : String(k.value),
        k.previousValue === null ? '' : String(k.previousValue),
        k.unit, delta(k) === null ? '' : delta(k)!.toFixed(1),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `executive-dashboard-${String(days)}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertCircle className="w-8 h-8 text-rose-500" />
        <p className="text-gray-600 dark:text-gray-400">{error || 'No data'}</p>
        <button onClick={load} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Executive Dashboard</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Live KPIs across all portals · {windowLabel(days)} · updated {new Date(data.generatedAt).toLocaleTimeString()}
            {data.view && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                {data.view.name}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search KPIs…"
              className="pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white" />
          </div>
          <ExecPeriodSelector value={days} onChange={setDays} />
          <button onClick={load} className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={exportCsv} className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          No KPIs match your search.
        </div>
      )}

      {approvals && approvals.summary.total > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <span className="w-1 h-6 bg-amber-500 rounded" />
              Pending Approvals
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {approvals.summary.total}
              </span>
              {approvals.summary.critical > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                  {approvals.summary.critical} urgent
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatAmount(approvals.summary.pendingAmount)} pending value
            </p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {approvals.items.slice(0, 8).map(item => (
              <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  item.urgency === 'critical' ? 'bg-rose-500'
                  : item.urgency === 'high' ? 'bg-orange-500'
                  : item.urgency === 'medium' ? 'bg-amber-400' : 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {item.source === 'operations' ? 'Operations' : item.source === 'finance' ? 'Finance' : 'Expense'}
                    {item.department ? ` · ${item.department}` : ''}
                    {item.requestedBy ? ` · ${item.requestedBy}` : ''}
                    {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                {item.amount !== null && (
                  <p className="text-sm font-semibold text-gray-900 dark:text-white shrink-0">
                    {formatAmount(item.amount)}
                  </p>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0 ${
                  item.status === 'escalated'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                  {item.status.replace('_', ' ')}
                </span>
                <button
                  onClick={() => navigate(item.drillPath)}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 shrink-0"
                >
                  Review
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          {approvals.items.length > 8 && (
            <div className="px-5 py-3 text-center text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700">
              + {approvals.items.length - 8} more — open the owning portal to action them
            </div>
          )}
        </div>
      )}

      {categories.map(category => {
        const meta = CATEGORY_META[category];
        return (
          <div key={category} className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <span className="w-1 h-6 bg-indigo-600 rounded" />
              {meta.label}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.filter(k => k.category === category).map(kpi => {
                const Icon = meta.icon;
                const d = delta(kpi);
                const improving = d === null ? null : kpi.lowerIsBetter ? d < 0 : d > 0;
                return (
                  <div key={kpi.id}
                    className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${meta.bg}`}>
                          <Icon className={`w-5 h-5 ${meta.color}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{kpi.name}</p>
                          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{fmt(kpi)}</p>
                        </div>
                      </div>
                      {d !== null && (
                        <div className={`flex items-center gap-1 text-sm ${
                          improving === null ? 'text-gray-500' : improving ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {d > 0 ? <TrendingUp className="w-4 h-4" /> : d < 0 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                          <span>{d > 0 ? '+' : ''}{d.toFixed(1)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Source: {kpi.source}</p>
                      {(() => {
                        const target = drillTargetFor(kpi.source);
                        if (!target) return kpi.detail && <p className="text-xs text-gray-400 dark:text-gray-500">{kpi.detail}</p>;
                        return (
                          <button
                            onClick={() => navigate(target.path)}
                            className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                          >
                            {target.label}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ExecutiveDashboard;
