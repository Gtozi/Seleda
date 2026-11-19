/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchase Order Management — Supply Chain & Procurement Portal (/erp/procurement/orders).
 * Aligns with unified_supply_chain_procurement_portal.md sections 19, 20, 21.
 *
 * Features:
 * - Full PO header (spec section 19): PO Number, Property, Supplier, Buyer, Department,
 *   Cost Center, Currency, Order Date, Required Delivery Date, Delivery Location,
 *   Payment Terms, Contract, Notes
 * - Full PO lines (spec section 19): Item, Description, Quantity, Unit, Unit Price,
 *   Discount, Tax, Total, Required Date, Specification
 * - Status flow (spec section 20): Draft → Pending Approval → Approved → Sent to Supplier
 *   → Supplier Acknowledged → Partially Received → Fully Received → Closed
 *   + Alternative: Rejected, Cancelled, On Hold, Expired
 * - PO Amendments (spec section 21): Quantity, Unit Price, Supplier, Delivery Date,
 *   Tax, Currency, Payment Terms, Total Value — with user, date, previous/new value, reason
 * - All 12 spec departments
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Search, RefreshCw, Eye, MoreVertical,
  Loader2, CheckCircle2, AlertTriangle, Clock, X, FileText,
  ArrowRight, AlertCircle, Edit2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, amendPurchaseOrder,
  fetchSuppliers, type PurchaseOrder, type POStatus, type Supplier,
} from '../../services/procurementService';

const DEPARTMENTS = [
  'Food & Beverage', 'Kitchen', 'Housekeeping', 'Engineering & Maintenance',
  'Spa & Wellness', 'Banquet & Events', 'Transportation & Fleet',
  'Human Resources', 'Administration', 'Security & Risk', 'IT', 'Other',
] as const;

// Spec section 20: Status flow
const STATUS_FLOW: POStatus[] = [
  'Draft', 'Pending Approval', 'Approved', 'Sent to Supplier',
  'Supplier Acknowledged', 'Partially Received', 'Fully Received', 'Closed',
];
const ALT_STATUSES: POStatus[] = ['Rejected', 'Cancelled', 'On Hold', 'Expired'];

const STATUS_TONE: Record<POStatus, StatusTone> = {
  Draft: 'neutral', 'Pending Approval': 'warning', Approved: 'accent',
  'Sent to Supplier': 'info', 'Supplier Acknowledged': 'info',
  'Partially Received': 'success', 'Fully Received': 'success',
  Closed: 'neutral', Rejected: 'danger', Cancelled: 'neutral',
  'On Hold': 'warning', Expired: 'danger',
};

const NEXT_ACTIONS: Record<POStatus, POStatus[]> = {
  Draft: ['Pending Approval', 'Cancelled'],
  'Pending Approval': ['Approved', 'Rejected'],
  Approved: ['Sent to Supplier', 'Rejected', 'Cancelled'],
  'Sent to Supplier': ['Supplier Acknowledged', 'On Hold', 'Cancelled'],
  'Supplier Acknowledged': ['Partially Received', 'Fully Received', 'On Hold'],
  'Partially Received': ['Fully Received', 'Closed'],
  'Fully Received': ['Closed'],
  Closed: [],
  Rejected: ['Draft'],
  Cancelled: ['Draft'],
  'On Hold': ['Sent to Supplier', 'Supplier Acknowledged'],
  Expired: ['Cancelled'],
};

const ACTION_LABELS: Record<POStatus, string> = {
  Draft: 'Submit for Approval',
  'Pending Approval': 'Approve',
  Approved: 'Send to Supplier',
  'Sent to Supplier': 'Mark Acknowledged',
  'Supplier Acknowledged': 'Mark Partially Received',
  'Partially Received': 'Mark Fully Received',
  'Fully Received': 'Close',
  Closed: 'Closed',
  Rejected: 'Reopen',
  Cancelled: 'Reopen',
  'On Hold': 'Resume',
  Expired: 'Cancel',
};

