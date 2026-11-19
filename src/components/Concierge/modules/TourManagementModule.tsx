/**
 * Tour & Excursion Management Module
 * Manage local tours, multi-day tours, and excursions.
 *
 * DB-integrated: the tour catalog comes from `guest_services`
 * (category='tour' — multi-day excursions, distinct from the in-city
 * 'concierge' experiences), bookings persist as guest_requests
 * (request_type='Tour Booking') linked to real reservations picked from
 * the service-center overview.
 */

import { conciergeFetch } from '../conciergeApi';
import { ServiceItemModal, DeleteServiceModal, ServiceItemActions, type ServiceCatalogItem } from '../ServiceCatalogModals';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MapPin,
  Plus,
  RefreshCw,
  Calendar,
  CalendarPlus,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  Compass,
  Mountain,
  Landmark,
  Trees,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface TourManagementModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface Tour {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  available: boolean;
}

interface TourRequest {
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
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
];

const DIMMED_CHIP = 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500';

const TOUR_ICONS: [RegExp, LucideIcon][] = [
  [/lalibela|church|castle|gondar|harar/i, Landmark],
  [/simien|mountain|trek|danakil|volcano/i, Mountain],
  [/omo|valley|cultural/i, Compass],
  [/lake|rift|awassa|langano/i, Waves],
  [/park|forest|safari/i, Trees],
];

