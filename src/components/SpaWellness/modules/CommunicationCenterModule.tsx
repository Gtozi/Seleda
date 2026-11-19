/**
 * Communication Center Module
 * DB-backed guest communications log (spa_communications) — SMS, email and
 * push notifications with scheduling and status tracking. Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Send,
  Mail,
  Smartphone,
  Bell,
  Loader2,
  RefreshCw,
  Eye,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface CommunicationCenterModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

type CommStatus = 'Sent' | 'Delivered' | 'Opened' | 'Failed' | 'Scheduled';

interface Communication {
  id: string;
  comm_type: 'SMS' | 'Email' | 'Push Notification';
  recipient_id: string | null;
  recipient_name: string;
  subject: string | null;
  message: string;
  category: string;
  status: CommStatus;
  sent_at: string | null;
  scheduled_for: string | null;
}

interface GuestOption { id: string; name: string; }

const COMM_TYPES = ['SMS', 'Email', 'Push Notification'] as const;
const CATEGORIES = [
  'Appointment Reminder', 'Wellness Tips', 'Promotional Campaign',
  'Membership Notice', 'Service Update',
];
const COMM_STATUSES: CommStatus[] = ['Sent', 'Delivered', 'Opened', 'Failed', 'Scheduled'];

const STATUS_TONE: Record<CommStatus, StatusTone> = {
  Sent: 'info',
  Delivered: 'success',
  Opened: 'accent',
  Failed: 'danger',
  Scheduled: 'warning',
};
const TYPE_TONE: Record<string, StatusTone> = {
  SMS: 'success',
  Email: 'info',
  'Push Notification': 'accent',
};
const CATEGORY_TONE: Record<string, StatusTone> = {
  'Appointment Reminder': 'info',
  'Wellness Tips': 'success',
  'Promotional Campaign': 'danger',
  'Membership Notice': 'warning',
  'Service Update': 'neutral',
};

const TYPE_ICON: Record<string, typeof Mail> = {
  SMS: Smartphone,
  Email: Mail,
  'Push Notification': Bell,
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

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

const emptyForm = {
  comm_type: 'Email' as typeof COMM_TYPES[number],
  recipient_id: '',
  broadcast: '',
  subject: '',
  message: '',
  category: 'Service Update',
  scheduled_for: '',
};

const CommunicationCenterModule: React.FC<CommunicationCenterModuleProps> = ({ onViewGuestProfile }) => {
  const { currentPropertyId, addNotification } = useERP();

  const [communications, setCommunications] = useState<Communication[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [viewTarget, setViewTarget] = useState<Communication | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Communication | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchCommunications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/communications${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setCommunications(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load communications');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchCommunications();
    fetch('/api/spa-wellness/guests', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setGuests)
      .catch(() => {});
  }, [fetchCommunications]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => communications.filter(c => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.recipient_name.toLowerCase().includes(q) ||
      c.message.toLowerCase().includes(q) || (c.subject || '').toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q);
    return matchesSearch &&
      (statusFilter === 'All' || c.status === statusFilter) &&
      (typeFilter === 'All' || c.comm_type === typeFilter) &&
      (categoryFilter === 'All' || c.category === categoryFilter);
  }), [communications, search, statusFilter, typeFilter, categoryFilter]);

  const stats = useMemo(() => ({
    total: communications.length,
    delivered: communications.filter(c => c.status === 'Delivered' || c.status === 'Opened').length,
    scheduled: communications.filter(c => c.status === 'Scheduled').length,
    failed: communications.filter(c => c.status === 'Failed').length,
  }), [communications]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchComm = async (id: string, updates: Record<string, unknown>, revert?: Partial<Communication>) => {
    setActingOn(id);
    try {
      const res = await fetch(`/api/spa-wellness/communications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setCommunications(prev => prev.map(c => (c.id === id ? saved : c)));
      return saved;
    } catch (e: any) {
      if (revert) setCommunications(prev => prev.map(c => (c.id === id ? { ...c, ...revert } : c)));
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
      return null;
    } finally {
      setActingOn(null);
    }
  };

  const sendNow = async (c: Communication) => {
    const saved = await patchComm(c.id, { send: true });
    if (saved) addNotification(`${c.id} sent to ${c.recipient_name}`, 'success', 'Spa');
  };

  const saveCommunication = async () => {
    if (!form.message.trim()) {
      addNotification('Message is required', 'warning', 'Spa');
      return;
    }
    if (!form.recipient_id && !form.broadcast.trim()) {
      addNotification('Select a guest or enter a broadcast label', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/spa-wellness/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          comm_type: form.comm_type,
          recipient_id: form.recipient_id || null,
          recipient_name: form.recipient_id ? null : form.broadcast.trim(),
          subject: form.subject || null,
          message: form.message.trim(),
          category: form.category,
          scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
          propertyId: currentPropertyId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setShowForm(false);
      setForm({ ...emptyForm });
      addNotification(
        saved.status === 'Scheduled' ? `Message scheduled for ${new Date(saved.scheduled_for).toLocaleString()}` : `Message sent to ${saved.recipient_name}`,
        'success', 'Spa'
      );
      fetchCommunications();
    } catch (e: any) {
      addNotification(`Send failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteComm = async (c: Communication) => {
    setActingOn(c.id);
    try {
      const res = await fetch(`/api/spa-wellness/communications/${c.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setCommunications(prev => prev.filter(x => x.id !== c.id));
      setDeleteTarget(null);
      addNotification(`${c.id} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Communication Center"
        subtitle="Guest communications via SMS, email and push notifications"
        icon={MessageSquare}
        actions={
          <button onClick={fetchCommunications} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Messages" value={stats.total} icon={MessageSquare} tone="accent" />
        <StatCard title="Delivered / Opened" value={stats.delivered} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={stats.scheduled} icon={Clock} tone={stats.scheduled > 0 ? 'warning' : 'neutral'} />
        <StatCard title="Failed" value={stats.failed} icon={AlertTriangle} tone={stats.failed > 0 ? 'danger' : 'success'} />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search recipient, subject, message…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Types</option>
            {COMM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            {COMM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => { setForm({ ...emptyForm }); setShowForm(true); }} className={button.primary}>
            <Plus className="w-4 h-4" /> New Message
          </button>
        </div>
      </SectionCard>

      {/* Communications table */}
      <SectionCard title="Communications" subtitle={`${filtered.length} of ${communications.length} messages`} icon={MessageSquare} tone="accent" pad="none">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No communications match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Recipient</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Message</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filtered.map(c => {
                  const TypeIcon = TYPE_ICON[c.comm_type] || MessageSquare;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="w-4 h-4 text-slate-400" />
                          <Badge tone={TYPE_TONE[c.comm_type] || 'neutral'}>{c.comm_type}</Badge>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">{c.id}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        {c.recipient_id ? (
                          <button
                            onClick={() => onViewGuestProfile?.(c.recipient_id!)}
                            className="text-sm font-medium text-[var(--color-accent-spa)] hover:opacity-80 transition"
                          >
                            {c.recipient_name}
                          </button>
                        ) : (
                          <span className="text-sm text-slate-700 dark:text-slate-300">{c.recipient_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge tone={CATEGORY_TONE[c.category] || 'neutral'}>{c.category}</Badge>
                      </td>
                      <td className="px-4 py-3.5 max-w-[280px]">
                        {c.subject && <div className="font-medium text-sm text-slate-900 dark:text-white truncate">{c.subject}</div>}
                        <div className="text-sm text-slate-500 dark:text-slate-400 line-clamp-1">{c.message}</div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <div>{fmtDate(c.sent_at)}</div>
                        {c.scheduled_for && (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400">Sched: {fmtDate(c.scheduled_for)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          value={c.status}
                          onChange={ev => patchComm(c.id, { status: ev.target.value }, { status: c.status })}
                          disabled={actingOn === c.id}
                          className={`${inlineSelectCls} ${statusTone[STATUS_TONE[c.status]].soft}`}
                        >
                          {COMM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {c.status === 'Scheduled' && (
                            <button onClick={() => sendNow(c)} title="Send now" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Send className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => setViewTarget(c)} title="View" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Eye className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteTarget(c)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Compose modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onConfirm={saveCommunication}
        title="New Message"
        subtitle="Send now or schedule for later"
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={form.scheduled_for ? 'Schedule Message' : 'Send Message'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Type">
            <select className={inputCls} value={form.comm_type} onChange={e => setForm(f => ({ ...f, comm_type: e.target.value as typeof COMM_TYPES[number] }))}>
              {COMM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Recipient (guest)">
            <select className={inputCls} value={form.recipient_id} onChange={e => setForm(f => ({ ...f, recipient_id: e.target.value, broadcast: '' }))}>
              <option value="">— broadcast instead —</option>
              {guests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
            </select>
          </Field>
          <Field label="Broadcast label (if no guest)">
            <input
              className={inputCls}
              value={form.broadcast}
              onChange={e => setForm(f => ({ ...f, broadcast: e.target.value, recipient_id: '' }))}
              placeholder="e.g. All Members"
              disabled={!!form.recipient_id}
            />
          </Field>
          {form.comm_type === 'Email' && (
            <div className="md:col-span-2">
              <Field label="Subject">
                <input className={inputCls} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
              </Field>
            </div>
          )}
          <div className="md:col-span-2">
            <Field label="Message *">
              <textarea className={inputCls + ' min-h-[90px]'} value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} placeholder="Message content…" />
            </Field>
          </div>
          <Field label="Schedule for (blank = send now)">
            <input type="datetime-local" className={inputCls} value={form.scheduled_for} onChange={e => setForm(f => ({ ...f, scheduled_for: e.target.value }))} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── View modal ── */}
      <ModalSystem
        isOpen={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={viewTarget?.subject || viewTarget?.id || ''}
        subtitle={viewTarget ? `${viewTarget.comm_type} → ${viewTarget.recipient_name}` : ''}
        variant="info"
        size="md"
      >
        {viewTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={TYPE_TONE[viewTarget.comm_type] || 'neutral'}>{viewTarget.comm_type}</Badge>
              <Badge tone={CATEGORY_TONE[viewTarget.category] || 'neutral'}>{viewTarget.category}</Badge>
              <Badge tone={STATUS_TONE[viewTarget.status]}>{viewTarget.status}</Badge>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-4 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {viewTarget.message}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <div>Sent: {fmtDate(viewTarget.sent_at)}</div>
              {viewTarget.scheduled_for && <div>Scheduled for: {fmtDate(viewTarget.scheduled_for)}</div>}
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteComm(deleteTarget)}
        title="Delete Communication"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.id}</b> ({deleteTarget?.comm_type} to {deleteTarget?.recipient_name})?
        </p>
      </ModalSystem>
    </div>
  );
};

export default CommunicationCenterModule;
