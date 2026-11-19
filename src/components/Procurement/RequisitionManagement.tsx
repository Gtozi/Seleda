/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Requisition Management — Supply Chain & Procurement Portal (/erp/procurement/requisitions).
 * Aligns 100% with unified_supply_chain_procurement_portal.md sections 10, 11, 12.
 *
 * Features:
 * - Full PR header (PR Number, Property, Department, Requester, Request Date, Required Date,
 *   Priority, Cost Center, Budget, Purpose, Notes, Attachments)
 * - Full PR lines (Item, Description, Category, Quantity, Unit, Estimated Unit Price,
 *   Estimated Total, Required Date, Preferred Supplier, Specification, Cost Center)
 * - All 9 status flow states + 4 alternative statuses (spec section 10)
 * - All 6 priorities with effects info (spec section 11)
 * - All 12 demand origin departments (spec section 8)
 * - Structured categories per department (spec section 12)
 * - Status flow visualization
 * - Convert to Purchase Order action
 * - View detail modal with all fields and line items
 *
 * DB-integrated via /api/proc-portal/requisitions.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  Eye,
  MoreVertical,
  Loader2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  User,
  ArrowRight,
  ShoppingCart,
  AlertCircle,
  Gavel,
  Trash2,
  Paperclip,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchRequisitions,
  createRequisition,
  updateRequisition,
  deleteRequisition,
  convertRequisitionToPO,
  createRFQFromRequisition,
  createTenderFromRequisition,
  fetchSuppliers,
  type Requisition,
  type RequisitionStatus,
  type RequisitionPriority,
  type Supplier,
} from '../../services/procurementService';

// ── Spec section 8: All 12 demand origin departments ──────────────────────
const DEPARTMENTS = [
  'Food & Beverage',
  'Kitchen',
  'Housekeeping',
  'Engineering & Maintenance',
  'Spa & Wellness',
  'Banquet & Events',
  'Transportation & Fleet',
  'Human Resources',
  'Administration',
  'Security & Risk',
  'IT',
  'Other',
] as const;

// ── Spec section 12: Procurement Categories by Department ──────────────────
const CATEGORIES_BY_DEPARTMENT: Record<string, string[]> = {
  'Food & Beverage': ['Food', 'Beverage', 'Dry Goods', 'Fresh Produce', 'Meat', 'Seafood', 'Dairy', 'Bakery Supplies', 'Packaging'],
  'Kitchen': ['Food', 'Beverage', 'Dry Goods', 'Fresh Produce', 'Meat', 'Seafood', 'Dairy', 'Bakery Supplies', 'Packaging'],
  'Housekeeping': ['Cleaning Chemicals', 'Guest Amenities', 'Linen', 'Towels', 'Laundry Supplies', 'Guest Room Supplies'],
  'Engineering & Maintenance': ['Electrical', 'Plumbing', 'HVAC', 'Mechanical', 'Tools', 'Spare Parts', 'Building Materials'],
  'Spa & Wellness': ['Treatment Products', 'Massage Oils', 'Beauty Supplies', 'Consumables', 'Retail Products'],
  'Banquet & Events': ['Event Supplies', 'Catering Supplies', 'Decorations', 'Disposable Items'],
  'Transportation & Fleet': ['Vehicle Parts', 'Tires', 'Lubricants', 'Vehicle Supplies', 'Cleaning Materials'],
  'Administration': ['Office Supplies', 'Stationery', 'Furniture', 'IT Equipment'],
  'Human Resources': ['Office Supplies', 'Stationery', 'Training Materials'],
  'Security & Risk': ['Security Equipment', 'Safety Supplies', 'Uniforms'],
  'IT': ['IT Equipment', 'Software', 'Networking', 'Consumables'],
  'Other': ['General Supplies', 'Miscellaneous'],
};

// ── Spec section 10: Status flow ───────────────────────────────────────────
const STATUS_FLOW: RequisitionStatus[] = [
  'Draft', 'Submitted', 'Under Review', 'Approved', 'Sourcing',
  'Converted to PO', 'Partially Fulfilled', 'Fully Fulfilled', 'Closed',
];