function tourIcon(name: string): LucideIcon {
  return TOUR_ICONS.find(([re]) => re.test(name))?.[1] ?? MapPin;
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

const TourManagementModule: React.FC<TourManagementModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, formatAmount, userProfile } = useERP();
  const [tours, setTours] = useState<Tour[]>([]);
  const [requests, setRequests] = useState<TourRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalog' | 'bookings'>('catalog');
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; item: ServiceCatalogItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState({
    reservationId: '',
    tourId: '',
    departureDate: '',
    participants: 2,
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
      const [toursRes, requestsRes, overviewRes] = await Promise.all([
        conciergeFetch('/api/concierge/services?category=tour&available_only=false'),
        conciergeFetch('/api/concierge/requests?request_type=Tour Booking&department=Concierge'),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setTours(await parseJson(toursRes));
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
      setError(e?.message || 'Failed to load tours');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    tours: tours.length,
    available: tours.filter((t) => t.available).length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [tours, requests]);

  const openForm = (tourId?: string) => {
    setFormError(null);
    setNewBooking((prev) => ({ ...prev, tourId: tourId ?? prev.tourId }));
    setShowForm(true);
  };

  const selectedGuest = guests.find((g) => g.reservationId === newBooking.reservationId);
  const selectedTour = tours.find((t) => t.id === newBooking.tourId);

  const handleCreateBooking = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!selectedTour) {
      setFormError('Please select a tour');
      return;
    }
    if (!newBooking.departureDate) {
      setFormError('Please pick a departure date');
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
          request_type: 'Tour Booking',
          description: `${selectedTour.name} · Departure ${new Date(newBooking.departureDate).toLocaleDateString()} · ${newBooking.participants} participant${newBooking.participants > 1 ? 's' : ''} · ${formatAmount(selectedTour.price)}/person`,
          notes: newBooking.notes.trim() || null,
          priority: 'Normal',
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewBooking({ reservationId: '', tourId: '', departureDate: '', participants: 2, notes: '' });
      addNotification('Tour booking created', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create tour booking');
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
        title="Tour & Excursion Management"
        subtitle="Manage local tours, multi-day tours, and excursions"
        icon={Compass}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => openForm()} className={button.primary}>
              <Plus size={16} />
              New Booking
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Tours" value={stats.tours} icon={MapPin} tone="accent" caption={`${stats.available} bookable`} />
        <StatCard title="Active Bookings" value={stats.active} icon={Clock} tone="warning" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Requests" value={requests.length} icon={ClipboardList} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Booking form */}
      {showForm && (
        <SectionCard title="New Tour Booking" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Guest</label>
              <select
                value={newBooking.reservationId}
                onChange={(e) => setNewBooking({ ...newBooking, reservationId: e.target.value })}
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
              <label className={labelClass}>Tour</label>
              <select
                value={newBooking.tourId}
                onChange={(e) => setNewBooking({ ...newBooking, tourId: e.target.value })}
                className={inputClass}
              >
                <option value="">Select tour…</option>
                {tours.filter((t) => t.available).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {formatAmount(t.price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Departure Date</label>
              <input
                type="date"
                value={newBooking.departureDate}
                onChange={(e) => setNewBooking({ ...newBooking, departureDate: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Participants</label>
              <input
                type="number"
                min={1}
                max={20}
                value={newBooking.participants}
                onChange={(e) => setNewBooking({ ...newBooking, participants: Math.max(1, Number(e.target.value) || 1) })}
                className={inputClass}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea
                value={newBooking.notes}
                onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                rows={2}
                placeholder="Dietary needs, mobility requirements, private guide…"
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
            <button type="button" onClick={handleCreateBooking} disabled={submitting || loading} className={button.primary}>
              {submitting ? 'Booking…' : 'Create Booking'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Sub-tabs */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'catalog', label: 'Tour Catalog', icon: Compass, count: tours.length },
            { id: 'bookings', label: 'Tour Bookings', icon: ClipboardList, count: requests.length },
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

      {/* Tour catalog */}
      {activeTab === 'catalog' && (
      <SectionCard title="Tour Catalog" subtitle={`${stats.available} of ${stats.tours} bookable`} icon={Compass} tone="accent" pad="md"
        actions={
          <button type="button" onClick={() => setCatalogModal({ open: true, item: null })} className={button.secondary}>
            <Plus size={14} /> Add
          </button>
        }>
        {loading && tours.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : tours.length === 0 ? (
          <div className="py-10 text-center">
            <MapPin size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No tours in the catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tours.map((tour, idx) => {
              const Icon = tourIcon(tour.name);
              const chip = tour.available ? CHIP_COLORS[idx % CHIP_COLORS.length] : DIMMED_CHIP;
              return (
                <div
                  key={tour.id}
                  className={`group flex flex-col rounded-xl border p-4 transition ${
                    tour.available
                      ? 'border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-slate-700 dark:hover:border-indigo-700'
                      : 'border-slate-200 opacity-70 dark:border-slate-700'
                  }`}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className={`shrink-0 rounded-lg p-2.5 transition group-hover:scale-105 ${chip}`}>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-snug text-slate-900 dark:text-white">{tour.name}</h3>
                      <Badge tone={tour.available ? 'success' : 'neutral'} className="mt-1">
                        {tour.available ? 'Available' : 'Unavailable'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-3 flex-1 text-sm text-slate-500 dark:text-slate-400">{tour.description}</p>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-700/60">
                    <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                      {formatAmount(Number(tour.price))}
                      <span className="text-xs font-normal text-slate-400"> /person</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <ServiceItemActions onEdit={() => setCatalogModal({ open: true, item: tour })} onDelete={() => setDeleteTarget(tour)} />
                    <button
                      type="button"
                      onClick={() => openForm(tour.id)}
                      disabled={!tour.available}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                    >
                      Book
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

      {/* Tour bookings */}
      {activeTab === 'bookings' && (
      <SectionCard title="Tour Bookings" subtitle={`${requests.length} booking request${requests.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No tour bookings yet</p>
            <p className="mt-1 text-xs text-slate-400">Book a tour for a guest above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tour Details</th>
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
        category="tour"
        itemLabel="tour"
        item={catalogModal.item}
      />
      <DeleteServiceModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchAll}
        item={deleteTarget}
        itemLabel="tour"
      />
    </div>
  );
};

export default TourManagementModule;
