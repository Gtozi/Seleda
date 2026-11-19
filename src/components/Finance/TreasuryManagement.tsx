import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, RefreshCw, Download, Loader2, ServerCrash,
  PiggyBank, Landmark, Globe, BarChart3, Layers, Wallet, Calendar,
  AlertCircle, CheckCircle2, Clock, Droplets, Plus,
} from 'lucide-react';
import { DataTable, Column } from '../Shared/DataTable';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchCashForecasts, fetchInvestments, fetchLoans, fetchFxRates,
  fetchFxTransactions, fetchLiquidityForecasts, fetchCashPoolParticipants,
  createCashForecast, createInvestment, createLoan, createFxRate,
  createLiquidityForecast, createCashPoolParticipant,
  deleteCashForecast, deleteInvestment, deleteLoan, deleteFxRate,
  deleteLiquidityForecast, deleteCashPoolParticipant,
  type CashForecast, type Investment, type Loan, type FxRate, type FxTransaction,
  type LiquidityForecast, type CashPoolParticipant,
} from '../../services/treasuryService';

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const TreasuryManagement = () => {
  const { currentPropertyId, properties, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<'forecast' | 'liquidity' | 'cash_pooling' | 'investments' | 'loans' | 'fx'>('forecast');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [forecasts, setForecasts] = useState<CashForecast[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [fxTransactions, setFxTransactions] = useState<FxTransaction[]>([]);
  const [liquidityForecasts, setLiquidityForecasts] = useState<LiquidityForecast[]>([]);
  const [poolParticipants, setPoolParticipants] = useState<CashPoolParticipant[]>([]);

  // ── Modal state (generic create/edit pattern for all tabs) ──────────────
  type ModalType = 'forecast' | 'liquidity' | 'cash_pooling' | 'investments' | 'loans' | 'fx' | null;
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const openModal = (type: ModalType) => {
    setModalType(type);
    setFormData({});
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setModalType(null);
    setFormData({});
  };
  const updateField = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    const pid = currentPropertyId || undefined;
    try {
      if (modalType === 'forecast') {
        const opening = Number(formData.opening_balance) || 0;
        const inflows = Number(formData.inflows) || 0;
        const outflows = Number(formData.outflows) || 0;
        await createCashForecast({
          period: formData.period || '',
          opening_balance: opening, inflows, outflows,
          net_cash_flow: inflows - outflows,
          closing_balance: opening + inflows - outflows,
          propertyId: pid,
        } as any);
        addNotification?.('Cash forecast created.', 'success', 'Finance');
      } else if (modalType === 'liquidity') {
        const opening = Number(formData.opening) || 0;
        const inflows = Number(formData.inflows) || 0;
        const outflows = Number(formData.outflows) || 0;
        await createLiquidityForecast({
          week_label: formData.week_label || '',
          opening, inflows, outflows,
          closing: opening + inflows - outflows,
          status: (formData.status as LiquidityForecast['status']) || 'Surplus',
          propertyId: pid,
        } as any);
        addNotification?.('Liquidity forecast created.', 'success', 'Finance');
      } else if (modalType === 'cash_pooling') {
        const roleVal = formData.role === 'Pool Leader' ? 'Header' : (formData.role || 'Participant');
        await createCashPoolParticipant({
          account_name: formData.account_name || '',
          entity: formData.entity || '',
          balance: Number(formData.balance) || 0,
          sweep_amount: Number(formData.sweep_amount) || 0,
          role: roleVal as CashPoolParticipant['role'],
          propertyId: pid,
        } as any);
        addNotification?.('Cash pool participant created.', 'success', 'Finance');
      } else if (modalType === 'investments') {
        await createInvestment({
          name: formData.name || '',
          type: formData.type || 'Term Deposit',
          amount: Number(formData.amount) || 0,
          interest_rate: Number(formData.interest_rate) || 0,
          maturity_date: formData.maturity_date || '',
          status: (formData.status as Investment['status']) || 'active',
          propertyId: pid,
        } as any);
        addNotification?.('Investment created.', 'success', 'Finance');
      } else if (modalType === 'loans') {
        await createLoan({
          lender: formData.lender || '',
          principal: Number(formData.principal) || 0,
          outstanding_balance: Number(formData.outstanding_balance) || 0,
          interest_rate: Number(formData.interest_rate) || 0,
          monthly_payment: Number(formData.monthly_payment) || 0,
          next_payment_date: formData.next_payment_date || '',
          status: (formData.status as Loan['status']) || 'active',
          propertyId: pid,
        } as any);
        addNotification?.('Loan created.', 'success', 'Finance');
      } else if (modalType === 'fx') {
        await createFxRate({
          currency: `${formData.from_currency || ''}/${formData.to_currency || ''}`,
          rate: Number(formData.rate) || 0,
          change_pct: 0,
          last_updated: formData.effective_date || new Date().toISOString(),
          propertyId: pid,
        } as any);
        addNotification?.('FX rate created.', 'success', 'Finance');
      }
      closeModal();
      await loadData();
    } catch (err: any) {
      addNotification?.(err?.message || 'Failed to save treasury record', 'warning', 'Finance');
    } finally {
      setSaving(false);
    }
  };

  // ── CSV export for the current tab ──────────────────────────────────────
  const exportCsv = () => {
    let headers: string[] = [];
    let rows: Record<string, any>[] = [];
    let filename = 'treasury-export.csv';
    if (activeTab === 'forecast') {
      headers = ['Period', 'Opening', 'Inflows', 'Outflows', 'Net Flow', 'Closing', 'Property'];
      rows = forecasts.map(f => ({ Period: f.period, Opening: f.opening_balance, Inflows: f.inflows, Outflows: f.outflows, 'Net Flow': f.net_cash_flow, Closing: f.closing_balance, Property: f.property_name || propertyName(f.property_id) }));
      filename = 'cash-forecast.csv';
    } else if (activeTab === 'liquidity') {
      headers = ['Week', 'Opening', 'Inflows', 'Outflows', 'Closing', 'Status', 'Property'];
      rows = liquidityForecasts.map(l => ({ Week: l.week_label, Opening: l.opening, Inflows: l.inflows, Outflows: l.outflows, Closing: l.closing, Status: l.status, Property: l.property_name || propertyName(l.property_id) }));
      filename = 'liquidity-forecast.csv';
    } else if (activeTab === 'cash_pooling') {
      headers = ['Account', 'Entity', 'Balance', 'Sweep Amount', 'Role', 'Property'];
      rows = poolParticipants.map(p => ({ Account: p.account_name, Entity: p.entity || '', Balance: p.balance, 'Sweep Amount': p.sweep_amount, Role: p.role, Property: p.property_name || propertyName(p.property_id) }));
      filename = 'cash-pooling.csv';
    } else if (activeTab === 'investments') {
      headers = ['Name', 'Type', 'Amount', 'Interest Rate', 'Maturity Date', 'Status', 'Property'];
      rows = investments.map(i => ({ Name: i.name, Type: i.type, Amount: i.amount, 'Interest Rate': i.interest_rate, 'Maturity Date': i.maturity_date, Status: i.status, Property: i.property_name || propertyName(i.property_id) }));
      filename = 'investments.csv';
    } else if (activeTab === 'loans') {
      headers = ['Lender', 'Principal', 'Outstanding', 'Interest Rate', 'Monthly Payment', 'Next Payment', 'Status', 'Property'];
      rows = loans.map(l => ({ Lender: l.lender, Principal: l.principal, Outstanding: l.outstanding_balance, 'Interest Rate': l.interest_rate, 'Monthly Payment': l.monthly_payment, 'Next Payment': l.next_payment_date, Status: l.status, Property: l.property_name || propertyName(l.property_id) }));
      filename = 'loans.csv';
    } else if (activeTab === 'fx') {
      headers = ['Currency', 'Rate', 'Change %', 'Last Updated'];
      rows = fxRates.map(r => ({ Currency: r.currency, Rate: r.rate, 'Change %': r.change_pct, 'Last Updated': r.last_updated ? new Date(r.last_updated).toLocaleDateString() : '' }));
      filename = 'fx-rates.csv';
    }
    const escape = (val: any) => {
      const s = String(val ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      const [f, inv, ln, fxr, fxt, lf, cp] = await Promise.all([
        fetchCashForecasts(pid),
        fetchInvestments(pid),
        fetchLoans(pid),
        fetchFxRates(pid),
        fetchFxTransactions(pid),
        fetchLiquidityForecasts(pid),
        fetchCashPoolParticipants(pid),
      ]);
      setForecasts(f);
      setInvestments(inv);
      setLoans(ln);
      setFxRates(fxr);
      setFxTransactions(fxt);
      setLiquidityForecasts(lf);
      setPoolParticipants(cp);
    } catch (err: any) {
      console.error('Error loading treasury data:', err);
      setError(err.message || 'Failed to load treasury data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [currentPropertyId]);

  // ── Derived KPIs ────────────────────────────────────────────────────────
  const totalInflows = forecasts.reduce((s, f) => s + f.inflows, 0);
  const totalOutflows = forecasts.reduce((s, f) => s + f.outflows, 0);
  const netCashFlow = totalInflows - totalOutflows;
  const totalInvested = investments.reduce((s, i) => s + i.amount, 0);
  const activeInvestments = investments.filter(i => i.status === 'active').length;
  const totalOutstandingLoans = loans.reduce((s, l) => s + l.outstanding_balance, 0);
  const monthlyLoanPayments = loans.reduce((s, l) => s + l.monthly_payment, 0);
  const activeLoans = loans.filter(l => l.status === 'active').length;
  const poolBalance = poolParticipants.reduce((s, p) => s + p.balance, 0);
  const poolSweep = poolParticipants.reduce((s, p) => s + p.sweep_amount, 0);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Treasury Management"
        subtitle="Cash forecasting, liquidity planning, investments, loans, FX, and cash pooling."
        icon={Landmark}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={exportCsv} className={button.primary}>
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
            <span>Loading treasury data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — per active tab */}
          {activeTab === 'forecast' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Inflows" value={fmt(totalInflows)} icon={TrendingUp} tone="success" />
              <StatCard title="Total Outflows" value={fmt(totalOutflows)} icon={TrendingDown} tone="danger" />
              <StatCard title="Net Cash Flow" value={fmt(netCashFlow)} icon={DollarSign} tone={netCashFlow >= 0 ? 'success' : 'danger'} />
              <StatCard title="Forecast Periods" value={forecasts.length} icon={Calendar} tone="info" />
            </div>
          )}
          {activeTab === 'liquidity' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Surplus Weeks" value={liquidityForecasts.filter(l => l.status === 'Surplus').length} icon={TrendingUp} tone="success" />
              <StatCard title="Watch Weeks" value={liquidityForecasts.filter(l => l.status === 'Watch').length} icon={AlertCircle} tone="warning" />
              <StatCard title="Deficit Weeks" value={liquidityForecasts.filter(l => l.status === 'Deficit').length} icon={TrendingDown} tone="danger" />
              <StatCard title="Total Weeks" value={liquidityForecasts.length} icon={Calendar} tone="info" />
            </div>
          )}
          {activeTab === 'cash_pooling' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Pool Balance" value={fmt(poolBalance)} icon={Wallet} tone="accent" />
              <StatCard title="Total Sweep" value={fmt(poolSweep)} icon={RefreshCw} tone="info" />
              <StatCard title="Participants" value={poolParticipants.length} icon={Layers} tone="success" />
              <StatCard title="Header Accounts" value={poolParticipants.filter(p => p.role === 'Header').length} icon={Landmark} tone="warning" />
            </div>
          )}
          {activeTab === 'investments' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Invested" value={fmt(totalInvested)} icon={PiggyBank} tone="accent" />
              <StatCard title="Active" value={activeInvestments} icon={TrendingUp} tone="success" />
              <StatCard title="Matured" value={investments.filter(i => i.status === 'matured').length} icon={Calendar} tone="warning" />
              <StatCard title="Redeemed" value={investments.filter(i => i.status === 'redeemed').length} icon={DollarSign} tone="neutral" />
            </div>
          )}
          {activeTab === 'loans' && (
            <div className={layout.kpiGrid}>
              <StatCard title="Total Outstanding" value={fmt(totalOutstandingLoans)} icon={TrendingDown} tone="danger" />
              <StatCard title="Monthly Payments" value={fmt(monthlyLoanPayments)} icon={Calendar} tone="warning" />
              <StatCard title="Active Loans" value={activeLoans} icon={Landmark} tone="info" />
              <StatCard title="Paid Off" value={loans.filter(l => l.status === 'paid').length} icon={CheckCircle2} tone="success" />
            </div>
          )}
          {activeTab === 'fx' && (
            <div className={layout.kpiGrid}>
              <StatCard title="FX Rates" value={fxRates.length} icon={Globe} tone="accent" />
              <StatCard title="FX Transactions" value={fxTransactions.length} icon={RefreshCw} tone="info" />
              <StatCard title="Completed" value={fxTransactions.filter(t => t.status === 'Completed').length} icon={CheckCircle2} tone="success" />
              <StatCard title="Pending" value={fxTransactions.filter(t => t.status === 'Pending').length} icon={Clock} tone="warning" />
            </div>
          )}

          {/* Sub-tab nav */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {([
              ['forecast', 'Cash Forecast'],
              ['liquidity', 'Liquidity Planning'],
              ['cash_pooling', 'Cash Pooling'],
              ['investments', 'Investments'],
              ['loans', 'Loans'],
              ['fx', 'Foreign Exchange'],
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

          {/* ── Cash Forecast ── */}
          {activeTab === 'forecast' && (
            <SectionCard
              title="Cash Forecast"
              subtitle="Monthly cash flow projections"
              icon={BarChart3}
              pad="none"
              actions={
                <button onClick={() => openModal('forecast')} className={button.primary}>
                  <Plus className="w-4 h-4" /> New Forecast
                </button>
              }
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'period', label: 'Period', render: (f: CashForecast) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Calendar size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{f.period}</span>
                    </div>
                  ) },
                  { key: 'opening_balance', label: 'Opening', align: 'right' as const, render: (f: CashForecast) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(f.opening_balance)}</span> },
                  { key: 'inflows', label: 'Inflows', align: 'right' as const, render: (f: CashForecast) => <span className="text-xs font-bold text-emerald-600">+{fmt(f.inflows)}</span> },
                  { key: 'outflows', label: 'Outflows', align: 'right' as const, render: (f: CashForecast) => <span className="text-xs font-bold text-rose-600">-{fmt(f.outflows)}</span> },
                  { key: 'net_cash_flow', label: 'Net Flow', align: 'right' as const, render: (f: CashForecast) => (
                    <span className={`text-xs font-bold ${f.net_cash_flow >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {f.net_cash_flow >= 0 ? '+' : ''}{fmt(f.net_cash_flow)}
                    </span>
                  ) },
                  { key: 'closing_balance', label: 'Closing', align: 'right' as const, render: (f: CashForecast) => <span className="text-xs font-bold text-slate-900 dark:text-white">{fmt(f.closing_balance)}</span> },
                  { key: 'property_name', label: 'Property', render: (f: CashForecast) => <span className="text-xs font-medium text-slate-500">{f.property_name || propertyName(f.property_id)}</span> },
                ] as Column<CashForecast>[]}
                data={forecasts}
                rowKey={(f) => f.id}
                sortable
                filterable
                filterPlaceholder="Search forecasts..."
                filterKeys={['period', 'property_name']}
                emptyMessage="No cash forecasts found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Liquidity Planning ── */}
          {activeTab === 'liquidity' && (
            <SectionCard
              title="Liquidity Forecast (13-Week)"
              subtitle="Weekly liquidity projections and surplus/deficit tracking"
              icon={Droplets}
              pad="none"
              actions={
                <button onClick={() => openModal('liquidity')} className={button.primary}>
                  <Plus className="w-4 h-4" /> New Plan
                </button>
              }
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'week_label', label: 'Week', render: (l: LiquidityForecast) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-lg"><Calendar size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{l.week_label}</span>
                    </div>
                  ) },
                  { key: 'opening', label: 'Opening', align: 'right' as const, render: (l: LiquidityForecast) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(l.opening)}K</span> },
                  { key: 'inflows', label: 'Inflows', align: 'right' as const, render: (l: LiquidityForecast) => <span className="text-xs font-bold text-emerald-600">+{fmt(l.inflows)}K</span> },
                  { key: 'outflows', label: 'Outflows', align: 'right' as const, render: (l: LiquidityForecast) => <span className="text-xs font-bold text-rose-600">-{fmt(l.outflows)}K</span> },
                  { key: 'closing', label: 'Closing', align: 'right' as const, render: (l: LiquidityForecast) => <span className="text-xs font-bold text-slate-900 dark:text-white">{fmt(l.closing)}K</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (l: LiquidityForecast) => {
                    const tone: StatusTone = l.status === 'Surplus' ? 'success' : l.status === 'Watch' ? 'warning' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{l.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (l: LiquidityForecast) => <span className="text-xs font-medium text-slate-500">{l.property_name || propertyName(l.property_id)}</span> },
                ] as Column<LiquidityForecast>[]}
                data={liquidityForecasts}
                rowKey={(l) => l.id}
                sortable
                filterable
                filterPlaceholder="Search weeks..."
                filterKeys={['week_label', 'status', 'property_name']}
                emptyMessage="No liquidity forecasts found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Cash Pooling ── */}
          {activeTab === 'cash_pooling' && (
            <SectionCard
              title="Cash Pool Participants"
              subtitle="Account-level cash pooling and sweep configuration"
              icon={Layers}
              pad="none"
              actions={
                <button onClick={() => openModal('cash_pooling')} className={button.primary}>
                  <Plus className="w-4 h-4" /> Add Participant
                </button>
              }
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'account_name', label: 'Account', render: (p: CashPoolParticipant) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-lg"><Landmark size={12} /></div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{p.account_name}</span>
                        <span className="text-[10px] text-slate-400 font-medium">{p.entity || '—'}</span>
                      </div>
                    </div>
                  ) },
                  { key: 'balance', label: 'Balance', align: 'right' as const, render: (p: CashPoolParticipant) => <span className="text-xs font-bold text-slate-900 dark:text-white">{fmt(p.balance)}</span> },
                  { key: 'sweep_amount', label: 'Sweep Amount', align: 'right' as const, render: (p: CashPoolParticipant) => (
                    <span className="text-xs font-bold text-blue-600">{p.sweep_amount > 0 ? fmt(p.sweep_amount) : '—'}</span>
                  ) },
                  { key: 'role', label: 'Role', align: 'center' as const, render: (p: CashPoolParticipant) => {
                    const tone: StatusTone = p.role === 'Header' ? 'accent' : p.role === 'Reserve' ? 'warning' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{p.role}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (p: CashPoolParticipant) => <span className="text-xs font-medium text-slate-500">{p.property_name || propertyName(p.property_id)}</span> },
                ] as Column<CashPoolParticipant>[]}
                data={poolParticipants}
                rowKey={(p) => p.id}
                sortable
                filterable
                filterPlaceholder="Search participants..."
                filterKeys={['account_name', 'entity', 'role', 'property_name']}
                emptyMessage="No cash pool participants found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Investments ── */}
          {activeTab === 'investments' && (
            <SectionCard
              title="Investments"
              subtitle="Term deposits, treasury bills, and bonds"
              icon={PiggyBank}
              pad="none"
              actions={
                <button onClick={() => openModal('investments')} className={button.primary}>
                  <Plus className="w-4 h-4" /> New Investment
                </button>
              }
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'name', label: 'Investment', render: (i: Investment) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-lg"><PiggyBank size={12} /></div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{i.name}</span>
                        <span className="text-[10px] text-slate-400 font-medium">{i.type}</span>
                      </div>
                    </div>
                  ) },
                  { key: 'amount', label: 'Amount', align: 'right' as const, render: (i: Investment) => <span className="text-xs font-bold text-slate-900 dark:text-white">{fmt(i.amount)}</span> },
                  { key: 'interest_rate', label: 'Rate', align: 'right' as const, render: (i: Investment) => <span className="text-xs font-bold text-blue-600">{i.interest_rate}%</span> },
                  { key: 'maturity_date', label: 'Maturity', render: (i: Investment) => <span className="text-xs font-medium text-slate-500">{i.maturity_date || '—'}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (i: Investment) => {
                    const tone: StatusTone = i.status === 'active' ? 'success' : i.status === 'matured' ? 'warning' : 'neutral';
                    return <div className="flex justify-center"><Badge tone={tone}>{i.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (i: Investment) => <span className="text-xs font-medium text-slate-500">{i.property_name || propertyName(i.property_id)}</span> },
                ] as Column<Investment>[]}
                data={investments}
                rowKey={(i) => i.id}
                sortable
                filterable
                filterPlaceholder="Search investments..."
                filterKeys={['name', 'type', 'status', 'property_name']}
                emptyMessage="No investments found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Loans ── */}
          {activeTab === 'loans' && (
            <SectionCard
              title="Loan Management"
              subtitle="Outstanding loans and payment schedules"
              icon={Landmark}
              pad="none"
              actions={
                <button onClick={() => openModal('loans')} className={button.primary}>
                  <Plus className="w-4 h-4" /> New Loan
                </button>
              }
              bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
            >
              <DataTable
                columns={[
                  { key: 'lender', label: 'Lender', render: (l: Loan) => (
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-rose-50 dark:bg-rose-500/10 text-rose-600 rounded-lg"><Landmark size={12} /></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{l.lender}</span>
                    </div>
                  ) },
                  { key: 'principal', label: 'Principal', align: 'right' as const, render: (l: Loan) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(l.principal)}</span> },
                  { key: 'outstanding_balance', label: 'Outstanding', align: 'right' as const, render: (l: Loan) => <span className="text-xs font-bold text-rose-600">{fmt(l.outstanding_balance)}</span> },
                  { key: 'interest_rate', label: 'Rate', align: 'right' as const, render: (l: Loan) => <span className="text-xs font-bold text-blue-600">{l.interest_rate}%</span> },
                  { key: 'monthly_payment', label: 'Monthly', align: 'right' as const, render: (l: Loan) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(l.monthly_payment)}</span> },
                  { key: 'next_payment_date', label: 'Next Payment', render: (l: Loan) => <span className="text-xs font-medium text-slate-500">{l.next_payment_date || '—'}</span> },
                  { key: 'status', label: 'Status', align: 'center' as const, render: (l: Loan) => {
                    const tone: StatusTone = l.status === 'active' ? 'warning' : l.status === 'paid' ? 'success' : 'danger';
                    return <div className="flex justify-center"><Badge tone={tone}>{l.status}</Badge></div>;
                  } },
                  { key: 'property_name', label: 'Property', render: (l: Loan) => <span className="text-xs font-medium text-slate-500">{l.property_name || propertyName(l.property_id)}</span> },
                ] as Column<Loan>[]}
                data={loans}
                rowKey={(l) => l.id}
                sortable
                filterable
                filterPlaceholder="Search loans..."
                filterKeys={['lender', 'status', 'property_name']}
                emptyMessage="No loans found."
                containerClassName="rounded-lg border-0"
              />
            </SectionCard>
          )}

          {/* ── Foreign Exchange ── */}
          {activeTab === 'fx' && (
            <div className={layout.sectionStack}>
              <SectionCard
                title="Exchange Rates"
                subtitle="Current FX rates and daily changes"
                icon={Globe}
                pad="none"
                actions={
                  <button onClick={() => openModal('fx')} className={button.primary}>
                    <Plus className="w-4 h-4" /> New FX Rate
                  </button>
                }
                bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              >
                <DataTable
                  columns={[
                    { key: 'currency', label: 'Currency', render: (r: FxRate) => (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-lg"><Globe size={12} /></div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{r.currency}</span>
                      </div>
                    ) },
                    { key: 'rate', label: 'Rate', align: 'right' as const, render: (r: FxRate) => <span className="text-xs font-bold text-slate-900 dark:text-white">{Number(r.rate).toFixed(2)}</span> },
                    { key: 'change_pct', label: 'Change', align: 'right' as const, render: (r: FxRate) => (
                      <span className={`text-xs font-bold ${r.change_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {r.change_pct >= 0 ? '+' : ''}{r.change_pct}%
                      </span>
                    ) },
                    { key: 'last_updated', label: 'Last Updated', render: (r: FxRate) => <span className="text-xs font-medium text-slate-500">{r.last_updated ? new Date(r.last_updated).toLocaleDateString() : '—'}</span> },
                  ] as Column<FxRate>[]}
                  data={fxRates}
                  rowKey={(r) => r.id}
                  sortable
                  emptyMessage="No FX rates found."
                  containerClassName="rounded-lg border-0"
                />
              </SectionCard>

              <SectionCard
                title="FX Transactions"
                subtitle="Currency conversion history"
                icon={RefreshCw}
                pad="none"
                bodyClassName="divide-y divide-gray-100 dark:divide-slate-700"
              >
                <DataTable
                  columns={[
                    { key: 'transaction_date', label: 'Date', render: (t: FxTransaction) => (
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-lg"><Calendar size={12} /></div>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.transaction_date || '—'}</span>
                      </div>
                    ) },
                    { key: 'from_currency', label: 'From', render: (t: FxTransaction) => <span className="text-xs font-bold text-slate-900 dark:text-white">{t.from_currency} → {t.to_currency}</span> },
                    { key: 'amount', label: 'Amount', align: 'right' as const, render: (t: FxTransaction) => <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{fmt(t.amount)}</span> },
                    { key: 'rate', label: 'Rate', align: 'right' as const, render: (t: FxTransaction) => <span className="text-xs font-medium text-blue-600">{Number(t.rate).toFixed(2)}</span> },
                    { key: 'converted_amount', label: 'Converted', align: 'right' as const, render: (t: FxTransaction) => <span className="text-xs font-bold text-slate-900 dark:text-white">{fmt(t.converted_amount)}</span> },
                    { key: 'status', label: 'Status', align: 'center' as const, render: (t: FxTransaction) => {
                      const tone: StatusTone = t.status === 'Completed' ? 'success' : t.status === 'Pending' ? 'warning' : 'neutral';
                      return <div className="flex justify-center"><Badge tone={tone}>{t.status}</Badge></div>;
                    } },
                    { key: 'property_name', label: 'Property', render: (t: FxTransaction) => <span className="text-xs font-medium text-slate-500">{t.property_name || propertyName(t.property_id)}</span> },
                  ] as Column<FxTransaction>[]}
                  data={fxTransactions}
                  rowKey={(t) => t.id}
                  sortable
                  filterable
                  filterPlaceholder="Search FX transactions..."
                  filterKeys={['from_currency', 'to_currency', 'status', 'property_name']}
                  emptyMessage="No FX transactions found."
                  containerClassName="rounded-lg border-0"
                />
              </SectionCard>
            </div>
          )}
        </>
      )}

      {/* ── Generic create/edit modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={showModal}
        onClose={closeModal}
        onConfirm={handleSave}
        variant="form"
        size="md"
        loading={saving}
        confirmLabel="Save"
        confirmColor="indigo"
        title={
          modalType === 'forecast' ? 'New Cash Forecast' :
          modalType === 'liquidity' ? 'New Liquidity Plan' :
          modalType === 'cash_pooling' ? 'Add Pool Participant' :
          modalType === 'investments' ? 'New Investment' :
          modalType === 'loans' ? 'New Loan' :
          modalType === 'fx' ? 'New FX Rate' : 'New Record'
        }
        subtitle="Fill in the fields below to create a new record."
      >
        <div className="space-y-4">
          {/* Cash Forecast */}
          {modalType === 'forecast' && (
            <>
              <Field label="Period" value={formData.period || ''} onChange={v => updateField('period', v)} placeholder="e.g. 2025-01" />
              <Field label="Opening Balance" type="number" value={formData.opening_balance || ''} onChange={v => updateField('opening_balance', v)} />
              <Field label="Expected Inflows" type="number" value={formData.inflows || ''} onChange={v => updateField('inflows', v)} />
              <Field label="Expected Outflows" type="number" value={formData.outflows || ''} onChange={v => updateField('outflows', v)} />
              <Field label="Notes" value={formData.notes || ''} onChange={v => updateField('notes', v)} placeholder="Optional notes" />
            </>
          )}
          {/* Liquidity Planning */}
          {modalType === 'liquidity' && (
            <>
              <Field label="Week" value={formData.week_label || ''} onChange={v => updateField('week_label', v)} placeholder="e.g. W1" />
              <Field label="Opening Balance" type="number" value={formData.opening || ''} onChange={v => updateField('opening', v)} />
              <Field label="Expected Inflows" type="number" value={formData.inflows || ''} onChange={v => updateField('inflows', v)} />
              <Field label="Expected Outflows" type="number" value={formData.outflows || ''} onChange={v => updateField('outflows', v)} />
              <SelectField label="Status" value={formData.status || 'Surplus'} onChange={v => updateField('status', v)} options={['Surplus', 'Watch', 'Deficit']} />
            </>
          )}
          {/* Cash Pooling */}
          {modalType === 'cash_pooling' && (
            <>
              <Field label="Account" value={formData.account_name || ''} onChange={v => updateField('account_name', v)} placeholder="Account name" />
              <Field label="Entity" value={formData.entity || ''} onChange={v => updateField('entity', v)} placeholder="Entity / subsidiary" />
              <Field label="Balance" type="number" value={formData.balance || ''} onChange={v => updateField('balance', v)} />
              <Field label="Sweep Amount" type="number" value={formData.sweep_amount || ''} onChange={v => updateField('sweep_amount', v)} />
              <SelectField label="Role" value={formData.role || 'Participant'} onChange={v => updateField('role', v)} options={['Pool Leader', 'Participant']} />
            </>
          )}
          {/* Investments */}
          {modalType === 'investments' && (
            <>
              <Field label="Name" value={formData.name || ''} onChange={v => updateField('name', v)} placeholder="Investment name" />
              <SelectField label="Type" value={formData.type || 'Term Deposit'} onChange={v => updateField('type', v)} options={['Term Deposit', 'Bonds', 'Equity', 'Money Market']} />
              <Field label="Amount" type="number" value={formData.amount || ''} onChange={v => updateField('amount', v)} />
              <Field label="Interest Rate (%)" type="number" value={formData.interest_rate || ''} onChange={v => updateField('interest_rate', v)} />
              <Field label="Maturity Date" type="date" value={formData.maturity_date || ''} onChange={v => updateField('maturity_date', v)} />
              <SelectField label="Status" value={formData.status || 'active'} onChange={v => updateField('status', v)} options={['active', 'matured', 'redeemed']} />
            </>
          )}
          {/* Loans */}
          {modalType === 'loans' && (
            <>
              <Field label="Lender" value={formData.lender || ''} onChange={v => updateField('lender', v)} placeholder="Lender name" />
              <Field label="Principal" type="number" value={formData.principal || ''} onChange={v => updateField('principal', v)} />
              <Field label="Outstanding" type="number" value={formData.outstanding_balance || ''} onChange={v => updateField('outstanding_balance', v)} />
              <Field label="Interest Rate (%)" type="number" value={formData.interest_rate || ''} onChange={v => updateField('interest_rate', v)} />
              <Field label="Monthly Payment" type="number" value={formData.monthly_payment || ''} onChange={v => updateField('monthly_payment', v)} />
              <Field label="Next Payment Date" type="date" value={formData.next_payment_date || ''} onChange={v => updateField('next_payment_date', v)} />
              <SelectField label="Status" value={formData.status || 'active'} onChange={v => updateField('status', v)} options={['active', 'paid', 'defaulted']} />
            </>
          )}
          {/* Foreign Exchange */}
          {modalType === 'fx' && (
            <>
              <Field label="From Currency" value={formData.from_currency || ''} onChange={v => updateField('from_currency', v)} placeholder="e.g. USD" />
              <Field label="To Currency" value={formData.to_currency || ''} onChange={v => updateField('to_currency', v)} placeholder="e.g. ETB" />
              <Field label="Rate" type="number" value={formData.rate || ''} onChange={v => updateField('rate', v)} />
              <Field label="Effective Date" type="date" value={formData.effective_date || ''} onChange={v => updateField('effective_date', v)} />
              <Field label="Source" value={formData.source || ''} onChange={v => updateField('source', v)} placeholder="e.g. NBE, Reuters" />
            </>
          )}
        </div>
      </ModalSystem>
    </div>
  );
};

export default TreasuryManagement;

// ── Reusable form field helpers (used by the generic create modal) ──────────

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition';

const Field = ({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClass}
    />
  </div>
);

const SelectField = ({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);
