/**
 * Retail Shop Module
 * DB-backed spa retail catalog (spa_retail_products) with live sales tracking
 * and stock management (spa_retail_sales). Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  ShoppingBag,
  Plus,
  Search,
  Pencil,
  Trash2,
  Package,
  TrendingUp,
  AlertTriangle,
  Tag,
  Loader2,
  RefreshCw,
  PackagePlus,
  CircleMinus,
  DollarSign,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';

interface RetailProduct {
  id: string;
  name: string;
  category: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  min_stock: number;
  description: string | null;
  brand: string | null;
  is_active: boolean;
  sold_this_month: number;
}

interface RetailSale {
  id: string;
  product_id: string;
  guest_id: string | null;
  guest_name: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  payment_method: string | null;
  sold_by: string | null;
  sale_date: string;
}

interface GuestOption { id: string; name: string; }

const RETAIL_CATEGORIES = [
  'Skincare', 'Haircare', 'Massage Oils', 'Supplements', 'Wellness Products', 'Gift Items',
];
const PAYMENT_METHODS = ['Cash', 'Card', 'Room Charge'];

const CATEGORY_TONE: Record<string, StatusTone> = {
  Skincare: 'danger',
  Haircare: 'accent',
  'Massage Oils': 'warning',
  Supplements: 'success',
  'Wellness Products': 'info',
  'Gift Items': 'danger',
};

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

const emptyForm = {
  name: '',
  category: 'Skincare',
  sku: '',
  price: 0,
  cost: 0,
  stock: 0,
  min_stock: 5,
  description: '',
  brand: '',
  is_active: true,
};

const RetailShopModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [products, setProducts] = useState<RetailProduct[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RetailProduct | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<RetailProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // Sell modal
  const [sellTarget, setSellTarget] = useState<RetailProduct | null>(null);
  const [sales, setSales] = useState<RetailSale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [sellGuestId, setSellGuestId] = useState('');
  const [sellQty, setSellQty] = useState(1);
  const [sellPayment, setSellPayment] = useState('Card');

  // Restock modal
  const [restockTarget, setRestockTarget] = useState<RetailProduct | null>(null);
  const [restockQty, setRestockQty] = useState(10);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/retail/products${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setProducts(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchProducts();
    fetch('/api/spa-wellness/guests', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setGuests)
      .catch(() => {});
  }, [fetchProducts]);

  const fetchSales = useCallback(async (productId: string) => {
    setLoadingSales(true);
    try {
      const prop = currentPropertyId ? `&propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/retail/sales?productId=${productId}${prop}`, { credentials: 'include' });
      if (res.ok) setSales(await res.json());
    } finally {
      setLoadingSales(false);
    }
  }, [currentPropertyId]);

  const openSell = (p: RetailProduct) => {
    setSellTarget(p);
    setSellGuestId('');
    setSellQty(1);
    setSellPayment('Card');
    fetchSales(p.id);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => products.filter(p => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;
    const matchesStock = stockFilter === 'All' ||
      (stockFilter === 'Low Stock' && p.stock <= p.min_stock) ||
      (stockFilter === 'In Stock' && p.stock > p.min_stock);
    return matchesSearch && matchesCategory && matchesStock;
  }), [products, search, categoryFilter, stockFilter]);

  const stats = useMemo(() => ({
    total: products.length,
    lowStock: products.filter(p => p.stock <= p.min_stock).length,
    soldMonth: products.reduce((n, p) => n + (p.sold_this_month || 0), 0),
    stockValue: products.reduce((n, p) => n + p.stock * Number(p.cost || 0), 0),
  }), [products]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };

  const openEdit = (p: RetailProduct) => {
    setEditing(p);
    setForm({
      name: p.name,
      category: p.category,
      sku: p.sku,
      price: p.price,
      cost: p.cost,
      stock: p.stock,
      min_stock: p.min_stock,
      description: p.description || '',
      brand: p.brand || '',
      is_active: p.is_active,
    });
    setShowForm(true);
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.sku.trim()) {
      addNotification('Product name and SKU are required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category: form.category,
      sku: form.sku.trim(),
      price: Number(form.price) || 0,
      cost: Number(form.cost) || 0,
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      description: form.description || null,
      brand: form.brand || null,
      is_active: form.is_active,
      propertyId: currentPropertyId || null,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/retail/products/${editing.id}` : '/api/spa-wellness/retail/products', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? 'Product updated' : 'Product added', 'success', 'Spa');
      fetchProducts();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (p: RetailProduct) => {
    setActingOn(p.id);
    try {
      const res = await fetch(`/api/spa-wellness/retail/products/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setProducts(prev => prev.filter(x => x.id !== p.id));
      setDeleteTarget(null);
      addNotification(`${p.name} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const recordSale = async () => {
    if (!sellTarget) return;
    setActingOn('sell');
    try {
      const res = await fetch('/api/spa-wellness/retail/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          product_id: sellTarget.id,
          guest_id: sellGuestId || null,
          quantity: sellQty,
          payment_method: sellPayment,
          propertyId: currentPropertyId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      addNotification(`Sale recorded — ${sellQty} × ${sellTarget.name}`, 'success', 'Spa');
      fetchSales(sellTarget.id);
      fetchProducts();
      setSellTarget(prev => prev ? { ...prev, stock: prev.stock - sellQty } : prev);
    } catch (e: any) {
      addNotification(`Sale failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const voidSale = async (s: RetailSale) => {
    try {
      const res = await fetch(`/api/spa-wellness/retail/sales/${s.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setSales(prev => prev.filter(x => x.id !== s.id));
      addNotification('Sale voided — stock restored', 'success', 'Spa');
      fetchProducts();
    } catch (e: any) {
      addNotification(`Void failed: ${e.message}`, 'warning', 'Spa');
    }
  };

  const restock = async () => {
    if (!restockTarget || restockQty < 1) return;
    setActingOn('restock');
    try {
      const res = await fetch(`/api/spa-wellness/retail/products/${restockTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ adjust: restockQty }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      addNotification(`${restockTarget.name} restocked +${restockQty}`, 'success', 'Spa');
      setRestockTarget(null);
      fetchProducts();
    } catch (e: any) {
      addNotification(`Restock failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const toggleActive = async (p: RetailProduct) => {
    setProducts(prev => prev.map(x => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
    try {
      const res = await fetch(`/api/spa-wellness/retail/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (e: any) {
      setProducts(prev => prev.map(x => (x.id === p.id ? { ...x, is_active: p.is_active } : x)));
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Retail Shop"
        subtitle="Spa retail products, inventory levels, sales and restocking"
        icon={ShoppingBag}
        actions={
          <button onClick={fetchProducts} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Products" value={stats.total} icon={Package} tone="accent" />
        <StatCard title="Low Stock" value={stats.lowStock} icon={AlertTriangle} tone={stats.lowStock > 0 ? 'warning' : 'success'} />
        <StatCard title="Sold This Month" value={stats.soldMonth} icon={TrendingUp} tone="info" />
        <StatCard title="Stock Value" value={`$${stats.stockValue.toLocaleString()}`} icon={DollarSign} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search products, SKU, brand…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Categories</option>
            {RETAIL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Stock Levels</option>
            <option value="Low Stock">Low Stock</option>
            <option value="In Stock">In Stock</option>
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </SectionCard>

      {/* Products */}
      <SectionCard title="Products" subtitle={`${filtered.length} of ${products.length} products`} icon={ShoppingBag} tone="accent" pad="none">
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No products match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-5">
            {filtered.map(p => {
              const lowStock = p.stock <= p.min_stock;
              const margin = p.cost > 0 ? Math.round(((p.price - p.cost) / p.cost) * 100) : 0;
              return (
                <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-accent-spa)]/10 flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-[var(--color-accent-spa)]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{p.sku}</p>
                      </div>
                    </div>
                    <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <Badge tone={CATEGORY_TONE[p.category] || 'neutral'}>{p.category}</Badge>
                    {lowStock && <Badge tone="warning">Low Stock</Badge>}
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-2 min-h-[2.5rem]">{p.description}</p>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="font-bold text-sm text-slate-900 dark:text-white">${p.price}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Price · {margin}% margin</div>
                    </div>
                    <div className={`text-center p-2 rounded-xl ${lowStock ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-slate-50 dark:bg-slate-900/40'}`}>
                      <div className={`font-bold text-sm ${lowStock ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                        {p.stock}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Stock / min {p.min_stock}</div>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 shrink-0" />
                      <span>{p.brand || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                      <span>{p.sold_this_month ?? 0} sold this month</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                    <button
                      onClick={() => toggleActive(p)}
                      className="text-xs font-medium text-[var(--color-accent-spa)] hover:opacity-80 transition"
                    >
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <div className="flex gap-1.5">
                      <button onClick={() => openSell(p)} title="Sell / sales history" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><DollarSign className="w-4 h-4" /></button>
                      <button onClick={() => { setRestockTarget(p); setRestockQty(10); }} title="Restock" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><PackagePlus className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(p)} title="Edit" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(p)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Create / Edit modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveProduct}
        title={editing ? `Edit ${editing.name}` : 'Add Retail Product'}
        subtitle={editing ? editing.sku : 'Product details, pricing and inventory'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Add Product'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Product Name *">
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lavender Massage Oil" />
          </Field>
          <Field label="SKU *">
            <input className={inputCls} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="SKU-XXX-000" />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {RETAIL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Brand">
            <input className={inputCls} value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
          </Field>
          <Field label="Price ($)">
            <input type="number" min={0} step="0.01" className={inputCls} value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} />
          </Field>
          <Field label="Cost ($)">
            <input type="number" min={0} step="0.01" className={inputCls} value={form.cost} onChange={e => setForm(f => ({ ...f, cost: Number(e.target.value) }))} />
          </Field>
          <Field label="Stock">
            <input type="number" min={0} className={inputCls} value={form.stock} onChange={e => setForm(f => ({ ...f, stock: Number(e.target.value) }))} />
          </Field>
          <Field label="Min Stock (low-stock alert)">
            <input type="number" min={0} className={inputCls} value={form.min_stock} onChange={e => setForm(f => ({ ...f, min_stock: Number(e.target.value) }))} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea className={inputCls + ' min-h-[70px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:col-span-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-accent-spa)] focus:ring-[var(--color-accent-spa)]"
            />
            Active (available for sale)
          </label>
        </div>
      </ModalSystem>

      {/* ── Sell / sales history modal ── */}
      <ModalSystem
        isOpen={!!sellTarget}
        onClose={() => setSellTarget(null)}
        title={sellTarget ? `Sell — ${sellTarget.name}` : ''}
        subtitle={sellTarget ? `${sellTarget.sku} · $${sellTarget.price} · ${sellTarget.stock} in stock` : ''}
        variant="info"
        size="lg"
      >
        {sellTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Guest (optional)">
                <select className={inputCls} value={sellGuestId} onChange={e => setSellGuestId(e.target.value)}>
                  <option value="">Walk-in</option>
                  {guests.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
              <Field label="Qty">
                <input type="number" min={1} max={sellTarget.stock} className={inputCls} value={sellQty} onChange={e => setSellQty(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="Payment">
                <select className={inputCls} value={sellPayment} onChange={e => setSellPayment(e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <button
              onClick={recordSale}
              disabled={actingOn === 'sell' || sellTarget.stock < 1 || !sellTarget.is_active}
              className={button.primary}
            >
              <DollarSign className="w-4 h-4" /> Record Sale — ${(sellTarget.price * sellQty).toFixed(2)}
            </button>

            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Sales</div>
            {loadingSales ? <LoadingRow /> : sales.length === 0 ? (
              <div className="py-4 text-center text-sm text-slate-400">No sales recorded yet.</div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {sales.map(s => (
                  <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-slate-900 dark:text-white truncate">
                        {s.guest_name || 'Walk-in'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {s.sale_date} · {s.payment_method || '—'} · by {s.sold_by || '—'}
                      </div>
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">×{s.quantity}</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">${s.total}</span>
                    <button onClick={() => voidSale(s)} title="Void sale (restores stock)" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition">
                      <CircleMinus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ModalSystem>

      {/* ── Restock modal ── */}
      <ModalSystem
        isOpen={!!restockTarget}
        onClose={() => setRestockTarget(null)}
        onConfirm={restock}
        title={`Restock — ${restockTarget?.name || ''}`}
        subtitle={restockTarget ? `Current stock ${restockTarget.stock} (min ${restockTarget.min_stock})` : ''}
        variant="form"
        size="sm"
        loading={actingOn === 'restock'}
        confirmLabel="Restock"
      >
        <Field label="Units to add">
          <input
            type="number"
            min={1}
            className={inputCls}
            value={restockQty}
            onChange={e => setRestockQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        {restockTarget && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            New stock level: <b className="text-slate-900 dark:text-white">{restockTarget.stock + restockQty}</b>
          </p>
        )}
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteProduct(deleteTarget)}
        title="Delete Product"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.name}</b> ({deleteTarget?.sku})? Its sales history will be removed with it.
        </p>
      </ModalSystem>
    </div>
  );
};

export default RetailShopModule;
