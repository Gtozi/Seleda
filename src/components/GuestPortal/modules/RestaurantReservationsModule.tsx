/**
 * Restaurant Reservations Module
 * Browse real outlets, check table availability, book and cancel dining.
 * Live data: /api/guest-portal/restaurants/*
 */

import { useCallback, useEffect, useState } from 'react';
import {
  UtensilsCrossed,
  Calendar,
  Clock,
  Users,
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Wine
} from 'lucide-react';

interface RestaurantReservationsModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface Restaurant {
  id: string;
  name: string;
  type: string;
  operatingHours: Record<string, { open?: string; close?: string } | undefined>;
  todayHours: { open?: string; close?: string } | null;
}

interface Booking {
  id: string;
  outletId: string;
  restaurantName: string;
  arrivalTime: string;
  partySize: number;
  duration?: number;
  status: string;
  specialRequests?: string | null;
  createdAt?: string;
}

interface DiningReservation {
  id: string;
  guestId?: string;
  guestName?: string;
  propertyId?: string;
  status?: string;
}

interface ReservationListItem {
  id: string;
  status?: string;
  checkOutDate?: string;
}

const IN_HOUSE_STATUSES = new Set(['CheckedIn', 'Checked In', 'InHouse', 'In House']);

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const RestaurantReservationsModule: React.FC<RestaurantReservationsModuleProps> = ({
  reservationId: reservationIdProp,
  guestId
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noContext, setNoContext] = useState(false);
  const [noEligible, setNoEligible] = useState(false);
  const [reservationId, setReservationId] = useState(reservationIdProp || '');
  const [reservation, setReservation] = useState<DiningReservation | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingParty, setBookingParty] = useState(2);
  const [bookingRequests, setBookingRequests] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadOverview = useCallback(async (resId: string) => {
    const res = await fetch(`/api/guest-portal/restaurants/overview/${encodeURIComponent(resId)}`, {
      headers: authHeaders(),
      credentials: 'include'
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to load restaurants (${res.status})`);
    }
    const body = await res.json();
    setReservation(body.reservation || null);
    setRestaurants(body.restaurants || []);
    setBookings(body.bookings || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let resId = reservationIdProp || '';
        if (!resId && guestId) {
          const res = await fetch(
            `/api/guest-portal/reservations/${encodeURIComponent(guestId)}`,
            { headers: authHeaders(), credentials: 'include' }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed to load reservations (${res.status})`);
          }
          const body = await res.json();
          const list: ReservationListItem[] = body.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          const inHouse = list.find(r => IN_HOUSE_STATUSES.has(String(r.status)));
          const upcoming = list
            .filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(String(r.status)))
            .filter(r => String(r.checkOutDate || '') >= today)
            .sort((a, b) => String(a.checkOutDate).localeCompare(String(b.checkOutDate)));
          resId = (inHouse || upcoming[0])?.id || '';
        }
        if (!resId) {
          if (!cancelled) {
            if (guestId) setNoEligible(true); else setNoContext(true);
          }
          return;
        }
        if (!cancelled) {
          setReservationId(resId);
          await loadOverview(resId);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load restaurants');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reservationIdProp, guestId, loadOverview]);

  const fetchSlots = useCallback(async (restaurant: Restaurant, date: string, party: number) => {
    if (!date || !reservation?.propertyId) { setSlots([]); return; }
    setSlotsLoading(true);
    setSelectedSlot('');
    try {
      const res = await fetch(
        `/api/guest-portal/restaurants/availability/${encodeURIComponent(reservation.propertyId)}?date=${encodeURIComponent(date)}&partySize=${party}&restaurantId=${encodeURIComponent(restaurant.id)}`,
        { headers: authHeaders(), credentials: 'include' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to load availability');
      setSlots(body.availability?.[0]?.availableSlots || []);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to load availability');
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [reservation?.propertyId]);

  useEffect(() => {
    if (selectedRestaurant && bookingDate) {
      fetchSlots(selectedRestaurant, bookingDate, bookingParty);
    } else {
      setSlots([]);
    }
  }, [selectedRestaurant, bookingDate, bookingParty, fetchSlots]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'seated': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'completed': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400',
      'no-show': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400'
    };
    return colors[status] || colors['confirmed'];
  };

  const formatHours = (h: { open?: string; close?: string } | null | undefined) => {
    if (!h || (!h.open && !h.close)) return 'Closed today';
    return `${h.open || '—'} – ${h.close || '—'}`;
  };

  const handleMakeReservation = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    setShowReservationModal(true);
    setBookingDate(new Date().toISOString().slice(0, 10));
    setBookingParty(2);
    setBookingRequests('');
    setSlots([]);
    setSelectedSlot('');
    setActionError(null);
  };

  const handleSubmitReservation = async () => {
    if (!selectedRestaurant || !selectedSlot || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch('/api/guest-portal/restaurants/reservations', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          reservationId,
          restaurantId: selectedRestaurant.id,
          date: bookingDate,
          time: selectedSlot,
          partySize: bookingParty,
          specialRequests: bookingRequests || null
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Booking failed (${res.status})`);
      setShowReservationModal(false);
      setSelectedRestaurant(null);
      await loadOverview(reservationId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to book table');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!confirm('Are you sure you want to cancel this reservation?')) return;
    setCancellingId(bookingId);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/restaurants/reservations/${encodeURIComponent(bookingId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ reservationId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Cancel failed (${res.status})`);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' } : b));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to cancel booking');
    } finally {
      setCancellingId(null);
    }
  };

  // ── Render states ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading restaurants…</p>
        </div>
      </div>
    );
  }

  if (noContext || noEligible) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Restaurant Reservations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Reserve tables at our restaurants</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <UtensilsCrossed size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {noContext ? 'Sign in to book a table' : 'No reservation available for dining bookings'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {noContext
              ? 'Link a guest profile to browse restaurants and reserve tables.'
              : 'Table reservations are available for current or upcoming stays.'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Restaurant Reservations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Reserve tables at our restaurants</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Restaurants unavailable</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); loadOverview(reservationId).catch(e => setError(e.message)).finally(() => setLoading(false)); }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Restaurant Reservations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Reserve tables at our restaurants
          </p>
        </div>
      </div>

      {actionError && !showReservationModal && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{actionError}</p>
        </div>
      )}

      {/* Restaurants */}
      {restaurants.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <UtensilsCrossed size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No restaurants configured</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This property has no active restaurant or bar outlets yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {restaurants.map((restaurant) => (
            <div key={restaurant.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="aspect-video bg-gradient-to-br from-orange-100 to-red-200 dark:from-orange-900/20 dark:to-red-900/20 flex items-center justify-center">
                {restaurant.type === 'Bar'
                  ? <Wine size={48} className="text-orange-600 dark:text-orange-400" />
                  : <UtensilsCrossed size={48} className="text-orange-600 dark:text-orange-400" />}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{restaurant.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {restaurant.type}
                  </span>
                </div>
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Clock size={14} />
                    <span>Today: {formatHours(restaurant.todayHours)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleMakeReservation(restaurant)}
                  disabled={!restaurant.todayHours}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Calendar size={16} />
                  Reserve Table
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My Reservations */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Reservations</h3>
        {bookings.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <Calendar size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No dining reservations yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => {
              const arrival = new Date(booking.arrivalTime);
              const isFuture = arrival.getTime() > Date.now();
              return (
                <div key={booking.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-medium text-slate-900 dark:text-white">{booking.restaurantName}</h4>
                        <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(booking.status)}`}>
                          {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Date</div>
                          <div className="font-medium text-slate-900 dark:text-white">
                            {Number.isNaN(arrival.getTime()) ? '—' : arrival.toLocaleDateString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Time</div>
                          <div className="font-medium text-slate-900 dark:text-white">
                            {Number.isNaN(arrival.getTime()) ? '—' : arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Guests</div>
                          <div className="font-medium text-slate-900 dark:text-white">{booking.partySize}</div>
                        </div>
                        {booking.specialRequests && (
                          <div>
                            <div className="text-slate-500 dark:text-slate-400">Special Requests</div>
                            <div className="font-medium text-slate-900 dark:text-white">{booking.specialRequests}</div>
                          </div>
                        )}
                      </div>
                    </div>
                    {booking.status === 'confirmed' && isFuture && (
                      <button
                        onClick={() => handleCancelBooking(booking.id)}
                        disabled={cancellingId === booking.id}
                        className="ml-4 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                      >
                        {cancellingId === booking.id ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reservation Modal */}
      {showReservationModal && selectedRestaurant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Reserve at {selectedRestaurant.name}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  value={bookingDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Number of Guests
                </label>
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-slate-400" />
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={bookingParty}
                    onChange={(e) => setBookingParty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Live slot availability */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Available Times
                </label>
                {slotsLoading ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 size={16} className="animate-spin" /> Checking availability…
                  </div>
                ) : !bookingDate ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Pick a date to see open slots.</p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">No open tables at that time — try another date or party size.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {slots.map(slot => (
                      <button
                        key={slot}
                        onClick={() => setSelectedSlot(slot)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                          selectedSlot === slot
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Special Requests
                </label>
                <textarea
                  value={bookingRequests}
                  onChange={(e) => setBookingRequests(e.target.value)}
                  placeholder="Any special requests..."
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {actionError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
                  <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-300">{actionError}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowReservationModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReservation}
                disabled={submitting || !selectedSlot}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Confirm Reservation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RestaurantReservationsModule;
