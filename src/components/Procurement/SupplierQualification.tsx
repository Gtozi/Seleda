/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Qualification — Supply Chain & Procurement Portal (/erp/procurement/qualification).
 * Aligns with unified_supply_chain_procurement_portal.md section 26.
 *
 * Qualification criteria (spec section 26):
 *   Legal compliance, Product quality, Financial capability, Delivery capacity,
 *   Production capacity, Certifications, Food safety, Insurance, References,
 *   Sustainability, Regulatory compliance
 *
 * Features:
 * - All 11 spec qualification criteria
 * - Score-based evaluation (0-100)
 * - Status flow: Pending → Qualified / Conditionally Qualified / Disqualified
 * - Expiry date tracking
 * - Search and filter
 * - Multi-property scoping
 * - Criteria reference panel
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award, Plus, RefreshCw, Loader2, AlertCircle, Search,
  CheckCircle2, XCircle, Eye, ShieldCheck, Clock,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSupplierQualifications, createSupplierQualification, updateSupplierQualification,
  fetchSuppliers, type SupplierQualification, type QualificationStatus, type QualificationCriteria, type Supplier,
} from '../../services/procurementService';

// Spec section 26: All 11 qualification criteria
const CRITERIA: QualificationCriteria[] = [
  'Legal Compliance', 'Product Quality', 'Financial Capability', 'Delivery Capacity',
  'Production Capacity', 'Certifications', 'Food Safety', 'Insurance',
  'References', 'Sustainability', 'Regulatory Compliance',
];

const CRITERIA_DESCRIPTIONS: Record<string, string> = {
  'Legal Compliance': 'Valid business license and legal standing',
  'Product Quality': 'Quality of products/services delivered',
  'Financial Capability': 'Financial stability and capacity',
  'Delivery Capacity': 'Ability to meet delivery requirements',
  'Production Capacity': 'Production volume capability',
  'Certifications': 'Industry certifications held',
  'Food Safety': 'Food safety compliance (HACCP, ISO 22000)',
  'Insurance': 'Adequate insurance coverage',
  'References': 'Customer references and track record',
  'Sustainability': 'Sustainability practices and policies',
  'Regulatory Compliance': 'Regulatory compliance status',
};

