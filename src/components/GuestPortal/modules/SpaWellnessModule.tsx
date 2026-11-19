/**
 * Spa & Wellness Module
 * Book massages, facials, gym sessions, sauna, wellness packages
 * Backed by /api/guest-portal/spa/* (spa_appointments + shared validation).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Calendar,
  Clock,
  Search,
  Filter,
  Plus,
  Heart,
  Dumbbell,
  Droplets,
  Sun,
  AlertTriangle,
  Loader2
} from 'lucide-react';

interface SpaWellnessModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface Treatment {
  id: string;
  name: string;
  category: string;
  description: string;
  duration: number;
  price: number;
  popular?: boolean;
}

interface Booking {
  id: string;
  treatment: string;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  therapist?: string;
  status: string;
  amount: number;
}

interface Provider {
  id: string;
  name: string;
  title?: string | null;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const SpaWellnessModule: React.FC<SpaWellnessModuleProps> = ({ reservationId, guestId }) => {
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTreatment, setSelectedTreatment] = useState<Treatment | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [newBooking, setNewBooking] = useState({ date: '', time: '', therapistId: '', notes: '' });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalWarnings, setModalWarnings] = useState<string[]>([]);
  const [rescheduling, setRescheduling] = useState<Booking | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({ date: '', time: '' });
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cred = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
      const [catRes, bookRes] = await Promise.all([
        fetch(`/api/guest-portal/spa/catalog/${encodeURIComponent(guestId)}${cred}`, {
          headers: authHeaders(), credentials: 'include',
        }),
        fetch(`/api/guest-portal/spa/bookings/${encodeURIComponent(guestId)}${cred}`, {
          headers: authHeaders(), credentials: 'include',
        }),
      ]);
      const catJson = await catRes.json().catch(() => ({}));
      const bookJson = await bookRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catJson.error || 'Failed to load treatments');
      if (!bookRes.ok) throw new Error(bookJson.error || 'Failed to load bookings');
      setTreatments(catJson.treatments || []);
      setBookings(bookJson.bookings || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load spa data');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh the available-provider list whenever date/time changes.
  useEffect(() => {
    if (!guestId || !newBooking.date || !newBooking.time || !selectedTreatment) {
      setProviders([]);
      return;
    }
    let cancelled = false;
    setProvidersLoading(true);
    const params = new URLSearchParams({
      guestId, date: newBooking.date, startTime: newBooking.time,
      duration: String(selectedTreatment.duration),
    });
    if (reservationId) params.append('reservationId', reservationId);
    fetch(`/api/guest-portal/spa/availability?${params}`, {
      headers: authHeaders(), credentials: 'include',
    })
      .then(r => r.json())
      .then(j => { if (!cancelled) setProviders(j.providers || []); })
      .catch(() => { if (!cancelled) setProviders([]); })
      .finally(() => { if (!cancelled) setProvidersLoading(false); });
    return () => { cancelled = true; };
  }, [guestId, reservationId, newBooking.date, newBooking.time, selectedTreatment]);

  const categories = ['All', ...Array.from(new Set(treatments.map(t => t.category)))];

  const filteredTreatments = treatments.filter(treatment => {
    const matchesSearch = treatment.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (treatment.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || treatment.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Massage': return <Heart size={20} />;
      case 'Facial': return <Sparkles size={20} />;
      case 'Body Treatment': return <Droplets size={20} />;
      case 'Wellness Package': return <Sun size={20} />;
      default: return <Sparkles size={20} />;
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Massage': 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:border-rose-700/50 dark:text-rose-400',
      'Facial': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:border-purple-700/50 dark:text-purple-400',
      'Body Treatment': 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/20 dark:border-cyan-700/50 dark:text-cyan-400',
      'Wellness Package': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400'
    };
    return colors[category] || colors['Massage'];
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Requested': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Pending': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400',
      'Completed': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'Checked In': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'In Treatment': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400'
    };
    return colors[status] || colors['Requested'];
  };

  const handleBookTreatment = (treatment: Treatment) => {
    setSelectedTreatment(treatment);
    setModalError(null);
    setModalWarnings([]);
    setNewBooking({ date: '', time: '', therapistId: '', notes: '' });
    setProviders([]);
    setShowBookingModal(true);
  };

  const handleSubmitBooking = async () => {
    if (!selectedTreatment || !guestId) return;
    if (!newBooking.date || !newBooking.time) {
      setModalError('Please choose a date and time');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/guest-portal/spa/bookings', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: guestId,
          reservation_id: reservationId || undefined,
          treatment_id: selectedTreatment.id,
          therapist_id: newBooking.therapistId || null,
          appointment_date: newBooking.date,
          start_time: newBooking.time,
          notes: newBooking.notes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Booking failed');
      if (Array.isArray(json.warnings) && json.warnings.length) {
        setModalWarnings(json.warnings);
      }
      await loadData();
      if (!json.warnings?.length) {
        setShowBookingModal(false);
        setSelectedTreatment(null);
      }
    } catch (e: any) {
      setModalError(e.message || 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!guestId || !confirm('Are you sure you want to cancel this booking?')) return;
    try {
      const res = await fetch(`/api/guest-portal/spa/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservation_id: reservationId || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Cancel failed');
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Could not cancel booking');
    }
  };

  const handleReschedule = async () => {
    if (!rescheduling || !guestId) return;
    if (!rescheduleForm.date || !rescheduleForm.time) {
      setRescheduleError('Please choose a new date and time');
      return;
    }
    setSubmitting(true);
    setRescheduleError(null);
    try {
      const res = await fetch(`/api/guest-portal/spa/bookings/${encodeURIComponent(rescheduling.id)}/reschedule`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          reservation_id: reservationId || undefined,
          appointment_date: rescheduleForm.date,
          start_time: rescheduleForm.time,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Reschedule failed');
      setRescheduling(null);
      await loadData();
    } catch (e: any) {
      setRescheduleError(e.message || 'Could not reschedule booking');
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!selectedTreatment || !guestId || !newBooking.date) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/guest-portal/spa/waitlist', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: guestId,
          reservation_id: reservationId || undefined,
          treatment_id: selectedTreatment.id,
          therapist_id: newBooking.therapistId || null,
          preferred_date: newBooking.date,
          preferred_time: newBooking.time || null,
          notes: newBooking.notes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not join waitlist');
      setShowBookingModal(false);
      setSelectedTreatment(null);
      alert('You have been added to the waitlist — we will notify you if a slot opens.');
    } catch (e: any) {
      setModalError(e.message || 'Could not join waitlist');
    } finally {
      setSubmitting(false);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Spa & Wellness</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Relax and rejuvenate with our premium spa services
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Sparkles size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to view spa services</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to browse treatments and manage bookings.
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Spa & Wellness</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Relax and rejuvenate with our premium spa services
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-lg text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Quick Access — real catalog categories, wired to the filter */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {categories.filter(c => c !== 'All').slice(0, 4).map((cat, i) => {
          const bgs = ['from-rose-500 to-pink-600', 'from-purple-500 to-indigo-600', 'from-cyan-500 to-blue-600', 'from-amber-500 to-orange-600'];
          const icons = [
            <Heart size={32} className="mb-2" />,
            <Sparkles size={32} className="mb-2" />,
            <Droplets size={32} className="mb-2" />,
            <Dumbbell size={32} className="mb-2" />,
          ];
          const count = treatments.filter(t => t.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'All' : cat)}
              className={`bg-gradient-to-br ${bgs[i % bgs.length]} rounded-xl p-4 text-white text-left transition ${
                categoryFilter === cat ? 'ring-2 ring-offset-2 ring-white/70 dark:ring-offset-slate-900' : 'hover:opacity-90'
              }`}
            >
              {icons[i % icons.length]}
              <div className="font-semibold">{cat}</div>
              <div className="text-sm opacity-90">{count} treatment{count === 1 ? '' : 's'}</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search treatments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Treatments */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading treatments...
        </div>
      ) : filteredTreatments.length === 0 ? (
        <div className="text-center py-12 text-slate-400">No treatments available</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTreatments.map((treatment) => (
            <div key={treatment.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="aspect-video bg-gradient-to-br from-purple-100 to-pink-200 dark:from-purple-900/20 dark:to-pink-900/20 flex items-center justify-center">
                {getCategoryIcon(treatment.category)}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{treatment.name}</h3>
                  <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getCategoryColor(treatment.category)}`}>
                    {treatment.category}
                  </div>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{treatment.description}</p>
                <div className="flex items-center gap-4 mb-3 text-sm text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-1">
                    <Clock size={14} />
                    <span>{treatment.duration} min</span>
                  </div>
                  {treatment.popular && (
                    <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <Sparkles size={14} />
                      <span>Popular</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    ${treatment.price.toFixed(2)}
                  </span>
                  <button
                    onClick={() => handleBookTreatment(treatment)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                  >
                    <Calendar size={16} />
                    Book Now
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My Bookings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Bookings</h3>
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-400">No bookings yet.</p>
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => (
              <div key={booking.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-medium text-slate-900 dark:text-white">{booking.treatment}</h4>
                      <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(booking.status)}`}>
                        {booking.status}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Date</div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {new Date(booking.appointment_date).toLocaleDateString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Time</div>
                        <div className="font-medium text-slate-900 dark:text-white">{booking.start_time}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Duration</div>
                        <div className="font-medium text-slate-900 dark:text-white">{booking.duration_minutes} min</div>
                      </div>
                      {booking.therapist && (
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Therapist</div>
                          <div className="font-medium text-slate-900 dark:text-white">{booking.therapist}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {['Requested', 'Confirmed'].includes(booking.status) && (
                    <div className="ml-4 flex flex-col gap-1">
                      <button
                        onClick={() => {
                          setRescheduling(booking);
                          setRescheduleForm({ date: booking.appointment_date, time: booking.start_time });
                          setRescheduleError(null);
                        }}
                        title="Reschedule"
                        className="p-2 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-lg transition"
                      >
                        <Calendar size={16} />
                      </button>
                      <button
                        onClick={() => handleCancelBooking(booking.id)}
                        title="Cancel"
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Booking Modal */}
      {showBookingModal && selectedTreatment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Book {selectedTreatment.name}
            </h3>

            {modalError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertTriangle size={16} />
                {modalError}
              </div>
            )}
            {modalWarnings.length > 0 && (
              <div className="p-3 mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg text-amber-700 dark:text-amber-400 text-sm space-y-1">
                {modalWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
                <p className="text-xs opacity-80 mt-1">Your booking was created — staff have been notified.</p>
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
                  onChange={(e) => setNewBooking({ ...newBooking, date: e.target.value, therapistId: '' })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Time
                </label>
                <input
                  type="time"
                  value={newBooking.time}
                  onChange={(e) => setNewBooking({ ...newBooking, time: e.target.value, therapistId: '' })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Preferred Therapist (Optional)
                </label>
                <select
                  value={newBooking.therapistId}
                  onChange={(e) => setNewBooking({ ...newBooking, therapistId: e.target.value })}
                  disabled={!newBooking.date || !newBooking.time || providersLoading}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">
                    {!newBooking.date || !newBooking.time
                      ? 'Choose date & time first'
                      : providersLoading
                        ? 'Checking availability...'
                        : providers.length === 0
                          ? 'No preference'
                          : 'No preference'}
                  </option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ''}</option>
                  ))}
                </select>
                {newBooking.date && newBooking.time && !providersLoading && providers.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">No specific therapists free at this slot — we'll assign one.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                  rows={2}
                  placeholder="Allergies, preferences, special requests..."
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Total Price</span>
                  <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    ${selectedTreatment.price.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowBookingModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              {newBooking.date && !providersLoading && providers.length === 0 && (
                <button
                  onClick={handleJoinWaitlist}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition text-sm font-medium disabled:opacity-50"
                >
                  <Clock size={16} />
                  Join Waitlist
                </button>
              )}
              <button
                onClick={handleSubmitBooking}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Confirm Booking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduling && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Reschedule {rescheduling.treatment}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Currently {new Date(rescheduling.appointment_date).toLocaleDateString()} at {rescheduling.start_time}
            </p>
            {rescheduleError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertTriangle size={16} />
                {rescheduleError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">New Date</label>
                <input
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={rescheduleForm.date}
                  onChange={(e) => setRescheduleForm({ ...rescheduleForm, date: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">New Time</label>
                <input
                  type="time"
                  value={rescheduleForm.time}
                  onChange={(e) => setRescheduleForm({ ...rescheduleForm, time: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setRescheduling(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleReschedule}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Calendar size={16} />}
                Reschedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpaWellnessModule;
