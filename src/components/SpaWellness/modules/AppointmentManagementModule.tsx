/**
 * Appointment Management Module
 * Handles appointment booking, scheduling, status management, and therapist assignment.
 * Backed by /api/spa-wellness endpoints (spa_appointments, spa_treatments,
 * spa_therapists, spa_rooms tables — migration 473).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar,
  Clock,
  User,
  Plus,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Phone,
  MapPin,
  ArrowRight,
  Edit,
  Trash2,
  Eye,
  Loader2,
  DollarSign,
  Sparkles,
  X,
  List,
  CalendarDays,
  Repeat,
  History,
  BellRing
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import StatCard from '../../FrontOffice/StatCard';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import SpaScheduleCalendar, { type CreateSeed } from './SpaScheduleCalendar';

interface AppointmentManagementModuleProps {
  selectedAppointmentId?: string;
  onClearSelectedAppointmentId?: () => void;
  /** Seed a new booking (e.g. "Book Session" from another module). */
  bookingSeed?: { treatmentId?: string; therapistName?: string };
  onClearBookingSeed?: () => void;
  onViewGuestProfile?: (guestId: string) => void;
  onViewTherapist?: (therapistId: string) => void;
}

type AppointmentStatus = 'Requested' | 'Confirmed' | 'Checked In' | 'In Treatment' | 'Completed' | 'Cancelled' | 'No Show' | 'Rescheduled';
type AppointmentSource = 'Guest Portal' | 'Front Desk' | 'Concierge' | 'Reception' | 'Telephone' | 'Walk-in' | 'Corporate Booking' | 'Public Booking Request';

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'Requested', 'Confirmed', 'Checked In', 'In Treatment', 'Completed', 'Cancelled', 'No Show', 'Rescheduled'
];
const APPOINTMENT_SOURCES: AppointmentSource[] = [
  'Guest Portal', 'Front Desk', 'Concierge', 'Reception', 'Telephone', 'Walk-in', 'Corporate Booking', 'Public Booking Request'
];

const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  Requested: 'neutral',
  Confirmed: 'info',
  'Checked In': 'accent',
  'In Treatment': 'warning',
  Completed: 'success',
  Cancelled: 'danger',
  'No Show': 'danger',
  Rescheduled: 'warning'
};

const STATUS_ICON: Record<AppointmentStatus, any> = {
  Requested: AlertCircle,
  Confirmed: CheckCircle2,
  'Checked In': CheckCircle2,
  'In Treatment': Clock,
  Completed: CheckCircle2,
  Cancelled: XCircle,
  'No Show': AlertCircle,
  Rescheduled: Calendar
};

interface Appointment {
  id: string;
  guestName: string;
  guestId: string;
  treatment: string;
  treatmentId: string;
  therapist: string;
  therapistId: string;
  date: string;
  time: string;
  duration: number;
  status: AppointmentStatus;
  source: AppointmentSource;
  room: string;
  roomId: string;
  amount: number;
  notes: string;
  seriesId: string;
}

interface Treatment {
  id: string;
  name: string;
  category: string;
  duration_minutes: number;
  price: number;
  room_type?: string | null;
}

interface Therapist {
  id: string;
  name: string;
  title: string;
  specialties?: string[];
  status?: string;
}

interface SpaRoom {
  id: string;
  name: string;
  room_type: string;
  status?: string;
  category?: string;
}

