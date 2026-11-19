/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Approval Center — Supply Chain & Procurement Portal (/erp/procurement/approvals).
 * Aligns with unified_supply_chain_procurement_portal.md sections 42, 43, 44.
 *
 * Features:
 * - Centralized approval queue aggregating pending items from:
 *   Purchase Requisitions, Purchase Orders, RFQ Awards, Contracts, Supplier Activations
 *   (spec section 42: also Supplier Suspension, Price Override, Emergency Purchase, Budget Exception)
 * - Approval conditions (spec section 43): amount, department, property, category,
 *   cost center, supplier, budget, purchase type, emergency status
 * - Approval delegation (spec section 44): temporary delegation, manager substitution,
 *   leave delegation, escalation, approval timeout, automatic reassignment
 * - Approve / Reject actions with comments
 * - Approval hierarchy visualization
 * - Filter by approval type
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, Loader2,
  FileText, ShoppingCart, Award, FileSignature, UserCheck, Search,
  ShieldCheck, ArrowRight, User,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchApprovals, approveApprovalItem, rejectApprovalItem,
  fetchApprovalDelegations, createApprovalDelegation,
  type ApprovalItem, type ApprovalDelegation, type ApprovalType,
} from '../../services/procurementService';

// Spec section 42: Approval types
const APPROVAL_TYPES = [
  'Purchase Requisition', 'Purchase Order', 'RFQ Award', 'Contract',
  'Supplier Activation', 'Supplier Suspension', 'Price Override',
  'Emergency Purchase', 'Budget Exception',
] as const;

const TYPE_ICONS: Record<string, any> = {
  'Purchase Requisition': FileText,
  'Purchase Order': ShoppingCart,
  'RFQ Award': Award,
  'Contract': FileSignature,
  'Supplier Activation': UserCheck,
};

// Spec section 43: Approval conditions
const APPROVAL_CONDITIONS = [
  'Amount', 'Department', 'Property', 'Category', 'Cost Center',
  'Supplier', 'Budget', 'Purchase Type', 'Emergency Status',
];

// Spec section 44: Approval delegation features
const DELEGATION_FEATURES = [
  'Temporary delegation', 'Manager substitution', 'Leave delegation',
  'Escalation', 'Approval timeout', 'Automatic reassignment',
];

// Approval hierarchy (spec section 43)
const HIERARCHY = [
  { level: 'Dept Manager', role: 'Purchase Requisition', limit: '< $5,000' },
  { level: 'Finance Manager', role: 'Budget Validation', limit: '$5k - $25k' },
  { level: 'General Manager', role: 'Strategic Approval', limit: '> $25,000' },
  { level: 'Asset Board', role: 'Capital Expenditure', limit: 'CAPEX' },
];

