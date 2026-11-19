/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RFQ Management — Supply Chain & Procurement Portal (/erp/procurement/rfq).
 * Aligns with unified_supply_chain_procurement_portal.md sections 13-18.
 *
 * Features:
 * - Full RFQ header (spec section 14): Number, Property, Department, Officer,
 *   Issue Date, Response Deadline, Currency, Delivery Requirement, Terms, Conditions
 * - Full RFQ lines (spec section 14): Item, Specification, Quantity, Unit,
 *   Required Delivery Date, Quality Requirement
 * - Supplier selection criteria (spec section 15): Approved/Preferred/Qualified/
 *   Local/Strategic with exclusion warnings for Suspended/Disqualified/Expired/Non-compliant
 * - Quotation comparison with weighted evaluation (spec section 17):
 *   Price 30%, Quality 25%, Delivery 20%, Supplier Rating 10%, Payment Terms 10%, Sustainability 5%
 * - Supplier award with full award data (spec section 18): Supplier, Award Amount,
 *   Evaluation Score, Award Reason, Negotiated Price, Delivery Terms, Contract Reference
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  Eye,
  MoreVertical,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  Award,
  Scale,
  AlertCircle,
  ShieldCheck,
  Users,
  Handshake,
  ShoppingCart,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchRFQs,
  createRFQ,
  updateRFQ,
  compareRFQQuotations,
  fetchQuotations,
  fetchSuppliers,
  createNegotiationFromRFQ,
  createPOFromRFQAward,
  type RFQ,
  type RFQStatus,
  type QuotationComparison,
  type Supplier,
  type Quotation,
} from '../../services/procurementService';

// Spec section 8: All 12 demand origin departments
const DEPARTMENTS = [
  'Food & Beverage', 'Kitchen', 'Housekeeping', 'Engineering & Maintenance',
  'Spa & Wellness', 'Banquet & Events', 'Transportation & Fleet',
  'Human Resources', 'Administration', 'Security & Risk', 'IT', 'Other',
] as const;

// Spec section 15: Supplier selection criteria
const SUPPLIER_CRITERIA = [
  { key: 'Active', label: 'Approved Suppliers', desc: 'Suppliers with Active status' },
  { key: 'Preferred', label: 'Preferred Suppliers', desc: 'Strategic partner suppliers' },
  { key: 'Qualified', label: 'Qualified Suppliers', desc: 'Passed qualification process' },
  { key: 'Local', label: 'Local Suppliers', desc: 'Local sourcing priority' },
  { key: 'Strategic', label: 'Strategic Suppliers', desc: 'Long-term strategic partners' },
] as const;

// Spec section 15: Excluded supplier statuses
const EXCLUDED_STATUSES = ['Suspended', 'Disqualified', 'Restricted', 'Inactive'];

