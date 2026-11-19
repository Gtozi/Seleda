/**
 * Stock Counts — /erp/inventory/stock-counts
 * DB-integrated via /api/uinv-portal/counts.
 * Stock count lifecycle: Draft → In Progress → Reconciled → Approved.
 * Supports performing counts: adding items, entering physical quantities, viewing variances.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ClipboardList, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  CheckCircle2, Play, Eye, Pencil, Trash2, Package, X, Zap,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchCounts, createCount, updateCount, type UinvCount, type CountLine,
  fetchStores, fetchStock, fetchItems, type UinvStore, type UinvStockBalance, type UinvItem,
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

const COUNT_TYPES = ['Full Physical', 'Cycle Count', 'Spot Count', 'ABC Count'];
const STATUS_FLOW = ['Draft', 'In Progress', 'Reconciled', 'Approved'] as const;
type CountStatus = typeof STATUS_FLOW[number];
const NEXT_ACTIONS: Record<CountStatus, string[]> = {
  'Draft': ['Start Count'],
  'In Progress': ['Reconcile'],
  'Reconciled': ['Approve'],
  'Approved': [],
};
const STATUS_TONE: Record<CountStatus, keyof typeof statusTone> = {
  'Draft': 'neutral', 'In Progress': 'warning', 'Reconciled': 'info', 'Approved': 'success',
};

const emptyForm = () => ({ count_type: 'Cycle Count', store_id: '', scheduled_date: new Date().toISOString().slice(0, 10), is_blind: false, notes: '' });

interface StockCountsModuleProps {
  /** Optional list of store IDs to filter to (e.g. HK stores). If omitted, all stores are shown. */
  storeFilter?: string[];
  /** Optional title override */
  title?: string;
  /** Optional subtitle override */
  subtitle?: string;
  /** Hide the internal KPI stat cards (when embedded in a module that has its own dynamic cards) */
  hideStats?: boolean;
  /** Hide the internal PageHeader (when embedded in a module that has its own header) */
  hideHeader?: boolean;
  /** Increment to trigger a refresh from parent */
  refreshTrigger?: number;
  /** Increment to open the New Count form from parent */
  newCountTrigger?: number;
  /** Optional sub-tab bar rendered after KPI cards (used by wrapper components) */
  subTabBar?: React.ReactNode;
}

