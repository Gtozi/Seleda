import React, { useState, useEffect, useCallback } from 'react';
import {
  PiggyBank, Target, TrendingUp, TrendingDown, BarChart3, AlertCircle, RefreshCw,
  Download, Loader2, ServerCrash, Plus, CheckCircle2, XCircle, ArrowRightLeft,
  Wallet, Percent, Layers, Building2, Calendar, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine,
} from 'recharts';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { useERP } from '../../context/ERPContext';
import {
  fetchBudgetEntries, fetchBudgetTypes, fetchBudgetForecasts, fetchBudgetTransfers,
  fetchPendingApprovals, createBudgetEntry,
  type BudgetEntry, type BudgetType, type BudgetForecast, type BudgetTransfer,
} from '../../services/budgetingService';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

const DEPT_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  'Front Office': Building2,
  'F&B': PiggyBank,
  'Housekeeping': Layers,
  'Engineering': AlertCircle,
  'Sales': TrendingUp,
  'Spa': Percent,
  'IT': ServerCrash,
  'HR': Wallet,
  'Administration': Wallet,
  'Marketing': Target,
  'Retail': Target,
};

const BudgetAnalysis = () => {
  const { currentPropertyId, properties, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'entries' | 'types' | 'forecast' | 'rolling_forecast' | 'transfer' | 'approval' | 'revision'>('entries');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewBudget, setShowNewBudget] = useState(false);
  const [newBudgetForm, setNewBudgetForm] = useState({
    budgetName: '', period: new Date().getFullYear() + '-Q' + Math.ceil((new Date().getMonth() + 1) / 3),
    accountCode: '', department: 'Front Office', budgetedAmount: 0,
    budgetType: 'Operating',
  });

  const [budgets, setBudgets] = useState<BudgetEntry[]>([]);
  const [types, setTypes] = useState<BudgetType[]>([]);
  const [forecasts, setForecasts] = useState<BudgetForecast[]>([]);
  const [transfers, setTransfers] = useState<BudgetTransfer[]>([]);
  const [approvals, setApprovals] = useState<BudgetEntry[]>([]);

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
      const [b, t, f, tr, ap] = await Promise.all([
        fetchBudgetEntries(pid),
        fetchBudgetTypes(pid),
        fetchBudgetForecasts(pid),
        fetchBudgetTransfers(pid),
        fetchPendingApprovals(pid),
      ]);
      setBudgets(b);
      setTypes(t);
      setForecasts(f);
      setTransfers(tr);
      setApprovals(ap);
    } catch (err: any) {
      console.error('Error loading budget data:', err);
      setError(err.message || 'Failed to load budget data');
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
    let filename = `budget_${activeTab}_${stamp}.csv`;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    if (activeTab === 'entries' || activeTab === 'approval' || activeTab === 'revision') {
      headers = ['ID', 'Budget Name', 'Period', 'Department', 'Account Code', 'Budgeted', 'Actual', 'Variance', 'Variance %', 'Version', 'Property'];
      const data = activeTab === 'entries' ? budgets : activeTab === 'approval' ? approvals : budgets;
      rows = data.map(b => [b.id, b.budget_name, b.period, b.department || '', b.account_code, b.budgeted_amount, b.actual_amount, b.variance, b.variance_percent, b.version, b.property_name || propertyName(b.property_id)]);
    } else if (activeTab === 'types') {
      headers = ['ID', 'Code', 'Name', 'Description', 'Entries', 'Status', 'Property'];
      rows = types.map(t => [t.id, t.code, t.name, t.description || '', t.entry_count, t.status, t.property_name || propertyName(t.property_id)]);
    } else if (activeTab === 'forecast' || activeTab === 'rolling_forecast') {
      headers = ['ID', 'Department', 'Q3/Month+1', 'Q4/Month+2', 'FY/12-Month Total', 'Trend', 'Confidence', 'Period', 'Property'];
      rows = forecasts.map(f => [f.id, f.department, f.q3_forecast, f.q4_forecast, f.fy_total, f.trend, f.confidence, f.period || '', f.property_name || propertyName(f.property_id)]);
    } else if (activeTab === 'transfer') {
      headers = ['ID', 'Transfer Number', 'From', 'To', 'Amount', 'Date', 'Reason', 'Status', 'Property'];
      rows = transfers.map(t => [t.id, t.transfer_number, t.from_department, t.to_department, t.amount, t.transfer_date || '', t.reason || '', t.status, t.property_name || propertyName(t.property_id)]);
    }
    exportToCsv(filename, headers, rows);
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  const handleCreateBudget = async () => {
    try {
      await createBudgetEntry(newBudgetForm);
      setShowNewBudget(false);
      setNewBudgetForm({
        budgetName: '', period: new Date().getFullYear() + '-Q' + Math.ceil((new Date().getMonth() + 1) / 3),
        accountCode: '', department: 'Front Office', budgetedAmount: 0,
        budgetType: 'Operating',
      });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create budget entry');
    }
  };

  const handleApprovalAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      await fetch(`/api/budgeting/approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update approval');
    }
  };

  // ── Derived KPIs ────────────────────────────────────────────────────────
  const totalBudget = budgets.reduce((s, b) => s + b.budgeted_amount, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actual_amount, 0);
  const totalVariance = totalActual - totalBudget;
  const utilization = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;

  const chartData = budgets
    .filter(b => b.actual_amount > 0 || b.budgeted_amount > 0)
    .map(b => ({
      name: b.department || b.budget_name || b.account_code,
      budget: b.budgeted_amount,
      actual: b.actual_amount,
      var: b.actual_amount - b.budgeted_amount,
    }));

  const totalForecastQ3 = forecasts.reduce((s, f) => s + f.q3_forecast, 0);
  const totalForecastQ4 = forecasts.reduce((s, f) => s + f.q4_forecast, 0);
  const totalForecastFY = forecasts.reduce((s, f) => s + f.fy_total, 0);
  const avgConfidence = forecasts.length ? forecasts.reduce((s, f) => s + f.confidence, 0) / forecasts.length : 0;

  const pendingTransfers = transfers.filter(t => t.status === 'Pending').length;
  const approvedTransfers = transfers.filter(t => t.status === 'Approved').length;
  const totalTransferAmount = transfers.filter(t => t.status === 'Approved').reduce((s, t) => s + t.amount, 0);

  const totalTypesEntries = types.reduce((s, t) => s + t.entry_count, 0);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Budgeting & Forecasting"
        subtitle="Budget entries, variance analysis, forecasts, transfers, and approvals."
        icon={PiggyBank}
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
            <span>Loading budget data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab */}
          {activeTab === 'entries' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Budget" value={fmt(totalBudget)} icon={Wallet} tone="info" />
              <StatCard title="Total Actual" value={fmt(totalActual)} icon={Target} tone="success" />
              <StatCard title="Variance" value={fmtSigned(totalVariance)} icon={totalVariance > 0 ? TrendingDown : TrendingUp} tone={totalVariance > 0 ? 'danger' : 'success'} />
              <StatCard title="Utilization" value={`${utilization.toFixed(1)}%`} icon={BarChart3} tone="accent" />
            </div>
          )}
          {activeTab === 'types' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Budget Types" value={types.length} icon={Layers} tone="info" />
              <StatCard title="Total Entries" value={totalTypesEntries} icon={PiggyBank} tone="accent" />
              <StatCard title="Active Types" value={types.filter(t => t.status === 'Active').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Inactive" value={types.filter(t => t.status === 'Inactive').length} icon={XCircle} tone="neutral" />
            </div>
          )}
          {activeTab === 'forecast' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Q3 Forecast" value={fmt(totalForecastQ3)} icon={TrendingUp} tone="success" />
              <StatCard title="Q4 Forecast" value={fmt(totalForecastQ4)} icon={Target} tone="info" />
              <StatCard title="FY Total" value={fmt(totalForecastFY)} icon={PiggyBank} tone="accent" />
              <StatCard title="Avg Confidence" value={`${avgConfidence.toFixed(0)}%`} icon={Percent} tone="warning" />
            </div>
          )}
          {activeTab === 'transfer' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Pending Transfers" value={pendingTransfers} icon={AlertCircle} tone="warning" />
              <StatCard title="Approved" value={approvedTransfers} icon={CheckCircle2} tone="success" />
              <StatCard title="Transfer Amount" value={fmt(totalTransferAmount)} icon={ArrowRightLeft} tone="info" />
              <StatCard title="Total Transfers" value={transfers.length} icon={Layers} tone="accent" />
            </div>
          )}
          {activeTab === 'approval' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Pending Approvals" value={approvals.length} icon={AlertCircle} tone="warning" />
              <StatCard title="Approved Budgets" value={budgets.filter(b => b.version === 'Approved').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Draft Budgets" value={budgets.filter(b => b.version === 'Draft').length} icon={Layers} tone="info" />
              <StatCard title="Rejected" value={budgets.filter(b => b.version === 'Rejected').length} icon={XCircle} tone="danger" />
            </div>
          )}

          {/* Sub-tab nav */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['entries', 'Budget Entries'],
              ['types', 'Budget Types'],
              ['forecast', 'Forecasting'],
              ['rolling_forecast', 'Rolling Forecast'],
              ['transfer', 'Transfers'],
              ['approval', 'Approvals'],
              ['revision', 'Revisions'],
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

          {/* ── Budget Entries ── */}
          {activeTab === 'entries' && (
            <>
              {chartData.length > 0 && (
                <SectionCard
                  title="Departmental Budget Variance"
                  subtitle="Variance Analysis (Actual vs Allocated)"
                  icon={BarChart3}
                >
                  <div className="flex gap-4 mb-4">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-[10px] font-bold text-slate-500">Under Budget</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-rose-500" />
                      <span className="text-[10px] font-bold text-slate-500">Over Budget</span>
                    </div>
                  </div>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} fontWeight={700} tick={{ fill: '#94a3b8' }} />
                        <YAxis axisLine={false} tickLine={false} fontSize={10} fontWeight={700} tick={{ fill: '#94a3b8' }} tickFormatter={(v) => `$${v / 1000}k`} />
                        <Tooltip
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          cursor={{ fill: '#f8fafc' }}
                        />
                        <ReferenceLine y={0} stroke="#cbd5e1" />
                        <Bar dataKey="var" radius={[4, 4, 0, 0]} barSize={32}>
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.var > 0 ? '#ef4444' : '#10b981'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              )}

              <SectionCard
                title="Budget Entries"
                subtitle="All budget line items with actuals and variance"
                icon={PiggyBank}
                pad="none"
                bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
                actions={
                  <button onClick={() => setShowNewBudget(true)} className={button.primary + ' text-xs'}>
                    <Plus className="w-4 h-4" /> New Entry
                  </button>
                }
              >
                <DataTable
                  columns={[
                    { key: 'budget_name', label: 'Budget Name', render: (b: BudgetEntry) => (
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{b.budget_name || '—'}</span>
                        <span className="text-[10px] font-mono text-slate-400">{b.id.slice(0, 8)}</span>
                      </div>
                    ) },
                    { key: 'period', label: 'Period', render: (b: BudgetEntry) => (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Calendar size={12} /></div>
                        <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-300">{b.period || '—'}</span>
                      </div>
                    ) },
                    { key: 'department', label: 'Department', render: (b: BudgetEntry) => {
                      const Icon = DEPT_ICON[b.department || ''] || Layers;
                      return (
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{b.department || '—'}</span>
                        </div>
                      );
                    } },
                    { key: 'account_code', label: 'Account', render: (b: BudgetEntry) => <span className="text-xs font-mono font-medium text-slate-500">{b.account_code || '—'}</span> },
                    { key: 'budgeted_amount', label: 'Budgeted', align: 'right' as const, render: (b: BudgetEntry) => <span className="text-xs font-medium text-slate-900 dark:text-white">{fmt(b.budgeted_amount)}</span> },
                    { key: 'actual_amount', label: 'Actual', align: 'right' as const, render: (b: BudgetEntry) => <span className="text-xs font-bold text-indigo-600">{fmt(b.actual_amount)}</span> },
                    { key: 'variance', label: 'Variance', align: 'right' as const, render: (b: BudgetEntry) => (
                      <span className={`text-xs font-bold ${b.variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmtSigned(b.variance)}</span>
                    ) },
                    { key: 'version', label: 'Status', align: 'center' as const, render: (b: BudgetEntry) => {
                      const tone: StatusTone =
                        b.version === 'Approved' ? 'success' :
                        b.version === 'Pending Approval' ? 'warning' :
                        b.version === 'Rejected' ? 'danger' : 'neutral';
                      return <div className="flex justify-center"><Badge tone={tone}>{b.version}</Badge></div>;
                    } },
                    { key: 'property_name', label: 'Property', render: (b: BudgetEntry) => <span className="text-xs font-medium text-slate-500">{b.property_name || propertyName(b.property_id)}</span> },
                  ] as Column<BudgetEntry>[]}
                  data={budgets}
                  rowKey={(b) => b.id}
                  sortable
                  filterable
                  filterPlaceholder="Search budgets..."
                  filterKeys={['budget_name', 'period', 'department', 'account_code', 'version', 'property_name']}
                  emptyMessage="No budget entries found."
                  containerClassName="rounded-lg border-0"
                />
              </SectionCard>
            </>
          )}

          {/* ── Budget Types ── */}
          {activeTab === 'types' && (
            <SectionCard
              title="Budget Types"
              subtitle="Different budgeting methodologies"
              icon={Layers}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'code', label: 'Code', render: (t: BudgetType) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Layers size={12} /></div>
                      <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{t.code}</span>
                    </div>
                  ) },
                  { key: 'name', label: 'Name', render: (t: BudgetType) => <span className="text-xs font-bold text-slate-900 dark:text-white">{t.name}</span> },
                  { key: 'description', label: 'Description', render: (t: BudgetType) => <span className="text-xs font-medium text-slate-500">{t.description || '—'}</span> },
                  { key: 'entry_count', label: 'Entries', align: 'right' as const, render: (t: BudgetType) => <span className="text-xs font-bold text-indigo-600">{t.entry_count}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (t: BudgetType) => {
                    const tone: StatusTone = t.status === 'Active' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{t.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (t: BudgetType) => <span className="text-xs font-medium text-slate-500">{t.property_name || propertyName(t.property_id)}</span> },
                ] as Column<BudgetType>[]}
                data={types}
                rowKey={(t) => t.id}
                sortable
                filterable
                filterPlaceholder="Search budget types..."
                filterKeys={['code', 'name', 'description', 'status', 'property_name']}
                emptyMessage="No budget types found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Forecasting ── */}
          {activeTab === 'forecast' && (
            <SectionCard
              title="Quarterly Forecast Breakdown"
              subtitle="Department-level forecasts with trends and confidence"
              icon={TrendingUp}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'department', label: 'Department', render: (f: BudgetForecast) => {
                    const Icon = DEPT_ICON[f.department] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{f.department}</span>
                      </div>
                    );
                  } },
                  { key: 'q3_forecast', label: 'Q3 Forecast', align: 'right' as const, render: (f: BudgetForecast) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{fmt(f.q3_forecast)}</span> },
                  { key: 'q4_forecast', label: 'Q4 Forecast', align: 'right' as const, render: (f: BudgetForecast) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{fmt(f.q4_forecast)}</span> },
                  { key: 'fy_total', label: 'FY Total', align: 'right' as const, render: (f: BudgetForecast) => <span className="text-xs font-bold text-indigo-600">{fmt(f.fy_total)}</span> },
                  { key: 'trend', label: 'Trend', align: 'center' as const, render: (f: BudgetForecast) => {
                    const Icon = f.trend === 'Up' ? ArrowUpRight : f.trend === 'Down' ? ArrowDownRight : Minus;
                    const color = f.trend === 'Up' ? 'text-emerald-600' : f.trend === 'Down' ? 'text-rose-600' : 'text-slate-400';
                    return <div className="flex justify-center items-center gap-1"><Icon size={14} className={color} /><span className={`text-xs font-bold ${color}`}>{f.trend}</span></div>;
                  } },
                  { key: 'confidence', label: 'Confidence', align: 'right' as const, render: (f: BudgetForecast) => (
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(f.confidence, 100)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{f.confidence.toFixed(0)}%</span>
                    </div>
                  ) },
                  { key: 'property_name', label: 'Property', render: (f: BudgetForecast) => <span className="text-xs font-medium text-slate-500">{f.property_name || propertyName(f.property_id)}</span> },
                ] as Column<BudgetForecast>[]}
                data={forecasts}
                rowKey={(f) => f.id}
                sortable
                filterable
                filterPlaceholder="Search forecasts..."
                filterKeys={['department', 'trend', 'period', 'property_name']}
                emptyMessage="No forecast data found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Budget Transfers ── */}
          {activeTab === 'transfer' && (
            <SectionCard
              title="Budget Transfers"
              subtitle="Inter-departmental budget reallocations"
              icon={ArrowRightLeft}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'transfer_number', label: 'Transfer ID', render: (t: BudgetTransfer) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><ArrowRightLeft size={12} /></div>
                      <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{t.transfer_number}</span>
                    </div>
                  ) },
                  { key: 'from_department', label: 'From', render: (t: BudgetTransfer) => <span className="text-xs font-bold text-slate-900 dark:text-white">{t.from_department}</span> },
                  { key: 'to_department', label: 'To', render: (t: BudgetTransfer) => <span className="text-xs font-bold text-slate-900 dark:text-white">{t.to_department}</span> },
                  { key: 'amount', label: 'Amount', align: 'right' as const, render: (t: BudgetTransfer) => <span className="text-xs font-bold text-indigo-600">{fmt(t.amount)}</span> },
                  { key: 'transfer_date', label: 'Date', render: (t: BudgetTransfer) => <span className="text-xs font-medium text-slate-500">{t.transfer_date || '—'}</span> },
                  { key: 'reason', label: 'Reason', render: (t: BudgetTransfer) => <span className="text-xs font-medium text-slate-500">{t.reason || '—'}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (t: BudgetTransfer) => {
                    const tone: StatusTone = t.status === 'Approved' ? 'success' : t.status === 'Pending' ? 'warning' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{t.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (t: BudgetTransfer) => <span className="text-xs font-medium text-slate-500">{t.property_name || propertyName(t.property_id)}</span> },
                ] as Column<BudgetTransfer>[]}
                data={transfers}
                rowKey={(t) => t.id}
                sortable
                filterable
                filterPlaceholder="Search transfers..."
                filterKeys={['transfer_number', 'from_department', 'to_department', 'status', 'reason', 'property_name']}
                emptyMessage="No budget transfers found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Pending Approvals ── */}
          {activeTab === 'approval' && (
            <SectionCard
              title="Pending Budget Approvals"
              subtitle="Budget entries awaiting approval or rejection"
              icon={CheckCircle2}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'budget_name', label: 'Budget Name', render: (b: BudgetEntry) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-lg"><AlertCircle size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{b.budget_name}</span>
                    </div>
                  ) },
                  { key: 'department', label: 'Department', render: (b: BudgetEntry) => {
                    const Icon = DEPT_ICON[b.department || ''] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{b.department || '—'}</span>
                      </div>
                    );
                  } },
                  { key: 'period', label: 'Period', render: (b: BudgetEntry) => <span className="text-xs font-mono font-medium text-slate-500">{b.period}</span> },
                  { key: 'budgeted_amount', label: 'Amount', align: 'right' as const, render: (b: BudgetEntry) => <span className="text-xs font-bold text-indigo-600">{fmt(b.budgeted_amount)}</span> },
                  { key: 'version', label: 'Status', align: 'center' as const, render: (b: BudgetEntry) => {
                    const tone: StatusTone = b.version === 'Pending Approval' ? 'warning' : b.version === 'Approved' ? 'success' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{b.version}</Badge></div>;
                  } },
                  { key: 'actions', label: 'Actions', align: 'center' as const, render: (b: BudgetEntry) => (
                    b.version === 'Pending Approval' ? (
                      <div className="flex justify-center gap-2">
                        <button onClick={() => handleApprovalAction(b.id, 'approve')} className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-100 transition">Approve</button>
                        <button onClick={() => handleApprovalAction(b.id, 'reject')} className="px-3 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-100 transition">Reject</button>
                      </div>
                    ) : <span className="text-xs text-slate-400">—</span>
                  ) },
                  { key: 'property_name', label: 'Property', render: (b: BudgetEntry) => <span className="text-xs font-medium text-slate-500">{b.property_name || propertyName(b.property_id)}</span> },
                ] as Column<BudgetEntry>[]}
                data={approvals.length > 0 ? approvals : budgets.filter(b => b.version === 'Pending Approval')}
                rowKey={(b) => b.id}
                sortable
                filterable
                filterPlaceholder="Search approvals..."
                filterKeys={['budget_name', 'department', 'period', 'version', 'property_name']}
                emptyMessage="No pending approvals."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Rolling Forecast ── */}
          {activeTab === 'rolling_forecast' && (
            <SectionCard
              title="Rolling Forecast"
              subtitle="Continuous 12-month rolling forecast updated monthly"
              icon={TrendingUp}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'department', label: 'Department', render: (f: BudgetForecast) => {
                    const Icon = DEPT_ICON[f.department] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{f.department}</span>
                      </div>
                    );
                  } },
                  { key: 'q3_forecast', label: 'Month +1', align: 'right' as const, render: (f: BudgetForecast) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{fmt(f.q3_forecast)}</span> },
                  { key: 'q4_forecast', label: 'Month +2', align: 'right' as const, render: (f: BudgetForecast) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{fmt(f.q4_forecast)}</span> },
                  { key: 'fy_total', label: '12-Month Total', align: 'right' as const, render: (f: BudgetForecast) => <span className="text-xs font-bold text-indigo-600">{fmt(f.fy_total)}</span> },
                  { key: 'trend', label: 'Trend', align: 'center' as const, render: (f: BudgetForecast) => {
                    const Icon = f.trend === 'Up' ? ArrowUpRight : f.trend === 'Down' ? ArrowDownRight : Minus;
                    const color = f.trend === 'Up' ? 'text-emerald-600' : f.trend === 'Down' ? 'text-rose-600' : 'text-slate-400';
                    return <div className="flex justify-center items-center gap-1"><Icon size={14} className={color} /><span className={`text-xs font-bold ${color}`}>{f.trend}</span></div>;
                  } },
                  { key: 'confidence', label: 'Confidence', align: 'right' as const, render: (f: BudgetForecast) => (
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(f.confidence, 100)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{f.confidence.toFixed(0)}%</span>
                    </div>
                  ) },
                  { key: 'property_name', label: 'Property', render: (f: BudgetForecast) => <span className="text-xs font-medium text-slate-500">{f.property_name || propertyName(f.property_id)}</span> },
                ] as Column<BudgetForecast>[]}
                data={forecasts}
                rowKey={(f) => f.id}
                sortable
                filterable
                filterPlaceholder="Search rolling forecast..."
                filterKeys={['department', 'trend', 'property_name']}
                emptyMessage="No rolling forecast data found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Budget Revisions ── */}
          {activeTab === 'revision' && (
            <SectionCard
              title="Budget Revisions"
              subtitle="Version-controlled budget revisions and change history"
              icon={RefreshCw}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'budget_name', label: 'Budget Name', render: (b: BudgetEntry) => (
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{b.budget_name || '—'}</span>
                      <span className="text-[10px] font-mono text-slate-400">{b.id.slice(0, 8)}</span>
                    </div>
                  ) },
                  { key: 'department', label: 'Department', render: (b: BudgetEntry) => {
                    const Icon = DEPT_ICON[b.department || ''] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{b.department || '—'}</span>
                      </div>
                    );
                  } },
                  { key: 'period', label: 'Period', render: (b: BudgetEntry) => <span className="text-xs font-mono font-medium text-slate-500">{b.period || '—'}</span> },
                  { key: 'budgeted_amount', label: 'Original Budget', align: 'right' as const, render: (b: BudgetEntry) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{fmt(b.budgeted_amount)}</span> },
                  { key: 'actual_amount', label: 'Revised Amount', align: 'right' as const, render: (b: BudgetEntry) => <span className="text-xs font-bold text-indigo-600">{fmt(b.actual_amount)}</span> },
                  { key: 'variance', label: 'Change', align: 'right' as const, render: (b: BudgetEntry) => (
                    <span className={`text-xs font-bold ${b.variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmtSigned(b.variance)}</span>
                  ) },
                  { key: 'version', label: 'Status', align: 'center' as const, render: (b: BudgetEntry) => {
                    const tone: StatusTone =
                      b.version === 'Approved' ? 'success' :
                      b.version === 'Pending Approval' ? 'warning' :
                      b.version === 'Rejected' ? 'danger' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{b.version}</Badge></div>;
                  } },
                  { key: 'actions', label: 'Actions', align: 'center' as const, render: (b: BudgetEntry) => (
                    b.version === 'Approved' || b.version === 'Draft' ? (
                      <div className="flex justify-center">
                        <button
                          onClick={() => {
                            setNewBudgetForm({
                              budgetName: b.budget_name || '',
                              period: b.period || '',
                              accountCode: b.account_code || '',
                              department: b.department || 'Front Office',
                              budgetedAmount: b.budgeted_amount,
                              budgetType: 'Operating',
                            });
                            setShowNewBudget(true);
                          }}
                          className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold uppercase hover:bg-indigo-100 transition"
                        >
                          Revise
                        </button>
                      </div>
                    ) : <span className="text-xs text-slate-400">—</span>
                  ) },
                ] as Column<BudgetEntry>[]}
                data={budgets.filter(b => b.version === 'Approved' || b.version === 'Draft' || b.version === 'Pending Approval')}
                rowKey={(b) => b.id}
                sortable
                filterable
                filterPlaceholder="Search revisions..."
                filterKeys={['budget_name', 'department', 'period', 'version']}
                emptyMessage="No budget revisions found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}
        </>
      )}

      {/* New Budget Entry Modal */}
      <ModalSystem
        isOpen={showNewBudget}
        onClose={() => setShowNewBudget(false)}
        title="New Budget Entry"
        subtitle="Create a new budget line item"
        variant="form"
        size="md"
        showFooter={false}
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Budget Name</label>
              <input
                type="text"
                value={newBudgetForm.budgetName}
                onChange={(e) => setNewBudgetForm({ ...newBudgetForm, budgetName: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Q3 Front Office Budget"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Period</label>
              <input
                type="text"
                value={newBudgetForm.period}
                onChange={(e) => setNewBudgetForm({ ...newBudgetForm, period: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="2026-Q3"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Department</label>
              <select
                value={newBudgetForm.department}
                onChange={(e) => setNewBudgetForm({ ...newBudgetForm, department: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="Front Office">Front Office</option>
                <option value="Housekeeping">Housekeeping</option>
                <option value="F&B">F&B</option>
                <option value="Engineering">Engineering</option>
                <option value="Sales">Sales</option>
                <option value="IT">IT</option>
                <option value="HR">HR</option>
                <option value="Spa">Spa</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Account Code</label>
              <input
                type="text"
                value={newBudgetForm.accountCode}
                onChange={(e) => setNewBudgetForm({ ...newBudgetForm, accountCode: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="4060"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Budget Type</label>
              <select
                value={newBudgetForm.budgetType}
                onChange={(e) => setNewBudgetForm({ ...newBudgetForm, budgetType: e.target.value })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="Operating">Operating Budget</option>
                <option value="Capital">Capital Budget</option>
                <option value="Payroll">Payroll Budget</option>
                <option value="Revenue">Revenue Budget</option>
                <option value="Cash">Cash Budget</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Budgeted Amount</label>
              <input
                type="number"
                value={newBudgetForm.budgetedAmount}
                onChange={(e) => setNewBudgetForm({ ...newBudgetForm, budgetedAmount: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="120000"
              />
            </div>
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-700">
          <button onClick={() => setShowNewBudget(false)} className={button.ghost + ' text-xs uppercase font-bold'}>Cancel</button>
          <button onClick={handleCreateBudget} className={button.primary + ' text-xs uppercase font-bold'}>Create Budget</button>
        </div>
      </ModalSystem>
    </div>
  );
};

export default BudgetAnalysis;
