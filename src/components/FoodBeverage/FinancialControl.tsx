/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Financial Control module — F&B Portal.
 * Owns Revenue, COGS (with variance), Labor Cost, Discounts/Comps/Voids,
 * Waste, and Batch Production Costs.
 *
 * All data is persisted to the database via the /api/fb/financial-control/*
 * routes (see src/server/routes/fbFinancialControl.routes.ts).
 *
 * Finance remains the system of record for accounting; this module captures
 * operational financial data for analysis. Journal Entries and Reconciliation
 * (GL posting and POS-vs-GL matching) are Finance-portal functions and are
 * intentionally NOT exposed here — their backing tables/routes remain
 * available for the Finance portal to consume.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  Calculator,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Search,
  Plus,
  Download,
  RefreshCw,
  X,
  Percent,
  Utensils,
  Wine,
  Users,
  Ban,
  RotateCcw,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'sales' | 'cogs' | 'labor' | 'discounts' | 'waste' | 'production';
type ResourceType =
  | 'revenue' | 'cogs' | 'labor' | 'discounts' | 'waste' | 'production';

interface Outlet { id: string; name: string; type: string; }

interface RevenueRecord {
  id: string; outlet_id: string | null; record_date: string;
  category: 'food' | 'beverage' | 'other';
  gross_revenue: number; tax: number; net_revenue: number;
  covers: number; avg_check: number;
  outlets?: { name: string } | null;
}

interface COGSRecord {
  id: string; outlet_id: string | null; record_date: string;
  category: 'food' | 'beverage';
  actual_cost: number; theoretical_cost: number;
  variance: number; variance_percent: number; cost_percentage: number;
  outlets?: { name: string } | null;
}

interface LaborRecord {
  id: string; outlet_id: string | null; record_date: string;
  regular_hours: number; overtime_hours: number; total_hours: number;
  labor_cost: number; revenue: number; labor_percent: number;
  outlets?: { name: string } | null;
}

interface DiscountRecord {
  id: string; outlet_id: string | null; record_date: string;
  type: 'discount' | 'comp' | 'void';
  reason: string; amount: number; approved_by: string | null; reference: string | null;
  outlets?: { name: string } | null;
}

interface WasteRecord {
  id: string; outlet_id: string | null; record_date: string;
  type: 'preparation' | 'spoilage' | 'expired' | 'overproduction' | 'plate-waste' | 'breakage';
  item: string; quantity: number; unit: string; cost: number; reason: string | null;
  outlets?: { name: string } | null;
}

interface ProductionBatch {
  id: string; outlet_id: string | null; batch_date: string;
  batch_number: string; product: string; quantity: number; unit: string;
  raw_cost: number; labor_cost: number; overhead_cost: number;
  total_cost: number; unit_cost: number;
  status: 'draft' | 'completed' | 'transferred'; notes: string | null;
  outlets?: { name: string } | null;
}

const SUB_TABS: { id: SubTab; label: string; icon: typeof DollarSign }[] = [
  { id: 'sales', label: 'Revenue', icon: DollarSign },
  { id: 'cogs', label: 'COGS', icon: Calculator },
  { id: 'labor', label: 'Labor Cost', icon: Users },
  { id: 'discounts', label: 'Discounts/Comps/Voids', icon: Ban },
  { id: 'waste', label: 'Waste', icon: AlertTriangle },
  { id: 'production', label: 'Production', icon: TrendingUp },
];

const REV_CATEGORIES = ['food', 'beverage', 'other'] as const;
const COGS_CATEGORIES = ['food', 'beverage'] as const;
const DISCOUNT_TYPES = ['discount', 'comp', 'void'] as const;
const WASTE_TYPES = ['preparation', 'spoilage', 'expired', 'overproduction', 'plate-waste', 'breakage'] as const;
const PROD_STATUS = ['draft', 'completed', 'transferred'] as const;

const API = '/api/fb/financial-control';

export default function FinancialControl() {
  const { addNotification, formatAmount } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('sales');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newRecordResource, setNewRecordResource] = useState<ResourceType | null>(null);
  const [showNewRecordMenu, setShowNewRecordMenu] = useState(false);
  const [editing, setEditing] = useState<{ resource: ResourceType; row: any } | null>(null);
  const [saving, setSaving] = useState(false);

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [revenue, setRevenue] = useState<RevenueRecord[]>([]);
  const [cogs, setCogs] = useState<COGSRecord[]>([]);
  const [labor, setLabor] = useState<LaborRecord[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRecord[]>([]);
  const [waste, setWaste] = useState<WasteRecord[]>([]);
  const [production, setProduction] = useState<ProductionBatch[]>([]);
  const [summary, setSummary] = useState<any>(null);

  const [loadingOutlets, setLoadingOutlets] = useState(true);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [loadingSummary, setLoadingSummary] = useState(true);

  // ── API helper ───────────────────────────────────────────────────
  const apiCall = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.status === 204 ? null : r.json();
  };

  const fetchOutlets = useCallback(async () => {
    setLoadingOutlets(true);
    try {
      const r = await fetch(`${API}/outlets`, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setOutlets(await r.json());
    } catch { /* ignore */ } finally { setLoadingOutlets(false); }
  }, []);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const r = await fetch(`${API}/summary`, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setSummary(await r.json());
    } catch { /* ignore */ } finally { setLoadingSummary(false); }
  }, []);

  const fetchResource = useCallback(async (resource: ResourceType, setter: (a: any[]) => void) => {
    setLoading(s => ({ ...s, [resource]: true }));
    try {
      const r = await fetch(`${API}/${resource}`, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setter(await r.json());
      else addNotification(`Failed to load ${resource}`, 'warning', 'F&B');
    } catch {
      addNotification(`Failed to load ${resource}`, 'warning', 'F&B');
    } finally {
      setLoading(s => ({ ...s, [resource]: false }));
    }
  }, [addNotification]);

  const fetchRevenue = useCallback(() => fetchResource('revenue', setRevenue), [fetchResource]);
  const fetchCogs = useCallback(() => fetchResource('cogs', setCogs), [fetchResource]);
  const fetchLabor = useCallback(() => fetchResource('labor', setLabor), [fetchResource]);
  const fetchDiscounts = useCallback(() => fetchResource('discounts', setDiscounts), [fetchResource]);
  const fetchWaste = useCallback(() => fetchResource('waste', setWaste), [fetchResource]);
  const fetchProduction = useCallback(() => fetchResource('production', setProduction), [fetchResource]);

  useEffect(() => { fetchOutlets(); fetchSummary(); }, [fetchOutlets, fetchSummary]);

  // Load data for active sub-tab
  useEffect(() => {
    if (subTab === 'sales') fetchRevenue();
    if (subTab === 'cogs') fetchCogs();
    if (subTab === 'labor') fetchLabor();
    if (subTab === 'discounts') fetchDiscounts();
    if (subTab === 'waste') fetchWaste();
    if (subTab === 'production') fetchProduction();
  }, [subTab, fetchRevenue, fetchCogs, fetchLabor, fetchDiscounts, fetchWaste, fetchProduction]);

  const refreshAll = useCallback(() => {
    fetchOutlets(); fetchSummary();
    fetchRevenue(); fetchCogs(); fetchLabor(); fetchDiscounts();
    fetchWaste(); fetchProduction();
    addNotification('Financial data refreshed', 'info', 'F&B');
  }, [fetchOutlets, fetchSummary, fetchRevenue, fetchCogs, fetchLabor, fetchDiscounts, fetchWaste, fetchProduction, addNotification]);

  // ── CRUD ─────────────────────────────────────────────────────────
  const refetch = (resource: ResourceType) => {
    if (resource === 'revenue') fetchRevenue();
    if (resource === 'cogs') fetchCogs();
    if (resource === 'labor') fetchLabor();
    if (resource === 'discounts') fetchDiscounts();
    if (resource === 'waste') fetchWaste();
    if (resource === 'production') fetchProduction();
    fetchSummary();
  };

  const handleSave = async (resource: ResourceType, payload: any, id?: string) => {
    setSaving(true);
    try {
      await apiCall(id ? 'PUT' : 'POST', `/${resource}${id ? `/${id}` : ''}`, payload);
      addNotification(`${resource} ${id ? 'updated' : 'created'}`, 'success', 'F&B');
      setShowModal(false); setEditing(null); setNewRecordResource(null);
      refetch(resource);
    } catch (e: any) {
      addNotification(e.message || 'Save failed', 'danger', 'F&B');
    } finally { setSaving(false); }
  };

  const handleDelete = async (resource: ResourceType, id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    try {
      await apiCall('DELETE', `/${resource}/${id}`);
      addNotification(`${resource} deleted`, 'info', 'F&B');
      refetch(resource);
    } catch (e: any) {
      addNotification(e.message || 'Delete failed', 'danger', 'F&B');
    } finally { setSaving(false); }
  };

  // ── Derived stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = summary || {};
    return {
      totalRevenue: s.totalRevenue ?? 0,
      totalCogs: s.totalCogs ?? 0,
      grossMargin: s.grossMargin ?? 0,
      totalWaste: s.totalWaste ?? 0,
    };
  }, [summary]);

  // ── Filters ──────────────────────────────────────────────────────
  const q = searchTerm.toLowerCase();
  const fRevenue = revenue.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  const fCogs = cogs.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  const fLabor = labor.filter(r => (r.outlets?.name || '').toLowerCase().includes(q));
  const fDiscounts = discounts.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.reason.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  const fWaste = waste.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.item.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  const fProduction = production.filter(r =>
    (r.outlets?.name || '').toLowerCase().includes(q) || r.product.toLowerCase().includes(q) || r.batch_number.toLowerCase().includes(q));

  // "New Record" options per sub-tab
  const NEW_RECORD_OPTIONS: Record<SubTab, { resource: ResourceType; label: string }[]> = {
    'sales': [{ resource: 'revenue', label: 'Revenue Record' }],
    'cogs': [{ resource: 'cogs', label: 'COGS Record' }],
    'labor': [{ resource: 'labor', label: 'Labor Record' }],
    'discounts': [{ resource: 'discounts', label: 'Discount/Comp/Void' }],
    'waste': [{ resource: 'waste', label: 'Waste Record' }],
    'production': [{ resource: 'production', label: 'Production Batch' }],
  };
  const currentNewOptions = NEW_RECORD_OPTIONS[subTab] || [];

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="F&B Financial Control"
        subtitle="Operational financial data tracking — Revenue, COGS, Labor, Waste, Production, Journal Entries, and Reconciliation"
        icon={Wallet}
        subtitleNote="Finance remains the system of record for accounting"
        actions={
          <>
            <button onClick={refreshAll} className={button.secondary} disabled={saving}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={() => addNotification('Exporting financial data...', 'info', 'F&B')} className={button.secondary}>
              <Download className="w-4 h-4" /> Export
            </button>
            {currentNewOptions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowNewRecordMenu(v => !v)}
                  className={button.primary}
                  disabled={saving}
                >
                  <Plus className="w-4 h-4" /> New Record
                </button>
                {showNewRecordMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowNewRecordMenu(false)} />
                    <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1">
                      {currentNewOptions.map(opt => (
                        <button
                          key={opt.resource}
                          onClick={() => {
                            setNewRecordResource(opt.resource);
                            setEditing(null);
                            setShowModal(true);
                            setShowNewRecordMenu(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Revenue" value={loadingSummary ? '…' : formatAmount(stats.totalRevenue)} icon={DollarSign} tone="success" />
        <StatCard title="Total COGS" value={loadingSummary ? '…' : formatAmount(stats.totalCogs)} icon={Calculator} tone="warning" />
        <StatCard title="Gross Margin" value={loadingSummary ? '…' : `${stats.grossMargin}%`} icon={TrendingUp} tone="info" />
        <StatCard title="Waste Cost" value={loadingSummary ? '…' : formatAmount(stats.totalWaste)} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map((tab) => (
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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by outlet, item, reason, reference…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
      </div>

      {/* Content Area */}
      <div className="space-y-6">
        {subTab === 'sales' && (
          <SectionCard title="Revenue Tracking" subtitle="Track food and beverage revenue by outlet">
            {loading['revenue'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Category', 'Gross Revenue', 'Tax', 'Net Revenue', 'Covers', 'Avg Check', '']}
                empty={fRevenue.length === 0}
                emptyColSpan={9}
                rows={fRevenue.map(rec => [
                  fmtDate(rec.record_date),
                  rec.outlets?.name || '—',
                  <Badge tone={rec.category === 'food' ? 'success' : rec.category === 'beverage' ? 'info' : 'neutral'}>
                    {rec.category === 'food' ? <Utensils className="w-3 h-3 inline mr-1" /> : rec.category === 'beverage' ? <Wine className="w-3 h-3 inline mr-1" /> : null}
                    {rec.category}
                  </Badge>,
                  formatAmount(Number(rec.gross_revenue)),
                  formatAmount(Number(rec.tax)),
                  <span className="font-medium text-slate-900 dark:text-white">{formatAmount(Number(rec.net_revenue))}</span>,
                  rec.covers,
                  formatAmount(Number(rec.avg_check)),
                  <RowActions onEdit={() => { setEditing({ resource: 'revenue', row: rec }); setShowModal(true); }} onDelete={() => handleDelete('revenue', rec.id)} />,
                ])}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'cogs' && (
          <SectionCard title="Cost of Goods Sold" subtitle="Track food and beverage costs with variance analysis">
            {loading['cogs'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Category', 'Actual Cost', 'Theoretical', 'Variance', 'Variance %', 'Cost %', '']}
                empty={fCogs.length === 0}
                emptyColSpan={9}
                rows={fCogs.map(rec => {
                  const v = Number(rec.variance);
                  const vp = Number(rec.variance_percent);
                  return [
                    fmtDate(rec.record_date),
                    rec.outlets?.name || '—',
                    <Badge tone={rec.category === 'food' ? 'success' : 'info'}>{rec.category}</Badge>,
                    formatAmount(Number(rec.actual_cost)),
                    formatAmount(Number(rec.theoretical_cost)),
                    <span className={v > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                      {v > 0 ? '+' : ''}{formatAmount(v)}
                    </span>,
                    <Badge tone={vp > 5 ? 'danger' : vp > 0 ? 'warning' : 'success'}>
                      {vp > 0 ? '+' : ''}{vp}%
                    </Badge>,
                    <span className="font-medium text-slate-900 dark:text-white">{Number(rec.cost_percentage)}%</span>,
                    <RowActions onEdit={() => { setEditing({ resource: 'cogs', row: rec }); setShowModal(true); }} onDelete={() => handleDelete('cogs', rec.id)} />,
                  ];
                })}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'labor' && (
          <SectionCard title="Labor Cost" subtitle="Track labor costs and productivity by outlet">
            {loading['labor'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Regular Hrs', 'OT Hrs', 'Total Hrs', 'Labor Cost', 'Revenue', 'Labor %', '']}
                empty={fLabor.length === 0}
                emptyColSpan={9}
                rows={fLabor.map(rec => {
                  const lp = Number(rec.labor_percent);
                  return [
                    fmtDate(rec.record_date),
                    rec.outlets?.name || '—',
                    Number(rec.regular_hours),
                    Number(rec.overtime_hours),
                    <span className="font-medium text-slate-900 dark:text-white">{Number(rec.total_hours)}</span>,
                    formatAmount(Number(rec.labor_cost)),
                    formatAmount(Number(rec.revenue)),
                    <Badge tone={lp > 30 ? 'danger' : lp > 25 ? 'warning' : 'success'}>{lp}%</Badge>,
                    <RowActions onEdit={() => { setEditing({ resource: 'labor', row: rec }); setShowModal(true); }} onDelete={() => handleDelete('labor', rec.id)} />,
                  ];
                })}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'discounts' && (
          <SectionCard title="Discounts, Comps & Voids" subtitle="Track all revenue adjustments">
            {loading['discounts'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Type', 'Reason', 'Amount', 'Approved By', 'Reference', '']}
                empty={fDiscounts.length === 0}
                emptyColSpan={8}
                rows={fDiscounts.map(rec => [
                  fmtDate(rec.record_date),
                  rec.outlets?.name || '—',
                  <Badge tone={rec.type === 'discount' ? 'warning' : rec.type === 'comp' ? 'danger' : 'neutral'}>
                    {rec.type === 'discount' ? <Percent className="w-3 h-3 inline mr-1" /> : rec.type === 'comp' ? <Ban className="w-3 h-3 inline mr-1" /> : <RotateCcw className="w-3 h-3 inline mr-1" />}
                    {rec.type}
                  </Badge>,
                  rec.reason,
                  <span className="font-medium text-slate-900 dark:text-white">{formatAmount(Number(rec.amount))}</span>,
                  rec.approved_by || '—',
                  rec.reference || '—',
                  <RowActions onEdit={() => { setEditing({ resource: 'discounts', row: rec }); setShowModal(true); }} onDelete={() => handleDelete('discounts', rec.id)} />,
                ])}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'waste' && (
          <SectionCard title="Waste Cost" subtitle="Track waste, spoilage, and breakage costs">
            {loading['waste'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Type', 'Item', 'Quantity', 'Cost', 'Reason', '']}
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
                  <RowActions onEdit={() => { setEditing({ resource: 'waste', row: rec }); setShowModal(true); }} onDelete={() => handleDelete('waste', rec.id)} />,
                ])}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'production' && (
          <SectionCard title="Batch Production Costs" subtitle="Track production costs and inventory transfers">
            {loading['production'] ? <LoadingRow /> : (
              <DataTable
                headers={['Date', 'Outlet', 'Batch #', 'Product', 'Qty', 'Raw Cost', 'Labor', 'Overhead', 'Total Cost', 'Unit Cost', 'Status', '']}
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
                  <RowActions onEdit={() => { setEditing({ resource: 'production', row: rec }); setShowModal(true); }} onDelete={() => handleDelete('production', rec.id)} />,
                ])}
              />
            )}
          </SectionCard>
        )}
      </div>

      {/* Integration Status Panel */}
      <SectionCard title="Finance Integration Status" subtitle="F&B provides operational financial data to Finance" icon={Wallet}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">General Ledger</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Auto-posting enabled and synced</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">Tax Module</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Tax calculations integrated</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">Accounts Payable</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Supplier invoices linked</p>
          </div>
        </div>
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <strong>Note:</strong> Finance remains the system of record for accounting. F&B provides operational financial data for reconciliation and analysis.
          </p>
        </div>
      </SectionCard>

      {showModal && newRecordResource && (
        <FinancialModal
          resource={newRecordResource}
          editing={editing}
          outlets={outlets}
          loadingOutlets={loadingOutlets}
          saving={saving}
          onClose={() => { setShowModal(false); setEditing(null); setNewRecordResource(null); }}
          onSave={handleSave}
        />
      )}
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

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="inline-flex gap-2">
      <button onClick={onEdit} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
      <button onClick={onDelete} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
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

// ── Modal ──────────────────────────────────────────────────────────
function FinancialModal({
  resource, editing, outlets, loadingOutlets, saving, onClose, onSave,
}: {
  resource: ResourceType;
  editing: { resource: ResourceType; row: any } | null;
  outlets: Outlet[];
  loadingOutlets: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (resource: ResourceType, payload: any, id?: string) => void;
}) {
  const row = editing?.row;
  const isEdit = !!row;
  const [outletId, setOutletId] = useState<string>(row?.outlet_id || '');

  // Shared date field — different name per resource
  const dateField = row?.record_date || row?.batch_date || '';
  const [recordDate, setRecordDate] = useState<string>(dateField ? dateField.slice(0, 10) : new Date().toISOString().slice(0, 10));

  // Revenue
  const [revCategory, setRevCategory] = useState<string>(row?.category || 'food');
  const [grossRevenue, setGrossRevenue] = useState<number>(Number(row?.gross_revenue ?? 0));
  const [tax, setTax] = useState<number>(Number(row?.tax ?? 0));
  const [covers, setCovers] = useState<number>(Number(row?.covers ?? 0));

  // COGS
  const [cogsCategory, setCogsCategory] = useState<string>(row?.category || 'food');
  const [actualCost, setActualCost] = useState<number>(Number(row?.actual_cost ?? 0));
  const [theoreticalCost, setTheoreticalCost] = useState<number>(Number(row?.theoretical_cost ?? 0));
  const [costPercentage, setCostPercentage] = useState<number>(Number(row?.cost_percentage ?? 0));

  // Labor
  const [regularHours, setRegularHours] = useState<number>(Number(row?.regular_hours ?? 0));
  const [overtimeHours, setOvertimeHours] = useState<number>(Number(row?.overtime_hours ?? 0));
  const [laborCost, setLaborCost] = useState<number>(Number(row?.labor_cost ?? 0));
  const [laborRevenue, setLaborRevenue] = useState<number>(Number(row?.revenue ?? 0));

  // Discount
  const [discType, setDiscType] = useState<string>(row?.type || 'discount');
  const [reason, setReason] = useState<string>(row?.reason || '');
  const [amount, setAmount] = useState<number>(Number(row?.amount ?? 0));
  const [approvedBy, setApprovedBy] = useState<string>(row?.approved_by || '');
  const [reference, setReference] = useState<string>(row?.reference || '');

  // Waste
  const [wasteType, setWasteType] = useState<string>(row?.type || 'preparation');
  const [item, setItem] = useState<string>(row?.item || '');
  const [quantity, setQuantity] = useState<number>(Number(row?.quantity ?? 0));
  const [unit, setUnit] = useState<string>(row?.unit || 'kg');
  const [wasteCost, setWasteCost] = useState<number>(Number(row?.cost ?? 0));
  const [wasteReason, setWasteReason] = useState<string>(row?.reason || '');

  // Production
  const [batchNumber, setBatchNumber] = useState<string>(row?.batch_number || '');
  const [product, setProduct] = useState<string>(row?.product || '');
  const [prodUnit, setProdUnit] = useState<string>(row?.unit || 'kg');
  const [rawCost, setRawCost] = useState<number>(Number(row?.raw_cost ?? 0));
  const [prodLaborCost, setProdLaborCost] = useState<number>(Number(row?.labor_cost ?? 0));
  const [overheadCost, setOverheadCost] = useState<number>(Number(row?.overhead_cost ?? 0));
  const [prodStatus, setProdStatus] = useState<string>(row?.status || 'draft');
  const [prodNotes, setProdNotes] = useState<string>(row?.notes || '');

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  const submit = () => {
    const base: any = { outlet_id: outletId || null };
    let payload: any;

    if (resource === 'revenue') {
      const net = grossRevenue - tax;
      payload = {
        ...base, record_date: recordDate, category: revCategory,
        gross_revenue: grossRevenue, tax, net_revenue: net,
        covers, avg_check: covers > 0 ? Number((net / covers).toFixed(2)) : 0,
      };
    } else if (resource === 'cogs') {
      const variance = actualCost - theoreticalCost;
      const variancePercent = theoreticalCost > 0 ? Number(((variance / theoreticalCost) * 100).toFixed(2)) : 0;
      payload = {
        ...base, record_date: recordDate, category: cogsCategory,
        actual_cost: actualCost, theoretical_cost: theoreticalCost,
        variance, variance_percent: variancePercent, cost_percentage: costPercentage,
      };
    } else if (resource === 'labor') {
      const totalHours = regularHours + overtimeHours;
      const laborPercent = laborRevenue > 0 ? Number(((laborCost / laborRevenue) * 100).toFixed(2)) : 0;
      payload = {
        ...base, record_date: recordDate,
        regular_hours: regularHours, overtime_hours: overtimeHours, total_hours: totalHours,
        labor_cost: laborCost, revenue: laborRevenue, labor_percent: laborPercent,
      };
    } else if (resource === 'discounts') {
      if (!reason) return alert('Reason is required');
      payload = {
        ...base, record_date: recordDate, type: discType, reason,
        amount, approved_by: approvedBy || null, reference: reference || null,
      };
    } else if (resource === 'waste') {
      if (!item) return alert('Item is required');
      payload = {
        ...base, record_date: recordDate, type: wasteType, item,
        quantity, unit, cost: wasteCost, reason: wasteReason || null,
      };
    } else if (resource === 'production') {
      if (!batchNumber || !product) return alert('Batch number and product are required');
      const total = rawCost + prodLaborCost + overheadCost;
      const unitCost = quantity > 0 ? Number((total / quantity).toFixed(2)) : 0;
      payload = {
        ...base, batch_date: recordDate, batch_number: batchNumber, product,
        quantity, unit: prodUnit, raw_cost: rawCost, labor_cost: prodLaborCost,
        overhead_cost: overheadCost, total_cost: total, unit_cost: unitCost,
        status: prodStatus, notes: prodNotes || null,
      };
    }
    onSave(resource, payload, isEdit ? row.id : undefined);
  };

  const titleMap: Record<ResourceType, string> = {
    'revenue': 'Revenue Record',
    'cogs': 'COGS Record',
    'labor': 'Labor Record',
    'discounts': 'Discount/Comp/Void',
    'waste': 'Waste Record',
    'production': 'Production Batch',
  };

  const dateLabel: Record<ResourceType, string> = {
    'revenue': 'Record Date', 'cogs': 'Record Date', 'labor': 'Record Date',
    'discounts': 'Record Date', 'waste': 'Record Date', 'production': 'Batch Date',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit' : 'New'} {titleMap[resource]}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {/* Outlet picker — all resources */}
          <div>
            <label className={labelCls}>Outlet</label>
            {loadingOutlets ? (
              <div className="text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading outlets…</div>
            ) : (
              <select className={inputCls} value={outletId} onChange={e => setOutletId(e.target.value)}>
                <option value="">— None —</option>
                {outlets.map(o => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
              </select>
            )}
          </div>

          <div>
            <label className={labelCls}>{dateLabel[resource]}</label>
            <input type="date" className={inputCls} value={recordDate} onChange={e => setRecordDate(e.target.value)} />
          </div>

          {resource === 'revenue' && (
            <>
              <div><label className={labelCls}>Category</label>
                <select className={inputCls} value={revCategory} onChange={e => setRevCategory(e.target.value)}>
                  {REV_CATEGORIES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Gross Revenue</label><input type="number" step="0.01" className={inputCls} value={grossRevenue} onChange={e => setGrossRevenue(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Tax</label><input type="number" step="0.01" className={inputCls} value={tax} onChange={e => setTax(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Covers</label><input type="number" className={inputCls} value={covers} onChange={e => setCovers(Number(e.target.value))} /></div>
            </>
          )}

          {resource === 'cogs' && (
            <>
              <div><label className={labelCls}>Category</label>
                <select className={inputCls} value={cogsCategory} onChange={e => setCogsCategory(e.target.value)}>
                  {COGS_CATEGORIES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Actual Cost</label><input type="number" step="0.01" className={inputCls} value={actualCost} onChange={e => setActualCost(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Theoretical Cost</label><input type="number" step="0.01" className={inputCls} value={theoreticalCost} onChange={e => setTheoreticalCost(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Cost %</label><input type="number" step="0.01" className={inputCls} value={costPercentage} onChange={e => setCostPercentage(Number(e.target.value))} /></div>
            </>
          )}

          {resource === 'labor' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Regular Hours</label><input type="number" step="0.01" className={inputCls} value={regularHours} onChange={e => setRegularHours(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Overtime Hours</label><input type="number" step="0.01" className={inputCls} value={overtimeHours} onChange={e => setOvertimeHours(Number(e.target.value))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Labor Cost</label><input type="number" step="0.01" className={inputCls} value={laborCost} onChange={e => setLaborCost(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Revenue</label><input type="number" step="0.01" className={inputCls} value={laborRevenue} onChange={e => setLaborRevenue(Number(e.target.value))} /></div>
              </div>
            </>
          )}

          {resource === 'discounts' && (
            <>
              <div><label className={labelCls}>Type</label>
                <select className={inputCls} value={discType} onChange={e => setDiscType(e.target.value)}>
                  {DISCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Reason</label><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></div>
              <div><label className={labelCls}>Amount</label><input type="number" step="0.01" className={inputCls} value={amount} onChange={e => setAmount(Number(e.target.value))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Approved By</label><input className={inputCls} value={approvedBy} onChange={e => setApprovedBy(e.target.value)} /></div>
                <div><label className={labelCls}>Reference</label><input className={inputCls} value={reference} onChange={e => setReference(e.target.value)} /></div>
              </div>
            </>
          )}

          {resource === 'waste' && (
            <>
              <div><label className={labelCls}>Type</label>
                <select className={inputCls} value={wasteType} onChange={e => setWasteType(e.target.value)}>
                  {WASTE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Item</label><input className={inputCls} value={item} onChange={e => setItem(e.target.value)} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Quantity</label><input type="number" step="0.01" className={inputCls} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Unit</label><input className={inputCls} value={unit} onChange={e => setUnit(e.target.value)} /></div>
                <div><label className={labelCls}>Cost</label><input type="number" step="0.01" className={inputCls} value={wasteCost} onChange={e => setWasteCost(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Reason</label><input className={inputCls} value={wasteReason} onChange={e => setWasteReason(e.target.value)} /></div>
            </>
          )}

          {resource === 'production' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Batch Number</label><input className={inputCls} value={batchNumber} onChange={e => setBatchNumber(e.target.value)} /></div>
                <div><label className={labelCls}>Status</label>
                  <select className={inputCls} value={prodStatus} onChange={e => setProdStatus(e.target.value)}>
                    {PROD_STATUS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelCls}>Product</label><input className={inputCls} value={product} onChange={e => setProduct(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Quantity</label><input type="number" step="0.01" className={inputCls} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Unit</label><input className={inputCls} value={prodUnit} onChange={e => setProdUnit(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Raw Cost</label><input type="number" step="0.01" className={inputCls} value={rawCost} onChange={e => setRawCost(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Labor Cost</label><input type="number" step="0.01" className={inputCls} value={prodLaborCost} onChange={e => setProdLaborCost(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Overhead</label><input type="number" step="0.01" className={inputCls} value={overheadCost} onChange={e => setOverheadCost(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Notes</label><textarea className={inputCls} value={prodNotes} onChange={e => setProdNotes(e.target.value)} rows={2} /></div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={submit} disabled={saving} className={button.primary + ' flex-1'}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isEdit ? 'Update' : 'Create'}
            </button>
            <button onClick={onClose} className={button.secondary}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
