/**
 * Concierge Desk Module
 * Daily operations workspace — quick request capture and recent activity.
 *
 * DB-integrated: reads /api/concierge/service-center/overview (in-house /
 * arriving guests) and /api/concierge/requests; creates requests via
 * POST /api/concierge/requests linked to real reservations.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Headphones,
  MapPin,
  Utensils,
  Car,
  RefreshCw,
  Plus,
  Clock,
  ClipboardList,
  Users,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface ConciergeDeskModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
  onCreateRequest?: (requestId: string) => void;
}

interface QuickRequest {
  id: string;
  request_number: string;
  guest_name: string;
  room_number: string | null;
  request_type: string;
  priority: string;
  status: string;
  submitted_at: string;
  guest_id?: string | null;
}

interface OverviewGuest {
  reservationId: string;
  name: string;
  roomNumber: string;
  isVIP?: boolean;
  status?: string;
}

interface ServiceCenterOverview {
  inHouse: OverviewGuest[];
  arriving: OverviewGuest[];
  departing: OverviewGuest[];
  queue: { id: string; status?: string }[];
}

const REQUEST_TYPES = [
  'Information Request',
  'Transportation',
  'Restaurant Booking',
  'Tour Booking',
  'Ticket Booking',
  'Shopping Assistance',
  'Wake-up Call',
  'Luggage',
  'VIP Service',
  'Medical Assistance',
  'Special Celebration',
  'Other',
];

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const STATUS_TONE: Record<string, StatusTone> = {
  Open: 'warning',
  Assigned: 'info',
  'In Progress': 'accent',
  Waiting: 'neutral',
  Completed: 'success',
  Cancelled: 'neutral',
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  Urgent: 'danger',
  High: 'danger',
  Normal: 'neutral',
  Low: 'neutral',
};

const QUICK_ACTIONS: { icon: typeof MapPin; title: string; description: string; requestType: string }[] = [
  { icon: MapPin, title: 'Local Information', description: 'Directions, recommendations, and local tips', requestType: 'Information Request' },
  { icon: Utensils, title: 'Restaurant Booking', description: 'Reserve a table for a guest', requestType: 'Restaurant Booking' },
  { icon: Car, title: 'Transportation', description: 'Arrange transfers and taxis', requestType: 'Transportation' },
];

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ConciergeDeskModule: React.FC<ConciergeDeskModuleProps> = ({ onViewGuestProfile, onCreateRequest }) => {
  const { addNotification, userProfile } = useERP();
  const [overview, setOverview] = useState<ServiceCenterOverview | null>(null);
  const [quickRequests, setQuickRequests] = useState<QuickRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState({
    reservationId: '',
    requestType: 'Information Request',
    priority: 'Normal',
    description: '',
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
      const [overviewRes, requestsRes] = await Promise.all([
        conciergeFetch('/api/concierge/service-center/overview'),
        conciergeFetch('/api/concierge/requests?department=Concierge&limit=10'),
      ]);
      setOverview(await parseJson(overviewRes));
      setQuickRequests(await parseJson(requestsRes));
    } catch (e: any) {
      setError(e?.message || 'Failed to load concierge desk data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Guests eligible for a new request — in-house + arriving + departing,
  // deduplicated by reservation.
  const bookableGuests = useMemo(() => {
    if (!overview) return [];
    const seen = new Set<string>();
    return [...overview.inHouse, ...overview.arriving, ...overview.departing].filter((g) => {
      if (!g.reservationId || seen.has(g.reservationId)) return false;
      seen.add(g.reservationId);
      return true;
    });
  }, [overview]);

  const stats = useMemo(() => ({
    inHouse: overview?.inHouse.length ?? 0,
    open: quickRequests.filter((r) => r.status === 'Open').length,
    inProgress: quickRequests.filter((r) => r.status === 'In Progress' || r.status === 'Assigned').length,
    queueTotal: overview?.queue.length ?? 0,
  }), [overview, quickRequests]);

  const openForm = (requestType: string) => {
    setFormError(null);
    setNewRequest((prev) => ({ ...prev, requestType }));
    setShowNewRequestForm(true);
  };

  const selectedGuest = bookableGuests.find((g) => g.reservationId === newRequest.reservationId);

  const handleCreateRequest = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!newRequest.description.trim()) {
      setFormError('Description is required');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const response = await conciergeFetch('/api/concierge/requests', {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          reservation_id: selectedGuest.reservationId,
          room_number: selectedGuest.roomNumber,
          guest_name: selectedGuest.name,
          request_type: newRequest.requestType,
          description: newRequest.description.trim(),
          priority: newRequest.priority,
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowNewRequestForm(false);
      setNewRequest({ reservationId: '', requestType: 'Information Request', priority: 'Normal', description: '' });
      addNotification('Request created', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create request');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Concierge Desk"
        subtitle="Daily operations and guest assistance"
        icon={Headphones}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => openForm('Information Request')} className={button.primary}>
              <Plus size={16} />
              New Request
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="In-House Guests" value={stats.inHouse} icon={Users} tone="success" />
        <StatCard title="Open Requests" value={stats.open} icon={Clock} tone="warning" />
        <StatCard title="Assigned / In Progress" value={stats.inProgress} icon={ClipboardList} tone="info" />
        <StatCard title="Service Queue" value={stats.queueTotal} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Quick actions — open the request form with the type preset */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.title}
              type="button"
              onClick={() => openForm(action.requestType)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-600"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-indigo-100 p-2.5 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                  <Icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{action.title}</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{action.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* New request form */}
      {showNewRequestForm && (
        <SectionCard title="New Guest Request" subtitle="Linked to a real reservation" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Guest</label>
              <select
                value={newRequest.reservationId}
                onChange={(e) => setNewRequest({ ...newRequest, reservationId: e.target.value })}
                className={inputClass}
                disabled={loading}
              >
                <option value="">{loading ? 'Loading guests…' : 'Select guest…'}</option>
                {bookableGuests.map((g) => (
                  <option key={g.reservationId} value={g.reservationId}>
                    {g.name} — Room {g.roomNumber}{g.isVIP ? ' (VIP)' : ''}
                  </option>
                ))}
              </select>
              {!loading && bookableGuests.length === 0 && (
                <p className="mt-1 text-xs text-slate-400">No in-house or arriving guests found.</p>
              )}
            </div>
            <div>
              <label className={labelClass}>Request Type</label>
              <select
                value={newRequest.requestType}
                onChange={(e) => setNewRequest({ ...newRequest, requestType: e.target.value })}
                className={inputClass}
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select
                value={newRequest.priority}
                onChange={(e) => setNewRequest({ ...newRequest, priority: e.target.value })}
                className={inputClass}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea
                value={newRequest.description}
                onChange={(e) => setNewRequest({ ...newRequest, description: e.target.value })}
                rows={3}
                placeholder="What does the guest need?"
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
            <button type="button" onClick={() => setShowNewRequestForm(false)} className={button.secondary}>
              Cancel
            </button>
            <button type="button" onClick={handleCreateRequest} disabled={submitting || loading} className={button.primary}>
              {submitting ? 'Creating…' : 'Create Request'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Recent requests */}
      <SectionCard title="Recent Requests" subtitle="Latest concierge activity" pad="none">
        {loading && quickRequests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : quickRequests.length === 0 ? (
          <div className="py-12 text-center">
            <ClipboardList size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No recent requests</p>
            <p className="mt-1 text-xs text-slate-400">Create one with the button above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Type</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Priority</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {quickRequests.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onCreateRequest?.(r.id)}
                    className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (r.guest_id) onViewGuestProfile?.(r.guest_id);
                        }}
                        className={`text-sm font-medium ${r.guest_id ? 'text-indigo-600 hover:underline dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}
                      >
                        {r.guest_name}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">{r.room_number || '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">{r.request_type}</td>
                    <td className="px-5 py-3.5"><Badge tone={PRIORITY_TONE[r.priority] || 'neutral'}>{r.priority}</Badge></td>
                    <td className="px-5 py-3.5"><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">{timeAgo(r.submitted_at)}</td>
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

export default ConciergeDeskModule;