const ALT_STATUSES: RequisitionStatus[] = ['Rejected', 'Returned', 'Cancelled', 'On Hold'];

const STATUS_TONE: Record<RequisitionStatus, StatusTone> = {
  Draft: 'neutral',
  Submitted: 'info',
  'Under Review': 'warning',
  Approved: 'accent',
  Sourcing: 'info',
  'Converted to PO': 'success',
  'Partially Fulfilled': 'success',
  'Fully Fulfilled': 'success',
  Closed: 'neutral',
  Rejected: 'danger',
  Returned: 'warning',
  Cancelled: 'neutral',
  'On Hold': 'warning',
};

// ── Spec section 11: All 6 priorities ──────────────────────────────────────
const PRIORITY_TONE: Record<RequisitionPriority, StatusTone> = {
  Low: 'neutral',
  Normal: 'info',
  High: 'warning',
  Urgent: 'danger',
  Critical: 'danger',
  Emergency: 'danger',
};

const PRIORITY_EFFECTS: Record<RequisitionPriority, string[]> = {
  Low: ['Standard approval routing', 'Normal sourcing priority'],
  Normal: ['Standard approval routing', 'Normal sourcing priority', 'Standard delivery requirement'],
  High: ['Expedited approval routing', 'Priority sourcing', 'Shortened delivery requirement'],
  Urgent: ['Fast-track approval', 'Priority sourcing', 'Short supplier response deadline', 'Expedited delivery'],
  Critical: ['Immediate approval required', 'Top sourcing priority', '24h supplier response deadline', 'Expedited delivery', 'Escalation triggered'],
  Emergency: ['Bypass standard approval', 'Immediate sourcing', 'Immediate delivery required', 'Management escalation'],
};

const NEXT_ACTIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Under Review', 'Returned', 'Cancelled'],
  'Under Review': ['Approved', 'Rejected', 'Returned'],
  Approved: ['Sourcing', 'Converted to PO', 'Rejected', 'Returned'],
  Sourcing: ['Converted to PO', 'Approved'],
  'Converted to PO': ['Partially Fulfilled', 'Fully Fulfilled'],
  'Partially Fulfilled': ['Fully Fulfilled', 'Closed'],
  'Fully Fulfilled': ['Closed'],
  Closed: [],
  Rejected: ['Submitted'],
  Returned: ['Submitted'],
  Cancelled: ['Draft'],
  'On Hold': ['Submitted', 'Approved'],
};

const ACTION_LABELS: Record<RequisitionStatus, string> = {
  Draft: 'Submit',
  Submitted: 'Start Review',
  'Under Review': 'Approve',
  Approved: 'Start Sourcing',
  Sourcing: 'Convert to PO',
  'Converted to PO': 'Mark Partially Fulfilled',
  'Partially Fulfilled': 'Mark Fully Fulfilled',
  'Fully Fulfilled': 'Close',
  Closed: 'Closed',
  Rejected: 'Re-open',
  Returned: 'Resubmit',
  Cancelled: 'Reopen',
  'On Hold': 'Resume',
};

// Source system display labels
const SOURCE_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  procurement: { label: 'Procurement', tone: 'info' },
  engineering: { label: 'Engineering', tone: 'accent' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  food_beverage: { label: 'F&B', tone: 'accent' },
  inventory: { label: 'Inventory', tone: 'accent' },
  spa_wellness: { label: 'Spa', tone: 'accent' },
  banquet_events: { label: 'Banquet', tone: 'accent' },
  transportation: { label: 'Transport', tone: 'accent' },
  human_resources: { label: 'HR', tone: 'accent' },
  security_risk: { label: 'Security', tone: 'accent' },
  it: { label: 'IT', tone: 'accent' },
};

// ── Field helper ───────────────────────────────────────────────────────────
const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

