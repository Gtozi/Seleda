/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Communication Center — driver messaging, dispatch notifications, guest comms.
 * DB-integrated via /api/transport/messages/* (transport_messages).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MessageSquare,
  Search,
  Plus,
  Phone,
  Mail,
  Bell,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Eye,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Message {
  id: string;
  message_number: string;
  type: string;
  from_party: string;
  to_party: string;
  subject: string | null;
  content: string | null;
  sent_at: string;
  status: string;
  priority: string;
  related_trip_id: string | null;
  transport_requests: { request_number: string; guest_name: string | null; status: string } | null;
}

interface Driver {
  id: string;
  status: string;
  employees: { name: string; phone: string | null } | null;
}

interface Trip { id: string; request_number: string; guest_name: string | null; status: string; }

const MESSAGE_TYPES = ['Driver Message', 'Guest Notification', 'Dispatch Notification', 'Emergency Alert'];
const PRIORITIES = ['Critical', 'High', 'Normal', 'Low'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';
const filterSelectCls = 'px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans w-auto';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function typeTone(type: string): StatusTone {
  switch (type) {
    case 'Driver Message': return 'info';
    case 'Guest Notification': return 'accent';
    case 'Dispatch Notification': return 'success';
    case 'Emergency Alert': return 'danger';
    default: return 'neutral';
  }
}

function priorityTone(priority: string): StatusTone {
  switch (priority) {
    case 'Critical': return 'danger';
    case 'High': return 'warning';
    case 'Normal': return 'info';
    case 'Low': return 'neutral';
    default: return 'neutral';
  }
}

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'Read': return 'success';
    case 'Delivered': return 'success';
    case 'Sent': return 'info';
    case 'Pending': return 'warning';
    case 'Failed': return 'danger';
    default: return 'neutral';
  }
}

function relativeTime(ts?: string | null): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const emptyForm = {
  type: 'Driver Message', from: 'Dispatch', to: '', subject: '', content: '',
  priority: 'Normal', relatedTripId: '',
};

const CommunicationCenter = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [messages, setMessages] = useState<Message[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showCompose, setShowCompose] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showCallDriver, setShowCallDriver] = useState(false);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [mRes, dRes, tRes] = await Promise.all([
        fetch(`/api/transport/messages/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/requests/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (mRes.ok) setMessages(((await mRes.json()) as { messages: Message[] }).messages || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (tRes.ok) setTrips(((await tRes.json()) as { requests: Trip[] }).requests || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = messages;
    if (typeFilter !== 'all') list = list.filter((m) => m.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) =>
        (m.subject || '').toLowerCase().includes(q) ||
        m.from_party.toLowerCase().includes(q) ||
        m.to_party.toLowerCase().includes(q) ||
        m.message_number.toLowerCase().includes(q));
    }
    return list;
  }, [messages, typeFilter, search]);

  const stats = useMemo(() => ({
    total: messages.length,
    notifications: messages.filter((m) => m.type === 'Guest Notification' || m.type === 'Dispatch Notification').length,
    emergency: messages.filter((m) => m.type === 'Emergency Alert').length,
    delivered: messages.filter((m) => m.status === 'Delivered' || m.status === 'Read').length,
  }), [messages]);

  const openCompose = (preset?: Partial<typeof emptyForm>) => {
    setForm({ ...emptyForm, ...preset });
    setShowCompose(true);
  };

  const handleSend = async () => {
    if (!currentPropertyId || !form.to.trim()) {
      addNotification('Recipient is required', 'warning', 'Transportation');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/transport/messages/', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          type: form.type,
          from: form.from || 'Dispatch',
          to: form.to,
          subject: form.subject || null,
          content: form.content || null,
          status: 'Sent',
          priority: form.priority,
          relatedTripId: form.relatedTripId || null,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(form.type === 'Emergency Alert' ? 'Emergency alert broadcast' : 'Message sent', 'success', 'Transportation');
      setShowCompose(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleMarkRead = async (m: Message) => {
    try {
      const res = await fetch(`/api/transport/messages/${m.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status: 'Read' }),
      });
      if (res.ok) fetchAll();
    } catch { /* non-fatal */ }
  };

  const handleView = (m: Message) => {
    setViewing(m);
    setShowView(true);
    if (m.status !== 'Read') handleMarkRead(m);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this message?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/messages/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Message deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Communication Center" subtitle="Driver messaging, dispatch notifications, and guest communications" icon={MessageSquare} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><MessageSquare className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view messages.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Communication Center"
        subtitle="Driver messaging, dispatch notifications, and guest communications"
        icon={MessageSquare}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openCompose()} className={button.primary}><Plus className="w-4 h-4" /> New Message</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Messages" value={String(stats.total)} icon={MessageSquare} tone="accent" />
        <StatCard title="Notifications Sent" value={String(stats.notifications)} icon={Bell} tone="info" />
        <StatCard title="Emergency Alerts" value={String(stats.emergency)} icon={AlertTriangle} tone="danger" />
        <StatCard title="Delivered / Read" value={String(stats.delivered)} icon={CheckCircle2} tone="success" />
      </div>

      {/* Quick Actions — functional */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button onClick={() => setShowCallDriver(true)} className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500 transition text-left">
          <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
            <Phone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Call Driver</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Direct voice communication</p>
          </div>
        </button>
        <button onClick={() => openCompose({ type: 'Guest Notification', from: 'System' })} className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500 transition text-left">
          <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
            <Mail className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Email Guest</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Send trip confirmation</p>
          </div>
        </button>
        <button onClick={() => openCompose({ type: 'Emergency Alert', to: 'All Drivers', priority: 'Critical', from: 'System' })} className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-500 transition text-left">
          <div className="p-2 bg-rose-100 dark:bg-rose-900 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Emergency Alert</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Broadcast to all drivers</p>
          </div>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            placeholder="Search messages..."
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={filterSelectCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          {MESSAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Messages */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Messages</h3></div>
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><MessageSquare className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No messages found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">From</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">To</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Subject</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Priority</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Time</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((m) => (
                  <tr key={m.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${m.status === 'Sent' || m.status === 'Delivered' ? 'font-medium' : ''}`}>
                    <td className="px-6 py-4"><Badge tone={typeTone(m.type)}>{m.type}</Badge></td>
                    <td className="px-6 py-4 text-sm text-slate-500">{m.from_party}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{m.to_party}</td>
                    <td className="px-6 py-4 text-sm text-slate-900 dark:text-white max-w-xs">
                      <span className="truncate block">{m.subject || '(no subject)'}</span>
                      {m.transport_requests && <span className="text-xs text-slate-400">{m.transport_requests.request_number}</span>}
                    </td>
                    <td className="px-6 py-4"><Badge tone={priorityTone(m.priority)}>{m.priority}</Badge></td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      <span className="flex items-center gap-1"><Clock size={12} />{relativeTime(m.sent_at)}</span>
                    </td>
                    <td className="px-6 py-4"><Badge tone={statusTone(m.status)}>{m.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => handleView(m)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(m.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Compose Modal */}
      <ModalSystem
        isOpen={showCompose}
        onClose={() => setShowCompose(false)}
        onConfirm={handleSend}
        title={form.type === 'Emergency Alert' ? 'Broadcast Emergency Alert' : 'New Message'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Sending…' : (form.type === 'Emergency Alert' ? 'Broadcast' : 'Send')}
        confirmColor={form.type === 'Emergency Alert' ? 'rose' : 'indigo'}
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {MESSAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="From"><input className={inputCls} value={form.from} onChange={(e) => setForm(f => ({ ...f, from: e.target.value }))} /></Field>
          <Field label="To">
            <input className={inputCls} list="comm-recipients" value={form.to} onChange={(e) => setForm(f => ({ ...f, to: e.target.value }))} placeholder="e.g. Dispatch / All Drivers / guest" />
            <datalist id="comm-recipients">
              <option value="Dispatch" />
              <option value="All Drivers" />
              {drivers.map((d) => <option key={d.id} value={`${d.employees?.name || 'Driver'} (Driver)`} />)}
            </datalist>
          </Field>
          <Field label="Related Trip">
            <select className={inputCls} value={form.relatedTripId} onChange={(e) => setForm(f => ({ ...f, relatedTripId: e.target.value }))}>
              <option value="">None</option>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.request_number} · {t.guest_name || 'Guest'}</option>)}
            </select>
          </Field>
          <Field label="Subject"><input className={inputCls} value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} /></Field>
          <label className="col-span-2 block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Message</span>
            <textarea className={inputCls} rows={4} value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))} />
          </label>
        </div>
      </ModalSystem>

      {/* Call Driver Modal */}
      <ModalSystem
        isOpen={showCallDriver}
        onClose={() => setShowCallDriver(false)}
        title="Call Driver"
        variant="info"
        size="md"
      >
        <div className="space-y-2">
          {drivers.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No drivers on record.</p>
          ) : drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{d.employees?.name || 'Driver'}</p>
                <p className="text-xs text-slate-500">{d.status} · {d.employees?.phone || 'No phone'}</p>
              </div>
              {d.employees?.phone && (
                <a href={`tel:${d.employees.phone}`} className={button.secondary}><Phone size={14} /> Call</a>
              )}
            </div>
          ))}
        </div>
      </ModalSystem>

      {/* View Modal */}
      <ModalSystem
        isOpen={showView}
        onClose={() => setShowView(false)}
        title={viewing?.subject || viewing?.message_number || 'Message'}
        variant="info"
        size="md"
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={typeTone(viewing.type)}>{viewing.type}</Badge>
              <Badge tone={priorityTone(viewing.priority)}>{viewing.priority}</Badge>
              <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">From</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.from_party}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">To</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.to_party}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Sent</p>
                <p className="font-medium text-slate-900 dark:text-white">{new Date(viewing.sent_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Related Trip</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.transport_requests?.request_number || '—'}</p>
              </div>
            </div>
            {viewing.content && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{viewing.content}</div>
            )}
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default CommunicationCenter;
