/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procurement Budget — Supply Chain & Procurement Portal (/erp/procurement/budget).
 * Aligns with unified_supply_chain_procurement_portal.md section 37.
 *
 * Budget types (spec section 37):
 *   Annual, Monthly, Department, Category, Property
 *
 * Budget tracking (spec section 37):
 *   Available Budget → PO Commitment → Remaining Budget
 *   Committed Spend, Actual Spend, Remaining Budget
 *
 * Budget control (spec section 37):
 *   Hard budget control, Soft budget warning, Budget override, Emergency exception
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PiggyBank, Plus, Search, RefreshCw, Loader2, AlertCircle,
  Eye, TrendingDown, TrendingUp, Wallet, ShieldAlert, AlertTriangle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchBudgets, createBudget, type Budget, type BudgetType, type ControlType,
} from '../../services/procurementService';

// Spec section 37: Budget types
const BUDGET_TYPES: BudgetType[] = ['Annual', 'Monthly', 'Quarterly', 'Project'];

// Spec section 37: Control types
const CONTROL_TYPES: ControlType[] = ['Hard', 'Soft', 'None'];

const DEPARTMENTS = [
  'Procurement', 'Food & Beverage', 'Kitchen', 'Housekeeping', 'Engineering',
  'Front Office', 'Rooms', 'Sales & Marketing', 'Finance', 'HR',
  'IT', 'Administration', 'Spa', 'Security',
];

const CATEGORIES = [
  'Food', 'Beverage', 'Cleaning Supplies', 'Linen', 'Amenities',
  'Equipment', 'Maintenance', 'Office Supplies', 'IT Equipment',
  'Furniture', 'Utilities', 'Services', 'Other',
];

const STATUS_TONE: Record<string, any> = {
  Draft: 'neutral', Active: 'success', Closed: 'info', Frozen: 'warning',
};

