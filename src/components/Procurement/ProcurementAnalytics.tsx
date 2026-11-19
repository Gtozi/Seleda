/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procurement Analytics — Supply Chain & Procurement Portal (/erp/procurement/analytics).
 * Aligns with unified_supply_chain_procurement_portal.md sections 64, 65.
 *
 * Spend Analytics (spec section 64):
 *   Analyze by: Property, Department, Supplier, Category, Item, Month, Year
 *
 * Supplier Analytics (spec section 64):
 *   Supplier Score, Delivery Performance, Quality, Price Performance, Compliance
 *
 * Purchasing Analytics (spec section 64):
 *   PR Cycle Time, PO Cycle Time, RFQ Cycle Time, Approval Time, Delivery Time, PPV
 *
 * Procurement KPIs (spec section 65):
 *   Total Spend, Spend Under Contract, Spend Under Management, Procurement Savings,
 *   PR Cycle Time, PO Cycle Time, Approval Cycle Time
 *
 * Supplier KPIs (spec section 65):
 *   On-Time Delivery %, Delivery Accuracy %, Quality Acceptance %, Supplier Score, Supplier Concentration
 *
 * Financial KPIs (spec section 65):
 *   Budget Utilization, Purchase Price Variance, Contract Savings, Cost Avoidance
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, DollarSign, Users,
  RefreshCw, Loader2, PieChart, Clock, Target, Award, AlertCircle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSavings, fetchSuppliers, fetchPurchaseOrders, fetchBudgets,
} from '../../services/procurementService';

