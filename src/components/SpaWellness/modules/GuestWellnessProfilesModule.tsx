/**
 * Guest Wellness Profiles Module
 * DB-backed guest wellness profiles (spa_wellness_profiles): goals, medical
 * notes, allergies, skin type, treatment preferences, contraindications and
 * favorite therapist. Visit counts, spend and treatment history are computed
 * live from spa_appointments. Mirrors the Housekeeping/Front Office shared UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  User,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  Heart,
  AlertTriangle,
  Star,
  Loader2,
  RefreshCw,
  ShieldAlert,
  MessageSquare,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';

interface GuestWellnessProfilesModuleProps {
  selectedGuestId?: string;
  onClearSelectedGuestId?: () => void;
}

type SkinType = 'Normal' | 'Dry' | 'Oily' | 'Combination' | 'Sensitive';
type Pressure = 'Light' | 'Medium' | 'Firm' | 'Extra Firm';
type CommPref = 'Email' | 'SMS' | 'Phone' | 'In-Person';

interface WellnessProfile {
  id: string;
  guest_id: string;
  guest_name: string;
  wellness_goals: string[];
  medical_notes: string | null;
  allergies: string[];
  skin_type: SkinType | null;
  treatment_preferences: string[];
  contraindications: string[];
  favorite_therapist_id: string | null;
  favorite_therapist: string | null;
  preferred_pressure: Pressure | null;
  communication_preference: CommPref | null;
  // live stats (withStats=true)
  total_visits: number;
  total_spent: number;
  last_visit: string | null;
  previous_treatments: { treatment: string; date: string }[];
}

interface GuestOption { id: string; name: string; }
interface TherapistOption { id: string; name: string; }

const SKIN_TYPES: SkinType[] = ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'];
const PRESSURES: Pressure[] = ['Light', 'Medium', 'Firm', 'Extra Firm'];
const COMM_PREFS: CommPref[] = ['Email', 'SMS', 'Phone', 'In-Person'];

const SKIN_TONE: Record<SkinType, StatusTone> = {
  Normal: 'success',
  Dry: 'warning',
  Oily: 'info',
  Combination: 'accent',
  Sensitive: 'danger',
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
  guest_id: '',
  wellness_goals: '',
  medical_notes: '',
  allergies: '',
  skin_type: 'Normal' as SkinType,
  treatment_preferences: '',
  contraindications: '',
  favorite_therapist_id: '',
  preferred_pressure: 'Medium' as Pressure,
  communication_preference: 'Email' as CommPref,
};

const GuestWellnessProfilesModule: React.FC<GuestWellnessProfilesModuleProps> = ({
  selectedGuestId,
  onClearSelectedGuestId,
}) => {
  const { currentPropertyId, addNotification } = useERP();

  const [profiles, setProfiles] = useState<WellnessProfile[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [therapists, setTherapists] = useState<TherapistOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [skinTypeFilter, setSkinTypeFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WellnessProfile | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [detailTarget, setDetailTarget] = useState<WellnessProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WellnessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ withStats: 'true' });
      if (currentPropertyId) params.set('propertyId', currentPropertyId);
      const res = await fetch(`/api/spa-wellness/wellness-profiles?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setProfiles(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load wellness profiles');
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

  useEffect(() => { fetchProfiles(); fetchLookups(); }, [fetchProfiles, fetchLookups]);

  // Deep-link: open the profile detail for the given guest.
  useEffect(() => {
    if (!selectedGuestId || loading) return;
    const match = profiles.find(p => p.guest_id === selectedGuestId);
    if (match) setDetailTarget(match);
    onClearSelectedGuestId?.();
  }, [selectedGuestId, loading, profiles, onClearSelectedGuestId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => profiles.filter(p => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || p.guest_name.toLowerCase().includes(q)
      || p.id.toLowerCase().includes(q)
      || p.wellness_goals.some(g => g.toLowerCase().includes(q));
    const matchesSkin = skinTypeFilter === 'All' || p.skin_type === skinTypeFilter;
    return matchesSearch && matchesSkin;
  }), [profiles, search, skinTypeFilter]);

  const stats = useMemo(() => ({
    total: profiles.length,
    withAllergies: profiles.filter(p => (p.allergies || []).length > 0).length,
    visits: profiles.reduce((n, p) => n + (p.total_visits || 0), 0),
    spent: profiles.reduce((n, p) => n + (p.total_spent || 0), 0),
  }), [profiles]);

  const guestsWithoutProfile = useMemo(() => {
    const taken = new Set(profiles.map(p => p.guest_id));
    return guests.filter(g => !taken.has(g.id));
  }, [guests, profiles]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (p: WellnessProfile) => {
    setEditing(p);
    setForm({
      guest_id: p.guest_id,
      wellness_goals: (p.wellness_goals || []).join(', '),
      medical_notes: p.medical_notes || '',
      allergies: (p.allergies || []).join(', '),
      skin_type: p.skin_type || 'Normal',
      treatment_preferences: (p.treatment_preferences || []).join(', '),
      contraindications: (p.contraindications || []).join(', '),
      favorite_therapist_id: p.favorite_therapist_id || '',
      preferred_pressure: p.preferred_pressure || 'Medium',
      communication_preference: p.communication_preference || 'Email',
    });
    setShowForm(true);
  };

  const saveProfile = async () => {
    if (!editing && !form.guest_id) {
      addNotification('Select a guest', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const toList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
    const payload: Record<string, unknown> = {
      wellness_goals: toList(form.wellness_goals),
      medical_notes: form.medical_notes || null,
      allergies: toList(form.allergies),
      skin_type: form.skin_type,
      treatment_preferences: toList(form.treatment_preferences),
      contraindications: toList(form.contraindications),
      favorite_therapist_id: form.favorite_therapist_id || null,
      preferred_pressure: form.preferred_pressure,
      communication_preference: form.communication_preference,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/wellness-profiles/${editing.id}` : '/api/spa-wellness/wellness-profiles', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(editing ? payload : { ...payload, guest_id: form.guest_id, propertyId: currentPropertyId || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? 'Profile updated' : 'Wellness profile created', 'success', 'Spa');
      fetchProfiles();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (p: WellnessProfile) => {
    setActingOn(p.id);
    try {
      const res = await fetch(`/api/spa-wellness/wellness-profiles/${p.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setProfiles(prev => prev.filter(x => x.id !== p.id));
      setDeleteTarget(null);
      addNotification(`Profile for ${p.guest_name} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const initials = (name: string) =>
    name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Wellness Profiles"
        subtitle="Wellness goals, medical notes, allergies and treatment preferences per guest"
        icon={Heart}
        actions={
          <button onClick={fetchProfiles} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Profiles" value={stats.total} icon={User} tone="accent" />
        <StatCard title="With Allergies" value={stats.withAllergies} icon={AlertTriangle} tone={stats.withAllergies ? 'warning' : 'success'} />
        <StatCard title="Total Spa Visits" value={stats.visits} icon={Heart} tone="info" />
        <StatCard title="Total Spa Spend" value={`$${stats.spent.toLocaleString()}`} icon={Star} tone="success" />
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
              placeholder="Search guests or goals…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={skinTypeFilter} onChange={e => setSkinTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Skin Types</option>
            {SKIN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> New Profile
          </button>
        </div>
      </SectionCard>

      {/* Profile cards */}
      <SectionCard title="Wellness Profiles" subtitle={`${filtered.length} of ${profiles.length} profiles`} icon={Heart} tone="accent" pad="none">
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No wellness profiles match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
            {filtered.map(p => (
              <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 shrink-0 rounded-full bg-[var(--color-accent-spa)]/10 flex items-center justify-center text-sm font-bold text-[var(--color-accent-spa)]">
                      {initials(p.guest_name)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{p.guest_name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{p.id} · {p.guest_id}</p>
                    </div>
                  </div>
                  {p.skin_type && <Badge tone={SKIN_TONE[p.skin_type]}>{p.skin_type}</Badge>}
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="font-bold text-slate-900 dark:text-white">{p.total_visits ?? 0}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Visits</div>
                  </div>
                  <div className="text-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="font-bold text-slate-900 dark:text-white">${(p.total_spent ?? 0).toLocaleString()}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Spent</div>
                  </div>
                  <div className="text-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                    <div className="font-bold text-slate-900 dark:text-white">{p.preferred_pressure || '—'}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Pressure</div>
                  </div>
                </div>

                <div className="space-y-2.5 mb-4">
                  {(p.wellness_goals || []).length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        <Heart className="w-3.5 h-3.5 text-rose-500" /> Wellness Goals
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {p.wellness_goals.map((g, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-300 text-[10px] font-medium">{g}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(p.allergies || []).length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Allergies
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {p.allergies.map((a, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 text-[10px] font-medium">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Star className="w-3.5 h-3.5 text-amber-500" />
                    Favorite therapist: <span className="font-medium text-slate-700 dark:text-slate-300">{p.favorite_therapist || '—'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-[11px] text-slate-400">
                    Last visit: {p.last_visit ? new Date(p.last_visit).toLocaleDateString() : '—'}
                  </span>
                  <div className="flex gap-1.5">
                    <button onClick={() => setDetailTarget(p)} title="View profile" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Eye className="w-4 h-4" /></button>
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
        onConfirm={saveProfile}
        title={editing ? `Edit ${editing.guest_name}'s Profile` : 'Create Wellness Profile'}
        subtitle={editing ? editing.id : 'Links a guest to their spa wellness preferences'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Create Profile'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!editing && (
            <Field label="Guest *">
              <select className={inputCls} value={form.guest_id} onChange={e => setForm(f => ({ ...f, guest_id: e.target.value }))}>
                <option value="">Select a guest…</option>
                {guestsWithoutProfile.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
              </select>
            </Field>
          )}
          <Field label="Skin Type">
            <select className={inputCls} value={form.skin_type} onChange={e => setForm(f => ({ ...f, skin_type: e.target.value as SkinType }))}>
              {SKIN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Preferred Pressure">
            <select className={inputCls} value={form.preferred_pressure} onChange={e => setForm(f => ({ ...f, preferred_pressure: e.target.value as Pressure }))}>
              {PRESSURES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Communication Preference">
            <select className={inputCls} value={form.communication_preference} onChange={e => setForm(f => ({ ...f, communication_preference: e.target.value as CommPref }))}>
              {COMM_PREFS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Favorite Therapist">
            <select className={inputCls} value={form.favorite_therapist_id} onChange={e => setForm(f => ({ ...f, favorite_therapist_id: e.target.value }))}>
              <option value="">None</option>
              {therapists.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
            </select>
          </Field>
          <Field label="Wellness Goals (comma separated)">
            <input className={inputCls} value={form.wellness_goals} onChange={e => setForm(f => ({ ...f, wellness_goals: e.target.value }))} placeholder="Stress Relief, Better Sleep" />
          </Field>
          <Field label="Allergies (comma separated)">
            <input className={inputCls} value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} placeholder="Lavender, Peanut Oil" />
          </Field>
          <Field label="Treatment Preferences (comma separated)">
            <input className={inputCls} value={form.treatment_preferences} onChange={e => setForm(f => ({ ...f, treatment_preferences: e.target.value }))} placeholder="Swedish Massage, Aromatherapy" />
          </Field>
          <Field label="Contraindications (comma separated)">
            <input className={inputCls} value={form.contraindications} onChange={e => setForm(f => ({ ...f, contraindications: e.target.value }))} placeholder="Deep Tissue on lower back" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Medical Notes">
              <textarea className={inputCls + ' min-h-[80px]'} value={form.medical_notes} onChange={e => setForm(f => ({ ...f, medical_notes: e.target.value }))} placeholder="Relevant medical history, areas to avoid…" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Detail modal ── */}
      <ModalSystem
        isOpen={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={detailTarget?.guest_name || ''}
        subtitle={detailTarget ? `${detailTarget.id} · Guest ${detailTarget.guest_id}` : ''}
        variant="info"
        size="lg"
      >
        {detailTarget && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {detailTarget.skin_type && <Badge tone={SKIN_TONE[detailTarget.skin_type]}>{detailTarget.skin_type} skin</Badge>}
              {detailTarget.preferred_pressure && <Badge tone="info">{detailTarget.preferred_pressure} pressure</Badge>}
              {detailTarget.communication_preference && <Badge tone="neutral"><MessageSquare className="w-3 h-3 inline mr-1" />{detailTarget.communication_preference}</Badge>}
              {detailTarget.favorite_therapist && <Badge tone="accent"><Star className="w-3 h-3 inline mr-1" />{detailTarget.favorite_therapist}</Badge>}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.total_visits ?? 0}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Total Visits</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">${(detailTarget.total_spent ?? 0).toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Total Spent</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.last_visit ? new Date(detailTarget.last_visit).toLocaleDateString() : '—'}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Last Visit</div>
              </div>
            </div>

            {detailTarget.medical_notes && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> Medical Notes
                </div>
                <p className="text-slate-700 dark:text-slate-300">{detailTarget.medical_notes}</p>
              </div>
            )}

            {([
              ['Wellness Goals', detailTarget.wellness_goals, 'rose'],
              ['Allergies', detailTarget.allergies, 'amber'],
              ['Treatment Preferences', detailTarget.treatment_preferences, 'accent'],
              ['Contraindications', detailTarget.contraindications, 'danger'],
            ] as [string, string[], string][]).map(([label, items]) =>
              (items || []).length > 0 && (
                <div key={label}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((it, i) => <Badge key={i} tone="neutral">{it}</Badge>)}
                  </div>
                </div>
              )
            )}

            {(detailTarget.previous_treatments || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Completed Treatments</div>
                <div className="space-y-1">
                  {detailTarget.previous_treatments.map((t, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <span className="text-slate-700 dark:text-slate-300">{t.treatment}</span>
                      <span className="text-xs text-slate-400">{new Date(t.date).toLocaleDateString()}</span>
                    </div>
                  ))}
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
        onConfirm={() => deleteTarget && deleteProfile(deleteTarget)}
        title="Delete Wellness Profile"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete the wellness profile for <b>{deleteTarget?.guest_name}</b> ({deleteTarget?.id})? The guest record and appointments are unaffected.
        </p>
      </ModalSystem>
    </div>
  );
};

export default GuestWellnessProfilesModule;
