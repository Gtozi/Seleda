/**
 * Transportation Module
 * Book airport pickup, shuttle, limousine, car rental, chauffeur services.
 * Backed by /api/guest-portal/transport/* — bookings create real
 * transport_requests (source 'Guest Mobile App') visible to dispatch.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Car,
  Plane,
  Bus,
  Gem,
  User,
  MapPin,
  Search,
  Plus,
  CheckCircle2,
  Loader2,
  AlertTriangle
} from 'lucide-react';

interface TransportationModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface TransportService {
  id: string;
  name: string;
  type: string;
  description: string;
  capacity: string;
  pricePerTrip: number;
}

interface Booking {
  id: string;
  request_number: string;
  type: string;
  scheduled_time: string;
  pickup_location: string;
  destination: string;
  passenger_count: number;
  status: string;
  amount: number;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const TransportationModule: React.FC<TransportationModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [services, setServices] = useState<TransportService[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedService, setSelectedService] = useState<TransportService | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState({
    date: '',
    time: '',
    pickupLocation: '',
    dropoffLocation: '',
    passengers: 1
  });

  const loadData = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
      const [catRes, bookRes] = await Promise.all([
        fetch(`/api/guest-portal/transport/catalog/${encodeURIComponent(guestId)}${qs}`, {
          headers: authHeaders(), credentials: 'include',
        }),
        fetch(`/api/guest-portal/transport/bookings/${encodeURIComponent(guestId)}${qs}`, {
          headers: authHeaders(), credentials: 'include',
        }),
      ]);
      const catJson = await catRes.json().catch(() => ({}));
      const bookJson = await bookRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catJson.error || 'Failed to load transport services');
      if (!bookRes.ok) throw new Error(bookJson.error || 'Failed to load bookings');
      setServices(catJson.services || []);
      setBookings(bookJson.bookings || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load transportation data');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadData(); }, [loadData]);

  const types = ['All', ...Array.from(new Set(services.map(s => s.type)))];

  const filteredServices = services.filter(service =>
    typeFilter === 'All' || service.type === typeFilter
  );

  const getTypeIcon = (type: string) => {
    if (/airport/i.test(type)) return <Plane size={20} />;
    if (/shuttle/i.test(type)) return <Bus size={20} />;
    if (/vip|limo|luxury/i.test(type)) return <Gem size={20} />;
    if (/staff|chauffeur/i.test(type)) return <User size={20} />;
    return <Car size={20} />;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Assigned': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Requested': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400',
      'Completed': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400'
    };
    return colors[status] || colors['Requested'];
  };

  const handleBookService = (service: TransportService) => {
    setSelectedService(service);
    setModalError(null);
    setShowBookingModal(true);
  };

  const handleSubmitBooking = async () => {
    if (!selectedService || !guestId) return;
    if (!newBooking.date || !newBooking.time || !newBooking.pickupLocation.trim()) {
      setModalError('Date, time and pickup location are required');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/guest-portal/transport/bookings', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: guestId,
          service_id: selectedService.id,
          service_name: selectedService.name,
          date: newBooking.date,
          time: newBooking.time,
          pickup_location: newBooking.pickupLocation.trim(),
          dropoff_location: newBooking.dropoffLocation.trim() || undefined,
          passengers: newBooking.passengers,
          reservation_id: reservationId || undefined,
          notes: reservationId ? `Reservation ${reservationId}` : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Booking failed');
      setShowBookingModal(false);
      setNewBooking({ date: '', time: '', pickupLocation: '', dropoffLocation: '', passengers: 1 });
      setSelectedService(null);
      await loadData();
    } catch (e: any) {
      setModalError(e.message || 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    try {
      const res = await fetch(`/api/guest-portal/transport/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: reservationId || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Cancel failed');
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Could not cancel booking');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading transportation...
      </div>
    );
  }

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Transportation</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Book transportation services for your travel needs
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Car size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to book transportation</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to browse transport services and manage bookings.
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Transportation</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Book transportation services for your travel needs
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-4">
          <Search size={18} className="text-slate-400" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {types.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Services */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredServices.map((service) => (
          <div key={service.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="aspect-video bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900/20 dark:to-indigo-900/20 flex items-center justify-center">
              {getTypeIcon(service.type)}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-slate-900 dark:text-white">{service.name}</h3>
                <div className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400">
                  {service.type}
                </div>
              </div>
              {service.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{service.description}</p>
              )}
              <div className="flex items-center gap-4 mb-3 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex items-center gap-1">
                  <User size={14} />
                  <span>{service.capacity}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    {service.pricePerTrip > 0 ? `$${service.pricePerTrip.toFixed(2)}` : 'Complimentary'}
                  </span>
                  {service.pricePerTrip > 0 && (
                    <span className="text-sm font-normal text-slate-500 dark:text-slate-400">/trip</span>
                  )}
                </div>
                <button
                  onClick={() => handleBookService(service)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                >
                  <Plus size={16} />
                  Book
                </button>
              </div>
            </div>
          </div>
        ))}
        {!filteredServices.length && !error && (
          <p className="text-slate-400 col-span-full text-center py-8">No transportation services available right now.</p>
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
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-medium text-slate-900 dark:text-white">{booking.type}</h4>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(booking.status)}`}>
                      {booking.status}
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{booking.request_number}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Scheduled</div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {new Date(booking.scheduled_time).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Pickup</div>
                      <div className="font-medium text-slate-900 dark:text-white">{booking.pickup_location}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Destination</div>
                      <div className="font-medium text-slate-900 dark:text-white">{booking.destination}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Fare</div>
                      <div className="font-medium text-slate-900 dark:text-white">${Number(booking.amount || 0).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
                {['Requested', 'Confirmed'].includes(booking.status) && (
                  <button
                    onClick={() => handleCancelBooking(booking.id)}
                    className="ml-4 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {!bookings.length && (
            <p className="text-slate-400 text-center py-4 sm:py-6 text-sm">No bookings yet — choose a service above.</p>
          )}
        </div>
      </div>

      {/* Booking Modal */}
      {showBookingModal && selectedService && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Book {selectedService.name}
            </h3>
            {modalError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertTriangle size={16} /> {modalError}
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
                  Time
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
                  Pickup Location
                </label>
                <div className="flex items-center gap-2">
                  <MapPin size={18} className="text-slate-400" />
                  <input
                    type="text"
                    value={newBooking.pickupLocation}
                    onChange={(e) => setNewBooking({ ...newBooking, pickupLocation: e.target.value })}
                    placeholder="Enter pickup location"
                    className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Drop-off Location (Optional)
                </label>
                <input
                  type="text"
                  value={newBooking.dropoffLocation}
                  onChange={(e) => setNewBooking({ ...newBooking, dropoffLocation: e.target.value })}
                  placeholder="Enter drop-off location"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Passengers
                </label>
                <input
                  type="number"
                  min="1"
                  value={newBooking.passengers}
                  onChange={(e) => setNewBooking({ ...newBooking, passengers: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Estimated Fare</span>
                  <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    {selectedService.pricePerTrip > 0 ? `$${selectedService.pricePerTrip.toFixed(2)}` : 'Complimentary'}
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

export default TransportationModule;
