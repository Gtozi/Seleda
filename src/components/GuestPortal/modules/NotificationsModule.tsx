/**
 * Notifications Module
 * Live per-guest notification feed backed by `guest_notifications` —
 * rows are emitted when staff reply to the guest's messages, when a
 * guest request changes status, or when staff send a notification via
 * POST /api/guest-portal/notifications/send.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Calendar,
  CheckCircle2,
  UtensilsCrossed,
  Car,
  Sparkles,
  AlertTriangle,
  Tag,
  Clock,
  Check,
  X,
  AlertCircle,
  Loader2,
  RefreshCw,
  MessageSquare,
} from 'lucide-react';

interface NotificationsModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface GuestNotification {
  id: string;
  category: string;
  title: string;
  message: string;
  priority: 'normal' | 'high';
  read: boolean;
  created_at: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const NotificationsModule: React.FC<NotificationsModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [notifications, setNotifications] = useState<GuestNotification[]>([]);
  const [resolvedReservationId, setResolvedReservationId] = useState<string | undefined>(reservationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');

  const fetchNotifications = useCallback(async () => {
    if (!guestId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let resvId = reservationId;
      if (!resvId) {
        // Pick the in-house stay first, else the soonest upcoming reservation —
        // needed as the canActForGuest credential on the notifications GET.
        const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}`, {
          headers: authHeaders(), credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const rows: any[] = payload.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          resvId = rows.find(r => r.status === 'CheckedIn')?.id
            || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status)
                && r.checkInDate <= today && r.checkOutDate >= today)[0]?.id
            || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status))
                .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0]?.id;
        }
      }
      setResolvedReservationId(resvId);

      const qs = resvId ? `?reservationId=${encodeURIComponent(resvId)}` : '';
      const res = await fetch(`/api/guest-portal/notifications/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load notifications (${res.status})`);
      setNotifications(payload.notifications || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const getNotificationIcon = (category: string) => {
    switch (category) {
      case 'reservation': return <Calendar size={20} />;
      case 'checkin': return <CheckCircle2 size={20} />;
      case 'order': return <UtensilsCrossed size={20} />;
      case 'transportation': return <Car size={20} />;
      case 'restaurant': return <UtensilsCrossed size={20} />;
      case 'spa': return <Sparkles size={20} />;
      case 'checkout': return <AlertTriangle size={20} />;
      case 'promotion': return <Tag size={20} />;
      case 'message_reply': return <MessageSquare size={20} />;
      case 'request_update': return <CheckCircle2 size={20} />;
      default: return <Bell size={20} />;
    }
  };

  const getTypeColor = (category: string) => {
    const colors: Record<string, string> = {
      reservation: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      checkin: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      order: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:border-orange-700/50 dark:text-orange-400',
      transportation: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:border-purple-700/50 dark:text-purple-400',
      restaurant: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:border-rose-700/50 dark:text-rose-400',
      spa: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:border-pink-700/50 dark:text-pink-400',
      checkout: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      promotion: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-700/50 dark:text-indigo-400',
      message_reply: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:border-sky-700/50 dark:text-sky-400',
      request_update: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:border-teal-700/50 dark:text-teal-400',
      general: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300',
    };
    return colors[category] || colors.general;
  };

  const filteredNotifications = notifications.filter(notification => {
    if (filter === 'all') return true;
    return filter === 'unread' ? !notification.read : notification.read;
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAsRead = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      const res = await fetch(`/api/guest-portal/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: resolvedReservationId }),
      });
      if (!res.ok) throw new Error();
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {
      setError('Failed to mark notification as read');
    } finally {
      setActioning(null);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!guestId || markingAll) return;
    setMarkingAll(true);
    try {
      const res = await fetch(`/api/guest-portal/notifications/${encodeURIComponent(guestId)}/read-all`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: resolvedReservationId }),
      });
      if (!res.ok) throw new Error();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      setError('Failed to mark all as read');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleDeleteNotification = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      const qs = resolvedReservationId ? `?reservationId=${encodeURIComponent(resolvedReservationId)}` : '';
      const res = await fetch(`/api/guest-portal/notifications/${encodeURIComponent(id)}${qs}`, {
        method: 'DELETE',
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error();
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      setError('Failed to dismiss notification');
    } finally {
      setActioning(null);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Bell className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in required</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in to view your notifications.
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Notifications</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Stay updated with your hotel notifications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchNotifications}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={markingAll}
              className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50"
            >
              {markingAll && <Loader2 size={14} className="animate-spin" />}
              Mark all as read
            </button>
          )}
          <div className="relative">
            <Bell size={24} className="text-slate-400" />
            {unreadCount > 0 && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {unreadCount}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            filter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            filter === 'unread'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          Unread ({unreadCount})
        </button>
        <button
          onClick={() => setFilter('read')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            filter === 'read'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          Read
        </button>
      </div>

      {/* Notifications List */}
      {loading && notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Loading notifications...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 border-l-4 ${notification.priority === 'high' ? 'border-l-red-500' : 'border-l-transparent'} ${!notification.read ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${getTypeColor(notification.category)}`}>
                  {getNotificationIcon(notification.category)}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="font-semibold text-slate-900 dark:text-white">{notification.title}</h4>
                    <div className="flex items-center gap-2">
                      {!notification.read && (
                        <button
                          onClick={() => handleMarkAsRead(notification.id)}
                          disabled={actioning === notification.id}
                          className="p-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/20 rounded disabled:opacity-50"
                        >
                          {actioning === notification.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteNotification(notification.id)}
                        disabled={actioning === notification.id}
                        className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded disabled:opacity-50"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{notification.message}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Clock size={12} />
                    <span>{new Date(notification.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filteredNotifications.length === 0 && (
        <div className="text-center py-12">
          <Bell size={48} className="mx-auto text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-slate-400">No notifications to display</p>
        </div>
      )}
    </div>
  );
};

export default NotificationsModule;
