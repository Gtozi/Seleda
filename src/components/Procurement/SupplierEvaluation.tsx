/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Evaluation — Supply Chain & Procurement Portal (/erp/procurement/evaluation).
 * Aligns with unified_supply_chain_procurement_portal.md section 28 (Supplier Performance).
 *
 * Performance measures (spec section 28):
 *   On-Time Delivery, Delivery Accuracy, Product Quality, Rejection Rate,
 *   Price Stability, Response Time, Complaint Rate, Contract Compliance
 *
 * Supplier Score weights (spec section 28):
 *   Quality 30%, On-Time Delivery 25%, Price 20%, Service 15%, Compliance 10% = 100%
 *
 * Ratings: Excellent, Good, Acceptable, Poor, Critical
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Star, Plus, RefreshCw, Loader2, AlertCircle, Search,
  Eye, TrendingUp, Award, BarChart3,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSupplierEvaluations, createSupplierEvaluation, fetchSuppliers,
  type SupplierEvaluation, type SupplierRating, type Supplier,
} from '../../services/procurementService';

const RATINGS: SupplierRating[] = ['Excellent', 'Good', 'Acceptable', 'Poor', 'Critical'];

const RATING_TONE: Record<SupplierRating, any> = {
  Excellent: 'success', Good: 'accent', Acceptable: 'info', Poor: 'warning', Critical: 'danger',
};

// Spec section 28: Performance measures
const PERFORMANCE_MEASURES = [
  'On-Time Delivery', 'Delivery Accuracy', 'Product Quality', 'Rejection Rate',
  'Price Stability', 'Response Time', 'Complaint Rate', 'Contract Compliance',
];