interface GuestOption {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface AppointmentForm {
  guestId: string;
  guestName: string;
  treatmentId: string;
  therapistId: string;
  roomId: string;
  date: string;
  time: string;
  duration: number;
  source: AppointmentSource;
  amount: number;
  notes: string;
}

interface WaitlistEntry {
  id: string;
  guest_id: string | null;
  guest_name: string;
  contact: string | null;
  treatment_id: string | null;
  treatment: string;
  therapist_id: string | null;
  preferred_date: string;
  preferred_time: string | null;
  status: string;
  booked_appointment_id: string | null;
  notes: string | null;
}

const WAITLIST_STATUSES = ['Waiting', 'Notified', 'Booked', 'Cancelled', 'Expired'];

const WAITLIST_TONE: Record<string, StatusTone> = {
  Waiting: 'neutral',
  Notified: 'warning',
  Booked: 'success',
  Cancelled: 'danger',
  Expired: 'neutral',
};

interface HistoryEntry {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  changed_by_name: string | null;
  notes: string | null;
  created_at: string;
}

interface SeriesForm {
  guestId: string;
  guestName: string;
  treatmentId: string;
  therapistId: string;
  roomId: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  startDate: string;
  startTime: string;
  occurrences: number;
  notes: string;
}

const EMPTY_SERIES: SeriesForm = {
  guestId: '',
  guestName: '',
  treatmentId: '',
  therapistId: '',
  roomId: '',
  frequency: 'weekly',
  startDate: '',
  startTime: '',
  occurrences: 4,
  notes: '',
};

const EMPTY_FORM: AppointmentForm = {
  guestId: '',
  guestName: '',
  treatmentId: '',
  therapistId: '',
  roomId: '',
  date: '',
  time: '',
  duration: 60,
  source: 'Reception',
  amount: 0,
  notes: ''
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// DB row (snake_case) → UI model (camelCase)
function mapAppointment(row: any): Appointment {
  return {
    id: row.id,
    guestName: row.guest_name,
    guestId: row.guest_id || '',
    treatment: row.treatment,
    treatmentId: row.treatment_id || '',
    therapist: row.therapist || 'Unassigned',
    therapistId: row.therapist_id || '',
    date: row.appointment_date,
    time: row.start_time,
    duration: row.duration_minutes,
    status: row.status,
    source: row.source,
    room: row.room || 'TBD',
    roomId: row.room_id || '',
    amount: Number(row.amount) || 0,
    notes: row.notes || '',
    seriesId: row.series_id || ''
  };
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';

const fieldLabelClass = 'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5';

const AppointmentManagementModule: React.FC<AppointmentManagementModuleProps> = ({
  selectedAppointmentId,
  onClearSelectedAppointmentId,
  bookingSeed,
  onClearBookingSeed,
  onViewGuestProfile,
  onViewTherapist
}) => {
  const { currentPropertyId, addNotification } = useERP();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [rooms, setRooms] = useState<SpaRoom[]>([]);
  const [guestOptions, setGuestOptions] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [dateFilter, setDateFilter] = useState<string>('');

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AppointmentForm>(EMPTY_FORM);
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'waitlist'>('list');

  // Waitlist
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistStatusFilter, setWaitlistStatusFilter] = useState<string>('All');
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [waitlistBookingRef, setWaitlistBookingRef] = useState<string | null>(null);
  const [waitlistForm, setWaitlistForm] = useState({
    guestId: '', guestName: '', contact: '', treatmentId: '',
    preferredDate: '', preferredTime: '', notes: ''
  });

  // Recurring series
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [seriesForm, setSeriesForm] = useState<SeriesForm>(EMPTY_SERIES);
  const [seriesResult, setSeriesResult] = useState<{
    created: Array<{ id: string; appointment_date: string; start_time: string }>;
    skipped: Array<{ date: string; reason: string }>;
  } | null>(null);

  // Audit history for the open detail modal
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ── Data loading ──────────────────────────────────────────────────

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.append('status', statusFilter);
      if (sourceFilter !== 'All') params.append('source', sourceFilter);
      if (dateFilter) params.append('date', dateFilter);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      if (currentPropertyId) params.append('propertyId', currentPropertyId);

      const res = await fetch(`/api/spa-wellness/appointments?${params}`, {
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Failed to load appointments (${res.status})`);
      const data = await res.json();
      setAppointments((data || []).map(mapAppointment));
    } catch (err: any) {
      setError(err.message || 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, dateFilter, searchTerm, currentPropertyId]);

  const fetchLookups = useCallback(async () => {
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const roomParams = `${prop ? prop + '&' : '?'}bookable=true`;
      const [tRes, thRes, rRes, gRes] = await Promise.all([
        fetch(`/api/spa-wellness/treatments${prop}`, { headers: authHeaders(), credentials: 'include' }),
        fetch(`/api/spa-wellness/therapists${prop}`, { headers: authHeaders(), credentials: 'include' }),
        fetch(`/api/spa-wellness/rooms${roomParams}`, { headers: authHeaders(), credentials: 'include' }),
        fetch('/api/spa-wellness/guests', { headers: authHeaders(), credentials: 'include' })
      ]);
      if (tRes.ok) setTreatments(await tRes.json());
      if (thRes.ok) setTherapists(await thRes.json());
      if (rRes.ok) setRooms(await rRes.json());
      if (gRes.ok) setGuestOptions(await gRes.json());
    } catch (err) {
      console.error('Error loading spa lookups:', err);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  useEffect(() => {
    fetchLookups();
  }, [fetchLookups]);

  // ── Waitlist ──────────────────────────────────────────────────────

  const fetchWaitlist = useCallback(async () => {
    try {
      setWaitlistLoading(true);
      const params = new URLSearchParams();
      if (dateFilter) params.append('date', dateFilter);
      if (waitlistStatusFilter !== 'All') params.append('status', waitlistStatusFilter);
      if (currentPropertyId) params.append('propertyId', currentPropertyId);
      const res = await fetch(`/api/spa-wellness/waitlist?${params}`, {
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Failed to load waitlist (${res.status})`);
      setWaitlist(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load waitlist');
    } finally {
      setWaitlistLoading(false);
    }
  }, [dateFilter, waitlistStatusFilter, currentPropertyId]);

  useEffect(() => {
    if (viewMode === 'waitlist') fetchWaitlist();
  }, [viewMode, fetchWaitlist]);

  const handleAddToWaitlist = async () => {
    if (!waitlistForm.guestName.trim() || !waitlistForm.preferredDate) return;
    setSaving(true);
    try {
      const res = await fetch('/api/spa-wellness/waitlist', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: waitlistForm.guestId || null,
          guest_name: waitlistForm.guestName,
          contact: waitlistForm.contact || null,
          treatment_id: waitlistForm.treatmentId || null,
          preferred_date: waitlistForm.preferredDate,
          preferred_time: waitlistForm.preferredTime || null,
          notes: waitlistForm.notes || null,
          property_id: currentPropertyId
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      addNotification(`${waitlistForm.guestName} added to waitlist`, 'success', 'Spa');
      setShowWaitlistModal(false);
      setWaitlistForm({ guestId: '', guestName: '', contact: '', treatmentId: '', preferredDate: '', preferredTime: '', notes: '' });
      await fetchWaitlist();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to add to waitlist', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const handleWaitlistStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/spa-wellness/waitlist/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      setWaitlist(list => list.map(w => w.id === id ? { ...w, status } : w));
    } catch (err: any) {
      addNotification(err?.message || 'Failed to update waitlist entry', 'warning', 'Spa');
    }
  };

  // Convert a waitlist entry into a prefilled booking form; on save the
  // entry is marked Booked with the new appointment id.
  const handleBookFromWaitlist = (entry: WaitlistEntry) => {
    setEditingId(null);
    const treatment = treatments.find(t => t.id === entry.treatment_id);
    setForm({
      ...EMPTY_FORM,
      guestId: entry.guest_id || '',
      guestName: entry.guest_name,
      treatmentId: entry.treatment_id || '',
      therapistId: entry.therapist_id || '',
      date: entry.preferred_date,
      time: entry.preferred_time || '',
      duration: treatment?.duration_minutes ?? 60,
      amount: treatment?.price ?? 0,
      notes: `Waitlist ${entry.id}${entry.notes ? ` — ${entry.notes}` : ''}`
    });
    setWaitlistBookingRef(entry.id);
    setShowFormModal(true);
  };

  const handleRemoveWaitlist = async (id: string) => {
    if (!window.confirm(`Remove waitlist entry ${id}?`)) return;
    try {
      const res = await fetch(`/api/spa-wellness/waitlist/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setWaitlist(list => list.filter(w => w.id !== id));
    } catch (err: any) {
      addNotification(err?.message || 'Failed to remove waitlist entry', 'warning', 'Spa');
    }
  };

  // ── Recurring series ──────────────────────────────────────────────

  const handleCreateSeries = async () => {
    if (!seriesForm.guestName.trim() || !seriesForm.treatmentId || !seriesForm.startDate || !seriesForm.startTime) return;
    setSaving(true);
    setSeriesResult(null);
    try {
      const res = await fetch('/api/spa-wellness/appointments/series', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: seriesForm.guestId || null,
          guest_name: seriesForm.guestName,
          treatment_id: seriesForm.treatmentId,
          therapist_id: seriesForm.therapistId || null,
          room_id: seriesForm.roomId || null,
          frequency: seriesForm.frequency,
          start_date: seriesForm.startDate,
          start_time: seriesForm.startTime,
          occurrences: seriesForm.occurrences,
          notes: seriesForm.notes || null,
          property_id: currentPropertyId
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) throw new Error(body.error || `Failed (${res.status})`);
      setSeriesResult({ created: body.created || [], skipped: body.skipped || [] });
      (body.warnings || []).forEach((w: string) => addNotification(w, 'warning', 'Spa'));
      if (body.created?.length) {
        addNotification(`Series created: ${body.created.length} appointment${body.created.length === 1 ? '' : 's'}`, 'success', 'Spa');
        await fetchAppointments();
      }
    } catch (err: any) {
      addNotification(err?.message || 'Failed to create series', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSeries = async (seriesId: string) => {
    if (!window.confirm(`Cancel all remaining appointments in series ${seriesId}?`)) return;
    try {
      const res = await fetch(`/api/spa-wellness/appointments/series/${encodeURIComponent(seriesId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reason: 'Cancelled via Appointments' })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      addNotification(`Series ${seriesId} cancelled (${body.cancelledCount ?? 0} appointments)`, 'success', 'Spa');
      setDetailAppointment(null);
      await fetchAppointments();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to cancel series', 'warning', 'Spa');
    }
  };

  // ── Audit history ─────────────────────────────────────────────────

  useEffect(() => {
    if (!detailAppointment) { setHistory([]); return; }
    fetch(`/api/spa-wellness/appointments/${encodeURIComponent(detailAppointment.id)}/history`, {
      headers: authHeaders(),
      credentials: 'include'
    })
      .then(res => (res.ok ? res.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [detailAppointment]);

  // Deep-link: open the detail modal when navigated here with a selected id.
  useEffect(() => {
    if (!selectedAppointmentId) return;
    const existing = appointments.find(a => a.id === selectedAppointmentId);
    if (existing) {
      setDetailAppointment(existing);
      return;
    }
    fetch(`/api/spa-wellness/appointments/${encodeURIComponent(selectedAppointmentId)}`, {
      headers: authHeaders(),
      credentials: 'include'
    })
      .then(res => (res.ok ? res.json() : null))
      .then(row => { if (row) setDetailAppointment(mapAppointment(row)); })
      .catch(() => {});
  }, [selectedAppointmentId, appointments]);

  // Cross-module "Book" entry point: open the create form pre-seeded with a
  // treatment (e.g. Beauty Services / Fitness) and an optional provider name.
  useEffect(() => {
    if (!bookingSeed || treatments.length === 0) return;
    const treatment = bookingSeed.treatmentId
      ? treatments.find(t => t.id === bookingSeed.treatmentId)
      : undefined;
    const therapist = bookingSeed.therapistName
      ? therapists.find(t => t.name === bookingSeed.therapistName)
      : undefined;
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      treatmentId: treatment?.id || '',
      duration: treatment?.duration_minutes ?? 60,
      amount: treatment?.price ?? 0,
      therapistId: therapist?.id || ''
    });
    setShowFormModal(true);
    onClearBookingSeed?.();
  }, [bookingSeed, treatments, therapists, onClearBookingSeed]);

  // ── KPI stats ─────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todays = appointments.filter(a => a.date === today);
    return {
      total: appointments.length,
      today: todays.length,
      confirmed: appointments.filter(a => a.status === 'Confirmed').length,
      inTreatment: appointments.filter(a => a.status === 'In Treatment').length,
      expectedRevenue: todays
        .filter(a => a.status !== 'Cancelled' && a.status !== 'No Show')
        .reduce((sum, a) => sum + a.amount, 0)
    };
  }, [appointments]);

  // ── Mutations ─────────────────────────────────────────────────────

  const handleStatusChange = async (appointmentId: string, newStatus: AppointmentStatus) => {
    const previous = appointments;
    setAppointments(appointments.map(apt =>
      apt.id === appointmentId ? { ...apt, status: newStatus } : apt
    ));
    try {
      const res = await fetch(`/api/spa-wellness/appointments/${encodeURIComponent(appointmentId)}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ status: newStatus })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Status update failed (${res.status})`);
      addNotification(`Appointment ${appointmentId} → ${newStatus}`, 'success', 'Spa');
      (body.warnings || []).forEach((w: string) => addNotification(w, 'warning', 'Spa'));
    } catch (err: any) {
      setAppointments(previous);
      addNotification(err?.message || 'Failed to update status', 'warning', 'Spa');
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowFormModal(true);
  };

  // Calendar slot click: create a booking seeded with that date/time/resource.
  const openCreateAt = (seed: CreateSeed) => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      date: seed.date,
      time: seed.time,
      therapistId: seed.therapistId || '',
      roomId: seed.roomId || ''
    });
    setShowFormModal(true);
  };

