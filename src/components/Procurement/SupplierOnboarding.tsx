/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Onboarding — Supply Chain & Procurement Portal (/erp/procurement/onboarding).
 * Aligns with unified_supply_chain_procurement_portal.md section 25.
 *
 * Onboarding flow (spec section 25):
 *   Supplier Application → Document Submission → Procurement Review →
 *   Compliance Review → Finance Verification → Approval → Supplier Activated
 *
 * Features:
 * - 7-stage onboarding pipeline with progress visualization
 * - Advance/reject actions with rejection reason
 * - Stage filter and search
 * - Multi-property scoping
 * - Detail view with stage history and review notes
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus, RefreshCw, Loader2, CheckCircle2, XCircle,
  AlertCircle, Search, Eye, ArrowRight, FileText,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSupplierOnboarding, updateSupplierOnboarding,
  type SupplierOnboarding, type OnboardingStage,
} from '../../services/procurementService';

// Spec section 25: Onboarding stages
const STAGES: OnboardingStage[] = [
  'Application', 'Document Submission', 'Procurement Review',
  'Compliance Review', 'Finance Verification', 'Approval', 'Activated',
];
const REJECTED: OnboardingStage = 'Rejected';

const NEXT_STAGE: Record<string, OnboardingStage | null> = {
  'Application': 'Document Submission',
  'Document Submission': 'Procurement Review',
  'Procurement Review': 'Compliance Review',
  'Compliance Review': 'Finance Verification',
  'Finance Verification': 'Approval',
  'Approval': 'Activated',
  'Activated': null,
  'Rejected': null,
};

