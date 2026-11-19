/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procurement Dashboard — Supply Chain & Procurement Portal (/erp/procurement/dashboard).
 * Executive dashboard with 14 KPIs, spend trends, supplier performance, and alerts.
 * Aligns 100% with unified_supply_chain_procurement_portal.md section 6.
 *
 * DB-integrated: fetches KPIs, alerts, and sections via /api/proc-portal/dashboard/*.
 * UI follows the Housekeeping/Engineering portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ShoppingCart,
  FileText,
  Truck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  Users,
  Bell,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  Calendar,
  PieChart,
  ShieldAlert,
  Award,
  Scale,
  Wrench,
  Sparkles,
  Utensils,
  Layers,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchDashboardKPIs,
  fetchDashboardAlerts,
  fetchDashboardSections,
  type DashboardKPIs,
  type ProcurementAlert,
  type DashboardSections,
} from '../../services/procurementService';

const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const priorityTone = (p: string): 'danger' | 'warning' | 'info' | 'neutral' =>
  p === 'Critical' || p === 'Emergency' || p === 'Urgent' ? 'danger' : p === 'High' ? 'warning' : p === 'Normal' ? 'info' : 'neutral';

const riskTone = (r: string): 'danger' | 'warning' | 'info' =>
  r === 'Critical' || r === 'High' ? 'danger' : r === 'Medium' ? 'warning' : 'info';

const ProcurementDashboard: React.FC = () => {
  const { currentPropertyId } = useERP();

  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [alerts, setAlerts] = useState<ProcurementAlert[]>([]);
  const [sections, setSections] = useState<DashboardSections | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpisData, alertsData, sectionsData] = await Promise.all([
        fetchDashboardKPIs(currentPropertyId || undefined),
        fetchDashboardAlerts(currentPropertyId || undefined),
        fetchDashboardSections(currentPropertyId || undefined),
      ]);
      setKpis(kpisData.kpis);
      setAlerts(alertsData.alerts);
      setSections(sectionsData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const maxSpend = sections ? Math.max(...sections.spendTrend.map(s => s.spend), 1) : 1;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Procurement Dashboard"
        subtitle="Executive overview of procurement performance, spending, and alerts."
        icon={ShoppingCart}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      {error && (
        <SectionCard tone="danger" pad="md">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </SectionCard>
      )}

      {/* ── KPI Cards (14 per spec) ──────────────────────────────────────── */}
      {!loading && kpis && (
        <div className={layout.kpiGrid}>
          <StatCard title="Total Spend" value={fmtMoney(kpis.totalSpend)} icon={DollarSign} tone="success" />
          <StatCard title="Monthly Spend" value={fmtMoney(kpis.monthlySpend)} icon={TrendingUp} tone="info" />
          <StatCard title="Annual Spend" value={fmtMoney(kpis.annualSpend)} icon={Calendar} tone="accent" />
          <StatCard title="Open Requisitions" value={kpis.openRequisitions} icon={FileText} tone="info" />
          <StatCard title="Pending Approvals" value={kpis.pendingApprovals} icon={Clock} tone="warning" />
          <StatCard title="Open RFQs" value={kpis.openRFQs} icon={FileText} tone="accent" />
          <StatCard title="Open POs" value={kpis.openPOs} icon={ShoppingCart} tone="accent" />
          <StatCard title="Overdue POs" value={kpis.overduePOs} icon={AlertTriangle} tone="danger" />
          <StatCard title="Pending Deliveries" value={kpis.pendingDeliveries} icon={Truck} tone="warning" />
          <StatCard title="Procurement Savings" value={fmtMoney(kpis.procurementSavings)} icon={CheckCircle2} tone="success" />
          <StatCard title="Budget Utilization" value={`${kpis.budgetUtilization}%`} icon={PieChart} tone="warning" />
          <StatCard title="Supplier Performance" value={`${kpis.supplierPerformance}`} icon={Award} tone="success" caption="avg score" />
          <StatCard title="Contract Expiry" value={kpis.contractExpiry} icon={Calendar} tone="warning" caption="within 90 days" />
          <StatCard title="Supplier Risk" value={kpis.supplierRisk} icon={ShieldAlert} tone="danger" caption="high/critical" />
        </div>
      )}

      {/* ── Department Integration KPIs ──────────────────────────────────── */}
      {!loading && kpis && (
        <SectionCard
          title="Department Integration"
          subtitle="Requisitions & demand forecasts originated from department portals"
          icon={Layers}
          pad="md"
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Engineering</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{kpis.engineeringRequisitions}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">requisitions</p>
            </div>
            <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Housekeeping</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{kpis.housekeepingRequisitions}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">requisitions</p>
            </div>
            <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <Utensils className="w-4 h-4 text-orange-600" />
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">F&B</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{kpis.foodBeverageRequisitions}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">requisitions</p>
            </div>
            <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-blue-600" />
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Dept Requisitions</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{kpis.departmentRequisitions}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">total from depts</p>
            </div>
            <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Dept Forecasts</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{kpis.departmentForecasts}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">synced demand</p>
            </div>
            <div className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="w-4 h-4 text-purple-600" />
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Total Forecasts</p>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{kpis.totalForecasts}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">all sources</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Procurement Spend Trend ──────────────────────────────────────── */}
      {sections && (
        <SectionCard title="Procurement Spend Trend" subtitle="Last 6 months" icon={TrendingUp} pad="md">
          <div className="flex items-end justify-between gap-3 h-40 pt-4">
            {sections.spendTrend.map((s, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 tabular-nums">
                  {s.spend > 0 ? fmtMoney(s.spend) : '—'}
                </div>
                <div
                  className="w-full rounded-t-lg bg-[var(--color-accent-operations)]/80 dark:bg-[var(--color-accent-operations)]/60 transition-all min-h-[4px]"
                  style={{ height: `${Math.max((s.spend / maxSpend) * 100, 2)}%` }}
                />
                <div className="text-xs text-gray-500 dark:text-gray-500">{s.month}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Two-column: Open Requisitions + Supplier Performance ─────────── */}
      {sections && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Open Requisitions */}
          <SectionCard title="Open Requisitions" subtitle={`${sections.openRequisitions.length} pending`} icon={FileText} pad="none">
            {sections.openRequisitions.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No open requisitions</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {sections.openRequisitions.map((r) => (
                  <div key={r.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.pr_number}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.department} · {r.requester}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(r.estimated_total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Supplier Performance */}
          <SectionCard title="Supplier Performance" subtitle="Top suppliers by score" icon={Award} pad="none">
            {sections.supplierPerformance.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No supplier data</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {sections.supplierPerformance.map((s) => (
                  <div key={s.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.legal_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Quality {s.quality_score} · OTD {s.on_time_delivery_rate}%</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{s.overall_score}</span>
                      <Badge tone={riskTone(s.risk_level)}>{s.risk_level}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── Two-column: Delivery Alerts + Contract Expiry ────────────────── */}
      {sections && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Delivery Alerts */}
          <SectionCard title="Delivery Alerts" subtitle={`${sections.deliveryAlerts.length} pending deliveries`} icon={Truck} pad="none">
            {sections.deliveryAlerts.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No pending deliveries</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {sections.deliveryAlerts.map((d) => (
                  <div key={d.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">PO: {d.po_id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Expected: {d.expected_date} · {d.total_items} items</p>
                    </div>
                    <Badge tone={d.status === 'Delayed' ? 'danger' : d.status === 'In Transit' ? 'info' : 'warning'}>{d.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Contract Expiry */}
          <SectionCard title="Contract Expiry" subtitle="Upcoming expirations" icon={Calendar} pad="none">
            {sections.contractExpiry.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No active contracts</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {sections.contractExpiry.map((c) => {
                  const daysToExpiry = Math.round((new Date(c.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={c.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.contract_number}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Ends: {c.end_date} · {fmtMoney(c.contract_value)}</p>
                      </div>
                      <Badge tone={daysToExpiry <= 30 ? 'danger' : daysToExpiry <= 60 ? 'warning' : 'info'}>
                        {daysToExpiry > 0 ? `${daysToExpiry}d` : 'Expired'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── Two-column: Budget Utilization + Supplier Risk ───────────────── */}
      {sections && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Budget Utilization */}
          <SectionCard title="Budget Utilization" subtitle="Budget vs. committed + actual" icon={PieChart} pad="none">
            {sections.budgetUtilization.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No budget data</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {sections.budgetUtilization.map((b) => {
                  const used = (b.committed_amount || 0) + (b.actual_spend || 0);
                  const pct = b.budgeted_amount > 0 ? Math.round((used / b.budgeted_amount) * 100) : 0;
                  return (
                    <div key={b.id} className="px-6 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.budget_code}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{b.department} · {b.category}</p>
                        </div>
                        <span className="text-xs font-bold tabular-nums text-gray-700 dark:text-gray-300">{pct}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-[var(--color-danger)]' : pct > 70 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums">{fmtMoney(used)} used</span>
                        <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums">{fmtMoney(b.budgeted_amount)} budget</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Supplier Risk */}
          <SectionCard title="Supplier Risk" subtitle="High and critical risk suppliers" icon={ShieldAlert} pad="none">
            {sections.supplierRisk.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                <CheckCircle2 className="w-8 h-8 mx-auto text-[var(--color-success)] mb-2" />
                No high-risk suppliers
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {sections.supplierRisk.map((s) => (
                  <div key={s.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.legal_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.supplier_type} · Score {s.overall_score}</p>
                    </div>
                    <Badge tone={riskTone(s.risk_level)}>{s.risk_level}</Badge>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── Active Alerts ────────────────────────────────────────────────── */}
      <SectionCard
        title="Active Alerts"
        subtitle={`Showing ${alerts.length} actionable alerts`}
        icon={Bell}
        tone={alerts.some(a => a.severity === 'Critical' || a.severity === 'High') ? 'danger' : 'warning'}
        pad="none"
      >
        {alerts.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No active alerts
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {alerts.map((alert) => (
              <div key={alert.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Badge
                    tone={alert.severity === 'Critical' ? 'danger' : alert.severity === 'High' ? 'danger' : alert.severity === 'Medium' ? 'warning' : 'info'}
                  >
                    {alert.severity}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{alert.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{alert.description}</p>
                  </div>
                </div>
                {alert.action_required && (
                  <button className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                    View
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
      <SectionCard title="Quick Actions" pad="md">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'New Requisition', icon: FileText },
            { label: 'New RFQ', icon: FileText },
            { label: 'New PO', icon: ShoppingCart },
            { label: 'Add Supplier', icon: Users },
          ].map((action) => (
            <button
              key={action.label}
              className={`p-3 rounded-xl border text-center smooth-transition ${
                'border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600'
              }`}
            >
              <action.icon className="w-5 h-5 mx-auto text-indigo-600 dark:text-indigo-400 mb-1" />
              <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{action.label}</p>
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
};

export default ProcurementDashboard;
