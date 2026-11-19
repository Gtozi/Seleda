/**
 * Waste & Spoilage — /erp/inventory/waste
 * DB-integrated via /api/uinv-portal/waste.
 * Records of wasted/spoiled stock with reason categorization per spec §14.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Trash2, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  CheckCircle2, XCircle, Package,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchWaste, createWaste, createWasteBulk, updateWaste, type UinvWaste,
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

const WASTE_REASONS = ['Spoilage', 'Damage', 'Expired', 'Contamination', 'Breakage', 'Theft', 'Shrinkage', 'Over-production', 'Other'];
const STATUS_FLOW = ['Draft', 'Approved', 'Rejected'] as const;
type WasteStatus = typeof STATUS_FLOW[number];
const NEXT_ACTIONS: Record<WasteStatus, string[]> = {
  'Draft': ['Approve', 'Reject'], 'Approved': [], 'Rejected': [],
};
const STATUS_TONE: Record<WasteStatus, keyof typeof statusTone> = {
  'Draft': 'neutral', 'Approved': 'success', 'Rejected': 'danger',
};

const emptyForm = () => ({ store_id: '', waste_type: 'Spoilage', reason: 'Spoilage', waste_date: new Date().toISOString().slice(0, 10), notes: '' });
const emptyWasteLine = () => ({ item_id: '', quantity: 0, unit_cost: 0 });

const WasteModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [records, setRecords] = useState<UinvWaste[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | WasteStatus>('All');
  const [reasonFilter, setReasonFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm());
  const [wasteLines, setWasteLines] = useState<any[]>([emptyWasteLine()]);
  const [stockBalances, setStockBalances] = useState<UinvStockBalance[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, s, it] = await Promise.all([
        fetchWaste({ propertyId: currentPropertyId || undefined }),
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      setRecords(data);
      setStores(s);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || 'Failed to load waste records');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter(w => {
      const matchesStatus = statusFilter === 'All' || w.status === statusFilter;
      const matchesReason = reasonFilter === 'All' || w.reason === reasonFilter;
      const matchesSearch = !q || (w.waste_number || '').toLowerCase().includes(q) || (w.reason || '').toLowerCase().includes(q);
      return matchesStatus && matchesReason && matchesSearch;
    });
  }, [records, search, statusFilter, reasonFilter]);

  const kpis = useMemo(() => {
    const totalValue = records.filter(w => w.status === 'Approved').reduce((s, w) => s + (w.total_cost || 0), 0);
    return {
      total: records.length,
      pending: records.filter(w => w.status === 'Draft').length,
      approved: records.filter(w => w.status === 'Approved').length,
      totalValue,
    };
  }, [records]);

  const money = (n: number) => (formatAmount ? formatAmount(n) : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0));

  const submit = async () => {
    if (!form.store_id) {
      addNotification('Store is required.', 'warning', 'Inventory');
      return;
    }
    const validLines = wasteLines.filter(l => l.item_id && Number(l.quantity));
    if (validLines.length === 0) {
      addNotification('Add at least one item with a non-zero quantity.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      if (validLines.length === 1) {
        const line = validLines[0];
        const created = await createWaste({
          ...form,
          property_id: currentPropertyId,
          item_id: line.item_id,
          quantity: Number(line.quantity),
          unit_cost: Number(line.unit_cost || 0),
        });
        setRecords(prev => [created, ...prev]);
        addNotification(`Waste record ${created.waste_number} created.`, 'success', 'Inventory');
      } else {
        const created = await createWasteBulk({
          store_id: form.store_id,
          waste_type: form.waste_type,
          reason: form.reason,
          notes: form.notes,
          property_id: currentPropertyId,
          lines: validLines.map(l => ({
            item_id: l.item_id,
            quantity: Number(l.quantity),
            unit_cost: Number(l.unit_cost || 0),
          })),
        });
        setRecords(prev => [...created, ...prev]);
        addNotification(`${created.length} waste records created.`, 'success', 'Inventory');
      }
      setShowForm(false);
      setForm(emptyForm());
      setWasteLines([emptyWasteLine()]);
      setStockBalances([]);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create waste record', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const onItemChange = (itemId: string, index: number) => {
    const it = items.find(x => x.id === itemId);
    const stock = stockBalances.find(s => s.item_id === itemId);
    setWasteLines(prev => prev.map((l, i) => i === index ? {
      ...l,
      item_id: itemId,
      unit_cost: Number(stock?.unit_cost || it?.last_cost || 0),
    } : l));
  };

  const onStoreChange = async (storeId: string) => {
    setForm((f: any) => ({ ...f, store_id: storeId }));
    if (storeId) {
      try {
        const stock = await fetchStock({ propertyId: currentPropertyId || undefined, storeId });
        setStockBalances(stock);
      } catch { setStockBalances([]); }
    } else {
      setStockBalances([]);
    }
  };

  const addWasteLine = () => setWasteLines(prev => [...prev, emptyWasteLine()]);
  const removeWasteLine = (index: number) => setWasteLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  const updateWasteLine = (index: number, field: string, value: any) =>
    setWasteLines(prev => prev.map((l, i) => i === index ? { ...l, [field]: value } : l));

  const advance = async (w: UinvWaste, action: string) => {
    setActingOn(w.id); setMenuOpen(null);
    const newStatus = action === 'Approve' ? 'Approved' : 'Rejected';
    try {
      const updated = await updateWaste(w.id, { status: newStatus });
      setRecords(prev => prev.map(x => (x.id === w.id ? updated : x)));
      addNotification(`Waste ${w.waste_number} → ${newStatus}.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Waste & Spoilage"
        subtitle="Track and approve wasted, spoiled, or damaged stock."
        icon={Trash2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Record</button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Records" value={kpis.total} icon={Trash2} tone="accent" />
        <StatCard title="Pending Approval" value={kpis.pending} icon={Clock} tone="warning" />
        <StatCard title="Approved" value={kpis.approved} icon={CheckCircle2} tone="success" />
        <StatCard title="Waste Value" value={money(kpis.totalValue)} icon={Trash2} tone="danger" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {(['All', ...STATUS_FLOW] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={['px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  statusFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
              <option>All</option>
              {WASTE_REASONS.map(r => <option key={r}>{r}</option>)}
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
        rowKey={(w) => w.id}
        loading={loading}
        loadingMessage="Loading…"
        error={error}
        onRetry={load}
        emptyMessage="No waste records."
        columns={[
          {
            key: 'record',
            header: 'Record',
            widthClass: 'md:w-44 shrink-0',
            render: (w) => (
              <IdentityCell
                icon={<Trash2 className="w-5 h-5" />}
                soft={statusTone.danger.soft}
                text={statusTone.danger.text}
                name={w.waste_number}
                code={w.waste_type}
              />
            ),
          },
          {
            key: 'item',
            header: 'Item',
            widthClass: 'md:w-56 shrink-0',
            render: (w) => (
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white truncate">{w.item?.item_name || 'Unknown item'}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{w.item?.item_code || w.item_id} · {w.item?.unit_of_measure || ''}</span>
              </div>
            ),
          },
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-40 shrink-0',
            render: (w) => w.store ? (
              <div className="min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{w.store.store_name}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{w.store.store_code}</span>
              </div>
            ) : <span className="text-slate-400 text-sm">—</span>,
          },
          {
            key: 'reason',
            header: 'Reason',
            widthClass: 'md:w-36 shrink-0',
            render: (w) => w.reason ? <span className="text-slate-600 dark:text-slate-400 text-sm">{w.reason}</span> : <span className="text-slate-400">—</span>,
          },
          {
            key: 'date',
            header: 'Date',
            widthClass: 'md:w-28 shrink-0',
            render: (w) => <span className="text-slate-600 dark:text-slate-400 text-sm">{w.created_at?.slice(0, 10)}</span>,
          },
          {
            key: 'qty',
            header: 'Qty',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (w) => <span className="text-slate-700 dark:text-slate-300 tabular-nums font-medium">{w.quantity}</span>,
          },
          {
            key: 'value',
            header: 'Value',
            widthClass: 'md:w-28 shrink-0',
            align: 'right',
            render: (w) => <span className="text-slate-700 dark:text-slate-300 tabular-nums font-medium">{money(w.total_cost || 0)}</span>,
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (w) => w.notes ? <span className="text-slate-500 dark:text-slate-400 text-sm italic">{w.notes}</span> : <span className="text-slate-400">—</span>,
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-28 shrink-0',
            render: (w) => {
              const tone = STATUS_TONE[w.status as WasteStatus] || 'neutral';
              return <Badge tone={tone} variant="solid">{w.status}</Badge>;
            },
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (w) => {
              const actions = NEXT_ACTIONS[w.status as WasteStatus] || [];
              if (actions.length === 0) return null;
              return (
                <OpsCell>
                  <div className="relative">
                    <IconButton onClick={() => setMenuOpen(menuOpen === w.id ? null : w.id)} title="Actions">
                      <MoreVertical className="w-4 h-4" />
                    </IconButton>
                    {menuOpen === w.id && (
                      <div className="absolute right-0 top-full mt-1 z-10 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                        {actions.map(a => (
                          <button key={a} onClick={() => advance(w, a)} disabled={actingOn === w.id}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                            {actingOn === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : a === 'Reject' ? <XCircle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4" />} {a}
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

      <ModalSystem isOpen={showForm} onClose={() => { setShowForm(false); setWasteLines([emptyWasteLine()]); setStockBalances([]); }} variant="form" size="xl"
        title="New Waste Record" confirmLabel={`Create ${wasteLines.filter(l => l.item_id && Number(l.quantity)).length} Record(s)`} onConfirm={submit} loading={submitting} confirmColor="emerald">
        <div className="space-y-4">
          {/* Shared fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Store *">
              <select className={inputClass} value={form.store_id} onChange={e => onStoreChange(e.target.value)}>
                <option value="">Select store…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
              </select>
            </Field>
            <Field label="Waste Type / Reason">
              <select className={inputClass} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value, waste_type: e.target.value })}>
                {WASTE_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Waste Date"><input type="date" className={inputClass} value={form.waste_date} onChange={e => setForm({ ...form, waste_date: e.target.value })} /></Field>
            <Field label="Notes"><input className={inputClass} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Wasted Items</span>
              <button onClick={addWasteLine} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700">
                <Plus className="w-3.5 h-3.5" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {wasteLines.map((line, i) => {
                const item = items.find(it => it.id === line.item_id);
                const stock = stockBalances.find(s => s.item_id === line.item_id);
                const qty = Number(line.quantity || 0);
                const totalCost = qty * Number(line.unit_cost || 0);
                return (
                  <div key={i} className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <select className={inputClass} value={line.item_id} onChange={e => onItemChange(e.target.value, i)}>
                          <option value="">Select item…</option>
                          {items.map(it => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>)}
                        </select>
                      </div>
                      <button onClick={() => removeWasteLine(i)} disabled={wasteLines.length === 1}
                        className="p-2 text-slate-400 hover:text-red-500 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {line.item_id && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Quantity *</span>
                          <input type="number" min={0} step="any" className={inputClass} value={line.quantity} onChange={e => updateWasteLine(i, 'quantity', +e.target.value)} placeholder="0" />
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Unit Cost</span>
                          <input type="number" step="0.01" className={inputClass} value={line.unit_cost} onChange={e => updateWasteLine(i, 'unit_cost', +e.target.value)} />
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Cost</span>
                          <div className="px-3 py-2 text-sm tabular-nums rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-red-500 font-medium">
                            ${totalCost.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}
                    {line.item_id && stock && (
                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Package className="w-3.5 h-3.5" />
                          Current stock: <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">{Number(stock.on_hand)} {item?.unit_of_measure || ''}</span>
                        </span>
                        {qty > 0 && <span className="text-slate-400">→</span>}
                        {qty > 0 && (
                          <span className={`font-medium tabular-nums ${qty > Number(stock.on_hand) ? 'text-amber-500' : 'text-slate-600 dark:text-slate-300'}`}>
                            New: {Math.max(0, Number(stock.on_hand) - qty)} {item?.unit_of_measure || ''}
                            {qty > Number(stock.on_hand) && ' (insufficient)'}
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
          {wasteLines.filter(l => l.item_id && Number(l.quantity)).length > 0 && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 flex items-center justify-between text-sm">
              <span className="text-red-700 dark:text-red-300 font-medium">
                {wasteLines.filter(l => l.item_id && Number(l.quantity)).length} item(s) ready
              </span>
              <span className="text-red-700 dark:text-red-300 font-bold tabular-nums">
                Total waste value: ${wasteLines.reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unit_cost || 0)), 0).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </ModalSystem>
    </div>
  );
};

export default WasteModule;
