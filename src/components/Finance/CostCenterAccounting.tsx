import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Wallet, TrendingUp, TrendingDown, RefreshCw, Download, Loader2,
  ServerCrash, Layers, PieChart, BarChart3, CheckCircle2, XCircle, AlertTriangle,
  Target, DollarSign, Percent, Users,
  UtensilsCrossed, WashingMachine, Megaphone, ShieldCheck, Plus,
} from 'lucide-react';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { useERP } from '../../context/ERPContext';
import {
  fetchCostCenters, fetchDepartmentPL, fetchProfitCenters, fetchProfitabilityAnalysis,
  type CostCenter, type DepartmentPL, type ProfitCenter, type ProfitabilityAnalysis,
  fetchRevenueAllocationRules, createRevenueAllocationRule, deleteRevenueAllocationRule,
  type RevenueAllocationRule,
} from '../../services/costCenterAccountingService';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${Number(n || 0).toFixed(1)}%`;
const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

const DEPT_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  'Front Office': Building2,
  'F&B': PieChart,
  'Food & Beverage': PieChart,
  'Housekeeping': Layers,
  'Engineering': AlertTriangle,
  'Kitchen': UtensilsCrossed,
  'Laundry': WashingMachine,
  'Spa': Percent,
  'Sales': TrendingUp,
  'Sales & Marketing': Megaphone,
  'Administration': Building2,
  'Security': ShieldCheck,
  'IT': ServerCrash,
  'HR': Users,
  'Retail': DollarSign,
};

const CostCenterAccounting = () => {
  const { currentPropertyId, properties, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'centers' | 'departments' | 'profit_centers' | 'analysis' | 'revenue_allocation'>('centers');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [departmentPL, setDepartmentPL] = useState<DepartmentPL[]>([]);
  const [profitCenters, setProfitCenters] = useState<ProfitCenter[]>([]);
  const [analysis, setAnalysis] = useState<ProfitabilityAnalysis[]>([]);

  // Revenue allocation rules (local state — spec §13)
  type RevenueAllocationRule = {
    id: string;
    cost_center: string;
    revenue_source: string;
    allocation_pct: number;
    allocated_amount: number;
    period: string;
    status: 'Active' | 'Inactive';
  };
  const [allocationRules, setAllocationRules] = useState<RevenueAllocationRule[]>([]);

  // Load revenue allocation rules from backend
  useEffect(() => {
    const load = async () => {
      try {
        const rules = await fetchRevenueAllocationRules(currentPropertyId || undefined);
        setAllocationRules(rules);
      } catch (err: any) {
        // Backend may not have the table yet; keep empty state
        console.warn('Failed to load revenue allocation rules:', err?.message);
      }
    };
    load();
  }, [currentPropertyId]);

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
      const [cc, dpl, pc, pa] = await Promise.all([
        fetchCostCenters(pid),
        fetchDepartmentPL(pid),
        fetchProfitCenters(pid),
        fetchProfitabilityAnalysis(pid),
      ]);
      setCostCenters(cc);
      setDepartmentPL(dpl);
      setProfitCenters(pc);
      setAnalysis(pa);
    } catch (err: any) {
      console.error('Error loading cost center data:', err);
      setError(err.message || 'Failed to load cost center data');
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
    let filename = `cost_center_${activeTab}_${stamp}.csv`;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    if (activeTab === 'centers') {
      headers = ['ID', 'Code', 'Name', 'Department', 'Manager', 'Budget', 'Actual Expense', 'Actual Revenue', 'Variance', 'Status', 'Property'];
      rows = costCenters.map(c => [c.id, c.code, c.name, c.department || '', c.manager || '', c.budget, c.actual_expense, c.actual_revenue, c.variance, c.status, c.property_name || propertyName(c.property_id)]);
    } else if (activeTab === 'departments') {
      headers = ['ID', 'Department', 'Revenue', 'COGS', 'Gross Profit', 'Operating Expenses', 'Operating Profit', 'Net Profit', 'Period', 'Property'];
      rows = departmentPL.map(d => [d.id, d.department, d.revenue, d.cost_of_sales, d.gross_profit, d.operating_expenses, d.operating_profit, d.net_profit, d.period || '', d.property_name || propertyName(d.property_id)]);
    } else if (activeTab === 'profit_centers') {
      headers = ['ID', 'Code', 'Name', 'Department', 'Revenue', 'Direct Costs', 'Allocated Costs', 'Net Profit', 'Margin %', 'Status', 'Property'];
      rows = profitCenters.map(p => [p.id, p.code, p.name, p.department || '', p.revenue, p.direct_costs, p.allocated_costs, p.net_profit, p.margin_pct, p.status, p.property_name || propertyName(p.property_id)]);
    } else if (activeTab === 'analysis') {
      headers = ['ID', 'Department', 'Revenue', 'Total Costs', 'Net Profit', 'Margin %', 'Revenue Share', 'Cost Share', 'Rating', 'Property'];
      rows = analysis.map(a => [a.id, a.department, a.revenue, a.total_costs, a.net_profit, a.margin_pct, a.revenue_share, a.cost_share, a.rating, a.property_name || propertyName(a.property_id)]);
    } else if (activeTab === 'revenue_allocation') {
      headers = ['ID', 'Cost Center', 'Revenue Source', 'Allocation %', 'Allocated Amount', 'Period', 'Status'];
      rows = allocationRules.map(r => [r.id, r.cost_center, r.revenue_source, r.allocation_pct, r.allocated_amount, r.period || '', r.status]);
    }
    exportToCsv(filename, headers, rows);
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  // ── Derived KPIs ────────────────────────────────────────────────────────
  const totalBudget = costCenters.reduce((s, c) => s + c.budget, 0);
  const totalExpense = costCenters.reduce((s, c) => s + c.actual_expense, 0);
  const totalRevenue = costCenters.reduce((s, c) => s + c.actual_revenue, 0);
  const activeCenters = costCenters.filter(c => c.status === 'Active').length;

  const totalDeptRevenue = departmentPL.reduce((s, d) => s + d.revenue, 0);
  const totalDeptNet = departmentPL.reduce((s, d) => s + d.net_profit, 0);
  const profitableDepts = departmentPL.filter(d => d.net_profit > 0).length;

  const totalPCRevenue = profitCenters.reduce((s, p) => s + p.revenue, 0);
  const totalPCNet = profitCenters.reduce((s, p) => s + p.net_profit, 0);
  const avgPCMargin = profitCenters.length ? profitCenters.reduce((s, p) => s + p.margin_pct, 0) / profitCenters.length : 0;

  const totalAnalysisRevenue = analysis.reduce((s, a) => s + a.revenue, 0);
  const totalAnalysisNet = analysis.reduce((s, a) => s + a.net_profit, 0);
  const excellentDepts = analysis.filter(a => a.rating === 'Excellent').length;
  const lossDepts = analysis.filter(a => a.rating === 'Loss').length;

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Cost Center Accounting"
        subtitle="Department expenses, revenue allocation, and profitability analysis."
        icon={Building2}
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
            <span>Loading cost center data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab */}
          {activeTab === 'centers' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Budget" value={fmt(totalBudget)} icon={Wallet} tone="info" />
              <StatCard title="Total Expenses" value={fmt(totalExpense)} icon={TrendingDown} tone="danger" />
              <StatCard title="Total Revenue" value={fmt(totalRevenue)} icon={TrendingUp} tone="success" />
              <StatCard title="Active Centers" value={activeCenters} icon={CheckCircle2} tone="accent" />
            </div>
          )}
          {activeTab === 'departments' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Revenue" value={fmt(totalDeptRevenue)} icon={TrendingUp} tone="success" />
              <StatCard title="Net Profit" value={fmt(totalDeptNet)} icon={DollarSign} tone={totalDeptNet >= 0 ? 'success' : 'danger'} />
              <StatCard title="Profitable Depts" value={profitableDepts} icon={CheckCircle2} tone="accent" />
              <StatCard title="Total Depts" value={departmentPL.length} icon={Layers} tone="info" />
            </div>
          )}
          {activeTab === 'profit_centers' && (
            <div className={layout.kpiGrid}>
              <StatCard title="PC Revenue" value={fmt(totalPCRevenue)} icon={TrendingUp} tone="success" />
              <StatCard title="PC Net Profit" value={fmt(totalPCNet)} icon={DollarSign} tone={totalPCNet >= 0 ? 'success' : 'danger'} />
              <StatCard title="Avg Margin" value={fmtPct(avgPCMargin)} icon={Percent} tone="accent" />
              <StatCard title="Profit Centers" value={profitCenters.length} icon={Target} tone="info" />
            </div>
          )}
          {activeTab === 'analysis' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Revenue" value={fmt(totalAnalysisRevenue)} icon={TrendingUp} tone="success" />
              <StatCard title="Net Profit" value={fmt(totalAnalysisNet)} icon={DollarSign} tone={totalAnalysisNet >= 0 ? 'success' : 'danger'} />
              <StatCard title="Excellent" value={excellentDepts} icon={CheckCircle2} tone="success" />
              <StatCard title="Loss Centers" value={lossDepts} icon={XCircle} tone="danger" />
            </div>
          )}
          {activeTab === 'revenue_allocation' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Allocation Rules" value={allocationRules.length} icon={Layers} tone="info" />
              <StatCard title="Active Rules" value={allocationRules.filter(r => r.status === 'Active').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Total Allocated" value={fmt(allocationRules.reduce((s, r) => s + r.allocated_amount, 0))} icon={DollarSign} tone="accent" />
              <StatCard title="Avg Allocation" value={fmtPct(allocationRules.length ? allocationRules.reduce((s, r) => s + r.allocation_pct, 0) / allocationRules.length : 0)} icon={Percent} tone="info" />
            </div>
          )}

          {/* Sub-tab nav */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['centers', 'Cost Centers'],
              ['departments', 'Department P&L'],
              ['profit_centers', 'Profit Centers'],
              ['analysis', 'Profitability Analysis'],
              ['revenue_allocation', 'Revenue Allocation'],
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

          {/* ── Cost Centers ── */}
          {activeTab === 'centers' && (
            <SectionCard
              title="Cost Centers"
              subtitle="Departmental cost centers with budget and actuals"
              icon={Building2}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'code', label: 'Code', render: (c: CostCenter) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Building2 size={12} /></div>
                      <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{c.code}</span>
                    </div>
                  ) },
                  { key: 'name', label: 'Name', render: (c: CostCenter) => (
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{c.name}</span>
                      {c.manager && <span className="text-[10px] text-slate-400 font-medium">{c.manager}</span>}
                    </div>
                  ) },
                  { key: 'department', label: 'Department', render: (c: CostCenter) => {
                    const Icon = DEPT_ICON[c.department || ''] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.department || '—'}</span>
                      </div>
                    );
                  } },
                  { key: 'budget', label: 'Budget', align: 'right' as const, render: (c: CostCenter) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(c.budget)}</span> },
                  { key: 'actual_expense', label: 'Actual Expense', align: 'right' as const, render: (c: CostCenter) => <span className="text-xs font-bold text-rose-600">{fmt(c.actual_expense)}</span> },
                  { key: 'actual_revenue', label: 'Actual Revenue', align: 'right' as const, render: (c: CostCenter) => <span className="text-xs font-bold text-emerald-600">{fmt(c.actual_revenue)}</span> },
                  { key: 'variance', label: 'Variance', align: 'right' as const, render: (c: CostCenter) => (
                    <span className={`text-xs font-bold ${c.variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtSigned(c.variance)}</span>
                  ) },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (c: CostCenter) => {
                    const tone: StatusTone = c.status === 'Active' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{c.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (c: CostCenter) => <span className="text-xs font-medium text-slate-500">{c.property_name || propertyName(c.property_id)}</span> },
                ] as Column<CostCenter>[]}
                data={costCenters}
                rowKey={(c) => c.id}
                sortable
                filterable
                filterPlaceholder="Search cost centers..."
                filterKeys={['code', 'name', 'department', 'manager', 'status', 'property_name']}
                emptyMessage="No cost centers found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Department P&L ── */}
          {activeTab === 'departments' && (
            <SectionCard
              title="Department P&L"
              subtitle="Profit & loss by department for the current period"
              icon={BarChart3}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'department', label: 'Department', render: (d: DepartmentPL) => {
                    const Icon = DEPT_ICON[d.department] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{d.department}</span>
                      </div>
                    );
                  } },
                  { key: 'revenue', label: 'Revenue', align: 'right' as const, render: (d: DepartmentPL) => <span className="text-xs font-bold text-emerald-600">{fmt(d.revenue)}</span> },
                  { key: 'cost_of_sales', label: 'COGS', align: 'right' as const, render: (d: DepartmentPL) => <span className="text-xs font-medium text-rose-600">{fmt(d.cost_of_sales)}</span> },
                  { key: 'gross_profit', label: 'Gross Profit', align: 'right' as const, render: (d: DepartmentPL) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{fmt(d.gross_profit)}</span> },
                  { key: 'operating_expenses', label: 'Op Expenses', align: 'right' as const, render: (d: DepartmentPL) => <span className="text-xs font-medium text-rose-600">{fmt(d.operating_expenses)}</span> },
                  { key: 'operating_profit', label: 'Op Profit', align: 'right' as const, render: (d: DepartmentPL) => (
                    <span className={`text-xs font-medium ${d.operating_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(d.operating_profit)}</span>
                  ) },
                  { key: 'net_profit', label: 'Net Profit', align: 'right' as const, render: (d: DepartmentPL) => (
                    <span className={`text-xs font-bold ${d.net_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(d.net_profit)}</span>
                  ) },
                  { key: 'period', label: 'Period', align: 'center' as const, render: (d: DepartmentPL) => <span className="text-xs font-medium text-slate-500">{d.period || '—'}</span> },
                  { key: 'property_name', label: 'Property', render: (d: DepartmentPL) => <span className="text-xs font-medium text-slate-500">{d.property_name || propertyName(d.property_id)}</span> },
                ] as Column<DepartmentPL>[]}
                data={departmentPL}
                rowKey={(d) => d.id}
                sortable
                filterable
                filterPlaceholder="Search departments..."
                filterKeys={['department', 'period', 'property_name']}
                emptyMessage="No department P&L records found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Profit Centers ── */}
          {activeTab === 'profit_centers' && (
            <SectionCard
              title="Profit Centers"
              subtitle="Revenue-generating units with allocated costs and net profit"
              icon={Target}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'code', label: 'Code', render: (p: ProfitCenter) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Target size={12} /></div>
                      <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">{p.code}</span>
                    </div>
                  ) },
                  { key: 'name', label: 'Name', render: (p: ProfitCenter) => <span className="text-xs font-bold text-slate-900 dark:text-white">{p.name}</span> },
                  { key: 'department', label: 'Department', render: (p: ProfitCenter) => {
                    const Icon = DEPT_ICON[p.department || ''] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{p.department || '—'}</span>
                      </div>
                    );
                  } },
                  { key: 'revenue', label: 'Revenue', align: 'right' as const, render: (p: ProfitCenter) => <span className="text-xs font-bold text-emerald-600">{fmt(p.revenue)}</span> },
                  { key: 'direct_costs', label: 'Direct Costs', align: 'right' as const, render: (p: ProfitCenter) => <span className="text-xs font-medium text-rose-600">{fmt(p.direct_costs)}</span> },
                  { key: 'allocated_costs', label: 'Allocated Costs', align: 'right' as const, render: (p: ProfitCenter) => <span className="text-xs font-medium text-amber-600">{fmt(p.allocated_costs)}</span> },
                  { key: 'net_profit', label: 'Net Profit', align: 'right' as const, render: (p: ProfitCenter) => (
                    <span className={`text-xs font-bold ${p.net_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(p.net_profit)}</span>
                  ) },
                  { key: 'margin_pct', label: 'Margin', align: 'right' as const, render: (p: ProfitCenter) => (
                    <span className={`text-xs font-bold ${p.margin_pct >= 40 ? 'text-emerald-600' : p.margin_pct >= 20 ? 'text-amber-600' : 'text-rose-600'}`}>{fmtPct(p.margin_pct)}</span>
                  ) },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (p: ProfitCenter) => {
                    const tone: StatusTone = p.status === 'Active' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{p.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (p: ProfitCenter) => <span className="text-xs font-medium text-slate-500">{p.property_name || propertyName(p.property_id)}</span> },
                ] as Column<ProfitCenter>[]}
                data={profitCenters}
                rowKey={(p) => p.id}
                sortable
                filterable
                filterPlaceholder="Search profit centers..."
                filterKeys={['code', 'name', 'department', 'status', 'property_name']}
                emptyMessage="No profit centers found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Profitability Analysis ── */}
          {activeTab === 'analysis' && (
            <SectionCard
              title="Profitability Analysis"
              subtitle="Department profitability metrics and performance ratings"
              icon={PieChart}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'department', label: 'Department', render: (a: ProfitabilityAnalysis) => {
                    const Icon = DEPT_ICON[a.department] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{a.department}</span>
                      </div>
                    );
                  } },
                  { key: 'revenue', label: 'Revenue', align: 'right' as const, render: (a: ProfitabilityAnalysis) => <span className="text-xs font-bold text-emerald-600">{fmt(a.revenue)}</span> },
                  { key: 'total_costs', label: 'Total Costs', align: 'right' as const, render: (a: ProfitabilityAnalysis) => <span className="text-xs font-medium text-rose-600">{fmt(a.total_costs)}</span> },
                  { key: 'net_profit', label: 'Net Profit', align: 'right' as const, render: (a: ProfitabilityAnalysis) => (
                    <span className={`text-xs font-bold ${a.net_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(a.net_profit)}</span>
                  ) },
                  { key: 'margin_pct', label: 'Margin', align: 'right' as const, render: (a: ProfitabilityAnalysis) => (
                    <span className={`text-xs font-bold ${a.margin_pct >= 40 ? 'text-emerald-600' : a.margin_pct >= 0 ? 'text-amber-600' : 'text-rose-600'}`}>{fmtPct(a.margin_pct)}</span>
                  ) },
                  { key: 'revenue_share', label: 'Rev Share', align: 'right' as const, render: (a: ProfitabilityAnalysis) => (
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(Math.abs(a.revenue_share), 100)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmtPct(a.revenue_share)}</span>
                    </div>
                  ) },
                  { key: 'cost_share', label: 'Cost Share', align: 'right' as const, render: (a: ProfitabilityAnalysis) => (
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(Math.abs(a.cost_share), 100)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmtPct(a.cost_share)}</span>
                    </div>
                  ) },
                  { key: 'rating', label: 'Rating', align: 'center' as const, render: (a: ProfitabilityAnalysis) => {
                    const tone: StatusTone =
                      a.rating === 'Excellent' ? 'success' :
                      a.rating === 'Good' ? 'accent' :
                      a.rating === 'Fair' ? 'warning' :
                      a.rating === 'Poor' ? 'danger' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{a.rating}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (a: ProfitabilityAnalysis) => <span className="text-xs font-medium text-slate-500">{a.property_name || propertyName(a.property_id)}</span> },
                ] as Column<ProfitabilityAnalysis>[]}
                data={analysis}
                rowKey={(a) => a.id}
                sortable
                filterable
                filterPlaceholder="Search analysis..."
                filterKeys={['department', 'rating', 'period', 'property_name']}
                emptyMessage="No profitability analysis records found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Revenue Allocation ── */}
          {activeTab === 'revenue_allocation' && (
            <SectionCard
              title="Revenue Allocation Rules"
              subtitle="Rules for allocating revenue across cost centers"
              icon={Percent}
              pad="none"
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              actions={
                <button
                  className={button.primary}
                  onClick={async () => {
                    try {
                      const created = await createRevenueAllocationRule({
                        cost_center: 'New Cost Center',
                        revenue_source: 'New Revenue Source',
                        allocation_pct: 0,
                        allocated_amount: 0,
                        period: '2025-Q1',
                        status: 'Active',
                        propertyId: currentPropertyId || undefined,
                      } as any);
                      setAllocationRules(prev => [...prev, created]);
                      addNotification?.('Allocation rule created. Edit details in the table.', 'success', 'Finance');
                    } catch (err: any) {
                      addNotification?.(err?.message || 'Failed to create allocation rule', 'warning', 'Finance');
                    }
                  }}
                >
                  <Plus className="w-4 h-4" /> Add Allocation Rule
                </button>
              }
            >
              <DataTable
                columns={[
                  { key: 'cost_center', label: 'Cost Center', render: (r: RevenueAllocationRule) => {
                    const Icon = DEPT_ICON[r.cost_center] || Layers;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Icon size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{r.cost_center}</span>
                      </div>
                    );
                  } },
                  { key: 'revenue_source', label: 'Revenue Source', render: (r: RevenueAllocationRule) => <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{r.revenue_source}</span> },
                  { key: 'allocation_pct', label: 'Allocation %', align: 'right' as const, render: (r: RevenueAllocationRule) => (
                    <span className={`text-xs font-bold ${r.allocation_pct >= 75 ? 'text-emerald-600' : r.allocation_pct >= 50 ? 'text-amber-600' : 'text-slate-600 dark:text-slate-300'}`}>{fmtPct(r.allocation_pct)}</span>
                  ) },
                  { key: 'allocated_amount', label: 'Allocated Amount', align: 'right' as const, render: (r: RevenueAllocationRule) => <span className="text-xs font-bold text-emerald-600">{fmt(r.allocated_amount)}</span> },
                  { key: 'period', label: 'Period', align: 'center' as const, render: (r: RevenueAllocationRule) => <span className="text-xs font-medium text-slate-500">{r.period || '—'}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (r: RevenueAllocationRule) => {
                    const tone: StatusTone = r.status === 'Active' ? 'success' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{r.status}</Badge></div>;
                  } },
                ] as Column<RevenueAllocationRule>[]}
                data={allocationRules}
                rowKey={(r) => r.id}
                sortable
                filterable
                filterPlaceholder="Search allocation rules..."
                filterKeys={['cost_center', 'revenue_source', 'period', 'status']}
                emptyMessage="No revenue allocation rules found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
};

export default CostCenterAccounting;
