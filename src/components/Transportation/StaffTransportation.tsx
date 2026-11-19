/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Staff Transportation — links trips to shared HR employees and drivers.
 * DB-integrated via /api/transport/shuttles-trips/*.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users,
  Search,
  Calendar,
  MapPin,
  Clock,
  Bus,
  Plus,
  Eye,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout } from '../FrontOffice/brandTheme';

interface Driver {
  id: string;
  employees: { name: string };
}

interface Employee {
  id: string;
  name: string;
  department: string;
}

interface Shuttle {
  id: string;
  name: string;
  type: string;
  route: string;
  stops: string[];
  schedule: string;
  assigned_vehicle: string;
  transport_drivers: { id: string; employees: { name: string } } | null;
  capacity: number;
  current_occupancy: number;
  status: string;
  department: string | null;
}

interface Trip {
  id: string;
  employee_id: string;
  employees: { name: string; department: string };
  type: string;
  pickup: string;
  destination: string;
  scheduled_at: string;
  actual_at: string | null;
  vehicle: string;
  transport_drivers: { id: string; employees: { name: string } } | null;
  status: string;
  shift: string;
}

const TRIP_TYPES = ['Staff Pickup', 'Staff Drop-off', 'Shift Transportation'];
const TRIP_STATUS = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const SHUTTLE_STATUS = ['Active', 'Scheduled', 'Completed', 'Cancelled'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function occupancyColor(occupancy: number, capacity: number) {
  if (capacity === 0) return 'bg-emerald-500';
  const pct = (occupancy / capacity) * 100;
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function parseTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const StaffTransportation = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'shuttle' | 'trip' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [shuttleForm, setShuttleForm] = useState({
    name: '', type: 'Staff Shuttle', route: '', stops: '', schedule: '', assignedVehicle: '',
    driverId: '', capacity: 20, currentOccupancy: 0, status: 'Active', department: 'All Departments',
  });
  const [tripForm, setTripForm] = useState({
    employeeId: '', type: 'Staff Pickup', pickup: '', destination: '',
    scheduledAt: '', actualAt: '', vehicle: '', driverId: '', status: 'Scheduled', shift: 'Morning',
  });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [stRes, drvRes, empRes] = await Promise.all([
        fetch(`/api/transport/shuttles-trips/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/hr-portal/employees/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (stRes.ok) {
        const data = (await stRes.json()) as { shuttles: Shuttle[]; trips: Trip[] };
        setShuttles(data.shuttles || []);
        setTrips(data.trips || []);
      }
      if (drvRes.ok) setDrivers(((await drvRes.json()) as { drivers: Driver[] }).drivers || []);
      if (empRes.ok) setEmployees(((await empRes.json()) as { employees: Employee[] }).employees || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filteredTrips = useMemo(() => {
    let list = trips;
    if (typeFilter !== 'all') list = list.filter((t) => t.type === typeFilter);
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((t) =>
      (t.employees?.name || '').toLowerCase().includes(q) ||
      t.employee_id.toLowerCase().includes(q) ||
      t.employees?.department?.toLowerCase().includes(q) ||
      t.vehicle?.toLowerCase().includes(q) ||
      (t.transport_drivers?.employees.name || '').toLowerCase().includes(q)
    );
  }, [trips, search, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    const activeRoutes = shuttles.filter((s) => s.status === 'Active').length;
    const staffTransported = shuttles.reduce((sum, s) => sum + (s.current_occupancy || 0), 0);
    const completedTrips = trips.filter((t) => t.status === 'Completed').length;
    const onTime = completedTrips > 0 ? Math.round((completedTrips / trips.length) * 100) : 0;
    const depts = new Set(trips.map((t) => t.employees?.department).filter(Boolean));
    return { activeRoutes, staffTransported, onTime, depts: depts.size };
  }, [shuttles, trips]);

  const openShuttleCreate = () => {
    setModalType('shuttle'); setEditingId(null);
    setShuttleForm({ name: '', type: 'Staff Shuttle', route: '', stops: '', schedule: '', assignedVehicle: '', driverId: '', capacity: 20, currentOccupancy: 0, status: 'Active', department: 'All Departments' });
    setShowModal(true);
  };

  const openTripCreate = () => {
    setModalType('trip'); setEditingId(null);
    setTripForm({ employeeId: '', type: 'Staff Pickup', pickup: '', destination: '', scheduledAt: '', actualAt: '', vehicle: '', driverId: '', status: 'Scheduled', shift: 'Morning' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      if (modalType === 'shuttle') {
        const endpoint = editingId ? `/api/transport/shuttles-trips/shuttles/${editingId}` : '/api/transport/shuttles-trips/shuttles';
        const method = editingId ? 'PUT' : 'POST';
        const body = {
          propertyId: currentPropertyId,
          name: shuttleForm.name, type: shuttleForm.type, route: shuttleForm.route,
          stops: shuttleForm.stops.split(',').map((s) => s.trim()).filter(Boolean),
          schedule: shuttleForm.schedule, assignedVehicle: shuttleForm.assignedVehicle,
          driverId: shuttleForm.driverId, capacity: shuttleForm.capacity,
          currentOccupancy: shuttleForm.currentOccupancy, status: shuttleForm.status, department: shuttleForm.department,
        };
        const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      } else {
        const endpoint = editingId ? `/api/transport/shuttles-trips/trips/${editingId}` : '/api/transport/shuttles-trips/trips';
        const method = editingId ? 'PUT' : 'POST';
        const body = {
          propertyId: currentPropertyId, employeeId: tripForm.employeeId, type: tripForm.type,
          pickup: tripForm.pickup, destination: tripForm.destination,
          scheduledAt: tripForm.scheduledAt, actualAt: tripForm.actualAt || null,
          vehicle: tripForm.vehicle, driverId: tripForm.driverId,
          status: tripForm.status, shift: tripForm.shift,
        };
        const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      }
      addNotification('Saved', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (kind: 'shuttles' | 'trips', id: string) => {
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
        <PageHeader title="Staff Transportation" subtitle="Employee shuttle and shift transportation" icon={Bus} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Bus className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view transport.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Staff Transportation"
        subtitle="Employee shuttle and shift transportation — linked to HR employees and drivers"
        icon={Bus}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openTripCreate} className={button.secondary}><Plus className="w-4 h-4" /> New Trip</button>
            <button onClick={openShuttleCreate} className={button.primary}><Plus className="w-4 h-4" /> New Shuttle</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Routes" value={String(stats.activeRoutes)} icon={Bus} tone="accent" />
        <StatCard title="Staff Transported" value={String(stats.staffTransported)} icon={UserCheck} tone="success" />
        <StatCard title="On-Time Rate" value={`${stats.onTime}%`} icon={Clock} tone="warning" />
        <StatCard title="Departments Served" value={String(stats.depts)} icon={Users} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search trips..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inputCls}>
          <option value="all">All Types</option>
          {TRIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
          <option value="all">All Status</option>
          {TRIP_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Shuttles */}
          <SectionCard title="Staff Shuttle Routes" subtitle="Per-route capacity and driver" icon={Bus} tone="accent">
            <div className="space-y-4 p-6">
              {shuttles.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No shuttles.</p> : shuttles.map((s) => (
                <div key={s.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2"><span className="font-medium text-slate-900 dark:text-white">{s.name}</span><Badge tone={s.status === 'Active' ? 'success' : 'info'}>{s.status}</Badge></div>
                      <p className="text-xs text-slate-500">{s.type} • {s.department}</p>
                    </div>
                    <div className="text-right"><span className="text-sm font-medium text-slate-900 dark:text-white">{s.schedule}</span><p className="text-xs text-slate-500">Schedule</p></div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-3"><MapPin size={14} /><span>{s.route}</span></div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3 text-slate-500">
                    <div className="flex items-center gap-2"><Bus size={14} />{s.assigned_vehicle || '—'}</div>
                    <div className="flex items-center gap-2"><Users size={14} />{s.transport_drivers?.employees.name || '—'}</div>
                    <div className="col-span-2 flex items-center gap-2"><UserCheck size={14} />{s.stops.join(', ')}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={`h-full ${occupancyColor(s.current_occupancy, s.capacity)}`} style={{ width: s.capacity ? `${(s.current_occupancy / s.capacity) * 100}%` : '0%' }} /></div>
                      <span className="text-xs text-slate-500">{s.current_occupancy}/{s.capacity}</span>
                    </div>
                    <button onClick={() => handleDelete('shuttles', s.id)} className="p-1 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Trips */}
          <SectionCard title="Staff Trips" subtitle="Recent pickup, drop-off and shift trips" icon={MapPin} tone="accent">
            <div className="space-y-3 p-6">
              {filteredTrips.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No trips.</p> : filteredTrips.map((t) => (
                <div key={t.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="font-medium text-slate-900 dark:text-white">{t.employees?.name || '—'}</span><Badge tone={t.status === 'Completed' ? 'success' : t.status === 'Cancelled' ? 'danger' : 'info'}>{t.status}</Badge></div>
                      <p className="text-xs text-slate-500">{t.employee_id} • {t.employees?.department || '—'}</p>
                    </div>
                    <div className="text-right"><span className="text-sm font-medium text-slate-900 dark:text-white">{t.shift}</span><p className="text-xs text-slate-500">{t.type}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div className="flex items-center gap-1"><MapPin size={12} />{t.pickup} → {t.destination}</div>
                    <div className="flex items-center gap-1"><Clock size={12} />{parseTime(t.scheduled_at)} / {parseTime(t.actual_at)}</div>
                    <div className="flex items-center gap-1"><Bus size={12} />{t.vehicle || '—'}</div>
                    <div className="flex items-center gap-1"><Users size={12} />{t.transport_drivers?.employees.name || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={modalType === 'shuttle' ? (editingId ? 'Edit Shuttle' : 'New Shuttle') : (editingId ? 'Edit Trip' : 'New Trip')}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        {modalType === 'shuttle' ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={shuttleForm.name} onChange={(e) => setShuttleForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Type"><input className={inputCls} value={shuttleForm.type} onChange={(e) => setShuttleForm(f => ({ ...f, type: e.target.value }))} /></Field>
            <div className="col-span-2"><Field label="Route"><input className={inputCls} value={shuttleForm.route} onChange={(e) => setShuttleForm(f => ({ ...f, route: e.target.value }))} /></Field></div>
            <Field label="Stops (comma separated)"><input className={inputCls} value={shuttleForm.stops} onChange={(e) => setShuttleForm(f => ({ ...f, stops: e.target.value }))} /></Field>
            <Field label="Schedule"><input className={inputCls} value={shuttleForm.schedule} onChange={(e) => setShuttleForm(f => ({ ...f, schedule: e.target.value }))} /></Field>
            <Field label="Vehicle"><input className={inputCls} value={shuttleForm.assignedVehicle} onChange={(e) => setShuttleForm(f => ({ ...f, assignedVehicle: e.target.value }))} /></Field>
            <Field label="Driver">
              <select className={inputCls} value={shuttleForm.driverId} onChange={(e) => setShuttleForm(f => ({ ...f, driverId: e.target.value }))}>
                <option value="">Select driver…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees.name}</option>)}
              </select>
            </Field>
            <Field label="Capacity"><input type="number" className={inputCls} value={shuttleForm.capacity} onChange={(e) => setShuttleForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></Field>
            <Field label="Current Occupancy"><input type="number" className={inputCls} value={shuttleForm.currentOccupancy} onChange={(e) => setShuttleForm(f => ({ ...f, currentOccupancy: Number(e.target.value) }))} /></Field>
            <Field label="Status">
              <select className={inputCls} value={shuttleForm.status} onChange={(e) => setShuttleForm(f => ({ ...f, status: e.target.value }))}>
                {SHUTTLE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Department"><input className={inputCls} value={shuttleForm.department} onChange={(e) => setShuttleForm(f => ({ ...f, department: e.target.value }))} /></Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Field label="Employee">
              <select className={inputCls} value={tripForm.employeeId} onChange={(e) => setTripForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
              </select>
            </Field></div>
            <Field label="Type">
              <select className={inputCls} value={tripForm.type} onChange={(e) => setTripForm(f => ({ ...f, type: e.target.value }))}>
                {TRIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select className={inputCls} value={tripForm.shift} onChange={(e) => setTripForm(f => ({ ...f, shift: e.target.value }))}>
                {['Morning', 'Afternoon', 'Evening', 'Night'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Pickup"><input className={inputCls} value={tripForm.pickup} onChange={(e) => setTripForm(f => ({ ...f, pickup: e.target.value }))} /></Field>
            <Field label="Destination"><input className={inputCls} value={tripForm.destination} onChange={(e) => setTripForm(f => ({ ...f, destination: e.target.value }))} /></Field>
            <Field label="Scheduled At"><input type="datetime-local" className={inputCls} value={tripForm.scheduledAt} onChange={(e) => setTripForm(f => ({ ...f, scheduledAt: e.target.value }))} /></Field>
            <Field label="Actual At"><input type="datetime-local" className={inputCls} value={tripForm.actualAt} onChange={(e) => setTripForm(f => ({ ...f, actualAt: e.target.value }))} /></Field>
            <Field label="Vehicle"><input className={inputCls} value={tripForm.vehicle} onChange={(e) => setTripForm(f => ({ ...f, vehicle: e.target.value }))} /></Field>
            <Field label="Driver">
              <select className={inputCls} value={tripForm.driverId} onChange={(e) => setTripForm(f => ({ ...f, driverId: e.target.value }))}>
                <option value="">Select driver…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={tripForm.status} onChange={(e) => setTripForm(f => ({ ...f, status: e.target.value }))}>
                {TRIP_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default StaffTransportation;
