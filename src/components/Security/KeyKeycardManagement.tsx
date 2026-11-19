/**
 * Key & Keycard Management — /erp/security/keys.
 *
 * DB-integrated via /api/sec-portal/keys routes (migration 605).
 * Lifecycle transitions (Issue/Return/Lost/Found/Damaged/Decommission/Audit)
 * stamp dates server-side and append to sec_key_logs — the audit trail in
 * the detail view is a real timeline, not a placeholder.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Key, Plus, Search, Clock, CheckCircle2, Eye, Pencil, Trash2, Tag,
  CreditCard, AlertTriangle, RefreshCw, Unlock, Lock, Loader2,
  ServerCrash, Filter, History, ClipboardCheck, MapPin, Ban,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecKeys, fetchSecKey, createSecKey, updateSecKey,
  reportSecKeyFound, deleteSecKey, fetchSecStaff,
  type SecKey, type SecKeyDetail, type SecKeyStatus, type SecKeyType,
  type SecStaff, type SecKeyLogAction,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const KEY_TYPES: SecKeyType[] = [
  'Master Key', 'Department Key', 'Emergency Key', 'Spare Key',
  'Guest Keycard', 'Mobile Key', 'Staff Card', 'Contractor Card',
];

const KEY_STATUSES: SecKeyStatus[] = [
  'Issued', 'Available', 'Lost', 'Damaged', 'Inactive', 'Decommissioned',
];

const DEPARTMENTS = ['Security', 'Housekeeping', 'Maintenance', 'Front Desk', 'F&B', 'Engineering', 'General'];

const TYPE_TONE: Record<SecKeyType, StatusTone> = {
  'Master Key': 'danger',
  'Department Key': 'info',
  'Emergency Key': 'warning',
  'Spare Key': 'neutral',
  'Guest Keycard': 'success',
  'Mobile Key': 'accent',
  'Staff Card': 'info',
  'Contractor Card': 'warning',
};

const STATUS_TONE: Record<SecKeyStatus, StatusTone> = {
  Issued: 'info',
  Available: 'success',
  Lost: 'danger',
  Damaged: 'warning',
  Inactive: 'neutral',
  Decommissioned: 'danger',
};

const LOG_DOT: Record<SecKeyLogAction, string> = {
  Registered: 'bg-slate-400',
  Issued: 'bg-blue-500',
  Returned: 'bg-emerald-500',
  'Reported Lost': 'bg-red-500',
  'Reported Found': 'bg-emerald-500',
  'Marked Damaged': 'bg-amber-500',
  Decommissioned: 'bg-rose-500',
  Audited: 'bg-purple-500',
  Edited: 'bg-slate-400',
  Note: 'bg-slate-400',
};

const isCardType = (t: SecKeyType) => t.includes('Card') || t === 'Mobile Key';

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

const actionBtn = 'px-3 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';

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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No keys found.</td></tr>
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

const KeyKeycardManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [keys, setKeys] = useState<SecKey[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecKeyStatus>('all');
  const [filterType, setFilterType] = useState<'all' | SecKeyType>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecKey | null>(null);
  const [detail, setDetail] = useState<SecKeyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecKey | null>(null);
  const [issueTarget, setIssueTarget] = useState<SecKey | null>(null);
  const [issueAssignee, setIssueAssignee] = useState('');
  const [issueNote, setIssueNote] = useState('');

  const emptyForm = {
    keyType: 'Department Key' as SecKeyType, keyNumber: '', department: 'General',
    accessLevel: '', location: '', assignedTo: '', issueNow: false,
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setKeys(await fetchSecKeys(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadStaff = useCallback(async () => {
    try {
      setStaff(await fetchSecStaff(currentPropertyId));
    } catch { /* non-fatal — assignee datalist stays empty */ }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecKey(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load key detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadKeys(); loadStaff(); }, [loadKeys, loadStaff]);

  const openDetail = (k: SecKey) => {
    setDetail(null);
    loadDetail(k.id);
  };

  const refreshAll = async () => {
    await Promise.all([loadKeys(), loadStaff()]);
    if (detail) await loadDetail(detail.key.id);
    addNotification('Key register refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: keys.length,
    issued: keys.filter(k => k.status === 'Issued').length,
    problem: keys.filter(k => k.status === 'Lost' || k.status === 'Damaged').length,
    cards: keys.filter(k => isCardType(k.key_type)).length,
  }), [keys]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return keys.filter(k => {
      const matchesStatus = filterStatus === 'all' || k.status === filterStatus;
      const matchesType = filterType === 'all' || k.key_type === filterType;
      const matchesSearch = !q ||
        k.id.toLowerCase().includes(q) ||
        k.key_number.toLowerCase().includes(q) ||
        (k.assigned_to?.toLowerCase().includes(q) ?? false) ||
        (k.department?.toLowerCase().includes(q) ?? false) ||
        (k.location?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [keys, filterStatus, filterType, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (k: SecKey) => {
    setEditing(k);
    setForm({
      keyType: k.key_type,
      keyNumber: k.key_number,
      department: k.department || 'General',
      accessLevel: k.access_level || '',
      location: k.location || '',
      assignedTo: k.assigned_to || '',
      issueNow: false,
    });
    setShowForm(true);
  };

  const saveKey = async () => {
    if (!form.keyNumber.trim()) {
      addNotification('Key number is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const res = await updateSecKey(editing.id, {
          keyType: form.keyType,
          keyNumber: form.keyNumber.trim(),
          department: form.department,
          accessLevel: form.accessLevel || null,
          location: form.location || null,
        });
        setKeys(prev => prev.map(k => (k.id === editing.id ? res.key : k)));
        if (detail?.key.id === editing.id) loadDetail(editing.id);
        addNotification(`Key ${editing.key_number} updated`, 'task', 'Security');
      } else {
        const created = await createSecKey({
          propertyId: currentPropertyId,
          keyType: form.keyType,
          keyNumber: form.keyNumber.trim(),
          department: form.department,
          accessLevel: form.accessLevel || null,
          location: form.location || null,
          status: form.issueNow ? 'Issued' : 'Available',
          assignedTo: form.issueNow ? (form.assignedTo || null) : null,
        });
        setKeys(prev => [created, ...prev]);
        addNotification(`Key ${created.key_number} registered`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save key', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const transition = async (k: SecKey, status: SecKeyStatus, extra?: { assignedTo?: string; transitionNote?: string }) => {
    setActingOn(k.id);
    try {
      const res = await updateSecKey(k.id, { status, ...(extra || {}) });
      setKeys(prev => prev.map(x => (x.id === k.id ? res.key : x)));
      if (detail?.key.id === k.id) loadDetail(k.id);
      addNotification(`Key ${k.key_number} → ${status}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Status update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const submitIssue = async () => {
    if (!issueTarget) return;
    if (!issueAssignee.trim()) {
      addNotification('Assignee is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const res = await updateSecKey(issueTarget.id, {
        status: 'Issued',
        assignedTo: issueAssignee.trim(),
        transitionNote: issueNote || undefined,
      });
      setKeys(prev => prev.map(x => (x.id === issueTarget.id ? res.key : x)));
      if (detail?.key.id === issueTarget.id) loadDetail(issueTarget.id);
      addNotification(`Key ${issueTarget.key_number} issued to ${issueAssignee.trim()}`, 'task', 'Security');
      setIssueTarget(null);
      setIssueAssignee('');
      setIssueNote('');
    } catch (e: any) {
      addNotification(e?.message || 'Issue failed', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const reportFound = async (k: SecKey) => {
    setActingOn(k.id);
    try {
      const res = await reportSecKeyFound(k.id);
      setKeys(prev => prev.map(x => (x.id === k.id ? res.key : x)));
      if (detail?.key.id === k.id) loadDetail(k.id);
      addNotification(`Key ${k.key_number} reported found`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const runAudit = async (k: SecKey) => {
    setActingOn(k.id);
    try {
      const res = await updateSecKey(k.id, { lastAuditDate: new Date().toISOString().slice(0, 10) });
      setKeys(prev => prev.map(x => (x.id === k.id ? res.key : x)));
      if (detail?.key.id === k.id) loadDetail(k.id);
      addNotification(`Key ${k.key_number} audit logged`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Audit failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeKey = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecKey(deleteTarget.id);
      setKeys(prev => prev.filter(k => k.id !== deleteTarget.id));
      if (detail?.key.id === deleteTarget.id) setDetail(null);
      addNotification(`Key ${deleteTarget.key_number} deleted`, 'task', 'Security');
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
        title="Key & Keycard Management"
        subtitle="Track and manage physical keys and electronic keycards"
        icon={Key}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Key
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Keys" value={stats.total} icon={Key} tone="accent" />
        <StatCard title="Issued" value={stats.issued} icon={Unlock} tone="info" />
        <StatCard title="Lost / Damaged" value={stats.problem} icon={AlertTriangle} tone="danger" />
        <StatCard title="Keycards & Mobile" value={stats.cards} icon={CreditCard} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadKeys} className={button.ghost + ' ml-auto'}>Retry</button>
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
              placeholder="Search key number, assignee, dept, location…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {KEY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag size={12} className="text-slate-400" />
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={filterSelect}>
              <option value="all">All Types</option>
              {KEY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Key register */}
      <SectionCard title="Key Register" subtitle="Key · Type · Assignee · Access · Status" icon={Key} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Key', 'Type', 'Assigned To', 'Department', 'Access Level', 'Status', 'Location', '']}
            rows={filtered.map(k => [
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 shrink-0">
                  {isCardType(k.key_type)
                    ? <CreditCard className="w-4 h-4 text-[var(--color-accent-operations)]" />
                    : <Key className="w-4 h-4 text-[var(--color-accent-operations)]" />}
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(k)} className="font-mono text-xs font-bold text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{k.key_number}</button>
                  <div className="text-[10px] text-slate-400 font-mono">{k.id}</div>
                </div>
              </div>,
              <Badge tone={TYPE_TONE[k.key_type]}>{k.key_type}</Badge>,
              k.assigned_to || <span className="text-slate-400">Unassigned</span>,
              k.department || '—',
              k.access_level || '—',
              <Badge tone={STATUS_TONE[k.status]}>{k.status}</Badge>,
              <span className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{k.location || '—'}</span>,
              <div className="inline-flex items-center gap-2">
                {k.status === 'Available' && (
                  <button
                    onClick={() => { setIssueTarget(k); setIssueAssignee(''); setIssueNote(''); }}
                    disabled={actingOn === k.id}
                    className={`${actionBtn} bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300`}
                  >
                    Issue
                  </button>
                )}
                {k.status === 'Issued' && (
                  <button
                    onClick={() => transition(k, 'Available')}
                    disabled={actingOn === k.id}
                    className={`${actionBtn} bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300`}
                  >
                    {actingOn === k.id ? '…' : 'Return'}
                  </button>
                )}
                {k.status === 'Lost' && (
                  <button
                    onClick={() => reportFound(k)}
                    disabled={actingOn === k.id}
                    className={`${actionBtn} bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300`}
                  >
                    {actingOn === k.id ? '…' : 'Found'}
                  </button>
                )}
                <button onClick={() => openDetail(k)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(k)} disabled={actingOn === k.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(k)} disabled={actingOn === k.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === k.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={8}
          />
        )}
      </SectionCard>

      {/* Add / Edit key modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveKey}
        title={editing ? `Edit ${editing.key_number}` : 'Add New Key/Keycard'}
        subtitle={editing ? 'Update key details' : 'Register a key in the inventory'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Add Key'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Key Type">
              <select className={inputClass} value={form.keyType} onChange={e => setForm(f => ({ ...f, keyType: e.target.value as SecKeyType }))}>
                {KEY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Key Number">
              <input className={inputClass} value={form.keyNumber} onChange={e => setForm(f => ({ ...f, keyNumber: e.target.value }))} placeholder="e.g., MK-001" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Department">
              <select className={inputClass} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Access Level">
              <input className={inputClass} value={form.accessLevel} onChange={e => setForm(f => ({ ...f, accessLevel: e.target.value }))} placeholder="e.g., All Guest Rooms" />
            </Field>
          </div>
          <Field label="Storage Location">
            <input className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Security Safe" />
          </Field>
          {!editing && (
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.issueNow} onChange={e => setForm(f => ({ ...f, issueNow: e.target.checked }))} className="rounded accent-[var(--color-accent-operations)]" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Issue immediately</span>
              </label>
              {form.issueNow && (
                <Field label="Issue To">
                  <input className={inputClass} list="sec-holder-list" value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Assignee name" />
                </Field>
              )}
            </div>
          )}
        </div>
      </ModalSystem>

      {/* Issue key modal */}
      <ModalSystem
        isOpen={!!issueTarget}
        onClose={() => setIssueTarget(null)}
        onConfirm={submitIssue}
        title={`Issue ${issueTarget?.key_number || 'Key'}`}
        subtitle={issueTarget ? `${issueTarget.key_type} · ${issueTarget.access_level || ''}` : ''}
        variant="form"
        loading={submitting}
        confirmLabel="Issue Key"
      >
        <div className="space-y-4">
          <Field label="Issue To">
            <input className={inputClass} list="sec-holder-list" value={issueAssignee} onChange={e => setIssueAssignee(e.target.value)} placeholder="Assignee name" />
          </Field>
          <Field label="Note (optional)">
            <input className={inputClass} value={issueNote} onChange={e => setIssueNote(e.target.value)} placeholder="e.g., Shift handover" />
          </Field>
        </div>
      </ModalSystem>
      <datalist id="sec-holder-list">
        {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
      </datalist>

      {/* Key detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Key ${detail.key.key_number}` : 'Key Detail'}
        subtitle={detail ? `${detail.key.key_type} · ${detail.key.id}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={TYPE_TONE[detail.key.key_type]}>{detail.key.key_type}</Badge>
              <Badge tone={STATUS_TONE[detail.key.status]}>{detail.key.status}</Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Assigned To</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.key.assigned_to || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Department</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.key.department || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Access Level</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.key.access_level || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.key.location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Issued Date</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDate(detail.key.issued_date)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Return Date</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtDate(detail.key.return_date)}</p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Audit</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><ClipboardCheck size={11} />{fmtDate(detail.key.last_audit_date)}</p>
              </div>
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.key.status === 'Available' && (
                <button onClick={() => { setIssueTarget(detail.key); setIssueAssignee(''); setIssueNote(''); }} disabled={actingOn === detail.key.id} className={button.primary + ' disabled:opacity-50'}>
                  <Unlock className="w-4 h-4" /> Issue Key
                </button>
              )}
              {detail.key.status === 'Issued' && (
                <>
                  <button onClick={() => transition(detail.key, 'Available')} disabled={actingOn === detail.key.id} className={button.primary + ' disabled:opacity-50'}>
                    <RefreshCw className="w-4 h-4" /> Return Key
                  </button>
                  <button onClick={() => transition(detail.key, 'Lost')} disabled={actingOn === detail.key.id} className={button.secondary + ' text-[var(--color-danger)]'}>
                    <AlertTriangle className="w-4 h-4" /> Report Lost
                  </button>
                </>
              )}
              {detail.key.status === 'Lost' && (
                <button onClick={() => reportFound(detail.key)} disabled={actingOn === detail.key.id} className={button.primary + ' disabled:opacity-50'}>
                  <CheckCircle2 className="w-4 h-4" /> Report Found
                </button>
              )}
              {detail.key.status !== 'Decommissioned' && detail.key.status !== 'Damaged' && (
                <button onClick={() => transition(detail.key, 'Damaged')} disabled={actingOn === detail.key.id} className={button.secondary + ' text-amber-600'}>
                  <Ban className="w-4 h-4" /> Mark Damaged
                </button>
              )}
              <button onClick={() => runAudit(detail.key)} disabled={actingOn === detail.key.id} className={button.secondary}>
                <ClipboardCheck className="w-4 h-4" /> Log Audit
              </button>
              {detail.key.status !== 'Decommissioned' && (
                <button onClick={() => transition(detail.key, 'Decommissioned')} disabled={actingOn === detail.key.id} className={button.secondary + ' text-[var(--color-danger)]'}>
                  <Lock className="w-4 h-4" /> Decommission
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.key); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.key)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>

            {/* Audit trail */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Audit Trail
              </h4>
              <div className="space-y-0 max-h-56 overflow-y-auto">
                {detail.logs.map((l, idx) => (
                  <div key={l.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${LOG_DOT[l.action] || 'bg-slate-400'}`} />
                      {idx < detail.logs.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-4 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{l.action}</p>
                      {l.detail && <p className="text-xs text-slate-500">{l.detail}</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock size={10} />{fmtDateTime(l.created_at)}{l.actor ? ` · ${l.actor}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {detail.logs.length === 0 && <p className="text-xs text-slate-400">No audit entries yet.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeKey}
        title="Delete Key"
        subtitle={deleteTarget ? `Permanently delete key ${deleteTarget.key_number} and its audit trail?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default KeyKeycardManagement;
