/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest Transportation — local transfers and guest transportation services.
 * DB-integrated via /api/transport/guest-transports/* with guest + driver links.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MapPin,
  Search,
  Calendar,
  Users,
  Car,
  Plus,
  Eye,
  Pencil,
  Trash2,
  ShoppingBag,
  Utensils,
  Camera,
  Heart,
  Briefcase,
  CheckCircle2,
  Loader2,
  RefreshCw,
  DollarSign,
  UserCheck,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface GuestTransport {
  id: string;
  transport_number: string;
  guest_id: string | null;
  guest_name: string;
  room: string | null;
  type: string;
  subtype: string | null;
  pickup: string;
  destination: string;
  scheduled_time: string;
  assigned_vehicle: string | null;
  driver_id: string | null;
  passenger_count: number;
  status: string;
  special_requests: string | null;
  estimated_duration: string | null;
  amount: number | null;
  transport_drivers: { id: string; employees: { name: string; phone: string | null } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  status: string;
  employees: { name: string } | null;
}

interface Guest {
  id: string;
  name: string;
}

const TRANSPORT_TYPES = ['Local Transfer', 'Restaurant Transfer', 'Tour Transportation', 'Medical Transportation', 'Special Assistance'];
const TRANSPORT_STATUSES = ['Requested', 'Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'];

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

function typeIcon(subtype?: string | null) {
  switch (subtype) {
    case 'Shopping Trip': return <ShoppingBag className="w-4 h-4" />;
    case 'Dinner Reservation': return <Utensils className="w-4 h-4" />;
    case 'City Sightseeing': return <Camera className="w-4 h-4" />;
    case 'Hospital Visit': return <Heart className="w-4 h-4" />;
    case 'Accessibility Service': return <Briefcase className="w-4 h-4" />;
    default: return <MapPin className="w-4 h-4" />;
  }
}

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'Completed': return 'success';
    case 'Cancelled': return 'danger';
    case 'In Progress': return 'accent';
    case 'Confirmed': return 'info';
    case 'Pending': return 'warning';
    default: return 'neutral';
  }
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

function isToday(ts?: string | null): boolean {
  if (!ts) return false;
  return new Date(ts).toDateString() === new Date().toDateString();
}

const emptyForm = {
  guestId: '', guestName: '', room: '', type: 'Local Transfer', subtype: '',
  pickup: 'Hotel Lobby', destination: '', scheduledTime: '',
  assignedVehicle: '', driverId: '', passengerCount: 1,
  status: 'Requested', specialRequests: '', estimatedDuration: '', amount: '',
};

const GuestTransportation = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [transports, setTransports] = useState<GuestTransport[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<GuestTransport | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [tRes, dRes, gRes] = await Promise.all([
        fetch(`/api/transport/guest-transports/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch('/api/guests', { headers: authHeaders() }),
      ]);
      if (tRes.ok) setTransports(((await tRes.json()) as { transports: GuestTransport[] }).transports || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (gRes.ok) setGuests(((await gRes.json()) as { guests: Guest[] }).guests || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = transports;
    if (typeFilter !== 'all') list = list.filter((t) => t.type === typeFilter);
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((t) =>
      t.guest_name.toLowerCase().includes(q) ||
      (t.room || '').toLowerCase().includes(q) ||
      t.transport_number.toLowerCase().includes(q) ||
      t.destination.toLowerCase().includes(q)
    );
  }, [transports, search, typeFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: transports.length,
    passengersToday: transports.filter((t) => isToday(t.scheduled_time)).reduce((s, t) => s + t.passenger_count, 0),
    pending: transports.filter((t) => t.status === 'Requested' || t.status === 'Pending').length,
    revenue: transports.filter((t) => t.status === 'Completed').reduce((s, t) => s + (t.amount || 0), 0),
  }), [transports]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (t: GuestTransport) => {
    setEditingId(t.id);
    setForm({
      guestId: t.guest_id || '',
      guestName: t.guest_name,
      room: t.room || '',
      type: t.type,
      subtype: t.subtype || '',
      pickup: t.pickup,
      destination: t.destination,
      scheduledTime: toLocalInput(t.scheduled_time),
      assignedVehicle: t.assigned_vehicle || '',
      driverId: t.driver_id || '',
      passengerCount: t.passenger_count,
      status: t.status,
      specialRequests: t.special_requests || '',
      estimatedDuration: t.estimated_duration || '',
      amount: t.amount !== null ? String(t.amount) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/guest-transports/${editingId}` : '/api/transport/guest-transports/';
      const body = {
        propertyId: currentPropertyId,
        guestId: form.guestId || null,
        guestName: form.guestName,
        room: form.room || null,
        type: form.type,
        subtype: form.subtype || null,
        pickup: form.pickup,
        destination: form.destination,
        scheduledTime: form.scheduledTime ? new Date(form.scheduledTime).toISOString() : null,
        assignedVehicle: form.assignedVehicle || null,
        driverId: form.driverId || null,
        passengerCount: form.passengerCount,
        status: form.status,
        specialRequests: form.specialRequests || null,
        estimatedDuration: form.estimatedDuration || null,
        amount: form.amount === '' ? null : Number(form.amount),
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Transportation updated' : 'Transportation created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (t: GuestTransport, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/guest-transports/${t.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Transport ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewing(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transportation record?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/guest-transports/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Transportation deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Guest Transportation" subtitle="Local transfers and guest transportation services" icon={Car} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view transports.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Transportation"
        subtitle="Local transfers and guest transportation services"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Transportation</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Requests" value={String(stats.total)} icon={Car} tone="accent" />
        <StatCard title="Passengers Today" value={String(stats.passengersToday)} icon={Users} tone="info" />
        <StatCard title="Pending" value={String(stats.pending)} icon={Calendar} tone="warning" />
        <StatCard title="Revenue (Completed)" value={formatAmount(stats.revenue)} icon={DollarSign} tone="success" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by guest, room, or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Types</option>
          {TRANSPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {TRANSPORT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Transports Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Guest Transports</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No guest transports found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Guest</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Route</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Scheduled</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Vehicle / Driver</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Pax</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Amount</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{t.transport_number}</td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white block">{t.guest_name}</span>
                        <span className="text-xs text-slate-400">{t.room ? `Room ${t.room}` : 'No room'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-500">{typeIcon(t.subtype)}</div>
                        <div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white block">{t.type}</span>
                          <span className="text-xs text-slate-400">{t.subtype || '—'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 max-w-xs">
                      <div className="flex items-center gap-1 truncate"><MapPin size={12} />{t.pickup} → {t.destination}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Calendar size={12} />{formatDateTime(t.scheduled_time)}</div>
                    </td>
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
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Users size={12} />{t.passenger_count}</div>
                    </td>
                    <td className="px-6 py-4"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{t.amount !== null ? formatAmount(t.amount) : '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setViewing(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                        <button onClick={() => openEdit(t)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(t.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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
        title={editingId ? 'Edit Transportation' : 'New Transportation'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest">
            <input className={inputCls} list="gt-guest-list" value={form.guestName} onChange={(e) => {
              const match = guests.find((g) => g.name === e.target.value);
              setForm(f => ({ ...f, guestName: e.target.value, guestId: match ? match.id : '' }));
            }} placeholder="Guest name…" />
            <datalist id="gt-guest-list">
              {guests.map((g) => <option key={g.id} value={g.name} />)}
            </datalist>
          </Field>
          <Field label="Room"><input className={inputCls} value={form.room} onChange={(e) => setForm(f => ({ ...f, room: e.target.value }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {TRANSPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Subtype"><input className={inputCls} value={form.subtype} onChange={(e) => setForm(f => ({ ...f, subtype: e.target.value }))} placeholder="e.g. Shopping Trip" /></Field>
          <Field label="Pickup"><input className={inputCls} value={form.pickup} onChange={(e) => setForm(f => ({ ...f, pickup: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={form.destination} onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Scheduled"><input type="datetime-local" className={inputCls} value={form.scheduledTime} onChange={(e) => setForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={form.passengerCount} onChange={(e) => setForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Driver">
            <select className={inputCls} value={form.driverId} onChange={(e) => {
              const d = drivers.find((x) => x.id === e.target.value);
              setForm(f => ({ ...f, driverId: e.target.value, assignedVehicle: d?.assigned_vehicle || f.assignedVehicle }));
            }}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Vehicle"><input className={inputCls} value={form.assignedVehicle} onChange={(e) => setForm(f => ({ ...f, assignedVehicle: e.target.value }))} placeholder="e.g. VH-001" /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {TRANSPORT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Est. Duration"><input className={inputCls} value={form.estimatedDuration} onChange={(e) => setForm(f => ({ ...f, estimatedDuration: e.target.value }))} placeholder="e.g. 2 hours" /></Field>
          <Field label="Amount"><input type="number" min={0} step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="Special Requests"><input className={inputCls} value={form.specialRequests} onChange={(e) => setForm(f => ({ ...f, specialRequests: e.target.value }))} placeholder="e.g. Wheelchair accessible" /></Field></div>
        </div>
      </ModalSystem>

      {/* Detail Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Transport ${viewing.transport_number}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.guest_name}</p>
                <p className="text-xs text-slate-500">{viewing.room ? `Room ${viewing.room} • ` : ''}{viewing.type}{viewing.subtype ? ` — ${viewing.subtype}` : ''}</p>
              </div>
              <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewing.pickup} → {viewing.destination}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Calendar size={14} />{formatDateTime(viewing.scheduled_time)} {viewing.estimated_duration ? `• ~${viewing.estimated_duration}` : ''}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.passenger_count} passengers</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><UserCheck size={14} />{viewing.transport_drivers?.employees?.name || 'No driver'} {viewing.assigned_vehicle ? `• ${viewing.assigned_vehicle}` : ''}</div>
            </div>
            {viewing.special_requests && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-200">
                {viewing.special_requests}
              </div>
            )}
            {viewing.amount !== null && (
              <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Amount</span>
                <span className="font-semibold text-slate-900 dark:text-white">{formatAmount(viewing.amount)}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {(viewing.status === 'Requested' || viewing.status === 'Pending') && <button onClick={() => handleStatusChange(viewing, 'Confirmed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Confirm</button>}
              {viewing.status === 'Confirmed' && <button onClick={() => handleStatusChange(viewing, 'In Progress')} disabled={saving} className={button.primary}><Car size={14} /> Start</button>}
              {viewing.status === 'In Progress' && <button onClick={() => handleStatusChange(viewing, 'Completed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Complete</button>}
              {!['Completed', 'Cancelled'].includes(viewing.status) && <button onClick={() => handleStatusChange(viewing, 'Cancelled')} disabled={saving} className={button.secondary}>Cancel</button>}
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default GuestTransportation;
