import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingDown, DollarSign, Receipt, RefreshCw, Download, Loader2, ServerCrash,
  Wallet, Zap, Wrench, Megaphone, Shield, Package, UtensilsCrossed, Wine,
  WashingMachine, FileText, Clock, CheckCircle2, XCircle, Repeat, Calendar,
  Layers, User, Check, X, PieChart, Plus,
} from 'lucide-react';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { useERP } from '../../context/ERPContext';
import {
  fetchExpenseRequests, fetchExpenseClaims, fetchApprovalWorkflows, fetchRecurringExpenses,
  updateExpenseRequestStatus, updateExpenseClaimStatus,
  type ExpenseRequest, type ExpenseClaim, type ApprovalWorkflow, type RecurringExpense,
} from '../../services/expenseManagementService';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const CATEGORY_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  payroll:        { label: 'Payroll',         icon: Wallet },
  'Payroll':      { label: 'Payroll',         icon: Wallet },
  utilities:      { label: 'Utilities',       icon: Zap },
  'Utilities':    { label: 'Utilities',       icon: Zap },
  maintenance:    { label: 'Maintenance',     icon: Wrench },
  'Maintenance':  { label: 'Maintenance',     icon: Wrench },
  marketing:      { label: 'Marketing',       icon: Megaphone },
  'Marketing':    { label: 'Marketing',       icon: Megaphone },
  insurance:      { label: 'Insurance',       icon: Shield },
  'Insurance':    { label: 'Insurance',       icon: Shield },
  supplies:       { label: 'Office Supplies', icon: Package },
  'Office Supplies': { label: 'Office Supplies', icon: Package },
  food_cost:      { label: 'Food Cost',       icon: UtensilsCrossed },
  'Food Cost':    { label: 'Food Cost',       icon: UtensilsCrossed },
  beverage_cost:  { label: 'Beverage Cost',   icon: Wine },
  'Beverage Cost':{ label: 'Beverage Cost',   icon: Wine },
  laundry_cost:   { label: 'Laundry Cost',    icon: WashingMachine },
  'Laundry Cost': { label: 'Laundry Cost',    icon: WashingMachine },
  other:          { label: 'Other',           icon: FileText },
  'Other':        { label: 'Other',           icon: FileText },
  'Inventory Receipt': { label: 'Inventory Receipt', icon: Package },
};

// ── Expense Allocation (spec §12) ─────────────────────────────────────────
interface ExpenseAllocation {
  id: string;
  expense_id: string;
  expense_description: string;
  department: string;
  cost_center: string;
  profit_center: string;
  project: string;
  allocation_pct: number;
  allocated_amount: number;
  period: string;
}

const COST_CENTERS = ['CC-100 Operations', 'CC-200 Kitchen', 'CC-300 Sales', 'CC-400 Admin', 'CC-500 Maintenance'];
const PROFIT_CENTERS = ['PC-Rooms', 'PC-F&B', 'PC-Events', 'PC-Spa', 'PC-Retail'];
const PROJECTS = ['PRJ-001 Renovation', 'PRJ-002 Marketing Campaign', 'PRJ-003 IT Upgrade', 'PRJ-004 Staff Training', '—'];

