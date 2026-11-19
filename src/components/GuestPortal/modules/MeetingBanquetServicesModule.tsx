/**
 * Meeting & Banquet Services Module
 * Meeting room booking, banquet inquiry, conference packages, catering requests.
 *
 * DB-integrated: venues from `banquet_venues` and inquiries create real
 * `banquet_events` rows (client_id = guest id, status 'Inquiry') via
 * /api/guest-portal/meetings/* — the same entities the staff events portal
 * manages.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  Send,
  Loader2,
  AlertCircle,
  MapPin,
  Building2
} from 'lucide-react';

interface MeetingBanquetServicesModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface Venue {
  id: string;
  venue_name: string;
  venue_type: string | null;
  capacity: number | null;
  area: number | null;
  floor: string | null;
  features: string[] | null;
  layouts: string[] | null;
  hourly_rate: number | null;
  daily_rate: number | null;
}

interface EventInquiry {
  id: string;
  event_name: string;
  event_type: string;
  event_date: string;
  guest_count: number | null;
  venue_ids: string[] | null;
  status: string;
  notes: string | null;
  created_at: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const EVENT_TYPES = [
  'Meeting', 'Conference', 'CorporateEvent', 'Banquet', 'Wedding',
  'Birthday', 'Anniversary', 'CocktailReception', 'GalaDinner',
  'Exhibition', 'ProductLaunch', 'Graduation', 'ReligiousEvent', 'Other',
];

const MeetingBanquetServicesModule: React.FC<MeetingBanquetServicesModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [inquiries, setInquiries] = useState<EventInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [newInquiry, setNewInquiry] = useState({
    type: 'Banquet',
    date: '',
    time: '',
    guests: 10,
    requirements: ''
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
      const res = await fetch(`/api/guest-portal/meetings/overview/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(), credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load (${res.status})`);
      setVenues(payload.venues || []);
      setInquiries(payload.events || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load meeting services');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadData(); }, [loadData]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Inquiry': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Tentative': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Planning': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'Confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'InProgress': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Completed': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
    };
    return colors[status] || colors['Inquiry'];
  };

  const venueName = (ids: string[] | null) => {
    if (!ids?.length) return null;
    return venues.find(v => v.id === ids[0])?.venue_name || null;
  };

  const submitInquiry = async (payload: {
    event_type: string; event_name?: string; venue_id?: string;
    date: string; time?: string; guests: number; requirements?: string;
  }) => {
    const res = await fetch('/api/guest-portal/meetings/inquiries', {
      method: 'POST',
      headers: authHeaders(true),
      credentials: 'include',
      body: JSON.stringify({
        guest_id: guestId,
        reservation_id: reservationId || undefined,
        ...payload,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Inquiry failed (${res.status})`);
  };

  const handleSubmitBooking = async () => {
    if (!selectedVenue || !guestId || submitting) return;
    if (!newInquiry.date) {
      setModalError('Please pick a date');
      return;
    }
    try {
      setSubmitting(true);
      setModalError(null);
      await submitInquiry({
        event_type: 'Meeting',
        event_name: `${selectedVenue.venue_name} booking`,
        venue_id: selectedVenue.id,
        date: newInquiry.date,
        time: newInquiry.time || undefined,
        guests: newInquiry.guests,
        requirements: newInquiry.requirements || undefined,
      });
      setShowBookingModal(false);
      setSelectedVenue(null);
      setNewInquiry({ type: 'Banquet', date: '', time: '', guests: 10, requirements: '' });
      await loadData();
    } catch (e: any) {
      setModalError(e?.message || 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitInquiry = async () => {
    if (!guestId || submitting) return;
    if (!newInquiry.date) {
      setModalError('Please pick a date');
      return;
    }
    try {
      setSubmitting(true);
      setModalError(null);
      await submitInquiry({
        event_type: newInquiry.type,
        date: newInquiry.date,
        time: newInquiry.time || undefined,
        guests: newInquiry.guests,
        requirements: newInquiry.requirements || undefined,
      });
      setShowInquiryModal(false);
      setNewInquiry({ type: 'Banquet', date: '', time: '', guests: 10, requirements: '' });
      await loadData();
    } catch (e: any) {
      setModalError(e?.message || 'Inquiry failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInquiry = async (eventId: string) => {
    if (!confirm('Are you sure you want to cancel this inquiry?') || cancelling) return;
    try {
      setCancelling(eventId);
      const res = await fetch(`/api/guest-portal/meetings/events/${encodeURIComponent(eventId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: reservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Cancel failed (${res.status})`);
      setInquiries(prev => prev.map(e =>
        e.id === eventId ? { ...e, status: 'Cancelled' } : e
      ));
    } catch (e: any) {
      setError(e?.message || 'Could not cancel inquiry');
    } finally {
      setCancelling(null);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Meeting & Banquet Services</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Book meeting rooms and inquire about banquet services
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Building2 size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to plan an event</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to browse venues and submit event inquiries.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading meeting services...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Meeting & Banquet Services</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Book meeting rooms and inquire about banquet services
          </p>
        </div>
        <button
          onClick={() => { setModalError(null); setShowInquiryModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
        >
          <Send size={16} />
          Banquet Inquiry
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Meeting Rooms */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Meeting Rooms & Venues</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {venues.map((venue) => (
            <div key={venue.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="aspect-video bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900/20 dark:to-indigo-900/20 flex items-center justify-center">
                <Users size={48} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-slate-900 dark:text-white">{venue.venue_name}</h4>
                  {venue.venue_type && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400 whitespace-nowrap ml-2">
                      {venue.venue_type}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400 mb-3 flex-wrap">
                  {venue.capacity != null && (
                    <div className="flex items-center gap-1">
                      <Users size={14} />
                      <span>{venue.capacity} people</span>
                    </div>
                  )}
                  {venue.floor && (
                    <div className="flex items-center gap-1">
                      <MapPin size={14} />
                      <span>{venue.floor}</span>
                    </div>
                  )}
                  {(venue.hourly_rate || venue.daily_rate) && (
                    <div className="flex items-center gap-1">
                      <Clock size={14} />
                      <span>
                        {venue.hourly_rate ? `$${Number(venue.hourly_rate).toFixed(0)}/hr` : ''}
                        {venue.hourly_rate && venue.daily_rate ? ' · ' : ''}
                        {venue.daily_rate ? `$${Number(venue.daily_rate).toFixed(0)}/day` : ''}
                      </span>
                    </div>
                  )}
                </div>
                {venue.features && venue.features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {venue.features.slice(0, 2).map((feature) => (
                      <span key={feature} className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs">
                        {feature}
                      </span>
                    ))}
                    {venue.features.length > 2 && (
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs">
                        +{venue.features.length - 2} more
                      </span>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setSelectedVenue(venue); setModalError(null); setShowBookingModal(true); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
                >
                  <Calendar size={16} />
                  Book Room
                </button>
              </div>
            </div>
          ))}
          {!venues.length && (
            <p className="text-slate-400 col-span-full text-center py-8 text-sm">
              No venues are currently listed — submit a banquet inquiry and the events team will assist.
            </p>
          )}
        </div>
      </div>

      {/* My Inquiries */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Inquiries & Events</h3>
        <div className="space-y-3">
          {inquiries.map((inquiry) => (
            <div key={inquiry.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h4 className="font-medium text-slate-900 dark:text-white">{inquiry.event_name}</h4>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(inquiry.status)}`}>
                      {inquiry.status}
                    </div>
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {inquiry.event_type}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Date</div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {new Date(inquiry.event_date).toLocaleDateString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Guests</div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {inquiry.guest_count ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Venue</div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {venueName(inquiry.venue_ids) || 'To be assigned'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Submitted</div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {new Date(inquiry.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  {inquiry.notes && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{inquiry.notes}</p>
                  )}
                </div>
                {['Inquiry', 'Tentative', 'Planning'].includes(inquiry.status) && (
                  <button
                    onClick={() => handleCancelInquiry(inquiry.id)}
                    disabled={cancelling === inquiry.id}
                    className="ml-4 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                  >
                    {cancelling === inquiry.id ? <Loader2 size={14} className="animate-spin" /> : '✕'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!inquiries.length && (
            <p className="text-slate-400 text-center py-4 sm:py-6 text-sm">
              No inquiries yet — book a venue or submit a banquet inquiry above.
            </p>
          )}
        </div>
      </div>

      {/* Venue Booking Modal */}
      {showBookingModal && selectedVenue && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Book {selectedVenue.venue_name}
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
                  value={newInquiry.date}
                  onChange={(e) => setNewInquiry({ ...newInquiry, date: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Preferred Time
                </label>
                <input
                  type="time"
                  value={newInquiry.time}
                  onChange={(e) => setNewInquiry({ ...newInquiry, time: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Expected Guests
                </label>
                <input
                  type="number"
                  min="1"
                  value={newInquiry.guests}
                  onChange={(e) => setNewInquiry({ ...newInquiry, guests: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Requirements <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={newInquiry.requirements}
                  onChange={(e) => setNewInquiry({ ...newInquiry, requirements: e.target.value })}
                  placeholder="Setup, catering, AV equipment..."
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Rate</span>
                  <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                    {selectedVenue.hourly_rate ? `$${Number(selectedVenue.hourly_rate).toFixed(0)}/hr` : ''}
                    {selectedVenue.hourly_rate && selectedVenue.daily_rate ? ' · ' : ''}
                    {selectedVenue.daily_rate ? `$${Number(selectedVenue.daily_rate).toFixed(0)}/day` : ''}
                    {!selectedVenue.hourly_rate && !selectedVenue.daily_rate ? 'On request' : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  The events team will confirm availability and final pricing.
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

      {/* Inquiry Modal */}
      {showInquiryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Banquet Inquiry</h3>
            {modalError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertCircle size={16} /> {modalError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Event Type
                </label>
                <select
                  value={newInquiry.type}
                  onChange={(e) => setNewInquiry({ ...newInquiry, type: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={newInquiry.date}
                  onChange={(e) => setNewInquiry({ ...newInquiry, date: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Preferred Time
                </label>
                <input
                  type="time"
                  value={newInquiry.time}
                  onChange={(e) => setNewInquiry({ ...newInquiry, time: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Expected Guests
                </label>
                <input
                  type="number"
                  min="1"
                  value={newInquiry.guests}
                  onChange={(e) => setNewInquiry({ ...newInquiry, guests: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Special Requirements
                </label>
                <textarea
                  value={newInquiry.requirements}
                  onChange={(e) => setNewInquiry({ ...newInquiry, requirements: e.target.value })}
                  placeholder="Describe your requirements..."
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowInquiryModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitInquiry}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Submit Inquiry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingBanquetServicesModule;
