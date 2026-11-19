import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FileText,
  Download,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  ShieldCheck,
  FileSpreadsheet,
  Printer,
  Send,
  BarChart3,
  ArrowDownRight,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Plus,
  X,
  MoreVertical,
  Check,
  Trash2,
  Percent,
  Palmtree,
  Edit3,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchTaxReturns,
  createTaxReturn,
  updateTaxReturn,
  deleteTaxReturn,
  fetchTaxPension,
  createTaxPension,
  updateTaxPension,
  deleteTaxPension,
  fetchTaxCustoms,
  createTaxCustoms,
  updateTaxCustoms,
  deleteTaxCustoms,
  fetchTaxAudits,
  createTaxAudit,
  updateTaxAudit,
  deleteTaxAudit,
  type TaxReturnFE,
  type TaxPensionFE,
  type TaxCustomsFE,
  type TaxAuditFE,
} from '../../services/financePortalService';

type TabKey = 'vat' | 'withholding' | 'tot' | 'excise' | 'paye' | 'pension' | 'customs' | 'local' | 'audit' | 'sales_tax' | 'tourism_levy' | 'service_charge' | 'adjustments';

const TABS: { id: TabKey; label: string; icon: typeof FileText }[] = [
  { id: 'vat', label: 'VAT', icon: Percent },
  { id: 'withholding', label: 'Withholding', icon: FileText },
  { id: 'tot', label: 'TOT', icon: BarChart3 },
  { id: 'excise', label: 'Excise', icon: ShieldCheck },
  { id: 'paye', label: 'PAYE', icon: DollarSign },
  { id: 'pension', label: 'Pension', icon: CheckCircle2 },
  { id: 'customs', label: 'Customs Duty', icon: Download },
  { id: 'local', label: 'Local Taxes', icon: FileSpreadsheet },
  { id: 'audit', label: 'Tax Audit', icon: ShieldCheck },
  { id: 'sales_tax', label: 'Sales Tax', icon: Send },
  { id: 'tourism_levy', label: 'Tourism Levy', icon: Palmtree },
  { id: 'service_charge', label: 'Service Charge', icon: Percent },
  { id: 'adjustments', label: 'Tax Adjustments', icon: Edit3 },
];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Pending: 'warning',
  Filed: 'success',
  Paid: 'success',
  Draft: 'neutral',
  Cancelled: 'danger',
  Remitted: 'success',
  Cleared: 'success',
  Open: 'danger',
  'In Progress': 'warning',
  Resolved: 'success',
  Closed: 'neutral',
};

const RISK_COLORS: Record<string, 'success' | 'warning' | 'danger'> = {
  Low: 'success',
  Medium: 'warning',
  High: 'danger',
};

const TAX_TYPES = ['VAT', 'WHT', 'TOT', 'PAYE', 'Sales Tax', 'Local', 'Tourism Levy', 'Service Charge', 'Adjustment'];
const LOCAL_TAX_TYPES = ['Municipal Tax', 'Service Tax', 'Property Tax'];
const JURISDICTIONS = ['City of Addis Ababa', 'Bole Subcity', 'Kirkos Subcity', 'Arada Subcity'];
const AUDIT_CATEGORIES = ['VAT Compliance', 'Withholding Tax', 'PAYE Reporting', 'TOT Filing', 'Customs Duty', 'Sales Tax'];