const StockCountsModule: React.FC<StockCountsModuleProps> = ({ storeFilter, title, subtitle, hideStats, hideHeader, refreshTrigger, newCountTrigger, subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [counts, setCounts] = useState<UinvCount[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | CountStatus>('All');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [detail, setDetail] = useState<UinvCount | null>(null);
  const [form, setForm] = useState<any>(emptyForm());

  // Perform-count state
  const [performing, setPerforming] = useState<UinvCount | null>(null);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [stockItems, setStockItems] = useState<UinvStockBalance[]>([]);
  const [allItems, setAllItems] = useState<UinvItem[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [savingCount, setSavingCount] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, s] = await Promise.all([
        fetchCounts({ propertyId: currentPropertyId || undefined }),
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      // Filter counts to only those whose store_id is in storeFilter (or counts with no store if no filter)
      const filteredCounts = storeFilter
        ? data.filter(c => !c.store_id || storeFilter.includes(c.store_id))
        : data;
      // Filter stores to only those in storeFilter
      const filteredStores = storeFilter
        ? s.filter(st => storeFilter.includes(st.id))
        : s;
      setCounts(filteredCounts);
      setStores(filteredStores);
    } catch (e: any) {
      setError(e?.message || 'Failed to load stock counts');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, storeFilter]);

  useEffect(() => { load(); }, [load]);

  // External trigger: refresh
  useEffect(() => { if (refreshTrigger && refreshTrigger > 0) load(); }, [refreshTrigger]);
  // External trigger: new count
  useEffect(() => { if (newCountTrigger && newCountTrigger > 0) setShowForm(true); }, [newCountTrigger]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return counts.filter(c => {
      const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
      const matchesSearch = !q || (c.count_number || '').toLowerCase().includes(q) || (c.count_type || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [counts, search, statusFilter]);

  const kpis = useMemo(() => ({
    total: counts.length,
    inProgress: counts.filter(c => c.status === 'In Progress').length,
    reconciled: counts.filter(c => c.status === 'Reconciled').length,
    approved: counts.filter(c => c.status === 'Approved').length,
  }), [counts]);

  const submit = async () => {
    if (!form.store_id) {
      addNotification('Store is required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createCount({ ...form, property_id: currentPropertyId });
      setCounts(prev => [created, ...prev]);
      addNotification(`Count ${created.count_number} created.`, 'success', 'Inventory');
      setShowForm(false);
      setForm(emptyForm());
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create count', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const advance = async (c: UinvCount, action: string) => {
    setActingOn(c.id); setMenuOpen(null);
    const transitions: Record<string, CountStatus> = {
      'Start Count': 'In Progress', 'Reconcile': 'Reconciled', 'Approve': 'Approved',
    };
    const newStatus = transitions[action];
    if (!newStatus) return;
    try {
      const updated = await updateCount(c.id, { status: newStatus });
      setCounts(prev => prev.map(x => (x.id === c.id ? updated : x)));
      addNotification(`Count ${c.count_number} → ${newStatus}.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update count', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  // ── Perform Count ──
  // stockItems holds balances for the count's store (or all stores if no store selected)
  // stockByItem is a per-item lookup for the add-item panel
  const stockByItem = useMemo(() => {
    const map = new Map<string, { on_hand: number; unit_cost: number }>();
    for (const s of stockItems) {
      const existing = map.get(s.item_id);
      if (existing) {
        existing.on_hand += Number(s.on_hand || 0);
        if (s.unit_cost) existing.unit_cost = Number(s.unit_cost);
      } else {
        map.set(s.item_id, { on_hand: Number(s.on_hand || 0), unit_cost: Number(s.unit_cost || 0) });
      }
    }
    return map;
  }, [stockItems]);

  const startPerform = async (c: UinvCount) => {
    setPerforming(c);
    setCountLines(c.lines || []);
    setShowAddItem(false);
    setAddItemSearch('');
    setLoadingStock(true);
    try {
      // Fetch stock for the specific store (department stores now have their own balances).
      // Also fetch all items so the add-item panel can show everything.
      const stockPromise = c.store_id
        ? fetchStock({ propertyId: currentPropertyId || undefined, storeId: c.store_id })
        : fetchStock({ propertyId: currentPropertyId || undefined });
      const [stock, items] = await Promise.all([
        stockPromise,
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      setStockItems(stock);
      // When a storeFilter is provided, only show items that have stock in those stores
      if (storeFilter && storeFilter.length > 0) {
        const itemIdsWithStock = new Set(stock.map(s => s.item_id));
        setAllItems(items.filter(it => itemIdsWithStock.has(it.id)));
      } else {
        setAllItems(items);
      }
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load stock data', 'error', 'Inventory');
    } finally { setLoadingStock(false); }
  };

  const autoPopulateFromStock = () => {
    // Use stock balances for this specific store
    const storeId = performing?.store_id;
    const storeStock = storeId ? stockItems.filter(s => s.store_id === storeId) : stockItems;

    if (storeStock.length > 0) {
      const newLines: CountLine[] = storeStock.map((s) => ({
        itemId: s.item_id,
        itemName: s.item?.item_name || s.item_id,
        systemQty: Number(s.on_hand || 0),
        physicalQty: 0,
        variance: 0,
        unitCost: Number(s.unit_cost || 0),
        varianceValue: 0,
        unit: s.item?.unit_of_measure || '',
      }));
      setCountLines(newLines);
      addNotification(`Auto-populated ${newLines.length} items from ${performing?.store?.store_name || 'this store'}.`, 'success', 'Inventory');
    } else {
      addNotification(`No stock balances found for ${performing?.store?.store_name || 'this store'}. Use "Add item" to add items manually.`, 'warning', 'Inventory');
    }
  };

  const addManualItem = (item: UinvItem) => {
    if (countLines.some(l => l.itemId === item.id)) {
      addNotification(`${item.item_name} is already in the count.`, 'warning', 'Inventory');
      return;
    }
    // Look up stock for this item in the count's store
    const storeId = performing?.store_id;
    const storeMatch = storeId ? stockItems.find(s => s.item_id === item.id && s.store_id === storeId) : null;
    setCountLines(prev => [...prev, {
      itemId: item.id,
      itemName: item.item_name,
      systemQty: Number(storeMatch?.on_hand || 0),
      physicalQty: 0,
      variance: 0,
      unitCost: Number(storeMatch?.unit_cost || item.avg_cost || 0),
      varianceValue: 0,
      unit: item.unit_of_measure,
    }]);
    setShowAddItem(false);
    setAddItemSearch('');
  };

  const updateLineQty = (index: number, physicalQty: number) => {
    setCountLines(prev => prev.map((l, i) => {
      if (i !== index) return l;
      const variance = physicalQty - Number(l.systemQty);
      const varianceValue = variance * Number(l.unitCost || 0);
      return { ...l, physicalQty, variance, varianceValue };
    }));
  };

  const removeLine = (index: number) => {
    setCountLines(prev => prev.filter((_, i) => i !== index));
  };

  const saveCount = async () => {
    if (!performing) return;
    setSavingCount(true);
    const totalVariance = countLines.reduce((s, l) => s + Number(l.varianceValue || 0), 0);
    try {
      const updated = await updateCount(performing.id, {
        lines: countLines,
        total_variance: totalVariance,
      });
      setCounts(prev => prev.map(x => (x.id === performing.id ? updated : x)));
      addNotification(`Count ${performing.count_number} saved with ${countLines.length} lines.`, 'success', 'Inventory');
      setPerforming(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save count', 'error', 'Inventory');
    } finally { setSavingCount(false); }
  };

  const filteredAddItems = useMemo(() => {
    const q = addItemSearch.trim().toLowerCase();
    return allItems
      .filter(it => !countLines.some(l => l.itemId === it.id))
      .filter(it => !q || (it.item_name || '').toLowerCase().includes(q) || (it.item_code || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [allItems, countLines, addItemSearch]);

  const totalVariance = countLines.reduce((s, l) => s + Number(l.varianceValue || 0), 0);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      {!hideHeader && (
      <PageHeader
        title={title || "Stock Counts"}
        subtitle={subtitle || "Physical, cycle, and spot count workflows."}
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Count</button>
          </div>
        }
      />
      )}

      {!hideStats && (
      <div className={layout.kpiGrid}>
        <StatCard title="Total Counts" value={kpis.total} icon={ClipboardList} tone="accent" />
        <StatCard title="In Progress" value={kpis.inProgress} icon={Play} tone="warning" />
        <StatCard title="Reconciled" value={kpis.reconciled} icon={CheckCircle2} tone="info" />
        <StatCard title="Approved" value={kpis.approved} icon={CheckCircle2} tone="success" />
      </div>
      )}

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
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search count number…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      <InventoryTable
        rows={filtered}
        rowKey={(c) => c.id}
        loading={loading}
        loadingMessage="Loading counts…"
        error={error}
        onRetry={load}
        emptyMessage="No counts."
        columns={[
          {
            key: 'count',
            header: 'Count',
            widthClass: 'md:w-48 shrink-0',
            render: (c) => {
              const tone = STATUS_TONE[c.status as CountStatus] || 'neutral';
              return (
                <IdentityCell
                  icon={<ClipboardList className="w-5 h-5" />}
                  soft={statusTone[tone].soft}
                  text={statusTone[tone].text}
                  name={c.count_number}
                  code={c.count_type}
                />
              );
            },
          },
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-44 shrink-0',
            render: (c) => c.store ? (
              <div className="min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{c.store.store_name}</p>
                <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{c.store.store_code}</span>
              </div>
            ) : <span className="text-slate-400 text-sm">All stores</span>,
          },
          {
            key: 'date',
            header: 'Created',
            widthClass: 'md:w-28 shrink-0',
            render: (c) => <span className="text-slate-600 dark:text-slate-400 text-sm">{c.created_at?.slice(0, 10)}</span>,
          },
          {
            key: 'blind',
            header: 'Blind',
            widthClass: 'md:w-20 shrink-0',
            render: (c) => c.is_blind ? <Badge tone="warning">Blind</Badge> : <span className="text-slate-400 text-sm">No</span>,
          },
          {
            key: 'lines',
            header: 'Lines',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (c) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{c.lines?.length || 0}</span>,
          },
          {
            key: 'variance',
            header: 'Variance',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (c) => {
              const v = Number(c.total_variance || 0);
              return <span className={`tabular-nums font-medium ${v < 0 ? 'text-red-500' : v > 0 ? 'text-emerald-600' : ''}`}>{v !== 0 ? `$${v.toFixed(2)}` : '—'}</span>;
            },
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (c) => c.notes ? <span className="text-slate-500 dark:text-slate-400 text-sm italic">{c.notes}</span> : <span className="text-slate-400">—</span>,
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-28 shrink-0',
            render: (c) => {
              const tone = STATUS_TONE[c.status as CountStatus] || 'neutral';
              return <Badge tone={tone} variant="solid">{c.status}</Badge>;
            },
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-28 shrink-0',
            align: 'right',
            render: (c) => {
              const actions = NEXT_ACTIONS[c.status as CountStatus] || [];
              const canPerform = c.status === 'Draft' || c.status === 'In Progress';
              return (
                <OpsCell>
                  {canPerform && (
                    <IconButton onClick={() => startPerform(c)} title="Perform count" variant="info">
                      <Pencil className="w-4 h-4" />
                    </IconButton>
                  )}
                  <IconButton onClick={() => setDetail(c)} title="View details">
                    <Eye className="w-4 h-4" />
                  </IconButton>
                  {actions.length > 0 && (
                    <div className="relative">
                      <IconButton onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} title="More actions">
                        <MoreVertical className="w-4 h-4" />
                      </IconButton>
                      {menuOpen === c.id && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                          {actions.map(a => (
                            <button key={a} onClick={() => advance(c, a)} disabled={actingOn === c.id}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                              {actingOn === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {a}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </OpsCell>
              );
            },
          },
        ]}
      />

      {/* New Count Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} variant="form" size="md"
        title="New Stock Count" confirmLabel="Create" onConfirm={submit} loading={submitting} confirmColor="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Count Type"><select className={inputClass} value={form.count_type} onChange={e => setForm({ ...form, count_type: e.target.value })}>{COUNT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Scheduled Date"><input type="date" className={inputClass} value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} /></Field>
          <Field label="Store *">
            <select className={inputClass} value={form.store_id} onChange={e => setForm({ ...form, store_id: e.target.value })}>
              <option value="">Select store…</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          </Field>
          <Field label="Blind Count">
            <select className={inputClass} value={form.is_blind ? 'yes' : 'no'} onChange={e => setForm({ ...form, is_blind: e.target.value === 'yes' })}>
              <option value="no">No — show system qty</option>
              <option value="yes">Yes — hide system qty</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><input className={inputClass} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      <ModalSystem isOpen={!!detail && !performing} onClose={() => setDetail(null)} variant="form" size="xl"
        title={detail?.count_number || 'Count Detail'} subtitle={detail?.count_type} confirmLabel="Close" onConfirm={() => setDetail(null)} confirmColor="neutral">
        {detail && (
          <div className="space-y-4 text-sm">
            {/* Summary grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-gray-200 dark:border-slate-700">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.status as CountStatus] || 'neutral'} variant="solid">{detail.status}</Badge>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Store</p>
                <p className="text-slate-700 dark:text-slate-300 font-medium truncate">{detail.store?.store_name || 'All stores'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Created</p>
                <p className="text-slate-700 dark:text-slate-300 font-medium">{detail.created_at?.slice(0, 10)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Blind Count</p>
                <p className="text-slate-700 dark:text-slate-300 font-medium">{detail.is_blind ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Started</p>
                <p className="text-slate-700 dark:text-slate-300 font-medium">{detail.started_at?.slice(0, 10) || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Completed</p>
                <p className="text-slate-700 dark:text-slate-300 font-medium">{detail.completed_at?.slice(0, 10) || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Approved By</p>
                <p className="text-slate-700 dark:text-slate-300 font-medium">{detail.approved_by || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Variance</p>
                <p className={`font-bold tabular-nums ${(detail.total_variance || 0) < 0 ? 'text-red-500' : (detail.total_variance || 0) > 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}`}>
                  ${Number(detail.total_variance || 0).toFixed(2)}
                </p>
              </div>
            </div>

            {detail.notes && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Notes</p>
                <p className="text-slate-700 dark:text-slate-300 italic">{detail.notes}</p>
              </div>
            )}

            {/* Line items table */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Counted Items ({detail.lines?.length || 0})</p>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium text-left">Item</th>
                      <th className="px-4 py-3 font-medium text-right">System Qty</th>
                      <th className="px-4 py-3 font-medium text-right">Physical Qty</th>
                      <th className="px-4 py-3 font-medium text-right">Variance</th>
                      <th className="px-4 py-3 font-medium text-right">Unit Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Variance Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-800">
                    {(detail.lines || []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No line items recorded. Use the pencil icon to perform the count.</td>
                      </tr>
                    ) : detail.lines!.map((line, i) => {
                      const variance = Number(line.variance ?? (Number(line.physicalQty) - Number(line.systemQty)));
                      const varianceValue = Number(line.varianceValue ?? (variance * Number(line.unitCost || 0)));
                      return (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                          <td className="px-4 py-3 text-left">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 dark:text-white truncate">{line.itemName || line.itemId}</p>
                              {line.unit && <span className="text-xs text-slate-500 dark:text-slate-400 block">{line.unit}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">{line.systemQty}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300 font-medium">{line.physicalQty}</td>
                          <td className={`px-4 py-3 text-right tabular-nums font-medium ${variance < 0 ? 'text-red-500' : variance > 0 ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-400'}`}>
                            {variance > 0 ? '+' : ''}{variance}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">${Number(line.unitCost || 0).toFixed(2)}</td>
                          <td className={`px-4 py-3 text-right tabular-nums font-medium ${varianceValue < 0 ? 'text-red-500' : varianceValue > 0 ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-400'}`}>
                            {varianceValue > 0 ? '+' : ''}${varianceValue.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {(detail.lines || []).length > 0 && (
                    <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t border-gray-200 dark:border-slate-700">
                      <tr>
                        <td className="px-4 py-3 text-left font-bold text-slate-700 dark:text-slate-300">Total</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{detail.lines!.reduce((s, l) => s + Number(l.systemQty || 0), 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300 font-bold">{detail.lines!.reduce((s, l) => s + Number(l.physicalQty || 0), 0)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-bold ${(detail.total_variance || 0) < 0 ? 'text-red-500' : (detail.total_variance || 0) > 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}`}>
                          {detail.lines!.reduce((s, l) => s + Number(l.variance ?? (Number(l.physicalQty) - Number(l.systemQty))), 0)}
                        </td>
                        <td className="px-4 py-3"></td>
                        <td className={`px-4 py-3 text-right tabular-nums font-bold ${(detail.total_variance || 0) < 0 ? 'text-red-500' : (detail.total_variance || 0) > 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}`}>
                          ${(detail.total_variance || 0).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Perform Count Modal */}
      <ModalSystem isOpen={!!performing} onClose={() => setPerforming(null)} variant="form" size="xl"
        title={`Perform Count — ${performing?.count_number || ''}`} subtitle={performing?.count_type}
        confirmLabel={savingCount ? 'Saving…' : 'Save Count'} onConfirm={saveCount} loading={savingCount} confirmColor="emerald">
        {performing && (
          <div className="space-y-4 text-sm">
            {/* Header info + actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-gray-200 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={STATUS_TONE[performing.status as CountStatus] || 'neutral'} variant="solid">{performing.status}</Badge>
                <span className="text-slate-600 dark:text-slate-400 text-xs">{performing.store?.store_name || 'All stores'}</span>
                {performing.is_blind && <Badge tone="warning">Blind — system qty hidden</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={autoPopulateFromStock} disabled={loadingStock} className={button.secondary + ' disabled:opacity-50 flex items-center gap-1.5'}>
                  {loadingStock ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Auto-populate from stock
                </button>
                <button onClick={() => setShowAddItem(!showAddItem)} className={button.secondary + ' flex items-center gap-1.5'}>
                  <Plus className="w-4 h-4" /> Add item
                </button>
              </div>
            </div>

            {/* Add item panel */}
            {showAddItem && (
              <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    placeholder="Search items by name or code…"
                    value={addItemSearch}
                    onChange={e => setAddItemSearch(e.target.value)}
                    autoFocus
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700 rounded-lg border border-gray-200 dark:border-slate-700">
                  {filteredAddItems.length === 0 ? (
                    <p className="px-3 py-4 text-center text-slate-400 text-xs">No items found.</p>
                  ) : filteredAddItems.map(it => {
                    const stock = stockByItem.get(it.id);
                    const storeId = performing?.store_id;
                    const storeStock = storeId ? stockItems.find(s => s.item_id === it.id && s.store_id === storeId) : null;
                    const displayQty = storeStock ? Number(storeStock.on_hand) : (stock?.on_hand || 0);
                    return (
                      <button key={it.id} onClick={() => addManualItem(it)}
                        className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 flex items-center gap-2 transition">
                        <Package className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-900 dark:text-white truncate">{it.item_name}</p>
                          <p className="text-xs text-slate-500">{it.item_code} · {it.unit_of_measure}</p>
                        </div>
                        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          Stock: <span className={displayQty > 0 ? 'text-slate-700 dark:text-slate-300 font-medium' : 'text-slate-400'}>{displayQty}</span>
                        </span>
                        <Plus className="w-4 h-4 text-indigo-500 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Count lines table */}
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium text-left">Item</th>
                    <th className="px-4 py-3 font-medium text-right">System Qty</th>
                    <th className="px-4 py-3 font-medium text-right">Physical Qty</th>
                    <th className="px-4 py-3 font-medium text-right">Variance</th>
                    <th className="px-4 py-3 font-medium text-right">Unit Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Variance Value</th>
                    <th className="px-4 py-3 font-medium text-center w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-800">
                  {countLines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        No items in this count yet. Use "Auto-populate from stock" or "Add item" to begin.
                      </td>
                    </tr>
                  ) : countLines.map((line, i) => {
                    const variance = Number(line.variance ?? (Number(line.physicalQty) - Number(line.systemQty)));
                    const varianceValue = Number(line.varianceValue ?? (variance * Number(line.unitCost || 0)));
                    const isBlind = performing.is_blind;
                    return (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-4 py-3 text-left">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-white truncate">{line.itemName || line.itemId}</p>
                            {line.unit && <span className="text-xs text-slate-500 dark:text-slate-400 block">{line.unit}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          {isBlind ? '—' : line.systemQty}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            value={line.physicalQty || ''}
                            onChange={e => updateLineQty(i, Number(e.target.value))}
                            placeholder="0"
                            className="w-20 px-2 py-1 text-right tabular-nums text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                          />
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${variance < 0 ? 'text-red-500' : variance > 0 ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-400'}`}>
                          {isBlind ? '—' : <>{variance > 0 ? '+' : ''}{variance}</>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          ${Number(line.unitCost || 0).toFixed(2)}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${varianceValue < 0 ? 'text-red-500' : varianceValue > 0 ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-400'}`}>
                          {isBlind ? '—' : <>{varianceValue > 0 ? '+' : ''}${varianceValue.toFixed(2)}</>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => removeLine(i)} title="Remove" className="p-1 text-slate-400 hover:text-red-500 transition">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {countLines.length > 0 && (
                  <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t border-gray-200 dark:border-slate-700">
                    <tr>
                      <td className="px-4 py-3 text-left font-bold text-slate-700 dark:text-slate-300">Total ({countLines.length} items)</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {performing.is_blind ? '—' : countLines.reduce((s, l) => s + Number(l.systemQty || 0), 0)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300 font-bold">
                        {countLines.reduce((s, l) => s + Number(l.physicalQty || 0), 0)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold ${totalVariance < 0 ? 'text-red-500' : totalVariance > 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}`}>
                        {performing.is_blind ? '—' : <>{totalVariance > 0 ? '+' : ''}{countLines.reduce((s, l) => s + Number(l.variance ?? (Number(l.physicalQty) - Number(l.systemQty))), 0)}</>}
                      </td>
                      <td className="px-4 py-3"></td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold ${totalVariance < 0 ? 'text-red-500' : totalVariance > 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}`}>
                        {performing.is_blind ? '—' : <>{totalVariance > 0 ? '+' : ''}${totalVariance.toFixed(2)}</>}
                      </td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default StockCountsModule;
