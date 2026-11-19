/**
 * Crisis Management — /erp/security/crisis.
 *
 * DB-integrated via /api/sec-portal/crises routes (migration 613).
 * `sec_crises` is the crisis register — severity, crisis lead, comms
 * channel, and a Monitoring → Active → Stabilizing → Resolved → Debrief
 * lifecycle, with optional links to `sec_incidents` and `sec_bcp_plans`
 * so a crisis can be tied to the incident that triggered it and the
 * continuity plan invoked.
 * `sec_crisis_updates` is the comms + decision log (Crisis Declared,
 * Team Mobilized, Status Update, Communication, Decision, Escalation,
 * BCP Activated, Resolved, Note), CASCADE on crisis delete. Status and
 * lead/BCP changes auto-log entries server-side.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Radio, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, History, User, Tag, MapPin,
  AlertOctagon, Siren, Megaphone, Scale, Link2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecCrises, fetchSecCrisis, createSecCrisis, updateSecCrisis,
  deleteSecCrisis, addSecCrisisUpdate, fetchSecStaff, fetchSecIncidents,
  fetchSecBcpPlans,
  type SecCrisis, type SecCrisisDetail, type SecCrisisType,
  type SecCrisisStatus, type SecCrisisUpdateType, type SecPriority,
  type SecStaff, type SecIncident, type SecBcpPlan,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const CRISIS_TYPES: SecCrisisType[] = [
  'Security Threat', 'Natural Disaster', 'Public Health', 'Media & PR',
  'Cyber Incident', 'Utility Failure', 'Structural', 'Civil Unrest', 'Other',
];
const STATUSES: SecCrisisStatus[] = ['Monitoring', 'Active', 'Stabilizing', 'Resolved', 'Debrief'];
const SEVERITIES: SecPriority[] = ['Critical', 'High', 'Medium', 'Low'];
const UPDATE_TYPES: SecCrisisUpdateType[] = [
  'Status Update', 'Communication', 'Decision', 'Escalation',
  'Team Mobilized', 'BCP Activated', 'Note',
];

const STATUS_TONE: Record<SecCrisisStatus, StatusTone> = {
  Monitoring: 'info',
  Active: 'danger',
  Stabilizing: 'warning',
  Resolved: 'success',
  Debrief: 'accent',
};

const SEVERITY_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const UPDATE_DOT: Record<SecCrisisUpdateType, string> = {
  'Crisis Declared': 'bg-red-500',
  'Team Mobilized': 'bg-indigo-500',
  'Status Update': 'bg-blue-500',
  Communication: 'bg-cyan-500',
  Decision: 'bg-violet-500',
  Escalation: 'bg-orange-500',
  'BCP Activated': 'bg-emerald-500',
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No crises found.</td></tr>
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

const CrisisManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [crises, setCrises] = useState<SecCrisis[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [incidents, setIncidents] = useState<SecIncident[]>([]);
  const [bcpPlans, setBcpPlans] = useState<SecBcpPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecCrisisStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecCrisisType>('all');
  const [filterSeverity, setFilterSeverity] = useState<'all' | SecPriority>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecCrisis | null>(null);
  const [detail, setDetail] = useState<SecCrisisDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecCrisis | null>(null);

  // Update form (detail modal)
  const [updType, setUpdType] = useState<SecCrisisUpdateType>('Status Update');
  const [updMessage, setUpdMessage] = useState('');

  const emptyForm = {
    title: '', crisisType: 'Other' as SecCrisisType, severity: 'High' as SecPriority,
    location: '', crisisLead: '', commsChannel: '', summary: '',
    incidentId: '', bcpPlanId: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s, i, b] = await Promise.all([
        fetchSecCrises(currentPropertyId),
        fetchSecStaff(currentPropertyId),
        fetchSecIncidents(currentPropertyId),
        fetchSecBcpPlans(currentPropertyId),
      ]);
      setCrises(c);
      setStaff(s);
      setIncidents(i);
      setBcpPlans(b);
    } catch (e: any) {
      setError(e?.message || 'Failed to load crises');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecCrisis(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load crisis detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (c: SecCrisis) => {
    setDetail(null);
    setUpdType('Status Update');
    setUpdMessage('');
    loadDetail(c.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.crisis.id);
    addNotification('Crisis register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    active: crises.filter(c => c.status === 'Active').length,
    critical: crises.filter(c => c.severity === 'Critical' && !['Resolved', 'Debrief'].includes(c.status)).length,
    stabilizing: crises.filter(c => c.status === 'Stabilizing' || c.status === 'Monitoring').length,
    resolved: crises.filter(c => c.status === 'Resolved' || c.status === 'Debrief').length,
  }), [crises]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return crises.filter(c => {
      const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
      const matchesType = filterType === 'all' || c.crisis_type === filterType;
      const matchesSeverity = filterSeverity === 'all' || c.severity === filterSeverity;
      const matchesSearch = !q ||
        c.id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.location?.toLowerCase().includes(q) ?? false) ||
        (c.crisis_lead?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSeverity && matchesSearch;
    });
  }, [crises, filterStatus, filterType, filterSeverity, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (c: SecCrisis) => {
    setEditing(c);
    setForm({
      title: c.title,
      crisisType: c.crisis_type,
      severity: c.severity,
      location: c.location || '',
      crisisLead: c.crisis_lead || '',
      commsChannel: c.comms_channel || '',
      summary: c.summary || '',
      incidentId: c.incident_id || '',
      bcpPlanId: c.bcp_plan_id || '',
    });
    setShowForm(true);
  };

  const saveCrisis = async () => {
    if (!form.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: form.title.trim(),
        crisisType: form.crisisType,
        severity: form.severity,
        location: form.location || null,
        crisisLead: form.crisisLead || null,
        commsChannel: form.commsChannel || null,
        summary: form.summary || null,
        incidentId: form.incidentId || null,
        bcpPlanId: form.bcpPlanId || null,
      };
      if (editing) {
        const res = await updateSecCrisis(editing.id, payload);
        setCrises(prev => prev.map(c => (c.id === editing.id ? res.crisis : c)));
        if (detail?.crisis.id === editing.id) loadDetail(editing.id);
        addNotification(`Crisis ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecCrisis({ propertyId: currentPropertyId, ...payload });
        setCrises(prev => [created, ...prev]);
        addNotification(`Crisis declared — ${created.id}`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save crisis', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchCrisis = async (c: SecCrisis, patch: Parameters<typeof updateSecCrisis>[1], toast?: string) => {
    setActingOn(c.id);
    try {
      const res = await updateSecCrisis(c.id, patch);
      setCrises(prev => prev.map(x => (x.id === c.id ? res.crisis : x)));
      if (detail?.crisis.id === c.id) loadDetail(c.id);
      addNotification(toast || `Crisis ${c.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitUpdate = async () => {
    if (!detail) return;
    if (!updMessage.trim()) {
      addNotification('Write an update message', 'warning', 'Security');
      return;
    }
    setActingOn(detail.crisis.id);
    try {
      await addSecCrisisUpdate(detail.crisis.id, { updateType: updType, message: updMessage.trim() });
      await loadDetail(detail.crisis.id);
      setUpdMessage('');
      addNotification(`${updType} logged`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeCrisis = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecCrisis(deleteTarget.id);
      setCrises(prev => prev.filter(c => c.id !== deleteTarget.id));
      if (detail?.crisis.id === deleteTarget.id) setDetail(null);
      addNotification(`Crisis ${deleteTarget.id} removed`, 'task', 'Security');
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
        title="Crisis Management"
        subtitle="Crisis team management, communication, and decision tracking"
        icon={Radio}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Siren className="w-4 h-4" /> Activate Crisis
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Crises" value={stats.active} icon={Siren} tone="danger" />
        <StatCard title="Critical Severity" value={stats.critical} icon={AlertOctagon} tone="danger" />
        <StatCard title="Monitoring / Stabilizing" value={stats.stabilizing} icon={Eye} tone="warning" />
        <StatCard title="Resolved & Debrief" value={stats.resolved} icon={CheckCircle2} tone="success" />
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
              placeholder="Search title, ID, location, lead…"
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
            <Tag size={12} className="text-slate-400" />
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
              <option value="all">All Types</option>
              {CRISIS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertOctagon size={12} className="text-slate-400" />
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value as any)} className={filterSelect}>
              <option value="all">All Severity</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Crisis register */}
      <SectionCard title="Crisis Register" subtitle="Crisis · Type · Severity · Status · Lead · Activated" icon={Radio} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Crisis', 'Type', 'Severity', 'Status', 'Crisis Lead', 'Activated', '']}
            rows={filtered.map(c => [
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg shrink-0 ${c.status === 'Active' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                  <Radio className={`w-4 h-4 ${c.status === 'Active' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(c)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{c.title}</button>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {c.id}{c.location ? ` · ${c.location}` : ''}
                    {c.bcp_plan_id ? ` · BCP ${c.bcp_plan_id}` : ''}
                  </div>
                </div>
              </div>,
              <Badge tone="neutral">{c.crisis_type}</Badge>,
              <Badge tone={SEVERITY_TONE[c.severity]}>{c.severity}</Badge>,
              <select
                value={c.status}
                onChange={e => patchCrisis(c, { status: e.target.value as SecCrisisStatus }, `Crisis ${c.id} → ${e.target.value}`)}
                disabled={actingOn === c.id}
                className={inlineStatusSelect}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{c.crisis_lead || '—'}</span>,
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} />{fmtDateTime(c.activated_at)}</span>,
              <div className="inline-flex gap-2">
                <button onClick={() => openDetail(c)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={7}
          />
        )}
      </SectionCard>

      {/* New / Edit crisis modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveCrisis}
        title={editing ? `Edit ${editing.id}` : 'Activate Crisis'}
        subtitle={editing ? editing.title : 'Declare a crisis and mobilize the response team'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Declare Crisis'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Crisis Title">
              <input className={inputClass} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Kitchen Gas Leak — Partial Evacuation" />
            </Field>
            <Field label="Crisis Type">
              <select className={inputClass} value={form.crisisType} onChange={e => setForm(f => ({ ...f, crisisType: e.target.value as SecCrisisType }))}>
                {CRISIS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Situation Summary">
            <textarea className={inputClass + ' min-h-[56px]'} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} placeholder="What happened, scope, immediate exposure…" />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Severity">
              <select className={inputClass} value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value as SecPriority }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Main Kitchen / IT Systems" />
            </Field>
            <Field label="Comms Channel">
              <input className={inputClass} value={form.commsChannel} onChange={e => setForm(f => ({ ...f, commsChannel: e.target.value }))} placeholder="e.g., Radio CH-1 + WhatsApp" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Crisis Lead">
              <input
                className={inputClass}
                list="sec-crisis-leads"
                value={form.crisisLead}
                onChange={e => setForm(f => ({ ...f, crisisLead: e.target.value }))}
                placeholder="Select or type lead"
              />
              <datalist id="sec-crisis-leads">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Linked Incident">
              <select className={inputClass} value={form.incidentId} onChange={e => setForm(f => ({ ...f, incidentId: e.target.value }))}>
                <option value="">None</option>
                {incidents.map(i => <option key={i.id} value={i.id}>{i.id} — {i.category || i.incident_type || 'Incident'}</option>)}
              </select>
            </Field>
            <Field label="Linked BCP Plan">
              <select className={inputClass} value={form.bcpPlanId} onChange={e => setForm(f => ({ ...f, bcpPlanId: e.target.value }))}>
                <option value="">None</option>
                {bcpPlans.map(p => <option key={p.id} value={p.id}>{p.id} — {p.title}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Crisis detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Crisis ${detail.crisis.id}` : 'Crisis Detail'}
        subtitle={detail ? `${detail.crisis.title} · ${detail.crisis.crisis_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            {detail.crisis.status === 'Active' && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm font-bold text-red-700 dark:text-red-300">
                <Siren className="w-4 h-4 animate-pulse" /> ACTIVE CRISIS — response team engaged
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.crisis.status]}>{detail.crisis.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Severity</p>
                <Badge tone={SEVERITY_TONE[detail.crisis.severity]}>{detail.crisis.severity}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Crisis Lead</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.crisis.crisis_lead || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><MapPin size={11} />{detail.crisis.location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Comms Channel</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><Megaphone size={11} />{detail.crisis.comms_channel || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Activated</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.crisis.activated_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Resolved</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.crisis.resolved_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Links</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1 text-xs">
                  <Link2 size={11} />
                  {detail.crisis.incident_id ? `INC ${detail.crisis.incident_id}` : ''}
                  {detail.crisis.incident_id && detail.crisis.bcp_plan_id ? ' · ' : ''}
                  {detail.crisis.bcp_plan_id ? `BCP ${detail.crisis.bcp_plan_id}` : ''}
                  {!detail.crisis.incident_id && !detail.crisis.bcp_plan_id ? '—' : ''}
                </p>
              </div>
              {detail.crisis.summary && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Situation Summary</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.crisis.summary}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.crisis.status === 'Monitoring' && (
                <button onClick={() => patchCrisis(detail.crisis, { status: 'Active' }, `Crisis ${detail.crisis.id} activated`)} disabled={actingOn === detail.crisis.id} className={button.primary + ' disabled:opacity-50'}>
                  <Siren className="w-4 h-4" /> Activate
                </button>
              )}
              {detail.crisis.status === 'Active' && (
                <button onClick={() => patchCrisis(detail.crisis, { status: 'Stabilizing' }, `Crisis ${detail.crisis.id} stabilizing`)} disabled={actingOn === detail.crisis.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Scale className="w-4 h-4" /> Mark Stabilizing
                </button>
              )}
              {(detail.crisis.status === 'Active' || detail.crisis.status === 'Stabilizing') && (
                <button onClick={() => patchCrisis(detail.crisis, { status: 'Resolved' }, `Crisis ${detail.crisis.id} resolved`)} disabled={actingOn === detail.crisis.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Resolve
                </button>
              )}
              {detail.crisis.status === 'Resolved' && (
                <button onClick={() => patchCrisis(detail.crisis, { status: 'Debrief' }, `Crisis ${detail.crisis.id} → debrief`)} disabled={actingOn === detail.crisis.id} className={button.secondary + ' disabled:opacity-50'}>
                  <History className="w-4 h-4" /> Move to Debrief
                </button>
              )}
              {detail.crisis.status === 'Debrief' && (
                <button onClick={() => patchCrisis(detail.crisis, { status: 'Monitoring' }, `Crisis ${detail.crisis.id} reopened`)} disabled={actingOn === detail.crisis.id} className={button.secondary + ' disabled:opacity-50'}>
                  Reopen
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.crisis); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.crisis)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Log update form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <Megaphone className="w-4 h-4 text-[var(--color-accent-operations)]" /> Log Update
              </h4>
              <div className="flex flex-wrap gap-2">
                <select className={inputClass + ' !w-auto'} value={updType} onChange={e => setUpdType(e.target.value as SecCrisisUpdateType)}>
                  {UPDATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  className={inputClass + ' flex-1 min-w-[200px]'}
                  value={updMessage}
                  onChange={e => setUpdMessage(e.target.value)}
                  placeholder="Situation update, communication sent, decision made…"
                />
                <button onClick={submitUpdate} disabled={actingOn === detail.crisis.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Log
                </button>
              </div>
            </div>

            {/* Update timeline */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Communications & Decision Log
              </h4>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {detail.updates.map((u, idx) => (
                  <div key={u.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${UPDATE_DOT[u.update_type]}`} />
                      {idx < detail.updates.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <p className="text-sm text-slate-900 dark:text-white">{u.message}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                        <span className="font-bold uppercase">{u.update_type}</span>
                        <span>· {fmtDateTime(u.created_at)}</span>
                        {u.actor && <span>· {u.actor}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {detail.updates.length === 0 && <p className="text-xs text-slate-400">No updates logged yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeCrisis}
        title="Remove Crisis"
        subtitle={deleteTarget ? `Permanently remove crisis ${deleteTarget.id} (${deleteTarget.title}) and its update log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default CrisisManagement;