const STATUS_TONE: Record<QualificationStatus, any> = {
  Pending: 'warning', Qualified: 'success', 'Conditionally Qualified': 'info', Disqualified: 'danger', Expired: 'neutral',
};

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const SupplierQualificationModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [qualifications, setQualifications] = useState<SupplierQualification[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<SupplierQualification | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | QualificationStatus>('All');
  const [criteriaFilter, setCriteriaFilter] = useState<'All' | QualificationCriteria>('All');
  const [form, setForm] = useState({ supplierId: '', criteriaType: 'Legal Compliance' as QualificationCriteria, score: 0, expiryDate: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [qualData, supData] = await Promise.all([
        fetchSupplierQualifications(),
        fetchSuppliers({ status: 'Active', propertyId: currentPropertyId || undefined }),
      ]);
      setQualifications(qualData.qualifications);
      setSuppliers(supData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load qualifications');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return qualifications.filter((q) => {
      if (statusFilter !== 'All' && q.status !== statusFilter) return false;
      if (criteriaFilter !== 'All' && q.criteria_type !== criteriaFilter) return false;
      const s = search.trim().toLowerCase();
      return !s || (q.proc_suppliers?.legal_name || '').toLowerCase().includes(s) || (q.criteria_type || '').toLowerCase().includes(s);
    });
  }, [qualifications, search, statusFilter, criteriaFilter]);

  const submitCreate = async () => {
    if (!form.supplierId || !form.criteriaType) {
      addNotification('Supplier and criteria type are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { qualification } = await createSupplierQualification({
        supplierId: form.supplierId, criteriaType: form.criteriaType, score: form.score,
        expiryDate: form.expiryDate || undefined, notes: form.notes,
      });
      setQualifications((prev) => [qualification, ...prev]);
      addNotification('Qualification added', 'task', 'Procurement');
      setShowForm(false);
      setForm({ supplierId: '', criteriaType: 'Legal Compliance', score: 0, expiryDate: '', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add qualification', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: QualificationStatus) => {
    setActingOn(id);
    try {
      const { qualification } = await updateSupplierQualification(id, { status });
      setQualifications((prev) => prev.map((q) => (q.id === id ? qualification : q)));
      addNotification(`Qualification → ${status}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const counts = {
    qualified: qualifications.filter((q) => q.status === 'Qualified').length,
    pending: qualifications.filter((q) => q.status === 'Pending').length,
    conditional: qualifications.filter((q) => q.status === 'Conditionally Qualified').length,
    disqualified: qualifications.filter((q) => q.status === 'Disqualified').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Supplier Qualification"
        subtitle="Qualification criteria evaluation per specification section 26."
        icon={Award}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Qualification
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
        <StatCard title="Qualified" value={counts.qualified} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Conditional" value={counts.conditional} icon={ShieldCheck} tone="info" />
        <StatCard title="Disqualified" value={counts.disqualified} icon={XCircle} tone="danger" />
      </div>

      {/* Criteria Reference (spec section 26) */}
      <SectionCard title="Qualification Criteria" subtitle="Per specification section 26" icon={ShieldCheck} pad="md">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CRITERIA.map((c) => (
            <div key={c} className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <p className="text-xs font-bold text-gray-900 dark:text-white">{c}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{CRITERIA_DESCRIPTIONS[c]}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by supplier or criteria..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[180px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Qualified">Qualified</option>
            <option value="Conditionally Qualified">Conditionally Qualified</option>
            <option value="Disqualified">Disqualified</option>
            <option value="Expired">Expired</option>
          </select>
          <select className={inputClass + ' max-w-[200px]'} value={criteriaFilter} onChange={(e) => setCriteriaFilter(e.target.value as any)}>
            <option value="All">All Criteria</option>
            {CRITERIA.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Qualifications List */}
      <SectionCard title="Qualifications" subtitle={`${filtered.length} record${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <Award className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No qualifications found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((q) => (
              <div key={q.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={STATUS_TONE[q.status] || 'neutral'}>{q.status}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{q.proc_suppliers?.legal_name || q.supplier_id}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{q.criteria_type} · Score: {q.score || 'N/A'}</p>
                    {q.expiry_date && <p className="text-xs text-gray-400 dark:text-gray-500">Expires: {q.expiry_date}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setViewing(q)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View">
                    <Eye className="w-4 h-4" />
                  </button>
                  {q.status === 'Pending' && (
                    <>
                      <button onClick={() => updateStatus(q.id, 'Qualified')} disabled={actingOn === q.id} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">Qualify</button>
                      <button onClick={() => updateStatus(q.id, 'Disqualified')} disabled={actingOn === q.id} className="text-xs bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-50">Disqualify</button>
                    </>
                  )}
                  {q.status === 'Conditionally Qualified' && (
                    <button onClick={() => updateStatus(q.id, 'Qualified')} disabled={actingOn === q.id} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">Full Qualify</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="Add Qualification" size="lg" loading={submitting} confirmLabel="Add" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
            <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Select supplier...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Criteria Type *</label>
            <select className={inputClass} value={form.criteriaType} onChange={(e) => setForm({ ...form, criteriaType: e.target.value as QualificationCriteria })}>
              {CRITERIA.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">{CRITERIA_DESCRIPTIONS[form.criteriaType]}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Score (0-100)</label>
              <input type="number" min={0} max={100} className={inputClass} value={form.score} onChange={(e) => setForm({ ...form, score: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Expiry Date</label>
              <input type="date" className={inputClass} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Evaluation notes" />
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Qualification Details" size="md" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.status] || 'neutral'}>{viewing.status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Criteria</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.criteria_type}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Score</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.score || 'N/A'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Expiry Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.expiry_date || '—'}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Evaluated</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.evaluated_at ? new Date(viewing.evaluated_at).toLocaleDateString() : '—'}</p></div>
            </div>
            {viewing.notes && (
              <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p></div>
            )}
            <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              {viewing.status === 'Pending' && (
                <>
                  <button onClick={() => { updateStatus(viewing.id, 'Qualified'); setViewing(null); }} disabled={actingOn === viewing.id} className={button.primary}>Qualify</button>
                  <button onClick={() => { updateStatus(viewing.id, 'Disqualified'); setViewing(null); }} disabled={actingOn === viewing.id} className="text-sm bg-red-600 text-white px-4 py-2 rounded-xl hover:bg-red-700">Disqualify</button>
                </>
              )}
              {viewing.status === 'Conditionally Qualified' && (
                <button onClick={() => { updateStatus(viewing.id, 'Qualified'); setViewing(null); }} disabled={actingOn === viewing.id} className={button.primary}>Full Qualify</button>
              )}
            </div>
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default SupplierQualificationModule;