const CONTROL_TONE: Record<ControlType, any> = {
  Hard: 'danger', Soft: 'warning', None: 'neutral',
};

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const fmtMoney = (n: number, currency = 'ETB') => `${currency} ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const utilizationPct = (b: Budget) => {
  if (b.budgeted_amount <= 0) return 0;
  return Math.min(100, ((b.actual_spend + b.committed_amount) / b.budgeted_amount) * 100);
};

const BudgetControl: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<Budget | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | BudgetType>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [form, setForm] = useState({
    budgetCode: '', department: 'Procurement', category: 'Food',
    budgetType: 'Annual' as BudgetType, fiscalYear: new Date().getFullYear(),
    periodStart: '', periodEnd: '', budgetedAmount: 0, currency: 'ETB',
    controlType: 'Soft' as ControlType, notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBudgets({ propertyId: currentPropertyId || undefined });
      setBudgets(data.budgets);
    } catch (e: any) {
      setError(e?.message || 'Failed to load budgets');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return budgets.filter((b) => {
      if (typeFilter !== 'All' && b.budget_type !== typeFilter) return false;
      if (statusFilter !== 'All' && b.status !== statusFilter) return false;
      const q = search.trim().toLowerCase();
      return !q || (b.budget_code || '').toLowerCase().includes(q) || (b.department || '').toLowerCase().includes(q) || (b.category || '').toLowerCase().includes(q);
    });
  }, [budgets, search, typeFilter, statusFilter]);

  const submitCreate = async () => {
    if (!form.budgetCode || !form.department || !form.category || !form.periodStart || !form.periodEnd) {
      addNotification('Budget code, department, category, and period dates are required', 'warning', 'Procurement');
      return;
    }
    setSubmitting(true);
    try {
      const { budget } = await createBudget({
        budgetCode: form.budgetCode, propertyId: currentPropertyId || undefined,
        department: form.department, category: form.category, budgetType: form.budgetType,
        fiscalYear: form.fiscalYear, periodStart: form.periodStart, periodEnd: form.periodEnd,
        budgetedAmount: form.budgetedAmount, currency: form.currency,
        controlType: form.controlType, notes: form.notes,
      });
      setBudgets((prev) => [budget, ...prev]);
      addNotification(`Budget ${budget.budget_code} created`, 'task', 'Procurement');
      setShowForm(false);
      setForm({ budgetCode: '', department: 'Procurement', category: 'Food', budgetType: 'Annual', fiscalYear: new Date().getFullYear(), periodStart: '', periodEnd: '', budgetedAmount: 0, currency: 'ETB', controlType: 'Soft', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create budget', 'warning', 'Procurement');
    } finally {
      setSubmitting(false);
    }
  };

  const totals = useMemo(() => {
    return budgets.reduce((acc, b) => ({
      budgeted: acc.budgeted + b.budgeted_amount,
      committed: acc.committed + b.committed_amount,
      actual: acc.actual + b.actual_spend,
      remaining: acc.remaining + b.remaining_budget,
    }), { budgeted: 0, committed: 0, actual: 0, remaining: 0 });
  }, [budgets]);

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Procurement Budget"
        subtitle="Budget management and control per specification section 37."
        icon={PiggyBank}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Budget
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
        <StatCard title="Total Budgeted" value={fmtMoney(totals.budgeted)} icon={Wallet} tone="info" />
        <StatCard title="Committed Spend" value={fmtMoney(totals.committed)} icon={TrendingDown} tone="warning" />
        <StatCard title="Actual Spend" value={fmtMoney(totals.actual)} icon={TrendingUp} tone="accent" />
        <StatCard title="Remaining" value={fmtMoney(totals.remaining)} icon={PiggyBank} tone="success" />
      </div>

      {/* Budget Control Flow (spec section 37) */}
      <SectionCard title="Budget Control Flow" subtitle="Per specification section 37" icon={ShieldAlert} pad="md">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 font-medium">Available Budget</div>
          <span className="text-gray-400">→</span>
          <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-medium">PO Commitment</div>
          <span className="text-gray-400">→</span>
          <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-medium">Remaining Budget</div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <p className="text-xs font-bold text-gray-500 mb-2">Control Modes:</p>
          <div className="flex flex-wrap gap-2">
            <Badge tone="danger">Hard Budget Control</Badge>
            <Badge tone="warning">Soft Budget Warning</Badge>
            <Badge tone="info">Budget Override</Badge>
            <Badge tone="neutral">Emergency Exception</Badge>
          </div>
        </div>
      </SectionCard>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input className={inputClass + ' pl-10'} placeholder="Search by code, department, category..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass + ' max-w-[140px]'} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
            <option value="All">All Types</option>
            {BUDGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={inputClass + ' max-w-[140px]'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All Status</option>
            <option value="Draft">Draft</option>
            <option value="Active">Active</option>
            <option value="Closed">Closed</option>
            <option value="Frozen">Frozen</option>
          </select>
        </div>
      </SectionCard>

      {/* Budgets List */}
      <SectionCard title="Budgets" subtitle={`${filtered.length} budget${filtered.length !== 1 ? 's' : ''}`} pad="none">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500 dark:text-gray-400">
            <PiggyBank className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No budgets found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((b) => {
              const pct = utilizationPct(b);
              const overBudget = pct >= 100;
              const warning = pct >= 80 && pct < 100;
              return (
                <div key={b.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => setViewing(b)}>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Badge tone={STATUS_TONE[b.status] || 'neutral'}>{b.status}</Badge>
                      <Badge tone={CONTROL_TONE[b.control_type]}>{b.control_type} Control</Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.budget_code} · {b.department} / {b.category}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{b.budget_type} · FY{b.fiscal_year} · {b.period_start} → {b.period_end}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(b.budgeted_amount, b.currency)}</p>
                      <p className={`text-xs tabular-nums ${overBudget ? 'text-red-500' : warning ? 'text-amber-500' : 'text-green-500'}`}>
                        Remaining: {fmtMoney(b.remaining_budget, b.currency)}
                      </p>
                    </div>
                  </div>
                  {/* Utilization bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                      <div className={`h-full rounded-full ${overBudget ? 'bg-red-500' : warning ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`text-xs font-medium tabular-nums ${overBudget ? 'text-red-500' : warning ? 'text-amber-500' : 'text-gray-500'}`}>{pct.toFixed(0)}%</span>
                    {overBudget && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} title="New Budget" size="xl" loading={submitting} confirmLabel="Create" onConfirm={submitCreate}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Budget Code *</label>
              <input className={inputClass} value={form.budgetCode} onChange={(e) => setForm({ ...form, budgetCode: e.target.value })} placeholder="e.g. BUD-2026-001" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Budget Type *</label>
              <select className={inputClass} value={form.budgetType} onChange={(e) => setForm({ ...form, budgetType: e.target.value as BudgetType })}>
                {BUDGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Department *</label>
              <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Category *</label>
              <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Fiscal Year *</label>
              <input type="number" className={inputClass} value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: parseInt(e.target.value) || new Date().getFullYear() })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Currency</label>
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="ETB">ETB</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Period Start *</label>
              <input type="date" className={inputClass} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Period End *</label>
              <input type="date" className={inputClass} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Budgeted Amount *</label>
              <input type="number" className={inputClass} value={form.budgetedAmount} onChange={(e) => setForm({ ...form, budgetedAmount: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Control Type</label>
              <select className={inputClass} value={form.controlType} onChange={(e) => setForm({ ...form, controlType: e.target.value as ControlType })}>
                {CONTROL_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Budget notes" />
          </div>
        </div>
      </ModalSystem>

      {/* View Detail Modal */}
      {viewing && (
        <ModalSystem isOpen={!!viewing} onClose={() => setViewing(null)} title="Budget Details" size="lg" showFooter={false}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500 uppercase">Budget Code</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.budget_code}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewing.status] || 'neutral'}>{viewing.status}</Badge></div>
              <div><p className="text-xs text-gray-500 uppercase">Department</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.department}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Category</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.category}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Type</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.budget_type}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Fiscal Year</p><p className="text-sm font-medium text-gray-900 dark:text-white">FY{viewing.fiscal_year}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Period</p><p className="text-sm font-medium text-gray-900 dark:text-white">{viewing.period_start} → {viewing.period_end}</p></div>
              <div><p className="text-xs text-gray-500 uppercase">Control</p><Badge tone={CONTROL_TONE[viewing.control_type]}>{viewing.control_type}</Badge></div>
            </div>

            {/* Budget breakdown */}
            <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
              <p className="text-xs font-bold text-gray-500 uppercase mb-3">Budget Breakdown</p>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-gray-500">Budgeted</p><p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(viewing.budgeted_amount, viewing.currency)}</p></div>
                <div><p className="text-xs text-gray-500">Committed (PO)</p><p className="text-lg font-bold text-amber-600 tabular-nums">{fmtMoney(viewing.committed_amount, viewing.currency)}</p></div>
                <div><p className="text-xs text-gray-500">Actual Spend</p><p className="text-lg font-bold text-indigo-600 tabular-nums">{fmtMoney(viewing.actual_spend, viewing.currency)}</p></div>
                <div><p className="text-xs text-gray-500">Remaining</p><p className={`text-lg font-bold tabular-nums ${viewing.remaining_budget < 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtMoney(viewing.remaining_budget, viewing.currency)}</p></div>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">Utilization</span>
                  <span className="font-medium tabular-nums">{utilizationPct(viewing).toFixed(0)}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
                  <div className={`h-full rounded-full ${utilizationPct(viewing) >= 100 ? 'bg-red-500' : utilizationPct(viewing) >= 80 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${utilizationPct(viewing)}%` }} />
                </div>
              </div>
            </div>

            {viewing.notes && <div><p className="text-xs text-gray-500 uppercase mb-1">Notes</p><p className="text-sm text-gray-700 dark:text-gray-300">{viewing.notes}</p></div>}
          </div>
        </ModalSystem>
      )}
    </div>
  );
};

export default BudgetControl;
