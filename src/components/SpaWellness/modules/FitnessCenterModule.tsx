/**
 * Fitness Center Module
 * Equipment bookings persisted via /api/spa-wellness/equipment-bookings
 * (spa_equipment_bookings — migration 494). Personal trainers live on the
 * shared staff roster (Therapist Management) and are booked through
 * Appointment Management; group classes are managed under Wellness Programs.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Loader2,
  X
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';

interface FitnessCenterModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
  /** Navigate to Appointment Management for a booking. */
  onBookAppointment?: () => void;
}

type BookingStatus = 'Confirmed' | 'In Use' | 'Completed' | 'Cancelled' | 'No Show';
const BOOKING_STATUSES: BookingStatus[] = ['Confirmed', 'In Use', 'Completed', 'Cancelled', 'No Show'];

interface EquipmentBooking {
  id: string;
  equipment: string;
  guest_id: string | null;
  guest_name: string;
  booking_date: string;
  start_time: string;
  duration_minutes: number;
  status: BookingStatus;
  notes: string | null;
}

interface GuestOption {
  id: string;
  name: string;
}

interface BookingForm {
  equipment: string;
  guestId: string;
  guestName: string;
  date: string;
  time: string;
  duration: number;
  notes: string;
}

const EMPTY_FORM: BookingForm = {
  equipment: '',
  guestId: '',
  guestName: '',
  date: new Date().toISOString().slice(0, 10),
  time: '',
  duration: 30,
  notes: ''
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500';
const fieldLabelClass = 'block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';

const FitnessCenterModule: React.FC<FitnessCenterModuleProps> = ({
  onViewGuestProfile,
  onBookAppointment
}) => {
  const { currentPropertyId, addNotification } = useERP();
  const [bookings, setBookings] = useState<EquipmentBooking[]>([]);
  const [guestOptions, setGuestOptions] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dateFilter, setDateFilter] = useState('');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BookingForm>(EMPTY_FORM);

  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (dateFilter) params.append('date', dateFilter);
      if (currentPropertyId) params.append('propertyId', currentPropertyId);
      const res = await fetch(`/api/spa-wellness/equipment-bookings?${params}`, {
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Failed to load bookings (${res.status})`);
      setBookings(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [dateFilter, currentPropertyId]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  useEffect(() => {
    fetch('/api/spa-wellness/guests', { headers: authHeaders(), credentials: 'include' })
      .then(res => (res.ok ? res.json() : []))
      .then(rows => setGuestOptions(rows || []))
      .catch(() => {});
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowFormModal(true);
  };

  const openEditModal = (b: EquipmentBooking) => {
    setEditingId(b.id);
    setForm({
      equipment: b.equipment,
      guestId: b.guest_id || '',
      guestName: b.guest_name,
      date: b.booking_date,
      time: b.start_time,
      duration: b.duration_minutes,
      notes: b.notes || ''
    });
    setShowFormModal(true);
  };

  const handleSubmit = async () => {
    if (!form.equipment.trim() || !form.guestName.trim() || !form.date || !form.time) return;
    setSaving(true);
    try {
      const payload = {
        equipment: form.equipment.trim(),
        guest_id: form.guestId || null,
        guest_name: form.guestName,
        booking_date: form.date,
        start_time: form.time,
        duration_minutes: form.duration,
        notes: form.notes || null,
        property_id: currentPropertyId
      };
      const res = await fetch(
        editingId
          ? `/api/spa-wellness/equipment-bookings/${encodeURIComponent(editingId)}`
          : '/api/spa-wellness/equipment-bookings',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: authHeaders(true),
          credentials: 'include',
          body: JSON.stringify(payload)
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
      addNotification(editingId ? `Booking ${editingId} updated` : 'Equipment booking created', 'success', 'Spa');
      setShowFormModal(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await fetchBookings();
    } catch (err: any) {
      addNotification(err?.message || 'Save failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id: string, status: BookingStatus) => {
    try {
      const res = await fetch(`/api/spa-wellness/equipment-bookings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ status })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Update failed (${res.status})`);
      setBookings(bookings.map(b => (b.id === id ? { ...b, status } : b)));
    } catch (err: any) {
      addNotification(err?.message || 'Failed to update status', 'warning', 'Spa');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete booking ${id}?`)) return;
    try {
      const res = await fetch(`/api/spa-wellness/equipment-bookings/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setBookings(bookings.filter(b => b.id !== id));
      addNotification(`Booking ${id} deleted`, 'info', 'Spa');
    } catch (err: any) {
      addNotification(err?.message || 'Failed to delete booking', 'warning', 'Spa');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Confirmed':
        return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400';
      case 'In Use':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400';
      case 'Completed':
        return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400';
      case 'Cancelled':
      case 'No Show':
        return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Fitness Center</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Equipment booking — trainers are managed in Therapist Management and booked via Appointments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
          <button
            onClick={fetchBookings}
            className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Plus size={16} />
            New Equipment Booking
          </button>
          <button
            onClick={() => onBookAppointment?.()}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition text-sm font-medium"
          >
            Book Appointment
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Equipment Booking */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Equipment
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Guest
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Date & Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 size={18} className="animate-spin inline-block mr-2" />
                  Loading bookings…
                </td>
              </tr>
            ) : bookings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No equipment bookings{dateFilter ? ` on ${dateFilter}` : ''} yet.
                </td>
              </tr>
            ) : bookings.map((booking) => (
              <tr key={booking.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/20 transition">
                <td className="px-4 py-4 font-medium text-slate-900 dark:text-white">
                  {booking.equipment}
                  <div className="text-xs text-slate-400 font-normal">{booking.id}</div>
                </td>
                <td className="px-4 py-4">
                  <button
                    onClick={() => booking.guest_id && onViewGuestProfile?.(booking.guest_id)}
                    className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    {booking.guest_name}
                  </button>
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  <div>{new Date(booking.booking_date).toLocaleDateString()}</div>
                  <div className="text-sm">{booking.start_time}</div>
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-400">
                  {booking.duration_minutes} min
                </td>
                <td className="px-4 py-4">
                  <select
                    value={booking.status}
                    onChange={e => handleStatusChange(booking.id, e.target.value as BookingStatus)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border bg-transparent cursor-pointer ${getStatusColor(booking.status)}`}
                  >
                    {BOOKING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => openEditModal(booking)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(booking.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create / Edit modal */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {editingId ? `Edit ${editingId}` : 'New Equipment Booking'}
              </h2>
              <button onClick={() => setShowFormModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={fieldLabelClass}>Equipment *</label>
                <input
                  className={inputClass}
                  placeholder="e.g. Treadmill #5"
                  value={form.equipment}
                  onChange={e => setForm(f => ({ ...f, equipment: e.target.value }))}
                />
              </div>
              <div>
                <label className={fieldLabelClass}>Guest *</label>
                <select
                  className={inputClass}
                  value={form.guestId}
                  onChange={e => {
                    const g = guestOptions.find(x => x.id === e.target.value);
                    setForm(f => ({ ...f, guestId: e.target.value, guestName: g?.name ?? f.guestName }));
                  }}
                >
                  <option value="">— walk-in / manual —</option>
                  {guestOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <input
                  className={`${inputClass} mt-2`}
                  placeholder="Guest name"
                  value={form.guestName}
                  onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabelClass}>Date *</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Start time *</label>
                  <input
                    type="time"
                    className={inputClass}
                    value={form.time}
                    onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={fieldLabelClass}>Duration (min)</label>
                <input
                  type="number"
                  min={5}
                  className={inputClass}
                  value={form.duration}
                  onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) || 30 }))}
                />
              </div>
              <div>
                <label className={fieldLabelClass}>Notes</label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowFormModal(false)}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.equipment.trim() || !form.guestName.trim() || !form.date || !form.time}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Save Changes' : 'Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FitnessCenterModule;
