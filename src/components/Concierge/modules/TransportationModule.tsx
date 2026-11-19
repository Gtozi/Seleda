/**
 * Transportation Coordination Module
 * Airport transfers and transportation arrangements.
 *
 * DB-integrated: reads/writes the shared `transport_requests` workflow
 * (source='Concierge') — the same queue the Transport & Fleet portal
 * dispatches from. Requests are linked to real reservations picked from
 * the service-center overview so guest_id/room resolve automatically.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Car,
  Plus,
  RefreshCw,
  PlaneTakeoff,
  PlaneLanding,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  CalendarPlus,
  ArrowRight,
  Users,
} from 'lucide-react';
import { conciergeFetch } from '../conciergeApi';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface TransportationModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface ShuttleRequest {
  id: string;
  request_number?: string | null;
  guest_id?: string | null;
  reservation_id?: string | null;
  guest_name: string;
  room?: string | null;
  type?: string | null;
  flight_number?: string | null;
  scheduled_time?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  quantity?: number;
  status: string;
  assigned_vehicle?: string | null;
  notes?: string | null;
  created_at: string;
}

interface OverviewGuest {
  reservationId: string;
  name: string;
  roomNumber: string;
  isVIP?: boolean;
}

const STATUS_TONE: Record<string, StatusTone> = {
  Pending: 'warning',
  Confirmed: 'info',
  'In Progress': 'accent',
  Completed: 'success',
  Cancelled: 'danger',
};

// Allowed concierge-side transitions (mirrors PUT
// /api/concierge/transportation/shuttle-requests/:id status mapping).
const NEXT_STATUS: Record<string, string[]> = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['In Progress', 'Cancelled'],
  'In Progress': ['Completed', 'Cancelled'],
};

const TYPE_TONE: Record<string, StatusTone> = {
  'Airport Pickup': 'info',
  'Airport Drop-off': 'warning',
  'City Transfer': 'accent',
  'Hotel Shuttle': 'neutral',
  'Sightseeing Tour': 'success',
  'VIP Transport': 'danger',
};

const TRANSFER_TYPES = [
  'Airport Pickup',
  'Airport Drop-off',
  'City Transfer',
  'Hotel Shuttle',
  'Sightseeing Tour',
  'VIP Transport',
];

const AIRPORT = 'Bole International Airport (ADD)';
const HOTEL = 'Hotel Main Entrance';

function routeFor(type: string): { pickup: string; dropoff: string } {
  switch (type) {
    case 'Airport Pickup':
      return { pickup: AIRPORT, dropoff: HOTEL };
    case 'Airport Drop-off':
      return { pickup: HOTEL, dropoff: AIRPORT };
    default:
      return { pickup: HOTEL, dropoff: '' };
  }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const TransportationModule: React.FC<TransportationModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification } = useERP();
  const [shuttleRequests, setShuttleRequests] = useState<ShuttleRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState({
    reservationId: '',
    type: 'Airport Pickup',
    flight_number: '',
    scheduled_time: '',
    pickup_location: AIRPORT,
    dropoff_location: HOTEL,
    quantity: 1,
    notes: '',
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
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      const [shuttleRes, overviewRes] = await Promise.all([
        conciergeFetch(`/api/concierge/transportation/shuttle-requests?${params}`),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setShuttleRequests(await parseJson(shuttleRes));
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
      setError(e?.message || 'Failed to load transportation requests');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    pending: shuttleRequests.filter((r) => r.status === 'Pending').length,
    confirmed: shuttleRequests.filter((r) => r.status === 'Confirmed').length,
    inProgress: shuttleRequests.filter((r) => r.status === 'In Progress').length,
    completed: shuttleRequests.filter((r) => r.status === 'Completed').length,
  }), [shuttleRequests]);

  const selectedGuest = guests.find((g) => g.reservationId === newRequest.reservationId);

  const setType = (type: string) => {
    const route = routeFor(type);
    setNewRequest((prev) => ({
      ...prev,
      type,
      pickup_location: route.pickup,
      dropoff_location: route.dropoff || prev.dropoff_location,
    }));
  };

  const openForm = () => {
    setFormError(null);
    setShowForm(true);
  };

  const handleStatusChange = async (r: ShuttleRequest, status: string) => {
    try {
      setUpdatingId(r.id);
      setError(null);
      const response = await conciergeFetch(`/api/concierge/transportation/shuttle-requests/${r.id}`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify({ status }),
      });
      const updated = await parseJson(response);
      setShuttleRequests((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated } : x)));
      addNotification(`Transfer ${status.toLowerCase()}`, 'success', 'Concierge');
    } catch (e: any) {
      setError(e?.message || 'Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateRequest = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!newRequest.scheduled_time) {
      setFormError('Please pick a scheduled time');
      return;
    }
    if (!newRequest.pickup_location.trim() || !newRequest.dropoff_location.trim()) {
      setFormError('Pickup and dropoff locations are required');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const response = await conciergeFetch('/api/concierge/transportation/shuttle-requests', {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          reservation_id: selectedGuest.reservationId,
          guest_name: selectedGuest.name,
          flight_number: newRequest.flight_number.trim() || null,
          scheduled_time: newRequest.scheduled_time,
          pickup_location: newRequest.pickup_location.trim(),
          dropoff_location: newRequest.dropoff_location.trim(),
          quantity: newRequest.quantity,
          notes: [newRequest.type !== 'Airport Pickup' && newRequest.type !== 'Airport Drop-off' ? newRequest.type : null, newRequest.notes.trim() || null].filter(Boolean).join(' | ') || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewRequest({
        reservationId: '',
        type: 'Airport Pickup',
        flight_number: '',
        scheduled_time: '',
        pickup_location: AIRPORT,
        dropoff_location: HOTEL,
        quantity: 1,
        notes: '',
      });
      addNotification('Transfer scheduled', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to schedule transfer');
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
        title="Transportation Coordination"
        subtitle="Airport transfers and transportation arrangements"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200"
            >
              <option value="">All Status</option>
              <option value="Pending">Pending</option>
              <option value="Confirmed">Confirmed</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={openForm} className={button.primary}>
              <Plus size={16} />
              New Transfer
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <StatCard title="Confirmed" value={stats.confirmed} icon={CheckCircle2} tone="info" />
        <StatCard title="In Progress" value={stats.inProgress} icon={Car} tone="accent" />
        <StatCard title="Completed" value={stats.completed} icon={ClipboardList} tone="success" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Transfer form */}
      {showForm && (
        <SectionCard title="Schedule Transfer" subtitle="Pushed to the Transport & Fleet dispatch queue" icon={CalendarPlus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Guest</label>
              <select
                value={newRequest.reservationId}
                onChange={(e) => setNewRequest({ ...newRequest, reservationId: e.target.value })}
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
              <label className={labelClass}>Transfer Type</label>
              <select value={newRequest.type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                {TRANSFER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Flight Number</label>
              <input
                type="text"
                value={newRequest.flight_number}
                onChange={(e) => setNewRequest({ ...newRequest, flight_number: e.target.value })}
                className={inputClass}
                placeholder="e.g. ET302"
              />
            </div>
            <div>
              <label className={labelClass}>Scheduled Time</label>
              <input
                type="datetime-local"
                value={newRequest.scheduled_time}
                onChange={(e) => setNewRequest({ ...newRequest, scheduled_time: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Pickup Location</label>
              <input
                type="text"
                value={newRequest.pickup_location}
                onChange={(e) => setNewRequest({ ...newRequest, pickup_location: e.target.value })}
                className={inputClass}
                placeholder="Airport or hotel address"
              />
            </div>
            <div>
              <label className={labelClass}>Dropoff Location</label>
              <input
                type="text"
                value={newRequest.dropoff_location}
                onChange={(e) => setNewRequest({ ...newRequest, dropoff_location: e.target.value })}
                className={inputClass}
                placeholder="Hotel or destination address"
              />
            </div>
            <div>
              <label className={labelClass}>Passengers</label>
              <input
                type="number"
                min={1}
                max={50}
                value={newRequest.quantity}
                onChange={(e) => setNewRequest({ ...newRequest, quantity: Math.max(1, Number(e.target.value) || 1) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input
                type="text"
                value={newRequest.notes}
                onChange={(e) => setNewRequest({ ...newRequest, notes: e.target.value })}
                className={inputClass}
                placeholder="Child seat, meet & greet, wait-and-return…"
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
            <button type="button" onClick={handleCreateRequest} disabled={submitting || loading} className={button.primary}>
              {submitting ? 'Scheduling…' : 'Schedule Transfer'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Transfer requests */}
      <SectionCard title="Transfer Requests" subtitle={`${shuttleRequests.length} request${shuttleRequests.length === 1 ? '' : 's'}${filterStatus ? ` · ${filterStatus}` : ''}`} icon={Car} tone="accent" pad="none">
        {loading && shuttleRequests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : shuttleRequests.length === 0 ? (
          <div className="py-12 text-center">
            <Car size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No transfer requests</p>
            <p className="mt-1 text-xs text-slate-400">Schedule a transfer for a guest above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Type</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Flight</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Scheduled</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Route</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {shuttleRequests.map((r) => (
                  <tr key={r.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => r.guest_id && onViewGuestProfile?.(r.guest_id)}
                        className={`text-sm font-medium ${r.guest_id ? 'text-indigo-600 hover:underline dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}
                      >
                        {r.guest_name}
                      </button>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        {r.room && <span>Room {r.room}</span>}
                        {r.quantity ? (
                          <span className="inline-flex items-center gap-0.5">
                            <Users size={10} /> {r.quantity}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.type ? <Badge tone={TYPE_TONE[r.type] || 'neutral'}>{r.type}</Badge> : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      {r.flight_number ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                          {r.type === 'Airport Drop-off' ? <PlaneTakeoff size={11} /> : <PlaneLanding size={11} />}
                          {r.flight_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">{formatDateTime(r.scheduled_time)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex max-w-xs items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <span className="truncate">{r.pickup_location}</span>
                        <ArrowRight size={11} className="shrink-0 text-slate-400" />
                        <span className="truncate">{r.dropoff_location}</span>
                      </div>
                      {r.assigned_vehicle && (
                        <div className="mt-0.5 text-xs text-slate-400">Vehicle {r.assigned_vehicle}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${statusTone[STATUS_TONE[r.status] || 'neutral'].dot}`} />
                        <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                      </span>
                      {(NEXT_STATUS[r.status] || []).length > 0 && (
                        <select
                          value=""
                          disabled={updatingId === r.id}
                          onChange={(e) => {
                            const next = e.target.value;
                            e.target.value = '';
                            if (next) handleStatusChange(r, next);
                          }}
                          className="ml-2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 outline-none transition focus:border-indigo-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          <option value="">{updatingId === r.id ? 'Updating…' : 'Update…'}</option>
                          {NEXT_STATUS[r.status].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default TransportationModule;
