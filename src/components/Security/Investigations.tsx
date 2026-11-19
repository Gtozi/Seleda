/**
 * Investigations — /erp/security/investigations.
 *
 * DB-integrated via /api/sec-portal/investigations routes (migration 602).
 * Cases link to the shared sec_incidents table; witnesses, evidence items
 * and the case timeline live in child tables so every action persists.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FileSearch, Plus, Search, Clock, Eye, Pencil, Trash2, Tag,
  Users, FolderOpen, History, ShieldAlert, Activity,
  RefreshCw, Loader2, ServerCrash, ClipboardList, Filter, Camera, User,
  Calendar, type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecInvestigations, fetchSecInvestigation, createSecInvestigation,
  updateSecInvestigation, deleteSecInvestigation, addSecWitness,
  deleteSecWitness, addSecEvidence, deleteSecEvidence, addSecCaseNote,
  fetchSecIncidents, fetchSecStaff,
  type SecInvestigation, type SecInvestigationDetail, type SecCaseStatus,
  type SecPriority, type SecIncident, type SecStaff, type SecEvidenceType,
  type SecCaseActivityType,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const PRIORITIES: SecPriority[] = ['Low', 'Medium', 'High', 'Critical'];

const CASE_STATUSES: SecCaseStatus[] = [
  'Open', 'In Progress', 'Evidence Collection', 'Interviews', 'Analysis', 'Review', 'Closed',
];

const EVIDENCE_TYPES: SecEvidenceType[] = [
  'CCTV Footage', 'Photo', 'Document', 'Statement', 'Log', 'Physical', 'Digital', 'Other',
];

const PRIORITY_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const STATUS_TONE: Record<SecCaseStatus, StatusTone> = {
  Open: 'info',
  'In Progress': 'warning',
  'Evidence Collection': 'accent',
  Interviews: 'accent',
  Analysis: 'info',
  Review: 'neutral',
  Closed: 'success',
};

const ACTIVITY_DOT: Record<SecCaseActivityType, string> = {
  'Case Opened': 'bg-emerald-500',
  'Status Change': 'bg-blue-500',
  'Witness Added': 'bg-purple-500',
  'Evidence Added': 'bg-amber-500',
  Note: 'bg-slate-400',
  'Case Closed': 'bg-emerald-500',
};

const EVIDENCE_ICON: Record<SecEvidenceType, LucideIcon> = {
  'CCTV Footage': Camera,
  Photo: Camera,
  Document: ClipboardList,
  Statement: User,
  Log: ClipboardList,
  Physical: FolderOpen,
  Digital: ClipboardList,
  Other: FolderOpen,
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No investigation cases found.</td></tr>
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

const Investigations: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [cases, setCases] = useState<SecInvestigation[]>([]);
  const [incidents, setIncidents] = useState<SecIncident[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecCaseStatus>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | SecPriority>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecInvestigation | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SecInvestigationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecInvestigation | null>(null);

  // Inline add forms inside the detail modal
  const [witnessForm, setWitnessForm] = useState({ name: '', contact: '', statement: '' });
  const [evidenceForm, setEvidenceForm] = useState<{ itemType: SecEvidenceType; description: string; collectedBy: string }>({
    itemType: 'Document', description: '', collectedBy: '',
  });
  const [noteText, setNoteText] = useState('');

  const emptyForm = {
    title: '', incidentId: '', description: '', leadInvestigator: '',
    priority: 'Medium' as SecPriority, status: 'Open' as SecCaseStatus, targetDate: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCases(await fetchSecInvestigations(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load investigations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadLookups = useCallback(async () => {
    try {
      const [inc, stf] = await Promise.all([
        fetchSecIncidents(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setIncidents(inc);
      setStaff(stf);
    } catch { /* non-fatal — dropdowns stay empty */ }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecInvestigation(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load case detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadCases(); loadLookups(); }, [loadCases, loadLookups]);
  useEffect(() => { if (detailId) loadDetail(detailId); }, [detailId, loadDetail]);

  const refreshAll = async () => {
    await Promise.all([loadCases(), loadLookups()]);
    if (detailId) await loadDetail(detailId);
    addNotification('Investigations refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: cases.length,
    open: cases.filter(c => c.status !== 'Closed').length,
    critical: cases.filter(c => c.priority === 'Critical' && c.status !== 'Closed').length,
    evidence: cases.reduce((sum, c) => sum + (c.evidence_count ?? 0), 0),
  }), [cases]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cases.filter(c => {
      const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || c.priority === filterPriority;
      const matchesSearch = !q ||
        c.id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.incident_id?.toLowerCase().includes(q) ?? false) ||
        (c.lead_investigator?.toLowerCase().includes(q) ?? false) ||
        (c.description?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [cases, filterStatus, filterPriority, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (c: SecInvestigation) => {
    setEditing(c);
    setForm({
      title: c.title,
      incidentId: c.incident_id || '',
      description: c.description || '',
      leadInvestigator: c.lead_investigator || '',
      priority: c.priority,
      status: c.status,
      targetDate: c.target_date ? c.target_date.slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const saveCase = async () => {
    if (!form.title.trim()) {
      addNotification('Case title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: form.title.trim(),
        incidentId: form.incidentId || null,
        description: form.description || null,
        leadInvestigator: form.leadInvestigator || null,
        priority: form.priority,
        status: form.status,
        targetDate: form.targetDate || null,
      };
      if (editing) {
        const res = await updateSecInvestigation(editing.id, payload);
        setCases(prev => prev.map(c => (c.id === editing.id ? { ...res.case, witness_count: c.witness_count, evidence_count: c.evidence_count } : c)));
        addNotification(`Case ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecInvestigation({ propertyId: currentPropertyId, ...payload });
        setCases(prev => [{ ...created, witness_count: 0, evidence_count: 0 }, ...prev]);
        addNotification(`Case ${created.id} opened`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save case', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const quickStatus = async (id: string, status: SecCaseStatus) => {
    setActingOn(id);
    try {
      const res = await updateSecInvestigation(id, { status });
      setCases(prev => prev.map(c => (c.id === id ? { ...res.case, witness_count: c.witness_count, evidence_count: c.evidence_count } : c)));
      if (detail?.case.id === id) loadDetail(id);
      addNotification(`Case ${id} → ${status}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Status update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeCase = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecInvestigation(deleteTarget.id);
      setCases(prev => prev.filter(c => c.id !== deleteTarget.id));
      if (detailId === deleteTarget.id) { setDetailId(null); setDetail(null); }
      addNotification(`Case ${deleteTarget.id} deleted`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitWitness = async () => {
    if (!detail || !witnessForm.name.trim()) return;
    setSubmitting(true);
    try {
      await addSecWitness(detail.case.id, {
        name: witnessForm.name.trim(),
        contact: witnessForm.contact || null,
        statement: witnessForm.statement || null,
      });
      setWitnessForm({ name: '', contact: '', statement: '' });
      await Promise.all([loadDetail(detail.case.id), loadCases()]);
      addNotification('Witness added', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add witness', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const removeWitness = async (witnessId: string) => {
    if (!detail) return;
    try {
      await deleteSecWitness(detail.case.id, witnessId);
      await Promise.all([loadDetail(detail.case.id), loadCases()]);
      addNotification('Witness removed', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove witness', 'warning', 'Security');
    }
  };

  const submitEvidence = async () => {
    if (!detail || !evidenceForm.description.trim()) return;
    setSubmitting(true);
    try {
      await addSecEvidence(detail.case.id, {
        itemType: evidenceForm.itemType,
        description: evidenceForm.description.trim(),
        collectedBy: evidenceForm.collectedBy || null,
      });
      setEvidenceForm({ itemType: 'Document', description: '', collectedBy: '' });
      await Promise.all([loadDetail(detail.case.id), loadCases()]);
      addNotification('Evidence logged', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add evidence', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const removeEvidence = async (evidenceId: string) => {
    if (!detail) return;
    try {
      await deleteSecEvidence(detail.case.id, evidenceId);
      await Promise.all([loadDetail(detail.case.id), loadCases()]);
      addNotification('Evidence removed', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove evidence', 'warning', 'Security');
    }
  };

  const submitNote = async () => {
    if (!detail || !noteText.trim()) return;
    setSubmitting(true);
    try {
      await addSecCaseNote(detail.case.id, noteText.trim());
      setNoteText('');
      await loadDetail(detail.case.id);
      addNotification('Note added to timeline', 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add note', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Investigations"
        subtitle="Manage investigation cases, witnesses, evidence, and findings"
        icon={FileSearch}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> New Case
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Cases" value={stats.total} icon={ClipboardList} tone="accent" />
        <StatCard title="Open Cases" value={stats.open} icon={Activity} tone="info" />
        <StatCard title="Critical (Open)" value={stats.critical} icon={ShieldAlert} tone="danger" />
        <StatCard title="Evidence Items" value={stats.evidence} icon={FolderOpen} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadCases} className={button.ghost + ' ml-auto'}>Retry</button>
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
              placeholder="Search ID, title, incident, investigator…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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

      {/* Case register */}
      <SectionCard title="Case Register" subtitle="Case · Incident · Investigator · Status · Evidence" icon={FileSearch} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Case', 'Incident', 'Lead Investigator', 'Priority', 'Status', 'Target Date', 'Evidence', '']}
            rows={filtered.map(c => [
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 shrink-0">
                  <FileSearch className="w-4 h-4 text-[var(--color-accent-operations)]" />
                </div>
                <div className="min-w-0">
                  <button onClick={() => setDetailId(c.id)} className="font-mono text-xs font-bold text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{c.id}</button>
                  <div className="text-[10px] text-slate-400 max-w-[220px] truncate">{c.title}</div>
                </div>
              </div>,
              c.incident_id
                ? <span className="font-mono text-xs">{c.incident_id}</span>
                : <span className="text-slate-400">—</span>,
              c.lead_investigator || <span className="text-slate-400">Unassigned</span>,
              <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>,
              <select
                value={c.status}
                onChange={e => quickStatus(c.id, e.target.value as SecCaseStatus)}
                disabled={actingOn === c.id}
                className={inlineStatusSelect}
              >
                {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <span className="text-xs text-slate-500 flex items-center gap-1"><Calendar size={11} />{fmtDate(c.target_date)}</span>,
              <span className="text-xs flex items-center gap-1"><FolderOpen size={11} className="text-slate-400" />{c.evidence_count ?? 0} items · {c.witness_count ?? 0} wit.</span>,
              <div className="inline-flex gap-2">
                <button onClick={() => setDetailId(c.id)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* New / Edit case modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveCase}
        title={editing ? `Edit ${editing.id}` : 'Open New Case'}
        subtitle={editing ? 'Update case details' : 'Register an investigation case'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Open Case'}
      >
        <div className="space-y-4">
          <Field label="Case Title">
            <input className={inputClass} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Enter case title" />
          </Field>
          <Field label="Related Incident">
            <select className={inputClass} value={form.incidentId} onChange={e => setForm(f => ({ ...f, incidentId: e.target.value }))}>
              <option value="">None</option>
              {incidents.map(i => <option key={i.id} value={i.id}>{i.id} — {i.category || i.incident_type} ({i.location})</option>)}
            </select>
          </Field>
          <Field label="Description">
            <textarea className={inputClass} rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the investigation scope…" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Lead Investigator">
              <select className={inputClass} value={form.leadInvestigator} onChange={e => setForm(f => ({ ...f, leadInvestigator: e.target.value }))}>
                <option value="">Unassigned</option>
                {staff.map(s => <option key={s.id} value={s.name}>{s.name} — {s.role}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as SecPriority }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <select className={inputClass} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SecCaseStatus }))}>
                {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Target Date">
              <input type="date" className={inputClass} value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Case detail modal */}
      <ModalSystem
        isOpen={!!detailId}
        onClose={() => { setDetailId(null); setDetail(null); }}
        title={detail ? `Case ${detail.case.id}` : 'Case Detail'}
        subtitle={detail?.case.title}
        variant="info"
        size="xl"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-6">
            {/* Header info */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={PRIORITY_TONE[detail.case.priority]}>{detail.case.priority}</Badge>
              <Badge tone={STATUS_TONE[detail.case.status]}>{detail.case.status}</Badge>
              {detail.case.incident_id && <Badge tone="neutral">Incident {detail.case.incident_id}</Badge>}
            </div>
            {detail.case.description && (
              <p className="text-sm text-slate-700 dark:text-slate-300">{detail.case.description}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Lead Investigator</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.case.lead_investigator || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Opened</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDate(detail.case.created_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Target Date</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDate(detail.case.target_date)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Update Status</p>
                <select
                  className={inputClass}
                  value={detail.case.status}
                  disabled={actingOn === detail.case.id}
                  onChange={e => quickStatus(detail.case.id, e.target.value as SecCaseStatus)}
                >
                  {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Witnesses */}
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-[var(--color-accent-operations)]" /> Witnesses ({detail.witnesses.length})
                </h4>
                <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                  {detail.witnesses.map(w => (
                    <div key={w.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{w.name}</p>
                        {w.contact && <p className="text-xs text-slate-500">{w.contact}</p>}
                        {w.statement && <p className="text-xs text-slate-400 mt-0.5 italic">"{w.statement}"</p>}
                      </div>
                      <button onClick={() => removeWitness(w.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  {detail.witnesses.length === 0 && <p className="text-xs text-slate-400">No witnesses recorded.</p>}
                </div>
                <div className="space-y-2 pt-3 border-t border-gray-100 dark:border-slate-800">
                  <input className={inputClass} placeholder="Witness name" value={witnessForm.name} onChange={e => setWitnessForm(f => ({ ...f, name: e.target.value }))} />
                  <input className={inputClass} placeholder="Contact (optional)" value={witnessForm.contact} onChange={e => setWitnessForm(f => ({ ...f, contact: e.target.value }))} />
                  <textarea className={inputClass} rows={2} placeholder="Statement (optional)" value={witnessForm.statement} onChange={e => setWitnessForm(f => ({ ...f, statement: e.target.value }))} />
                  <button onClick={submitWitness} disabled={submitting || !witnessForm.name.trim()} className={button.secondary + ' w-full justify-center disabled:opacity-50'}>
                    <Plus className="w-4 h-4" /> Add Witness
                  </button>
                </div>
              </div>

              {/* Evidence */}
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                  <FolderOpen className="w-4 h-4 text-[var(--color-accent-operations)]" /> Evidence ({detail.evidence.length})
                </h4>
                <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                  {detail.evidence.map(ev => {
                    const EvIcon = EVIDENCE_ICON[ev.item_type] || FolderOpen;
                    return (
                      <div key={ev.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                        <div className="flex items-start gap-2 min-w-0">
                          <EvIcon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{ev.description}</p>
                            <p className="text-xs text-slate-500">{ev.item_type}{ev.collected_by ? ` · ${ev.collected_by}` : ''} · {fmtDate(ev.collected_at)}</p>
                          </div>
                        </div>
                        <button onClick={() => removeEvidence(ev.id)} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Remove"><Trash2 size={13} /></button>
                      </div>
                    );
                  })}
                  {detail.evidence.length === 0 && <p className="text-xs text-slate-400">No evidence logged.</p>}
                </div>
                <div className="space-y-2 pt-3 border-t border-gray-100 dark:border-slate-800">
                  <select className={inputClass} value={evidenceForm.itemType} onChange={e => setEvidenceForm(f => ({ ...f, itemType: e.target.value as SecEvidenceType }))}>
                    {EVIDENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input className={inputClass} placeholder="Evidence description" value={evidenceForm.description} onChange={e => setEvidenceForm(f => ({ ...f, description: e.target.value }))} />
                  <input className={inputClass} placeholder="Collected by (optional)" value={evidenceForm.collectedBy} onChange={e => setEvidenceForm(f => ({ ...f, collectedBy: e.target.value }))} />
                  <button onClick={submitEvidence} disabled={submitting || !evidenceForm.description.trim()} className={button.secondary + ' w-full justify-center disabled:opacity-50'}>
                    <Plus className="w-4 h-4" /> Add Evidence
                  </button>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Case Timeline
              </h4>
              <div className="space-y-0 max-h-56 overflow-y-auto">
                {detail.activities.map((a, idx) => (
                  <div key={a.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${ACTIVITY_DOT[a.activity_type] || 'bg-slate-400'}`} />
                      {idx < detail.activities.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-4 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{a.activity_type}</p>
                      <p className="text-xs text-slate-500">{a.description}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock size={10} />{fmtDateTime(a.created_at)}{a.actor ? ` · ${a.actor}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {detail.activities.length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
              </div>
              <div className="flex gap-2 pt-3 border-t border-gray-100 dark:border-slate-800">
                <input className={inputClass} placeholder="Add a case note…" value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitNote()} />
                <button onClick={submitNote} disabled={submitting || !noteText.trim()} className={button.secondary + ' shrink-0 disabled:opacity-50'}>
                  Add Note
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setDetailId(null); setDetail(null); openEdit(detail.case); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit Case
              </button>
              <button onClick={() => setDeleteTarget(detail.case)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Delete Case
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeCase}
        title="Delete Case"
        subtitle={deleteTarget ? `Permanently delete case ${deleteTarget.id} and its witnesses, evidence, and timeline?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default Investigations;
