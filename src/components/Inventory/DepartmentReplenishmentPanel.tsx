/**
 * Department Replenishment Panel — embedded in department inventory modules.
 *
 * Department-side request-driven flow:
 *   1. Auto-Calculate — scans department stores for items at/below reorder point,
 *      calculates what's needed from Central, creates Draft requests.
 *   2. Department reviews Drafts → approves → sends to Central Inventory
 *      (status becomes 'Requested').
 *   3. Central Inventory fulfills from Main Warehouse (status becomes 'Fulfilled').
 *
 * Uses the unified uinv_replenishment table with department-scoped store filtering.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Zap, Truck, Package, AlertTriangle, CheckCircle, XCircle,
  Loader2, Clock, Send, FileText,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchStores, fetchItems, fetchReplenishment,
  generateReplenishmentRequests, updateReplenishment,
  type UinvStore, type UinvItem, type UinvReplenishment,
} from '../../services/inventoryService';

/** Department name → store match predicate (same as DepartmentParOverridesPanel). */
const STORE_MATCHERS: Record<string, (s: UinvStore) => boolean> = {
  Engineering: s =>
    s.department === 'Engineering' ||
    /^UINV-ST-ENG$/i.test(s.store_code) ||
    /engineering/i.test(s.store_name),
  Housekeeping: s =>
    s.department === 'Housekeeping' ||
    /^UINV-ST-HK$/i.test(s.store_code) ||
    /^UINV-ST-LINEN$/i.test(s.store_code) ||
    /housekeeping/i.test(s.store_name) ||
    /linen/i.test(s.store_name),
  'Food & Beverage': s =>
    s.department === 'Food & Beverage' ||
    /^UINV-ST-FOOD$/i.test(s.store_code) ||
    /^UINV-ST-BEV$/i.test(s.store_code) ||
    /food store/i.test(s.store_name) ||
    /beverage store/i.test(s.store_name),
  'Banquet & Events': s =>
    s.department === 'Banquet & Events' ||
    /^UINV-ST-BANQ$/i.test(s.store_code) ||
    /banquet/i.test(s.store_name) ||
    /event/i.test(s.store_name),
  'Spa & Wellness': s =>
    s.department === 'Spa & Wellness' ||
    /^UINV-ST-SPA$/i.test(s.store_code) ||
    /spa/i.test(s.store_name),
};

// Status flow for department-side requests
const STATUS_FLOW = ['Draft', 'Requested', 'Fulfilled', 'Cancelled'] as const;
type ReplStatus = typeof STATUS_FLOW[number];
const STATUS_TONE: Record<ReplStatus, keyof typeof statusTone> = {
  'Draft': 'neutral', 'Requested': 'info', 'Fulfilled': 'success', 'Cancelled': 'danger',
};

interface Props {
  department: string;
  hideStats?: boolean;
  hideHeader?: boolean;
  /** Increment to trigger a refresh from parent */
  refreshTrigger?: number;
  /** Increment to trigger auto-calculate from parent */
  autoReplenishTrigger?: number;
}

