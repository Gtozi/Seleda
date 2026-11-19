/**
 * Concierge Services Module
 * Request airport transfers, tours, restaurant recommendations, tickets, shopping assistance
 *
 * DB-integrated: catalog from /api/guest-portal/concierge/catalog/:guestId
 * (shared `guest_services` table) and requests persisted to `guest_requests`
 * with assigned_department='Concierge' — the same queue the staff Concierge
 * portal works from.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ConciergeBell,
  Plane,
  Car,
  MapPin,
  Ticket,
  ShoppingBag,
  BriefcaseMedical,
  Info,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  Package,
  Crown,
  Calendar,
  Loader2,
  Star
} from 'lucide-react';

interface ConciergeServicesModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface CatalogService {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number | null;
}

interface ServiceRequest {
  id: string;
  request_number: string | null;
  type: string;
  description: string;
  status: 'Open' | 'Assigned' | 'In Progress' | 'Completed' | 'Cancelled';
  submittedAt: string;
  scheduledAt?: string;
  completedAt?: string;
  rating?: number | null;
  feedback?: string | null;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function serviceIcon(category: string, name: string) {
  const c = `${category} ${name}`.toLowerCase();
  if (/airport|transfer|shuttle|taxi|transport/.test(c)) return <Plane size={24} />;
  if (/car|driver|vehicle/.test(c)) return <Car size={24} />;
  if (/tour|excursion|sightseeing|itinerary/.test(c)) return <MapPin size={24} />;
  if (/ticket|event|show/.test(c)) return <Ticket size={24} />;
  if (/shop/.test(c)) return <ShoppingBag size={24} />;
  if (/medical|pharmacy|doctor/.test(c)) return <BriefcaseMedical size={24} />;
  if (/luggage|parcel|package|bag/.test(c)) return <Package size={24} />;
  if (/vip|butler|amenity/.test(c)) return <Crown size={24} />;
  if (/wake|reminder|book|reservation|restaurant|dining/.test(c)) return <Calendar size={24} />;
  if (/restaurant|dining/.test(c)) return <ConciergeBell size={24} />;
  return <Info size={24} />;
}

// Map the staff queue's status vocabulary onto the guest-facing labels.
const STATUS_LABEL: Record<string, ServiceRequest['status']> = {
  Open: 'Open',
  Assigned: 'In Progress',
  'In Progress': 'In Progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

// Star rating + optional comment for a completed request. Posts to
// PATCH /api/guest-portal/concierge/requests/:id/rating (ownership-checked).
const RatingControl: React.FC<{
  requestId: string;
  reservationId?: string;
  onSubmitted: (rating: number, feedback: string | null) => void;
}> = ({ requestId, reservationId, onSubmitted }) => {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async () => {
    if (!rating || saving) return;
    try {
      setSaving(true);
      setSubmitError(null);
      const res = await fetch(`/api/guest-portal/concierge/requests/${encodeURIComponent(requestId)}/rating`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ rating, feedback: feedback.trim() || null, reservationId: reservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Rating failed (${res.status})`);
      onSubmitted(rating, feedback.trim() || null);
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to submit rating');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            className="p-0.5"
            aria-label={`Rate ${n} of 5`}
          >
            <Star
              size={18}
              className={(hovered || rating) >= n
                ? 'fill-amber-400 text-amber-400'
                : 'text-slate-300 dark:text-slate-600'}
            />
          </button>
        ))}
        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">Rate this service</span>
      </div>
      {rating > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Anything to add? (optional)"
            className="flex-1 px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Submit
          </button>
        </div>
      )}
      {submitError && <p className="text-xs text-red-600 dark:text-red-400">{submitError}</p>}
    </div>
  );
};

const ConciergeServicesModule: React.FC<ConciergeServicesModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [feedbackPrompt, setFeedbackPrompt] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [selectedService, setSelectedService] = useState<string>('');
  const [requestDescription, setRequestDescription] = useState('');
  const [requestDateTime, setRequestDateTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const qs = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
      const [catalogRes, requestsRes] = await Promise.all([
        fetch(`/api/guest-portal/concierge/catalog/${encodeURIComponent(guestId)}${qs}`, {
          headers: authHeaders(), credentials: 'include',
        }),
        fetch(`/api/guest-portal/concierge/requests/${encodeURIComponent(guestId)}${qs}`, {
          headers: authHeaders(), credentials: 'include',
        }),
      ]);
      const catalogPayload = await catalogRes.json().catch(() => ({}));
      const requestsPayload = await requestsRes.json().catch(() => ({}));
      if (!catalogRes.ok) throw new Error(catalogPayload.error || `Catalog failed (${catalogRes.status})`);
      if (!requestsRes.ok) throw new Error(requestsPayload.error || `Requests failed (${requestsRes.status})`);

      setServices(catalogPayload.services || []);
      setRequests((requestsPayload.requests || []).map((r: any) => ({
        id: r.id,
        request_number: r.request_number,
        type: r.request_type || 'Concierge',
        description: r.description || '',
        status: STATUS_LABEL[r.status] || 'Open',
        submittedAt: r.submitted_at || r.created_at,
        scheduledAt: r.scheduled_for || undefined,
        completedAt: r.completed_at || undefined,
        rating: r.rating ?? null,
        feedback: r.feedback ?? null,
      })));
      setFeedbackPrompt(requestsPayload.feedback_prompt !== false);
    } catch (e: any) {
      setError(e?.message || 'Failed to load concierge services');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getStatusColor = (status: string) => {
    const colors = {
      'Open': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'Completed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
    };
    return colors[status as keyof typeof colors] || colors['Open'];
  };

  const handleSubmitRequest = async () => {
    if (!selectedService || !requestDescription.trim() || !guestId) return;

    try {
      setSubmitting(true);
      setFormError(null);
      const service = services.find(s => s.id === selectedService);
      const res = await fetch('/api/guest-portal/concierge/requests', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: guestId,
          reservation_id: reservationId || undefined,
          service_id: service?.id,
          service_name: service?.name,
          request_details: requestDescription.trim(),
          scheduled_for: requestDateTime ? new Date(requestDateTime).toISOString() : undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);

      setShowNewRequestModal(false);
      setSelectedService('');
      setRequestDescription('');
      setRequestDateTime('');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Are you sure you want to cancel this request?')) return;
    try {
      const res = await fetch(`/api/guest-portal/concierge/requests/${encodeURIComponent(requestId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: reservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Cancel failed (${res.status})`);
      setRequests(requests.map(req =>
        req.id === requestId ? { ...req, status: 'Cancelled' as const } : req
      ));
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel request');
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Concierge Services</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Personal assistance for all your needs
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <ConciergeBell size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to request concierge services</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to browse services and submit requests.
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Concierge Services</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Personal assistance for all your needs
          </p>
        </div>
        <button
          onClick={() => setShowNewRequestModal(true)}
          disabled={!guestId}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={16} />
          New Request
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Services Grid */}
      {loading && services.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {services.map((service) => (
            <button
              key={service.id}
              onClick={() => {
                setSelectedService(service.id);
                setShowNewRequestModal(true);
              }}
              className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition text-left"
            >
              <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3">
                {serviceIcon(service.category, service.name)}
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-1">{service.name}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">{service.description || ''}</p>
            </button>
          ))}
          {services.length === 0 && !loading && (
            <p className="col-span-full py-4 sm:py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No concierge services are currently available.
            </p>
          )}
        </div>
      )}

      {/* My Requests */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Requests</h3>
        <div className="space-y-3">
          {requests.map((request) => (
            <div key={request.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-medium text-slate-900 dark:text-white">{request.type}</h4>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(request.status)}`}>
                      {request.status}
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{request.description}</p>
                  <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      <span>Submitted: {new Date(request.submittedAt).toLocaleString()}</span>
                    </div>
                    {request.scheduledAt && (
                      <div className="flex items-center gap-1">
                        <Calendar size={12} />
                        <span>Scheduled: {new Date(request.scheduledAt).toLocaleString()}</span>
                      </div>
                    )}
                    {request.completedAt && (
                      <div className="flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        <span>Completed: {new Date(request.completedAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                  {request.status === 'Completed' && (
                    request.rating ? (
                      <div className="mt-2 flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            size={14}
                            className={request.rating! >= n
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-300 dark:text-slate-600'}
                          />
                        ))}
                        {request.feedback && (
                          <span className="ml-2 truncate text-xs text-slate-500 dark:text-slate-400">
                            — {request.feedback}
                          </span>
                        )}
                      </div>
                    ) : feedbackPrompt && (
                      <RatingControl
                        requestId={request.id}
                        reservationId={reservationId}
                        onSubmitted={(rating, feedback) =>
                          setRequests((prev) =>
                            prev.map((r) => (r.id === request.id ? { ...r, rating, feedback } : r))
                          )
                        }
                      />
                    )
                  )}
                </div>
                {request.status === 'Open' && (
                  <button
                    onClick={() => handleCancelRequest(request.id)}
                    className="ml-4 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {requests.length === 0 && !loading && (
            <p className="py-4 sm:py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No requests yet — submit one above and the concierge team will take care of it.
            </p>
          )}
        </div>
      </div>

      {/* New Request Modal */}
      {showNewRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">New Concierge Request</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Service Type
                </label>
                <select
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a service...</option>
                  {services.map(service => (
                    <option key={service.id} value={service.id}>{service.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Description
                </label>
                <textarea
                  value={requestDescription}
                  onChange={(e) => setRequestDescription(e.target.value)}
                  placeholder="Describe your request in detail..."
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Requested for <span className="font-normal text-slate-400">(optional — e.g. wake-up time)</span>
                </label>
                <input
                  type="datetime-local"
                  value={requestDateTime}
                  onChange={(e) => setRequestDateTime(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {formError && (
                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowNewRequestModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitRequest}
                disabled={!selectedService || !requestDescription.trim() || submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConciergeServicesModule;
