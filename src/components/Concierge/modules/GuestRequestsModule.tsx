/**
 * Guest Requests Module
 * Manage and track guest service requests.
 *
 * DB-integrated: GET/POST/PUT /api/concierge/requests — reads guest_requests
 * rows (snake_case) joined to reservations for guest-profile navigation.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClipboardList,
  Search,
  RefreshCw,
  Plus,
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  User,
  BedDouble,
  Calendar,
  Star,
  Loader2,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface GuestRequestsModuleProps {
  selectedRequestId?: string;
  onClearSelectedRequestId?: () => void;
  onSelectRequestId?: (requestId: string) => void;
  onViewGuestProfile?: (guestId: string) => void;
}

interface GuestRequest {
  id: string;
  request_number: string;
  reservation_id: string | null;
  room_number: string | null;
  guest_name: string;
  request_type: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  assigned_department: string | null;
  submitted_at: string;
  scheduled_for: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  notes: string | null;
  rating: number | null;
  feedback: string | null;
  guest_id?: string | null;
  reservation?: { id: string; guest_id: string; room_type?: string; check_in_date?: string; check_out_date?: string; status?: string } | null;
}

interface OverviewGuest {
  reservationId: string;
  name: string;
  roomNumber: string;
}

// Canonical request types shared with the specialist modules and the guest
// portal category map. 'Transportation' and 'Restaurant Booking' are
// deliberately absent — those have dedicated modules that write real
// transport_requests / fb_table_reservations records.
const REQUEST_TYPES = [
  'General Inquiry',
  'Experience Booking',
  'Tour Booking',
  'Ticket Booking',
  'Personal Shopping',
  'Itinerary Planning',
  'Luggage',
  'Package',
  'VIP Service',
  'Wake-up Call',
  'Medical Assistance',
  'Special Celebration',
  'Information Request',
  'Other',
];

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const STATUS_TONE: Record<string, StatusTone> = {
  Open: 'warning',
  Assigned: 'info',
  'In Progress': 'accent',
  'Waiting': 'neutral',
  Completed: 'success',
  Cancelled: 'neutral',
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  Urgent: 'danger',
  High: 'danger',
  Normal: 'neutral',
  Low: 'neutral',
};

const STATUS_FILTERS = ['', 'Open', 'Assigned', 'In Progress', 'Waiting', 'Completed', 'Cancelled'];

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
const formatDateTime = (v?: string | null) => (v ? dateTimeFmt.format(new Date(v)) : '—');

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const GuestRequestsModule: React.FC<GuestRequestsModuleProps> = ({
  selectedRequestId,
  onClearSelectedRequestId,
  onSelectRequestId,
  onViewGuestProfile,
}) => {
  const { addNotification, userProfile } = useERP();
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [detail, setDetail] = useState<GuestRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const parseJson = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected response (${response.status})`);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ department: 'Concierge', limit: '200' });
      if (filterStatus) params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      if (search.trim()) params.set('search', search.trim());
      const response = await conciergeFetch(`/api/concierge/requests?${params.toString()}`);
      setRequests(await parseJson(response));
    } catch (e: any) {
      setError(e?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority, search]);

  useEffect(() => {
    const timer = setTimeout(fetchRequests, 300);
    return () => clearTimeout(timer);
  }, [fetchRequests]);

  const fetchDetail = useCallback(async () => {
    if (!selectedRequestId) {
      setDetail(null);
      return;
    }
    try {
      setDetailLoading(true);
      setDetailError(null);
      const response = await conciergeFetch(`/api/concierge/requests/${selectedRequestId}`);
      setDetail(await parseJson(response));
    } catch (e: any) {
      setDetail(null);
      setDetailError(e?.message || 'Failed to load request');
    } finally {
      setDetailLoading(false);
    }
  }, [selectedRequestId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const stats = useMemo(() => ({
    open: requests.filter((r) => r.status === 'Open').length,
    inProgress: requests.filter((r) => r.status === 'In Progress' || r.status === 'Assigned').length,
    completedToday: requests.filter(
      (r) => r.status === 'Completed' && r.completed_at && r.completed_at.slice(0, 10) === new Date().toISOString().slice(0, 10)
    ).length,
    urgent: requests.filter((r) => r.priority === 'Urgent' && !['Completed', 'Cancelled'].includes(r.status)).length,
  }), [requests]);

  const updateStatus = async (id: string, updates: Record<string, any>) => {
    try {
      setActionBusy(true);
      const response = await conciergeFetch(`/api/concierge/requests/${id}`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify(updates),
      });
      await parseJson(response);
      addNotification('Request updated', 'success', 'Concierge');
      await fetchDetail();
      fetchRequests();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update request', 'danger', 'Concierge');
    } finally {
      setActionBusy(false);
    }
  };

  const handleClear = () => {
    setDetail(null);
    onClearSelectedRequestId?.();
  };

  // ── Detail view ─────────────────────────────────────────────────────────
  if (selectedRequestId) {
    const guestId = detail?.guest_id;
    return (
      <div className={layout.sectionStack}>
        <PageHeader
          title={detail?.request_number || 'Request Details'}
          subtitle={detail ? `${detail.request_type} · ${detail.guest_name}` : 'Loading request…'}
          icon={ClipboardList}
          actions={
            <div className="flex items-center gap-2">
              <button type="button" onClick={fetchDetail} disabled={detailLoading} className={button.secondary}>
                <RefreshCw size={16} className={detailLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button type="button" onClick={handleClear} className={button.secondary}>
                <ArrowLeft size={16} />
                All Requests
              </button>
            </div>
          }
        />

        {detailError && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle size={16} />
            {detailError}
          </div>
        )}

        {detailLoading && !detail ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : detail ? (
          <>
            {/* Header card */}
            <SectionCard pad="md">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{detail.request_type}</h2>
                    <Badge tone={STATUS_TONE[detail.status] || 'neutral'}>{detail.status}</Badge>
                    <Badge tone={PRIORITY_TONE[detail.priority] || 'neutral'}>{detail.priority}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{detail.description}</p>
                </div>
                {/* Lifecycle actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {detail.status === 'Open' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      className={button.primary}
                      onClick={() => updateStatus(detail.id, {
                        status: 'Assigned',
                        assigned_to: userProfile?.name || 'Concierge Desk',
                        acknowledged_at: new Date().toISOString(),
                      })}
                    >
                      Assign to Me
                    </button>
                  )}
                  {detail.status === 'Assigned' && (
                    <button type="button" disabled={actionBusy} className={button.primary} onClick={() => updateStatus(detail.id, { status: 'In Progress' })}>
                      Start Work
                    </button>
                  )}
                  {detail.status === 'In Progress' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      className={button.primary}
                      onClick={() => updateStatus(detail.id, { status: 'Completed', completed_at: new Date().toISOString() })}
                    >
                      <CheckCircle2 size={15} />
                      Mark Complete
                    </button>
                  )}
                  {!['Completed', 'Cancelled'].includes(detail.status) && (
                    <button type="button" disabled={actionBusy} className={button.secondary} onClick={() => updateStatus(detail.id, { status: 'Cancelled' })}>
                      <XCircle size={15} />
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </SectionCard>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Guest & reservation */}
              <SectionCard title="Guest" pad="md">
                <dl className="space-y-3">
                  <InfoRow icon={<User size={15} />} label="Guest" value={detail.guest_name} />
                  <InfoRow icon={<BedDouble size={15} />} label="Room" value={detail.room_number || '—'} />
                  <InfoRow icon={<Calendar size={15} />} label="Reservation" value={detail.reservation_id || '—'} />
                  <InfoRow icon={<User size={15} />} label="Assigned To" value={detail.assigned_to || 'Unassigned'} />
                </dl>
                {guestId && onViewGuestProfile && (
                  <button type="button" onClick={() => onViewGuestProfile(guestId)} className={`${button.secondary} mt-4`}>
                    View Guest Profile
                  </button>
                )}
              </SectionCard>

              {/* Timeline */}
              <SectionCard title="Timeline" pad="md">
                <dl className="space-y-3">
                  <InfoRow icon={<Clock size={15} />} label="Submitted" value={formatDateTime(detail.submitted_at)} />
                  {detail.scheduled_for && (
                    <InfoRow icon={<Calendar size={15} />} label="Scheduled" value={formatDateTime(detail.scheduled_for)} />
                  )}
                  <InfoRow icon={<Clock size={15} />} label="Acknowledged" value={formatDateTime(detail.acknowledged_at)} />
                  <InfoRow icon={<CheckCircle2 size={15} />} label="Completed" value={formatDateTime(detail.completed_at)} />
                </dl>
                {detail.rating != null && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-900/20">
                    <Star size={15} className="fill-amber-500 text-amber-500" />
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{detail.rating}/5</span>
                    {detail.feedback && <span className="truncate text-sm text-amber-700 dark:text-amber-400">— {detail.feedback}</span>}
                  </div>
                )}
                {detail.notes && (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    {detail.notes}
                  </p>
                )}
              </SectionCard>
            </div>
          </>
        ) : !detailLoading && !detailError ? (
          <div className="py-12 text-center">
            <ClipboardList size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Request not found.</p>
          </div>
        ) : null}
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────
  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Requests"
        subtitle="Concierge service requests and assignments"
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchRequests} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => setShowNew(true)} className={button.primary}>
              <Plus size={16} />
              New Request
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open" value={stats.open} icon={Clock} tone="warning" />
        <StatCard title="Assigned / In Progress" value={stats.inProgress} icon={ClipboardList} tone="info" />
        <StatCard title="Completed Today" value={stats.completedToday} icon={CheckCircle2} tone="success" />
        <StatCard title="Urgent" value={stats.urgent} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search guest, request #, room or type…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s || 'All Status'}</option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="">All Priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </SectionCard>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Requests table */}
      <SectionCard
        title="Requests"
        subtitle={`${requests.length} request${requests.length === 1 ? '' : 's'}`}
        pad="none"
      >
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <ClipboardList size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No requests found</p>
            <p className="mt-1 text-xs text-slate-400">Try a different filter, or create a new request.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Request</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Priority</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Assigned To</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {requests.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onSelectRequestId?.(r.id)}
                    className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{r.request_type}</div>
                      <div className="text-xs text-slate-400">{r.request_number || r.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">{r.guest_name}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">{r.room_number || '—'}</td>
                    <td className="px-5 py-3.5"><Badge tone={PRIORITY_TONE[r.priority] || 'neutral'}>{r.priority}</Badge></td>
                    <td className="px-5 py-3.5"><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">{r.assigned_to || '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400" title={formatDateTime(r.submitted_at)}>
                      {timeAgo(r.submitted_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            fetchRequests();
            addNotification('Request created', 'success', 'Concierge');
          }}
        />
      )}
    </div>
  );
};

const InfoRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-3">
    <div className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{icon}</div>
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="truncate text-sm font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  </div>
);

// ── New Request modal ──────────────────────────────────────────────────────
// Guest picker is populated from the service-center overview (in-house +
// arriving + departing), so each request links to a real reservation/room.
const NewRequestModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const { userProfile } = useERP();
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(true);
  const [reservationId, setReservationId] = useState('');
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [priority, setPriority] = useState('Normal');
  const [scheduledFor, setScheduledFor] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    conciergeFetch('/api/concierge/service-center/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed to load guests (${r.status})`))))
      .then((data) => {
        if (cancelled) return;
        const all: OverviewGuest[] = [
          ...(data.inHouse || []),
          ...(data.arriving || []),
          ...(data.departing || []),
        ].map((g: any) => ({ reservationId: g.reservationId, name: g.name, roomNumber: g.roomNumber }));
        const seen = new Set<string>();
        setGuests(all.filter((g) => (seen.has(g.reservationId) ? false : seen.add(g.reservationId))));
      })
      .catch(() => { if (!cancelled) setGuests([]); })
      .finally(() => { if (!cancelled) setGuestsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selectedGuest = guests.find((g) => g.reservationId === reservationId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGuest) {
      setSubmitError('Please select a guest');
      return;
    }
    if (!description.trim()) {
      setSubmitError('Description is required');
      return;
    }
    try {
      setSubmitting(true);
      setSubmitError(null);
      const response = await conciergeFetch('/api/concierge/requests', {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          reservation_id: selectedGuest.reservationId,
          room_number: selectedGuest.roomNumber,
          guest_name: selectedGuest.name,
          request_type: requestType,
          description: description.trim(),
          priority,
          scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error(`Unexpected response (${response.status})`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Failed to create request (${response.status})`);
      onCreated();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to create request');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-lg bg-indigo-100 p-2 dark:bg-indigo-900/30">
            <ClipboardList size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">New Guest Request</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Guest</label>
            <select
              value={reservationId}
              onChange={(e) => setReservationId(e.target.value)}
              className={inputClass}
              disabled={guestsLoading}
            >
              <option value="">{guestsLoading ? 'Loading guests…' : 'Select guest…'}</option>
              {guests.map((g) => (
                <option key={g.reservationId} value={g.reservationId}>
                  {g.name} — Room {g.roomNumber}
                </option>
              ))}
            </select>
            {!guestsLoading && guests.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">No in-house or arriving guests found.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Request Type</label>
              <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className={inputClass}>
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>
              Scheduled for <span className="font-normal text-slate-400">(required for auto-dispatch, e.g. wake-up calls)</span>
            </label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does the guest need?"
              className={inputClass}
            />
          </div>

          {submitError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={14} />
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className={button.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={submitting || guestsLoading} className={button.primary}>
              {submitting ? 'Creating…' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GuestRequestsModule;
