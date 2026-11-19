/**
 * VIP & Butler Services Module
 * Manage VIP arrival preparation, personalized welcome, butler requests.
 *
 * DB-integrated: the VIP queue lives in guest_requests
 * (request_type='VIP Service') linked to real reservations picked from
 * the service-center overview; the VIP guest strip comes from the
 * overview's live `isVIP` flags.
 */

import { conciergeFetch } from '../conciergeApi';
import { ServiceItemModal, DeleteServiceModal, ServiceItemActions, type ServiceCatalogItem } from '../ServiceCatalogModals';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Crown,
  Plus,
  RefreshCw,
  CalendarPlus,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  Sparkles,
  Gift,
  DoorOpen,
  HandHelping,
  PartyPopper,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface VIPServicesModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface VIPRequest {
  id: string;
  request_number: string;
  guest_name: string;
  room_number: string | null;
  description: string;
  notes: string | null;
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
  guestId?: string | null;
}

const STATUS_TONE: Record<string, StatusTone> = {
  Open: 'warning',
  Assigned: 'info',
  'In Progress': 'accent',
  Completed: 'success',
  Cancelled: 'neutral',
};

const SERVICE_ICON: Record<string, LucideIcon> = {
  'Arrival Preparation': DoorOpen,
  'Welcome Amenity': Gift,
  'Butler Request': HandHelping,
  'Special Occasion': PartyPopper,
};
const FALLBACK_ICON: LucideIcon = Sparkles;