  // Calendar block click: open the detail modal (fetch if not in the list).
  const openDetailById = (appointmentId: string) => {
    const existing = appointments.find(a => a.id === appointmentId);
    if (existing) {
      setDetailAppointment(existing);
      return;
    }
    fetch(`/api/spa-wellness/appointments/${encodeURIComponent(appointmentId)}`, {
      headers: authHeaders(),
      credentials: 'include'
    })
      .then(res => (res.ok ? res.json() : null))
      .then(row => { if (row) setDetailAppointment(mapAppointment(row)); })
      .catch(() => {});
  };

  const openEditModal = (apt: Appointment) => {
    setEditingId(apt.id);
    setForm({
      guestId: apt.guestId,
      guestName: apt.guestName,
      treatmentId: apt.treatmentId,
      therapistId: apt.therapistId,
      roomId: apt.roomId,
      date: apt.date,
      time: apt.time,
      duration: apt.duration,
      source: apt.source,
      amount: apt.amount,
      notes: apt.notes
    });
    setShowFormModal(true);
  };

  const handleTreatmentSelect = (treatmentId: string) => {
    const treatment = treatments.find(t => t.id === treatmentId);
    setForm(f => ({
      ...f,
      treatmentId,
      duration: treatment?.duration_minutes ?? f.duration,
      amount: treatment?.price ?? f.amount
    }));
  };

