/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vehicle Maintenance Interface — maintenance request tracking for the fleet.
 * DB-integrated via /api/transport/maintenance/* (transport_maintenance_requests).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Wrench,
  Search,
  Plus,
  Pencil,
  Eye,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Car,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface MaintenanceRequest {
  id: string;
  request_number: string;
  vehicle_id: string | null;
  type: string;
  priority: string;
  description: string | null;
  status: string;
  requested_date: string;
  scheduled_date: string | null;
  completed_date: string | null;
  estimated_cost: number;
  actual_cost: number | null;
  vendor: string | null;
  assigned_to: string | null;
  notes: string | null;
  transport_vehicles: { vehicle_number: string; make: string | null; model: string | null; status: string; mileage: number | null } | null;
}

interface Vehicle { id: string; vehicle_number: string; make: string | null; model: string | null; status: string; }

const REQUEST_TYPES = ['Preventive Maintenance', 'Breakdown Repair', 'Inspection', 'Emergency Repair'];
const PRIORITIES = ['High', 'Normal', 'Low'];
const STATUSES = ['Pending', 'In Progress', 'Scheduled', 'Completed', 'Cancelled'];

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
    case 'Pending': return 'warning';
    case 'In Progress': return 'info';
    case 'Scheduled': return 'accent';
    case 'Completed': return 'success';
    case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

function priorityTone(priority: string): StatusTone {
  switch (priority) {
    case 'High': return 'danger';
    case 'Normal': return 'info';
    case 'Low': return 'neutral';
    default: return 'neutral';
  }
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyForm = {
  vehicleId: '', type: 'Preventive Maintenance', priority: 'Normal', description: '',
  status: 'Pending', requestedDate: '', scheduledDate: '', estimatedCost: '', actualCost: '',
  vendor: '', assignedTo: '', notes: '',
};

const VehicleMaintenanceInterface = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRequest | null>(null);
  const [viewing, setViewing] = useState<MaintenanceRequest | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [rRes, vRes] = await Promise.all([
        fetch(`/api/transport/maintenance/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (rRes.ok) setRequests(((await rRes.json()) as { requests: MaintenanceRequest[] }).requests || []);
      if (vRes.ok) setVehicles(((await vRes.json()) as { vehicles: Vehicle[] }).vehicles || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = requests;
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (priorityFilter !== 'all') list = list.filter((r) => r.priority === priorityFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r.transport_vehicles?.vehicle_number || '').toLowerCase().includes(q) ||
        (`${r.transport_vehicles?.make || ''} ${r.transport_vehicles?.model || ''}`).toLowerCase().includes(q) ||
        r.request_number.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.vendor || '').toLowerCase().includes(q));
    }
    return list;
  }, [requests, statusFilter, priorityFilter, search]);

  const stats = useMemo(() => ({
    open: requests.filter((r) => !['Completed', 'Cancelled'].includes(r.status)).length,
    highPriority: requests.filter((r) => r.priority === 'High' && r.status !== 'Completed' && r.status !== 'Cancelled').length,
    completed: requests.filter((r) => r.status === 'Completed').length,
    inService: vehicles.filter((v) => v.status === 'Maintenance').length,
  }), [requests, vehicles]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, requestedDate: new Date().toISOString().slice(0, 10) });
    setShowModal(true);
  };

  const openEdit = (r: MaintenanceRequest) => {
    setEditing(r);
    setForm({
      vehicleId: r.vehicle_id || '',
      type: r.type,
      priority: r.priority,
      description: r.description || '',
      status: r.status,
      requestedDate: r.requested_date || '',
      scheduledDate: r.scheduled_date || '',
      estimatedCost: String(r.estimated_cost),
      actualCost: r.actual_cost != null ? String(r.actual_cost) : '',
      vendor: r.vendor || '',
      assignedTo: r.assigned_to || '',
      notes: r.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editing ? `/api/transport/maintenance/${editing.id}` : '/api/transport/maintenance/';
      const body = {
        propertyId: currentPropertyId,
        vehicleId: form.vehicleId || null,
        type: form.type,
        priority: form.priority,
        description: form.description || null,
        status: form.status,
        requestedDate: form.requestedDate || null,
        scheduledDate: form.scheduledDate || null,
        estimatedCost: Number(form.estimatedCost) || 0,
        actualCost: form.actualCost === '' ? null : Number(form.actualCost),
        vendor: form.vendor || null,
        assignedTo: form.assignedTo || null,
        notes: form.notes || null,
      };
      const res = await fetch(endpoint, { method: editing ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editing ? 'Request updated' : 'Request created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatus = async (r: MaintenanceRequest, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/maintenance/${r.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Request ${status.toLowerCase()}`, 'success', 'Transportation');
      setShowView(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this maintenance request?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/maintenance/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Request deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Vehicle Maintenance" subtitle="Integration with Engineering & Maintenance Portal" icon={Wrench} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Wrench className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view maintenance.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Vehicle Maintenance"
        subtitle="Integration with Engineering & Maintenance Portal"
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Request</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Requests" value={String(stats.open)} icon={Wrench} tone="accent" />
        <StatCard title="High Priority" value={String(stats.highPriority)} icon={AlertTriangle} tone="danger" />
        <StatCard title="Completed" value={String(stats.completed)} icon={CheckCircle2} tone="success" />
        <StatCard title="Vehicles in Service" value={String(stats.inService)} icon={Car} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            placeholder="Search by vehicle, ID, description, or vendor..."
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={filterSelectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={filterSelectCls} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="all">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Requests Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Maintenance Requests</h3></div>
        {loading && requests.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Wrench className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No maintenance requests.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Request ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Vehicle</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Description</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Priority</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Scheduled</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Est. Cost</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{r.request_number}</td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{r.transport_vehicles?.vehicle_number || '—'}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{r.transport_vehicles ? `${r.transport_vehicles.make || ''} ${r.transport_vehicles.model || ''}`.trim() : ''}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{r.type}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate">{r.description || '—'}</td>
                    <td className="px-6 py-4"><Badge tone={priorityTone(r.priority)}>{r.priority}</Badge></td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {r.scheduled_date ? (
                        <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(r.scheduled_date)}</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">Not scheduled</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{formatAmount(Number(r.estimated_cost))}</td>
                    <td className="px-6 py-4"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => { setViewing(r); setShowView(true); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
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
        title={editing ? `Edit ${editing.request_number}` : 'New Maintenance Request'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vehicle">
            <select className={inputCls} value={form.vehicleId} onChange={(e) => setForm(f => ({ ...f, vehicleId: e.target.value }))}>
              <option value="">Select vehicle</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number} — {v.make} {v.model}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Requested Date"><input type="date" className={inputCls} value={form.requestedDate} onChange={(e) => setForm(f => ({ ...f, requestedDate: e.target.value }))} /></Field>
          <Field label="Scheduled Date"><input type="date" className={inputCls} value={form.scheduledDate} onChange={(e) => setForm(f => ({ ...f, scheduledDate: e.target.value }))} /></Field>
          <Field label="Estimated Cost"><input type="number" step="0.01" min={0} className={inputCls} value={form.estimatedCost} onChange={(e) => setForm(f => ({ ...f, estimatedCost: e.target.value }))} /></Field>
          <Field label="Actual Cost"><input type="number" step="0.01" min={0} className={inputCls} value={form.actualCost} onChange={(e) => setForm(f => ({ ...f, actualCost: e.target.value }))} /></Field>
          <Field label="Vendor"><input className={inputCls} value={form.vendor} onChange={(e) => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="e.g. BMW Service Center" /></Field>
          <Field label="Assigned To"><input className={inputCls} value={form.assignedTo} onChange={(e) => setForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="e.g. Engineering Team" /></Field>
          <label className="col-span-2 block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Description</span>
            <textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="col-span-2 block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes</span>
            <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          </label>
        </div>
      </ModalSystem>

      {/* View Modal */}
      <ModalSystem
        isOpen={showView}
        onClose={() => setShowView(false)}
        title={`Request ${viewing?.request_number || ''}`}
        variant="info"
        size="md"
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Vehicle</p>
                <p className="font-medium text-slate-900 dark:text-white">
                  {viewing.transport_vehicles?.vehicle_number || '—'}
                  {viewing.transport_vehicles && <span className="text-slate-500"> · {viewing.transport_vehicles.make} {viewing.transport_vehicles.model}</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Status</p>
                <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Type / Priority</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.type} · <Badge tone={priorityTone(viewing.priority)}>{viewing.priority}</Badge></p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Vendor</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.vendor || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Requested</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatDate(viewing.requested_date)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Scheduled</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.scheduled_date ? formatDate(viewing.scheduled_date) : 'Not scheduled'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Estimated</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatAmount(Number(viewing.estimated_cost))}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Actual</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.actual_cost != null ? formatAmount(Number(viewing.actual_cost)) : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assigned To</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.assigned_to || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Completed</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.completed_date ? formatDate(viewing.completed_date) : '—'}</p>
              </div>
            </div>
            {viewing.description && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-sm text-slate-700 dark:text-slate-300">{viewing.description}</div>
            )}
            {viewing.notes && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-sm text-slate-600 dark:text-slate-400"><span className="font-bold">Notes:</span> {viewing.notes}</div>
            )}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              {viewing.status === 'Pending' && (
                <button onClick={() => handleStatus(viewing, 'Scheduled')} disabled={saving} className={button.secondary}><Calendar size={14} /> Schedule</button>
              )}
              {['Pending', 'Scheduled'].includes(viewing.status) && (
                <button onClick={() => handleStatus(viewing, 'In Progress')} disabled={saving} className={button.secondary}><Wrench size={14} /> Start Work</button>
              )}
              {viewing.status === 'In Progress' && (
                <button onClick={() => handleStatus(viewing, 'Completed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Complete</button>
              )}
              {!['Completed', 'Cancelled'].includes(viewing.status) && (
                <button onClick={() => handleStatus(viewing, 'Cancelled')} disabled={saving} className={button.ghost}><AlertTriangle size={14} /> Cancel</button>
              )}
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default VehicleMaintenanceInterface;
