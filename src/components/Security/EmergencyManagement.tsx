/**
 * Emergency Management — /erp/security/emergency.
 *
 * DB-integrated via /api/sec-portal/soc/emergency routes (migrations
 * 600/609). Shares `sec_emergency_notifications` with the SOC emergency tab
 * — one source of truth. `sec_emergency_responses` backs a real incident-
 * command log: alerts, dispatches, evacuation orders, status updates and
 * all-clear events persist as response entries.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, History, MapPin, Radio, Siren,
  Flame, HeartPulse, Zap, ShieldAlert, Users, Megaphone, Play, Flag,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecEmergencies, fetchSecEmergency, createSecEmergency,
  updateSecEmergency, deleteSecEmergency, addSecEmergencyResponse,
  fetchSecStaff,
  type SecEmergency, type SecEmergencyDetail, type SecEmergencyStatus,
  type SecEvacuationStatus, type SecEmergencyResponseAction,
  type SecPriority, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const EMERGENCY_TYPES = [
  'Fire Emergency', 'Medical Emergency', 'Evacuation Drill', 'Gas Leak',
  'Power Outage', 'Structural Incident', 'Security Threat', 'Severe Weather',
  'Hazmat Incident', 'Other',
];

const STATUSES: SecEmergencyStatus[] = ['Active', 'In Progress', 'Scheduled', 'Resolved'];
const PRIORITIES: SecPriority[] = ['Critical', 'High', 'Medium', 'Low'];
const EVACUATIONS: SecEvacuationStatus[] = ['Not Required', 'Standby', 'In Progress', 'Complete'];
const RESPONSE_ACTIONS: SecEmergencyResponseAction[] = [
  'Status Update', 'Team Dispatched', 'Commander Assigned',
  'Evacuation Ordered', 'Evacuation Complete', 'All Clear', 'Note',
];

const STATUS_TONE: Record<SecEmergencyStatus, StatusTone> = {
  Active: 'danger',
  'In Progress': 'warning',
  Scheduled: 'neutral',
  Resolved: 'success',
};

const PRIORITY_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const EVAC_TONE: Record<SecEvacuationStatus, StatusTone> = {
  'Not Required': 'neutral', Standby: 'warning',
  'In Progress': 'danger', Complete: 'success',
};

const TYPE_ICON: Record<string, typeof AlertTriangle> = {
  'Fire Emergency': Flame,
  'Medical Emergency': HeartPulse,
  'Evacuation Drill': Users,
  'Gas Leak': ShieldAlert,
  'Power Outage': Zap,
  'Severe Weather': AlertTriangle,
};

const RESPONSE_DOT: Record<SecEmergencyResponseAction, string> = {
  'Alert Raised': 'bg-red-500',
  'Team Dispatched': 'bg-blue-500',
  'Commander Assigned': 'bg-indigo-500',
  'Evacuation Ordered': 'bg-amber-500',
  'Evacuation Complete': 'bg-emerald-500',
  'Status Update': 'bg-blue-500',
  'All Clear': 'bg-emerald-500',
  Resolved: 'bg-emerald-600',
  Note: 'bg-slate-400',
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

const inlineStatusSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No emergencies found.</td></tr>
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

const EmergencyManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [emergencies, setEmergencies] = useState<SecEmergency[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecEmergencyStatus>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | SecPriority>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecEmergency | null>(null);
  const [detail, setDetail] = useState<SecEmergencyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecEmergency | null>(null);

  // Response log form (detail modal)
  const [respAction, setRespAction] = useState<SecEmergencyResponseAction>('Status Update');
  const [respDetail, setRespDetail] = useState('');

  const emptyForm = {
    emergencyType: 'Fire Emergency', location: '', priority: 'High' as SecPriority,
    description: '', commander: '', responseTeam: '',
    evacuation: 'Not Required' as SecEvacuationStatus,
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s] = await Promise.all([
        fetchSecEmergencies(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setEmergencies(e);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load emergencies');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecEmergency(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load emergency detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (e: SecEmergency) => {
    setDetail(null);
    setRespAction('Status Update');
    setRespDetail('');
    loadDetail(e.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.emergency.id);
    addNotification('Emergency board refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    active: emergencies.filter(e => e.status === 'Active').length,
    inProgress: emergencies.filter(e => e.status === 'In Progress').length,
    evacuating: emergencies.filter(e => e.evacuation === 'In Progress').length,
    resolved: emergencies.filter(e => e.status === 'Resolved').length,
  }), [emergencies]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return emergencies.filter(e => {
      const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || e.priority === filterPriority;
      const matchesSearch = !q ||
        e.id.toLowerCase().includes(q) ||
        e.emergency_type.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (e.commander?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [emergencies, filterStatus, filterPriority, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (e: SecEmergency) => {
    setEditing(e);
    setForm({
      emergencyType: e.emergency_type,
      location: e.location,
      priority: e.priority,
      description: e.description || '',
      commander: e.commander || '',
      responseTeam: e.response_team || '',
      evacuation: e.evacuation,
    });
    setShowForm(true);
  };

  const saveEmergency = async () => {
    if (!form.location.trim()) {
      addNotification('Location is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        emergencyType: form.emergencyType,
        location: form.location.trim(),
        priority: form.priority,
        description: form.description || null,
        commander: form.commander || null,
        responseTeam: form.responseTeam || null,
        evacuation: form.evacuation,
      };
      if (editing) {
        const res = await updateSecEmergency(editing.id, payload);
        setEmergencies(prev => prev.map(e => (e.id === editing.id ? res.emergency : e)));
        if (detail?.emergency.id === editing.id) loadDetail(editing.id);
        addNotification(`Emergency ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecEmergency({ propertyId: currentPropertyId, ...payload });
        setEmergencies(prev => [created, ...prev]);
        addNotification(`Emergency alert raised — ${created.emergency_type} at ${created.location} (${created.id})`, 'warning', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save emergency', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchEmergency = async (e: SecEmergency, patch: Parameters<typeof updateSecEmergency>[1], toast?: string) => {
    setActingOn(e.id);
    try {
      const res = await updateSecEmergency(e.id, patch);
      setEmergencies(prev => prev.map(x => (x.id === e.id ? res.emergency : x)));
      if (detail?.emergency.id === e.id) loadDetail(e.id);
      addNotification(toast || `Emergency ${e.id} updated`, 'task', 'Security');
    } catch (err: any) {
      addNotification(err?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitResponse = async () => {
    if (!detail) return;
    setActingOn(detail.emergency.id);
    try {
      await addSecEmergencyResponse(detail.emergency.id, { action: respAction, detail: respDetail || null });
      await loadDetail(detail.emergency.id);
      setRespDetail('');
      addNotification(`${respAction} logged on ${detail.emergency.id}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Response log failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeEmergency = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecEmergency(deleteTarget.id);
      setEmergencies(prev => prev.filter(e => e.id !== deleteTarget.id));
      if (detail?.emergency.id === deleteTarget.id) setDetail(null);
      addNotification(`Emergency ${deleteTarget.id} removed`, 'task', 'Security');
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
        title="Emergency Management"
        subtitle="Coordinate emergency response, evacuation, and incident command"
        icon={AlertTriangle}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Siren className="w-4 h-4" /> Emergency Alert
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Alerts" value={stats.active} icon={Siren} tone="danger" />
        <StatCard title="Responding" value={stats.inProgress} icon={Radio} tone="warning" />
        <StatCard title="Evacuating" value={stats.evacuating} icon={Users} tone="info" />
        <StatCard title="Resolved" value={stats.resolved} icon={CheckCircle2} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
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
              placeholder="Search type, location, commander, ID…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-slate-400" />
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as any)} className={filterSelect}>
              <option value="all">All Priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Incident command board */}
      <SectionCard title="Incident Command" subtitle="Emergency · Location · Priority · Evacuation · Commander" icon={AlertTriangle} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Emergency', 'Location', 'Priority', 'Status', 'Evacuation', 'Commander', 'Occurred', '']}
            rows={filtered.map(e => {
              const Icon = TYPE_ICON[e.emergency_type] || AlertTriangle;
              return [
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${e.status === 'Active' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                    <Icon className={`w-4 h-4 ${e.status === 'Active' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => openDetail(e)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{e.emergency_type}</button>
                    <div className="text-[10px] text-slate-400 font-mono">{e.id}</div>
                  </div>
                </div>,
                <span className="flex items-center gap-1 text-xs"><MapPin size={11} className="text-slate-400" />{e.location}</span>,
                <Badge tone={PRIORITY_TONE[e.priority]}>{e.priority}</Badge>,
                <select
                  value={e.status}
                  onChange={ev => patchEmergency(e, { status: ev.target.value as SecEmergencyStatus }, `Emergency ${e.id} → ${ev.target.value}`)}
                  disabled={actingOn === e.id}
                  className={inlineStatusSelect}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                <Badge tone={EVAC_TONE[e.evacuation]}>{e.evacuation}</Badge>,
                <span className="text-xs">{e.commander || '—'}</span>,
                <span className="text-xs text-slate-500">{fmtDateTime(e.occurred_at)}</span>,
                <div className="inline-flex gap-2">
                  <button onClick={() => openDetail(e)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => openEdit(e)} disabled={actingOn === e.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteTarget(e)} disabled={actingOn === e.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === e.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ];
            })}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* Raise / Edit emergency modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveEmergency}
        title={editing ? `Edit ${editing.id}` : 'Raise Emergency Alert'}
        subtitle={editing ? editing.emergency_type : 'Declare an emergency and assign incident command'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Raise Alert'}
        confirmColor={editing ? undefined : 'rose'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Emergency Type">
              <select className={inputClass} value={form.emergencyType} onChange={e => setForm(f => ({ ...f, emergencyType: e.target.value }))}>
                {EMERGENCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Kitchen, Pool Area, All Areas" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Priority">
              <select className={inputClass} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as SecPriority }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Evacuation">
              <select className={inputClass} value={form.evacuation} onChange={e => setForm(f => ({ ...f, evacuation: e.target.value as SecEvacuationStatus }))}>
                {EVACUATIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Situation Report">
            <textarea className={inputClass + ' min-h-[64px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What happened, current status, resources needed…" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Incident Commander">
              <input
                className={inputClass}
                list="sec-emg-commanders"
                value={form.commander}
                onChange={e => setForm(f => ({ ...f, commander: e.target.value }))}
                placeholder="Select or type commander"
              />
              <datalist id="sec-emg-commanders">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Response Team">
              <input className={inputClass} value={form.responseTeam} onChange={e => setForm(f => ({ ...f, responseTeam: e.target.value }))} placeholder="e.g., Security Team A, Engineering" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Emergency detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Emergency ${detail.emergency.id}` : 'Emergency Detail'}
        subtitle={detail ? `${detail.emergency.emergency_type} · ${detail.emergency.location}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            {/* Live alert banner for active emergencies */}
            {detail.emergency.status === 'Active' && (
              <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                <Siren className="w-4 h-4 shrink-0 animate-pulse" /> ACTIVE EMERGENCY — response in progress
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.emergency.status]}>{detail.emergency.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Priority</p>
                <Badge tone={PRIORITY_TONE[detail.emergency.priority]}>{detail.emergency.priority}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Evacuation</p>
                <Badge tone={EVAC_TONE[detail.emergency.evacuation]}>{detail.emergency.evacuation}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Commander</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.emergency.commander || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Response Team</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.emergency.response_team || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Occurred</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.emergency.occurred_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Resolved</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.emergency.resolved_at)}</p>
              </div>
              {detail.emergency.description && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Situation Report</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.emergency.description}</p>
                </div>
              )}
            </div>

            {/* Command actions */}
            <div className="flex flex-wrap gap-2">
              {detail.emergency.status === 'Active' && (
                <button onClick={() => patchEmergency(detail.emergency, { status: 'In Progress' }, `Response started — ${detail.emergency.id}`)} disabled={actingOn === detail.emergency.id} className={button.primary + ' disabled:opacity-50'}>
                  <Play className="w-4 h-4" /> Begin Response
                </button>
              )}
              {detail.emergency.evacuation !== 'Complete' && detail.emergency.status !== 'Resolved' && detail.emergency.status !== 'Scheduled' && (
                <button
                  onClick={() => patchEmergency(detail.emergency, { evacuation: detail.emergency.evacuation === 'In Progress' ? 'Complete' : 'In Progress' })}
                  disabled={actingOn === detail.emergency.id}
                  className={button.secondary + ' disabled:opacity-50'}
                >
                  <Users className="w-4 h-4" /> {detail.emergency.evacuation === 'In Progress' ? 'Evacuation Complete' : 'Order Evacuation'}
                </button>
              )}
              {detail.emergency.status !== 'Resolved' && (
                <button onClick={() => patchEmergency(detail.emergency, { status: 'Resolved' }, `Emergency ${detail.emergency.id} resolved`)} disabled={actingOn === detail.emergency.id} className={button.primary + ' disabled:opacity-50'}>
                  <Flag className="w-4 h-4" /> Resolve
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.emergency); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.emergency)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Response log form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <Megaphone className="w-4 h-4 text-[var(--color-accent-operations)]" /> Log Response Action
              </h4>
              <div className="flex flex-wrap gap-2">
                <select className={inputClass + ' !w-auto'} value={respAction} onChange={e => setRespAction(e.target.value as SecEmergencyResponseAction)}>
                  {RESPONSE_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input className={inputClass + ' flex-1 min-w-[160px]'} value={respDetail} onChange={e => setRespDetail(e.target.value)} placeholder="Detail — what happened, who was dispatched…" />
                <button onClick={submitResponse} disabled={actingOn === detail.emergency.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Log
                </button>
              </div>
            </div>

            {/* Response timeline */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Response Timeline
              </h4>
              <div className="space-y-0 max-h-56 overflow-y-auto">
                {detail.responses.map((ev, idx) => (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${RESPONSE_DOT[ev.action] || 'bg-slate-400'}`} />
                      {idx < detail.responses.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{ev.action}</p>
                      {ev.detail && <p className="text-xs text-slate-500">{ev.detail}</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock size={10} />{fmtDateTime(ev.created_at)}{ev.actor ? ` · ${ev.actor}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {detail.responses.length === 0 && <p className="text-xs text-slate-400">No response actions logged.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeEmergency}
        title="Remove Emergency"
        subtitle={deleteTarget ? `Permanently remove emergency ${deleteTarget.id} (${deleteTarget.emergency_type}) and its response log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default EmergencyManagement;