// Spec section 28: Score weights
const SCORE_WEIGHTS = [
  { key: 'quality', label: 'Quality', weight: 30 },
  { key: 'delivery', label: 'On-Time Delivery', weight: 25 },
  { key: 'price', label: 'Price', weight: 20 },
  { key: 'service', label: 'Service', weight: 15 },
  { key: 'compliance', label: 'Compliance', weight: 10 },
];

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const SupplierEvaluationModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [evaluations, setEvaluations] = useState<SupplierEvaluation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<SupplierEvaluation | null>(null);
  const [search, setSearch] = useState('');
  const [ratingFilter, setRatingFilter] = useState<'All' | SupplierRating>('All');
  const [form, setForm] = useState({
    supplierId: '', evaluationPeriod: '', evaluator: '',
    qualityScore: 0, deliveryScore: 0, priceScore: 0, serviceScore: 0, complianceScore: 0,
    rating: 'Good' as SupplierRating, strengths: '', weaknesses: '', recommendations: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evalData, supData] = await Promise.all([
        fetchSupplierEvaluations(),
        fetchSuppliers({ propertyId: currentPropertyId || undefined }),
      ]);
      setEvaluations(evalData.evaluations);
      setSuppliers(supData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load evaluations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return evaluations.filter((e) => {
      if (ratingFilter !== 'All' && e.rating !== ratingFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || (e.proc_suppliers?.legal_name || '').toLowerCase().includes(q) || (e.evaluation_period || '').toLowerCase().includes(q) || (e.evaluator || '').toLowerCase().includes(q);
    });
  }, [evaluations, search, ratingFilter]);

  const overall = form.qualityScore * 0.3 + form.deliveryScore * 0.25 + form.priceScore * 0.2 + form.serviceScore * 0.15 + form.complianceScore * 0.1;

  const submitCreate = async () => {
    if (!form.supplierId || !form.evaluationPeriod || !form.evaluator) {
      addNotification('Supplier, period, and evaluator are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const overallScore = form.qualityScore * 0.3 + form.deliveryScore * 0.25 + form.priceScore * 0.2 + form.serviceScore * 0.15 + form.complianceScore * 0.1;
      const { evaluation } = await createSupplierEvaluation({
        supplierId: form.supplierId, evaluationPeriod: form.evaluationPeriod, evaluator: form.evaluator,
        qualityScore: form.qualityScore, deliveryScore: form.deliveryScore, priceScore: form.priceScore,
        serviceScore: form.serviceScore, complianceScore: form.complianceScore, overallScore,
        rating: form.rating, strengths: form.strengths, weaknesses: form.weaknesses, recommendations: form.recommendations,
      });
      setEvaluations((prev) => [evaluation, ...prev]);
      addNotification('Evaluation created', 'task', 'Procurement');
      setShowForm(false);
      setForm({ supplierId: '', evaluationPeriod: '', evaluator: '', qualityScore: 0, deliveryScore: 0, priceScore: 0, serviceScore: 0, complianceScore: 0, rating: 'Good', strengths: '', weaknesses: '', recommendations: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create evaluation', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const avgScore = evaluations.length > 0 ? evaluations.reduce((sum, e) => sum + e.overall_score, 0) / evaluations.length : 0;
  const counts = {
    excellent: evaluations.filter((e) => e.rating === 'Excellent').length,
    good: evaluations.filter((e) => e.rating === 'Good').length,
    poor: evaluations.filter((e) => e.rating === 'Poor' || e.rating === 'Critical').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Supplier Evaluation"
        subtitle="Periodic supplier performance evaluations per specification section 28."
        icon={Star}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Evaluation
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
        <StatCard title="Total Evaluations" value={evaluations.length} icon={BarChart3} tone="info" />
        <StatCard title="Average Score" value={avgScore.toFixed(1)} icon={TrendingUp} tone="accent" />
        <StatCard title="Excellent" value={counts.excellent} icon={Award} tone="success" />
        <StatCard title="Poor/Critical" value={counts.poor} icon={AlertCircle} tone="danger" />
      </div>

      {/* Score Weights (spec section 28) */}
      <SectionCard title="Supplier Score Weights" subtitle="Per specification section 28" icon={BarChart3} pad="md">
        <div className="grid grid-cols-5 gap-3">
          {SCORE_WEIGHTS.map((w) => (
            <div key={w.key} className="text-center p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">{w.label}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{w.weight}%</p>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <p className="text-xs font-bold text-gray-500 mb-2">Performance Measures:</p>
          <div className="flex flex-wrap gap-1.5">
            {PERFORMANCE_MEASURES.map((m) => (
              <span key={m} className="px-2 py-1 text-xs rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">{m}</span>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by supplier, period, evaluator..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[160px]'} value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value as any)}>
            <option value="All">All Ratings</option>
            {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Evaluations List */}
      <SectionCard title="Evaluations" subtitle={`${filtered.length} evaluation${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <Star className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No evaluations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((e) => (
              <div key={e.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <Badge tone={RATING_TONE[e.rating] || 'neutral'}>{e.rating || 'N/A'}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{e.proc_suppliers?.legal_name || e.supplier_id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{e.evaluation_period} · {e.evaluator}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-2xl font-bold text-indigo-600 tabular-nums">{e.overall_score.toFixed(1)}</p>
                    <button onClick={() => setViewing(e)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View">
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2 text-xs">
                  <div><p className="text-gray-400">Quality (30%)</p><p className="font-medium text-gray-700 dark:text-gray-300">{e.quality_score}</p></div>
                  <div><p className="text-gray-400">Delivery (25%)</p><p className="font-medium text-gray-700 dark:text-gray-300">{e.delivery_score}</p></div>
                  <div><p className="text-gray-400">Price (20%)</p><p className="font-medium text-gray-700 dark:text-gray-300">{e.price_score}</p></div>
                  <div><p className="text-gray-400">Service (15%)</p><p className="font-medium text-gray-700 dark:text-gray-300">{e.service_score}</p></div>
                  <div><p className="text-gray-400">Compliance (10%)</p><p className="font-medium text-gray-700 dark:text-gray-300">{e.compliance_score}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Supplier Evaluation" size="xl" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
              <select className={inputClass} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">Select supplier...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Period *</label>
              <input className={inputClass} placeholder="e.g. Q3 2026" value={form.evaluationPeriod} onChange={(e) => setForm({ ...form, evaluationPeriod: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Evaluator *</label>
              <input className={inputClass} value={form.evaluator} onChange={(e) => setForm({ ...form, evaluator: e.target.value })} placeholder="Evaluator name" />
            </div>
          </div>

          {/* Score inputs with weights */}
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
            <p className="text-xs font-bold text-gray-600 dark:text-gray-400 mb-2">Performance Scores (0-100)</p>
            <div className="grid grid-cols-5 gap-3">
              <div><label className="block text-xs font-bold text-gray-500 mb-1">Quality (30%)</label><input type="number" min={0} max={100} className={inputClass} value={form.qualityScore} onChange={(e) => setForm({ ...form, qualityScore: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1">Delivery (25%)</label><input type="number" min={0} max={100} className={inputClass} value={form.deliveryScore} onChange={(e) => setForm({ ...form, deliveryScore: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1">Price (20%)</label><input type="number" min={0} max={100} className={inputClass} value={form.priceScore} onChange={(e) => setForm({ ...form, priceScore: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1">Service (15%)</label><input type="number" min={0} max={100} className={inputClass} value={form.serviceScore} onChange={(e) => setForm({ ...form, serviceScore: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1">Compliance (10%)</label><input type="number" min={0} max={100} className={inputClass} value={form.complianceScore} onChange={(e) => setForm({ ...form, complianceScore: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <p className="text-sm text-right mt-2 text-gray-600 dark:text-gray-400">Overall Score: <span className="font-bold text-indigo-600">{overall.toFixed(1)}</span></p>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Overall Rating</label>
            <select className={inputClass} value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value as SupplierRating })}>
              {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Strengths</label><textarea className={inputClass} rows={2} value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} placeholder="Supplier strengths" /></div>
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Weaknesses</label><textarea className={inputClass} rows={2} value={form.weaknesses} onChange={(e) => setForm({ ...form, weaknesses: e.target.value })} placeholder="Areas for improvement" /></div>
            <div><label className="block text-xs font-bold text-gray-500 mb-1">Recommendations</label><textarea className={inputClass} rows={2} value={form.recommendations} onChange={(e) => setForm({ ...form, recommendations: e.target.value })} placeholder="Action recommendations" /></div>
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Evaluation Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.proc_suppliers?.legal_name || viewing.supplier_id}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Rating</p><Badge tone={RATING_TONE[viewing.rating] || 'neutral'}>{viewing.rating}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Period</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.evaluation_period}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Evaluator</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.evaluator}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Overall Score</p><p className="text-lg font-bold text-indigo-600 tabular-nums">{viewing.overall_score.toFixed(1)}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Date</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.evaluation_date ? new Date(viewing.evaluation_date).toLocaleDateString() : '—'}</p></div>
            </div>

            {/* Score breakdown */}
            <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
              <p className="text-xs font-bold text-gray-500 uppercase mb-3">Score Breakdown</p>
              <div className="grid grid-cols-5 gap-3">
                <div className="text-center"><p className="text-xs text-gray-500">Quality (30%)</p><p className="text-lg font-bold text-gray-900 dark:text-white">{viewing.quality_score}</p></div>
                <div className="text-center"><p className="text-xs text-gray-500">Delivery (25%)</p><p className="text-lg font-bold text-gray-900 dark:text-white">{viewing.delivery_score}</p></div>
                <div className="text-center"><p className="text-xs text-gray-500">Price (20%)</p><p className="text-lg font-bold text-gray-900 dark:text-white">{viewing.price_score}</p></div>
                <div className="text-center"><p className="text-xs text-gray-500">Service (15%)</p><p className="text-lg font-bold text-gray-900 dark:text-white">{viewing.service_score}</p></div>
                <div className="text-center"><p className="text-xs text-gray-500">Compliance (10%)</p><p className="text-lg font-bold text-gray-900 dark:text-white">{viewing.compliance_score}</p></div>
              </div>
            </div>

            {viewing.strengths && <div><p className="text-xs text-gray-500 uppercase mb-1">Strengths</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.strengths}</p></div>}
            {viewing.weaknesses && <div><p className="text-xs text-gray-500 uppercase mb-1">Weaknesses</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.weaknesses}</p></div>}
            {viewing.recommendations && <div><p className="text-xs text-gray-500 uppercase mb-1">Recommendations</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.recommendations}</p></div>}
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default SupplierEvaluationModule;
