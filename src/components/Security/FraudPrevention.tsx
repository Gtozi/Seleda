/**
 * Fraud Prevention — /erp/security/fraud-prevention.
 *
 * DB-integrated via /api/sec-portal/fraud-cases + /api/sec-portal/fraud-alerts
 * routes (migration 617). `sec_fraud_cases` is the fraud case register —
 * type, amount, severity, source, assignee, optional link to
 * `sec_investigations`, resolution, and a Flagged → Under Review →
 * Investigating → Substantiated/Unfounded → Closed lifecycle (resolved
 * statuses stamp resolved_at server-side). `sec_fraud_alerts` is the
 * payment/transaction alert feed — alerts can be reviewed, dismissed, or
 * escalated, which creates a linked fraud case (POST /:id/escalate).
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, pill sub-tabs, SectionCard + DataTable,
 * Badge status pills, ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ShieldAlert, Plus, Search, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Tag, Clock, User, AlertOctagon,
  CreditCard, Landmark, ArrowUpRight, FileText, Bell,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecFraudCases, createSecFraudCase, updateSecFraudCase, deleteSecFraudCase,
  fetchSecFraudAlerts, createSecFraudAlert, updateSecFraudAlert,
  escalateSecFraudAlert, deleteSecFraudAlert,
  fetchSecStaff, fetchSecInvestigations,
  type SecFraudCase, type SecFraudAlert, type SecFraudType, type SecFraudStatus,
  type SecFraudSource, type SecFraudAlertType, type SecFraudAlertStatus,
  type SecPriority, type SecStaff, type SecInvestigation,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const CASE_TYPES: SecFraudType[] = [
  'Payment Fraud', 'Internal Theft', 'Expense Fraud', 'Identity Fraud',
  'Refund Fraud', 'Card Fraud', 'Vendor Fraud', 'Other',
];
const CASE_STATUSES: SecFraudStatus[] = [
  'Flagged', 'Under Review', 'Investigating', 'Substantiated', 'Unfounded', 'Closed',
];
const CASE_SOURCES: SecFraudSource[] = ['System Alert', 'Manual Report', 'Audit Finding', 'External'];
const ALERT_TYPES: SecFraudAlertType[] = [
  'Large Transaction', 'Unusual Refund', 'Velocity Anomaly', 'Card Mismatch',
  'Duplicate Charge', 'After-Hours Access', 'Discount Abuse', 'Other',
];
const ALERT_STATUSES: SecFraudAlertStatus[] = ['New', 'Reviewed', 'Escalated', 'Dismissed'];
const SEVERITIES: SecPriority[] = ['Critical', 'High', 'Medium', 'Low'];

const CASE_STATUS_TONE: Record<SecFraudStatus, StatusTone> = {
  Flagged: 'warning',
  'Under Review': 'info',
  Investigating: 'accent',
  Substantiated: 'danger',
  Unfounded: 'neutral',
  Closed: 'neutral',
};
const ALERT_STATUS_TONE: Record<SecFraudAlertStatus, StatusTone> = {
  New: 'warning',
  Reviewed: 'info',
  Escalated: 'accent',
  Dismissed: 'neutral',
};
const SEV_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

type TabId = 'cases' | 'alerts';
const SUB_TABS: { id: TabId; label: string; icon: typeof ShieldAlert }[] = [
  { id: 'cases', label: 'Fraud Cases', icon: ShieldAlert },
  { id: 'alerts', label: 'Payment Alerts', icon: Bell },
];

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

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number(v).toLocaleString([], { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function DataTable({ headers, rows, empty, emptyColSpan, emptyLabel = 'No records found.' }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
  emptyLabel?: string;
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">{emptyLabel}</td></tr>
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

const FraudPrevention: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [tab, setTab] = useState<TabId>('cases');
  const [cases, setCases] = useState<SecFraudCase[]>([]);
  const [alerts, setAlerts] = useState<SecFraudAlert[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [investigations, setInvestigations] = useState<SecInvestigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [caseStatusFilter, setCaseStatusFilter] = useState<'all' | SecFraudStatus>('all');
  const [caseTypeFilter, setCaseTypeFilter] = useState<'all' | SecFraudType>('all');
  const [alertStatusFilter, setAlertStatusFilter] = useState<'all' | SecFraudAlertStatus>('all');
  const [alertTypeFilter, setAlertTypeFilter] = useState<'all' | SecFraudAlertType>('all');

  // Modals
  const [showCaseForm, setShowCaseForm] = useState(false);
  const [editingCase, setEditingCase] = useState<SecFraudCase | null>(null);
  const [viewingCase, setViewingCase] = useState<SecFraudCase | null>(null);
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [viewingAlert, setViewingAlert] = useState<SecFraudAlert | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<SecFraudAlert | null>(null);
  const [escalateType, setEscalateType] = useState<SecFraudType>('Payment Fraud');
  const [escalateAssignee, setEscalateAssignee] = useState('');
  const [deleteCaseTarget, setDeleteCaseTarget] = useState<SecFraudCase | null>(null);
  const [deleteAlertTarget, setDeleteAlertTarget] = useState<SecFraudAlert | null>(null);

  const emptyCaseForm = {
    title: '', fraudType: 'Other' as SecFraudType, amount: '',
    severity: 'Medium' as SecPriority, source: 'Manual Report' as SecFraudSource,
    description: '', assignedTo: '', investigationId: '', resolution: '',
  };
  const emptyAlertForm = {
    alertType: 'Other' as SecFraudAlertType, title: '', description: '',
    amount: '', source: '', severity: 'Medium' as SecPriority,
  };
  const [caseForm, setCaseForm] = useState({ ...emptyCaseForm });
  const [alertForm, setAlertForm] = useState({ ...emptyAlertForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, a, s, inv] = await Promise.all([
        fetchSecFraudCases(currentPropertyId),
        fetchSecFraudAlerts(currentPropertyId),
        fetchSecStaff(currentPropertyId).catch(() => [] as SecStaff[]),
        fetchSecInvestigations(currentPropertyId).catch(() => [] as SecInvestigation[]),
      ]);
      setCases(c);
      setAlerts(a);
      setStaff(s);
      setInvestigations(inv);
    } catch (e: any) {
      setError(e?.message || 'Failed to load fraud prevention data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const refreshAll = async () => {
    await load();
    addNotification('Fraud prevention data refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    openCases: cases.filter(c => ['Flagged', 'Under Review', 'Investigating'].includes(c.status)).length,
    highCases: cases.filter(c =>
      (c.severity === 'Critical' || c.severity === 'High') &&
      !['Substantiated', 'Unfounded', 'Closed'].includes(c.status)).length,
    newAlerts: alerts.filter(a => a.status === 'New').length,
    exposure: cases
      .filter(c => !['Unfounded', 'Closed'].includes(c.status))
      .reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
  }), [cases, alerts]);

  const filteredCases = useMemo(() => {
    const q = search.toLowerCase();
    return cases.filter(c => {
      const matchesStatus = caseStatusFilter === 'all' || c.status === caseStatusFilter;
      const matchesType = caseTypeFilter === 'all' || c.fraud_type === caseTypeFilter;
      const matchesSearch = !q ||
        c.id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.assigned_to?.toLowerCase().includes(q) ?? false) ||
        (c.investigation_id?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [cases, caseStatusFilter, caseTypeFilter, search]);

  const filteredAlerts = useMemo(() => {
    const q = search.toLowerCase();
    return alerts.filter(a => {
      const matchesStatus = alertStatusFilter === 'all' || a.status === alertStatusFilter;
      const matchesType = alertTypeFilter === 'all' || a.alert_type === alertTypeFilter;
      const matchesSearch = !q ||
        a.id.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        (a.source?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [alerts, alertStatusFilter, alertTypeFilter, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNewCase = () => {
    setEditingCase(null);
    setCaseForm({ ...emptyCaseForm });
    setShowCaseForm(true);
  };

  const openEditCase = (c: SecFraudCase) => {
    setEditingCase(c);
    setCaseForm({
      title: c.title,
      fraudType: c.fraud_type,
      amount: c.amount != null ? String(c.amount) : '',
      severity: c.severity,
      source: c.source,
      description: c.description || '',
      assignedTo: c.assigned_to || '',
      investigationId: c.investigation_id || '',
      resolution: c.resolution || '',
    });
    setShowCaseForm(true);
  };

  const saveCase = async () => {
    if (!caseForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: caseForm.title.trim(),
        fraudType: caseForm.fraudType,
        amount: caseForm.amount === '' ? null : parseFloat(caseForm.amount),
        severity: caseForm.severity,
        source: caseForm.source,
        description: caseForm.description || null,
        assignedTo: caseForm.assignedTo || null,
        investigationId: caseForm.investigationId || null,
        resolution: caseForm.resolution || null,
      };
      if (editingCase) {
        const res = await updateSecFraudCase(editingCase.id, payload);
        setCases(prev => prev.map(c => (c.id === editingCase.id ? res.case : c)));
        if (viewingCase?.id === editingCase.id) setViewingCase(res.case);
        addNotification(`Fraud case ${editingCase.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecFraudCase({ propertyId: currentPropertyId, ...payload });
        setCases(prev => [created, ...prev]);
        addNotification(`Fraud case opened — ${created.id}`, 'task', 'Security');
      }
      setShowCaseForm(false);
      setEditingCase(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save case', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchCase = async (c: SecFraudCase, patch: Parameters<typeof updateSecFraudCase>[1], toast?: string) => {
    setActingOn(c.id);
    try {
      const res = await updateSecFraudCase(c.id, patch);
      setCases(prev => prev.map(x => (x.id === c.id ? res.case : x)));
      if (viewingCase?.id === c.id) setViewingCase(res.case);
      addNotification(toast || `Case ${c.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeCase = async () => {
    if (!deleteCaseTarget) return;
    setActingOn(deleteCaseTarget.id);
    try {
      await deleteSecFraudCase(deleteCaseTarget.id);
      setCases(prev => prev.filter(c => c.id !== deleteCaseTarget.id));
      setAlerts(prev => prev.map(a => (a.case_id === deleteCaseTarget.id ? { ...a, case_id: null, sec_fraud_cases: null } : a)));
      if (viewingCase?.id === deleteCaseTarget.id) setViewingCase(null);
      addNotification(`Fraud case ${deleteCaseTarget.id} removed`, 'task', 'Security');
      setDeleteCaseTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const saveAlert = async () => {
    if (!alertForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSecFraudAlert({
        propertyId: currentPropertyId,
        alertType: alertForm.alertType,
        title: alertForm.title.trim(),
        description: alertForm.description || null,
        amount: alertForm.amount === '' ? null : parseFloat(alertForm.amount),
        source: alertForm.source || null,
        severity: alertForm.severity,
      });
      setAlerts(prev => [created, ...prev]);
      addNotification(`Alert logged — ${created.id}`, 'task', 'Security');
      setShowAlertForm(false);
      setAlertForm({ ...emptyAlertForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save alert', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchAlert = async (a: SecFraudAlert, patch: Parameters<typeof updateSecFraudAlert>[1], toast?: string) => {
    setActingOn(a.id);
    try {
      const res = await updateSecFraudAlert(a.id, patch);
      setAlerts(prev => prev.map(x => (x.id === a.id ? res.alert : x)));
      if (viewingAlert?.id === a.id) setViewingAlert(res.alert);
      addNotification(toast || `Alert ${a.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const doEscalate = async () => {
    if (!escalateTarget) return;
    setSubmitting(true);
    try {
      const res = await escalateSecFraudAlert(escalateTarget.id, {
        assignedTo: escalateAssignee || null,
        fraudType: escalateType,
      });
      setCases(prev => [res.case, ...prev]);
      setAlerts(prev => prev.map(a => (a.id === escalateTarget.id
        ? { ...a, status: 'Escalated', case_id: res.case.id, sec_fraud_cases: { id: res.case.id, title: res.case.title } }
        : a)));
      addNotification(`Alert ${escalateTarget.id} escalated → case ${res.case.id}`, 'task', 'Security');
      setEscalateTarget(null);
      setViewingAlert(null);
    } catch (e: any) {
      addNotification(e?.message || 'Escalation failed', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const removeAlert = async () => {
    if (!deleteAlertTarget) return;
    setActingOn(deleteAlertTarget.id);
    try {
      await deleteSecFraudAlert(deleteAlertTarget.id);
      setAlerts(prev => prev.filter(a => a.id !== deleteAlertTarget.id));
      if (viewingAlert?.id === deleteAlertTarget.id) setViewingAlert(null);
      addNotification(`Alert ${deleteAlertTarget.id} removed`, 'task', 'Security');
      setDeleteAlertTarget(null);
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
        title="Fraud Prevention"
        subtitle="Internal fraud cases, payment alerts, and investigation support"
        icon={ShieldAlert}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {tab === 'cases' ? (
              <button onClick={openNewCase} className={button.primary}>
                <Plus className="w-4 h-4" /> New Case
              </button>
            ) : (
              <button onClick={() => setShowAlertForm(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Alert
              </button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Cases" value={stats.openCases} icon={AlertOctagon} tone="warning" />
        <StatCard title="High / Critical" value={stats.highCases} icon={ShieldAlert} tone="danger" />
        <StatCard title="New Alerts" value={stats.newAlerts} icon={Bell} tone="info" />
        <StatCard title="Active Exposure" value={fmtMoney(stats.exposure)} icon={Landmark} tone="accent" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl w-fit">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearch(''); }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                active
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon size={13} /> {t.label}
              {t.id === 'alerts' && stats.newAlerts > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 text-[10px]">{stats.newAlerts}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={tab === 'cases' ? 'Search title, ID, assignee…' : 'Search title, ID, source…'}
              className={inputClass + ' pl-9'}
            />
          </div>
          {tab === 'cases' ? (
            <>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={caseStatusFilter} onChange={e => setCaseStatusFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={caseTypeFilter} onChange={e => setCaseTypeFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={alertStatusFilter} onChange={e => setAlertStatusFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {ALERT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={alertTypeFilter} onChange={e => setAlertTypeFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {ALERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </SectionCard>

      {/* Fraud case register */}
      {tab === 'cases' && (
        <SectionCard title="Fraud Case Register" subtitle="Case · Type · Amount · Severity · Status · Assignee" icon={ShieldAlert} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Case', 'Type', 'Amount', 'Severity', 'Status', 'Assigned To', 'Reported', '']}
              emptyLabel="No fraud cases found."
              empty={filteredCases.length === 0}
              emptyColSpan={8}
              rows={filteredCases.map(c => [
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${['Critical', 'High'].includes(c.severity) ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                    <ShieldAlert className={`w-4 h-4 ${['Critical', 'High'].includes(c.severity) ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => setViewingCase(c)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{c.title}</button>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {c.id} · {c.source}{c.sec_investigations ? ` · ${c.sec_investigations.id}` : ''}
                    </div>
                  </div>
                </div>,
                <Badge tone="neutral">{c.fraud_type}</Badge>,
                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">{fmtMoney(c.amount)}</span>,
                <Badge tone={SEV_TONE[c.severity]}>{c.severity}</Badge>,
                <select
                  value={c.status}
                  onChange={e => patchCase(c, { status: e.target.value as SecFraudStatus }, `Case ${c.id} → ${e.target.value}`)}
                  disabled={actingOn === c.id}
                  className={inlineStatusSelect}
                >
                  {CASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                <span className="text-xs flex items-center gap-1"><User size={11} className="text-slate-400" />{c.assigned_to || '—'}</span>,
                <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} className="text-slate-400" />{fmtDateTime(c.reported_at)}</span>,
                <div className="inline-flex gap-2">
                  <button onClick={() => setViewingCase(c)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => openEditCase(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteCaseTarget(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ])}
            />
          )}
        </SectionCard>
      )}

      {/* Payment alert feed */}
      {tab === 'alerts' && (
        <SectionCard title="Payment & Fraud Alerts" subtitle="Alert · Type · Amount · Severity · Status · Linked Case" icon={Bell} tone="warning" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Alert', 'Type', 'Amount', 'Severity', 'Status', 'Linked Case', 'Raised', '']}
              emptyLabel="No fraud alerts found."
              empty={filteredAlerts.length === 0}
              emptyColSpan={8}
              rows={filteredAlerts.map(a => [
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${a.status === 'New' ? 'bg-amber-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                    <CreditCard className={`w-4 h-4 ${a.status === 'New' ? 'text-amber-500' : 'text-[var(--color-accent-operations)]'}`} />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => setViewingAlert(a)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{a.title}</button>
                    <div className="text-[10px] text-slate-400 font-mono">{a.id}{a.source ? ` · ${a.source}` : ''}</div>
                  </div>
                </div>,
                <Badge tone="info">{a.alert_type}</Badge>,
                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">{fmtMoney(a.amount)}</span>,
                <Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge>,
                <select
                  value={a.status}
                  onChange={e => patchAlert(a, { status: e.target.value as SecFraudAlertStatus }, `Alert ${a.id} → ${e.target.value}`)}
                  disabled={actingOn === a.id}
                  className={inlineStatusSelect}
                >
                  {ALERT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                a.sec_fraud_cases
                  ? <span className="text-xs font-mono text-[var(--color-accent-operations)]">{a.sec_fraud_cases.id}</span>
                  : <span className="text-xs text-slate-400">—</span>,
                <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} className="text-slate-400" />{fmtDateTime(a.created_at)}</span>,
                <div className="inline-flex gap-2">
                  {!a.case_id && a.status !== 'Dismissed' && (
                    <button
                      onClick={() => { setEscalateTarget(a); setEscalateType('Payment Fraud'); setEscalateAssignee(''); }}
                      className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"
                      title="Escalate to case"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => setViewingAlert(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteAlertTarget(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === a.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ])}
            />
          )}
        </SectionCard>
      )}

      {/* New / Edit case modal */}
      <ModalSystem
        isOpen={showCaseForm}
        onClose={() => { setShowCaseForm(false); setEditingCase(null); }}
        onConfirm={saveCase}
        title={editingCase ? `Edit ${editingCase.id}` : 'New Fraud Case'}
        subtitle={editingCase ? editingCase.title : 'Record a fraud case for review and investigation'}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={editingCase ? 'Save Changes' : 'Open Case'}
      >
        <div className="space-y-4">
          <Field label="Title">
            <input className={inputClass} value={caseForm.title} onChange={e => setCaseForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Refund abuse — Front Desk Terminal 3" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fraud Type">
              <select className={inputClass} value={caseForm.fraudType} onChange={e => setCaseForm(f => ({ ...f, fraudType: e.target.value as SecFraudType }))}>
                {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Amount (USD)">
              <input type="number" min={0} step="0.01" className={inputClass} value={caseForm.amount} onChange={e => setCaseForm(f => ({ ...f, amount: e.target.value }))} placeholder="e.g., 2400" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Severity">
              <select className={inputClass} value={caseForm.severity} onChange={e => setCaseForm(f => ({ ...f, severity: e.target.value as SecPriority }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select className={inputClass} value={caseForm.source} onChange={e => setCaseForm(f => ({ ...f, source: e.target.value as SecFraudSource }))}>
                {CASE_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Assigned To">
              <input
                className={inputClass}
                list="sec-fraud-assignees"
                value={caseForm.assignedTo}
                onChange={e => setCaseForm(f => ({ ...f, assignedTo: e.target.value }))}
                placeholder="Select or type case owner"
              />
              <datalist id="sec-fraud-assignees">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Linked Investigation">
              <select className={inputClass} value={caseForm.investigationId} onChange={e => setCaseForm(f => ({ ...f, investigationId: e.target.value }))}>
                <option value="">None</option>
                {investigations.map(i => <option key={i.id} value={i.id}>{i.id} — {i.title}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass + ' min-h-[72px]'} value={caseForm.description} onChange={e => setCaseForm(f => ({ ...f, description: e.target.value }))} placeholder="What was detected, evidence, affected transactions…" />
          </Field>
          <Field label="Resolution">
            <textarea className={inputClass + ' min-h-[48px]'} value={caseForm.resolution} onChange={e => setCaseForm(f => ({ ...f, resolution: e.target.value }))} placeholder="Outcome once resolved (recovery, dismissal, corrective action)…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Case detail modal */}
      <ModalSystem
        isOpen={!!viewingCase}
        onClose={() => setViewingCase(null)}
        title={viewingCase ? `Fraud Case ${viewingCase.id}` : 'Case Detail'}
        subtitle={viewingCase ? `${viewingCase.title} · ${viewingCase.fraud_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewingCase && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={CASE_STATUS_TONE[viewingCase.status]}>{viewingCase.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Severity</p>
                <Badge tone={SEV_TONE[viewingCase.severity]}>{viewingCase.severity}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Amount</p>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{fmtMoney(viewingCase.amount)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Source</p>
                <Badge tone="neutral">{viewingCase.source}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Assigned To</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{viewingCase.assigned_to || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Reported</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(viewingCase.reported_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Resolved</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(viewingCase.resolved_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Investigation</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
                  {viewingCase.sec_investigations ? `${viewingCase.sec_investigations.id} — ${viewingCase.sec_investigations.title}` : '—'}
                </p>
              </div>
              {viewingCase.description && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{viewingCase.description}</p>
                </div>
              )}
              {viewingCase.resolution && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Resolution</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{viewingCase.resolution}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {viewingCase.status === 'Flagged' && (
                <button onClick={() => patchCase(viewingCase, { status: 'Under Review' }, `Case ${viewingCase.id} → Under Review`)} disabled={actingOn === viewingCase.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Eye className="w-4 h-4" /> Begin Review
                </button>
              )}
              {viewingCase.status === 'Under Review' && (
                <button onClick={() => patchCase(viewingCase, { status: 'Investigating' }, `Case ${viewingCase.id} → Investigating`)} disabled={actingOn === viewingCase.id} className={button.secondary + ' disabled:opacity-50'}>
                  <FileText className="w-4 h-4" /> Open Investigation
                </button>
              )}
              {viewingCase.status === 'Investigating' && (
                <>
                  <button onClick={() => patchCase(viewingCase, { status: 'Substantiated' }, `Case ${viewingCase.id} substantiated`)} disabled={actingOn === viewingCase.id} className={button.secondary + ' !text-[var(--color-danger)] disabled:opacity-50'}>
                    <AlertOctagon className="w-4 h-4" /> Mark Substantiated
                  </button>
                  <button onClick={() => patchCase(viewingCase, { status: 'Unfounded' }, `Case ${viewingCase.id} unfounded`)} disabled={actingOn === viewingCase.id} className={button.secondary + ' disabled:opacity-50'}>
                    Mark Unfounded
                  </button>
                </>
              )}
              {(viewingCase.status === 'Substantiated' || viewingCase.status === 'Unfounded') && (
                <button onClick={() => patchCase(viewingCase, { status: 'Closed' }, `Case ${viewingCase.id} closed`)} disabled={actingOn === viewingCase.id} className={button.primary + ' disabled:opacity-50'}>
                  Close Case
                </button>
              )}
              {viewingCase.status === 'Closed' && (
                <button onClick={() => patchCase(viewingCase, { status: 'Under Review' }, `Case ${viewingCase.id} reopened`)} disabled={actingOn === viewingCase.id} className={button.secondary + ' disabled:opacity-50'}>
                  Reopen
                </button>
              )}
              <button onClick={() => { setViewingCase(null); openEditCase(viewingCase); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteCaseTarget(viewingCase)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* New alert modal */}
      <ModalSystem
        isOpen={showAlertForm}
        onClose={() => setShowAlertForm(false)}
        onConfirm={saveAlert}
        title="New Fraud Alert"
        subtitle="Manually log a payment or transaction alert"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel="Log Alert"
      >
        <div className="space-y-4">
          <Field label="Title">
            <input className={inputClass} value={alertForm.title} onChange={e => setAlertForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Large cash settlement — Suite 1201" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Alert Type">
              <select className={inputClass} value={alertForm.alertType} onChange={e => setAlertForm(f => ({ ...f, alertType: e.target.value as SecFraudAlertType }))}>
                {ALERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select className={inputClass} value={alertForm.severity} onChange={e => setAlertForm(f => ({ ...f, severity: e.target.value as SecPriority }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount (USD)">
              <input type="number" min={0} step="0.01" className={inputClass} value={alertForm.amount} onChange={e => setAlertForm(f => ({ ...f, amount: e.target.value }))} placeholder="e.g., 4800" />
            </Field>
            <Field label="Source System">
              <input className={inputClass} value={alertForm.source} onChange={e => setAlertForm(f => ({ ...f, source: e.target.value }))} placeholder="PMS / POS / Gateway…" />
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputClass + ' min-h-[72px]'} value={alertForm.description} onChange={e => setAlertForm(f => ({ ...f, description: e.target.value }))} placeholder="Trigger details, transaction reference…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Alert detail modal */}
      <ModalSystem
        isOpen={!!viewingAlert}
        onClose={() => setViewingAlert(null)}
        title={viewingAlert ? `Alert ${viewingAlert.id}` : 'Alert Detail'}
        subtitle={viewingAlert ? `${viewingAlert.title} · ${viewingAlert.alert_type}` : ''}
        variant="info"
        size="md"
        showFooter={false}
      >
        {viewingAlert && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={ALERT_STATUS_TONE[viewingAlert.status]}>{viewingAlert.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Severity</p>
                <Badge tone={SEV_TONE[viewingAlert.severity]}>{viewingAlert.severity}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Amount</p>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{fmtMoney(viewingAlert.amount)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Source</p>
                <p className="text-slate-600 dark:text-slate-300">{viewingAlert.source || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Raised</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(viewingAlert.created_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Linked Case</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
                  {viewingAlert.sec_fraud_cases ? `${viewingAlert.sec_fraud_cases.id} — ${viewingAlert.sec_fraud_cases.title}` : '—'}
                </p>
              </div>
              {viewingAlert.description && (
                <div className="col-span-2">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{viewingAlert.description}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {viewingAlert.status === 'New' && (
                <button onClick={() => patchAlert(viewingAlert, { status: 'Reviewed' }, `Alert ${viewingAlert.id} reviewed`)} disabled={actingOn === viewingAlert.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Eye className="w-4 h-4" /> Mark Reviewed
                </button>
              )}
              {!viewingAlert.case_id && viewingAlert.status !== 'Dismissed' && (
                <button onClick={() => { setEscalateTarget(viewingAlert); setEscalateType('Payment Fraud'); setEscalateAssignee(''); }} className={button.primary}>
                  <ArrowUpRight className="w-4 h-4" /> Escalate to Case
                </button>
              )}
              {viewingAlert.status !== 'Dismissed' && (
                <button onClick={() => patchAlert(viewingAlert, { status: 'Dismissed' }, `Alert ${viewingAlert.id} dismissed`)} disabled={actingOn === viewingAlert.id} className={button.secondary + ' disabled:opacity-50'}>
                  Dismiss
                </button>
              )}
              <button onClick={() => setDeleteAlertTarget(viewingAlert)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Escalate modal */}
      <ModalSystem
        isOpen={!!escalateTarget}
        onClose={() => setEscalateTarget(null)}
        onConfirm={doEscalate}
        title="Escalate Alert to Fraud Case"
        subtitle={escalateTarget ? `Creates a case from ${escalateTarget.id} — ${escalateTarget.title} and links the alert to it` : ''}
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel="Escalate"
      >
        <div className="space-y-4">
          <Field label="Fraud Type">
            <select className={inputClass} value={escalateType} onChange={e => setEscalateType(e.target.value as SecFraudType)}>
              {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Assign To">
            <input
              className={inputClass}
              list="sec-fraud-assignees"
              value={escalateAssignee}
              onChange={e => setEscalateAssignee(e.target.value)}
              placeholder="Select or type case owner"
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Delete confirms */}
      <ModalSystem
        isOpen={!!deleteCaseTarget}
        onClose={() => setDeleteCaseTarget(null)}
        onConfirm={removeCase}
        title="Delete Fraud Case"
        subtitle={deleteCaseTarget ? `Permanently delete case ${deleteCaseTarget.id} (${deleteCaseTarget.title})? Linked alerts will be kept but unlinked.` : ''}
        variant="confirm"
        loading={actingOn === deleteCaseTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
      <ModalSystem
        isOpen={!!deleteAlertTarget}
        onClose={() => setDeleteAlertTarget(null)}
        onConfirm={removeAlert}
        title="Delete Alert"
        subtitle={deleteAlertTarget ? `Permanently delete alert ${deleteAlertTarget.id} (${deleteAlertTarget.title})?` : ''}
        variant="confirm"
        loading={actingOn === deleteAlertTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      />
    </div>
  );
};

export default FraudPrevention;