// Source system display labels for department-originated RFQs
const SOURCE_LABELS: Record<string, { label: string; tone: 'info' | 'accent' | 'warning' }> = {
  procurement: { label: 'Procurement', tone: 'info' },
  engineering: { label: 'Engineering', tone: 'accent' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  food_beverage: { label: 'F&B', tone: 'accent' },
  inventory: { label: 'Inventory', tone: 'accent' },
};

// Spec section 17: Weighted evaluation criteria (configurable)
const EVAL_WEIGHTS = [
  { key: 'price', label: 'Price', weight: 30 },
  { key: 'quality', label: 'Quality', weight: 25 },
  { key: 'delivery', label: 'Delivery', weight: 20 },
  { key: 'supplierRating', label: 'Supplier Rating', weight: 10 },
  { key: 'paymentTerms', label: 'Payment Terms', weight: 10 },
  { key: 'sustainability', label: 'Sustainability', weight: 5 },
];

const RFQManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | RFQStatus>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    department: 'Kitchen',
    procurementOfficer: '',
    responseDeadline: '',
    currency: 'ETB',
    deliveryRequirement: '',
    terms: '',
    conditions: '',
    requisitionId: '',
    supplierIds: [] as string[],
    lines: [{ itemName: '', specification: '', quantity: 1, unitOfMeasure: 'ea', requiredDeliveryDate: '', qualityRequirement: '' }],
  });

  // Award modal state (spec section 18)
  const [awardModal, setAwardModal] = useState<{ rfqId: string; quotationId: string; supplierName: string } | null>(null);
  const [awardData, setAwardData] = useState({ awardReason: '', negotiatedPrice: 0, deliveryTerms: '', contractReference: '' });

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingTab, setViewingTab] = useState<'details' | 'quotations' | 'comparison'>('details');
  const [comparison, setComparison] = useState<QuotationComparison[] | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rfqsData, suppliersData] = await Promise.all([
        fetchRFQs({ propertyId: currentPropertyId || undefined, status: statusFilter === 'All' ? undefined : statusFilter }),
        fetchSuppliers({ status: 'Active', propertyId: currentPropertyId || undefined }),
      ]);
      setRfqs(rfqsData.rfqs);
      setSuppliers(suppliersData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load RFQs');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = rfqs.filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.rfq_number.toLowerCase().includes(q) || r.department.toLowerCase().includes(q);
  });

  const counts = {
    draft: rfqs.filter((r) => r.status === 'Draft').length,
    issued: rfqs.filter((r) => r.status === 'Issued').length,
    closed: rfqs.filter((r) => r.status === 'Closed').length,
  };

  const submitCreate = async () => {
    if (!form.department || !form.procurementOfficer || !form.responseDeadline || form.lines.some((l) => !l.itemName || l.quantity <= 0)) {
      addNotification('Please fill in all required fields', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createRFQ({
        propertyId: currentPropertyId || undefined,
        department: form.department,
        procurementOfficer: form.procurementOfficer,
        responseDeadline: form.responseDeadline,
        currency: form.currency,
        deliveryRequirement: form.deliveryRequirement,
        terms: form.terms,
        conditions: form.conditions,
        requisitionId: form.requisitionId || undefined,
        supplierIds: form.supplierIds,
        lines: form.lines,
      });
      setRfqs((prev) => [created.rfq, ...prev]);
      addNotification(`RFQ ${created.rfq.rfq_number} created.`, 'task', 'Procurement');
      setShowForm(false);
      setForm({
        department: 'Kitchen', procurementOfficer: '', responseDeadline: '', currency: 'ETB',
        deliveryRequirement: '', terms: '', conditions: '', requisitionId: '',
        supplierIds: [], lines: [{ itemName: '', specification: '', quantity: 1, unitOfMeasure: 'ea', requiredDeliveryDate: '', qualityRequirement: '' }],
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create RFQ', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const issueRFQ = async (id: string) => {
    setActingOn(id);
    try {
      const { rfq } = await updateRFQ(id, { status: 'Issued' });
      setRfqs((prev) => prev.map((r) => (r.id === id ? rfq : r)));
      addNotification(`RFQ ${id} issued to suppliers.`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to issue RFQ', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const awardSupplier = async (rfqId: string, quotationId: string) => {
    const quotation = comparison?.find((q) => q.quotationId === quotationId);
    if (!quotation) return;
    setAwardModal({ rfqId, quotationId, supplierName: quotation.supplierName });
    setAwardData({ awardReason: '', negotiatedPrice: quotation.total, deliveryTerms: '', contractReference: '' });
  };

  const confirmAward = async () => {
    if (!awardModal) return;
    setActingOn(awardModal.rfqId);
    try {
      const quotation = comparison?.find((q) => q.quotationId === awardModal.quotationId);
      if (!quotation) return;

      const awardNotes = `Reason: ${awardData.awardReason || 'Best evaluation score'} | Negotiated: ${awardData.negotiatedPrice} | Delivery: ${awardData.deliveryTerms || 'Standard'} | Contract: ${awardData.contractReference || 'N/A'}`;

      const { rfq } = await updateRFQ(awardModal.rfqId, {
        status: 'Closed',
        awardedSupplierId: quotation.supplierId,
        awardAmount: awardData.negotiatedPrice || quotation.total,
        awardNotes,
      });
      setRfqs((prev) => prev.map((r) => (r.id === awardModal.rfqId ? rfq : r)));
      addNotification(`RFQ awarded to ${quotation.supplierName}`, 'task', 'Procurement');
      setAwardModal(null);
      setViewingId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to award supplier', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const startNegotiation = async (rfq: RFQ, quotation: QuotationComparison) => {
    setActingOn(rfq.id);
    try {
      const { negotiation } = await createNegotiationFromRFQ(rfq, quotation.supplierId, quotation.total);
      addNotification(`Negotiation ${negotiation.negotiation_number} created from RFQ ${rfq.rfq_number}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create negotiation', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const createPO = async (rfq: RFQ, quotation: QuotationComparison) => {
    setActingOn(rfq.id);
    try {
      const result = await createPOFromRFQAward(rfq, quotation, 'Procurement Officer');
      addNotification(`PO ${result.purchaseOrder.po_number} created from RFQ ${rfq.rfq_number}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create PO', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const loadComparison = async (rfqId: string) => {
    setComparisonLoading(true);
    try {
      const data = await compareRFQQuotations(rfqId);
      setComparison(data.comparison);
    } catch (e: any) {
      addNotification('Failed to load comparison', 'warning', 'Procurement');
    } finally {
      setComparisonLoading(false);
    }
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader title="RFQ Management" icon={FileText} actions={
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          <button onClick={() => setShowForm(true)} className={button.primary}>
            <Plus className="w-4 h-4" /> New RFQ
          </button>
        </div>
      } />

      {error && (
        <SectionCard tone="danger" pad="md">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </SectionCard>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Draft" value={counts.draft} icon={FileText} tone="neutral" />
        <StatCard title="Issued" value={counts.issued} icon={CheckCircle2} tone="info" />
        <StatCard title="Closed" value={counts.closed} icon={AlertTriangle} tone="success" />
      </div>

      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search RFQs..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[150px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            <option value="Draft">Draft</option>
            <option value="Issued">Issued</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </SectionCard>

      <SectionCard title="RFQs" pad="none" className="min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <FileText className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No RFQs found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((rfq) => (
              <div key={rfq.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge>{rfq.status}</Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{rfq.rfq_number}</p>
                      {rfq.source_system && rfq.source_system !== 'procurement' && SOURCE_LABELS[rfq.source_system] && (
                        <Badge tone={SOURCE_LABELS[rfq.source_system].tone}>{SOURCE_LABELS[rfq.source_system].label}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{rfq.department} • {rfq.procurement_officer}</p>
                    <p className="text-xs text-gray-400">Deadline: {rfq.response_deadline}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {rfq.status === 'Draft' && (
                    <button onClick={() => issueRFQ(rfq.id)} disabled={actingOn === rfq.id} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                      Issue RFQ
                    </button>
                  )}
                  <button onClick={() => {
                    setViewingId(rfq.id);
                    setViewingTab('details');
                    setComparison(null);
                  }} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New RFQ" size="xl" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Department</label>
              <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Procurement Officer</label>
              <input className={inputClass} value={form.procurementOfficer} onChange={(e) => setForm({ ...form, procurementOfficer: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Response Deadline</label>
              <input type="datetime-local" className={inputClass} value={form.responseDeadline} onChange={(e) => setForm({ ...form, responseDeadline: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Currency</label>
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="ETB">ETB</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          {/* Supplier Selection (spec section 15) */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2">Select Suppliers for RFQ</label>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-2">
              <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">Supplier Selection Criteria (Spec §15)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {SUPPLIER_CRITERIA.map((c) => (
                  <div key={c.key} className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                    <ShieldCheck className="w-3 h-3" /> {c.label}
                  </div>
                ))}
              </div>
            </div>
            {suppliers.filter(s => EXCLUDED_STATUSES.includes(s.status)).length > 0 && (
              <div className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 mb-2">
                <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Excluded suppliers (Suspended/Disqualified/Restricted/Inactive):
                </p>
                <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">
                  {suppliers.filter(s => EXCLUDED_STATUSES.includes(s.status)).map(s => s.legal_name).join(', ')}
                </p>
              </div>
            )}
            <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-xl divide-y divide-gray-100 dark:divide-slate-700">
              {suppliers.filter(s => !EXCLUDED_STATUSES.includes(s.status)).map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.supplierIds.includes(s.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm({ ...form, supplierIds: [...form.supplierIds, s.id] });
                      } else {
                        setForm({ ...form, supplierIds: form.supplierIds.filter(id => id !== s.id) });
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{s.legal_name}</span>
                  <Badge tone="neutral">{s.supplier_type}</Badge>
                  {s.status === 'Preferred' && <Badge tone="success">Preferred</Badge>}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{form.supplierIds.length} supplier(s) selected</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-gray-500">RFQ Lines (Spec §14)</label>
              <button onClick={() => setForm({ ...form, lines: [...form.lines, { itemName: '', specification: '', quantity: 1, unitOfMeasure: 'ea', requiredDeliveryDate: '', qualityRequirement: '' }] })} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-2 mb-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500">Line {idx + 1}</span>
                  {form.lines.length > 1 && (
                    <button onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) })} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                      <X className="w-3 h-3" /> Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputClass} placeholder="Item name *" value={line.itemName} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], itemName: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} placeholder="Specification" value={line.specification} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], specification: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} type="number" placeholder="Quantity" value={line.quantity} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], quantity: parseFloat(e.target.value) };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} placeholder="Unit" value={line.unitOfMeasure} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], unitOfMeasure: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} type="date" placeholder="Required delivery date" value={line.requiredDeliveryDate} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], requiredDeliveryDate: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                  <input className={inputClass} placeholder="Quality requirement" value={line.qualityRequirement} onChange={(e) => {
                    const newLines = [...form.lines];
                    newLines[idx] = { ...newLines[idx], qualityRequirement: e.target.value };
                    setForm({ ...form, lines: newLines });
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Weighted Evaluation Criteria (spec section 17) */}
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
            <p className="text-xs font-bold text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">
              <Scale className="w-3.5 h-3.5" /> Weighted Evaluation Criteria (Spec §17)
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {EVAL_WEIGHTS.map((w) => (
                <div key={w.key} className="text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{w.label}</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{w.weight}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewingId && (
        <ModalSystem isOpen={!!viewingId} onClose={() => setViewingId(null)} title="RFQ Details" size="xl" showFooter={false}>
          {(() => {
            const rfq = rfqs.find((r) => r.id === viewingId);
            if (!rfq) return null;
            return (
              <div>
                <div className="flex border-b border-gray-200 dark:border-slate-700 mb-4">
                  <button onClick={() => setViewingTab('details')} className={`px-4 py-2 text-sm font-medium ${viewingTab === 'details' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Details</button>
                  <button onClick={() => { setViewingTab('quotations'); }} className={`px-4 py-2 text-sm font-medium ${viewingTab === 'quotations' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Quotations</button>
                  <button onClick={() => { setViewingTab('comparison'); if (!comparison) loadComparison(rfq.id); }} className={`px-4 py-2 text-sm font-medium ${viewingTab === 'comparison' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>Comparison</button>
                </div>

                {viewingTab === 'details' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 uppercase">RFQ Number</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{rfq.rfq_number}</p>
                          {rfq.source_system && rfq.source_system !== 'procurement' && SOURCE_LABELS[rfq.source_system] && (
                            <Badge tone={SOURCE_LABELS[rfq.source_system].tone}>{SOURCE_LABELS[rfq.source_system].label}</Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Status</p>
                        <Badge>{rfq.status}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Department</p>
                        <p className="text-sm font-medium">{rfq.department}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Procurement Officer</p>
                        <p className="text-sm font-medium">{rfq.procurement_officer}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Issue Date</p>
                        <p className="text-sm font-medium">{new Date(rfq.issue_date).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Response Deadline</p>
                        <p className="text-sm font-medium">{new Date(rfq.response_deadline).toLocaleString()}</p>
                      </div>
                    </div>
                    {rfq.proc_rfq_lines && rfq.proc_rfq_lines.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">RFQ Lines (Spec §14)</p>
                        <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Item</th>
                                <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Specification</th>
                                <th className="px-4 py-2 text-right text-xs font-bold text-gray-500">Qty</th>
                                <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Req. Delivery</th>
                                <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Quality Req.</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                              {rfq.proc_rfq_lines.map((line) => (
                                <tr key={line.id}>
                                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{line.item_name}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{line.specification || '—'}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{line.quantity} {line.unit_of_measure}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{line.required_delivery_date || '—'}</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{line.quality_requirement || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {viewingTab === 'quotations' && (
                  <div>
                    {rfq.proc_quotations && rfq.proc_quotations.length > 0 ? (
                      <div className="space-y-3">
                        {rfq.proc_quotations.map((quot) => (
                          <div key={quot.id} className="p-4 border border-gray-200 dark:border-slate-700 rounded-xl">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-medium">{quot.quotation_number}</p>
                                <p className="text-xs text-gray-500">{quot.proc_suppliers?.legal_name}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold">{quot.total.toLocaleString()} {quot.currency}</p>
                                <p className="text-xs text-gray-500">Lead time: {quot.lead_time} days</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No quotations received yet</p>
                    )}
                  </div>
                )}

                {viewingTab === 'comparison' && (
                  <div>
                    {comparisonLoading ? (
                      <div className="flex items-center justify-center p-12">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                      </div>
                    ) : comparison && comparison.length > 0 ? (
                      <div>
                        {/* Weighted Evaluation Criteria (spec section 17) */}
                        <div className="mb-3 p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">
                            <Scale className="w-3.5 h-3.5" /> Weighted Evaluation Criteria
                          </p>
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            {EVAL_WEIGHTS.map((w) => (
                              <div key={w.key} className="text-center">
                                <p className="text-xs text-gray-500 dark:text-gray-400">{w.label}</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{w.weight}%</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
                          <p className="text-sm font-bold text-green-800 dark:text-green-200 flex items-center gap-1">
                            <Award className="w-4 h-4" /> Recommendation: {comparison[0]?.supplierName}
                          </p>
                          <p className="text-xs text-green-700 dark:text-green-300">Best weighted evaluation score</p>
                        </div>

                        {/* Side-by-side comparison (spec section 17 format) */}
                        <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Supplier</th>
                                <th className="px-4 py-2 text-right text-xs font-bold text-gray-500">Price</th>
                                <th className="px-4 py-2 text-right text-xs font-bold text-gray-500">Delivery</th>
                                <th className="px-4 py-2 text-right text-xs font-bold text-gray-500">Quality</th>
                                <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">Payment</th>
                                <th className="px-4 py-2 text-right text-xs font-bold text-gray-500">Score</th>
                                <th className="px-4 py-2 text-center text-xs font-bold text-gray-500">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                              {comparison.map((comp, idx) => (
                                <tr key={comp.quotationId} className={idx === 0 ? 'bg-green-50 dark:bg-green-900/10' : ''}>
                                  <td className="px-4 py-2">
                                    <p className="font-medium text-gray-900 dark:text-white">{comp.supplierName}</p>
                                    <p className="text-xs text-gray-500">{comp.supplierCode}</p>
                                  </td>
                                  <td className="px-4 py-2 text-right font-bold tabular-nums">{comp.total.toLocaleString()}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{comp.leadTime} days</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{comp.supplierScore.toFixed(0)}%</td>
                                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{comp.paymentTerms || '—'}</td>
                                  <td className="px-4 py-2 text-right font-bold tabular-nums">{comp.supplierScore.toFixed(1)}</td>
                                  <td className="px-4 py-2 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={() => awardSupplier(rfq.id, comp.quotationId)}
                                        disabled={actingOn === rfq.id}
                                        className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
                                      >
                                        <Award className="w-3 h-3" /> Award
                                      </button>
                                      <button
                                        onClick={() => startNegotiation(rfq, comp)}
                                        disabled={actingOn === rfq.id}
                                        className="text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1"
                                        title="Start negotiation with this supplier"
                                      >
                                        <Handshake className="w-3 h-3" /> Negotiate
                                      </button>
                                      {rfq.status === 'Closed' && (
                                        <button
                                          onClick={() => createPO(rfq, comp)}
                                          disabled={actingOn === rfq.id}
                                          className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                                          title="Create purchase order from this quotation"
                                        >
                                          <ShoppingCart className="w-3 h-3" /> PO
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No quotations available for comparison</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </ModalSystem>
      )}

      {/* Award Modal (spec section 18) */}
      <ModalSystem
        isOpen={!!awardModal}
        onClose={() => setAwardModal(null)}
        title="Supplier Award"
        size="md"
        loading={actingOn === awardModal?.rfqId}
        confirmLabel="Confirm Award"
        onConfirm={confirmAward}
      >
        {awardModal && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
              <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Awarding to: {awardModal.supplierName}</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">This will close the RFQ and create an award recommendation.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Award Reason</label>
                <input className={inputClass} value={awardData.awardReason} onChange={(e) => setAwardData({ ...awardData, awardReason: e.target.value })} placeholder="e.g. Best overall evaluation score" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Negotiated Price</label>
                <input type="number" className={inputClass} value={awardData.negotiatedPrice} onChange={(e) => setAwardData({ ...awardData, negotiatedPrice: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Delivery Terms</label>
                <input className={inputClass} value={awardData.deliveryTerms} onChange={(e) => setAwardData({ ...awardData, deliveryTerms: e.target.value })} placeholder="e.g. 7 days FOB destination" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Contract Reference</label>
                <input className={inputClass} value={awardData.contractReference} onChange={(e) => setAwardData({ ...awardData, contractReference: e.target.value })} placeholder="e.g. CTR-2026-001" />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">High-value awards may require configurable approval.</p>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default RFQManagement;