  const handleGuestSelect = (guestId: string) => {
    const guest = guestOptions.find(g => g.id === guestId);
    setForm(f => ({ ...f, guestId, guestName: guest?.name ?? f.guestName }));
  };

  const handleSubmit = async () => {
    if (!form.guestName.trim() || !form.treatmentId || !form.date || !form.time) return;
    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/spa-wellness/appointments/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          credentials: 'include',
          body: JSON.stringify({
            guest_id: form.guestId || null,
            guest_name: form.guestName,
            treatment_id: form.treatmentId,
            treatment: treatments.find(t => t.id === form.treatmentId)?.name,
            therapist_id: form.therapistId || null,
            therapist: form.therapistId ? therapists.find(t => t.id === form.therapistId)?.name : null,
            room_id: form.roomId || null,
            room: form.roomId ? rooms.find(r => r.id === form.roomId)?.name : null,
            appointment_date: form.date,
            start_time: form.time,
            duration_minutes: form.duration,
            source: form.source,
            amount: form.amount,
            notes: form.notes
          })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Update failed (${res.status})`);
        addNotification(`Appointment ${editingId} updated`, 'success', 'Spa');
        (body.warnings || []).forEach((w: string) => addNotification(w, 'warning', 'Spa'));
      } else {
        const res = await fetch('/api/spa-wellness/appointments', {
          method: 'POST',
          headers: authHeaders(true),
          credentials: 'include',
          body: JSON.stringify({
            guest_id: form.guestId || null,
            guest_name: form.guestName,
            treatment_id: form.treatmentId,
            therapist_id: form.therapistId || null,
            room_id: form.roomId || null,
            appointment_date: form.date,
            start_time: form.time,
            duration_minutes: form.duration,
            source: form.source,
            amount: form.amount,
            notes: form.notes,
            property_id: currentPropertyId
          })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || `Create failed (${res.status})`);
        }
        addNotification('Appointment created', 'success', 'Spa');
        (body.warnings || []).forEach((w: string) => addNotification(w, 'warning', 'Spa'));
        if (waitlistBookingRef && body.id) {
          fetch(`/api/spa-wellness/waitlist/${encodeURIComponent(waitlistBookingRef)}`, {
            method: 'PATCH',
            headers: authHeaders(true),
            credentials: 'include',
            body: JSON.stringify({ status: 'Booked', booked_appointment_id: body.id })
          }).then(() => fetchWaitlist()).catch(() => {});
          setWaitlistBookingRef(null);
        }
      }
      setShowFormModal(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await fetchAppointments();
    } catch (err: any) {
      setError(err.message || 'Save failed');
      addNotification(err?.message || 'Save failed', 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (appointmentId: string) => {
    if (!window.confirm(`Delete appointment ${appointmentId}?`)) return;
    try {
      const res = await fetch(`/api/spa-wellness/appointments/${encodeURIComponent(appointmentId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setAppointments(appointments.filter(a => a.id !== appointmentId));
      addNotification(`Appointment ${appointmentId} deleted`, 'info', 'Spa');
    } catch (err: any) {
      addNotification(err?.message || 'Failed to delete appointment', 'warning', 'Spa');
    }
  };

  const closeDetail = () => {
    setDetailAppointment(null);
    onClearSelectedAppointmentId?.();
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Appointment Management"
        subtitle="Schedule and manage spa appointments"
        icon={Calendar}
        actions={
          <>
            <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  viewMode === 'list'
                    ? 'bg-[var(--color-accent-spa)] text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  viewMode === 'calendar'
                    ? 'bg-[var(--color-accent-spa)] text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" /> Calendar
              </button>
              <button
                onClick={() => setViewMode('waitlist')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                  viewMode === 'waitlist'
                    ? 'bg-[var(--color-accent-spa)] text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <BellRing className="w-3.5 h-3.5" /> Waitlist
              </button>
            </div>
            <button onClick={fetchAppointments} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => { setSeriesForm(EMPTY_SERIES); setSeriesResult(null); setShowSeriesModal(true); }}
              className={button.secondary}
            >
              <Repeat className="w-4 h-4" />
              New Series
            </button>
            <button
              onClick={() => setShowWaitlistModal(true)}
              className={button.secondary}
            >
              <BellRing className="w-4 h-4" />
              Add to Waitlist
            </button>
            <button onClick={openCreateModal} className={button.primary}>
              <Plus className="w-4 h-4" />
              New Appointment
            </button>
          </>
        }
      />

      {/* KPI strip */}
      <div className={layout.kpiGrid}>
        <StatCard title="Today's Appointments" value={stats.today} icon={Calendar} tone="accent" />
        <StatCard title="Confirmed" value={stats.confirmed} icon={CheckCircle2} tone="info" />
        <StatCard title="In Treatment" value={stats.inTreatment} icon={Clock} tone="warning" />
        <StatCard title="Expected Revenue (Today)" value={`$${stats.expectedRevenue.toLocaleString()}`} icon={DollarSign} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {viewMode === 'calendar' && (
        <SpaScheduleCalendar
          treatments={treatments}
          therapists={therapists}
          rooms={rooms}
          onSelect={openDetailById}
          onCreateAt={openCreateAt}
        />
      )}

      {viewMode === 'list' && (
      <>
      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-nowrap items-center gap-3">
          <div className="relative flex-[2] min-w-[120px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search guest, treatment, therapist, id…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={inputClass + ' pl-9'}
            />
          </div>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className={inputClass + ' flex-1 min-w-0'}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass + ' flex-1 min-w-0 truncate'}>
            <option value="All">All Status</option>
            {APPOINTMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={inputClass + ' flex-1 min-w-0 truncate'}>
            <option value="All">All Sources</option>
            {APPOINTMENT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(statusFilter !== 'All' || sourceFilter !== 'All' || dateFilter || searchTerm) && (
            <button
              onClick={() => { setStatusFilter('All'); setSourceFilter('All'); setDateFilter(''); setSearchTerm(''); }}
              className={button.ghost}
            >
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>
      </SectionCard>

      {/* Appointments table */}
      <SectionCard title="Appointments" subtitle={`${appointments.length} record${appointments.length === 1 ? '' : 's'}`} icon={Sparkles} tone="accent" pad="none">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
            Loading appointments…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Appointment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Guest</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Treatment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Therapist</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {appointments.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-500">
                      No appointments found.
                    </td>
                  </tr>
                )}
                {appointments.map((appointment) => (
                  <tr key={appointment.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                    <td className="px-4 py-4">
                      <div className="font-medium text-gray-900 dark:text-white">{appointment.id}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">{appointment.room}</div>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => appointment.guestId && onViewGuestProfile?.(appointment.guestId)}
                        className="flex items-center gap-2 text-[var(--color-accent-spa)] hover:text-[var(--color-accent-spa-hover)]"
                      >
                        <User size={16} />
                        <span className="font-medium">{appointment.guestName}</span>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-gray-900 dark:text-white">{appointment.treatment}</div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-500">
                        <span>{appointment.duration} min</span>
                        {(() => {
                          const cat = treatments.find(t => t.id === appointment.treatmentId)?.category;
                          return cat ? <Badge tone={cat === 'Beauty Services' ? 'warning' : cat === 'Fitness' ? 'info' : 'neutral'}>{cat}</Badge> : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => appointment.therapistId && onViewTherapist?.(appointment.therapistId)}
                        className="text-[var(--color-accent-spa)] hover:text-[var(--color-accent-spa-hover)]"
                      >
                        {appointment.therapist}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                        <Calendar size={16} className="text-gray-400" />
                        <span>{new Date(appointment.date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-500 text-sm">
                        <Clock size={14} />
                        <span>{appointment.time}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        value={appointment.status}
                        onChange={(e) => handleStatusChange(appointment.id, e.target.value as AppointmentStatus)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer ${statusTone[STATUS_TONE[appointment.status]].soft} focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-spa)]`}
                      >
                        {APPOINTMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm">
                        {appointment.source === 'Guest Portal' && <Phone size={14} />}
                        {appointment.source === 'Concierge' && <MapPin size={14} />}
                        {appointment.source === 'Front Desk' && <User size={14} />}
                        <span>{appointment.source}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-gray-900 dark:text-white tabular-nums">
                      ${appointment.amount}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setDetailAppointment(appointment)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-accent-spa)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="View details"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => openEditModal(appointment)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(appointment.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="Delete"
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
        )}
      </SectionCard>
      </>
      )}

      {viewMode === 'waitlist' && (
        <SectionCard
          title="Waitlist"
          subtitle={`${waitlist.length} entr${waitlist.length === 1 ? 'y' : 'ies'} — cancellations flag matching entries as Notified`}
          icon={BellRing}
          tone="accent"
          pad="none"
        >
          <div className="flex flex-nowrap items-center gap-3 p-4 border-b border-gray-100 dark:border-slate-700">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className={inputClass + ' w-44'}
            />
            <select
              value={waitlistStatusFilter}
              onChange={(e) => setWaitlistStatusFilter(e.target.value)}
              className={inputClass + ' w-44'}
            >
              <option value="All">All Status</option>
              {WAITLIST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {(dateFilter || waitlistStatusFilter !== 'All') && (
              <button
                onClick={() => { setDateFilter(''); setWaitlistStatusFilter('All'); }}
                className={button.ghost}
              >
                <X className="w-4 h-4" /> Clear
              </button>
            )}
          </div>
          {waitlistLoading ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
              Loading waitlist…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Entry</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Guest</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Treatment</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Preferred</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Contact</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {waitlist.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                        No waitlist entries found.
                      </td>
                    </tr>
                  )}
                  {waitlist.map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                      <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">{entry.id}</td>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => entry.guest_id && onViewGuestProfile?.(entry.guest_id)}
                          className="flex items-center gap-2 text-[var(--color-accent-spa)] hover:text-[var(--color-accent-spa-hover)]"
                        >
                          <User size={16} />
                          <span className="font-medium">{entry.guest_name}</span>
                        </button>
                      </td>
                      <td className="px-4 py-4 text-gray-900 dark:text-white">{entry.treatment}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                          <Calendar size={16} className="text-gray-400" />
                          <span>{new Date(entry.preferred_date).toLocaleDateString()}</span>
                        </div>
                        {entry.preferred_time && (
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <Clock size={14} />
                            <span>{entry.preferred_time}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">{entry.contact || '—'}</td>
                      <td className="px-4 py-4">
                        <select
                          value={entry.status}
                          onChange={(e) => handleWaitlistStatus(entry.id, e.target.value)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer ${statusTone[WAITLIST_TONE[entry.status] ?? 'neutral'].soft} focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-spa)]`}
                        >
                          {WAITLIST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleBookFromWaitlist(entry)}
                            disabled={entry.status === 'Booked' || entry.status === 'Cancelled'}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-success)] hover:bg-slate-100 dark:hover:bg-slate-700 transition disabled:opacity-30"
                            title="Book this guest"
                          >
                            <Plus size={16} />
                          </button>
                          <button
                            onClick={() => handleRemoveWaitlist(entry.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                            title="Remove"
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
          )}
        </SectionCard>
      )}

      {/* Create / Edit Appointment Modal */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto ring-1 ring-black/5 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-accent-spa)] to-[var(--color-accent-guest)] rounded-t-2xl" />
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingId ? `Edit ${editingId}` : 'New Appointment'}
              </h2>
              <button
                onClick={() => { setShowFormModal(false); setEditingId(null); setForm(EMPTY_FORM); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={22} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className={fieldLabelClass}>Guest</span>
                <select value={form.guestId} onChange={(e) => handleGuestSelect(e.target.value)} className={inputClass}>
                  <option value="">— Walk-in / manual entry —</option>
                  {guestOptions.map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Guest Name *</span>
                <input
                  type="text"
                  value={form.guestName}
                  onChange={(e) => setForm(f => ({ ...f, guestName: e.target.value }))}
                  placeholder="Guest name"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Service *</span>
                <select value={form.treatmentId} onChange={(e) => handleTreatmentSelect(e.target.value)} className={inputClass}>
                  <option value="">Select service…</option>
                  {[...new Set(treatments.map(t => t.category))].map(cat => (
                    <optgroup key={cat} label={cat}>
                      {treatments.filter(t => t.category === cat).map(t => (
                        <option key={t.id} value={t.id}>{t.name} — {t.duration_minutes} min (${t.price})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Therapist / Provider</span>
                <select value={form.therapistId} onChange={(e) => setForm(f => ({ ...f, therapistId: e.target.value }))} className={inputClass}>
                  <option value="">Assign later</option>
                  {therapists.map(t => (
                    <option key={t.id} value={t.id}>{t.name} — {t.title}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Room / Station</span>
                {(() => {
                  const wantedType = treatments.find(t => t.id === form.treatmentId)?.room_type;
                  const matching = wantedType ? rooms.filter(r => r.room_type === wantedType) : rooms;
                  const list = matching.length > 0 ? matching : rooms;
                  return (
                    <select value={form.roomId} onChange={(e) => setForm(f => ({ ...f, roomId: e.target.value }))} className={inputClass}>
                      <option value="">Assign later</option>
                      {list.map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.room_type})</option>
                      ))}
                    </select>
                  );
                })()}
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Source</span>
                <select value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value as AppointmentSource }))} className={inputClass}>
                  {APPOINTMENT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Date *</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Start Time *</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm(f => ({ ...f, time: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Duration (min)</span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={form.duration}
                  onChange={(e) => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Amount ($)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.amount}
                  onChange={(e) => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
                  className={inputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className={fieldLabelClass}>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Preferences, allergies, special requests…"
                  className={inputClass}
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 rounded-b-2xl">
              <button
                onClick={() => { setShowFormModal(false); setEditingId(null); setForm(EMPTY_FORM); }}
                className={button.secondary}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.guestName.trim() || !form.treatmentId || !form.date || !form.time}
                className={button.primary}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Waitlist Modal */}
      {showWaitlistModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full ring-1 ring-black/5 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-accent-spa)] to-[var(--color-accent-guest)] rounded-t-2xl" />
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add to Waitlist</h2>
              <button onClick={() => setShowWaitlistModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={22} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className={fieldLabelClass}>Guest</span>
                <select
                  value={waitlistForm.guestId}
                  onChange={(e) => {
                    const g = guestOptions.find(x => x.id === e.target.value);
                    setWaitlistForm(f => ({ ...f, guestId: e.target.value, guestName: g?.name ?? f.guestName, contact: g?.phone || g?.email || f.contact }));
                  }}
                  className={inputClass}
                >
                  <option value="">— Walk-in / manual entry —</option>
                  {guestOptions.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Guest Name *</span>
                <input
                  type="text"
                  value={waitlistForm.guestName}
                  onChange={(e) => setWaitlistForm(f => ({ ...f, guestName: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Contact (phone / email)</span>
                <input
                  type="text"
                  value={waitlistForm.contact}
                  onChange={(e) => setWaitlistForm(f => ({ ...f, contact: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Service</span>
                <select
                  value={waitlistForm.treatmentId}
                  onChange={(e) => setWaitlistForm(f => ({ ...f, treatmentId: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Any treatment</option>
                  {treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Preferred Date *</span>
                <input
                  type="date"
                  value={waitlistForm.preferredDate}
                  onChange={(e) => setWaitlistForm(f => ({ ...f, preferredDate: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Preferred Time</span>
                <input
                  type="time"
                  value={waitlistForm.preferredTime}
                  onChange={(e) => setWaitlistForm(f => ({ ...f, preferredTime: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block md:col-span-2">
                <span className={fieldLabelClass}>Notes</span>
                <textarea
                  value={waitlistForm.notes}
                  onChange={(e) => setWaitlistForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 rounded-b-2xl">
              <button onClick={() => setShowWaitlistModal(false)} className={button.secondary}>Cancel</button>
              <button
                onClick={handleAddToWaitlist}
                disabled={saving || !waitlistForm.guestName.trim() || !waitlistForm.preferredDate}
                className={button.primary}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Add to Waitlist
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Recurring Series Modal */}
      {showSeriesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto ring-1 ring-black/5 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-accent-spa)] to-[var(--color-accent-guest)] rounded-t-2xl" />
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">New Recurring Series</h2>
              <button onClick={() => setShowSeriesModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={22} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className={fieldLabelClass}>Guest</span>
                <select
                  value={seriesForm.guestId}
                  onChange={(e) => {
                    const g = guestOptions.find(x => x.id === e.target.value);
                    setSeriesForm(f => ({ ...f, guestId: e.target.value, guestName: g?.name ?? f.guestName }));
                  }}
                  className={inputClass}
                >
                  <option value="">— Walk-in / manual entry —</option>
                  {guestOptions.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Guest Name *</span>
                <input
                  type="text"
                  value={seriesForm.guestName}
                  onChange={(e) => setSeriesForm(f => ({ ...f, guestName: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Service *</span>
                <select
                  value={seriesForm.treatmentId}
                  onChange={(e) => setSeriesForm(f => ({ ...f, treatmentId: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Select service…</option>
                  {[...new Set(treatments.map(t => t.category))].map(cat => (
                    <optgroup key={cat} label={cat}>
                      {treatments.filter(t => t.category === cat).map(t => (
                        <option key={t.id} value={t.id}>{t.name} — {t.duration_minutes} min (${t.price})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Therapist / Provider</span>
                <select
                  value={seriesForm.therapistId}
                  onChange={(e) => setSeriesForm(f => ({ ...f, therapistId: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Assign later</option>
                  {therapists.map(t => <option key={t.id} value={t.id}>{t.name} — {t.title}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Frequency *</span>
                <select
                  value={seriesForm.frequency}
                  onChange={(e) => setSeriesForm(f => ({ ...f, frequency: e.target.value as SeriesForm['frequency'] }))}
                  className={inputClass}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Occurrences * (2–52)</span>
                <input
                  type="number"
                  min={2}
                  max={52}
                  value={seriesForm.occurrences}
                  onChange={(e) => setSeriesForm(f => ({ ...f, occurrences: Number(e.target.value) }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>First Date *</span>
                <input
                  type="date"
                  value={seriesForm.startDate}
                  onChange={(e) => setSeriesForm(f => ({ ...f, startDate: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Start Time *</span>
                <input
                  type="time"
                  value={seriesForm.startTime}
                  onChange={(e) => setSeriesForm(f => ({ ...f, startTime: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Room / Station</span>
                <select
                  value={seriesForm.roomId}
                  onChange={(e) => setSeriesForm(f => ({ ...f, roomId: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Assign later</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.room_type})</option>)}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className={fieldLabelClass}>Notes</span>
                <textarea
                  value={seriesForm.notes}
                  onChange={(e) => setSeriesForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className={inputClass}
                />
              </label>
            </div>

            {seriesResult && (
              <div className="mx-6 mb-4 rounded-xl border border-gray-200 dark:border-slate-700 p-4 text-sm">
                <div className="font-semibold text-gray-900 dark:text-white mb-2">
                  {seriesResult.created.length} booked · {seriesResult.skipped.length} skipped
                </div>
                {seriesResult.created.length > 0 && (
                  <div className="text-gray-600 dark:text-gray-400">
                    {seriesResult.created.map(c => (
                      <div key={c.id}>{c.id} — {c.appointment_date} at {c.start_time}</div>
                    ))}
                  </div>
                )}
                {seriesResult.skipped.length > 0 && (
                  <div className="mt-2 text-amber-600 dark:text-amber-400">
                    {seriesResult.skipped.map(s => (
                      <div key={s.date}>{s.date} — {s.reason}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 rounded-b-2xl">
              <button onClick={() => setShowSeriesModal(false)} className={button.secondary}>Close</button>
              <button
                onClick={handleCreateSeries}
                disabled={saving || !seriesForm.guestName.trim() || !seriesForm.treatmentId || !seriesForm.startDate || !seriesForm.startTime}
                className={button.primary}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Series
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appointment Detail Modal */}
      {detailAppointment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto ring-1 ring-black/5 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-accent-spa)] to-[var(--color-accent-guest)] rounded-t-2xl" />
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{detailAppointment.id}</h2>
                <div className="flex items-center gap-2 mt-2">
                  <Badge tone={STATUS_TONE[detailAppointment.status]} icon={STATUS_ICON[detailAppointment.status]}>
                    {detailAppointment.status}
                  </Badge>
                  {detailAppointment.seriesId && (
                    <Badge tone="info" icon={Repeat}>Series {detailAppointment.seriesId}</Badge>
                  )}
                  <span className="text-xs text-gray-500">via {detailAppointment.source}</span>
                </div>
              </div>
              <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={22} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className={fieldLabelClass}>Guest</span>
                <button
                  onClick={() => detailAppointment.guestId && onViewGuestProfile?.(detailAppointment.guestId)}
                  className="text-[var(--color-accent-spa)] font-medium"
                >
                  {detailAppointment.guestName}
                </button>
              </div>
              <div>
                <span className={fieldLabelClass}>Treatment</span>
                <div className="text-gray-900 dark:text-white">{detailAppointment.treatment} ({detailAppointment.duration} min)</div>
              </div>
              <div>
                <span className={fieldLabelClass}>Therapist</span>
                <button
                  onClick={() => detailAppointment.therapistId && onViewTherapist?.(detailAppointment.therapistId)}
                  className="text-[var(--color-accent-spa)]"
                >
                  {detailAppointment.therapist}
                </button>
              </div>
              <div>
                <span className={fieldLabelClass}>Room</span>
                <div className="text-gray-900 dark:text-white">{detailAppointment.room}</div>
              </div>
              <div>
                <span className={fieldLabelClass}>Date & Time</span>
                <div className="text-gray-900 dark:text-white">
                  {new Date(detailAppointment.date).toLocaleDateString()} at {detailAppointment.time}
                </div>
              </div>
              <div>
                <span className={fieldLabelClass}>Amount</span>
                <div className="text-gray-900 dark:text-white font-medium">${detailAppointment.amount}</div>
              </div>
              {detailAppointment.notes && (
                <div className="col-span-2">
                  <span className={fieldLabelClass}>Notes</span>
                  <div className="text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                    {detailAppointment.notes}
                  </div>
                </div>
              )}
              <div className="col-span-2">
                <span className={fieldLabelClass}><History size={12} className="inline-block mr-1 -mt-0.5" />Audit History</span>
                {history.length === 0 ? (
                  <div className="text-xs text-gray-400">No recorded changes.</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
                    {history.map(h => (
                      <div key={h.id} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900 dark:text-white capitalize">{h.action}</span>
                          <span className="text-gray-400">{new Date(h.created_at).toLocaleString()}</span>
                        </div>
                        <div className="text-gray-500 dark:text-gray-400 mt-0.5">
                          {h.from_status && h.to_status ? `${h.from_status} → ${h.to_status}` : h.to_status || ''}
                          {h.changed_by_name ? ` · by ${h.changed_by_name}` : ''}
                        </div>
                        {h.notes && <div className="text-gray-400 mt-0.5">{h.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 rounded-b-2xl">
              {detailAppointment.seriesId && !['Cancelled', 'Completed', 'No Show'].includes(detailAppointment.status) && (
                <button
                  onClick={() => handleCancelSeries(detailAppointment.seriesId)}
                  className="mr-auto flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                >
                  <Repeat className="w-3.5 h-3.5" /> Cancel Series
                </button>
              )}
              <button onClick={closeDetail} className={button.secondary}>
                Close
              </button>
              <button
                onClick={() => { openEditModal(detailAppointment); setDetailAppointment(null); }}
                className={button.primary}
              >
                Edit <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppointmentManagementModule;
