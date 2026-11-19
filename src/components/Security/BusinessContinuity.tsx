/**
 * Business Continuity — /erp/security/business-continuity.
 *
 * DB-integrated via /api/sec-portal/bcp routes (migration 612).
 * `sec_bcp_plans` is the continuity / disaster-recovery plan register —
 * RTO/RPO objectives, activation triggers, recovery steps, test schedule,
 * and a Draft → Active → Under Review → Archived lifecycle.
 * `sec_bcp_exercises` is the per-plan test log (Tabletop / Simulation /
 * Full Test / Review); completing an exercise stamps the plan's
 * last_tested and rolls next_test_due forward server-side.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  RefreshCw, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, Loader2,
  ServerCrash, Filter, Clock, History, User, Tag, CalendarClock,
  LifeBuoy, FileText, ClipboardCheck, PlayCircle, ArchiveRestore,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecBcpPlans, fetchSecBcpPlan, createSecBcpPlan, updateSecBcpPlan,
  deleteSecBcpPlan, fetchSecBcpExercises, createSecBcpExercise,
  updateSecBcpExercise, deleteSecBcpExercise, fetchSecStaff,
  type SecBcpPlan, type SecBcpExercise, type SecBcpPlanDetail,
  type SecBcpPlanType, type SecBcpPlanStatus, type SecBcpExerciseType,
  type SecBcpExerciseStatus, type SecBcpExerciseResult, type SecPriority,
  type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const PLAN_TYPES: SecBcpPlanType[] = [
  'Disaster Recovery', 'Business Continuity', 'Emergency Response',
  'IT Recovery', 'Utility Outage', 'Pandemic Response', 'Other',
];
const PLAN_STATUSES: SecBcpPlanStatus[] = ['Draft', 'Active', 'Under Review', 'Archived'];
const CRITICALITIES: SecPriority[] = ['Critical', 'High', 'Medium', 'Low'];
const EXERCISE_TYPES: SecBcpExerciseType[] = ['Tabletop', 'Simulation', 'Full Test', 'Review'];
const EXERCISE_STATUSES: SecBcpExerciseStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const EXERCISE_RESULTS: SecBcpExerciseResult[] = ['Pass', 'Issues Found', 'Fail'];

const PLAN_STATUS_TONE: Record<SecBcpPlanStatus, StatusTone> = {
  Draft: 'neutral',
  Active: 'success',
  'Under Review': 'warning',
  Archived: 'neutral',
};

const CRIT_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const EXERCISE_STATUS_TONE: Record<SecBcpExerciseStatus, StatusTone> = {
  Scheduled: 'info',
  'In Progress': 'warning',
  Completed: 'success',
  Cancelled: 'neutral',
};

const RESULT_TONE: Record<SecBcpExerciseResult, StatusTone> = {
  Pass: 'success', 'Issues Found': 'warning', Fail: 'danger',
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function testOverdue(nextTestDue: string | null | undefined): boolean {
  if (!nextTestDue) return false;
  return new Date(nextTestDue) < new Date();
}

function fmtHours(h: number | null | undefined): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h}h`;
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

const BusinessContinuity: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [plans, setPlans] = useState<SecBcpPlan[]>([]);
  const [exercises, setExercises] = useState<SecBcpExercise[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tab, setTab] = useState<'plans' | 'exercises'>('plans');

  // Plan filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecBcpPlanStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecBcpPlanType>('all');

  // Exercise filters
  const [exSearch, setExSearch] = useState('');
  const [exFilterStatus, setExFilterStatus] = useState<'all' | SecBcpExerciseStatus>('all');
  const [exFilterType, setExFilterType] = useState<'all' | SecBcpExerciseType>('all');

  // Plan modals
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SecBcpPlan | null>(null);
  const [detail, setDetail] = useState<SecBcpPlanDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletePlanTarget, setDeletePlanTarget] = useState<SecBcpPlan | null>(null);

  // Exercise modals
  const [showExerciseForm, setShowExerciseForm] = useState(false);
  const [exercisePlanId, setExercisePlanId] = useState('');
  const [completeTarget, setCompleteTarget] = useState<SecBcpExercise | null>(null);
  const [deleteExerciseTarget, setDeleteExerciseTarget] = useState<SecBcpExercise | null>(null);

  // Exercise completion form
  const [exResult, setExResult] = useState<SecBcpExerciseResult>('Pass');
  const [exParticipants, setExParticipants] = useState('');
  const [exFindings, setExFindings] = useState('');

  const emptyPlanForm = {
    title: '', planType: 'Business Continuity' as SecBcpPlanType,
    criticality: 'Medium' as SecPriority, owner: '', scope: '',
    activationTrigger: '', recoverySteps: '', rtoHours: '', rpoHours: '',
    version: '1.0', nextTestDue: '', reviewDate: '',
  };
  const [planForm, setPlanForm] = useState({ ...emptyPlanForm });

  const emptyExerciseForm = {
    exerciseType: 'Tabletop' as SecBcpExerciseType, title: '',
    conductedBy: '', scheduledAt: '', findings: '',
  };
  const [exerciseForm, setExerciseForm] = useState({ ...emptyExerciseForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, e, s] = await Promise.all([
        fetchSecBcpPlans(currentPropertyId),
        fetchSecBcpExercises(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setPlans(p);
      setExercises(e);
      setStaff(s);
    } catch (e2: any) {
      setError(e2?.message || 'Failed to load continuity data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecBcpPlan(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load plan detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (p: SecBcpPlan) => {
    setDetail(null);
    loadDetail(p.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.plan.id);
    addNotification('Business continuity data refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    active: plans.filter(p => p.status === 'Active').length,
    critical: plans.filter(p => p.criticality === 'Critical' && p.status !== 'Archived').length,
    testsOverdue: plans.filter(p => p.status !== 'Archived' && testOverdue(p.next_test_due)).length,
    exScheduled: exercises.filter(e => e.status === 'Scheduled' || e.status === 'In Progress').length,
  }), [plans, exercises]);

  const filteredPlans = useMemo(() => {
    const q = search.toLowerCase();
    return plans.filter(p => {
      const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
      const matchesType = filterType === 'all' || p.plan_type === filterType;
      const matchesSearch = !q ||
        p.id.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        (p.scope?.toLowerCase().includes(q) ?? false) ||
        (p.owner?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [plans, filterStatus, filterType, search]);

  const filteredExercises = useMemo(() => {
    const q = exSearch.toLowerCase();
    return exercises.filter(e => {
      const matchesStatus = exFilterStatus === 'all' || e.status === exFilterStatus;
      const matchesType = exFilterType === 'all' || e.exercise_type === exFilterType;
      const matchesSearch = !q ||
        e.id.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        (e.sec_bcp_plans?.title?.toLowerCase().includes(q) ?? false) ||
        (e.conducted_by?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [exercises, exFilterStatus, exFilterType, exSearch]);

  // ── Plan mutations ─────────────────────────────────────────────────────

  const openNewPlan = () => {
    setEditingPlan(null);
    setPlanForm({ ...emptyPlanForm });
    setShowPlanForm(true);
  };

  const openEditPlan = (p: SecBcpPlan) => {
    setEditingPlan(p);
    setPlanForm({
      title: p.title,
      planType: p.plan_type,
      criticality: p.criticality,
      owner: p.owner || '',
      scope: p.scope || '',
      activationTrigger: p.activation_trigger || '',
      recoverySteps: p.recovery_steps || '',
      rtoHours: p.rto_hours != null ? String(p.rto_hours) : '',
      rpoHours: p.rpo_hours != null ? String(p.rpo_hours) : '',
      version: p.version,
      nextTestDue: p.next_test_due || '',
      reviewDate: p.review_date || '',
    });
    setShowPlanForm(true);
  };

  const savePlan = async () => {
    if (!planForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: planForm.title.trim(),
        planType: planForm.planType,
        criticality: planForm.criticality,
        owner: planForm.owner || null,
        scope: planForm.scope || null,
        activationTrigger: planForm.activationTrigger || null,
        recoverySteps: planForm.recoverySteps || null,
        rtoHours: planForm.rtoHours === '' ? null : parseInt(planForm.rtoHours),
        rpoHours: planForm.rpoHours === '' ? null : parseInt(planForm.rpoHours),
        version: planForm.version || '1.0',
        nextTestDue: planForm.nextTestDue || null,
        reviewDate: planForm.reviewDate || null,
      };
      if (editingPlan) {
        const res = await updateSecBcpPlan(editingPlan.id, payload);
        setPlans(prev => prev.map(p => (p.id === editingPlan.id ? res.plan : p)));
        if (detail?.plan.id === editingPlan.id) loadDetail(editingPlan.id);
        addNotification(`Plan ${editingPlan.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecBcpPlan({ propertyId: currentPropertyId, ...payload });
        setPlans(prev => [created, ...prev]);
        addNotification(`Plan registered — ${created.id}`, 'task', 'Security');
      }
      setShowPlanForm(false);
      setEditingPlan(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save plan', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchPlan = async (p: SecBcpPlan, patch: Parameters<typeof updateSecBcpPlan>[1], toast?: string) => {
    setActingOn(p.id);
    try {
      const res = await updateSecBcpPlan(p.id, patch);
      setPlans(prev => prev.map(x => (x.id === p.id ? res.plan : x)));
      if (detail?.plan.id === p.id) loadDetail(p.id);
      addNotification(toast || `Plan ${p.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removePlan = async () => {
    if (!deletePlanTarget) return;
    setActingOn(deletePlanTarget.id);
    try {
      await deleteSecBcpPlan(deletePlanTarget.id);
      setPlans(prev => prev.filter(p => p.id !== deletePlanTarget.id));
      if (detail?.plan.id === deletePlanTarget.id) setDetail(null);
      addNotification(`Plan ${deletePlanTarget.id} removed`, 'task', 'Security');
      setDeletePlanTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Exercise mutations ─────────────────────────────────────────────────

  const openNewExercise = (planId?: string) => {
    setExercisePlanId(planId || detail?.plan.id || plans[0]?.id || '');
    setExerciseForm({ ...emptyExerciseForm });
    setShowExerciseForm(true);
  };

  const saveExercise = async () => {
    if (!exercisePlanId) {
      addNotification('Select a plan', 'warning', 'Security');
      return;
    }
    if (!exerciseForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSecBcpExercise(exercisePlanId, {
        propertyId: currentPropertyId,
        exerciseType: exerciseForm.exerciseType,
        title: exerciseForm.title.trim(),
        conductedBy: exerciseForm.conductedBy || null,
        scheduledAt: exerciseForm.scheduledAt || null,
        findings: exerciseForm.findings || null,
      });
      setExercises(prev => [created, ...prev]);
      if (detail?.plan.id === exercisePlanId) loadDetail(exercisePlanId);
      addNotification(`Exercise scheduled — ${created.id}`, 'task', 'Security');
      setShowExerciseForm(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to schedule exercise', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchExercise = async (ex: SecBcpExercise, patch: Parameters<typeof updateSecBcpExercise>[1], toast?: string) => {
    setActingOn(ex.id);
    try {
      const res = await updateSecBcpExercise(ex.id, patch);
      setExercises(prev => prev.map(x => (x.id === ex.id ? res.exercise : x)));
      if (detail?.plan.id === ex.plan_id) loadDetail(ex.plan_id);
      if (patch.status === 'Completed') await load(); // plan test dates changed
      addNotification(toast || `Exercise ${ex.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const openComplete = (ex: SecBcpExercise) => {
    setCompleteTarget(ex);
    setExResult('Pass');
    setExParticipants(ex.participants != null ? String(ex.participants) : '');
    setExFindings(ex.findings || '');
  };

  const submitComplete = async () => {
    if (!completeTarget) return;
    setSubmitting(true);
    try {
      const res = await updateSecBcpExercise(completeTarget.id, {
        status: 'Completed',
        result: exResult,
        participants: exParticipants === '' ? null : parseInt(exParticipants),
        findings: exFindings || null,
      });
      setExercises(prev => prev.map(x => (x.id === completeTarget.id ? res.exercise : x)));
      await load(); // plan last_tested / next_test_due updated server-side
      if (detail?.plan.id === completeTarget.plan_id) await loadDetail(completeTarget.plan_id);
      addNotification(`Exercise ${completeTarget.id} completed — ${exResult}`, 'task', 'Security');
      setCompleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to complete exercise', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const removeExercise = async () => {
    if (!deleteExerciseTarget) return;
    setActingOn(deleteExerciseTarget.id);
    try {
      await deleteSecBcpExercise(deleteExerciseTarget.id);
      setExercises(prev => prev.filter(x => x.id !== deleteExerciseTarget.id));
      if (detail?.plan.id === deleteExerciseTarget.plan_id) loadDetail(deleteExerciseTarget.plan_id);
      addNotification(`Exercise ${deleteExerciseTarget.id} removed`, 'task', 'Security');
      setDeleteExerciseTarget(null);
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
        title="Business Continuity"
        subtitle="Business impact analysis, recovery plans, and disaster recovery coordination"
        icon={LifeBuoy}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {tab === 'plans' ? (
              <button onClick={openNewPlan} className={button.primary}>
                <Plus className="w-4 h-4" /> New Plan
              </button>
            ) : (
              <button onClick={() => openNewExercise()} disabled={plans.length === 0} className={button.primary + ' disabled:opacity-50'}>
                <Plus className="w-4 h-4" /> Schedule Exercise
              </button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Plans" value={stats.active} icon={LifeBuoy} tone="accent" />
        <StatCard title="Critical Plans" value={stats.critical} icon={FileText} tone="danger" />
        <StatCard title="Tests Overdue" value={stats.testsOverdue} icon={Clock} tone="warning" />
        <StatCard title="Exercises Scheduled" value={stats.exScheduled} icon={ClipboardCheck} tone="info" />
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
          ['plans', 'Recovery Plans', LifeBuoy],
          ['exercises', 'Exercises & Tests', ClipboardCheck],
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

      {/* ── Plans tab ── */}
      {tab === 'plans' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search title, ID, owner…"
                  className={inputClass + ' pl-9'}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {PLAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Continuity Plans" subtitle="Plan · Type · Criticality · RTO/RPO · Status · Test Schedule" icon={LifeBuoy} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Plan', 'Type', 'Criticality', 'RTO / RPO', 'Status', 'Owner', 'Next Test', '']}
                rows={filteredPlans.map(p => [
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${p.criticality === 'Critical' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                      <LifeBuoy className={`w-4 h-4 ${p.criticality === 'Critical' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                    </div>
                    <div className="min-w-0">
                      <button onClick={() => openDetail(p)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{p.title}</button>
                      <div className="text-[10px] text-slate-400 font-mono">{p.id} · v{p.version}</div>
                    </div>
                  </div>,
                  <Badge tone="neutral">{p.plan_type}</Badge>,
                  <Badge tone={CRIT_TONE[p.criticality]}>{p.criticality}</Badge>,
                  <span className="font-mono text-xs">{fmtHours(p.rto_hours)} / {fmtHours(p.rpo_hours)}</span>,
                  <select
                    value={p.status}
                    onChange={e => patchPlan(p, { status: e.target.value as SecBcpPlanStatus }, `Plan ${p.id} → ${e.target.value}`)}
                    disabled={actingOn === p.id}
                    className={inlineStatusSelect}
                  >
                    {PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>,
                  <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{p.owner || '—'}</span>,
                  <span className={`text-xs ${testOverdue(p.next_test_due) ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                    {p.next_test_due ? fmtDate(p.next_test_due) : '—'}{testOverdue(p.next_test_due) ? ' · overdue' : ''}
                  </span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => openDetail(p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openEditPlan(p)} disabled={actingOn === p.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeletePlanTarget(p)} disabled={actingOn === p.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      {actingOn === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ])}
                empty={filteredPlans.length === 0}
                emptyColSpan={8}
                emptyText="No continuity plans found."
              />
            )}
          </SectionCard>
        </>
      )}

      {/* ── Exercises tab ── */}
      {tab === 'exercises' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={exSearch}
                  onChange={e => setExSearch(e.target.value)}
                  placeholder="Search exercise, plan, ID…"
                  className={inputClass + ' pl-9'}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={exFilterStatus} onChange={e => setExFilterStatus(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {EXERCISE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={exFilterType} onChange={e => setExFilterType(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {EXERCISE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Exercises & Tests" subtitle="Exercise · Plan · Type · Schedule · Status · Result" icon={ClipboardCheck} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Exercise', 'Plan', 'Type', 'Scheduled', 'Status', 'Result', '']}
                rows={filteredExercises.map(ex => [
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{ex.title}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{ex.id}{ex.conducted_by ? ` · ${ex.conducted_by}` : ''}</p>
                  </div>,
                  <span className="text-xs">{ex.sec_bcp_plans?.title || ex.plan_id}</span>,
                  <Badge tone="neutral">{ex.exercise_type}</Badge>,
                  <span className="text-xs">{fmtDateTime(ex.scheduled_at)}</span>,
                  <div className="inline-flex items-center gap-2">
                    <select
                      value={ex.status}
                      onChange={e => patchExercise(ex, { status: e.target.value as SecBcpExerciseStatus }, `Exercise ${ex.id} → ${e.target.value}`)}
                      disabled={actingOn === ex.id || ex.status === 'Completed'}
                      className={inlineStatusSelect}
                    >
                      {EXERCISE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {(ex.status === 'Scheduled' || ex.status === 'In Progress') && (
                      <button onClick={() => openComplete(ex)} disabled={actingOn === ex.id} className={button.ghost + ' !px-2 !py-1 text-[10px]'} title="Record result">
                        <CheckCircle2 size={12} /> Complete
                      </button>
                    )}
                  </div>,
                  ex.result ? <Badge tone={RESULT_TONE[ex.result]}>{ex.result}</Badge> : <span className="text-xs text-slate-400">—</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => setDeleteExerciseTarget(ex)} disabled={actingOn === ex.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      {actingOn === ex.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ])}
                empty={filteredExercises.length === 0}
                emptyColSpan={7}
                emptyText="No exercises scheduled."
              />
            )}
          </SectionCard>
        </>
      )}

      {/* New / Edit plan modal */}
      <ModalSystem
        isOpen={showPlanForm}
        onClose={() => { setShowPlanForm(false); setEditingPlan(null); }}
        onConfirm={savePlan}
        title={editingPlan ? `Edit ${editingPlan.id}` : 'New Continuity Plan'}
        subtitle={editingPlan ? editingPlan.title : 'Define objectives, triggers, and recovery steps'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editingPlan ? 'Save Changes' : 'Register Plan'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Plan Title">
              <input className={inputClass} value={planForm.title} onChange={e => setPlanForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., PMS / Systems Outage Recovery" />
            </Field>
            <Field label="Plan Type">
              <select className={inputClass} value={planForm.planType} onChange={e => setPlanForm(f => ({ ...f, planType: e.target.value as SecBcpPlanType }))}>
                {PLAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Scope">
            <input className={inputClass} value={planForm.scope} onChange={e => setPlanForm(f => ({ ...f, scope: e.target.value }))} placeholder="What this plan covers — systems, zones, people…" />
          </Field>
          <Field label="Activation Trigger">
            <input className={inputClass} value={planForm.activationTrigger} onChange={e => setPlanForm(f => ({ ...f, activationTrigger: e.target.value }))} placeholder="Condition that activates this plan" />
          </Field>
          <Field label="Recovery Steps">
            <textarea className={inputClass + ' min-h-[72px]'} value={planForm.recoverySteps} onChange={e => setPlanForm(f => ({ ...f, recoverySteps: e.target.value }))} placeholder="Numbered recovery procedure…" />
          </Field>
          <div className="grid grid-cols-4 gap-4">
            <Field label="RTO (hours)">
              <input type="number" min={0} className={inputClass} value={planForm.rtoHours} onChange={e => setPlanForm(f => ({ ...f, rtoHours: e.target.value }))} placeholder="—" />
            </Field>
            <Field label="RPO (hours)">
              <input type="number" min={0} className={inputClass} value={planForm.rpoHours} onChange={e => setPlanForm(f => ({ ...f, rpoHours: e.target.value }))} placeholder="—" />
            </Field>
            <Field label="Criticality">
              <select className={inputClass} value={planForm.criticality} onChange={e => setPlanForm(f => ({ ...f, criticality: e.target.value as SecPriority }))}>
                {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Version">
              <input className={inputClass} value={planForm.version} onChange={e => setPlanForm(f => ({ ...f, version: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Plan Owner">
              <input
                className={inputClass}
                list="sec-bcp-owners"
                value={planForm.owner}
                onChange={e => setPlanForm(f => ({ ...f, owner: e.target.value }))}
                placeholder="Select or type owner"
              />
              <datalist id="sec-bcp-owners">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Next Test Due">
              <input type="date" className={inputClass} value={planForm.nextTestDue} onChange={e => setPlanForm(f => ({ ...f, nextTestDue: e.target.value }))} />
            </Field>
            <Field label="Review Date">
              <input type="date" className={inputClass} value={planForm.reviewDate} onChange={e => setPlanForm(f => ({ ...f, reviewDate: e.target.value }))} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Plan detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Plan ${detail.plan.id}` : 'Plan Detail'}
        subtitle={detail ? `${detail.plan.title} · ${detail.plan.plan_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={PLAN_STATUS_TONE[detail.plan.status]}>{detail.plan.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Criticality</p>
                <Badge tone={CRIT_TONE[detail.plan.criticality]}>{detail.plan.criticality}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">RTO / RPO</p>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                  {fmtHours(detail.plan.rto_hours)} / {fmtHours(detail.plan.rpo_hours)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Owner</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.plan.owner || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Version</p>
                <p className="text-slate-600 dark:text-slate-300">v{detail.plan.version}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Tested</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(detail.plan.last_tested)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Next Test Due</p>
                <p className={`flex items-center gap-1 ${testOverdue(detail.plan.next_test_due) ? 'text-red-600 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>
                  <CalendarClock size={11} />{fmtDate(detail.plan.next_test_due)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Review Date</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(detail.plan.review_date)}</p>
              </div>
              {detail.plan.scope && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Scope</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.plan.scope}</p>
                </div>
              )}
              {detail.plan.activation_trigger && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Activation Trigger</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.plan.activation_trigger}</p>
                </div>
              )}
              {detail.plan.recovery_steps && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Recovery Steps</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{detail.plan.recovery_steps}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.plan.status === 'Draft' && (
                <button onClick={() => patchPlan(detail.plan, { status: 'Active' }, `Plan ${detail.plan.id} activated`)} disabled={actingOn === detail.plan.id} className={button.primary + ' disabled:opacity-50'}>
                  <PlayCircle className="w-4 h-4" /> Activate Plan
                </button>
              )}
              {detail.plan.status === 'Active' && (
                <button onClick={() => patchPlan(detail.plan, { status: 'Under Review' }, `Plan ${detail.plan.id} → Under Review`)} disabled={actingOn === detail.plan.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Eye className="w-4 h-4" /> Start Review
                </button>
              )}
              {detail.plan.status === 'Under Review' && (
                <button onClick={() => patchPlan(detail.plan, { status: 'Active' }, `Plan ${detail.plan.id} re-activated`)} disabled={actingOn === detail.plan.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Approve & Activate
                </button>
              )}
              {detail.plan.status !== 'Archived' && (
                <button onClick={() => patchPlan(detail.plan, { status: 'Archived' }, `Plan ${detail.plan.id} archived`)} disabled={actingOn === detail.plan.id} className={button.secondary + ' disabled:opacity-50'}>
                  Archive
                </button>
              )}
              {detail.plan.status === 'Archived' && (
                <button onClick={() => patchPlan(detail.plan, { status: 'Draft' }, `Plan ${detail.plan.id} restored to draft`)} disabled={actingOn === detail.plan.id} className={button.secondary + ' disabled:opacity-50'}>
                  <ArchiveRestore className="w-4 h-4" /> Restore
                </button>
              )}
              <button onClick={() => openNewExercise(detail.plan.id)} className={button.secondary}>
                <ClipboardCheck className="w-4 h-4" /> Schedule Exercise
              </button>
              <button onClick={() => { setDetail(null); openEditPlan(detail.plan); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeletePlanTarget(detail.plan)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Exercise history */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Exercise History
              </h4>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {detail.exercises.map((ex, idx) => (
                  <div key={ex.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                        ex.status === 'Completed' ? 'bg-emerald-500' : ex.status === 'Cancelled' ? 'bg-slate-400' : 'bg-amber-500'
                      }`} />
                      {idx < detail.exercises.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{ex.title}</p>
                        <Badge tone="neutral">{ex.exercise_type}</Badge>
                        <Badge tone={EXERCISE_STATUS_TONE[ex.status]}>{ex.status}</Badge>
                        {ex.result && <Badge tone={RESULT_TONE[ex.result]}>{ex.result}</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                        <span className="font-mono">{ex.id}</span>
                        {ex.conducted_by && <span>· {ex.conducted_by}</span>}
                        {ex.participants != null && <span>· {ex.participants} participants</span>}
                        <span>· {ex.status === 'Completed' ? `done ${fmtDateTime(ex.completed_at)}` : `scheduled ${fmtDateTime(ex.scheduled_at)}`}</span>
                      </div>
                      {ex.findings && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{ex.findings}</p>}
                    </div>
                  </div>
                ))}
                {detail.exercises.length === 0 && <p className="text-xs text-slate-400">No exercises recorded for this plan yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* New exercise modal */}
      <ModalSystem
        isOpen={showExerciseForm}
        onClose={() => setShowExerciseForm(false)}
        onConfirm={saveExercise}
        title="Schedule Exercise"
        subtitle="Tabletop, simulation, full test, or review"
        variant="form"
        loading={submitting}
        confirmLabel="Schedule"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Plan">
              <select className={inputClass} value={exercisePlanId} onChange={e => setExercisePlanId(e.target.value)}>
                <option value="">Select plan…</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.id} — {p.title}</option>)}
              </select>
            </Field>
            <Field label="Exercise Type">
              <select className={inputClass} value={exerciseForm.exerciseType} onChange={e => setExerciseForm(f => ({ ...f, exerciseType: e.target.value as SecBcpExerciseType }))}>
                {EXERCISE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Exercise Title">
            <input className={inputClass} value={exerciseForm.title} onChange={e => setExerciseForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Q4 Evacuation Full Test" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Conducted By">
              <input
                className={inputClass}
                list="sec-bcp-conductors"
                value={exerciseForm.conductedBy}
                onChange={e => setExerciseForm(f => ({ ...f, conductedBy: e.target.value }))}
                placeholder="Select or type conductor"
              />
              <datalist id="sec-bcp-conductors">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Scheduled At">
              <input type="datetime-local" className={inputClass} value={exerciseForm.scheduledAt} onChange={e => setExerciseForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes / Scenario">
            <textarea className={inputClass + ' min-h-[56px]'} value={exerciseForm.findings} onChange={e => setExerciseForm(f => ({ ...f, findings: e.target.value }))} placeholder="Scenario outline, invitees, objectives…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Exercise result modal */}
      <ModalSystem
        isOpen={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        onConfirm={submitComplete}
        title="Record Exercise Result"
        subtitle={completeTarget ? `${completeTarget.id} — ${completeTarget.title}` : ''}
        variant="form"
        loading={submitting}
        confirmLabel="Complete Exercise"
      >
        <div className="space-y-4">
          <Field label="Result">
            <div className="flex gap-2">
              {EXERCISE_RESULTS.map(r => (
                <button
                  key={r}
                  onClick={() => setExResult(r)}
                  className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition ${
                    exResult === r
                      ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/10 text-slate-900 dark:text-white'
                      : 'border-gray-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Participants">
            <input type="number" min={0} className={inputClass} value={exParticipants} onChange={e => setExParticipants(e.target.value)} placeholder="e.g., 12" />
          </Field>
          <Field label="Findings">
            <textarea className={inputClass + ' min-h-[72px]'} value={exFindings} onChange={e => setExFindings(e.target.value)} placeholder="Observations, gaps identified, follow-up actions…" />
          </Field>
          <p className="text-[11px] text-slate-400">Completing an exercise stamps the plan's last-tested date and rolls the next test due forward one year.</p>
        </div>
      </ModalSystem>

      {/* Delete plan confirm */}
      <ModalSystem
        isOpen={!!deletePlanTarget}
        onClose={() => setDeletePlanTarget(null)}
        onConfirm={removePlan}
        title="Remove Plan"
        subtitle={deletePlanTarget ? `Permanently remove plan ${deletePlanTarget.id} (${deletePlanTarget.title}) and its exercise history?` : ''}
        variant="confirm"
        loading={actingOn === deletePlanTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />

      {/* Delete exercise confirm */}
      <ModalSystem
        isOpen={!!deleteExerciseTarget}
        onClose={() => setDeleteExerciseTarget(null)}
        onConfirm={removeExercise}
        title="Remove Exercise"
        subtitle={deleteExerciseTarget ? `Permanently remove exercise ${deleteExerciseTarget.id} (${deleteExerciseTarget.title})?` : ''}
        variant="confirm"
        loading={actingOn === deleteExerciseTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default BusinessContinuity;
