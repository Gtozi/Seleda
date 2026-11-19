/**
 * Reservations Module
 * Search availability, book rooms, modify/cancel reservations, view booking history
 *
 * DB-integrated via /api/guest-portal/reservations/* — reads/writes the shared
 * `reservations` table the front office manages. "New Reservation" hands off to
 * the public booking flow at /public-portal?section=booking.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Plus,
  Edit,
  X,
  Clock,
  AlertCircle,
  Filter,
  Loader2
} from 'lucide-react';

interface ReservationsModuleProps {
  reservationId?: string;
  guestId?: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

interface Reservation {
  id: string;
  confirmationNumber: string;
  hotelName: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  roomType: string;
  roomNumber?: string | null;
  ratePlan?: string | null;
  packages: string[];
  totalAmount: number;
  currency: string;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid' | 'Refunded' | string;
  status: 'Reserved' | 'Pending' | 'Confirmed' | 'CheckedIn' | 'CheckedOut' | 'Cancelled' | 'NoShow' | string;
}

const ReservationsModule: React.FC<ReservationsModuleProps> = ({
  reservationId: contextReservationId,
  guestId
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'bookings' | 'history'>('bookings');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [modifyForm, setModifyForm] = useState({ checkIn: '', checkOut: '' });
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadReservations = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cred = contextReservationId ? `?reservationId=${encodeURIComponent(contextReservationId)}` : '';
      const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}${cred}`, {
        headers: authHeaders(), credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load reservations (${res.status})`);
      setReservations(payload.reservations || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, [guestId, contextReservationId]);

  useEffect(() => { loadReservations(); }, [loadReservations]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Confirmed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Reserved': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Pending': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'CheckedIn': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'CheckedOut': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'Completed': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400',
      'NoShow': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
    };
    return colors[status] || colors['Pending'];
  };

  const getPaymentStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Paid': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Partial': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Unpaid': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'Pending': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'Refunded': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400'
    };
    return colors[status] || colors['Unpaid'];
  };

  const filteredReservations = reservations.filter(res => {
    if (statusFilter === 'All') return true;
    return res.status === statusFilter;
  });

  const handleModify = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setModifyForm({ checkIn: reservation.checkInDate, checkOut: reservation.checkOutDate });
    setModifyError(null);
    setShowModifyModal(true);
  };

  const handleSaveModify = async () => {
    if (!selectedReservation || !guestId) return;
    setSaving(true);
    setModifyError(null);
    try {
      const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(selectedReservation.id)}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          reservationId: contextReservationId || selectedReservation.id,
          checkInDate: modifyForm.checkIn,
          checkOutDate: modifyForm.checkOut,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Modify failed (${res.status})`);
      setShowModifyModal(false);
      setSelectedReservation(null);
      loadReservations();
    } catch (e: any) {
      setModifyError(e?.message || 'Failed to modify reservation');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (reservation: Reservation) => {
    if (!confirm(`Cancel reservation ${reservation.confirmationNumber}? This cannot be undone.`)) return;
    setCancellingId(reservation.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(reservation.id)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: contextReservationId || reservation.id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Cancel failed (${res.status})`);
      loadReservations();
    } catch (e: any) {
      setActionError(e?.message || 'Failed to cancel reservation');
    } finally {
      setCancellingId(null);
    }
  };

  const calculateNights = (checkIn: string, checkOut: string) => {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffTime = end.getTime() - start.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const isMutable = (status: string) => ['Reserved', 'Pending', 'Confirmed'].includes(status);

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-slate-500 dark:text-slate-400">Sign in to view your reservations.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex items-center gap-3 text-slate-500 dark:text-slate-400">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading your reservations…</span>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reservations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Book, modify, or manage your reservations
          </p>
        </div>
        <button
          onClick={() => navigate('/public-portal?section=booking')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
        >
          <Plus size={16} />
          New Reservation
        </button>
      </div>

      {(error || actionError) && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-lg text-red-700 dark:text-red-400 text-sm">
          <AlertCircle size={16} />
          {error || actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('bookings')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition ${
            activeTab === 'bookings'
              ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300'
          }`}
        >
          <Calendar size={18} />
          My Bookings
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition ${
            activeTab === 'history'
              ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300'
          }`}
        >
          <Clock size={18} />
          Booking History
        </button>
      </div>

      {/* Bookings Tab */}
      {activeTab === 'bookings' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-4">
              <Filter size={18} className="text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="All">All Status</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Reserved">Reserved</option>
                <option value="Pending">Pending</option>
                <option value="CheckedIn">Checked In</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Reservations List — bookings tab shows upcoming/active stays */}
          <div className="space-y-4">
            {filteredReservations.length === 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No reservations found{statusFilter !== 'All' ? ` with status "${statusFilter}"` : ''}.
              </div>
            )}
            {filteredReservations.map((reservation) => (
              <div key={reservation.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {reservation.hotelName}
                      </h3>
                      <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(reservation.status)}`}>
                        {reservation.status}
                      </div>
                      <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getPaymentStatusColor(reservation.paymentStatus)}`}>
                        {reservation.paymentStatus}
                      </div>
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                      <span className="font-medium">Confirmation:</span> {reservation.confirmationNumber}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Check-in</div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {new Date(reservation.checkInDate).toLocaleDateString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Check-out</div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {new Date(reservation.checkOutDate).toLocaleDateString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Duration</div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {calculateNights(reservation.checkInDate, reservation.checkOutDate)} nights
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Guests</div>
                        <div className="font-medium text-slate-900 dark:text-white">{reservation.guests}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Room Type</div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {reservation.roomType || 'Any'}{reservation.roomNumber ? ` · Room ${reservation.roomNumber}` : ''}
                        </div>
                      </div>
                      {reservation.ratePlan && (
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Rate Plan</div>
                          <div className="font-medium text-slate-900 dark:text-white">{reservation.ratePlan}</div>
                        </div>
                      )}
                      {reservation.packages.length > 0 && (
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Package</div>
                          <div className="font-medium text-slate-900 dark:text-white">{reservation.packages.join(', ')}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Total</div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {reservation.currency} {reservation.totalAmount.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {isMutable(reservation.status) && (
                      <>
                        <button
                          onClick={() => handleModify(reservation)}
                          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
                        >
                          <Edit size={16} />
                          Modify
                        </button>
                        <button
                          onClick={() => handleCancel(reservation)}
                          disabled={cancellingId === reservation.id}
                          className="flex items-center gap-2 px-3 py-2 text-sm border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                        >
                          {cancellingId === reservation.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Booking History</h2>
          <div className="space-y-4">
            {reservations.filter(r => ['CheckedOut', 'Completed', 'Cancelled', 'NoShow'].includes(r.status)).length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No past bookings yet.</p>
            )}
            {reservations.filter(r => ['CheckedOut', 'Completed', 'Cancelled', 'NoShow'].includes(r.status)).map((reservation) => (
              <div key={reservation.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">{reservation.hotelName}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      {new Date(reservation.checkInDate).toLocaleDateString()} - {new Date(reservation.checkOutDate).toLocaleDateString()}
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(reservation.status)}`}>
                    {reservation.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modify Modal */}
      {showModifyModal && selectedReservation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Modify Reservation {selectedReservation.confirmationNumber}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  New Check-in Date
                </label>
                <input
                  type="date"
                  value={modifyForm.checkIn}
                  onChange={(e) => setModifyForm({ ...modifyForm, checkIn: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  New Check-out Date
                </label>
                <input
                  type="date"
                  value={modifyForm.checkOut}
                  onChange={(e) => setModifyForm({ ...modifyForm, checkOut: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            {modifyError && (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle size={14} /> {modifyError}
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModifyModal(false)}
                disabled={saving}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveModify}
                disabled={saving || !modifyForm.checkIn || !modifyForm.checkOut}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReservationsModule;
