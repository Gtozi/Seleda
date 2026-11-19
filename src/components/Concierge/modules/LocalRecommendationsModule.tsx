/**
 * Local Recommendations Module
 * Knowledge base for restaurants, attractions, shopping, and cultural sites.
 *
 * DB-integrated: reads/writes the `local_recommendations` table via
 * /api/concierge/local-recommendations. Category tabs, live search,
 * and an Add Recommendation form.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MapPin,
  Star,
  Search,
  Plus,
  UtensilsCrossed,
  Camera,
  ShoppingBag,
  Landmark,
  RefreshCw,
  Phone,
  AlertTriangle,
  Loader2,
  Pencil,
  Trash2,
  EyeOff,
  Eye,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface Recommendation {
  id: string;
  name: string;
  category: string;
  rating: number | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
  price_tier: string | null;
  active: boolean;
}

const CATEGORIES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: MapPin },
  { id: 'restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { id: 'attractions', label: 'Attractions', icon: Camera },
  { id: 'shopping', label: 'Shopping', icon: ShoppingBag },
  { id: 'cultural', label: 'Cultural Sites', icon: Landmark },
];

const CATEGORY_META: Record<string, { icon: LucideIcon; chip: string }> = {
  restaurants: { icon: UtensilsCrossed, chip: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300' },
  attractions: { icon: Camera, chip: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300' },
  shopping: { icon: ShoppingBag, chip: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
  cultural: { icon: Landmark, chip: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300' },
};

const EMPTY_FORM = { name: '', category: 'restaurants', rating: '', priceTier: '', address: '', phone: '', notes: '' };

const LocalRecommendationsModule: React.FC = () => {
  const { addNotification } = useERP();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const parseJson = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected response (${response.status})`);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await conciergeFetch('/api/concierge/local-recommendations?active_only=false');
      setRecommendations(await parseJson(res));
    } catch (e: any) {
      setError(e?.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => {
    const rated = recommendations.filter((r) => r.rating != null);
    const avg = rated.length ? rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length : 0;
    return {
      total: recommendations.length,
      restaurants: recommendations.filter((r) => r.category === 'restaurants').length,
      topRated: recommendations.filter((r) => Number(r.rating) >= 4.5).length,
      avgRating: avg.toFixed(1),
    };
  }, [recommendations]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of recommendations) counts[r.category] = (counts[r.category] || 0) + 1;
    return counts;
  }, [recommendations]);

  const filtered = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return recommendations.filter((r) => {
      const matchesCategory = activeCategory === 'all' || r.category === activeCategory;
      const matchesSearch =
        !term ||
        r.name.toLowerCase().includes(term) ||
        (r.address || '').toLowerCase().includes(term) ||
        (r.notes || '').toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [recommendations, activeCategory, searchQuery]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (rec: Recommendation) => {
    setEditingId(rec.id);
    setForm({
      name: rec.name,
      category: rec.category,
      rating: rec.rating != null ? String(rec.rating) : '',
      priceTier: rec.price_tier || '',
      address: rec.address || '',
      phone: rec.phone || '',
      notes: rec.notes || '',
    });
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const payload = {
        name: form.name.trim(),
        category: form.category,
        rating: form.rating ? Number(form.rating) : null,
        price_tier: form.priceTier || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
      };
      const res = await conciergeFetch(
        editingId ? `/api/concierge/local-recommendations/${editingId}` : '/api/concierge/local-recommendations',
        { method: editingId ? 'PUT' : 'POST', json: true, body: JSON.stringify(payload) }
      );
      await parseJson(res);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      addNotification(editingId ? 'Recommendation updated' : 'Recommendation added', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || `Failed to ${editingId ? 'update' : 'add'} recommendation`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (rec: Recommendation) => {
    try {
      setBusyId(rec.id);
      const res = await conciergeFetch(`/api/concierge/local-recommendations/${rec.id}`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify({ active: !rec.active }),
      });
      await parseJson(res);
      addNotification(rec.active ? 'Recommendation deactivated' : 'Recommendation reactivated', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to update recommendation');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rec: Recommendation) => {
    if (!window.confirm(`Remove "${rec.name}" from the knowledge base?`)) return;
    try {
      setBusyId(rec.id);
      const res = await conciergeFetch(`/api/concierge/local-recommendations/${rec.id}`, {
        method: 'DELETE',
        json: true,
      });
      await parseJson(res);
      addNotification('Recommendation removed', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete recommendation');
    } finally {
      setBusyId(null);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Local Recommendations"
        subtitle="Curated knowledge base of restaurants, attractions, shopping, and cultural sites"
        icon={MapPin}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={openAdd} className={button.primary}>
              <Plus size={16} />
              Add Recommendation
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Recommendations" value={stats.total} icon={MapPin} tone="accent" caption="in the knowledge base" />
        <StatCard title="Restaurants" value={stats.restaurants} icon={UtensilsCrossed} tone="info" />
        <StatCard title="Top Rated (4.5+)" value={stats.topRated} icon={Star} tone="success" />
        <StatCard title="Average Rating" value={stats.avgRating} icon={Star} tone="warning" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Add recommendation form */}
      {showForm && (
        <SectionCard title={editingId ? 'Edit Recommendation' : 'Add Recommendation'} subtitle={editingId ? 'Update this knowledge-base entry' : 'Add a vetted place to the concierge knowledge base'} icon={editingId ? Pencil : Plus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <label className={labelClass}>Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="e.g. Tomoca Coffee" />
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                <option value="restaurants">Restaurant</option>
                <option value="attractions">Attraction</option>
                <option value="shopping">Shopping</option>
                <option value="cultural">Cultural Site</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Rating (0–5)</label>
              <input type="number" min="0" max="5" step="0.1" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} className={inputClass} placeholder="4.5" />
            </div>
            <div>
              <label className={labelClass}>Price Tier</label>
              <select value={form.priceTier} onChange={(e) => setForm({ ...form, priceTier: e.target.value })} className={inputClass}>
                <option value="">—</option>
                <option value="$">$</option>
                <option value="$$">$$</option>
                <option value="$$$">$$$</option>
                <option value="$$$$">$$$$</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} placeholder="+251 …" />
            </div>
            <div className="lg:col-span-2">
              <label className={labelClass}>Address</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} placeholder="Street / district, Addis Ababa" />
            </div>
            <div>
              <label className={labelClass}>Concierge Notes</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} placeholder="Insider tips for guests…" />
            </div>
          </div>
          {formError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={14} />
              {formError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }} className={button.secondary}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={submitting} className={button.primary}>
              {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Add Recommendation'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Category tabs + search */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => {
            const count = cat.id === 'all' ? recommendations.length : categoryCounts[cat.id] || 0;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                <cat.icon size={13} />
                {cat.label}
                <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-200 text-slate-500 dark:bg-slate-600 dark:text-slate-300'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full md:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search recommendations…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </div>

      {/* Recommendations grid */}
      <SectionCard
        title={CATEGORIES.find((c) => c.id === activeCategory)?.label || 'Recommendations'}
        subtitle={`${filtered.length} place${filtered.length === 1 ? '' : 's'}`}
        icon={CATEGORIES.find((c) => c.id === activeCategory)?.icon || MapPin}
        tone="accent"
        pad="md"
      >
        {loading && recommendations.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <MapPin size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No recommendations found</p>
            <p className="mt-1 text-xs text-slate-400">Try a different category or search term — or add one above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((rec) => {
              const meta = CATEGORY_META[rec.category] || { icon: MapPin, chip: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' };
              const Icon = meta.icon;
              return (
                <div
                  key={rec.id}
                  className={`group flex flex-col rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-slate-700 dark:hover:border-indigo-700 ${rec.active === false ? 'opacity-60' : ''}`}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className={`shrink-0 rounded-lg p-2.5 transition group-hover:scale-105 ${meta.chip}`}>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-snug text-slate-900 dark:text-white">{rec.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {rec.rating != null && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            <Star size={12} className="fill-amber-500 text-amber-500" />
                            {Number(rec.rating).toFixed(1)}
                          </span>
                        )}
                        {rec.price_tier && (
                          <Badge tone="neutral">{rec.price_tier}</Badge>
                        )}
                        {rec.active === false && (
                          <Badge tone="danger">Inactive</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openEdit(rec)}
                        title="Edit"
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(rec)}
                        disabled={busyId === rec.id}
                        title={rec.active === false ? 'Reactivate' : 'Deactivate'}
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                      >
                        {rec.active === false ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(rec)}
                        disabled={busyId === rec.id}
                        title="Delete"
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5 text-sm">
                    {rec.address && (
                      <p className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                        <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />
                        {rec.address}
                      </p>
                    )}
                    {rec.phone && (
                      <p className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <Phone size={13} className="shrink-0 text-slate-400" />
                        {rec.phone}
                      </p>
                    )}
                    {rec.notes && (
                      <p className="border-t border-slate-100 pt-2 text-xs italic text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
                        {rec.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default LocalRecommendationsModule;
