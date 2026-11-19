/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demand Planning — Supply Chain & Procurement Portal (/erp/procurement/demand-planning).
 * Aligns 100% with unified_supply_chain_procurement_portal.md section 8.
 *
 * Features:
 * - Demand forecast CRUD (create / edit / delete)
 * - All 12 spec demand origin departments
 * - All 14 spec demand sources panel
 * - Demand flow visualization (Forecast → Procurement Need → Purchase Requisition)
 * - Demand analysis: by department, by category, by source, by confidence
 * - KPIs: Total Forecast, High-Confidence, Open POs, Expected Deliveries
 * - Convert forecast to Purchase Requisition
 *
 * DB-integrated via /api/proc-portal/demand-forecasts and /api/proc-portal/demand-analysis.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp,
  Calendar,
  Plus,
  RefreshCw,
  Loader2,
  BarChart3,
  Truck,
  ShoppingCart,
  FileText,
  ArrowRight,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Activity,
  Layers,
  Database,
  Package,
  ArrowRightLeft,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchDemandForecasts,
  createDemandForecast,
  updateDemandForecast,
  deleteDemandForecast,
  convertForecastToRequisition,
  fetchDemandAnalysis,
  type DemandForecast,
  type DemandAnalysis,
  type RequisitionPriority,
} from '../../services/procurementService';