// Source system display labels for sourcing-originated POs
const SOURCE_LABELS: Record<string, { label: string; tone: 'info' | 'accent' | 'warning' }> = {
  procurement: { label: 'Procurement', tone: 'info' },
  rfq: { label: 'RFQ', tone: 'accent' },
  tender: { label: 'Tender', tone: 'accent' },
  engineering: { label: 'Engineering', tone: 'accent' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  food_beverage: { label: 'F&B', tone: 'accent' },
};

const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const PurchaseOrderManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | POStatus>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    supplierId: '',
    buyer: '',
    department: 'Kitchen' as string,
    costCenter: '',
    currency: 'ETB',
    requiredDeliveryDate: '',
    deliveryLocation: '',
    paymentTerms: '',
    notes: '',
    lines: [{ itemName: '', description: '', category: '', quantity: 1, unitOfMeasure: 'ea', unitPrice: 0, discount: 0, tax: 0, requiredDate: '', specification: '' }],
  });

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingTab, setViewingTab] = useState<'details' | 'lines' | 'amendments'>('details');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Amendment modal
  const [amendModal, setAmendModal] = useState<string | null>(null);
  const [amendForm, setAmendForm] = useState({ field: '', previousValue: '', newValue: '', reason: '' });
  const [amending, setAmending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [posData, suppliersData] = await Promise.all([
        fetchPurchaseOrders({ propertyId: currentPropertyId || undefined, status: statusFilter === 'All' ? undefined : statusFilter }),
        fetchSuppliers({ status: 'Active', propertyId: currentPropertyId || undefined }),
      ]);
      setPos(posData.purchaseOrders);
      setSuppliers(suppliersData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return pos.filter((p) => {
      const q = search.trim().toLowerCase();
      return !q || p.po_number.toLowerCase().includes(q) || p.department.toLowerCase().includes(q) || (p.notes?.toLowerCase().includes(q));
    });
  }, [pos, search]);

  const counts = {
    draft: pos.filter((p) => p.status === 'Draft').length,
    pending: pos.filter((p) => p.status === 'Pending Approval').length,
    open: pos.filter((p) => p.status === 'Approved' || p.status === 'Sent to Supplier' || p.status === 'Supplier Acknowledged').length,
    received: pos.filter((p) => p.status === 'Partially Received' || p.status === 'Fully Received').length,
  };

  const submitCreate = async () => {
    if (!form.supplierId || !form.buyer || !form.department || !form.requiredDeliveryDate || form.lines.some((l) => !l.itemName || l.quantity <= 0)) {
      addNotification('Supplier, buyer, department, delivery date, and valid line items are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createPurchaseOrder({
        propertyId: currentPropertyId || undefined,
        supplierId: form.supplierId,
        buyer: form.buyer,
        department: form.department,
        costCenter: form.costCenter || undefined,
        currency: form.currency,
        requiredDeliveryDate: form.requiredDeliveryDate,
        deliveryLocation: form.deliveryLocation || undefined,
        paymentTerms: form.paymentTerms || undefined,
        notes: form.notes || undefined,
        lines: form.lines,
      });
      setPos((prev) => [created.purchaseOrder, ...prev]);
      addNotification(`PO ${created.purchaseOrder.po_number} created`, 'task', 'Procurement');
      setShowForm(false);
      setForm({ supplierId: '', buyer: '', department: 'Kitchen', costCenter: '', currency: 'ETB', requiredDeliveryDate: '', deliveryLocation: '', paymentTerms: '', notes: '', lines: [{ itemName: '', description: '', category: '', quantity: 1, unitOfMeasure: 'ea', unitPrice: 0, discount: 0, tax: 0, requiredDate: '', specification: '' }] });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create PO', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: POStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { purchaseOrder } = await updatePurchaseOrder(id, { status });
      setPos((prev) => prev.map((p) => (p.id === id ? purchaseOrder : p)));
      addNotification(`PO → ${status}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update status', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const submitAmendment = async () => {
    if (!amendModal || !amendForm.field || !amendForm.newValue || !amendForm.reason) {
      addNotification('Field, new value, and reason are required', 'warning', 'Procurement');
      return;
    }
    setAmending(true);
    try {
      await amendPurchaseOrder(amendModal, {
        fieldName: amendForm.field,
        previousValue: amendForm.previousValue,
        newValue: amendForm.newValue,
        reason: amendForm.reason,
      });
      addNotification('Amendment recorded', 'task', 'Procurement');
      setAmendModal(null);
      setAmendForm({ field: '', previousValue: '', newValue: '', reason: '' });
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create amendment', 'warning', 'Procurement');
    } finally {
      setAmending(false);
    }
  };

  const addLine = () => setForm({ ...form, lines: [...form.lines, { itemName: '', description: '', category: '', quantity: 1, unitOfMeasure: 'ea', unitPrice: 0, discount: 0, tax: 0, requiredDate: '', specification: '' }] });
  const removeLine = (idx: number) => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) });
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...form.lines];
    newLines[idx] = { ...newLines[idx], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const formTotal = form.lines.reduce((s, l) => s + (l.quantity * l.unitPrice - l.discount + l.tax), 0);

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Purchase Orders"
        subtitle="Formal purchasing commitments to suppliers with full lifecycle management."
        icon={ShoppingCart}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New PO
            </button>
          </div>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </SectionCard>
      )}

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Draft" value={counts.draft} icon={FileText} tone="neutral" />
        <StatCard title="Pending Approval" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Open POs" value={counts.open} icon={ShoppingCart} tone="accent" />
        <StatCard title="Received" value={counts.received} icon={CheckCircle2} tone="success" />
      </div>

      {/* Status Flow (spec section 20) */}
      <SectionCard title="PO Lifecycle" subtitle="Status flow per specification" icon={ArrowRight} pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FLOW.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusTone[STATUS_TONE[s]] || 'border-gray-200 text-gray-600'}`}>
                {s}
              </div>
              {i < STATUS_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-gray-400" />}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Alternative:</span>
          {ALT_STATUSES.map((s) => <Badge key={s} tone={STATUS_TONE[s]}>{s}</Badge>)}
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by PO number, department..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[180px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
            {ALT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* PO List */}
      <SectionCard title="Purchase Orders" subtitle={`${filtered.length} order${filtered.length !== 1 ? 's' : ''}`} pad="none" className="min-h-[300px]">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <ShoppingCart className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No purchase orders found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((po) => (
              <div key={po.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{po.po_number}</p>
                      {po.source_system && po.source_system !== 'procurement' && SOURCE_LABELS[po.source_system] && (
                        <Badge tone={SOURCE_LABELS[po.source_system].tone}>{SOURCE_LABELS[po.source_system].label}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{po.department} · {po.proc_suppliers?.legal_name || po.supplier_id}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">Required: {po.required_delivery_date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="text-sm font-mono font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(po.total_amount)}</p>
                  <button onClick={() => setViewingId(po.id)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View Details">
                    <Eye className="w-4 h-4" />
                  </button>
                  <button onClick={() => setMenuOpen(menuOpen === po.id ? null : po.id)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition" title="Actions">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>

                {menuOpen === po.id && (
                  <div className="absolute right-4 mt-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-10 min-w-[200px]">
                    {NEXT_ACTIONS[po.status]?.map((status) => (
                      <button key={status} onClick={() => changeStatus(po.id, status)} disabled={actingOn === po.id} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 first:rounded-t-xl last:rounded-b-xl disabled:opacity-50">
                        {ACTION_LABELS[status] || status}
                      </button>
                    ))}
                    {!['Closed', 'Cancelled', 'Rejected', 'Expired'].includes(po.status) && (
                      <button onClick={() => { setAmendModal(po.id); setMenuOpen(null); }} className="w-full text-left px-4 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-t border-gray-100 dark:border-slate-700">
                        <Edit2 className="w-3.5 h-3.5 inline mr-1" /> Create Amendment
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Purchase Order" size="xl" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          {/* Header fields (spec section 19) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
              <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">Select supplier...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Buyer *</label>
              <input className={inputClass} value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} placeholder="Buyer name" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Department *</label>
              <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Cost Center</label>
              <input className={inputClass} value={form.costCenter} onChange={(e) => setForm({ ...form, costCenter: e.target.value })} placeholder="e.g. CC-001" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Currency</label>
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="ETB">ETB</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Required Delivery Date *</label>
              <input type="date" className={inputClass} value={form.requiredDeliveryDate} onChange={(e) => setForm({ ...form, requiredDeliveryDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delivery Location</label>
              <input className={inputClass} value={form.deliveryLocation} onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })} placeholder="e.g. Main Store" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Payment Terms</label>
              <input className={inputClass} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. Net 30" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="PO notes" />
          </div>

          {/* Lines (spec section 19) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-gray-500">PO Lines</label>
              <button onClick={addLine} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-2 mb-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500">Line {idx + 1}</span>
                  {form.lines.length > 1 && <button onClick={() => removeLine(idx)} className="text-xs text-red-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" /> Remove</button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputClass} placeholder="Item name *" value={line.itemName} onChange={(e) => updateLine(idx, 'itemName', e.target.value)} />
                  <input className={inputClass} placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                  <input type="number" className={inputClass} placeholder="Quantity" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                  <input className={inputClass} placeholder="Unit" value={line.unitOfMeasure} onChange={(e) => updateLine(idx, 'unitOfMeasure', e.target.value)} />
                  <input type="number" className={inputClass} placeholder="Unit price" value={line.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)} />
                  <input type="number" className={inputClass} placeholder="Discount" value={line.discount} onChange={(e) => updateLine(idx, 'discount', parseFloat(e.target.value) || 0)} />
                  <input type="number" className={inputClass} placeholder="Tax" value={line.tax} onChange={(e) => updateLine(idx, 'tax', parseFloat(e.target.value) || 0)} />
                  <input type="date" className={inputClass} placeholder="Required date" value={line.requiredDate} onChange={(e) => updateLine(idx, 'requiredDate', e.target.value)} />
                  <input className={inputClass} placeholder="Specification" value={line.specification} onChange={(e) => updateLine(idx, 'specification', e.target.value)} />
                </div>
                {line.quantity > 0 && line.unitPrice > 0 && (
                  <p className="text-xs text-right text-gray-500">Line total: <span className="font-bold">{fmtMoney(line.quantity * line.unitPrice - line.discount + line.tax)}</span></p>
                )}
              </div>
            ))}
            <p className="text-sm text-right mt-2 text-gray-600 dark:text-gray-400">Total: <span className="font-bold text-gray-900 dark:text-white">{fmtMoney(formTotal)}</span></p>
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewingId && (
        <ModalSystem isOpen={!!viewingId} onClose={() => setViewingId(null)} title="PO Details" size="xl" showFooter={false}>
          {(() => {
            const po = pos.find((p) => p.id === viewingId);
            if (!po) return null;
            return (
              <div>
                <div className="flex border-b border-gray-200 dark:border-slate-700 mb-4">
                  {['details', 'lines', 'amendments'].map((tab) => (
                    <button key={tab} onClick={() => setViewingTab(tab as any)} className={`px-4 py-2 text-sm font-medium capitalize ${viewingTab === tab ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>{tab}</button>
                  ))}
                </div>

                {viewingTab === 'details' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 uppercase">PO Number</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{po.po_number}</p>
                          {po.source_system && po.source_system !== 'procurement' && SOURCE_LABELS[po.source_system] && (
                            <Badge tone={SOURCE_LABELS[po.source_system].tone}>{SOURCE_LABELS[po.source_system].label}</Badge>
                          )}
                        </div>
                      </div>
                      <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge></div>
                      <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.proc_suppliers?.legal_name || po.supplier_id}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Buyer</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.buyer}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Department</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.department}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Cost Center</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.cost_center || '—'}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Order Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.order_date}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Required Delivery</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.required_delivery_date}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Delivery Location</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.delivery_location || '—'}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Payment Terms</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.payment_terms || '—'}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Currency</p><p className="text-sm font-medium text-gray-900 dark:text-white">{po.currency}</p></div>
                      <div><p className="text-xs text-gray-500 uppercase">Total Amount</p><p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(po.total_amount)}</p></div>
                    </div>
                    {po.notes && <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{po.notes}</p></div>}
                    <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
                      {NEXT_ACTIONS[po.status]?.map((status) => (
                        <button key={status} onClick={() => changeStatus(po.id, status)} disabled={actingOn === po.id} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                          {ACTION_LABELS[status] || status}
                        </button>
                      ))}
                      {!['Closed', 'Cancelled', 'Rejected', 'Expired'].includes(po.status) && (
                        <button onClick={() => setAmendModal(po.id)} className="text-xs bg-gray-600 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700">
                          <Edit2 className="w-3 h-3 inline mr-1" /> Amend
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {viewingTab === 'lines' && (
                  <div>
                    {po.proc_po_lines && po.proc_po_lines.length > 0 ? (
                      <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">#</th>
                              <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Item</th>
                              <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Qty</th>
                              <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Price</th>
                              <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Disc</th>
                              <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Tax</th>
                              <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                            {po.proc_po_lines.map((line, i) => (
                              <tr key={line.id || i}>
                                <td className="px-3 py-2 text-gray-500">{line.line_number || i + 1}</td>
                                <td className="px-3 py-2">
                                  <p className="font-medium text-gray-900 dark:text-white">{line.item_name}</p>
                                  {line.description && <p className="text-xs text-gray-500">{line.description}</p>}
                                  {line.specification && <p className="text-xs text-gray-400">Spec: {line.specification}</p>}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">{line.quantity_ordered} {line.unit_of_measure}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.unit_price)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.discount)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line.tax)}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(line.line_total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-sm text-gray-500">No line items</p>}
                  </div>
                )}

                {viewingTab === 'amendments' && (
                  <div>
                    {po.proc_po_amendments && po.proc_po_amendments.length > 0 ? (
                      <div className="space-y-2">
                        {po.proc_po_amendments.map((amend, i) => (
                          <div key={amend.id || i} className="p-3 border border-gray-200 dark:border-slate-700 rounded-xl">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">{amend.amendment_type || amend.field || 'Amendment'}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {amend.previous_value || '—'} → {amend.new_value || amend.newValue || '—'}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">Reason: {amend.reason || '—'}</p>
                              </div>
                              <Badge tone="warning">Amended</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-sm text-gray-500 dark:text-gray-400">No amendments recorded</p>
                        {!['Closed', 'Cancelled', 'Rejected', 'Expired'].includes(po.status) && (
                          <button onClick={() => setAmendModal(po.id)} className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                            Create Amendment
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </ModalSystem>
      )}

      {/* Amendment Modal (spec section 21) */}
      <ModalSystem
        isOpen={!!amendModal}
        onClose={() => setAmendModal(null)}
        title="PO Amendment"
        size="md"
        loading={amending}
        confirmLabel="Record Amendment"
        onConfirm={submitAmendment}
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Amendments record changes to quantity, price, supplier, delivery date, tax, currency, payment terms, or total value.
              Each amendment records: user, date/time, previous value, new value, reason, and approval.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Amendment Field *</label>
            <select className={inputClass} value={amendForm.field} onChange={(e) => setAmendForm({ ...amendForm, field: e.target.value })}>
              <option value="">Select field...</option>
              <option value="Quantity">Quantity</option>
              <option value="Unit Price">Unit Price</option>
              <option value="Supplier">Supplier</option>
              <option value="Delivery Date">Delivery Date</option>
              <option value="Tax">Tax</option>
              <option value="Currency">Currency</option>
              <option value="Payment Terms">Payment Terms</option>
              <option value="Total Value">Total Value</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Previous Value</label>
              <input className={inputClass} value={amendForm.previousValue} onChange={(e) => setAmendForm({ ...amendForm, previousValue: e.target.value })} placeholder="Previous value" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">New Value *</label>
              <input className={inputClass} value={amendForm.newValue} onChange={(e) => setAmendForm({ ...amendForm, newValue: e.target.value })} placeholder="New value" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Reason *</label>
            <textarea className={inputClass} rows={2} value={amendForm.reason} onChange={(e) => setAmendForm({ ...amendForm, reason: e.target.value })} placeholder="Reason for amendment" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default PurchaseOrderManagement;