const TaxCompliance = () => {
  const { formatAmount, addNotification, currentPropertyId } = useERP();
  const [activeTab, setActiveTab] = useState<TabKey>('vat');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Data
  const [returns, setReturns] = useState<TaxReturnFE[]>([]);
  const [pension, setPension] = useState<TaxPensionFE[]>([]);
  const [customs, setCustoms] = useState<TaxCustomsFE[]>([]);
  const [audits, setAudits] = useState<TaxAuditFE[]>([]);

  // Modals
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showLocalModal, setShowLocalModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showPensionModal, setShowPensionModal] = useState(false);
  const [showCustomsModal, setShowCustomsModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [returnForm, setReturnForm] = useState({ taxType: 'VAT', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 0, metadata: {} as Record<string, any> });
  const [localForm, setLocalForm] = useState({ taxType: 'Municipal Tax', jurisdiction: 'City of Addis Ababa', period: '', dueDate: '', amount: 0 });
  const [adjustmentForm, setAdjustmentForm] = useState({ taxType: 'VAT', period: '', dueDate: '', originalAmount: 0, adjustmentAmount: 0, reason: '' });
  const [pensionForm, setPensionForm] = useState({ period: '', employeeAmount: 0, employerAmount: 0 });
  const [customsForm, setCustomsForm] = useState({ itemDescription: '', cifValue: 0, dutyRate: '15%', dutyPaid: 0, declarationDate: '' });
  const [auditForm, setAuditForm] = useState({ category: 'VAT Compliance', description: '', riskLevel: 'Medium', dueDate: '' });

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [r, p, c, a] = await Promise.all([
        fetchTaxReturns({ propertyId: pid }).catch(() => [] as TaxReturnFE[]),
        fetchTaxPension({ propertyId: pid }).catch(() => [] as TaxPensionFE[]),
        fetchTaxCustoms({ propertyId: pid }).catch(() => [] as TaxCustomsFE[]),
        fetchTaxAudits({ propertyId: pid }).catch(() => [] as TaxAuditFE[]),
      ]);
      setReturns(r);
      setPension(p);
      setCustoms(c);
      setAudits(a);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tax data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const vatReturns = useMemo(() => returns.filter(r => r.tax_type === 'VAT'), [returns]);
  const withholdingTax = useMemo(() => returns.filter(r => r.tax_type === 'WHT'), [returns]);
  const totReturns = useMemo(() => returns.filter(r => r.tax_type === 'TOT'), [returns]);
  const payeReturns = useMemo(() => returns.filter(r => r.tax_type === 'PAYE'), [returns]);
  const salesTaxReturns = useMemo(() => returns.filter(r => r.tax_type === 'Sales Tax'), [returns]);
  const localTaxReturns = useMemo(() => returns.filter(r => r.tax_type === 'Local'), [returns]);
  const tourismLevyReturns = useMemo(() => returns.filter(r => r.tax_type === 'Tourism Levy'), [returns]);
  const serviceChargeReturns = useMemo(() => returns.filter(r => r.tax_type === 'Service Charge'), [returns]);
  const adjustmentReturns = useMemo(() => returns.filter(r => r.tax_type === 'Adjustment'), [returns]);

  // ── Filters ───────────────────────────────────────────────────────────
  const filterBySearch = (rows: any[], fields: string[]) =>
    rows.filter(r => fields.some(f => String(r[f] || '').toLowerCase().includes(searchTerm.toLowerCase())));

  const filteredVat = useMemo(() => filterBySearch(vatReturns, ['return_number', 'period', 'status']), [vatReturns, searchTerm]);
  const filteredWht = useMemo(() => filterBySearch(withholdingTax, ['return_number', 'period', 'status']), [withholdingTax, searchTerm]);
  const filteredTot = useMemo(() => filterBySearch(totReturns, ['return_number', 'period', 'status']), [totReturns, searchTerm]);
  const filteredPaye = useMemo(() => filterBySearch(payeReturns, ['return_number', 'period', 'status']), [payeReturns, searchTerm]);
  const filteredSales = useMemo(() => filterBySearch(salesTaxReturns, ['return_number', 'period', 'status']), [salesTaxReturns, searchTerm]);
  const filteredLocal = useMemo(() => filterBySearch(localTaxReturns, ['return_number', 'period', 'status']), [localTaxReturns, searchTerm]);
  const filteredTourism = useMemo(() => filterBySearch(tourismLevyReturns, ['return_number', 'period', 'status']), [tourismLevyReturns, searchTerm]);
  const filteredService = useMemo(() => filterBySearch(serviceChargeReturns, ['return_number', 'period', 'status']), [serviceChargeReturns, searchTerm]);
  const filteredAdjustments = useMemo(() => filterBySearch(adjustmentReturns, ['return_number', 'period', 'status']), [adjustmentReturns, searchTerm]);
  const filteredPension = useMemo(() => filterBySearch(pension, ['period', 'status']), [pension, searchTerm]);
  const filteredCustoms = useMemo(() => filterBySearch(customs, ['declaration_number', 'item_description', 'status']), [customs, searchTerm]);
  const filteredAudits = useMemo(() => filterBySearch(audits, ['finding_number', 'category', 'description', 'status']), [audits, searchTerm]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const vatCollectedYtd = vatReturns.reduce((s, r) => s + Number(r.tax_collected), 0);
    const vatPaidYtd = vatReturns.reduce((s, r) => s + Number(r.tax_paid), 0);
    const netVat = vatCollectedYtd - vatPaidYtd;
    const whtYtd = withholdingTax.reduce((s, r) => s + Number(r.tax_collected), 0);
    const whtPending = withholdingTax.filter(r => r.status === 'Pending').reduce((s, r) => s + Number(r.tax_collected), 0);
    const totYtd = totReturns.reduce((s, r) => s + Number(r.net_tax), 0);
    const totPending = totReturns.filter(r => r.status === 'Pending').reduce((s, r) => s + Number(r.net_tax), 0);
    const payeYtd = payeReturns.reduce((s, r) => s + Number(r.tax_collected), 0);
    const grossSalaryYtd = payeReturns.reduce((s, r) => s + Number(r.taxable_base), 0);
    const pensionEmpYtd = pension.reduce((s, p) => s + Number(p.employee_amount), 0);
    const pensionErYtd = pension.reduce((s, p) => s + Number(p.employer_amount), 0);
    const pensionTotal = pensionEmpYtd + pensionErYtd;
    const customsDutyYtd = customs.reduce((s, c) => s + Number(c.duty_paid), 0);
    const customsPending = customs.filter(c => c.status === 'Pending').length;
    const salesTaxYtd = salesTaxReturns.reduce((s, r) => s + Number(r.tax_collected), 0);
    const salesTaxableYtd = salesTaxReturns.reduce((s, r) => s + Number(r.taxable_base), 0);
    const localYtd = localTaxReturns.reduce((s, r) => s + Number(r.net_tax), 0);
    const tourismLevyYtd = tourismLevyReturns.reduce((s, r) => s + Number(r.tax_collected), 0);
    const tourismLevyNetYtd = tourismLevyReturns.reduce((s, r) => s + Number(r.net_tax), 0);
    const serviceChargeYtd = serviceChargeReturns.reduce((s, r) => s + Number(r.tax_collected), 0);
    const serviceChargeNetYtd = serviceChargeReturns.reduce((s, r) => s + Number(r.net_tax), 0);
    const adjustmentYtd = adjustmentReturns.reduce((s, r) => s + Number(r.metadata?.adjustmentAmount || 0), 0);
    const auditOpen = audits.filter(a => a.status === 'Open' || a.status === 'In Progress').length;
    const auditResolved = audits.filter(a => a.status === 'Resolved').length;
    return {
      vatCollectedYtd, vatPaidYtd, netVat,
      whtYtd, whtPending,
      totYtd, totPending,
      payeYtd, grossSalaryYtd,
      pensionEmpYtd, pensionErYtd, pensionTotal,
      customsDutyYtd, customsPending,
      salesTaxYtd, salesTaxableYtd,
      localYtd,
      tourismLevyYtd, tourismLevyNetYtd,
      serviceChargeYtd, serviceChargeNetYtd,
      adjustmentYtd,
      auditOpen, auditResolved,
    };
  }, [vatReturns, withholdingTax, totReturns, payeReturns, pension, customs, salesTaxReturns, localTaxReturns, tourismLevyReturns, serviceChargeReturns, adjustmentReturns, audits]);

  // ── Action handlers ───────────────────────────────────────────────────
  const handleReturnStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateTaxReturn(id, { status });
      await loadAll();
      addNotification(`Tax return status updated to ${status}.`, 'success', 'Tax');
    } catch (e: any) { addNotification(e?.message || 'Failed to update status', 'error', 'Tax'); }
  };

  const handlePensionStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateTaxPension(id, { status });
      await loadAll();
      addNotification(`Pension status updated to ${status}.`, 'success', 'Tax');
    } catch (e: any) { addNotification(e?.message || 'Failed to update status', 'error', 'Tax'); }
  };

  const handleCustomsStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateTaxCustoms(id, { status });
      await loadAll();
      addNotification(`Customs status updated to ${status}.`, 'success', 'Tax');
    } catch (e: any) { addNotification(e?.message || 'Failed to update status', 'error', 'Tax'); }
  };

  const handleAuditStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateTaxAudit(id, { status });
      await loadAll();
      addNotification(`Audit finding status updated to ${status}.`, 'success', 'Tax');
    } catch (e: any) { addNotification(e?.message || 'Failed to update status', 'error', 'Tax'); }
  };

  const handleDelete = async (type: 'return' | 'pension' | 'customs' | 'audit', id: string) => {
    setActionMenuId(null);
    try {
      if (type === 'return') await deleteTaxReturn(id);
      else if (type === 'pension') await deleteTaxPension(id);
      else if (type === 'customs') await deleteTaxCustoms(id);
      else await deleteTaxAudit(id);
      await loadAll();
      addNotification('Record deleted.', 'warning', 'Tax');
    } catch (e: any) { addNotification(e?.message || 'Failed to delete', 'error', 'Tax'); }
  };

  const handleCreate = async (type: 'return' | 'local' | 'adjustment' | 'pension' | 'customs' | 'audit') => {
    setSubmitting(true);
    try {
      const pid = currentPropertyId || undefined;
      if (type === 'return') {
        if (!returnForm.period) { addNotification('Period is required.', 'warning', 'Tax'); setSubmitting(false); return; }
        await createTaxReturn({
          taxType: returnForm.taxType, period: returnForm.period, dueDate: returnForm.dueDate || undefined,
          taxableBase: returnForm.taxableBase, taxCollected: returnForm.taxCollected, taxPaid: returnForm.taxPaid,
          netTax: returnForm.taxCollected - returnForm.taxPaid, taxRate: returnForm.taxRate, propertyId: pid,
        });
        setShowReturnModal(false);
        setReturnForm({ taxType: 'VAT', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 0, metadata: {} });
      } else if (type === 'local') {
        if (!localForm.period) { addNotification('Period is required.', 'warning', 'Tax'); setSubmitting(false); return; }
        await createTaxReturn({
          taxType: 'Local', period: localForm.period, dueDate: localForm.dueDate || undefined,
          netTax: localForm.amount, taxPaid: 0, propertyId: pid,
          metadata: { taxType: localForm.taxType, jurisdiction: localForm.jurisdiction },
        });
        setShowLocalModal(false);
        setLocalForm({ taxType: 'Municipal Tax', jurisdiction: 'City of Addis Ababa', period: '', dueDate: '', amount: 0 });
      } else if (type === 'adjustment') {
        if (!adjustmentForm.period) { addNotification('Period is required.', 'warning', 'Tax'); setSubmitting(false); return; }
        await createTaxReturn({
          taxType: 'Adjustment', period: adjustmentForm.period, dueDate: adjustmentForm.dueDate || undefined,
          netTax: adjustmentForm.adjustmentAmount, taxPaid: 0, propertyId: pid,
          metadata: {
            taxType: adjustmentForm.taxType,
            originalAmount: adjustmentForm.originalAmount,
            adjustmentAmount: adjustmentForm.adjustmentAmount,
            reason: adjustmentForm.reason,
          },
        });
        setShowAdjustmentModal(false);
        setAdjustmentForm({ taxType: 'VAT', period: '', dueDate: '', originalAmount: 0, adjustmentAmount: 0, reason: '' });
      } else if (type === 'pension') {
        if (!pensionForm.period) { addNotification('Period is required.', 'warning', 'Tax'); setSubmitting(false); return; }
        await createTaxPension({ ...pensionForm, propertyId: pid });
        setShowPensionModal(false);
        setPensionForm({ period: '', employeeAmount: 0, employerAmount: 0 });
      } else if (type === 'customs') {
        if (!customsForm.itemDescription) { addNotification('Item description is required.', 'warning', 'Tax'); setSubmitting(false); return; }
        await createTaxCustoms({ ...customsForm, propertyId: pid });
        setShowCustomsModal(false);
        setCustomsForm({ itemDescription: '', cifValue: 0, dutyRate: '15%', dutyPaid: 0, declarationDate: '' });
      } else if (type === 'audit') {
        if (!auditForm.category) { addNotification('Category is required.', 'warning', 'Tax'); setSubmitting(false); return; }
        await createTaxAudit({ ...auditForm, propertyId: pid });
        setShowAuditModal(false);
        setAuditForm({ category: 'VAT Compliance', description: '', riskLevel: 'Medium', dueDate: '' });
      }
      await loadAll();
      addNotification('Record created successfully.', 'success', 'Tax');
    } catch (e: any) { addNotification(e?.message || 'Failed to create record', 'error', 'Tax'); }
    finally { setSubmitting(false); }
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────
  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdB = 'px-4 py-3.5 text-sm text-right font-bold text-slate-900 dark:text-white';
  const tdC = 'px-4 py-3.5 text-sm text-center text-slate-700 dark:text-slate-300';
  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';

  const ActionMenu = ({ id, status, onStatus, onDelete, canFile }: {
    id: string; status: string; onStatus: (id: string, s: string) => void; onDelete: (id: string) => void; canFile?: boolean;
  }) => (
    <div className="relative">
      <button onClick={() => setActionMenuId(actionMenuId === id ? null : id)}
        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
        <MoreVertical size={14} />
      </button>
      {actionMenuId === id && (
        <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[140px]">
          {status === 'Pending' && canFile && (
            <button onClick={() => onStatus(id, 'Filed')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Check size={14} /> File Return
            </button>
          )}
          {status === 'Pending' && !canFile && (
            <button onClick={() => onStatus(id, 'Remitted')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Check size={14} /> Mark Remitted
            </button>
          )}
          {status === 'Pending' && (
            <button onClick={() => onStatus(id, 'Cleared')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
              <Check size={14} /> Mark Cleared
            </button>
          )}
          {(status === 'Open' || status === 'In Progress') && (
            <button onClick={() => onStatus(id, 'Resolved')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Check size={14} /> Resolve
            </button>
          )}
          <button onClick={() => onDelete(id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );

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

  const renderVAT = () => (
    <div className="space-y-6">
      <SectionCard
        title="VAT Returns History"
        subtitle={`${filteredVat.length} return${filteredVat.length !== 1 ? 's' : ''}`}
        icon={Percent}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'VAT', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 10, metadata: {} }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Return
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Return #</th>
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Taxable Sales</th>
                <th className={th + ' text-right'}>VAT Collected</th>
                <th className={th + ' text-right'}>VAT Paid</th>
                <th className={th + ' text-right'}>Net VAT</th>
                <th className={th}>Due Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredVat.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdR}>{formatAmount(Number(r.taxable_base))}</td>
                  <td className={tdR}><span className="text-emerald-600">{formatAmount(Number(r.tax_collected))}</span></td>
                  <td className={tdR}><span className="text-amber-600">{formatAmount(Number(r.tax_paid))}</span></td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(r.net_tax))}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{r.due_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredVat.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">No VAT returns found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderWithholding = () => (
    <div className="space-y-6">
      <SectionCard
        title="Withholding Tax Returns"
        subtitle={`${filteredWht.length} return${filteredWht.length !== 1 ? 's' : ''}`}
        icon={FileText}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'WHT', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 2, metadata: { vendors: 0 } }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Return
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Return #</th>
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Total Withheld</th>
                <th className={th + ' text-right'}>Vendors</th>
                <th className={th}>Due Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredWht.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdB}>{formatAmount(Number(r.tax_collected))}</td>
                  <td className={tdR}>{r.metadata?.vendors || '—'}</td>
                  <td className={td}><span className="text-xs text-slate-500">{r.due_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredWht.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No withholding returns found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderTOT = () => (
    <div className="space-y-6">
      <SectionCard
        title="Turnover Tax (TOT) Returns"
        subtitle={`${filteredTot.length} return${filteredTot.length !== 1 ? 's' : ''}`}
        icon={BarChart3}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'TOT', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 2, metadata: {} }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Return
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Return #</th>
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Gross Turnover</th>
                <th className={th + ' text-right'}>TOT Payable</th>
                <th className={th}>Due Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTot.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdR}>{formatAmount(Number(r.taxable_base))}</td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(r.net_tax))}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{r.due_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredTot.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No TOT returns found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderExcise = () => (
    <div className="space-y-6">
      <SectionCard title="Excise Tax Module" subtitle="Not currently applicable" icon={ShieldCheck}>
        <div className="p-8 text-center">
          <ShieldCheck size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-xs text-slate-500 font-medium mb-6">This module is currently not applicable to your business operations.</p>
          <button className="px-6 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl text-[10px] font-black uppercase">
            Configure Module
          </button>
        </div>
      </SectionCard>
    </div>
  );

  const renderPAYE = () => (
    <div className="space-y-6">
      <SectionCard
        title="PAYE Returns History"
        subtitle={`${filteredPaye.length} return${filteredPaye.length !== 1 ? 's' : ''}`}
        icon={DollarSign}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'PAYE', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 10, metadata: { employees: 0, grossSalary: 0, pensionDeducted: 0 } }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Return
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Return #</th>
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Employees</th>
                <th className={th + ' text-right'}>Gross Salary</th>
                <th className={th + ' text-right'}>PAYE Deducted</th>
                <th className={th}>Filing Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredPaye.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdR}>{r.metadata?.employees || '—'}</td>
                  <td className={tdR}>{formatAmount(Number(r.taxable_base))}</td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(r.tax_collected))}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{r.filing_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredPaye.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No PAYE returns found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderPension = () => (
    <div className="space-y-6">
      <SectionCard
        title="Pension Remittance Schedule"
        subtitle={`${filteredPension.length} record${filteredPension.length !== 1 ? 's' : ''}`}
        icon={CheckCircle2}
        actions={
          <button onClick={() => setShowPensionModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Entry
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Employee 8%</th>
                <th className={th + ' text-right'}>Employer 11%</th>
                <th className={th + ' text-right'}>Total</th>
                <th className={th}>Remittance Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredPension.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{p.period}</span></td>
                  <td className={tdR}>{formatAmount(Number(p.employee_amount))}</td>
                  <td className={tdR}>{formatAmount(Number(p.employer_amount))}</td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(p.total_amount))}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{p.remittance_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[p.status] || 'neutral'}>{p.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={p.id} status={p.status} onStatus={handlePensionStatus} onDelete={(id) => handleDelete('pension', id)} />
                  </td>
                </tr>
              ))}
              {filteredPension.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No pension records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderCustoms = () => (
    <div className="space-y-6">
      <SectionCard
        title="Customs Declarations"
        subtitle={`${filteredCustoms.length} declaration${filteredCustoms.length !== 1 ? 's' : ''}`}
        icon={Download}
        actions={
          <button onClick={() => setShowCustomsModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Declaration
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Declaration</th>
                <th className={th}>Item</th>
                <th className={th + ' text-right'}>CIF Value</th>
                <th className={th + ' text-right'}>Duty Rate</th>
                <th className={th + ' text-right'}>Duty Paid</th>
                <th className={th}>Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCustoms.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{c.declaration_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{c.item_description}</span></td>
                  <td className={tdR}>{formatAmount(Number(c.cif_value))}</td>
                  <td className={tdR}>{c.duty_rate || '—'}</td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(c.duty_paid))}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{c.declaration_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[c.status] || 'neutral'}>{c.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={c.id} status={c.status} onStatus={handleCustomsStatus} onDelete={(id) => handleDelete('customs', id)} />
                  </td>
                </tr>
              ))}
              {filteredCustoms.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No customs declarations found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderLocal = () => (
    <div className="space-y-6">
      <SectionCard
        title="Local Tax Payments"
        subtitle={`${filteredLocal.length} payment${filteredLocal.length !== 1 ? 's' : ''}`}
        icon={FileSpreadsheet}
        actions={
          <button onClick={() => { setLocalForm({ taxType: 'Municipal Tax', jurisdiction: 'City of Addis Ababa', period: '', dueDate: '', amount: 0 }); setShowLocalModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Payment
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Payment #</th>
                <th className={th}>Tax Type</th>
                <th className={th}>Jurisdiction</th>
                <th className={th + ' text-right'}>Amount</th>
                <th className={th}>Period</th>
                <th className={th}>Due Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLocal.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.metadata?.taxType || '—'}</span></td>
                  <td className={td}><span className="text-xs text-slate-600 dark:text-slate-400">{r.metadata?.jurisdiction || '—'}</span></td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(r.net_tax))}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{r.period}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{r.due_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredLocal.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No local tax payments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderAudit = () => (
    <div className="space-y-6">
      <SectionCard
        title="Audit Findings"
        subtitle={`${filteredAudits.length} finding${filteredAudits.length !== 1 ? 's' : ''}`}
        icon={ShieldCheck}
        actions={
          <button onClick={() => setShowAuditModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Finding
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Finding #</th>
                <th className={th}>Category</th>
                <th className={th}>Description</th>
                <th className={th}>Risk Level</th>
                <th className={th}>Status</th>
                <th className={th}>Due Date</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAudits.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{a.finding_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{a.category}</span></td>
                  <td className={td}><span className="text-xs text-slate-600 dark:text-slate-400">{a.description || '—'}</span></td>
                  <td className={tdC}><Badge tone={RISK_COLORS[a.risk_level] || 'neutral'}>{a.risk_level}</Badge></td>
                  <td className={tdC}><Badge tone={STATUS_COLORS[a.status] || 'neutral'}>{a.status}</Badge></td>
                  <td className={td}><span className="text-xs text-slate-500">{a.due_date || '—'}</span></td>
                  <td className={tdR}>
                    <ActionMenu id={a.id} status={a.status} onStatus={handleAuditStatus} onDelete={(id) => handleDelete('audit', id)} />
                  </td>
                </tr>
              ))}
              {filteredAudits.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No audit findings found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderSalesTax = () => (
    <div className="space-y-6">
      <SectionCard
        title="Sales Tax Returns"
        subtitle={`${filteredSales.length} return${filteredSales.length !== 1 ? 's' : ''}`}
        icon={Send}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'Sales Tax', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 5, metadata: {} }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Return
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Return #</th>
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Taxable Sales</th>
                <th className={th + ' text-right'}>Tax Collected</th>
                <th className={th + ' text-right'}>Tax Rate</th>
                <th className={th}>Due Date</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredSales.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdR}>{formatAmount(Number(r.taxable_base))}</td>
                  <td className={tdR}><span className="text-emerald-600">{formatAmount(Number(r.tax_collected))}</span></td>
                  <td className={tdR}>{r.tax_rate ? `${r.tax_rate}%` : '—'}</td>
                  <td className={td}><span className="text-xs text-slate-500">{r.due_date || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No sales tax returns found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderTourismLevy = () => (
    <div className="space-y-6">
      <SectionCard
        title="Tourism Levy Returns"
        subtitle={`${filteredTourism.length} return${filteredTourism.length !== 1 ? 's' : ''}`}
        icon={Palmtree}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'Tourism Levy', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 10, metadata: {} }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Return
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Levy Collected</th>
                <th className={th + ' text-right'}>Levy Rate</th>
                <th className={th + ' text-right'}>Net Levy</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTourism.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdR}><span className="text-emerald-600">{formatAmount(Number(r.tax_collected))}</span></td>
                  <td className={tdR}>{r.tax_rate ? `${r.tax_rate}%` : '—'}</td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(r.net_tax))}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredTourism.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">No tourism levy returns found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderServiceCharge = () => (
    <div className="space-y-6">
      <SectionCard
        title="Service Charge Records"
        subtitle={`${filteredService.length} record${filteredService.length !== 1 ? 's' : ''}`}
        icon={Percent}
        actions={
          <button onClick={() => { setReturnForm({ taxType: 'Service Charge', period: '', dueDate: '', taxableBase: 0, taxCollected: 0, taxPaid: 0, taxRate: 10, metadata: {} }); setShowReturnModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> Generate Record
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Service Charge Collected</th>
                <th className={th + ' text-right'}>Rate</th>
                <th className={th + ' text-right'}>Net Amount</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredService.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.period}</span></td>
                  <td className={tdR}><span className="text-emerald-600">{formatAmount(Number(r.tax_collected))}</span></td>
                  <td className={tdR}>{r.tax_rate ? `${r.tax_rate}%` : '—'}</td>
                  <td className={tdB}><span className="text-indigo-600">{formatAmount(Number(r.net_tax))}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredService.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">No service charge records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  const renderAdjustments = () => (
    <div className="space-y-6">
      <SectionCard
        title="Tax Adjustments"
        subtitle={`${filteredAdjustments.length} adjustment${filteredAdjustments.length !== 1 ? 's' : ''}`}
        icon={Edit3}
        actions={
          <button onClick={() => { setAdjustmentForm({ taxType: 'VAT', period: '', dueDate: '', originalAmount: 0, adjustmentAmount: 0, reason: '' }); setShowAdjustmentModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Adjustment
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Adjustment #</th>
                <th className={th}>Tax Type</th>
                <th className={th}>Period</th>
                <th className={th + ' text-right'}>Original Amount</th>
                <th className={th + ' text-right'}>Adjustment Amount</th>
                <th className={th}>Reason</th>
                <th className={th}>Status</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAdjustments.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-mono text-xs text-indigo-500">{r.return_number || '—'}</span></td>
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{r.metadata?.taxType || '—'}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{r.period}</span></td>
                  <td className={tdR}>{formatAmount(Number(r.metadata?.originalAmount || 0))}</td>
                  <td className={tdR}><span className={Number(r.metadata?.adjustmentAmount || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>{formatAmount(Number(r.metadata?.adjustmentAmount || 0))}</span></td>
                  <td className={td}><span className="text-xs text-slate-600 dark:text-slate-400">{r.metadata?.reason || '—'}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className={tdR}>
                    <ActionMenu id={r.id} status={r.status} canFile onStatus={handleReturnStatus} onDelete={(id) => handleDelete('return', id)} />
                  </td>
                </tr>
              ))}
              {filteredAdjustments.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No tax adjustments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Stat cards (rendered above tab bar) ───────────────────────────────
  const renderStats = () => {
    const cards = (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {activeTab === 'vat' && (
          <>
            <StatCard title="VAT Collected (YTD)" value={formatAmount(stats.vatCollectedYtd)} icon={DollarSign} tone="success" />
            <StatCard title="VAT Paid (YTD)" value={formatAmount(stats.vatPaidYtd)} icon={ArrowDownRight} tone="warning" />
            <StatCard title="Net VAT Payable" value={formatAmount(stats.netVat)} icon={Send} tone="info" />
            <StatCard title="Filed Returns" value={vatReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="neutral" />
          </>
        )}
        {activeTab === 'withholding' && (
          <>
            <StatCard title="Total Withheld (YTD)" value={formatAmount(stats.whtYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Pending Filing" value={formatAmount(stats.whtPending)} icon={Clock} tone="warning" />
            <StatCard title="Filed Returns" value={withholdingTax.filter(r => r.status === 'Filed').length} icon={FileText} tone="info" />
            <StatCard title="Avg Rate" value="2.0%" icon={BarChart3} tone="neutral" />
          </>
        )}
        {activeTab === 'tot' && (
          <>
            <StatCard title="Gross Turnover (YTD)" value={formatAmount(totReturns.reduce((s, r) => s + Number(r.taxable_base), 0))} icon={DollarSign} tone="success" />
            <StatCard title="TOT Payable (YTD)" value={formatAmount(stats.totYtd)} icon={Send} tone="info" />
            <StatCard title="Pending Filing" value={formatAmount(stats.totPending)} icon={Clock} tone="warning" />
            <StatCard title="Filed Returns" value={totReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="neutral" />
          </>
        )}
        {activeTab === 'excise' && (
          <>
            <StatCard title="Excise Tax" value="—" icon={ShieldCheck} tone="neutral" />
            <StatCard title="Applicable" value="No" icon={AlertCircle} tone="warning" />
            <StatCard title="Filed" value={0} icon={CheckCircle2} tone="neutral" />
            <StatCard title="Pending" value={0} icon={Clock} tone="neutral" />
          </>
        )}
        {activeTab === 'paye' && (
          <>
            <StatCard title="PAYE Deducted (YTD)" value={formatAmount(stats.payeYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Employees" value={payeReturns.length > 0 ? (payeReturns[0]?.metadata?.employees || '—') : '—'} icon={FileText} tone="info" />
            <StatCard title="Gross Salary (YTD)" value={formatAmount(stats.grossSalaryYtd)} icon={BarChart3} tone="neutral" />
            <StatCard title="Filed Returns" value={payeReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="warning" />
          </>
        )}
        {activeTab === 'pension' && (
          <>
            <StatCard title="Pension Deducted (YTD)" value={formatAmount(stats.pensionEmpYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Employer Contribution" value={formatAmount(stats.pensionErYtd)} icon={BarChart3} tone="info" />
            <StatCard title="Total Remitted" value={formatAmount(stats.pensionTotal)} icon={Send} tone="neutral" />
            <StatCard title="Pending" value={pension.filter(p => p.status === 'Pending').length} icon={Clock} tone="warning" />
          </>
        )}
        {activeTab === 'customs' && (
          <>
            <StatCard title="Customs Duty Paid (YTD)" value={formatAmount(stats.customsDutyYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Import Declarations" value={customs.length} icon={FileText} tone="info" />
            <StatCard title="Avg Duty Rate" value={customs.length > 0 ? `${(customs.reduce((s, c) => s + parseFloat(c.duty_rate || '0'), 0) / customs.length).toFixed(1)}%` : '—'} icon={BarChart3} tone="neutral" />
            <StatCard title="Pending Clearance" value={stats.customsPending} icon={Clock} tone="warning" />
          </>
        )}
        {activeTab === 'local' && (
          <>
            <StatCard title="Local Tax (YTD)" value={formatAmount(stats.localYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Pending Payments" value={localTaxReturns.filter(r => r.status === 'Pending').length} icon={Clock} tone="warning" />
            <StatCard title="Paid" value={localTaxReturns.filter(r => r.status === 'Paid').length} icon={CheckCircle2} tone="info" />
            <StatCard title="Total Records" value={localTaxReturns.length} icon={FileText} tone="neutral" />
          </>
        )}
        {activeTab === 'audit' && (
          <>
            <StatCard title="Open Findings" value={stats.auditOpen} icon={AlertCircle} tone="danger" />
            <StatCard title="Resolved" value={stats.auditResolved} icon={CheckCircle2} tone="success" />
            <StatCard title="High Risk" value={audits.filter(a => a.risk_level === 'High').length} icon={AlertTriangle} tone="warning" />
            <StatCard title="Total Findings" value={audits.length} icon={ShieldCheck} tone="info" />
          </>
        )}
        {activeTab === 'sales_tax' && (
          <>
            <StatCard title="Sales Tax Collected (YTD)" value={formatAmount(stats.salesTaxYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Taxable Sales (YTD)" value={formatAmount(stats.salesTaxableYtd)} icon={BarChart3} tone="info" />
            <StatCard title="Filed Returns" value={salesTaxReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="neutral" />
            <StatCard title="Pending" value={salesTaxReturns.filter(r => r.status === 'Pending').length} icon={Clock} tone="warning" />
          </>
        )}
        {activeTab === 'tourism_levy' && (
          <>
            <StatCard title="Levy Collected (YTD)" value={formatAmount(stats.tourismLevyYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Net Levy (YTD)" value={formatAmount(stats.tourismLevyNetYtd)} icon={Send} tone="info" />
            <StatCard title="Filed Returns" value={tourismLevyReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="neutral" />
            <StatCard title="Pending" value={tourismLevyReturns.filter(r => r.status === 'Pending').length} icon={Clock} tone="warning" />
          </>
        )}
        {activeTab === 'service_charge' && (
          <>
            <StatCard title="Service Charge (YTD)" value={formatAmount(stats.serviceChargeYtd)} icon={DollarSign} tone="success" />
            <StatCard title="Net Amount (YTD)" value={formatAmount(stats.serviceChargeNetYtd)} icon={Send} tone="info" />
            <StatCard title="Filed Records" value={serviceChargeReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="neutral" />
            <StatCard title="Pending" value={serviceChargeReturns.filter(r => r.status === 'Pending').length} icon={Clock} tone="warning" />
          </>
        )}
        {activeTab === 'adjustments' && (
          <>
            <StatCard title="Total Adjustments (YTD)" value={formatAmount(stats.adjustmentYtd)} icon={Edit3} tone="info" />
            <StatCard title="Total Records" value={adjustmentReturns.length} icon={FileText} tone="neutral" />
            <StatCard title="Filed" value={adjustmentReturns.filter(r => r.status === 'Filed').length} icon={CheckCircle2} tone="success" />
            <StatCard title="Pending" value={adjustmentReturns.filter(r => r.status === 'Pending').length} icon={Clock} tone="warning" />
          </>
        )}
      </div>
    );
    return cards;
  };

  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Tax Compliance"
        subtitle="Manage VAT, withholding, PAYE, pension, customs, and audit compliance"
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
      {!loading && activeTab === 'vat' && renderVAT()}
      {!loading && activeTab === 'withholding' && renderWithholding()}
      {!loading && activeTab === 'tot' && renderTOT()}
      {!loading && activeTab === 'excise' && renderExcise()}
      {!loading && activeTab === 'paye' && renderPAYE()}
      {!loading && activeTab === 'pension' && renderPension()}
      {!loading && activeTab === 'customs' && renderCustoms()}
      {!loading && activeTab === 'local' && renderLocal()}
      {!loading && activeTab === 'audit' && renderAudit()}
      {!loading && activeTab === 'sales_tax' && renderSalesTax()}
      {!loading && activeTab === 'tourism_levy' && renderTourismLevy()}
      {!loading && activeTab === 'service_charge' && renderServiceCharge()}
      {!loading && activeTab === 'adjustments' && renderAdjustments()}

      {/* ═══ CREATE MODALS ═══ */}

      {/* Tax Return Modal (VAT/WHT/TOT/PAYE/Sales Tax) */}
      <Modal open={showReturnModal} onClose={() => setShowReturnModal(false)} title={`New ${returnForm.taxType} Return`} onSubmit={() => handleCreate('return')}>
        <FormField label="Tax Type">
          <select className={inputCls} value={returnForm.taxType} onChange={e => setReturnForm({ ...returnForm, taxType: e.target.value })}>
            {TAX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Period">
            <input className={inputCls} value={returnForm.period} onChange={e => setReturnForm({ ...returnForm, period: e.target.value })} placeholder="e.g. June 2026" />
          </FormField>
          <FormField label="Due Date">
            <input type="date" className={inputCls} value={returnForm.dueDate} onChange={e => setReturnForm({ ...returnForm, dueDate: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Taxable Base">
            <input type="number" step="0.01" className={inputCls} value={returnForm.taxableBase || ''} onChange={e => setReturnForm({ ...returnForm, taxableBase: Number(e.target.value) })} />
          </FormField>
          <FormField label="Tax Rate (%)">
            <input type="number" step="0.01" className={inputCls} value={returnForm.taxRate || ''} onChange={e => setReturnForm({ ...returnForm, taxRate: Number(e.target.value) })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Tax Collected">
            <input type="number" step="0.01" className={inputCls} value={returnForm.taxCollected || ''} onChange={e => setReturnForm({ ...returnForm, taxCollected: Number(e.target.value) })} />
          </FormField>
          <FormField label="Tax Paid">
            <input type="number" step="0.01" className={inputCls} value={returnForm.taxPaid || ''} onChange={e => setReturnForm({ ...returnForm, taxPaid: Number(e.target.value) })} />
          </FormField>
        </div>
      </Modal>

      {/* Local Tax Modal */}
      <Modal open={showLocalModal} onClose={() => setShowLocalModal(false)} title="New Local Tax Payment" onSubmit={() => handleCreate('local')}>
        <FormField label="Tax Type">
          <select className={inputCls} value={localForm.taxType} onChange={e => setLocalForm({ ...localForm, taxType: e.target.value })}>
            <option>Municipal Tax</option>
            <option>Property Tax</option>
            <option>Business License Fee</option>
            <option>Road Tax</option>
            <option>Land Use Fee</option>
          </select>
        </FormField>
        <FormField label="Jurisdiction">
          <input className={inputCls} value={localForm.jurisdiction} onChange={e => setLocalForm({ ...localForm, jurisdiction: e.target.value })} placeholder="e.g. City of Addis Ababa" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Period">
            <input className={inputCls} value={localForm.period} onChange={e => setLocalForm({ ...localForm, period: e.target.value })} placeholder="e.g. June 2026" />
          </FormField>
          <FormField label="Due Date">
            <input type="date" className={inputCls} value={localForm.dueDate} onChange={e => setLocalForm({ ...localForm, dueDate: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Amount">
          <input type="number" step="0.01" className={inputCls} value={localForm.amount || ''} onChange={e => setLocalForm({ ...localForm, amount: Number(e.target.value) })} />
        </FormField>
      </Modal>

      {/* Tax Adjustment Modal */}
      <Modal open={showAdjustmentModal} onClose={() => setShowAdjustmentModal(false)} title="New Tax Adjustment" onSubmit={() => handleCreate('adjustment')}>
        <FormField label="Tax Type">
          <select className={inputCls} value={adjustmentForm.taxType} onChange={e => setAdjustmentForm({ ...adjustmentForm, taxType: e.target.value })}>
            <option>VAT</option>
            <option>Withholding Tax</option>
            <option>Sales Tax</option>
            <option>Tourism Levy</option>
            <option>Service Charge</option>
            <option>Local</option>
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Period">
            <input className={inputCls} value={adjustmentForm.period} onChange={e => setAdjustmentForm({ ...adjustmentForm, period: e.target.value })} placeholder="e.g. June 2026" />
          </FormField>
          <FormField label="Due Date">
            <input type="date" className={inputCls} value={adjustmentForm.dueDate} onChange={e => setAdjustmentForm({ ...adjustmentForm, dueDate: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Original Amount">
            <input type="number" step="0.01" className={inputCls} value={adjustmentForm.originalAmount || ''} onChange={e => setAdjustmentForm({ ...adjustmentForm, originalAmount: Number(e.target.value) })} />
          </FormField>
          <FormField label="Adjustment Amount">
            <input type="number" step="0.01" className={inputCls} value={adjustmentForm.adjustmentAmount || ''} onChange={e => setAdjustmentForm({ ...adjustmentForm, adjustmentAmount: Number(e.target.value) })} />
          </FormField>
        </div>
        <FormField label="Reason">
          <input className={inputCls} value={adjustmentForm.reason} onChange={e => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })} placeholder="e.g. Correction of prior period overstatement" />
        </FormField>
      </Modal>

      {/* Pension Modal */}
      <Modal open={showPensionModal} onClose={() => setShowPensionModal(false)} title="New Pension Entry" onSubmit={() => handleCreate('pension')}>
        <FormField label="Period">
          <input className={inputCls} value={pensionForm.period} onChange={e => setPensionForm({ ...pensionForm, period: e.target.value })} placeholder="e.g. June 2026" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Employee (8%)">
            <input type="number" step="0.01" className={inputCls} value={pensionForm.employeeAmount || ''} onChange={e => setPensionForm({ ...pensionForm, employeeAmount: Number(e.target.value) })} />
          </FormField>
          <FormField label="Employer (11%)">
            <input type="number" step="0.01" className={inputCls} value={pensionForm.employerAmount || ''} onChange={e => setPensionForm({ ...pensionForm, employerAmount: Number(e.target.value) })} />
          </FormField>
        </div>
      </Modal>

      {/* Customs Modal */}
      <Modal open={showCustomsModal} onClose={() => setShowCustomsModal(false)} title="New Customs Declaration" onSubmit={() => handleCreate('customs')}>
        <FormField label="Item Description">
          <input className={inputCls} value={customsForm.itemDescription} onChange={e => setCustomsForm({ ...customsForm, itemDescription: e.target.value })} placeholder="e.g. Kitchen Equipment Import" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="CIF Value">
            <input type="number" step="0.01" className={inputCls} value={customsForm.cifValue || ''} onChange={e => setCustomsForm({ ...customsForm, cifValue: Number(e.target.value) })} />
          </FormField>
          <FormField label="Duty Rate">
            <input className={inputCls} value={customsForm.dutyRate} onChange={e => setCustomsForm({ ...customsForm, dutyRate: e.target.value })} placeholder="e.g. 15%" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Duty Paid">
            <input type="number" step="0.01" className={inputCls} value={customsForm.dutyPaid || ''} onChange={e => setCustomsForm({ ...customsForm, dutyPaid: Number(e.target.value) })} />
          </FormField>
          <FormField label="Declaration Date">
            <input type="date" className={inputCls} value={customsForm.declarationDate} onChange={e => setCustomsForm({ ...customsForm, declarationDate: e.target.value })} />
          </FormField>
        </div>
      </Modal>

      {/* Audit Modal */}
      <Modal open={showAuditModal} onClose={() => setShowAuditModal(false)} title="New Audit Finding" onSubmit={() => handleCreate('audit')}>
        <FormField label="Category">
          <select className={inputCls} value={auditForm.category} onChange={e => setAuditForm({ ...auditForm, category: e.target.value })}>
            {AUDIT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label="Description">
          <textarea className={inputCls} rows={3} value={auditForm.description} onChange={e => setAuditForm({ ...auditForm, description: e.target.value })} placeholder="Finding details..." />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Risk Level">
            <select className={inputCls} value={auditForm.riskLevel} onChange={e => setAuditForm({ ...auditForm, riskLevel: e.target.value })}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </FormField>
          <FormField label="Due Date">
            <input type="date" className={inputCls} value={auditForm.dueDate} onChange={e => setAuditForm({ ...auditForm, dueDate: e.target.value })} />
          </FormField>
        </div>
      </Modal>
    </div>
  );
};

export default TaxCompliance;
