/**
 * Parcel & Package Management Module
 * Track incoming packages, outgoing shipments, and guest deliveries.
 *
 * DB-integrated: the parcel queue lives in guest_requests
 * (request_type='Package') linked to real reservations picked from the
 * service-center overview.
 */

import { conciergeFetch } from '../conciergeApi';
import { ServiceItemModal, DeleteServiceModal, ServiceItemActions, type ServiceCatalogItem } from '../ServiceCatalogModals';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Package,
  PackageOpen,
  PackagePlus,
  PackageCheck,
  Send,
  Plus,
  RefreshCw,
  CalendarPlus,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface ParcelManagementModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface ParcelRequest {
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
}

const STATUS_TONE: Record<string, StatusTone> = {
  Open: 'warning',
  Assigned: 'info',
  'In Progress': 'accent',
  Completed: 'success',
  Cancelled: 'neutral',
};

const SERVICE_ICON: Record<string, LucideIcon> = {
  'Package Received': PackagePlus,
  'Package Pickup': PackageOpen,
  'Package Delivery': PackageCheck,
  'Outgoing Courier': Send,
};
const FALLBACK_ICON: LucideIcon = Package;

function serviceFromDescription(desc: string): string {
  return desc.split('·')[0]?.trim() || 'Package';
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

const ParcelManagementModule: React.FC<ParcelManagementModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, userProfile } = useERP();
  const [requests, setRequests] = useState<ParcelRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'services' | 'log'>('services');
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; item: ServiceCatalogItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState({
    reservationId: '',
    serviceType: 'Package Received',
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
        conciergeFetch('/api/concierge/services?category=parcel&available_only=false'),
        conciergeFetch('/api/concierge/requests?request_type=Package&department=Concierge'),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setServices(await parseJson(servicesRes));
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
      setError(e?.message || 'Failed to load parcel requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    holding: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)
      && serviceFromDescription(r.description) === 'Package Received').length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [requests]);

  const openForm = (serviceType?: string) => {
    setFormError(null);
    setNewRequest((prev) => ({ ...prev, serviceType: serviceType ?? prev.serviceType }));
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
          request_type: 'Package',
          description: `${newRequest.serviceType}${newRequest.details.trim() ? ` · ${newRequest.details.trim()}` : ''}`,
          notes: newRequest.notes.trim() || null,
          priority: 'Normal',
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewRequest({ reservationId: '', serviceType: 'Package Received', details: '', notes: '' });
      addNotification('Parcel request created', 'success', 'Concierge');
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
        title="Parcel & Package Management"
        subtitle="Track incoming packages, outgoing shipments, and guest deliveries"
        icon={Package}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => openForm()} className={button.primary}>
              <Plus size={16} />
              New Entry
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Holding for Guest" value={stats.holding} icon={Package} tone="accent" />
        <StatCard title="Active" value={stats.active} icon={Clock} tone="warning" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Entries" value={requests.length} icon={ClipboardList} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Entry form */}
      {showForm && (
        <SectionCard title="New Parcel Entry" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
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
                placeholder="e.g. DHL envelope · 2 boxes · courier name"
              />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input
                type="text"
                value={newRequest.notes}
                onChange={(e) => setNewRequest({ ...newRequest, notes: e.target.value })}
                className={inputClass}
                placeholder="Tracking #, storage location, instructions…"
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
              {submitting ? 'Creating…' : 'Create Entry'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Sub-tabs */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'services', label: 'Parcel Services', icon: Package, count: services.length },
            { id: 'log', label: 'Parcel Log', icon: ClipboardList, count: requests.length },
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

      {/* Quick service actions */}
      {activeTab === 'services' && (
      <SectionCard title="Parcel Services" subtitle="Tap a service to start an entry" icon={Package} tone="accent" pad="md"
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

      {/* Parcel log */}
      {activeTab === 'log' && (
      <SectionCard title="Parcel Log" subtitle={`${requests.length} entr${requests.length === 1 ? 'y' : 'ies'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Package size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No parcels logged</p>
            <p className="mt-1 text-xs text-slate-400">Log an incoming or outgoing package above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Parcel</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Priority</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {requests.map((r) => {
                  const serviceName = serviceFromDescription(r.description);
                  const Icon = SERVICE_ICON[serviceName] || Package;
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
        category="parcel"
        itemLabel="service type"
        item={catalogModal.item}
        showPrice={false}
      />
      <DeleteServiceModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchAll}
        item={deleteTarget}
        itemLabel="service type"
      />
    </div>
  );
};

export default ParcelManagementModule;
