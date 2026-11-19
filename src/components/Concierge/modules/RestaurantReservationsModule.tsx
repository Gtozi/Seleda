/**
 * Restaurant Reservations Module
 * Manage reservations for hotel and partner restaurants.
 *
 * DB-integrated: venues from the real `outlets` table via
 * /api/food-beverage/outlets, bookings persisted to the real F&B book
 * (fb_table_reservations) via /api/concierge/restaurant-reservations, which
 * also writes a guest_requests audit row for the concierge queue.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UtensilsCrossed,
  Plus,
  RefreshCw,
  Calendar,
  CalendarPlus,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  Wine,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface RestaurantReservationsModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface Outlet {
  id: string;
  name: string;
  type: string;
  operating_hours?: Record<string, { open: string; close: string }> | null;
  is_active: boolean;
}

interface ReservationRequest {
  id: string;
  request_number: string;
  guest_name: string;
  room_number: string | null;
  description: string;
  notes: string | null;
  priority: string;
  status: string;
  submitted_at: string;
  assigned_to?: string | null;
  guest_id?: string | null;
}

interface OverviewGuest {
  reservationId: string;
  name: string;
  roomNumber: string;
  isVIP?: boolean;
}

const STATUS_TONE: Record<string, StatusTone> = {
  Open: 'warning',
  Assigned: 'info',
  'In Progress': 'accent',
  Completed: 'success',
  Cancelled: 'neutral',
};

const OUTLET_ICON: Record<string, LucideIcon> = {
  Restaurant: UtensilsCrossed,
  Bar: Wine,
  Banquet: Users,
};

const OUTLET_TONE: Record<string, StatusTone> = {
  Restaurant: 'accent',
  Bar: 'info',
  Banquet: 'warning',
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function todayHours(outlet: Outlet): string | null {
  const hours = outlet.operating_hours?.[DAY_KEYS[new Date().getDay()]];
  return hours ? `${hours.open} – ${hours.close}` : null;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const RestaurantReservationsModule: React.FC<RestaurantReservationsModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification } = useERP();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [requests, setRequests] = useState<ReservationRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'venues' | 'reservations'>('venues');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newReservation, setNewReservation] = useState({
    reservationId: '',
    outletId: '',
    dateTime: '',
    partySize: 2,
    specialRequests: '',
  });

  const parseJson = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected response (${response.status})`);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [outletsRes, requestsRes, overviewRes] = await Promise.all([
        conciergeFetch('/api/food-beverage/outlets'),
        conciergeFetch('/api/concierge/requests?request_type=Restaurant Booking&department=Concierge'),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      const outletRows: Outlet[] = await parseJson(outletsRes);
      setOutlets(outletRows.filter((o) => o.is_active));
      setRequests(await parseJson(requestsRes));
      const overview = await parseJson(overviewRes);
      const seen = new Set<string>();
      setGuests(
        [...(overview.inHouse || []), ...(overview.arriving || []), ...(overview.departing || [])]
          .map((g: any) => ({ reservationId: g.reservationId, name: g.name, roomNumber: g.roomNumber, isVIP: g.isVIP }))
          .filter((g: OverviewGuest) => {
            if (!g.reservationId || seen.has(g.reservationId)) return false;
            seen.add(g.reservationId);
            return true;
          })
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load restaurant reservations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    outlets: outlets.length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [outlets, requests]);

  const openForm = (outletId?: string) => {
    setFormError(null);
    setNewReservation((prev) => ({ ...prev, outletId: outletId ?? prev.outletId }));
    setShowForm(true);
  };

  const selectedGuest = guests.find((g) => g.reservationId === newReservation.reservationId);
  const selectedOutlet = outlets.find((o) => o.id === newReservation.outletId);

  const handleCreateReservation = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!selectedOutlet) {
      setFormError('Please select a restaurant');
      return;
    }
    if (!newReservation.dateTime) {
      setFormError('Please pick a date and time');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const response = await conciergeFetch('/api/concierge/restaurant-reservations', {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          reservation_id: selectedGuest.reservationId,
          outlet_id: selectedOutlet.id,
          arrival_time: new Date(newReservation.dateTime).toISOString(),
          party_size: newReservation.partySize,
          special_requests: newReservation.specialRequests.trim() || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewReservation({ reservationId: '', outletId: '', dateTime: '', partySize: 2, specialRequests: '' });
      addNotification('Restaurant reservation created', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create reservation');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Restaurant Reservations"
        subtitle="Book hotel and partner restaurant reservations for guests"
        icon={UtensilsCrossed}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => openForm()} className={button.primary}>
              <Plus size={16} />
              New Reservation
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Venues" value={stats.outlets} icon={Store} tone="accent" />
        <StatCard title="Active Reservations" value={stats.active} icon={Clock} tone="warning" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Requests" value={requests.length} icon={ClipboardList} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Reservation form */}
      {showForm && (
        <SectionCard title="New Restaurant Reservation" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Guest</label>
              <select
                value={newReservation.reservationId}
                onChange={(e) => setNewReservation({ ...newReservation, reservationId: e.target.value })}
                className={inputClass}
                disabled={loading}
              >
                <option value="">{loading ? 'Loading guests…' : 'Select guest…'}</option>
                {guests.map((g) => (
                  <option key={g.reservationId} value={g.reservationId}>
                    {g.name} — Room {g.roomNumber}{g.isVIP ? ' (VIP)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Restaurant</label>
              <select
                value={newReservation.outletId}
                onChange={(e) => setNewReservation({ ...newReservation, outletId: e.target.value })}
                className={inputClass}
              >
                <option value="">Select restaurant…</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{todayHours(o) ? ` (${todayHours(o)})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Date & Time</label>
              <input
                type="datetime-local"
                value={newReservation.dateTime}
                onChange={(e) => setNewReservation({ ...newReservation, dateTime: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Party Size</label>
              <input
                type="number"
                min={1}
                max={50}
                value={newReservation.partySize}
                onChange={(e) => setNewReservation({ ...newReservation, partySize: Math.max(1, Number(e.target.value) || 1) })}
                className={inputClass}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Special Requests</label>
              <textarea
                value={newReservation.specialRequests}
                onChange={(e) => setNewReservation({ ...newReservation, specialRequests: e.target.value })}
                rows={2}
                placeholder="Dietary requirements, occasions, seating preferences…"
                className={inputClass}
              />
            </div>
          </div>
          {formError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={14} />
              {formError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className={button.secondary}>
              Cancel
            </button>
            <button type="button" onClick={handleCreateReservation} disabled={submitting || loading} className={button.primary}>
              {submitting ? 'Booking…' : 'Create Reservation'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Sub-tabs */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'venues', label: 'Venues', icon: Store, count: outlets.length },
            { id: 'reservations', label: 'Reservations', icon: ClipboardList, count: requests.length },
          ] as const).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === t.id
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeTab === t.id
                    ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]'
                    : 'bg-slate-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
                }`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Venues */}
      {activeTab === 'venues' && (
      <SectionCard title="Venues" subtitle={`${stats.outlets} outlets accepting reservations`} icon={Store} tone="accent" pad="md">
        {loading && outlets.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : outlets.length === 0 ? (
          <div className="py-10 text-center">
            <Store size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No active outlets found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outlets.map((outlet) => {
              const Icon = OUTLET_ICON[outlet.type] || Store;
              const hours = todayHours(outlet);
              return (
                <div
                  key={outlet.id}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-slate-700 dark:hover:border-indigo-700"
                >
                  <div className="shrink-0 rounded-lg bg-indigo-100 p-2.5 text-indigo-600 transition group-hover:scale-105 dark:bg-indigo-900/40 dark:text-indigo-300">
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-slate-900 dark:text-white">{outlet.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={OUTLET_TONE[outlet.type] || 'neutral'}>{outlet.type}</Badge>
                      {hours && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Clock size={11} /> {hours}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openForm(outlet.id)}
                    className="inline-flex shrink-0 items-center rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                  >
                    Book
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
      )}

      {/* Reservations list */}
      {activeTab === 'reservations' && (
      <SectionCard title="Reservations" subtitle={`${requests.length} booking request${requests.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No reservations yet</p>
            <p className="mt-1 text-xs text-slate-400">Book a venue for a guest above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Details</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {requests.map((r) => (
                  <tr key={r.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => r.guest_id && onViewGuestProfile?.(r.guest_id)}
                        className={`text-sm font-medium ${r.guest_id ? 'text-indigo-600 hover:underline dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}
                      >
                        {r.guest_name}
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.room_number ? (
                        <span className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                          {r.room_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="max-w-md px-5 py-3.5">
                      <div className="truncate text-sm text-slate-700 dark:text-slate-300">{r.description}</div>
                      {r.notes && <div className="truncate text-xs text-slate-400">{r.notes}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${statusTone[STATUS_TONE[r.status] || 'neutral'].dot}`} />
                        <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">{timeAgo(r.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      )}
    </div>
  );
};

export default RestaurantReservationsModule;
