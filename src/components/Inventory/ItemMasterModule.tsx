/**
 * Item Master — /erp/inventory/items
 * DB-integrated via /api/uinv-portal/items.
 * Central definition of every inventory-controlled item (spec §6).
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Package, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  Edit3, Trash2, CheckCircle2, X, Tag,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchItems, createItem, updateItem, deleteItem,
  type UinvItem,
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

const CATEGORIES = ['Food & Beverage', 'Housekeeping', 'Engineering', 'Office Supplies', 'Operating Supplies', 'Spa', 'Administration'];
const ITEM_TYPES = ['Inventory Item', 'Non-Inventory Item', 'Consumable', 'Spare Part', 'Asset', 'Food', 'Beverage', 'Service'];
const COSTING_METHODS = ['Weighted Average', 'FIFO', 'Standard Cost'];

const EMPTY_FORM = {
  item_code: '', item_name: '', description: '', category: 'Food & Beverage', subcategory: '',
  secondary_categories: [] as string[],
  item_type: 'Inventory Item', brand: '', manufacturer: '', sku: '', barcode: '',
  unit_of_measure: 'PCS', batch_controlled: false, expiry_controlled: false, fefo_required: false,
  min_stock: 0, max_stock: 0, reorder_point: 0, safety_stock: 0, par_level: 0,
  costing_method: 'Weighted Average', last_cost: 0, avg_cost: 0, standard_cost: 0,
};

const ItemMasterModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [items, setItems] = useState<UinvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UinvItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchItems({ propertyId: currentPropertyId || undefined });
      setItems(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      // Match primary category OR any secondary category
      const allCats = [it.category, ...(it.secondary_categories || [])];
      const matchesCat = categoryFilter === 'All' || allCats.includes(categoryFilter);
      const matchesSearch = !q || it.item_name.toLowerCase().includes(q) || it.item_code.toLowerCase().includes(q) || (it.sku || '').toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [items, search, categoryFilter]);

  const counts = {
    total: items.length,
    active: items.filter(i => i.is_active).length,
    batchControlled: items.filter(i => i.batch_controlled).length,
    expiryControlled: items.filter(i => i.expiry_controlled).length,
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (it: UinvItem) => {
    setEditing(it);
    setForm({
      item_code: it.item_code, item_name: it.item_name, description: it.description || '',
      category: it.category, subcategory: it.subcategory || '',
      secondary_categories: it.secondary_categories || [],
      item_type: it.item_type,
      brand: it.brand || '', manufacturer: it.manufacturer || '', sku: it.sku || '', barcode: it.barcode || '',
      unit_of_measure: it.unit_of_measure, batch_controlled: it.batch_controlled,
      expiry_controlled: it.expiry_controlled, fefo_required: it.fefo_required,
      min_stock: it.min_stock, max_stock: it.max_stock || 0, reorder_point: it.reorder_point,
      safety_stock: it.safety_stock, par_level: it.par_level,
      costing_method: it.costing_method, last_cost: it.last_cost, avg_cost: it.avg_cost, standard_cost: it.standard_cost,
    });
    setMenuOpen(null);
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.item_name.trim() || !form.item_code.trim()) return;
    setSubmitting(true);
    try {
      const payload = { ...form, property_id: currentPropertyId };
      if (editing) {
        const updated = await updateItem(editing.id, payload);
        setItems(prev => prev.map(i => (i.id === editing.id ? updated : i)));
        addNotification(`Item ${updated.item_name} updated.`, 'success', 'Inventory');
      } else {
        const created = await createItem(payload);
        setItems(prev => [created, ...prev]);
        addNotification(`Item ${created.item_name} created.`, 'success', 'Inventory');
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditing(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save item', 'error', 'Inventory');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      addNotification('Item deleted.', 'warning', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete item', 'error', 'Inventory');
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Item Master"
        subtitle="Central definition of every inventory-controlled item."
        icon={Package}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openCreate} className={button.primary}>
              <Plus className="w-4 h-4" /> New Item
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total SKUs" value={counts.total} icon={Package} tone="accent" />
        <StatCard title="Active" value={counts.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Batch Controlled" value={counts.batchControlled} icon={Package} tone="info" />
        <StatCard title="Expiry Controlled" value={counts.expiryControlled} icon={Clock} tone="warning" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {['All', ...CATEGORIES].map(f => (
              <button key={f} onClick={() => setCategoryFilter(f)}
                className={['px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  categoryFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search name, code, SKU…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      <InventoryTable
        rows={filtered}
        rowKey={(it) => it.id}
        loading={loading}
        loadingMessage="Loading items…"
        error={error}
        onRetry={load}
        emptyMessage={items.length === 0 ? 'No items defined yet.' : 'No items match the filters.'}
        columns={[
          {
            key: 'item',
            header: 'Item',
            widthClass: 'md:w-72 shrink-0',
            render: (it) => (
              <IdentityCell
                icon={<Package className="w-5 h-5" />}
                soft={it.is_active ? statusTone.accent.soft : statusTone.neutral.soft}
                text={it.is_active ? statusTone.accent.text : statusTone.neutral.text}
                name={it.item_name}
                code={`${it.item_code} · ${it.unit_of_measure}`}
              />
            ),
          },
          {
            key: 'category',
            header: 'Category',
            widthClass: 'md:w-40 shrink-0',
            render: (it) => (
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="neutral">{it.category}</Badge>
                {(it.secondary_categories || []).map((c, i) => (
                  <Badge key={i} tone="info" variant="soft">{c}</Badge>
                ))}
              </div>
            ),
          },
          {
            key: 'subcategory',
            header: 'Subcategory',
            widthClass: 'md:w-36 shrink-0',
            render: (it) => it.subcategory ? <span className="text-slate-600 dark:text-slate-400 text-sm">{it.subcategory}</span> : <span className="text-slate-400">—</span>,
          },
          {
            key: 'type',
            header: 'Type',
            widthClass: 'md:w-32 shrink-0',
            render: (it) => (
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="info">{it.item_type}</Badge>
                {it.batch_controlled && <Badge tone="warning">Batch</Badge>}
                {it.expiry_controlled && <Badge tone="warning">Expiry</Badge>}
                {it.fefo_required && <Badge tone="warning">FEFO</Badge>}
              </div>
            ),
          },
          {
            key: 'reorder',
            header: 'Reorder',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (it) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{it.reorder_point}</span>,
          },
          {
            key: 'min',
            header: 'Min',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (it) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{it.min_stock}</span>,
          },
          {
            key: 'par',
            header: 'Par',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (it) => <span className="text-slate-600 dark:text-slate-400 tabular-nums">{it.par_level}</span>,
          },
          {
            key: 'avgCost',
            header: 'Avg Cost',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (it) => <span className="text-slate-700 dark:text-slate-300 tabular-nums font-medium">${it.avg_cost.toFixed(2)}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-28 shrink-0',
            render: (it) => (
              <Badge tone={it.is_active ? 'success' : 'neutral'} variant="solid">{it.is_active ? 'Active' : 'Inactive'}</Badge>
            ),
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-20 shrink-0',
            align: 'right',
            render: (it) => (
              <OpsCell>
                <div className="relative">
                  <IconButton title="Actions" onClick={() => setMenuOpen(menuOpen === it.id ? null : it.id)}>
                    <MoreVertical className="w-4 h-4" />
                  </IconButton>
                  {menuOpen === it.id && (
                    <div className="absolute right-0 top-full mt-1 z-10 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                      <button onClick={() => openEdit(it)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Edit3 className="w-4 h-4" /> Edit</button>
                      <button onClick={() => remove(it.id)} disabled={actingOn === it.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                        {actingOn === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                      </button>
                    </div>
                  )}
                </div>
              </OpsCell>
            ),
          },
        ]}
      />

      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} variant="form" size="xl"
        title={editing ? 'Edit Item' : 'New Item'} subtitle="Item master definition"
        confirmLabel={editing ? 'Save Changes' : 'Create Item'} onConfirm={submit} loading={submitting}
        confirmColor="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Item Code *"><input className={inputClass} value={form.item_code} onChange={e => setForm({ ...form, item_code: e.target.value })} /></Field>
          <Field label="Item Name *"><input className={inputClass} value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} /></Field>
          <Field label="Primary Category"><select className={inputClass} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Subcategory"><input className={inputClass} value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Additional Categories (Dual / Triple)</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.filter(c => c !== form.category).map(c => {
                const selected = (form.secondary_categories || []).includes(c);
                return (
                  <button key={c} type="button" onClick={() => {
                    const current = form.secondary_categories || [];
                    const next = selected ? current.filter((x: string) => x !== c) : [...current, c];
                    setForm({ ...form, secondary_categories: next });
                  }}
                    className={['flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                      selected ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-slate-700 text-gray-500 hover:border-gray-300 dark:hover:border-slate-600'].join(' ')}>
                    <Tag className="w-3 h-3" />
                    {c}
                    {selected && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Select additional categories for items that belong to multiple departments (e.g. cleaning supplies used by both Housekeeping and Engineering).</p>
          </div>
          <Field label="Item Type"><select className={inputClass} value={form.item_type} onChange={e => setForm({ ...form, item_type: e.target.value })}>{ITEM_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Unit of Measure"><input className={inputClass} value={form.unit_of_measure} onChange={e => setForm({ ...form, unit_of_measure: e.target.value })} /></Field>
          <Field label="Brand"><input className={inputClass} value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} /></Field>
          <Field label="SKU"><input className={inputClass} value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></Field>
          <Field label="Barcode"><input className={inputClass} value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} /></Field>
          <Field label="Costing Method"><select className={inputClass} value={form.costing_method} onChange={e => setForm({ ...form, costing_method: e.target.value })}>{COSTING_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Min Stock"><input type="number" className={inputClass} value={form.min_stock} onChange={e => setForm({ ...form, min_stock: +e.target.value })} /></Field>
          <Field label="Max Stock"><input type="number" className={inputClass} value={form.max_stock} onChange={e => setForm({ ...form, max_stock: +e.target.value })} /></Field>
          <Field label="Reorder Point"><input type="number" className={inputClass} value={form.reorder_point} onChange={e => setForm({ ...form, reorder_point: +e.target.value })} /></Field>
          <Field label="Safety Stock"><input type="number" className={inputClass} value={form.safety_stock} onChange={e => setForm({ ...form, safety_stock: +e.target.value })} /></Field>
          <Field label="Par Level"><input type="number" className={inputClass} value={form.par_level} onChange={e => setForm({ ...form, par_level: +e.target.value })} /></Field>
          <Field label="Last Cost"><input type="number" step="0.01" className={inputClass} value={form.last_cost} onChange={e => setForm({ ...form, last_cost: +e.target.value })} /></Field>
          <Field label="Avg Cost"><input type="number" step="0.01" className={inputClass} value={form.avg_cost} onChange={e => setForm({ ...form, avg_cost: +e.target.value })} /></Field>
          <Field label="Standard Cost"><input type="number" step="0.01" className={inputClass} value={form.standard_cost} onChange={e => setForm({ ...form, standard_cost: +e.target.value })} /></Field>
          <Field label="Description"><input className={inputClass} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-4 mt-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.batch_controlled} onChange={e => setForm({ ...form, batch_controlled: e.target.checked })} /> Batch Controlled</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.expiry_controlled} onChange={e => setForm({ ...form, expiry_controlled: e.target.checked })} /> Expiry Controlled</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.fefo_required} onChange={e => setForm({ ...form, fefo_required: e.target.checked })} /> FEFO Required</label>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ItemMasterModule;
