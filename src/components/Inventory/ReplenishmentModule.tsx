/**
 * Replenishment — /erp/inventory/replenishment
 * Central Inventory view: receives replenishment requests from departments,
 * reviews and fulfills them from Main Warehouse.
 *
 * Department-side flow (auto-calculate → draft → approve & send) is handled
 * in DepartmentReplenishmentPanel.tsx, embedded in each department's inventory module.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, Clock, Loader2, ServerCrash, MoreVertical,
  CheckCircle2, ShoppingCart, AlertTriangle, Truck,
  FileText, Warehouse,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchReplenishment, updateReplenishment, type UinvReplenishment,
  fetchStores, fetchItems, type UinvStore, type UinvItem,
  fulfillReplenishment,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';
import { PullsTab, ProcurementTab } from './OperationalEnhancementsModule';
import CentralStoreDynamicParPanel from './CentralStoreDynamicParPanel';

// Central Inventory sees requests that departments have already approved and sent.
// Status flow: Requested (from dept) → Fulfilled (Central fulfills) → Cancelled
const STATUS_FLOW = ['Requested', 'Fulfilled', 'Cancelled'] as const;
type ReplStatus = typeof STATUS_FLOW[number];
const NEXT_ACTIONS: Record<ReplStatus, string[]> = {
  'Requested': ['Fulfill from Central', 'Reject'],
  'Fulfilled': [],
  'Cancelled': [],
};
const STATUS_TONE: Record<ReplStatus, keyof typeof statusTone> = {
  'Requested': 'info', 'Fulfilled': 'success', 'Cancelled': 'danger',
};

const ReplenishmentModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [records, setRecords] = useState<UinvReplenishment[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'All' | ReplStatus>('All');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  // Ops enhancement panels (Pulls, Procurement)
  const [showPullsPanel, setShowPullsPanel] = useState(false);
  const [showProcurementPanel, setShowProcurementPanel] = useState(false);
  // Central store dynamic par panel
  const [showCentralParPanel, setShowCentralParPanel] = useState(false);

  // Notify wrapper for sub-tab components (which expect a 2-arg notify)
  const notify = useCallback((msg: string, type: 'success' | 'warning' = 'success') => {
    addNotification?.(msg, type, 'Inventory');
  }, [addNotification]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, s, it] = await Promise.all([
        fetchReplenishment({ propertyId: currentPropertyId || undefined }),
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      // Central only sees requests that departments have sent (not Drafts)
      setRecords((data || []).filter(r => r.status !== 'Draft' && r.status !== 'Suggested'));
      setStores(s);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || 'Failed to load replenishment');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const fulfillRequest = async (r: UinvReplenishment) => {
    setFulfillingId(r.id);
    setMenuOpen(null);
    try {
      const result = await fulfillReplenishment(r.id);
      addNotification(
        `Fulfilled: ${result.quantity} units via ${result.transferNumber}. Stock transferred from Main Warehouse → ${r.store?.store_name || 'department'}.`,
        'success',
        'Inventory',
      );
      if (result.procurementTriggered && result.procurementMessage) {
        addNotification(result.procurementMessage, 'warning', 'Inventory');
      }
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to fulfill request', 'warning', 'Inventory');
    } finally { setFulfillingId(null); }
  };

  const filtered = useMemo(() => {
    return records.filter(r => statusFilter === 'All' || r.status === statusFilter);
  }, [records, statusFilter]);

  const kpis = useMemo(() => ({
    requested: records.filter(r => r.status === 'Requested').length,
    fulfilled: records.filter(r => r.status === 'Fulfilled' || r.status === 'Received').length,
    cancelled: records.filter(r => r.status === 'Cancelled').length,
  }), [records]);

  const advance = async (r: UinvReplenishment, action: string) => {
    setActingOn(r.id); setMenuOpen(null);
    // "Fulfill from Central" is a special action that creates a transfer
    if (action === 'Fulfill from Central') {
      await fulfillRequest(r);
      setActingOn(null);
      return;
    }
    const transitions: Record<string, ReplStatus> = {
      'Reject': 'Cancelled',
    };
    const newStatus = transitions[action];
    if (!newStatus) return;
    try {
      const updated = await updateReplenishment(r.id, {
        status: newStatus,
        notes: (r.notes || '') + ` | Rejected by Central Inventory.`,
      });
      setRecords(prev => prev.map(x => (x.id === r.id ? updated : x)));
      addNotification(`Replenishment request ${newStatus === 'Cancelled' ? 'rejected' : '→ ' + newStatus}.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'warning', 'Inventory');
    } finally { setActingOn(null); }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Replenishment — Central Fulfillment"
        subtitle="Replenishment requests received from departments. Review and fulfill from Main Warehouse."
        icon={TrendingUp}
        actions={
          <div className="flex items-center flex-wrap gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={() => setShowPullsPanel(!showPullsPanel)}
              className={button.secondary + (showPullsPanel ? ' ring-2 ring-purple-400' : '')}>
              <TrendingUp className="w-4 h-4" /> Pulls
            </button>
            <button onClick={() => setShowProcurementPanel(!showProcurementPanel)}
              className={button.secondary + (showProcurementPanel ? ' ring-2 ring-rose-400' : '')}>
              <FileText className="w-4 h-4" /> Procurement
            </button>
            <button onClick={() => setShowCentralParPanel(!showCentralParPanel)}
              className={button.secondary + (showCentralParPanel ? ' ring-2 ring-indigo-400' : '')}>
              <Warehouse className="w-4 h-4" /> Central Par
            </button>
          </div>
        }
      />

      {/* Replenishment Pulls Panel (Central = separate stock model) */}
      {showPullsPanel && (
        <PullsTab stores={stores} items={items} propertyId={currentPropertyId} notify={notify} />
      )}

      {/* Procurement Auto-Trigger Panel (Low central stock → PR) */}
      {showProcurementPanel && (
        <ProcurementTab propertyId={currentPropertyId} notify={notify} />
      )}

      {/* Central Store Dynamic Par Panel (ROP = D_Total × LT_Vendor + SS_Central) */}
      {showCentralParPanel && (
        <CentralStoreDynamicParPanel />
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Requested" value={kpis.requested} icon={ShoppingCart} tone="info" caption="From departments" />
        <StatCard title="Fulfilled" value={kpis.fulfilled} icon={CheckCircle2} tone="success" />
        <StatCard title="Cancelled/Rejected" value={kpis.cancelled} icon={AlertTriangle} tone="danger" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

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

      <InventoryTable
        rows={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        loadingMessage="Loading…"
        error={error}
        onRetry={load}
        emptyMessage="No replenishment requests from departments."
        columns={[
          {
            key: 'suggestion',
            header: 'Replenishment',
            widthClass: 'md:w-48 shrink-0',
            render: (r) => {
              const tone = STATUS_TONE[r.status as ReplStatus] || 'neutral';
              return (
                <IdentityCell
                  icon={<TrendingUp className="w-5 h-5" />}
                  soft={statusTone[tone].soft}
                  text={statusTone[tone].text}
                  name={r.replenishment_number || `REQ-${r.id.slice(-6).toUpperCase()}`}
                  code={r.urgency ? `Urgency: ${r.urgency}` : ''}
                />
              );
            },
          },
          {
            key: 'item',
            header: 'Item',
            widthClass: 'md:w-56 shrink-0',
            render: (r) => (
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white truncate">{r.item?.item_name || 'Unknown item'}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{r.item?.item_code || r.item_id} · {r.item?.unit_of_measure || ''}</span>
              </div>
            ),
          },
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-40 shrink-0',
            render: (r) => r.store ? (
              <div className="min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{r.store.store_name}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{r.store.store_code}</span>
              </div>
            ) : <span className="text-slate-400 text-sm">Any store</span>,
          },
          {
            key: 'currentStock',
            header: 'Current',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (r) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{r.current_stock}</span>,
          },
          {
            key: 'reorderPoint',
            header: 'Reorder',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (r) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{r.reorder_point}</span>,
          },
          {
            key: 'parLevel',
            header: 'Par',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (r) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{r.par_level}</span>,
          },
          {
            key: 'suggestedQty',
            header: 'Suggested',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (r) => <span className="text-slate-700 dark:text-slate-300 tabular-nums font-medium">{r.suggested_qty}</span>,
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (r) => r.notes ? <span className="text-slate-500 dark:text-slate-400 text-sm italic">{r.notes}</span> : <span className="text-slate-400">—</span>,
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-28 shrink-0',
            render: (r) => {
              const tone = STATUS_TONE[r.status as ReplStatus] || 'neutral';
              return <Badge tone={tone} variant="solid">{r.status}</Badge>;
            },
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (r) => {
              const actions = NEXT_ACTIONS[r.status as ReplStatus] || [];
              if (actions.length === 0) return null;
              const isBusy = actingOn === r.id || fulfillingId === r.id;
              return (
                <OpsCell>
                  <div className="relative">
                    <IconButton onClick={() => setMenuOpen(menuOpen === r.id ? null : r.id)} title="Actions" disabled={isBusy}>
                      {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                    </IconButton>
                    {menuOpen === r.id && !isBusy && (
                      <div className="absolute right-0 top-full mt-1 z-10 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                        {actions.map(a => (
                          <button key={a} onClick={() => advance(r, a)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                            {a === 'Fulfill from Central' ? <Truck className="w-4 h-4 text-emerald-600" /> : <CheckCircle2 className="w-4 h-4" />} {a}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </OpsCell>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default ReplenishmentModule;