function serviceFromDescription(desc: string): string {
  return desc.split('·')[0]?.trim() || 'VIP Service';
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

const VIPServicesModule: React.FC<VIPServicesModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, userProfile } = useERP();
  const [requests, setRequests] = useState<VIPRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [vipGuests, setVipGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'guests' | 'services' | 'queue'>('guests');
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; item: ServiceCatalogItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState({
    reservationId: '',
    serviceType: 'Welcome Amenity',
    details: '',
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
      const [servicesRes, requestsRes, overviewRes] = await Promise.all([
        conciergeFetch('/api/concierge/services?category=vip&available_only=false'),
        conciergeFetch('/api/concierge/requests?request_type=VIP Service&department=Concierge'),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setServices(await parseJson(servicesRes));
      setRequests(await parseJson(requestsRes));
      const overview = await parseJson(overviewRes);
      const seen = new Set<string>();
      const all: OverviewGuest[] = [...(overview.inHouse || []), ...(overview.arriving || []), ...(overview.departing || [])]
        .map((g: any) => ({
          reservationId: g.reservationId,
          name: g.name,
          roomNumber: g.roomNumber,
          isVIP: g.isVIP,
          guestId: g.id ?? null,
        }))
        .filter((g: OverviewGuest) => {
          if (!g.reservationId || seen.has(g.reservationId)) return false;
          seen.add(g.reservationId);
          return true;
        });
      setGuests(all);
      setVipGuests(all.filter((g) => g.isVIP));
    } catch (e: any) {
      setError(e?.message || 'Failed to load VIP services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    vipInHouse: vipGuests.length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [vipGuests, requests]);

  const openForm = (serviceType?: string, reservationId?: string) => {
    setFormError(null);
    setNewRequest((prev) => ({
      ...prev,
      serviceType: serviceType ?? prev.serviceType,
      reservationId: reservationId ?? prev.reservationId,
    }));
    setShowForm(true);
  };

  const selectedGuest = guests.find((g) => g.reservationId === newRequest.reservationId);

  const handleCreateRequest = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
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
          request_type: 'VIP Service',
          description: `${newRequest.serviceType}${newRequest.details.trim() ? ` · ${newRequest.details.trim()}` : ''}`,
          notes: newRequest.notes.trim() || null,
          priority: 'High',
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewRequest({ reservationId: '', serviceType: 'Welcome Amenity', details: '', notes: '' });
      addNotification('VIP service request created', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create request');
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
        title="VIP & Butler Services"
        subtitle="VIP arrival preparation, personalized welcome, butler requests"
        icon={Crown}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => openForm()} className={button.primary}>
              <Plus size={16} />
              New Request
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="VIP Guests" value={stats.vipInHouse} icon={Crown} tone="accent" caption="in house / arriving" />
        <StatCard title="Active Requests" value={stats.active} icon={Clock} tone="warning" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Requests" value={requests.length} icon={ClipboardList} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Sub-tabs */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'guests', label: 'VIP Guests', icon: Crown, count: vipGuests.length },
            { id: 'services', label: 'VIP Services', icon: Sparkles, count: services.length },
            { id: 'queue', label: 'Service Queue', icon: ClipboardList, count: requests.length },
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

      {/* VIP guests strip */}
      {vipGuests.length > 0 && activeTab === 'guests' && (
        <SectionCard title="VIP Guests In House" subtitle={`${vipGuests.length} VIP guest${vipGuests.length === 1 ? '' : 's'} — tap to start a service`} icon={Crown} tone="warning" pad="md">
          <div className="flex flex-wrap gap-3">
            {vipGuests.map((g) => (
              <button
                key={g.reservationId}
                type="button"
                onClick={() => openForm(undefined, g.reservationId)}
                className="group inline-flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-left transition hover:border-amber-400 hover:shadow-md dark:border-amber-900/40 dark:bg-amber-900/20"
              >
                <Crown size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{g.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Room {g.roomNumber}</div>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Request form */}
      {showForm && (
        <SectionCard title="New VIP Service Request" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
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
              <label className={labelClass}>Service Type</label>
              <select
                value={newRequest.serviceType}
                onChange={(e) => setNewRequest({ ...newRequest, serviceType: e.target.value })}
                className={inputClass}
              >
                {services.filter((s) => s.available).map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Details</label>
              <input
                type="text"
                value={newRequest.details}
                onChange={(e) => setNewRequest({ ...newRequest, details: e.target.value })}
                className={inputClass}
                placeholder="e.g. champagne + fruit platter · deliver 18:00"
              />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input
                type="text"
                value={newRequest.notes}
                onChange={(e) => setNewRequest({ ...newRequest, notes: e.target.value })}
                className={inputClass}
                placeholder="Timing, preferences, occasion details…"
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
              {submitting ? 'Creating…' : 'Create Request'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Quick service actions */}
      {activeTab === 'services' && (
      <SectionCard title="VIP Services" subtitle="Tap a service to start a request" icon={Sparkles} tone="accent" pad="md"
        actions={
          <button type="button" onClick={() => setCatalogModal({ open: true, item: null })} className={button.secondary}>
            <Plus size={14} /> Add
          </button>
        }>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => {
            const count = requests.filter((r) => serviceFromDescription(r.description) === service.name).length;
            const Icon = SERVICE_ICON[service.name] || FALLBACK_ICON;
            return (
              <div
                key={service.id}
                className={`group relative flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition dark:border-slate-700 ${
                  service.available
                    ? 'hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 dark:hover:border-indigo-700'
                    : 'opacity-60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => openForm(service.name)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div className="shrink-0 rounded-lg bg-indigo-100 p-2.5 text-indigo-600 transition group-hover:scale-105 dark:bg-indigo-900/40 dark:text-indigo-300">
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 dark:text-white">{service.name}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {service.description} · {count}
                    </div>
                  </div>
                </button>
                <div className="absolute right-1.5 top-1.5">
                  <ServiceItemActions onEdit={() => setCatalogModal({ open: true, item: service })} onDelete={() => setDeleteTarget(service)} />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
      )}

      {/* Request queue */}
      {activeTab === 'queue' && (
      <SectionCard title="Service Queue" subtitle={`${requests.length} VIP request${requests.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Crown size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No VIP service requests</p>
            <p className="mt-1 text-xs text-slate-400">Create a VIP service request above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Service</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Priority</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {requests.map((r) => {
                  const serviceName = serviceFromDescription(r.description);
                  const Icon = SERVICE_ICON[serviceName] || Sparkles;
                  return (
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
                        <div className="flex items-center gap-2">
                          <Icon size={14} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
                          <div className="truncate text-sm text-slate-700 dark:text-slate-300">{r.description}</div>
                        </div>
                        {r.notes && <div className="ml-6 truncate text-xs text-slate-400">{r.notes}</div>}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone={r.priority === 'Urgent' || r.priority === 'High' ? 'danger' : r.priority === 'Low' ? 'neutral' : 'info'}>
                          {r.priority}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${statusTone[STATUS_TONE[r.status] || 'neutral'].dot}`} />
                          <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">{timeAgo(r.submitted_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      )}
      <ServiceItemModal
        isOpen={catalogModal.open}
        onClose={() => setCatalogModal({ open: false, item: null })}
        onSaved={fetchAll}
        category="vip"
        itemLabel="VIP service"
        item={catalogModal.item}
        showPrice={false}
      />
      <DeleteServiceModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchAll}
        item={deleteTarget}
        itemLabel="VIP service"
      />
    </div>
  );
};

export default VIPServicesModule;
