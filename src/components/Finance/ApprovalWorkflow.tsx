/**
 * Finance — Approval Workflow (backs /erp/finance/approval).
 *
 * DB-integrated via /api/fin-portal (see financePortal.routes.ts).
 * Four tabs:
 *   Pending Approvals  — pending requests with approve/reject actions
 *   Approval History   — all requests with status history
 *   Approval Levels    — multi-level approval configuration with CRUD
 *   Delegation Rules   — temporary delegation rules with CRUD
 *
 * Uses the shared FrontOffice UI primitives (PageHeader, StatCard, Badge,
 * SectionCard) and the useERP context for currency formatting + notifications,
 * matching the F&B / HK inventory module look & feel.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ShieldCheck,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Loader2,
  Search,
  Plus,
  X,
  MoreVertical,
  Trash2,
  Check,
  Layers,
  ArrowRightLeft,
  AlertTriangle,
  Users,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchApprovalRequests,
  createApprovalRequest,
  updateApprovalRequest,
  deleteApprovalRequest,
  fetchApprovalLevels,
  createApprovalLevel,
  updateApprovalLevel,
  deleteApprovalLevel,
  fetchDelegationRules,
  createDelegationRule,
  updateDelegationRule,
  deleteDelegationRule,
  type ApprovalRequestFE,
  type ApprovalLevelFE,
  type DelegationRuleFE,
} from '../../services/financePortalService';

type TabKey = 'pending' | 'history' | 'levels' | 'rules';

const TABS: { id: TabKey; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'pending', label: 'Pending Approvals', icon: Clock },
  { id: 'history', label: 'Approval History', icon: FileText },
  { id: 'levels', label: 'Approval Levels', icon: Layers },
  { id: 'rules', label: 'Delegation Rules', icon: ArrowRightLeft },
];

const REQUEST_TYPES = ['journal', 'vendor_invoice', 'payment', 'budget', 'expense', 'asset'];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const LEVEL_STATUSES = ['active', 'inactive'];
const DELEGATION_SCOPES = ['all', 'journal', 'vendor_invoice', 'payment', 'budget', 'expense', 'asset'];
const DELEGATION_STATUSES = ['active', 'expired', 'revoked'];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  active: 'success',
  inactive: 'neutral',
  expired: 'neutral',
  revoked: 'danger',
};

const TYPE_LABELS: Record<string, string> = {
  journal: 'Journal',
  vendor_invoice: 'Vendor Invoice',
  payment: 'Payment',
  budget: 'Budget',
  expense: 'Expense',
  asset: 'Asset',
};

const TYPE_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  journal: 'info',
  vendor_invoice: 'warning',
  payment: 'success',
  budget: 'info',
  expense: 'warning',
  asset: 'neutral',
};

const ApprovalWorkflow = () => {
  const { formatAmount, addNotification, currentPropertyId } = useERP();

  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Data
  const [requests, setRequests] = useState<ApprovalRequestFE[]>([]);
  const [levels, setLevels] = useState<ApprovalLevelFE[]>([]);
  const [delegations, setDelegations] = useState<DelegationRuleFE[]>([]);

  // Modals
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [showDelegationModal, setShowDelegationModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState<ApprovalRequestFE | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [requestForm, setRequestForm] = useState({
    requestNumber: '', type: 'journal', title: '', description: '', amount: 0, totalLevels: 1,
  });
  const [levelForm, setLevelForm] = useState({
    name: '', level: 1, requiresUnanimous: false, approvers: '', spendingLimit: 0, description: '',
  });
  const [delegationForm, setDelegationForm] = useState({
    ruleName: '', delegator: '', delegatee: '', scope: 'all', spendingLimit: 0, startDate: '', endDate: '', notes: '',
  });
  const [rejectionReason, setRejectionReason] = useState('');

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [reqs, lvls, dels] = await Promise.all([
        fetchApprovalRequests({ propertyId: pid }).catch(() => [] as ApprovalRequestFE[]),
        fetchApprovalLevels({ propertyId: pid }).catch(() => [] as ApprovalLevelFE[]),
        fetchDelegationRules({ propertyId: pid }).catch(() => [] as DelegationRuleFE[]),
      ]);
      setRequests(reqs);
      setLevels(lvls);
      setDelegations(dels);
    } catch (e: any) {
      setError(e?.message || 'Failed to load approval workflow data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const pendingRequests = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);

  const filteredPending = useMemo(() =>
    pendingRequests.filter(r => {
      const matchesSearch =
        r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.request_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.requested_by_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'all' || r.type === typeFilter;
      return matchesSearch && matchesType;
    }), [pendingRequests, searchTerm, typeFilter]);

  const filteredHistory = useMemo(() =>
    requests.filter(r => {
      const matchesSearch =
        r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.request_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.requested_by_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'all' || r.type === typeFilter;
      return matchesSearch && matchesType;
    }), [requests, searchTerm, typeFilter]);

  const filteredLevels = useMemo(() =>
    levels.filter(l =>
      l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.approvers.join(',').toLowerCase().includes(searchTerm.toLowerCase())
    ), [levels, searchTerm]);

  const filteredDelegations = useMemo(() =>
    delegations.filter(d =>
      d.rule_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.delegator.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.delegatee.toLowerCase().includes(searchTerm.toLowerCase())
    ), [delegations, searchTerm]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const pending = pendingRequests.length;
    const pendingAmount = pendingRequests.reduce((s, r) => s + Number(r.amount), 0);
    const urgent = pendingRequests.filter(r => r.current_level >= r.total_levels - 1).length;
    const approved = requests.filter(r => r.status === 'approved').length;
    const rejected = requests.filter(r => r.status === 'rejected').length;
    const totalAmount = requests.reduce((s, r) => s + Number(r.amount), 0);
    return {
      pending, pendingAmount, urgent, approved, rejected, totalAmount,
      levelsCount: levels.length,
      activeLevels: levels.filter(l => l.status === 'active').length,
      delegationsCount: delegations.length,
      activeDelegations: delegations.filter(d => d.status === 'active').length,
    };
  }, [requests, pendingRequests, levels, delegations]);

  // ── Action handlers ───────────────────────────────────────────────────
  const handleApprove = async (req: ApprovalRequestFE) => {
    setActionMenuId(null);
    try {
      const nextLevel = req.current_level + 1;
      const isFinal = nextLevel >= req.total_levels;
      await updateApprovalRequest(req.id, {
        currentLevel: isFinal ? req.total_levels : nextLevel,
        status: isFinal ? 'approved' : 'pending',
      });
      await loadAll();
      addNotification(isFinal ? 'Request approved (final level).' : `Advanced to level ${nextLevel + 1}.`, 'success', 'Approvals');
    } catch (e: any) { addNotification(e?.message || 'Failed to approve', 'error', 'Approvals'); }
  };

  const handleReject = async () => {
    if (!showRejectModal) return;
    setSubmitting(true);
    try {
      await updateApprovalRequest(showRejectModal.id, { status: 'rejected', rejectionReason });
      await loadAll();
      setShowRejectModal(null);
      setRejectionReason('');
      addNotification('Request rejected.', 'warning', 'Approvals');
    } catch (e: any) { addNotification(e?.message || 'Failed to reject', 'error', 'Approvals'); }
    finally { setSubmitting(false); }
  };

  const handleCancel = async (id: string) => {
    setActionMenuId(null);
    try {
      await updateApprovalRequest(id, { status: 'cancelled' });
      await loadAll();
      addNotification('Request cancelled.', 'warning', 'Approvals');
    } catch (e: any) { addNotification(e?.message || 'Failed to cancel', 'error', 'Approvals'); }
  };

  const handleDeleteRequest = async (id: string) => {
    setActionMenuId(null);
    try { await deleteApprovalRequest(id); await loadAll(); addNotification('Request deleted.', 'warning', 'Approvals'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Approvals'); }
  };

  const handleLevelStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try { await updateApprovalLevel(id, { status }); await loadAll(); addNotification(`Level ${status}.`, 'success', 'Approvals'); }
    catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Approvals'); }
  };

  const handleDeleteLevel = async (id: string) => {
    setActionMenuId(null);
    try { await deleteApprovalLevel(id); await loadAll(); addNotification('Level deleted.', 'warning', 'Approvals'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Approvals'); }
  };

  const handleDelegationStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try { await updateDelegationRule(id, { status }); await loadAll(); addNotification(`Delegation ${status}.`, 'success', 'Approvals'); }
    catch (e: any) { addNotification(e?.message || 'Failed to update', 'error', 'Approvals'); }
  };

  const handleDeleteDelegation = async (id: string) => {
    setActionMenuId(null);
    try { await deleteDelegationRule(id); await loadAll(); addNotification('Delegation deleted.', 'warning', 'Approvals'); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Approvals'); }
  };

  // ── Create handlers ───────────────────────────────────────────────────
  const handleCreateRequest = async () => {
    setSubmitting(true);
    try {
      if (!requestForm.title) { addNotification('Title is required.', 'warning', 'Approvals'); setSubmitting(false); return; }
      await createApprovalRequest({ ...requestForm, propertyId: currentPropertyId || undefined });
      await loadAll(); setShowRequestModal(false);
      setRequestForm({ requestNumber: '', type: 'journal', title: '', description: '', amount: 0, totalLevels: 1 });
      addNotification('Approval request created.', 'success', 'Approvals');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Approvals'); }
    finally { setSubmitting(false); }
  };

  const handleCreateLevel = async () => {
    setSubmitting(true);
    try {
      if (!levelForm.name) { addNotification('Level name is required.', 'warning', 'Approvals'); setSubmitting(false); return; }
      const approvers = levelForm.approvers.split(',').map(s => s.trim()).filter(Boolean);
      await createApprovalLevel({
        name: levelForm.name,
        level: levelForm.level,
        requiresUnanimous: levelForm.requiresUnanimous,
        approvers,
        spendingLimit: levelForm.spendingLimit || undefined,
        description: levelForm.description || undefined,
        propertyId: currentPropertyId || undefined,
      });
      await loadAll(); setShowLevelModal(false);
      setLevelForm({ name: '', level: 1, requiresUnanimous: false, approvers: '', spendingLimit: 0, description: '' });
      addNotification('Approval level created.', 'success', 'Approvals');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Approvals'); }
    finally { setSubmitting(false); }
  };

  const handleCreateDelegation = async () => {
    setSubmitting(true);
    try {
      if (!delegationForm.ruleName || !delegationForm.delegator || !delegationForm.delegatee) {
        addNotification('Rule name, delegator, and delegatee are required.', 'warning', 'Approvals'); setSubmitting(false); return;
      }
      await createDelegationRule({
        ...delegationForm,
        spendingLimit: delegationForm.spendingLimit || undefined,
        startDate: delegationForm.startDate || undefined,
        endDate: delegationForm.endDate || undefined,
        propertyId: currentPropertyId || undefined,
      });
      await loadAll(); setShowDelegationModal(false);
      setDelegationForm({ ruleName: '', delegator: '', delegatee: '', scope: 'all', spendingLimit: 0, startDate: '', endDate: '', notes: '' });
      addNotification('Delegation rule created.', 'success', 'Approvals');
    } catch (e: any) { addNotification(e?.message || 'Failed to create', 'error', 'Approvals'); }
    finally { setSubmitting(false); }
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────
  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdB = 'px-4 py-3.5 text-sm text-right font-bold text-slate-900 dark:text-white';
  const tdC = 'px-4 py-3.5 text-sm text-center text-slate-700 dark:text-slate-300';
  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';

  const Modal = ({ open, onClose, title, children, onSubmit, submitLabel }: {
    open: boolean; onClose: () => void; title: string; children: ReactNode;
    onSubmit?: () => void; submitLabel?: string;
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
          {onSubmit && (
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200 dark:border-slate-700">
              <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
              <button onClick={onSubmit} disabled={submitting}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
                {submitting && <Loader2 size={14} className="animate-spin" />} {submitLabel || 'Submit'}
              </button>
            </div>
          )}
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

  const Progress = ({ current, total }: { current: number; total: number }) => {
    const pct = total > 0 ? (current / total) * 100 : 0;
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-2 w-24 max-w-[120px]">
          <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{current}/{total}</span>
      </div>
    );
  };

  // ── Stat cards (rendered above tab bar) ───────────────────────────────
  const renderStats = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {activeTab === 'pending' && (
        <>
          <StatCard title="Pending Requests" value={stats.pending} icon={Clock} tone="warning" />
          <StatCard title="Total Amount" value={formatAmount(stats.pendingAmount)} icon={FileText} tone="info" />
          <StatCard title="Urgent (Final Level)" value={stats.urgent} icon={AlertTriangle} tone="danger" />
          <StatCard title="Active Levels" value={stats.activeLevels} icon={Layers} tone="success" />
        </>
      )}
      {activeTab === 'history' && (
        <>
          <StatCard title="Total Requests" value={requests.length} icon={FileText} tone="info" />
          <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} tone="success" />
          <StatCard title="Rejected" value={stats.rejected} icon={XCircle} tone="danger" />
          <StatCard title="Total Value" value={formatAmount(stats.totalAmount)} icon={ShieldCheck} tone="neutral" />
        </>
      )}
      {activeTab === 'levels' && (
        <>
          <StatCard title="Total Levels" value={stats.levelsCount} icon={Layers} tone="info" />
          <StatCard title="Active" value={stats.activeLevels} icon={CheckCircle2} tone="success" />
          <StatCard title="Inactive" value={stats.levelsCount - stats.activeLevels} icon={XCircle} tone="neutral" />
          <StatCard title="Total Approvers" value={levels.reduce((s, l) => s + l.approvers.length, 0)} icon={Users} tone="warning" />
        </>
      )}
      {activeTab === 'rules' && (
        <>
          <StatCard title="Total Rules" value={stats.delegationsCount} icon={ArrowRightLeft} tone="info" />
          <StatCard title="Active" value={stats.activeDelegations} icon={CheckCircle2} tone="success" />
          <StatCard title="Expired/Revoked" value={stats.delegationsCount - stats.activeDelegations} icon={XCircle} tone="neutral" />
          <StatCard title="All Scopes" value={delegations.filter(d => d.scope === 'all').length} icon={ShieldCheck} tone="warning" />
        </>
      )}
    </div>
  );

  // ── Pending tab ───────────────────────────────────────────────────────
  const renderPending = () => (
    <SectionCard title="Pending Approvals" subtitle={`${filteredPending.length} request${filteredPending.length !== 1 ? 's' : ''}`} icon={Clock}
      actions={
        <button onClick={() => setShowRequestModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
          <Plus size={14} /> New Request
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
              <th className={th}>Request #</th>
              <th className={th}>Type</th>
              <th className={th}>Title</th>
              <th className={th}>Requested By</th>
              <th className={th + ' text-right'}>Amount</th>
              <th className={th}>Progress</th>
              <th className={th}>Created</th>
              <th className={th + ' text-right'}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredPending.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                <td className={td}><span className="font-mono text-xs text-indigo-500">{r.request_number || '—'}</span></td>
                <td className={td}><Badge tone={TYPE_COLORS[r.type] || 'neutral'}>{TYPE_LABELS[r.type] || r.type}</Badge></td>
                <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.title}</span></td>
                <td className={td}><span className="text-xs">{r.requested_by_name || '—'}</span></td>
                <td className={tdB}>{formatAmount(Number(r.amount))}</td>
                <td className={td}><Progress current={r.current_level} total={r.total_levels} /></td>
                <td className={td}><span className="text-xs text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span></td>
                <td className={tdR}>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => handleApprove(r)} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-emerald-700 transition-colors flex items-center gap-1">
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => { setActionMenuId(null); setShowRejectModal(r); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-red-700 transition-colors flex items-center gap-1">
                      <X size={12} /> Reject
                    </button>
                    <ActionMenu id={r.id} status={r.status} statusOptions={['cancelled']} onStatus={handleCancel} onDelete={handleDeleteRequest} />
                  </div>
                </td>
              </tr>
            ))}
            {filteredPending.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No pending approvals</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  // ── History tab ───────────────────────────────────────────────────────
  const renderHistory = () => (
    <SectionCard title="Approval History" subtitle={`${filteredHistory.length} request${filteredHistory.length !== 1 ? 's' : ''}`} icon={FileText}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
              <th className={th}>Request #</th>
              <th className={th}>Type</th>
              <th className={th}>Title</th>
              <th className={th}>Requested By</th>
              <th className={th + ' text-right'}>Amount</th>
              <th className={th}>Progress</th>
              <th className={th}>Status</th>
              <th className={th}>Decided By</th>
              <th className={th}>Created</th>
              <th className={th + ' text-right'}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredHistory.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                <td className={td}><span className="font-mono text-xs text-indigo-500">{r.request_number || '—'}</span></td>
                <td className={td}><Badge tone={TYPE_COLORS[r.type] || 'neutral'}>{TYPE_LABELS[r.type] || r.type}</Badge></td>
                <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.title}</span></td>
                <td className={td}><span className="text-xs">{r.requested_by_name || '—'}</span></td>
                <td className={tdB}>{formatAmount(Number(r.amount))}</td>
                <td className={td}><Progress current={r.current_level} total={r.total_levels} /></td>
                <td className={tdC}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                <td className={td}><span className="text-xs">{r.approved_by || r.rejected_by || '—'}</span></td>
                <td className={td}><span className="text-xs text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span></td>
                <td className={tdR}>
                  <ActionMenu id={r.id} status={r.status} statusOptions={REQUEST_STATUSES} onStatus={(id, s) => updateApprovalRequest(id, { status: s }).then(loadAll)} onDelete={handleDeleteRequest} />
                </td>
              </tr>
            ))}
            {filteredHistory.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">No approval history</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  // ── Levels tab ────────────────────────────────────────────────────────
  const renderLevels = () => (
    <SectionCard title="Approval Levels" subtitle={`${filteredLevels.length} level${filteredLevels.length !== 1 ? 's' : ''}`} icon={Layers}
      actions={
        <button onClick={() => setShowLevelModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
          <Plus size={14} /> Add Level
        </button>
      }
    >
      <div className="space-y-3">
        {filteredLevels.map(l => (
          <div key={l.id} className="bg-slate-50 dark:bg-slate-850/50 rounded-xl p-4 border border-slate-150 dark:border-slate-800">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-black text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 px-2 py-1 rounded-lg">LEVEL {l.level}</span>
                  <span className="font-bold text-slate-900 dark:text-white">{l.name}</span>
                  <Badge tone={STATUS_COLORS[l.status] || 'neutral'}>{l.status}</Badge>
                  {l.requires_unanimous && <Badge tone="warning">Unanimous</Badge>}
                </div>
                <div className="text-xs text-slate-500 mb-2">
                  <Users size={12} className="inline mr-1" />
                  {l.approvers.length} approver{l.approvers.length !== 1 ? 's' : ''}: {l.approvers.join(', ') || '—'}
                </div>
                {l.spending_limit != null && (
                  <div className="text-xs text-slate-500">Spending limit: <span className="font-bold text-slate-700 dark:text-slate-300">{formatAmount(Number(l.spending_limit))}</span></div>
                )}
                {l.description && <div className="text-xs text-slate-400 mt-1">{l.description}</div>}
              </div>
              <ActionMenu id={l.id} status={l.status} statusOptions={LEVEL_STATUSES} onStatus={handleLevelStatus} onDelete={handleDeleteLevel} />
            </div>
          </div>
        ))}
        {filteredLevels.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-slate-400">No approval levels configured</div>
        )}
      </div>
    </SectionCard>
  );

  // ── Delegation Rules tab ──────────────────────────────────────────────
  const renderRules = () => (
    <SectionCard title="Delegation Rules" subtitle={`${filteredDelegations.length} rule${filteredDelegations.length !== 1 ? 's' : ''}`} icon={ArrowRightLeft}
      actions={
        <button onClick={() => setShowDelegationModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
          <Plus size={14} /> New Rule
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
              <th className={th}>Rule Name</th>
              <th className={th}>Delegator</th>
              <th className={th}>Delegatee</th>
              <th className={th}>Scope</th>
              <th className={th + ' text-right'}>Limit</th>
              <th className={th}>Start Date</th>
              <th className={th}>End Date</th>
              <th className={th}>Status</th>
              <th className={th + ' text-right'}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredDelegations.map(d => (
              <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                <td className={td}><span className="font-medium text-slate-900 dark:text-white">{d.rule_name}</span></td>
                <td className={td}><span className="text-xs">{d.delegator}</span></td>
                <td className={td}><span className="text-xs">{d.delegatee}</span></td>
                <td className={td}><Badge tone="info">{d.scope === 'all' ? 'All' : TYPE_LABELS[d.scope] || d.scope}</Badge></td>
                <td className={tdB}>{d.spending_limit != null ? formatAmount(Number(d.spending_limit)) : '—'}</td>
                <td className={td}><span className="text-xs text-slate-500">{d.start_date ? new Date(d.start_date).toLocaleDateString() : '—'}</span></td>
                <td className={td}><span className="text-xs text-slate-500">{d.end_date ? new Date(d.end_date).toLocaleDateString() : '—'}</span></td>
                <td className={tdC}><Badge tone={STATUS_COLORS[d.status] || 'neutral'}>{d.status}</Badge></td>
                <td className={tdR}>
                  <ActionMenu id={d.id} status={d.status} statusOptions={DELEGATION_STATUSES} onStatus={handleDelegationStatus} onDelete={handleDeleteDelegation} />
                </td>
              </tr>
            ))}
            {filteredDelegations.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">No delegation rules configured</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Approval Workflow"
        subtitle="Multi-level authorization for journals, invoices, payments, and expenses"
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
            onClick={() => { setActiveTab(tab.id); setSearchTerm(''); setTypeFilter('all'); setActionMenuId(null); }}
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
        {(activeTab === 'pending' || activeTab === 'history') && (
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' min-w-[140px]'}>
            <option value="all">All Types</option>
            {REQUEST_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
          </select>
        )}
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
      {!loading && activeTab === 'pending' && renderPending()}
      {!loading && activeTab === 'history' && renderHistory()}
      {!loading && activeTab === 'levels' && renderLevels()}
      {!loading && activeTab === 'rules' && renderRules()}

      {/* ═══ CREATE MODALS ═══ */}

      {/* Approval Request Modal */}
      <Modal open={showRequestModal} onClose={() => setShowRequestModal(false)} title="New Approval Request" onSubmit={handleCreateRequest}>
        <FormField label="Request # (optional)">
          <input className={inputCls} value={requestForm.requestNumber} onChange={e => setRequestForm({ ...requestForm, requestNumber: e.target.value })} placeholder="AR-2024-011" />
        </FormField>
        <FormField label="Title">
          <input className={inputCls} value={requestForm.title} onChange={e => setRequestForm({ ...requestForm, title: e.target.value })} placeholder="Request title" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type">
            <select className={inputCls} value={requestForm.type} onChange={e => setRequestForm({ ...requestForm, type: e.target.value })}>
              {REQUEST_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
            </select>
          </FormField>
          <FormField label="Total Levels">
            <input type="number" min={1} max={5} className={inputCls} value={requestForm.totalLevels} onChange={e => setRequestForm({ ...requestForm, totalLevels: Number(e.target.value) })} />
          </FormField>
        </div>
        <FormField label="Amount">
          <input type="number" step="0.01" className={inputCls} value={requestForm.amount || ''} onChange={e => setRequestForm({ ...requestForm, amount: Number(e.target.value) })} />
        </FormField>
        <FormField label="Description (optional)">
          <textarea className={inputCls} rows={2} value={requestForm.description} onChange={e => setRequestForm({ ...requestForm, description: e.target.value })} placeholder="Request details..." />
        </FormField>
      </Modal>

      {/* Approval Level Modal */}
      <Modal open={showLevelModal} onClose={() => setShowLevelModal(false)} title="New Approval Level" onSubmit={handleCreateLevel}>
        <FormField label="Level Name">
          <input className={inputCls} value={levelForm.name} onChange={e => setLevelForm({ ...levelForm, name: e.target.value })} placeholder="e.g. Department Manager" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Level Number">
            <input type="number" min={1} className={inputCls} value={levelForm.level} onChange={e => setLevelForm({ ...levelForm, level: Number(e.target.value) })} />
          </FormField>
          <FormField label="Spending Limit (optional)">
            <input type="number" step="0.01" className={inputCls} value={levelForm.spendingLimit || ''} onChange={e => setLevelForm({ ...levelForm, spendingLimit: Number(e.target.value) })} />
          </FormField>
        </div>
        <FormField label="Approvers (comma-separated emails)">
          <input className={inputCls} value={levelForm.approvers} onChange={e => setLevelForm({ ...levelForm, approvers: e.target.value })} placeholder="manager@erp.com, asst.manager@erp.com" />
        </FormField>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="req-unanimous" checked={levelForm.requiresUnanimous} onChange={e => setLevelForm({ ...levelForm, requiresUnanimous: e.target.checked })} className="rounded border-slate-300" />
          <label htmlFor="req-unanimous" className="text-xs font-medium text-slate-700 dark:text-slate-300">Requires unanimous approval</label>
        </div>
        <FormField label="Description (optional)">
          <textarea className={inputCls} rows={2} value={levelForm.description} onChange={e => setLevelForm({ ...levelForm, description: e.target.value })} placeholder="Level description..." />
        </FormField>
      </Modal>

      {/* Delegation Rule Modal */}
      <Modal open={showDelegationModal} onClose={() => setShowDelegationModal(false)} title="New Delegation Rule" onSubmit={handleCreateDelegation}>
        <FormField label="Rule Name">
          <input className={inputCls} value={delegationForm.ruleName} onChange={e => setDelegationForm({ ...delegationForm, ruleName: e.target.value })} placeholder="e.g. Vacation Delegation" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Delegator">
            <input className={inputCls} value={delegationForm.delegator} onChange={e => setDelegationForm({ ...delegationForm, delegator: e.target.value })} placeholder="manager@erp.com" />
          </FormField>
          <FormField label="Delegatee">
            <input className={inputCls} value={delegationForm.delegatee} onChange={e => setDelegationForm({ ...delegationForm, delegatee: e.target.value })} placeholder="asst.manager@erp.com" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Scope">
            <select className={inputCls} value={delegationForm.scope} onChange={e => setDelegationForm({ ...delegationForm, scope: e.target.value })}>
              {DELEGATION_SCOPES.map(s => <option key={s} value={s}>{s === 'all' ? 'All' : TYPE_LABELS[s] || s}</option>)}
            </select>
          </FormField>
          <FormField label="Spending Limit (optional)">
            <input type="number" step="0.01" className={inputCls} value={delegationForm.spendingLimit || ''} onChange={e => setDelegationForm({ ...delegationForm, spendingLimit: Number(e.target.value) })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Start Date">
            <input type="date" className={inputCls} value={delegationForm.startDate} onChange={e => setDelegationForm({ ...delegationForm, startDate: e.target.value })} />
          </FormField>
          <FormField label="End Date (optional)">
            <input type="date" className={inputCls} value={delegationForm.endDate} onChange={e => setDelegationForm({ ...delegationForm, endDate: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Notes (optional)">
          <textarea className={inputCls} rows={2} value={delegationForm.notes} onChange={e => setDelegationForm({ ...delegationForm, notes: e.target.value })} placeholder="Delegation notes..." />
        </FormField>
      </Modal>

      {/* Reject Modal */}
      <Modal open={!!showRejectModal} onClose={() => { setShowRejectModal(null); setRejectionReason(''); }} title="Reject Request" onSubmit={handleReject} submitLabel="Reject">
        {showRejectModal && (
          <>
            <div className="text-sm text-slate-700 dark:text-slate-300">
              Rejecting <span className="font-bold">{showRejectModal.title}</span>
              {showRejectModal.request_number && <span className="font-mono text-xs text-indigo-500 ml-2">({showRejectModal.request_number})</span>}
            </div>
            <FormField label="Rejection Reason (optional)">
              <textarea className={inputCls} rows={3} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="Reason for rejection..." />
            </FormField>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ApprovalWorkflow;
