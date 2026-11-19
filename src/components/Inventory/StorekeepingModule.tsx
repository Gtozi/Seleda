/**
 * Storekeeping — /erp/inventory/storekeeping (and per-tab routes)
 *
 * DB-backed storekeeping operations:
 *   - Put-Away tasks (uinv_putaway_tasks)
 *   - Picking tasks (uinv_picking_tasks)
 *   - Returns (uinv_returns)
 *   - Quarantine (uinv_quarantine)
 *   - Serials & Lots (uinv_serials, uinv_lots)
 *   - Expiry alerts (uinv_expiry_alerts view)
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Package, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  Trash2, Boxes, ArrowLeftRight, Undo2, AlertOctagon, ShieldAlert,
  Tag, Tags, CalendarClock, Check, Edit3, Building2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchPutAwayTasks, createPutAwayTask, updatePutAwayTask, deletePutAwayTask,
  fetchPickingTasks, createPickingTask, updatePickingTask, deletePickingTask,
  fetchReturns, createReturn, updateReturn, deleteReturn,
  fetchQuarantine, createQuarantine, updateQuarantine, deleteQuarantine,
  fetchSerials, createSerial, deleteSerial,
  fetchLots, createLot, deleteLot,
  fetchExpiryAlerts,
  fetchStores, fetchItems,
  type UinvPutAwayTask, type UinvPickingTask, type UinvReturn,
  type UinvQuarantine, type UinvSerial, type UinvLot, type UinvExpiryAlert,
  type UinvStore, type UinvItem,
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

const SUB_TABS = [
  { id: 'putaway', label: 'Put-Away', icon: ArrowLeftRight },
  { id: 'picking', label: 'Picking', icon: Package },
  { id: 'returns', label: 'Returns', icon: Undo2 },
  { id: 'quarantine', label: 'Quarantine', icon: ShieldAlert },
  { id: 'serials-lots', label: 'Serials & Lots', icon: Tags },
  { id: 'expiry', label: 'Expiry', icon: CalendarClock },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];

function statusToneFor(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['Put Away', 'Picked', 'Received', 'Restocked', 'Released', 'OK'].includes(status)) return 'success';
  if (['Pending', 'In Progress', 'Held', 'Short'].includes(status)) return 'warning';
  if (['Cancelled', 'Rejected', 'Disposed', 'Damaged', 'Lost', 'Expired', 'Critical'].includes(status)) return 'danger';
  if (['Quarantined', 'Inspected', 'Exception'].includes(status)) return 'info';
  return 'neutral';
}

function expiryBucketTone(bucket: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (bucket === 'Expired') return 'danger';
  if (['7 Days', '14 Days'].includes(bucket)) return 'warning';
  if (['30 Days', '60 Days'].includes(bucket)) return 'info';
  return 'success';
}

interface StorekeepingModuleProps {
  /** Optional initial sub-tab (used when routed from /erp/inventory/:tab). */
  initialTab?: SubTab;
}

