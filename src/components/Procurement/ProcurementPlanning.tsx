/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procurement Planning — Supply Chain & Procurement Portal (/erp/procurement/procurement-planning).
 * Aligns 100% with unified_supply_chain_procurement_portal.md section 9.
 *
 * Converts expected demand into a purchasing plan with:
 * - 5 planning horizons (Daily, Weekly, Monthly, Quarterly, Annual)
 * - 11 planning factors (Occupancy, Forecast rooms, Restaurant covers, Banquet events,
 *   Spa appointments, Maintenance plans, Seasonal demand, Supplier lead time,
 *   Contract commitments, Inventory levels, Budget availability)
 * - Unified plan table merging demand forecasts + pending requisitions
 * - Budget availability by department
 * - Open POs + expected deliveries in horizon
 * - Convert forecast to requisition action
 *
 * DB-integrated via /api/proc-portal/procurement-plan.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  RefreshCw,
  Loader2,
  TrendingUp,
  ShoppingCart,
  Truck,
  FileText,
  DollarSign,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Building,
  BedDouble,
  Utensils,
  PartyPopper,
  Sparkles,
  Wrench,
  Sun,
  Timer,
  FileCheck,
  Package,
  Wallet,
  Plus,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchProcurementPlan,
  convertForecastToRequisition,
  type ProcurementPlan,
  type PlanningHorizon,
  type PlanItem,
} from '../../services/procurementService';

const HORIZONS: PlanningHorizon[] = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annual'];