const fmtMoney = (n: number, currency = 'ETB') => `${currency} ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const ApprovalCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [search, setSearch] = useState('');

  // Action modal
  const [actionModal, setActionModal] = useState<{ item: ApprovalItem; action: 'approve' | 'reject' } | null>(null);
  const [actionComment, setActionComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Delegation modal
  const [showDelegationForm, setShowDelegationForm] = useState(false);
  const [delegationForm, setDelegationForm] = useState({
    delegatorId: '', delegatorName: '', delegateId: '', delegateName: '',
    approvalType: 'Purchase Requisition' as ApprovalType, startDate: '', endDate: '', reason: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [apprData, delData] = await Promise.all([
        fetchApprovals({ propertyId: currentPropertyId || undefined }),
        fetchApprovalDelegations({ status: 'Active' }),
      ]);
      setApprovals(apprData.approvals);
      setDelegations(delData.delegations);
    } catch (e: any) {
      setError(e?.message || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return approvals.filter((a) => {
      if (typeFilter !== 'All' && a.type !== typeFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || a.refNumber.toLowerCase().includes(q) || a.type.toLowerCase().includes(q) || a.department.toLowerCase().includes(q);
    });
  }, [approvals, typeFilter, search]);

  const counts = {
    total: approvals.length,
    requisitions: approvals.filter(a => a.type === 'Purchase Requisition').length,
    pos: approvals.filter(a => a.type === 'Purchase Order').length,
    highPriority: approvals.filter(a => a.priority === 'High' || a.priority === 'Urgent').length,
  };

  const openAction = (item: ApprovalItem, action: 'approve' | 'reject') => {
    setActionModal({ item, action });
    setActionComment('');
  };

  const submitAction = async () => {
    if (!actionModal) return;
    setSubmitting(true);
    setActingOn(actionModal.item.id);
    try {
      if (actionModal.action === 'approve') {
        await approveApprovalItem(actionModal.item.id, actionComment);
        addNotification(`${actionModal.item.type} ${actionModal.item.refNumber} approved`, 'task', 'Procurement');
      } else {
        await rejectApprovalItem(actionModal.item.id, actionComment);
        addNotification(`${actionModal.item.type} ${actionModal.item.refNumber} rejected`, 'warning', 'Procurement');
      }
      setActionModal(null);
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to process approval', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
      setActingOn(null);
    }
  };

  const submitDelegation = async () => {
    if (!delegationForm.delegatorId || !delegationForm.delegateId || !delegationForm.startDate || !delegationForm.endDate) {
      addNotification('All delegation fields are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      await createApprovalDelegation(delegationForm);
      addNotification('Approval delegation created', 'task', 'Procurement');
      setShowDelegationForm(false);
      setDelegationForm({ delegatorId: '', delegatorName: '', delegateId: '', delegateName: '', approvalType: 'Purchase Requisition', startDate: '', endDate: '', reason: '' });
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create delegation', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Approval Center"
        subtitle="Centralized procurement approval queue with delegation support."
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowDelegationForm(true)} className={button.secondary}>
              <UserCheck className="w-4 h-4" /> New Delegation
            </button>
          </div>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </SectionCard>
      )}

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Approvals" value={counts.total} icon={Clock} tone="warning" />
        <StatCard title="Requisitions" value={counts.requisitions} icon={FileText} tone="info" />
        <StatCard title="Purchase Orders" value={counts.pos} icon={ShoppingCart} tone="accent" />
        <StatCard title="High Priority" value={counts.highPriority} icon={AlertCircle} tone="danger" />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Approval Queue */}
        <div className="lg:col-span-8 space-y-4">
          {/* Filters */}
          <SectionCard pad="md">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input className={inputClass + ' pl-10'} placeholder="Search by ref number, type, department..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className={inputClass + ' max-w-[200px]'} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="All">All Types</option>
                {APPROVAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </SectionCard>

          <SectionCard title="Approval Queue" subtitle={`${filtered.length} pending item${filtered.length !== 1 ? 's' : ''}`} pad="none">
            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
                <ShieldCheck className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm">No pending approvals</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {filtered.map((item) => {
                  const Icon = TYPE_ICONS[item.type] || FileText;
                  return (
                    <div key={item.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 dark:text-white">{item.type}</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{item.refNumber}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(item.amount, item.currency)}</p>
                          <Badge tone={item.priority === 'Urgent' ? 'danger' : item.priority === 'High' ? 'warning' : 'neutral'}>{item.priority}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-slate-700">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                            <User className="w-3.5 h-3.5" /> {item.requester || '—'}
                          </div>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{item.department}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <Badge tone="warning">{item.status}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => openAction(item, 'reject')} disabled={actingOn === item.id} className="text-xs bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50">
                            <XCircle className="w-3.5 h-3.5 inline mr-1" /> Reject
                          </button>
                          <button onClick={() => openAction(item, 'approve')} disabled={actingOn === item.id} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Approve
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Sidebar: Hierarchy + Conditions + Delegations */}
        <div className="lg:col-span-4 space-y-4">
          {/* Approval Hierarchy (spec section 43) */}
          <SectionCard title="Approval Hierarchy" subtitle="Per spec section 43" icon={ArrowRight} pad="md">
            <div className="space-y-3">
              {HIERARCHY.map((level, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{level.level}</p>
                      <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">{level.limit}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{level.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Approval Conditions (spec section 43) */}
          <SectionCard title="Approval Conditions" subtitle="Per spec section 43" icon={ShieldCheck} pad="md">
            <div className="flex flex-wrap gap-1.5">
              {APPROVAL_CONDITIONS.map((c) => (
                <span key={c} className="px-2 py-1 text-xs rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">{c}</span>
              ))}
            </div>
          </SectionCard>

          {/* Active Delegations (spec section 44) */}
          <SectionCard title="Active Delegations" subtitle="Per spec section 44" icon={UserCheck} pad="md">
            {delegations.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No active delegations</p>
            ) : (
              <div className="space-y-2">
                {delegations.map((d) => (
                  <div key={d.id} className="p-2 border border-gray-200 dark:border-slate-700 rounded-lg">
                    <p className="text-xs font-medium text-gray-900 dark:text-white">{d.delegate_name || d.delegate_id}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{d.approval_type}</p>
                    <p className="text-xs text-gray-400">{d.start_date} → {d.end_date}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
              <p className="text-xs font-bold text-gray-500 mb-1">Delegation Features:</p>
              <div className="flex flex-wrap gap-1">
                {DELEGATION_FEATURES.map((f) => (
                  <span key={f} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400">{f}</span>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Action Modal */}
      <ModalSystem
        isOpen={!!actionModal}
        onClose={() => setActionModal(null)}
        title={actionModal?.action === 'approve' ? 'Approve Request' : 'Reject Request'}
        size="md"
        loading={submitting}
        confirmLabel={actionModal?.action === 'approve' ? 'Approve' : 'Reject'}
        onConfirm={submitAction}
      >
        {actionModal && (
          <div className="space-y-4">
            <div className={`p-3 rounded-xl border ${actionModal.action === 'approve' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{actionModal.item.type} · {actionModal.item.refNumber}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {actionModal.item.department} · {fmtMoney(actionModal.item.amount, actionModal.item.currency)}
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {actionModal.action === 'approve' ? 'Approval Comments' : 'Rejection Reason'}
              </label>
              <textarea
                className={inputClass}
                rows={3}
                value={actionComment}
                onChange={(e) => setActionComment(e.target.value)}
                placeholder={actionModal.action === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
              />
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delegation Modal (spec section 44) */}
      <ModalSystem
        isOpen={showDelegationForm}
        onClose={() => setShowDelegationForm(false)}
        title="New Approval Delegation"
        size="md"
        loading={submitting}
        confirmLabel="Create Delegation"
        onConfirm={submitDelegation}
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Delegate approval authority to another user for a specified period and approval type.
              Supports temporary delegation, manager substitution, and leave delegation.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delegator ID *</label>
              <input className={inputClass} value={delegationForm.delegatorId} onChange={(e) => setDelegationForm({ ...delegationForm, delegatorId: e.target.value })} placeholder="User ID" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delegator Name</label>
              <input className={inputClass} value={delegationForm.delegatorName} onChange={(e) => setDelegationForm({ ...delegationForm, delegatorName: e.target.value })} placeholder="Name" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delegate ID *</label>
              <input className={inputClass} value={delegationForm.delegateId} onChange={(e) => setDelegationForm({ ...delegationForm, delegateId: e.target.value })} placeholder="User ID" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Delegate Name</label>
              <input className={inputClass} value={delegationForm.delegateName} onChange={(e) => setDelegationForm({ ...delegationForm, delegateName: e.target.value })} placeholder="Name" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 mb-1">Approval Type *</label>
              <select className={inputClass} value={delegationForm.approvalType} onChange={(e) => setDelegationForm({ ...delegationForm, approvalType: e.target.value as ApprovalType })}>
                {APPROVAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Start Date *</label>
              <input type="date" className={inputClass} value={delegationForm.startDate} onChange={(e) => setDelegationForm({ ...delegationForm, startDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">End Date *</label>
              <input type="date" className={inputClass} value={delegationForm.endDate} onChange={(e) => setDelegationForm({ ...delegationForm, endDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Reason</label>
            <textarea className={inputClass} rows={2} value={delegationForm.reason} onChange={(e) => setDelegationForm({ ...delegationForm, reason: e.target.value })} placeholder="e.g. Annual leave" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ApprovalCenter;
