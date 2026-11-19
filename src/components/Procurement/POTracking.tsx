/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PO Tracking — Supply Chain & Procurement Portal (/erp/procurement/po-tracking).
 * Aligns with unified_supply_chain_procurement_portal.md section 20 (PO Status).
 *
 * Tracks shipment and delivery of purchase orders. The tracking status flow
 * complements the PO status flow (spec section 20):
 *   Pending → Shipped → In Transit → (At Customs) → Out for Delivery → Delivered
 *   + Delayed, Lost as alternative statuses
 *
 * Features:
 * - Shipment tracking with carrier, tracking number, current location, ETA
 * - Status flow visualization and one-click advance
 * - Multi-property scoping via currentPropertyId
 * - Search and status filter
 * - Detail view with tracking history
 * - KPIs: In Transit, Delivered, Delayed
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck, Plus, RefreshCw, Loader2, MapPin, Search,
  AlertCircle, Eye, ArrowRight, Package, CheckCircle2, Clock,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchPOTracking, createPOTracking, updatePOTracking, fetchPurchaseOrders,
  type POTracking, type TrackingStatus, type PurchaseOrder,
} from '../../services/procurementService';

const STATUS_FLOW: TrackingStatus[] = [
  'Pending', 'Shipped', 'In Transit', 'At Customs', 'Out for Delivery', 'Delivered',
];
const ALT_STATUSES: TrackingStatus[] = ['Delayed', 'Lost'];

const STATUS_TONE: Record<TrackingStatus, StatusTone> = {
  Pending: 'neutral', Shipped: 'info', 'In Transit': 'info', 'At Customs': 'warning',
  'Out for Delivery': 'info', Delivered: 'success', Delayed: 'danger', Lost: 'danger',
};

const NEXT_STATUS: Record<TrackingStatus, TrackingStatus | null> = {
  Pending: 'Shipped', Shipped: 'In Transit', 'In Transit': 'Out for Delivery',
  'At Customs': 'Out for Delivery', 'Out for Delivery': 'Delivered',
  Delivered: null, Delayed: 'In Transit', Lost: null,
};

