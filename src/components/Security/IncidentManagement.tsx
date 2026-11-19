/**
 * Incident Management — /erp/security/incidents.
 *
 * DB-integrated via /api/sec-portal/soc/incidents routes (migrations 600/601).
 * Shares the `sec_incidents` table with the SOC dispatch queue — an incident
 * logged here appears in the SOC queue and vice versa.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Plus, Search, Clock, MapPin, CheckCircle2, Eye, Pencil,
  Trash2, Tag, ShieldAlert, Activity, Flame, Droplets, Wrench, Lock, Heart,
  Briefcase, RefreshCw, Loader2, ServerCrash, ClipboardList, Filter,
  Monitor, type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecIncidents, createSecIncident, updateSecIncident, deleteSecIncident,
  fetchSecStaff,
  type SecIncident, type SecIncidentStatus, type SecPriority, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const CATEGORIES = [
  'Theft', 'Assault', 'Guest Complaint', 'Medical Emergency', 'Fire',
  'Water Leak', 'Property Damage', 'Security Breach', 'Lost Property',
  'Workplace Accident', 'Fraud', 'Cybersecurity Incident',
];

const PRIORITIES: SecPriority[] = ['Low', 'Medium', 'High', 'Critical'];

const STATUSES: SecIncidentStatus[] = [
  'Draft', 'Reported', 'Classified', 'Assigned', 'In Progress',
  'Investigation', 'Corrective Action', 'Closed',
];

const CLOSED_STATUSES: SecIncidentStatus[] = ['Closed', 'Resolved'];

const CATEGORY_ICON: Record<string, LucideIcon> = {
  'Theft': Lock,
  'Medical Emergency': Heart,
  'Fire': Flame,
  'Water Leak': Droplets,
  'Property Damage': Wrench,
  'Security Breach': ShieldAlert,
  'Workplace Accident': Activity,
  'Fraud': Briefcase,
  'Cybersecurity Incident': Monitor,
};

const PRIORITY_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const STATUS_TONE: Record<SecIncidentStatus, StatusTone> = {
  Draft: 'neutral',
  Reported: 'info',
  Classified: 'accent',
  Assigned: 'warning',
  'In Progress': 'warning',
  Investigation: 'info',
  'Corrective Action': 'success',
  Closed: 'success',
  Active: 'info',
  Pending: 'neutral',
  Resolved: 'success',
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-6 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-6 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No incidents found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

const IncidentManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [incidents, setIncidents] = useState<SecIncident[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecIncidentStatus>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | SecPriority>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecIncident | null>(null);
  const [detail, setDetail] = useState<SecIncident | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecIncident | null>(null);

  const emptyForm = {
    category: 'Theft', description: '', location: '', priority: 'Medium' as SecPriority,
    status: 'Reported' as SecIncidentStatus, reportedBy: '', assignedTo: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecIncidents(currentPropertyId);
      setIncidents(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadStaff = useCallback(async () => {
    try {
      setStaff(await fetchSecStaff(currentPropertyId));
    } catch { /* non-fatal — assignee dropdown falls back to free text */ }
  }, [currentPropertyId]);

  useEffect(() => { loadIncidents(); loadStaff(); }, [loadIncidents, loadStaff]);

  const refreshAll = async () => {
    await Promise.all([loadIncidents(), loadStaff()]);
    addNotification('Incidents refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: incidents.length,
    open: incidents.filter(i => !CLOSED_STATUSES.includes(i.status)).length,
    critical: incidents.filter(i => i.priority === 'Critical' && !CLOSED_STATUSES.includes(i.status)).length,
    closed: incidents.filter(i => CLOSED_STATUSES.includes(i.status)).length,
  }), [incidents]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return incidents.filter(i => {
      const matchesStatus = filterStatus === 'all' || i.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || i.priority === filterPriority;
      const matchesSearch = !q ||
        i.id.toLowerCase().includes(q) ||
        (i.category || i.incident_type).toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q) ||
        (i.description?.toLowerCase().includes(q) ?? false) ||
        (i.assigned_to?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [incidents, filterStatus, filterPriority, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (i: SecIncident) => {
    setEditing(i);
    setForm({
      category: i.category || i.incident_type,
      description: i.description || '',
      location: i.location,
      priority: i.priority,
      status: i.status,
      reportedBy: i.reported_by || '',
      assignedTo: i.assigned_to || '',
    });
    setShowForm(true);
  };

  const saveIncident = async () => {
    if (!form.location.trim()) {
      addNotification('Location is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const res = await updateSecIncident(editing.id, {
          incidentType: form.category, category: form.category,
          location: form.location.trim(), priority: form.priority, status: form.status,
          reportedBy: form.reportedBy || null, assignedTo: form.assignedTo || null,
          description: form.description || null,
        });
        setIncidents(prev => prev.map(i => (i.id === editing.id ? res.incident : i)));
        if (detail?.id === editing.id) setDetail(res.incident);
        addNotification(`Incident ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecIncident({
          propertyId: currentPropertyId,
          incidentType: form.category, category: form.category,
          location: form.location.trim(), priority: form.priority, status: form.status,
          reportedBy: form.reportedBy || null, assignedTo: form.assignedTo || null,
          description: form.description || null,
        });
        setIncidents(prev => [created, ...prev]);
        addNotification(`Incident ${created.id} reported`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save incident', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const quickStatus = async (id: string, status: SecIncidentStatus) => {
    setActingOn(id);
    try {
      const res = await updateSecIncident(id, { status });
      setIncidents(prev => prev.map(i => (i.id === id ? res.incident : i)));
      if (detail?.id === id) setDetail(res.incident);
      addNotification(`Incident ${id} → ${status}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Status update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeIncident = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecIncident(deleteTarget.id);
      setIncidents(prev => prev.filter(i => i.id !== deleteTarget.id));
      if (detail?.id === deleteTarget.id) setDetail(null);
      addNotification(`Incident ${deleteTarget.id} deleted`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Incident Management"
        subtitle="Report, track, and manage security incidents"
        icon={AlertTriangle}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> New Incident
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Incidents" value={stats.total} icon={ClipboardList} tone="accent" />
        <StatCard title="Open Cases" value={stats.open} icon={Activity} tone="info" />
        <StatCard title="Critical (Open)" value={stats.critical} icon={ShieldAlert} tone="danger" />
        <StatCard title="Closed / Resolved" value={stats.closed} icon={CheckCircle2} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadIncidents} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ID, category, location, assignee…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {[...STATUSES, 'Active', 'Pending', 'Resolved'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as any)} className={filterSelect}>
              <option value="all">All Priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Incident list */}
      <SectionCard title="Incident Register" subtitle="Category · Location · Priority · Status · Assignment" icon={AlertTriangle} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Incident', 'Category', 'Location', 'Priority', 'Status', 'Assigned', 'Reported', '']}
            rows={filtered.map(i => {
              const CategoryIcon = CATEGORY_ICON[i.category || i.incident_type] || AlertTriangle;
              return [
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 shrink-0">
                    <CategoryIcon className="w-4 h-4 text-[var(--color-accent-operations)]" />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => setDetail(i)} className="font-mono text-xs font-bold text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{i.id}</button>
                    <div className="text-[10px] text-slate-400 max-w-[220px] truncate">{i.description || i.incident_type}</div>
                  </div>
                </div>,
                <span className="font-medium text-slate-900 dark:text-white">{i.category || i.incident_type}</span>,
                <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{i.location}</span>,
                <Badge tone={PRIORITY_TONE[i.priority]}>{i.priority}</Badge>,
                <select
                  value={i.status}
                  onChange={e => quickStatus(i.id, e.target.value as SecIncidentStatus)}
                  disabled={actingOn === i.id}
                  className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50"
                >
                  {(STATUSES.includes(i.status) ? STATUSES : [i.status, ...STATUSES]).map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                i.assigned_to || <span className="text-slate-400">Unassigned</span>,
                <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} />{fmtDateTime(i.reported_at)}</span>,
                <div className="inline-flex gap-2">
                  <button onClick={() => setDetail(i)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => openEdit(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteTarget(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === i.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ];
            })}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* New / Edit incident modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveIncident}
        title={editing ? `Edit ${editing.id}` : 'Report New Incident'}
        subtitle={editing ? 'Update case details' : 'Log a security incident'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Submit Incident'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select className={inputClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as SecPriority }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass} rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the incident…" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location">
              <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Incident location" />
            </Field>
            <Field label="Status">
              <select className={inputClass} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SecIncidentStatus }))}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Reported By">
              <input className={inputClass} value={form.reportedBy} onChange={e => setForm(f => ({ ...f, reportedBy: e.target.value }))} placeholder="e.g. Guest - John Smith" />
            </Field>
            <Field label="Assign To">
              <select className={inputClass} value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}>
                <option value="">Unassigned</option>
                {staff.map(s => <option key={s.id} value={s.name}>{s.name} — {s.role}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Incident detail modal */}
      <ModalSystem
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Incident ${detail.id}` : ''}
        subtitle={detail ? (detail.category || detail.incident_type) : ''}
        variant="info"
        showFooter={false}
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone={PRIORITY_TONE[detail.priority]}>{detail.priority}</Badge>
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
            </div>
            {detail.description && (
              <p className="text-sm text-slate-700 dark:text-slate-300">{detail.description}</p>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.location}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Assigned To</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.assigned_to || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reported By</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.reported_by || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reported At</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDateTime(detail.reported_at)}</p>
              </div>
            </div>
            <Field label="Update Status">
              <select
                className={inputClass}
                value={detail.status}
                disabled={actingOn === detail.id}
                onChange={e => quickStatus(detail.id, e.target.value as SecIncidentStatus)}
              >
                {(STATUSES.includes(detail.status) ? STATUSES : [detail.status, ...STATUSES]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="flex gap-2 pt-2">
              <button onClick={() => { setDetail(null); openEdit(detail); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => { setDeleteTarget(detail); }} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeIncident}
        title="Delete Incident"
        subtitle={deleteTarget ? `Permanently delete incident ${deleteTarget.id}?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default IncidentManagement;
