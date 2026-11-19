/**
 * Operational Communication Center — Operations Portal (/erp/operations/communication).
 *
 * Unified live feed across every portal's messaging tables — Front Office
 * `communications`, HK `housekeeping_communication_messages`, Engineering
 * `eng_communication_messages`, Security `sec_messages`, F&B
 * `fb_kitchen_messages`, and system `notifications`. Outbound broadcasts /
 * department messages write to the shared `communications` table and the
 * notification bell.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MessageSquare,
  Megaphone,
  Send,
  Bell,
  Search,
  Users,
  Clock,
  RefreshCw,
  Loader2,
  AlertTriangle,
  MailOpen,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsCommunication,
  sendOpsMessage,
  markCommRead,
  type CommMessage,
  type CommSource,
} from '../../../services/operationsService';

type Tab = 'all' | 'chat' | 'broadcast' | 'department';

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'all', label: 'All', icon: MessageSquare },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'broadcast', label: 'Broadcasts', icon: Megaphone },
  { id: 'department', label: 'Department', icon: Users },
];

const SOURCE_META: Record<CommSource, { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent' }> = {
  'front-office': { label: 'Front Office', tone: 'info' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  engineering: { label: 'Engineering', tone: 'warning' },
  security: { label: 'Security', tone: 'danger' },
  'f&b': { label: 'F&B', tone: 'success' },
  system: { label: 'System', tone: 'neutral' },
};

const priorityTone = (p?: string): 'danger' | 'warning' | 'neutral' =>
  p === 'urgent' || p === 'high' ? 'danger' : p === 'medium' ? 'warning' : 'neutral';

const DEPARTMENT_TARGETS = ['Front Office', 'Housekeeping', 'Engineering', 'Security', 'F&B', 'Spa', 'Transportation', 'Finance', 'HR'];

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const OperationalCommunicationCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [messages, setMessages] = useState<CommMessage[]>([]);
  const [stats, setStats] = useState({ total: 0, unread: 0, broadcasts: 0, today: 0, sources: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | CommSource>('all');
  const [query, setQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm] = useState({ type: 'broadcast' as 'broadcast' | 'department' | 'message', to: 'Front Office', subject: '', content: '', priority: 'medium' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await fetchOpsCommunication(currentPropertyId);
      setMessages(d.messages);
      setStats(d.stats);
    } catch (e: any) {
      setError(e?.message || 'Failed to load communications');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const filtered = useMemo(() => messages.filter((m) => {
    if (activeTab !== 'all' && m.type !== activeTab) return false;
    if (sourceFilter !== 'all' && m.source !== sourceFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (![m.from, m.to, m.subject, m.content].some((v) => v?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [messages, activeTab, sourceFilter, query]);

  const act = async (key: string, fn: () => Promise<any>, note?: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      if (note) addNotification(note, 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Action failed', 'error', 'Executive');
    } finally {
      setBusy(null);
    }
  };

  const submitSend = () => {
    if (!form.content.trim()) return;
    act('send', async () => {
      await sendOpsMessage({
        propertyId: currentPropertyId,
        type: form.type,
        to: form.type === 'department' ? form.to : form.type === 'message' ? form.to : undefined,
        subject: form.subject || undefined,
        content: form.content.trim(),
        priority: form.priority,
      });
      setForm({ ...form, subject: '', content: '' });
      setShowCompose(false);
    }, 'Message sent.');
  };

  const markRead = (m: CommMessage) => {
    if (m.read) return;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, read: true } : x)));
    markCommRead(m.source, m.id).catch(() => load());
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={MessageSquare}
        title="Operational Communication Center"
        subtitle="Unified message feed across Front Office, Housekeeping, Engineering, Security, F&B and system notifications"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.primary} onClick={() => setShowCompose(!showCompose)}>
              <Send size={16} /> Compose
            </button>
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Messages Today" icon={Clock} tone="accent" value={stats.today} caption={`${stats.total} in feed`} />
        <StatCard title="Unread" icon={Bell} tone="warning" value={stats.unread} />
        <StatCard title="Broadcasts" icon={Megaphone} tone="info" value={stats.broadcasts} />
        <StatCard title="Active Sources" icon={Users} tone="success" value={stats.sources} caption="portals contributing" />
      </div>

      {/* Compose */}
      {showCompose && (
        <SectionCard title="Compose Message" subtitle="Writes to the shared communications table; broadcasts and department sends also ring the notification bell" icon={Send} pad="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
                <option value="broadcast">Broadcast — all departments</option>
                <option value="department">Department message</option>
                <option value="message">Direct message</option>
              </select>
              {form.type !== 'broadcast' && (
                form.type === 'department' ? (
                  <select className={inputCls} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                    {DEPARTMENT_TARGETS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                ) : (
                  <input className={inputCls} placeholder="Recipient" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
                )
              )}
              <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
                <option value="urgent">Urgent</option>
              </select>
              <input className={inputCls} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <textarea className={`${inputCls} min-h-[72px]`} placeholder="Message content *" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            <div className="flex gap-2">
              <button className={button.primary} onClick={submitSend} disabled={busy === 'send' || !form.content.trim()}>
                {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
              </button>
              <button className={button.secondary} onClick={() => setShowCompose(false)}>Cancel</button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Feed */}
      <SectionCard
        title="Message Feed"
        subtitle={`${filtered.length} messages`}
        icon={MessageSquare}
        pad="md"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === t.id ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                  }`}>
                  <t.icon size={13} /> {t.label}
                </button>
              ))}
            </div>
            <select className={inputCls} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as any)}>
              <option value="all">All sources</option>
              {Object.entries(SOURCE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <Search size={14} className="text-slate-400" />
              <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)}
                className="bg-transparent outline-none text-sm w-32 text-slate-900 dark:text-white placeholder:text-slate-400" />
            </div>
          </div>
        }
      >
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={20} className="animate-spin" /> Loading messages…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No messages match the current filters.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((m) => (
              <div key={`${m.source}-${m.id}`}
                className={`p-3 rounded-lg border transition-colors ${
                  m.read
                    ? 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                    : 'border-[var(--color-accent-operations)]/40 bg-[var(--color-accent-operations)]/5'
                }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">{m.from}</span>
                      <span className="text-xs text-slate-400">→ {m.to}</span>
                      <Badge tone={SOURCE_META[m.source]?.tone || 'neutral'}>{SOURCE_META[m.source]?.label || m.source}</Badge>
                      <Badge tone={m.type === 'broadcast' ? 'info' : m.type === 'department' ? 'accent' : 'neutral'}>{m.type}</Badge>
                      {m.priority && m.priority !== 'medium' && m.priority !== 'low' && (
                        <Badge tone={priorityTone(m.priority)}>{m.priority}</Badge>
                      )}
                    </div>
                    {m.subject && <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-1">{m.subject}</p>}
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{m.content}</p>
                    <p className="text-xs text-slate-400 mt-1">{m.sentAt ? new Date(m.sentAt).toLocaleString() : ''}{m.channel ? ` · ${m.channel}` : ''}</p>
                  </div>
                  {!m.read && (
                    <button className={button.ghost} title="Mark read" disabled={busy === `r-${m.id}`}
                      onClick={() => markRead(m)}>
                      <MailOpen size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default OperationalCommunicationCenter;