const ACTION_LABELS: Record<TrackingStatus, string> = {
  Pending: 'Mark Shipped',
  Shipped: 'Mark In Transit',
  'In Transit': 'Mark Out for Delivery',
  'At Customs': 'Clear Customs',
  'Out for Delivery': 'Mark Delivered',
  Delivered: 'Delivered',
  Delayed: 'Resume Transit',
  Lost: 'Lost',
};

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const POTrackingModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [tracking, setTracking] = useState<POTracking[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<POTracking | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | TrackingStatus>('All');
  const [form, setForm] = useState({ poId: '', trackingNumber: '', carrier: '', estimatedArrival: '', currentLocation: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trackData, poData] = await Promise.all([
        fetchPOTracking(),
        fetchPurchaseOrders({ propertyId: currentPropertyId || undefined }),
      ]);
      setTracking(trackData.tracking);
      setPos(poData.purchaseOrders);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tracking data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return tracking.filter((t) => {
      if (statusFilter !== 'All' && t.tracking_status !== statusFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || (t.proc_purchase_orders?.po_number || '').toLowerCase().includes(q) || (t.tracking_number || '').toLowerCase().includes(q) || (t.carrier || '').toLowerCase().includes(q);
    });
  }, [tracking, search, statusFilter]);

  const submitCreate = async () => {
    if (!form.poId) {
      addNotification('Please select a purchase order', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { tracking: newTrack } = await createPOTracking({
        poId: form.poId,
        trackingNumber: form.trackingNumber || undefined,
        carrier: form.carrier || undefined,
        estimatedArrival: form.estimatedArrival || undefined,
        currentLocation: form.currentLocation || undefined,
      });
      setTracking((prev) => [newTrack, ...prev]);
      addNotification('Tracking record created', 'task', 'Procurement');
      setShowForm(false);
      setForm({ poId: '', trackingNumber: '', carrier: '', estimatedArrival: '', currentLocation: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create tracking', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const advance = async (id: string, currentStatus: TrackingStatus) => {
    const next = NEXT_STATUS[currentStatus];
    if (!next) return;
    setActingOn(id);
    try {
      const updateData: any = { trackingStatus: next };
      if (next === 'Delivered') updateData.actualArrival = new Date().toISOString().split('T')[0];
      const { tracking: updated } = await updatePOTracking(id, updateData);
      setTracking((prev) => prev.map((t) => (t.id === id ? updated : t)));
      addNotification(`Shipment → ${next}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update status', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const markDelayed = async (id: string) => {
    setActingOn(id);
    try {
      const { tracking: updated } = await updatePOTracking(id, { trackingStatus: 'Delayed' });
      setTracking((prev) => prev.map((t) => (t.id === id ? updated : t)));
      addNotification('Shipment marked as delayed', 'warning', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to mark delayed', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    inTransit: tracking.filter((t) => t.tracking_status === 'In Transit' || t.tracking_status === 'Shipped' || t.tracking_status === 'Out for Delivery').length,
    delivered: tracking.filter((t) => t.tracking_status === 'Delivered').length,
    delayed: tracking.filter((t) => t.tracking_status === 'Delayed').length,
    pending: tracking.filter((t) => t.tracking_status === 'Pending').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="PO Tracking"
        subtitle="Shipment and delivery tracking for purchase orders."
        icon={Truck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Tracking
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
        <StatCard title="Pending" value={counts.pending} icon={Clock} tone="neutral" />
        <StatCard title="In Transit" value={counts.inTransit} icon={Truck} tone="info" />
        <StatCard title="Delivered" value={counts.delivered} icon={CheckCircle2} tone="success" />
        <StatCard title="Delayed" value={counts.delayed} icon={AlertCircle} tone="danger" />
      </div>

      {/* Status Flow (spec section 20) */}
      <SectionCard title="Shipment Lifecycle" subtitle="Tracking status flow" icon={ArrowRight} pad="md">
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
            <input className={inputClass + ' pl-10'} placeholder="Search by PO number, tracking #, carrier..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[180px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
            {ALT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Shipments List */}
      <SectionCard title="Shipments" subtitle={`${filtered.length} shipment${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <Truck className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No shipments tracked</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((t) => (
              <div key={t.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[t.tracking_status]}>{t.tracking_status}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.proc_purchase_orders?.po_number || t.po_id}</p>
                    {t.tracking_number && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Tracking: {t.tracking_number} · {t.carrier || '—'}</p>}
                    {t.current_location && <p className="text-xs text-gray-400 dark:text-gray-500 truncate flex items-center gap-1"><MapPin className="w-3 h-3" />{t.current_location}</p>}
                    {t.estimated_arrival && <p className="text-xs text-gray-400 dark:text-gray-500">ETA: {t.estimated_arrival}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setViewing(t)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View Details">
                    <Eye className="w-4 h-4" />
                  </button>
                  {NEXT_STATUS[t.tracking_status] && (
                    <button onClick={() => advance(t.id, t.tracking_status)} disabled={actingOn === t.id} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                      {ACTION_LABELS[t.tracking_status]}
                    </button>
                  )}
                  {t.tracking_status !== 'Delivered' && t.tracking_status !== 'Lost' && t.tracking_status !== 'Delayed' && (
                    <button onClick={() => markDelayed(t.id)} disabled={actingOn === t.id} className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                      Mark Delayed
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="Add Shipment Tracking" size="lg" loading={submitting} confirmLabel="Add Tracking" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Purchase Order *</label>
            <select className={inputClass} value={form.poId} onChange={(e) => setForm({ ...form, poId: e.target.value })}>
              <option value="">Select PO...</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number} · {p.department}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Tracking Number</label>
              <input className={inputClass} value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} placeholder="Carrier tracking number" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Carrier</label>
              <input className={inputClass} value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder="e.g. DHL, FedEx" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Estimated Arrival</label>
              <input type="date" className={inputClass} value={form.estimatedArrival} onChange={(e) => setForm({ ...form, estimatedArrival: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Current Location</label>
              <input className={inputClass} value={form.currentLocation} onChange={(e) => setForm({ ...form, currentLocation: e.target.value })} placeholder="e.g. Addis Ababa Hub" />
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Shipment Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">PO Number</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_purchase_orders?.po_number || viewing.po_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.tracking_status]}>{viewing.tracking_status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Tracking Number</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.tracking_number || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Carrier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.carrier || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Current Location</p><p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{viewing.current_location || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Estimated Arrival</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.estimated_arrival || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Actual Arrival</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.actual_arrival || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Shipped Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.shipped_date || '—'}</p></div>
            </div>

            {viewing.notes && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p></div>
            )}

            {/* Tracking history */}
            {viewing.proc_tracking_events && viewing.proc_tracking_events.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase mb-2">Tracking History</p>
                <div className="space-y-2">
                  {viewing.proc_tracking_events.map((event, i) => (
                    <div key={event.id || i} className="p-3 border border-gray-200 dark:border-slate-700 rounded-xl flex justify-between items-start">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{event.event_type || event.status}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{event.location || '—'}</p>
                          {event.notes && <p className="text-xs text-gray-400 mt-1">{event.notes}</p>}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">{event.event_date || event.created_at}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              {NEXT_STATUS[viewing.tracking_status] && (
                <button onClick={() => { advance(viewing.id, viewing.tracking_status); setViewing(null); }} disabled={actingOn === viewing.id} className={button.primary}>
                  {ACTION_LABELS[viewing.tracking_status]}
                </button>
              )}
              {viewing.tracking_status !== 'Delivered' && viewing.tracking_status !== 'Lost' && viewing.tracking_status !== 'Delayed' && (
                <button onClick={() => { markDelayed(viewing.id); setViewing(null); }} disabled={actingOn === viewing.id} className="text-sm bg-amber-600 text-white px-4 py-2 rounded-xl hover:bg-amber-700">
                  Mark Delayed
                </button>
              )}
            </div>
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default POTrackingModule;