const STAGE_TONE: Record<string, any> = {
  Application: 'neutral', 'Document Submission': 'info', 'Procurement Review': 'info',
  'Compliance Review': 'warning', 'Finance Verification': 'warning',
  Approval: 'accent', Activated: 'success', Rejected: 'danger',
};

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const SupplierOnboardingModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [onboarding, setOnboarding] = useState<SupplierOnboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<'All' | OnboardingStage>('All');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<SupplierOnboarding | null>(null);

  // Reject modal
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSupplierOnboarding({
        stage: stageFilter === 'All' ? undefined : stageFilter,
        propertyId: currentPropertyId || undefined,
      });
      setOnboarding(data.onboarding);
    } catch (e: any) {
      setError(e?.message || 'Failed to load onboarding data');
    } finally {
      setLoading(false);
    }
  }, [stageFilter, currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return onboarding.filter((o) => {
      const q = search.trim().toLowerCase();
      return !q || (o.proc_suppliers?.legal_name || '').toLowerCase().includes(q) || (o.proc_suppliers?.supplier_code || '').toLowerCase().includes(q);
    });
  }, [onboarding, search]);

  const advance = async (id: string, currentStage: OnboardingStage) => {
    const next = NEXT_STAGE[currentStage];
    if (!next) return;
    setActingOn(id);
    try {
      const { onboarding: updated } = await updateSupplierOnboarding(id, { currentStage: next });
      setOnboarding((prev) => prev.map((o) => (o.id === id ? updated : o)));
      addNotification(`Supplier advanced to ${next}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to advance supplier', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    setSubmitting(true);
    setActingOn(rejectModal);
    try {
      const { onboarding: updated } = await updateSupplierOnboarding(rejectModal, {
        currentStage: 'Rejected',
        rejectionReason: rejectReason || 'Failed review',
      });
      setOnboarding((prev) => prev.map((o) => (o.id === rejectModal ? updated : o)));
      addNotification('Supplier rejected', 'warning', 'Procurement');
      setRejectModal(null);
      setRejectReason('');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to reject supplier', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
      setActingOn(null);
    }
  };

  const counts = {
    pending: onboarding.filter((o) => o.current_stage !== 'Activated' && o.current_stage !== 'Rejected').length,
    activated: onboarding.filter((o) => o.current_stage === 'Activated').length,
    rejected: onboarding.filter((o) => o.current_stage === 'Rejected').length,
    compliance: onboarding.filter((o) => o.current_stage === 'Compliance Review' || o.current_stage === 'Finance Verification').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Supplier Onboarding"
        subtitle="Multi-stage supplier onboarding workflow per specification section 25."
        icon={UserPlus}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
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
        <StatCard title="In Progress" value={counts.pending} icon={UserPlus} tone="warning" />
        <StatCard title="Compliance Review" value={counts.compliance} icon={FileText} tone="info" />
        <StatCard title="Activated" value={counts.activated} icon={CheckCircle2} tone="success" />
        <StatCard title="Rejected" value={counts.rejected} icon={XCircle} tone="danger" />
      </div>

      {/* Onboarding Flow (spec section 25) */}
      <SectionCard title="Onboarding Flow" subtitle="Per specification section 25" icon={ArrowRight} pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${STAGE_TONE[s] === 'success' ? 'border-green-200 text-green-700 bg-green-50' : STAGE_TONE[s] === 'accent' ? 'border-indigo-200 text-indigo-700 bg-indigo-50' : 'border-gray-200 text-gray-600'}`}>
                {s}
              </div>
              {i < STAGES.length - 1 && <ArrowRight className="w-3 h-3 text-gray-400" />}
            </React.Fragment>
          ))}
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by supplier name or code..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[180px]'} value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)}>
            <option value="All">All Stages</option>
            {[...STAGES, REJECTED].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Onboarding Pipeline */}
      <SectionCard title="Onboarding Pipeline" subtitle={`${filtered.length} supplier${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <UserPlus className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No onboarding records</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((o) => (
              <div key={o.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <Badge tone={STAGE_TONE[o.current_stage] || 'neutral'}>{o.current_stage}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{o.proc_suppliers?.legal_name || o.supplier_id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{o.proc_suppliers?.supplier_category || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setViewing(o)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View Details">
                      <Eye className="w-4 h-4" />
                    </button>
                    {NEXT_STAGE[o.current_stage] && (
                      <button onClick={() => advance(o.id, o.current_stage)} disabled={actingOn === o.id} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                        Advance to {NEXT_STAGE[o.current_stage]}
                      </button>
                    )}
                    {o.current_stage !== 'Activated' && o.current_stage !== 'Rejected' && (
                      <button onClick={() => setRejectModal(o.id)} disabled={actingOn === o.id} className="text-xs bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-50">
                        Reject
                      </button>
                    )}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="flex gap-1">
                  {STAGES.map((s) => {
                    const stageIdx = STAGES.indexOf(o.current_stage as OnboardingStage);
                    const thisIdx = STAGES.indexOf(s);
                    return <div key={s} className={`h-1.5 flex-1 rounded-full ${thisIdx <= stageIdx ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-700'}`} title={s} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Onboarding Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Current Stage</p><Badge tone={STAGE_TONE[viewing.current_stage] || 'neutral'}>{viewing.current_stage}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Category</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.supplier_category || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Type</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.supplier_type || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Started</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.created_at ? new Date(viewing.created_at).toLocaleDateString() : '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Last Updated</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.updated_at ? new Date(viewing.updated_at).toLocaleDateString() : '—'}</p></div>
            </div>

            {/* Progress */}
            <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
              <p className="text-xs font-bold text-gray-500 uppercase mb-3">Onboarding Progress</p>
              <div className="space-y-2">
                {STAGES.map((s, i) => {
                  const stageIdx = STAGES.indexOf(viewing.current_stage as OnboardingStage);
                  const completed = i <= stageIdx;
                  const current = s === viewing.current_stage;
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${completed ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-slate-700 text-gray-400'}`}>
                        {completed ? '✓' : i + 1}
                      </div>
                      <p className={`text-sm ${current ? 'font-bold text-indigo-600' : completed ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`}>{s}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {viewing.rejection_reason && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-xs font-bold text-red-600 uppercase mb-1">Rejection Reason</p>
                <p className="text-sm text-red-700 dark:text-red-300">{viewing.rejection_reason}</p>
              </div>
            )}

            {viewing.review_notes && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Review Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.review_notes}</p></div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              {NEXT_STAGE[viewing.current_stage] && (
                <button onClick={() => { advance(viewing.id, viewing.current_stage); setViewing(null); }} disabled={actingOn === viewing.id} className={button.primary}>
                  Advance to {NEXT_STAGE[viewing.current_stage]}
                </button>
              )}
              {viewing.current_stage !== 'Activated' && viewing.current_stage !== 'Rejected' && (
                <button onClick={() => { setRejectModal(viewing.id); setViewing(null); }} disabled={actingOn === viewing.id} className="text-sm bg-red-600 text-white px-4 py-2 rounded-xl hover:bg-red-700">
                  Reject
                </button>
              )}
            </div>
          </div>
        </ModalSystem>
      )}

      {/* Reject Modal */}
      <ModalSystem
        isOpen={!!rejectModal}
        onClose={() => setRejectModal(null)}
        title="Reject Supplier"
        size="md"
        loading={submitting}
        confirmLabel="Confirm Rejection"
        onConfirm={confirmReject}
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-xs text-red-700 dark:text-red-300">
              The supplier will be marked as rejected and removed from the onboarding pipeline.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Rejection Reason</label>
            <textarea className={inputClass} rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Provide a reason for rejection..." />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default SupplierOnboardingModule;