const PLAN_DEPARTMENTS = [
  'All',
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

// Spec section 9: Planning factors (11)
const PLANNING_FACTORS = [
  { key: 'occupancy', label: 'Occupancy', icon: BedDouble },
  { key: 'forecastRoomsSold', label: 'Forecast Rooms Sold', icon: TrendingUp },
  { key: 'restaurantCovers', label: 'Restaurant Covers', icon: Utensils },
  { key: 'banquetEvents', label: 'Banquet Events', icon: PartyPopper },
  { key: 'spaAppointments', label: 'Spa Appointments', icon: Sparkles },
  { key: 'maintenancePlans', label: 'Maintenance Plans', icon: Wrench },
  { key: 'seasonalDemand', label: 'Seasonal Demand', icon: Sun },
  { key: 'supplierLeadTime', label: 'Supplier Lead Time', icon: Timer },
  { key: 'contractCommitments', label: 'Contract Commitments', icon: FileCheck },
  { key: 'inventoryLevels', label: 'Inventory Levels', icon: Package },
  { key: 'budgetAvailability', label: 'Budget Availability', icon: Wallet },
] as const;

const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const itemStatusTone = (status: string): 'danger' | 'warning' | 'info' | 'success' | 'neutral' => {
  if (status === 'Pending') return 'warning';
  if (status === 'Converted to Requisition' || status === 'Approved') return 'success';
  if (status === 'Sourcing') return 'info';
  if (status === 'Draft' || status === 'Submitted' || status === 'Under Review') return 'neutral';
  return 'neutral';
};

const confidenceTone = (c: string): 'danger' | 'warning' | 'success' =>
  c === 'High' ? 'success' : c === 'Medium' ? 'warning' : 'danger';

const ProcurementPlanning: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [plan, setPlan] = useState<ProcurementPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<PlanningHorizon>('Monthly');
  const [department, setDepartment] = useState<string>('All');

  // Convert-to-requisition state
  const [convertItem, setConvertItem] = useState<PlanItem | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertRequester, setConvertRequester] = useState('');
  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProcurementPlan({
        propertyId: currentPropertyId || undefined,
        horizon,
        department: department !== 'All' ? department : undefined,
      });
      setPlan(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load procurement plan');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, horizon, department]);

  useEffect(() => { load(); }, [load]);

  const handleConvert = (item: PlanItem) => {
    if (item.type === 'Forecast') {
      setConvertItem(item);
      setConvertRequester('');
    }
  };

  const confirmConvert = async () => {
    if (!convertItem) return;
    if (!convertRequester.trim()) {
      addNotification?.({ type: 'warning', message: 'Requester name is required' });
      return;
    }
    setConverting(true);
    try {
      const result = await convertForecastToRequisition(convertItem.id, {
        requester: convertRequester,
      });
      addNotification?.({
        type: 'success',
        message: `Converted to ${result.requisition.pr_number} (Draft)`,
      });
      setConvertItem(null);
      await load();
    } catch (e: any) {
      addNotification?.({ type: 'error', message: e?.message || 'Failed to convert forecast' });
    } finally {
      setConverting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Procurement Planning"
        subtitle="Convert expected demand into a purchasing plan across planning horizons."
        icon={Calendar}
        actions={
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {PLAN_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
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

      {/* ── Planning Horizon Segments ──────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-slate-800 w-fit">
        {HORIZONS.map((h) => (
          <button
            key={h}
            onClick={() => setHorizon(h)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              horizon === h
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {h}
          </button>
        ))}
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      {!loading && plan && (
        <div className={layout.kpiGrid}>
          <StatCard title="Plan Items" value={plan.kpis.totalPlanItems} icon={FileText} tone="info" />
          <StatCard title="Pending Conversion" value={plan.kpis.pendingCount} icon={Clock} tone="warning" />
          <StatCard title="Converted" value={plan.kpis.convertedCount} icon={CheckCircle2} tone="success" />
          <StatCard title="Planned Value" value={fmtMoney(plan.kpis.totalPlannedValue)} icon={DollarSign} tone="accent" />
          <StatCard title="Open POs (Horizon)" value={plan.kpis.openPOs} icon={ShoppingCart} tone="accent" />
          <StatCard title="Expected Deliveries" value={plan.kpis.expectedDeliveries} icon={Truck} tone="warning" />
        </div>
      )}

      {/* ── Planning Factors (spec section 9) ──────────────────────────── */}
      {plan && (
        <SectionCard title="Planning Factors" subtitle="Inputs that drive the procurement plan" icon={TrendingUp} pad="md">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {PLANNING_FACTORS.map((factor) => {
              const value = (plan.planningFactors as any)[factor.key];
              const displayValue = value === null || value === undefined
                ? 'N/A'
                : factor.key === 'budgetAvailability'
                  ? fmtMoney(value)
                  : factor.key === 'supplierLeadTime'
                    ? `${value} days`
                    : String(value);
              return (
                <div key={factor.key} className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <factor.icon className="w-4 h-4 text-[var(--color-accent-operations)] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{factor.label}</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{displayValue}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Budget Availability by Department ──────────────────────────── */}
      {plan && Object.keys(plan.budgetByDept).length > 0 && (
        <SectionCard title="Budget Availability" subtitle="Remaining budget by department" icon={Wallet} pad="none">
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {Object.entries(plan.budgetByDept).map(([dept, b]) => {
              const used = b.committed + b.actual;
              const pct = b.budgeted > 0 ? Math.round((used / b.budgeted) * 100) : 0;
              return (
                <div key={dept} className="px-6 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{dept}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{fmtMoney(used)} / {fmtMoney(b.budgeted)}</span>
                      <Badge tone={pct > 90 ? 'danger' : pct > 70 ? 'warning' : 'success'}>{pct}%</Badge>
                    </div>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-[var(--color-danger)]' : pct > 70 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums">Remaining: {fmtMoney(b.remaining)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Procurement Plan Table ─────────────────────────────────────── */}
      <SectionCard
        title="Procurement Plan"
        subtitle={plan ? `${plan.planItems.length} items · ${plan.horizon} horizon · ${plan.rangeStart} to ${plan.rangeEnd}` : 'Loading...'}
        icon={Calendar}
        pad="none"
      >
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" /></div>
        ) : !plan || plan.planItems.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No plan items for this horizon and department.</p>
            <p className="text-xs mt-1">Create demand forecasts or requisitions to populate the plan.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {plan.planItems.map((item) => (
              <div key={`${item.type}-${item.id}`} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone={item.type === 'Forecast' ? 'info' : 'accent'}>{item.type}</Badge>
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.department} · {item.item}</p>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {item.date}
                    {item.source && ` · Source: ${item.source}`}
                    {item.estimatedValue > 0 && ` · Est. ${fmtMoney(item.estimatedValue)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {item.quantity > 0 && (
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                        {item.quantity.toLocaleString()} <span className="text-xs font-normal text-gray-500">{item.unit}</span>
                      </p>
                    </div>
                  )}
                  {item.confidence && item.type === 'Forecast' && (
                    <Badge tone={confidenceTone(item.confidence)}>{item.confidence}</Badge>
                  )}
                  <Badge tone={itemStatusTone(item.status)}>{item.status}</Badge>
                  {item.type === 'Forecast' && item.status === 'Pending' && (
                    <button
                      onClick={() => handleConvert(item)}
                      className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                      title="Convert to requisition"
                    >
                      <Plus className="w-3 h-3" /> Convert
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Horizon Context Summary ────────────────────────────────────── */}
      {plan && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SectionCard title="Open POs" subtitle={`In ${plan.horizon} horizon`} icon={ShoppingCart} pad="md">
            <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{plan.openPOsInHorizon}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Purchase orders active in this period</p>
          </SectionCard>
          <SectionCard title="Expected Deliveries" subtitle={`In ${plan.horizon} horizon`} icon={Truck} pad="md">
            <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{plan.expectedDeliveries}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deliveries expected in this period</p>
          </SectionCard>
          <SectionCard title="Active Contracts" subtitle="Contract commitments" icon={FileCheck} pad="md">
            <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{plan.activeContracts}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Active supplier contracts</p>
          </SectionCard>
        </div>
      )}

      {/* ── Convert to Requisition Modal ────────────────────────────────── */}
      <ModalSystem
        isOpen={!!convertItem}
        onClose={() => setConvertItem(null)}
        title="Convert Forecast to Requisition"
        size="sm"
        loading={converting}
        confirmLabel="Convert"
        onConfirm={confirmConvert}
      >
        {convertItem && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-1">
                <Badge tone="neutral">{convertItem.category}</Badge>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{convertItem.department}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {convertItem.quantity.toLocaleString()} {convertItem.unit} · due {convertItem.date}
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Requester *</label>
              <input className={inputClass} value={convertRequester} onChange={(e) => setConvertRequester(e.target.value)} placeholder="Your name" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              A Draft requisition will be created for {convertItem.quantity.toLocaleString()} {convertItem.unit} of {convertItem.category}.
            </p>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default ProcurementPlanning;
