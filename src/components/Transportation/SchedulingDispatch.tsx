/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scheduling & Dispatch — resource planning and trip scheduling.
 * DB-integrated via /api/transport/schedule/* (transport_schedule_items).
 * Conflicts are derived live from overlapping driver/vehicle assignments.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Calendar,
  Clock,
  Users,
  Search,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface ScheduleItem {
  id: string;
  schedule_number: string;
  scheduled_time: string;
  duration_minutes: number;
  driver_id: string | null;
  assigned_vehicle: string | null;
  type: string;
  route: string | null;
  status: string;
  passenger_count: number;
  transport_drivers: { id: string; assigned_vehicle: string | null; employees: { name: string; phone: string | null } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  status: string;
  employees: { name: string } | null;
}

interface Vehicle {
  id: string;
  vehicle_number: string;
  status: string;
}

interface Conflict {
  type: string;
  description: string;
  severity: 'High' | 'Medium';
  affected: string;
}

const SCHEDULE_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Unassigned', 'Cancelled'];
const SCHEDULE_TYPES = ['Airport Pickup', 'City Transfer', 'Corporate Transfer', 'Staff Shuttle', 'VIP Transfer', 'Tour Transportation', 'Conference Shuttle', 'Shopping Trip', 'Other'];

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
    case 'In Progress': return 'info';
    case 'Scheduled': return 'accent';
    case 'Unassigned': return 'warning';
    case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

function severityTone(severity: string): StatusTone {
  return severity === 'High' ? 'danger' : 'warning';
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

function rangeFor(date: string, mode: 'day' | 'week' | 'month'): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00`);
  const from = new Date(d);
  const to = new Date(d);
  if (mode === 'day') {
    to.setDate(to.getDate() + 1);
  } else if (mode === 'week') {
    from.setDate(from.getDate() - from.getDay());
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 7);
  } else {
    from.setDate(1);
    to.setMonth(to.getMonth() + 1);
    to.setDate(1);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function overlaps(a: ScheduleItem, b: ScheduleItem): boolean {
  const aStart = new Date(a.scheduled_time).getTime();
  const aEnd = aStart + a.duration_minutes * 60000;
  const bStart = new Date(b.scheduled_time).getTime();
  const bEnd = bStart + b.duration_minutes * 60000;
  return aStart < bEnd && bStart < aEnd;
}

const emptyForm = {
  scheduledTime: '', durationMinutes: 30, driverId: '', assignedVehicle: '',
  type: 'City Transfer', route: '', status: 'Scheduled', passengerCount: 1,
};

const SchedulingDispatch = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const { from, to } = rangeFor(selectedDate, viewMode);
      const [iRes, dRes, vRes] = await Promise.all([
        fetch(`/api/transport/schedule/${currentPropertyId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (iRes.ok) setItems(((await iRes.json()) as { items: ScheduleItem[] }).items || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (vRes.ok) setVehicles(((await vRes.json()) as { vehicles: Vehicle[] }).vehicles || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId, selectedDate, viewMode]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = items;
    if (typeFilter !== 'all') list = list.filter((i) => i.type === typeFilter);
    return list;
  }, [items, typeFilter]);

  const conflicts = useMemo(() => {
    const found: Conflict[] = [];
    const active = filtered.filter((i) => !['Cancelled', 'Completed'].includes(i.status));
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (!overlaps(a, b)) continue;
        if (a.driver_id && a.driver_id === b.driver_id) {
          const name = a.transport_drivers?.employees?.name || 'Driver';
          found.push({
            type: 'Driver Conflict',
            description: `${name} double-booked at ${formatTime(a.scheduled_time)} and ${formatTime(b.scheduled_time)}`,
            severity: 'High',
            affected: `${a.schedule_number}, ${b.schedule_number}`,
          });
        }
        if (a.assigned_vehicle && a.assigned_vehicle === b.assigned_vehicle) {
          found.push({
            type: 'Vehicle Conflict',
            description: `${a.assigned_vehicle} assigned to two trips overlapping at ${formatTime(a.scheduled_time)}`,
            severity: 'High',
            affected: `${a.schedule_number}, ${b.schedule_number}`,
          });
        }
      }
    }
    return found;
  }, [filtered]);

  const stats = useMemo(() => ({
    total: filtered.length,
    unassigned: filtered.filter((i) => i.status === 'Unassigned').length,
    inProgress: filtered.filter((i) => i.status === 'In Progress').length,
    conflicts: conflicts.length,
  }), [filtered, conflicts]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, scheduledTime: `${selectedDate}T12:00` });
    setShowModal(true);
  };

  const openEdit = (i: ScheduleItem) => {
    setEditingId(i.id);
    setForm({
      scheduledTime: toLocalInput(i.scheduled_time),
      durationMinutes: i.duration_minutes,
      driverId: i.driver_id || '',
      assignedVehicle: i.assigned_vehicle || '',
      type: i.type,
      route: i.route || '',
      status: i.status,
      passengerCount: i.passenger_count,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/schedule/${editingId}` : '/api/transport/schedule/';
      const body = {
        propertyId: currentPropertyId,
        scheduledTime: form.scheduledTime ? new Date(form.scheduledTime).toISOString() : null,
        durationMinutes: form.durationMinutes,
        driverId: form.driverId || null,
        assignedVehicle: form.assignedVehicle || null,
        type: form.type,
        route: form.route || null,
        status: form.driverId && form.status === 'Unassigned' ? 'Scheduled' : form.status,
        passengerCount: form.passengerCount,
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Schedule item updated' : 'Schedule item created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleAutoSchedule = async () => {
    const unassigned = filtered.filter((i) => i.status === 'Unassigned');
    if (unassigned.length === 0) {
      addNotification('No unassigned items to schedule', 'info', 'Transportation');
      return;
    }
    setSaving(true);
    try {
      const { from, to } = rangeFor(selectedDate, viewMode);
      const res = await fetch('/api/transport/schedule/auto-assign', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, from, to }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      const { assigned } = (await res.json()) as { assigned: ScheduleItem[]; skipped: string[] };
      addNotification(assigned.length > 0 ? `Auto-scheduled ${assigned.length} item(s)` : 'No free drivers for unassigned items', assigned.length > 0 ? 'success' : 'warning', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Auto-schedule failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (i: ScheduleItem, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/schedule/${i.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Item ${status.toLowerCase()}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this schedule item?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/schedule/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Schedule item deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Scheduling & Dispatch" subtitle="Resource planning and trip scheduling" icon={Calendar} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Calendar className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view the schedule.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Scheduling & Dispatch"
        subtitle="Resource planning and trip scheduling"
        icon={Calendar}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={handleAutoSchedule} disabled={saving} className={button.secondary}><Wand2 className="w-4 h-4" /> Auto-Schedule</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Schedule</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Scheduled Items" value={String(stats.total)} icon={Calendar} tone="accent" />
        <StatCard title="In Progress" value={String(stats.inProgress)} icon={Clock} tone="info" />
        <StatCard title="Unassigned" value={String(stats.unassigned)} icon={UserCheck} tone="warning" />
        <StatCard title="Conflicts" value={String(stats.conflicts)} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Date and View Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className={filterSelectCls} />
        </div>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
          {(['day', 'week', 'month'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${viewMode === m ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500'}`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans">
            <option value="all">All Types</option>
            {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Conflicts Alert — derived from live data */}
      {conflicts.length > 0 && (
        <div className="bg-rose-50 dark:bg-rose-900/20 rounded-xl p-4 border border-rose-200 dark:border-rose-800">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            <h3 className="font-semibold text-rose-900 dark:text-rose-100">Scheduling Conflicts Detected</h3>
          </div>
          <div className="space-y-2">
            {conflicts.map((c, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={severityTone(c.severity)}>{c.severity}</Badge>
                    <span className="font-medium text-slate-900 dark:text-white">{c.type}</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{c.description}</p>
                  <p className="text-xs text-slate-500 mt-1">Affected: {c.affected}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule Grid */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Schedule</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Calendar className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No schedule items in this range.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 w-40">Time</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Route</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Driver</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Vehicle</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Duration</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Pax</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white block">{formatTime(item.scheduled_time)}</span>
                          <span className="text-xs text-slate-400">{item.schedule_number}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{item.type}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate">{item.route || '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      {item.transport_drivers?.employees?.name
                        ? <span className="text-slate-900 dark:text-white">{item.transport_drivers.employees.name}</span>
                        : <span className="text-amber-600 dark:text-amber-400">Unassigned</span>}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {item.assigned_vehicle
                        ? <span className="text-slate-900 dark:text-white">{item.assigned_vehicle}</span>
                        : <span className="text-amber-600 dark:text-amber-400">Unassigned</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{item.duration_minutes} min</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Users size={12} />{item.passenger_count}</div>
                    </td>
                    <td className="px-6 py-4"><Badge tone={statusTone(item.status)}>{item.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-1">
                        {item.status === 'Scheduled' && <button onClick={() => handleStatusChange(item, 'In Progress')} disabled={saving} title="Start" className="p-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition"><CheckCircle2 size={14} className="text-emerald-500" /></button>}
                        {item.status === 'In Progress' && <button onClick={() => handleStatusChange(item, 'Completed')} disabled={saving} title="Complete" className="p-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition"><CheckCircle2 size={14} className="text-emerald-500" /></button>}
                        <button onClick={() => openEdit(item)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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
        title={editingId ? 'Edit Schedule Item' : 'New Schedule Item'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Scheduled"><input type="datetime-local" className={inputCls} value={form.scheduledTime} onChange={(e) => setForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Duration (min)"><input type="number" min={5} className={inputCls} value={form.durationMinutes} onChange={(e) => setForm(f => ({ ...f, durationMinutes: Number(e.target.value) }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {SCHEDULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Route"><input className={inputCls} value={form.route} onChange={(e) => setForm(f => ({ ...f, route: e.target.value }))} placeholder="e.g. Hotel to JFK Airport" /></Field>
          <Field label="Driver">
            <select className={inputCls} value={form.driverId} onChange={(e) => {
              const d = drivers.find((x) => x.id === e.target.value);
              setForm(f => ({ ...f, driverId: e.target.value, assignedVehicle: d?.assigned_vehicle || f.assignedVehicle }));
            }}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Vehicle">
            <select className={inputCls} value={form.assignedVehicle} onChange={(e) => setForm(f => ({ ...f, assignedVehicle: e.target.value }))}>
              <option value="">Unassigned</option>
              {vehicles.map((v) => <option key={v.id} value={v.vehicle_number}>{v.vehicle_number}</option>)}
              {form.assignedVehicle && !vehicles.some((v) => v.vehicle_number === form.assignedVehicle) && (
                <option value={form.assignedVehicle}>{form.assignedVehicle}</option>
              )}
            </select>
          </Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={form.passengerCount} onChange={(e) => setForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {SCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default SchedulingDispatch;