const ExpenseManagement = () => {
  const { currentPropertyId, properties, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'expenses' | 'claims' | 'approvals' | 'recurring' | 'allocation'>('expenses');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expenses, setExpenses] = useState<ExpenseRequest[]>([]);
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [customAllocations, setCustomAllocations] = useState<ExpenseAllocation[]>([]);

  // ── Derived expense allocations (spec §12) ──────────────────────────────
  const allocations: ExpenseAllocation[] = useMemo(() => {
    const derived: ExpenseAllocation[] = expenses.map((e, idx) => ({
      id: `alloc-${e.id}`,
      expense_id: e.id,
      expense_description: e.description,
      department: e.department || '—',
      cost_center: COST_CENTERS[idx % COST_CENTERS.length],
      profit_center: PROFIT_CENTERS[idx % PROFIT_CENTERS.length],
      project: PROJECTS[idx % PROJECTS.length],
      allocation_pct: 100,
      allocated_amount: e.amount,
      period: e.request_date ? e.request_date.slice(0, 7) : '—',
    }));
    return [...derived, ...customAllocations];
  }, [expenses, customAllocations]);

  const handleAddAllocation = () => {
    const newAlloc: ExpenseAllocation = {
      id: `alloc-new-${Date.now()}`,
      expense_id: '—',
      expense_description: 'New Expense Allocation',
      department: '—',
      cost_center: COST_CENTERS[0],
      profit_center: PROFIT_CENTERS[0],
      project: PROJECTS[0],
      allocation_pct: 100,
      allocated_amount: 0,
      period: new Date().toISOString().slice(0, 7),
    };
    setCustomAllocations(prev => [...prev, newAlloc]);
  };

  const handleDeleteAllocation = (id: string) => {
    setCustomAllocations(prev => prev.filter(a => a.id !== id));
  };

  // ── Approve / Reject handlers (spec §12) ────────────────────────────────
  const handleExpenseStatus = async (id: string, status: 'Approved' | 'Rejected') => {
    try {
      await updateExpenseRequestStatus(id, status);
      setExpenses(prev => prev.map(e => (e.id === id ? { ...e, status } : e)));
      addNotification?.(`Expense ${id} ${status.toLowerCase()}.`, status === 'Approved' ? 'success' : 'warning', 'Finance');
    } catch (err: any) {
      addNotification?.(err?.message || 'Failed to update expense status', 'warning', 'Finance');
    }
  };

  const handleClaimStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await updateExpenseClaimStatus(id, status);
      setClaims(prev => prev.map(c => (c.id === id ? { ...c, status, approved_date: new Date().toISOString().slice(0, 10) } : c)));
      addNotification?.(`Claim ${id} ${status}.`, status === 'approved' ? 'success' : 'warning', 'Finance');
    } catch (err: any) {
      addNotification?.(err?.message || 'Failed to update claim status', 'warning', 'Finance');
    }
  };

  const propertyName = useCallback((id?: string | null): string => {
    if (!id) return '—';
    const p = properties.find(p => p.id === id);
    return p?.property_name || '—';
  }, [properties]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [e, c, w, r] = await Promise.all([
        fetchExpenseRequests(pid),
        fetchExpenseClaims(pid),
        fetchApprovalWorkflows(pid),
        fetchRecurringExpenses(pid),
      ]);
      setExpenses(e);
      setClaims(c);
      setWorkflows(w);
      setRecurring(r);
    } catch (err: any) {
      console.error('Error loading expense data:', err);
      setError(err.message || 'Failed to load expense data');
    } finally {
      setLoading(false);
    }
  };

  // ── CSV export helper ───────────────────────────────────────────────────
  const exportToCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escape = (val: string | number) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addNotification?.(`Exported ${rows.length} record${rows.length !== 1 ? 's' : ''} to ${filename}.`, 'success', 'Finance');
  };

  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    let filename = `expense_${activeTab}_${stamp}.csv`;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    if (activeTab === 'expenses') {
      headers = ['ID', 'Date', 'Department', 'Category', 'Description', 'Requested By', 'Amount', 'Priority', 'Status', 'Property'];
      rows = expenses.map(e => [e.id, e.request_date, e.department, e.category, e.description, e.requested_by, e.amount, e.priority, e.status, e.property_name || propertyName(e.property_id)]);
    } else if (activeTab === 'claims') {
      headers = ['ID', 'Employee', 'Category', 'Description', 'Amount', 'Receipts', 'Submitted', 'Approved By', 'Approved Date', 'Status', 'Property'];
      rows = claims.map(c => [c.id, c.employee_name, c.category, c.description, c.amount, c.receipts_count, c.submitted_date, c.approved_by || '', c.approved_date || '', c.status, c.property_name || propertyName(c.property_id)]);
    } else if (activeTab === 'approvals') {
      headers = ['ID', 'Workflow', 'Category', 'Min Amount', 'Max Amount', 'Approver 1', 'Approver 2', 'Auto-Approve Below', 'Status', 'Property'];
      rows = workflows.map(w => [w.id, w.workflow_name, w.category || 'All', w.min_amount, w.max_amount, w.approver_level1, w.approver_level2 || '', w.auto_approve_below, w.status, w.property_name || propertyName(w.property_id)]);
    } else if (activeTab === 'recurring') {
      headers = ['ID', 'Description', 'Category', 'Vendor', 'Department', 'Amount', 'Frequency', 'Next Date', 'Status', 'Property'];
      rows = recurring.map(r => [r.id, r.description, r.category, r.vendor || '', r.department || '', r.amount, r.frequency, r.next_date, r.status, r.property_name || propertyName(r.property_id)]);
    } else if (activeTab === 'allocation') {
      headers = ['ID', 'Expense ID', 'Expense', 'Department', 'Cost Center', 'Profit Center', 'Project', 'Allocation %', 'Allocated Amount', 'Period'];
      rows = allocations.map(a => [a.id, a.expense_id, a.expense_description, a.department, a.cost_center, a.profit_center, a.project, a.allocation_pct, a.allocated_amount, a.period]);
    }
    exportToCsv(filename, headers, rows);
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  // ── Derived KPIs ────────────────────────────────────────────────────────
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const pendingExpenses = expenses.filter(e => e.status === 'Under Review').reduce((s, e) => s + e.amount, 0);
  const approvedExpenses = expenses.filter(e => e.status === 'Approved').reduce((s, e) => s + e.amount, 0);
  const paidExpenses = expenses.filter(e => e.status === 'Paid').reduce((s, e) => s + e.amount, 0);

  const pendingClaims = claims.filter(c => c.status === 'pending');
  const totalPendingClaims = pendingClaims.reduce((s, c) => s + c.amount, 0);

  const activeWorkflows = workflows.filter(w => w.status === 'Active').length;
  const activeRecurring = recurring.filter(r => r.status === 'Active');
  const totalRecurringMonthly = activeRecurring.filter(r => r.frequency === 'Monthly').reduce((s, r) => s + r.amount, 0);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Expense Management"
        subtitle="Track, approve, and manage all organizational expenses."
        icon={Receipt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={handleExport} className={button.primary}>
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        }
      />

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadData} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-500 text-sm">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading expense data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab */}
          {activeTab === 'expenses' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Expenses" value={fmt(totalExpenses)} icon={TrendingDown} tone="danger" />
              <StatCard title="Under Review" value={fmt(pendingExpenses)} icon={Clock} tone="warning" />
              <StatCard title="Approved" value={fmt(approvedExpenses)} icon={CheckCircle2} tone="success" />
              <StatCard title="Paid" value={fmt(paidExpenses)} icon={DollarSign} tone="info" />
            </div>
          )}
          {activeTab === 'claims' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Pending Claims" value={pendingClaims.length} icon={Clock} tone="warning" />
              <StatCard title="Pending Amount" value={fmt(totalPendingClaims)} icon={DollarSign} tone="danger" />
              <StatCard title="Approved" value={claims.filter(c => c.status === 'approved').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Total Claims" value={claims.length} icon={Layers} tone="info" />
            </div>
          )}
          {activeTab === 'approvals' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Active Workflows" value={activeWorkflows} icon={CheckCircle2} tone="success" />
              <StatCard title="Total Workflows" value={workflows.length} icon={Layers} tone="info" />
              <StatCard title="Auto-Approve Rules" value={workflows.filter(w => w.auto_approve_below > 0).length} icon={Zap} tone="accent" />
              <StatCard title="Inactive" value={workflows.filter(w => w.status === 'Inactive').length} icon={XCircle} tone="neutral" />
            </div>
          )}
          {activeTab === 'recurring' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Active Recurring" value={activeRecurring.length} icon={Repeat} tone="success" />
              <StatCard title="Monthly Recurring" value={fmt(totalRecurringMonthly)} icon={Calendar} tone="danger" />
              <StatCard title="Paused" value={recurring.filter(r => r.status === 'Paused').length} icon={Clock} tone="warning" />
              <StatCard title="Total Schedules" value={recurring.length} icon={Layers} tone="info" />
            </div>
          )}
          {activeTab === 'allocation' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Allocations" value={allocations.length} icon={PieChart} tone="info" />
              <StatCard title="Allocated Amount" value={fmt(allocations.reduce((s, a) => s + a.allocated_amount, 0))} icon={DollarSign} tone="danger" />
              <StatCard title="Departments" value={new Set(allocations.map(a => a.department)).size} icon={Layers} tone="accent" />
              <StatCard title="Cost Centers" value={new Set(allocations.map(a => a.cost_center)).size} icon={PieChart} tone="success" />
            </div>
          )}

          {/* Sub-tab nav */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['expenses', 'Expense Register'],
              ['claims', 'Expense Claims'],
              ['approvals', 'Approvals'],
              ['recurring', 'Recurring Expenses'],
              ['allocation', 'Allocation'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  activeTab === key
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Expense Register ── */}
          {activeTab === 'expenses' && (
            <SectionCard
              title="Expense Register"
              subtitle="All organizational expense requests"
              icon={Receipt}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'request_date', label: 'Date', render: (e: ExpenseRequest) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Calendar size={12} /></div>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{e.request_date}</span>
                    </div>
                  ) },
                  { key: 'category', label: 'Category', render: (e: ExpenseRequest) => {
                    const meta = CATEGORY_META[e.category] || CATEGORY_META.other;
                    const Icon = meta.icon;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-rose-50 dark:bg-rose-500/10 text-rose-600 rounded-lg"><Icon size={12} /></div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{meta.label}</span>
                          {e.subcategory && <span className="text-[10px] text-slate-400 font-medium">{e.subcategory}</span>}
                        </div>
                      </div>
                    );
                  } },
                  { key: 'description', label: 'Description', render: (e: ExpenseRequest) => (
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-slate-900 dark:text-white">{e.description}</span>
                      {e.supplier_name && <span className="text-[10px] text-slate-400 font-medium">{e.supplier_name}</span>}
                    </div>
                  ) },
                  { key: 'department', label: 'Department', render: (e: ExpenseRequest) => <span className="text-xs font-medium text-slate-500">{e.department}</span> },
                  { key: 'requested_by', label: 'Requested By', render: (e: ExpenseRequest) => <span className="text-xs font-medium text-slate-500">{e.requested_by}</span> },
                  { key: 'amount', label: 'Amount', align: 'right' as const, render: (e: ExpenseRequest) => <span className="text-xs font-bold text-rose-600">{fmt(e.amount)}</span> },
                  { key: 'priority', label: 'Priority', align: 'center' as const, render: (e: ExpenseRequest) => {
                    const tone: StatusTone = e.priority === 'Urgent' ? 'danger' : e.priority === 'High' ? 'warning' : e.priority === 'Medium' ? 'info' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{e.priority}</Badge></div>;
                  } },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (e: ExpenseRequest) => {
                    const tone: StatusTone = e.status === 'Paid' ? 'info' : e.status === 'Approved' ? 'success' : e.status === 'Under Review' ? 'warning' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{e.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (e: ExpenseRequest) => <span className="text-xs font-medium text-slate-500">{e.property_name || propertyName(e.property_id)}</span> },
                  { key: 'actions', label: 'Actions', align: 'center' as const, render: (e: ExpenseRequest) => {
                    if (e.status !== 'Under Review' && e.status !== 'Pending') return <span className="text-xs text-slate-400">—</span>;
                    return (
                      <div className="flex items-center gap-1 justify-center">
                        <button onClick={() => handleExpenseStatus(e.id, 'Approved')} className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-emerald-700 transition-colors flex items-center gap-1">
                          <Check size={12} /> Approve
                        </button>
                        <button onClick={() => handleExpenseStatus(e.id, 'Rejected')} className="px-2.5 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-red-700 transition-colors flex items-center gap-1">
                          <X size={12} /> Reject
                        </button>
                      </div>
                    );
                  } },
                ] as Column<ExpenseRequest>[]}
                data={expenses}
                rowKey={(e) => e.id}
                sortable
                filterable
                filterPlaceholder="Search expenses..."
                filterKeys={['description', 'category', 'department', 'status', 'requested_by', 'supplier_name', 'property_name']}
                emptyMessage="No expense requests found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Expense Claims ── */}
          {activeTab === 'claims' && (
            <SectionCard
              title="Expense Claims"
              subtitle="Employee-submitted expense reimbursement claims"
              icon={User}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'employee_name', label: 'Employee', render: (c: ExpenseClaim) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><User size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{c.employee_name}</span>
                    </div>
                  ) },
                  { key: 'category', label: 'Category', render: (c: ExpenseClaim) => <span className="text-xs font-medium text-slate-500 capitalize">{c.category || '—'}</span> },
                  { key: 'description', label: 'Description', render: (c: ExpenseClaim) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.description}</span> },
                  { key: 'amount', label: 'Amount', align: 'right' as const, render: (c: ExpenseClaim) => <span className="text-xs font-bold text-rose-600">{fmt(c.amount)}</span> },
                  { key: 'receipts_count', label: 'Receipts', align: 'center' as const, render: (c: ExpenseClaim) => <span className="text-xs font-medium text-slate-500">{c.receipts_count}</span> },
                  { key: 'submitted_date', label: 'Submitted', render: (c: ExpenseClaim) => <span className="text-xs font-medium text-slate-500">{c.submitted_date}</span> },
                  { key: 'approved_by', label: 'Approved By', render: (c: ExpenseClaim) => <span className="text-xs font-medium text-slate-500">{c.approved_by || '—'}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (c: ExpenseClaim) => {
                    const tone: StatusTone = c.status === 'paid' ? 'info' : c.status === 'approved' ? 'success' : c.status === 'pending' ? 'warning' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{c.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (c: ExpenseClaim) => <span className="text-xs font-medium text-slate-500">{c.property_name || propertyName(c.property_id)}</span> },
                  { key: 'actions', label: 'Actions', align: 'center' as const, render: (c: ExpenseClaim) => {
                    if (c.status !== 'pending') return <span className="text-xs text-slate-400">—</span>;
                    return (
                      <div className="flex items-center gap-1 justify-center">
                        <button onClick={() => handleClaimStatus(c.id, 'approved')} className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-emerald-700 transition-colors flex items-center gap-1">
                          <Check size={12} /> Approve
                        </button>
                        <button onClick={() => handleClaimStatus(c.id, 'rejected')} className="px-2.5 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-red-700 transition-colors flex items-center gap-1">
                          <X size={12} /> Reject
                        </button>
                      </div>
                    );
                  } },
                ] as Column<ExpenseClaim>[]}
                data={claims}
                rowKey={(c) => c.id}
                sortable
                filterable
                filterPlaceholder="Search claims..."
                filterKeys={['employee_name', 'category', 'description', 'status', 'property_name']}
                emptyMessage="No expense claims found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Approval Workflows ── */}
          {activeTab === 'approvals' && (
            <SectionCard
              title="Approval Workflows"
              subtitle="Expense approval rules by amount threshold"
              icon={CheckCircle2}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'workflow_name', label: 'Workflow', render: (w: ApprovalWorkflow) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-lg"><CheckCircle2 size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{w.workflow_name}</span>
                    </div>
                  ) },
                  { key: 'category', label: 'Category', render: (w: ApprovalWorkflow) => <span className="text-xs font-medium text-slate-500 capitalize">{w.category || 'All'}</span> },
                  { key: 'min_amount', label: 'Min Amount', align: 'right' as const, render: (w: ApprovalWorkflow) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(w.min_amount)}</span> },
                  { key: 'max_amount', label: 'Max Amount', align: 'right' as const, render: (w: ApprovalWorkflow) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(w.max_amount)}</span> },
                  { key: 'approver_level1', label: 'Approver 1', render: (w: ApprovalWorkflow) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{w.approver_level1}</span> },
                  { key: 'approver_level2', label: 'Approver 2', render: (w: ApprovalWorkflow) => <span className="text-xs font-medium text-slate-500">{w.approver_level2 || '—'}</span> },
                  { key: 'auto_approve_below', label: 'Auto-Approve Below', align: 'right' as const, render: (w: ApprovalWorkflow) => (
                    <span className="text-xs font-bold text-blue-600">{w.auto_approve_below > 0 ? fmt(w.auto_approve_below) : '—'}</span>
                  ) },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (w: ApprovalWorkflow) => {
                    const tone: StatusTone = w.status === 'Active' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{w.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (w: ApprovalWorkflow) => <span className="text-xs font-medium text-slate-500">{w.property_name || propertyName(w.property_id)}</span> },
                ] as Column<ApprovalWorkflow>[]}
                data={workflows}
                rowKey={(w) => w.id}
                sortable
                filterable
                filterPlaceholder="Search workflows..."
                filterKeys={['workflow_name', 'category', 'approver_level1', 'status', 'property_name']}
                emptyMessage="No approval workflows found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Recurring Expenses ── */}
          {activeTab === 'recurring' && (
            <SectionCard
              title="Recurring Expenses"
              subtitle="Scheduled and automated recurring expense payments"
              icon={Repeat}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'description', label: 'Description', render: (r: RecurringExpense) => {
                    const meta = CATEGORY_META[r.category] || CATEGORY_META.other;
                    const Icon = meta.icon;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{r.description}</span>
                      </div>
                    );
                  } },
                  { key: 'category', label: 'Category', render: (r: RecurringExpense) => <span className="text-xs font-medium text-slate-500">{CATEGORY_META[r.category]?.label || r.category}</span> },
                  { key: 'vendor', label: 'Vendor', render: (r: RecurringExpense) => <span className="text-xs font-medium text-slate-500">{r.vendor || '—'}</span> },
                  { key: 'department', label: 'Department', render: (r: RecurringExpense) => <span className="text-xs font-medium text-slate-500">{r.department || '—'}</span> },
                  { key: 'amount', label: 'Amount', align: 'right' as const, render: (r: RecurringExpense) => <span className="text-xs font-bold text-rose-600">{fmt(r.amount)}</span> },
                  { key: 'frequency', label: 'Frequency', align: 'center' as const, render: (r: RecurringExpense) => {
                    const tone: StatusTone = r.frequency === 'Daily' ? 'danger' : r.frequency === 'Weekly' ? 'warning' : r.frequency === 'Monthly' ? 'info' : r.frequency === 'Quarterly' ? 'accent' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{r.frequency}</Badge></div>;
                  } },
                  { key: 'next_date', label: 'Next Date', render: (r: RecurringExpense) => (
                    <div className="flex items-center gap-1">
                      <Calendar size={12} className="text-slate-400" />
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{r.next_date}</span>
                    </div>
                  ) },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (r: RecurringExpense) => {
                    const tone: StatusTone = r.status === 'Active' ? 'success' : r.status === 'Paused' ? 'warning' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{r.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (r: RecurringExpense) => <span className="text-xs font-medium text-slate-500">{r.property_name || propertyName(r.property_id)}</span> },
                ] as Column<RecurringExpense>[]}
                data={recurring}
                rowKey={(r) => r.id}
                sortable
                filterable
                filterPlaceholder="Search recurring expenses..."
                filterKeys={['description', 'category', 'vendor', 'department', 'frequency', 'status', 'property_name']}
                emptyMessage="No recurring expenses found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Expense Allocation (spec §12) ── */}
          {activeTab === 'allocation' && (
            <SectionCard
              title="Expense Allocation"
              subtitle="Allocate expenses to cost centers, departments, and projects"
              icon={PieChart}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              actions={
                <button onClick={handleAddAllocation} className={button.primary + ' flex items-center gap-1.5'}>
                  <Plus className="w-4 h-4" /> Add Allocation
                </button>
              }
            >
              <DataTable
                columns={[
                  { key: 'expense_description', label: 'Expense', render: (a: ExpenseAllocation) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-violet-50 dark:bg-violet-500/10 text-violet-600 rounded-lg"><PieChart size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{a.expense_description}</span>
                    </div>
                  ) },
                  { key: 'department', label: 'Department', render: (a: ExpenseAllocation) => <span className="text-xs font-medium text-slate-500">{a.department}</span> },
                  { key: 'cost_center', label: 'Cost Center', render: (a: ExpenseAllocation) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.cost_center}</span> },
                  { key: 'profit_center', label: 'Profit Center', render: (a: ExpenseAllocation) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.profit_center}</span> },
                  { key: 'project', label: 'Project', render: (a: ExpenseAllocation) => <span className="text-xs font-medium text-slate-500">{a.project}</span> },
                  { key: 'allocation_pct', label: 'Allocation %', align: 'right' as const, render: (a: ExpenseAllocation) => (
                    <span className="text-xs font-bold text-blue-600">{a.allocation_pct}%</span>
                  ) },
                  { key: 'allocated_amount', label: 'Allocated Amount', align: 'right' as const, render: (a: ExpenseAllocation) => <span className="text-xs font-bold text-rose-600">{fmt(a.allocated_amount)}</span> },
                  { key: 'period', label: 'Period', align: 'center' as const, render: (a: ExpenseAllocation) => (
                    <div className="flex items-center justify-center gap-1">
                      <Calendar size={12} className="text-slate-400" />
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.period}</span>
                    </div>
                  ) },
                  { key: 'actions', label: 'Actions', align: 'center' as const, render: (a: ExpenseAllocation) => (
                    <div className="flex items-center gap-1 justify-center">
                      <button onClick={() => handleDeleteAllocation(a.id)} className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-black uppercase hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex items-center gap-1">
                        <X size={12} /> Remove
                      </button>
                    </div>
                  ) },
                ] as Column<ExpenseAllocation>[]}
                data={allocations}
                rowKey={(a) => a.id}
                sortable
                filterable
                filterPlaceholder="Search allocations..."
                filterKeys={['expense_description', 'department', 'cost_center', 'profit_center', 'project', 'period']}
                emptyMessage="No expense allocations found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
};

export default ExpenseManagement;
