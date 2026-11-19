/**
 * Inventory — /erp/inventory/inventory
 * DB-integrated via /api/uinv-portal/stock.
 * Live stock balances per item/store with availability, reserved, FEFO batches.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Boxes, Search, Clock, Loader2, ServerCrash, Package, AlertTriangle,
  CheckCircle2, XCircle, Edit, ArrowDownToLine,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchStock, createAdjustment, updateItem,
  type UinvStockBalance, type UinvItem,
} from '../../services/inventoryService';
import InventoryTable, { IconButton, OpsCell } from './InventoryTable';

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

const fmtNum = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n || 0);

const InventoryModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [balances, setBalances] = useState<UinvStockBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Overstock'>('All');
  const [typeFilter, setTypeFilter] = useState('all'); // Food / Beverage
  const [itemTypeFilter, setItemTypeFilter] = useState('all'); // Consumable / Non-Consumable
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [storageFilter, setStorageFilter] = useState('all'); // Perishable / Non-Perishable / Frozen / Dry / Ambient
  const [locationFilter, setLocationFilter] = useState('all');
  // Edit / Receive modals
  const [editTarget, setEditTarget] = useState<UinvStockBalance | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<UinvStockBalance | null>(null);
  const [editForm, setEditForm] = useState<Partial<UinvItem>>({});
  const [receiveForm, setReceiveForm] = useState({ quantity: 0, unit_cost: 0, reference: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStock({ propertyId: currentPropertyId || undefined });
      setBalances(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load balances');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (b: UinvStockBalance) => {
    setEditTarget(b);
    setEditForm(b.item ? { ...b.item } : {});
  };

  const submitEdit = async () => {
    if (!editTarget?.item) return;
    if (!editForm.item_name) {
      addNotification?.('Item name is required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await updateItem(editTarget.item_id, {
        item_name: editForm.item_name,
        category: editForm.category,
        unit_of_measure: editForm.unit_of_measure,
        min_stock: Number(editForm.min_stock) || 0,
        max_stock: editForm.max_stock != null ? Number(editForm.max_stock) : null,
        reorder_point: Number(editForm.reorder_point) || 0,
        par_level: Number(editForm.par_level) || 0,
        safety_stock: Number(editForm.safety_stock) || 0,
        last_cost: Number(editForm.last_cost) || 0,
        item_type: editForm.item_type,
        brand: editForm.brand || null,
        manufacturer: editForm.manufacturer || null,
        description: editForm.description || null,
      });
      addNotification?.(`Item "${editForm.item_name}" updated.`, 'success', 'Inventory');
      setEditTarget(null);
      await load();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to update item', 'warning', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const openReceive = (b: UinvStockBalance) => {
    setReceiveTarget(b);
    setReceiveForm({ quantity: 0, unit_cost: b.unit_cost || 0, reference: '', notes: '' });
  };

  const submitReceive = async () => {
    if (!receiveTarget) return;
    const qty = Number(receiveForm.quantity);
    if (!qty || qty <= 0) {
      addNotification?.('Quantity must be positive.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      // Create an adjustment as a goods receipt (Quantity Increase)
      await createAdjustment({
        property_id: currentPropertyId || null,
        item_id: receiveTarget.item_id,
        store_id: receiveTarget.store_id,
        adjustment_type: 'Quantity Increase',
        reason: 'Goods Receipt',
        quantity_delta: qty,
        unit_cost: Number(receiveForm.unit_cost) || receiveTarget.unit_cost || 0,
        status: 'Approved',
        reference: receiveForm.reference || null,
        notes: receiveForm.notes || 'Goods received into store',
      });
      addNotification?.(`Received ${qty} units of ${receiveTarget.item?.item_name || 'item'}.`, 'success', 'Inventory');
      setReceiveTarget(null);
      await load();
    } catch (e: any) {
      addNotification?.(e?.message || 'Failed to receive goods', 'warning', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const stores = useMemo(() => Array.from(new Set(balances.map(b => b.store?.store_name).filter(Boolean) as string[])), [balances]);
  const categories = useMemo(() => Array.from(new Set(balances.map(b => b.item?.category).filter(Boolean) as string[])).sort(), [balances]);
  const locations = useMemo(() => Array.from(new Set(balances.map(b => b.location?.location_name || b.store?.store_name).filter(Boolean) as string[])).sort(), [balances]);

  /** Resolve the storage/temperature zone for a balance row. */
  const getZone = (b: UinvStockBalance): string => {
    const zone = (b.store?.temperature_zone || b.location?.temperature_zone || 'ambient').toLowerCase();
    return zone;
  };

  /** Normalize a zone value to one of the filter buckets. */
  const normalizeZone = (zone: string): string => {
    if (zone.includes('frozen')) return 'frozen';
    if (zone.includes('cold') || zone.includes('chill') || zone.includes('perish')) return 'perishable';
    if (zone.includes('dry')) return 'dry';
    if (zone.includes('ambient') || zone === '') return 'ambient';
    return 'non-perishable';
  };

  /** Determine if an item is Food or Beverage based on category/store. */
  const getItemTypeGroup = (b: UinvStockBalance): string => {
    const cat = (b.item?.category || '').toLowerCase();
    const storeType = (b.store?.store_type || '').toLowerCase();
    const storeName = (b.store?.store_name || '').toLowerCase();
    if (cat.includes('bev') || storeType.includes('bev') || storeName.includes('beverage')) return 'beverage';
    if (cat.includes('food') || storeType.includes('food') || storeName.includes('food')) return 'food';
    return '';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances.filter(b => {
      const matchesStore = storeFilter === 'All' || b.store?.store_name === storeFilter;
      const matchesSearch = !q || (b.item?.item_name || '').toLowerCase().includes(q) || (b.item?.item_code || '').toLowerCase().includes(q);
      const onHand = b.on_hand || 0;
      const reorder = b.item?.reorder_point || 0;
      const max = b.item?.max_stock || 0;
      const status: 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Overstock' =
        onHand <= 0 ? 'Out of Stock'
        : reorder > 0 && onHand <= reorder ? 'Low Stock'
        : max > 0 && onHand > max ? 'Overstock'
        : 'In Stock';
      const matchesStatus = statusFilter === 'All' || status === statusFilter;
      // Type filter (Food / Beverage)
      const itemGroup = getItemTypeGroup(b);
      const matchesType = typeFilter === 'all' || itemGroup === typeFilter;
      // Item Type filter (Consumable / Non-Consumable)
      const itemType = (b.item?.item_type || '').toLowerCase();
      const matchesItemType = itemTypeFilter === 'all' || itemType === itemTypeFilter;
      // Category filter
      const matchesCategory = categoryFilter === 'all' || b.item?.category === categoryFilter;
      // Storage filter
      const zone = normalizeZone(getZone(b));
      const matchesStorage = storageFilter === 'all' || zone === storageFilter;
      // Location filter
      const locName = b.location?.location_name || b.store?.store_name || '';
      const matchesLocation = locationFilter === 'all' || locName === locationFilter;
      return matchesStore && matchesSearch && matchesStatus && matchesType && matchesItemType && matchesCategory && matchesStorage && matchesLocation;
    });
  }, [balances, search, storeFilter, statusFilter, typeFilter, itemTypeFilter, categoryFilter, storageFilter, locationFilter]);

  const counts = useMemo(() => {
    const total = balances.length;
    const inStock = balances.filter(b => (b.on_hand || 0) > (b.item?.reorder_point || 0)).length;
    const low = balances.filter(b => (b.on_hand || 0) > 0 && (b.on_hand || 0) <= (b.item?.reorder_point || 0)).length;
    const out = balances.filter(b => (b.on_hand || 0) <= 0).length;
    const totalValue = balances.reduce((s, b) => s + (b.on_hand || 0) * (b.unit_cost || 0), 0);
    return { total, inStock, low, out, totalValue };
  }, [balances]);

  const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Inventory"
        subtitle="Live stock balances across all stores."
        icon={Boxes}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total SKUs" value={counts.total} icon={Package} tone="accent" />
        <StatCard title="In Stock" value={counts.inStock} icon={CheckCircle2} tone="success" />
        <StatCard title="Low Stock" value={counts.low} icon={AlertTriangle} tone="warning" />
        <StatCard title="Out of Stock" value={counts.out} icon={XCircle} tone="danger" />
      </div>

      <div className={layout.kpiGrid}>
        <StatCard title="Inventory Value" value={money(counts.totalValue)} icon={Boxes} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Status segmented filter */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {(['All', 'In Stock', 'Low Stock', 'Out of Stock', 'Overstock'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={['px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  statusFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Rich filter bar — search, type, item type, category, storage, location */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-500" />
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-48 outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" type="text" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Type:</label>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
            <option value="all">All</option>
            <option value="food">Food</option>
            <option value="beverage">Beverage</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Item Type:</label>
          <select value={itemTypeFilter} onChange={e => setItemTypeFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
            <option value="all">All Types</option>
            <option value="consumable">Consumable</option>
            <option value="non-consumable">Non-Consumable</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Category:</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
            <option value="all">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Storage:</label>
          <select value={storageFilter} onChange={e => setStorageFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
            <option value="all">All Storage</option>
            <option value="perishable">Perishable</option>
            <option value="non-perishable">Non-Perishable</option>
            <option value="frozen">Frozen</option>
            <option value="dry">Dry</option>
            <option value="ambient">Ambient</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Location:</label>
          <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
            <option value="all">All Locations</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
            <option value="All">All Stores</option>
            {stores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <InventoryTable
        title="Inventory Listing"
        subtitle="All items by store, category and storage type"
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (b: UinvStockBalance) => (
              <span className="font-medium text-slate-900 dark:text-white">{b.item?.item_name || 'Unknown'}</span>
            ),
          },
          {
            key: 'category',
            header: 'Category',
            render: (b: UinvStockBalance) => (
              <span className="text-slate-600 dark:text-slate-400">{b.item?.category || '—'}</span>
            ),
          },
          {
            key: 'storage',
            header: 'Storage',
            render: (b: UinvStockBalance) => {
              const zone = (b.store?.temperature_zone || b.location?.temperature_zone || 'ambient').toLowerCase();
              const tone =
                zone.includes('frozen') ? 'info'
                : zone.includes('cold') || zone.includes('chill') || zone.includes('perish') ? 'danger'
                : zone.includes('dry') ? 'warning'
                : 'neutral';
              return <Badge tone={tone}>{zone}</Badge>;
            },
          },
          {
            key: 'location',
            header: 'Location',
            render: (b: UinvStockBalance) => (
              <span className="text-slate-600 dark:text-slate-400">
                {b.store?.store_name || '—'}{b.location?.location_name ? ` · ${b.location.location_name}` : ''}
              </span>
            ),
          },
          {
            key: 'stocklevel',
            header: 'Stock Level',
            render: (b: UinvStockBalance) => {
              const onHand = b.on_hand || 0;
              const min = b.item?.min_stock || 0;
              const reorder = b.item?.reorder_point || 0;
              const maxRef = b.item?.max_stock || (reorder > 0 ? reorder * 3 : 100);
              const pct = Math.min(100, Math.max(0, (onHand / maxRef) * 100));
              const status = onHand <= 0 && min > 0 ? 'critical' : reorder > 0 && onHand <= reorder ? 'low' : 'normal';
              return (
                <div className="w-24">
                  <div className="h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        status === 'critical' ? 'bg-red-500'
                        : status === 'low' ? 'bg-amber-500'
                        : 'bg-green-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    min: {min} · reorder: {reorder}
                  </div>
                </div>
              );
            },
          },
          {
            key: 'qty',
            header: 'Qty',
            align: 'right',
            render: (b: UinvStockBalance) => {
              const onHand = b.on_hand || 0;
              const reorder = b.item?.reorder_point || 0;
              const min = b.item?.min_stock || 0;
              const status = onHand <= 0 && min > 0 ? 'critical' : reorder > 0 && onHand <= reorder ? 'low' : 'normal';
              return (
                <span className={`font-medium ${
                  status === 'critical' ? 'text-red-600'
                  : status === 'low' ? 'text-amber-600'
                  : 'text-slate-900 dark:text-white'
                }`}>
                  {fmtNum(onHand)}
                </span>
              );
            },
          },
          {
            key: 'unit',
            header: 'Unit',
            render: (b: UinvStockBalance) => (
              <span className="text-slate-600 dark:text-slate-400">{b.item?.unit_of_measure || '—'}</span>
            ),
          },
          {
            key: 'unitcost',
            header: 'Unit Cost',
            align: 'right',
            render: (b: UinvStockBalance) => (
              <span className="text-slate-600 dark:text-slate-400">{money(b.unit_cost || 0)}</span>
            ),
          },
          {
            key: 'stockvalue',
            header: 'Stock Value',
            align: 'right',
            render: (b: UinvStockBalance) => (
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {money((b.on_hand || 0) * (b.unit_cost || 0))}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (b: UinvStockBalance) => {
              const onHand = b.on_hand || 0;
              const reorder = b.item?.reorder_point || 0;
              const min = b.item?.min_stock || 0;
              const status = onHand <= 0 && min > 0 ? 'critical' : reorder > 0 && onHand <= reorder ? 'low' : 'normal';
              return (
                <Badge tone={status === 'critical' ? 'danger' : status === 'low' ? 'warning' : 'success'}>
                  {status}
                </Badge>
              );
            },
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (b: UinvStockBalance) => (
              <OpsCell>
                <IconButton title="Edit" variant="neutral" onClick={() => openEdit(b)}>
                  <Edit className="w-4 h-4" />
                </IconButton>
                <IconButton title="Receive goods" variant="success" onClick={() => openReceive(b)}>
                  <ArrowDownToLine className="w-4 h-4" />
                </IconButton>
              </OpsCell>
            ),
          },
        ]}
        rows={filtered}
        rowKey={(b, i) => `${b.item_id}-${b.store_id}-${i}`}
        loading={loading}
        loadingMessage="Loading balances…"
        error={error}
        onRetry={load}
        emptyMessage={balances.length === 0 ? 'No stock balances yet.' : 'No balances match the filters.'}
        footer={
          filtered.length > 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">
                {filtered.length} items — Total Stock Value:
              </td>
              <td className="px-4 py-3 font-bold text-indigo-600 dark:text-indigo-400 text-right">
                {money(filtered.reduce((s, b) => s + (b.on_hand || 0) * (b.unit_cost || 0), 0))}
              </td>
              <td colSpan={2}></td>
            </tr>
          ) : null
        }
      />

      {/* Edit Item Modal */}
      <ModalSystem
        isOpen={!!editTarget}
        onClose={() => setEditTarget(null)}
        variant="form"
        size="lg"
        title={`Edit Item — ${editTarget?.item?.item_name || ''}`}
        subtitle={`Code: ${editTarget?.item?.item_code || '—'} · Store: ${editTarget?.store?.store_name || '—'} · On Hand: ${fmtNum(editTarget?.on_hand || 0)}`}
        confirmLabel="Update"
        onConfirm={submitEdit}
        loading={submitting}
        confirmColor="indigo"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Item Name *">
            <input className={inputClass} value={editForm.item_name || ''}
              onChange={e => setEditForm({ ...editForm, item_name: e.target.value })} />
          </Field>
          <Field label="Category">
            <input className={inputClass} value={editForm.category || ''}
              onChange={e => setEditForm({ ...editForm, category: e.target.value })} />
          </Field>
          <Field label="Item Type">
            <select className={inputClass} value={editForm.item_type || 'Consumable'}
              onChange={e => setEditForm({ ...editForm, item_type: e.target.value })}>
              <option value="Consumable">Consumable</option>
              <option value="Food">Food</option>
              <option value="Beverage">Beverage</option>
              <option value="Inventory Item">Inventory Item</option>
              <option value="Fixed Asset">Fixed Asset</option>
              <option value="Linen">Linen</option>
            </select>
          </Field>
          <Field label="Unit of Measure">
            <input className={inputClass} value={editForm.unit_of_measure || ''}
              onChange={e => setEditForm({ ...editForm, unit_of_measure: e.target.value })} />
          </Field>
          <Field label="Min Stock">
            <input type="number" step="any" className={inputClass} value={editForm.min_stock ?? 0}
              onChange={e => setEditForm({ ...editForm, min_stock: +e.target.value })} />
          </Field>
          <Field label="Reorder Point">
            <input type="number" step="any" className={inputClass} value={editForm.reorder_point ?? 0}
              onChange={e => setEditForm({ ...editForm, reorder_point: +e.target.value })} />
          </Field>
          <Field label="Par Level">
            <input type="number" step="any" className={inputClass} value={editForm.par_level ?? 0}
              onChange={e => setEditForm({ ...editForm, par_level: +e.target.value })} />
          </Field>
          <Field label="Max Stock">
            <input type="number" step="any" className={inputClass} value={editForm.max_stock ?? 0}
              onChange={e => setEditForm({ ...editForm, max_stock: e.target.value ? +e.target.value : null })} />
          </Field>
          <Field label="Safety Stock">
            <input type="number" step="any" className={inputClass} value={editForm.safety_stock ?? 0}
              onChange={e => setEditForm({ ...editForm, safety_stock: +e.target.value })} />
          </Field>
          <Field label="Last Cost">
            <input type="number" step="0.01" className={inputClass} value={editForm.last_cost ?? 0}
              onChange={e => setEditForm({ ...editForm, last_cost: +e.target.value })} />
          </Field>
          <Field label="Brand">
            <input className={inputClass} value={editForm.brand || ''}
              onChange={e => setEditForm({ ...editForm, brand: e.target.value })} />
          </Field>
          <Field label="Manufacturer">
            <input className={inputClass} value={editForm.manufacturer || ''}
              onChange={e => setEditForm({ ...editForm, manufacturer: e.target.value })} />
          </Field>
          <div className="col-span-1 sm:col-span-2">
            <Field label="Description">
              <textarea className={inputClass} rows={2} value={editForm.description || ''}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Receive Goods Modal */}
      <ModalSystem
        isOpen={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        variant="form"
        size="md"
        title={`Receive Goods — ${receiveTarget?.item?.item_name || ''}`}
        subtitle={`Store: ${receiveTarget?.store?.store_name || '—'} · Current: ${fmtNum(receiveTarget?.on_hand || 0)} ${receiveTarget?.item?.unit_of_measure || ''}`}
        confirmLabel="Receive"
        onConfirm={submitReceive}
        loading={submitting}
        confirmColor="emerald"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Quantity *">
            <input type="number" step="any" className={inputClass} value={receiveForm.quantity}
              onChange={e => setReceiveForm({ ...receiveForm, quantity: +e.target.value })} />
          </Field>
          <Field label="Unit Cost">
            <input type="number" step="any" className={inputClass} value={receiveForm.unit_cost}
              onChange={e => setReceiveForm({ ...receiveForm, unit_cost: +e.target.value })} />
          </Field>
          <Field label="Reference (PO/GRN #)">
            <input className={inputClass} value={receiveForm.reference}
              onChange={e => setReceiveForm({ ...receiveForm, reference: e.target.value })} />
          </Field>
          <Field label="Notes">
            <input className={inputClass} value={receiveForm.notes}
              onChange={e => setReceiveForm({ ...receiveForm, notes: e.target.value })} />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default InventoryModule;
