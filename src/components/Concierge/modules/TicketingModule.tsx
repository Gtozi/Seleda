/**
 * Ticketing Services Module
 * Issue and manage tickets for flights, museums, concerts, etc.
 *
 * DB-integrated: ticketable items from `guest_services`
 * (category='ticketing'), issued tickets persist as guest_requests
 * (request_type='Ticket Booking') linked to real reservations picked from
 * the service-center overview.
 */

import { conciergeFetch } from '../conciergeApi';
import { ServiceItemModal, DeleteServiceModal, ServiceItemActions, type ServiceCatalogItem } from '../ServiceCatalogModals';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Ticket,
  Plus,
  RefreshCw,
  Calendar,
  CalendarPlus,
  Clock,
  CheckCircle2,
  ClipboardList,
  AlertTriangle,
  Loader2,
  Landmark,
  Music,
  Film,
  Plane,
  Drama,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface TicketingModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface TicketItem {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  available: boolean;
}

interface TicketRequest {
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
  'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300',
];

const DIMMED_CHIP = 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500';

const TICKET_ICONS: [RegExp, LucideIcon][] = [
  [/museum|park|entry/i, Landmark],
  [/music|concert|fendika|azmari/i, Music],
  [/theatre|theater|drama|performance/i, Drama],
  [/film|festival|cinema/i, Film],
  [/flight|air/i, Plane],
];

