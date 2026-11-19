/**
 * Messaging Center Module
 * Guest ↔ hotel messaging thread backed by `guest_communications` —
 * the same rows concierge staff reply to from the Concierge portal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw
} from 'lucide-react';

interface MessagingCenterModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface CommRow {
  id: string;
  message: string;
  message_type: string;
  status: string;
  reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
}

interface ThreadItem {
  id: string;
  sender: 'Guest' | 'Hotel';
  content: string;
  timestamp: string;
  senderName?: string | null;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const MessagingCenterModule: React.FC<MessagingCenterModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [rows, setRows] = useState<CommRow[]>([]);
  const [resolvedReservationId, setResolvedReservationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(async () => {
    if (!reservationId && !guestId) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let resvId = reservationId;
      if (!resvId && guestId) {
        // Pick the in-house stay first, else the soonest upcoming reservation.
        const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}`, {
          headers: authHeaders(), credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Failed to resolve stay (${res.status})`);
        const list: any[] = payload.reservations || [];
        const today = new Date().toISOString().slice(0, 10);
        resvId = list.find(r => r.status === 'CheckedIn')?.id
          || list.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status)
              && r.checkInDate <= today && r.checkOutDate >= today)[0]?.id
          || list.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status))
              .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0]?.id;
      }

      if (!resvId) {
        setResolvedReservationId(undefined);
        setRows([]);
        return;
      }
      setResolvedReservationId(resvId);

      const res = await fetch(`/api/guest-portal/communications/${encodeURIComponent(resvId)}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load messages (${res.status})`);
      setRows(payload.messages || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [reservationId, guestId]);

  useEffect(() => { fetchThread(); }, [fetchThread]);

  // Flatten each communication row into guest message + optional hotel reply.
  const thread: ThreadItem[] = rows.flatMap((r) => {
    const items: ThreadItem[] = [{
      id: `${r.id}-msg`,
      sender: 'Guest',
      content: r.message,
      timestamp: r.created_at,
    }];
    if (r.reply) {
      items.push({
        id: `${r.id}-reply`,
        sender: 'Hotel',
        content: r.reply,
        timestamp: r.replied_at || r.created_at,
        senderName: r.replied_by,
      });
    }
    return items;
  }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.length]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !resolvedReservationId || sending) return;
    try {
      setSending(true);
      setError(null);
      const res = await fetch('/api/guest-portal/communications', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          reservation_id: resolvedReservationId,
          message: newMessage.trim(),
          message_type: 'Inquiry',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to send (${res.status})`);
      setNewMessage('');
      fetchThread();
    } catch (e: any) {
      setError(e?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (!guestId && !reservationId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <MessageSquare className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in required</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in to message the hotel team.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Messaging Center</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Message the hotel team — concierge replies appear here
          </p>
        </div>
        <button
          onClick={fetchThread}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Chat area */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col" style={{ minHeight: '28rem' }}>
        {/* Chat header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <MessageSquare size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Hotel Team</h3>
              <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={12} />
                <span>Front desk &amp; concierge</span>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : !resolvedReservationId ? (
            <div className="flex-1 flex items-center justify-center py-16">
              <div className="text-center">
                <MessageSquare size={48} className="mx-auto text-slate-400 mb-4" />
                <p className="text-slate-600 dark:text-slate-400">Messaging is available once your reservation is linked</p>
              </div>
            </div>
          ) : thread.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-16">
              <div className="text-center">
                <MessageSquare size={48} className="mx-auto text-slate-400 mb-4" />
                <p className="text-slate-600 dark:text-slate-400">No messages yet</p>
                <p className="text-xs text-slate-500 mt-1">Send a message and the hotel team will reply here</p>
              </div>
            </div>
          ) : (
            <>
              {thread.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender === 'Guest' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[70%] p-3 rounded-lg ${
                    message.sender === 'Guest'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                  }`}>
                    {message.senderName && (
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-0.5">{message.senderName}</p>
                    )}
                    <p className="text-sm">{message.content}</p>
                    <div className={`flex items-center gap-1 mt-1 text-xs ${
                      message.sender === 'Guest' ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      <Clock size={10} />
                      <span>{new Date(message.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Message input */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={resolvedReservationId ? 'Type your message...' : 'Link a reservation to send messages'}
              disabled={!resolvedReservationId || sending}
              className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || !resolvedReservationId || sending}
              className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagingCenterModule;
