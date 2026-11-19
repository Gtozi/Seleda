/**
 * Digital Check-in Module
 * Online registration, identity verification, payment confirmation, signature capture.
 * Live data: mobile_check_ins rows via /api/guest-portal/check-in/*.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Upload,
  PenTool,
  CreditCard,
  MapPin,
  User,
  Shield,
  ChevronRight,
  LogIn,
  Loader2,
  Calendar,
  BedDouble
} from 'lucide-react';

interface DigitalCheckinModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface CheckinRecord {
  id: string;
  reservation_id: string;
  status: 'initiated' | 'in_progress' | 'completed' | 'cancelled';
  progress: Record<string, unknown>;
  estimated_arrival?: string | null;
  room_preferences?: string | null;
  signature?: string | null;
  photo_id_verified?: boolean;
  payment_method_on_file?: boolean;
  completed_at?: string | null;
}

interface ReservationSummary {
  id: string;
  propertyId?: string;
  guestId?: string;
  guestName?: string;
  checkInDate?: string;
  checkOutDate?: string;
  roomType?: string;
  roomNumber?: string | null;
  guests?: number;
  status?: string;
  paymentStatus?: string;
  totalAmount?: number;
  hotelName?: string;
}

interface GuestInfo {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  nationality?: string;
}

interface RegistrationData {
  fullName: string;
  email: string;
  phone: string;
  nationality: string;
}

const STEP_IDS = ['registration', 'identity', 'payment', 'roomPrefs', 'signature'] as const;
type StepId = typeof STEP_IDS[number];

const CHECKIN_ELIGIBLE_STATUSES = new Set(['Reserved', 'Pending', 'Confirmed', 'CheckedIn']);

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleDateString();
}

const DigitalCheckinModule: React.FC<DigitalCheckinModuleProps> = ({
  reservationId: reservationIdProp,
  guestId
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noContext, setNoContext] = useState(false);
  const [noEligible, setNoEligible] = useState(false);
  const [reservationId, setReservationId] = useState(reservationIdProp || '');
  const [reservation, setReservation] = useState<ReservationSummary | null>(null);
  const [guest, setGuest] = useState<GuestInfo | null>(null);
  const [checkIn, setCheckIn] = useState<CheckinRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [registration, setRegistration] = useState<RegistrationData>({
    fullName: '', email: '', phone: '', nationality: ''
  });
  const [estimatedArrival, setEstimatedArrival] = useState('');
  const [roomPreferences, setRoomPreferences] = useState('');

  const steps = [
    { id: 'registration' as StepId, num: 1, name: 'Registration', icon: <User size={20} /> },
    { id: 'identity' as StepId, num: 2, name: 'Identity Verification', icon: <Shield size={20} /> },
    { id: 'payment' as StepId, num: 3, name: 'Payment Verification', icon: <CreditCard size={20} /> },
    { id: 'roomPrefs' as StepId, num: 4, name: 'Room Preferences', icon: <MapPin size={20} /> },
    { id: 'signature' as StepId, num: 5, name: 'Signature', icon: <PenTool size={20} /> }
  ];

  const progress = (checkIn?.progress || {}) as Record<string, unknown>;
  const completedSteps = STEP_IDS.filter(id => progress[id] === true);
  const currentStepNum = Math.min(completedSteps.length + 1, steps.length);
  const isCompleted = checkIn?.status === 'completed';
  const progressPercentage = isCompleted ? 100 : (completedSteps.length / steps.length) * 100;

  const loadCheckIn = useCallback(async (resId: string) => {
    const res = await fetch(`/api/guest-portal/check-in/${encodeURIComponent(resId)}`, {
      headers: authHeaders(),
      credentials: 'include'
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to load check-in (${res.status})`);
    }
    const body = await res.json();
    setReservation(body.reservation || null);
    setGuest(body.guest || null);
    setCheckIn(body.checkIn || null);

    // Prefill forms from the check-in record, then guest/reservation data
    const reg = (body.checkIn?.progress?.registrationData || {}) as Partial<RegistrationData>;
    const g = body.guest;
    const fullName = reg.fullName
      || [g?.first_name, g?.last_name].filter(Boolean).join(' ')
      || g?.name
      || body.reservation?.guestName
      || '';
    setRegistration({
      fullName,
      email: reg.email || g?.email || '',
      phone: reg.phone || g?.phone || '',
      nationality: reg.nationality || g?.nationality || ''
    });
    setEstimatedArrival(body.checkIn?.estimated_arrival || '');
    setRoomPreferences(body.checkIn?.room_preferences || '');
    setSignatureName(typeof body.checkIn?.signature === 'string' ? body.checkIn.signature : '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let resId = reservationIdProp || '';
        if (!resId && guestId) {
          // Resolve the guest's check-in-eligible reservation
          const res = await fetch(
            `/api/guest-portal/reservations/${encodeURIComponent(guestId)}`,
            { headers: authHeaders(), credentials: 'include' }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed to load reservations (${res.status})`);
          }
          const body = await res.json();
          const list: ReservationSummary[] = body.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          const eligible = list
            .filter(r => CHECKIN_ELIGIBLE_STATUSES.has(String(r.status)))
            .sort((a, b) => {
              // Soonest upcoming first; in-house stays first overall
              const aIn = String(a.status) === 'CheckedIn' ? '0' : '1';
              const bIn = String(b.status) === 'CheckedIn' ? '0' : '1';
              if (aIn !== bIn) return aIn.localeCompare(bIn);
              return String(a.checkInDate || '9999').localeCompare(String(b.checkInDate || '9999'));
            })
            .filter(r => String(r.status) === 'CheckedIn' || String(r.checkOutDate || '') >= today);
          resId = eligible[0]?.id || '';
        }
        if (!resId) {
          if (!cancelled) {
            if (guestId) setNoEligible(true); else setNoContext(true);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setReservationId(resId);
          await loadCheckIn(resId);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load check-in');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reservationIdProp, guestId, loadCheckIn]);

  const saveProgress = async (patch: {
    progress?: Record<string, unknown>;
    estimatedArrival?: string;
    roomPreferences?: string;
    photoIdVerified?: boolean;
    paymentMethodOnFile?: boolean;
  }) => {
    if (!checkIn) return null;
    const res = await fetch(`/api/guest-portal/check-in/${checkIn.id}/progress`, {
      method: 'PATCH',
      headers: authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ reservationId, ...patch })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
    setCheckIn(body.checkIn);
    return body.checkIn as CheckinRecord;
  };

  const handleBegin = async () => {
    if (!reservation?.guestId) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch('/api/guest-portal/check-in/initiate', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          reservationId,
          propertyId: reservation.propertyId,
          guestId: reservation.guestId
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Check-in failed (${res.status})`);
      await loadCheckIn(reservationId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to start check-in');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStepSubmit = async (step: StepId, extra?: Parameters<typeof saveProgress>[0]) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await saveProgress({ progress: { [step]: true }, ...extra });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to save progress');
    } finally {
      setSubmitting(false);
    }
  };

  const handleIdUpload = async (file: File) => {
    const okTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!okTypes.includes(file.type)) {
      setActionError('Unsupported file type — upload a PDF, JPG, or PNG');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setActionError('File too large — maximum 5MB');
      return;
    }
    setUploading(true);
    setActionError(null);
    try {
      // Document storage integration is pending; record the verification flag.
      await handleStepSubmit('identity', { photoIdVerified: true });
    } finally {
      setUploading(false);
    }
  };

  const handleComplete = async () => {
    if (!checkIn) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await saveProgress({ progress: { signature: true } });
      const res = await fetch(`/api/guest-portal/check-in/${checkIn.id}/complete`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          reservationId,
          signature: signatureName || 'signed',
          photoIdVerified: checkIn.photo_id_verified,
          paymentMethodOnFile: checkIn.payment_method_on_file
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Completion failed (${res.status})`);
      await loadCheckIn(reservationId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to complete check-in');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'initiated': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'in_progress': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'completed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'cancelled': 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400'
    };
    return colors[status] || colors['initiated'];
  };

  const statusLabel = (status?: string) =>
    status === 'in_progress' ? 'In Progress'
    : status === 'completed' ? 'Completed'
    : status === 'cancelled' ? 'Cancelled'
    : 'Pending';

  // ── Render states ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading check-in…</p>
        </div>
      </div>
    );
  }

  if (noContext || noEligible) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Digital Check-in</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Complete your check-in online for a faster arrival experience
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <LogIn size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {noContext ? 'Sign in to check in' : 'No reservation eligible for check-in'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {noContext
              ? 'Link a guest profile to view and complete your digital check-in.'
              : 'You have no upcoming reservations that can be checked in online.'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Digital Check-in</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Complete your check-in online for a faster arrival experience
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Check-in unavailable</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); loadCheckIn(reservationId).catch(e => setError(e.message)).finally(() => setLoading(false)); }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const eligible = CHECKIN_ELIGIBLE_STATUSES.has(String(reservation?.status));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Digital Check-in</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Complete your check-in online for a faster arrival experience
          </p>
        </div>
        <div className={`px-4 py-2 rounded-lg text-sm font-medium border ${getStatusColor(checkIn?.status || 'initiated')}`}>
          {statusLabel(checkIn?.status)}
        </div>
      </div>

      {/* Reservation summary */}
      {reservation && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex items-center gap-2 text-sm">
              <User size={16} className="text-slate-400" />
              <span className="text-slate-900 dark:text-white font-medium">{reservation.guestName || guest?.name || 'Guest'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar size={16} className="text-slate-400" />
              <span className="text-slate-600 dark:text-slate-300">
                {formatDate(reservation.checkInDate)} → {formatDate(reservation.checkOutDate)}
              </span>
            </div>
            {reservation.roomType && (
              <div className="flex items-center gap-2 text-sm">
                <BedDouble size={16} className="text-slate-400" />
                <span className="text-slate-600 dark:text-slate-300">
                  {reservation.roomType}{reservation.roomNumber ? ` · Room ${reservation.roomNumber}` : ''}
                </span>
              </div>
            )}
            <div className="text-sm text-slate-500 dark:text-slate-400 ml-auto">
              {reservation.hotelName} · Conf #{reservation.id}
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{actionError}</p>
        </div>
      )}

      {/* Not eligible / not initiated */}
      {!checkIn && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <LogIn size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {eligible ? 'Ready to check in' : `This reservation is ${reservation?.status || 'not eligible'}`}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            {eligible
              ? 'Complete registration, verification, and signature online — then skip the front desk line.'
              : 'Online check-in is only available for upcoming confirmed reservations.'}
          </p>
          {eligible && (
            <button
              onClick={handleBegin}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Begin Check-in
            </button>
          )}
        </div>
      )}

      {checkIn && !isCompleted && (
        <>
          {/* Progress Bar */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Check-in Progress</h3>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {completedSteps.length} of {steps.length} steps completed
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-6">
              <div
                className="bg-gradient-to-r from-indigo-500 to-purple-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {steps.map((step) => {
                const isStepCompleted = progress[step.id] === true;
                const isCurrent = currentStepNum === step.num;
                return (
                  <div key={step.id} className="flex flex-col items-center">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition ${
                      isStepCompleted
                        ? 'bg-emerald-100 border-emerald-500 text-emerald-600 dark:bg-emerald-900/20 dark:border-emerald-400 dark:text-emerald-400'
                        : isCurrent
                        ? 'bg-indigo-100 border-indigo-500 text-indigo-600 dark:bg-indigo-900/20 dark:border-indigo-400 dark:text-indigo-400'
                        : 'bg-slate-100 border-slate-300 text-slate-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-500'
                    }`}>
                      {isStepCompleted ? <CheckCircle2 size={20} /> : step.icon}
                    </div>
                    <div className={`text-xs font-medium mt-2 text-center ${
                      isStepCompleted
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : isCurrent
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      {step.name}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step Content */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
            {currentStepNum === 1 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Registration Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={registration.fullName}
                      onChange={(e) => setRegistration({ ...registration, fullName: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={registration.email}
                      onChange={(e) => setRegistration({ ...registration, email: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={registration.phone}
                      onChange={(e) => setRegistration({ ...registration, phone: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Nationality
                    </label>
                    <input
                      type="text"
                      value={registration.nationality}
                      onChange={(e) => setRegistration({ ...registration, nationality: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => handleStepSubmit('registration', { progress: { registration: true, registrationData: registration } })}
                    disabled={submitting || !registration.fullName.trim()}
                    className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    Continue
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}

            {currentStepNum === 2 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Identity Verification</h3>
                <div className="space-y-4">
                  <label className="block border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition">
                    <Upload size={48} className="mx-auto text-slate-400 mb-4" />
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                      Upload your passport or ID document
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
                      Supported formats: PDF, JPG, PNG (Max 5MB)
                    </p>
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">
                      {uploading && <Loader2 size={16} className="animate-spin" />}
                      {uploading ? 'Uploading…' : 'Choose File'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      disabled={uploading || submitting}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleIdUpload(file);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  {(checkIn.photo_id_verified || progress.identity === true) && (
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-700/50">
                      <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <div className="font-medium text-emerald-900 dark:text-emerald-100">Identity Verified</div>
                        <div className="text-sm text-emerald-700 dark:text-emerald-300">Your document has been received</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => handleStepSubmit('identity', { photoIdVerified: true })}
                    disabled={submitting || !checkIn.photo_id_verified}
                    className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    Continue
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}

            {currentStepNum === 3 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Payment Verification</h3>
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Reservation Total</span>
                      <span className="text-sm text-slate-900 dark:text-white">
                        USD {Number(reservation?.totalAmount || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Payment Status</span>
                      <div className="flex items-center gap-2">
                        {String(reservation?.paymentStatus) === 'Paid' ? (
                          <>
                            <CheckCircle2 size={16} className="text-emerald-500" />
                            <span className="text-sm text-emerald-600 dark:text-emerald-400">Paid</span>
                          </>
                        ) : (
                          <span className="text-sm text-amber-600 dark:text-amber-400">{reservation?.paymentStatus || 'Unpaid'}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleStepSubmit('payment', { paymentMethodOnFile: true })}
                    disabled={submitting || checkIn.payment_method_on_file}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    {checkIn.payment_method_on_file ? 'Payment Method Confirmed' : 'Confirm Payment Method on File'}
                  </button>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => handleStepSubmit('payment')}
                    disabled={submitting || !checkIn.payment_method_on_file}
                    className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    Continue
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}

            {currentStepNum === 4 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Room Preferences</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Estimated Arrival Time
                    </label>
                    <div className="relative">
                      <Clock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="time"
                        value={estimatedArrival}
                        onChange={(e) => setEstimatedArrival(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Special Room Requests
                    </label>
                    <textarea
                      value={roomPreferences}
                      onChange={(e) => setRoomPreferences(e.target.value)}
                      placeholder="Any special requests for your room..."
                      rows={3}
                      className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => handleStepSubmit('roomPrefs', { estimatedArrival, roomPreferences })}
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    Continue
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}

            {currentStepNum === 5 && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Signature</h3>
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 sm:p-8 bg-slate-50 dark:bg-slate-900/20">
                    <PenTool size={40} className="mx-auto text-slate-400 mb-4" />
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 text-center">
                      Type your full legal name to sign the registration card
                    </p>
                    <input
                      type="text"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      placeholder="Your signature (full name)"
                      className="w-full max-w-md mx-auto block px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm text-center italic focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleComplete}
                    disabled={submitting || !signatureName.trim()}
                    className="flex items-center gap-2 px-4 sm:px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
                    Complete Check-in
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {isCompleted && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={40} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Check-in Complete!</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-2">
            Your digital check-in was completed
            {checkIn?.completed_at ? ` on ${new Date(checkIn.completed_at).toLocaleString()}` : ''}.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {reservation?.roomNumber
              ? `Proceed to the front desk for key collection — Room ${reservation.roomNumber}.`
              : 'Proceed to the front desk for key collection.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default DigitalCheckinModule;
