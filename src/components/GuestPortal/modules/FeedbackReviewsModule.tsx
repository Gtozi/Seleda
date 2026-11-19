/**
 * Feedback & Reviews Module
 * Guest feedback backed by `guest_feedback` — the same rows the hotel
 * reviews on the staff side. Submit/list via /api/guest-portal/feedback/*.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Star,
  ThumbsUp,
  MessageSquare,
  Send,
  CheckCircle2,
  Building,
  Users,
  UtensilsCrossed,
  Sparkles,
  Bed,
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';

interface FeedbackReviewsModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface Review {
  id: string;
  category: string;
  rating: number;
  comments: string;
  submitted_at: string;
}

const FEEDBACK_TYPES = [
  { id: 'Stay', name: 'Overall Stay', icon: <Star size={20} /> },
  { id: 'Room', name: 'Room', icon: <Bed size={20} /> },
  { id: 'Staff', name: 'Staff', icon: <Users size={20} /> },
  { id: 'Food', name: 'Food & Beverage', icon: <UtensilsCrossed size={20} /> },
  { id: 'Cleanliness', name: 'Cleanliness', icon: <Sparkles size={20} /> },
  { id: 'Facilities', name: 'Facilities', icon: <Building size={20} /> },
  { id: 'Compliment', name: 'Compliment', icon: <ThumbsUp size={20} /> },
  { id: 'Suggestion', name: 'Suggestion', icon: <MessageSquare size={20} /> },
  { id: 'Complaint', name: 'Complaint', icon: <AlertCircle size={20} /> },
];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const FeedbackReviewsModule: React.FC<FeedbackReviewsModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [resolvedReservationId, setResolvedReservationId] = useState<string | undefined>(reservationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewFeedbackModal, setShowNewFeedbackModal] = useState(false);
  const [selectedType, setSelectedType] = useState('Stay');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    if (!guestId) {
      setReviews([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let resvId = reservationId;
      if (!resvId) {
        // Needed as the canActForGuest credential — in-house stay first,
        // else soonest upcoming.
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
      const res = await fetch(`/api/guest-portal/feedback/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load reviews (${res.status})`);
      setReviews(payload.feedback || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  const openModal = (type: string) => {
    setSelectedType(type);
    setSubmitError(null);
    setShowNewFeedbackModal(true);
  };

  const handleSubmitFeedback = async () => {
    if (!guestId || !resolvedReservationId || rating === 0 || !comment.trim() || submitting) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const res = await fetch('/api/guest-portal/feedback', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guestId,
          reservationId: resolvedReservationId,
          category: selectedType,
          rating,
          comments: comment.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to submit (${res.status})`);
      setShowNewFeedbackModal(false);
      setRating(0);
      setComment('');
      setSelectedType('Stay');
      await loadReviews();
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (currentRating: number, interactive: boolean = false) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => interactive && setRating(star)}
            disabled={!interactive}
            className={`transition ${
              interactive ? 'cursor-pointer hover:scale-110' : 'cursor-default'
            }`}
          >
            <Star
              size={20}
              className={star <= currentRating ? 'text-amber-500 fill-amber-500' : 'text-slate-300'}
            />
          </button>
        ))}
      </div>
    );
  };

  const iconFor = (category: string) =>
    FEEDBACK_TYPES.find(t => t.id === category)?.icon || <MessageSquare size={20} />;

  const nameFor = (category: string) =>
    FEEDBACK_TYPES.find(t => t.id === category)?.name || category;

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <MessageSquare className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in required</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in to share feedback and see your reviews.
          </p>
        </div>
      </div>
    );
  }

  const canSubmit = !!resolvedReservationId;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Feedback & Reviews</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Share your experience and help us improve
          </p>
        </div>
        <button
          onClick={() => openModal('Stay')}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={16} />
          Submit Feedback
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!canSubmit && !loading && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Feedback can be submitted once you have a current or upcoming reservation.
          </p>
        </div>
      )}

      {/* Feedback Categories */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {FEEDBACK_TYPES.slice(0, 6).map((type) => (
          <button
            key={type.id}
            onClick={() => openModal(type.id)}
            disabled={!canSubmit}
            className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto mb-2">
              {type.icon}
            </div>
            <h3 className="font-medium text-slate-900 dark:text-white text-sm">{type.name}</h3>
          </button>
        ))}
      </div>

      {/* My Reviews */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Reviews</h3>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No feedback submitted yet — your reviews will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      {iconFor(review.category)}
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-900 dark:text-white">{nameFor(review.category)}</h4>
                      <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <CheckCircle2 size={12} />
                        <span>Submitted: {new Date(review.submitted_at || (review as any).created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  {renderStars(review.rating)}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{review.comments}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Feedback */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Feedback</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => openModal('Compliment')}
            disabled={!canSubmit}
            className="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <ThumbsUp size={20} />
            </div>
            <div className="text-left">
              <div className="font-medium text-slate-900 dark:text-white">Compliment</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Share something you loved</div>
            </div>
          </button>
          <button
            onClick={() => openModal('Suggestion')}
            disabled={!canSubmit}
            className="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/20 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400">
              <MessageSquare size={20} />
            </div>
            <div className="text-left">
              <div className="font-medium text-slate-900 dark:text-white">Suggestion</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Help us improve</div>
            </div>
          </button>
          <button
            onClick={() => openModal('Complaint')}
            disabled={!canSubmit}
            className="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center text-red-600 dark:text-red-400">
              <AlertCircle size={20} />
            </div>
            <div className="text-left">
              <div className="font-medium text-slate-900 dark:text-white">Complaint</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Tell us what went wrong</div>
            </div>
          </button>
        </div>
      </div>

      {/* New Feedback Modal */}
      {showNewFeedbackModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Submit Feedback</h3>
              <button
                onClick={() => setShowNewFeedbackModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Feedback Type
                </label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {FEEDBACK_TYPES.map(type => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Rating
                </label>
                {renderStars(rating, true)}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Your Feedback
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Share your experience..."
                  rows={4}
                  maxLength={2000}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {submitError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle size={14} />
                  {submitError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowNewFeedbackModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFeedback}
                disabled={rating === 0 || !comment.trim() || submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedbackReviewsModule;
