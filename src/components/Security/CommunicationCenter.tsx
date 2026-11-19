/**
 * Communication Center — /erp/security/communication.
 *
 * DB-integrated via /api/sec-portal/messages routes (migration 619).
 * `sec_messages` is the dispatch/internal/broadcast register — type,
 * priority (Emergency/Urgent/Routine), channel (Radio/App/Email/PA
 * System), audience, sender, expiry, and a Sent → Acknowledged |
 * Expired | Recalled lifecycle. `sec_message_acks` is the real
 * per-person acknowledgement log — POST /:id/ack records an ack and
 * a Sent message auto-derives to Acknowledged on its first ack.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MessageSquare, Plus, Search, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Tag, Clock, User, Radio,
  Megaphone, Siren, Send, CheckCheck, Ban, Timer, Users,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecMessages, fetchSecMessage, createSecMessage, updateSecMessage,
  ackSecMessage, deleteSecMessage, fetchSecStaff,
  type SecMessage, type SecMessageDetail, type SecMessageType,
  type SecMessagePriority, type SecMessageChannel, type SecMessageAudience,
  type SecMessageStatus, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const MSG_TYPES: SecMessageType[] = ['Dispatch', 'Internal', 'Broadcast', 'Emergency'];
const PRIORITIES: SecMessagePriority[] = ['Emergency', 'Urgent', 'Routine'];
const CHANNELS: SecMessageChannel[] = ['Radio', 'App', 'Email', 'PA System'];
const AUDIENCES: SecMessageAudience[] = [
  'All Security', 'Shift Supervisors', 'Patrol Officers', 'Control Room', 'Management', 'Custom',
];
const STATUSES: SecMessageStatus[] = ['Sent', 'Acknowledged', 'Expired', 'Recalled'];

const TYPE_TONE: Record<SecMessageType, StatusTone> = {
  Dispatch: 'info',
  Internal: 'neutral',
  Broadcast: 'accent',
  Emergency: 'danger',
};
const PRIORITY_TONE: Record<SecMessagePriority, StatusTone> = {
  Emergency: 'danger', Urgent: 'warning', Routine: 'neutral',
};
const STATUS_TONE: Record<SecMessageStatus, StatusTone> = {
  Sent: 'warning',
  Acknowledged: 'success',
  Expired: 'neutral',
  Recalled: 'danger',
};
const TYPE_ICON: Record<SecMessageType, typeof MessageSquare> = {
  Dispatch: Radio,
  Internal: MessageSquare,
  Broadcast: Megaphone,
  Emergency: Siren,
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

const inlineStatusSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isExpired(m: SecMessage): boolean {
  return !!m.expires_at && new Date(m.expires_at) < new Date();
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-6 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-6 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No messages found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

const CommunicationCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [messages, setMessages] = useState<SecMessage[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecMessageStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecMessageType>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | SecMessagePriority>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecMessage | null>(null);
  const [detail, setDetail] = useState<SecMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecMessage | null>(null);

  // Ack form (detail modal)
  const [ackBy, setAckBy] = useState('');
  const [ackNote, setAckNote] = useState('');

  const emptyForm = {
    msgType: 'Internal' as SecMessageType,
    priority: 'Routine' as SecMessagePriority,
    channel: 'App' as SecMessageChannel,
    audience: 'All Security' as SecMessageAudience,
    recipient: '', subject: '', body: '', sender: '', expiresAt: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s] = await Promise.all([
        fetchSecMessages(currentPropertyId),
        fetchSecStaff(currentPropertyId).catch(() => [] as SecStaff[]),
      ]);
      setMessages(m);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecMessage(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load message', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (m: SecMessage) => {
    setDetail(null);
    setAckBy('');
    setAckNote('');
    loadDetail(m.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.message.id);
    addNotification('Messages refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: messages.length,
    awaitingAck: messages.filter(m => m.status === 'Sent').length,
    acknowledged: messages.filter(m => m.status === 'Acknowledged').length,
    emergency: messages.filter(m => m.priority === 'Emergency' && ['Sent', 'Acknowledged'].includes(m.status)).length,
  }), [messages]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return messages.filter(m => {
      const matchesStatus = filterStatus === 'all' || m.status === filterStatus;
      const matchesType = filterType === 'all' || m.msg_type === filterType;
      const matchesPriority = filterPriority === 'all' || m.priority === filterPriority;
      const matchesSearch = !q ||
        m.id.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        (m.body?.toLowerCase().includes(q) ?? false) ||
        (m.sender?.toLowerCase().includes(q) ?? false) ||
        (m.recipient?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesPriority && matchesSearch;
    });
  }, [messages, filterStatus, filterType, filterPriority, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (m: SecMessage) => {
    setEditing(m);
    setForm({
      msgType: m.msg_type,
      priority: m.priority,
      channel: m.channel,
      audience: m.audience,
      recipient: m.recipient || '',
      subject: m.subject,
      body: m.body || '',
      sender: m.sender || '',
      expiresAt: m.expires_at ? m.expires_at.slice(0, 16) : '',
    });
    setShowForm(true);
  };

  const saveMessage = async () => {
    if (!form.subject.trim()) {
      addNotification('Subject is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        msgType: form.msgType,
        priority: form.priority,
        channel: form.channel,
        audience: form.audience,
        recipient: form.recipient || null,
        subject: form.subject.trim(),
        body: form.body || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };
      if (editing) {
        const res = await updateSecMessage(editing.id, payload);
        setMessages(prev => prev.map(m => (m.id === editing.id ? { ...res.message, ack_count: m.ack_count } : m)));
        if (detail?.message.id === editing.id) loadDetail(editing.id);
        addNotification(`Message ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecMessage({
          propertyId: currentPropertyId,
          sender: form.sender || null,
          ...payload,
        });
        setMessages(prev => [{ ...created, ack_count: 0 }, ...prev]);
        addNotification(`Message sent — ${created.id}`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to send message', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchMessage = async (m: SecMessage, patch: Parameters<typeof updateSecMessage>[1], toast?: string) => {
    setActingOn(m.id);
    try {
      const res = await updateSecMessage(m.id, patch);
      setMessages(prev => prev.map(x => (x.id === m.id ? { ...res.message, ack_count: x.ack_count } : x)));
      if (detail?.message.id === m.id) loadDetail(m.id);
      addNotification(toast || `Message ${m.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitAck = async () => {
    if (!detail) return;
    if (!ackBy.trim()) {
      addNotification('Who is acknowledging?', 'warning', 'Security');
      return;
    }
    setActingOn(detail.message.id);
    try {
      await ackSecMessage(detail.message.id, { ackedBy: ackBy.trim(), note: ackNote.trim() || null });
      await Promise.all([loadDetail(detail.message.id), load()]);
      setAckBy('');
      setAckNote('');
      addNotification('Acknowledgement recorded', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Ack failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeMessage = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecMessage(deleteTarget.id);
      setMessages(prev => prev.filter(m => m.id !== deleteTarget.id));
      if (detail?.message.id === deleteTarget.id) setDetail(null);
      addNotification(`Message ${deleteTarget.id} removed`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Communication Center"
        subtitle="Security dispatch, internal messaging, and emergency broadcasts"
        icon={MessageSquare}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> New Message
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Messages" value={stats.total} icon={MessageSquare} tone="accent" />
        <StatCard title="Awaiting Ack" value={stats.awaitingAck} icon={Timer} tone="warning" />
        <StatCard title="Acknowledged" value={stats.acknowledged} icon={CheckCheck} tone="success" />
        <StatCard title="Emergency Active" value={stats.emergency} icon={Siren} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search subject, body, sender, recipient…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
              <option value="all">All Types</option>
              {MSG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Siren size={12} className="text-slate-400" />
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as any)} className={filterSelect}>
              <option value="all">All Priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Message feed */}
      <SectionCard title="Message Feed" subtitle="Message · Type · Priority · Channel · Audience · Acks" icon={MessageSquare} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Message', 'Type', 'Priority', 'Channel', 'Audience', 'Status', 'Acks', 'Sent', '']}
            rows={filtered.map(m => {
              const TypeIcon = TYPE_ICON[m.msg_type];
              return [
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${m.priority === 'Emergency' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                    <TypeIcon className={`w-4 h-4 ${m.priority === 'Emergency' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => openDetail(m)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{m.subject}</button>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {m.id} · {m.sender || 'System'}{m.recipient ? ` → ${m.recipient}` : ''}
                    </div>
                  </div>
                </div>,
                <Badge tone={TYPE_TONE[m.msg_type]}>{m.msg_type}</Badge>,
                <Badge tone={PRIORITY_TONE[m.priority]}>{m.priority}</Badge>,
                <span className="text-xs text-slate-500">{m.channel}</span>,
                <span className="text-xs text-slate-500 flex items-center gap-1"><Users size={11} className="text-slate-400" />{m.recipient || m.audience}</span>,
                <select
                  value={m.status}
                  onChange={e => patchMessage(m, { status: e.target.value as SecMessageStatus }, `Message ${m.id} → ${e.target.value}`)}
                  disabled={actingOn === m.id}
                  className={inlineStatusSelect}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                <span className={`text-xs font-mono font-bold ${((m.ack_count ?? 0) > 0) ? 'text-emerald-600' : 'text-slate-400'}`}>
                  <CheckCheck size={11} className="inline mr-0.5 -mt-0.5" />{m.ack_count ?? 0}
                </span>,
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock size={11} className="text-slate-400" />{fmtDateTime(m.sent_at)}
                  {isExpired(m) && <span className="text-red-500 font-semibold">· expired</span>}
                </span>,
                <div className="inline-flex gap-2">
                  <button onClick={() => openDetail(m)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => openEdit(m)} disabled={actingOn === m.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteTarget(m)} disabled={actingOn === m.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ];
            })}
            empty={filtered.length === 0}
            emptyColSpan={9}
          />
        )}
      </SectionCard>

      {/* Compose / edit modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveMessage}
        title={editing ? `Edit ${editing.id}` : 'New Message'}
        subtitle={editing ? editing.subject : 'Dispatch a message or broadcast to the security team'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Send Message'}
      >
        <div className="space-y-4">
          <Field label="Subject">
            <input className={inputClass} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g., Suspicious person — Level 2 parking" />
          </Field>
          <Field label="Message Body">
            <textarea className={inputClass + ' min-h-[88px]'} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Full message text — instructions, description, actions required…" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <select className={inputClass} value={form.msgType} onChange={e => setForm(f => ({ ...f, msgType: e.target.value as SecMessageType }))}>
                {MSG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as SecMessagePriority }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Channel">
              <select className={inputClass} value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value as SecMessageChannel }))}>
                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Audience">
              <select className={inputClass} value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value as SecMessageAudience }))}>
                {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Recipient (Custom / Dispatch target)">
              <input
                className={inputClass}
                list="sec-msg-recipients"
                value={form.recipient}
                onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))}
                placeholder="e.g., Patrol Unit 2"
              />
              <datalist id="sec-msg-recipients">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Sender">
              <input className={inputClass} value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} placeholder="Defaults to your account" />
            </Field>
          </div>
          <Field label="Expires At (optional)">
            <input type="datetime-local" className={inputClass} value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
          </Field>
        </div>
      </ModalSystem>

      {/* Message detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Message ${detail.message.id}` : 'Message Detail'}
        subtitle={detail ? `${detail.message.subject} · ${detail.message.msg_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.message.status]}>{detail.message.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Priority</p>
                <Badge tone={PRIORITY_TONE[detail.message.priority]}>{detail.message.priority}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Channel</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.message.channel}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Audience</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.message.recipient || detail.message.audience}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Sender</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.message.sender || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Sent</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.message.sent_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Expires</p>
                <p className={`text-slate-600 dark:text-slate-300 ${isExpired(detail.message) ? 'text-red-600 font-semibold' : ''}`}>
                  {detail.message.expires_at ? fmtDateTime(detail.message.expires_at) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Acks</p>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{detail.acks.length}</p>
              </div>
              {detail.message.body && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Message</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{detail.message.body}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {detail.message.status !== 'Recalled' && (
                <button onClick={() => patchMessage(detail.message, { status: 'Recalled' }, `Message ${detail.message.id} recalled`)} disabled={actingOn === detail.message.id} className={button.secondary + ' !text-[var(--color-danger)] disabled:opacity-50'}>
                  <Ban className="w-4 h-4" /> Recall
                </button>
              )}
              {detail.message.status === 'Recalled' && (
                <button onClick={() => patchMessage(detail.message, { status: 'Sent' }, `Message ${detail.message.id} re-sent`)} disabled={actingOn === detail.message.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Send className="w-4 h-4" /> Re-send
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.message); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.message)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Ack form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <CheckCheck className="w-4 h-4 text-[var(--color-accent-operations)]" /> Record Acknowledgement
              </h4>
              <div className="flex flex-wrap gap-2">
                <input
                  className={inputClass + ' !w-48'}
                  list="sec-msg-ackers"
                  value={ackBy}
                  onChange={e => setAckBy(e.target.value)}
                  placeholder="Acknowledged by"
                />
                <datalist id="sec-msg-ackers">
                  {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
                </datalist>
                <input
                  className={inputClass + ' flex-1 min-w-[200px]'}
                  value={ackNote}
                  onChange={e => setAckNote(e.target.value)}
                  placeholder="Optional note (e.g., ETA, on scene)…"
                />
                <button onClick={submitAck} disabled={actingOn === detail.message.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Ack
                </button>
              </div>
            </div>

            {/* Ack list */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-[var(--color-accent-operations)]" /> Acknowledgements ({detail.acks.length})
              </h4>
              <div className="space-y-0 max-h-56 overflow-y-auto">
                {detail.acks.map((a, idx) => (
                  <div key={a.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500" />
                      {idx < detail.acks.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <p className="text-sm text-slate-900 dark:text-white">{a.acked_by}{a.note ? ` — ${a.note}` : ''}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{fmtDateTime(a.created_at)}</p>
                    </div>
                  </div>
                ))}
                {detail.acks.length === 0 && <p className="text-xs text-slate-400">No acknowledgements yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeMessage}
        title="Delete Message"
        subtitle={deleteTarget ? `Permanently delete message ${deleteTarget.id} (${deleteTarget.subject}) and its acknowledgements?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default CommunicationCenter;
