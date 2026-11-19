/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Trip Management — complete trip lifecycle on top of transport_requests.
 * DB-integrated via /api/transport/requests/*, /api/transport/vehicles/* and
 * /api/transport/drivers/*.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Search,
  Calendar,
  MapPin,
  Users,
  Clock,
  Car,
  CheckCircle2,
  Eye,
  Pencil,
  Navigation,
  DollarSign,
  Loader2,
  RefreshCw,
  Plus,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Trip {
  id: string;
  request_number: string;
  guest_name: string;
  room: string | null;
  type: string;
  source: string;
  pickup_location: string;
  destination: string;
  scheduled_time: string;
  actual_start_time: string | null;
  actual_end_time: string | null;
  passenger_count: number;
  luggage_count: number;
  status: string;
  priority: string;
  special_instructions: string | null;
  assigned_vehicle: string | null;
  driver_id: string | null;
  estimated_duration: string | null;
  estimated_distance: number | null;
  actual_duration: string | null;
  actual_distance: number | null;
  amount: number;
  payment_method: string | null;
  transport_drivers: { id: string; employees: { name: string } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  status: string;
  employees: { name: string } | null;
}

const TRIP_TYPES = ['Airport Pickup', 'Airport Drop-off', 'City Transfer', 'Hotel Shuttle', 'Sightseeing Tour', 'VIP Transport', 'Staff Shuttle', 'Courier Service'];
const TRIP_STATUSES = ['Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show'];
const PAYMENT_METHODS = ['Guest Folio', 'Corporate Billing', 'Event Billing', 'Cash Payment', 'Credit Card', 'Complimentary', 'Internal Department Charge'];
const ACTIVE_STATUSES = ['Driver En Route', 'Guest Picked Up', 'In Progress'];

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

function formatDateTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toLocalInput(ts?: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inDateRange(ts: string, range: string): boolean {
  if (range === 'all') return true;
  const d = new Date(ts);
  const now = new Date();
  if (range === 'today') return d.toDateString() === now.toDateString();
  if (range === 'week') { const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0); return d >= start; }
  if (range === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return true;
}

const emptyForm = {
  guestName: '', room: '', type: 'Airport Pickup', pickupLocation: '', destination: '',
  scheduledTime: '', passengerCount: 1, luggageCount: 0, status: 'Requested',
  assignedVehicle: '', driverId: '', estimatedDuration: '', estimatedDistance: '',
  actualDuration: '', actualDistance: '', amount: 0, paymentMethod: 'Guest Folio',
};

const TripManagement = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Trip | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        fetch(`/api/transport/requests/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (rRes.ok) setTrips(((await rRes.json()) as { requests: Trip[] }).requests || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = trips.filter((t) => inDateRange(t.scheduled_time, dateFilter));
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((t) =>
      t.guest_name.toLowerCase().includes(q) ||
      t.request_number.toLowerCase().includes(q) ||
      (t.room || '').toLowerCase().includes(q) ||
      (t.assigned_vehicle || '').toLowerCase().includes(q)
    );
  }, [trips, search, statusFilter, dateFilter]);

  const stats = useMemo(() => ({
    total: filtered.length,
    completed: filtered.filter((t) => t.status === 'Completed').length,
    inProgress: filtered.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    revenue: filtered.filter((t) => t.status === 'Completed').reduce((s, t) => s + (t.amount || 0), 0),
  }), [filtered]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (t: Trip) => {
    setEditingId(t.id);
    setForm({
      guestName: t.guest_name,
      room: t.room || '',
      type: t.type,
      pickupLocation: t.pickup_location,
      destination: t.destination,
      scheduledTime: toLocalInput(t.scheduled_time),
      passengerCount: t.passenger_count,
      luggageCount: t.luggage_count,
      status: t.status,
      assignedVehicle: t.assigned_vehicle || '',
      driverId: t.driver_id || '',
      estimatedDuration: t.estimated_duration || '',
      estimatedDistance: t.estimated_distance != null ? String(t.estimated_distance) : '',
      actualDuration: t.actual_duration || '',
      actualDistance: t.actual_distance != null ? String(t.actual_distance) : '',
      amount: t.amount || 0,
      paymentMethod: t.payment_method || 'Guest Folio',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/requests/${editingId}` : '/api/transport/requests/';
      const method = editingId ? 'PUT' : 'POST';
      const body: Record<string, unknown> = {
        propertyId: currentPropertyId,
        guestName: form.guestName,
        room: form.room || null,
        type: form.type,
        pickupLocation: form.pickupLocation,
        destination: form.destination,
        scheduledTime: form.scheduledTime ? new Date(form.scheduledTime).toISOString() : null,
        passengerCount: form.passengerCount,
        luggageCount: form.luggageCount,
        status: form.status,
        assignedVehicle: form.assignedVehicle || null,
        driverId: form.driverId || null,
        estimatedDuration: form.estimatedDuration || null,
        estimatedDistance: form.estimatedDistance !== '' ? Number(form.estimatedDistance) : null,
        actualDuration: form.actualDuration || null,
        actualDistance: form.actualDistance !== '' ? Number(form.actualDistance) : null,
        amount: form.amount,
        paymentMethod: form.paymentMethod || null,
      };
      // Lifecycle bookkeeping: stamp actual start/end when status implies it.
      if (editingId) {
        const existing = trips.find((t) => t.id === editingId);
        if (existing && !existing.actual_start_time && ACTIVE_STATUSES.includes(form.status)) {
          body.actualStartTime = new Date().toISOString();
        }
        if (existing && !existing.actual_end_time && form.status === 'Completed') {
          body.actualEndTime = new Date().toISOString();
        }
      }
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Trip updated' : 'Trip created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (t: Trip, status: string) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { status };
      if (!t.actual_start_time && ACTIVE_STATUSES.includes(status)) body.actualStartTime = new Date().toISOString();
      if (status === 'Completed' && !t.actual_end_time) body.actualEndTime = new Date().toISOString();
      const res = await fetch(`/api/transport/requests/${t.id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Trip ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewing(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Trip Management" subtitle="Complete trip lifecycle management" icon={Car} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view trips.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Trip Management"
        subtitle="Complete trip lifecycle management — requests through billing"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Trip</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Trips" value={String(stats.total)} icon={Car} tone="accent" />
        <StatCard title="Completed" value={String(stats.completed)} icon={CheckCircle2} tone="success" />
        <StatCard title="In Progress" value={String(stats.inProgress)} icon={Clock} tone="warning" />
        <StatCard title="Revenue" value={formatAmount(stats.revenue)} icon={DollarSign} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by guest, ID, room, or vehicle..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {TRIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </div>

      {/* Trips Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Trips</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No trips found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Trip ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Guest</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Vehicle / Driver</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Route</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Scheduled</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Duration</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Amount</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{t.request_number}</td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white block">{t.guest_name}</span>
                        <span className="text-xs text-slate-400">{t.room ? `Room ${t.room}` : 'No room'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{t.type}</td>
                    <td className="px-6 py-4">
                      {t.assigned_vehicle ? (
                        <div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white block">{t.assigned_vehicle}</span>
                          <span className="text-xs text-slate-400">{t.transport_drivers?.employees?.name || '—'}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-slate-500 max-w-[220px]">
                        <div className="flex items-center gap-1 truncate"><MapPin size={11} className="shrink-0" />{t.pickup_location}</div>
                        <div className="flex items-center gap-1 truncate mt-0.5"><Navigation size={11} className="shrink-0" />{t.destination}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Calendar size={12} />{formatDateTime(t.scheduled_time)}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{t.actual_duration || t.estimated_duration || '—'}</td>
                    <td className="px-6 py-4"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{formatAmount(t.amount || 0)}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setViewing(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                        <button onClick={() => openEdit(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
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
        title={editingId ? 'Edit Trip' : 'New Trip'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest"><input className={inputCls} value={form.guestName} onChange={(e) => setForm(f => ({ ...f, guestName: e.target.value }))} /></Field>
          <Field label="Room"><input className={inputCls} value={form.room} onChange={(e) => setForm(f => ({ ...f, room: e.target.value }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {TRIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {TRIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Pickup"><input className={inputCls} value={form.pickupLocation} onChange={(e) => setForm(f => ({ ...f, pickupLocation: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={form.destination} onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Scheduled"><input type="datetime-local" className={inputCls} value={form.scheduledTime} onChange={(e) => setForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Driver">
            <select className={inputCls} value={form.driverId} onChange={(e) => {
              const d = drivers.find((x) => x.id === e.target.value);
              setForm(f => ({ ...f, driverId: e.target.value, assignedVehicle: d?.assigned_vehicle || f.assignedVehicle }));
            }}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Vehicle"><input className={inputCls} value={form.assignedVehicle} onChange={(e) => setForm(f => ({ ...f, assignedVehicle: e.target.value }))} placeholder="e.g. VH-003" /></Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={form.passengerCount} onChange={(e) => setForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Luggage"><input type="number" min={0} className={inputCls} value={form.luggageCount} onChange={(e) => setForm(f => ({ ...f, luggageCount: Number(e.target.value) }))} /></Field>
          <Field label="Est. Duration"><input className={inputCls} value={form.estimatedDuration} onChange={(e) => setForm(f => ({ ...f, estimatedDuration: e.target.value }))} placeholder="e.g. 45 min" /></Field>
          <Field label="Est. Distance (km)"><input type="number" min={0} step="0.1" className={inputCls} value={form.estimatedDistance} onChange={(e) => setForm(f => ({ ...f, estimatedDistance: e.target.value }))} /></Field>
          <Field label="Actual Duration"><input className={inputCls} value={form.actualDuration} onChange={(e) => setForm(f => ({ ...f, actualDuration: e.target.value }))} placeholder="e.g. 42 min" /></Field>
          <Field label="Actual Distance (km)"><input type="number" min={0} step="0.1" className={inputCls} value={form.actualDistance} onChange={(e) => setForm(f => ({ ...f, actualDistance: e.target.value }))} /></Field>
          <Field label="Amount"><input type="number" min={0} step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: Number(e.target.value) }))} /></Field>
          <Field label="Payment Method">
            <select className={inputCls} value={form.paymentMethod} onChange={(e) => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* Detail Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Trip ${viewing.request_number}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.guest_name}</p>
                <p className="text-xs text-slate-500">{viewing.room ? `Room ${viewing.room} • ` : ''}{viewing.type} • {viewing.source}</p>
              </div>
              <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Car size={14} />{viewing.assigned_vehicle || 'No vehicle'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><UserCheck size={14} />{viewing.transport_drivers?.employees?.name || 'No driver'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.passenger_count} pax / {viewing.luggage_count} bags</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><DollarSign size={14} />{formatAmount(viewing.amount || 0)} • {viewing.payment_method || '—'}</div>
              <div className="col-span-2 flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewing.pickup_location} → {viewing.destination}</div>
            </div>
            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs">
              <div><p className="text-slate-400 uppercase font-bold">Scheduled</p><p className="text-slate-700 dark:text-slate-200 mt-0.5">{formatDateTime(viewing.scheduled_time)}</p></div>
              <div><p className="text-slate-400 uppercase font-bold">Started</p><p className="text-slate-700 dark:text-slate-200 mt-0.5">{formatTime(viewing.actual_start_time)}</p></div>
              <div><p className="text-slate-400 uppercase font-bold">Ended</p><p className="text-slate-700 dark:text-slate-200 mt-0.5">{formatTime(viewing.actual_end_time)}</p></div>
              <div><p className="text-slate-400 uppercase font-bold">Est. Duration</p><p className="text-slate-700 dark:text-slate-200 mt-0.5">{viewing.estimated_duration || '—'}</p></div>
              <div><p className="text-slate-400 uppercase font-bold">Actual Duration</p><p className="text-slate-700 dark:text-slate-200 mt-0.5">{viewing.actual_duration || '—'}</p></div>
              <div><p className="text-slate-400 uppercase font-bold">Distance</p><p className="text-slate-700 dark:text-slate-200 mt-0.5">{viewing.actual_distance ?? viewing.estimated_distance ?? '—'} km</p></div>
            </div>
            {viewing.special_instructions && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />{viewing.special_instructions}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {viewing.status === 'Requested' && <button onClick={() => handleStatusChange(viewing, 'Confirmed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Confirm</button>}
              {viewing.status === 'Confirmed' && <button onClick={() => handleStatusChange(viewing, 'Driver En Route')} disabled={saving} className={button.primary}><Car size={14} /> Start Trip</button>}
              {ACTIVE_STATUSES.includes(viewing.status) && <button onClick={() => handleStatusChange(viewing, 'Completed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Complete</button>}
              {!['Completed', 'Cancelled', 'No Show'].includes(viewing.status) && <button onClick={() => handleStatusChange(viewing, 'Cancelled')} disabled={saving} className={button.secondary}>Cancel</button>}
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default TripManagement;
