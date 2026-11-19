/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procurement Risk Management — Supply Chain & Procurement Portal (/erp/procurement/risk).
 * Aligns with unified_supply_chain_procurement_portal.md sections 29, 30.
 *
 * Supplier risk monitor (spec section 29):
 *   Single-source dependency, Financial risk, Delivery risk, Quality risk,
 *   Compliance risk, Geographic risk, Price volatility, Contract dependency
 *
 * Risk levels (spec section 29): Low, Medium, High, Critical
 *
 * Supplier concentration (spec section 30):
 *   System should automatically identify concentration above configured thresholds.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert, Plus, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, Eye, AlertCircle, PieChart, TrendingUp,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSuppliers, fetchSupplierRisk, createSupplierRisk,
  type RiskLevel, type Supplier,
} from '../../services/procurementService';

// Spec section 29: Risk types
const RISK_TYPES = [
  'Single-source Dependency', 'Financial', 'Delivery', 'Quality', 'Compliance',
  'Geographic', 'Price Volatility', 'Contract Dependency',
] as const;

// Spec section 29: Risk levels
const RISK_LEVELS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];

const RISK_TONE: Record<RiskLevel, StatusTone> = {
  Low: 'success', Medium: 'warning', High: 'danger', Critical: 'danger',
};

// Spec section 30: Concentration threshold (configurable)
const CONCENTRATION_THRESHOLD = 50; // % above which concentration risk is flagged

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const ProcurementRisk: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [riskData, setRiskData] = useState<any[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [showRiskForm, setShowRiskForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [riskForm, setRiskForm] = useState({
    supplierId: '', riskType: 'Financial' as string, riskLevel: 'Medium' as RiskLevel,
    riskDescription: '', mitigationPlan: '', owner: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSuppliers({ status: 'Active', propertyId: currentPropertyId || undefined });
      setSuppliers(data.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const loadSupplierRisk = async (supplierId: string) => {
    setRiskLoading(true);
    try {
      const data = await fetchSupplierRisk(supplierId);
      setRiskData(data.risks);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load risk data', 'warning', 'Procurement');
    } finally {
      setRiskLoading(false);
    }
  };

  const selectSupplier = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    loadSupplierRisk(supplierId);
  };

  // Spec section 30: Supplier concentration analysis by category
  const concentrationByCategory = useMemo(() => {
    const byCat: Record<string, { supplier: Supplier; count: number }[]> = {};
    suppliers.forEach((s) => {
      const cat = s.supplier_category || 'Uncategorized';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push({ supplier: s, count: 1 });
    });
    // Calculate concentration percentages
    return Object.entries(byCat).map(([cat, items]) => {
      const total = items.length;
      return {
        category: cat,
        suppliers: items.map((i) => ({
          ...i.supplier,
          concentrationPct: total > 0 ? (1 / total) * 100 : 0,
        })),
        totalSuppliers: total,
        highConcentration: total === 1, // Single-source = high concentration
      };
    }).sort((a, b) => a.totalSuppliers - b.totalSuppliers);
  }, [suppliers]);

  const submitRisk = async () => {
    if (!riskForm.supplierId || !riskForm.riskDescription) {
      addNotification('Supplier and description are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      await createSupplierRisk({
        supplierId: riskForm.supplierId,
        riskType: riskForm.riskType,
        riskLevel: riskForm.riskLevel,
        riskDescription: riskForm.riskDescription,
        mitigationPlan: riskForm.mitigationPlan || undefined,
        owner: riskForm.owner || undefined,
      });
      addNotification('Risk added to supplier risk register', 'task', 'Procurement');
      setShowRiskForm(false);
      setRiskForm({ supplierId: '', riskType: 'Financial', riskLevel: 'Medium', riskDescription: '', mitigationPlan: '', owner: '' });
      if (riskForm.supplierId === selectedSupplierId) {
        loadSupplierRisk(riskForm.supplierId);
      }
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create risk', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const counts = {
    low: suppliers.filter((s) => s.risk_level === 'Low').length,
    medium: suppliers.filter((s) => s.risk_level === 'Medium').length,
    high: suppliers.filter((s) => s.risk_level === 'High').length,
    critical: suppliers.filter((s) => s.risk_level === 'Critical').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Procurement Risk Management"
        subtitle="Supplier risk monitoring and concentration analysis per specification sections 29-30."
        icon={ShieldAlert}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowRiskForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Risk
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
        <StatCard title="Low Risk" value={counts.low} icon={CheckCircle2} tone="success" />
        <StatCard title="Medium Risk" value={counts.medium} icon={AlertTriangle} tone="warning" />
        <StatCard title="High Risk" value={counts.high} icon={AlertTriangle} tone="danger" />
        <StatCard title="Critical Risk" value={counts.critical} icon={ShieldAlert} tone="danger" />
      </div>

      {/* Risk Monitor Types (spec section 29) */}
      <SectionCard title="Risk Monitor" subtitle="Per specification section 29" icon={ShieldAlert} pad="md">
        <div className="flex flex-wrap gap-1.5">
          {RISK_TYPES.map((r) => (
            <span key={r} className="px-2 py-1 text-xs rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">{r}</span>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <p className="text-xs font-bold text-gray-500 mb-2">Risk Levels:</p>
          <div className="flex flex-wrap gap-2">
            {RISK_LEVELS.map((l) => <Badge key={l} tone={RISK_TONE[l]}>{l}</Badge>)}
          </div>
        </div>
      </SectionCard>

      {/* Supplier Concentration (spec section 30) */}
      <SectionCard title="Supplier Concentration Analysis" subtitle={`Per specification section 30 — threshold: ${CONCENTRATION_THRESHOLD}%`} icon={PieChart} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : concentrationByCategory.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <PieChart className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No concentration data</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {concentrationByCategory.map((cat) => (
              <div key={cat.category} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{cat.category}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{cat.totalSuppliers} supplier{cat.totalSuppliers !== 1 ? 's' : ''}</span>
                    {cat.highConcentration && <Badge tone="danger">HIGH CONCENTRATION</Badge>}
                  </div>
                </div>
                <div className="space-y-1">
                  {cat.suppliers.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">{s.legal_name}</span>
                      <span className={`tabular-nums font-medium ${s.concentrationPct >= CONCENTRATION_THRESHOLD ? 'text-red-500' : 'text-gray-500'}`}>
                        {s.concentrationPct.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Supplier Risk Overview */}
      <SectionCard title="Supplier Risk Overview" subtitle={`${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : suppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <ShieldAlert className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No suppliers found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {suppliers.map((supplier) => (
              <div key={supplier.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge tone={RISK_TONE[supplier.risk_level] || 'neutral'}>{supplier.risk_level} Risk</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{supplier.legal_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{supplier.supplier_category}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setViewing(supplier)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View">
                    <Eye className="w-4 h-4" />
                  </button>
                  <button onClick={() => selectSupplier(supplier.id)} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                    View Risks
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Risk Register for selected supplier */}
      {selectedSupplierId && (
        <SectionCard
          title={`Risk Register — ${suppliers.find((s) => s.id === selectedSupplierId)?.legal_name || ''}`}
          pad="none"
        >
          {riskLoading ? (
            <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
          ) : riskData.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
              <ShieldAlert className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm">No risks registered for this supplier</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {riskData.map((risk) => (
                <div key={risk.id} className="px-6 py-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{risk.risk_type}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{risk.risk_description}</p>
                    </div>
                    <Badge tone={RISK_TONE[risk.risk_level as RiskLevel] || 'neutral'}>{risk.risk_level}</Badge>
                  </div>
                  {risk.mitigation_plan && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 uppercase mb-1">Mitigation Plan</p>
                      <p className="text-xs text-gray-700 dark:text-gray-300">{risk.mitigation_plan}</p>
                    </div>
                  )}
                  <div className="flex justify-between items-center mt-2">
                    <p className="text-xs text-gray-400">Owner: {risk.owner || '—'}</p>
                    <Badge>{risk.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Supplier Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Supplier Risk Profile" size="md" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Supplier</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.legal_name}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Risk Level</p><Badge tone={RISK_TONE[viewing.risk_level] || 'neutral'}>{viewing.risk_level} Risk</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Category</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.supplier_category}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.status}</p></div>
            </div>
            <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              <button onClick={() => { selectSupplier(viewing.id); setViewing(null); }} className={button.primary}>
                View Risk Register
              </button>
            </div>
          </div>
        </ModalSystem>
      )}

      {/* Add Risk Modal */}
      <ModalSystem isOpen={showRiskForm} onClose={() => setShowRiskForm(false)} title="Add Risk" size="lg" loading={submitting} confirmLabel="Add" onConfirm={submitRisk}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Supplier *</label>
            <select className={inputClass} value={riskForm.supplierId} onChange={(e) => setRiskForm({ ...riskForm, supplierId: e.target.value })}>
              <option value="">Select supplier...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Risk Type *</label>
              <select className={inputClass} value={riskForm.riskType} onChange={(e) => setRiskForm({ ...riskForm, riskType: e.target.value })}>
                {RISK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Risk Level</label>
              <select className={inputClass} value={riskForm.riskLevel} onChange={(e) => setRiskForm({ ...riskForm, riskLevel: e.target.value as RiskLevel })}>
                {RISK_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Description *</label>
            <textarea className={inputClass} rows={3} value={riskForm.riskDescription} onChange={(e) => setRiskForm({ ...riskForm, riskDescription: e.target.value })} placeholder="Risk description" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Mitigation Plan</label>
            <textarea className={inputClass} rows={3} value={riskForm.mitigationPlan} onChange={(e) => setRiskForm({ ...riskForm, mitigationPlan: e.target.value })} placeholder="Mitigation plan" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Owner</label>
            <input className={inputClass} value={riskForm.owner} onChange={(e) => setRiskForm({ ...riskForm, owner: e.target.value })} placeholder="Risk owner" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ProcurementRisk;
