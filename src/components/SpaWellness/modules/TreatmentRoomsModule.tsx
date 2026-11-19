/**
 * Rooms & Facilities Module
 * Unified facility management for the Spa & Wellness portal: treatment rooms,
 * salon stations, studios, and thermal & hydro facilities (sauna, steam room,
 * jacuzzi, pools, lounges) — all backed by the spa_rooms table.
 * Mirrors the Housekeeping/Front Office shared UI (brandTheme + FO ui kit).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Home,
  Droplets,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  Wrench,
  CheckCircle2,
  Users,
  Thermometer,
  Loader2,
  RefreshCw,
  Sparkles,
  CalendarClock,
  DoorOpen,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

// ── Types & constants ────────────────────────────────────────────────────────

type FacilityCategory = 'Treatment Room' | 'Thermal & Hydro';
type FacilityStatus = 'Available' | 'In Use' | 'Cleaning' | 'Maintenance' | 'Out of Service';

interface Facility {
  id: string;
  name: string;
  room_type: string;
  category: FacilityCategory;
  capacity: number;
  current_occupancy: number;
  status: FacilityStatus;
  equipment: string[];
  features: string[];
  temperature: number | null;
  target_temperature: number | null;
  last_maintenance: string | null;
  next_maintenance: string | null;
  last_cleaning: string | null;
  is_bookable: boolean;
  property_id: string | null;
}

type SubTab = 'rooms' | 'thermal';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon; category: FacilityCategory }[] = [
  { id: 'rooms', label: 'Treatment Rooms', icon: DoorOpen, category: 'Treatment Room' },
  { id: 'thermal', label: 'Thermal & Hydro', icon: Droplets, category: 'Thermal & Hydro' },
];

const STATUSES: FacilityStatus[] = ['Available', 'In Use', 'Cleaning', 'Maintenance', 'Out of Service'];

const ROOM_TYPES = [
  'Massage Room', 'Couples Room', 'Facial Room', 'Hydrotherapy Room',
  'Salon Station', 'Consultation Room', 'Yoga Studio', 'Multi-Purpose Room',
];
const THERMAL_TYPES = [
  'Sauna', 'Steam Room', 'Jacuzzi', 'Hydrotherapy Pool', 'Cold Plunge', 'Relaxation Lounge',
];

const STATUS_TONE: Record<FacilityStatus, StatusTone> = {
  'Available': 'success',
  'In Use': 'info',
  'Cleaning': 'neutral',
  'Maintenance': 'warning',
  'Out of Service': 'danger',
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
  room_type: 'Massage Room',
  category: 'Treatment Room' as FacilityCategory,
  capacity: 1,
  current_occupancy: 0,
  status: 'Available' as FacilityStatus,
  equipment: '',
  features: '',
  temperature: '',
  target_temperature: '',
  last_maintenance: '',
  next_maintenance: '',
  is_bookable: true,
};

// ── Component ────────────────────────────────────────────────────────────────

const TreatmentRoomsModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subTab, setSubTab] = useState<SubTab>('rooms');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [detailTarget, setDetailTarget] = useState<Facility | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Facility | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const activeCategory: FacilityCategory = subTab === 'thermal' ? 'Thermal & Hydro' : 'Treatment Room';
  const typeOptions = subTab === 'thermal' ? THERMAL_TYPES : ROOM_TYPES;

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchFacilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/rooms${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setFacilities(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load facilities');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchFacilities(); }, [fetchFacilities]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const visible = useMemo(() => facilities.filter(f => f.category === activeCategory), [facilities, activeCategory]);

  const filtered = useMemo(() => visible.filter(f => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || f.name.toLowerCase().includes(q) || f.room_type.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
    const matchesType = typeFilter === 'All' || f.room_type === typeFilter;
    const matchesStatus = statusFilter === 'All' || f.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  }), [visible, search, typeFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: facilities.length,
    available: facilities.filter(f => f.status === 'Available').length,
    inUse: facilities.filter(f => f.status === 'In Use').length,
    attention: facilities.filter(f => f.status === 'Maintenance' || f.status === 'Out of Service').length,
  }), [facilities]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchFacility = async (id: string, updates: Record<string, unknown>, revert?: Partial<Facility>) => {
    setActingOn(id);
    setFacilities(prev => prev.map(f => (f.id === id ? { ...f, ...updates } as Facility : f)));
    try {
      const res = await fetch(`/api/spa-wellness/rooms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setFacilities(prev => prev.map(f => (f.id === id ? saved : f)));
    } catch (e: any) {
      if (revert) setFacilities(prev => prev.map(f => (f.id === id ? { ...f, ...revert } : f)));
      else fetchFacilities();
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, category: activeCategory, room_type: typeOptions[0], is_bookable: subTab !== 'thermal' });
    setShowForm(true);
  };

  const openEdit = (f: Facility) => {
    setEditing(f);
    setForm({
      name: f.name,
      room_type: f.room_type,
      category: f.category,
      capacity: f.capacity,
      current_occupancy: f.current_occupancy,
      status: f.status,
      equipment: (f.equipment || []).join(', '),
      features: (f.features || []).join(', '),
      temperature: f.temperature != null ? String(f.temperature) : '',
      target_temperature: f.target_temperature != null ? String(f.target_temperature) : '',
      last_maintenance: f.last_maintenance || '',
      next_maintenance: f.next_maintenance || '',
      is_bookable: f.is_bookable,
    });
    setShowForm(true);
  };

  const saveFacility = async () => {
    if (!form.name.trim()) {
      addNotification('Name is required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const toList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(),
      room_type: form.room_type,
      category: form.category,
      capacity: Number(form.capacity) || 1,
      current_occupancy: Number(form.current_occupancy) || 0,
      status: form.status,
      equipment: toList(form.equipment),
      features: toList(form.features),
      temperature: form.temperature === '' ? null : Number(form.temperature),
      target_temperature: form.target_temperature === '' ? null : Number(form.target_temperature),
      last_maintenance: form.last_maintenance || null,
      next_maintenance: form.next_maintenance || null,
      is_bookable: form.is_bookable,
      propertyId: currentPropertyId || null,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/rooms/${editing.id}` : '/api/spa-wellness/rooms', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setFacilities(prev => editing ? prev.map(f => (f.id === editing.id ? saved : f)) : [...prev, saved]);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? `${saved.name} updated` : `${saved.name} added`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteFacility = async (f: Facility) => {
    setActingOn(f.id);
    try {
      const res = await fetch(`/api/spa-wellness/rooms/${f.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setFacilities(prev => prev.filter(x => x.id !== f.id));
      setDeleteTarget(null);
      addNotification(`${f.name} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const markCleaned = (f: Facility) =>
    patchFacility(f.id, { last_cleaning: new Date().toISOString(), status: 'Available' }, { last_cleaning: f.last_cleaning, status: f.status });

  const switchTab = (t: SubTab) => {
    setSubTab(t);
    setTypeFilter('All');
    setStatusFilter('All');
    setSearch('');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Rooms & Facilities"
        subtitle="Treatment rooms, salon stations, studios, and thermal & hydro facilities"
        icon={Home}
        actions={
          <button onClick={fetchFacilities} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Facilities" value={stats.total} icon={Home} tone="accent" />
        <StatCard title="Available" value={stats.available} icon={CheckCircle2} tone="success" />
        <StatCard title="In Use" value={stats.inUse} icon={Users} tone="info" />
        <StatCard title="Needs Attention" value={stats.attention} icon={Wrench} tone={stats.attention ? 'warning' : 'success'} />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Sub-tabs + filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={
                subTab === t.id
                  ? 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-[var(--color-accent-spa)] text-white transition'
                  : 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition'
              }
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search facilities…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Types</option>
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> {subTab === 'thermal' ? 'Add Facility' : 'Add Room'}
          </button>
        </div>
      </SectionCard>

      {/* Facility cards */}
      <SectionCard
        title={subTab === 'thermal' ? 'Thermal & Hydro Facilities' : 'Treatment Rooms'}
        subtitle={`${filtered.length} of ${visible.length} facilities`}
        icon={subTab === 'thermal' ? Droplets : DoorOpen}
        tone="accent"
        pad="none"
      >
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No facilities match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
            {filtered.map(f => (
              <div key={f.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-accent-spa)]/10 flex items-center justify-center">
                      {f.category === 'Thermal & Hydro'
                        ? <Droplets className="w-5 h-5 text-[var(--color-accent-spa)]" />
                        : <DoorOpen className="w-5 h-5 text-[var(--color-accent-spa)]" />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{f.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{f.id} · {f.room_type}</p>
                    </div>
                  </div>
                  <select
                    value={f.status}
                    disabled={actingOn === f.id}
                    onChange={e => patchFacility(f.id, { status: e.target.value }, { status: f.status })}
                    className={`${inlineSelectCls} ${statusTone[STATUS_TONE[f.status]].soft}`}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {f.category === 'Thermal & Hydro' && f.temperature != null && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="flex items-center justify-center gap-1 text-slate-900 dark:text-white">
                        <Thermometer className="w-3.5 h-3.5" />
                        <span className="font-semibold text-sm">{f.temperature}°C</span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Current</div>
                    </div>
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="flex items-center justify-center gap-1 text-slate-900 dark:text-white">
                        <Thermometer className="w-3.5 h-3.5" />
                        <span className="font-semibold text-sm">{f.target_temperature ?? '—'}°C</span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Target</div>
                    </div>
                  </div>
                )}

                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500 dark:text-slate-400">Occupancy</span>
                    <span className="font-medium text-slate-900 dark:text-white">{f.current_occupancy}/{f.capacity}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-700">
                    <div
                      className="h-1.5 rounded-full bg-[var(--color-accent-spa)] transition-all"
                      style={{ width: `${f.capacity ? Math.min(100, (f.current_occupancy / f.capacity) * 100) : 0}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 shrink-0" />
                    <span>Next maintenance: {f.next_maintenance ? new Date(f.next_maintenance).toLocaleDateString() : '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>Last cleaned: {f.last_cleaning ? new Date(f.last_cleaning).toLocaleString() : '—'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                  <div className="flex flex-wrap gap-1">
                    {(f.features || []).slice(0, 2).map((ft, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[10px]">{ft}</span>
                    ))}
                    {(f.features || []).length > 2 && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[10px]">+{f.features.length - 2}</span>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => setDetailTarget(f)} title="Details" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => markCleaned(f)} title="Mark cleaned" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><CalendarClock className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(f)} title="Edit" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteTarget(f)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Add / Edit modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveFacility}
        title={editing ? `Edit ${editing.name}` : (form.category === 'Thermal & Hydro' ? 'Add Thermal Facility' : 'Add Room')}
        subtitle={editing ? editing.id : 'Registers a new facility in the shared rooms table'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Add Facility'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Name *">
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Massage Room 3" />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={e => {
              const cat = e.target.value as FacilityCategory;
              setForm(f => ({ ...f, category: cat, room_type: (cat === 'Thermal & Hydro' ? THERMAL_TYPES : ROOM_TYPES)[0], is_bookable: cat !== 'Thermal & Hydro' ? f.is_bookable : false }));
            }}>
              <option value="Treatment Room">Treatment Room</option>
              <option value="Thermal & Hydro">Thermal &amp; Hydro</option>
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls} value={form.room_type} onChange={e => setForm(f => ({ ...f, room_type: e.target.value }))}>
              {(form.category === 'Thermal & Hydro' ? THERMAL_TYPES : ROOM_TYPES).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as FacilityStatus }))}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Capacity">
            <input type="number" min={1} className={inputCls} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} />
          </Field>
          <Field label="Current Occupancy">
            <input type="number" min={0} className={inputCls} value={form.current_occupancy} onChange={e => setForm(f => ({ ...f, current_occupancy: Number(e.target.value) }))} />
          </Field>
          {form.category === 'Thermal & Hydro' && (
            <>
              <Field label="Current Temperature (°C)">
                <input type="number" className={inputCls} value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))} />
              </Field>
              <Field label="Target Temperature (°C)">
                <input type="number" className={inputCls} value={form.target_temperature} onChange={e => setForm(f => ({ ...f, target_temperature: e.target.value }))} />
              </Field>
            </>
          )}
          <Field label="Last Maintenance">
            <input type="date" className={inputCls} value={form.last_maintenance} onChange={e => setForm(f => ({ ...f, last_maintenance: e.target.value }))} />
          </Field>
          <Field label="Next Maintenance">
            <input type="date" className={inputCls} value={form.next_maintenance} onChange={e => setForm(f => ({ ...f, next_maintenance: e.target.value }))} />
          </Field>
          <Field label="Equipment (comma separated)">
            <input className={inputCls} value={form.equipment} onChange={e => setForm(f => ({ ...f, equipment: e.target.value }))} placeholder="Massage Table, Hot Stone Heater" />
          </Field>
          <Field label="Features (comma separated)">
            <input className={inputCls} value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} placeholder="Sound System, Dimmable Lighting" />
          </Field>
          <label className="flex items-center gap-2 md:col-span-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.is_bookable}
              onChange={e => setForm(f => ({ ...f, is_bookable: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-accent-spa)] focus:ring-[var(--color-accent-spa)]"
            />
            Bookable for appointments (shows in the booking room picker)
          </label>
        </div>
      </ModalSystem>

      {/* ── Detail modal ── */}
      <ModalSystem
        isOpen={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={detailTarget?.name || ''}
        subtitle={detailTarget ? `${detailTarget.id} · ${detailTarget.room_type} · ${detailTarget.category}` : ''}
        variant="info"
        size="md"
      >
        {detailTarget && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={STATUS_TONE[detailTarget.status]}>{detailTarget.status}</Badge>
              <Badge tone="accent">{detailTarget.room_type}</Badge>
              {detailTarget.is_bookable && <Badge tone="info">Bookable</Badge>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.current_occupancy}/{detailTarget.capacity}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Occupancy</div>
              </div>
              {detailTarget.temperature != null && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                  <div className="font-bold text-slate-900 dark:text-white">{detailTarget.temperature}°C</div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Temp</div>
                </div>
              )}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.next_maintenance ? new Date(detailTarget.next_maintenance).toLocaleDateString() : '—'}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Next Maint.</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.last_cleaning ? new Date(detailTarget.last_cleaning).toLocaleDateString() : '—'}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Last Cleaned</div>
              </div>
            </div>
            {(detailTarget.equipment || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Equipment</div>
                <div className="flex flex-wrap gap-1.5">
                  {detailTarget.equipment.map((eq, i) => <Badge key={i} tone="neutral">{eq}</Badge>)}
                </div>
              </div>
            )}
            {(detailTarget.features || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Features</div>
                <div className="flex flex-wrap gap-1.5">
                  {detailTarget.features.map((ft, i) => <Badge key={i} tone="neutral">{ft}</Badge>)}
                </div>
              </div>
            )}
          </div>
        )}
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteFacility(deleteTarget)}
        title="Remove Facility"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Remove <b>{deleteTarget?.name}</b> ({deleteTarget?.id})? Existing appointments keep their record but lose the room link.
        </p>
      </ModalSystem>
    </div>
  );
};

export default TreatmentRoomsModule;
