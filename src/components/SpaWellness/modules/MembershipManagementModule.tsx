/**
 * Membership Management Module
 * DB-backed spa memberships (spa_memberships): type, status, benefits, visit
 * allowances and renewal tracking. total_visits is computed live from
 * spa_appointments since the membership start date. Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Crown,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  Calendar,
  Loader2,
  RefreshCw,
  CheckCircle2,
  TrendingUp,
  AlarmClock,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface MembershipManagementModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

type MembershipType = 'Monthly' | 'Quarterly' | 'Annual' | 'Family' | 'Corporate' | 'VIP';
type MembershipStatus = 'Active' | 'Expired' | 'Frozen' | 'Pending' | 'Cancelled';

interface Membership {
  id: string;
  guest_id: string;
  member_name: string;
  membership_type: MembershipType;
  status: MembershipStatus;
  start_date: string;
  end_date: string;
  price: number;
  benefits: string[];
  visits_remaining: number | null;
  auto_renew: boolean;
  payment_method: string | null;
  total_visits: number;
}

interface GuestOption { id: string; name: string; }

const MEMBERSHIP_TYPES: MembershipType[] = ['Monthly', 'Quarterly', 'Annual', 'Family', 'Corporate', 'VIP'];
const MEMBERSHIP_STATUSES: MembershipStatus[] = ['Active', 'Expired', 'Frozen', 'Pending', 'Cancelled'];
const PAYMENT_METHODS = ['Credit Card', 'Bank Transfer', 'Cash', 'Corporate Billing', 'Direct Debit'];

const STATUS_TONE: Record<MembershipStatus, StatusTone> = {
  Active: 'success',
  Expired: 'danger',
  Frozen: 'warning',
  Pending: 'info',
  Cancelled: 'neutral',
};
const TYPE_TONE: Record<MembershipType, StatusTone> = {
  VIP: 'warning',
  Corporate: 'info',
  Family: 'accent',
  Annual: 'success',
  Quarterly: 'info',
  Monthly: 'neutral',
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
  guest_id: '',
  membership_type: 'Monthly' as MembershipType,
  status: 'Active' as MembershipStatus,
  start_date: '',
  end_date: '',
  price: 0,
  benefits: '',
  visits_remaining: '',
  auto_renew: false,
  payment_method: 'Credit Card',
};

const MembershipManagementModule: React.FC<MembershipManagementModuleProps> = ({ onViewGuestProfile }) => {
  const { currentPropertyId, addNotification } = useERP();

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [detailTarget, setDetailTarget] = useState<Membership | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Membership | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchMemberships = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/memberships${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setMemberships(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load memberships');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchMemberships();
    fetch('/api/spa-wellness/guests', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setGuests)
      .catch(() => {});
  }, [fetchMemberships]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => memberships.filter(m => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || m.member_name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.guest_id.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || m.status === statusFilter;
    const matchesType = typeFilter === 'All' || m.membership_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  }), [memberships, search, statusFilter, typeFilter]);

  const daysUntil = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

  const stats = useMemo(() => ({
    total: memberships.length,
    active: memberships.filter(m => m.status === 'Active').length,
    expiringSoon: memberships.filter(m => m.status === 'Active' && daysUntil(m.end_date) >= 0 && daysUntil(m.end_date) <= 30).length,
    activeValue: memberships.filter(m => m.status === 'Active').reduce((n, m) => n + Number(m.price || 0), 0),
  }), [memberships]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchMembership = async (id: string, updates: Record<string, unknown>, revert?: Partial<Membership>) => {
    setActingOn(id);
    setMemberships(prev => prev.map(m => (m.id === id ? { ...m, ...updates } as Membership : m)));
    try {
      const res = await fetch(`/api/spa-wellness/memberships/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setMemberships(prev => prev.map(m => (m.id === id ? { ...saved, total_visits: m.total_visits } : m)));
    } catch (e: any) {
      if (revert) setMemberships(prev => prev.map(m => (m.id === id ? { ...m, ...revert } : m)));
      else fetchMemberships();
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const openAdd = () => {
    setEditing(null);
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    setForm({ ...emptyForm, start_date: today, end_date: nextMonth });
    setShowForm(true);
  };

  const openEdit = (m: Membership) => {
    setEditing(m);
    setForm({
      guest_id: m.guest_id,
      membership_type: m.membership_type,
      status: m.status,
      start_date: m.start_date,
      end_date: m.end_date,
      price: m.price,
      benefits: (m.benefits || []).join(', '),
      visits_remaining: m.visits_remaining == null ? '' : String(m.visits_remaining),
      auto_renew: m.auto_renew,
      payment_method: m.payment_method || 'Credit Card',
    });
    setShowForm(true);
  };

  const saveMembership = async () => {
    if (!editing && !form.guest_id) {
      addNotification('Select a guest', 'warning', 'Spa');
      return;
    }
    if (!form.start_date || !form.end_date) {
      addNotification('Start and end dates are required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      membership_type: form.membership_type,
      status: form.status,
      start_date: form.start_date,
      end_date: form.end_date,
      price: Number(form.price) || 0,
      benefits: form.benefits.split(',').map(s => s.trim()).filter(Boolean),
      visits_remaining: form.visits_remaining === '' ? null : Number(form.visits_remaining),
      auto_renew: form.auto_renew,
      payment_method: form.payment_method,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/memberships/${editing.id}` : '/api/spa-wellness/memberships', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(editing ? payload : { ...payload, guest_id: form.guest_id, propertyId: currentPropertyId || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? 'Membership updated' : 'Membership created', 'success', 'Spa');
      fetchMemberships();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteMembership = async (m: Membership) => {
    setActingOn(m.id);
    try {
      const res = await fetch(`/api/spa-wellness/memberships/${m.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setMemberships(prev => prev.filter(x => x.id !== m.id));
      setDeleteTarget(null);
      addNotification(`Membership ${m.id} removed`, 'success', 'Spa');
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
        title="Membership Management"
        subtitle="Spa memberships, renewals, benefits and visit allowances"
        icon={Crown}
        actions={
          <button onClick={fetchMemberships} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Memberships" value={stats.total} icon={Crown} tone="accent" />
        <StatCard title="Active" value={stats.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Expiring ≤30d" value={stats.expiringSoon} icon={AlarmClock} tone={stats.expiringSoon ? 'warning' : 'success'} />
        <StatCard title="Active Value" value={`$${stats.activeValue.toLocaleString()}`} icon={TrendingUp} tone="info" />
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
              placeholder="Search members…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Types</option>
            {MEMBERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            {MEMBERSHIP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> New Membership
          </button>
        </div>
      </SectionCard>

      {/* Membership cards */}
      <SectionCard title="Memberships" subtitle={`${filtered.length} of ${memberships.length} memberships`} icon={Crown} tone="accent" pad="none">
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No memberships match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
            {filtered.map(m => {
              const days = daysUntil(m.end_date);
              const expiring = m.status === 'Active' && days >= 0 && days <= 30;
              return (
                <div key={m.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--color-accent-spa)]/10 flex items-center justify-center text-xs font-bold text-[var(--color-accent-spa)]">
                        {initials(m.member_name)}
                      </div>
                      <div className="min-w-0">
                        <button
                          onClick={() => onViewGuestProfile?.(m.guest_id)}
                          className="font-semibold text-slate-900 dark:text-white hover:text-[var(--color-accent-spa)] transition truncate block text-left"
                        >
                          {m.member_name}
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{m.id} · {m.guest_id}</p>
                      </div>
                    </div>
                    <select
                      value={m.status}
                      disabled={actingOn === m.id}
                      onChange={e => patchMembership(m.id, { status: e.target.value }, { status: m.status })}
                      className={`${inlineSelectCls} ${statusTone[STATUS_TONE[m.status]].soft}`}
                    >
                      {MEMBERSHIP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <Badge tone={TYPE_TONE[m.membership_type]}>{m.membership_type}</Badge>
                    {m.auto_renew && <Badge tone="success"><CheckCircle2 className="w-3 h-3 inline mr-0.5" />Auto-renew</Badge>}
                    {expiring && <Badge tone="warning">Expires in {days}d</Badge>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="font-bold text-sm text-slate-900 dark:text-white">${m.price}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Price</div>
                    </div>
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="font-bold text-sm text-slate-900 dark:text-white">
                        {m.visits_remaining == null ? 'Unlimited' : m.visits_remaining}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Visits Left</div>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      <span>{new Date(m.start_date).toLocaleDateString()} → {new Date(m.end_date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                      <span>{m.total_visits ?? 0} visits since start</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                    <div className="flex flex-wrap gap-1">
                      {(m.benefits || []).slice(0, 2).map((b, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[10px]">{b}</span>
                      ))}
                      {(m.benefits || []).length > 2 && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[10px]">+{m.benefits.length - 2}</span>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => setDetailTarget(m)} title="Details" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(m)} title="Edit" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(m)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
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
        onConfirm={saveMembership}
        title={editing ? `Edit ${editing.member_name}'s Membership` : 'New Membership'}
        subtitle={editing ? editing.id : 'Assign a membership plan to a guest'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Create Membership'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!editing && (
            <Field label="Guest *">
              <select className={inputCls} value={form.guest_id} onChange={e => setForm(f => ({ ...f, guest_id: e.target.value }))}>
                <option value="">Select a guest…</option>
                {guests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
              </select>
            </Field>
          )}
          <Field label="Membership Type">
            <select className={inputCls} value={form.membership_type} onChange={e => setForm(f => ({ ...f, membership_type: e.target.value as MembershipType }))}>
              {MEMBERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as MembershipStatus }))}>
              {MEMBERSHIP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Start Date *">
            <input type="date" className={inputCls} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </Field>
          <Field label="End Date *">
            <input type="date" className={inputCls} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
          </Field>
          <Field label="Price ($)">
            <input type="number" min={0} className={inputCls} value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} />
          </Field>
          <Field label="Visits Remaining (blank = unlimited)">
            <input type="number" min={0} className={inputCls} value={form.visits_remaining} onChange={e => setForm(f => ({ ...f, visits_remaining: e.target.value }))} />
          </Field>
          <Field label="Payment Method">
            <select className={inputCls} value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
              {PAYMENT_METHODS.map(pm => <option key={pm} value={pm}>{pm}</option>)}
            </select>
          </Field>
          <Field label="Benefits (comma separated)">
            <input className={inputCls} value={form.benefits} onChange={e => setForm(f => ({ ...f, benefits: e.target.value }))} placeholder="Unlimited Spa Access, 20% Retail Discount" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.auto_renew}
              onChange={e => setForm(f => ({ ...f, auto_renew: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-accent-spa)] focus:ring-[var(--color-accent-spa)]"
            />
            Auto-renew on expiry
          </label>
        </div>
      </ModalSystem>

      {/* ── Detail modal ── */}
      <ModalSystem
        isOpen={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={detailTarget?.member_name || ''}
        subtitle={detailTarget ? `${detailTarget.id} · Guest ${detailTarget.guest_id}` : ''}
        variant="info"
        size="md"
      >
        {detailTarget && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={STATUS_TONE[detailTarget.status]}>{detailTarget.status}</Badge>
              <Badge tone={TYPE_TONE[detailTarget.membership_type]}>{detailTarget.membership_type}</Badge>
              {detailTarget.auto_renew && <Badge tone="success">Auto-renew</Badge>}
              {detailTarget.payment_method && <Badge tone="neutral">{detailTarget.payment_method}</Badge>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">${detailTarget.price}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Price</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.visits_remaining == null ? '∞' : detailTarget.visits_remaining}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Visits Left</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-center">
                <div className="font-bold text-slate-900 dark:text-white">{detailTarget.total_visits ?? 0}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Visits Used</div>
              </div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Valid {new Date(detailTarget.start_date).toLocaleDateString()} → {new Date(detailTarget.end_date).toLocaleDateString()}
            </div>
            {(detailTarget.benefits || []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Benefits</div>
                <div className="flex flex-wrap gap-1.5">
                  {detailTarget.benefits.map((b, i) => <Badge key={i} tone="neutral">{b}</Badge>)}
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
        onConfirm={() => deleteTarget && deleteMembership(deleteTarget)}
        title="Delete Membership"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.member_name}</b>'s {deleteTarget?.membership_type} membership ({deleteTarget?.id})? The guest record is unaffected.
        </p>
      </ModalSystem>
    </div>
  );
};

export default MembershipManagementModule;
