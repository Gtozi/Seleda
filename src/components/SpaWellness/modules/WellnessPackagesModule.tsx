/**
 * Wellness Packages Module
 * DB-backed bundled spa packages (spa_wellness_packages) with live purchase
 * tracking and session redemption (spa_package_purchases). Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Gift,
  Plus,
  Search,
  Pencil,
  Trash2,
  Users,
  Clock,
  Loader2,
  RefreshCw,
  CheckCircle2,
  ShoppingBag,
  TicketCheck,
  CircleMinus,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface WellnessPackagesModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

type PurchaseStatus = 'Active' | 'Redeemed' | 'Expired' | 'Refunded';

interface WellnessPackage {
  id: string;
  name: string;
  package_type: string;
  description: string | null;
  price: number;
  original_price: number | null;
  duration_minutes: number;
  sessions: number;
  validity_days: number;
  included_treatments: string[];
  amenities: string[];
  is_active: boolean;
  purchase_count: number;
}

interface Purchase {
  id: string;
  package_id: string;
  guest_id: string;
  guest_name: string;
  purchase_date: string;
  amount_paid: number;
  sessions_used: number;
  status: PurchaseStatus;
}

interface GuestOption { id: string; name: string; }

const PACKAGE_TYPES = [
  'Couples Retreat', 'Weekend Spa Package', 'Honeymoon Package',
  'Bridal Package', 'Executive Wellness', 'Family Wellness',
];
const PURCHASE_STATUSES: PurchaseStatus[] = ['Active', 'Redeemed', 'Expired', 'Refunded'];

const PURCHASE_TONE: Record<PurchaseStatus, StatusTone> = {
  Active: 'info',
  Redeemed: 'success',
  Expired: 'warning',
  Refunded: 'danger',
};
const TYPE_TONE: Record<string, StatusTone> = {
  'Couples Retreat': 'danger',
  'Weekend Spa Package': 'accent',
  'Honeymoon Package': 'danger',
  'Bridal Package': 'warning',
  'Executive Wellness': 'info',
  'Family Wellness': 'success',
};

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';
const inlineSelectCls = 'px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-spa)]';

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
  package_type: 'Couples Retreat',
  description: '',
  price: 0,
  original_price: '',
  duration_minutes: 120,
  sessions: 2,
  validity_days: 90,
  included_treatments: '',
  amenities: '',
  is_active: true,
};

const WellnessPackagesModule: React.FC<WellnessPackagesModuleProps> = ({ onViewGuestProfile }) => {
  const { currentPropertyId, addNotification } = useERP();

  const [packages, setPackages] = useState<WellnessPackage[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WellnessPackage | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<WellnessPackage | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // Purchases modal
  const [purchasePkg, setPurchasePkg] = useState<WellnessPackage | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [sellGuestId, setSellGuestId] = useState('');

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/wellness-packages${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setPackages(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load packages');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchPackages();
    fetch('/api/spa-wellness/guests', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setGuests)
      .catch(() => {});
  }, [fetchPackages]);

  const fetchPurchases = useCallback(async (pkgId: string) => {
    setLoadingPurchases(true);
    try {
      const res = await fetch(`/api/spa-wellness/wellness-packages/${pkgId}/purchases`, { credentials: 'include' });
      if (res.ok) setPurchases(await res.json());
    } finally {
      setLoadingPurchases(false);
    }
  }, []);

  const openPurchases = (p: WellnessPackage) => {
    setPurchasePkg(p);
    setSellGuestId('');
    fetchPurchases(p.id);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => packages.filter(p => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchesType = typeFilter === 'All' || p.package_type === typeFilter;
    const matchesStatus = statusFilter === 'All' || (statusFilter === 'Active' ? p.is_active : !p.is_active);
    return matchesSearch && matchesType && matchesStatus;
  }), [packages, search, typeFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: packages.length,
    active: packages.filter(p => p.is_active).length,
    sold: packages.reduce((n, p) => n + (p.purchase_count || 0), 0),
    revenue: packages.reduce((n, p) => n + (p.purchase_count || 0) * Number(p.price || 0), 0),
  }), [packages]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchPackage = async (id: string, updates: Record<string, unknown>, revert?: Partial<WellnessPackage>) => {
    setActingOn(id);
    setPackages(prev => prev.map(p => (p.id === id ? { ...p, ...updates } as WellnessPackage : p)));
    try {
      const res = await fetch(`/api/spa-wellness/wellness-packages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setPackages(prev => prev.map(p => (p.id === id ? { ...saved, purchase_count: p.purchase_count } : p)));
    } catch (e: any) {
      if (revert) setPackages(prev => prev.map(p => (p.id === id ? { ...p, ...revert } : p)));
      else fetchPackages();
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };

  const openEdit = (p: WellnessPackage) => {
    setEditing(p);
    setForm({
      name: p.name,
      package_type: p.package_type,
      description: p.description || '',
      price: p.price,
      original_price: p.original_price == null ? '' : String(p.original_price),
      duration_minutes: p.duration_minutes,
      sessions: p.sessions,
      validity_days: p.validity_days,
      included_treatments: (p.included_treatments || []).join(', '),
      amenities: (p.amenities || []).join(', '),
      is_active: p.is_active,
    });
    setShowForm(true);
  };

  const savePackage = async () => {
    if (!form.name.trim()) {
      addNotification('Package name is required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      package_type: form.package_type,
      description: form.description || null,
      price: Number(form.price) || 0,
      original_price: form.original_price === '' ? null : Number(form.original_price),
      duration_minutes: Number(form.duration_minutes) || 60,
      sessions: Number(form.sessions) || 1,
      validity_days: Number(form.validity_days) || 90,
      included_treatments: form.included_treatments.split(',').map(s => s.trim()).filter(Boolean),
      amenities: form.amenities.split(',').map(s => s.trim()).filter(Boolean),
      is_active: form.is_active,
      propertyId: currentPropertyId || null,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/wellness-packages/${editing.id}` : '/api/spa-wellness/wellness-packages', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? 'Package updated' : 'Package created', 'success', 'Spa');
      fetchPackages();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deletePackage = async (p: WellnessPackage) => {
    setActingOn(p.id);
    try {
      const res = await fetch(`/api/spa-wellness/wellness-packages/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setPackages(prev => prev.filter(x => x.id !== p.id));
      setDeleteTarget(null);
      addNotification(`${p.name} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  // ── Purchase mutations ────────────────────────────────────────────────────

  const sellPackage = async () => {
    if (!purchasePkg || !sellGuestId) return;
    setActingOn('sell');
    try {
      const res = await fetch(`/api/spa-wellness/wellness-packages/${purchasePkg.id}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ guest_id: sellGuestId, propertyId: currentPropertyId || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setSellGuestId('');
      addNotification('Package sold', 'success', 'Spa');
      fetchPurchases(purchasePkg.id);
      fetchPackages();
    } catch (e: any) {
      addNotification(`Sale failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const patchPurchase = async (id: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/spa-wellness/purchases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setPurchases(prev => prev.map(p => (p.id === id ? saved : p)));
      if (updates.redeem) addNotification('Session redeemed', 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    }
  };

  const removePurchase = async (p: Purchase) => {
    try {
      const res = await fetch(`/api/spa-wellness/purchases/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setPurchases(prev => prev.filter(x => x.id !== p.id));
      addNotification(`Purchase for ${p.guest_name} removed`, 'success', 'Spa');
      fetchPackages();
    } catch (e: any) {
      addNotification(`Remove failed: ${e.message}`, 'warning', 'Spa');
    }
  };

  const savings = (p: WellnessPackage) =>
    p.original_price && p.original_price > p.price
      ? Math.round(((p.original_price - p.price) / p.original_price) * 100)
      : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Wellness Packages"
        subtitle="Bundled spa packages with special pricing, sales and session redemption"
        icon={Gift}
        actions={
          <button onClick={fetchPackages} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Packages" value={stats.total} icon={Gift} tone="accent" />
        <StatCard title="Active" value={stats.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Packages Sold" value={stats.sold} icon={ShoppingBag} tone="info" />
        <StatCard title="Sales Value" value={`$${stats.revenue.toLocaleString()}`} icon={TicketCheck} tone="success" />
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
              placeholder="Search packages…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Types</option>
            {PACKAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> New Package
          </button>
        </div>
      </SectionCard>

      {/* Package cards */}
      <SectionCard title="Packages" subtitle={`${filtered.length} of ${packages.length} packages`} icon={Gift} tone="accent" pad="none">
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No packages match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
            {filtered.map(p => (
              <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-accent-spa)]/10 flex items-center justify-center">
                      <Gift className="w-5 h-5 text-[var(--color-accent-spa)]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{p.id}</p>
                    </div>
                  </div>
                  <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Badge tone={TYPE_TONE[p.package_type] || 'neutral'}>{p.package_type}</Badge>
                  {savings(p) > 0 && <Badge tone="danger">Save {savings(p)}%</Badge>}
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-2 min-h-[2.5rem]">{p.description}</p>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="font-bold text-sm text-slate-900 dark:text-white">${p.price}</div>
                    {p.original_price != null && p.original_price > p.price && (
                      <div className="text-[10px] text-slate-400 line-through">${p.original_price}</div>
                    )}
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Price</div>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="font-bold text-sm text-slate-900 dark:text-white">{p.sessions}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Sessions</div>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="font-bold text-sm text-slate-900 dark:text-white">{p.purchase_count ?? 0}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Sold</div>
                  </div>
                </div>

                <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>Valid {p.validity_days} days · {Math.round(p.duration_minutes / 60)}h total</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    <span>{(p.included_treatments || []).length} treatments · {(p.amenities || []).length} amenities</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={() => patchPackage(p.id, { is_active: !p.is_active }, { is_active: p.is_active })}
                    className="text-xs font-medium text-[var(--color-accent-spa)] hover:opacity-80 transition"
                  >
                    {p.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <div className="flex gap-1.5">
                    <button onClick={() => openPurchases(p)} title="Sales & redemption" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><ShoppingBag className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(p)} title="Edit" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteTarget(p)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Create / Edit modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={savePackage}
        title={editing ? `Edit ${editing.name}` : 'Create Wellness Package'}
        subtitle={editing ? editing.id : 'Bundles treatments and amenities at a package price'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Create Package'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Package Name *">
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Couples Retreat Package" />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={form.package_type} onChange={e => setForm(f => ({ ...f, package_type: e.target.value }))}>
              {PACKAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Price ($)">
            <input type="number" min={0} className={inputCls} value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} />
          </Field>
          <Field label="Original Price ($)">
            <input type="number" min={0} className={inputCls} value={form.original_price} onChange={e => setForm(f => ({ ...f, original_price: e.target.value }))} placeholder="For savings display" />
          </Field>
          <Field label="Sessions">
            <input type="number" min={1} className={inputCls} value={form.sessions} onChange={e => setForm(f => ({ ...f, sessions: Number(e.target.value) }))} />
          </Field>
          <Field label="Total Duration (minutes)">
            <input type="number" min={15} step={15} className={inputCls} value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))} />
          </Field>
          <Field label="Validity (days)">
            <input type="number" min={1} className={inputCls} value={form.validity_days} onChange={e => setForm(f => ({ ...f, validity_days: Number(e.target.value) }))} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-accent-spa)] focus:ring-[var(--color-accent-spa)]"
            />
            Active (available for sale)
          </label>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea className={inputCls + ' min-h-[70px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
          <Field label="Included Treatments (comma separated)">
            <input className={inputCls} value={form.included_treatments} onChange={e => setForm(f => ({ ...f, included_treatments: e.target.value }))} placeholder="Couples Massage, Champagne Service" />
          </Field>
          <Field label="Amenities (comma separated)">
            <input className={inputCls} value={form.amenities} onChange={e => setForm(f => ({ ...f, amenities: e.target.value }))} placeholder="Private Room, Robes & Slippers" />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Purchases modal ── */}
      <ModalSystem
        isOpen={!!purchasePkg}
        onClose={() => setPurchasePkg(null)}
        title={purchasePkg?.name || ''}
        subtitle={purchasePkg ? `${purchasePkg.id} · ${purchasePkg.purchase_count} sold · ${purchasePkg.sessions} sessions each` : ''}
        variant="info"
        size="lg"
      >
        {purchasePkg && (
          <div className="space-y-4">
            {(purchasePkg.included_treatments || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Included Treatments</div>
                <div className="flex flex-wrap gap-1.5">
                  {purchasePkg.included_treatments.map((t, i) => <Badge key={i} tone="accent">{t}</Badge>)}
                </div>
              </div>
            )}
            {(purchasePkg.amenities || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Amenities</div>
                <div className="flex flex-wrap gap-1.5">
                  {purchasePkg.amenities.map((a, i) => <Badge key={i} tone="neutral">{a}</Badge>)}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <select className={inputCls + ' flex-1'} value={sellGuestId} onChange={e => setSellGuestId(e.target.value)}>
                <option value="">Sell to guest…</option>
                {guests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
              </select>
              <button onClick={sellPackage} disabled={!sellGuestId || actingOn === 'sell' || !purchasePkg.is_active} className={button.primary}>
                <ShoppingBag className="w-4 h-4" /> Sell
              </button>
            </div>

            {loadingPurchases ? <LoadingRow /> : purchases.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">No purchases yet.</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {purchases.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onViewGuestProfile?.(p.guest_id)}
                        className="font-medium text-sm text-slate-900 dark:text-white hover:text-[var(--color-accent-spa)] transition truncate block"
                      >
                        {p.guest_name}
                      </button>
                      <div className="text-[11px] text-slate-400">
                        {p.guest_id} · ${p.amount_paid} · {new Date(p.purchase_date).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {p.sessions_used}/{purchasePkg.sessions} used
                    </span>
                    <select
                      value={p.status}
                      onChange={ev => patchPurchase(p.id, { status: ev.target.value })}
                      className={`${inlineSelectCls} ${statusTone[PURCHASE_TONE[p.status]].soft}`}
                    >
                      {PURCHASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                      onClick={() => patchPurchase(p.id, { redeem: true })}
                      disabled={p.status !== 'Active' || p.sessions_used >= purchasePkg.sessions}
                      title="Redeem a session"
                      className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] disabled:opacity-40 transition"
                    >
                      <TicketCheck className="w-4 h-4" />
                    </button>
                    <button onClick={() => removePurchase(p)} title="Remove" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition">
                      <CircleMinus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deletePackage(deleteTarget)}
        title="Delete Package"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.name}</b> ({deleteTarget?.id})? All {deleteTarget?.purchase_count ?? 0} purchase records will be removed with it.
        </p>
      </ModalSystem>
    </div>
  );
};

export default WellnessPackagesModule;
