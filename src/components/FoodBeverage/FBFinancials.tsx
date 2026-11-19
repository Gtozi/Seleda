/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Financials — consolidated F&B operational finance + analytics.
 *
 * 6 sub-tabs (redundant manual-entry tabs removed — revenue, COGS, labor,
 * and discounts live in POS, inventory, and HR respectively):
 *   1. Waste (sourced from inventory wastage_logs)
 *   2. Production (sourced from production coordination fb_batch_production)
 *   3. Outlet Analytics (analytics snapshot)
 *   4. Cost Analytics (analytics snapshot)
 *   5. Kitchen Analytics (analytics snapshot)
 *   6. Menu Engineering (analytics snapshot)
 *
 * Waste and Production are editable (CRUD) via /api/fb/financial-control/*.
 * Analytics tabs are read-only period snapshots via /api/fb/analytics/*.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet,
  AlertTriangle,
  Search,
  Download,
  RefreshCw,
  Percent,
  Users,
  Loader2,
  BarChart3,
  PieChart,
  Store,
  ChefHat,
  ArrowUpRight,
  ArrowDownRight,
  BarChart,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab =
  | 'waste' | 'production'
  | 'outlet-analytics' | 'cost-analytics' | 'kitchen-analytics' | 'menu-analytics';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';
type ResourceType = 'waste' | 'production';

interface WasteRecord {
  id: string; outlet_id: string | null; record_date: string;
  type: 'preparation' | 'spoilage' | 'expired' | 'overproduction' | 'plate-waste' | 'breakage';
  item: string; quantity: number; unit: string; cost: number; reason: string | null;
  wastage_log_id?: string | null;
  wastage_logs?: { id: string; ingredient_id: string; location_id: string; logged_by: string | null; approved_by: string | null; notes: string | null } | null;
  outlets?: { name: string } | null;
}

interface ProductionBatch {
  id: string; outlet_id: string | null; batch_date: string;
  batch_number: string; product: string; quantity: number; unit: string;
  raw_cost: number; labor_cost: number; overhead_cost: number;
  total_cost: number; unit_cost: number;
  status: 'draft' | 'completed' | 'transferred'; notes: string | null;
  batch_production_id?: string | null;
  fb_batch_production?: { id: string; name: string; batch_type: string; yield_qty: number; yield_unit: string; status: string } | null;
  outlets?: { name: string } | null;
}

interface OutletMetric {
  id: string; outlet_id: string | null; period: Period;
  revenue: number; covers: number; avg_check: number; rev_pash: number;
  occupancy: number; turnover: number; change_percent: number;
  outlets?: { name: string; type: string } | null;
}

interface MenuMetric {
  id: string; menu_item_id: string | null; outlet_id: string | null; period: Period;
  item_name: string; category: string; sold: number; price: number; cost: number;
  margin: number; food_cost_pct: number;
  classification: 'Star' | 'Plow Horse' | 'Puzzle' | 'Dog';
  outlets?: { name: string } | null;
}

interface KitchenMetric {
  id: string; outlet_id: string | null; period: Period;
  station: string; avg_ticket_time_min: number; volume: number;
  accuracy: number; downtime_min: number;
  outlets?: { name: string } | null;
}

interface CostMetric {
  id: string; outlet_id: string | null; period: Period;
  food_cost_pct: number; bev_cost_pct: number; waste: number;
  variance: number; theoretical: number; actual: number;
  outlets?: { name: string } | null;
}

interface AnalyticsSummary {
  period: Period; totalRevenue: number; totalCovers: number;
  avgChange: number; avgFoodCost: number; avgBevCost: number;
  totalWaste: number; outletCount: number;
}

interface FinancialSummary {
  totalWaste: number; totalProductionCost: number;
}

// ── Sub-tab registry ───────────────────────────────────────────────
const SUB_TABS: { id: SubTab; label: string; icon: typeof Wallet }[] = [
  { id: 'waste', label: 'Waste', icon: AlertTriangle },
  { id: 'production', label: 'Production', icon: TrendingUp },
  { id: 'outlet-analytics', label: 'Outlet Analytics', icon: Store },
  { id: 'cost-analytics', label: 'Cost Analytics', icon: BarChart3 },
  { id: 'kitchen-analytics', label: 'Kitchen Analytics', icon: ChefHat },
  { id: 'menu-analytics', label: 'Menu Engineering', icon: PieChart },
];

const ANALYTICS_TABS: SubTab[] = ['outlet-analytics', 'cost-analytics', 'kitchen-analytics', 'menu-analytics'];
const isAnalyticsTab = (id: SubTab) => ANALYTICS_TABS.includes(id);

const CLASS_TONE: Record<MenuMetric['classification'], 'success' | 'info' | 'warning' | 'neutral'> = {
  Star: 'success', 'Plow Horse': 'info', Puzzle: 'warning', Dog: 'neutral',
};

const FC_API = '/api/fb/financial-control';
const ANALYTICS_API = '/api/fb/analytics';

export default function FBFinancials() {
  const { addNotification, formatAmount } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('waste');
  const [searchTerm, setSearchTerm] = useState('');
  const [period, setPeriod] = useState<Period>('MTD');
  const [customStart, setCustomStart] = useState<string>(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState<string>(new Date().toISOString().slice(0, 10));

  // FC state
  const [waste, setWaste] = useState<WasteRecord[]>([]);
  const [production, setProduction] = useState<ProductionBatch[]>([]);
  const [fcSummary, setFcSummary] = useState<FinancialSummary | null>(null);

  // Analytics state
  const [outletMetrics, setOutletMetrics] = useState<OutletMetric[]>([]);
  const [menu, setMenu] = useState<MenuMetric[]>([]);
  const [kitchen, setKitchen] = useState<KitchenMetric[]>([]);
  const [costs, setCosts] = useState<CostMetric[]>([]);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);

  const [loadingFc, setLoadingFc] = useState<Record<string, boolean>>({});
  const [loadingAnalytics, setLoadingAnalytics] = useState<Record<string, boolean>>({});
  const [loadingFcSummary, setLoadingFcSummary] = useState(true);
  const [loadingAnalyticsSummary, setLoadingAnalyticsSummary] = useState(true);

  // ── API helpers ──────────────────────────────────────────────────
  const periodDateRange = useCallback((p: Period): { startDate?: string; endDate?: string } => {
    if (p === 'Custom') return { startDate: customStart, endDate: customEnd };
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (p === 'Today') return { startDate: today, endDate: today };
    if (p === 'WTD') {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      return { startDate: monday.toISOString().slice(0, 10), endDate: today };
    }
    if (p === 'MTD') {
      return { startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, endDate: today };
    }
    if (p === 'YTD') {
      return { startDate: `${now.getFullYear()}-01-01`, endDate: today };
    }
    return {};
  }, [customStart, customEnd]);

  const analyticsGet = async (path: string) => {
    const r = await fetch(`${ANALYTICS_API}${path}`, { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const fetchFcSummary = useCallback(async () => {
    setLoadingFcSummary(true);
    try {
      const r = await fetch(`${FC_API}/summary`, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setFcSummary(await r.json());
    } catch { /* ignore */ } finally { setLoadingFcSummary(false); }
  }, []);

  const fetchFcResource = useCallback(async (resource: ResourceType, setter: (a: any[]) => void, dateRange?: { startDate?: string; endDate?: string }) => {
    setLoadingFc(s => ({ ...s, [resource]: true }));
    try {
      let url = `${FC_API}/${resource}`;
      const params = new URLSearchParams();
      if (dateRange?.startDate) params.set('startDate', dateRange.startDate);
      if (dateRange?.endDate) params.set('endDate', dateRange.endDate);
      if (params.toString()) url += `?${params.toString()}`;
      const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setter(await r.json());
      else addNotification(`Failed to load ${resource}`, 'warning', 'F&B');
    } catch { addNotification(`Failed to load ${resource}`, 'warning', 'F&B'); }
    finally { setLoadingFc(s => ({ ...s, [resource]: false })); }
  }, [addNotification]);

  const fetchWaste = useCallback(() => fetchFcResource('waste', setWaste, periodDateRange(period)), [fetchFcResource, periodDateRange, period]);
  const fetchProduction = useCallback(() => fetchFcResource('production', setProduction, periodDateRange(period)), [fetchFcResource, periodDateRange, period]);

  const fetchAnalyticsSummary = useCallback(async (p: Period) => {
    setLoadingAnalyticsSummary(true);
    try { setAnalyticsSummary(await analyticsGet(`/summary?period=${encodeURIComponent(p)}`)); }
    catch (e: any) { addNotification(e.message || 'Failed to load analytics summary', 'warning', 'F&B'); }
    finally { setLoadingAnalyticsSummary(false); }
  }, [addNotification]);

  const fetchOutletMetrics = useCallback(async (p: Period) => {
    setLoadingAnalytics(s => ({ ...s, 'outlet-analytics': true }));
    try { setOutletMetrics(await analyticsGet(`/outlet-analytics?period=${encodeURIComponent(p)}`)); }
    catch (e: any) { addNotification(e.message || 'Failed to load outlet analytics', 'warning', 'F&B'); }
    finally { setLoadingAnalytics(s => ({ ...s, 'outlet-analytics': false })); }
  }, [addNotification]);

  const fetchMenu = useCallback(async (p: Period) => {
    setLoadingAnalytics(s => ({ ...s, 'menu-analytics': true }));
    try { setMenu(await analyticsGet(`/menu-engineering?period=${encodeURIComponent(p)}`)); }
    catch (e: any) { addNotification(e.message || 'Failed to load menu analytics', 'warning', 'F&B'); }
    finally { setLoadingAnalytics(s => ({ ...s, 'menu-analytics': false })); }
  }, [addNotification]);

  const fetchKitchen = useCallback(async (p: Period) => {
    setLoadingAnalytics(s => ({ ...s, 'kitchen-analytics': true }));
    try { setKitchen(await analyticsGet(`/kitchen-analytics?period=${encodeURIComponent(p)}`)); }
    catch (e: any) { addNotification(e.message || 'Failed to load kitchen analytics', 'warning', 'F&B'); }
    finally { setLoadingAnalytics(s => ({ ...s, 'kitchen-analytics': false })); }
  }, [addNotification]);

  const fetchCosts = useCallback(async (p: Period) => {
    setLoadingAnalytics(s => ({ ...s, 'cost-analytics': true }));
    try { setCosts(await analyticsGet(`/cost-analytics?period=${encodeURIComponent(p)}`)); }
    catch (e: any) { addNotification(e.message || 'Failed to load cost analytics', 'warning', 'F&B'); }
    finally { setLoadingAnalytics(s => ({ ...s, 'cost-analytics': false })); }
  }, [addNotification]);

  // ── Initial load ──────────────────────────────────────────────────
  useEffect(() => { fetchFcSummary(); fetchAnalyticsSummary(period); }, [fetchFcSummary, fetchAnalyticsSummary, period]);

  useEffect(() => {
    if (subTab === 'waste') fetchWaste();
    if (subTab === 'production') fetchProduction();
    if (subTab === 'outlet-analytics') fetchOutletMetrics(period);
    if (subTab === 'cost-analytics') fetchCosts(period);
    if (subTab === 'kitchen-analytics') fetchKitchen(period);
    if (subTab === 'menu-analytics') fetchMenu(period);
  }, [subTab, period, fetchWaste, fetchProduction, fetchOutletMetrics, fetchCosts, fetchKitchen, fetchMenu]);

  const refreshAll = useCallback(() => {
    fetchFcSummary(); fetchAnalyticsSummary(period);
    fetchWaste(); fetchProduction();
    fetchOutletMetrics(period); fetchCosts(period); fetchKitchen(period); fetchMenu(period);
    addNotification('Financial data refreshed', 'info', 'F&B');
  }, [fetchFcSummary, fetchAnalyticsSummary, period, fetchWaste, fetchProduction, fetchOutletMetrics, fetchCosts, fetchKitchen, fetchMenu, addNotification]);

  // ── Derived KPIs ──────────────────────────────────────────────────
  const fcStats = useMemo(() => {
    const s = fcSummary || {};
    return { totalWaste: s.totalWaste ?? 0, totalProductionCost: s.totalProductionCost ?? 0 };
  }, [fcSummary]);

  const aStats = useMemo(() => {
    const s = analyticsSummary;
    return {
      totalRevenue: s?.totalRevenue ?? 0, totalCovers: s?.totalCovers ?? 0,
      avgFoodCost: s?.avgFoodCost ?? 0, avgBevCost: s?.avgBevCost ?? 0,
      totalWaste: s?.totalWaste ?? 0,
    };
  }, [analyticsSummary]);

  // ── Filters ───────────────────────────────────────────────────────
  const q = searchTerm.toLowerCase();
  const fWaste = waste.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.item.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  const fProduction = production.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.product.toLowerCase().includes(q) || r.batch_number.toLowerCase().includes(q));

  const isLoadingAny = loadingFcSummary || loadingAnalyticsSummary || Object.values(loadingFc).some(Boolean) || Object.values(loadingAnalytics).some(Boolean);

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="F&B Financials"
        subtitle="Operational waste, production costs, and outlet/menu/kitchen/cost analytics"
        icon={Wallet}
        subtitleNote="Revenue, COGS, labor, and discounts come from POS, inventory, and HR"
        actions={
          <>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              {(['Today', 'WTD', 'MTD', 'YTD'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === p ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPeriod('Custom')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === 'Custom' ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                Custom
              </button>
            </div>
            {period === 'Custom' && (
              <div className="flex items-center gap-1 text-sm">
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-1.5 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                />
                <span className="text-slate-400">—</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-1.5 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                />
              </div>
            )}
            <button onClick={refreshAll} className={button.secondary} disabled={isLoadingAny}>
              <RefreshCw className={`w-4 h-4 ${isLoadingAny ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => addNotification('Exporting financial data...', 'info', 'F&B')} className={button.secondary}>
              <Download className="w-4 h-4" /> Export
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Waste Cost" value={loadingFcSummary ? '…' : formatAmount(fcStats.totalWaste)} icon={AlertTriangle} tone="danger" changeLabel={`period: ${period}`} />
        <StatCard title="Production Cost" value={loadingFcSummary ? '…' : formatAmount(fcStats.totalProductionCost)} icon={TrendingUp} tone="info" changeLabel={`period: ${period}`} />
        <StatCard title="Total Covers" value={loadingAnalyticsSummary ? '…' : aStats.totalCovers} icon={Users} tone="info" changeLabel={`period: ${period}`} />
        <StatCard title="Avg Food Cost %" value={loadingAnalyticsSummary ? '…' : `${aStats.avgFoodCost}%`} icon={Percent} tone="warning" changeLabel={`period: ${period}`} />
        <StatCard title="Avg Bev Cost %" value={loadingAnalyticsSummary ? '…' : `${aStats.avgBevCost}%`} icon={BarChart3} tone="success" changeLabel={`period: ${period}`} />
        <StatCard title="Analytics Waste" value={loadingAnalyticsSummary ? '…' : formatAmount(aStats.totalWaste)} icon={AlertTriangle} tone="accent" changeLabel={`period: ${period}`} />
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setSubTab(tab.id); setSearchTerm(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        ))}
      </div>

      {!isAnalyticsTab(subTab) && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by outlet, item, batch…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          />
        </div>
      )}

      {/* Content */}
      <div className="space-y-6">
        {subTab === 'waste' && (
          <SectionCard title="Waste Cost" subtitle="Waste records are sourced from inventory wastage logs">
            {loadingFc['waste'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Type', 'Item', 'Quantity', 'Cost', 'Reason', 'Source Log']}
                empty={fWaste.length === 0}
                emptyColSpan={8}
                rows={fWaste.map(rec => [
                  fmtDate(rec.record_date),
                  rec.outlets?.name || '—',
                  <Badge tone="danger">{rec.type}</Badge>,
                  <span className="font-medium text-slate-900 dark:text-white">{rec.item}</span>,
                  `${Number(rec.quantity)} ${rec.unit}`,
                  <span className="font-medium text-slate-900 dark:text-white">{formatAmount(Number(rec.cost))}</span>,
                  rec.reason || '—',
                  rec.wastage_log_id ? (
                    <span className="text-xs text-slate-500" title={rec.wastage_log_id}>Log {rec.wastage_log_id.slice(0, 8)}…</span>
                  ) : (
                    <span className="text-xs text-slate-400">Manual</span>
                  ),
                ])}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'production' && (
          <SectionCard title="Batch Production Costs" subtitle="Financial batches are sourced from production coordination">
            {loadingFc['production'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Batch #', 'Product', 'Qty', 'Raw Cost', 'Labor', 'Overhead', 'Total Cost', 'Unit Cost', 'Status', 'Source Batch']}
                empty={fProduction.length === 0}
                emptyColSpan={12}
                rows={fProduction.map(rec => [
                  fmtDate(rec.batch_date),
                  rec.outlets?.name || '—',
                  rec.batch_number,
                  <span className="font-medium text-slate-900 dark:text-white">{rec.product}</span>,
                  `${Number(rec.quantity)} ${rec.unit}`,
                  formatAmount(Number(rec.raw_cost)),
                  formatAmount(Number(rec.labor_cost)),
                  formatAmount(Number(rec.overhead_cost)),
                  <span className="font-medium text-slate-900 dark:text-white">{formatAmount(Number(rec.total_cost))}</span>,
                  formatAmount(Number(rec.unit_cost)),
                  <Badge tone={rec.status === 'completed' ? 'success' : rec.status === 'transferred' ? 'info' : 'warning'}>{rec.status}</Badge>,
                  rec.batch_production_id ? (
                    <span className="text-xs text-slate-500" title={rec.batch_production_id}>
                      {rec.fb_batch_production?.name || 'Batch'} {rec.fb_batch_production?.batch_type ? `(${rec.fb_batch_production.batch_type})` : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Manual</span>
                  ),
                ])}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'outlet-analytics' && (
          <SectionCard title="Outlet Performance" icon={Store} tone="accent">
            {loadingAnalytics['outlet-analytics'] ? <LoadingRow /> : outletMetrics.length === 0 ? (
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
                    {outletMetrics.map(o => (
                      <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">
                          {o.outlets?.name || '—'}
                          {o.outlets?.type && <span className="ml-2 text-xs text-slate-400">({o.outlets.type})</span>}
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

        {subTab === 'cost-analytics' && (
          <SectionCard title="Cost & Variance" icon={BarChart3} tone="success">
            {loadingAnalytics['cost-analytics'] ? <LoadingRow /> : costs.length === 0 ? (
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

        {subTab === 'kitchen-analytics' && (
          <SectionCard title="Kitchen Performance" icon={ChefHat} tone="warning">
            {loadingAnalytics['kitchen-analytics'] ? <LoadingRow /> : kitchen.length === 0 ? (
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

        {subTab === 'menu-analytics' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <SectionCard title="Menu Engineering" icon={PieChart} tone="info">
                {loadingAnalytics['menu-analytics'] ? <LoadingRow /> : menu.length === 0 ? (
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
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────
function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="px-4 py-10 text-center text-slate-400 text-sm">{label}</div>;
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: any[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-4 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-4 py-8 text-center text-slate-400">No records found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(s: string) {
  if (!s) return '—';
  return s.slice(0, 10);
}