const StorekeepingModule: React.FC<StorekeepingModuleProps> = ({ initialTab = 'putaway' }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [sub, setSub] = useState<SubTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [putaways, setPutaways] = useState<UinvPutAwayTask[]>([]);
  const [picking, setPicking] = useState<UinvPickingTask[]>([]);
  const [returns, setReturns] = useState<UinvReturn[]>([]);
  const [quarantine, setQuarantine] = useState<UinvQuarantine[]>([]);
  const [serials, setSerials] = useState<UinvSerial[]>([]);
  const [lots, setLots] = useState<UinvLot[]>([]);
  const [expiry, setExpiry] = useState<UinvExpiryAlert[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);

  // Forms
  const [showPutawayForm, setShowPutawayForm] = useState(false);
  const [putawayForm, setPutawayForm] = useState<Partial<UinvPutAwayTask>>({});
  const [showPickingForm, setShowPickingForm] = useState(false);
  const [pickingForm, setPickingForm] = useState<Partial<UinvPickingTask>>({});
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnForm, setReturnForm] = useState<Partial<UinvReturn>>({});
  const [showQuarantineForm, setShowQuarantineForm] = useState(false);
  const [quarantineForm, setQuarantineForm] = useState<Partial<UinvQuarantine>>({});
  const [showSerialForm, setShowSerialForm] = useState(false);
  const [serialForm, setSerialForm] = useState<Partial<UinvSerial>>({});
  const [showLotForm, setShowLotForm] = useState(false);
  const [lotForm, setLotForm] = useState<Partial<UinvLot>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [pa, pk, rt, qu, se, lo, ex, st, it] = await Promise.all([
        fetchPutAwayTasks({ propertyId }),
        fetchPickingTasks({ propertyId }),
        fetchReturns({ propertyId }),
        fetchQuarantine({ propertyId }),
        fetchSerials({ propertyId }),
        fetchLots({ propertyId }),
        fetchExpiryAlerts({ propertyId }),
        fetchStores({ propertyId, active: 'true' }),
        fetchItems({ propertyId, active: 'true' }),
      ]);
      setPutaways(pa);
      setPicking(pk);
      setReturns(rt);
      setQuarantine(qu);
      setSerials(se);
      setLots(lo);
      setExpiry(ex);
      setStores(st);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || 'Failed to load storekeeping data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const itemLabel = (id?: string | null) => items.find(i => i.id === id)?.item_name || id || '—';
  const storeLabel = (id?: string | null) => stores.find(s => s.id === id)?.store_name || id || '—';

  const kpis = useMemo(() => ({
    pendingPutaway: putaways.filter(p => p.status === 'Pending' || p.status === 'In Progress').length,
    pendingPicking: picking.filter(p => p.status === 'Pending').length,
    pendingReturns: returns.filter(r => r.status === 'Pending' || r.status === 'Received').length,
    heldQuarantine: quarantine.filter(q => q.status === 'Held').length,
    expiringSoon: expiry.filter(e => ['7 Days', '14 Days', '30 Days'].includes(e.alert_bucket)).length,
    expired: expiry.filter(e => e.alert_bucket === 'Expired').length,
  }), [putaways, picking, returns, quarantine, expiry]);

  const matchSearch = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());

  // ── Put-Away actions ──
  const openPutawayForm = () => {
    setPutawayForm({ property_id: currentPropertyId, status: 'Pending', quantity: 0 });
    setShowPutawayForm(true);
  };
  const submitPutaway = async () => {
    if (!putawayForm.item_id || !putawayForm.store_id || !putawayForm.quantity) {
      addNotification('Item, store and quantity are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createPutAwayTask({ ...putawayForm, property_id: currentPropertyId });
      addNotification('Put-away task created.', 'success', 'Inventory');
      setShowPutawayForm(false);
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to create put-away', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const advancePutaway = async (p: UinvPutAwayTask, status: UinvPutAwayTask['status']) => {
    if (!p.id) return;
    setActingOn(p.id);
    try {
      await updatePutAwayTask(p.id, { status, putaway_at: status === 'Put Away' ? new Date().toISOString() : null });
      addNotification(`Put-away → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removePutaway = async (id: string) => { setActingOn(id); try { await deletePutAwayTask(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // ── Picking actions ──
  const openPickingForm = () => {
    setPickingForm({ property_id: currentPropertyId, source_type: 'Issue', status: 'Pending', pick_strategy: 'FIFO', quantity: 0 });
    setShowPickingForm(true);
  };
  const submitPicking = async () => {
    if (!pickingForm.item_id || !pickingForm.store_id || !pickingForm.quantity) {
      addNotification('Item, store and quantity are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createPickingTask({ ...pickingForm, property_id: currentPropertyId });
      addNotification('Picking task created.', 'success', 'Inventory');
      setShowPickingForm(false);
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to create picking', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const advancePicking = async (p: UinvPickingTask, status: UinvPickingTask['status']) => {
    if (!p.id) return;
    setActingOn(p.id);
    try {
      await updatePickingTask(p.id, { status, picked_at: status === 'Picked' ? new Date().toISOString() : null });
      addNotification(`Pick → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removePicking = async (id: string) => { setActingOn(id); try { await deletePickingTask(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // ── Returns actions ──
  const openReturnForm = () => {
    setReturnForm({ property_id: currentPropertyId, return_date: new Date().toISOString().slice(0, 10), status: 'Pending', lines: [], total_value: 0 });
    setShowReturnForm(true);
  };
  const submitReturn = async () => {
    if (!returnForm.store_id || !returnForm.return_date) {
      addNotification('Store and return date are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createReturn({ ...returnForm, property_id: currentPropertyId });
      addNotification('Return recorded.', 'success', 'Inventory');
      setShowReturnForm(false);
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to create return', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const advanceReturn = async (r: UinvReturn, status: UinvReturn['status']) => {
    if (!r.id) return;
    setActingOn(r.id);
    try { await updateReturn(r.id, { status }); addNotification(`Return → ${status}`, 'success', 'Inventory'); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removeReturn = async (id: string) => { setActingOn(id); try { await deleteReturn(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // ── Quarantine actions ──
  const openQuarantineForm = () => {
    setQuarantineForm({ property_id: currentPropertyId, source: 'Receiving', status: 'Held', quarantined_at: new Date().toISOString(), quantity: 0 });
    setShowQuarantineForm(true);
  };
  const submitQuarantine = async () => {
    if (!quarantineForm.item_id || !quarantineForm.quantity || !quarantineForm.reason) {
      addNotification('Item, quantity and reason are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createQuarantine({ ...quarantineForm, property_id: currentPropertyId });
      addNotification('Item quarantined.', 'success', 'Inventory');
      setShowQuarantineForm(false);
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to quarantine', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const advanceQuarantine = async (q: UinvQuarantine, status: UinvQuarantine['status']) => {
    if (!q.id) return;
    setActingOn(q.id);
    try {
      await updateQuarantine(q.id, { status, released_at: ['Released', 'Returned to Supplier', 'Disposed', 'Rejected'].includes(status) ? new Date().toISOString() : null });
      addNotification(`Quarantine → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removeQuarantine = async (id: string) => { setActingOn(id); try { await deleteQuarantine(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // ── Serial/Lot actions ──
  const openSerialForm = () => { setSerialForm({ property_id: currentPropertyId, status: 'In Stock', condition: 'New' }); setShowSerialForm(true); };
  const submitSerial = async () => {
    if (!serialForm.item_id || !serialForm.serial_number) {
      addNotification('Item and serial number are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try { await createSerial({ ...serialForm, property_id: currentPropertyId }); addNotification('Serial recorded.', 'success', 'Inventory'); setShowSerialForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to add serial', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeSerial = async (id: string) => { setActingOn(id); try { await deleteSerial(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const openLotForm = () => { setLotForm({ property_id: currentPropertyId, status: 'In Stock', quantity: 0, unit_cost: 0 }); setShowLotForm(true); };
  const submitLot = async () => {
    if (!lotForm.item_id || !lotForm.lot_number) {
      addNotification('Item and lot number are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try { await createLot({ ...lotForm, property_id: currentPropertyId }); addNotification('Lot recorded.', 'success', 'Inventory'); setShowLotForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to add lot', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeLot = async (id: string) => { setActingOn(id); try { await deleteLot(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const renderMenu = (id: string, children: ReactNode) => (
    <div className="relative">
      <IconButton title="Actions" onClick={() => setMenuOpen(menuOpen === id ? null : id)}>
        <MoreVertical className="w-4 h-4" />
      </IconButton>
      {menuOpen === id && (
        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1" onMouseLeave={() => setMenuOpen(null)}>
          {children}
        </div>
      )}
    </div>
  );

  const itemSelect = (value: string, onChange: (v: string) => void) => (
    <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Select item…</option>
      {items.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
    </select>
  );
  const storeSelect = (value: string, onChange: (v: string) => void) => (
    <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Select store…</option>
      {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
    </select>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Storekeeping"
        subtitle="Put-away, picking, returns, quarantine, serial/lot control and expiry management."
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            {sub === 'putaway' && <button onClick={openPutawayForm} className={button.primary}><Plus className="w-4 h-4" /> New Put-Away</button>}
            {sub === 'picking' && <button onClick={openPickingForm} className={button.primary}><Plus className="w-4 h-4" /> New Pick</button>}
            {sub === 'returns' && <button onClick={openReturnForm} className={button.primary}><Plus className="w-4 h-4" /> New Return</button>}
            {sub === 'quarantine' && <button onClick={openQuarantineForm} className={button.primary}><Plus className="w-4 h-4" /> Quarantine</button>}
            {sub === 'serials-lots' && (
              <>
                <button onClick={openSerialForm} className={button.secondary}><Plus className="w-4 h-4" /> New Serial</button>
                <button onClick={openLotForm} className={button.primary}><Plus className="w-4 h-4" /> New Lot</button>
              </>
            )}
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Pending Put-Away" value={kpis.pendingPutaway} icon={ArrowLeftRight} tone="warning" />
        <StatCard title="Pending Picks" value={kpis.pendingPicking} icon={Package} tone="info" />
        <StatCard title="Open Returns" value={kpis.pendingReturns} icon={Undo2} tone="info" />
        <StatCard title="Held in Quarantine" value={kpis.heldQuarantine} icon={ShieldAlert} tone="danger" />
        <StatCard title="Expiring ≤30d" value={kpis.expiringSoon} icon={CalendarClock} tone="warning" />
        <StatCard title="Expired" value={kpis.expired} icon={AlertOctagon} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {SUB_TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => { setSub(t.id); setSearch(''); setMenuOpen(null); }}
                  className={['px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                    sub === t.id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      {/* ── Put-Away ── */}
      {sub === 'putaway' && (
        <InventoryTable
          rows={putaways.filter(p => matchSearch(p.putaway_number) || matchSearch(itemLabel(p.item_id)))}
          rowKey={p => p.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No put-away tasks."
          columns={[
            { key: 'task', header: 'Task', widthClass: 'md:w-40 shrink-0', render: p => <span className="font-medium text-slate-900 dark:text-white">{p.putaway_number}</span> },
            { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: p => <span className="text-sm text-slate-700 dark:text-slate-300">{itemLabel(p.item_id)}</span> },
            { key: 'store', header: 'Store', widthClass: 'md:w-40 shrink-0', render: p => <span className="text-sm text-slate-600">{storeLabel(p.store_id)}</span> },
            { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: p => <span className="text-sm font-medium">{p.quantity} {p.unit}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: p => <Badge tone={statusToneFor(p.status)} variant="solid">{p.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-32 shrink-0', align: 'right', render: p => (
              <OpsCell>
                {p.status === 'Pending' && <IconButton onClick={() => advancePutaway(p, 'In Progress')} title="Start"><Edit3 className="w-4 h-4" /></IconButton>}
                {(p.status === 'Pending' || p.status === 'In Progress') && <IconButton onClick={() => advancePutaway(p, 'Put Away')} title="Put Away"><Check className="w-4 h-4" /></IconButton>}
                {renderMenu(p.id, (
                  <button onClick={() => removePutaway(p.id)} disabled={actingOn === p.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Picking ── */}
      {sub === 'picking' && (
        <InventoryTable
          rows={picking.filter(p => matchSearch(p.picking_number) || matchSearch(itemLabel(p.item_id)))}
          rowKey={p => p.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No picking tasks."
          columns={[
            { key: 'task', header: 'Task', widthClass: 'md:w-40 shrink-0', render: p => <span className="font-medium text-slate-900 dark:text-white">{p.picking_number}</span> },
            { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: p => <span className="text-sm text-slate-700 dark:text-slate-300">{itemLabel(p.item_id)}</span> },
            { key: 'source', header: 'Source', widthClass: 'md:w-32 shrink-0', render: p => <Badge tone="neutral">{p.source_type}</Badge> },
            { key: 'strategy', header: 'Strategy', widthClass: 'md:w-28 shrink-0', render: p => <span className="text-xs text-slate-500">{p.pick_strategy}</span> },
            { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: p => <span className="text-sm font-medium">{p.quantity} {p.unit}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: p => <Badge tone={statusToneFor(p.status)} variant="solid">{p.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-32 shrink-0', align: 'right', render: p => (
              <OpsCell>
                {p.status === 'Pending' && <IconButton onClick={() => advancePicking(p, 'Picked')} title="Pick"><Check className="w-4 h-4" /></IconButton>}
                {renderMenu(p.id, (
                  <>
                    {p.status === 'Pending' && <button onClick={() => advancePicking(p, 'Short')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><AlertOctagon className="w-4 h-4" /> Mark Short</button>}
                    <button onClick={() => removePicking(p.id)} disabled={actingOn === p.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  </>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Returns ── */}
      {sub === 'returns' && (
        <InventoryTable
          rows={returns.filter(r => matchSearch(r.return_number) || matchSearch(storeLabel(r.store_id)))}
          rowKey={r => r.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No returns recorded."
          columns={[
            { key: 'number', header: 'Return #', widthClass: 'md:w-40 shrink-0', render: r => <span className="font-medium text-slate-900 dark:text-white">{r.return_number}</span> },
            { key: 'store', header: 'Store', widthClass: 'md:w-40 shrink-0', render: r => <span className="text-sm text-slate-600">{storeLabel(r.store_id)}</span> },
            { key: 'dept', header: 'Department', widthClass: 'md:w-40 shrink-0', render: r => <span className="text-sm text-slate-600">{r.department || '—'}</span> },
            { key: 'date', header: 'Date', widthClass: 'md:w-32 shrink-0', render: r => <span className="text-xs text-slate-500">{r.return_date}</span> },
            { key: 'lines', header: 'Lines', widthClass: 'md:w-20 shrink-0', align: 'right', render: r => <span className="text-sm">{(r.lines || []).length}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: r => <Badge tone={statusToneFor(r.status)} variant="solid">{r.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: r => (
              <OpsCell>
                {r.status === 'Pending' && <IconButton onClick={() => advanceReturn(r, 'Received')} title="Receive"><Check className="w-4 h-4" /></IconButton>}
                {r.status === 'Received' && <IconButton onClick={() => advanceReturn(r, 'Inspected')} title="Inspect"><Check className="w-4 h-4" /></IconButton>}
                {r.status === 'Inspected' && <IconButton onClick={() => advanceReturn(r, 'Restocked')} title="Restock"><Check className="w-4 h-4" /></IconButton>}
                {renderMenu(r.id, (
                  <button onClick={() => removeReturn(r.id)} disabled={actingOn === r.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Quarantine ── */}
      {sub === 'quarantine' && (
        <InventoryTable
          rows={quarantine.filter(q => matchSearch(q.quarantine_number) || matchSearch(itemLabel(q.item_id)))}
          rowKey={q => q.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No items in quarantine."
          columns={[
            { key: 'number', header: 'Quarantine #', widthClass: 'md:w-40 shrink-0', render: q => <span className="font-medium text-slate-900 dark:text-white">{q.quarantine_number}</span> },
            { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: q => <span className="text-sm text-slate-700 dark:text-slate-300">{itemLabel(q.item_id)}</span> },
            { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: q => <span className="text-sm font-medium">{q.quantity} {q.unit}</span> },
            { key: 'reason', header: 'Reason', render: q => <span className="text-sm text-slate-600 dark:text-slate-400 truncate max-w-xs">{q.reason}</span> },
            { key: 'source', header: 'Source', widthClass: 'md:w-32 shrink-0', render: q => <Badge tone="neutral">{q.source}</Badge> },
            { key: 'status', header: 'Status', widthClass: 'md:w-32 shrink-0', render: q => <Badge tone={statusToneFor(q.status)} variant="solid">{q.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: q => (
              <OpsCell>
                {q.status === 'Held' && <IconButton onClick={() => advanceQuarantine(q, 'Released')} title="Release"><Check className="w-4 h-4" /></IconButton>}
                {renderMenu(q.id, (
                  <>
                    {q.status === 'Held' && <button onClick={() => advanceQuarantine(q, 'Rejected')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><AlertOctagon className="w-4 h-4" /> Reject</button>}
                    {q.status === 'Held' && <button onClick={() => advanceQuarantine(q, 'Returned to Supplier')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Undo2 className="w-4 h-4" /> Return to Supplier</button>}
                    {q.status === 'Held' && <button onClick={() => advanceQuarantine(q, 'Disposed')} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"><Trash2 className="w-4 h-4" /> Dispose</button>}
                    <button onClick={() => removeQuarantine(q.id)} disabled={actingOn === q.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === q.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  </>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Serials & Lots ── */}
      {sub === 'serials-lots' && (
        <>
          <InventoryTable
            title="Serials"
            rows={serials.filter(s => matchSearch(s.serial_number) || matchSearch(itemLabel(s.item_id)))}
            rowKey={s => s.id}
            loading={loading}
            emptyMessage="No serials tracked."
            columns={[
              { key: 'serial', header: 'Serial #', widthClass: 'md:w-48 shrink-0', render: s => <span className="font-medium text-slate-900 dark:text-white">{s.serial_number}</span> },
              { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: s => <span className="text-sm text-slate-700 dark:text-slate-300">{itemLabel(s.item_id)}</span> },
              { key: 'store', header: 'Store', widthClass: 'md:w-40 shrink-0', render: s => <span className="text-sm text-slate-600">{storeLabel(s.store_id)}</span> },
              { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: s => <Badge tone="neutral">{s.condition}</Badge> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: s => <Badge tone={statusToneFor(s.status)} variant="solid">{s.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: s => (
                <OpsCell>
                  {renderMenu(s.id, (
                    <button onClick={() => removeSerial(s.id)} disabled={actingOn === s.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  ))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Lots"
            rows={lots.filter(l => matchSearch(l.lot_number) || matchSearch(itemLabel(l.item_id)))}
            rowKey={l => l.id}
            loading={loading}
            emptyMessage="No lots tracked."
            columns={[
              { key: 'lot', header: 'Lot #', widthClass: 'md:w-48 shrink-0', render: l => <span className="font-medium text-slate-900 dark:text-white">{l.lot_number}</span> },
              { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: l => <span className="text-sm text-slate-700 dark:text-slate-300">{itemLabel(l.item_id)}</span> },
              { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: l => <span className="text-sm font-medium">{l.quantity}</span> },
              { key: 'mfg', header: 'Mfg Date', widthClass: 'md:w-32 shrink-0', render: l => <span className="text-xs text-slate-500">{l.manufacturing_date || '—'}</span> },
              { key: 'expiry', header: 'Expiry', widthClass: 'md:w-32 shrink-0', render: l => <span className="text-xs text-slate-500">{l.expiry_date || '—'}</span> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: l => <Badge tone={statusToneFor(l.status)} variant="solid">{l.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: l => (
                <OpsCell>
                  {renderMenu(l.id, (
                    <button onClick={() => removeLot(l.id)} disabled={actingOn === l.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  ))}
                </OpsCell>
              ) },
            ]}
          />
        </>
      )}

      {/* ── Expiry ── */}
      {sub === 'expiry' && (
        <InventoryTable
          rows={expiry.filter(e => matchSearch(e.item_name) || matchSearch(e.batch_number))}
          rowKey={e => `${e.batch_id}-${e.source}`}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No expiry alerts. Items with expiry dates will appear here."
          columns={[
            { key: 'item', header: 'Item', widthClass: 'md:w-56 shrink-0', render: e => <span className="font-medium text-slate-900 dark:text-white">{e.item_name}</span> },
            { key: 'batch', header: 'Batch / Lot', widthClass: 'md:w-40 shrink-0', render: e => <span className="text-sm text-slate-600">{e.batch_number}</span> },
            { key: 'store', header: 'Store', widthClass: 'md:w-40 shrink-0', render: e => <span className="text-sm text-slate-600">{storeLabel(e.store_id)}</span> },
            { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: e => <span className="text-sm font-medium">{e.quantity}</span> },
            { key: 'expiry', header: 'Expiry Date', widthClass: 'md:w-32 shrink-0', render: e => <span className="text-xs text-slate-500">{e.expiry_date}</span> },
            { key: 'bucket', header: 'Alert', widthClass: 'md:w-28 shrink-0', render: e => <Badge tone={expiryBucketTone(e.alert_bucket)} variant="solid">{e.alert_bucket}</Badge> },
          ]}
        />
      )}

      {/* ── Modals ── */}
      <ModalSystem isOpen={showPutawayForm} onClose={() => setShowPutawayForm(false)} onConfirm={submitPutaway} title="New Put-Away Task" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Item *">{itemSelect(putawayForm.item_id || '', v => setPutawayForm({ ...putawayForm, item_id: v }))}</Field>
          <Field label="Store *">{storeSelect(putawayForm.store_id || '', v => setPutawayForm({ ...putawayForm, store_id: v }))}</Field>
          <Field label="Quantity *"><input type="number" className={inputClass} value={putawayForm.quantity ?? 0} onChange={e => setPutawayForm({ ...putawayForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit"><input className={inputClass} value={putawayForm.unit || ''} onChange={e => setPutawayForm({ ...putawayForm, unit: e.target.value })} /></Field>
          <Field label="Recommended Location"><input className={inputClass} value={putawayForm.recommended_location || ''} onChange={e => setPutawayForm({ ...putawayForm, recommended_location: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={putawayForm.notes || ''} onChange={e => setPutawayForm({ ...putawayForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showPickingForm} onClose={() => setShowPickingForm(false)} onConfirm={submitPicking} title="New Picking Task" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Item *">{itemSelect(pickingForm.item_id || '', v => setPickingForm({ ...pickingForm, item_id: v }))}</Field>
          <Field label="Store *">{storeSelect(pickingForm.store_id || '', v => setPickingForm({ ...pickingForm, store_id: v }))}</Field>
          <Field label="Source Type">
            <select className={inputClass} value={pickingForm.source_type || 'Issue'} onChange={e => setPickingForm({ ...pickingForm, source_type: e.target.value as any })}>
              {['Issue', 'Transfer', 'Reservation', 'Production'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Pick Strategy">
            <select className={inputClass} value={pickingForm.pick_strategy || 'FIFO'} onChange={e => setPickingForm({ ...pickingForm, pick_strategy: e.target.value as any })}>
              {['FIFO', 'FEFO', 'LIFO', 'Manual'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Quantity *"><input type="number" className={inputClass} value={pickingForm.quantity ?? 0} onChange={e => setPickingForm({ ...pickingForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit"><input className={inputClass} value={pickingForm.unit || ''} onChange={e => setPickingForm({ ...pickingForm, unit: e.target.value })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={pickingForm.notes || ''} onChange={e => setPickingForm({ ...pickingForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showReturnForm} onClose={() => setShowReturnForm(false)} onConfirm={submitReturn} title="New Return" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Store *">{storeSelect(returnForm.store_id || '', v => setReturnForm({ ...returnForm, store_id: v }))}</Field>
          <Field label="Department"><input className={inputClass} value={returnForm.department || ''} onChange={e => setReturnForm({ ...returnForm, department: e.target.value || null })} /></Field>
          <Field label="Return Date *"><input type="date" className={inputClass} value={returnForm.return_date || ''} onChange={e => setReturnForm({ ...returnForm, return_date: e.target.value })} /></Field>
          <Field label="Received By"><input className={inputClass} value={returnForm.received_by || ''} onChange={e => setReturnForm({ ...returnForm, received_by: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={returnForm.notes || ''} onChange={e => setReturnForm({ ...returnForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showQuarantineForm} onClose={() => setShowQuarantineForm(false)} onConfirm={submitQuarantine} title="Quarantine Item" loading={submitting} confirmLabel="Quarantine">
        <div className="space-y-4">
          <Field label="Item *">{itemSelect(quarantineForm.item_id || '', v => setQuarantineForm({ ...quarantineForm, item_id: v }))}</Field>
          <Field label="Store">{storeSelect(quarantineForm.store_id || '', v => setQuarantineForm({ ...quarantineForm, store_id: v }))}</Field>
          <Field label="Quantity *"><input type="number" className={inputClass} value={quarantineForm.quantity ?? 0} onChange={e => setQuarantineForm({ ...quarantineForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit"><input className={inputClass} value={quarantineForm.unit || ''} onChange={e => setQuarantineForm({ ...quarantineForm, unit: e.target.value })} /></Field>
          <Field label="Reason *"><input className={inputClass} value={quarantineForm.reason || ''} onChange={e => setQuarantineForm({ ...quarantineForm, reason: e.target.value })} /></Field>
          <Field label="Source">
            <select className={inputClass} value={quarantineForm.source || 'Receiving'} onChange={e => setQuarantineForm({ ...quarantineForm, source: e.target.value as any })}>
              {['Receiving', 'Return', 'Damage', 'Inspection', 'Expiry', 'Other'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={quarantineForm.notes || ''} onChange={e => setQuarantineForm({ ...quarantineForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showSerialForm} onClose={() => setShowSerialForm(false)} onConfirm={submitSerial} title="New Serial" loading={submitting} confirmLabel="Save">
        <div className="space-y-4">
          <Field label="Item *">{itemSelect(serialForm.item_id || '', v => setSerialForm({ ...serialForm, item_id: v }))}</Field>
          <Field label="Serial Number *"><input className={inputClass} value={serialForm.serial_number || ''} onChange={e => setSerialForm({ ...serialForm, serial_number: e.target.value })} /></Field>
          <Field label="Store">{storeSelect(serialForm.store_id || '', v => setSerialForm({ ...serialForm, store_id: v }))}</Field>
          <Field label="Custodian"><input className={inputClass} value={serialForm.custodian || ''} onChange={e => setSerialForm({ ...serialForm, custodian: e.target.value || null })} /></Field>
          <Field label="Condition">
            <select className={inputClass} value={serialForm.condition || 'New'} onChange={e => setSerialForm({ ...serialForm, condition: e.target.value as any })}>
              {['New', 'Excellent', 'Good', 'Fair', 'Poor', 'Damaged', 'Unusable'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={serialForm.notes || ''} onChange={e => setSerialForm({ ...serialForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showLotForm} onClose={() => setShowLotForm(false)} onConfirm={submitLot} title="New Lot" loading={submitting} confirmLabel="Save">
        <div className="space-y-4">
          <Field label="Item *">{itemSelect(lotForm.item_id || '', v => setLotForm({ ...lotForm, item_id: v }))}</Field>
          <Field label="Lot Number *"><input className={inputClass} value={lotForm.lot_number || ''} onChange={e => setLotForm({ ...lotForm, lot_number: e.target.value })} /></Field>
          <Field label="Store">{storeSelect(lotForm.store_id || '', v => setLotForm({ ...lotForm, store_id: v }))}</Field>
          <Field label="Quantity"><input type="number" className={inputClass} value={lotForm.quantity ?? 0} onChange={e => setLotForm({ ...lotForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit Cost"><input type="number" className={inputClass} value={lotForm.unit_cost ?? 0} onChange={e => setLotForm({ ...lotForm, unit_cost: Number(e.target.value) })} /></Field>
          <Field label="Manufacturing Date"><input type="date" className={inputClass} value={lotForm.manufacturing_date || ''} onChange={e => setLotForm({ ...lotForm, manufacturing_date: e.target.value || null })} /></Field>
          <Field label="Expiry Date"><input type="date" className={inputClass} value={lotForm.expiry_date || ''} onChange={e => setLotForm({ ...lotForm, expiry_date: e.target.value || null })} /></Field>
          <Field label="Supplier"><input className={inputClass} value={lotForm.supplier || ''} onChange={e => setLotForm({ ...lotForm, supplier: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default StorekeepingModule;
