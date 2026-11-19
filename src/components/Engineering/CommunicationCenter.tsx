import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  MessageSquare,
  Search,
  Plus,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  ChevronRight,
  Send,
  FileText,
  Users,
  Wrench,
  Zap,
  Droplets,
  Flame,
  Loader2,
  ServerCrash,
  MoreVertical,
  Trash2,
  ArrowRight,
  Archive,
  XCircle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchCommunicationMessages,
  createCommunicationMessage,
  updateCommunicationMessage,
  deleteCommunicationMessage,
  fetchCommunicationNotifications,
  createCommunicationNotification,
  updateCommunicationNotification,
  deleteCommunicationNotification,
  type CommunicationMessage,
  type CommunicationNotification,
  type CommunicationMessageType,
  type CommunicationCategory,
  type CommunicationMessageStatus,
  type CommunicationPriority,
  type CommunicationNotificationType,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────

const ALL_TYPES: CommunicationMessageType[] = ['Announcement', 'Alert', 'Request', 'Update', 'Reminder'];
const ALL_STATUSES: CommunicationMessageStatus[] = ['Sent', 'Read', 'Archived'];
const ALL_CATEGORIES: CommunicationCategory[] = ['General', 'Safety', 'Maintenance', 'Emergency', 'Compliance'];
const ALL_PRIORITIES: CommunicationPriority[] = ['Critical', 'High', 'Normal', 'Low'];
const ALL_NOTIF_TYPES: CommunicationNotificationType[] = ['System', 'Work Order', 'Alert', 'Request'];

const TYPE_ICON: Record<CommunicationMessageType, LucideIcon> = {
  Announcement: Bell,
  Alert: AlertTriangle,
  Request: MessageSquare,
  Update: FileText,
  Reminder: Clock,
};

const CATEGORY_ICON: Record<CommunicationCategory, LucideIcon> = {
  General: Users,
  Safety: Flame,
  Maintenance: Wrench,
  Emergency: AlertTriangle,
  Compliance: CheckCircle2,
};

const STATUS_TONE: Record<CommunicationMessageStatus, StatusTone> = {
  Sent: 'info',
  Read: 'success',
  Archived: 'neutral',
};

const PRIORITY_TONE: Record<CommunicationPriority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

const NOTIF_TYPE_TONE: Record<CommunicationNotificationType, StatusTone> = {
  System: 'neutral',
  'Work Order': 'info',
  Alert: 'danger',
  Request: 'warning',
};

const SENDER_OPTIONS = [
  'Engineering Manager',
  'John Electrician',
  'Maria HVAC',
  'Safety Officer',
  'General Maintenance Team',
] as const;

const RECIPIENT_OPTIONS = [
  'Engineering Team',
  'All Engineering Staff',
  'Management',
  'Security',
  'Procurement',
  'Elevator Maintenance Team',
] as const;

// ── Field helper ─────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDateTime(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────────

const CommunicationCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [notifications, setNotifications] = useState<CommunicationNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<'All' | CommunicationMessageType>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | CommunicationMessageStatus>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    type: CommunicationMessageType;
    category: CommunicationCategory;
    title: string;
    content: string;
    sender: string;
    senderRole: string;
    recipients: string[];
    priority: CommunicationPriority;
  }>({
    type: 'Announcement',
    category: 'General',
    title: '',
    content: '',
    sender: SENDER_OPTIONS[0],
    senderRole: '',
    recipients: ['Engineering Team'],
    priority: 'Normal',
  });

  const [detail, setDetail] = useState<CommunicationMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [notifMenuOpen, setNotifMenuOpen] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCommunicationMessages({
        propertyId: currentPropertyId || undefined,
      });
      setMessages(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const data = await fetchCommunicationNotifications({
        propertyId: currentPropertyId || undefined,
      });
      setNotifications(data);
    } catch {
      // Sidebar notifications are non-blocking — leave list as-is.
    } finally {
      setNotifLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); loadNotifications(); }, [load, loadNotifications]);

  // ── Derived list ───────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      messages.filter(m => {
        const matchesType = typeFilter === 'All' || m.type === typeFilter;
        const matchesStatus = statusFilter === 'All' || m.status === statusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          m.msg_number.toLowerCase().includes(q) ||
          m.title.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.sender.toLowerCase().includes(q) ||
          (m.sender_role || '').toLowerCase().includes(q) ||
          m.recipients.some(r => r.toLowerCase().includes(q));
        return matchesType && matchesStatus && matchesSearch;
      }),
    [messages, typeFilter, statusFilter, search]
  );

  const totals = {
    count: messages.length,
    critical: messages.filter(m => m.priority === 'Critical').length,
    unread: notifications.filter(n => !n.read).length,
    read: messages.filter(m => m.status === 'Read').length,
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.title.trim() || !form.content.trim() || !form.sender.trim()) return;
    setSubmitting(true);
    try {
      const created = await createCommunicationMessage({
        propertyId: currentPropertyId || undefined,
        type: form.type,
        category: form.category,
        title: form.title.trim(),
        content: form.content.trim(),
        sender: form.sender.trim(),
        senderRole: form.senderRole.trim() || undefined,
        recipients: form.recipients,
        priority: form.priority,
      });
      setMessages(prev => [created, ...prev]);
      addNotification(`Message ${created.msg_number} sent: ${created.title}.`, 'task', 'Maintenance');
      setShowForm(false);
      setForm({
        type: 'Announcement', category: 'General', title: '', content: '',
        sender: SENDER_OPTIONS[0], senderRole: '', recipients: ['Engineering Team'], priority: 'Normal',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to send message', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: CommunicationMessageStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { message } = await updateCommunicationMessage(id, { status });
      setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...message } : m)));
      if (detail?.id === id) setDetail({ ...detail, ...message });
      addNotification(`Message ${message.msg_number} marked ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeMessage = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteCommunicationMessage(id);
      setMessages(prev => prev.filter(m => m.id !== id));
      if (detail?.id === id) setDetail(null);
      addNotification('Message deleted.', 'warning', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete message', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const toggleNotifRead = async (n: CommunicationNotification) => {
    setNotifMenuOpen(null);
    try {
      const { notification } = await updateCommunicationNotification(n.id, { read: !n.read });
      setNotifications(prev => prev.map(x => (x.id === n.id ? { ...x, ...notification } : x)));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update notification', 'warning', 'Maintenance');
    }
  };

  const removeNotif = async (id: string) => {
    setNotifMenuOpen(null);
    try {
      await deleteCommunicationNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete notification', 'warning', 'Maintenance');
    }
  };

  const quickCompose = (type: CommunicationMessageType, category: CommunicationCategory, priority: CommunicationPriority) => {
    setForm(f => ({ ...f, type, category, priority }));
    setShowForm(true);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Communication Center"
        subtitle="Internal messaging, announcements, and notifications."
        icon={MessageSquare}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { load(); loadNotifications(); }} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Message
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Messages" value={totals.count} icon={MessageSquare} tone="accent" />
        <StatCard title="Critical" value={totals.critical} icon={AlertTriangle} tone="danger" />
        <StatCard title="Unread Alerts" value={totals.unread} icon={Bell} tone="warning" />
        <StatCard title="Read" value={totals.read} icon={CheckCircle2} tone="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Main column */}
        <div className="lg:col-span-8 space-y-4">
          {/* Type quick filter */}
          <SectionCard title="Message Types" subtitle="Click to filter by message type" pad="md">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {(['All' as const, ...ALL_TYPES] as const).map(t => {
                const Icon = t === 'All' ? MessageSquare : TYPE_ICON[t];
                const active = typeFilter === t;
                const count = t === 'All' ? messages.length : messages.filter(m => m.type === t).length;
                return (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(typeFilter === t ? 'All' : (t as CommunicationMessageType | 'All'))}
                    className={[
                      'p-2.5 rounded-xl border text-center smooth-transition',
                      active
                        ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                        : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50',
                    ].join(' ')}
                  >
                    <Icon className="w-4 h-4 mx-auto text-[var(--color-accent-operations)] mb-1" />
                    <p className="text-[9px] font-bold uppercase leading-tight text-gray-700 dark:text-gray-300">{t}</p>
                    {count > 0 && <span className="block text-[10px] font-bold text-gray-500 mt-1">{count}</span>}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {/* Status filter + search */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
                {(['All', ...ALL_STATUSES] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={[
                      'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                      statusFilter === f
                        ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-700',
                    ].join(' ')}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  placeholder="Search title, sender, recipient…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                />
              </div>
            </div>
          </SectionCard>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
              <ServerCrash className="w-4 h-4 shrink-0" /> {error}
              <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
            </div>
          )}

          {/* Messages list */}
          <SectionCard
            title="Messages"
            subtitle={loading ? 'Loading…' : `${filtered.length} matching message${filtered.length === 1 ? '' : 's'}`}
            pad="none"
            bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
          >
            {loading && (
              <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading messages…
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                {messages.length === 0 ? 'No messages yet. Use “New Message” to send one.' : 'No messages match the filters.'}
              </div>
            )}

            {!loading && !error && filtered.map(m => {
              const TypeIcon = TYPE_ICON[m.type];
              const CategoryIcon = CATEGORY_ICON[m.category];
              return (
                <div
                  key={m.id}
                  className="p-4 hover:bg-gray-50 dark:hover:bg-slate-800/40 smooth-transition group"
                >
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="space-y-3 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-gray-400 group-hover:text-[var(--color-accent-operations)] transition-colors uppercase tracking-widest">{m.msg_number}</span>
                        <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                        <Badge tone={PRIORITY_TONE[m.priority]}>{m.priority}</Badge>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full text-[9px] font-bold uppercase tracking-tight">
                          <TypeIcon className="w-3 h-3" /> {m.type}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-sans font-extrabold text-gray-900 dark:text-white leading-tight">{m.title}</h4>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500">
                            <CategoryIcon className="w-3 h-3 text-[var(--color-accent-operations)]" />
                            {m.category}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500">
                            <User className="w-3 h-3 text-[var(--color-accent-operations)]" />
                            {m.sender}{m.sender_role ? ` · ${m.sender_role}` : ''}
                          </div>
                          {m.attachments > 0 && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500">
                              <FileText className="w-3 h-3 text-[var(--color-accent-operations)]" />
                              {m.attachments} attachment{m.attachments > 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      </div>

                      <p className="text-[11px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">{m.content}</p>

                      <div className="flex flex-wrap gap-2">
                        {m.recipients.slice(0, 3).map((r, i) => (
                          <span key={i} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[9px] font-bold text-gray-600 dark:text-gray-400">
                            {r}
                          </span>
                        ))}
                        {m.recipients.length > 3 && (
                          <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[9px] font-bold text-gray-600 dark:text-gray-400">
                            +{m.recipients.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-row md:flex-col justify-between items-end gap-2 border-t md:border-t-0 md:border-l border-gray-100 dark:border-slate-700 md:pl-4 pt-3 md:pt-0">
                      <div className="space-y-2">
                        <div>
                          <span className="text-[9px] font-bold text-gray-400 uppercase block tracking-tight leading-none">Sent</span>
                          <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 block">{fmtDateTime(m.created_at)}</span>
                        </div>
                      </div>

                      <div className="relative">
                        <button
                          onClick={() => setMenuOpen(menuOpen === m.id ? null : m.id)}
                          className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-gray-400 hover:bg-indigo-50 hover:text-[var(--color-accent-operations)] transition"
                        >
                          {actingOn === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                        </button>
                        {menuOpen === m.id && (
                          <div
                            className="absolute right-0 mt-1 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-10 py-1"
                            onMouseLeave={() => setMenuOpen(null)}
                          >
                            <button
                              onClick={() => { setDetail(m); setMenuOpen(null); }}
                              className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                            >
                              <ChevronRight className="w-3.5 h-3.5" /> View Details
                            </button>
                            {m.status !== 'Read' && (
                              <button
                                onClick={() => changeStatus(m.id, 'Read')}
                                className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> Mark Read
                              </button>
                            )}
                            {m.status !== 'Archived' && (
                              <button
                                onClick={() => changeStatus(m.id, 'Archived')}
                                className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                              >
                                <Archive className="w-3.5 h-3.5" /> Archive
                              </button>
                            )}
                            {m.status === 'Archived' && (
                              <button
                                onClick={() => changeStatus(m.id, 'Sent')}
                                className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                              >
                                <ArrowRight className="w-3.5 h-3.5" /> Restore
                              </button>
                            )}
                            <button
                              onClick={() => removeMessage(m.id)}
                              className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </SectionCard>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          {/* Notifications */}
          <div className="bg-slate-900 dark:bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-sm font-extrabold text-white leading-tight">Notifications</h3>
              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mt-0.5">
                {notifLoading ? 'Loading…' : `${notifications.filter(n => !n.read).length} unread`}
              </p>
            </div>
            <div className="divide-y divide-white/10">
              {notifLoading && (
                <div className="p-6 flex items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading notifications…
                </div>
              )}
              {!notifLoading && notifications.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-400">No notifications.</div>
              )}
              {!notifLoading && notifications.map(n => {
              const tone = NOTIF_TYPE_TONE[n.type];
              const toneCls =
                tone === 'danger' ? 'bg-rose-500/20 text-rose-400'
                : tone === 'warning' ? 'bg-amber-500/20 text-amber-400'
                : tone === 'info' ? 'bg-indigo-500/20 text-indigo-400'
                : 'bg-slate-500/20 text-slate-400';
              return (
                <div
                  key={n.id}
                  className={`p-3 ${n.read ? 'bg-white/5' : 'bg-white/10'} group relative`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${n.read ? 'bg-slate-500/20 text-slate-400' : toneCls}`}>
                      <Bell className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-white block truncate">{n.title}</span>
                        <span className="text-[8px] font-bold text-slate-500 uppercase">{n.type}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{n.message}</p>
                      <span className="text-[9px] font-bold text-slate-500 mt-1 block">{fmtRelative(n.created_at)}</span>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setNotifMenuOpen(notifMenuOpen === n.id ? null : n.id)}
                        className="p-1 rounded-lg text-slate-500 hover:text-white"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {notifMenuOpen === n.id && (
                        <div
                          className="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-10 py-1"
                          onMouseLeave={() => setNotifMenuOpen(null)}
                        >
                          <button
                            onClick={() => toggleNotifRead(n)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                          >
                            {n.read ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            {n.read ? 'Mark Unread' : 'Mark Read'}
                          </button>
                          <button
                            onClick={() => removeNotif(n.id)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          </div>

          {/* Quick Actions */}
          <SectionCard title="Quick Actions" subtitle="Common communications" pad="md">
            <div className="space-y-2">
              <button
                onClick={() => quickCompose('Announcement', 'General', 'Normal')}
                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left"
              >
                <Send className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <div>
                  <span className="text-[11px] font-bold text-gray-900 dark:text-white block">Send Announcement</span>
                  <span className="text-[9px] text-gray-500 font-medium">Broadcast to team</span>
                </div>
              </button>
              <button
                onClick={() => quickCompose('Alert', 'Emergency', 'Critical')}
                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left"
              >
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <div>
                  <span className="text-[11px] font-bold text-gray-900 dark:text-white block">Send Alert</span>
                  <span className="text-[9px] text-gray-500 font-medium">Emergency notification</span>
                </div>
              </button>
              <button
                onClick={() => quickCompose('Request', 'Maintenance', 'High')}
                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-left"
              >
                <Users className="w-4 h-4 text-emerald-500" />
                <div>
                  <span className="text-[11px] font-bold text-gray-900 dark:text-white block">Team Request</span>
                  <span className="text-[9px] text-gray-500 font-medium">Direct communication</span>
                </div>
              </button>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* New Message modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="New Message"
        subtitle="Compose an announcement, alert, request, update, or reminder."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Sending…' : 'Send Message'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as CommunicationMessageType }))}
                className={inputClass}
              >
                {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as CommunicationCategory }))}
                className={inputClass}
              >
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Title">
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Generator Maintenance Required"
              className={inputClass}
            />
          </Field>

          <Field label="Content">
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Message body…"
              rows={4}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Sender">
              <select
                value={form.sender}
                onChange={e => setForm(f => ({ ...f, sender: e.target.value }))}
                className={inputClass}
              >
                {SENDER_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Sender Role">
              <input
                value={form.senderRole}
                onChange={e => setForm(f => ({ ...f, senderRole: e.target.value }))}
                placeholder="e.g. Department Head"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as CommunicationPriority }))}
                className={inputClass}
              >
                {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Recipients">
              <div className="flex flex-wrap gap-2">
                {RECIPIENT_OPTIONS.map(r => {
                  const selected = form.recipients.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        recipients: selected ? f.recipients.filter(x => x !== r) : [...f.recipients, r],
                      }))}
                      className={[
                        'px-2 py-1 rounded-lg text-[10px] font-bold border transition',
                        selected
                          ? 'bg-[var(--color-accent-operations)]/10 border-[var(--color-accent-operations)] text-[var(--color-accent-operations)]'
                          : 'border-gray-200 dark:border-slate-700 text-gray-500 hover:border-[var(--color-accent-operations)]/50',
                      ].join(' ')}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || 'Message'}
        subtitle={detail ? `${detail.msg_number} · ${detail.type} · ${detail.category}` : ''}
        variant="form"
        size="lg"
        showFooter
        confirmLabel="Close"
        cancelLabel={detail && detail.status !== 'Archived' ? 'Archive' : 'Close'}
        confirmColor="indigo"
        onConfirm={() => setDetail(null)}
        onCancel={() => { if (detail && detail.status !== 'Archived') changeStatus(detail.id, 'Archived'); else setDetail(null); }}
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <Badge tone={PRIORITY_TONE[detail.priority]}>{detail.priority}</Badge>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full text-[9px] font-bold uppercase tracking-tight">
                {TYPE_ICON[detail.type] && (() => { const I = TYPE_ICON[detail.type]; return <I className="w-3 h-3" />; })()}
                {detail.type}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide">Sender</span>
                <span className="font-bold text-gray-900 dark:text-white">{detail.sender}</span>
                {detail.sender_role && <span className="block text-gray-500">{detail.sender_role}</span>}
              </div>
              <div>
                <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide">Sent</span>
                <span className="font-bold text-gray-900 dark:text-white">{fmtDateTime(detail.created_at)}</span>
                {detail.read_at && <span className="block text-gray-500">Read {fmtDateTime(detail.read_at)}</span>}
                {detail.archived_at && <span className="block text-gray-500">Archived {fmtDateTime(detail.archived_at)}</span>}
              </div>
            </div>

            <div>
              <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Content</span>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{detail.content}</p>
            </div>

            <div>
              <span className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Recipients</span>
              <div className="flex flex-wrap gap-2">
                {detail.recipients.map((r, i) => (
                  <span key={i} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[10px] font-bold text-gray-600 dark:text-gray-400">
                    {r}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {detail.status !== 'Read' && (
                <button onClick={() => changeStatus(detail.id, 'Read')} className={button.secondary}>
                  <CheckCircle2 className="w-4 h-4" /> Mark Read
                </button>
              )}
              {detail.status !== 'Archived' && (
                <button onClick={() => changeStatus(detail.id, 'Archived')} className={button.secondary}>
                  <Archive className="w-4 h-4" /> Archive
                </button>
              )}
              {detail.status === 'Archived' && (
                <button onClick={() => changeStatus(detail.id, 'Sent')} className={button.secondary}>
                  <ArrowRight className="w-4 h-4" /> Restore
                </button>
              )}
              <button
                onClick={() => { removeMessage(detail.id); }}
                className={button.ghost + ' text-red-600 dark:text-red-400 hover:text-red-700'}
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default CommunicationCenter;
