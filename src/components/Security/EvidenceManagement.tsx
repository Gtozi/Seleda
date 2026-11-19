/**
 * Evidence Management — /erp/security/evidence.
 *
 * DB-integrated via /api/sec-portal/evidence routes (migration 618).
 * `sec_evidence` is the evidence item register — type (Photo/Video/
 * Document/Physical Item/Digital File/Audio/Other), collection + storage
 * locations, collector, source, nullable links to sec_incidents /
 * sec_investigations / sec_fraud_cases, and a Collected → Secured →
 * In Analysis → Released | Archived lifecycle (Released stamps
 * released_at server-side). `sec_evidence_custody` is the real
 * chain-of-custody log — status transitions auto-log entries and
 * POST /:id/custody records manual transfers/notes.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FolderOpen, Plus, Search, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Tag, Clock, User,
  Lock, History, FileText, MapPin, Box, ArrowLeftRight, FlaskConical,
  Archive, CheckCircle2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecEvidenceItems, fetchSecEvidenceItem, createSecEvidenceItem,
  updateSecEvidenceItem, addSecEvidenceCustody, deleteSecEvidenceItem,
  fetchSecStaff, fetchSecIncidents, fetchSecInvestigations, fetchSecFraudCases,
  type SecEvidenceItem, type SecEvidenceItemDetail, type SecEvidenceItemType,
  type SecEvidenceStatus, type SecEvidenceCustodyAction,
  type SecStaff, type SecIncident, type SecInvestigation, type SecFraudCase,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const EVIDENCE_TYPES: SecEvidenceItemType[] = [
  'Photo', 'Video', 'Document', 'Physical Item', 'Digital File', 'Audio', 'Other',
];
const STATUSES: SecEvidenceStatus[] = ['Collected', 'Secured', 'In Analysis', 'Released', 'Archived'];
const CUSTODY_ACTIONS: SecEvidenceCustodyAction[] = [
  'Logged', 'Transferred', 'Analysis Started', 'Analysis Complete', 'Released', 'Archived', 'Note',
];

const STATUS_TONE: Record<SecEvidenceStatus, StatusTone> = {
  Collected: 'warning',
  Secured: 'success',
  'In Analysis': 'info',
  Released: 'accent',
  Archived: 'neutral',
};

const CUSTODY_DOT: Record<SecEvidenceCustodyAction, string> = {
  Collected: 'bg-indigo-500',
  Logged: 'bg-emerald-500',
  Transferred: 'bg-blue-500',
  'Analysis Started': 'bg-violet-500',
  'Analysis Complete': 'bg-emerald-500',
  Released: 'bg-amber-500',
  Archived: 'bg-slate-500',
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No evidence items found.</td></tr>
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

const EvidenceManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [items, setItems] = useState<SecEvidenceItem[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [incidents, setIncidents] = useState<SecIncident[]>([]);
  const [investigations, setInvestigations] = useState<SecInvestigation[]>([]);
  const [fraudCases, setFraudCases] = useState<SecFraudCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecEvidenceStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecEvidenceItemType>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecEvidenceItem | null>(null);
  const [detail, setDetail] = useState<SecEvidenceItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecEvidenceItem | null>(null);

  // Custody entry form (detail modal)
  const [custodyAction, setCustodyAction] = useState<SecEvidenceCustodyAction>('Transferred');
  const [custodyRecipient, setCustodyRecipient] = useState('');
  const [custodyLocation, setCustodyLocation] = useState('');
  const [custodyDetail, setCustodyDetail] = useState('');

  const emptyForm = {
    title: '', evidenceType: 'Physical Item' as SecEvidenceItemType, description: '',
    location: '', storageLocation: '', collectedBy: '', source: '',
    incidentId: '', investigationId: '', caseId: '', releasedTo: '', notes: '',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s, i, inv, fc] = await Promise.all([
        fetchSecEvidenceItems(currentPropertyId),
        fetchSecStaff(currentPropertyId).catch(() => [] as SecStaff[]),
        fetchSecIncidents(currentPropertyId).catch(() => [] as SecIncident[]),
        fetchSecInvestigations(currentPropertyId).catch(() => [] as SecInvestigation[]),
        fetchSecFraudCases(currentPropertyId).catch(() => [] as SecFraudCase[]),
      ]);
      setItems(e);
      setStaff(s);
      setIncidents(i);
      setInvestigations(inv);
      setFraudCases(fc);
    } catch (e: any) {
      setError(e?.message || 'Failed to load evidence register');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecEvidenceItem(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load evidence detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (e: SecEvidenceItem) => {
    setDetail(null);
    setCustodyAction('Transferred');
    setCustodyRecipient('');
    setCustodyLocation('');
    setCustodyDetail('');
    loadDetail(e.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.evidence.id);
    addNotification('Evidence register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: items.length,
    inCustody: items.filter(i => ['Collected', 'Secured'].includes(i.status)).length,
    inAnalysis: items.filter(i => i.status === 'In Analysis').length,
    released: items.filter(i => i.status === 'Released').length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(i => {
      const matchesStatus = filterStatus === 'all' || i.status === filterStatus;
      const matchesType = filterType === 'all' || i.evidence_type === filterType;
      const matchesSearch = !q ||
        i.id.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        (i.location?.toLowerCase().includes(q) ?? false) ||
        (i.storage_location?.toLowerCase().includes(q) ?? false) ||
        (i.collected_by?.toLowerCase().includes(q) ?? false) ||
        (i.source?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [items, filterStatus, filterType, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (e: SecEvidenceItem) => {
    setEditing(e);
    setForm({
      title: e.title,
      evidenceType: e.evidence_type,
      description: e.description || '',
      location: e.location || '',
      storageLocation: e.storage_location || '',
      collectedBy: e.collected_by || '',
      source: e.source || '',
      incidentId: e.incident_id || '',
      investigationId: e.investigation_id || '',
      caseId: e.case_id || '',
      releasedTo: e.released_to || '',
      notes: e.notes || '',
    });
    setShowForm(true);
  };

  const saveEvidence = async () => {
    if (!form.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: form.title.trim(),
        evidenceType: form.evidenceType,
        description: form.description || null,
        location: form.location || null,
        storageLocation: form.storageLocation || null,
        collectedBy: form.collectedBy || null,
        source: form.source || null,
        incidentId: form.incidentId || null,
        investigationId: form.investigationId || null,
        caseId: form.caseId || null,
        releasedTo: form.releasedTo || null,
        notes: form.notes || null,
      };
      if (editing) {
        const res = await updateSecEvidenceItem(editing.id, payload);
        setItems(prev => prev.map(i => (i.id === editing.id ? res.evidence : i)));
        if (detail?.evidence.id === editing.id) loadDetail(editing.id);
        addNotification(`Evidence ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecEvidenceItem({ propertyId: currentPropertyId, ...payload });
        setItems(prev => [created, ...prev]);
        addNotification(`Evidence logged — ${created.id}`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save evidence', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchEvidence = async (e: SecEvidenceItem, patch: Parameters<typeof updateSecEvidenceItem>[1], toast?: string) => {
    setActingOn(e.id);
    try {
      const res = await updateSecEvidenceItem(e.id, patch);
      setItems(prev => prev.map(x => (x.id === e.id ? res.evidence : x)));
      if (detail?.evidence.id === e.id) loadDetail(e.id);
      addNotification(toast || `Evidence ${e.id} updated`, 'task', 'Security');
    } catch (err: any) {
      addNotification(err?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitCustody = async () => {
    if (!detail) return;
    if (!custodyDetail.trim() && custodyAction !== 'Note') {
      addNotification('Describe the custody entry', 'warning', 'Security');
      return;
    }
    setActingOn(detail.evidence.id);
    try {
      await addSecEvidenceCustody(detail.evidence.id, {
        action: custodyAction,
        recipient: custodyRecipient || null,
        location: custodyLocation || detail.evidence.storage_location || null,
        detail: custodyDetail.trim() || null,
      });
      await loadDetail(detail.evidence.id);
      setCustodyDetail('');
      setCustodyRecipient('');
      addNotification(`${custodyAction} logged`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Custody entry failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeEvidence = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecEvidenceItem(deleteTarget.id);
      setItems(prev => prev.filter(i => i.id !== deleteTarget.id));
      if (detail?.evidence.id === deleteTarget.id) setDetail(null);
      addNotification(`Evidence ${deleteTarget.id} removed`, 'task', 'Security');
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
        title="Evidence Management"
        subtitle="Digital and physical evidence tracking with chain of custody"
        icon={FolderOpen}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> Log Evidence
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Items" value={stats.total} icon={FolderOpen} tone="accent" />
        <StatCard title="In Custody" value={stats.inCustody} icon={Lock} tone="success" />
        <StatCard title="In Analysis" value={stats.inAnalysis} icon={FlaskConical} tone="info" />
        <StatCard title="Released" value={stats.released} icon={ArrowLeftRight} tone="warning" />
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
              placeholder="Search title, ID, location, collector…"
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
              {EVIDENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Evidence register */}
      <SectionCard title="Evidence Register" subtitle="Item · Type · Location · Status · Custody" icon={FolderOpen} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Evidence', 'Type', 'Location', 'Status', 'Collected By', 'Linked To', 'Collected', '']}
            rows={filtered.map(i => [
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg shrink-0 ${i.status === 'Released' ? 'bg-amber-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                  <Box className={`w-4 h-4 ${i.status === 'Released' ? 'text-amber-500' : 'text-[var(--color-accent-operations)]'}`} />
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(i)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{i.title}</button>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {i.id}{i.storage_location ? ` · ${i.storage_location}` : ''}
                  </div>
                </div>
              </div>,
              <Badge tone="neutral">{i.evidence_type}</Badge>,
              <span className="text-xs flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{i.location || '—'}</span>,
              <select
                value={i.status}
                onChange={e => patchEvidence(i, { status: e.target.value as SecEvidenceStatus }, `Evidence ${i.id} → ${e.target.value}`)}
                disabled={actingOn === i.id}
                className={inlineStatusSelect}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{i.collected_by || '—'}</span>,
              <span className="text-[10px] font-mono text-slate-500">
                {[i.incident_id, i.investigation_id, i.case_id].filter(Boolean).join(' · ') || '—'}
              </span>,
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} className="text-slate-400" />{fmtDateTime(i.collected_at)}</span>,
              <div className="inline-flex gap-2">
                <button onClick={() => openDetail(i)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === i.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* New / Edit evidence modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveEvidence}
        title={editing ? `Edit ${editing.id}` : 'Log Evidence'}
        subtitle={editing ? editing.title : 'Register a new evidence item — a Collected custody entry is created automatically'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Log Evidence'}
      >
        <div className="space-y-4">
          <Field label="Title">
            <input className={inputClass} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Lobby CCTV clip — altercation" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Evidence Type">
              <select className={inputClass} value={form.evidenceType} onChange={e => setForm(f => ({ ...f, evidenceType: e.target.value as SecEvidenceItemType }))}>
                {EVIDENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <input className={inputClass} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g., CCTV CAM-003, POS export, guest statement" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Collection Location">
              <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Main Lobby" />
            </Field>
            <Field label="Storage Location">
              <input className={inputClass} value={form.storageLocation} onChange={e => setForm(f => ({ ...f, storageLocation: e.target.value }))} placeholder="e.g., Evidence Locker A / Bin 2" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Collected By">
              <input
                className={inputClass}
                list="sec-evidence-collectors"
                value={form.collectedBy}
                onChange={e => setForm(f => ({ ...f, collectedBy: e.target.value }))}
                placeholder="Select or type collector"
              />
              <datalist id="sec-evidence-collectors">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Released To">
              <input className={inputClass} value={form.releasedTo} onChange={e => setForm(f => ({ ...f, releasedTo: e.target.value }))} placeholder="e.g., Corporate Legal (if released)" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Linked Incident">
              <select className={inputClass} value={form.incidentId} onChange={e => setForm(f => ({ ...f, incidentId: e.target.value }))}>
                <option value="">None</option>
                {incidents.map(i => <option key={i.id} value={i.id}>{i.id}</option>)}
              </select>
            </Field>
            <Field label="Linked Investigation">
              <select className={inputClass} value={form.investigationId} onChange={e => setForm(f => ({ ...f, investigationId: e.target.value }))}>
                <option value="">None</option>
                {investigations.map(i => <option key={i.id} value={i.id}>{i.id} — {i.title}</option>)}
              </select>
            </Field>
            <Field label="Linked Fraud Case">
              <select className={inputClass} value={form.caseId} onChange={e => setForm(f => ({ ...f, caseId: e.target.value }))}>
                <option value="">None</option>
                {fraudCases.map(c => <option key={c.id} value={c.id}>{c.id} — {c.title}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass + ' min-h-[64px]'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What the item is, condition, how it was obtained…" />
          </Field>
          <Field label="Notes">
            <textarea className={inputClass + ' min-h-[48px]'} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Handling instructions, hash/checksum, analysis notes…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Evidence detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Evidence ${detail.evidence.id}` : 'Evidence Detail'}
        subtitle={detail ? `${detail.evidence.title} · ${detail.evidence.evidence_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.evidence.status]}>{detail.evidence.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Type</p>
                <Badge tone="neutral">{detail.evidence.evidence_type}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Collected By</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.evidence.collected_by || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Collected At</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(detail.evidence.collected_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Found At</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><MapPin size={11} />{detail.evidence.location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Storage</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">{detail.evidence.storage_location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Source</p>
                <p className="text-slate-600 dark:text-slate-300">{detail.evidence.source || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Released To</p>
                <p className="text-slate-600 dark:text-slate-300">
                  {detail.evidence.released_to || '—'}{detail.evidence.released_at ? ` · ${fmtDateTime(detail.evidence.released_at)}` : ''}
                </p>
              </div>
              {(detail.evidence.incident_id || detail.evidence.investigation_id || detail.evidence.case_id) && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Linked Records</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.evidence.sec_incidents && <Badge tone="info">Incident {detail.evidence.sec_incidents.id}</Badge>}
                    {detail.evidence.sec_investigations && <Badge tone="accent">Investigation {detail.evidence.sec_investigations.id} — {detail.evidence.sec_investigations.title}</Badge>}
                    {detail.evidence.sec_fraud_cases && <Badge tone="danger">Case {detail.evidence.sec_fraud_cases.id} — {detail.evidence.sec_fraud_cases.title}</Badge>}
                  </div>
                </div>
              )}
              {detail.evidence.description && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.evidence.description}</p>
                </div>
              )}
              {detail.evidence.notes && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.evidence.notes}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.evidence.status === 'Collected' && (
                <button onClick={() => patchEvidence(detail.evidence, { status: 'Secured' }, `Evidence ${detail.evidence.id} secured`)} disabled={actingOn === detail.evidence.id} className={button.primary + ' disabled:opacity-50'}>
                  <Lock className="w-4 h-4" /> Secure in Storage
                </button>
              )}
              {detail.evidence.status === 'Secured' && (
                <button onClick={() => patchEvidence(detail.evidence, { status: 'In Analysis' }, `Evidence ${detail.evidence.id} → In Analysis`)} disabled={actingOn === detail.evidence.id} className={button.secondary + ' disabled:opacity-50'}>
                  <FlaskConical className="w-4 h-4" /> Start Analysis
                </button>
              )}
              {detail.evidence.status === 'In Analysis' && (
                <button onClick={() => patchEvidence(detail.evidence, { status: 'Secured' }, `Analysis complete — ${detail.evidence.id} re-secured`)} disabled={actingOn === detail.evidence.id} className={button.secondary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Analysis Complete — Re-secure
                </button>
              )}
              {detail.evidence.status !== 'Released' && detail.evidence.status !== 'Archived' && (
                <button onClick={() => { setDetail(null); openEdit(detail.evidence); }} className={button.secondary + ' disabled:opacity-50'}>
                  <ArrowLeftRight className="w-4 h-4" /> Release…
                </button>
              )}
              {detail.evidence.status !== 'Archived' && detail.evidence.status !== 'Released' && (
                <button onClick={() => patchEvidence(detail.evidence, { status: 'Archived' }, `Evidence ${detail.evidence.id} archived`)} disabled={actingOn === detail.evidence.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Archive className="w-4 h-4" /> Archive
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.evidence); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.evidence)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Custody entry form */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-[var(--color-accent-operations)]" /> Custody Entry
              </h4>
              <div className="flex flex-wrap gap-2">
                <select className={inputClass + ' !w-auto'} value={custodyAction} onChange={e => setCustodyAction(e.target.value as SecEvidenceCustodyAction)}>
                  {CUSTODY_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input
                  className={inputClass + ' !w-40'}
                  value={custodyRecipient}
                  onChange={e => setCustodyRecipient(e.target.value)}
                  placeholder="Recipient (transfer/release)"
                />
                <input
                  className={inputClass + ' !w-40'}
                  value={custodyLocation}
                  onChange={e => setCustodyLocation(e.target.value)}
                  placeholder="Location"
                />
                <input
                  className={inputClass + ' flex-1 min-w-[200px]'}
                  value={custodyDetail}
                  onChange={e => setCustodyDetail(e.target.value)}
                  placeholder="Transfer details, analysis notes…"
                />
                <button onClick={submitCustody} disabled={actingOn === detail.evidence.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Plus size={14} /> Log
                </button>
              </div>
            </div>

            {/* Chain of custody */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Chain of Custody
              </h4>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {detail.custody.map((l, idx) => (
                  <div key={l.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${CUSTODY_DOT[l.action]}`} />
                      {idx < detail.custody.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <p className="text-sm text-slate-900 dark:text-white">{l.detail || l.action}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                        <span className="font-bold uppercase">{l.action}</span>
                        {l.recipient && <span>· → {l.recipient}</span>}
                        {l.location && <span>· {l.location}</span>}
                        <span>· {fmtDateTime(l.created_at)}</span>
                        {l.actor && <span>· {l.actor}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {detail.custody.length === 0 && <p className="text-xs text-slate-400">No custody entries yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeEvidence}
        title="Remove Evidence"
        subtitle={deleteTarget ? `Permanently remove evidence ${deleteTarget.id} (${deleteTarget.title}) and its custody log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default EvidenceManagement;
