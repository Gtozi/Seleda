/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Driver Management — links to shared HR employees.
 * DB-integrated via /api/transport/drivers/* and /api/hr-portal/employees/*.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users,
  Search,
  Plus,
  Pencil,
  Trash2,
  Car,
  Phone,
  AlertTriangle,
  CheckCircle2,
  Award,
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
  employee_id: string;
  license_number: string;
  license_category: string | null;
  license_expiry: string | null;
  medical_certificate: string | null;
  certifications: string[];
  assigned_vehicle: string | null;
  shift: string | null;
  incidents: number;
  total_trips: number;
  performance: number;
  status: string;
  employees: {
    name: string;
    phone: string | null;
    email: string | null;
    hire_date: string | null;
    status: string;
  };
}

interface Employee {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
}

interface Incident {
  id: string;
  incident_number: string;
  driver_id: string | null;
  vehicle_id: string | null;
  trip_id: string | null;
  occurred_at: string;
  type: string;
  severity: string;
  location: string | null;
  description: string | null;
  status: string;
  reported_by: string | null;
  resolution_notes: string | null;
  transport_drivers: { id: string; employees: { name: string } | null } | null;
  transport_vehicles: { vehicle_number: string } | null;
  transport_requests: { request_number: string; guest_name: string | null } | null;
}

interface SafetyScore {
  driverId: string;
  name: string;
  incidentCount: number;
  safetyScore: number;
}

interface VehicleRef {
  id: string;
  vehicle_number: string;
}

const STATUS_OPTIONS = ['Active', 'On Leave', 'Suspended', 'Inactive'];
const SHIFT_OPTIONS = ['Morning', 'Afternoon', 'Night', 'Flexible', 'N/A'];
const INCIDENT_TYPES = ['Accident', 'Traffic Violation', 'Speeding', 'Breakdown', 'Passenger Complaint', 'Vehicle Damage', 'Other'];
const SEVERITIES = ['Minor', 'Moderate', 'Major', 'Critical'];
const INCIDENT_STATUSES = ['Reported', 'Under Review', 'Resolved', 'Closed'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';
const filterSelectCls = 'px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans w-auto';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function daysUntil(date: string): { text: string; color: string } {
  const today = new Date();
  const expiry = new Date(date + 'T00:00:00');
  const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: 'Expired', color: 'text-rose-600' };
  if (days <= 30) return { text: `${days} days`, color: 'text-amber-600' };
  return { text: `${days} days`, color: 'text-emerald-600' };
}

function performanceColor(score: number): string {
  if (score >= 95) return 'bg-emerald-500';
  if (score >= 85) return 'bg-blue-500';
  if (score >= 75) return 'bg-amber-500';
  return 'bg-rose-500';
}

function incidentTone(status: string) {
  switch (status) {
    case 'Resolved': case 'Closed': return 'success' as const;
    case 'Under Review': return 'info' as const;
    default: return 'warning' as const;
  }
}

function severityTone(sev: string) {
  switch (sev) {
    case 'Critical': return 'danger' as const;
    case 'Major': return 'danger' as const;
    case 'Moderate': return 'warning' as const;
    default: return 'neutral' as const;
  }
}

const emptyIncidentForm = {
  driverId: '', vehicleId: '', occurredAt: '', type: 'Other',
  severity: 'Minor', location: '', description: '',
};

const DriverManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('all');
  const [safetyScores, setSafetyScores] = useState<SafetyScore[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [incidentForm, setIncidentForm] = useState({ ...emptyIncidentForm });

  const [form, setForm] = useState({
    employeeId: '', licenseNumber: '', licenseCategory: '', licenseExpiry: '',
    medicalCertificate: '', certifications: '', assignedVehicle: '', shift: 'Morning',
    incidents: 0, totalTrips: 0, performance: 0, status: 'Active',
  });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [dRes, eRes, iRes, sRes, vRes] = await Promise.all([
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/hr-portal/employees/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/incidents/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/incidents/safety/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (eRes.ok) setEmployees(((await eRes.json()) as { employees: Employee[] }).employees || []);
      if (iRes.ok) setIncidents(((await iRes.json()) as { incidents: Incident[] }).incidents || []);
      if (sRes.ok) setSafetyScores(((await sRes.json()) as { scores: SafetyScore[] }).scores || []);
      if (vRes.ok) setVehicles(((await vRes.json()) as { vehicles: VehicleRef[] }).vehicles || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = drivers;
    if (statusFilter !== 'all') list = list.filter((d) => d.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((d) =>
      (d.employees?.name || '').toLowerCase().includes(q) ||
      d.license_number.toLowerCase().includes(q) ||
      (d.assigned_vehicle || '').toLowerCase().includes(q)
    );
  }, [drivers, search, statusFilter]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ employeeId: '', licenseNumber: '', licenseCategory: '', licenseExpiry: '', medicalCertificate: '', certifications: '', assignedVehicle: '', shift: 'Morning', incidents: 0, totalTrips: 0, performance: 0, status: 'Active' });
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    setEditingId(d.id);
    setForm({
      employeeId: d.employee_id,
      licenseNumber: d.license_number,
      licenseCategory: d.license_category || '',
      licenseExpiry: d.license_expiry || '',
      medicalCertificate: d.medical_certificate || '',
      certifications: (d.certifications || []).join(', '),
      assignedVehicle: d.assigned_vehicle || '',
      shift: d.shift || 'Morning',
      incidents: d.incidents,
      totalTrips: d.total_trips,
      performance: d.performance,
      status: d.status,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/drivers/${editingId}` : '/api/transport/drivers/';
      const method = editingId ? 'PUT' : 'POST';
      const body = {
        propertyId: currentPropertyId, employeeId: form.employeeId, licenseNumber: form.licenseNumber,
        licenseCategory: form.licenseCategory, licenseExpiry: form.licenseExpiry,
        medicalCertificate: form.medicalCertificate,
        certifications: form.certifications.split(',').map((s) => s.trim()).filter(Boolean),
        assignedVehicle: form.assignedVehicle, shift: form.shift,
        incidents: form.incidents, totalTrips: form.totalTrips, performance: form.performance, status: form.status,
      };
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this driver?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/drivers/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const safetyFor = (driverId: string) => safetyScores.find((s) => s.driverId === driverId);

  const openReportIncident = (driverId?: string) => {
    setIncidentForm({ ...emptyIncidentForm, driverId: driverId || '', occurredAt: new Date().toISOString().slice(0, 16) });
    setShowIncidentModal(true);
  };

  const handleSaveIncident = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/transport/incidents', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          driverId: incidentForm.driverId || null,
          vehicleId: incidentForm.vehicleId || null,
          occurredAt: incidentForm.occurredAt ? new Date(incidentForm.occurredAt).toISOString() : null,
          type: incidentForm.type,
          severity: incidentForm.severity,
          location: incidentForm.location || null,
          description: incidentForm.description || null,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Incident reported', 'success', 'Transportation');
      setShowIncidentModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleIncidentStatus = async (inc: Incident, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/incidents/${inc.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Incident ${status.toLowerCase()}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeleteIncident = async (id: string) => {
    if (!confirm('Delete this incident?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/incidents/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Incident deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const stats = useMemo(() => {
    const total = drivers.length;
    const active = drivers.filter((d) => d.status === 'Active').length;
    const expiring = drivers.filter((d) => d.license_expiry && daysUntil(d.license_expiry).color === 'text-amber-600').length;
    const avg = drivers.length ? Math.round(drivers.reduce((s, d) => s + d.performance, 0) / drivers.length) : 0;
    return { total, active, expiring, avg };
  }, [drivers]);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Driver Management" subtitle="Driver profiles, scheduling, and performance" icon={Car} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view drivers.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Driver Management"
        subtitle="Driver profiles, scheduling, and performance — linked to HR employees"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openReportIncident()} className={button.secondary}><AlertTriangle className="w-4 h-4" /> Report Incident</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> Add Driver</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Drivers" value={String(stats.total)} icon={Users} tone="accent" />
        <StatCard title="Active" value={String(stats.active)} icon={CheckCircle2} tone="success" />
        <StatCard title="License Expiring" value={String(stats.expiring)} icon={AlertTriangle} tone="warning" />
        <StatCard title="Avg Performance" value={`${stats.avg}%`} icon={Award} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by name, license, or vehicle..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
          <option value="all">All Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Drivers</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No drivers found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Driver ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Name</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">License</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Assigned Vehicle</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Shift</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Performance</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Safety</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Total Trips</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((d) => {
                  const licenseStatus = d.license_expiry ? daysUntil(d.license_expiry) : { text: '—', color: 'text-slate-400' };
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{d.license_number}</td>
                      <td className="px-6 py-4">
                        <div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white block">{d.employees?.name || '—'}</span>
                          <span className="text-xs text-slate-400">{d.employees?.email || '—'}</span>
                          <div className="flex items-center gap-1 mt-1"><Phone size={10} className="text-slate-400" /><span className="text-xs text-slate-500">{d.employees?.phone || '—'}</span></div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {licenseStatus.color.includes('rose') ? <AlertTriangle size={14} className={licenseStatus.color} /> : <CheckCircle2 size={14} className={licenseStatus.color} />}
                          <div>
                            <span className="text-sm text-slate-900 dark:text-white block">{d.license_number}</span>
                            <span className={`text-xs ${licenseStatus.color}`}>{d.license_category || '—'} • {licenseStatus.text}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{d.assigned_vehicle || <span className="text-slate-400">Unassigned</span>}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{d.shift || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={`h-full ${performanceColor(d.performance)}`} style={{ width: `${Math.min(d.performance, 100)}%` }} /></div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white">{d.performance}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const s = safetyFor(d.id);
                          if (!s) return <span className="text-sm text-slate-400">—</span>;
                          const tone = s.safetyScore >= 90 ? 'text-emerald-600' : s.safetyScore >= 75 ? 'text-amber-600' : 'text-rose-600';
                          return (
                            <span className={`text-sm font-semibold ${tone}`} title={`${s.incidentCount} incident(s)`}>
                              {s.safetyScore}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{d.total_trips.toLocaleString()}</td>
                      <td className="px-6 py-4"><Badge tone={d.status === 'Active' ? 'success' : d.status === 'On Leave' ? 'warning' : 'danger'}>{d.status}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit(d)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => handleDelete(d.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Incidents */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Incident Log</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{incidents.filter((i) => ['Reported', 'Under Review'].includes(i.status)).length} open</span>
            <select className={filterSelectCls} value={incidentStatusFilter} onChange={(e) => setIncidentStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto">
          {(incidentStatusFilter === 'all' ? incidents : incidents.filter((i) => i.status === incidentStatusFilter)).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400"><AlertTriangle className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No incidents recorded.</p></div>
          ) : (incidentStatusFilter === 'all' ? incidents : incidents.filter((i) => i.status === incidentStatusFilter)).map((inc) => (
            <div key={inc.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 group">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 dark:text-white">{inc.incident_number}</span>
                    <Badge tone={severityTone(inc.severity)}>{inc.severity}</Badge>
                    <Badge tone={incidentTone(inc.status)}>{inc.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {inc.type} — {inc.transport_drivers?.employees?.name || 'No driver'}{inc.transport_vehicles ? ` · ${inc.transport_vehicles.vehicle_number}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(inc.occurred_at).toLocaleString()}{inc.location ? ` · ${inc.location}` : ''}{inc.transport_requests ? ` · Trip ${inc.transport_requests.request_number}` : ''}
                  </p>
                  {inc.description && <p className="text-xs text-slate-500 mt-1">{inc.description}</p>}
                </div>
                <button onClick={() => handleDeleteIncident(inc.id)} className="p-1 opacity-0 group-hover:opacity-100 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={12} className="text-rose-400" /></button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {inc.status === 'Reported' && (
                  <button onClick={() => handleIncidentStatus(inc, 'Under Review')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 transition">Review</button>
                )}
                {['Reported', 'Under Review'].includes(inc.status) && (
                  <button onClick={() => handleIncidentStatus(inc, 'Resolved')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-200 transition">Resolve</button>
                )}
                {inc.status === 'Resolved' && (
                  <button onClick={() => handleIncidentStatus(inc, 'Closed')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 transition">Close</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Report Incident Modal */}
      <ModalSystem
        isOpen={showIncidentModal}
        onClose={() => setShowIncidentModal(false)}
        onConfirm={handleSaveIncident}
        title="Report Incident"
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Report'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Driver">
            <select className={inputCls} value={incidentForm.driverId} onChange={(e) => setIncidentForm(f => ({ ...f, driverId: e.target.value }))}>
              <option value="">None</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.license_number}</option>)}
            </select>
          </Field>
          <Field label="Vehicle">
            <select className={inputCls} value={incidentForm.vehicleId} onChange={(e) => setIncidentForm(f => ({ ...f, vehicleId: e.target.value }))}>
              <option value="">None</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls} value={incidentForm.type} onChange={(e) => setIncidentForm(f => ({ ...f, type: e.target.value }))}>
              {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Severity">
            <select className={inputCls} value={incidentForm.severity} onChange={(e) => setIncidentForm(f => ({ ...f, severity: e.target.value }))}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Occurred At"><input type="datetime-local" className={inputCls} value={incidentForm.occurredAt} onChange={(e) => setIncidentForm(f => ({ ...f, occurredAt: e.target.value }))} /></Field>
          <Field label="Location"><input className={inputCls} value={incidentForm.location} onChange={(e) => setIncidentForm(f => ({ ...f, location: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="Description"><input className={inputCls} value={incidentForm.description} onChange={(e) => setIncidentForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Driver' : 'Add Driver'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Employee">
            <select className={inputCls} value={form.employeeId} onChange={(e) => setForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Select HR employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status})</option>)}
            </select>
          </Field></div>
          <Field label="License Number"><input className={inputCls} value={form.licenseNumber} onChange={(e) => setForm(f => ({ ...f, licenseNumber: e.target.value }))} /></Field>
          <Field label="License Category"><input className={inputCls} value={form.licenseCategory} onChange={(e) => setForm(f => ({ ...f, licenseCategory: e.target.value }))} /></Field>
          <Field label="License Expiry"><input type="date" className={inputCls} value={form.licenseExpiry} onChange={(e) => setForm(f => ({ ...f, licenseExpiry: e.target.value }))} /></Field>
          <Field label="Medical Certificate"><input type="date" className={inputCls} value={form.medicalCertificate} onChange={(e) => setForm(f => ({ ...f, medicalCertificate: e.target.value }))} /></Field>
          <Field label="Certifications (comma separated)"><input className={inputCls} value={form.certifications} onChange={(e) => setForm(f => ({ ...f, certifications: e.target.value }))} /></Field>
          <Field label="Assigned Vehicle"><input className={inputCls} value={form.assignedVehicle} onChange={(e) => setForm(f => ({ ...f, assignedVehicle: e.target.value }))} /></Field>
          <Field label="Shift">
            <select className={inputCls} value={form.shift} onChange={(e) => setForm(f => ({ ...f, shift: e.target.value }))}>
              {SHIFT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Incidents"><input type="number" className={inputCls} value={form.incidents} onChange={(e) => setForm(f => ({ ...f, incidents: Number(e.target.value) }))} /></Field>
          <Field label="Total Trips"><input type="number" className={inputCls} value={form.totalTrips} onChange={(e) => setForm(f => ({ ...f, totalTrips: Number(e.target.value) }))} /></Field>
          <Field label="Performance %"><input type="number" className={inputCls} value={form.performance} onChange={(e) => setForm(f => ({ ...f, performance: Number(e.target.value) }))} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default DriverManagement;
