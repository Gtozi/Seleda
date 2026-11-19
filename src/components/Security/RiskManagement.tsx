/**
 * Risk Management — /erp/security/risk.
 *
 * DB-integrated via /api/sec-portal/risks routes (migration 611).
 * `sec_risks` is the enterprise risk register — likelihood × impact is
 * scored and leveled server-side (1–4 Low, 5–9 Medium, 10–15 High,
 * 16–25 Critical). `sec_risk_actions` backs a real per-risk mitigation
 * checklist + review log.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ShieldAlert, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, History, AlertOctagon, User,
  Tag, Gauge, ListChecks, CalendarClock, Circle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecRisks, fetchSecRisk, createSecRisk, updateSecRisk,
  deleteSecRisk, addSecRiskAction, toggleSecRiskAction, fetchSecStaff,
  type SecRisk, type SecRiskDetail, type SecRiskStatus, type SecRiskLevel,
  type SecRiskCategory, type SecRiskActionType, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const CATEGORIES: SecRiskCategory[] = [
  'Physical Security', 'Safety', 'Cyber', 'Operational',
  'Financial', 'Compliance', 'Reputational',
];

const STATUSES: SecRiskStatus[] = ['Open', 'Assessed', 'Mitigating', 'Monitoring', 'Closed'];
const LEVELS: SecRiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];
const ACTION_TYPES: SecRiskActionType[] = ['Mitigation Action', 'Review', 'Note'];

const STATUS_TONE: Record<SecRiskStatus, StatusTone> = {
  Open: 'danger',
  Assessed: 'warning',
  Mitigating: 'info',
  Monitoring: 'accent',
  Closed: 'success',
};

const LEVEL_TONE: Record<SecRiskLevel, StatusTone> = {
  Low: 'neutral', Medium: 'warning', High: 'warning', Critical: 'danger',
};

const ACTION_DOT: Record<SecRiskActionType, string> = {
  'Mitigation Action': 'bg-indigo-500',
  Review: 'bg-blue-500',
  'Status Change': 'bg-amber-500',
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

function reviewOverdue(nextReview: string | null | undefined): boolean {
  if (!nextReview) return false;
  return new Date(nextReview) < new Date();
}

function levelFor(score: number): SecRiskLevel {
  if (score >= 16) return 'Critical';
  if (score >= 10) return 'High';
  if (score >= 5) return 'Medium';
  return 'Low';
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No risks found.</td></tr>
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

const RiskManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [risks, setRisks] = useState<SecRisk[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecRiskStatus>('all');
  const [filterLevel, setFilterLevel] = useState<'all' | SecRiskLevel>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | SecRiskCategory>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecRisk | null>(null);
  const [detail, setDetail] = useState<SecRiskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecRisk | null>(null);

  // Action form (detail modal)
  const [actType, setActType] = useState<SecRiskActionType>('Mitigation Action');
  const [actDesc, setActDesc] = useState('');
  const [actOwner, setActOwner] = useState('');
  const [actDue, setActDue] = useState('');

  const emptyForm = {
    title: '', description: '', category: 'Physical Security' as SecRiskCategory,
    likelihood: 3, impact: 3, owner: '', mitigationPlan: '', nextReview: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([
        fetchSecRisks(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setRisks(r);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load risks');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecRisk(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load risk detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (r: SecRisk) => {
    setDetail(null);
    setActType('Mitigation Action');
    setActDesc('');
    setActOwner('');
    setActDue('');
    loadDetail(r.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.risk.id);
    addNotification('Risk register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const open = risks.filter(r => r.status !== 'Closed');
    return {
      open: open.length,
      severe: risks.filter(r => (r.risk_level === 'High' || r.risk_level === 'Critical') && r.status !== 'Closed').length,
      mitigating: risks.filter(r => r.status === 'Mitigating').length,
      overdue: open.filter(r => reviewOverdue(r.next_review)).length,
    };
  }, [risks]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return risks.filter(r => {
      const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
      const matchesLevel = filterLevel === 'all' || r.risk_level === filterLevel;
      const matchesCategory = filterCategory === 'all' || r.category === filterCategory;
      const matchesSearch = !q ||
        r.id.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false) ||
        (r.owner?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesLevel && matchesCategory && matchesSearch;
    });
  }, [risks, filterStatus, filterLevel, filterCategory, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (r: SecRisk) => {
    setEditing(r);
    setForm({
      title: r.title,
      description: r.description || '',
      category: r.category,
      likelihood: r.likelihood,
      impact: r.impact,
      owner: r.owner || '',
      mitigationPlan: r.mitigation_plan || '',
      nextReview: r.next_review || '',
    });
    setShowForm(true);
  };

  const saveRisk = async () => {
    if (!form.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description || null,
        category: form.category,
        likelihood: form.likelihood,
        impact: form.impact,
        owner: form.owner || null,
        mitigationPlan: form.mitigationPlan || null,
        nextReview: form.nextReview || null,
      };
      if (editing) {
        const res = await updateSecRisk(editing.id, payload);
        setRisks(prev => prev.map(r => (r.id === editing.id ? res.risk : r)));
        if (detail?.risk.id === editing.id) loadDetail(editing.id);
        addNotification(`Risk ${editing.id} updated — score ${res.risk.risk_score} (${res.risk.risk_level})`, 'task', 'Security');
      } else {
        const created = await createSecRisk({ propertyId: currentPropertyId, ...payload });
        setRisks(prev => [created, ...prev]);
        addNotification(`Risk registered — score ${created.risk_score} (${created.risk_level}) ${created.id}`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save risk', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchRisk = async (r: SecRisk, patch: Parameters<typeof updateSecRisk>[1], toast?: string) => {
    setActingOn(r.id);
    try {
      const res = await updateSecRisk(r.id, patch);
      setRisks(prev => prev.map(x => (x.id === r.id ? res.risk : x)));
      if (detail?.risk.id === r.id) loadDetail(r.id);
      addNotification(toast || `Risk ${r.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitAction = async () => {
    if (!detail) return;
    if (!actDesc.trim()) {
      addNotification('Describe the action', 'warning', 'Security');
      return;
    }
    setActingOn(detail.risk.id);
    try {
      await addSecRiskAction(detail.risk.id, {
        action: actType,
        description: actDesc.trim(),
        owner: actOwner || null,
        dueDate: actDue || null,
      });
      await loadDetail(detail.risk.id);
      setActDesc('');
      setActOwner('');
      setActDue('');
      addNotification('Mitigation action added', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Action failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const toggleAction = async (riskId: string, actionId: string, done: boolean) => {
    setActingOn(actionId);
    try {
      await toggleSecRiskAction(riskId, actionId, done);
      await loadDetail(riskId);
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeRisk = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecRisk(deleteTarget.id);
      setRisks(prev => prev.filter(r => r.id !== deleteTarget.id));
      if (detail?.risk.id === deleteTarget.id) setDetail(null);
      addNotification(`Risk ${deleteTarget.id} removed`, 'task', 'Security');
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
        title="Risk Management"
        subtitle="Enterprise risk register, assessment, and mitigation planning"
        icon={ShieldAlert}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> New Risk
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Risks" value={stats.open} icon={ShieldAlert} tone="accent" />
        <StatCard title="High & Critical" value={stats.severe} icon={AlertOctagon} tone="danger" />
        <StatCard title="Mitigating" value={stats.mitigating} icon={ListChecks} tone="info" />
        <StatCard title="Reviews Overdue" value={stats.overdue} icon={Clock} tone="warning" />
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
              placeholder="Search title, ID, owner…"
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
            <Gauge size={12} className="text-slate-400" />
            <select value={filterLevel} onChange={e => setFilterLevel(e.target.value as any)} className={filterSelect}>
              <option value="all">All Levels</option>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as any)} className={filterSelect}>
              <option value="all">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Risk register */}
      <SectionCard title="Risk Register" subtitle="Risk · Category · Score · Level · Status · Review" icon={ShieldAlert} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Risk', 'Category', 'Score', 'Level', 'Status', 'Owner', 'Next Review', '']}
            rows={filtered.map(r => [
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg shrink-0 ${r.risk_level === 'Critical' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                  <ShieldAlert className={`w-4 h-4 ${r.risk_level === 'Critical' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(r)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{r.title}</button>
                  <div className="text-[10px] text-slate-400 font-mono">{r.id}</div>
                </div>
              </div>,
              <Badge tone="neutral">{r.category}</Badge>,
              <span className="font-mono text-xs font-bold" title={`Likelihood ${r.likelihood} × Impact ${r.impact}`}>
                {r.likelihood}×{r.impact} = {r.risk_score}
              </span>,
              <Badge tone={LEVEL_TONE[r.risk_level]}>{r.risk_level}</Badge>,
              <select
                value={r.status}
                onChange={e => patchRisk(r, { status: e.target.value as SecRiskStatus }, `Risk ${r.id} → ${e.target.value}`)}
                disabled={actingOn === r.id}
                className={inlineStatusSelect}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{r.owner || '—'}</span>,
              <span className={`text-xs ${reviewOverdue(r.next_review) ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                {r.next_review ? fmtDate(r.next_review) : '—'}{reviewOverdue(r.next_review) ? ' · overdue' : ''}
              </span>,
              <div className="inline-flex gap-2">
                <button onClick={() => openDetail(r)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(r)} disabled={actingOn === r.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(r)} disabled={actingOn === r.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* New / Edit risk modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveRisk}
        title={editing ? `Edit ${editing.id}` : 'Register New Risk'}
        subtitle={editing ? editing.title : 'Assess likelihood × impact — score is derived automatically'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Register Risk'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Risk Title">
              <input className={inputClass} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., CCTV blind spot — parking B2" />
            </Field>
            <Field label="Category">
              <select className={inputClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as SecRiskCategory }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass + ' min-h-[56px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What is the risk, evidence, exposure…" />
          </Field>
          <div className="grid grid-cols-3 gap-4 items-end">
            <Field label={`Likelihood (${form.likelihood}/5)`}>
              <input type="range" min={1} max={5} className="w-full accent-[var(--color-accent-operations)]" value={form.likelihood} onChange={e => setForm(f => ({ ...f, likelihood: parseInt(e.target.value) }))} />
            </Field>
            <Field label={`Impact (${form.impact}/5)`}>
              <input type="range" min={1} max={5} className="w-full accent-[var(--color-accent-operations)]" value={form.impact} onChange={e => setForm(f => ({ ...f, impact: parseInt(e.target.value) }))} />
            </Field>
            <div className="pb-1">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Score</span>
              <Badge tone={LEVEL_TONE[levelFor(form.likelihood * form.impact)]}>
                {form.likelihood * form.impact} — {levelFor(form.likelihood * form.impact)}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Risk Owner">
              <input
                className={inputClass}
                list="sec-risk-owners"
                value={form.owner}
                onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}
                placeholder="Select or type owner"
              />
              <datalist id="sec-risk-owners">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Next Review">
              <input type="date" className={inputClass} value={form.nextReview} onChange={e => setForm(f => ({ ...f, nextReview: e.target.value }))} />
            </Field>
          </div>
          <Field label="Mitigation Plan">
            <textarea className={inputClass + ' min-h-[56px]'} value={form.mitigationPlan} onChange={e => setForm(f => ({ ...f, mitigationPlan: e.target.value }))} placeholder="Planned controls and mitigations…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Risk detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Risk ${detail.risk.id}` : 'Risk Detail'}
        subtitle={detail ? `${detail.risk.title} · ${detail.risk.category}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.risk.status]}>{detail.risk.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Level</p>
                <Badge tone={LEVEL_TONE[detail.risk.risk_level]}>{detail.risk.risk_level}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Score</p>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                  {detail.risk.likelihood}×{detail.risk.impact} = {detail.risk.risk_score}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Owner</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.risk.owner || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Identified</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(detail.risk.identified_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Next Review</p>
                <p className={`flex items-center gap-1 ${reviewOverdue(detail.risk.next_review) ? 'text-red-600 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>
                  <CalendarClock size={11} />{fmtDate(detail.risk.next_review)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Closed</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(detail.risk.closed_at)}</p>
              </div>
              {detail.risk.description && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.risk.description}</p>
                </div>
              )}
              {detail.risk.mitigation_plan && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Mitigation Plan</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.risk.mitigation_plan}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.risk.status === 'Open' && (
                <button onClick={() => patchRisk(detail.risk, { status: 'Assessed' }, `Risk ${detail.risk.id} assessed`)} disabled={actingOn === detail.risk.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Mark Assessed
                </button>
              )}
              {(detail.risk.status === 'Open' || detail.risk.status === 'Assessed') && (
                <button onClick={() => patchRisk(detail.risk, { status: 'Mitigating' }, `Mitigation started — ${detail.risk.id}`)} disabled={actingOn === detail.risk.id} className={button.secondary + ' disabled:opacity-50'}>
                  <ListChecks className="w-4 h-4" /> Start Mitigation
                </button>
              )}
              {detail.risk.status === 'Mitigating' && (
                <button onClick={() => patchRisk(detail.risk, { status: 'Monitoring' }, `Risk ${detail.risk.id} moved to monitoring`)} disabled={actingOn === detail.risk.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Eye className="w-4 h-4" /> Move to Monitoring
                </button>
              )}
              {detail.risk.status !== 'Closed' && (
                <button onClick={() => patchRisk(detail.risk, { status: 'Closed' }, `Risk ${detail.risk.id} closed`)} disabled={actingOn === detail.risk.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Close Risk
                </button>
              )}
              {detail.risk.status === 'Closed' && (
                <button onClick={() => patchRisk(detail.risk, { status: 'Open' }, `Risk ${detail.risk.id} reopened`)} disabled={actingOn === detail.risk.id} className={button.secondary + ' disabled:opacity-50'}>
                  Reopen
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.risk); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.risk)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Add action form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <ListChecks className="w-4 h-4 text-[var(--color-accent-operations)]" /> Add Mitigation Action
              </h4>
              <div className="flex flex-wrap gap-2">
                <select className={inputClass + ' !w-auto'} value={actType} onChange={e => setActType(e.target.value as SecRiskActionType)}>
                  {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input
                  className={inputClass + ' !w-36'}
                  list="sec-risk-action-owners"
                  value={actOwner}
                  onChange={e => setActOwner(e.target.value)}
                  placeholder="Owner"
                />
                <datalist id="sec-risk-action-owners">
                  {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
                </datalist>
                <input type="date" className={inputClass + ' !w-auto'} value={actDue} onChange={e => setActDue(e.target.value)} />
                <input className={inputClass + ' flex-1 min-w-[160px]'} value={actDesc} onChange={e => setActDesc(e.target.value)} placeholder="Action description…" />
                <button onClick={submitAction} disabled={actingOn === detail.risk.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>

            {/* Action checklist */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Mitigation Checklist & Log
              </h4>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {detail.actions.map((a, idx) => (
                  <div key={a.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <button
                        onClick={() => toggleAction(detail.risk.id, a.id, !a.done)}
                        disabled={actingOn === a.id}
                        className="mt-0.5 disabled:opacity-50"
                        title={a.done ? 'Mark incomplete' : 'Mark done'}
                      >
                        {a.done
                          ? <CheckCircle2 size={16} className="text-emerald-500" />
                          : <Circle size={16} className="text-slate-400 hover:text-[var(--color-accent-operations)]" />}
                      </button>
                      {idx < detail.actions.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <p className={`text-sm font-medium ${a.done ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>{a.description}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${ACTION_DOT[a.action]}`} />{a.action}
                        {a.owner && <span>· {a.owner}</span>}
                        {a.due_date && <span className={!a.done && new Date(a.due_date) < new Date() ? 'text-red-500 font-semibold' : ''}>· due {fmtDate(a.due_date)}</span>}
                        <span>· {a.done ? `done ${fmtDateTime(a.completed_at)}` : fmtDateTime(a.created_at)}</span>
                        {a.actor && <span>· {a.actor}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {detail.actions.length === 0 && <p className="text-xs text-slate-400">No mitigation actions yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeRisk}
        title="Remove Risk"
        subtitle={deleteTarget ? `Permanently remove risk ${deleteTarget.id} (${deleteTarget.title}) and its action log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default RiskManagement;
