/**
 * Event & Activity Booking Module
 * Book hotel activities, excursions, local tours, cultural experiences.
 *
 * DB-integrated: the catalog is the experience slice of `guest_services`
 * (categories 'concierge'/'tour'/'itinerary' — the same rows the staff
 * Concierge experience desk sells) and bookings land in the shared
 * `guest_requests` queue via the existing /concierge endpoints as
 * 'Experience Booking' / 'Tour Booking' / 'Itinerary Planning' requests.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  Search,
  Plus,
  CheckCircle2,
  Mountain,
  Music,
  Loader2,
  AlertCircle,
  ConciergeBell
} from 'lucide-react';

interface EventActivityBookingModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface Activity {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
}

interface Booking {
  id: string;
  request_number: string | null;
  activityName: string;
  scheduledAt?: string;
  submittedAt: string;
  status: 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
  description: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// Experience-bookable guest_services categories. 'concierge' is the seeded
// in-city experiences catalog (coffee ceremonies, city tours, etc.).
const EXPERIENCE_CATEGORIES = ['concierge', 'tour', 'itinerary'];

// request_types the concierge queue assigns to experience bookings —
// used to pick this guest's activity bookings out of their requests.
const EXPERIENCE_REQUEST_TYPES = ['Experience Booking', 'Tour Booking', 'Itinerary Planning'];

const STATUS_LABEL: Record<string, Booking['status']> = {
  Open: 'Open',
  Assigned: 'In Progress',
  'In Progress': 'In Progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

const CATEGORY_LABEL: Record<string, string> = {
  concierge: 'Local Experience',
  tour: 'Tour & Excursion',
  itinerary: 'Day Itinerary',
};

const EventActivityBookingModule: React.FC<EventActivityBookingModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState({
    date: '',
    time: '',
    participants: 1
  });

  const loadData = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const qs = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
      const [catRes, reqRes] = await Promise.all([
        fetch(`/api/guest-portal/concierge/catalog/${encodeURIComponent(guestId)}${qs}`, {
          headers: authHeaders(), credentials: 'include',
        }),
        fetch(`/api/guest-portal/concierge/requests/${encodeURIComponent(guestId)}${qs}`, {
          headers: authHeaders(), credentials: 'include',
        }),
      ]);
      const catPayload = await catRes.json().catch(() => ({}));
      const reqPayload = await reqRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catPayload.error || `Catalog failed (${catRes.status})`);
      if (!reqRes.ok) throw new Error(reqPayload.error || `Requests failed (${reqRes.status})`);

      setActivities(((catPayload.services || []) as any[])
        .filter(s => EXPERIENCE_CATEGORIES.includes(s.category))
        .map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          description: s.description || '',
          price: Number(s.price) || 0,
        })));

      setBookings(((reqPayload.requests || []) as any[])
        .filter(r => EXPERIENCE_REQUEST_TYPES.includes(r.request_type))
        .map(r => ({
          id: r.id,
          request_number: r.request_number,
          // Server stores "ServiceName · details" in description.
          activityName: (r.description || '').split(' · ')[0] || r.request_type,
          description: (r.description || '').split(' · ').slice(1).join(' · '),
          status: STATUS_LABEL[r.status] || 'Open',
          submittedAt: r.submitted_at || r.created_at,
          scheduledAt: r.scheduled_for || undefined,
        })));
    } catch (e: any) {
      setError(e?.message || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadData(); }, [loadData]);

  const categories = ['All', ...Array.from(new Set(activities.map(a => a.category)))];

  const filteredActivities = activities.filter(activity => {
    const matchesSearch = activity.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         activity.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || activity.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'tour': return <Mountain size={20} />;
      case 'itinerary': return <MapPin size={20} />;
      case 'concierge': return <Music size={20} />;
      default: return <Calendar size={20} />;
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      'Open': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'Completed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
    };
    return colors[status as keyof typeof colors] || colors['Open'];
  };

  const handleBookActivity = (activity: Activity) => {
    setSelectedActivity(activity);
    setModalError(null);
    setShowBookingModal(true);
  };

  const handleSubmitBooking = async () => {
    if (!selectedActivity || !guestId || submitting) return;
    if (!newBooking.date || !newBooking.time) {
      setModalError('Please pick a date and time');
      return;
    }
    try {
      setSubmitting(true);
      setModalError(null);
      const scheduledFor = new Date(`${newBooking.date}T${newBooking.time}:00`);
      const res = await fetch('/api/guest-portal/concierge/requests', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: guestId,
          reservation_id: reservationId || undefined,
          service_id: selectedActivity.id,
          service_name: selectedActivity.name,
          request_details: `Booking for ${newBooking.participants} participant${newBooking.participants === 1 ? '' : 's'}`,
          scheduled_for: scheduledFor.toISOString(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Booking failed (${res.status})`);

      setShowBookingModal(false);
      setNewBooking({ date: '', time: '', participants: 1 });
      setSelectedActivity(null);
      await loadData();
    } catch (e: any) {
      setModalError(e?.message || 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!confirm('Are you sure you want to cancel this booking?') || cancelling) return;
    try {
      setCancelling(bookingId);
      const res = await fetch(`/api/guest-portal/concierge/requests/${encodeURIComponent(bookingId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: reservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Cancel failed (${res.status})`);
      setBookings(prev => prev.map(b =>
        b.id === bookingId ? { ...b, status: 'Cancelled' as const } : b
      ));
    } catch (e: any) {
      setError(e?.message || 'Could not cancel booking');
    } finally {
      setCancelling(null);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Events & Activities</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Discover and book exciting experiences
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <ConciergeBell size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to book experiences</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to browse activities and manage bookings.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading activities...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Events & Activities</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Discover and book exciting experiences
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search activities..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat === 'All' ? 'All' : CATEGORY_LABEL[cat] || cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Activities */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredActivities.map((activity) => (
          <div key={activity.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="aspect-video bg-gradient-to-br from-teal-100 to-emerald-200 dark:from-teal-900/20 dark:to-emerald-900/20 flex items-center justify-center">
              {getCategoryIcon(activity.category)}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-slate-900 dark:text-white">{activity.name}</h3>
                <div className="px-2 py-1 rounded-full text-xs font-medium bg-teal-100 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400 whitespace-nowrap ml-2">
                  {CATEGORY_LABEL[activity.category] || activity.category}
                </div>
              </div>
              {activity.description && (
                <p className="text-sm text-slate-500 dark:text-slate-500 mb-3">{activity.description}</p>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    {activity.price > 0 ? `$${activity.price.toFixed(2)}` : 'Complimentary'}
                  </span>
                  {activity.price > 0 && (
                    <span className="text-sm font-normal text-slate-500 dark:text-slate-400">/person</span>
                  )}
                </div>
                <button
                  onClick={() => handleBookActivity(activity)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                >
                  <Plus size={16} />
                  Book Now
                </button>
              </div>
            </div>
          </div>
        ))}
        {!filteredActivities.length && !error && (
          <p className="text-slate-400 col-span-full text-center py-8">
            No experiences are currently available{searchTerm || categoryFilter !== 'All' ? ' for this filter' : ''}.
          </p>
        )}
      </div>

      {/* My Bookings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Bookings</h3>
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div key={booking.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h4 className="font-medium text-slate-900 dark:text-white">{booking.activityName}</h4>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(booking.status)}`}>
                      {booking.status}
                    </div>
                    {booking.request_number && (
                      <span className="text-xs text-slate-400 font-mono">{booking.request_number}</span>
                    )}
                  </div>
                  {booking.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{booking.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    {booking.scheduledAt && (
                      <div className="flex items-center gap-1">
                        <Calendar size={12} />
                        <span>Scheduled: {new Date(booking.scheduledAt).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      <span>Submitted: {new Date(booking.submittedAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {booking.status === 'Open' && (
                  <button
                    onClick={() => handleCancelBooking(booking.id)}
                    disabled={cancelling === booking.id}
                    className="ml-4 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                  >
                    {cancelling === booking.id ? <Loader2 size={14} className="animate-spin" /> : '✕'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!bookings.length && (
            <p className="text-slate-400 text-center py-4 sm:py-6 text-sm">
              No bookings yet — pick an experience above and the concierge team will confirm it.
            </p>
          )}
        </div>
      </div>

      {/* Booking Modal */}
      {showBookingModal && selectedActivity && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Book {selectedActivity.name}
            </h3>
            {modalError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertCircle size={16} /> {modalError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={newBooking.date}
                  onChange={(e) => setNewBooking({ ...newBooking, date: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Preferred Time
                </label>
                <input
                  type="time"
                  value={newBooking.time}
                  onChange={(e) => setNewBooking({ ...newBooking, time: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Number of Participants
                </label>
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-slate-400" />
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={newBooking.participants}
                    onChange={(e) => setNewBooking({ ...newBooking, participants: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Estimated Total</span>
                  <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    {selectedActivity.price > 0
                      ? `$${(selectedActivity.price * newBooking.participants).toFixed(2)}`
                      : 'Complimentary'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  The concierge team will confirm your booking and arrange details.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowBookingModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitBooking}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Confirm Booking
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventActivityBookingModule;
