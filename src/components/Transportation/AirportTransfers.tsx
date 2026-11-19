/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Airport Transfers — flight tracking and airport transfer management.
 * DB-integrated via /api/transport/airport-transfers/* with guest + driver links.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Plane,
  Search,
  Calendar,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Bell,
  Eye,
  Pencil,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Navigation,
  Loader2,
  RefreshCw,
  UserCheck,
  Users,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface AirportTransfer {
  id: string;
  transfer_number: string;
  guest_id: string | null;
  guest_name: string;
  room: string | null;
  type: string;
  service: string;
  flight_number: string;
  airline: string | null;
  terminal: string | null;
  scheduled_time: string;
  estimated_landing: string | null;
  actual_landing: string | null;
  flight_status: string;
  delay: string | null;
  pickup_location: string;
  destination: string;
  status: string;
  meet_greet: boolean;
  passenger_count: number;
  luggage_count: number;
  assigned_vehicle: string | null;
  driver_id: string | null;
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

const TRANSFER_TYPES = ['Arrival Pickup', 'Departure Drop-off', 'Meet & Greet', 'VIP Pickup', 'Group Transfer', 'Executive Transfer'];
const TRANSFER_SERVICES = ['Standard', 'VIP Meet & Greet', 'Group', 'Executive'];
const FLIGHT_STATUSES = ['Scheduled', 'In Flight', 'Landed', 'Delayed', 'Cancelled', 'Diverted'];
const TRANSFER_STATUSES = ['Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show'];
const ARRIVAL_TYPES = ['Arrival Pickup', 'Meet & Greet', 'VIP Pickup', 'Group Transfer', 'Executive Transfer'];

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

function flightStatusTone(status: string): StatusTone {
  switch (status) {
    case 'Landed': return 'success';
    case 'In Flight': return 'info';
    case 'Delayed': return 'warning';
    case 'Cancelled': case 'Diverted': return 'danger';
    default: return 'neutral';
  }
}

function delayTone(delay?: string | null): string {
  if (!delay) return 'text-emerald-600 dark:text-emerald-400';
  if (delay.startsWith('+')) return 'text-amber-600 dark:text-amber-400';
  return 'text-slate-500';
}

function formatTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  guestId: '', guestName: '', room: '', type: 'Arrival Pickup', service: 'Standard',
  flightNumber: '', airline: '', terminal: '', scheduledTime: '', estimatedLanding: '',
  flightStatus: 'Scheduled', delay: '', pickupLocation: '', destination: '',
  status: 'Requested', meetGreet: false, passengerCount: 1, luggageCount: 0,
  assignedVehicle: '', driverId: '',
};

const AirportTransfers = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [transfers, setTransfers] = useState<AirportTransfer[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AirportTransfer | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [refreshingFlights, setRefreshingFlights] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [tRes, dRes, gRes] = await Promise.all([
        fetch(`/api/transport/airport-transfers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch('/api/guests', { headers: authHeaders() }),
      ]);
      if (tRes.ok) setTransfers(((await tRes.json()) as { transfers: AirportTransfer[] }).transfers || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (gRes.ok) setGuests(((await gRes.json()) as { guests: Guest[] }).guests || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const handleRefreshFlights = async () => {
    if (!currentPropertyId) return;
    setRefreshingFlights(true);
    try {
      const res = await fetch(`/api/transport/airport-transfers/refresh-flights/${currentPropertyId}`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({}),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      const data = (await res.json()) as { configured: boolean; refreshed: number; scanned?: number };
      if (!data.configured) {
        addNotification('Flight tracking provider not configured — statuses remain manual', 'info', 'Transportation');
      } else {
        addNotification(`Refreshed ${data.refreshed} flight(s)`, 'success', 'Transportation');
      }
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Flight refresh failed', 'danger', 'Transportation'); } finally { setRefreshingFlights(false); }
  };

  const filtered = useMemo(() => {
    let list = transfers;
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    if (typeFilter !== 'all') list = list.filter((t) => t.type === typeFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((t) =>
      t.guest_name.toLowerCase().includes(q) ||
      t.flight_number.toLowerCase().includes(q) ||
      t.transfer_number.toLowerCase().includes(q) ||
      (t.airline || '').toLowerCase().includes(q)
    );
  }, [transfers, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    total: transfers.length,
    arrivals: transfers.filter((t) => ARRIVAL_TYPES.includes(t.type) && isToday(t.scheduled_time)).length,
    departures: transfers.filter((t) => t.type === 'Departure Drop-off' && isToday(t.scheduled_time)).length,
    delayed: transfers.filter((t) => t.flight_status === 'Delayed').length,
  }), [transfers]);

  const flightAlerts = useMemo(() => {
    const alerts: { message: string; detail: string; icon: typeof AlertTriangle }[] = [];
    for (const t of transfers) {
      if (t.status === 'Completed' || t.status === 'Cancelled') continue;
      if (t.flight_status === 'Delayed') {
        alerts.push({ message: `Flight ${t.flight_number} delayed${t.delay ? ` by ${t.delay.replace(/^\+/, '')}` : ''}`, detail: t.guest_name, icon: AlertTriangle });
      }
      if (t.flight_status === 'Diverted') {
        alerts.push({ message: `Flight ${t.flight_number} diverted`, detail: t.guest_name, icon: AlertTriangle });
      }
      if (t.flight_status === 'Cancelled') {
        alerts.push({ message: `Flight ${t.flight_number} cancelled`, detail: t.guest_name, icon: AlertTriangle });
      }
      if (t.actual_landing && t.estimated_landing && new Date(t.actual_landing) < new Date(t.estimated_landing)) {
        const mins = Math.round((new Date(t.estimated_landing).getTime() - new Date(t.actual_landing).getTime()) / 60000);
        alerts.push({ message: `Flight ${t.flight_number} landed ${mins} min early`, detail: t.guest_name, icon: ArrowDown });
      }
      if (t.flight_status === 'In Flight' && t.estimated_landing) {
        alerts.push({ message: `Flight ${t.flight_number} in flight — landing ~${formatTime(t.estimated_landing)}`, detail: t.guest_name, icon: Navigation });
      }
    }
    return alerts.slice(0, 6);
  }, [transfers]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (t: AirportTransfer) => {
    setEditingId(t.id);
    setForm({
      guestId: t.guest_id || '',
      guestName: t.guest_name,
      room: t.room || '',
      type: t.type,
      service: t.service,
      flightNumber: t.flight_number,
      airline: t.airline || '',
      terminal: t.terminal || '',
      scheduledTime: toLocalInput(t.scheduled_time),
      estimatedLanding: toLocalInput(t.estimated_landing),
      flightStatus: t.flight_status,
      delay: t.delay || '',
      pickupLocation: t.pickup_location,
      destination: t.destination,
      status: t.status,
      meetGreet: t.meet_greet,
      passengerCount: t.passenger_count,
      luggageCount: t.luggage_count,
      assignedVehicle: t.assigned_vehicle || '',
      driverId: t.driver_id || '',
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
      const endpoint = editingId ? `/api/transport/airport-transfers/${editingId}` : '/api/transport/airport-transfers/';
      const method = editingId ? 'PUT' : 'POST';
      const body = {
        propertyId: currentPropertyId,
        guestId: form.guestId || null,
        guestName: form.guestName,
        room: form.room || null,
        type: form.type,
        service: form.service,
        flightNumber: form.flightNumber,
        airline: form.airline || null,
        terminal: form.terminal || null,
        scheduledTime: form.scheduledTime ? new Date(form.scheduledTime).toISOString() : null,
        estimatedLanding: form.estimatedLanding ? new Date(form.estimatedLanding).toISOString() : null,
        flightStatus: form.flightStatus,
        delay: form.delay || null,
        pickupLocation: form.pickupLocation,
        destination: form.destination,
        status: form.status,
        meetGreet: form.meetGreet,
        passengerCount: form.passengerCount,
        luggageCount: form.luggageCount,
        assignedVehicle: form.assignedVehicle || null,
        driverId: form.driverId || null,
      };
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Transfer updated' : 'Transfer created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (t: AirportTransfer, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/airport-transfers/${t.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Transfer ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewing(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transfer?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/airport-transfers/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Transfer deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Airport Transfers" subtitle="Flight tracking and airport transfer management" icon={Plane} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Plane className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view transfers.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Airport Transfers"
        subtitle="Flight tracking and airport transfer management"
        icon={Plane}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={handleRefreshFlights} disabled={refreshingFlights} className={button.secondary}>
              {refreshingFlights ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plane className="w-4 h-4" />} Refresh Flights
            </button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Transfer</button>
          </div>
        }
      />

      {/* Flight Alerts — derived from live transfer data */}
      {flightAlerts.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h3 className="font-semibold text-amber-900 dark:text-amber-100">Flight Alerts</h3>
          </div>
          <div className="space-y-2">
            {flightAlerts.map((alert, i) => {
              const Icon = alert.icon;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <Icon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-amber-800 dark:text-amber-200">{alert.message}</span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">{alert.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Transfers" value={String(stats.total)} icon={Plane} tone="accent" />
        <StatCard title="Arrivals Today" value={String(stats.arrivals)} icon={ArrowDown} tone="success" />
        <StatCard title="Departures Today" value={String(stats.departures)} icon={ArrowUp} tone="info" />
        <StatCard title="Delayed Flights" value={String(stats.delayed)} icon={AlertTriangle} tone="warning" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by guest, flight, or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Types</option>
          {TRANSFER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Transfers Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Transfers</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Plane className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No airport transfers found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Transfer ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Guest</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Flight</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Scheduled</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Flight Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Delay</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Driver / Vehicle</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{t.transfer_number}</td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white block">{t.guest_name}</span>
                        <span className="text-xs text-slate-400">{t.room ? `Room ${t.room}` : 'No room'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-900 dark:text-white">{t.type}</span>
                        {t.meet_greet && <Badge tone="accent">Meet & Greet</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="text-sm font-medium text-slate-900 dark:text-white block">{t.flight_number}</span>
                        <span className="text-xs text-slate-400">{[t.airline, t.terminal].filter(Boolean).join(' • ') || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Calendar size={12} />{formatDateTime(t.scheduled_time)}</div>
                    </td>
                    <td className="px-6 py-4"><Badge tone={flightStatusTone(t.flight_status)}>{t.flight_status}</Badge></td>
                    <td className="px-6 py-4 text-sm font-medium"><span className={delayTone(t.delay)}>{t.delay || 'On Time'}</span></td>
                    <td className="px-6 py-4">
                      {t.transport_drivers ? (
                        <div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white block">{t.transport_drivers.employees?.name || '—'}</span>
                          <span className="text-xs text-slate-400">{t.assigned_vehicle || '—'}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
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
        title={editingId ? 'Edit Transfer' : 'New Airport Transfer'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest">
            <input className={inputCls} list="at-guest-list" value={form.guestName} onChange={(e) => handleGuestNameChange(e.target.value)} placeholder="Guest name…" />
            <datalist id="at-guest-list">
              {guests.map((g) => <option key={g.id} value={g.name} />)}
            </datalist>
          </Field>
          <Field label="Room"><input className={inputCls} value={form.room} onChange={(e) => setForm(f => ({ ...f, room: e.target.value }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {TRANSFER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Service">
            <select className={inputCls} value={form.service} onChange={(e) => setForm(f => ({ ...f, service: e.target.value }))}>
              {TRANSFER_SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Flight Number"><input className={inputCls} value={form.flightNumber} onChange={(e) => setForm(f => ({ ...f, flightNumber: e.target.value }))} placeholder="e.g. BA247" /></Field>
          <Field label="Airline"><input className={inputCls} value={form.airline} onChange={(e) => setForm(f => ({ ...f, airline: e.target.value }))} /></Field>
          <Field label="Terminal"><input className={inputCls} value={form.terminal} onChange={(e) => setForm(f => ({ ...f, terminal: e.target.value }))} placeholder="e.g. Terminal 4" /></Field>
          <Field label="Flight Status">
            <select className={inputCls} value={form.flightStatus} onChange={(e) => setForm(f => ({ ...f, flightStatus: e.target.value }))}>
              {FLIGHT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Scheduled"><input type="datetime-local" className={inputCls} value={form.scheduledTime} onChange={(e) => setForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Estimated Landing"><input type="datetime-local" className={inputCls} value={form.estimatedLanding} onChange={(e) => setForm(f => ({ ...f, estimatedLanding: e.target.value }))} /></Field>
          <Field label="Delay"><input className={inputCls} value={form.delay} onChange={(e) => setForm(f => ({ ...f, delay: e.target.value }))} placeholder="e.g. +25 min" /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Pickup Location"><input className={inputCls} value={form.pickupLocation} onChange={(e) => setForm(f => ({ ...f, pickupLocation: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={form.destination} onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={form.passengerCount} onChange={(e) => setForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Luggage"><input type="number" min={0} className={inputCls} value={form.luggageCount} onChange={(e) => setForm(f => ({ ...f, luggageCount: Number(e.target.value) }))} /></Field>
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
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.meetGreet} onChange={(e) => setForm(f => ({ ...f, meetGreet: e.target.checked }))} className="rounded border-slate-300" />
              Meet & Greet service
            </label>
          </div>
        </div>
      </ModalSystem>

      {/* Detail Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Transfer ${viewing.transfer_number}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.guest_name}</p>
                <p className="text-xs text-slate-500">{viewing.room ? `Room ${viewing.room} • ` : ''}{viewing.type} • {viewing.service}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={flightStatusTone(viewing.flight_status)} icon={Plane}>{viewing.flight_status}</Badge>
                <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Plane size={14} />{viewing.flight_number} — {viewing.airline || '—'} {viewing.terminal ? `(${viewing.terminal})` : ''}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Clock size={14} />{formatDateTime(viewing.scheduled_time)}{viewing.delay ? ` • ${viewing.delay}` : ''}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.passenger_count} pax / {viewing.luggage_count} bags</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><UserCheck size={14} />{viewing.transport_drivers?.employees?.name || 'No driver'} {viewing.assigned_vehicle ? `• ${viewing.assigned_vehicle}` : ''}</div>
              <div className="col-span-2 flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewing.pickup_location} → {viewing.destination}</div>
              {viewing.estimated_landing && (
                <div className="col-span-2 text-xs text-slate-500">
                  Est. landing {formatDateTime(viewing.estimated_landing)}{viewing.actual_landing ? ` • landed ${formatDateTime(viewing.actual_landing)}` : ''}
                </div>
              )}
            </div>
            {viewing.meet_greet && (
              <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 rounded-xl text-xs text-indigo-800 dark:text-indigo-200">
                Meet & Greet service included — driver meets guest at arrivals.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {viewing.status === 'Requested' && <button onClick={() => handleStatusChange(viewing, 'Confirmed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Confirm</button>}
              {viewing.status === 'Confirmed' && <button onClick={() => handleStatusChange(viewing, 'Assigned')} disabled={saving} className={button.primary}><UserCheck size={14} /> Mark Assigned</button>}
              {['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress'].includes(viewing.status) && <button onClick={() => handleStatusChange(viewing, 'Completed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Complete</button>}
              {!['Completed', 'Cancelled', 'No Show'].includes(viewing.status) && <button onClick={() => handleStatusChange(viewing, 'Cancelled')} disabled={saving} className={button.secondary}>Cancel</button>}
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default AirportTransfers;
