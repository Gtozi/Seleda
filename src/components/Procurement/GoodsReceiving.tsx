/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Receiving Coordination — Supply Chain & Procurement Portal (/erp/procurement/receiving).
 * Aligns with unified_supply_chain_procurement_portal.md sections 40, 41.
 *
 * Receiving flow (spec section 40):
 *   Purchase Order → Supplier Delivery → Receiving → Quantity Check →
 *   Quality Check → Goods Receipt → Inventory
 *
 * Receiving supports (spec section 40):
 *   Full receipt, Partial receipt, Short delivery, Over delivery,
 *   Damaged goods, Rejected goods, Backorders
 *
 * Note: The Inventory & Stores Portal owns the final stock transaction.
 *
 * Three-Way Matching (spec section 41):
 *   Purchase Order + Goods Receipt + Supplier Invoice → Three-Way Match → Matched → Finance Payment
 *   Variance → Exception → Review → Correction / Approval
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck, Search, RefreshCw, Loader2, AlertCircle, Eye,
  ArrowRight, CheckCircle2, XCircle, Package, FileCheck, Layers,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchDeliveries, updateDelivery, type Delivery, type DeliveryStatus,
} from '../../services/procurementService';

const STATUS_TONE: Record<DeliveryStatus, any> = {
  Expected: 'neutral', 'In Transit': 'info', Delayed: 'warning',
  'Partial Received': 'accent', 'Fully Received': 'success', Cancelled: 'danger',
};

const RECEIVING_TYPES = [
  'Full receipt', 'Partial receipt', 'Short delivery', 'Over delivery',
  'Damaged goods', 'Rejected goods', 'Backorders',
];

