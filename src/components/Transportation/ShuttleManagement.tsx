/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shuttle Management — guest-facing shuttle routes and boarding list.
 * DB-integrated via /api/transport/shuttles-trips/* with driver + guest links.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bus,
  MapPin,
  Clock,
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  Route,
  CheckCircle2,
  Loader2,
  RefreshCw,
  UserCheck,
  LogIn,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Shuttle {
  id: string;
  shuttle_number: string | null;
  name: string;
  type: string;
  route: string;
  stops: string[];
  schedule: string | null;
  next_departure: string | null;
  frequency: string | null;
  assigned_vehicle: string | null;
  driver_id: string | null;
  capacity: number;
  current_occupancy: number;
  status: string;
  department: string | null;
  transport_drivers: { id: string; employees: { name: string } | null } | null;
}

interface Boarding {
  id: string;
  shuttle_id: string;
  guest_id: string | null;
  guest_name: string;
  room: string | null;
  pickup: string;
  destination: string;
  scheduled_time: string | null;
  status: string;
  transport_shuttles: { name: string; shuttle_number: string | null } | null;
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

const SHUTTLE_STATUSES = ['Active', 'Standby', 'Scheduled', 'In Transit', 'Maintenance', 'Completed', 'Cancelled'];
const SHUTTLE_TYPES = ['Scheduled Route', 'Demand-Based', 'Special Event', 'Staff Shuttle', 'Shift Transportation'];
const FREQUENCIES = ['Fixed', 'On-Demand', 'Event'];
const BOARDING_STATUSES = ['Confirmed', 'Waiting', 'Checked In', 'Boarded', 'No Show', 'Cancelled'];

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

function shuttleTone(status: string): StatusTone {
  switch (status) {
    case 'Active': return 'success';
    case 'Standby': return 'warning';
    case 'Scheduled': return 'info';
    case 'In Transit': return 'accent';
    case 'Maintenance': case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

function boardingTone(status: string): StatusTone {
  switch (status) {
    case 'Checked In': case 'Boarded': return 'success';
    case 'Waiting': return 'warning';
    case 'Confirmed': return 'info';
    case 'No Show': case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

function occupancyBar(occupancy: number, capacity: number): string {
  if (!capacity) return 'bg-slate-300';
  const pct = (occupancy / capacity) * 100;
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function formatTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const emptyShuttleForm = {
  name: '', type: 'Scheduled Route', route: '', stops: '', schedule: '',
  nextDeparture: '', frequency: 'Fixed', assignedVehicle: '', driverId: '',
  capacity: 20, currentOccupancy: 0, status: 'Active', department: 'Guest Services',
};

const emptyBoardingForm = {
  shuttleId: '', guestId: '', guestName: '', room: '',
  pickup: '', destination: '', scheduledTime: '', status: 'Confirmed',
};

const ShuttleManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [boarding, setBoarding] = useState<Boarding[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shuttleModal, setShuttleModal] = useState(false);
  const [boardingModal, setBoardingModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Shuttle | null>(null);
  const [shuttleForm, setShuttleForm] = useState({ ...emptyShuttleForm });
  const [boardingForm, setBoardingForm] = useState({ ...emptyBoardingForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [sRes, dRes, gRes] = await Promise.all([
        fetch(`/api/transport/shuttles-trips/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch('/api/guests', { headers: authHeaders() }),
      ]);
      if (sRes.ok) {
        const data = (await sRes.json()) as { shuttles: Shuttle[]; boarding: Boarding[] };
        setShuttles(data.shuttles || []);
        setBoarding(data.boarding || []);
      }
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (gRes.ok) setGuests(((await gRes.json()) as { guests: Guest[] }).guests || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filteredShuttles = useMemo(() => {
    let list = shuttles;
    if (statusFilter !== 'all') list = list.filter((s) => s.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.shuttle_number || '').toLowerCase().includes(q) ||
      s.route.toLowerCase().includes(q)
    );
  }, [shuttles, search, statusFilter]);

  const stats = useMemo(() => ({
    active: shuttles.filter((s) => s.status === 'Active' || s.status === 'In Transit').length,
    passengers: shuttles.reduce((sum, s) => sum + (s.current_occupancy || 0), 0),
    boardingToday: boarding.filter((b) => b.scheduled_time && new Date(b.scheduled_time).toDateString() === new Date().toDateString()).length,
    nextDeparture: shuttles
      .filter((s) => s.next_departure && (s.status === 'Active' || s.status === 'Scheduled' || s.status === 'In Transit'))
      .map((s) => s.next_departure as string)
      .sort()[0] || '—',
  }), [shuttles, boarding]);

  const openShuttleCreate = () => {
    setEditingId(null);
    setShuttleForm({ ...emptyShuttleForm });
    setShuttleModal(true);
  };

  const openShuttleEdit = (s: Shuttle) => {
    setEditingId(s.id);
    setShuttleForm({
      name: s.name, type: s.type, route: s.route,
      stops: (s.stops || []).join(', '), schedule: s.schedule || '',
      nextDeparture: s.next_departure || '', frequency: s.frequency || 'Fixed',
      assignedVehicle: s.assigned_vehicle || '', driverId: s.driver_id || '',
      capacity: s.capacity, currentOccupancy: s.current_occupancy,
      status: s.status, department: s.department || 'Guest Services',
    });
    setShuttleModal(true);
  };

  const openBoardingCreate = () => {
    setEditingId(null);
    setBoardingForm({ ...emptyBoardingForm, shuttleId: shuttles[0]?.id || '' });
    setBoardingModal(true);
  };

  const handleShuttleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/shuttles-trips/shuttles/${editingId}` : '/api/transport/shuttles-trips/shuttles';
      const body = {
        propertyId: currentPropertyId,
        name: shuttleForm.name, type: shuttleForm.type, route: shuttleForm.route,
        stops: shuttleForm.stops.split(',').map((s) => s.trim()).filter(Boolean),
        schedule: shuttleForm.schedule || null, nextDeparture: shuttleForm.nextDeparture || null,
        frequency: shuttleForm.frequency || null,
        assignedVehicle: shuttleForm.assignedVehicle || null, driverId: shuttleForm.driverId || null,
        capacity: shuttleForm.capacity, currentOccupancy: shuttleForm.currentOccupancy,
        status: shuttleForm.status, department: shuttleForm.department || null,
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Shuttle updated' : 'Shuttle created', 'success', 'Transportation');
      setShuttleModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleBoardingSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/shuttles-trips/boarding/${editingId}` : '/api/transport/shuttles-trips/boarding';
      const body = {
        propertyId: currentPropertyId,
        shuttleId: boardingForm.shuttleId,
        guestId: boardingForm.guestId || null,
        guestName: boardingForm.guestName,
        room: boardingForm.room || null,
        pickup: boardingForm.pickup,
        destination: boardingForm.destination,
        scheduledTime: boardingForm.scheduledTime ? new Date(boardingForm.scheduledTime).toISOString() : null,
        status: boardingForm.status,
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Boarding updated' : 'Passenger added', 'success', 'Transportation');
      setBoardingModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleBoardingStatus = async (b: Boarding, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/shuttles-trips/boarding/${b.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`${b.guest_name}: ${status}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (kind: 'shuttles' | 'boarding', id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/shuttles-trips/${kind}/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Shuttle Management" subtitle="Scheduled routes and shuttle operations" icon={Bus} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Bus className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view shuttles.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Shuttle Management"
        subtitle="Scheduled routes and shuttle operations"
        icon={Bus}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openBoardingCreate} className={button.secondary}><UserCheck className="w-4 h-4" /> Add Passenger</button>
            <button onClick={openShuttleCreate} className={button.primary}><Plus className="w-4 h-4" /> New Shuttle Route</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Routes" value={String(stats.active)} icon={Bus} tone="accent" />
        <StatCard title="On Schedule" value={stats.nextDeparture !== '—' ? 'Yes' : '—'} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Passengers" value={String(stats.passengers)} icon={Users} tone="info" />
        <StatCard title="Next Departure" value={stats.nextDeparture} icon={Clock} tone="warning" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by name, route, or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {SHUTTLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shuttle Routes */}
        <SectionCard title="Shuttle Routes" subtitle="Guest-facing scheduled routes" icon={Bus} tone="accent" pad="none">
          <div className="p-5 space-y-4">
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
              : filteredShuttles.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No shuttle routes found.</p>
              : filteredShuttles.map((s) => (
                <div key={s.id} className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700/50">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500">{s.shuttle_number || 'SH—'}</span>
                        <Badge tone={shuttleTone(s.status)}>{s.status}</Badge>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{s.name}</p>
                      <p className="text-xs text-slate-500">{s.type}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.next_departure || 'N/A'}</p>
                      <p className="text-xs text-slate-500">Next departure</p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Route className="w-4 h-4" />
                      <span>{s.route}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400 mb-3">
                    <div className="flex items-center gap-2"><Bus className="w-3.5 h-3.5" />{s.assigned_vehicle || 'No vehicle'}</div>
                    <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5" />{s.transport_drivers?.employees?.name || 'No driver'}</div>
                    <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5" />{s.schedule || '—'}</div>
                    <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{(s.stops || []).length} stops</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                        <div className={`h-2 rounded-full ${occupancyBar(s.current_occupancy, s.capacity)}`} style={{ width: `${s.capacity ? Math.min(100, (s.current_occupancy / s.capacity) * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{s.current_occupancy}/{s.capacity}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setViewing(s)} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                      <button onClick={() => openShuttleEdit(s)} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => handleDelete('shuttles', s.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>

        {/* Boarding List */}
        <SectionCard title="Upcoming Boarding" subtitle="Guest shuttle boarding list" icon={UserCheck} tone="info" pad="none">
          <div className="p-5 space-y-3">
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
              : boarding.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No upcoming boarding.</p>
              : boarding.map((b) => (
                <div key={b.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700/50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{b.guest_name}</p>
                        {b.room && <span className="text-xs text-slate-500">Room {b.room}</span>}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{b.pickup}</div>
                        <div className="flex items-center gap-1"><Route className="w-3 h-3" />{b.destination}</div>
                        <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(b.scheduled_time)}</div>
                        <div className="flex items-center gap-1"><Bus className="w-3 h-3" />{b.transport_shuttles?.shuttle_number || b.transport_shuttles?.name || '—'}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone={boardingTone(b.status)}>{b.status}</Badge>
                      <div className="flex gap-1">
                        {(b.status === 'Confirmed' || b.status === 'Waiting') && (
                          <button onClick={() => handleBoardingStatus(b, 'Checked In')} disabled={saving} title="Check in" className="p-1 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition"><LogIn size={13} className="text-emerald-500" /></button>
                        )}
                        {b.status === 'Checked In' && (
                          <button onClick={() => handleBoardingStatus(b, 'Boarded')} disabled={saving} title="Mark boarded" className="p-1 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition"><CheckCircle2 size={13} className="text-emerald-500" /></button>
                        )}
                        <button onClick={() => handleDelete('boarding', b.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={13} className="text-rose-400" /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      </div>

      {/* Shuttle Create / Edit Modal */}
      <ModalSystem
        isOpen={shuttleModal}
        onClose={() => setShuttleModal(false)}
        onConfirm={handleShuttleSave}
        title={editingId ? 'Edit Shuttle Route' : 'New Shuttle Route'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input className={inputCls} value={shuttleForm.name} onChange={(e) => setShuttleForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={shuttleForm.type} onChange={(e) => setShuttleForm(f => ({ ...f, type: e.target.value }))}>
              {SHUTTLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="col-span-2"><Field label="Route"><input className={inputCls} value={shuttleForm.route} onChange={(e) => setShuttleForm(f => ({ ...f, route: e.target.value }))} placeholder="Hotel ↔ Destination" /></Field></div>
          <div className="col-span-2"><Field label="Stops (comma separated)"><input className={inputCls} value={shuttleForm.stops} onChange={(e) => setShuttleForm(f => ({ ...f, stops: e.target.value }))} /></Field></div>
          <Field label="Schedule"><input className={inputCls} value={shuttleForm.schedule} onChange={(e) => setShuttleForm(f => ({ ...f, schedule: e.target.value }))} placeholder="e.g. Every 2 hours" /></Field>
          <Field label="Next Departure"><input className={inputCls} value={shuttleForm.nextDeparture} onChange={(e) => setShuttleForm(f => ({ ...f, nextDeparture: e.target.value }))} placeholder="e.g. 14:00" /></Field>
          <Field label="Frequency">
            <select className={inputCls} value={shuttleForm.frequency} onChange={(e) => setShuttleForm(f => ({ ...f, frequency: e.target.value }))}>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={shuttleForm.status} onChange={(e) => setShuttleForm(f => ({ ...f, status: e.target.value }))}>
              {SHUTTLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Vehicle"><input className={inputCls} value={shuttleForm.assignedVehicle} onChange={(e) => setShuttleForm(f => ({ ...f, assignedVehicle: e.target.value }))} placeholder="e.g. VH-020" /></Field>
          <Field label="Driver">
            <select className={inputCls} value={shuttleForm.driverId} onChange={(e) => {
              const d = drivers.find((x) => x.id === e.target.value);
              setShuttleForm(f => ({ ...f, driverId: e.target.value, assignedVehicle: d?.assigned_vehicle || f.assignedVehicle }));
            }}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Capacity"><input type="number" min={0} className={inputCls} value={shuttleForm.capacity} onChange={(e) => setShuttleForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></Field>
          <Field label="Current Occupancy"><input type="number" min={0} className={inputCls} value={shuttleForm.currentOccupancy} onChange={(e) => setShuttleForm(f => ({ ...f, currentOccupancy: Number(e.target.value) }))} /></Field>
          <div className="col-span-2"><Field label="Department"><input className={inputCls} value={shuttleForm.department} onChange={(e) => setShuttleForm(f => ({ ...f, department: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>

      {/* Boarding Create / Edit Modal */}
      <ModalSystem
        isOpen={boardingModal}
        onClose={() => setBoardingModal(false)}
        onConfirm={handleBoardingSave}
        title="Add Passenger to Shuttle"
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Shuttle">
            <select className={inputCls} value={boardingForm.shuttleId} onChange={(e) => setBoardingForm(f => ({ ...f, shuttleId: e.target.value }))}>
              <option value="">Select shuttle…</option>
              {shuttles.map((s) => <option key={s.id} value={s.id}>{s.shuttle_number ? `${s.shuttle_number} — ` : ''}{s.name}</option>)}
            </select>
          </Field>
          <Field label="Guest">
            <input className={inputCls} list="sm-guest-list" value={boardingForm.guestName} onChange={(e) => {
              const match = guests.find((g) => g.name === e.target.value);
              setBoardingForm(f => ({ ...f, guestName: e.target.value, guestId: match ? match.id : '' }));
            }} placeholder="Guest name…" />
            <datalist id="sm-guest-list">
              {guests.map((g) => <option key={g.id} value={g.name} />)}
            </datalist>
          </Field>
          <Field label="Room"><input className={inputCls} value={boardingForm.room} onChange={(e) => setBoardingForm(f => ({ ...f, room: e.target.value }))} /></Field>
          <Field label="Scheduled"><input type="datetime-local" className={inputCls} value={boardingForm.scheduledTime} onChange={(e) => setBoardingForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Pickup"><input className={inputCls} value={boardingForm.pickup} onChange={(e) => setBoardingForm(f => ({ ...f, pickup: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={boardingForm.destination} onChange={(e) => setBoardingForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={boardingForm.status} onChange={(e) => setBoardingForm(f => ({ ...f, status: e.target.value }))}>
              {BOARDING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* Shuttle Detail Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.shuttle_number || 'Shuttle'} — ${viewing.name}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.name}</p>
                <p className="text-xs text-slate-500">{viewing.type} • {viewing.frequency || '—'}</p>
              </div>
              <Badge tone={shuttleTone(viewing.status)}>{viewing.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Route size={14} />{viewing.route}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Clock size={14} />{viewing.schedule || '—'} {viewing.next_departure ? `• next ${viewing.next_departure}` : ''}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Bus size={14} />{viewing.assigned_vehicle || 'No vehicle'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.transport_drivers?.employees?.name || 'No driver'} • {viewing.current_occupancy}/{viewing.capacity}</div>
            </div>
            {(viewing.stops || []).length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Stops</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.stops.map((stop, i) => (
                    <span key={i} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-300">{stop}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => { setViewing(null); openShuttleEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default ShuttleManagement;
