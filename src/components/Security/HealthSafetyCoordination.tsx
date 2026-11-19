/**
 * Health & Safety Coordination — /erp/security/health-safety.
 *
 * DB-integrated via /api/sec-portal/safety-inspections and
 * /api/sec-portal/safety-hazards routes (migration 614).
 * `sec_safety_inspections` is the inspection register (Scheduled →
 * In Progress → Completed/Cancelled with Pass/Pass with Notes/Fail
 * result). `sec_safety_hazards` is the hazard register with a
 * Reported → Assessed → Corrective Action → Resolved → Closed
 * lifecycle; a hazard can be linked to the inspection that found it
 * (inspection_id, SET NULL on inspection delete).
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Heart, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, User, Tag, MapPin,
  AlertTriangle, ClipboardCheck, ShieldAlert, CalendarClock,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecSafetyInspections, createSecSafetyInspection,
  updateSecSafetyInspection, deleteSecSafetyInspection,
  fetchSecSafetyHazards, createSecSafetyHazard,
  updateSecSafetyHazard, deleteSecSafetyHazard, fetchSecStaff,
  type SecSafetyInspection, type SecSafetyHazard,
  type SecInspectionType, type SecInspectionStatus, type SecInspectionResult,
  type SecHazardType, type SecHazardStatus, type SecPriority, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const INSPECTION_TYPES: SecInspectionType[] = [
  'Routine', 'Fire Safety', 'Pool Safety', 'Kitchen Hygiene',
  'Workplace', 'Compliance', 'Other',
];
const INSPECTION_STATUSES: SecInspectionStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const INSPECTION_RESULTS: SecInspectionResult[] = ['Pass', 'Pass with Notes', 'Fail'];

const HAZARD_TYPES: SecHazardType[] = [
  'Slip-Trip-Fall', 'Electrical', 'Chemical', 'Fire',
  'Structural', 'Ergonomic', 'Biological', 'Other',
];
const HAZARD_STATUSES: SecHazardStatus[] = ['Reported', 'Assessed', 'Corrective Action', 'Resolved', 'Closed'];
const SEVERITIES: SecPriority[] = ['Critical', 'High', 'Medium', 'Low'];

const RESULT_TONE: Record<SecInspectionResult, StatusTone> = {
  Pass: 'success', 'Pass with Notes': 'warning', Fail: 'danger',
};

const HAZARD_STATUS_TONE: Record<SecHazardStatus, StatusTone> = {
  Reported: 'danger',
  Assessed: 'warning',
  'Corrective Action': 'info',
  Resolved: 'success',
  Closed: 'neutral',
};

const SEVERITY_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
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

function DataTable({ headers, rows, empty, emptyColSpan, emptyText }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
  emptyText: string;
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">{emptyText}</td></tr>
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

const HealthSafetyCoordination: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [inspections, setInspections] = useState<SecSafetyInspection[]>([]);
  const [hazards, setHazards] = useState<SecSafetyHazard[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tab, setTab] = useState<'inspections' | 'hazards'>('inspections');

  // Inspection filters
  const [inspSearch, setInspSearch] = useState('');
  const [inspFilterStatus, setInspFilterStatus] = useState<'all' | SecInspectionStatus>('all');
  const [inspFilterType, setInspFilterType] = useState<'all' | SecInspectionType>('all');

  // Hazard filters
  const [hazSearch, setHazSearch] = useState('');
  const [hazFilterStatus, setHazFilterStatus] = useState<'all' | SecHazardStatus>('all');
  const [hazFilterSeverity, setHazFilterSeverity] = useState<'all' | SecPriority>('all');
  const [hazFilterType, setHazFilterType] = useState<'all' | SecHazardType>('all');

  // Inspection modals
  const [showInspForm, setShowInspForm] = useState(false);
  const [editingInsp, setEditingInsp] = useState<SecSafetyInspection | null>(null);
  const [completeInspTarget, setCompleteInspTarget] = useState<SecSafetyInspection | null>(null);
  const [deleteInspTarget, setDeleteInspTarget] = useState<SecSafetyInspection | null>(null);

  // Inspection completion form
  const [inspResult, setInspResult] = useState<SecInspectionResult>('Pass');
  const [inspFindings, setInspFindings] = useState('');

  // Hazard modals
  const [showHazForm, setShowHazForm] = useState(false);
  const [editingHaz, setEditingHaz] = useState<SecSafetyHazard | null>(null);
  const [hazDetail, setHazDetail] = useState<SecSafetyHazard | null>(null);
  const [deleteHazTarget, setDeleteHazTarget] = useState<SecSafetyHazard | null>(null);

  const emptyInspForm = {
    title: '', inspectionType: 'Routine' as SecInspectionType, area: '',
    inspector: '', scheduledAt: '', findings: '',
  };
  const [inspForm, setInspForm] = useState({ ...emptyInspForm });

  const emptyHazForm = {
    title: '', hazardType: 'Other' as SecHazardType, severity: 'Medium' as SecPriority,
    location: '', description: '', correctiveAction: '', reportedBy: '',
    assignedTo: '', inspectionId: '',
  };
  const [hazForm, setHazForm] = useState({ ...emptyHazForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, h, s] = await Promise.all([
        fetchSecSafetyInspections(currentPropertyId),
        fetchSecSafetyHazards(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setInspections(i);
      setHazards(h);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load health & safety data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const refreshAll = async () => {
    await load();
    addNotification('Health & safety data refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    openHazards: hazards.filter(h => !['Resolved', 'Closed'].includes(h.status)).length,
    criticalHazards: hazards.filter(h => (h.severity === 'Critical' || h.severity === 'High') && !['Resolved', 'Closed'].includes(h.status)).length,
    inspScheduled: inspections.filter(i => i.status === 'Scheduled' || i.status === 'In Progress').length,
    inspFailed: inspections.filter(i => i.result === 'Fail').length,
  }), [inspections, hazards]);

  const filteredInspections = useMemo(() => {
    const q = inspSearch.toLowerCase();
    return inspections.filter(i => {
      const matchesStatus = inspFilterStatus === 'all' || i.status === inspFilterStatus;
      const matchesType = inspFilterType === 'all' || i.inspection_type === inspFilterType;
      const matchesSearch = !q ||
        i.id.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        (i.area?.toLowerCase().includes(q) ?? false) ||
        (i.inspector?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [inspections, inspFilterStatus, inspFilterType, inspSearch]);

  const filteredHazards = useMemo(() => {
    const q = hazSearch.toLowerCase();
    return hazards.filter(h => {
      const matchesStatus = hazFilterStatus === 'all' || h.status === hazFilterStatus;
      const matchesSeverity = hazFilterSeverity === 'all' || h.severity === hazFilterSeverity;
      const matchesType = hazFilterType === 'all' || h.hazard_type === hazFilterType;
      const matchesSearch = !q ||
        h.id.toLowerCase().includes(q) ||
        h.title.toLowerCase().includes(q) ||
        (h.location?.toLowerCase().includes(q) ?? false) ||
        (h.assigned_to?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesSeverity && matchesType && matchesSearch;
    });
  }, [hazards, hazFilterStatus, hazFilterSeverity, hazFilterType, hazSearch]);

  // ── Inspection mutations ───────────────────────────────────────────────

  const openNewInspection = () => {
    setEditingInsp(null);
    setInspForm({ ...emptyInspForm });
    setShowInspForm(true);
  };

  const openEditInspection = (i: SecSafetyInspection) => {
    setEditingInsp(i);
    setInspForm({
      title: i.title,
      inspectionType: i.inspection_type,
      area: i.area || '',
      inspector: i.inspector || '',
      scheduledAt: i.scheduled_at ? i.scheduled_at.slice(0, 16) : '',
      findings: i.findings || '',
    });
    setShowInspForm(true);
  };

  const saveInspection = async () => {
    if (!inspForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: inspForm.title.trim(),
        inspectionType: inspForm.inspectionType,
        area: inspForm.area || null,
        inspector: inspForm.inspector || null,
        scheduledAt: inspForm.scheduledAt || null,
        findings: inspForm.findings || null,
      };
      if (editingInsp) {
        const res = await updateSecSafetyInspection(editingInsp.id, payload);
        setInspections(prev => prev.map(i => (i.id === editingInsp.id ? res.inspection : i)));
        addNotification(`Inspection ${editingInsp.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecSafetyInspection({ propertyId: currentPropertyId, ...payload });
        setInspections(prev => [created, ...prev]);
        addNotification(`Inspection scheduled — ${created.id}`, 'task', 'Security');
      }
      setShowInspForm(false);
      setEditingInsp(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save inspection', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchInspection = async (i: SecSafetyInspection, patch: Parameters<typeof updateSecSafetyInspection>[1], toast?: string) => {
    setActingOn(i.id);
    try {
      const res = await updateSecSafetyInspection(i.id, patch);
      setInspections(prev => prev.map(x => (x.id === i.id ? res.inspection : x)));
      addNotification(toast || `Inspection ${i.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const openCompleteInspection = (i: SecSafetyInspection) => {
    setCompleteInspTarget(i);
    setInspResult('Pass');
    setInspFindings(i.findings || '');
  };

  const submitCompleteInspection = async () => {
    if (!completeInspTarget) return;
    setSubmitting(true);
    try {
      const res = await updateSecSafetyInspection(completeInspTarget.id, {
        status: 'Completed',
        result: inspResult,
        findings: inspFindings || null,
      });
      setInspections(prev => prev.map(x => (x.id === completeInspTarget.id ? res.inspection : x)));
      addNotification(`Inspection ${completeInspTarget.id} completed — ${inspResult}`, 'task', 'Security');
      setCompleteInspTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to complete inspection', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const removeInspection = async () => {
    if (!deleteInspTarget) return;
    setActingOn(deleteInspTarget.id);
    try {
      await deleteSecSafetyInspection(deleteInspTarget.id);
      setInspections(prev => prev.filter(i => i.id !== deleteInspTarget.id));
      addNotification(`Inspection ${deleteInspTarget.id} removed`, 'task', 'Security');
      setDeleteInspTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Hazard mutations ───────────────────────────────────────────────────

  const openNewHazard = () => {
    setEditingHaz(null);
    setHazForm({ ...emptyHazForm });
    setShowHazForm(true);
  };

  const openEditHazard = (h: SecSafetyHazard) => {
    setEditingHaz(h);
    setHazForm({
      title: h.title,
      hazardType: h.hazard_type,
      severity: h.severity,
      location: h.location || '',
      description: h.description || '',
      correctiveAction: h.corrective_action || '',
      reportedBy: h.reported_by || '',
      assignedTo: h.assigned_to || '',
      inspectionId: h.inspection_id || '',
    });
    setShowHazForm(true);
  };

  const saveHazard = async () => {
    if (!hazForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: hazForm.title.trim(),
        hazardType: hazForm.hazardType,
        severity: hazForm.severity,
        location: hazForm.location || null,
        description: hazForm.description || null,
        correctiveAction: hazForm.correctiveAction || null,
        reportedBy: hazForm.reportedBy || null,
        assignedTo: hazForm.assignedTo || null,
        inspectionId: hazForm.inspectionId || null,
      };
      if (editingHaz) {
        const res = await updateSecSafetyHazard(editingHaz.id, payload);
        setHazards(prev => prev.map(h => (h.id === editingHaz.id ? res.hazard : h)));
        if (hazDetail?.id === editingHaz.id) setHazDetail(res.hazard);
        addNotification(`Hazard ${editingHaz.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecSafetyHazard({ propertyId: currentPropertyId, ...payload });
        setHazards(prev => [created, ...prev]);
        addNotification(`Hazard reported — ${created.id}`, 'task', 'Security');
      }
      setShowHazForm(false);
      setEditingHaz(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save hazard', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchHazard = async (h: SecSafetyHazard, patch: Parameters<typeof updateSecSafetyHazard>[1], toast?: string) => {
    setActingOn(h.id);
    try {
      const res = await updateSecSafetyHazard(h.id, patch);
      setHazards(prev => prev.map(x => (x.id === h.id ? res.hazard : x)));
      if (hazDetail?.id === h.id) setHazDetail(res.hazard);
      addNotification(toast || `Hazard ${h.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeHazard = async () => {
    if (!deleteHazTarget) return;
    setActingOn(deleteHazTarget.id);
    try {
      await deleteSecSafetyHazard(deleteHazTarget.id);
      setHazards(prev => prev.filter(h => h.id !== deleteHazTarget.id));
      if (hazDetail?.id === deleteHazTarget.id) setHazDetail(null);
      addNotification(`Hazard ${deleteHazTarget.id} removed`, 'task', 'Security');
      setDeleteHazTarget(null);
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
        title="Health & Safety Coordination"
        subtitle="Safety inspections, hazard identification, and corrective actions"
        icon={Heart}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {tab === 'inspections' ? (
              <button onClick={openNewInspection} className={button.primary}>
                <Plus className="w-4 h-4" /> New Inspection
              </button>
            ) : (
              <button onClick={openNewHazard} className={button.primary}>
                <Plus className="w-4 h-4" /> Report Hazard
              </button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Hazards" value={stats.openHazards} icon={AlertTriangle} tone="danger" />
        <StatCard title="Critical / High" value={stats.criticalHazards} icon={ShieldAlert} tone="warning" />
        <StatCard title="Inspections Scheduled" value={stats.inspScheduled} icon={ClipboardCheck} tone="info" />
        <StatCard title="Failed Inspections" value={stats.inspFailed} icon={ServerCrash} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Sub-tab pills */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
        {([
          ['inspections', 'Safety Inspections', ClipboardCheck],
          ['hazards', 'Hazard Register', AlertTriangle],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition ${
              tab === key
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* ── Inspections tab ── */}
      {tab === 'inspections' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={inspSearch}
                  onChange={e => setInspSearch(e.target.value)}
                  placeholder="Search title, ID, area, inspector…"
                  className={inputClass + ' pl-9'}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={inspFilterStatus} onChange={e => setInspFilterStatus(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {INSPECTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={inspFilterType} onChange={e => setInspFilterType(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Inspection Register" subtitle="Inspection · Type · Area · Inspector · Schedule · Status · Result" icon={ClipboardCheck} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Inspection', 'Type', 'Area', 'Inspector', 'Scheduled', 'Status', 'Result', '']}
                rows={filteredInspections.map(i => [
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${i.result === 'Fail' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                      <ClipboardCheck className={`w-4 h-4 ${i.result === 'Fail' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white">{i.title}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{i.id}</p>
                    </div>
                  </div>,
                  <Badge tone="neutral">{i.inspection_type}</Badge>,
                  <span className="text-xs flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{i.area || '—'}</span>,
                  <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{i.inspector || '—'}</span>,
                  <span className="text-xs text-slate-500 flex items-center gap-1"><CalendarClock size={11} />{fmtDateTime(i.scheduled_at)}</span>,
                  <div className="inline-flex items-center gap-2">
                    <select
                      value={i.status}
                      onChange={e => patchInspection(i, { status: e.target.value as SecInspectionStatus }, `Inspection ${i.id} → ${e.target.value}`)}
                      disabled={actingOn === i.id || i.status === 'Completed'}
                      className={inlineStatusSelect}
                    >
                      {INSPECTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {(i.status === 'Scheduled' || i.status === 'In Progress') && (
                      <button onClick={() => openCompleteInspection(i)} disabled={actingOn === i.id} className={button.ghost + ' !px-2 !py-1 text-[10px]'} title="Record result">
                        <CheckCircle2 size={12} /> Complete
                      </button>
                    )}
                  </div>,
                  i.result ? <Badge tone={RESULT_TONE[i.result]}>{i.result}</Badge> : <span className="text-xs text-slate-400">—</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => openEditInspection(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteInspTarget(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      {actingOn === i.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ])}
                empty={filteredInspections.length === 0}
                emptyColSpan={8}
                emptyText="No inspections found."
              />
            )}
          </SectionCard>
        </>
      )}

      {/* ── Hazards tab ── */}
      {tab === 'hazards' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={hazSearch}
                  onChange={e => setHazSearch(e.target.value)}
                  placeholder="Search hazard, ID, location, assignee…"
                  className={inputClass + ' pl-9'}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={hazFilterStatus} onChange={e => setHazFilterStatus(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {HAZARD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldAlert size={12} className="text-slate-400" />
                <select value={hazFilterSeverity} onChange={e => setHazFilterSeverity(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Severity</option>
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={hazFilterType} onChange={e => setHazFilterType(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {HAZARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Hazard Register" subtitle="Hazard · Type · Severity · Status · Location · Assigned" icon={AlertTriangle} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Hazard', 'Type', 'Severity', 'Status', 'Location', 'Assigned To', 'Identified', '']}
                rows={filteredHazards.map(h => [
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${h.severity === 'Critical' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                      <AlertTriangle className={`w-4 h-4 ${h.severity === 'Critical' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                    </div>
                    <div className="min-w-0">
                      <button onClick={() => setHazDetail(h)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{h.title}</button>
                      <p className="text-[10px] text-slate-400 font-mono">{h.id}{h.inspection_id ? ` · via ${h.inspection_id}` : ''}</p>
                    </div>
                  </div>,
                  <Badge tone="neutral">{h.hazard_type}</Badge>,
                  <Badge tone={SEVERITY_TONE[h.severity]}>{h.severity}</Badge>,
                  <select
                    value={h.status}
                    onChange={e => patchHazard(h, { status: e.target.value as SecHazardStatus }, `Hazard ${h.id} → ${e.target.value}`)}
                    disabled={actingOn === h.id}
                    className={inlineStatusSelect}
                  >
                    {HAZARD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>,
                  <span className="text-xs flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{h.location || '—'}</span>,
                  <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{h.assigned_to || '—'}</span>,
                  <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} />{fmtDateTime(h.identified_at)}</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => setHazDetail(h)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openEditHazard(h)} disabled={actingOn === h.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteHazTarget(h)} disabled={actingOn === h.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      {actingOn === h.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ])}
                empty={filteredHazards.length === 0}
                emptyColSpan={8}
                emptyText="No hazards reported."
              />
            )}
          </SectionCard>
        </>
      )}

      {/* New / Edit inspection modal */}
      <ModalSystem
        isOpen={showInspForm}
        onClose={() => { setShowInspForm(false); setEditingInsp(null); }}
        onConfirm={saveInspection}
        title={editingInsp ? `Edit ${editingInsp.id}` : 'New Safety Inspection'}
        subtitle={editingInsp ? editingInsp.title : 'Schedule a safety inspection'}
        variant="form"
        loading={submitting}
        confirmLabel={editingInsp ? 'Save Changes' : 'Schedule Inspection'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Inspection Title">
              <input className={inputClass} value={inspForm.title} onChange={e => setInspForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Pool Area Safety Inspection" />
            </Field>
            <Field label="Type">
              <select className={inputClass} value={inspForm.inspectionType} onChange={e => setInspForm(f => ({ ...f, inspectionType: e.target.value as SecInspectionType }))}>
                {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Area">
              <input className={inputClass} value={inspForm.area} onChange={e => setInspForm(f => ({ ...f, area: e.target.value }))} placeholder="e.g., Pool Deck" />
            </Field>
            <Field label="Inspector">
              <input
                className={inputClass}
                list="sec-inspectors"
                value={inspForm.inspector}
                onChange={e => setInspForm(f => ({ ...f, inspector: e.target.value }))}
                placeholder="Select or type inspector"
              />
              <datalist id="sec-inspectors">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Scheduled At">
              <input type="datetime-local" className={inputClass} value={inspForm.scheduledAt} onChange={e => setInspForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Scope / Notes">
            <textarea className={inputClass + ' min-h-[56px]'} value={inspForm.findings} onChange={e => setInspForm(f => ({ ...f, findings: e.target.value }))} placeholder="What this inspection covers…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Inspection result modal */}
      <ModalSystem
        isOpen={!!completeInspTarget}
        onClose={() => setCompleteInspTarget(null)}
        onConfirm={submitCompleteInspection}
        title="Record Inspection Result"
        subtitle={completeInspTarget ? `${completeInspTarget.id} — ${completeInspTarget.title}` : ''}
        variant="form"
        loading={submitting}
        confirmLabel="Complete Inspection"
      >
        <div className="space-y-4">
          <Field label="Result">
            <div className="flex gap-2">
              {INSPECTION_RESULTS.map(r => (
                <button
                  key={r}
                  onClick={() => setInspResult(r)}
                  className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition ${
                    inspResult === r
                      ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/10 text-slate-900 dark:text-white'
                      : 'border-gray-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Findings">
            <textarea className={inputClass + ' min-h-[72px]'} value={inspFindings} onChange={e => setInspFindings(e.target.value)} placeholder="Observations, deficiencies found, follow-ups needed…" />
          </Field>
          <p className="text-[11px] text-slate-400">A Fail result should be followed by logging the deficiencies as hazards in the Hazard Register.</p>
        </div>
      </ModalSystem>

      {/* New / Edit hazard modal */}
      <ModalSystem
        isOpen={showHazForm}
        onClose={() => { setShowHazForm(false); setEditingHaz(null); }}
        onConfirm={saveHazard}
        title={editingHaz ? `Edit ${editingHaz.id}` : 'Report Hazard'}
        subtitle={editingHaz ? editingHaz.title : 'Log a safety hazard for corrective action'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editingHaz ? 'Save Changes' : 'Report Hazard'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Hazard Title">
              <input className={inputClass} value={hazForm.title} onChange={e => setHazForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Wet floor — lobby entrance" />
            </Field>
            <Field label="Hazard Type">
              <select className={inputClass} value={hazForm.hazardType} onChange={e => setHazForm(f => ({ ...f, hazardType: e.target.value as SecHazardType }))}>
                {HAZARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass + ' min-h-[56px]'} value={hazForm.description} onChange={e => setHazForm(f => ({ ...f, description: e.target.value }))} placeholder="What is the hazard, exposure, who is at risk…" />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Severity">
              <select className={inputClass} value={hazForm.severity} onChange={e => setHazForm(f => ({ ...f, severity: e.target.value as SecPriority }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className={inputClass} value={hazForm.location} onChange={e => setHazForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Pool Deck" />
            </Field>
            <Field label="Linked Inspection">
              <select className={inputClass} value={hazForm.inspectionId} onChange={e => setHazForm(f => ({ ...f, inspectionId: e.target.value }))}>
                <option value="">None</option>
                {inspections.map(i => <option key={i.id} value={i.id}>{i.id} — {i.title}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Reported By">
              <input
                className={inputClass}
                list="sec-hazard-reporters"
                value={hazForm.reportedBy}
                onChange={e => setHazForm(f => ({ ...f, reportedBy: e.target.value }))}
                placeholder="Select or type reporter"
              />
              <datalist id="sec-hazard-reporters">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Assigned To">
              <input
                className={inputClass}
                list="sec-hazard-assignees"
                value={hazForm.assignedTo}
                onChange={e => setHazForm(f => ({ ...f, assignedTo: e.target.value }))}
                placeholder="Select or type assignee"
              />
              <datalist id="sec-hazard-assignees">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
          </div>
          <Field label="Corrective Action">
            <textarea className={inputClass + ' min-h-[56px]'} value={hazForm.correctiveAction} onChange={e => setHazForm(f => ({ ...f, correctiveAction: e.target.value }))} placeholder="Planned or taken corrective measures…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Hazard detail modal */}
      <ModalSystem
        isOpen={!!hazDetail}
        onClose={() => setHazDetail(null)}
        title={hazDetail ? `Hazard ${hazDetail.id}` : 'Hazard Detail'}
        subtitle={hazDetail ? `${hazDetail.title} · ${hazDetail.hazard_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {hazDetail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={HAZARD_STATUS_TONE[hazDetail.status]}>{hazDetail.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Severity</p>
                <Badge tone={SEVERITY_TONE[hazDetail.severity]}>{hazDetail.severity}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><MapPin size={11} />{hazDetail.location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reported By</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><User size={11} />{hazDetail.reported_by || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Assigned To</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{hazDetail.assigned_to || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Identified</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(hazDetail.identified_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Resolved</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(hazDetail.resolved_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Linked Inspection</p>
                <p className="text-slate-600 dark:text-slate-300 text-xs">{hazDetail.sec_safety_inspections?.title || hazDetail.inspection_id || '—'}</p>
              </div>
              {hazDetail.description && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{hazDetail.description}</p>
                </div>
              )}
              {hazDetail.corrective_action && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Corrective Action</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{hazDetail.corrective_action}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {hazDetail.status === 'Reported' && (
                <button onClick={() => patchHazard(hazDetail, { status: 'Assessed' }, `Hazard ${hazDetail.id} assessed`)} disabled={actingOn === hazDetail.id} className={button.primary + ' disabled:opacity-50'}>
                  <Eye className="w-4 h-4" /> Mark Assessed
                </button>
              )}
              {(hazDetail.status === 'Reported' || hazDetail.status === 'Assessed') && (
                <button onClick={() => patchHazard(hazDetail, { status: 'Corrective Action' }, `Corrective action started — ${hazDetail.id}`)} disabled={actingOn === hazDetail.id} className={button.secondary + ' disabled:opacity-50'}>
                  <AlertTriangle className="w-4 h-4" /> Start Corrective Action
                </button>
              )}
              {hazDetail.status === 'Corrective Action' && (
                <button onClick={() => patchHazard(hazDetail, { status: 'Resolved' }, `Hazard ${hazDetail.id} resolved`)} disabled={actingOn === hazDetail.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Mark Resolved
                </button>
              )}
              {hazDetail.status === 'Resolved' && (
                <button onClick={() => patchHazard(hazDetail, { status: 'Closed' }, `Hazard ${hazDetail.id} closed`)} disabled={actingOn === hazDetail.id} className={button.secondary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Verify & Close
                </button>
              )}
              {(hazDetail.status === 'Resolved' || hazDetail.status === 'Closed') && (
                <button onClick={() => patchHazard(hazDetail, { status: 'Reported' }, `Hazard ${hazDetail.id} reopened`)} disabled={actingOn === hazDetail.id} className={button.secondary + ' disabled:opacity-50'}>
                  Reopen
                </button>
              )}
              <button onClick={() => { setHazDetail(null); openEditHazard(hazDetail); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteHazTarget(hazDetail)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete inspection confirm */}
      <ModalSystem
        isOpen={!!deleteInspTarget}
        onClose={() => setDeleteInspTarget(null)}
        onConfirm={removeInspection}
        title="Remove Inspection"
        subtitle={deleteInspTarget ? `Permanently remove inspection ${deleteInspTarget.id} (${deleteInspTarget.title})? Linked hazards are kept.` : ''}
        variant="confirm"
        loading={actingOn === deleteInspTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />

      {/* Delete hazard confirm */}
      <ModalSystem
        isOpen={!!deleteHazTarget}
        onClose={() => setDeleteHazTarget(null)}
        onConfirm={removeHazard}
        title="Remove Hazard"
        subtitle={deleteHazTarget ? `Permanently remove hazard ${deleteHazTarget.id} (${deleteHazTarget.title})?` : ''}
        variant="confirm"
        loading={actingOn === deleteHazTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default HealthSafetyCoordination;
