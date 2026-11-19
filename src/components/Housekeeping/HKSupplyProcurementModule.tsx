/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HKSupplyProcurementModule — Housekeeping Supply & Procurement Coordination.
 *
 * Mirrors the F&B SupplierProcurementCoordination screen but for Housekeeping.
 * Three tabs:
 *   - Replenishment Demand: HK inventory items at/below reorder point
 *   - Purchase Requisitions: hk_purchase_orders dispatched to Procurement
 *   - Supplier Requirements: shared supplier master (fb_suppliers)
 *
 * Backed by /api/hk-portal/supply-procurement/* endpoints.
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

interface ForecastDemand {
  id: string;
  period: string;
  outlet_id: string;
  menu_item_id: string;
  predicted_quantity: number;
  unit: string;
  confidence: number;
  created_at: string;
  fb_outlet_stock: number;
  main_store_stock: number;
  total_available: number;
  shortage: number;
  requisition_id: string | null;
  requisition_status: string | null;
  supplier_order_id: string | null;
  supplier_order_status: string | null;
}

interface PurchaseRequisition {
  id: string;
  requisition_number: string;
  requested_by: string;
  request_date: string;
  department: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processing';
  po_status?: string;
  items: RequisitionItem[];
  total_cost: number;
  notes: string;
  supplier_order_id: string | null;
  supplier_order_number: string | null;
  supplier_order_status: string | null;
  supplier_name: string | null;
}

interface RequisitionItem {
  id: string;
  item_name: string;
  category: string;
  requested_quantity: number;
  unit: string;
  estimated_unit_cost: number;
  estimated_total: number;
  required_by: string;
  reason: string;
}

interface SupplierRequirement {
  id: string;
  supplier_id: string;
  supplier_name: string;
  category: string;
  item_name: string;
  minimum_order_qty: number;
  unit: string;
  lead_time_days: number;
  payment_terms: string;
  status: 'active' | 'inactive' | 'on-hold';
  last_order_date: string | null;
}

export default function HKSupplyProcurementModule() {
  const { formatAmount, addNotification, currentPropertyId } = useERP();
  const [activeTab, setActiveTab] = useState<'forecast' | 'requisitions' | 'suppliers'>('forecast');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showRequisitionModal, setShowRequisitionModal] = useState(false);
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('all');
  const [requisitionForm, setRequisitionForm] = useState({
    supplierId: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    notes: '',
    items: [] as { itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string }[],
  });

  // Data state
  const [forecasts, setForecasts] = useState<ForecastDemand[]>([]);
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRequirement[]>([]);
  const [hkItems, setHkItems] = useState<{ id: string; name: string; category: string; unit_of_measure: string; current_cost: number }[]>([]);
  const [statsData, setStatsData] = useState({ openRequisitions: 0, pendingApproval: 0, activeSuppliers: 0, avgLeadTimeDays: 0 });
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  useEffect(() => {
    fetchData();
    fetchHkItems();
  }, []);

  // Refetch requisitions when the status filter changes
  useEffect(() => {
    if (!loading) fetchRequisitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqStatusFilter]);

  const fetchHkItems = async () => {
    try {
      const res = await fetch('/api/hk-portal/inventory/main-store-items', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setHkItems((data?.items || []).map((i: any) => ({
          id: i.id,
          name: i.name,
          category: 'General',
          unit_of_measure: i.unitOfMeasure || 'pcs',
          current_cost: Number(i.unitCost || 0),
        })));
      }
    } catch (err) {
      console.error('Error fetching HK items:', err);
    }
  };

  const fetchStats = async () => {
    try {
      const qs = currentPropertyId ? `?propertyId=${encodeURIComponent(currentPropertyId)}` : '';
      const res = await fetch(`/api/hk-portal/supply-procurement/stats${qs}`, { headers: authHeaders() });
      if (res.ok) setStatsData(await res.json());
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchRequisitions = async () => {
    try {
      const params = new URLSearchParams();
      if (reqStatusFilter !== 'all') params.set('status', mapFilterToPoStatus(reqStatusFilter));
      if (currentPropertyId) params.set('propertyId', currentPropertyId);
      const qs = params.toString();
      const url = `/api/hk-portal/supply-procurement/requisitions${qs ? `?${qs}` : ''}`;
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
      const [fcRes, reqRes, supRes] = await Promise.all([
        fetch(`/api/hk-portal/supply-procurement/forecast${qs}`, { headers: authHeaders() }),
        fetch(`/api/hk-portal/supply-procurement/requisitions${qs}`, { headers: authHeaders() }),
        fetch('/api/hk-portal/supply-procurement/suppliers', { headers: authHeaders() }),
      ]);
      if (fcRes.ok) setForecasts(await fcRes.json());
      if (reqRes.ok) setRequisitions(await reqRes.json());
      if (supRes.ok) setSuppliers(await supRes.json());
      await fetchStats();
    } catch (error) {
      addNotification('Failed to load procurement data', 'warning', 'Housekeeping');
    } finally {
      setLoading(false);
    }
  };

  // Map the UI status filter to the underlying purchase-order status used by the API.
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

  const submitRequisition = async () => {
    if (!currentPropertyId) {
      addNotification('No active property selected', 'warning', 'Housekeeping');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/supply-procurement/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
      addNotification(`Purchase requisition ${data.po_number} submitted to Procurement`, 'success', 'Housekeeping');
      setShowRequisitionModal(false);
      setRequisitionForm({ supplierId: '', priority: 'medium', notes: '', items: [] });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to create requisition', 'warning', 'Housekeeping');
    } finally {
      setSubmitting(false);
    }
  };

  // Pre-fill the requisition modal from a replenishment demand row
  const createRequisitionFromForecast = (forecast: ForecastDemand) => {
    setRequisitionForm({
      supplierId: '',
      priority: forecast.shortage > 100 ? 'urgent' : 'high',
      notes: `Replenishment for ${forecast.menu_item_id} — shortage of ${forecast.shortage} ${forecast.unit}`,
      items: [
        {
          itemName: forecast.menu_item_id,
          category: 'General',
          quantity: forecast.shortage,
          unit: forecast.unit,
          estimatedCost: 0,
          requiredBy: '',
          reason: 'Replenishment demand',
        },
      ],
    });
    setShowRequisitionModal(true);
  };

  // Advance a PO to the next status (draft → submitted → acknowledged → …).
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
      const res = await fetch(`/api/hk-portal/supply-procurement/requisitions/${reqId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`PO ${poNumber} → ${next}`, 'success', 'Housekeeping');
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to advance PO', 'warning', 'Housekeeping');
    }
  };

  // Goods receipt: credit inventory_items with received quantities.
  const receivePo = async (reqId: string, poNumber: string) => {
    try {
      const res = await fetch(`/api/hk-portal/supply-procurement/requisitions/${reqId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      addNotification(`Goods received for ${poNumber} — ${data.fullyReceived ? 'fully received' : 'partial'}`, 'success', 'Housekeeping');
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to process goods receipt', 'warning', 'Housekeeping');
    }
  };

  // Client-side search filtering across the active tab's columns
  const filteredForecasts = useMemo(() => {
    if (!searchTerm.trim()) return forecasts;
    const q = searchTerm.toLowerCase();
    return forecasts.filter((f) =>
      [f.outlet_id, f.menu_item_id, f.period, f.unit, f.requisition_id, f.supplier_order_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [forecasts, searchTerm]);

  const filteredRequisitions = useMemo(() => {
    if (!searchTerm.trim()) return requisitions;
    const q = searchTerm.toLowerCase();
    return requisitions.filter((r) =>
      [r.requisition_number, r.requested_by, r.department, r.notes, r.supplier_name, r.supplier_order_number]
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

  // Live total for the requisition modal
  const requisitionTotal = useMemo(
    () => requisitionForm.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimatedCost) || 0), 0),
    [requisitionForm.items]
  );

  const handleRefresh = () => {
    fetchData();
    fetchHkItems();
    addNotification('Procurement data refreshed', 'info', 'Housekeeping');
  };

  // CSV export of the currently active tab's data
  const exportCsv = () => {
    let headers: string[] = [];
    let rows: any[] = [];
    if (activeTab === 'forecast') {
      headers = ['Period', 'Location', 'Item', 'Reorder Qty', 'Unit', 'On-Hand', 'Shortage', 'Requisition', 'Supplier Order'];
      rows = filteredForecasts.map((f) => [f.period, f.outlet_id, f.menu_item_id, f.predicted_quantity, f.unit, f.total_available, f.shortage, f.requisition_id || '', f.supplier_order_id || '']);
    } else if (activeTab === 'requisitions') {
      headers = ['Requisition #', 'Requested By', 'Department', 'Priority', 'Items', 'Total Cost', 'Status', 'Supplier Order', 'Order Status', 'Supplier'];
      rows = filteredRequisitions.map((r) => [r.requisition_number, r.requested_by, r.department, r.priority, r.items.length, r.total_cost, r.status, r.supplier_order_number || '', r.supplier_order_status || '', r.supplier_name || '']);
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
    link.download = `hk-supply-procurement-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addNotification('CSV exported', 'success', 'Housekeeping');
  };

  // Totals for the forecast summary footer
  const forecastTotals = useMemo(() => {
    const totalPredicted = filteredForecasts.reduce((s, f) => s + f.predicted_quantity, 0);
    const totalAvailable = filteredForecasts.reduce((s, f) => s + f.total_available, 0);
    const totalShortage = filteredForecasts.reduce((s, f) => s + f.shortage, 0);
    const shortageRows = filteredForecasts.filter((f) => f.shortage > 0).length;
    return { totalPredicted, totalAvailable, totalShortage, shortageRows };
  }, [filteredForecasts]);

  const tabs = [
    { id: 'forecast', label: 'Replenishment Demand', icon: TrendingUp, count: forecasts.length },
    { id: 'requisitions', label: 'Purchase Requisitions', icon: FileText, count: requisitions.length },
    { id: 'suppliers', label: 'Supplier Requirements', icon: Building2, count: suppliers.length },
  ];

  const stats = [
    { label: 'Open Requisitions', value: String(statsData.openRequisitions), change: '', icon: FileText, color: 'blue' },
    { label: 'Pending Approval', value: String(statsData.pendingApproval), change: '', icon: Clock, color: 'amber' },
    { label: 'Active Suppliers', value: String(statsData.activeSuppliers), change: '', icon: Building2, color: 'green' },
    { label: 'Avg Lead Time', value: `${statsData.avgLeadTimeDays} days`, change: '', icon: Truck, color: 'purple' },
  ];

  return (
    <div className={layout.sectionStack}>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Housekeeping Supply & Procurement Coordination"
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
            placeholder={`Search ${activeTab === 'forecast' ? 'item, location, period...' : activeTab === 'requisitions' ? 'requisition #, supplier...' : 'supplier, category, item...'}"`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-72"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
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
            <SectionCard title="Replenishment Demand" subtitle="Housekeeping items at or below reorder point">
              {filteredForecasts.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Inbox className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{forecasts.length === 0 ? 'No replenishment demand — all items above reorder point.' : 'No items match your search.'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Last Restock</th>
                        <th className="px-4 py-3 font-medium">Location</th>
                        <th className="px-4 py-3 font-medium">Item</th>
                        <th className="px-4 py-3 font-medium">Reorder Qty</th>
                        <th className="px-4 py-3 font-medium">On-Hand</th>
                        <th className="px-4 py-3 font-medium">Shortage</th>
                        <th className="px-4 py-3 font-medium">Requisition</th>
                        <th className="px-4 py-3 font-medium">Supplier Order</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                      {filteredForecasts.map((forecast) => (
                        <tr key={forecast.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{forecast.period}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{forecast.outlet_id}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{forecast.menu_item_id}</td>
                          <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">{forecast.predicted_quantity} <span className="text-slate-400 font-normal">{forecast.unit}</span></td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{forecast.total_available}</td>
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
                            {forecast.supplier_order_status ? (
                              <Badge tone={forecast.supplier_order_status === 'shipped' ? 'success' : forecast.supplier_order_status === 'ordered' ? 'warning' : 'neutral'}>
                                {forecast.supplier_order_status}
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
                        <td className="px-4 py-3 tabular-nums">{forecastTotals.totalPredicted}</td>
                        <td className="px-4 py-3 tabular-nums">{forecastTotals.totalAvailable}</td>
                        <td className="px-4 py-3 tabular-nums text-red-600">{forecastTotals.totalShortage > 0 ? `-${forecastTotals.totalShortage}` : '0'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500" colSpan={3}>{forecastTotals.shortageRows} shortage{forecastTotals.shortageRows === 1 ? '' : 's'}</td>
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
                        <th className="px-4 py-3 font-medium">Department</th>
                        <th className="px-4 py-3 font-medium">Priority</th>
                        <th className="px-4 py-3 font-medium">Items</th>
                        <th className="px-4 py-3 font-medium">Total Cost</th>
                        <th className="px-4 py-3 font-medium">HK Status</th>
                        <th className="px-4 py-3 font-medium">Supplier Order</th>
                        <th className="px-4 py-3 font-medium">Order Status</th>
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
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{req.department}</td>
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
                                {req.supplier_order_number ? (
                                  <span className="text-indigo-600 font-medium">{req.supplier_order_number}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {req.supplier_order_status ? (
                                  <Badge tone={req.supplier_order_status === 'shipped' ? 'success' : req.supplier_order_status === 'ordered' ? 'warning' : req.supplier_order_status === 'delivered' ? 'success' : 'neutral'}>
                                    {req.supplier_order_status}
                                  </Badge>
                                ) : (
                                  <span className="text-slate-400">Pending</span>
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
                                    <button onClick={() => receivePo(req.id, req.requisition_number)} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700" title="Receive goods into HK store">Receive</button>
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
                                <td colSpan={10} className="px-4 py-4">
                                  <div className="space-y-3">
                                    {req.notes && (
                                      <div className="text-xs text-slate-600 dark:text-slate-400">
                                        <span className="font-medium">Notes:</span> {req.notes}
                                      </div>
                                    )}
                                    {req.supplier_name && (
                                      <div className="text-xs text-slate-600 dark:text-slate-400">
                                        <span className="font-medium">Supplier:</span> {req.supplier_name}
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
                  <select
                    value={requisitionForm.priority}
                    onChange={(e) => setRequisitionForm({ ...requisitionForm, priority: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
                  <input
                    type="text"
                    value="Housekeeping"
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Supplier (optional)</label>
                <select
                  value={requisitionForm.supplierId}
                  onChange={(e) => setRequisitionForm({ ...requisitionForm, supplierId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Auto-assign by Procurement</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.supplier_name} ({s.category})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <textarea
                  value={requisitionForm.notes}
                  onChange={(e) => setRequisitionForm({ ...requisitionForm, notes: e.target.value })}
                  placeholder="Additional notes for this requisition..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white h-20"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Items <span className="text-slate-400 font-normal">(optional)</span></label>
                  <button
                    onClick={() => setRequisitionForm({ ...requisitionForm, items: [...requisitionForm.items, { itemName: '', category: '', quantity: 1, unit: 'pcs', estimatedCost: 0, requiredBy: '', reason: '' }] })}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>
                <div className="mb-3 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    <Package className="w-3 h-3 inline mr-1" />
                    Replenishment is based on HK inventory reorder points. Order only what's needed.
                  </p>
                </div>
                <div className="space-y-2">
                  {requisitionForm.items.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          list={`hk-items-list-${idx}`}
                          value={item.itemName}
                          onChange={(e) => {
                            const next = [...requisitionForm.items];
                            const typed = e.target.value;
                            const selected = hkItems.find((ing) => ing.name === typed);
                            if (selected) {
                              next[idx] = {
                                ...next[idx],
                                itemName: selected.name,
                                category: selected.category,
                                unit: selected.unit_of_measure,
                                estimatedCost: selected.current_cost,
                              };
                            } else {
                              next[idx] = { ...next[idx], itemName: typed };
                            }
                            setRequisitionForm({ ...requisitionForm, items: next });
                          }}
                          className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                          placeholder="Type or select item (optional)..."
                        />
                        <datalist id={`hk-items-list-${idx}`}>
                          {hkItems.map((ing) => (
                            <option key={ing.id} value={ing.name}>{ing.category} · {ing.unit_of_measure}</option>
                          ))}
                        </datalist>
                        <div className="grid grid-cols-3 gap-2">
                          <input type="text" value={item.category}
                            onChange={(e) => {
                              const next = [...requisitionForm.items];
                              next[idx] = { ...next[idx], category: e.target.value };
                              setRequisitionForm({ ...requisitionForm, items: next });
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                            placeholder="Category"
                          />
                          <input type="number" step="0.001" value={item.quantity}
                            onChange={(e) => {
                              const next = [...requisitionForm.items];
                              next[idx] = { ...next[idx], quantity: parseFloat(e.target.value) || 0 };
                              setRequisitionForm({ ...requisitionForm, items: next });
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                            placeholder="Qty"
                          />
                          <input type="text" value={item.unit}
                            onChange={(e) => {
                              const next = [...requisitionForm.items];
                              next[idx] = { ...next[idx], unit: e.target.value };
                              setRequisitionForm({ ...requisitionForm, items: next });
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                            placeholder="Unit"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input type="number" step="0.01" value={item.estimatedCost}
                            onChange={(e) => {
                              const next = [...requisitionForm.items];
                              next[idx] = { ...next[idx], estimatedCost: parseFloat(e.target.value) || 0 };
                              setRequisitionForm({ ...requisitionForm, items: next });
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                            placeholder="Est. Cost/Unit"
                          />
                          <input type="text" value={item.requiredBy}
                            onChange={(e) => {
                              const next = [...requisitionForm.items];
                              next[idx] = { ...next[idx], requiredBy: e.target.value };
                              setRequisitionForm({ ...requisitionForm, items: next });
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                            placeholder="Required By"
                          />
                          <input type="text" value={item.reason}
                            onChange={(e) => {
                              const next = [...requisitionForm.items];
                              next[idx] = { ...next[idx], reason: e.target.value };
                              setRequisitionForm({ ...requisitionForm, items: next });
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                            placeholder="Reason"
                          />
                        </div>
                      </div>
                      <button onClick={() => setRequisitionForm({ ...requisitionForm, items: requisitionForm.items.filter((_, i) => i !== idx) })}
                        className="p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                <div className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-medium">Estimated Total:</span>{' '}
                  <span className="text-xs text-slate-500">({requisitionForm.items.length} item{requisitionForm.items.length === 1 ? '' : 's'})</span>
                </div>
                <div className="text-lg font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">{formatAmount(requisitionTotal)}</div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={submitRequisition}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting...' : 'Submit to Procurement'}
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
