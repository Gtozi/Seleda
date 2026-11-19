/**
 * Treatment Catalog Module
 * Manages spa treatment categories, services, pricing, and duration.
 * Backed by /api/spa-wellness/treatments (spa_treatments table — migrations 473/474).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Plus,
  Search,
  Edit,
  Trash2,
  Clock,
  DollarSign,
  Star,
  Grid3x3,
  List,
  RefreshCw,
  Loader2,
  X,
  Tag
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import StatCard from '../../FrontOffice/StatCard';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';

type TreatmentCategory =
  | 'Massage'
  | 'Facial Treatments'
  | 'Body Treatments'
  | 'Beauty Services'
  | 'Wellness'
  | 'Fitness'
  | 'Wellness Packages';

const CATEGORIES: TreatmentCategory[] = [
  'Massage', 'Facial Treatments', 'Body Treatments',
  'Beauty Services', 'Wellness', 'Fitness', 'Wellness Packages'
];

const CATEGORY_TONE: Record<string, StatusTone> = {
  'Massage': 'accent',
  'Facial Treatments': 'info',
  'Body Treatments': 'success',
  'Beauty Services': 'warning',
  'Wellness': 'neutral',
  'Fitness': 'info',
  'Wellness Packages': 'danger'
};

interface Treatment {
  id: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  description: string;
  popular: boolean;
  isActive: boolean;
  therapistQualifications: string[];
  roomType: string;
}

interface TreatmentForm {
  name: string;
  category: string;
  duration: number;
  price: number;
  description: string;
  popular: boolean;
  isActive: boolean;
  qualifications: string; // comma-separated in the form, stored as text[]
  roomType: string;
}

const EMPTY_FORM: TreatmentForm = {
  name: '',
  category: 'Massage',
  duration: 60,
  price: 0,
  description: '',
  popular: false,
  isActive: true,
  qualifications: '',
  roomType: ''
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function mapTreatment(row: any): Treatment {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    duration: row.duration_minutes,
    price: Number(row.price) || 0,
    description: row.description || '',
    popular: !!row.is_popular,
    isActive: row.is_active !== false,
    therapistQualifications: row.therapist_qualifications || [],
    roomType: row.room_type || ''
  };
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';

const fieldLabelClass = 'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5';

const TreatmentCatalogModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [roomTypes, setRoomTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TreatmentForm>(EMPTY_FORM);

  // ── Data loading ──────────────────────────────────────────────────

  const fetchTreatments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ includeInactive: 'true' });
      if (currentPropertyId) params.append('propertyId', currentPropertyId);
      if (categoryFilter !== 'All') params.append('category', categoryFilter);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());

      const res = await fetch(`/api/spa-wellness/treatments?${params}`, {
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Failed to load treatments (${res.status})`);
      const data = await res.json();
      setTreatments((data || []).map(mapTreatment));
    } catch (err: any) {
      setError(err.message || 'Failed to load treatments');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, categoryFilter, searchTerm]);

  const fetchRoomTypes = useCallback(async () => {
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/rooms${prop}`, {
        headers: authHeaders(),
        credentials: 'include'
      });
      if (res.ok) {
        const rooms = await res.json();
        setRoomTypes([...new Set((rooms || []).map((r: any) => r.room_type).filter(Boolean))] as string[]);
      }
    } catch (err) {
      console.error('Error loading room types:', err);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchTreatments();
  }, [fetchTreatments]);

  useEffect(() => {
    fetchRoomTypes();
  }, [fetchRoomTypes]);

  // ── KPI stats ─────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const active = treatments.filter(t => t.isActive);
    return {
      total: treatments.length,
      active: active.length,
      categories: new Set(treatments.map(t => t.category)).size,
      popular: treatments.filter(t => t.popular).length,
      avgPrice: active.length
        ? Math.round(active.reduce((s, t) => s + t.price, 0) / active.length)
        : 0
    };
  }, [treatments]);

  // ── Mutations ─────────────────────────────────────────────────────

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowFormModal(true);
  };

  const openEditModal = (t: Treatment) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      category: t.category,
      duration: t.duration,
      price: t.price,
      description: t.description,
      popular: t.popular,
      isActive: t.isActive,
      qualifications: t.therapistQualifications.join(', '),
      roomType: t.roomType
    });
    setShowFormModal(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.category || form.duration <= 0) return;
    setSaving(true);
    const qualifications = form.qualifications
      .split(',')
      .map(q => q.trim())
      .filter(Boolean);
    try {
      if (editingId) {
        const res = await fetch(`/api/spa-wellness/treatments/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          credentials: 'include',
          body: JSON.stringify({
            name: form.name,
            category: form.category,
            duration_minutes: form.duration,
            price: form.price,
            description: form.description || null,
            is_popular: form.popular,
            is_active: form.isActive,
            therapist_qualifications: qualifications,
            room_type: form.roomType || null
          })
        });
        if (!res.ok) throw new Error(`Update failed (${res.status})`);
        addNotification(`Treatment ${editingId} updated`, 'success', 'Spa');
      } else {
        const res = await fetch('/api/spa-wellness/treatments', {
          method: 'POST',
          headers: authHeaders(true),
          credentials: 'include',
          body: JSON.stringify({
            name: form.name,
            category: form.category,
            duration_minutes: form.duration,
            price: form.price,
            description: form.description || null,
            is_popular: form.popular,
            therapist_qualifications: qualifications,
            room_type: form.roomType || null,
            property_id: currentPropertyId
          })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Create failed (${res.status})`);
        }
        addNotification('Treatment created', 'success', 'Spa');
      }
      setShowFormModal(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await fetchTreatments();
    } catch (err: any) {
      setError(err.message || 'Save failed');
      addNotification(err?.message || 'Save failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (treatment: Treatment) => {
    if (!window.confirm(`Delete treatment "${treatment.name}" (${treatment.id})? Appointments referencing it will keep their record but lose the link.`)) return;
    try {
      const res = await fetch(`/api/spa-wellness/treatments/${encodeURIComponent(treatment.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setTreatments(treatments.filter(t => t.id !== treatment.id));
      addNotification(`Treatment ${treatment.id} deleted`, 'info', 'Spa');
    } catch (err: any) {
      addNotification(err?.message || 'Failed to delete treatment', 'warning', 'Spa');
    }
  };

  const toggleActive = async (treatment: Treatment) => {
    try {
      const res = await fetch(`/api/spa-wellness/treatments/${encodeURIComponent(treatment.id)}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ is_active: !treatment.isActive })
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      setTreatments(treatments.map(t =>
        t.id === treatment.id ? { ...t, isActive: !treatment.isActive } : t
      ));
    } catch (err: any) {
      addNotification(err?.message || 'Failed to update treatment', 'warning', 'Spa');
    }
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Treatment Catalog"
        subtitle="Manage spa treatments, pricing, and service categories"
        icon={Sparkles}
        actions={
          <>
            <button onClick={fetchTreatments} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button onClick={openCreateModal} className={button.primary}>
              <Plus className="w-4 h-4" />
              Add Treatment
            </button>
          </>
        }
      />

      {/* KPI strip */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Treatments" value={stats.active} icon={Sparkles} tone="accent" />
        <StatCard title="Categories" value={stats.categories} icon={Tag} tone="info" />
        <StatCard title="Popular" value={stats.popular} icon={Star} tone="warning" />
        <StatCard title="Average Price" value={`$${stats.avgPrice}`} icon={DollarSign} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search treatments…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {['All', ...CATEGORIES].map((category) => (
              <button
                key={category}
                onClick={() => setCategoryFilter(category)}
                className={
                  categoryFilter === category
                    ? 'px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-accent-spa)] text-white transition'
                    : 'px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition'
                }
              >
                {category}
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-l border-gray-200 dark:border-slate-700 pl-3">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition ${viewMode === 'grid' ? 'bg-slate-100 text-[var(--color-accent-spa)] dark:bg-slate-700' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
              title="Grid view"
            >
              <Grid3x3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition ${viewMode === 'list' ? 'bg-slate-100 text-[var(--color-accent-spa)] dark:bg-slate-700' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
              title="List view"
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Catalog */}
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
          Loading treatments…
        </div>
      ) : treatments.length === 0 ? (
        <SectionCard pad="md">
          <div className="py-12 text-center text-sm text-gray-500">No treatments found.</div>
        </SectionCard>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {treatments.map((treatment) => (
            <div
              key={treatment.id}
              className={`bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 hover:shadow-md transition ${treatment.isActive ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <Badge tone={CATEGORY_TONE[treatment.category] || 'neutral'}>
                  {treatment.category}
                </Badge>
                <div className="flex items-center gap-2">
                  {treatment.popular && (
                    <span className="flex items-center gap-1 text-[var(--color-warning)]">
                      <Star size={14} fill="currentColor" />
                      <span className="text-xs font-medium">Popular</span>
                    </span>
                  )}
                  {!treatment.isActive && (
                    <Badge tone="danger">Inactive</Badge>
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{treatment.name}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 line-clamp-2 min-h-[2.5rem]">
                {treatment.description || 'No description'}
              </p>
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {treatment.duration} min
                </span>
                <span className="flex items-center gap-1 font-medium text-gray-900 dark:text-white">
                  <DollarSign size={14} />
                  {treatment.price}
                </span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-slate-700">
                <span className="text-xs text-gray-500 dark:text-gray-500">{treatment.roomType || 'Any room'}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleActive(treatment)}
                    className="px-2 py-1 text-xs rounded-lg text-gray-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                    title={treatment.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {treatment.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => openEditModal(treatment)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-accent-spa)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(treatment)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <SectionCard pad="none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Treatment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Room Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {treatments.map((treatment) => (
                  <tr key={treatment.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {treatment.popular && <Star size={16} className="text-[var(--color-warning)] fill-[var(--color-warning)]" />}
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{treatment.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-500">{treatment.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={CATEGORY_TONE[treatment.category] || 'neutral'}>
                        {treatment.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-400">{treatment.duration} min</td>
                    <td className="px-4 py-4 text-right font-medium text-gray-900 dark:text-white tabular-nums">
                      ${treatment.price}
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-400">{treatment.roomType || '—'}</td>
                    <td className="px-4 py-4">
                      <button onClick={() => toggleActive(treatment)}>
                        <Badge tone={treatment.isActive ? 'success' : 'danger'}>
                          {treatment.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEditModal(treatment)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-accent-spa)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(treatment)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Create / Edit Treatment Modal */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto ring-1 ring-black/5 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-accent-spa)] to-[var(--color-accent-guest)] rounded-t-2xl" />
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingId ? `Edit ${editingId}` : 'Add Treatment'}
              </h2>
              <button
                onClick={() => { setShowFormModal(false); setEditingId(null); setForm(EMPTY_FORM); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={22} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block md:col-span-2">
                <span className={fieldLabelClass}>Treatment Name *</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Swedish Massage"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Category *</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                  className={inputClass}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Room Type</span>
                <select
                  value={form.roomType}
                  onChange={(e) => setForm(f => ({ ...f, roomType: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Any room</option>
                  {roomTypes.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Duration (min) *</span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={form.duration}
                  onChange={(e) => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Price ($)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) => setForm(f => ({ ...f, price: Number(e.target.value) }))}
                  className={inputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className={fieldLabelClass}>Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="What the treatment involves…"
                  className={inputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className={fieldLabelClass}>Therapist Qualifications</span>
                <input
                  type="text"
                  value={form.qualifications}
                  onChange={(e) => setForm(f => ({ ...f, qualifications: e.target.value }))}
                  placeholder="Comma-separated, e.g. Massage Therapy Certification, 2 years experience"
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.popular}
                  onChange={(e) => setForm(f => ({ ...f, popular: e.target.checked }))}
                  className="w-4 h-4 rounded accent-[var(--color-accent-spa)]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Mark as popular</span>
              </label>
              {editingId && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm(f => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[var(--color-accent-spa)]"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Active (bookable)</span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 rounded-b-2xl">
              <button
                onClick={() => { setShowFormModal(false); setEditingId(null); setForm(EMPTY_FORM); }}
                className={button.secondary}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.name.trim() || form.duration <= 0}
                className={button.primary}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Treatment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TreatmentCatalogModule;
