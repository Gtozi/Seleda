/**
 * Wellness Programs Module
 * DB-backed structured wellness programs (spa_wellness_programs) with live
 * enrollment management (spa_program_enrollments): enroll guests, track
 * progress, mark complete/withdraw. Mirrors the HK/Front Office shared UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Target,
  Plus,
  Search,
  Pencil,
  Trash2,
  Users,
  Calendar,
  Loader2,
  RefreshCw,
  CheckCircle2,
  UserPlus,
  UserMinus,
  Flag,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface WellnessProgramsModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

type ProgramStatus = 'Active' | 'Upcoming' | 'Completed' | 'Suspended';
type EnrollmentStatus = 'Enrolled' | 'Completed' | 'Withdrawn';

interface WellnessProgram {
  id: string;
  name: string;
  program_type: string;
  description: string | null;
  duration_days: number;
  sessions: number;
  price: number;
  capacity: number;
  status: ProgramStatus;
  start_date: string | null;
  end_date: string | null;
  instructor_id: string | null;
  instructor: string | null;
  progress_tracking: boolean;
  milestones: string[];
  schedule: string | null;
  location: string | null;
  enrolled_count: number;
}

interface Enrollment {
  id: string;
  program_id: string;
  guest_id: string;
  guest_name: string;
  enrolled_date: string;
  status: EnrollmentStatus;
  progress: number;
  notes: string | null;
}

interface GuestOption { id: string; name: string; }
interface TherapistOption { id: string; name: string; }

const PROGRAM_TYPES = [
  'Weight Management', 'Detox Program', 'Stress Relief', 'Fitness Transformation',
  'Corporate Wellness', 'Holistic Wellness', 'Senior Wellness',
  // Group class types (moved from the Fitness Center)
  'Yoga', 'Pilates', 'Spin', 'HIIT', 'Strength Training', 'Zumba', 'CrossFit',
];
const PROGRAM_STATUSES: ProgramStatus[] = ['Active', 'Upcoming', 'Completed', 'Suspended'];
const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['Enrolled', 'Completed', 'Withdrawn'];

const PROGRAM_STATUS_TONE: Record<ProgramStatus, StatusTone> = {
  Active: 'success',
  Upcoming: 'info',
  Completed: 'neutral',
  Suspended: 'warning',
};
const ENROLLMENT_TONE: Record<EnrollmentStatus, StatusTone> = {
  Enrolled: 'info',
  Completed: 'success',
  Withdrawn: 'danger',
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
  program_type: 'Stress Relief',
  description: '',
  duration_days: 7,
  sessions: 6,
  price: 0,
  capacity: 10,
  status: 'Upcoming' as ProgramStatus,
  start_date: '',
  end_date: '',
  instructor_id: '',
  progress_tracking: true,
  milestones: '',
  schedule: '',
  location: '',
};

const WellnessProgramsModule: React.FC<WellnessProgramsModuleProps> = ({ onViewGuestProfile }) => {
  const { currentPropertyId, addNotification } = useERP();

  const [programs, setPrograms] = useState<WellnessProgram[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [therapists, setTherapists] = useState<TherapistOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WellnessProgram | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<WellnessProgram | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // Enrollment modal state
  const [rosterProgram, setRosterProgram] = useState<WellnessProgram | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [enrollGuestId, setEnrollGuestId] = useState('');

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchPrograms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/wellness-programs${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setPrograms(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load programs');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const fetchLookups = useCallback(async () => {
    const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
    const [gRes, tRes] = await Promise.all([
      fetch('/api/spa-wellness/guests', { credentials: 'include' }),
      fetch(`/api/spa-wellness/therapists${prop}`, { credentials: 'include' }),
    ]);
    if (gRes.ok) setGuests(await gRes.json());
    if (tRes.ok) setTherapists(await tRes.json());
  }, [currentPropertyId]);

  useEffect(() => { fetchPrograms(); fetchLookups(); }, [fetchPrograms, fetchLookups]);

  const fetchEnrollments = useCallback(async (programId: string) => {
    setLoadingEnrollments(true);
    try {
      const res = await fetch(`/api/spa-wellness/wellness-programs/${programId}/enrollments`, { credentials: 'include' });
      if (res.ok) setEnrollments(await res.json());
    } finally {
      setLoadingEnrollments(false);
    }
  }, []);

  const openRoster = (p: WellnessProgram) => {
    setRosterProgram(p);
    setEnrollGuestId('');
    fetchEnrollments(p.id);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => programs.filter(p => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    const matchesType = typeFilter === 'All' || p.program_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  }), [programs, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    total: programs.length,
    active: programs.filter(p => p.status === 'Active').length,
    enrolled: programs.reduce((n, p) => n + (p.enrolled_count || 0), 0),
    fillRate: programs.length
      ? Math.round(programs.reduce((n, p) => n + (p.capacity ? (p.enrolled_count / p.capacity) * 100 : 0), 0) / programs.length)
      : 0,
  }), [programs]);

  const enrolledGuestIds = useMemo(() => new Set(enrollments.filter(e => e.status === 'Enrolled').map(e => e.guest_id)), [enrollments]);
  const enrollableGuests = useMemo(() => guests.filter(g => !enrolledGuestIds.has(g.id)), [guests, enrolledGuestIds]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchProgram = async (id: string, updates: Record<string, unknown>, revert?: Partial<WellnessProgram>) => {
    setActingOn(id);
    setPrograms(prev => prev.map(p => (p.id === id ? { ...p, ...updates } as WellnessProgram : p)));
    try {
      const res = await fetch(`/api/spa-wellness/wellness-programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setPrograms(prev => prev.map(p => (p.id === id ? { ...saved, enrolled_count: p.enrolled_count } : p)));
    } catch (e: any) {
      if (revert) setPrograms(prev => prev.map(p => (p.id === id ? { ...p, ...revert } : p)));
      else fetchPrograms();
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };

  const openEdit = (p: WellnessProgram) => {
    setEditing(p);
    setForm({
      name: p.name,
      program_type: p.program_type,
      description: p.description || '',
      duration_days: p.duration_days,
      sessions: p.sessions,
      price: p.price,
      capacity: p.capacity,
      status: p.status,
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      instructor_id: p.instructor_id || '',
      progress_tracking: p.progress_tracking,
      milestones: (p.milestones || []).join(', '),
      schedule: p.schedule || '',
      location: p.location || '',
    });
    setShowForm(true);
  };

  const saveProgram = async () => {
    if (!form.name.trim()) {
      addNotification('Program name is required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      program_type: form.program_type,
      description: form.description || null,
      duration_days: Number(form.duration_days) || 1,
      sessions: Number(form.sessions) || 1,
      price: Number(form.price) || 0,
      capacity: Number(form.capacity) || 10,
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      instructor_id: form.instructor_id || null,
      progress_tracking: form.progress_tracking,
      milestones: form.milestones.split(',').map(s => s.trim()).filter(Boolean),
      schedule: form.schedule || null,
      location: form.location || null,
      propertyId: currentPropertyId || null,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/wellness-programs/${editing.id}` : '/api/spa-wellness/wellness-programs', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? 'Program updated' : 'Program created', 'success', 'Spa');
      fetchPrograms();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteProgram = async (p: WellnessProgram) => {
    setActingOn(p.id);
    try {
      const res = await fetch(`/api/spa-wellness/wellness-programs/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setPrograms(prev => prev.filter(x => x.id !== p.id));
      setDeleteTarget(null);
      addNotification(`${p.name} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  // ── Enrollment mutations ──────────────────────────────────────────────────

  const enrollGuest = async () => {
    if (!rosterProgram || !enrollGuestId) return;
    setActingOn('enroll');
    try {
      const res = await fetch(`/api/spa-wellness/wellness-programs/${rosterProgram.id}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ guest_id: enrollGuestId, propertyId: currentPropertyId || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setEnrollGuestId('');
      addNotification('Guest enrolled', 'success', 'Spa');
      fetchEnrollments(rosterProgram.id);
      fetchPrograms();
    } catch (e: any) {
      addNotification(`Enroll failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const patchEnrollment = async (id: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/spa-wellness/enrollments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setEnrollments(prev => prev.map(e => (e.id === id ? saved : e)));
      if (updates.status) fetchPrograms();
    } catch (e: any) {
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    }
  };

  const removeEnrollment = async (e: Enrollment) => {
    try {
      const res = await fetch(`/api/spa-wellness/enrollments/${e.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setEnrollments(prev => prev.filter(x => x.id !== e.id));
      addNotification(`${e.guest_name} removed from program`, 'success', 'Spa');
      fetchPrograms();
    } catch (err: any) {
      addNotification(`Remove failed: ${err.message}`, 'warning', 'Spa');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Wellness Programs"
        subtitle="Structured multi-day programs with enrollment and progress tracking"
        icon={Target}
        actions={
          <button onClick={fetchPrograms} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Programs" value={stats.total} icon={Target} tone="accent" />
        <StatCard title="Active" value={stats.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Enrolled Guests" value={stats.enrolled} icon={Users} tone="info" />
        <StatCard title="Avg Fill Rate" value={`${stats.fillRate}%`} icon={Flag} tone={stats.fillRate >= 80 ? 'warning' : 'accent'} />
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
              placeholder="Search programs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Types</option>
            {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            {PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> New Program
          </button>
        </div>
      </SectionCard>

      {/* Program cards */}
      <SectionCard title="Programs" subtitle={`${filtered.length} of ${programs.length} programs`} icon={Target} tone="accent" pad="none">
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No programs match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
            {filtered.map(p => {
              const fill = p.capacity ? Math.min(100, Math.round((p.enrolled_count / p.capacity) * 100)) : 0;
              return (
                <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-accent-spa)]/10 flex items-center justify-center">
                        <Target className="w-5 h-5 text-[var(--color-accent-spa)]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{p.id} · {p.program_type}</p>
                      </div>
                    </div>
                    <select
                      value={p.status}
                      disabled={actingOn === p.id}
                      onChange={e => patchProgram(p.id, { status: e.target.value }, { status: p.status })}
                      className={`${inlineSelectCls} ${statusTone[PROGRAM_STATUS_TONE[p.status]].soft}`}
                    >
                      {PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-2 min-h-[2.5rem]">{p.description}</p>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {p.schedule ? (
                      <>
                        <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                          <div className="font-bold text-sm text-slate-900 dark:text-white truncate" title={p.schedule}>{p.schedule}</div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Schedule · {p.sessions}×/wk</div>
                        </div>
                        <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                          <div className="font-bold text-sm text-slate-900 dark:text-white truncate" title={p.location || ''}>{p.location || '—'}</div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Location</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                          <div className="font-bold text-sm text-slate-900 dark:text-white">{p.duration_days}d · {p.sessions} sessions</div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Duration</div>
                        </div>
                        <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                          <div className="font-bold text-sm text-slate-900 dark:text-white">${p.price}</div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Price</div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-500 dark:text-slate-400">Enrollment</span>
                      <span className="font-medium text-slate-900 dark:text-white">{p.enrolled_count}/{p.capacity} ({fill}%)</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-700">
                      <div
                        className={`h-1.5 rounded-full transition-all ${fill >= 90 ? 'bg-rose-500' : 'bg-[var(--color-accent-spa)]'}`}
                        style={{ width: `${fill}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Instructor: {p.instructor || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {p.schedule ? 'Recurring class'
                          : `${p.start_date ? new Date(p.start_date).toLocaleDateString() : '—'} → ${p.end_date ? new Date(p.end_date).toLocaleDateString() : '—'}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                    <span className="text-[11px] text-slate-400">{(p.milestones || []).length} milestones</span>
                    <div className="flex gap-1.5">
                      <button onClick={() => openRoster(p)} title="Manage enrollments" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Users className="w-4 h-4" /></button>
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
        onConfirm={saveProgram}
        title={editing ? `Edit ${editing.name}` : 'Create Wellness Program'}
        subtitle={editing ? editing.id : 'Defines a structured program; enroll guests from the roster view'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Create Program'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Program Name *">
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. 21-Day Detox Program" />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={form.program_type} onChange={e => setForm(f => ({ ...f, program_type: e.target.value }))}>
              {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ProgramStatus }))}>
              {PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Instructor">
            <select className={inputCls} value={form.instructor_id} onChange={e => setForm(f => ({ ...f, instructor_id: e.target.value }))}>
              <option value="">None / external</option>
              {therapists.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
            </select>
          </Field>
          <Field label="Duration (days)">
            <input type="number" min={1} className={inputCls} value={form.duration_days} onChange={e => setForm(f => ({ ...f, duration_days: Number(e.target.value) }))} />
          </Field>
          <Field label="Sessions">
            <input type="number" min={1} className={inputCls} value={form.sessions} onChange={e => setForm(f => ({ ...f, sessions: Number(e.target.value) }))} />
          </Field>
          <Field label="Price ($)">
            <input type="number" min={0} className={inputCls} value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} />
          </Field>
          <Field label="Capacity">
            <input type="number" min={1} className={inputCls} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} />
          </Field>
          <Field label="Start Date">
            <input type="date" className={inputCls} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </Field>
          <Field label="End Date">
            <input type="date" className={inputCls} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
          </Field>
          <Field label="Schedule (recurring classes)">
            <input className={inputCls} value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} placeholder="e.g. Mon, Wed, Fri 7:00 AM" />
          </Field>
          <Field label="Location">
            <input className={inputCls} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Yoga Studio" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea className={inputCls + ' min-h-[70px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
          <Field label="Milestones (comma separated)">
            <input className={inputCls} value={form.milestones} onChange={e => setForm(f => ({ ...f, milestones: e.target.value }))} placeholder="Initial Assessment, Week 2, Final Assessment" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.progress_tracking}
              onChange={e => setForm(f => ({ ...f, progress_tracking: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-accent-spa)] focus:ring-[var(--color-accent-spa)]"
            />
            Track participant progress
          </label>
        </div>
      </ModalSystem>

      {/* ── Enrollment roster modal ── */}
      <ModalSystem
        isOpen={!!rosterProgram}
        onClose={() => setRosterProgram(null)}
        title={rosterProgram?.name || ''}
        subtitle={rosterProgram ? `${rosterProgram.id} · ${rosterProgram.enrolled_count}/${rosterProgram.capacity} enrolled` : ''}
        variant="info"
        size="lg"
      >
        {rosterProgram && (
          <div className="space-y-4">
            {(rosterProgram.milestones || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Milestones</div>
                <div className="flex flex-wrap gap-1.5">
                  {rosterProgram.milestones.map((m, i) => <Badge key={i} tone="neutral">{m}</Badge>)}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <select className={inputCls + ' flex-1'} value={enrollGuestId} onChange={e => setEnrollGuestId(e.target.value)}>
                <option value="">Select a guest to enroll…</option>
                {enrollableGuests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
              </select>
              <button onClick={enrollGuest} disabled={!enrollGuestId || actingOn === 'enroll'} className={button.primary}>
                <UserPlus className="w-4 h-4" /> Enroll
              </button>
            </div>

            {loadingEnrollments ? <LoadingRow /> : enrollments.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">No guests enrolled yet.</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {enrollments.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onViewGuestProfile?.(e.guest_id)}
                        className="font-medium text-sm text-slate-900 dark:text-white hover:text-[var(--color-accent-spa)] transition truncate block"
                      >
                        {e.guest_name}
                      </button>
                      <div className="text-[11px] text-slate-400">{e.guest_id} · enrolled {new Date(e.enrolled_date).toLocaleDateString()}</div>
                    </div>
                    {rosterProgram.progress_tracking && (
                      <div className="w-24">
                        <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                          <span>Progress</span><span>{e.progress}%</span>
                        </div>
                        <input
                          type="range" min={0} max={100} value={e.progress}
                          onChange={ev => setEnrollments(prev => prev.map(x => x.id === e.id ? { ...x, progress: Number(ev.target.value) } : x))}
                          onMouseUp={ev => patchEnrollment(e.id, { progress: Number((ev.target as HTMLInputElement).value) })}
                          onTouchEnd={ev => patchEnrollment(e.id, { progress: Number((ev.target as HTMLInputElement).value) })}
                          className="w-full h-1.5 accent-[var(--color-accent-spa)]"
                        />
                      </div>
                    )}
                    <select
                      value={e.status}
                      onChange={ev => patchEnrollment(e.id, { status: ev.target.value })}
                      className={`${inlineSelectCls} ${statusTone[ENROLLMENT_TONE[e.status]].soft}`}
                    >
                      {ENROLLMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => removeEnrollment(e)} title="Remove" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition">
                      <UserMinus className="w-4 h-4" />
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
        onConfirm={() => deleteTarget && deleteProgram(deleteTarget)}
        title="Delete Program"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.name}</b> ({deleteTarget?.id})? All {deleteTarget?.enrolled_count ?? 0} enrollments will be removed with it.
        </p>
      </ModalSystem>
    </div>
  );
};

export default WellnessProgramsModule;
