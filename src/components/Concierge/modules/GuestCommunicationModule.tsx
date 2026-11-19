/**
 * Guest Communication Center Module
 * Manage guest messages — requests, bookings, inquiries, complaints.
 *
 * DB-integrated: reads/writes `guest_communications` via
 * /api/concierge/communications. Guest names resolve through the linked
 * reservation; replies mark the thread Resolved.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MessageSquare,
  RefreshCw,
  Send,
  CheckCircle2,
  Clock,
  ClipboardList,
  CalendarCheck,
  HelpCircle,
  AlertTriangle,
  Loader2,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface GuestCommunicationModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface Communication {
  id: string;
  guest_id?: string | null;
  guest_name?: string | null;
  reservation_id?: string | null;
  room_number?: string | null;
  message: string;
  message_type: string;
  status: string;
  reply?: string | null;
  created_at: string;
  replied_at?: string | null;
  replied_by?: string | null;
}

interface OverviewGuest {
  reservationId: string;
  name: string;
  roomNumber: string;
  guestId?: string;
}

const TYPE_META: Record<string, { icon: LucideIcon; tone: StatusTone; chip: string }> = {
  Request: { icon: ClipboardList, tone: 'info', chip: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
  Booking: { icon: CalendarCheck, tone: 'accent', chip: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
  Inquiry: { icon: HelpCircle, tone: 'neutral', chip: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300' },
  Complaint: { icon: AlertTriangle, tone: 'danger', chip: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300' },
  Other: { icon: MessageSquare, tone: 'neutral', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  'In Progress': 'accent',
  Resolved: 'success',
};

const MESSAGE_TYPES = ['Request', 'Booking', 'Inquiry', 'Complaint', 'Other'];

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const GuestCommunicationModule: React.FC<GuestCommunicationModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, userProfile } = useERP();
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ reservationId: '', messageType: 'Request', message: '' });

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
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      const [commsRes, overviewRes] = await Promise.all([
        conciergeFetch(`/api/concierge/communications?${params}`),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setCommunications(await parseJson(commsRes));
      const overview = await parseJson(overviewRes);
      const seen = new Set<string>();
      setGuests(
        [...(overview.inHouse || []), ...(overview.arriving || []), ...(overview.departing || [])]
          .map((g: any) => ({ reservationId: g.reservationId, name: g.name, roomNumber: g.roomNumber, guestId: g.id }))
          .filter((g: OverviewGuest) => {
            if (!g.reservationId || seen.has(g.reservationId)) return false;
            seen.add(g.reservationId);
            return true;
          })
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load communications');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const selected = communications.find((c) => c.id === selectedId) || null;

  const stats = useMemo(() => ({
    pending: communications.filter((c) => c.status === 'Pending').length,
    inProgress: communications.filter((c) => c.status === 'In Progress').length,
    resolved: communications.filter((c) => c.status === 'Resolved').length,
  }), [communications]);

  const handleReply = async () => {
    if (!selected || !replyText.trim()) return;
    try {
      setReplying(true);
      const response = await conciergeFetch(`/api/concierge/communications/${selected.id}/reply`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify({ reply: replyText.trim(), replied_by: userProfile?.name || 'Concierge' }),
      });
      await parseJson(response);
      setReplyText('');
      addNotification('Reply sent', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleCompose = async () => {
    const guest = guests.find((g) => g.reservationId === form.reservationId);
    if (!guest) {
      setFormError('Please select a guest');
      return;
    }
    if (!form.message.trim()) {
      setFormError('Message is required');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const response = await conciergeFetch('/api/concierge/communications', {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          guest_id: guest.guestId || null,
          reservation_id: guest.reservationId,
          room_number: guest.roomNumber,
          message: form.message.trim(),
          message_type: form.messageType,
        }),
      });
      await parseJson(response);
      setShowCompose(false);
      setForm({ reservationId: '', messageType: 'Request', message: '' });
      addNotification('Message logged', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to log message');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Communication Center"
        subtitle="Manage guest messages — requests, bookings, inquiries, and complaints"
        icon={MessageSquare}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => { setFormError(null); setShowCompose(true); }} className={button.primary}>
              <Plus size={16} />
              Log Message
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending" value={stats.pending} icon={Clock} tone="warning" caption="awaiting response" />
        <StatCard title="In Progress" value={stats.inProgress} icon={MessageSquare} tone="accent" />
        <StatCard title="Resolved" value={stats.resolved} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Messages" value={communications.length} icon={ClipboardList} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Compose form */}
      {showCompose && (
        <SectionCard title="Log Guest Message" subtitle="Record a message received by phone, in person, or app" icon={Plus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Guest</label>
              <select
                value={form.reservationId}
                onChange={(e) => setForm({ ...form, reservationId: e.target.value })}
                className={inputClass}
                disabled={loading}
              >
                <option value="">{loading ? 'Loading guests…' : 'Select guest…'}</option>
                {guests.map((g) => (
                  <option key={g.reservationId} value={g.reservationId}>
                    {g.name} — Room {g.roomNumber}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select
                value={form.messageType}
                onChange={(e) => setForm({ ...form, messageType: e.target.value })}
                className={inputClass}
              >
                {MESSAGE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Message</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className={inputClass}
                rows={3}
                placeholder="What did the guest ask for?"
              />
            </div>
          </div>
          {formError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={14} />
              {formError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCompose(false)} className={button.secondary}>
              Cancel
            </button>
            <button type="button" onClick={handleCompose} disabled={submitting} className={button.primary}>
              {submitting ? 'Saving…' : 'Log Message'}
            </button>
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Message list */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Messages"
            subtitle={`${communications.length} message${communications.length === 1 ? '' : 's'}`}
            icon={MessageSquare}
            tone="info"
            pad="none"
            actions={
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">All Status</option>
                <option value="Pending">Pending</option>
                <option value="In Progress">In Progress</option>
                <option value="Resolved">Resolved</option>
              </select>
            }
          >
            {loading && communications.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 size={22} className="animate-spin" />
              </div>
            ) : communications.length === 0 ? (
              <div className="py-12 text-center">
                <MessageSquare size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No messages found</p>
                <p className="mt-1 text-xs text-slate-400">Try a different status filter.</p>
              </div>
            ) : (
              <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700/60">
                {communications.map((comm) => {
                  const meta = TYPE_META[comm.message_type] || TYPE_META.Other;
                  const Icon = meta.icon;
                  const active = selectedId === comm.id;
                  return (
                    <button
                      key={comm.id}
                      type="button"
                      onClick={() => setSelectedId(comm.id)}
                      className={`flex w-full items-start gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        active ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                      }`}
                    >
                      <div className={`shrink-0 rounded-lg p-2.5 ${meta.chip}`}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {comm.guest_name || 'Unknown Guest'}
                          </span>
                          {comm.room_number && (
                            <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              Rm {comm.room_number}
                            </span>
                          )}
                          <Badge tone={STATUS_TONE[comm.status] || 'neutral'}>{comm.status}</Badge>
                        </div>
                        <p className="truncate text-sm text-slate-600 dark:text-slate-400">{comm.message}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {comm.message_type} · {timeAgo(comm.created_at)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Detail pane */}
        <SectionCard
          title={selected ? 'Message Details' : 'Select a Message'}
          subtitle={selected ? `${selected.message_type} · ${selected.status}` : 'Click a message to view'}
          icon={selected ? (TYPE_META[selected.message_type] || TYPE_META.Other).icon : MessageSquare}
          tone={selected ? (TYPE_META[selected.message_type] || TYPE_META.Other).tone : 'neutral'}
          pad="md"
        >
          {selected ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Guest</label>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => selected.guest_id && onViewGuestProfile?.(selected.guest_id)}
                    className={`text-sm font-medium ${selected.guest_id ? 'text-indigo-600 hover:underline dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    {selected.guest_name || 'Unknown Guest'}
                  </button>
                  {selected.room_number && (
                    <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      Rm {selected.room_number}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Message</label>
                <p className="mt-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {selected.message}
                </p>
                <p className="mt-1 text-xs text-slate-400">Received {timeAgo(selected.created_at)}</p>
              </div>
              {selected.reply && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Reply</label>
                  <p className="mt-1 rounded-lg bg-emerald-50 p-3 text-sm text-slate-700 dark:bg-emerald-900/20 dark:text-slate-300">
                    {selected.reply}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {selected.replied_by} · {timeAgo(selected.replied_at)}
                  </p>
                </div>
              )}
              {selected.status !== 'Resolved' && (
                <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Your Reply</label>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className={`${inputClass} mt-1`}
                    rows={3}
                    placeholder="Type your reply — resolves the thread…"
                  />
                  <button
                    type="button"
                    onClick={handleReply}
                    disabled={!replyText.trim() || replying}
                    className={`${button.primary} mt-2`}
                  >
                    <Send size={14} />
                    {replying ? 'Sending…' : 'Send Reply'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-10 text-center">
              <MessageSquare size={36} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Select a message to view details</p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default GuestCommunicationModule;
