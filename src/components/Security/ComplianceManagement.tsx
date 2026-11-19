/**
 * Compliance Management — /erp/security/compliance.
 *
 * DB-integrated via /api/sec-portal/compliance-items and
 * /api/sec-portal/compliance-audits routes (migration 615).
 * `sec_compliance_items` is the license/certification/permit register —
 * status is auto-derived from expiry_date server-side (Expired < today,
 * Expiring Soon <= 30 days) unless explicitly Pending/Non-Compliant.
 * `sec_compliance_audits` is the audit register (Scheduled → In Progress
 * → Completed/Cancelled with Pass/Pass with Findings/Fail result).
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FileCheck, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, User, Tag,
  ClipboardCheck, CalendarClock, Award, ShieldCheck, XCircle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecComplianceItems, createSecComplianceItem,
  updateSecComplianceItem, deleteSecComplianceItem,
  fetchSecComplianceAudits, createSecComplianceAudit,
  updateSecComplianceAudit, deleteSecComplianceAudit, fetchSecStaff,
  type SecComplianceItem, type SecComplianceAudit,
  type SecComplianceCategory, type SecComplianceStatus,
  type SecAuditType, type SecAuditStatus, type SecAuditResult, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const CATEGORIES: SecComplianceCategory[] = [
  'License', 'Certification', 'Permit', 'Regulatory',
  'Policy', 'Training', 'Insurance', 'Other',
];
const ITEM_STATUSES: SecComplianceStatus[] = [
  'Compliant', 'Pending', 'Expiring Soon', 'Expired', 'Non-Compliant',
];
const AUDIT_TYPES: SecAuditType[] = ['Internal', 'External', 'Regulatory', 'Insurance'];
const AUDIT_STATUSES: SecAuditStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const AUDIT_RESULTS: SecAuditResult[] = ['Pass', 'Pass with Findings', 'Fail'];

const ITEM_STATUS_TONE: Record<SecComplianceStatus, StatusTone> = {
  Compliant: 'success',
  Pending: 'info',
  'Expiring Soon': 'warning',
  Expired: 'danger',
  'Non-Compliant': 'danger',
};

const AUDIT_RESULT_TONE: Record<SecAuditResult, StatusTone> = {
  Pass: 'success', 'Pass with Findings': 'warning', Fail: 'danger',
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

function daysToExpiry(expiry: string | null | undefined): number | null {
  if (!expiry) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry); exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

function expiryLabel(expiry: string | null | undefined): { text: string; cls: string } {
  const d = daysToExpiry(expiry);
  if (d == null) return { text: '—', cls: 'text-slate-500' };
  if (d < 0) return { text: `${fmtDate(expiry)} · expired ${-d}d ago`, cls: 'text-red-600 font-semibold' };
  if (d <= 30) return { text: `${fmtDate(expiry)} · ${d}d left`, cls: 'text-amber-600 font-semibold' };
  return { text: fmtDate(expiry), cls: 'text-slate-500' };
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

const ComplianceManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [items, setItems] = useState<SecComplianceItem[]>([]);
  const [audits, setAudits] = useState<SecComplianceAudit[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tab, setTab] = useState<'items' | 'audits'>('items');

  // Item filters
  const [itemSearch, setItemSearch] = useState('');
  const [itemFilterStatus, setItemFilterStatus] = useState<'all' | SecComplianceStatus>('all');
  const [itemFilterCategory, setItemFilterCategory] = useState<'all' | SecComplianceCategory>('all');

  // Audit filters
  const [audSearch, setAudSearch] = useState('');
  const [audFilterStatus, setAudFilterStatus] = useState<'all' | SecAuditStatus>('all');
  const [audFilterType, setAudFilterType] = useState<'all' | SecAuditType>('all');

  // Item modals
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<SecComplianceItem | null>(null);
  const [itemDetail, setItemDetail] = useState<SecComplianceItem | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<SecComplianceItem | null>(null);

  // Audit modals
  const [showAuditForm, setShowAuditForm] = useState(false);
  const [editingAudit, setEditingAudit] = useState<SecComplianceAudit | null>(null);
  const [completeAuditTarget, setCompleteAuditTarget] = useState<SecComplianceAudit | null>(null);
  const [deleteAuditTarget, setDeleteAuditTarget] = useState<SecComplianceAudit | null>(null);

  // Audit completion form
  const [audResult, setAudResult] = useState<SecAuditResult>('Pass');
  const [audFindings, setAudFindings] = useState('');

  const emptyItemForm = {
    title: '', category: 'Regulatory' as SecComplianceCategory, authority: '',
    referenceNo: '', status: 'Compliant' as SecComplianceStatus,
    issueDate: '', expiryDate: '', responsible: '', notes: '',
  };
  const [itemForm, setItemForm] = useState({ ...emptyItemForm });

  const emptyAuditForm = {
    title: '', auditType: 'Internal' as SecAuditType, auditor: '',
    scope: '', scheduledAt: '', findings: '',
  };
  const [auditForm, setAuditForm] = useState({ ...emptyAuditForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, a, s] = await Promise.all([
        fetchSecComplianceItems(currentPropertyId),
        fetchSecComplianceAudits(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setItems(i);
      setAudits(a);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const refreshAll = async () => {
    await load();
    addNotification('Compliance data refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    compliant: items.filter(i => i.status === 'Compliant').length,
    expiring: items.filter(i => i.status === 'Expiring Soon' || i.status === 'Expired').length,
    nonCompliant: items.filter(i => i.status === 'Non-Compliant' || i.status === 'Pending').length,
    auditsOpen: audits.filter(a => a.status === 'Scheduled' || a.status === 'In Progress').length,
  }), [items, audits]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.toLowerCase();
    return items.filter(i => {
      const matchesStatus = itemFilterStatus === 'all' || i.status === itemFilterStatus;
      const matchesCategory = itemFilterCategory === 'all' || i.category === itemFilterCategory;
      const matchesSearch = !q ||
        i.id.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        (i.authority?.toLowerCase().includes(q) ?? false) ||
        (i.reference_no?.toLowerCase().includes(q) ?? false) ||
        (i.responsible?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [items, itemFilterStatus, itemFilterCategory, itemSearch]);

  const filteredAudits = useMemo(() => {
    const q = audSearch.toLowerCase();
    return audits.filter(a => {
      const matchesStatus = audFilterStatus === 'all' || a.status === audFilterStatus;
      const matchesType = audFilterType === 'all' || a.audit_type === audFilterType;
      const matchesSearch = !q ||
        a.id.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        (a.auditor?.toLowerCase().includes(q) ?? false) ||
        (a.scope?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [audits, audFilterStatus, audFilterType, audSearch]);

  // ── Item mutations ─────────────────────────────────────────────────────

  const openNewItem = () => {
    setEditingItem(null);
    setItemForm({ ...emptyItemForm });
    setShowItemForm(true);
  };

  const openEditItem = (i: SecComplianceItem) => {
    setEditingItem(i);
    setItemForm({
      title: i.title,
      category: i.category,
      authority: i.authority || '',
      referenceNo: i.reference_no || '',
      status: i.status,
      issueDate: i.issue_date || '',
      expiryDate: i.expiry_date || '',
      responsible: i.responsible || '',
      notes: i.notes || '',
    });
    setShowItemForm(true);
  };

  const saveItem = async () => {
    if (!itemForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: itemForm.title.trim(),
        category: itemForm.category,
        authority: itemForm.authority || null,
        referenceNo: itemForm.referenceNo || null,
        status: itemForm.status,
        issueDate: itemForm.issueDate || null,
        expiryDate: itemForm.expiryDate || null,
        responsible: itemForm.responsible || null,
        notes: itemForm.notes || null,
      };
      if (editingItem) {
        const res = await updateSecComplianceItem(editingItem.id, payload);
        setItems(prev => prev.map(i => (i.id === editingItem.id ? res.item : i)));
        if (itemDetail?.id === editingItem.id) setItemDetail(res.item);
        addNotification(`Item ${editingItem.id} updated → ${res.item.status}`, 'task', 'Security');
      } else {
        const created = await createSecComplianceItem({ propertyId: currentPropertyId, ...payload });
        setItems(prev => [created, ...prev]);
        addNotification(`Compliance item registered — ${created.id} (${created.status})`, 'task', 'Security');
      }
      setShowItemForm(false);
      setEditingItem(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save item', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchItem = async (i: SecComplianceItem, patch: Parameters<typeof updateSecComplianceItem>[1], toast?: string) => {
    setActingOn(i.id);
    try {
      const res = await updateSecComplianceItem(i.id, patch);
      setItems(prev => prev.map(x => (x.id === i.id ? res.item : x)));
      if (itemDetail?.id === i.id) setItemDetail(res.item);
      addNotification(toast || `Item ${i.id} → ${res.item.status}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeItem = async () => {
    if (!deleteItemTarget) return;
    setActingOn(deleteItemTarget.id);
    try {
      await deleteSecComplianceItem(deleteItemTarget.id);
      setItems(prev => prev.filter(i => i.id !== deleteItemTarget.id));
      if (itemDetail?.id === deleteItemTarget.id) setItemDetail(null);
      addNotification(`Item ${deleteItemTarget.id} removed`, 'task', 'Security');
      setDeleteItemTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Audit mutations ────────────────────────────────────────────────────

  const openNewAudit = () => {
    setEditingAudit(null);
    setAuditForm({ ...emptyAuditForm });
    setShowAuditForm(true);
  };

  const openEditAudit = (a: SecComplianceAudit) => {
    setEditingAudit(a);
    setAuditForm({
      title: a.title,
      auditType: a.audit_type,
      auditor: a.auditor || '',
      scope: a.scope || '',
      scheduledAt: a.scheduled_at ? a.scheduled_at.slice(0, 16) : '',
      findings: a.findings || '',
    });
    setShowAuditForm(true);
  };

  const saveAudit = async () => {
    if (!auditForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: auditForm.title.trim(),
        auditType: auditForm.auditType,
        auditor: auditForm.auditor || null,
        scope: auditForm.scope || null,
        scheduledAt: auditForm.scheduledAt || null,
        findings: auditForm.findings || null,
      };
      if (editingAudit) {
        const res = await updateSecComplianceAudit(editingAudit.id, payload);
        setAudits(prev => prev.map(a => (a.id === editingAudit.id ? res.audit : a)));
        addNotification(`Audit ${editingAudit.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecComplianceAudit({ propertyId: currentPropertyId, ...payload });
        setAudits(prev => [created, ...prev]);
        addNotification(`Audit scheduled — ${created.id}`, 'task', 'Security');
      }
      setShowAuditForm(false);
      setEditingAudit(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save audit', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchAudit = async (a: SecComplianceAudit, patch: Parameters<typeof updateSecComplianceAudit>[1], toast?: string) => {
    setActingOn(a.id);
    try {
      const res = await updateSecComplianceAudit(a.id, patch);
      setAudits(prev => prev.map(x => (x.id === a.id ? res.audit : x)));
      addNotification(toast || `Audit ${a.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const openCompleteAudit = (a: SecComplianceAudit) => {
    setCompleteAuditTarget(a);
    setAudResult('Pass');
    setAudFindings(a.findings || '');
  };

  const submitCompleteAudit = async () => {
    if (!completeAuditTarget) return;
    setSubmitting(true);
    try {
      const res = await updateSecComplianceAudit(completeAuditTarget.id, {
        status: 'Completed',
        result: audResult,
        findings: audFindings || null,
      });
      setAudits(prev => prev.map(x => (x.id === completeAuditTarget.id ? res.audit : x)));
      addNotification(`Audit ${completeAuditTarget.id} completed — ${audResult}`, 'task', 'Security');
      setCompleteAuditTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to complete audit', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const removeAudit = async () => {
    if (!deleteAuditTarget) return;
    setActingOn(deleteAuditTarget.id);
    try {
      await deleteSecComplianceAudit(deleteAuditTarget.id);
      setAudits(prev => prev.filter(a => a.id !== deleteAuditTarget.id));
      addNotification(`Audit ${deleteAuditTarget.id} removed`, 'task', 'Security');
      setDeleteAuditTarget(null);
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
        title="Compliance Management"
        subtitle="Regulatory compliance tracking, audits, and certifications"
        icon={FileCheck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {tab === 'items' ? (
              <button onClick={openNewItem} className={button.primary}>
                <Plus className="w-4 h-4" /> New Item
              </button>
            ) : (
              <button onClick={openNewAudit} className={button.primary}>
                <Plus className="w-4 h-4" /> New Audit
              </button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Compliant" value={stats.compliant} icon={ShieldCheck} tone="success" />
        <StatCard title="Expiring / Expired" value={stats.expiring} icon={Clock} tone="warning" />
        <StatCard title="Non-Compliant / Pending" value={stats.nonCompliant} icon={XCircle} tone="danger" />
        <StatCard title="Open Audits" value={stats.auditsOpen} icon={ClipboardCheck} tone="info" />
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
          ['items', 'Compliance Register', FileCheck],
          ['audits', 'Audits', ClipboardCheck],
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

      {/* ── Items tab ── */}
      {tab === 'items' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  placeholder="Search title, ID, authority, ref…"
                  className={inputClass + ' pl-9'}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={itemFilterStatus} onChange={e => setItemFilterStatus(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {ITEM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={itemFilterCategory} onChange={e => setItemFilterCategory(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Compliance Register" subtitle="Item · Category · Authority · Status · Expiry" icon={FileCheck} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Item', 'Category', 'Authority', 'Status', 'Expiry', 'Responsible', '']}
                rows={filteredItems.map(i => {
                  const exp = expiryLabel(i.expiry_date);
                  return [
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg shrink-0 ${i.status === 'Expired' || i.status === 'Non-Compliant' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                        <Award className={`w-4 h-4 ${i.status === 'Expired' || i.status === 'Non-Compliant' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                      </div>
                      <div className="min-w-0">
                        <button onClick={() => setItemDetail(i)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{i.title}</button>
                        <p className="text-[10px] text-slate-400 font-mono">{i.id}{i.reference_no ? ` · ${i.reference_no}` : ''}</p>
                      </div>
                    </div>,
                    <Badge tone="neutral">{i.category}</Badge>,
                    <span className="text-xs">{i.authority || '—'}</span>,
                    <select
                      value={i.status}
                      onChange={e => patchItem(i, { status: e.target.value as SecComplianceStatus }, `Item ${i.id} → ${e.target.value}`)}
                      disabled={actingOn === i.id}
                      className={inlineStatusSelect}
                    >
                      {ITEM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>,
                    <span className={`text-xs ${exp.cls}`}>{exp.text}</span>,
                    <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{i.responsible || '—'}</span>,
                    <div className="inline-flex gap-2">
                      <button onClick={() => setItemDetail(i)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => openEditItem(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteItemTarget(i)} disabled={actingOn === i.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                        {actingOn === i.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>,
                  ];
                })}
                empty={filteredItems.length === 0}
                emptyColSpan={7}
                emptyText="No compliance items found."
              />
            )}
          </SectionCard>
        </>
      )}

      {/* ── Audits tab ── */}
      {tab === 'audits' && (
        <>
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={audSearch}
                  onChange={e => setAudSearch(e.target.value)}
                  placeholder="Search audit, ID, auditor, scope…"
                  className={inputClass + ' pl-9'}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={audFilterStatus} onChange={e => setAudFilterStatus(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {AUDIT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={audFilterType} onChange={e => setAudFilterType(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {AUDIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Audit Register" subtitle="Audit · Type · Auditor · Schedule · Status · Result" icon={ClipboardCheck} tone="accent" pad="none">
            {loading ? <LoadingRow /> : (
              <DataTable
                headers={['Audit', 'Type', 'Auditor', 'Scheduled', 'Status', 'Result', '']}
                rows={filteredAudits.map(a => [
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${a.result === 'Fail' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                      <ClipboardCheck className={`w-4 h-4 ${a.result === 'Fail' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white">{a.title}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{a.id}{a.scope ? ` · ${a.scope}` : ''}</p>
                    </div>
                  </div>,
                  <Badge tone="neutral">{a.audit_type}</Badge>,
                  <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{a.auditor || '—'}</span>,
                  <span className="text-xs text-slate-500 flex items-center gap-1"><CalendarClock size={11} />{fmtDateTime(a.scheduled_at)}</span>,
                  <div className="inline-flex items-center gap-2">
                    <select
                      value={a.status}
                      onChange={e => patchAudit(a, { status: e.target.value as SecAuditStatus }, `Audit ${a.id} → ${e.target.value}`)}
                      disabled={actingOn === a.id || a.status === 'Completed'}
                      className={inlineStatusSelect}
                    >
                      {AUDIT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {(a.status === 'Scheduled' || a.status === 'In Progress') && (
                      <button onClick={() => openCompleteAudit(a)} disabled={actingOn === a.id} className={button.ghost + ' !px-2 !py-1 text-[10px]'} title="Record result">
                        <CheckCircle2 size={12} /> Complete
                      </button>
                    )}
                  </div>,
                  a.result ? <Badge tone={AUDIT_RESULT_TONE[a.result]}>{a.result}</Badge> : <span className="text-xs text-slate-400">—</span>,
                  <div className="inline-flex gap-2">
                    <button onClick={() => openEditAudit(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteAuditTarget(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      {actingOn === a.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ])}
                empty={filteredAudits.length === 0}
                emptyColSpan={7}
                emptyText="No audits scheduled."
              />
            )}
          </SectionCard>
        </>
      )}

      {/* New / Edit item modal */}
      <ModalSystem
        isOpen={showItemForm}
        onClose={() => { setShowItemForm(false); setEditingItem(null); }}
        onConfirm={saveItem}
        title={editingItem ? `Edit ${editingItem.id}` : 'New Compliance Item'}
        subtitle={editingItem ? editingItem.title : 'Register a license, certification, permit, or policy'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editingItem ? 'Save Changes' : 'Register Item'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Title">
              <input className={inputClass} value={itemForm.title} onChange={e => setItemForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Fire Safety Certificate" />
            </Field>
            <Field label="Category">
              <select className={inputClass} value={itemForm.category} onChange={e => setItemForm(f => ({ ...f, category: e.target.value as SecComplianceCategory }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Issuing Authority">
              <input className={inputClass} value={itemForm.authority} onChange={e => setItemForm(f => ({ ...f, authority: e.target.value }))} placeholder="e.g., Civil Defense Authority" />
            </Field>
            <Field label="Reference No.">
              <input className={inputClass} value={itemForm.referenceNo} onChange={e => setItemForm(f => ({ ...f, referenceNo: e.target.value }))} placeholder="e.g., FSC-4471" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Status">
              <select className={inputClass} value={itemForm.status} onChange={e => setItemForm(f => ({ ...f, status: e.target.value as SecComplianceStatus }))}>
                {ITEM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Issue Date">
              <input type="date" className={inputClass} value={itemForm.issueDate} onChange={e => setItemForm(f => ({ ...f, issueDate: e.target.value }))} />
            </Field>
            <Field label="Expiry Date">
              <input type="date" className={inputClass} value={itemForm.expiryDate} onChange={e => setItemForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="Responsible">
            <input
              className={inputClass}
              list="sec-compliance-owners"
              value={itemForm.responsible}
              onChange={e => setItemForm(f => ({ ...f, responsible: e.target.value }))}
              placeholder="Select or type owner"
            />
            <datalist id="sec-compliance-owners">
              {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
            </datalist>
          </Field>
          <Field label="Notes">
            <textarea className={inputClass + ' min-h-[56px]'} value={itemForm.notes} onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))} placeholder="Renewal status, scope, conditions…" />
          </Field>
          <p className="text-[11px] text-slate-400">When an expiry date is set, status auto-derives (past → Expired, within 30 days → Expiring Soon) unless Pending or Non-Compliant is chosen.</p>
        </div>
      </ModalSystem>

      {/* Item detail modal */}
      <ModalSystem
        isOpen={!!itemDetail}
        onClose={() => setItemDetail(null)}
        title={itemDetail ? `Item ${itemDetail.id}` : 'Item Detail'}
        subtitle={itemDetail ? `${itemDetail.title} · ${itemDetail.category}` : ''}
        variant="info"
        showFooter={false}
      >
        {itemDetail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={ITEM_STATUS_TONE[itemDetail.status]}>{itemDetail.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Category</p>
                <Badge tone="neutral">{itemDetail.category}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Authority</p>
                <p className="text-slate-600 dark:text-slate-300">{itemDetail.authority || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reference</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">{itemDetail.reference_no || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Issued</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(itemDetail.issue_date)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Expires</p>
                <p className={expiryLabel(itemDetail.expiry_date).cls}>{expiryLabel(itemDetail.expiry_date).text}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Audit</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(itemDetail.last_audit)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Responsible</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{itemDetail.responsible || '—'}</p>
              </div>
              {itemDetail.notes && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{itemDetail.notes}</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {(itemDetail.status === 'Expired' || itemDetail.status === 'Non-Compliant') && (
                <button onClick={() => patchItem(itemDetail, { status: 'Pending' }, `Item ${itemDetail.id} → Pending renewal`)} disabled={actingOn === itemDetail.id} className={button.primary + ' disabled:opacity-50'}>
                  <RefreshCw className="w-4 h-4" /> Mark Pending Renewal
                </button>
              )}
              {itemDetail.status === 'Pending' && (
                <button onClick={() => patchItem(itemDetail, { status: 'Compliant', issueDate: new Date().toISOString().slice(0, 10) }, `Item ${itemDetail.id} compliant`)} disabled={actingOn === itemDetail.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Mark Compliant
                </button>
              )}
              <button onClick={() => { setItemDetail(null); openEditItem(itemDetail); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteItemTarget(itemDetail)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* New / Edit audit modal */}
      <ModalSystem
        isOpen={showAuditForm}
        onClose={() => { setShowAuditForm(false); setEditingAudit(null); }}
        onConfirm={saveAudit}
        title={editingAudit ? `Edit ${editingAudit.id}` : 'Schedule Audit'}
        subtitle={editingAudit ? editingAudit.title : 'Internal, external, regulatory, or insurance audit'}
        variant="form"
        loading={submitting}
        confirmLabel={editingAudit ? 'Save Changes' : 'Schedule Audit'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Audit Title">
              <input className={inputClass} value={auditForm.title} onChange={e => setAuditForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Q4 Internal Compliance Audit" />
            </Field>
            <Field label="Type">
              <select className={inputClass} value={auditForm.auditType} onChange={e => setAuditForm(f => ({ ...f, auditType: e.target.value as SecAuditType }))}>
                {AUDIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Auditor">
              <input
                className={inputClass}
                list="sec-auditors"
                value={auditForm.auditor}
                onChange={e => setAuditForm(f => ({ ...f, auditor: e.target.value }))}
                placeholder="Select or type auditor"
              />
              <datalist id="sec-auditors">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Scheduled At">
              <input type="datetime-local" className={inputClass} value={auditForm.scheduledAt} onChange={e => setAuditForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Scope">
            <input className={inputClass} value={auditForm.scope} onChange={e => setAuditForm(f => ({ ...f, scope: e.target.value }))} placeholder="What this audit covers…" />
          </Field>
          <Field label="Notes / Preparation">
            <textarea className={inputClass + ' min-h-[56px]'} value={auditForm.findings} onChange={e => setAuditForm(f => ({ ...f, findings: e.target.value }))} placeholder="Preparation notes, documents to gather…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Audit result modal */}
      <ModalSystem
        isOpen={!!completeAuditTarget}
        onClose={() => setCompleteAuditTarget(null)}
        onConfirm={submitCompleteAudit}
        title="Record Audit Result"
        subtitle={completeAuditTarget ? `${completeAuditTarget.id} — ${completeAuditTarget.title}` : ''}
        variant="form"
        loading={submitting}
        confirmLabel="Complete Audit"
      >
        <div className="space-y-4">
          <Field label="Result">
            <div className="flex gap-2">
              {AUDIT_RESULTS.map(r => (
                <button
                  key={r}
                  onClick={() => setAudResult(r)}
                  className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition ${
                    audResult === r
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
            <textarea className={inputClass + ' min-h-[72px]'} value={audFindings} onChange={e => setAudFindings(e.target.value)} placeholder="Audit findings, recommendations, follow-ups…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Delete item confirm */}
      <ModalSystem
        isOpen={!!deleteItemTarget}
        onClose={() => setDeleteItemTarget(null)}
        onConfirm={removeItem}
        title="Remove Compliance Item"
        subtitle={deleteItemTarget ? `Permanently remove ${deleteItemTarget.id} (${deleteItemTarget.title})?` : ''}
        variant="confirm"
        loading={actingOn === deleteItemTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />

      {/* Delete audit confirm */}
      <ModalSystem
        isOpen={!!deleteAuditTarget}
        onClose={() => setDeleteAuditTarget(null)}
        onConfirm={removeAudit}
        title="Remove Audit"
        subtitle={deleteAuditTarget ? `Permanently remove audit ${deleteAuditTarget.id} (${deleteAuditTarget.title})?` : ''}
        variant="confirm"
        loading={actingOn === deleteAuditTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default ComplianceManagement;
