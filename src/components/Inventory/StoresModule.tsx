/**
 * Stores — /erp/inventory/stores
 * DB-integrated via /api/uinv-portal/stores + /api/uinv-portal/locations.
 * Store master + location hierarchy (zone/rack/shelf/bin) per spec §11, §12.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  Edit3, Trash2, MapPin, ChevronRight, ArrowLeft, ArrowRight,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchStores, createStore, updateStore, deleteStore,
  fetchLocations, createLocation, updateLocation, deleteLocation,
  fetchStock, transferStock,
  type UinvStore, type UinvLocation,
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

const STORE_TYPES = ['Main', 'Department', 'Warehouse', 'Store', 'Departmental', 'Virtual'];
const TEMP_ZONES = ['Ambient', 'Cold', 'Frozen', 'Mixed'];
const LOCATION_TYPES = ['Zone', 'Rack', 'Shelf', 'Bin'];
const DEPARTMENTS = [
  'Food & Beverage', 'Housekeeping', 'Engineering', 'Front Office', 'Finance',
  'Human Resources', 'Security', 'Procurement', 'Sales', 'Transportation',
  'Concierge', 'Spa & Wellness', 'Banquet & Events', 'Operations', 'Admin', 'Executive',
];

const StoresModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [locations, setLocations] = useState<UinvLocation[]>([]);
  const [stockByStore, setStockByStore] = useState<Record<string, { items: number; totalQty: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedStore, setSelectedStore] = useState<UinvStore | null>(null);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [showLocForm, setShowLocForm] = useState(false);
  const [editingStore, setEditingStore] = useState<UinvStore | null>(null);
  const [editingLoc, setEditingLoc] = useState<UinvLocation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [storeForm, setStoreForm] = useState<any>({ store_code: '', store_name: '', store_type: 'Warehouse', department: '', manager: '', location: '', capacity: 0, temperature_zone: 'Ambient', notes: '' });
  const [locForm, setLocForm] = useState<any>({ location_code: '', location_name: '', location_type: 'Bin', temperature_zone: 'Ambient', capacity: 0 });
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState<UinvStore | null>(null);
  const [mainStock, setMainStock] = useState<any[]>([]);
  const [transferForm, setTransferForm] = useState<any>({ itemId: '', quantity: 0, reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, l, stock] = await Promise.all([
        fetchStores({ propertyId: currentPropertyId || undefined }),
        fetchLocations({ active: 'true' }),
        fetchStock({ propertyId: currentPropertyId || undefined }),
      ]);
      setStores(s);
      setLocations(l);
      // Aggregate stock by store_id
      const byStore: Record<string, { items: number; totalQty: number }> = {};
      for (const b of (stock || [])) {
        if (!byStore[b.store_id]) byStore[b.store_id] = { items: 0, totalQty: 0 };
        byStore[b.store_id].items++;
        byStore[b.store_id].totalQty += Number(b.on_hand || 0);
      }
      setStockByStore(byStore);
    } catch (e: any) {
      setError(e?.message || 'Failed to load stores');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const storeLocations = useMemo(() => {
    if (!selectedStore) return [];
    return locations.filter(l => l.store_id === selectedStore.id);
  }, [locations, selectedStore]);

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter(s => !q || s.store_name.toLowerCase().includes(q) || s.store_code.toLowerCase().includes(q));
  }, [stores, search]);

  const counts = {
    total: stores.length,
    active: stores.filter(s => s.is_active).length,
    locations: locations.length,
    coldChain: stores.filter(s => s.temperature_zone === 'Cold' || s.temperature_zone === 'Frozen').length,
  };

  const openCreateStore = () => { setEditingStore(null); setStoreForm({ store_code: '', store_name: '', store_type: 'Warehouse', department: '', manager: '', location: '', capacity: 0, temperature_zone: 'Ambient', notes: '' }); setShowStoreForm(true); };
  const openEditStore = (s: UinvStore) => {
    setEditingStore(s);
    setStoreForm({ store_code: s.store_code, store_name: s.store_name, store_type: s.store_type, department: s.department || '', manager: s.manager || '', location: s.location || '', capacity: s.capacity || 0, temperature_zone: s.temperature_zone || 'Ambient', notes: s.notes || '' });
    setMenuOpen(null);
    setShowStoreForm(true);
  };

  const submitStore = async () => {
    if (!storeForm.store_name.trim() || !storeForm.store_code.trim()) return;
    setSubmitting(true);
    try {
      // Convert empty department string to null (null = inventory portal store)
      const payload = { ...storeForm, department: storeForm.department || null, property_id: currentPropertyId };
      if (editingStore) {
        const updated = await updateStore(editingStore.id, payload);
        setStores(prev => prev.map(s => (s.id === editingStore.id ? updated : s)));
        if (selectedStore?.id === editingStore.id) setSelectedStore(updated);
        addNotification(`Store ${updated.store_name} updated.`, 'success', 'Inventory');
      } else {
        const created = await createStore(payload);
        setStores(prev => [created, ...prev]);
        addNotification(`Store ${created.store_name} created.`, 'success', 'Inventory');
      }
      setShowStoreForm(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save store', 'error', 'Inventory');
    } finally {
      setSubmitting(false);
    }
  };

  const removeStore = async (id: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      await deleteStore(id);
      setStores(prev => prev.filter(s => s.id !== id));
      if (selectedStore?.id === id) setSelectedStore(null);
      addNotification('Store deleted.', 'warning', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete store', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const openCreateLoc = () => { setEditingLoc(null); setLocForm({ location_code: '', location_name: '', location_type: 'Bin', temperature_zone: 'Ambient', capacity: 0 }); setShowLocForm(true); };
  const openEditLoc = (l: UinvLocation) => {
    setEditingLoc(l);
    setLocForm({ location_code: l.location_code, location_name: l.location_name, location_type: l.location_type, temperature_zone: l.temperature_zone || 'Ambient', capacity: l.capacity || 0 });
    setShowLocForm(true);
  };

  const submitLoc = async () => {
    if (!locForm.location_name.trim() || !locForm.location_code.trim() || !selectedStore) return;
    setSubmitting(true);
    try {
      const payload = { ...locForm, store_id: selectedStore.id };
      if (editingLoc) {
        const updated = await updateLocation(editingLoc.id, payload);
        setLocations(prev => prev.map(l => (l.id === editingLoc.id ? updated : l)));
        addNotification(`Location ${updated.location_name} updated.`, 'success', 'Inventory');
      } else {
        const created = await createLocation(payload);
        setLocations(prev => [created, ...prev]);
        addNotification(`Location ${created.location_name} created.`, 'success', 'Inventory');
      }
      setShowLocForm(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save location', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const removeLoc = async (id: string) => {
    setActingOn(id);
    try {
      await deleteLocation(id);
      setLocations(prev => prev.filter(l => l.id !== id));
      addNotification('Location deleted.', 'warning', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete location', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const openTransfer = async (store: UinvStore) => {
    setMenuOpen(null);
    setTransferTarget(store);
    setTransferForm({ itemId: '', quantity: 0, reason: '' });
    setShowTransfer(true);
    try {
      const stock = await fetchStock({ propertyId: currentPropertyId || undefined, storeId: 'UINV-ST-MAIN' });
      setMainStock(stock || []);
    } catch { setMainStock([]); }
  };

  const submitTransfer = async () => {
    if (!transferTarget || !transferForm.itemId || !transferForm.quantity || Number(transferForm.quantity) <= 0) {
      addNotification('Select an item and enter a valid quantity.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const result = await transferStock({
        itemId: transferForm.itemId,
        toStoreId: transferTarget.id,
        quantity: Number(transferForm.quantity),
        reason: transferForm.reason || undefined,
      });
      addNotification(result.message || `Stock transferred to ${transferTarget.store_name}.`, 'success', 'Inventory');
      setShowTransfer(false);
      // Reload stock counts
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to transfer stock', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title={selectedStore ? `Stores · ${selectedStore.store_name}` : 'Stores'}
        subtitle={selectedStore ? 'Location hierarchy (zone / rack / shelf / bin)' : 'Store master — warehouses and storage locations.'}
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            {selectedStore && <button onClick={() => setSelectedStore(null)} className={button.secondary}><ArrowLeft className="w-4 h-4" /> Back</button>}
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            {(!selectedStore || !selectedStore.is_department_store) && (
              <button onClick={selectedStore ? openCreateLoc : openCreateStore} className={button.primary}>
                <Plus className="w-4 h-4" /> {selectedStore ? 'New Location' : 'New Store'}
              </button>
            )}
          </div>
        }
      />

      {!selectedStore && (
        <div className={layout.kpiGrid}>
          <StatCard title="Total Stores" value={counts.total} icon={Building2} tone="accent" />
          <StatCard title="Active" value={counts.active} icon={Building2} tone="success" />
          <StatCard title="Locations" value={counts.locations} icon={MapPin} tone="info" />
          <StatCard title="Cold Chain" value={counts.coldChain} icon={Building2} tone="warning" />
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {!selectedStore && (
        <SectionCard pad="md">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search store name or code…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </SectionCard>
      )}

      {/* Store list */}
      {!selectedStore && (
        <InventoryTable
          rows={filteredStores}
          rowKey={(s) => s.id}
          loading={loading}
          loadingMessage="Loading stores…"
          error={error}
          onRetry={load}
          emptyMessage={stores.length === 0 ? 'No stores defined yet.' : 'No stores match the search.'}
          columns={[
            {
              key: 'store',
              header: 'Store',
              widthClass: 'md:w-80 shrink-0',
              render: (s) => (
                <IdentityCell
                  icon={<Building2 className="w-5 h-5" />}
                  soft={s.is_active ? statusTone.accent.soft : statusTone.neutral.soft}
                  text={s.is_active ? statusTone.accent.text : statusTone.neutral.text}
                  name={s.store_name}
                  code={`${s.store_code} · ${s.store_type}`}
                />
              ),
            },
            {
              key: 'type',
              header: 'Type',
              widthClass: 'md:w-32 shrink-0',
              render: (s) => <Badge tone="neutral">{s.store_type}</Badge>,
            },
            {
              key: 'tempZone',
              header: 'Temp Zone',
              widthClass: 'md:w-28 shrink-0',
              render: (s) => s.temperature_zone ? <Badge tone={s.temperature_zone === 'Ambient' ? 'neutral' : 'info'}>{s.temperature_zone}</Badge> : <span className="text-slate-400">—</span>,
            },
            {
              key: 'manager',
              header: 'Manager',
              widthClass: 'md:w-36 shrink-0',
              render: (s) => s.manager ? <span className="text-slate-600 dark:text-slate-400 text-sm">{s.manager}</span> : <span className="text-slate-400">—</span>,
            },
            {
              key: 'location',
              header: 'Location',
              widthClass: 'md:w-40 shrink-0',
              render: (s) => s.location ? <span className="text-slate-600 dark:text-slate-400 text-sm">{s.location}</span> : <span className="text-slate-400">—</span>,
            },
            {
              key: 'capacity',
              header: 'Capacity',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => s.capacity ? <span className="text-slate-600 dark:text-slate-400 tabular-nums">{s.capacity}</span> : <span className="text-slate-400">—</span>,
            },
            {
              key: 'deptStore',
              header: 'Dept Store',
              widthClass: 'md:w-36 shrink-0',
              render: (s) => s.is_department_store ? <Badge tone="warning" variant="solid">{s.department} · Read-only</Badge> : <span className="text-slate-400">—</span>,
            },
            {
              key: 'stock',
              header: 'Stock',
              widthClass: 'md:w-32 shrink-0',
              align: 'right',
              render: (s) => {
                const stock = stockByStore[s.id];
                if (!stock || stock.items === 0) {
                  return <span className="text-xs text-slate-400">—</span>;
                }
                return (
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{stock.totalQty}</p>
                    <p className="text-[10px] text-slate-400">{stock.items} {stock.items === 1 ? 'item' : 'items'}</p>
                  </div>
                );
              },
            },
            {
              key: 'ops',
              header: 'Ops',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => (
                <OpsCell>
                  <IconButton onClick={() => setSelectedStore(s)} title="View locations">
                    <ChevronRight className="w-4 h-4" />
                  </IconButton>
                  {s.is_department_store ? (
                    /* Department stores: show Transfer Stock button instead of read-only */
                    <button onClick={() => openTransfer(s)} title="Transfer stock from Main Warehouse"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors">
                      <ArrowRight className="w-3 h-3" /> Transfer
                    </button>
                  ) : (
                    <div className="relative">
                      <IconButton onClick={() => setMenuOpen(menuOpen === s.id ? null : s.id)} title="More">
                        <MoreVertical className="w-4 h-4" />
                      </IconButton>
                      {menuOpen === s.id && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                          <button onClick={() => openEditStore(s)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Edit3 className="w-4 h-4" /> Edit</button>
                          <button onClick={() => removeStore(s.id)} disabled={actingOn === s.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                            {actingOn === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </OpsCell>
              ),
            },
          ]}
        />
      )}

      {/* Location list for selected store */}
      {selectedStore && (
        <SectionCard
          title={`Locations in ${selectedStore.store_name}`}
          subtitle={selectedStore.is_department_store ? 'Department store — read-only' : 'Zone → Rack → Shelf → Bin hierarchy'}
          pad="none"
          bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
          actions={selectedStore.is_department_store ? undefined : (
            <button onClick={openCreateLoc} className={button.primary + ' text-xs'}><Plus className="w-3 h-3" /> New Location</button>
          )}
        >
          {loading && <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading locations…</div>}
          {!loading && storeLocations.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No locations defined for this store.</div>}
          {storeLocations.map(l => (
            <div key={l.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 md:w-72 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone.info.soft}`}><MapPin className={`w-4 h-4 ${statusTone.info.text}`} /></div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{l.location_name}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">{l.location_code} · {l.location_type}</p>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{l.location_type}</Badge>
                  {l.temperature_zone && <Badge tone={l.temperature_zone === 'Ambient' ? 'neutral' : 'info'}>{l.temperature_zone}</Badge>}
                  {l.capacity ? <Badge tone="neutral">Cap: {l.capacity}</Badge> : null}
                </div>
              </div>
              <div className="md:w-24 shrink-0 flex justify-end items-center gap-1.5">
                {selectedStore.is_department_store ? (
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Read-only</span>
                ) : (
                  <>
                    <button onClick={() => openEditLoc(l)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"><Edit3 className="w-4 h-4 text-gray-500" /></button>
                    <button onClick={() => removeLoc(l.id)} disabled={actingOn === l.id} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 disabled:opacity-50">
                      {actingOn === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {/* Store modal */}
      <ModalSystem isOpen={showStoreForm} onClose={() => setShowStoreForm(false)} variant="form" size="lg"
        title={editingStore ? 'Edit Store' : 'New Store'} confirmLabel={editingStore ? 'Save' : 'Create'} onConfirm={submitStore} loading={submitting} confirmColor="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Store Code *"><input className={inputClass} value={storeForm.store_code} onChange={e => setStoreForm({ ...storeForm, store_code: e.target.value })} /></Field>
          <Field label="Store Name *"><input className={inputClass} value={storeForm.store_name} onChange={e => setStoreForm({ ...storeForm, store_name: e.target.value })} /></Field>
          <Field label="Store Type"><select className={inputClass} value={storeForm.store_type} onChange={e => setStoreForm({ ...storeForm, store_type: e.target.value })}>{STORE_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Department (optional)">
            <select className={inputClass} value={storeForm.department} onChange={e => setStoreForm({ ...storeForm, department: e.target.value })}>
              <option value="">— Inventory Portal Store —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">Assigning a department makes this store read-only from the inventory portal. The department manages its own stock.</p>
          </Field>
          <Field label="Temperature Zone"><select className={inputClass} value={storeForm.temperature_zone} onChange={e => setStoreForm({ ...storeForm, temperature_zone: e.target.value })}>{TEMP_ZONES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Manager"><input className={inputClass} value={storeForm.manager} onChange={e => setStoreForm({ ...storeForm, manager: e.target.value })} /></Field>
          <Field label="Location"><input className={inputClass} value={storeForm.location} onChange={e => setStoreForm({ ...storeForm, location: e.target.value })} /></Field>
          <Field label="Capacity"><input type="number" className={inputClass} value={storeForm.capacity} onChange={e => setStoreForm({ ...storeForm, capacity: +e.target.value })} /></Field>
          <Field label="Notes"><input className={inputClass} value={storeForm.notes} onChange={e => setStoreForm({ ...storeForm, notes: e.target.value })} /></Field>
        </div>
      </ModalSystem>

      {/* Location modal */}
      <ModalSystem isOpen={showLocForm} onClose={() => setShowLocForm(false)} variant="form" size="md"
        title={editingLoc ? 'Edit Location' : 'New Location'} confirmLabel={editingLoc ? 'Save' : 'Create'} onConfirm={submitLoc} loading={submitting} confirmColor="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Location Code *"><input className={inputClass} value={locForm.location_code} onChange={e => setLocForm({ ...locForm, location_code: e.target.value })} /></Field>
          <Field label="Location Name *"><input className={inputClass} value={locForm.location_name} onChange={e => setLocForm({ ...locForm, location_name: e.target.value })} /></Field>
          <Field label="Location Type"><select className={inputClass} value={locForm.location_type} onChange={e => setLocForm({ ...locForm, location_type: e.target.value })}>{LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Temperature Zone"><select className={inputClass} value={locForm.temperature_zone} onChange={e => setLocForm({ ...locForm, temperature_zone: e.target.value })}>{TEMP_ZONES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Capacity"><input type="number" className={inputClass} value={locForm.capacity} onChange={e => setLocForm({ ...locForm, capacity: +e.target.value })} /></Field>
        </div>
      </ModalSystem>

      {/* Transfer Stock modal — Main Warehouse → department store */}
      <ModalSystem isOpen={showTransfer} onClose={() => setShowTransfer(false)} variant="form" size="md"
        title={`Transfer to ${transferTarget?.store_name || ''}`}
        subtitle="Move stock from Main Warehouse to this department store"
        confirmLabel="Transfer" onConfirm={submitTransfer} loading={submitting} confirmColor="indigo">
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-xs text-indigo-700 dark:text-indigo-300">
            <ArrowRight className="w-4 h-4" />
            Main Warehouse → {transferTarget?.store_name}
          </div>
          <Field label="Item *">
            <select className={inputClass} value={transferForm.itemId} onChange={e => {
              const item = mainStock.find(s => s.item_id === e.target.value);
              setTransferForm({ ...transferForm, itemId: e.target.value, quantity: 0 });
            }}>
              <option value="">Select item from Main Warehouse…</option>
              {mainStock.filter(s => Number(s.on_hand) > 0).map(s => (
                <option key={s.item_id} value={s.item_id}>
                  {s.item?.item_name || s.item_id} — On hand: {s.on_hand} {s.item?.unit_of_measure || ''}
                </option>
              ))}
            </select>
          </Field>
          {transferForm.itemId && (() => {
            const sel = mainStock.find(s => s.item_id === transferForm.itemId);
            const maxQty = Number(sel?.on_hand || 0);
            return (
              <>
                <Field label={`Quantity * (max: ${maxQty})`}>
                  <input type="number" min={1} max={maxQty} className={inputClass} value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: +e.target.value })} />
                </Field>
                <Field label="Reason (optional)">
                  <input className={inputClass} value={transferForm.reason} onChange={e => setTransferForm({ ...transferForm, reason: e.target.value })} placeholder="e.g. Restock for weekly usage" />
                </Field>
              </>
            );
          })()}
          {mainStock.length === 0 && <p className="text-sm text-slate-400">Loading Main Warehouse stock…</p>}
        </div>
      </ModalSystem>
    </div>
  );
};

export default StoresModule;
