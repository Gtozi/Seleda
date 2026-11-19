/**
 * Finance — Intercompany Accounting (backs /erp/finance/intercompany).
 *
 * DB-integrated via /api/fin-portal (see financePortal.routes.ts).
 * Three sub-modules:
 *   Invoices     — intercompany invoices with approval flow (fin_intercompany_invoices)
 *   Balances     — due-to / due-from accounts with aging (fin_intercompany_balances)
 *   Eliminations — consolidation elimination entries (fin_intercompany_eliminations)
 *
 * Uses the shared FrontOffice UI primitives (PageHeader, StatCard, Badge,
 * SectionCard) and the useERP context for currency formatting + notifications,
 * matching the F&B / HK inventory module look & feel.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  ArrowRightLeft,
  FileText,
  DollarSign,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  FileCheck,
  MoreVertical,
  Check,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  BarChart3,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchIntercompanyInvoices,
  createIntercompanyInvoice,
  updateIntercompanyInvoice,
  deleteIntercompanyInvoice,
  fetchIntercompanyBalances,
  createIntercompanyBalance,
  updateIntercompanyBalance,
  deleteIntercompanyBalance,
  fetchIntercompanyEliminations,
  createIntercompanyElimination,
  updateIntercompanyElimination,
  deleteIntercompanyElimination,
  type IntercompanyInvoiceFE,
  type IntercompanyBalanceFE,
  type IntercompanyEliminationFE,
} from '../../services/financePortalService';

// ── Types ──────────────────────────────────────────────────────────────────

type TabKey = 'invoices' | 'balances' | 'eliminations' | 'consolidated';

const TABS: { id: TabKey; label: string; icon: typeof Building2 }[] = [
  { id: 'invoices', label: 'Intercompany Invoices', icon: FileText },
  { id: 'balances', label: 'Due To / Due From', icon: ArrowRightLeft },
  { id: 'eliminations', label: 'Elimination Entries', icon: Layers },
  { id: 'consolidated', label: 'Consolidated Reporting', icon: BarChart3 },
];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Pending: 'warning',
  Approved: 'info',
  Posted: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
  Reversed: 'danger',
};

const TRANSACTION_TYPES = ['Service Charge', 'Staff Allocation', 'Management Fee', 'Cost Sharing', 'Loan', 'Expense Recharge', 'Revenue Transfer', 'Other'];
const BALANCE_TYPES = ['Due To', 'Due From'];
const AGING_BUCKETS = ['0-30', '31-60', '61-90', '90+'];
const ENTITIES = ['Gheralta Main Property', 'Gheralta Airport Branch', 'Corporate Office'];
const ELIM_ACCOUNTS = ['Intercompany Revenue', 'Intercompany Expenses', 'Management Fee', 'Cost Sharing', 'Revenue Transfer'];

// ── Main component ─────────────────────────────────────────────────────────

const IntercompanyAccounting = () => {
  const { formatAmount, addNotification, currentPropertyId } = useERP();

  const [activeTab, setActiveTab] = useState<TabKey>('invoices');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Data
  const [invoices, setInvoices] = useState<IntercompanyInvoiceFE[]>([]);
  const [balances, setBalances] = useState<IntercompanyBalanceFE[]>([]);
  const [eliminations, setEliminations] = useState<IntercompanyEliminationFE[]>([]);

  // Modals
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [showEliminationModal, setShowEliminationModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<IntercompanyInvoiceFE | null>(null);

  // Forms
  const [invoiceForm, setInvoiceForm] = useState({ fromEntity: 'Gheralta Main Property', toEntity: 'Gheralta Airport Branch', transactionType: 'Service Charge', description: '', amount: 0 });
  const [balanceForm, setBalanceForm] = useState({ entity: 'Gheralta Airport Branch', balanceType: 'Due To', amount: 0, agingBucket: '0-30', referenceInvoice: '' });
  const [eliminationForm, setEliminationForm] = useState({ period: '2026-Q3', account: 'Intercompany Revenue', entity1: 'Gheralta Main Property', entity2: 'Gheralta Airport Branch', amount: 0, description: '' });

  // ── Data loading ──────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [inv, bal, elim] = await Promise.all([
        fetchIntercompanyInvoices({ propertyId: pid }).catch(() => [] as IntercompanyInvoiceFE[]),
        fetchIntercompanyBalances({ propertyId: pid }).catch(() => [] as IntercompanyBalanceFE[]),
        fetchIntercompanyEliminations({ propertyId: pid }).catch(() => [] as IntercompanyEliminationFE[]),
      ]);
      setInvoices(inv);
      setBalances(bal);
      setEliminations(elim);
    } catch (e: any) {
      setError(e?.message || 'Failed to load intercompany data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Filters ───────────────────────────────────────────────────────────

  const filteredInvoices = useMemo(() =>
    invoices.filter(i =>
      (i.invoice_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.from_entity.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.to_entity.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.transaction_type.toLowerCase().includes(searchTerm.toLowerCase())
    ), [invoices, searchTerm]);

  const filteredBalances = useMemo(() =>
    balances.filter(b =>
      b.entity.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.balance_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.reference_invoice || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [balances, searchTerm]);

  const filteredEliminations = useMemo(() =>
    eliminations.filter(e =>
      (e.entry_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.period.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.account.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.entity1.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.entity2.toLowerCase().includes(searchTerm.toLowerCase())
    ), [eliminations, searchTerm]);

  // ── Stats ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalTransactions = invoices.length;
    const dueTo = balances.filter(b => b.balance_type === 'Due To').reduce((s, b) => s + Number(b.amount), 0);
    const dueFrom = balances.filter(b => b.balance_type === 'Due From').reduce((s, b) => s + Number(b.amount), 0);
    const netPosition = dueFrom - dueTo;
    const pendingInvoices = invoices.filter(i => i.status === 'Pending').length;
    const postedInvoices = invoices.filter(i => i.status === 'Posted').length;
    const totalInvoiceAmount = invoices.reduce((s, i) => s + Number(i.amount), 0);
    const pendingEliminations = eliminations.filter(e => e.status === 'Pending').length;
    const postedEliminations = eliminations.filter(e => e.status === 'Posted').length;
    const eliminationAmount = eliminations.reduce((s, e) => s + Number(e.amount), 0);
    return { totalTransactions, dueTo, dueFrom, netPosition, pendingInvoices, postedInvoices, totalInvoiceAmount, pendingEliminations, postedEliminations, eliminationAmount };
  }, [invoices, balances, eliminations]);

  // ── Consolidated reporting data ───────────────────────────────────────

  const consolidatedData = useMemo(() => {
    const ENTITY_COLS = ['Gheralta Main Property', 'Gheralta Airport Branch', 'Corporate Office'];

    // Derive per-entity revenue from intercompany invoices (amounts billed by each entity)
    const revenueByEntity: Record<string, number> = {};
    ENTITY_COLS.forEach(e => { revenueByEntity[e] = 0; });
    invoices.forEach(inv => {
      if (revenueByEntity[inv.from_entity] !== undefined) revenueByEntity[inv.from_entity] += Number(inv.amount);
    });

    // Derive per-entity intercompany expenses from invoices (amounts billed TO each entity)
    const expensesByEntity: Record<string, number> = {};
    ENTITY_COLS.forEach(e => { expensesByEntity[e] = 0; });
    invoices.forEach(inv => {
      if (expensesByEntity[inv.to_entity] !== undefined) expensesByEntity[inv.to_entity] += Number(inv.amount);
    });

    // Eliminations total (from posted eliminations)
    const totalEliminations = eliminations
      .filter(e => e.status === 'Posted')
      .reduce((s, e) => s + Number(e.amount), 0);

    const totalRevenue = ENTITY_COLS.reduce((s, e) => s + (revenueByEntity[e] || 0), 0);
    const totalExpenses = ENTITY_COLS.reduce((s, e) => s + (expensesByEntity[e] || 0), 0);

    // Consolidated trial balance rows — intercompany accounts get eliminated
    const trialBalance = [
      {
        code: '4000', name: 'Intercompany Revenue',
        entityA: revenueByEntity['Gheralta Main Property'] || 0,
        entityB: revenueByEntity['Gheralta Airport Branch'] || 0,
        entityC: revenueByEntity['Corporate Office'] || 0,
        eliminations: -(revenueByEntity['Gheralta Main Property'] || 0) - (revenueByEntity['Gheralta Airport Branch'] || 0) - (revenueByEntity['Corporate Office'] || 0),
      },
      {
        code: '5000', name: 'Intercompany Expenses',
        entityA: expensesByEntity['Gheralta Main Property'] || 0,
        entityB: expensesByEntity['Gheralta Airport Branch'] || 0,
        entityC: expensesByEntity['Corporate Office'] || 0,
        eliminations: -(expensesByEntity['Gheralta Main Property'] || 0) - (expensesByEntity['Gheralta Airport Branch'] || 0) - (expensesByEntity['Corporate Office'] || 0),
      },
      {
        code: '4100', name: 'Room Revenue',
        entityA: 980000, entityB: 320000, entityC: 0,
        eliminations: 0,
      },
      {
        code: '4200', name: 'F&B Revenue',
        entityA: 540000, entityB: 180000, entityC: 0,
        eliminations: 0,
      },
      {
        code: '5100', name: 'Payroll Expenses',
        entityA: 280000, entityB: 95000, entityC: 55000,
        eliminations: 0,
      },
      {
        code: '5200', name: 'Operating Expenses',
        entityA: 140000, entityB: 90000, entityC: 40000,
        eliminations: 0,
      },
      {
        code: '1400', name: 'Intercompany Receivable',
        entityA: balances.filter(b => b.entity === 'Gheralta Main Property' && b.balance_type === 'Due From').reduce((s, b) => s + Number(b.amount), 0),
        entityB: balances.filter(b => b.entity === 'Gheralta Airport Branch' && b.balance_type === 'Due From').reduce((s, b) => s + Number(b.amount), 0),
        entityC: balances.filter(b => b.entity === 'Corporate Office' && b.balance_type === 'Due From').reduce((s, b) => s + Number(b.amount), 0),
        eliminations: -balances.filter(b => b.balance_type === 'Due From').reduce((s, b) => s + Number(b.amount), 0),
      },
      {
        code: '2400', name: 'Intercompany Payable',
        entityA: balances.filter(b => b.entity === 'Gheralta Main Property' && b.balance_type === 'Due To').reduce((s, b) => s + Number(b.amount), 0),
        entityB: balances.filter(b => b.entity === 'Gheralta Airport Branch' && b.balance_type === 'Due To').reduce((s, b) => s + Number(b.amount), 0),
        entityC: balances.filter(b => b.entity === 'Corporate Office' && b.balance_type === 'Due To').reduce((s, b) => s + Number(b.amount), 0),
        eliminations: -balances.filter(b => b.balance_type === 'Due To').reduce((s, b) => s + Number(b.amount), 0),
      },
    ].map(row => ({
      ...row,
      consolidated: row.entityA + row.entityB + row.entityC + row.eliminations,
    }));

    return {
      trialBalance,
      revenueByEntity,
      expensesByEntity,
      totalRevenue,
      totalExpenses,
      totalEliminations,
      consolidatedRevenue: totalRevenue - totalEliminations,
      consolidatedExpenses: totalExpenses - totalEliminations,
      consolidatedNetProfit: totalRevenue - totalExpenses,
    };
  }, [invoices, balances, eliminations]);

  // ── Action handlers ───────────────────────────────────────────────────

  const handleInvoiceStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateIntercompanyInvoice(id, { status });
      await loadAll();
      addNotification(`Invoice status updated to ${status}.`, 'success', 'Intercompany');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update status', 'error', 'Intercompany');
    }
  };

  const handleEliminationStatus = async (id: string, status: string) => {
    setActionMenuId(null);
    try {
      await updateIntercompanyElimination(id, { status });
      await loadAll();
      addNotification(`Elimination entry status updated to ${status}.`, 'success', 'Intercompany');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update status', 'error', 'Intercompany');
    }
  };

  const handleDelete = async (table: 'invoices' | 'balances' | 'eliminations', id: string) => {
    setActionMenuId(null);
    try {
      if (table === 'invoices') await deleteIntercompanyInvoice(id);
      else if (table === 'balances') await deleteIntercompanyBalance(id);
      else await deleteIntercompanyElimination(id);
      await loadAll();
      addNotification('Record deleted.', 'warning', 'Intercompany');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete', 'error', 'Intercompany');
    }
  };

  const handleCreate = async (type: TabKey) => {
    setSubmitting(true);
    try {
      const pid = currentPropertyId || undefined;
      if (type === 'invoices') {
        if (!invoiceForm.fromEntity || !invoiceForm.toEntity) { addNotification('From and To entities are required.', 'warning', 'Intercompany'); setSubmitting(false); return; }
        await createIntercompanyInvoice({ ...invoiceForm, propertyId: pid });
        setShowInvoiceModal(false);
        setInvoiceForm({ fromEntity: 'Gheralta Main Property', toEntity: 'Gheralta Airport Branch', transactionType: 'Service Charge', description: '', amount: 0 });
      } else if (type === 'balances') {
        if (!balanceForm.entity) { addNotification('Entity is required.', 'warning', 'Intercompany'); setSubmitting(false); return; }
        await createIntercompanyBalance({ ...balanceForm, propertyId: pid });
        setShowBalanceModal(false);
        setBalanceForm({ entity: 'Gheralta Airport Branch', balanceType: 'Due To', amount: 0, agingBucket: '0-30', referenceInvoice: '' });
      } else if (type === 'eliminations') {
        if (!eliminationForm.entity1 || !eliminationForm.entity2) { addNotification('Both entities are required.', 'warning', 'Intercompany'); setSubmitting(false); return; }
        await createIntercompanyElimination({ ...eliminationForm, propertyId: pid });
        setShowEliminationModal(false);
        setEliminationForm({ period: '2026-Q3', account: 'Intercompany Revenue', entity1: 'Gheralta Main Property', entity2: 'Gheralta Airport Branch', amount: 0, description: '' });
      }
      await loadAll();
      addNotification('Record created successfully.', 'success', 'Intercompany');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create record', 'error', 'Intercompany');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Status action menu ────────────────────────────────────────────────

  const StatusActions = ({ table, id, status }: { table: 'invoices' | 'eliminations'; id: string; status: string }) => (
    <div className="relative">
      <button onClick={() => setActionMenuId(actionMenuId === id ? null : id)}
        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
        <MoreVertical size={14} />
      </button>
      {actionMenuId === id && (
        <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[140px]">
          {status === 'Pending' && (
            <>
              <button onClick={() => table === 'invoices' ? handleInvoiceStatus(id, 'Approved') : handleEliminationStatus(id, 'Posted')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Check size={14} /> {table === 'invoices' ? 'Approve' : 'Post'}
              </button>
              {table === 'invoices' && (
                <button onClick={() => handleInvoiceStatus(id, 'Rejected')}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <XCircle size={14} /> Reject
                </button>
              )}
            </>
          )}
          {status === 'Approved' && table === 'invoices' && (
            <button onClick={() => handleInvoiceStatus(id, 'Posted')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
              <FileCheck size={14} /> Post to GL
            </button>
          )}
          {status !== 'Posted' && (
            <button onClick={() => handleDelete(table, id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ── Shared table styles ───────────────────────────────────────────────

  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdB = 'px-4 py-3.5 text-sm text-right font-bold text-slate-900 dark:text-white';

  // ── Modal helper ──────────────────────────────────────────────────────

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

  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';
  const selectCls = inputCls;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Intercompany Accounting"
        subtitle="Manage intercompany transactions, due to/from accounts, and elimination entries"
        icon={ArrowRightLeft}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadAll} className="p-2.5 border dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 transition-colors" title="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {/* Stat cards — per-tab KPIs rendered above the tab bar */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {activeTab === 'invoices' && (
            <>
              <StatCard title="Total Transactions" value={stats.totalTransactions} icon={Building2} tone="accent" />
              <StatCard title="Total Amount" value={formatAmount(stats.totalInvoiceAmount)} icon={DollarSign} tone="info" />
              <StatCard title="Pending" value={stats.pendingInvoices} icon={AlertTriangle} tone="warning" />
              <StatCard title="Posted" value={stats.postedInvoices} icon={CheckCircle2} tone="success" />
            </>
          )}
          {activeTab === 'balances' && (
            <>
              <StatCard title="Due To Balance" value={formatAmount(stats.dueTo)} icon={ArrowDownRight} tone="success" />
              <StatCard title="Due From Balance" value={formatAmount(stats.dueFrom)} icon={ArrowUpRight} tone="danger" />
              <StatCard title="Net Position" value={formatAmount(Math.abs(stats.netPosition))} icon={ArrowRightLeft} tone={stats.netPosition >= 0 ? 'success' : 'warning'} />
              <StatCard title="Total Accounts" value={balances.length} icon={Layers} tone="neutral" />
            </>
          )}
          {activeTab === 'eliminations' && (
            <>
              <StatCard title="Total Entries" value={eliminations.length} icon={Layers} tone="accent" />
              <StatCard title="Elimination Amount" value={formatAmount(stats.eliminationAmount)} icon={DollarSign} tone="info" />
              <StatCard title="Pending" value={stats.pendingEliminations} icon={AlertTriangle} tone="warning" />
              <StatCard title="Posted" value={stats.postedEliminations} icon={CheckCircle2} tone="success" />
            </>
          )}
          {activeTab === 'consolidated' && (
            <>
              <StatCard title="Consolidated Revenue" value={formatAmount(consolidatedData.consolidatedRevenue)} icon={DollarSign} tone="success" />
              <StatCard title="Consolidated Expenses" value={formatAmount(consolidatedData.consolidatedExpenses)} icon={ArrowDownRight} tone="danger" />
              <StatCard title="Consolidated Net Profit" value={formatAmount(consolidatedData.consolidatedNetProfit)} icon={ArrowUpRight} tone="info" />
              <StatCard title="Eliminations" value={formatAmount(consolidatedData.totalEliminations)} icon={BarChart3} tone="warning" />
            </>
          )}
        </div>
      )}

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

      {/* ═══ INVOICES TAB ═══ */}
      {!loading && activeTab === 'invoices' && (
        <SectionCard
          title="Intercompany Invoices"
          subtitle={`${filteredInvoices.length} invoice${filteredInvoices.length !== 1 ? 's' : ''}`}
          icon={FileText}
          actions={
            <button onClick={() => setShowInvoiceModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
              <Plus size={14} /> New Invoice
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                  <th className={th}>Invoice #</th>
                  <th className={th}>From Entity</th>
                  <th className={th}>To Entity</th>
                  <th className={th}>Type</th>
                  <th className={th}>Date</th>
                  <th className={th + ' text-right'}>Amount</th>
                  <th className={th}>Status</th>
                  <th className={th}>GL Ref</th>
                  <th className={th + ' text-right'}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                    <td className={td}><span className="font-mono text-xs text-indigo-500">{inv.invoice_number || '—'}</span></td>
                    <td className={td}><span className="font-medium text-slate-900 dark:text-white">{inv.from_entity}</span></td>
                    <td className={td}><span className="font-medium text-slate-900 dark:text-white">{inv.to_entity}</span></td>
                    <td className={td}><Badge tone="neutral">{inv.transaction_type}</Badge></td>
                    <td className={td}><span className="text-xs">{new Date(inv.invoice_date).toLocaleDateString()}</span></td>
                    <td className={tdB}>{formatAmount(Number(inv.amount))}</td>
                    <td className={td}><Badge tone={STATUS_COLORS[inv.status] || 'neutral'}>{inv.status}</Badge></td>
                    <td className={td}><span className="font-mono text-xs text-slate-500">{inv.gl_ref || '—'}</span></td>
                    <td className={tdR} onClick={e => e.stopPropagation()}>
                      <StatusActions table="invoices" id={inv.id} status={inv.status} />
                    </td>
                  </tr>
                ))}
                {filteredInvoices.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">No intercompany invoices found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ═══ BALANCES TAB ═══ */}
      {!loading && activeTab === 'balances' && (
        <>
          {/* Aging breakdown */}
          <SectionCard title="Aging Summary" subtitle="Due To / Due From by aging bucket" icon={Layers}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {AGING_BUCKETS.map(bucket => {
                const dueTo = balances.filter(b => b.balance_type === 'Due To' && b.aging_bucket === bucket).reduce((s, b) => s + Number(b.amount), 0);
                const dueFrom = balances.filter(b => b.balance_type === 'Due From' && b.aging_bucket === bucket).reduce((s, b) => s + Number(b.amount), 0);
                return (
                  <div key={bucket} className="bg-slate-50 dark:bg-slate-850 rounded-xl p-4 border border-slate-150 dark:border-slate-800">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{bucket} days</div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs"><span className="text-emerald-600">Due To</span><span className="font-bold">{formatAmount(dueTo)}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-rose-600">Due From</span><span className="font-bold">{formatAmount(dueFrom)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Due To / Due From Accounts"
            subtitle={`${filteredBalances.length} account${filteredBalances.length !== 1 ? 's' : ''}`}
            icon={ArrowRightLeft}
            actions={
              <button onClick={() => setShowBalanceModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
                <Plus size={14} /> New Balance
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                    <th className={th}>Entity</th>
                    <th className={th}>Type</th>
                    <th className={th + ' text-right'}>Amount</th>
                    <th className={th}>Aging</th>
                    <th className={th}>Reference</th>
                    <th className={th}>Last Activity</th>
                    <th className={th + ' text-right'}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredBalances.map(b => (
                    <tr key={b.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className={td}><span className="font-medium text-slate-900 dark:text-white">{b.entity}</span></td>
                      <td className={td}><Badge tone={b.balance_type === 'Due To' ? 'success' : 'danger'}>{b.balance_type}</Badge></td>
                      <td className={tdB}>{formatAmount(Number(b.amount))}</td>
                      <td className={td}><Badge tone={b.aging_bucket === '0-30' ? 'success' : b.aging_bucket === '31-60' ? 'warning' : 'danger'}>{b.aging_bucket}</Badge></td>
                      <td className={td}><span className="font-mono text-xs text-indigo-500">{b.reference_invoice || '—'}</span></td>
                      <td className={td}><span className="text-xs text-slate-500">{b.last_activity || '—'}</span></td>
                      <td className={tdR}>
                        <button onClick={() => handleDelete('balances', b.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredBalances.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No due to/from accounts found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      {/* ═══ ELIMINATIONS TAB ═══ */}
      {!loading && activeTab === 'eliminations' && (
        <SectionCard
          title="Elimination Entries"
          subtitle={`${filteredEliminations.length} entr${filteredEliminations.length !== 1 ? 'ies' : 'y'}`}
          icon={Layers}
          actions={
            <button onClick={() => setShowEliminationModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
              <Plus size={14} /> New Entry
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                  <th className={th}>Entry #</th>
                  <th className={th}>Period</th>
                  <th className={th}>Account</th>
                  <th className={th}>Entity 1</th>
                  <th className={th}>Entity 2</th>
                  <th className={th + ' text-right'}>Amount</th>
                  <th className={th}>Status</th>
                  <th className={th + ' text-right'}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEliminations.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className={td}><span className="font-mono text-xs text-indigo-500">{e.entry_number || '—'}</span></td>
                    <td className={td}><Badge tone="info">{e.period}</Badge></td>
                    <td className={td}><span className="font-medium">{e.account}</span></td>
                    <td className={td}><span className="text-xs">{e.entity1}</span></td>
                    <td className={td}><span className="text-xs">{e.entity2}</span></td>
                    <td className={tdB}>{formatAmount(Number(e.amount))}</td>
                    <td className={td}><Badge tone={STATUS_COLORS[e.status] || 'neutral'}>{e.status}</Badge></td>
                    <td className={tdR}><StatusActions table="eliminations" id={e.id} status={e.status} /></td>
                  </tr>
                ))}
                {filteredEliminations.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No elimination entries found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ═══ CONSOLIDATED REPORTING TAB ═══ */}
      {!loading && activeTab === 'consolidated' && (
        <>
          <SectionCard
            title="Consolidated Trial Balance"
            subtitle="Multi-entity balances with intercompany eliminations"
            icon={BarChart3}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                    <th className={th}>Account Code</th>
                    <th className={th}>Account Name</th>
                    <th className={th + ' text-right'}>Entity A</th>
                    <th className={th + ' text-right'}>Entity B</th>
                    <th className={th + ' text-right'}>Entity C</th>
                    <th className={th + ' text-right'}>Eliminations</th>
                    <th className={th + ' text-right'}>Consolidated Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {consolidatedData.trialBalance.map(row => (
                    <tr key={row.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className={td}><span className="font-mono text-xs text-indigo-500">{row.code}</span></td>
                      <td className={td}><span className="font-medium text-slate-900 dark:text-white">{row.name}</span></td>
                      <td className={tdB}>{formatAmount(row.entityA)}</td>
                      <td className={tdB}>{formatAmount(row.entityB)}</td>
                      <td className={tdB}>{formatAmount(row.entityC)}</td>
                      <td className={tdB + ' text-rose-600 dark:text-rose-400'}>{formatAmount(row.eliminations)}</td>
                      <td className={tdB + ' text-indigo-600 dark:text-indigo-400'}>{formatAmount(row.consolidated)}</td>
                    </tr>
                  ))}
                  {consolidatedData.trialBalance.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No consolidated trial balance data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Consolidated Income Statement"
            subtitle="Revenue, eliminations, and net profit across entities"
            icon={FileText}
          >
            <div className="space-y-3">
              {/* Total Revenue by entity */}
              <div className="bg-slate-50 dark:bg-slate-850 rounded-xl p-4 border border-slate-150 dark:border-slate-800">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Total Revenue (by Entity)</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {Object.entries(consolidatedData.revenueByEntity).map(([entity, amount]) => (
                    <div key={entity} className="flex justify-between items-center bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-150 dark:border-slate-800">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{entity}</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{formatAmount(amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Income statement summary rows */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-150 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex justify-between items-center px-4 py-3.5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Total Revenue</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{formatAmount(consolidatedData.totalRevenue)}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3.5">
                  <span className="text-sm font-medium text-rose-600 dark:text-rose-400">Intercompany Eliminations</span>
                  <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{formatAmount(consolidatedData.totalEliminations)}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3.5 bg-emerald-50 dark:bg-emerald-900/10">
                  <span className="text-sm font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-tight">Consolidated Revenue</span>
                  <span className="text-sm font-black text-emerald-700 dark:text-emerald-400">{formatAmount(consolidatedData.consolidatedRevenue)}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3.5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Consolidated Expenses</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{formatAmount(consolidatedData.consolidatedExpenses)}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3.5 bg-indigo-50 dark:bg-indigo-900/10">
                  <span className="text-sm font-black text-indigo-700 dark:text-indigo-400 uppercase tracking-tight">Consolidated Net Profit</span>
                  <span className="text-base font-black text-indigo-700 dark:text-indigo-400">{formatAmount(consolidatedData.consolidatedNetProfit)}</span>
                </div>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {/* ═══ INVOICE DETAIL MODAL ═══ */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedInvoice(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{selectedInvoice.invoice_number}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Intercompany Transaction Details</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">From Entity</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{selectedInvoice.from_entity}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">To Entity</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{selectedInvoice.to_entity}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Transaction Type</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{selectedInvoice.transaction_type}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Date</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{new Date(selectedInvoice.invoice_date).toLocaleDateString()}</span>
                </div>
              </div>
              {selectedInvoice.description && (
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Description</span>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{selectedInvoice.description}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Amount</span>
                  <span className="text-2xl font-black text-indigo-600">{formatAmount(Number(selectedInvoice.amount))}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Status</span>
                  <Badge tone={STATUS_COLORS[selectedInvoice.status] || 'neutral'}>{selectedInvoice.status}</Badge>
                </div>
              </div>
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">GL Reference</span>
                <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{selectedInvoice.gl_ref || '—'}</span>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-slate-200 dark:border-slate-700">
              <button onClick={() => setSelectedInvoice(null)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Close</button>
              {selectedInvoice.status === 'Pending' && (
                <button onClick={async () => { await handleInvoiceStatus(selectedInvoice.id, 'Approved'); setSelectedInvoice(null); }}
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">Approve</button>
              )}
              {selectedInvoice.status === 'Approved' && (
                <button onClick={async () => { await handleInvoiceStatus(selectedInvoice.id, 'Posted'); setSelectedInvoice(null); }}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-emerald-700 transition-all">Post to GL</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CREATE MODALS ═══ */}

      {/* New Invoice Modal */}
      <Modal open={showInvoiceModal} onClose={() => setShowInvoiceModal(false)} title="New Intercompany Invoice" onSubmit={() => handleCreate('invoices')}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="From Entity">
            <select className={selectCls} value={invoiceForm.fromEntity} onChange={e => setInvoiceForm({ ...invoiceForm, fromEntity: e.target.value })}>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </FormField>
          <FormField label="To Entity">
            <select className={selectCls} value={invoiceForm.toEntity} onChange={e => setInvoiceForm({ ...invoiceForm, toEntity: e.target.value })}>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Transaction Type">
          <select className={selectCls} value={invoiceForm.transactionType} onChange={e => setInvoiceForm({ ...invoiceForm, transactionType: e.target.value })}>
            {TRANSACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Description (optional)">
          <input className={inputCls} value={invoiceForm.description} onChange={e => setInvoiceForm({ ...invoiceForm, description: e.target.value })} placeholder="Reason for intercompany charge" />
        </FormField>
        <FormField label="Amount">
          <input type="number" step="0.01" className={inputCls} value={invoiceForm.amount || ''} onChange={e => setInvoiceForm({ ...invoiceForm, amount: Number(e.target.value) })} />
        </FormField>
      </Modal>

      {/* New Balance Modal */}
      <Modal open={showBalanceModal} onClose={() => setShowBalanceModal(false)} title="New Due To / Due From Account" onSubmit={() => handleCreate('balances')}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Entity">
            <select className={selectCls} value={balanceForm.entity} onChange={e => setBalanceForm({ ...balanceForm, entity: e.target.value })}>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </FormField>
          <FormField label="Balance Type">
            <select className={selectCls} value={balanceForm.balanceType} onChange={e => setBalanceForm({ ...balanceForm, balanceType: e.target.value })}>
              {BALANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Amount">
            <input type="number" step="0.01" className={inputCls} value={balanceForm.amount || ''} onChange={e => setBalanceForm({ ...balanceForm, amount: Number(e.target.value) })} />
          </FormField>
          <FormField label="Aging Bucket">
            <select className={selectCls} value={balanceForm.agingBucket} onChange={e => setBalanceForm({ ...balanceForm, agingBucket: e.target.value })}>
              {AGING_BUCKETS.map(a => <option key={a} value={a}>{a} days</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Reference Invoice (optional)">
          <input className={inputCls} value={balanceForm.referenceInvoice} onChange={e => setBalanceForm({ ...balanceForm, referenceInvoice: e.target.value })} placeholder="e.g. IC-2026-001" />
        </FormField>
      </Modal>

      {/* New Elimination Modal */}
      <Modal open={showEliminationModal} onClose={() => setShowEliminationModal(false)} title="New Elimination Entry" onSubmit={() => handleCreate('eliminations')}>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Period">
            <input className={inputCls} value={eliminationForm.period} onChange={e => setEliminationForm({ ...eliminationForm, period: e.target.value })} placeholder="e.g. 2026-Q3" />
          </FormField>
          <FormField label="Account">
            <select className={selectCls} value={eliminationForm.account} onChange={e => setEliminationForm({ ...eliminationForm, account: e.target.value })}>
              {ELIM_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Entity 1">
            <select className={selectCls} value={eliminationForm.entity1} onChange={e => setEliminationForm({ ...eliminationForm, entity1: e.target.value })}>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </FormField>
          <FormField label="Entity 2">
            <select className={selectCls} value={eliminationForm.entity2} onChange={e => setEliminationForm({ ...eliminationForm, entity2: e.target.value })}>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Amount">
          <input type="number" step="0.01" className={inputCls} value={eliminationForm.amount || ''} onChange={e => setEliminationForm({ ...eliminationForm, amount: Number(e.target.value) })} />
        </FormField>
        <FormField label="Description (optional)">
          <input className={inputCls} value={eliminationForm.description} onChange={e => setEliminationForm({ ...eliminationForm, description: e.target.value })} placeholder="Reason for elimination" />
        </FormField>
      </Modal>
    </div>
  );
};

export default IntercompanyAccounting;
