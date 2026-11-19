/**
 * Home Dashboard Module
 * Displays current reservation, loyalty status, notifications, and quick actions.
 *
 * DB-integrated:
 * - Featured stay + room/balance: GET /api/guest-portal/reservations/:guestId
 *   (folio balance via GET /api/:reservationId/folio?guestId=)
 * - Loyalty card: GET /api/guest-portal/loyalty/:guestId (guests.loyalty_points)
 * - Announcements: GET /api/guest-portal/notifications/:guestId (guest_notifications)
 * - Recommendations: GET /api/guest-portal/concierge/catalog/:guestId (guest_services)
 * - Guest name: GET /api/guest-portal/profile/:guestId
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Home,
  Calendar,
  Clock,
  CreditCard,
  Star,
  Bell,
  ArrowRight,
  LogIn,
  Key,
  UtensilsCrossed,
  MessageSquare,
  Bed,
  Car,
  ChevronRight,
  Loader2,
  RefreshCw,
  LogIn as SignInIcon,
  AlertCircle,
  Receipt
} from 'lucide-react';
import { fetchReservationFolio } from '../../../services/folioService';

interface HomeDashboardModuleProps {
  reservationId?: string;
  guestId?: string;
  onViewModule?: (module: string) => void;
}

interface GuestReservation {
  id: string;
  confirmationNumber: string;
  hotelName: string;
  checkInDate: string;
  checkOutDate: string;
  roomType?: string;
  roomNumber?: string | null;
  totalAmount: number;
  currency: string;
  paymentStatus: string;
  status: string;
}

interface LoyaltyData {
  balance: number;
  tier: string;
  nextTier: { name: string; threshold: number } | null;
}

interface GuestNotification {
  id: string;
  category: string;
  title: string;
  message: string;
  priority: string;
  read: boolean;
  created_at: string;
}

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  available?: boolean;
}

const IN_HOUSE_STATUSES = new Set(['CheckedIn', 'Checked In', 'InHouse', 'In House']);
const UPCOMING_STATUSES = new Set(['Reserved', 'Confirmed', 'Pending', 'Guaranteed']);

const RECOMMENDATION_GRADIENTS = [
  'from-teal-400 to-emerald-500',
  'from-orange-400 to-red-500',
  'from-blue-400 to-indigo-500',
];

const HomeDashboardModule: React.FC<HomeDashboardModuleProps> = ({
  reservationId,
  guestId,
  onViewModule
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [featured, setFeatured] = useState<GuestReservation | null>(null);
  const [folioBalance, setFolioBalance] = useState<number | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [notifications, setNotifications] = useState<GuestNotification[]>([]);
  const [recommendations, setRecommendations] = useState<CatalogItem[]>([]);

  const qs = useMemo(
    () => (reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : ''),
    [reservationId]
  );

  const pickFeatured = (rows: GuestReservation[]): GuestReservation | null => {
    if (!rows.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const inHouse = rows.find(r => IN_HOUSE_STATUSES.has(r.status));
    if (inHouse) return inHouse;
    const upcoming = rows
      .filter(r => UPCOMING_STATUSES.has(r.status) && String(r.checkInDate).slice(0, 10) >= today)
      .sort((a, b) => String(a.checkInDate).localeCompare(String(b.checkInDate)));
    if (upcoming.length) return upcoming[0];
    return rows.find(r => reservationId && r.id === reservationId) || null;
  };

  const load = async () => {
    if (!guestId) return;
    setLoading(true);
    setError(null);
    try {
      const [resRes, loyRes, notifRes, catRes, profRes] = await Promise.all([
        fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}${qs}`, { credentials: 'include' }),
        fetch(`/api/guest-portal/loyalty/${encodeURIComponent(guestId)}${qs}`, { credentials: 'include' }),
        fetch(`/api/guest-portal/notifications/${encodeURIComponent(guestId)}${qs}`, { credentials: 'include' }),
        fetch(`/api/guest-portal/concierge/catalog/${encodeURIComponent(guestId)}${qs}`, { credentials: 'include' }),
        fetch(`/api/guest-portal/profile/${encodeURIComponent(guestId)}${qs}`, { credentials: 'include' }),
      ]);

      if (resRes.status === 401 || resRes.status === 403) {
        const d = await resRes.json().catch(() => null);
        throw new Error(d?.error || 'Not authorized to view this guest portal');
      }
      if (!resRes.ok) throw new Error('Failed to load your reservations');

      const resData = await resRes.json();
      const rows: GuestReservation[] = resData.reservations || [];
      const pick = pickFeatured(rows);
      setFeatured(pick);
      setFolioBalance(null);

      if (loyRes.ok) setLoyalty(await loyRes.json());
      if (notifRes.ok) {
        const d = await notifRes.json();
        setNotifications(d.notifications || []);
      }
      if (catRes.ok) {
        const d = await catRes.json();
        const items: CatalogItem[] = (d.services || d.catalog || d.items || [])
          .filter((s: CatalogItem) => s.available !== false);
        setRecommendations(items.slice(0, 3));
      }
      if (profRes.ok) {
        const d = await profRes.json();
        setGuestName([d.firstName, d.lastName].filter(Boolean).join(' ').trim());
      }

      if (pick) {
        try {
          const folio = await fetchReservationFolio(pick.id, guestId);
          setFolioBalance(folio.consolidatedBalance);
        } catch {
          setFolioBalance(null);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (guestId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, reservationId]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const stayTiming = useMemo(() => {
    if (!featured) return { label: 'Check-in', value: '—' };
    const today = new Date().toISOString().slice(0, 10);
    const ci = String(featured.checkInDate).slice(0, 10);
    const co = String(featured.checkOutDate).slice(0, 10);
    if (IN_HOUSE_STATUSES.has(featured.status) || (ci <= today && co >= today)) {
      const night = Math.max(1, Math.round((Date.parse(today) - Date.parse(ci)) / 86400000) + 1);
      const total = Math.max(1, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000));
      return { label: 'Your Stay', value: `Night ${Math.min(night, total)} of ${total}` };
    }
    const days = Math.ceil((Date.parse(ci) - Date.parse(today)) / 86400000);
    if (days === 0) return { label: 'Check-in', value: 'Today' };
    if (days === 1) return { label: 'Check-in', value: 'Tomorrow' };
    if (days > 1) return { label: 'Check-in', value: `in ${days} days` };
    return { label: 'Stay', value: 'Completed' };
  }, [featured]);

  const getTierColor = (tier: string) => {
    const colors: Record<string, string> = {
      'Silver': 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
      'Gold': 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700/50',
      'Platinum': 'bg-slate-200 text-slate-800 border-slate-400 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-500',
      'Bronze': 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700/50',
    };
    return colors[tier] || 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-700/50';
  };

  const getStatusColor = (status: string) => {
    if (IN_HOUSE_STATUSES.has(status)) {
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400';
    }
    if (status === 'Cancelled' || status === 'CheckedOut' || status === 'Checked Out') {
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400';
    }
    return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400';
  };

  const recommendationModule = (item: CatalogItem): string => {
    const cat = String(item.category || '').toLowerCase();
    if (cat === 'tour' || cat === 'itinerary') return 'events';
    if (cat === 'transport') return 'transportation';
    return 'concierge';
  };

  const quickActions = [
    { id: 'checkin', label: 'Check-in', icon: <LogIn size={20} />, module: 'checkin' },
    { id: 'key', label: 'Digital Key', icon: <Key size={20} />, module: 'digitalKey' },
    { id: 'roomService', label: 'Room Service', icon: <UtensilsCrossed size={20} />, module: 'roomService' },
    { id: 'chat', label: 'Chat with Hotel', icon: <MessageSquare size={20} />, module: 'messaging' },
    { id: 'housekeeping', label: 'Housekeeping', icon: <Bed size={20} />, module: 'housekeeping' },
    { id: 'restaurant', label: 'Book Restaurant', icon: <UtensilsCrossed size={20} />, module: 'restaurant' },
    { id: 'transport', label: 'Transportation', icon: <Car size={20} />, module: 'transportation' },
    { id: 'billing', label: 'View Bill', icon: <Receipt size={20} />, module: 'billing' }
  ];

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-10 text-center">
          <SignInIcon size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Sign in to view your dashboard</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Open your booking confirmation link to load your stay, loyalty status, and notifications.
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Welcome{guestName ? `, ${guestName.split(' ')[0]}` : ' Back'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your home away from home
          </p>
        </div>
        <button
          onClick={() => onViewModule?.('notifications')}
          className="relative p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
          aria-label="Notifications"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={load} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/40 rounded" aria-label="Retry">
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {loading && !featured ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-indigo-500" />
        </div>
      ) : (
        <>
          {/* Current Reservation Card */}
          {featured ? (
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-4 sm:p-6 text-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar size={20} className="shrink-0" />
                    <span className="text-sm font-medium opacity-90">
                      {IN_HOUSE_STATUSES.has(featured.status) ? 'Current Stay' : 'Upcoming Reservation'}
                    </span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold mb-1 truncate">{featured.confirmationNumber}</h2>
                  <p className="text-sm opacity-90 mb-1">{featured.hotelName}</p>
                  <div className="flex items-center gap-4 text-sm opacity-90">
                    <span>{new Date(featured.checkInDate).toLocaleDateString()}</span>
                    <ArrowRight size={16} />
                    <span>{new Date(featured.checkOutDate).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(featured.status)}`}>
                  {featured.status}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock size={16} />
                    <span className="text-xs opacity-75">{stayTiming.label}</span>
                  </div>
                  <div className="text-lg font-bold">{stayTiming.value}</div>
                </div>
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
                  <div className="flex items-center gap-2 mb-1">
                    <Home size={16} />
                    <span className="text-xs opacity-75">Room</span>
                  </div>
                  <div className="text-lg font-bold">
                    {featured.roomNumber || featured.roomType || 'Assigned at check-in'}
                  </div>
                </div>
                <button
                  onClick={() => onViewModule?.('billing')}
                  className="bg-white/10 rounded-lg p-3 backdrop-blur text-left hover:bg-white/20 transition"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard size={16} />
                    <span className="text-xs opacity-75">Balance</span>
                  </div>
                  <div className="text-lg font-bold">
                    {featured.currency} {(folioBalance ?? featured.totalAmount).toFixed(2)}
                  </div>
                </button>
                <button
                  onClick={() => onViewModule?.('loyalty')}
                  className="bg-white/10 rounded-lg p-3 backdrop-blur text-left hover:bg-white/20 transition"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Star size={16} />
                    <span className="text-xs opacity-75">Points</span>
                  </div>
                  <div className="text-lg font-bold">{(loyalty?.balance ?? 0).toLocaleString()}</div>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
              <Calendar size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <h3 className="font-semibold text-slate-900 dark:text-white mb-1">No active reservation</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Book a stay to see your reservation details here.
              </p>
            </div>
          )}

          {/* Loyalty Status */}
          {loyalty && (
            <button
              onClick={() => onViewModule?.('loyalty')}
              className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6 hover:border-indigo-300 dark:hover:border-indigo-700 transition"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Loyalty Status</h3>
                <div className={`px-3 py-1 rounded-full text-xs font-medium border ${getTierColor(loyalty.tier)}`}>
                  {loyalty.tier} Member
                </div>
              </div>
              <div className="mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    {loyalty.nextTier ? `Progress to ${loyalty.nextTier.name}` : 'Top tier reached'}
                  </span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {loyalty.balance.toLocaleString()}
                    {loyalty.nextTier ? ` / ${loyalty.nextTier.threshold.toLocaleString()}` : ''} points
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-amber-400 to-amber-600 h-2 rounded-full transition-all"
                    style={{
                      width: `${loyalty.nextTier
                        ? Math.min(100, (loyalty.balance / loyalty.nextTier.threshold) * 100)
                        : 100}%`
                    }}
                  />
                </div>
              </div>
            </button>
          )}

          {/* Quick Actions */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => onViewModule?.(action.module)}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition group"
                >
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition">
                    {action.icon}
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Notifications / Announcements */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Hotel Announcements</h3>
              <button
                onClick={() => onViewModule?.('notifications')}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
              >
                View all <ChevronRight size={14} />
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                No announcements right now — we'll let you know about events, updates, and replies here.
              </p>
            ) : (
              <div className="space-y-3">
                {notifications.slice(0, 4).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onViewModule?.('notifications')}
                    className={`w-full text-left p-4 rounded-lg border transition ${
                      n.read
                        ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20'
                        : 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                        {!n.read && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
                        {n.title}
                      </h4>
                      {n.priority === 'high' && (
                        <span className="shrink-0 px-2 py-0.5 rounded text-xs font-medium border bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400">
                          Important
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recommended for You — real bookable services */}
          {recommendations.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Recommended for You</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recommendations.map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => onViewModule?.(recommendationModule(item))}
                    className="relative rounded-lg overflow-hidden group text-left"
                  >
                    <div className={`aspect-video bg-gradient-to-br ${RECOMMENDATION_GRADIENTS[idx % RECOMMENDATION_GRADIENTS.length]}`} />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                      <ChevronRight size={24} className="text-white" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                      <h4 className="text-white font-medium text-sm truncate">{item.name}</h4>
                      <p className="text-white/80 text-xs truncate">
                        {item.price != null ? `${item.currency || 'ETB'} ${Number(item.price).toFixed(2)}` : item.category || 'Hotel service'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HomeDashboardModule;
