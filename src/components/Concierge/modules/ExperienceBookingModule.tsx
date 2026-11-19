/**
 * Experience & Activity Booking Module
 * Manage reservations for tours, museums, cultural experiences, etc.
 *
 * DB-integrated: catalog from /api/concierge/services?category=concierge,
 * bookings persisted as guest_requests (request_type='Experience Booking') linked
 * to real reservations picked from the service-center overview.
 */

import { conciergeFetch } from '../conciergeApi';
import { ServiceItemModal, DeleteServiceModal, ServiceItemActions, type ServiceCatalogItem } from '../ServiceCatalogModals';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Map,
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
  Sparkles,
  Landmark,
  Mountain,
  Coffee,
  UtensilsCrossed,
  ShoppingBag,
  Palette,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface ExperienceBookingModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface GuestService {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  available: boolean;
}

interface ExperienceRequest {
  id: string;
  request_number: string;
  guest_name: string;
  room_number: string | null;
  description: string;
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

// Catalog icons share the operations accent — one primary accent per brandTheme
const ACCENT_CHIP = 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]';
const DIMMED_CHIP = 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500';

const EXPERIENCE_ICONS: [RegExp, LucideIcon][] = [
  [/museum|palace|monument|unity/i, Landmark],
  [/hike|trek|entoto|mountain/i, Mountain],
  [/coffee/i, Coffee],
  [/food|dining|restaurant|tast/i, UtensilsCrossed],
  [/market|merkato|shopping/i, ShoppingBag],
  [/art|galler/i, Palette],
  [/balloon|flight|air/i, Wind],
];

function experienceIcon(name: string): LucideIcon {
  return EXPERIENCE_ICONS.find(([re]) => re.test(name))?.[1] ?? MapPin;
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

const ExperienceBookingModule: React.FC<ExperienceBookingModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, formatAmount, userProfile } = useERP();
  const [services, setServices] = useState<GuestService[]>([]);
  const [requests, setRequests] = useState<ExperienceRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'catalog' | 'bookings'>('catalog');
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; item: ServiceCatalogItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState({
    reservationId: '',
    experienceId: '',
    dateTime: '',
    participants: 1,
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
        conciergeFetch('/api/concierge/services?category=concierge&available_only=false'),
        conciergeFetch('/api/concierge/requests?request_type=Experience Booking&department=Concierge'),
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
      setError(e?.message || 'Failed to load experiences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    experiences: services.length,
    available: services.filter((s) => s.available).length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [services, requests]);

  const openForm = (experienceId?: string) => {
    setFormError(null);
    setNewBooking((prev) => ({ ...prev, experienceId: experienceId ?? prev.experienceId }));
    setShowBookingForm(true);
  };

  const selectedGuest = guests.find((g) => g.reservationId === newBooking.reservationId);
  const selectedService = services.find((s) => s.id === newBooking.experienceId);

  const handleCreateBooking = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!selectedService) {
      setFormError('Please select an experience');
      return;
    }
    if (!newBooking.dateTime) {
      setFormError('Please pick a date and time');
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
          request_type: 'Experience Booking',
          description: `Experience: ${selectedService.name} · ${new Date(newBooking.dateTime).toLocaleString()} · ${newBooking.participants} participant${newBooking.participants > 1 ? 's' : ''} · ${formatAmount(selectedService.price)}/person`,
          notes: newBooking.notes.trim() || null,
          priority: 'Normal',
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowBookingForm(false);
      setNewBooking({ reservationId: '', experienceId: '', dateTime: '', participants: 1, notes: '' });
      addNotification('Experience booking created', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create booking');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[var(--color-accent-operations)] focus:ring-2 focus:ring-[var(--color-accent-operations)]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Experience & Activity Booking"
        subtitle="Book tours, museums, cultural experiences, and activities"
        icon={Map}
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
        <StatCard title="Experiences" value={stats.experiences} icon={Sparkles} tone="accent" caption={`${stats.available} available`} />
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
      {showBookingForm && (
        <SectionCard title="New Experience Booking" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
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
              <label className={labelClass}>Experience</label>
              <select
                value={newBooking.experienceId}
                onChange={(e) => setNewBooking({ ...newBooking, experienceId: e.target.value })}
                className={inputClass}
              >
                <option value="">Select experience…</option>
                {services.filter((s) => s.available).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {formatAmount(s.price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Date & Time</label>
              <input
                type="datetime-local"
                value={newBooking.dateTime}
                onChange={(e) => setNewBooking({ ...newBooking, dateTime: e.target.value })}
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
                placeholder="Pickup point, dietary needs, special requests…"
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
            <button type="button" onClick={() => setShowBookingForm(false)} className={button.secondary}>
              Cancel
            </button>
            <button type="button" onClick={handleCreateBooking} disabled={submitting || loading} className={button.primary}>
              {submitting ? 'Booking…' : 'Create Booking'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Sub-tabs: catalog vs bookings */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'catalog', label: 'Available Experiences', icon: Sparkles, count: stats.experiences },
            { id: 'bookings', label: 'Recent Bookings', icon: ClipboardList, count: requests.length },
          ] as const).map(t => {
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

      {/* Experience catalog */}
      {activeTab === 'catalog' && (
      <SectionCard title="Available Experiences" subtitle={`${stats.available} of ${stats.experiences} bookable`} icon={Sparkles} tone="accent" pad="md"
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
            <MapPin size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No experiences in the catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => {
              const Icon = experienceIcon(service.name);
              const chip = service.available ? ACCENT_CHIP : DIMMED_CHIP;
              return (
                <div
                  key={service.id}
                  className={`group flex flex-col rounded-xl border p-4 transition ${
                    service.available
                      ? 'border-slate-200 hover:border-[var(--color-accent-operations)]/60 hover:shadow-lg dark:border-slate-700'
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
                    <span className="text-base font-bold text-[var(--color-accent-operations)]">
                      {formatAmount(Number(service.price))}
                      <span className="text-xs font-normal text-slate-400"> /person</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <ServiceItemActions onEdit={() => setCatalogModal({ open: true, item: service })} onDelete={() => setDeleteTarget(service)} />
                    <button
                      type="button"
                      onClick={() => openForm(service.id)}
                      disabled={!service.available}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent-operations)] transition hover:bg-[var(--color-accent-operations)]/20 disabled:cursor-not-allowed disabled:opacity-40"
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

      {/* Recent bookings */}
      {activeTab === 'bookings' && (
      <SectionCard title="Recent Bookings" subtitle={`${requests.length} booking request${requests.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No bookings yet</p>
            <p className="mt-1 text-xs text-slate-400">Book an experience for a guest above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Booking</th>
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
                        className={`text-sm font-medium ${r.guest_id ? 'text-[var(--color-accent-operations)] hover:underline' : 'text-slate-700 dark:text-slate-300'}`}
                      >
                        {r.guest_name}
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.room_number ? (
                        <span className="inline-flex rounded-md bg-[var(--color-accent-operations)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-operations)]">
                          {r.room_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="max-w-md truncate px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300">{r.description}</td>
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
        category="concierge"
        itemLabel="experience"
        item={catalogModal.item}
      />
      <DeleteServiceModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchAll}
        item={deleteTarget}
        itemLabel="experience"
      />
    </div>
  );
};

export default ExperienceBookingModule;
