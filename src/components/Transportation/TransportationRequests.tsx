/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transportation Requests — incoming guest/staff transport requests.
 * DB-integrated via /api/transport/requests/* with guest + driver links.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Plus,
  Search,
  Calendar,
  MapPin,
  Users,
  Clock,
  Plane,
  Car,
  Bus,
  Luggage,
  CheckCircle2,
  AlertCircle,
  Eye,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  Crown,
  Package,
  Navigation,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface TransportRequest {
  id: string;
  request_number: string;
  guest_id: string | null;
  guest_name: string;
  room: string | null;
  type: string;
  source: string;
  pickup_location: string;
  destination: string;
  scheduled_time: string;
  passenger_count: number;
  luggage_count: number;
  status: string;
  priority: string;
  special_instructions: string | null;
  assigned_vehicle: string | null;
  driver_id: string | null;
  estimated_duration: string | null;
  estimated_distance: number | null;
  guests: { name: string } | null;
  transport_drivers: { id: string; assigned_vehicle: string | null; employees: { name: string } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  employees: { name: string } | null;
}

interface Guest {
  id: string;
  name: string;
}

const REQUEST_TYPES = ['Airport Pickup', 'Airport Drop-off', 'City Transfer', 'Hotel Shuttle', 'Sightseeing Tour', 'VIP Transport', 'Staff Shuttle', 'Courier Service'];
const REQUEST_SOURCES = ['Front Office', 'Concierge', 'Guest Mobile App', 'Website', 'Reservation System', 'Corporate Account', 'Events & Banquets', 'Staff Portal'];
const REQUEST_STATUSES = ['Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show'];
const REQUEST_PRIORITIES = ['Critical', 'High', 'Normal', 'Low'];
const ACTIVE_STATUSES = ['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';
const filterSelectCls = 'px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans w-auto';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'Completed': return 'success';
    case 'Cancelled': case 'No Show': return 'danger';
    case 'Requested': return 'warning';
    case 'Confirmed': return 'info';
    default: return 'accent';
  }
}

function priorityTone(priority: string): StatusTone {
  switch (priority) {
    case 'Critical': return 'danger';
    case 'High': return 'warning';
    case 'Normal': return 'info';
    default: return 'neutral';
  }
}

function TypeIcon({ type }: { type: string }) {
  if (type.includes('Airport')) return <Plane className="w-4 h-4" />;
  if (type.includes('Shuttle')) return <Bus className="w-4 h-4" />;
  if (type.includes('VIP')) return <Crown className="w-4 h-4" />;
  if (type.includes('Courier')) return <Package className="w-4 h-4" />;
  if (type.includes('Tour')) return <Navigation className="w-4 h-4" />;
  return <Car className="w-4 h-4" />;
}

function formatDateTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toLocalInput(ts?: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyForm = {
  guestId: '', guestName: '', room: '', type: 'Airport Pickup', source: 'Front Office',
  pickupLocation: '', destination: '', scheduledTime: '', passengerCount: 1, luggageCount: 0,
  status: 'Requested', priority: 'Normal', specialInstructions: '', assignedVehicle: '', driverId: '',
};

const TransportationRequests = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [requests, setRequests] = useState<TransportRequest[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TransportRequest | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [rRes, dRes, gRes] = await Promise.all([
        fetch(`/api/transport/requests/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch('/api/guests', { headers: authHeaders() }),
      ]);
      if (rRes.ok) setRequests(((await rRes.json()) as { requests: TransportRequest[] }).requests || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (gRes.ok) setGuests(((await gRes.json()) as { guests: Guest[] }).guests || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = requests;
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (typeFilter !== 'all') list = list.filter((r) => r.type === typeFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((r) =>
      r.guest_name.toLowerCase().includes(q) ||
      r.request_number.toLowerCase().includes(q) ||
      (r.room || '').toLowerCase().includes(q) ||
      r.pickup_location.toLowerCase().includes(q) ||
      r.destination.toLowerCase().includes(q)
    );
  }, [requests, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    pending: requests.filter((r) => r.status === 'Requested').length,
    confirmed: requests.filter((r) => r.status === 'Confirmed').length,
    active: requests.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
    completed: requests.filter((r) => r.status === 'Completed').length,
  }), [requests]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (r: TransportRequest) => {
    setEditingId(r.id);
    setForm({
      guestId: r.guest_id || '',
      guestName: r.guest_name,
      room: r.room || '',
      type: r.type,
      source: r.source,
      pickupLocation: r.pickup_location,
      destination: r.destination,
      scheduledTime: toLocalInput(r.scheduled_time),
      passengerCount: r.passenger_count,
      luggageCount: r.luggage_count,
      status: r.status,
      priority: r.priority,
      specialInstructions: r.special_instructions || '',
      assignedVehicle: r.assigned_vehicle || '',
      driverId: r.driver_id || '',
    });
    setShowModal(true);
  };

  const handleGuestNameChange = (name: string) => {
    const match = guests.find((g) => g.name === name);
    setForm((f) => ({ ...f, guestName: name, guestId: match ? match.id : '' }));
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/requests/${editingId}` : '/api/transport/requests/';
      const method = editingId ? 'PUT' : 'POST';
      const body = {
        propertyId: currentPropertyId,
        guestId: form.guestId || null,
        guestName: form.guestName,
        room: form.room || null,
        type: form.type,
        source: form.source,
        pickupLocation: form.pickupLocation,
        destination: form.destination,
        scheduledTime: form.scheduledTime ? new Date(form.scheduledTime).toISOString() : null,
        passengerCount: form.passengerCount,
        luggageCount: form.luggageCount,
        status: form.status,
        priority: form.priority,
        specialInstructions: form.specialInstructions || null,
        assignedVehicle: form.assignedVehicle || null,
        driverId: form.driverId || null,
      };
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Request updated' : 'Request created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (r: TransportRequest, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/requests/${r.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Request ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewing(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this request?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/requests/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Request deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Transportation Requests" subtitle="Manage incoming transportation requests" icon={Car} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view requests.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Transportation Requests"
        subtitle="Manage incoming transportation requests — linked to guests and drivers"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Request</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending" value={String(stats.pending)} icon={Clock} tone="warning" />
        <StatCard title="Confirmed" value={String(stats.confirmed)} icon={CheckCircle2} tone="info" />
        <StatCard title="Active" value={String(stats.active)} icon={Car} tone="accent" />
        <StatCard title="Completed" value={String(stats.completed)} icon={CheckCircle2} tone="success" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by guest, ID, room, or location..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Types</option>
          {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Requests Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Requests</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No transportation requests found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Request ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Guest</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Source</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Route</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Scheduled</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Pax / Bags</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Priority</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{r.request_number}</td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white block">{r.guest_name}</span>
                        <span className="text-xs text-slate-400">{r.room ? `Room ${r.room}` : 'No room'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500"><TypeIcon type={r.type} /></div>
                        <span className="text-sm text-slate-900 dark:text-white">{r.type}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{r.source}</td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-slate-500 max-w-[220px]">
                        <div className="flex items-center gap-1 truncate"><MapPin size={11} className="shrink-0" />{r.pickup_location}</div>
                        <div className="flex items-center gap-1 truncate mt-0.5"><Navigation size={11} className="shrink-0" />{r.destination}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Calendar size={12} />{formatDateTime(r.scheduled_time)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Users size={12} />{r.passenger_count}</span>
                        <span className="flex items-center gap-1"><Luggage size={12} />{r.luggage_count}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-6 py-4"><Badge tone={priorityTone(r.priority)} variant={r.priority === 'Critical' || r.priority === 'High' ? 'solid' : 'soft'}>{r.priority}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setViewing(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                        <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create / Edit Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Request' : 'New Transportation Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest / Requester">
            <input className={inputCls} list="tr-guest-list" value={form.guestName} onChange={(e) => handleGuestNameChange(e.target.value)} placeholder="Guest name or requester…" />
            <datalist id="tr-guest-list">
              {guests.map((g) => <option key={g.id} value={g.name} />)}
            </datalist>
          </Field>
          <Field label="Room"><input className={inputCls} value={form.room} onChange={(e) => setForm(f => ({ ...f, room: e.target.value }))} placeholder="e.g. 302" /></Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select className={inputCls} value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))}>
              {REQUEST_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Pickup Location"><input className={inputCls} value={form.pickupLocation} onChange={(e) => setForm(f => ({ ...f, pickupLocation: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={form.destination} onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Scheduled Time"><input type="datetime-local" className={inputCls} value={form.scheduledTime} onChange={(e) => setForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}>
              {REQUEST_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={form.passengerCount} onChange={(e) => setForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Luggage"><input type="number" min={0} className={inputCls} value={form.luggageCount} onChange={(e) => setForm(f => ({ ...f, luggageCount: Number(e.target.value) }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Assigned Driver">
            <select className={inputCls} value={form.driverId} onChange={(e) => {
              const d = drivers.find((x) => x.id === e.target.value);
              setForm(f => ({ ...f, driverId: e.target.value, assignedVehicle: d?.assigned_vehicle || f.assignedVehicle }));
            }}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Assigned Vehicle"><input className={inputCls} value={form.assignedVehicle} onChange={(e) => setForm(f => ({ ...f, assignedVehicle: e.target.value }))} placeholder="e.g. VH-003" /></Field>
          <div className="col-span-2"><Field label="Special Instructions"><textarea className={inputCls} rows={2} value={form.specialInstructions} onChange={(e) => setForm(f => ({ ...f, specialInstructions: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>

      {/* Detail / Dispatch Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Request ${viewing.request_number}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.guest_name}</p>
                <p className="text-xs text-slate-500">{viewing.room ? `Room ${viewing.room}` : 'No room'} • {viewing.source}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
                <Badge tone={priorityTone(viewing.priority)}>{viewing.priority}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><TypeIcon type={viewing.type} />{viewing.type}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Calendar size={14} />{formatDateTime(viewing.scheduled_time)}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.passenger_count} passengers</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Luggage size={14} />{viewing.luggage_count} bags</div>
              <div className="col-span-2 flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewing.pickup_location} → {viewing.destination}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Car size={14} />{viewing.assigned_vehicle || 'No vehicle'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.transport_drivers?.employees?.name || 'No driver'}</div>
            </div>
            {viewing.special_instructions && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />{viewing.special_instructions}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {viewing.status === 'Requested' && (
                <button onClick={() => handleStatusChange(viewing, 'Confirmed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Confirm</button>
              )}
              {viewing.status === 'Confirmed' && (
                <button onClick={() => handleStatusChange(viewing, 'Assigned')} disabled={saving} className={button.primary}><Car size={14} /> Mark Assigned</button>
              )}
              {ACTIVE_STATUSES.includes(viewing.status) && (
                <button onClick={() => handleStatusChange(viewing, 'Completed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Complete</button>
              )}
              {!['Completed', 'Cancelled', 'No Show'].includes(viewing.status) && (
                <button onClick={() => handleStatusChange(viewing, 'Cancelled')} disabled={saving} className={button.secondary}>Cancel Request</button>
              )}
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default TransportationRequests;