const DepartmentReplenishmentPanel: React.FC<Props> = ({ department, hideStats, hideHeader, refreshTrigger, autoReplenishTrigger }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [records, setRecords] = useState<UinvReplenishment[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'All' | ReplStatus>('All');

  const notify = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    addNotification?.(msg, type, department);
  }, [addNotification, department]);

  // ── Load department stores + replenishment records ──────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allStores, allRecords, allItems] = await Promise.all([
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
        fetchReplenishment({ propertyId: currentPropertyId || undefined }),
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      const matcher = STORE_MATCHERS[department];
      const deptStores = matcher
        ? (allStores || []).filter(matcher)
        : (allStores || []).filter(s => s.department === department);
      setStores(deptStores);
      setItems(allItems || []);
      // Filter replenishment records to this department's stores
      const deptStoreIds = new Set(deptStores.map(s => s.id));
      setRecords((allRecords || []).filter(r => r.store_id && deptStoreIds.has(r.store_id)));
    } catch (e: any) {
      notify(e?.message || 'Failed to load replenishment data', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, department, notify]);

  useEffect(() => { load(); }, [load]);

  // External trigger: refresh
  useEffect(() => { if (refreshTrigger && refreshTrigger > 0) load(); }, [refreshTrigger]);
  // External trigger: auto-calculate
  useEffect(() => { if (autoReplenishTrigger && autoReplenishTrigger > 0) handleAutoCalculate(); }, [autoReplenishTrigger]);

  // ── Auto-Calculate: scan dept stores, create Draft requests ─────────
  const handleAutoCalculate = async () => {
    setCalculating(true);
    try {
      const result = await generateReplenishmentRequests(currentPropertyId || undefined);
      notify(
        result.generated > 0
          ? `${result.generated} draft request(s) auto-calculated from reorder points. Review and approve to send to Central Inventory.`
          : 'No new draft requests — all department stores are above their reorder points.',
        result.generated > 0 ? 'success' : 'info',
      );
      await load();
    } catch (e: any) {
      notify(e?.message || 'Failed to auto-calculate requests', 'error');
    } finally {
      setCalculating(false);
    }
  };

  // ── Approve & Send to Central ───────────────────────────────────────
  const handleApproveSend = async (r: UinvReplenishment) => {
    setActingId(r.id);
    try {
      const updated = await updateReplenishment(r.id, {
        status: 'Requested',
        notes: (r.notes || '') + ` | Approved and sent to Central Inventory by department.`,
      });
      setRecords(prev => prev.map(x => (x.id === r.id ? updated : x)));
      notify(`Request sent to Central Inventory.`, 'success');
    } catch (e: any) {
      notify(e?.message || 'Failed to send request', 'error');
    } finally {
      setActingId(null);
    }
  };

  // ── Cancel ──────────────────────────────────────────────────────────
  const handleCancel = async (r: UinvReplenishment) => {
    setActingId(r.id);
    try {
      const updated = await updateReplenishment(r.id, { status: 'Cancelled' });
      setRecords(prev => prev.map(x => (x.id === r.id ? updated : x)));
      notify('Request cancelled.', 'info');
    } catch (e: any) {
      notify(e?.message || 'Failed to cancel request', 'error');
    } finally {
      setActingId(null);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return records.filter(r => statusFilter === 'All' || r.status === statusFilter);
  }, [records, statusFilter]);

  const kpis = useMemo(() => ({
    draft: records.filter(r => r.status === 'Draft').length,
    requested: records.filter(r => r.status === 'Requested').length,
    fulfilled: records.filter(r => r.status === 'Fulfilled' || r.status === 'Received').length,
    cancelled: records.filter(r => r.status === 'Cancelled').length,
  }), [records]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading {department} replenishment…</span>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <SectionCard title={`${department} Replenishment`} subtitle="No department stores found">
        <p className="text-sm text-slate-500 py-6 text-center">
          No {department} stores are configured yet. Replenishment requires department-specific stores in the unified inventory.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className={layout.sectionStack + ' animate-fade-in'}>
      {!hideHeader && (
      <PageHeader
        title={`${department} Replenishment`}
        subtitle="Auto-calculate from reorder points → approve → send request to Central Inventory for fulfillment."
        icon={Zap}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
            </button>
            <button onClick={handleAutoCalculate} disabled={calculating}
              className={button.primary + ' disabled:opacity-50'}>
              {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {calculating ? 'Calculating…' : 'Auto-Calculate Requests'}
            </button>
          </div>
        }
      />
      )}

      {/* Stats */}
      {!hideStats && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">Draft (Pending Approval)</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">{kpis.draft}</p>
            </div>
            <div className="shrink-0 p-2.5 rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/20">
              <FileText className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">Sent to Central</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">{kpis.requested}</p>
            </div>
            <div className="shrink-0 p-2.5 rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/20">
              <Send className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">Fulfilled</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">{kpis.fulfilled}</p>
            </div>
            <div className="shrink-0 p-2.5 rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20">
              <Package className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">Cancelled</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">{kpis.cancelled}</p>
            </div>
            <div className="shrink-0 p-2.5 rounded-xl bg-red-100 text-red-600 dark:bg-red-900/20">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Status filter */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {(['All', ...STATUS_FLOW] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={['px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                statusFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
              {f}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Replenishment requests table */}
      <SectionCard
        title="Replenishment Requests"
        subtitle="Auto-calculated from your department stock levels. Approve drafts to send to Central Inventory."
      >
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Store</th>
                  <th className="px-4 py-3 font-medium text-right">On Hand</th>
                  <th className="px-4 py-3 font-medium text-right">Reorder</th>
                  <th className="px-4 py-3 font-medium text-right">Par</th>
                  <th className="px-4 py-3 font-medium text-right">Requested Qty</th>
                  <th className="px-4 py-3 font-medium">Urgency</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filtered.map(r => {
                  const tone = STATUS_TONE[r.status as ReplStatus] || 'neutral';
                  const isBusy = actingId === r.id;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        {r.item?.item_name || 'Unknown'}
                        <div className="text-xs text-slate-400">{r.item?.item_code || r.item_id}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {r.store?.store_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-bold tabular-nums ${Number(r.current_stock) <= Number(r.reorder_point) ? 'text-red-600' : 'text-slate-600 dark:text-slate-400'}`}>
                          {r.current_stock}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 tabular-nums">{r.reorder_point}</td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 tabular-nums">{r.par_level}</td>
                      <td className="px-4 py-3 text-right font-medium text-indigo-600 dark:text-indigo-400 tabular-nums">{r.suggested_qty}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${
                          r.urgency === 'Urgent' ? 'text-red-600'
                          : r.urgency === 'High' ? 'text-amber-600'
                          : 'text-slate-500'
                        }`}>
                          {r.urgency || 'Normal'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={tone} variant="solid">{r.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                          {!isBusy && r.status === 'Draft' && (
                            <>
                              <button
                                title="Approve & Send to Central"
                                onClick={() => handleApproveSend(r)}
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                              <button
                                title="Cancel"
                                onClick={() => handleCancel(r)}
                                className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {!isBusy && r.status === 'Requested' && (
                            <button
                              title="Cancel Request"
                              onClick={() => handleCancel(r)}
                              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {!isBusy && (r.status === 'Fulfilled' || r.status === 'Received') && (
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">
              No replenishment requests for {department}. Click "Auto-Calculate Requests" to scan your stock levels.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default DepartmentReplenishmentPanel;
