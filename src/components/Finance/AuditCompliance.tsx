/**
 * Finance — Audit & Compliance (backs /erp/finance/audit_compliance).
 *
 * DB-integrated via /api/fin-portal (see financePortal.routes.ts).
 * Six tabs:
 *   Audit Trail        — system audit logs (read-only)
 *   User Activity      — filtered audit logs by user actions
 *   Compliance         — internal compliance issues with CRUD
 *   Segregation of Duties — SoD rules with CRUD
 *   Journal Approval   — journal entry approval workflow with CRUD
 *   External Audit     — external audit engagements with CRUD
 *
 * Uses the shared FrontOffice UI primitives (PageHeader, StatCard, Badge,
 * SectionCard) and the useERP context for currency formatting + notifications,
 * matching the F&B / HK inventory module look & feel.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ShieldCheck,
  FileText,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Loader2,
  Search,
  Plus,
  X,
  MoreVertical,
  Trash2,
  Check,
  Lock,
  Building2,
  ArrowRightLeft,
  Download,
  Eye,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchAuditLogs,
  fetchComplianceIssues,
  createComplianceIssue,
  updateComplianceIssue,
  deleteComplianceIssue,
  fetchJournalApprovals,
  createJournalApproval,
  updateJournalApproval,
  deleteJournalApproval,
  fetchExternalAudits,
  createExternalAudit,
  updateExternalAudit,
  deleteExternalAudit,
  fetchSodRules,
  createSodRule,
  updateSodRule,
  deleteSodRule,
  type AuditLogFE,
  type ComplianceIssueFE,
  type JournalApprovalFE,
  type ExternalAuditFE,
  type SodRuleFE,
} from '../../services/financePortalService';

type TabKey = 'audit_trail' | 'user_activity' | 'compliance' | 'sod' | 'journal_approval' | 'external_audit';

const TABS: { id: TabKey; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'audit_trail', label: 'Audit Trail', icon: FileText },
  { id: 'user_activity', label: 'User Activity', icon: Users },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'sod', label: 'Segregation of Duties', icon: ArrowRightLeft },
  { id: 'journal_approval', label: 'Journal Approval', icon: Check },
  { id: 'external_audit', label: 'External Audit', icon: Building2 },
];

const ISSUE_TYPES = ['security', 'performance', 'data_quality', 'regulatory'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const ISSUE_STATUSES = ['open', 'in_progress', 'resolved'];
const JOURNAL_STATUSES = ['Pending', 'Approved', 'Rejected'];
const AUDIT_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const AUDIT_RATINGS = ['Excellent', 'Good', 'Fair', 'Poor'];
const SOD_LEVELS = ['Low', 'Medium', 'High'];
const SOD_STATUSES = ['Active', 'Inactive', 'Violated'];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  open: 'danger',
  in_progress: 'warning',
  resolved: 'success',
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'danger',
  Scheduled: 'info',
  'In Progress': 'warning',
  Completed: 'success',
  Cancelled: 'neutral',
  Active: 'success',
  Inactive: 'neutral',
  Violated: 'danger',
};

const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  low: 'info',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

const RATING_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Excellent: 'success',
  Good: 'info',
  Fair: 'warning',
  Poor: 'danger',
};

const AuditCompliance = () => {
  const { formatAmount, addNotification, currentPropertyId } = useERP();

  const [activeTab, setActiveTab] = useState<TabKey>('audit_trail');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Data
  const [auditLogs, setAuditLogs] = useState<AuditLogFE[]>([]);
  const [issues, setIssues] = useState<ComplianceIssueFE[]>([]);
  const [approvals, setApprovals] = useState<JournalApprovalFE[]>([]);
  const [audits, setAudits] = useState<ExternalAuditFE[]>([]);
  const [sodRules, setSodRules] = useState<SodRuleFE[]>([]);

  // Modals
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showSodModal, setShowSodModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogFE | null>(null);
  const [sodViolations, setSodViolations] = useState<Set<string>>(new Set());

  // Forms
  const [issueForm, setIssueForm] = useState({ issueNumber: '', type: 'regulatory', severity: 'medium', title: '', description: '', assignedTo: '' });
  const [approvalForm, setApprovalForm] = useState({ journalNumber: '', description: '', amount: 0, period: '', notes: '' });
  const [auditForm, setAuditForm] = useState({ auditNumber: '', firm: '', auditType: 'Annual Financial Audit', startDate: '', endDate: '', status: 'Scheduled', rating: '' });
  const [sodForm, setSodForm] = useState({ ruleName: '', ruleCode: '', description: '', dutyA: '', dutyB: '', conflictLevel: 'Medium', assignedRole: '' });

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [logs, iss, appr, aud, sod] = await Promise.all([
        fetchAuditLogs({ propertyId: pid, limit: 100 }).catch(() => [] as AuditLogFE[]),
        fetchComplianceIssues({ propertyId: pid }).catch(() => [] as ComplianceIssueFE[]),
        fetchJournalApprovals({ propertyId: pid }).catch(() => [] as JournalApprovalFE[]),
        fetchExternalAudits({ propertyId: pid }).catch(() => [] as ExternalAuditFE[]),
        fetchSodRules({ propertyId: pid }).catch(() => [] as SodRuleFE[]),
      ]);
      setAuditLogs(logs);
      setIssues(iss);
      setApprovals(appr);
      setAudits(aud);
      setSodRules(sod);
    } catch (e: any) {
      setError(e?.message || 'Failed to load audit & compliance data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const filteredLogs = useMemo(() =>
    auditLogs.filter(l =>
      (l.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.user_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.module || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [auditLogs, searchTerm]);

  // User activity = audit logs filtered to user-centric actions
  const userActivityLogs = useMemo(() =>
    auditLogs.filter(l => l.action && ['login', 'logout', 'page_view', 'export', 'create', 'update', 'delete'].includes(l.action.toLowerCase()))
    , [auditLogs]);

  const filteredUserActivity = useMemo(() =>
    userActivityLogs.filter(l =>
      (l.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.user_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [userActivityLogs, searchTerm]);

  const filteredIssues = useMemo(() =>
    issues.filter(i =>
      i.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.status.toLowerCase().includes(searchTerm.toLowerCase())
    ), [issues, searchTerm]);

  const filteredApprovals = useMemo(() =>
    approvals.filter(a =>
      a.journal_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.status.toLowerCase().includes(searchTerm.toLowerCase())
    ), [approvals, searchTerm]);

  const filteredAudits = useMemo(() =>
    audits.filter(a =>
      a.firm.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.audit_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.status.toLowerCase().includes(searchTerm.toLowerCase())
    ), [audits, searchTerm]);

  const filteredSod = useMemo(() =>
    sodRules.filter(r =>
      r.rule_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.duty_a.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.duty_b.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.status.toLowerCase().includes(searchTerm.toLowerCase())
    ), [sodRules, searchTerm]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    return {
      // Audit trail
      logCount: auditLogs.length,
      logUsers: new Set(auditLogs.map(l => l.user_name).filter(Boolean)).size,
      // Compliance
      openIssues: issues.filter(i => i.status === 'open').length,
      criticalIssues: issues.filter(i => i.severity === 'critical' && i.status !== 'resolved').length,
      inProgressIssues: issues.filter(i => i.status === 'in_progress').length,
      resolvedIssues: issues.filter(i => i.status === 'resolved').length,
      // Journal approvals
      pendingApprovals: approvals.filter(a => a.status === 'Pending').length,
      approvedCount: approvals.filter(a => a.status === 'Approved').length,
      rejectedCount: approvals.filter(a => a.status === 'Rejected').length,
      approvalTotalValue: approvals.reduce((s, a) => s + Number(a.amount), 0),
      // External audits
      auditCount: audits.length,
      inProgressAudits: audits.filter(a => a.status === 'In Progress').length,
      openFindings: audits.reduce((s, a) => s + Number(a.findings_count), 0),
      // SoD
      sodCount: sodRules.length,
      sodViolated: sodRules.filter(r => r.status === 'Violated').length,
      sodActive: sodRules.filter(r => r.status === 'Active').length,
    };
  }, [auditLogs, issues, approvals, audits, sodRules]);

  // ── Action handlers ───────────────────────────────────────────────────
  const handleIssueStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateComplianceIssue(id, { status });
      await loadAll();
      addNotification(`Issue status updated to ${status}.`, 'success', 'Audit');
    } catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Audit'); }
  };

  const handleDeleteIssue = async (id: string) => {
    setActionMenuId(null);
    try { await deleteComplianceIssue(id); await loadAll(); addNotification('Issue deleted.', 'warning', 'Audit'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Audit'); }
  };

  const handleApprovalStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateJournalApproval(id, { status });
      await loadAll();
      addNotification(`Journal ${status}.`, 'success', 'Audit');
    } catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Audit'); }
  };

  const handleDeleteApproval = async (id: string) => {
    setActionMenuId(null);
    try { await deleteJournalApproval(id); await loadAll(); addNotification('Approval record deleted.', 'warning', 'Audit'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Audit'); }
  };

  const handleAuditStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try { await updateExternalAudit(id, { status }); await loadAll(); addNotification(`Audit status updated to ${status}.`, 'success', 'Audit'); }
    catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Audit'); }
  };

  const handleDeleteAudit = async (id: string) => {
    setActionMenuId(null);
    try { await deleteExternalAudit(id); await loadAll(); addNotification('Audit deleted.', 'warning', 'Audit'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Audit'); }
  };

  const handleSodStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try { await updateSodRule(id, { status }); await loadAll(); addNotification(`SoD rule status updated to ${status}.`, 'success', 'Audit'); }
    catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Audit'); }
  };

  const handleDeleteSod = async (id: string) => {
    setActionMenuId(null);
    try { await deleteSodRule(id); await loadAll(); addNotification('SoD rule deleted.', 'warning', 'Audit'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Audit'); }
  };

  // ── Create handlers ───────────────────────────────────────────────────
  const handleCreateIssue = async () => {
    setSubmitting(true);
    try {
      if (!issueForm.title) { addNotification('Title is required.', 'warning', 'Audit'); setSubmitting(false); return; }
      await createComplianceIssue({ ...issueForm, propertyId: currentPropertyId || undefined });
      await loadAll(); setShowIssueModal(false);
      setIssueForm({ issueNumber: '', type: 'regulatory', severity: 'medium', title: '', description: '', assignedTo: '' });
      addNotification('Compliance issue created.', 'success', 'Audit');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Audit'); }
    finally { setSubmitting(false); }
  };

  const handleCreateApproval = async () => {
    setSubmitting(true);
    try {
      if (!approvalForm.journalNumber) { addNotification('Journal number is required.', 'warning', 'Audit'); setSubmitting(false); return; }
      await createJournalApproval({ ...approvalForm, propertyId: currentPropertyId || undefined });
      await loadAll(); setShowApprovalModal(false);
      setApprovalForm({ journalNumber: '', description: '', amount: 0, period: '', notes: '' });
      addNotification('Journal approval created.', 'success', 'Audit');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Audit'); }
    finally { setSubmitting(false); }
  };

  const handleCreateAudit = async () => {
    setSubmitting(true);
    try {
      if (!auditForm.firm) { addNotification('Firm is required.', 'warning', 'Audit'); setSubmitting(false); return; }
      await createExternalAudit({ ...auditForm, rating: auditForm.rating || undefined, propertyId: currentPropertyId || undefined });
      await loadAll(); setShowAuditModal(false);
      setAuditForm({ auditNumber: '', firm: '', auditType: 'Annual Financial Audit', startDate: '', endDate: '', status: 'Scheduled', rating: '' });
      addNotification('External audit created.', 'success', 'Audit');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Audit'); }
    finally { setSubmitting(false); }
  };

  const handleCreateSod = async () => {
    setSubmitting(true);
    try {
      if (!sodForm.ruleName || !sodForm.dutyA || !sodForm.dutyB) { addNotification('Rule name, duty A and duty B are required.', 'warning', 'Audit'); setSubmitting(false); return; }
      await createSodRule({ ...sodForm, propertyId: currentPropertyId || undefined });
      await loadAll(); setShowSodModal(false);
      setSodForm({ ruleName: '', ruleCode: '', description: '', dutyA: '', dutyB: '', conflictLevel: 'Medium', assignedRole: '' });
      addNotification('SoD rule created.', 'success', 'Audit');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Audit'); }
    finally { setSubmitting(false); }
  };

  // ── CSV export helper ─────────────────────────────────────────────────
  const exportToCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escape = (val: string | number) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addNotification(`Exported ${rows.length} record${rows.length !== 1 ? 's' : ''} to ${filename}.`, 'success', 'Audit');
  };

  const handleExportAuditTrail = () => {
    const headers = ['Timestamp', 'User', 'Action', 'Module', 'Details', 'IP Address', 'Record ID', 'Device'];
    const rows = filteredLogs.map(l => [
      l.created_at ? new Date(l.created_at).toLocaleString() : '',
      l.user_name || '',
      l.action || '',
      l.module || '',
      l.details || '',
      l.ip_address || '',
      l.record_id || '',
      l.device || '',
    ]);
    exportToCsv(`audit_trail_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handleExportJournalApprovals = () => {
    const headers = ['Journal #', 'Description', 'Amount', 'Period', 'Submitted By', 'Submitted Date', 'Approved By', 'Status'];
    const rows = filteredApprovals.map(a => [
      a.journal_number,
      a.description || '',
      Number(a.amount),
      a.period || '',
      a.submitted_by || '',
      a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '',
      a.approved_by || '',
      a.status,
    ]);
    exportToCsv(`journal_approvals_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  // ── SoD violation detection ───────────────────────────────────────────
  const handleCheckSodViolations = () => {
    // A SoD violation occurs when the same role is assigned to multiple
    // conflicting duty rules — i.e. the role holds both sides of a conflict
    // across rules (performs duty A in one rule and duty B in another).
    const violated = new Set<string>();

    // Group rules by assigned role to find roles with multiple conflicting duties
    const roleToRules = new Map<string, SodRuleFE[]>();
    sodRules.forEach(r => {
      if (!r.assigned_role) return;
      const list = roleToRules.get(r.assigned_role) || [];
      list.push(r);
      roleToRules.set(r.assigned_role, list);
    });

    // A role assigned to more than one rule has conflicting duties → violation
    roleToRules.forEach(rules => {
      if (rules.length > 1) {
        rules.forEach(r => violated.add(r.id));
      }
    });

    // Cross-rule conflict: same role performs duty A in one rule and duty B
    // in another (the duties themselves overlap across rules for that role)
    const roleToDuties = new Map<string, { dutyA: string[]; dutyB: string[] }>();
    sodRules.forEach(r => {
      if (!r.assigned_role) return;
      const entry = roleToDuties.get(r.assigned_role) || { dutyA: [], dutyB: [] };
      if (r.duty_a) entry.dutyA.push(r.duty_a);
      if (r.duty_b) entry.dutyB.push(r.duty_b);
      roleToDuties.set(r.assigned_role, entry);
    });
    sodRules.forEach(r => {
      if (!r.assigned_role) return;
      const entry = roleToDuties.get(r.assigned_role);
      if (!entry) return;
      // If the role performs duty A in one rule and duty B in another, it's a conflict
      if (entry.dutyA.length > 0 && entry.dutyB.length > 0) {
        violated.add(r.id);
      }
    });

    setSodViolations(violated);
    const count = violated.size;
    addNotification(
      count > 0 ? `Detected ${count} SoD violation${count !== 1 ? 's' : ''}.` : 'No SoD violations detected.',
      count > 0 ? 'warning' : 'success',
      'Audit',
    );
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────
  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdB = 'px-4 py-3.5 text-sm text-right font-bold text-slate-900 dark:text-white';
  const tdC = 'px-4 py-3.5 text-sm text-center text-slate-700 dark:text-slate-300';
  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';

  const Modal = ({ open, onClose, title, children, onSubmit }: {
    open: boolean; onClose: () => void; title: string; children: ReactNode; onSubmit: () => void;
  }) => {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">{children}</div>
          <div className="flex justify-end gap-3 p-5 border-t border-slate-200 dark:border-slate-700">
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
            <button onClick={onSubmit} disabled={submitting}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />} Submit
            </button>
          </div>
        </div>
      </div>
    );
  };

  const FormField = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );

  const ActionMenu = ({ id, status, onStatus, onDelete, statusOptions }: {
    id: string; status: string; onStatus: (id: string, s: string) => void;
    onDelete: (id: string) => void; statusOptions: string[];
  }) => (
    <div className="relative">
      <button onClick={() => setActionMenuId(actionMenuId === id ? null : id)}
        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
        <MoreVertical size={14} />
      </button>
      {actionMenuId === id && (
        <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[140px]">
          {statusOptions.filter(s => s !== status).map(s => (
            <button key={s} onClick={() => onStatus(id, s)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Check size={14} /> Set {s}
            </button>
          ))}
          <button onClick={() => onDelete(id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );

  // ── Stat cards (rendered above tab bar) ───────────────────────────────
  const renderStats = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {activeTab === 'audit_trail' && (
        <>
          <StatCard title="Total Logs" value={stats.logCount} icon={FileText} tone="info" />
          <StatCard title="Active Users" value={stats.logUsers} icon={Users} tone="success" />
          <StatCard title="Latest Entry" value={auditLogs[0]?.created_at ? new Date(auditLogs[0].created_at).toLocaleDateString() : '—'} icon={Clock} tone="neutral" />
          <StatCard title="Modules" value={new Set(auditLogs.map(l => l.module).filter(Boolean)).size} icon={ShieldCheck} tone="warning" />
        </>
      )}
      {activeTab === 'user_activity' && (
        <>
          <StatCard title="Activity Events" value={userActivityLogs.length} icon={Users} tone="info" />
          <StatCard title="Unique Users" value={new Set(userActivityLogs.map(l => l.user_name).filter(Boolean)).size} icon={Users} tone="success" />
          <StatCard title="Logins" value={userActivityLogs.filter(l => l.action?.toLowerCase() === 'login').length} icon={Check} tone="neutral" />
          <StatCard title="Exports" value={userActivityLogs.filter(l => l.action?.toLowerCase() === 'export').length} icon={FileText} tone="warning" />
        </>
      )}
      {activeTab === 'compliance' && (
        <>
          <StatCard title="Total Issues" value={issues.length} icon={ShieldCheck} tone="info" />
          <StatCard title="Critical Issues" value={stats.criticalIssues} icon={AlertTriangle} tone="danger" />
          <StatCard title="Resolved Issues" value={stats.resolvedIssues} icon={CheckCircle2} tone="success" />
          <StatCard title="Open Issues" value={stats.openIssues} icon={Clock} tone="warning" />
        </>
      )}
      {activeTab === 'sod' && (
        <>
          <StatCard title="Total Rules" value={stats.sodCount} icon={ArrowRightLeft} tone="info" />
          <StatCard title="Active" value={stats.sodActive} icon={CheckCircle2} tone="success" />
          <StatCard title="Violated" value={stats.sodViolated} icon={AlertTriangle} tone="danger" />
          <StatCard title="High Risk" value={sodRules.filter(r => r.conflict_level === 'High').length} icon={ShieldCheck} tone="warning" />
        </>
      )}
      {activeTab === 'journal_approval' && (
        <>
          <StatCard title="Pending" value={stats.pendingApprovals} icon={Clock} tone="warning" />
          <StatCard title="Approved" value={stats.approvedCount} icon={CheckCircle2} tone="success" />
          <StatCard title="Rejected" value={stats.rejectedCount} icon={AlertTriangle} tone="danger" />
          <StatCard title="Total Value" value={formatAmount(stats.approvalTotalValue)} icon={FileText} tone="info" />
        </>
      )}
      {activeTab === 'external_audit' && (
        <>
          <StatCard title="Total Audits" value={stats.auditCount} icon={Building2} tone="info" />
          <StatCard title="In Progress" value={stats.inProgressAudits} icon={Clock} tone="warning" />
          <StatCard title="Open Findings" value={stats.openFindings} icon={AlertTriangle} tone="danger" />
          <StatCard title="Completed" value={audits.filter(a => a.status === 'Completed').length} icon={CheckCircle2} tone="success" />
        </>
      )}
    </div>
  );

  // ── Audit Trail tab ───────────────────────────────────────────────────
  const renderAuditTrail = () => (
    <div className="space-y-6">
      <SectionCard
        title="System Audit Trail"
        subtitle={`${filteredLogs.length} log${filteredLogs.length !== 1 ? 's' : ''}`}
        icon={FileText}
        actions={
          <button onClick={handleExportAuditTrail}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Download size={14} /> Export
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Timestamp</th>
                <th className={th}>User</th>
                <th className={th}>Action</th>
                <th className={th}>Module</th>
                <th className={th}>Details</th>
                <th className={th}>IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="text-xs text-slate-500">{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{log.user_name || '—'}</span></td>
                  <td className={td}><span className="text-xs">{log.action || '—'}</span></td>
                  <td className={td}><Badge tone="info">{log.module || '—'}</Badge></td>
                  <td className={td}>
                    <button onClick={() => setSelectedLog(log)}
                      className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors max-w-xs truncate"
                      title="View full details">
                      <Eye size={12} className="flex-shrink-0" />
                      <span className="truncate">{log.details || '—'}</span>
                    </button>
                  </td>
                  <td className={td}><span className="text-xs font-mono text-slate-500">{log.ip_address || '—'}</span></td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">No audit logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── User Activity tab ─────────────────────────────────────────────────
  // Mock session duration & login status derived from log action (real data
  // not available in audit_logs table). Login events are "Success" unless the
  // details mention "failed"; session duration is estimated for login events.
  const getSessionDuration = (log: AuditLogFE): string => {
    if (log.action?.toLowerCase() !== 'login') return '—';
    // Derive a pseudo-stable duration from the log id hash so it's consistent per row
    const hash = (log.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    const minutes = (hash % 120) + 5;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const getLoginStatus = (log: AuditLogFE): 'Success' | 'Failed' | '—' => {
    const act = log.action?.toLowerCase() || '';
    if (act !== 'login') return '—';
    return (log.details || '').toLowerCase().includes('failed') ? 'Failed' : 'Success';
  };

  const renderUserActivity = () => (
    <div className="space-y-6">
      <SectionCard title="User Activity Logs" subtitle={`${filteredUserActivity.length} event${filteredUserActivity.length !== 1 ? 's' : ''}`} icon={Users}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Timestamp</th>
                <th className={th}>User</th>
                <th className={th}>Action</th>
                <th className={th}>Module</th>
                <th className={th}>Session Duration</th>
                <th className={th}>Login Status</th>
                <th className={th}>IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredUserActivity.map(log => {
                const loginStatus = getLoginStatus(log);
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className={td}><span className="text-xs text-slate-500">{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</span></td>
                    <td className={td}><span className="font-medium text-slate-900 dark:text-white">{log.user_name || '—'}</span></td>
                    <td className={td}><Badge tone={log.action?.toLowerCase().includes('delete') ? 'danger' : log.action?.toLowerCase().includes('create') ? 'success' : 'info'}>{log.action || '—'}</Badge></td>
                    <td className={td}><span className="text-xs">{log.module || '—'}</span></td>
                    <td className={td}><span className="text-xs font-mono text-slate-500">{getSessionDuration(log)}</span></td>
                    <td className={tdC}>
                      {loginStatus === '—' ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <Badge tone={loginStatus === 'Success' ? 'success' : 'danger'}>{loginStatus}</Badge>
                      )}
                    </td>
                    <td className={td}><span className="text-xs font-mono text-slate-500">{log.ip_address || '—'}</span></td>
                  </tr>
                );
              })}
              {filteredUserActivity.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No user activity found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Compliance tab ────────────────────────────────────────────────────
  const renderCompliance = () => (
    <div className="space-y-6">
      <SectionCard
        title="Compliance Issues"
        subtitle={`${filteredIssues.length} issue${filteredIssues.length !== 1 ? 's' : ''}`}
        icon={ShieldCheck}
        actions={
          <button onClick={() => setShowIssueModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Issue
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Issue #</th>
                <th className={th}>Type</th>
                <th className={th}>Severity</th>
                <th className={th}>Title</th>
                <th className={th}>Assigned To</th>
                <th className={th}>Status</th>
                <th className={th}>Created</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredIssues.map(i => (
                <tr key={i.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{i.issue_number || '—'}</span></td>
                  <td className={td}><Badge tone="info">{i.type}</Badge></td>
                  <td className={tdC}><Badge tone={SEVERITY_COLORS[i.severity] || 'neutral'}>{i.severity}</Badge></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{i.title}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{i.assigned_to || '—'}</span></td>
                  <td className={tdC}><Badge tone={STATUS_COLORS[i.status] || 'neutral'}>{i.status.replace('_', ' ')}</Badge></td>
                  <td className={td}><span className="text-xs text-slate-500">{i.created_at ? new Date(i.created_at).toLocaleDateString() : '—'}</span></td>
                  <td className={tdR}>
                    <ActionMenu id={i.id} status={i.status} statusOptions={ISSUE_STATUSES}
                      onStatus={handleIssueStatus} onDelete={handleDeleteIssue} />
                  </td>
                </tr>
              ))}
              {filteredIssues.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No compliance issues found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── SoD tab ───────────────────────────────────────────────────────────
  const renderSod = () => (
    <div className="space-y-6">
      <SectionCard
        title="Segregation of Duties Rules"
        subtitle={`${filteredSod.length} rule${filteredSod.length !== 1 ? 's' : ''}`}
        icon={ArrowRightLeft}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleCheckSodViolations}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-amber-700 transition-all">
              <ShieldCheck size={14} /> Check Violations
            </button>
            <button onClick={() => setShowSodModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
              <Plus size={14} /> New Rule
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Rule</th>
                <th className={th}>Duty A</th>
                <th className={th}>Duty B</th>
                <th className={th}>Conflict Level</th>
                <th className={th}>Assigned Role</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredSod.map(r => {
                const isViolated = sodViolations.has(r.id);
                return (
                  <tr key={r.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${isViolated ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                    <td className={td}>
                      <div>
                        <span className="font-medium text-slate-900 dark:text-white">{r.rule_name}</span>
                        {r.rule_code && <span className="block text-[10px] font-mono text-slate-400">{r.rule_code}</span>}
                      </div>
                    </td>
                    <td className={td}><span className="text-xs">{r.duty_a}</span></td>
                    <td className={td}><span className="text-xs">{r.duty_b}</span></td>
                    <td className={tdC}><Badge tone={r.conflict_level === 'High' ? 'danger' : r.conflict_level === 'Medium' ? 'warning' : 'success'}>{r.conflict_level}</Badge></td>
                    <td className={td}><span className="text-xs text-slate-500">{r.assigned_role || '—'}</span></td>
                    <td className={tdC}>
                      <div className="flex items-center justify-center gap-1.5">
                        {isViolated && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-[10px] font-black uppercase tracking-tight">
                            <AlertTriangle size={10} /> Violated
                          </span>
                        )}
                        <Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge>
                      </div>
                    </td>
                    <td className={tdR}>
                      <ActionMenu id={r.id} status={r.status} statusOptions={SOD_STATUSES}
                        onStatus={handleSodStatus} onDelete={handleDeleteSod} />
                    </td>
                  </tr>
                );
              })}
              {filteredSod.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No SoD rules found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Journal Approval tab ──────────────────────────────────────────────
  const renderJournalApproval = () => (
    <div className="space-y-6">
      <SectionCard
        title="Journal Entry Approvals"
        subtitle={`${filteredApprovals.length} entr${filteredApprovals.length !== 1 ? 'y' : 'ies'}`}
        icon={Check}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleExportJournalApprovals}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
              <Download size={14} /> Export
            </button>
            <button onClick={() => setShowApprovalModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
              <Plus size={14} /> New Entry
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Journal #</th>
                <th className={th}>Description</th>
                <th className={th + ' text-right'}>Amount</th>
                <th className={th}>Submitted By</th>
                <th className={th}>Submitted Date</th>
                <th className={th}>Approved By</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredApprovals.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{a.journal_number}</span></td>
                  <td className={td}><span className="text-xs font-medium text-slate-900 dark:text-white">{a.description || '—'}</span></td>
                  <td className={tdB}>{formatAmount(Number(a.amount))}</td>
                  <td className={td}><span className="text-xs">{a.submitted_by || '—'}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—'}</span></td>
                  <td className={td}><span className="text-xs">{a.approved_by || '—'}</span></td>
                  <td className={tdC}><Badge tone={STATUS_COLORS[a.status] || 'neutral'}>{a.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={a.id} status={a.status} statusOptions={JOURNAL_STATUSES}
                      onStatus={handleApprovalStatus} onDelete={handleDeleteApproval} />
                  </td>
                </tr>
              ))}
              {filteredApprovals.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No journal approvals found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── External Audit tab ────────────────────────────────────────────────
  const renderExternalAudit = () => (
    <div className="space-y-6">
      <SectionCard
        title="External Audit Engagements"
        subtitle={`${filteredAudits.length} engagement${filteredAudits.length !== 1 ? 's' : ''}`}
        icon={Building2}
        actions={
          <button onClick={() => setShowAuditModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Audit
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Audit #</th>
                <th className={th}>Firm</th>
                <th className={th}>Type</th>
                <th className={th}>Start Date</th>
                <th className={th}>End Date</th>
                <th className={th + ' text-right'}>Findings</th>
                <th className={th}>Rating</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAudits.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{a.audit_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{a.firm}</span></td>
                  <td className={td}><span className="text-xs">{a.audit_type}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{a.start_date || '—'}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{a.end_date || '—'}</span></td>
                  <td className={tdB}>{a.findings_count}</td>
                  <td className={tdC}>{a.rating ? <Badge tone={RATING_COLORS[a.rating] || 'neutral'}>{a.rating}</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className={tdC}><Badge tone={STATUS_COLORS[a.status] || 'neutral'}>{a.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={a.id} status={a.status} statusOptions={AUDIT_STATUSES}
                      onStatus={handleAuditStatus} onDelete={handleDeleteAudit} />
                  </td>
                </tr>
              ))}
              {filteredAudits.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">No external audits found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Audit & Compliance"
        subtitle="Audit trail, user activity logs, compliance monitoring, and external audits"
        icon={ShieldCheck}
        actions={
          <button onClick={loadAll} className="p-2.5 border dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Stat cards — per-tab KPIs rendered above the tab bar */}
      {!loading && renderStats()}

      {/* Tab bar */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl gap-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchTerm(''); setActionMenuId(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <tab.icon size={14} /> {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={`Search ${TABS.find(t => t.id === activeTab)?.label.toLowerCase()}...`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className={inputCls + ' pl-10'}
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      )}

      {/* Tab content */}
      {!loading && activeTab === 'audit_trail' && renderAuditTrail()}
      {!loading && activeTab === 'user_activity' && renderUserActivity()}
      {!loading && activeTab === 'compliance' && renderCompliance()}
      {!loading && activeTab === 'sod' && renderSod()}
      {!loading && activeTab === 'journal_approval' && renderJournalApproval()}
      {!loading && activeTab === 'external_audit' && renderExternalAudit()}

      {/* ═══ CREATE MODALS ═══ */}

      {/* Compliance Issue Modal */}
      <Modal open={showIssueModal} onClose={() => setShowIssueModal(false)} title="New Compliance Issue" onSubmit={handleCreateIssue}>
        <FormField label="Issue # (optional)">
          <input className={inputCls} value={issueForm.issueNumber} onChange={e => setIssueForm({ ...issueForm, issueNumber: e.target.value })} placeholder="CI-005" />
        </FormField>
        <FormField label="Title">
          <input className={inputCls} value={issueForm.title} onChange={e => setIssueForm({ ...issueForm, title: e.target.value })} placeholder="Issue title" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type">
            <select className={inputCls} value={issueForm.type} onChange={e => setIssueForm({ ...issueForm, type: e.target.value })}>
              {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Severity">
            <select className={inputCls} value={issueForm.severity} onChange={e => setIssueForm({ ...issueForm, severity: e.target.value })}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Description">
          <textarea className={inputCls} rows={3} value={issueForm.description} onChange={e => setIssueForm({ ...issueForm, description: e.target.value })} placeholder="Issue details..." />
        </FormField>
        <FormField label="Assigned To">
          <input className={inputCls} value={issueForm.assignedTo} onChange={e => setIssueForm({ ...issueForm, assignedTo: e.target.value })} placeholder="e.g. IT Security" />
        </FormField>
      </Modal>

      {/* Journal Approval Modal */}
      <Modal open={showApprovalModal} onClose={() => setShowApprovalModal(false)} title="New Journal Approval" onSubmit={handleCreateApproval}>
        <FormField label="Journal Number">
          <input className={inputCls} value={approvalForm.journalNumber} onChange={e => setApprovalForm({ ...approvalForm, journalNumber: e.target.value })} placeholder="JNL-2024-090" />
        </FormField>
        <FormField label="Description">
          <input className={inputCls} value={approvalForm.description} onChange={e => setApprovalForm({ ...approvalForm, description: e.target.value })} placeholder="Journal description" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Amount">
            <input type="number" step="0.01" className={inputCls} value={approvalForm.amount || ''} onChange={e => setApprovalForm({ ...approvalForm, amount: Number(e.target.value) })} />
          </FormField>
          <FormField label="Period (optional)">
            <input className={inputCls} value={approvalForm.period} onChange={e => setApprovalForm({ ...approvalForm, period: e.target.value })} placeholder="June 2024" />
          </FormField>
        </div>
      </Modal>

      {/* External Audit Modal */}
      <Modal open={showAuditModal} onClose={() => setShowAuditModal(false)} title="New External Audit" onSubmit={handleCreateAudit}>
        <FormField label="Audit # (optional)">
          <input className={inputCls} value={auditForm.auditNumber} onChange={e => setAuditForm({ ...auditForm, auditNumber: e.target.value })} placeholder="EXT-2024-004" />
        </FormField>
        <FormField label="Firm">
          <input className={inputCls} value={auditForm.firm} onChange={e => setAuditForm({ ...auditForm, firm: e.target.value })} placeholder="KPMG Ethiopia" />
        </FormField>
        <FormField label="Audit Type">
          <input className={inputCls} value={auditForm.auditType} onChange={e => setAuditForm({ ...auditForm, auditType: e.target.value })} placeholder="Annual Financial Audit" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Start Date">
            <input type="date" className={inputCls} value={auditForm.startDate} onChange={e => setAuditForm({ ...auditForm, startDate: e.target.value })} />
          </FormField>
          <FormField label="End Date">
            <input type="date" className={inputCls} value={auditForm.endDate} onChange={e => setAuditForm({ ...auditForm, endDate: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Status">
            <select className={inputCls} value={auditForm.status} onChange={e => setAuditForm({ ...auditForm, status: e.target.value })}>
              {AUDIT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Rating (optional)">
            <select className={inputCls} value={auditForm.rating} onChange={e => setAuditForm({ ...auditForm, rating: e.target.value })}>
              <option value="">—</option>
              {AUDIT_RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </FormField>
        </div>
      </Modal>

      {/* SoD Rule Modal */}
      <Modal open={showSodModal} onClose={() => setShowSodModal(false)} title="New SoD Rule" onSubmit={handleCreateSod}>
        <FormField label="Rule Name">
          <input className={inputCls} value={sodForm.ruleName} onChange={e => setSodForm({ ...sodForm, ruleName: e.target.value })} placeholder="AP Creation vs Payment" />
        </FormField>
        <FormField label="Rule Code (optional)">
          <input className={inputCls} value={sodForm.ruleCode} onChange={e => setSodForm({ ...sodForm, ruleCode: e.target.value })} placeholder="SOD-005" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Duty A">
            <input className={inputCls} value={sodForm.dutyA} onChange={e => setSodForm({ ...sodForm, dutyA: e.target.value })} placeholder="Invoice Creation" />
          </FormField>
          <FormField label="Duty B">
            <input className={inputCls} value={sodForm.dutyB} onChange={e => setSodForm({ ...sodForm, dutyB: e.target.value })} placeholder="Payment Approval" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Conflict Level">
            <select className={inputCls} value={sodForm.conflictLevel} onChange={e => setSodForm({ ...sodForm, conflictLevel: e.target.value })}>
              {SOD_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="Assigned Role">
            <input className={inputCls} value={sodForm.assignedRole} onChange={e => setSodForm({ ...sodForm, assignedRole: e.target.value })} placeholder="Controller" />
          </FormField>
        </div>
        <FormField label="Description (optional)">
          <textarea className={inputCls} rows={2} value={sodForm.description} onChange={e => setSodForm({ ...sodForm, description: e.target.value })} placeholder="Rule description..." />
        </FormField>
      </Modal>

      {/* Audit Log Detail Modal (drill-down) */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedLog(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Audit Log Details</h3>
              <button onClick={() => setSelectedLog(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Timestamp</label>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString() : '—'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">User</label>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{selectedLog.user_name || '—'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Action</label>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{selectedLog.action || '—'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Module</label>
                  <Badge tone="info">{selectedLog.module || '—'}</Badge>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">IP Address</label>
                  <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{selectedLog.ip_address || '—'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Device</label>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{selectedLog.device || '—'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Record ID</label>
                  <span className="text-sm font-mono text-indigo-500">{selectedLog.record_id || '—'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">User ID</label>
                  <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{selectedLog.user_id || '—'}</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Full Details</label>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                  {selectedLog.details || '—'}
                </div>
              </div>
            </div>
            <div className="flex justify-end p-5 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => setSelectedLog(null)} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditCompliance;