function ticketIcon(name: string): LucideIcon {
  return TICKET_ICONS.find(([re]) => re.test(name))?.[1] ?? Ticket;
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

const TicketingModule: React.FC<TicketingModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, formatAmount, userProfile } = useERP();
  const [items, setItems] = useState<TicketItem[]>([]);
  const [requests, setRequests] = useState<TicketRequest[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalog' | 'requests'>('catalog');
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; item: ServiceCatalogItem | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ServiceCatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newTicket, setNewTicket] = useState({
    reservationId: '',
    itemId: '',
    eventDate: '',
    quantity: 2,
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
      const [itemsRes, requestsRes, overviewRes] = await Promise.all([
        conciergeFetch('/api/concierge/services?category=ticketing&available_only=false'),
        conciergeFetch('/api/concierge/requests?request_type=Ticket Booking&department=Concierge'),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setItems(await parseJson(itemsRes));
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
      setError(e?.message || 'Failed to load ticketing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => ({
    items: items.length,
    available: items.filter((i) => i.available).length,
    active: requests.filter((r) => ['Open', 'Assigned', 'In Progress'].includes(r.status)).length,
    issued: requests.filter((r) => r.status === 'Completed').length,
  }), [items, requests]);

  const openForm = (itemId?: string) => {
    setFormError(null);
    setNewTicket((prev) => ({ ...prev, itemId: itemId ?? prev.itemId }));
    setShowForm(true);
  };

  const selectedGuest = guests.find((g) => g.reservationId === newTicket.reservationId);
  const selectedItem = items.find((i) => i.id === newTicket.itemId);

  const handleIssueTicket = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!selectedItem) {
      setFormError('Please select a ticket item');
      return;
    }
    if (!newTicket.eventDate) {
      setFormError('Please pick a date');
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
          request_type: 'Ticket Booking',
          description: `${selectedItem.name} · ${new Date(newTicket.eventDate).toLocaleDateString()} · ${newTicket.quantity} ticket${newTicket.quantity > 1 ? 's' : ''} · ${formatAmount(selectedItem.price)}/ticket`,
          notes: newTicket.notes.trim() || null,
          priority: 'Normal',
          assigned_department: 'Concierge',
          assigned_to: userProfile?.name || null,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setNewTicket({ reservationId: '', itemId: '', eventDate: '', quantity: 2, notes: '' });
      addNotification('Ticket request created', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to issue ticket');
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
        title="Ticketing Services"
        subtitle="Issue and manage tickets for flights, museums, concerts, and events"
        icon={Ticket}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => openForm()} className={button.primary}>
              <Plus size={16} />
              Issue Ticket
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Ticketable Items" value={stats.items} icon={Sparkles} tone="accent" caption={`${stats.available} available`} />
        <StatCard title="Active Requests" value={stats.active} icon={Clock} tone="warning" />
        <StatCard title="Issued" value={stats.issued} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Requests" value={requests.length} icon={ClipboardList} tone="info" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Issue form */}
      {showForm && (
        <SectionCard title="Issue Tickets" subtitle="Linked to a real reservation" icon={CalendarPlus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Guest</label>
              <select
                value={newTicket.reservationId}
                onChange={(e) => setNewTicket({ ...newTicket, reservationId: e.target.value })}
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
              <label className={labelClass}>Ticket Item</label>
              <select
                value={newTicket.itemId}
                onChange={(e) => setNewTicket({ ...newTicket, itemId: e.target.value })}
                className={inputClass}
              >
                <option value="">Select item…</option>
                {items.filter((i) => i.available).map((i) => (
                  <option key={i.id} value={i.id}>{i.name} — {formatAmount(i.price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Event Date</label>
              <input
                type="date"
                value={newTicket.eventDate}
                onChange={(e) => setNewTicket({ ...newTicket, eventDate: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Quantity</label>
              <input
                type="number"
                min={1}
                max={50}
                value={newTicket.quantity}
                onChange={(e) => setNewTicket({ ...newTicket, quantity: Math.max(1, Number(e.target.value) || 1) })}
                className={inputClass}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea
                value={newTicket.notes}
                onChange={(e) => setNewTicket({ ...newTicket, notes: e.target.value })}
                rows={2}
                placeholder="Seating preference, child pricing, pickup instructions…"
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
            <button type="button" onClick={handleIssueTicket} disabled={submitting || loading} className={button.primary}>
              {submitting ? 'Issuing…' : 'Issue Ticket'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Sub-tabs */}
      <SectionCard pad="md">
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
          {([
            { id: 'catalog', label: 'Ticketable Items', icon: Ticket, count: items.length },
            { id: 'requests', label: 'Ticket Requests', icon: ClipboardList, count: requests.length },
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

      {/* Ticketable items */}
      {activeTab === 'catalog' && (
      <SectionCard title="Ticketable Items" subtitle={`${stats.available} of ${stats.items} available`} icon={Ticket} tone="accent" pad="md"
        actions={
          <button type="button" onClick={() => setCatalogModal({ open: true, item: null })} className={button.secondary}>
            <Plus size={14} /> Add
          </button>
        }>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center">
            <Ticket size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No ticketable items in the catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item, idx) => {
              const Icon = ticketIcon(item.name);
              const chip = item.available ? CHIP_COLORS[idx % CHIP_COLORS.length] : DIMMED_CHIP;
              return (
                <div
                  key={item.id}
                  className={`group flex flex-col rounded-xl border p-4 transition ${
                    item.available
                      ? 'border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-slate-700 dark:hover:border-indigo-700'
                      : 'border-slate-200 opacity-70 dark:border-slate-700'
                  }`}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className={`shrink-0 rounded-lg p-2.5 transition group-hover:scale-105 ${chip}`}>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-snug text-slate-900 dark:text-white">{item.name}</h3>
                      <Badge tone={item.available ? 'success' : 'neutral'} className="mt-1">
                        {item.available ? 'Available' : 'Unavailable'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-3 flex-1 text-sm text-slate-500 dark:text-slate-400">{item.description}</p>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-700/60">
                    <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                      {formatAmount(Number(item.price))}
                      <span className="text-xs font-normal text-slate-400"> /ticket</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <ServiceItemActions onEdit={() => setCatalogModal({ open: true, item: item })} onDelete={() => setDeleteTarget(item)} />
                    <button
                      type="button"
                      onClick={() => openForm(item.id)}
                      disabled={!item.available}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                    >
                      Issue
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

      {/* Issued tickets */}
      {activeTab === 'requests' && (
      <SectionCard title="Ticket Requests" subtitle={`${requests.length} request${requests.length === 1 ? '' : 's'}`} icon={ClipboardList} tone="info" pad="none">
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No ticket requests yet</p>
            <p className="mt-1 text-xs text-slate-400">Issue a ticket for a guest above.</p>
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
        category="ticketing"
        itemLabel="ticket item"
        item={catalogModal.item}
      />
      <DeleteServiceModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchAll}
        item={deleteTarget}
        itemLabel="ticket item"
      />
    </div>
  );
};

export default TicketingModule;
