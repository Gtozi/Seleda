/**
 * Stock Control — Adjustments only.
 * DB-integrated via /api/uinv-portal/adjustments.
 * Stock adjustments per spec §10.
 *
 * Note: Reservations & Allocations are managed in the dedicated
 * ReservationsModule (/erp/inventory/reservations) — they were
 * previously a duplicate tab here and have been removed.
 *
 * Create forms are DB-integrated:
 *   - Item/store dropdowns populated from uinv_items / uinv_stores
 *   - Adjustment form includes adjustment type, quantity delta, unit cost
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Scale, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  CheckCircle2, XCircle, Trash2, Package,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchAdjustments, createAdjustment, createAdjustmentBulk, updateAdjustment, type UinvAdjustment,
  fetchStores, fetchItems, fetchStock, type UinvStore, type UinvItem, type UinvStockBalance,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const ADJ_REASONS = ['Stock Count Variance', 'Damage', 'Shrinkage', 'System Correction', 'Initial Stock', 'Return to Supplier', 'Other'];
const ADJ_TYPES = ['Quantity Increase', 'Quantity Decrease', 'Revaluation', 'Status Change'];

const emptyAdjForm = () => ({
  store_id: '', adjustment_type: 'Quantity Increase',
  adjustment_date: new Date().toISOString().slice(0, 10),
  reason: 'Stock Count Variance', notes: '',
});
const emptyAdjLine = () => ({ item_id: '', quantity_delta: 0, unit_cost: 0 });

const StockControlModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [adjustments, setAdjustments] = useState<UinvAdjustment[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [adjForm, setAdjForm] = useState<any>(emptyAdjForm());
  const [adjLines, setAdjLines] = useState<any[]>([emptyAdjLine()]);
  const [stockBalances, setStockBalances] = useState<UinvStockBalance[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, s, it] = await Promise.all([
        fetchAdjustments({ propertyId: currentPropertyId || undefined }),
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      setAdjustments(a);
      setStores(s);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || 'Failed to load stock control data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const statuses = useMemo(() => Array.from(new Set(adjustments.map((x: any) => x.status))), [adjustments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return adjustments.filter((x: any) => {
      const matchesStatus = statusFilter === 'All' || x.status === statusFilter;
      const num = x.adjustment_number;
      const subText = x.reason;
      const matchesSearch = !q || (num || '').toLowerCase().includes(q) || (subText || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [adjustments, search, statusFilter]);

  const counts = useMemo(() => ({
    pendingAdj: adjustments.filter(a => a.status === 'Draft' || a.status === 'Pending').length,
    approvedAdj: adjustments.filter(a => a.status === 'Approved').length,
    rejectedAdj: adjustments.filter(a => a.status === 'Rejected').length,
    totalAdj: adjustments.length,
  }), [adjustments]);

  const onAdjItemChange = (itemId: string, index: number) => {
    const it = items.find(x => x.id === itemId);
    const stock = stockBalances.find(s => s.item_id === itemId);
    setAdjLines(prev => prev.map((l, i) => i === index ? {
      ...l,
      item_id: itemId,
      unit_cost: Number(stock?.unit_cost || it?.last_cost || 0),
    } : l));
  };

  // When the adjustment store changes, load stock balances for that store
  const onAdjStoreChange = async (storeId: string) => {
    setAdjForm((f: any) => ({ ...f, store_id: storeId }));
    if (storeId) {
      try {
        const stock = await fetchStock({ propertyId: currentPropertyId || undefined, storeId });
        setStockBalances(stock);
      } catch { setStockBalances([]); }
    } else {
      setStockBalances([]);
    }
  };

  const addAdjLine = () => setAdjLines(prev => [...prev, emptyAdjLine()]);
  const removeAdjLine = (index: number) => setAdjLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  const updateAdjLine = (index: number, field: string, value: any) =>
    setAdjLines(prev => prev.map((l, i) => i === index ? { ...l, [field]: value } : l));

  const submitAdj = async () => {
    if (!adjForm.store_id) {
      addNotification('Store is required.', 'warning', 'Inventory');
      return;
    }
    const validLines = adjLines.filter(l => l.item_id && Number(l.quantity_delta));
    if (validLines.length === 0) {
      addNotification('Add at least one item with a non-zero quantity.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      if (validLines.length === 1) {
        // Single line — use regular endpoint
        const line = validLines[0];
        const delta = Number(line.quantity_delta);
        const valueDelta = delta * Number(line.unit_cost || 0);
        const created = await createAdjustment({
          ...adjForm,
          property_id: currentPropertyId,
          item_id: line.item_id,
          quantity_delta: delta,
          unit_cost: Number(line.unit_cost || 0),
          value_delta: valueDelta,
        });
        setAdjustments(prev => [created, ...prev]);
        addNotification(`Adjustment ${created.adjustment_number} created.`, 'success', 'Inventory');
      } else {
        // Multiple lines — use bulk endpoint
        const created = await createAdjustmentBulk({
          store_id: adjForm.store_id,
          reason: adjForm.reason,
          adjustment_type: adjForm.adjustment_type,
          notes: adjForm.notes,
          property_id: currentPropertyId,
          lines: validLines.map(l => ({
            item_id: l.item_id,
            quantity_delta: Number(l.quantity_delta),
            unit_cost: Number(l.unit_cost || 0),
          })),
        });
        setAdjustments(prev => [...created, ...prev]);
        addNotification(`${created.length} adjustments created.`, 'success', 'Inventory');
      }
      setShowForm(false);
      setAdjForm(emptyAdjForm());
      setAdjLines([emptyAdjLine()]);
      setStockBalances([]);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create adjustment', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const advance = async (x: any, action: string) => {
    setActingOn(x.id); setMenuOpen(null);
    const transitions: Record<string, string> = {
      'Approve': 'Approved', 'Reject': 'Rejected',
    };
    const newStatus = transitions[action];
    if (!newStatus) return;
    try {
      const updated = await updateAdjustment(x.id, { status: newStatus });
      setAdjustments(prev => prev.map(a => (a.id === x.id ? updated : a)));
      addNotification(`→ ${newStatus}.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const ACTIONS: Record<string, string[]> = {
    'Draft': ['Approve', 'Reject'],
    'Pending': ['Approve', 'Reject'],
    'Approved': [],
    'Rejected': [],
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Stock Adjustments"
        subtitle="Quantity corrections, revaluations, and status changes."
        icon={Scale}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Adjustment</button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Pending" value={counts.pendingAdj} icon={Scale} tone="warning" />
        <StatCard title="Approved" value={counts.approvedAdj} icon={CheckCircle2} tone="success" />
        <StatCard title="Rejected" value={counts.rejectedAdj} icon={XCircle} tone="danger" />
        <StatCard title="Total" value={counts.totalAdj} icon={Scale} tone="neutral" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
              <option>All</option>
              {statuses.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>
        </div>
      </SectionCard>

      <InventoryTable
        rows={filtered}
        rowKey={(x: any) => x.id}
        loading={loading}
        loadingMessage="Loading…"
        error={error}
        onRetry={load}
        emptyMessage="No adjustments."
        columns={[
          {
            key: 'record',
            header: 'Adjustment',
            widthClass: 'md:w-44 shrink-0',
            render: (x: any) => {
              const tone = (x.status === 'Approved') ? 'success'
                : (x.status === 'Rejected') ? 'danger' : 'neutral';
              return (
                <IdentityCell
                  icon={<Scale size={20} />}
                  soft={statusTone[tone as keyof typeof statusTone].soft}
                  text={statusTone[tone as keyof typeof statusTone].text}
                  name={x.adjustment_number}
                  code={x.adjustment_type}
                />
              );
            },
          },
          {
            key: 'item',
            header: 'Item',
            widthClass: 'md:w-52 shrink-0',
            render: (x: any) => (
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white truncate">{x.item?.item_name || 'Unknown item'}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{x.item?.item_code || x.item_id} · {x.item?.unit_of_measure || ''}</span>
              </div>
            ),
          },
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-36 shrink-0',
            render: (x: any) => x.store ? (
              <div className="min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{x.store.store_name}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{x.store.store_code}</span>
              </div>
            ) : <span className="text-slate-400 text-sm">—</span>,
          },
          {
            key: 'reason',
            header: 'Reason',
            widthClass: 'md:w-36 shrink-0',
            render: (x: any) => <span className="text-slate-600 dark:text-slate-400 text-sm">{x.reason || '—'}</span>,
          },
          {
            key: 'qtyDelta',
            header: 'Qty Delta',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const delta = Number(x.quantity_delta || 0);
              const isIncrease = delta >= 0;
              return (
                <span className={`tabular-nums font-medium ${isIncrease ? 'text-emerald-600' : 'text-red-500'}`}>
                  {isIncrease ? '+' : ''}{delta}
                </span>
              );
            },
          },
          {
            key: 'unitCost',
            header: 'Unit Cost',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">${Number(x.unit_cost || 0).toFixed(2)}</span>,
          },
          {
            key: 'valueDelta',
            header: 'Value Impact',
            widthClass: 'md:w-28 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const val = Number(x.value_delta || 0);
              return <span className={`tabular-nums font-medium ${val >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{val >= 0 ? '+' : ''}${val.toFixed(2)}</span>;
            },
          },
          {
            key: 'date',
            header: 'Created',
            widthClass: 'md:w-28 shrink-0',
            render: (x: any) => <span className="text-slate-600 dark:text-slate-400 text-sm">{x.created_at?.slice(0, 10)}</span>,
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (x: any) => x.notes ? <span className="text-slate-500 dark:text-slate-400 text-sm italic">{x.notes}</span> : <span className="text-slate-400">—</span>,
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-28 shrink-0',
            render: (x: any) => {
              const tone = (x.status === 'Approved') ? 'success'
                : (x.status === 'Rejected') ? 'danger' : 'neutral';
              return <Badge tone={tone as any} variant="solid">{x.status}</Badge>;
            },
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (x: any) => {
              const actions = ACTIONS[x.status] || [];
              if (actions.length === 0) return null;
              return (
                <OpsCell>
                  <div className="relative">
                    <IconButton onClick={() => setMenuOpen(menuOpen === x.id ? null : x.id)} title="Actions">
                      <MoreVertical className="w-4 h-4" />
                    </IconButton>
                    {menuOpen === x.id && (
                      <div className="absolute right-0 top-full mt-1 z-10 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                        {actions.map(a => (
                          <button key={a} onClick={() => advance(x, a)} disabled={actingOn === x.id}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                            {actingOn === x.id ? <Loader2 className="w-4 h-4 animate-spin" /> : a === 'Reject' ? <XCircle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4" />} {a}
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

      <ModalSystem isOpen={showForm} onClose={() => { setShowForm(false); setAdjLines([emptyAdjLine()]); setStockBalances([]); }} variant="form" size="xl"
        title="New Stock Adjustment" confirmLabel={`Create ${adjLines.filter(l => l.item_id && Number(l.quantity_delta)).length} Adjustment(s)`} onConfirm={submitAdj} loading={submitting} confirmColor="emerald">
        <div className="space-y-4">
          {/* Shared fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Store *">
              <select className={inputClass} value={adjForm.store_id} onChange={e => onAdjStoreChange(e.target.value)}>
                <option value="">Select store…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
              </select>
            </Field>
            <Field label="Adjustment Type">
              <select className={inputClass} value={adjForm.adjustment_type} onChange={e => setAdjForm({ ...adjForm, adjustment_type: e.target.value })}>
                {ADJ_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Reason">
              <select className={inputClass} value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })}>
                {ADJ_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Notes"><input className={inputClass} value={adjForm.notes} onChange={e => setAdjForm({ ...adjForm, notes: e.target.value })} /></Field>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items</span>
              <button onClick={addAdjLine} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700">
                <Plus className="w-3.5 h-3.5" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {adjLines.map((line, i) => {
                const item = items.find(it => it.id === line.item_id);
                const stock = stockBalances.find(s => s.item_id === line.item_id);
                const delta = Number(line.quantity_delta || 0);
                const valueImpact = delta * Number(line.unit_cost || 0);
                return (
                  <div key={i} className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <select className={inputClass} value={line.item_id} onChange={e => onAdjItemChange(e.target.value, i)}>
                          <option value="">Select item…</option>
                          {items.map(it => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>)}
                        </select>
                      </div>
                      <button onClick={() => removeAdjLine(i)} disabled={adjLines.length === 1}
                        className="p-2 text-slate-400 hover:text-red-500 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {line.item_id && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Qty Delta *</span>
                          <input type="number" step="any" className={inputClass} value={line.quantity_delta} onChange={e => updateAdjLine(i, 'quantity_delta', +e.target.value)} placeholder="0" />
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Unit Cost</span>
                          <input type="number" step="0.01" className={inputClass} value={line.unit_cost} onChange={e => updateAdjLine(i, 'unit_cost', +e.target.value)} />
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Value Impact</span>
                          <div className={`px-3 py-2 text-sm tabular-nums rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 ${valueImpact < 0 ? 'text-red-500' : valueImpact > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                            {valueImpact >= 0 ? '+' : ''}${valueImpact.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}
                    {line.item_id && (
                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        {stock && (
                          <span className="flex items-center gap-1">
                            <Package className="w-3.5 h-3.5" />
                            Current stock: <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">{Number(stock.on_hand)} {item?.unit_of_measure || ''}</span>
                          </span>
                        )}
                        {stock && delta !== 0 && (
                          <span className="text-slate-400">→</span>
                        )}
                        {stock && delta !== 0 && (
                          <span className={`font-medium tabular-nums ${delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                            New: {Math.max(0, Number(stock.on_hand) + delta)} {item?.unit_of_measure || ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          {adjLines.filter(l => l.item_id && Number(l.quantity_delta)).length > 0 && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 flex items-center justify-between text-sm">
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                {adjLines.filter(l => l.item_id && Number(l.quantity_delta)).length} item(s) ready
              </span>
              <span className="text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">
                Total impact: {adjLines.reduce((s, l) => s + (Number(l.quantity_delta || 0) * Number(l.unit_cost || 0)), 0) >= 0 ? '+' : ''}${adjLines.reduce((s, l) => s + (Number(l.quantity_delta || 0) * Number(l.unit_cost || 0)), 0).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </ModalSystem>
    </div>
  );
};

export default StockControlModule;
