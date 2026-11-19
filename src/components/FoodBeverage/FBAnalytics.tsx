/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Analytics module — F&B Portal.
 * Owns Outlet Analytics, Menu Analytics, Kitchen Analytics, and Cost Analytics.
 * Per spec §28 (F&B Analytics).
 *
 * All data is served from pre-aggregated snapshot tables via the
 * /api/fb/analytics/* routes (see src/server/routes/fbAnalytics.routes.ts).
 * The Today / MTD / YTD period toggle fetches the matching snapshot.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  PieChart,
  Store,
  ChefHat,
  DollarSign,
  Percent,
  Users,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type AnalyticsTab = 'outlet' | 'menu' | 'kitchen' | 'cost';
type Period = 'Today' | 'MTD' | 'YTD';

interface OutletMetric {
  id: string;
  outlet_id: string | null;
  period: Period;
  revenue: number;
  covers: number;
  avg_check: number;
  rev_pash: number;
  occupancy: number;
  turnover: number;
  change_percent: number;
  outlets?: { name: string; type: string } | null;
}

interface MenuMetric {
  id: string;
  menu_item_id: string | null;
  outlet_id: string | null;
  period: Period;
  item_name: string;
  category: string;
  sold: number;
  price: number;
  cost: number;
  margin: number;
  food_cost_pct: number;
  classification: 'Star' | 'Plow Horse' | 'Puzzle' | 'Dog';
  outlets?: { name: string } | null;
}

interface KitchenMetric {
  id: string;
  outlet_id: string | null;
  period: Period;
  station: string;
  avg_ticket_time_min: number;
  volume: number;
  accuracy: number;
  downtime_min: number;
  outlets?: { name: string } | null;
}

interface CostMetric {
  id: string;
  outlet_id: string | null;
  period: Period;
  food_cost_pct: number;
  bev_cost_pct: number;
  waste: number;
  variance: number;
  theoretical: number;
  actual: number;
  outlets?: { name: string } | null;
}

interface Summary {
  period: Period;
  totalRevenue: number;
  totalCovers: number;
  avgChange: number;
  avgFoodCost: number;
  avgBevCost: number;
  totalWaste: number;
  outletCount: number;
}

const TABS: { id: AnalyticsTab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'outlet', label: 'Outlet Analytics', icon: Store },
  { id: 'menu', label: 'Menu Analytics', icon: PieChart },
  { id: 'kitchen', label: 'Kitchen Analytics', icon: ChefHat },
  { id: 'cost', label: 'Cost Analytics', icon: DollarSign },
];

const CLASS_TONE: Record<MenuMetric['classification'], 'success' | 'info' | 'warning' | 'neutral'> = {
  Star: 'success',
  'Plow Horse': 'info',
  Puzzle: 'warning',
  Dog: 'neutral',
};

const API = '/api/fb/analytics';

export default function FBAnalytics() {
  const { addNotification, formatAmount } = useERP();
  const [tab, setTab] = useState<AnalyticsTab>('outlet');
  const [period, setPeriod] = useState<Period>('MTD');

  const [outlets, setOutlets] = useState<OutletMetric[]>([]);
  const [menu, setMenu] = useState<MenuMetric[]>([]);
  const [kitchen, setKitchen] = useState<KitchenMetric[]>([]);
  const [costs, setCosts] = useState<CostMetric[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [loadingOutlets, setLoadingOutlets] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [loadingKitchen, setLoadingKitchen] = useState(false);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ── API helper ───────────────────────────────────────────────────
  const apiGet = async (path: string) => {
    const r = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const fetchSummary = useCallback(async (p: Period) => {
    setLoadingSummary(true);
    try {
      const data = await apiGet(`/summary?period=${encodeURIComponent(p)}`);
      setSummary(data);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load analytics summary', 'warning', 'F&B');
    } finally { setLoadingSummary(false); }
  }, [addNotification]);

  const fetchOutlets = useCallback(async (p: Period) => {
    setLoadingOutlets(true);
    try {
      const data = await apiGet(`/outlet-analytics?period=${encodeURIComponent(p)}`);
      setOutlets(data);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load outlet analytics', 'warning', 'F&B');
    } finally { setLoadingOutlets(false); }
  }, [addNotification]);

  const fetchMenu = useCallback(async (p: Period) => {
    setLoadingMenu(true);
    try {
      const data = await apiGet(`/menu-engineering?period=${encodeURIComponent(p)}`);
      setMenu(data);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load menu analytics', 'warning', 'F&B');
    } finally { setLoadingMenu(false); }
  }, [addNotification]);

  const fetchKitchen = useCallback(async (p: Period) => {
    setLoadingKitchen(true);
    try {
      const data = await apiGet(`/kitchen-analytics?period=${encodeURIComponent(p)}`);
      setKitchen(data);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load kitchen analytics', 'warning', 'F&B');
    } finally { setLoadingKitchen(false); }
  }, [addNotification]);

  const fetchCosts = useCallback(async (p: Period) => {
    setLoadingCosts(true);
    try {
      const data = await apiGet(`/cost-analytics?period=${encodeURIComponent(p)}`);
      setCosts(data);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load cost analytics', 'warning', 'F&B');
    } finally { setLoadingCosts(false); }
  }, [addNotification]);

  // Always load summary + the active tab's data when period changes
  useEffect(() => {
    fetchSummary(period);
    if (tab === 'outlet') fetchOutlets(period);
    if (tab === 'menu') fetchMenu(period);
    if (tab === 'kitchen') fetchKitchen(period);
    if (tab === 'cost') fetchCosts(period);
  }, [period, tab, fetchSummary, fetchOutlets, fetchMenu, fetchKitchen, fetchCosts]);

  const refreshAll = useCallback(() => {
    fetchSummary(period);
    fetchOutlets(period); fetchMenu(period); fetchKitchen(period); fetchCosts(period);
    addNotification('Analytics refreshed', 'info', 'F&B');
  }, [period, fetchSummary, fetchOutlets, fetchMenu, fetchKitchen, fetchCosts, addNotification]);

  // ── Derived KPIs from loaded summary ──────────────────────────────
  const kpis = useMemo(() => {
    const s = summary;
    return {
      totalRevenue: s?.totalRevenue ?? 0,
      totalCovers: s?.totalCovers ?? 0,
      avgFoodCost: s?.avgFoodCost ?? 0,
      avgBevCost: s?.avgBevCost ?? 0,
      avgChange: s?.avgChange ?? 0,
      totalWaste: s?.totalWaste ?? 0,
    };
  }, [summary]);

  const isLoading = loadingSummary || loadingOutlets || loadingMenu || loadingKitchen || loadingCosts;

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="F&B Analytics"
        subtitle="Outlet, menu, kitchen, and cost analytics for F&B management"
        icon={BarChart3}
        actions={
          <>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              {(['Today', 'MTD', 'YTD'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === p ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button onClick={refreshAll} className={button.secondary} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard
          title="Total Revenue"
          value={loadingSummary ? '…' : formatAmount(kpis.totalRevenue)}
          icon={TrendingUp}
          tone="accent"
          change={kpis.avgChange}
          changeLabel={`avg vs last period · ${period}`}
        />
        <StatCard
          title="Total Covers"
          value={loadingSummary ? '…' : kpis.totalCovers}
          icon={Users}
          tone="info"
          change={kpis.avgChange}
          changeLabel={`avg change · ${period}`}
        />
        <StatCard
          title="Avg Food Cost %"
          value={loadingSummary ? '…' : `${kpis.avgFoodCost}%`}
          icon={Percent}
          tone="warning"
          changeLabel={`period: ${period}`}
        />
        <StatCard
          title="Avg Bev Cost %"
          value={loadingSummary ? '…' : `${kpis.avgBevCost}%`}
          icon={DollarSign}
          tone="success"
          changeLabel={`period: ${period}`}
        />
      </div>

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              tab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Outlet Analytics */}
      {tab === 'outlet' && (
        <SectionCard title="Outlet Performance" icon={Store} tone="accent">
          {loadingOutlets ? <LoadingRow /> : outlets.length === 0 ? (
            <EmptyState label="No outlet analytics for this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Outlet</th>
                    <th className="px-6 py-3 font-medium">Revenue</th>
                    <th className="px-6 py-3 font-medium">Covers</th>
                    <th className="px-6 py-3 font-medium">Avg Check</th>
                    <th className="px-6 py-3 font-medium">RevPASH</th>
                    <th className="px-6 py-3 font-medium">Occupancy</th>
                    <th className="px-6 py-3 font-medium">Turnover</th>
                    <th className="px-6 py-3 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {outlets.map(o => (
                    <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">
                        {o.outlets?.name || '—'}
                        {o.outlets?.type && (
                          <span className="ml-2 text-xs text-slate-400">({o.outlets.type})</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(o.revenue))}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{o.covers}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(o.avg_check))}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(o.rev_pash) ? formatAmount(Number(o.rev_pash)) : '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(o.occupancy) ? `${o.occupancy}%` : '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(o.turnover) ? Number(o.turnover) : '—'}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-1">
                          {Number(o.change_percent) >= 0 ? <ArrowUpRight className="w-4 h-4 text-green-600" /> : <ArrowDownRight className="w-4 h-4 text-red-600" />}
                          <span className={Number(o.change_percent) >= 0 ? 'text-green-600' : 'text-red-600'}>{Math.abs(Number(o.change_percent))}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Menu Analytics */}
      {tab === 'menu' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SectionCard title="Menu Engineering" icon={PieChart} tone="info">
              {loadingMenu ? <LoadingRow /> : menu.length === 0 ? (
                <EmptyState label="No menu analytics for this period." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-medium">Item</th>
                        <th className="px-6 py-3 font-medium">Category</th>
                        <th className="px-6 py-3 font-medium">Sold</th>
                        <th className="px-6 py-3 font-medium">Price</th>
                        <th className="px-6 py-3 font-medium">Cost</th>
                        <th className="px-6 py-3 font-medium">Margin</th>
                        <th className="px-6 py-3 font-medium">Food Cost %</th>
                        <th className="px-6 py-3 font-medium">Class</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {menu.map(m => (
                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{m.item_name}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.category}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{m.sold}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(m.price))}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(m.cost))}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(m.margin))}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(m.food_cost_pct).toFixed(1)}%</td>
                          <td className="px-6 py-3"><Badge tone={CLASS_TONE[m.classification]}>{m.classification}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
          <div className="lg:col-span-1">
            <SectionCard title="Menu Engineering Matrix" icon={BarChart} tone="neutral">
              <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <p className="font-semibold text-green-800 dark:text-green-300">Star</p>
                  <p className="text-xs text-green-700 dark:text-green-400">High profit / High sales</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <p className="font-semibold text-blue-800 dark:text-blue-300">Plow Horse</p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">Low profit / High sales</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">Puzzle</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">High profit / Low sales</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">Dog</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Low profit / Low sales</p>
                </div>
              </div>
              <div className="px-4 pb-4 text-xs text-slate-500 dark:text-slate-400">
                Classification is computed from {menu.length} items in the {period} snapshot.
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {/* Kitchen Analytics */}
      {tab === 'kitchen' && (
        <SectionCard title="Kitchen Performance" icon={ChefHat} tone="warning">
          {loadingKitchen ? <LoadingRow /> : kitchen.length === 0 ? (
            <EmptyState label="No kitchen analytics for this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Outlet</th>
                    <th className="px-6 py-3 font-medium">Station</th>
                    <th className="px-6 py-3 font-medium">Avg Ticket Time</th>
                    <th className="px-6 py-3 font-medium">Volume</th>
                    <th className="px-6 py-3 font-medium">Order Accuracy</th>
                    <th className="px-6 py-3 font-medium">Downtime (min)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {kitchen.map(k => (
                    <tr key={k.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{k.outlets?.name || '—'}</td>
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{k.station}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400"><Clock className="w-3 h-3 inline mr-1" />{Number(k.avg_ticket_time_min).toFixed(1)} min</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{k.volume}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(k.accuracy).toFixed(1)}%</td>
                      <td className="px-6 py-3"><Badge tone={k.downtime_min > 0 ? 'danger' : 'success'}>{k.downtime_min} min</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Cost Analytics */}
      {tab === 'cost' && (
        <SectionCard title="Cost & Variance" icon={DollarSign} tone="success">
          {loadingCosts ? <LoadingRow /> : costs.length === 0 ? (
            <EmptyState label="No cost analytics for this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Outlet</th>
                    <th className="px-6 py-3 font-medium">Food Cost %</th>
                    <th className="px-6 py-3 font-medium">Bev Cost %</th>
                    <th className="px-6 py-3 font-medium">Waste</th>
                    <th className="px-6 py-3 font-medium">Theoretical</th>
                    <th className="px-6 py-3 font-medium">Actual</th>
                    <th className="px-6 py-3 font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {costs.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{c.outlets?.name || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(c.food_cost_pct).toFixed(1)}%</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{Number(c.bev_cost_pct).toFixed(1)}%</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(c.waste))}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(c.theoretical))}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{formatAmount(Number(c.actual))}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-1">
                          {Number(c.variance) >= 0 ? <ArrowUpRight className="w-4 h-4 text-red-600" /> : <ArrowDownRight className="w-4 h-4 text-green-600" />}
                          <span className={Number(c.variance) >= 0 ? 'text-red-600' : 'text-green-600'}>{Math.abs(Number(c.variance))}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl p-6 border border-indigo-200 dark:border-indigo-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          Analytics Notes
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          F&B analytics snapshots are sourced from the operational tables (POS, KDS, Inventory, and Finance).
          Switch the <strong>{period}</strong> period to compare Today, MTD, and YTD snapshots.
        </p>
      </div>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-4 py-10 text-center text-slate-400 text-sm">{label}</div>
  );
}