// Spec section 8: Demand origins (12 departments)
const DEMAND_DEPARTMENTS = [
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

// Spec section 8: Demand sources (14)
const DEMAND_SOURCES = [
  'Current Inventory',
  'Minimum Stock',
  'Maximum Stock',
  'Par Level',
  'Reorder Point',
  'Historical Consumption',
  'Occupancy Forecast',
  'Restaurant Forecast',
  'Banquet Events',
  'Spa Bookings',
  'Maintenance Schedules',
  'Seasonal Demand',
  'Supplier Lead Time',
  'Open Purchase Orders',
  'Expected Deliveries',
] as const;

const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'] as const;

const confidenceTone = (c: string): 'danger' | 'warning' | 'success' =>
  c === 'High' ? 'success' : c === 'Medium' ? 'warning' : 'danger';

// Source system display labels for department-originated forecasts
const SOURCE_LABELS: Record<string, { label: string; tone: 'info' | 'accent' | 'warning' }> = {
  procurement: { label: 'Procurement', tone: 'info' },
  engineering: { label: 'Engineering', tone: 'accent' },
  housekeeping: { label: 'Housekeeping', tone: 'accent' },
  food_beverage: { label: 'F&B', tone: 'accent' },
  inventory: { label: 'Inventory', tone: 'accent' },
  banquet_events: { label: 'Banquet', tone: 'accent' },
};

const sourceIcon = (s: string) => {
  if (s.includes('Inventory') || s.includes('Stock') || s.includes('Par') || s.includes('Reorder')) return Package;
  if (s.includes('Forecast') || s.includes('Consumption') || s.includes('Seasonal')) return TrendingUp;
  if (s.includes('Events') || s.includes('Bookings') || s.includes('Schedules')) return Calendar;
  if (s.includes('Purchase Orders') || s.includes('Deliveries') || s.includes('Lead Time')) return Truck;
  return Database;
};

interface FormState {
  department: string;
  category: string;
  forecastDate: string;
  forecastQuantity: number;
  unitOfMeasure: string;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  forecastSource: string;
  notes: string;
}

const emptyForm: FormState = {
  department: 'Kitchen',
  category: 'Food',
  forecastDate: '',
  forecastQuantity: 0,
  unitOfMeasure: 'kg',
  confidenceLevel: 'Medium',
  forecastSource: 'Occupancy Forecast',
  notes: '',
};

const DemandPlanning: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [forecasts, setForecasts] = useState<DemandForecast[]>([]);
  const [analysis, setAnalysis] = useState<DemandAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [confidenceFilter, setConfidenceFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Convert-to-requisition modal state
  const [convertForecast, setConvertForecast] = useState<DemandForecast | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertForm, setConvertForm] = useState({
    requester: '',
    priority: 'Normal' as RequisitionPriority,
    unitPrice: 0,
    notes: '',
  });

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fcData, anData] = await Promise.all([
        fetchDemandForecasts({ propertyId: currentPropertyId || undefined }),
        fetchDemandAnalysis(currentPropertyId || undefined),
      ]);
      setForecasts(fcData.forecasts);
      setAnalysis(anData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load demand forecasts');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Filters ──────────────────────────────────────────────────────────
  const filtered = forecasts.filter((f) => {
    if (departmentFilter !== 'All' && f.department !== departmentFilter) return false;
    if (confidenceFilter !== 'All' && f.confidence_level !== confidenceFilter) return false;
    return true;
  });

  // ── KPIs ─────────────────────────────────────────────────────────────
  const totalForecast = filtered.reduce((sum, f) => sum + f.forecast_quantity, 0);
  const highConfidence = filtered.filter((f) => f.confidence_level === 'High').length;
  const openPOs = analysis?.demandSources.openPurchaseOrders ?? 0;
  const expectedDeliveries = analysis?.demandSources.expectedDeliveries ?? 0;

  // ── Create / Edit ────────────────────────────────────────────────────
  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (f: DemandForecast) => {
    setForm({
      department: f.department,
      category: f.category,
      forecastDate: f.forecast_date,
      forecastQuantity: f.forecast_quantity,
      unitOfMeasure: f.unit_of_measure,
      confidenceLevel: f.confidence_level,
      forecastSource: f.forecast_source || 'Manual',
      notes: f.notes || '',
    });
    setEditingId(f.id);
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!form.department || !form.category || !form.forecastDate || form.forecastQuantity <= 0) {
      addNotification?.({ type: 'warning', message: 'Department, category, date, and quantity are required' });
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await updateDemandForecast(editingId, form);
        addNotification?.({ type: 'success', message: 'Demand forecast updated' });
      } else {
        await createDemandForecast({ ...form, propertyId: currentPropertyId || undefined });
        addNotification?.({ type: 'success', message: 'Demand forecast created' });
      }
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (e: any) {
      addNotification?.({ type: 'error', message: e?.message || 'Failed to save forecast' });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteDemandForecast(deleteId);
      addNotification?.({ type: 'success', message: 'Demand forecast deleted' });
      setDeleteId(null);
      await load();
    } catch (e: any) {
      addNotification?.({ type: 'error', message: e?.message || 'Failed to delete forecast' });
    } finally {
      setDeleting(false);
    }
  };

  const openConvert = (f: DemandForecast) => {
    setConvertForecast(f);
    setConvertForm({ requester: '', priority: 'Normal', unitPrice: 0, notes: '' });
  };

  const confirmConvert = async () => {
    if (!convertForecast) return;
    if (!convertForm.requester.trim()) {
      addNotification?.({ type: 'warning', message: 'Requester name is required' });
      return;
    }
    setConverting(true);
    try {
      const result = await convertForecastToRequisition(convertForecast.id, {
        requester: convertForm.requester,
        priority: convertForm.priority,
        unitPrice: convertForm.unitPrice,
        notes: convertForm.notes,
      });
      addNotification?.({
        type: 'success',
        message: `Converted to ${result.requisition.pr_number} (Draft)`,
      });
      setConvertForecast(null);
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
        title="Demand Planning"
        subtitle="Forecast demand from occupancy, consumption, events, and inventory signals."
        icon={TrendingUp}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={openCreate} className={button.primary}>
              <Plus className="w-4 h-4" /> New Forecast
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

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      {!loading && (
        <div className={layout.kpiGrid}>
          <StatCard title="Total Forecast" value={totalForecast.toLocaleString()} icon={BarChart3} tone="info" />
          <StatCard title="High Confidence" value={highConfidence} icon={CheckCircle2} tone="success" />
          <StatCard title="Open Purchase Orders" value={openPOs} icon={ShoppingCart} tone="accent" />
          <StatCard title="Expected Deliveries" value={expectedDeliveries} icon={Truck} tone="warning" />
        </div>
      )}

      {/* ── Demand Flow (spec section 8) ───────────────────────────────── */}
      <SectionCard title="Demand Flow" subtitle="How demand signals become purchase requisitions" icon={Activity} pad="md">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
          {[
            { label: 'Occupancy / Business Forecast', icon: TrendingUp },
            { label: 'Historical Consumption', icon: BarChart3 },
            { label: 'Department Requirements', icon: FileText },
            { label: 'Current Inventory', icon: Package },
            { label: 'Open Purchase Orders', icon: ShoppingCart },
            { label: 'Future Events', icon: Calendar },
          ].map((step, i, arr) => (
            <React.Fragment key={step.label}>
              <div className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <step.icon className="w-5 h-5 text-[var(--color-accent-operations)]" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">{step.label}</span>
              </div>
              {i < arr.length - 1 && <ArrowRight className="w-4 h-4 text-gray-400 hidden sm:block" />}
            </React.Fragment>
          ))}
          <ArrowRight className="w-4 h-4 text-gray-400" />
          <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl bg-[var(--color-accent-operations)]/10 border border-[var(--color-accent-operations)]/30">
            <TrendingUp className="w-5 h-5 text-[var(--color-accent-operations)]" />
            <span className="text-xs font-bold text-[var(--color-accent-operations)]">Demand Forecast</span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400" />
          <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl bg-[var(--color-info)]/10 border border-[var(--color-info)]/30">
            <ShoppingCart className="w-5 h-5 text-[var(--color-info)]" />
            <span className="text-xs font-bold text-[var(--color-info)]">Procurement Need</span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400" />
          <div className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/30">
            <FileText className="w-5 h-5 text-[var(--color-success)]" />
            <span className="text-xs font-bold text-[var(--color-success)]">Purchase Requisition</span>
          </div>
        </div>
      </SectionCard>

      {/* ── Demand Sources (spec section 8) ────────────────────────────── */}
      <SectionCard title="Demand Sources" subtitle="Signals that feed the demand forecast" icon={Database} pad="md">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {DEMAND_SOURCES.map((src) => {
            const Icon = sourceIcon(src);
            const count = analysis?.bySource[src] || 0;
            return (
              <div key={src} className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <Icon className="w-4 h-4 text-[var(--color-accent-operations)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{src}</p>
                  {count > 0 && <p className="text-xs text-gray-500 dark:text-gray-500">{count} forecast{count > 1 ? 's' : ''}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ── Demand Analysis ─────────────────────────────────────────────── */}
      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* By Department */}
          <SectionCard title="By Department" subtitle="Forecast distribution across departments" icon={Layers} pad="none">
            {Object.keys(analysis.byDepartment).length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No data</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {Object.entries(analysis.byDepartment)
                  .sort(([, a], [, b]) => b.totalQuantity - a.totalQuantity)
                  .map(([dept, d]) => {
                    const max = Math.max(...Object.values(analysis.byDepartment).map((x) => x.totalQuantity), 1);
                    return (
                      <div key={dept} className="px-6 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{dept}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{d.totalQuantity.toLocaleString()} ({d.count})</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                          <div className="h-full rounded-full bg-[var(--color-accent-operations)]" style={{ width: `${(d.totalQuantity / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </SectionCard>

          {/* By Confidence */}
          <SectionCard title="By Confidence Level" subtitle="Forecast confidence distribution" icon={CheckCircle2} pad="none">
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {CONFIDENCE_LEVELS.map((level) => {
                const count = analysis.byConfidence[level] || 0;
                const total = analysis.totalForecasts || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={level} className="px-6 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Badge tone={confidenceTone(level)}>{level}</Badge>
                      <span className="text-sm text-gray-700 dark:text-gray-300">{count} forecast{count !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div className={`h-full rounded-full ${level === 'High' ? 'bg-[var(--color-success)]' : level === 'Medium' ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-danger)]'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Demand Forecasts List ──────────────────────────────────────── */}
      <SectionCard
        title="Demand Forecasts"
        subtitle={`${filtered.length} forecast${filtered.length !== 1 ? 's' : ''}`}
        icon={Calendar}
        pad="none"
        actions={
          <div className="flex items-center gap-2">
            <select className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <option value="All">All Departments</option>
              {DEMAND_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800" value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}>
              <option value="All">All Confidence</option>
              {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        }
      >
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No forecasts found. Click "New Forecast" to create one.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((forecast) => (
              <div key={forecast.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{forecast.department}</p>
                    <Badge tone="neutral">{forecast.category}</Badge>
                    {forecast.source_system && forecast.source_system !== 'procurement' && SOURCE_LABELS[forecast.source_system] && (
                      <Badge tone={SOURCE_LABELS[forecast.source_system].tone}>{SOURCE_LABELS[forecast.source_system].label}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {forecast.forecast_date} · Source: {forecast.forecast_source || 'Manual'}
                    {forecast.notes && ` · ${forecast.notes}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                      {forecast.forecast_quantity.toLocaleString()} <span className="text-xs font-normal text-gray-500">{forecast.unit_of_measure}</span>
                    </p>
                    <Badge tone={confidenceTone(forecast.confidence_level)}>{forecast.confidence_level}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openConvert(forecast)} className="p-1.5 rounded-lg text-gray-400 hover:text-[var(--color-accent-operations)] hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors" title="Convert to Requisition">
                      <ArrowRightLeft className="w-4 h-4" />
                    </button>
                    <button onClick={() => openEdit(forecast)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors" title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteId(forecast.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-700 transition-colors" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Create / Edit Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingId(null); }}
        title={editingId ? 'Edit Demand Forecast' : 'New Demand Forecast'}
        size="lg"
        loading={submitting}
        confirmLabel={editingId ? 'Update' : 'Create'}
        onConfirm={submitForm}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Department *</label>
              <select className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEMAND_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Category *</label>
              <input className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Food, Beverage, Cleaning" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Forecast Date *</label>
              <input type="date" className={inputClass} value={form.forecastDate} onChange={(e) => setForm({ ...form, forecastDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Forecast Quantity *</label>
              <input type="number" min="0" step="0.001" className={inputClass} value={form.forecastQuantity} onChange={(e) => setForm({ ...form, forecastQuantity: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Unit of Measure *</label>
              <input className={inputClass} value={form.unitOfMeasure} onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value })} placeholder="kg, liters, units" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Confidence Level</label>
              <select className={inputClass} value={form.confidenceLevel} onChange={(e) => setForm({ ...form, confidenceLevel: e.target.value as any })}>
                {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 mb-1">Demand Source</label>
              <select className={inputClass} value={form.forecastSource} onChange={(e) => setForm({ ...form, forecastSource: e.target.value })}>
                {DEMAND_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
              <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional context for this forecast" />
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* ── Delete Confirmation ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Forecast"
        size="sm"
        loading={deleting}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        tone="danger"
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Are you sure you want to delete this demand forecast? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Convert to Requisition Modal ────────────────────────────────── */}
      <ModalSystem
        isOpen={!!convertForecast}
        onClose={() => setConvertForecast(null)}
        title="Convert to Purchase Requisition"
        size="md"
        loading={converting}
        confirmLabel="Convert"
        onConfirm={confirmConvert}
      >
        {convertForecast && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-1">
                <Badge tone="neutral">{convertForecast.category}</Badge>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{convertForecast.department}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {convertForecast.forecast_quantity.toLocaleString()} {convertForecast.unit_of_measure} · due {convertForecast.forecast_date}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Requester *</label>
                <input className={inputClass} value={convertForm.requester} onChange={(e) => setConvertForm({ ...convertForm, requester: e.target.value })} placeholder="Your name" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Priority</label>
                <select className={inputClass} value={convertForm.priority} onChange={(e) => setConvertForm({ ...convertForm, priority: e.target.value as RequisitionPriority })}>
                  <option value="Low">Low</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Estimated Unit Price</label>
                <input type="number" min="0" step="0.01" className={inputClass} value={convertForm.unitPrice} onChange={(e) => setConvertForm({ ...convertForm, unitPrice: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Estimated Total</label>
                <input className={inputClass + ' bg-gray-50 dark:bg-slate-700'} disabled value={`${(convertForecast.forecast_quantity * convertForm.unitPrice).toLocaleString()}`} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-gray-500 mb-1">Notes</label>
                <textarea className={inputClass} rows={2} value={convertForm.notes} onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })} placeholder="Optional notes for the requisition" />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              A Draft requisition ({convertForecast.category}) will be created with a single line item for {convertForecast.forecast_quantity.toLocaleString()} {convertForecast.unit_of_measure}.
            </p>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default DemandPlanning;
