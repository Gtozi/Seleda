/**
 * Guest Service Center Module
 * Central workspace for concierge staff with guest lists and service queue.
 *
 * DB-integrated: reads /api/concierge/service-center/overview (reservations
 * joined with guests + guest_requests) and persists request status changes
 * back via PUT /api/concierge/requests/:id.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Crown,
  Calendar,
  LogOut,
  ClipboardList,
  Clock,
  Search,
  ArrowRight,
  RefreshCw,
  Headphones,
  Car,
  Utensils,
  Map,
  Package,
  Bell,
  Ticket,
  ShoppingBag,
  MessageSquare,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface GuestServiceCenterModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
  onViewRequest?: (requestId: string) => void;
}

interface Guest {
  id: string;
  reservationId: string;
  name: string;
  roomNumber: string;
  status: 'in-house' | 'arriving' | 'departing';
  isVIP: boolean;
  checkInDate: string;
  checkOutDate: string;
  loyaltyStatus: string;
  openRequests: number;
}

interface ServiceRequest {
  id: string;
  requestNumber: string;
  guestName: string;
  roomNumber: string;
  type: string;
  description: string;
  priority: 'low' | 'normal' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'in-progress' | 'completed';
  assignedTo: string | null;
  requestedAt: string;
}

interface ServiceCenterOverview {
  inHouse: Guest[];
  arriving: Guest[];
  departing: Guest[];
  queue: ServiceRequest[];
}

type ServiceTab = 'in-house' | 'arriving' | 'departing' | 'vip' | 'queue';

const TYPE_ICON: Record<string, LucideIcon> = {
  Transportation: Car,
  'Restaurant Booking': Utensils,
  'Tour Booking': Map,
  Luggage: Package,
  Package: Package,
  'Wake-up Call': Bell,
  'Ticket Booking': Ticket,
  'VIP Service': Crown,
  'Personal Shopping': ShoppingBag,
  'General Inquiry': MessageSquare,
};

const GUEST_STATUS_TONE: Record<Guest['status'], StatusTone> = {
  'in-house': 'success',
  arriving: 'info',
  departing: 'warning',
};

const GUEST_STATUS_LABEL: Record<Guest['status'], string> = {
  'in-house': 'In-House',
  arriving: 'Arriving',
  departing: 'Departing',
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  low: 'neutral',
  normal: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
};

const QUEUE_STATUS_TONE: Record<string, StatusTone> = {
  open: 'warning',
  assigned: 'info',
  'in-progress': 'info',
  completed: 'success',
};

const QUEUE_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

const inputClass =
  'w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function formatStayDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatRequestedAt(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

const GuestServiceCenterModule: React.FC<GuestServiceCenterModuleProps> = ({
  onViewGuestProfile,
  onViewRequest
}) => {
  const { addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<ServiceTab>('in-house');
  const [searchQuery, setSearchQuery] = useState('');
  const [overview, setOverview] = useState<ServiceCenterOverview>({
    inHouse: [],
    arriving: [],
    departing: [],
    queue: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await conciergeFetch('/api/concierge/service-center/overview');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`Failed to load service center (${res.status})`);
      }
      const data = await res.json();
      setOverview({
        inHouse: data.inHouse || [],
        arriving: data.arriving || [],
        departing: data.departing || [],
        queue: data.queue || [],
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to load service center');
      console.error('[concierge-service-center] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const vipGuests = useMemo(
    () => [...overview.inHouse, ...overview.arriving, ...overview.departing].filter(g => g.isVIP),
    [overview]
  );

  const tabGuests: Record<Exclude<ServiceTab, 'queue'>, Guest[]> = {
    'in-house': overview.inHouse,
    arriving: overview.arriving,
    departing: overview.departing,
    vip: vipGuests,
  };

  const displayedGuests = useMemo(() => {
    if (activeTab === 'queue') return [];
    const list = tabGuests[activeTab];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      g => g.name.toLowerCase().includes(q) || g.roomNumber.toLowerCase().includes(q)
    );
  }, [activeTab, overview, vipGuests, searchQuery]);

  const displayedQueue = useMemo(() => {
    if (!searchQuery.trim()) return overview.queue;
    const q = searchQuery.toLowerCase();
    return overview.queue.filter(
      r =>
        r.guestName?.toLowerCase().includes(q) ||
        r.roomNumber?.toLowerCase().includes(q) ||
        r.type?.toLowerCase().includes(q)
    );
  }, [overview.queue, searchQuery]);

  // Advance a queue request: Open/Assigned → In Progress, In Progress → Completed.
  const advanceRequest = async (request: ServiceRequest) => {
    const nextStatus = request.status === 'in-progress' ? 'Completed' : 'In Progress';
    setActingOn(request.id);
    try {
      const body: any = { status: nextStatus };
      if (nextStatus === 'In Progress') {
        body.acknowledged_at = new Date().toISOString();
        if (!request.assignedTo) body.assigned_to = 'Concierge Desk';
      } else {
        body.completed_at = new Date().toISOString();
      }
      const res = await conciergeFetch(`/api/concierge/requests/${request.id}`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update (${res.status})`);
      }
      setOverview(prev => ({
        ...prev,
        queue:
          nextStatus === 'Completed'
            ? prev.queue.filter(r => r.id !== request.id)
            : prev.queue.map(r =>
                r.id === request.id
                  ? { ...r, status: 'in-progress', assignedTo: r.assignedTo ?? 'Concierge Desk' }
                  : r
              ),
      }));
      addNotification(
        `Request ${request.requestNumber || request.id} ${nextStatus === 'In Progress' ? 'dispatched' : 'completed'}`,
        nextStatus === 'In Progress' ? 'info' : 'success',
        'Concierge'
      );
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update request', 'danger', 'Concierge');
    } finally {
      setActingOn(null);
    }
  };

  const tabs: { id: ServiceTab; label: string; icon: LucideIcon; count: number }[] = [
    { id: 'in-house', label: 'In-House', icon: Users, count: overview.inHouse.length },
    { id: 'arriving', label: 'Arriving', icon: Calendar, count: overview.arriving.length },
    { id: 'departing', label: 'Departing', icon: LogOut, count: overview.departing.length },
    { id: 'vip', label: 'VIP Guests', icon: Crown, count: vipGuests.length },
    { id: 'queue', label: 'Service Queue', icon: ClipboardList, count: overview.queue.length },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Service Center"
        subtitle="Central workspace for concierge operations."
        icon={Headphones}
        actions={
          <button onClick={fetchOverview} disabled={loading} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="In-House Guests" value={overview.inHouse.length} icon={Users} tone="success" />
        <StatCard title="Arriving Today" value={overview.arriving.length} icon={Calendar} tone="info" />
        <StatCard title="Departing Today" value={overview.departing.length} icon={LogOut} tone="warning" />
        <StatCard title="Open Requests" value={overview.queue.length} icon={ClipboardList} tone="danger" />
      </div>

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {tabs.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
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
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Search guests, rooms, requests..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </SectionCard>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {activeTab !== 'queue' && (
        <SectionCard
          title={tabs.find(t => t.id === activeTab)?.label}
          subtitle={`${displayedGuests.length} guest${displayedGuests.length === 1 ? '' : 's'}`}
          icon={tabs.find(t => t.id === activeTab)?.icon}
          tone="accent"
          pad="none"
        >
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
              Loading guests…
            </div>
          ) : displayedGuests.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No guests found.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {displayedGuests.map(guest => (
                <div key={guest.reservationId} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-3 md:w-72 shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] flex items-center justify-center font-semibold text-sm shrink-0">
                      {initials(guest.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
                        <span className="truncate">{guest.name}</span>
                        {guest.isVIP && <Crown className="w-3.5 h-3.5 text-[var(--color-warning)] shrink-0" />}
                      </div>
                      <p className="text-xs text-gray-500">
                        Room {guest.roomNumber} · {formatStayDate(guest.checkInDate)} – {formatStayDate(guest.checkOutDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={GUEST_STATUS_TONE[guest.status]}>{GUEST_STATUS_LABEL[guest.status]}</Badge>
                    <Badge tone={guest.loyaltyStatus === 'Regular' ? 'neutral' : 'accent'}>
                      {guest.loyaltyStatus}
                    </Badge>
                    {guest.openRequests > 0 && (
                      <Badge tone="warning">{guest.openRequests} open request{guest.openRequests === 1 ? '' : 's'}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 md:w-24 shrink-0 md:justify-end">
                    <button
                      onClick={() => onViewGuestProfile?.(guest.id)}
                      className={button.ghost + ' text-xs'}
                      title="View guest profile"
                    >
                      Profile <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === 'queue' && (
        <SectionCard
          title="Active Service Queue"
          subtitle={`${displayedQueue.length} open request${displayedQueue.length === 1 ? '' : 's'}`}
          icon={Clock}
          tone="accent"
          pad="none"
        >
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
              Loading service queue…
            </div>
          ) : displayedQueue.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No open requests.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {displayedQueue.map(request => {
                const Icon = TYPE_ICON[request.type] ?? ClipboardList;
                return (
                  <div key={request.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex items-center gap-3 md:w-80 shrink-0">
                      <div className="p-2 rounded-xl bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{request.type}</h4>
                        <p className="text-xs text-gray-500 truncate">
                          {request.guestName} · Room {request.roomNumber} · {request.requestNumber || request.id.slice(0, 12)}
                        </p>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-wrap items-center gap-2 text-xs min-w-0">
                      {request.description && (
                        <span className="text-gray-500 truncate max-w-md">{request.description}</span>
                      )}
                      <Badge tone={PRIORITY_TONE[request.priority] || 'neutral'} variant={request.priority === 'urgent' ? 'solid' : 'soft'}>
                        {request.priority.charAt(0).toUpperCase() + request.priority.slice(1)}
                      </Badge>
                      {request.assignedTo && <span className="text-gray-500">→ {request.assignedTo}</span>}
                      <span className="text-gray-400">{formatRequestedAt(request.requestedAt)}</span>
                    </div>
                    <div className="flex items-center gap-3 md:w-52 shrink-0">
                      <Badge tone={QUEUE_STATUS_TONE[request.status] || 'neutral'}>
                        {QUEUE_STATUS_LABEL[request.status] || request.status}
                      </Badge>
                      <button
                        onClick={() => advanceRequest(request)}
                        disabled={actingOn === request.id}
                        className={button.ghost + ' text-xs disabled:opacity-50'}
                      >
                        {actingOn === request.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {request.status === 'in-progress' ? 'Complete' : 'Dispatch'}
                      </button>
                      <button
                        onClick={() => onViewRequest?.(request.id)}
                        className={button.ghost + ' text-xs'}
                        title="View request"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
};

export default GuestServiceCenterModule;