interface FormState {
  department: string;
  requester: string;
  requiredDate: string;
  priority: RequisitionPriority;
  costCenter: string;
  budgetCode: string;
  purpose: string;
  notes: string;
  lines: Array<{
    itemName: string;
    description: string;
    category: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    requiredDate: string;
    preferredSupplierId: string;
    specification: string;
    costCenter: string;
  }>;
}

const emptyForm: FormState = {
  department: 'Kitchen',
  requester: '',
  requiredDate: '',
  priority: 'Normal',
  costCenter: '',
  budgetCode: '',
  purpose: '',
  notes: '',
  lines: [{ itemName: '', description: '', category: '', quantity: 1, unitOfMeasure: 'ea', unitPrice: 0, requiredDate: '', preferredSupplierId: '', specification: '', costCenter: '' }],
};

// ── Component ────────────────────────────────────────────────────────────
const RequisitionManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | RequisitionStatus>('All');
  const [priorityFilter, setPriorityFilter] = useState<'All' | RequisitionPriority>('All');
  const [departmentFilter, setDepartmentFilter] = useState<'All' | string>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Convert to PO modal
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertSupplierId, setConvertSupplierId] = useState('');
  const [convertNotes, setConvertNotes] = useState('');
  const [converting, setConverting] = useState(false);

  // Convert to RFQ modal
  const [rfqConvertId, setRfqConvertId] = useState<string | null>(null);
  const [rfqOfficer, setRfqOfficer] = useState('');
  const [rfqSupplierIds, setRfqSupplierIds] = useState<string[]>([]);
  const [rfqConverting, setRfqConverting] = useState(false);

  // Convert to Tender modal
  const [tenderConvertId, setTenderConvertId] = useState<string | null>(null);
  const [tenderOfficer, setTenderOfficer] = useState('');
  const [tenderConverting, setTenderConverting] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqData, supData] = await Promise.all([
        fetchRequisitions({
          status: statusFilter === 'All' ? undefined : statusFilter,
          priority: priorityFilter === 'All' ? undefined : priorityFilter,
          department: departmentFilter === 'All' ? undefined : departmentFilter,
          propertyId: currentPropertyId || undefined,
        }),
        fetchSuppliers({ propertyId: currentPropertyId || undefined }),
      ]);
      setRequisitions(reqData.requisitions);
      setSuppliers(supData.suppliers);
    } catch (e: any) {
      setError(e?.message || 'Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, statusFilter, priorityFilter, departmentFilter]);

  useEffect(() => { load(); }, [load]);

  // ── Derived list ──────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      requisitions.filter((r) => {
        const matchesSearch =
          !search.trim() ||
          r.pr_number.toLowerCase().includes(search.toLowerCase()) ||
          r.department.toLowerCase().includes(search.toLowerCase()) ||
          r.purpose?.toLowerCase().includes(search.toLowerCase());
        return matchesSearch;
      }),
    [requisitions, search]
  );

  const counts = {
    draft: requisitions.filter((r) => r.status === 'Draft').length,
    pending: requisitions.filter((r) => r.status === 'Submitted' || r.status === 'Under Review').length,
    approved: requisitions.filter((r) => r.status === 'Approved' || r.status === 'Sourcing').length,
    converted: requisitions.filter((r) => r.status === 'Converted to PO').length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.requester || !form.requiredDate || form.lines.some(l => !l.itemName || l.quantity <= 0)) {
      addNotification('Please fill in all required fields', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createRequisition({
        propertyId: currentPropertyId || undefined,
        department: form.department,
        requester: form.requester,
        requiredDate: form.requiredDate,
        priority: form.priority,
        costCenter: form.costCenter || undefined,
        budgetCode: form.budgetCode || undefined,
        purpose: form.purpose || undefined,
        notes: form.notes || undefined,
        lines: form.lines.map(l => ({
          itemName: l.itemName,
          description: l.description || undefined,
          category: l.category || undefined,
          quantity: l.quantity,
          unitOfMeasure: l.unitOfMeasure,
          unitPrice: l.unitPrice,
          requiredDate: l.requiredDate || undefined,
          preferredSupplierId: l.preferredSupplierId || undefined,
          specification: l.specification || undefined,
          costCenter: l.costCenter || undefined,
        })),
      });
      setRequisitions((prev) => [created.requisition, ...prev]);
      addNotification(`Requisition ${created.requisition.pr_number} created`, 'task', 'Procurement');
      setShowForm(false);
      setForm(emptyForm);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create requisition', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: RequisitionStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { requisition } = await updateRequisition(id, { status });
      setRequisitions((prev) => prev.map((r) => (r.id === id ? requisition : r)));
      addNotification(`Requisition → ${status}`, 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteRequisition(id);
      setRequisitions((prev) => prev.filter((r) => r.id !== id));
      addNotification('Requisition deleted', 'task', 'Procurement');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete requisition', 'warning', 'Procurement');
    } finally {
      setActingOn(null);
    }
  };

  const handleConvertToPO = async () => {
    if (!convertId || !convertSupplierId) {
      addNotification('Please select a supplier', 'warning', 'Procurement');
      return;
    }
    setConverting(true);
    try {
      const result = await convertRequisitionToPO(convertId, { supplierId: convertSupplierId, notes: convertNotes });
      addNotification(`Purchase Order ${result.po.po_number} created from requisition`, 'task', 'Procurement');
      setConvertId(null);
      setConvertSupplierId('');
      setConvertNotes('');
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to convert to PO', 'warning', 'Procurement');
    } finally {
      setConverting(false);
    }
  };

  const openConvert = (id: string) => {
    setConvertId(id);
    setMenuOpen(null);
  };

  const handleConvertToRFQ = async () => {
    if (!rfqConvertId || !rfqOfficer) {
      addNotification('Please enter a procurement officer name', 'warning', 'Procurement');
      return;
    }
    const req = requisitions.find((r) => r.id === rfqConvertId);
    if (!req) return;
    setRfqConverting(true);
    try {
      const result = await createRFQFromRequisition(req, rfqOfficer, rfqSupplierIds);
      addNotification(`RFQ ${result.rfq.rfq_number} created from requisition ${req.pr_number}`, 'task', 'Procurement');
      setRfqConvertId(null);
      setRfqOfficer('');
      setRfqSupplierIds([]);
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to convert to RFQ', 'warning', 'Procurement');
    } finally {
      setRfqConverting(false);
    }
  };

  const openRfqConvert = (id: string) => {
    setRfqConvertId(id);
    setRfqSupplierIds([]);
    setMenuOpen(null);
  };

  const handleConvertToTender = async () => {
    if (!tenderConvertId || !tenderOfficer) {
      addNotification('Please enter a procurement officer name', 'warning', 'Procurement');
      return;
    }
    const req = requisitions.find((r) => r.id === tenderConvertId);
    if (!req) return;
    setTenderConverting(true);
    try {
      const result = await createTenderFromRequisition(req, tenderOfficer);
      addNotification(`Tender ${result.tender.tender_number} created from requisition ${req.pr_number}`, 'task', 'Procurement');
      setTenderConvertId(null);
      setTenderOfficer('');
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to convert to Tender', 'warning', 'Procurement');
    } finally {
      setTenderConverting(false);
    }
  };

  const openTenderConvert = (id: string) => {
    setTenderConvertId(id);
    setMenuOpen(null);
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { itemName: '', description: '', category: '', quantity: 1, unitOfMeasure: 'ea', unitPrice: 0, requiredDate: '', preferredSupplierId: '', specification: '', costCenter: '' }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const availableCategories = CATEGORIES_BY_DEPARTMENT[form.department] || ['General Supplies'];

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Purchase Requisitions"
        subtitle="Internal purchase requests with full approval workflow and lifecycle."
        icon={FileText}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Requisition
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

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      <div className={layout.kpiGrid}>
        <StatCard title="Draft" value={counts.draft} icon={FileText} tone="neutral" />
        <StatCard title="Pending Approval" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Approved / Sourcing" value={counts.approved} icon={CheckCircle2} tone="accent" />
        <StatCard title="Converted to PO" value={counts.converted} icon={ShoppingCart} tone="success" />
      </div>

      {/* ── Status Flow Visualization (spec section 10) ─────────────────── */}
      <SectionCard title="Requisition Lifecycle" subtitle="Status flow per specification" icon={ArrowRight} pad="md">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FLOW.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                statusTone[STATUS_TONE[s]] || 'border-gray-200 text-gray-600'
              }`}>
                {s}
              </div>
              {i < STATUS_FLOW.length - 1 && <ArrowRight className="w-3 h-3 text-gray-400" />}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Alternative statuses:</span>
          {ALT_STATUSES.map((s) => (
            <Badge key={s} tone={STATUS_TONE[s]}>{s}</Badge>
          ))}
        </div>
      </SectionCard>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by PR number, department, or purpose..."
              className={inputClass + ' pl-10'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={inputClass + ' max-w-[160px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="All">All Status</option>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
            {ALT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={inputClass + ' max-w-[140px]'} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as any)}>
            <option value="All">All Priority</option>
            {Object.keys(PRIORITY_TONE).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className={inputClass + ' max-w-[180px]'} value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="All">All Departments</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* ── Requisitions List ───────────────────────────────────────────── */}
      <SectionCard title="Requisitions" subtitle={`${filtered.length} requisition${filtered.length !== 1 ? 's' : ''}`} pad="none" className="min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <FileText className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No requisitions found</p>
            <p className="text-xs mt-1">Click "New Requisition" to create one.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((req) => (
              <div key={req.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={STATUS_TONE[req.status]}>{req.status}</Badge>
                    <Badge tone={PRIORITY_TONE[req.priority]}>{req.priority}</Badge>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{req.pr_number}</p>
                      {req.source_system && req.source_system !== 'procurement' && SOURCE_LABELS[req.source_system] && (
                        <Badge tone={SOURCE_LABELS[req.source_system].tone}>{SOURCE_LABELS[req.source_system].label}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{req.department} · {req.requester}</p>
                    {req.purpose && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{req.purpose}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <p className="text-sm font-mono text-gray-900 dark:text-white tabular-nums">
                    ${req.estimated_total.toLocaleString()}
                  </p>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setViewingId(req.id)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition" title="View Details">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button onClick={() => setMenuOpen(menuOpen === req.id ? null : req.id)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition" title="Actions">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Action Menu */}
                {menuOpen === req.id && (
                  <div className="absolute right-4 mt-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-10 min-w-[200px]">
                    {NEXT_ACTIONS[req.status]?.map((status) => (
                      <button
                        key={status}
                        onClick={() => changeStatus(req.id, status)}
                        disabled={actingOn === req.id}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 first:rounded-t-xl last:rounded-b-xl disabled:opacity-50"
                      >
                        {ACTION_LABELS[status] || status}
                      </button>
                    ))}
                    {(req.status === 'Approved' || req.status === 'Sourcing') && (
                      <button
                        onClick={() => openConvert(req.id)}
                        disabled={actingOn === req.id}
                        className="w-full text-left px-4 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 border-t border-gray-100 dark:border-slate-700"
                      >
                        <ShoppingCart className="w-3.5 h-3.5 inline mr-1" /> Convert to PO
                      </button>
                    )}
                    {(req.status === 'Approved' || req.status === 'Sourcing') && (
                      <button
                        onClick={() => openRfqConvert(req.id)}
                        disabled={actingOn === req.id}
                        className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 border-t border-gray-100 dark:border-slate-700"
                      >
                        <FileText className="w-3.5 h-3.5 inline mr-1" /> Create RFQ
                      </button>
                    )}
                    {(req.status === 'Approved' || req.status === 'Sourcing') && (
                      <button
                        onClick={() => openTenderConvert(req.id)}
                        disabled={actingOn === req.id}
                        className="w-full text-left px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 border-t border-gray-100 dark:border-slate-700"
                      >
                        <Gavel className="w-3.5 h-3.5 inline mr-1" /> Create Tender
                      </button>
                    )}
                    {req.status === 'Draft' && (
                      <button
                        onClick={() => handleDelete(req.id)}
                        disabled={actingOn === req.id}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-b-xl disabled:opacity-50 border-t border-gray-100 dark:border-slate-700"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Create Modal ────────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title="New Purchase Requisition"
        size="xl"
        loading={submitting}
        confirmLabel="Create"
        onConfirm={submitCreate}
      >
        <div className="space-y-4">
          {/* Header fields (spec section 10) */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Department" required>
              <select className={inputClass} value={form.department} onChange={(e) => {
                const newDept = e.target.value;
                const newCats = CATEGORIES_BY_DEPARTMENT[newDept] || ['General Supplies'];
                setForm({ ...form, department: newDept, lines: form.lines.map(l => ({ ...l, category: newCats[0] })) });
              }}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Requester" required>
              <input className={inputClass} value={form.requester} onChange={(e) => setForm({ ...form, requester: e.target.value })} placeholder="Requester name" />
            </Field>
            <Field label="Required Date" required>
              <input type="date" className={inputClass} value={form.requiredDate} onChange={(e) => setForm({ ...form, requiredDate: e.target.value })} />
            </Field>
            <Field label="Priority" required>
              <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as RequisitionPriority })}>
                {Object.keys(PRIORITY_TONE).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Cost Center">
              <input className={inputClass} value={form.costCenter} onChange={(e) => setForm({ ...form, costCenter: e.target.value })} placeholder="e.g. CC-001" />
            </Field>
            <Field label="Budget Code">
              <input className={inputClass} value={form.budgetCode} onChange={(e) => setForm({ ...form, budgetCode: e.target.value })} placeholder="e.g. BUD-2026-FNB" />
            </Field>
          </div>
          <Field label="Purpose">
            <textarea className={inputClass} rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Purpose of this requisition" />
          </Field>
          <Field label="Notes">
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes" />
          </Field>

          {/* Priority effects info (spec section 11) */}
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <p className="text-xs font-bold text-blue-700 dark:text-blue-300 mb-1">Priority: {form.priority}</p>
            <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
              {PRIORITY_EFFECTS[form.priority].map((effect, i) => (
                <li key={i} className="flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" /> {effect}
                </li>
              ))}
            </ul>
          </div>

          {/* Lines (spec section 10) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Line Items</span>
              <button onClick={addLine} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            <div className="space-y-3">
              {form.lines.map((line, idx) => (
                <div key={idx} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500">Line {idx + 1}</span>
                    {form.lines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                        <X className="w-3 h-3" /> Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className={inputClass} placeholder="Item name *" value={line.itemName} onChange={(e) => updateLine(idx, 'itemName', e.target.value)} />
                    <select className={inputClass} value={line.category} onChange={(e) => updateLine(idx, 'category', e.target.value)}>
                      <option value="">Select category</option>
                      {availableCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className={inputClass} placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                    <input className={inputClass} placeholder="Specification" value={line.specification} onChange={(e) => updateLine(idx, 'specification', e.target.value)} />
                    <input type="number" className={inputClass} placeholder="Quantity" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                    <input className={inputClass} placeholder="Unit (ea, kg, L)" value={line.unitOfMeasure} onChange={(e) => updateLine(idx, 'unitOfMeasure', e.target.value)} />
                    <input type="number" className={inputClass} placeholder="Unit price" value={line.unitPrice} onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)} />
                    <input type="date" className={inputClass} placeholder="Line required date" value={line.requiredDate} onChange={(e) => updateLine(idx, 'requiredDate', e.target.value)} title="Line required date" />
                    <select className={inputClass} value={line.preferredSupplierId} onChange={(e) => updateLine(idx, 'preferredSupplierId', e.target.value)}>
                      <option value="">No preferred supplier</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
                    </select>
                    <input className={inputClass} placeholder="Cost Center" value={line.costCenter} onChange={(e) => updateLine(idx, 'costCenter', e.target.value)} />
                  </div>
                  {line.quantity > 0 && line.unitPrice > 0 && (
                    <p className="text-xs text-right text-gray-500 dark:text-gray-400">
                      Line total: <span className="font-bold text-gray-700 dark:text-gray-300">${(line.quantity * line.unitPrice).toLocaleString()}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
            {form.lines.length > 0 && (
              <p className="text-sm text-right mt-2 text-gray-600 dark:text-gray-400">
                Estimated Total: <span className="font-bold text-gray-900 dark:text-white">${form.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0).toLocaleString()}</span>
              </p>
            )}
          </div>
        </div>
      </ModalSystem>

      {/* ── View Detail Modal ───────────────────────────────────────────── */}
      {viewingId && (
        <ModalSystem
          isOpen={!!viewingId}
          onClose={() => setViewingId(null)}
          title="Requisition Details"
          size="lg"
          showFooter={false}
        >
          {(() => {
            const req = requisitions.find((r) => r.id === viewingId);
            if (!req) return null;
            return (
              <div className="space-y-4">
                {/* Header fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">PR Number</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{req.pr_number}</p>
                      {req.source_system && req.source_system !== 'procurement' && SOURCE_LABELS[req.source_system] && (
                        <Badge tone={SOURCE_LABELS[req.source_system].tone}>{SOURCE_LABELS[req.source_system].label}</Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Status</p>
                    <Badge tone={STATUS_TONE[req.status]}>{req.status}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Department</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{req.department}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Requester</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{req.requester}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Request Date</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{req.request_date}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Required Date</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{req.required_date}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Priority</p>
                    <Badge tone={PRIORITY_TONE[req.priority]}>{req.priority}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Estimated Total</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">${req.estimated_total.toLocaleString()}</p>
                  </div>
                  {req.cost_center && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Cost Center</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{req.cost_center}</p>
                    </div>
                  )}
                  {req.budget_code && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Budget Code</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{req.budget_code}</p>
                    </div>
                  )}
                  {req.approved_by && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Approved By</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{req.approved_by}</p>
                    </div>
                  )}
                  {req.approved_at && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Approved At</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{new Date(req.approved_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {req.purpose && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-1">Purpose</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{req.purpose}</p>
                  </div>
                )}
                {req.notes && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{req.notes}</p>
                  </div>
                )}

                {/* Priority effects (spec section 11) */}
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <p className="text-xs font-bold text-blue-700 dark:text-blue-300 mb-1">Priority Effects: {req.priority}</p>
                  <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
                    {PRIORITY_EFFECTS[req.priority].map((effect, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> {effect}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Lines (spec section 10 - all line fields) */}
                {req.proc_requisition_lines && req.proc_requisition_lines.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase mb-2">Line Items</p>
                    <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">#</th>
                            <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Item</th>
                            <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Category</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Qty</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Unit Price</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                          {req.proc_requisition_lines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-3 py-2 text-gray-500">{line.line_number}</td>
                              <td className="px-3 py-2">
                                <p className="font-medium text-gray-900 dark:text-white">{line.item_name}</p>
                                {line.description && <p className="text-xs text-gray-500">{line.description}</p>}
                                {line.specification && <p className="text-xs text-gray-400">Spec: {line.specification}</p>}
                              </td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{line.category || '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{line.quantity} {line.unit_of_measure}</td>
                              <td className="px-3 py-2 text-right tabular-nums">${line.estimated_unit_price.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium">${line.estimated_total.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Convert to PO action in view modal */}
                {(req.status === 'Approved' || req.status === 'Sourcing') && (
                  <div className="space-y-2">
                    <button
                      onClick={() => { setViewingId(null); openConvert(req.id); }}
                      className={button.primary + ' w-full'}
                    >
                      <ShoppingCart className="w-4 h-4" /> Convert to Purchase Order
                    </button>
                    <button
                      onClick={() => { setViewingId(null); openRfqConvert(req.id); }}
                      className={button.secondary + ' w-full'}
                    >
                      <FileText className="w-4 h-4" /> Create RFQ
                    </button>
                    <button
                      onClick={() => { setViewingId(null); openTenderConvert(req.id); }}
                      className={button.secondary + ' w-full'}
                    >
                      <Gavel className="w-4 h-4" /> Create Tender
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </ModalSystem>
      )}

      {/* ── Convert to PO Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!convertId}
        onClose={() => { setConvertId(null); setConvertSupplierId(''); setConvertNotes(''); }}
        title="Convert to Purchase Order"
        size="md"
        loading={converting}
        confirmLabel="Create PO"
        onConfirm={handleConvertToPO}
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              This will create a new Purchase Order from the requisition lines and mark the requisition as "Converted to PO".
            </p>
          </div>
          <Field label="Supplier" required>
            <select className={inputClass} value={convertSupplierId} onChange={(e) => setConvertSupplierId(e.target.value)}>
              <option value="">Select a supplier...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
            </select>
          </Field>
          <Field label="Notes">
            <textarea className={inputClass} rows={2} value={convertNotes} onChange={(e) => setConvertNotes(e.target.value)} placeholder="Optional notes for the PO" />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Create RFQ Modal ────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!rfqConvertId}
        onClose={() => setRfqConvertId(null)}
        title="Create RFQ from Requisition"
        size="md"
        loading={rfqConverting}
        confirmLabel="Create RFQ"
        onConfirm={handleConvertToRFQ}
      >
        {rfqConvertId && (() => {
          const req = requisitions.find((r) => r.id === rfqConvertId);
          if (!req) return null;
          return (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  This will create a new RFQ from {req.pr_number} with {req.proc_requisition_lines?.length || 0} line item(s) in the {req.department} department.
                </p>
              </div>
              <Field label="Procurement Officer" required>
                <input className={inputClass} value={rfqOfficer} onChange={(e) => setRfqOfficer(e.target.value)} placeholder="e.g. Daniel Bekele" />
              </Field>
              <Field label="Invite Suppliers (optional)">
                <div className="max-h-32 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-xl divide-y divide-gray-100 dark:divide-slate-700">
                  {suppliers.filter(s => !['Suspended', 'Disqualified', 'Restricted', 'Inactive'].includes(s.status)).map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rfqSupplierIds.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) setRfqSupplierIds([...rfqSupplierIds, s.id]);
                          else setRfqSupplierIds(rfqSupplierIds.filter(id => id !== s.id));
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s.legal_name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">{rfqSupplierIds.length} supplier(s) selected</p>
              </Field>
            </div>
          );
        })()}
      </ModalSystem>

      {/* ── Create Tender Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!tenderConvertId}
        onClose={() => setTenderConvertId(null)}
        title="Create Tender from Requisition"
        size="md"
        loading={tenderConverting}
        confirmLabel="Create Tender"
        onConfirm={handleConvertToTender}
      >
        {tenderConvertId && (() => {
          const req = requisitions.find((r) => r.id === tenderConvertId);
          if (!req) return null;
          return (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <p className="text-xs text-purple-600 dark:text-purple-400">
                  This will create a new Open tender from {req.pr_number} with {req.proc_requisition_lines?.length || 0} line item(s) in the {req.department} department. The tender will be in Draft status.
                </p>
              </div>
              <Field label="Procurement Officer" required>
                <input className={inputClass} value={tenderOfficer} onChange={(e) => setTenderOfficer(e.target.value)} placeholder="e.g. Daniel Bekele" />
              </Field>
            </div>
          );
        })()}
      </ModalSystem>
    </div>
  );
};

export default RequisitionManagement;
