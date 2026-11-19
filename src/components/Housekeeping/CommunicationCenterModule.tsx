/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Communication Center module — docs/Housekeeping Portal new.md §22.
 * Internal Chat, Task Notifications, Escalations, Shift Announcements,
 * Guest Service Notifications.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/communication.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  MessageSquare,
  Bell,
  AlertTriangle,
  Megaphone,
  ConciergeBell,
  Send,
  Search,
  Loader2,
  ServerCrash,
  CheckCheck,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type Channel = 'Internal Chat' | 'Task Notifications' | 'Escalations' | 'Shift Announcements' | 'Guest Service Notifications';

interface Message {
  id: string;
  channel: Channel;
  from: string;
  text: string;
  timestamp: string;
  unread: boolean;
}

const CHANNEL_META: Record<Channel, { icon: LucideIcon; tone: StatusTone }> = {
  'Internal Chat': { icon: MessageSquare, tone: 'info' },
  'Task Notifications': { icon: Bell, tone: 'info' },
  'Escalations': { icon: AlertTriangle, tone: 'danger' },
  'Shift Announcements': { icon: Megaphone, tone: 'warning' },
  'Guest Service Notifications': { icon: ConciergeBell, tone: 'accent' },
};

const ALL_CHANNELS = Object.keys(CHANNEL_META) as Channel[];

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function CommunicationCenterModule() {
  const { currentPropertyId, addNotification } = useERP();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const [activeChannel, setActiveChannel] = useState<Channel>('Internal Chat');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');

  const fetchMessages = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/communication/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const filtered = useMemo(
    () =>
      messages.filter(m => {
        const matchesChannel = m.channel === activeChannel;
        const matchesSearch =
          m.text.toLowerCase().includes(search.toLowerCase()) ||
          m.from.toLowerCase().includes(search.toLowerCase());
        return matchesChannel && matchesSearch;
      }),
    [messages, activeChannel, search]
  );

  const unreadByChannel = useMemo(() => {
    const map = {} as Record<Channel, number>;
    ALL_CHANNELS.forEach(c => (map[c] = 0));
    messages.forEach(m => { if (m.unread) map[m.channel] += 1; });
    return map;
  }, [messages]);

  const send = async () => {
    if (!draft.trim() || !currentPropertyId) return;
    setSending(true);
    try {
      const res = await fetch('/api/hk-portal/communication', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          channel: activeChannel,
          from: 'You',
          text: draft.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to send message (${res.status})`);
      }
      const created = (await res.json()) as Message;
      setMessages(prev => [created, ...prev]);
      addNotification(`Message sent to ${activeChannel}.`, 'task', 'Housekeeping');
      setDraft('');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to send message', 'error', 'Housekeeping');
    } finally {
      setSending(false);
    }
  };

  const markRead = async (id: string) => {
    // Optimistic update
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, unread: false } : m)));
    try {
      await fetch(`/api/hk-portal/communication/${id}/read`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
    } catch {
      // Revert on failure
      setMessages(prev => prev.map(m => (m.id === id ? { ...m, unread: true } : m)));
    }
  };

  const markAllRead = async () => {
    if (!currentPropertyId) return;
    setMarkingAll(true);
    const previous = messages;
    // Optimistic update for the active channel
    setMessages(prev => prev.map(m => (m.channel === activeChannel ? { ...m, unread: false } : m)));
    try {
      const res = await fetch(`/api/hk-portal/communication/${currentPropertyId}/read-all`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ channel: activeChannel }),
      });
      if (!res.ok) throw new Error(`Failed to mark all read (${res.status})`);
      addNotification(`All messages in ${activeChannel} marked as read.`, 'task', 'Housekeeping');
    } catch (e: any) {
      // Revert
      setMessages(previous);
      addNotification(e?.message || 'Failed to mark all read', 'error', 'Housekeeping');
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Communication Center"
        subtitle="Internal chat, notifications, escalations & announcements."
        icon={MessageSquare}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Channel list */}
        <div className="lg:col-span-3 space-y-2">
          {ALL_CHANNELS.map(c => {
            const meta = CHANNEL_META[c];
            const Icon = meta.icon;
            const unread = unreadByChannel[c];
            const active = activeChannel === c;
            return (
              <button
                key={c}
                onClick={() => setActiveChannel(c)}
                className={[
                  'w-full text-left p-3 rounded-2xl border smooth-transition flex items-center gap-3',
                  active
                    ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                    : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]',
                ].join(' ')}
              >
                <div className={`p-2 rounded-xl ${statusTone[meta.tone].soft}`}>
                  <Icon size={16} className={statusTone[meta.tone].text} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-gray-900 dark:text-white uppercase leading-tight truncate">{c}</p>
                  {unread > 0 && (
                    <Badge tone="danger" variant="soft" className="mt-0.5">{unread} unread</Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Messages */}
        <div className="lg:col-span-9">
          <SectionCard pad="none" className="flex flex-col h-full">
            <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {(() => {
                  const meta = CHANNEL_META[activeChannel];
                  const Icon = meta.icon;
                  return <Icon size={16} className={statusTone[meta.tone].text} />;
                })()}
                <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">{activeChannel}</h3>
                {unreadByChannel[activeChannel] > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={markingAll}
                    className={button.ghost + ' ml-1 text-[9px] font-bold uppercase px-2 py-1 disabled:opacity-50'}
                    title="Mark all as read"
                  >
                    {markingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} className="inline mr-1" />}
                    Mark all read
                  </button>
                )}
              </div>
              <div className="relative w-full max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder="Search messages..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)] font-sans"
                />
              </div>
            </div>

            <div className="flex-1 divide-y divide-gray-100 dark:divide-slate-700 max-h-[28rem] overflow-y-auto">
              {loading && (
                <div className="p-8 flex items-center justify-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
                  <Loader2 size={14} className="animate-spin" /> Loading messages…
                </div>
              )}
              {!loading && error && (
                <div className="p-8 flex flex-col items-center justify-center gap-2 text-[10px] font-bold text-red-500 uppercase">
                  <ServerCrash size={16} /> {error}
                  <button onClick={fetchMessages} className={button.ghost + ' mt-1'}>Retry</button>
                </div>
              )}
              {!loading && !error && filtered.map(m => (
                <div
                  key={m.id}
                  onClick={() => m.unread && markRead(m.id)}
                  className={[
                    'p-4 flex gap-3 smooth-transition',
                    m.unread ? 'bg-[var(--color-accent-operations)]/5 cursor-pointer' : '',
                  ].join(' ')}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-gray-500 shrink-0">
                    {m.from.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-black text-gray-900 dark:text-white inline-flex items-center gap-2">
                        {m.from}
                        {m.unread && <span className={`inline-block w-2 h-2 rounded-full ${statusTone.danger.dot}`} />}
                      </span>
                      <span className="text-[9px] font-mono text-gray-400">{m.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 font-medium mt-0.5">{m.text}</p>
                  </div>
                </div>
              ))}
              {!loading && !error && filtered.length === 0 && (
                <div className="p-8 text-center text-[10px] font-bold text-gray-400 uppercase">
                  {messages.length === 0 ? 'No messages yet.' : 'No messages in this channel.'}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="p-4 border-t border-gray-200 dark:border-slate-700 flex items-center gap-2">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !sending && send()}
                placeholder={`Message ${activeChannel}...`}
                disabled={loading || !!error}
                className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)] font-sans disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={sending || !draft.trim()}
                className={button.primary + ' p-2.5 disabled:opacity-50'}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