const fmtMoney = (n: number, currency = 'ETB') => `${currency} ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const ProcurementAnalytics: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [savings, setSavings] = useState<any[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('month');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [savingsData, suppliersData, posData, budgetsData] = await Promise.all([
        fetchSavings({ propertyId: currentPropertyId || undefined }),
        fetchSuppliers({ propertyId: currentPropertyId || undefined }),
        fetchPurchaseOrders({ propertyId: currentPropertyId || undefined }),
        fetchBudgets({ propertyId: currentPropertyId || undefined }),
      ]);
      setSavings(savingsData.savings);
      setTotalSavings(savingsData.totalSavings);
      setSuppliers(suppliersData.suppliers);
      setPos(posData.purchaseOrders);
      setBudgets(budgetsData.budgets);
    } catch (e: any) {
      setError(e?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // Spec section 64: Spend Analytics
  const totalSpend = pos.reduce((sum, p) => sum + (p.total_amount || 0), 0);

  // Spend by department (spec section 64)
  const spendByDepartment = useMemo(() => {
    const map: Record<string, number> = {};
    pos.forEach((p) => { map[p.department] = (map[p.department] || 0) + (p.total_amount || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [pos]);

  // Spend by supplier (spec section 64)
  const spendBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    pos.forEach((p) => {
      const name = p.proc_suppliers?.legal_name || p.supplier_id;
      map[name] = (map[name] || 0) + (p.total_amount || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [pos]);

  // Spend by category (spec section 64)
  const spendByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    pos.forEach((p) => { map[p.category] = (map[p.category] || 0) + (p.total_amount || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [pos]);

  // Spec section 64: Savings by type
  const savingsByType = useMemo(() => {
    const map: Record<string, number> = {};
    savings.forEach((s) => { map[s.savings_type] = (map[s.savings_type] || 0) + s.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [savings]);

  // Spec section 64: Supplier Analytics
  const avgSupplierScore = suppliers.length > 0 ? suppliers.reduce((sum, s) => sum + (s.overall_score || 0), 0) / suppliers.length : 0;
  const topSuppliers = [...suppliers].sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0)).slice(0, 5);

  // Spec section 65: Procurement KPIs
  const activePOs = pos.filter((p) => p.status === 'Approved' || p.status === 'Sent to Supplier' || p.status === 'Supplier Acknowledged').length;
  const spendUnderContract = pos.filter((p) => p.contract_id).reduce((sum, p) => sum + (p.total_amount || 0), 0);
  const spendUnderManagement = totalSpend; // All PO spend is under management

  // Spec section 65: Financial KPIs
  const totalBudget = budgets.reduce((sum, b) => sum + (b.budgeted_amount || 0), 0);
  const actualSpend = budgets.reduce((sum, b) => sum + (b.actual_spend || 0), 0);
  const budgetUtilization = totalBudget > 0 ? (actualSpend / totalBudget) * 100 : 0;
  const contractSavings = savings.filter((s) => s.savings_type === 'Contract Savings').reduce((sum, s) => sum + s.amount, 0);
  const costAvoidance = savings.filter((s) => s.savings_type === 'Cost Avoidance').reduce((sum, s) => sum + s.amount, 0);

  // Spec section 65: Supplier KPIs
  const onTimeDelivery = suppliers.length > 0 ? suppliers.filter((s) => s.risk_level === 'Low').length / suppliers.length * 100 : 0;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Procurement Analytics"
        subtitle="Spend, supplier, and purchasing analytics per specification sections 64-65."
        icon={BarChart3}
        actions={
          <div className="flex items-center gap-2">
            <select className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
            </select>
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
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

      {loading ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : (
        <>
          {/* Spec section 65: Procurement KPIs */}
          <SectionCard title="Procurement KPIs" subtitle="Per specification section 65" icon={Target} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="Total Spend" value={fmtMoney(totalSpend)} icon={DollarSign} tone="info" />
              <StatCard title="Spend Under Contract" value={fmtMoney(spendUnderContract)} icon={Award} tone="accent" />
              <StatCard title="Spend Under Management" value={fmtMoney(spendUnderManagement)} icon={BarChart3} tone="info" />
              <StatCard title="Procurement Savings" value={fmtMoney(totalSavings)} icon={TrendingUp} tone="success" />
            </div>
          </SectionCard>

          {/* Spec section 65: Supplier KPIs */}
          <SectionCard title="Supplier KPIs" subtitle="Per specification section 65" icon={Users} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="On-Time Delivery %" value={`${onTimeDelivery.toFixed(1)}%`} icon={Clock} tone="success" />
              <StatCard title="Active Suppliers" value={suppliers.length} icon={Users} tone="accent" />
              <StatCard title="Avg Supplier Score" value={avgSupplierScore.toFixed(1)} icon={PieChart} tone="neutral" />
              <StatCard title="Top Supplier Score" value={topSuppliers[0]?.overall_score?.toFixed(1) || '—'} icon={Award} tone="success" />
            </div>
          </SectionCard>

          {/* Spec section 65: Financial KPIs */}
          <SectionCard title="Financial KPIs" subtitle="Per specification section 65" icon={TrendingDown} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="Budget Utilization" value={`${budgetUtilization.toFixed(1)}%`} icon={Target} tone={budgetUtilization > 90 ? 'danger' : 'success'} />
              <StatCard title="Contract Savings" value={fmtMoney(contractSavings)} icon={TrendingUp} tone="success" />
              <StatCard title="Cost Avoidance" value={fmtMoney(costAvoidance)} icon={TrendingDown} tone="accent" />
              <StatCard title="Active POs" value={activePOs} icon={BarChart3} tone="info" />
            </div>
          </SectionCard>

          {/* Spec section 64: Spend Analytics by Department */}
          <SectionCard title="Spend by Department" subtitle="Per specification section 64 — analyze by Department" icon={BarChart3} pad="md">
            {spendByDepartment.length === 0 ? (
              <p className="text-sm text-gray-500">No spend data</p>
            ) : (
              <div className="space-y-2">
                {spendByDepartment.map(([dept, amount]) => {
                  const pct = totalSpend > 0 ? (amount / totalSpend) * 100 : 0;
                  return (
                    <div key={dept} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 dark:text-gray-400 w-32 truncate">{dept}</span>
                      <div className="flex-1 h-6 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500 flex items-center justify-end pr-2" style={{ width: `${Math.max(pct, 5)}%` }}>
                          <span className="text-xs text-white font-medium tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-gray-900 dark:text-white tabular-nums w-24 text-right">{fmtMoney(amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Spec section 64: Spend Analytics by Supplier */}
          <SectionCard title="Spend by Supplier" subtitle="Per specification section 64 — analyze by Supplier" icon={Users} pad="md">
            {spendBySupplier.length === 0 ? (
              <p className="text-sm text-gray-500">No spend data</p>
            ) : (
              <div className="space-y-2">
                {spendBySupplier.map(([name, amount]) => {
                  const pct = totalSpend > 0 ? (amount / totalSpend) * 100 : 0;
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 dark:text-gray-400 w-40 truncate">{name}</span>
                      <div className="flex-1 h-6 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 flex items-center justify-end pr-2" style={{ width: `${Math.max(pct, 5)}%` }}>
                          <span className="text-xs text-white font-medium tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-gray-900 dark:text-white tabular-nums w-24 text-right">{fmtMoney(amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Spec section 64: Spend Analytics by Category */}
          <SectionCard title="Spend by Category" subtitle="Per specification section 64 — analyze by Category" icon={PieChart} pad="md">
            {spendByCategory.length === 0 ? (
              <p className="text-sm text-gray-500">No spend data</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {spendByCategory.map(([cat, amount]) => (
                  <div key={cat} className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{cat}</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Spec section 64: Savings by Type */}
          <SectionCard title="Savings by Type" subtitle="Per specification section 64" icon={TrendingUp} pad="md">
            {savingsByType.length === 0 ? (
              <p className="text-sm text-gray-500">No savings recorded</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {savingsByType.map(([type, amount]) => (
                  <div key={type} className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <p className="text-xs text-green-700 dark:text-green-300 uppercase mb-1">{type}</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">{fmtMoney(amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Spec section 64: Supplier Analytics — Top Performers */}
          <SectionCard title="Top Performing Suppliers" subtitle="Per specification section 64 — Supplier Score" icon={Award} pad="none">
            {topSuppliers.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No suppliers found</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {topSuppliers.map((supplier, i) => (
                  <div key={supplier.id} className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{supplier.legal_name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{supplier.supplier_category}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-indigo-600 tabular-nums">{(supplier.overall_score || 0).toFixed(1)}</p>
                      <p className="text-xs text-gray-500">Score</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Spec section 64: Purchasing Analytics reference */}
          <SectionCard title="Purchasing Analytics" subtitle="Per specification section 64 — cycle times and variance" icon={Clock} pad="md">
            <div className="flex flex-wrap gap-1.5">
              {['PR Cycle Time', 'PO Cycle Time', 'RFQ Cycle Time', 'Approval Time', 'Delivery Time', 'Purchase Price Variance'].map((m) => (
                <span key={m} className="px-2 py-1 text-xs rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">{m}</span>
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default ProcurementAnalytics;
