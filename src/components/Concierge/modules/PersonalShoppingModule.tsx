/**
 * Personal Shopping Module
 * Assist guests with luxury shopping, souvenirs, and custom orders.
 *
 * DB-integrated: shopping destinations/services from `guest_services`
 * (category='shopping'), requests persist as guest_requests
 * (request_type='Personal Shopping') linked to real reservations picked
 * from the service-center overview.
 */

import { conciergeFetch } from '../conciergeApi';
import { ServiceItemModal, DeleteServiceModal, ServiceItemActions, type ServiceCatalogItem } from '../ServiceCatalogModals';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShoppingBag,
  Plus,
  RefreshCw,
  Calendar,
  CalendarPlus,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  Store,
  Gem,
  Coffee,
  ShoppingCart,
  Shirt,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface PersonalShoppingModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface ShopService {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  available: boolean;
}

interface ShoppingRequest {
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

const CHIP_COLORS = [
  'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300',
  'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
];

const DIMMED_CHIP = 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500';

const SHOP_ICONS: [RegExp, LucideIcon][] = [
  [/gold|jewel/i, Gem],
  [/coffee|souvenir/i, Coffee],
  [/clothing|tailor|shirt|kemis/i, Shirt],
  [/mall|boutique/i, Store],
  [/merkato|market|escort/i, ShoppingCart],
];

function shopIcon(name: string): LucideIcon {
  return SHOP_ICONS.find(([re]) => re.test(name))?.[1] ?? ShoppingBag;
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

const PersonalShoppingModule: React.FC<PersonalShoppingModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, formatAmount, userProfile } = useERP();
  const [services, setServices] = useState<ShopService[]>([]);
  const [requests, setRequests] = useState<ShoppingRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalog' | 'requests'>('catalog');
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; item: ServiceCatalogItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState({
    reservationId: '',
    serviceId: '',
    dateTime: '',
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
        conciergeFetch('/api/concierge/services?category=shopping&available_only=false'),
        conciergeFetch('/api/concierge/requests?request_type=Personal Shopping&department=Concierge'),
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
      setError(e?.message || 'Failed to load personal shopping');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    services: services.length,
    available: services.filter((s) => s.available).length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [services, requests]);

  const openForm = (serviceId?: string) => {
    setFormError(null);
    setNewRequest((prev) => ({ ...prev, serviceId: serviceId ?? prev.serviceId }));
    setShowForm(true);
  };

  const selectedGuest = guests.find((g) => g.reservationId === newRequest.reservationId);
  const selectedService = services.find((s) => s.id === newRequest.serviceId);

  const handleCreateRequest = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!selectedService) {
      setFormError('Please select a shopping service');
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
          request_type: 'Personal Shopping',
          description: `${selectedService.name}${newRequest.dateTime ? ` · ${new Date(newRequest.dateTime).toLocaleString()}` : ''} · ${formatAmount(selectedService.price)}/escort`,
          notes: newRequest.notes.trim() || null,
          priority: 'Normal',
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewRequest({ reservationId: '', serviceId: '', dateTime: '', notes: '' });
      addNotification('Shopping request created', 'success', 'Concierge');
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
        title="Personal Shopping"
        subtitle="Assist guests with luxury shopping, souvenirs, and custom orders"
        icon={ShoppingBag}
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
        <StatCard title="Shopping Services" value={stats.services} icon={Store} tone="accent" caption={`${stats.available} available`} />
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

      {/* Request form */}
      {showForm && (
        <SectionCard title="New Shopping Request" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
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
              <label className={labelClass}>Shopping Service</label>
              <select
                value={newRequest.serviceId}
                onChange={(e) => setNewRequest({ ...newRequest, serviceId: e.target.value })}
                className={inputClass}
              >
                <option value="">Select service…</option>
                {services.filter((s) => s.available).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {formatAmount(s.price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Date & Time</label>
              <input
                type="datetime-local"
                value={newRequest.dateTime}
                onChange={(e) => setNewRequest({ ...newRequest, dateTime: e.target.value })}
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
                placeholder="Budget, sizes, items, timing…"
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

      {/* Sub-tabs */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'catalog', label: 'Shopping Destinations', icon: ShoppingBag, count: services.length },
            { id: 'requests', label: 'Shopping Requests', icon: ClipboardList, count: requests.length },
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

      {/* Shopping services */}
      {activeTab === 'catalog' && (
      <SectionCard title="Shopping Destinations" subtitle={`${stats.available} of ${stats.services} available`} icon={ShoppingBag} tone="accent" pad="md"
        actions={
          <button type="button" onClick={() => setCatalogModal({ open: true, item: null })} className={button.secondary}>
            <Plus size={14} /> Add
          </button>
        }>
        {loading && services.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : services.length === 0 ? (
          <div className="py-10 text-center">
            <ShoppingBag size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No shopping services in the catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service, idx) => {
              const Icon = shopIcon(service.name);
              const chip = service.available ? CHIP_COLORS[idx % CHIP_COLORS.length] : DIMMED_CHIP;
              return (
                <div
                  key={service.id}
                  className={`group flex flex-col rounded-xl border p-4 transition ${
                    service.available
                      ? 'border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-slate-700 dark:hover:border-indigo-700'
                      : 'border-slate-200 opacity-70 dark:border-slate-700'
                  }`}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className={`shrink-0 rounded-lg p-2.5 transition group-hover:scale-105 ${chip}`}>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-snug text-slate-900 dark:text-white">{service.name}</h3>
                      <Badge tone={service.available ? 'success' : 'neutral'} className="mt-1">
                        {service.available ? 'Available' : 'Unavailable'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-3 flex-1 text-sm text-slate-500 dark:text-slate-400">{service.description}</p>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-700/60">
                    <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                      {formatAmount(Number(service.price))}
                      <span className="text-xs font-normal text-slate-400"> /escort</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <ServiceItemActions onEdit={() => setCatalogModal({ open: true, item: service })} onDelete={() => setDeleteTarget(service)} />
                    <button
                      type="button"
                      onClick={() => openForm(service.id)}
                      disabled={!service.available}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                    >
                      Arrange
                    </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
      )}

      {/* Shopping requests */}
      {activeTab === 'requests' && (
      <SectionCard title="Shopping Requests" subtitle={`${requests.length} request${requests.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No shopping requests yet</p>
            <p className="mt-1 text-xs text-slate-400">Arrange a shopping trip for a guest above.</p>
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
      <ServiceItemModal
        isOpen={catalogModal.open}
        onClose={() => setCatalogModal({ open: false, item: null })}
        onSaved={fetchAll}
        category="shopping"
        itemLabel="shopping service"
        item={catalogModal.item}
      />
      <DeleteServiceModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchAll}
        item={deleteTarget}
        itemLabel="shopping service"
      />
    </div>
  );
};

export default PersonalShoppingModule;
