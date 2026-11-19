/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SupplyProcurementModule — Engineering Supply & Procurement Coordination.
 *
 * Mirrors the HK SupplyProcurementModule pattern but for Engineering.
 * Replaces the old mock VendorContractorManagement component.
 *
 * Three tabs:
 *   - Replenishment Demand: spare_parts at/below reorder point
 *   - Purchase Requisitions: eng_purchase_orders dispatched to Procurement
 *   - Supplier Requirements: shared supplier master (fb_suppliers)
 *
 * Backed by /api/eng-portal/supply-procurement/* endpoints.
 */

import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  Package,
  Search,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  RefreshCw,
  Download,
  Truck,
  FileText,
  Building2,
  Clock,
  ArrowRight,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  Inbox,
  Plus,
  X,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { layout } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import {
  fetchEngForecast, fetchEngRequisitions, createEngRequisition,
  advanceEngPoStatus, receiveEngPo,
  fetchEngSuppliers, fetchEngProcurementStats,
  type EngForecastDemand, type EngPurchaseRequisition, type EngSupplierRequirement,
  type EngProcurementStats,
} from '../../services/engineeringService';

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function SupplyProcurementModule() {
  const { formatAmount, addNotification, currentPropertyId } = useERP();
  const [activeTab, setActiveTab] = useState<'forecast' | 'requisitions' | 'suppliers'>('forecast');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showRequisitionModal, setShowRequisitionModal] = useState(false);
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('all');
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);

  // Data state
  const [forecasts, setForecasts] = useState<EngForecastDemand[]>([]);
  const [requisitions, setRequisitions] = useState<EngPurchaseRequisition[]>([]);
  const [suppliers, setSuppliers] = useState<EngSupplierRequirement[]>([]);
  const [statsData, setStatsData] = useState<EngProcurementStats>({ openRequisitions: 0, pendingApproval: 0, activeSuppliers: 0, avgLeadTimeDays: 0 });

  // Requisition form
  const [requisitionForm, setRequisitionForm] = useState({
    supplierId: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    notes: '',
    items: [] as { itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string }[],
  });

  // ── Data loading ──────────────────────────────────────────────────────
  const fetchRequisitions = async () => {
    try {
      const params = new URLSearchParams();
      if (reqStatusFilter !== 'all') params.set('status', mapFilterToPoStatus(reqStatusFilter));
      if (currentPropertyId) params.set('propertyId', currentPropertyId);
      const qs = params.toString();
      const url = `/api/eng-portal/supply-procurement/requisitions${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (res.ok) setRequisitions(await res.json());
    } catch (err) {
      console.error('Error fetching requisitions:', err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const qs = currentPropertyId ? `?propertyId=${encodeURIComponent(currentPropertyId)}` : '';
      const [fcRes, reqRes, supRes, statsRes] = await Promise.all([
        fetch(`/api/eng-portal/supply-procurement/forecast${qs}`, { headers: authHeaders() }),
        fetch(`/api/eng-portal/supply-procurement/requisitions${qs}`, { headers: authHeaders() }),
        fetch('/api/eng-portal/supply-procurement/suppliers', { headers: authHeaders() }),
        fetch(`/api/eng-portal/supply-procurement/stats${qs}`, { headers: authHeaders() }),
      ]);
      if (fcRes.ok) setForecasts(await fcRes.json());
      if (reqRes.ok) setRequisitions(await reqRes.json());
      if (supRes.ok) setSuppliers(await supRes.json());
      if (statsRes.ok) setStatsData(await statsRes.json());
    } catch (error) {
      addNotification('Failed to load procurement data', 'warning', 'Maintenance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (!loading) fetchRequisitions(); /* eslint-disable-next-line */ }, [reqStatusFilter]);

  // Map UI status filter to PO status.
  const mapFilterToPoStatus = (filter: string): string => {
    switch (filter) {
      case 'draft': return 'draft';
      case 'submitted': return 'submitted';
      case 'approved': return 'acknowledged';
      case 'processing': return 'partial';
      case 'rejected': return 'cancelled';
      default: return '';
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────
  const submitRequisition = async () => {
    if (!currentPropertyId) { addNotification('No active property selected', 'warning', 'Maintenance'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/eng-portal/supply-procurement/requisitions', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          supplierId: requisitionForm.supplierId || null,
          priority: requisitionForm.priority,
          notes: requisitionForm.notes,
          items: requisitionForm.items,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create requisition');
      }
      const data = await res.json();
      addNotification(`Purchase requisition ${data.po_number} submitted to Procurement`, 'task', 'Maintenance');
      setShowRequisitionModal(false);
      setRequisitionForm({ supplierId: '', priority: 'medium', notes: '', items: [] });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to create requisition', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const createRequisitionFromForecast = (forecast: EngForecastDemand) => {
    setRequisitionForm({
      supplierId: '',
      priority: forecast.shortage > 100 ? 'urgent' : 'high',
      notes: `Replenishment for ${forecast.part_name} — shortage of ${forecast.shortage} ${forecast.unit}`,
      items: [{
        itemName: forecast.part_name,
        category: forecast.category,
        quantity: forecast.shortage,
        unit: forecast.unit,
        estimatedCost: forecast.unit_cost,
        requiredBy: '',
        reason: 'Replenishment demand',
      }],
    });
    setShowRequisitionModal(true);
  };

  const advancePoStatus = async (reqId: string, poNumber: string, currentStatus: string) => {
    const nextMap: Record<string, string> = {
      draft: 'submitted',
      submitted: 'acknowledged',
      acknowledged: 'received',
      partial: 'received',
      received: 'closed',
    };
    const next = nextMap[currentStatus];
    if (!next) return;
    try {
      const res = await fetch(`/api/eng-portal/supply-procurement/requisitions/${reqId}/status`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`PO ${poNumber} → ${next}`, 'task', 'Maintenance');
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to advance PO', 'warning', 'Maintenance');
    }
  };

  const receivePo = async (reqId: string, poNumber: string) => {
    try {
      const res = await fetch(`/api/eng-portal/supply-procurement/requisitions/${reqId}/receive`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      addNotification(`Goods received for ${poNumber} — ${data.fullyReceived ? 'fully received' : 'partial'}. ${data.transactionsLogged} restock tx logged.`, 'task', 'Maintenance');
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to process goods receipt', 'warning', 'Maintenance');
    }
  };

  const handleRefresh = () => {
    fetchData();
    addNotification('Procurement data refreshed', 'task', 'Maintenance');
  };

  // ── Derived data ──────────────────────────────────────────────────────
  const filteredForecasts = useMemo(() => {
    if (!searchTerm.trim()) return forecasts;
    const q = searchTerm.toLowerCase();
    return forecasts.filter((f) =>
      [f.part_name, f.part_number, f.category, f.supplier, f.requisition_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [forecasts, searchTerm]);

  const filteredRequisitions = useMemo(() => {
    if (!searchTerm.trim()) return requisitions;
    const q = searchTerm.toLowerCase();
    return requisitions.filter((r) =>
      [r.requisition_number, r.requested_by, r.department, r.notes, r.supplier_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [requisitions, searchTerm]);

  const filteredSuppliers = useMemo(() => {
    if (!searchTerm.trim()) return suppliers;
    const q = searchTerm.toLowerCase();
    return suppliers.filter((s) =>
      [s.supplier_name, s.category, s.item_name, s.payment_terms, s.supplier_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [suppliers, searchTerm]);

  const requisitionTotal = useMemo(
    () => requisitionForm.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimatedCost) || 0), 0),
    [requisitionForm.items]
  );

  const forecastTotals = useMemo(() => {
    const totalReorder = filteredForecasts.reduce((s, f) => s + f.reorder_qty, 0);
    const totalOnHand = filteredForecasts.reduce((s, f) => s + f.current_stock, 0);
    const totalShortage = filteredForecasts.reduce((s, f) => s + f.shortage, 0);
    const shortageRows = filteredForecasts.filter((f) => f.shortage > 0).length;
    return { totalReorder, totalOnHand, totalShortage, shortageRows };
  }, [filteredForecasts]);

  // ── Tab config + stats ────────────────────────────────────────────────
  const tabs = [
    { id: 'forecast' as const, label: 'Replenishment Demand', icon: TrendingUp, count: forecasts.length },
    { id: 'requisitions' as const, label: 'Purchase Requisitions', icon: FileText, count: requisitions.length },
    { id: 'suppliers' as const, label: 'Supplier Requirements', icon: Building2, count: suppliers.length },
  ];

  const stats = [
    { label: 'Open Requisitions', value: String(statsData.openRequisitions), change: '', icon: FileText, color: 'blue' },
    { label: 'Pending Approval', value: String(statsData.pendingApproval), change: '', icon: Clock, color: 'amber' },
    { label: 'Active Suppliers', value: String(statsData.activeSuppliers), change: '', icon: Building2, color: 'green' },
    { label: 'Avg Lead Time', value: `${statsData.avgLeadTimeDays} days`, change: '', icon: Truck, color: 'purple' },
  ];

  // ── CSV export ────────────────────────────────────────────────────────
  const exportCsv = () => {
    let headers: string[] = [];
    let rows: any[] = [];
    if (activeTab === 'forecast') {
      headers = ['Part Name', 'Part #', 'Category', 'Unit', 'On-Hand', 'Reorder Qty', 'Shortage', 'Unit Cost', 'Supplier', 'Requisition', 'Status'];
      rows = filteredForecasts.map((f) => [f.part_name, f.part_number, f.category, f.unit, f.current_stock, f.reorder_qty, f.shortage, f.unit_cost, f.supplier, f.requisition_id || '', f.requisition_status || '']);
    } else if (activeTab === 'requisitions') {
      headers = ['Requisition #', 'Requested By', 'Department', 'Priority', 'Items', 'Total Cost', 'Status', 'Supplier'];
      rows = filteredRequisitions.map((r) => [r.requisition_number, r.requested_by, r.department, r.priority, r.items.length, r.total_cost, r.status, r.supplier_name || '']);
    } else {
      headers = ['Supplier', 'Code', 'Category', 'Item', 'Min Order Qty', 'Unit', 'Lead Time (days)', 'Payment Terms', 'Status', 'Last Order'];
      rows = filteredSuppliers.map((s) => [s.supplier_name, s.supplier_id, s.category, s.item_name, s.minimum_order_qty, s.unit, s.lead_time_days, s.payment_terms, s.status, s.last_order_date || '']);
    }
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `eng-supply-procurement-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addNotification('CSV exported', 'task', 'Maintenance');
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className={layout.sectionStack}>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Engineering Supply & Procurement"
          subtitle="Generate replenishment demand and create purchase requisitions for procurement"
          icon={ShoppingCart}
        />
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            title={stat.label}
            value={stat.value}
            change={stat.change}
            icon={stat.icon}
            color={stat.color as any}
          />
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
              activeTab === tab.id
                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder={`Search ${activeTab === 'forecast' ? 'part, category, supplier...' : activeTab === 'requisitions' ? 'requisition #, supplier...' : 'supplier, category, item...'}`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-72"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
              Clear
            </button>
          )}
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Forecast Tab */}
          {activeTab === 'forecast' && (
            <SectionCard title="Replenishment Demand" subtitle="Spare parts at or below reorder point">
              {filteredForecasts.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Inbox className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{forecasts.length === 0 ? 'No replenishment demand — all parts above reorder point.' : 'No parts match your search.'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Part Name</th>
                        <th className="px-4 py-3 font-medium">Part #</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">On-Hand</th>
                        <th className="px-4 py-3 font-medium">Reorder Qty</th>
                        <th className="px-4 py-3 font-medium">Shortage</th>
                        <th className="px-4 py-3 font-medium">Unit Cost</th>
                        <th className="px-4 py-3 font-medium">Supplier</th>
                        <th className="px-4 py-3 font-medium">Requisition</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {filteredForecasts.map((forecast) => (
                        <tr key={forecast.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">{forecast.part_name}</td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs">{forecast.part_number || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{forecast.category}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{forecast.current_stock} {forecast.unit}</td>
                          <td className="px-4 py-3 text-slate-900 dark:text-white font-medium tabular-nums">{forecast.reorder_qty} {forecast.unit}</td>
                          <td className="px-4 py-3">
                            {forecast.shortage > 0 ? (
                              <span className="inline-flex items-center gap-1 text-red-600 font-medium tabular-nums">
                                <TrendingDown className="w-3.5 h-3.5" />
                                {forecast.shortage}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                OK
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{formatAmount(forecast.unit_cost)}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{forecast.supplier || '—'}</td>
                          <td className="px-4 py-3">
                            {forecast.requisition_status ? (
                              <Badge tone={forecast.requisition_status === 'approved' ? 'success' : forecast.requisition_status === 'submitted' ? 'warning' : 'neutral'}>
                                {forecast.requisition_status}
                              </Badge>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {forecast.shortage > 0 && !forecast.requisition_id && (
                              <button
                                onClick={() => createRequisitionFromForecast(forecast)}
                                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                              >
                                Create Requisition <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                            {forecast.shortage > 0 && forecast.requisition_id && (
                              <span className="text-xs text-slate-500 flex items-center gap-1">
                                {forecast.requisition_id}
                              </span>
                            )}
                            {forecast.shortage === 0 && (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 dark:bg-slate-900/40 font-medium text-slate-700 dark:text-slate-300">
                        <td className="px-4 py-3" colSpan={3}>Totals ({filteredForecasts.length} rows)</td>
                        <td className="px-4 py-3 tabular-nums">{forecastTotals.totalOnHand}</td>
                        <td className="px-4 py-3 tabular-nums">{forecastTotals.totalReorder}</td>
                        <td className="px-4 py-3 tabular-nums text-red-600">{forecastTotals.totalShortage > 0 ? `-${forecastTotals.totalShortage}` : '0'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500" colSpan={4}>{forecastTotals.shortageRows} shortage{forecastTotals.shortageRows === 1 ? '' : 's'}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </SectionCard>
          )}

          {/* Requisitions Tab */}
          {activeTab === 'requisitions' && (
            <SectionCard title="Purchase Requisitions" subtitle="Create and track purchase requisitions sent to Procurement">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <select
                    value={reqStatusFilter}
                    onChange={(e) => setReqStatusFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="submitted">Submitted</option>
                    <option value="approved">Approved</option>
                    <option value="processing">Processing</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <button
                  onClick={() => {
                    setRequisitionForm({ supplierId: '', priority: 'medium', notes: '', items: [] });
                    setShowRequisitionModal(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" /> New Requisition
                </button>
              </div>
              {filteredRequisitions.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Inbox className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{requisitions.length === 0 ? 'No purchase requisitions yet.' : 'No requisitions match your filters.'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium w-8"></th>
                        <th className="px-4 py-3 font-medium">Requisition #</th>
                        <th className="px-4 py-3 font-medium">Requested By</th>
                        <th className="px-4 py-3 font-medium">Priority</th>
                        <th className="px-4 py-3 font-medium">Items</th>
                        <th className="px-4 py-3 font-medium">Total Cost</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Supplier</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {filteredRequisitions.map((req) => {
                        const isExpanded = expandedReqId === req.id;
                        return (
                          <Fragment key={req.id}>
                            <tr
                              onClick={() => setExpandedReqId(isExpanded ? null : req.id)}
                              className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
                            >
                              <td className="px-4 py-3 text-slate-400">
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </td>
                              <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{req.requisition_number}</td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{req.requested_by}</td>
                              <td className="px-4 py-3">
                                <Badge tone={req.priority === 'urgent' ? 'danger' : req.priority === 'high' ? 'warning' : req.priority === 'medium' ? 'neutral' : 'success'}>
                                  {req.priority}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{req.items.length} items</td>
                              <td className="px-4 py-3 text-slate-900 dark:text-white font-medium tabular-nums">{formatAmount(req.total_cost)}</td>
                              <td className="px-4 py-3">
                                <Badge tone={req.status === 'approved' ? 'success' : req.status === 'submitted' ? 'warning' : req.status === 'processing' ? 'neutral' : req.status === 'rejected' ? 'danger' : 'neutral'}>
                                  {req.status}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                {req.supplier_name ? (
                                  <span className="text-indigo-600 font-medium">{req.supplier_name}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1.5">
                                  {req.po_status === 'draft' && (
                                    <button onClick={() => advancePoStatus(req.id, req.requisition_number, 'draft')} className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700" title="Submit to Procurement">Submit</button>
                                  )}
                                  {req.po_status === 'submitted' && (
                                    <button onClick={() => advancePoStatus(req.id, req.requisition_number, 'submitted')} className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700" title="Acknowledge">Acknowledge</button>
                                  )}
                                  {(req.po_status === 'acknowledged' || req.po_status === 'partial') && (
                                    <button onClick={() => receivePo(req.id, req.requisition_number)} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700" title="Receive goods into Engineering store">Receive</button>
                                  )}
                                  {req.po_status === 'received' && (
                                    <button onClick={() => advancePoStatus(req.id, req.requisition_number, 'received')} className="px-2 py-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300" title="Close PO">Close</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50 dark:bg-slate-900/30">
                                <td></td>
                                <td colSpan={8} className="px-4 py-4">
                                  <div className="space-y-3">
                                    {req.notes && (
                                      <div className="text-xs text-slate-600 dark:text-slate-400">
                                        <span className="font-medium">Notes:</span> {req.notes}
                                      </div>
                                    )}
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                      <table className="w-full text-xs">
                                        <thead className="bg-white dark:bg-slate-800 text-left text-slate-500">
                                          <tr>
                                            <th className="px-3 py-2 font-medium">Item</th>
                                            <th className="px-3 py-2 font-medium">Category</th>
                                            <th className="px-3 py-2 font-medium text-right">Qty</th>
                                            <th className="px-3 py-2 font-medium">Unit</th>
                                            <th className="px-3 py-2 font-medium text-right">Unit Cost</th>
                                            <th className="px-3 py-2 font-medium text-right">Line Total</th>
                                            <th className="px-3 py-2 font-medium">Required By</th>
                                            <th className="px-3 py-2 font-medium">Reason</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                          {req.items.map((item) => (
                                            <tr key={item.id}>
                                              <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{item.item_name}</td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.category}</td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-right tabular-nums">{item.requested_quantity}</td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.unit}</td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-right tabular-nums">{formatAmount(item.estimated_unit_cost)}</td>
                                              <td className="px-3 py-2 text-slate-900 dark:text-white text-right tabular-nums font-medium">{formatAmount(item.estimated_total)}</td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.required_by || '—'}</td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.reason || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot>
                                          <tr className="bg-white dark:bg-slate-800 font-medium">
                                            <td className="px-3 py-2 text-right text-slate-500" colSpan={5}>Total</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{formatAmount(req.total_cost)}</td>
                                            <td colSpan={2}></td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}

          {/* Suppliers Tab */}
          {activeTab === 'suppliers' && (
            <SectionCard title="Supplier Requirements" subtitle="View supplier requirements managed by Procurement">
              {filteredSuppliers.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Inbox className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{suppliers.length === 0 ? 'No suppliers available.' : 'No suppliers match your search.'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Supplier</th>
                        <th className="px-4 py-3 font-medium">Code</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Item</th>
                        <th className="px-4 py-3 font-medium">Min Order Qty</th>
                        <th className="px-4 py-3 font-medium">Lead Time</th>
                        <th className="px-4 py-3 font-medium">Payment Terms</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Last Order</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {filteredSuppliers.map((supplier) => (
                        <tr key={supplier.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{supplier.supplier_name}</td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs">{supplier.supplier_id}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{supplier.category}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{supplier.item_name}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{supplier.minimum_order_qty} {supplier.unit}</td>
                          <td className="px-4 py-3">
                            <span className={`tabular-nums ${supplier.lead_time_days <= 2 ? 'text-green-600' : supplier.lead_time_days <= 4 ? 'text-amber-600' : 'text-red-600'}`}>
                              {supplier.lead_time_days} days
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{supplier.payment_terms}</td>
                          <td className="px-4 py-3">
                            <Badge tone={supplier.status === 'active' ? 'success' : supplier.status === 'on-hold' ? 'warning' : 'neutral'}>
                              {supplier.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{supplier.last_order_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}

      {/* Requisition Modal */}
      {showRequisitionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">New Purchase Requisition</h2>
              <button onClick={() => setShowRequisitionModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Supplier</label>
                  <select
                    value={requisitionForm.supplierId}
                    onChange={(e) => setRequisitionForm(f => ({ ...f, supplierId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">— Select Supplier —</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.supplier_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
                  <select
                    value={requisitionForm.priority}
                    onChange={(e) => setRequisitionForm(f => ({ ...f, priority: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                  <input
                    value={requisitionForm.notes}
                    onChange={(e) => setRequisitionForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Items</label>
                  <button
                    onClick={() => setRequisitionForm(f => ({
                      ...f,
                      items: [...f.items, { itemName: '', category: 'Engineering', quantity: 1, unit: 'pcs', estimatedCost: 0, requiredBy: '', reason: '' }],
                    }))}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>
                <div className="space-y-2">
                  {requisitionForm.items.length === 0 && (
                    <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                      No items added. Click "Add Item" or use "Create Requisition" from the Replenishment Demand tab.
                    </div>
                  )}
                  {requisitionForm.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                      <input
                        type="text"
                        placeholder="Item name"
                        value={item.itemName}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, itemName: e.target.value } : it),
                        }))}
                        className="col-span-4 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Category"
                        value={item.category}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, category: e.target.value } : it),
                        }))}
                        className="col-span-2 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, quantity: Number(e.target.value) || 0 } : it),
                        }))}
                        className="col-span-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Unit"
                        value={item.unit}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it),
                        }))}
                        className="col-span-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Cost"
                        value={item.estimatedCost}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, estimatedCost: Number(e.target.value) || 0 } : it),
                        }))}
                        className="col-span-2 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                      <input
                        type="date"
                        value={item.requiredBy}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, requiredBy: e.target.value } : it),
                        }))}
                        className="col-span-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                      <button
                        onClick={() => setRequisitionForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                        className="col-span-1 p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <input
                        type="text"
                        placeholder="Reason (optional)"
                        value={item.reason}
                        onChange={(e) => setRequisitionForm(f => ({
                          ...f,
                          items: f.items.map((it, i) => i === idx ? { ...it, reason: e.target.value } : it),
                        }))}
                        className="col-span-12 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                      />
                    </div>
                  ))}
                </div>
                {requisitionForm.items.length > 0 && (
                  <div className="text-right text-sm font-medium text-slate-600 dark:text-slate-400 pt-2">
                    Total: {formatAmount(requisitionTotal)}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={submitRequisition}
                  disabled={submitting || requisitionForm.items.length === 0}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : 'Submit Requisition'}
                </button>
                <button
                  onClick={() => setShowRequisitionModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