// Spec section 40: Receiving flow
const RECEIVING_FLOW = [
  'Purchase Order', 'Supplier Delivery', 'Receiving', 'Quantity Check',
  'Quality Check', 'Goods Receipt', 'Inventory',
];

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const GoodsReceiving: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Delivery | null>(null);
  const [showReceive, setShowReceive] = useState<Delivery | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | DeliveryStatus>('All');
  const [receiveForm, setReceiveForm] = useState({ receivedQuantity: 0, receivedBy: '', notes: '', delayReason: '', receivingType: 'Full receipt' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeliveries({ propertyId: currentPropertyId || undefined });
      setDeliveries(data.deliveries);
    } catch (e: any) {
      setError(e?.message || 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return deliveries.filter((d) => {
      if (statusFilter !== 'All' && d.status !== statusFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || (d.proc_suppliers?.legal_name || '').toLowerCase().includes(q) || (d.proc_purchase_orders?.po_number || '').toLowerCase().includes(q);
    });
  }, [deliveries, search, statusFilter]);

  const openReceive = (d: Delivery) => {
    setShowReceive(d);
    setReceiveForm({ receivedQuantity: d.total_quantity, receivedBy: '', notes: '', delayReason: '', receivingType: 'Full receipt' });
  };

  const submitReceive = async () => {
    if (!showReceive) return;
    if (!receiveForm.receivedBy) {
      addNotification('Received by is required', 'warning', 'Procurement');
      return;
    }
    setActingOn(showReceive.id);
    try {
      const isFull = receiveForm.receivedQuantity >= showReceive.total_quantity;
      const isPartial = receiveForm.receivedQuantity > 0 && receiveForm.receivedQuantity < showReceive.total_quantity;
      const status: DeliveryStatus = isFull ? 'Fully Received' : isPartial ? 'Partial Received' : showReceive.status;
      const { delivery } = await updateDelivery(showReceive.id, {
        status, actualDate: new Date().toISOString().slice(0, 10),
        receivedBy: receiveForm.receivedBy, notes: receiveForm.notes,
        delayReason: receiveForm.delayReason || undefined,
      });
      setDeliveries((prev) => prev.map((d) => (d.id === showReceive.id ? delivery : d)));
      addNotification(`Delivery ${status}`, 'task', 'Procurement');
      setShowReceive(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update delivery', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const markInTransit = async (id: string) => {
    setActingOn(id);
    try {
      const { delivery } = await updateDelivery(id, { status: 'In Transit' });
      setDeliveries((prev) => prev.map((d) => (d.id === id ? delivery : d)));
      addNotification('Delivery marked In Transit', 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    expected: deliveries.filter((d) => d.status === 'Expected').length,
    inTransit: deliveries.filter((d) => d.status === 'In Transit').length,
    delayed: deliveries.filter((d) => d.status === 'Delayed').length,
    received: deliveries.filter((d) => d.status === 'Fully Received' || d.status === 'Partial Received').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Receiving Coordination"
        subtitle="Delivery coordination and goods receiving per specification sections 40-41."
        icon={Truck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
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
        <StatCard title="Expected" value={counts.expected} icon={Package} tone="neutral" />
        <StatCard title="In Transit" value={counts.inTransit} icon={Truck} tone="info" />
        <StatCard title="Delayed" value={counts.delayed} icon={AlertCircle} tone="warning" />
        <StatCard title="Received" value={counts.received} icon={CheckCircle2} tone="success" />
      </div>

      {/* Receiving Flow (spec section 40) */}
      <SectionCard title="Receiving Flow" subtitle="Per specification section 40 — Inventory & Stores owns the final stock transaction" icon={ArrowRight} pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {RECEIVING_FLOW.map((s, i) => (
            <React.Fragment key={s}>
              <div className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300">{s}</div>
              {i < RECEIVING_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-gray-400" />}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <p className="text-xs font-bold text-gray-500 mb-2">Receiving Supports:</p>
          <div className="flex flex-wrap gap-1.5">
            {RECEIVING_TYPES.map((r) => (
              <span key={r} className="px-2 py-1 text-xs rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">{r}</span>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Three-Way Matching (spec section 41) */}
      <SectionCard title="Three-Way Matching" subtitle="Per specification section 41" icon={FileCheck} pad="md">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-medium">Purchase Order</div>
          <span className="text-gray-400 font-bold">+</span>
          <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 font-medium">Goods Receipt</div>
          <span className="text-gray-400 font-bold">+</span>
          <div className="px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-medium">Supplier Invoice</div>
          <ArrowRight className="w-4 h-4 text-gray-400" />
          <div className="px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-medium">Three-Way Match</div>
          <ArrowRight className="w-4 h-4 text-gray-400" />
          <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-medium">Finance Payment</div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <p className="text-xs font-bold text-gray-500 mb-2">Variance Handling:</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">Variance</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">Exception</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">Review</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span className="px-2 py-1 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">Correction / Approval</span>
          </div>
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by supplier or PO number..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[160px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            <option value="Expected">Expected</option>
            <option value="In Transit">In Transit</option>
            <option value="Delayed">Delayed</option>
            <option value="Partial Received">Partial Received</option>
            <option value="Fully Received">Fully Received</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </SectionCard>

      {/* Deliveries List */}
      <SectionCard title="Deliveries" subtitle={`${filtered.length} delivery${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <Truck className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No deliveries found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((d) => (
              <div key={d.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[d.status] || 'neutral'}>{d.status}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{d.proc_suppliers?.legal_name || d.supplier_id}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">PO: {d.proc_purchase_orders?.po_number || d.po_id} · Expected: {d.expected_date}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">Items: {d.total_items} · Qty: {d.received_quantity}/{d.total_quantity}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setViewing(d)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View">
                    <Eye className="w-4 h-4" />
                  </button>
                  {d.status === 'Expected' && (
                    <button onClick={() => markInTransit(d.id)} disabled={actingOn === d.id} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">Mark In Transit</button>
                  )}
                  {(d.status === 'Expected' || d.status === 'In Transit' || d.status === 'Delayed' || d.status === 'Partial Received') && (
                    <button onClick={() => openReceive(d)} disabled={actingOn === d.id} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">Receive</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Delivery Details" size="md" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.status] || 'neutral'}>{viewing.status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">PO Number</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_purchase_orders?.po_number || viewing.po_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Expected Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.expected_date}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Actual Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.actual_date || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Received By</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.received_by || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Total Items</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.total_items}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Quantity</p><p className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{viewing.received_quantity} / {viewing.total_quantity}</p></div>
            </div>
            {viewing.delay_reason && <div><p className="text-xs text-gray-500 uppercase mb-1">Delay Reason</p><p className="text-sm text-amber-600">{viewing.delay_reason}</p></div>}
            {viewing.delivery_note && <div><p className="text-xs text-gray-500 uppercase mb-1">Delivery Note</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.delivery_note}</p></div>}
            {viewing.notes && <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p></div>}
          </div>
        </ModalSystem>
      )}

      {/* Receive Modal */}
      {showReceive && (
        <ModalSystem isOpen={!!showReceive} onClose={() => setShowReceive(null)} title="Receive Goods" size="md" loading={actingOn === showReceive.id} confirmLabel="Confirm Receipt" onConfirm={submitReceive}>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <p className="text-xs text-gray-500">Supplier</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{showReceive.proc_suppliers?.legal_name || showReceive.supplier_id}</p>
              <p className="text-xs text-gray-500 mt-2">Expected Quantity</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{showReceive.total_quantity}</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Receiving Type</label>
              <select className={inputClass} value={receiveForm.receivingType} onChange={(e) => setReceiveForm({ ...receiveForm, receivingType: e.target.value })}>
                {RECEIVING_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Received Quantity *</label>
                <input type="number" min={0} max={showReceive.total_quantity * 1.2} className={inputClass} value={receiveForm.receivedQuantity} onChange={(e) => setReceiveForm({ ...receiveForm, receivedQuantity: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Received By *</label>
                <input className={inputClass} value={receiveForm.receivedBy} onChange={(e) => setReceiveForm({ ...receiveForm, receivedBy: e.target.value })} placeholder="Receiver name" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delay Reason (if any)</label>
              <input className={inputClass} value={receiveForm.delayReason} onChange={(e) => setReceiveForm({ ...receiveForm, delayReason: e.target.value })} placeholder="Reason for delay" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
              <textarea className={inputClass} rows={2} value={receiveForm.notes} onChange={(e) => setReceiveForm({ ...receiveForm, notes: e.target.value })} placeholder="Receiving notes" />
            </div>
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default GoodsReceiving;
