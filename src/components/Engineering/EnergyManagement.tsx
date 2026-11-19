/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Energy Management — Engineering Portal
 * (/erp/maintenance/energy).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/energy-metrics,
 * /api/eng-portal/energy-efficiency, /api/eng-portal/energy-projects.
 * UI aligned with WorkOrderManagement — PageHeader, SectionCard, StatCard,
 * Badge, brandTheme tokens, list rows, detail/create modal, loading/error/retry.
 * Multi-property scoping via useERP(). ERP notifications on create/update/delete.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Zap, Plus, ArrowRight, Loader2, ServerCrash, MoreVertical,
  Eye, Trash2, X, Droplets, Leaf, DollarSign, Sun, Gauge,
  Activity, AlertTriangle, CheckCircle2, TrendingUp,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchEnergyMetrics, createEnergyMetric, updateEnergyMetric, deleteEnergyMetric,
  fetchEnergyEfficiency, createEnergyEfficiency, updateEnergyEfficiency, deleteEnergyEfficiency,
  fetchEnergyProjects, createEnergyProject, updateEnergyProject, deleteEnergyProject,
  type EnergyMetric, type EquipmentEfficiency, type EnergyProject,
  type EfficiencyStatus, type EnergyProjectType, type EnergyProjectStatus,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
const EFFICIENCY_STATUS_TONE: Record<EfficiencyStatus, StatusTone> = {
  Optimal: 'success',
  Warning: 'warning',
  Critical: 'danger',
};

const PROJECT_STATUS_TONE: Record<EnergyProjectStatus, StatusTone> = {
  Planned: 'neutral',
  'In Progress': 'warning',
  Completed: 'success',
};

const PROJECT_TYPE_OPTIONS: EnergyProjectType[] = [
  'LED Upgrade', 'HVAC Optimization', 'Solar Installation', 'Insulation', 'Variable Speed Drives',
];
const PROJECT_STATUS_OPTIONS: EnergyProjectStatus[] = ['Planned', 'In Progress', 'Completed'];
const EFFICIENCY_STATUS_OPTIONS: EfficiencyStatus[] = ['Optimal', 'Warning', 'Critical'];

// ── Field helper ─────────────────────────────────────────────────────────
const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCost(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ── Component ────────────────────────────────────────────────────────────
const EnergyManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [metrics, setMetrics] = useState<EnergyMetric[]>([]);
  const [efficiency, setEfficiency] = useState<EquipmentEfficiency[]>([]);
  const [projects, setProjects] = useState<EnergyProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [projectStatusFilter, setProjectStatusFilter] = useState<'All' | EnergyProjectStatus>('All');
  const [effStatusFilter, setEffStatusFilter] = useState<'All' | EfficiencyStatus>('All');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateMetric, setShowCreateMetric] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [projectForm, setProjectForm] = useState<{
    name: string; type: EnergyProjectType; status: EnergyProjectStatus;
    estimatedSavings: string; investment: string; roi: string;
  }>({
    name: '', type: 'LED Upgrade', status: 'Planned',
    estimatedSavings: '', investment: '', roi: '',
  });

  const [metricForm, setMetricForm] = useState<{
    metricDate: string; electricityKwh: string; waterLiters: string;
    gasM3: string; dieselLiters: string; solarKwh: string;
    totalCost: string; carbonFootprintTons: string;
  }>({
    metricDate: new Date().toISOString().split('T')[0],
    electricityKwh: '', waterLiters: '', gasM3: '', dieselLiters: '',
    solarKwh: '', totalCost: '', carbonFootprintTons: '',
  });

  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const detailProject = projects.find(p => p.id === detailProjectId) || null;

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, e, p] = await Promise.all([
        fetchEnergyMetrics({ propertyId: currentPropertyId || undefined }),
        fetchEnergyEfficiency({ propertyId: currentPropertyId || undefined }),
        fetchEnergyProjects({ propertyId: currentPropertyId || undefined }),
      ]);
      setMetrics(m);
      setEfficiency(e);
      setProjects(p);
    } catch (err: any) {
      setError(err?.message || 'Failed to load energy data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ───────────────────────────────────────────────────────────
  const latestMetric = metrics[0] || null;

  const filteredEfficiency = useMemo(
    () => efficiency.filter(e => effStatusFilter === 'All' || e.status === effStatusFilter),
    [efficiency, effStatusFilter]
  );

  const filteredProjects = useMemo(
    () => projects.filter(p => projectStatusFilter === 'All' || p.status === projectStatusFilter),
    [projects, projectStatusFilter]
  );

  // ── Actions: Projects ─────────────────────────────────────────────────
  const submitCreateProject = async () => {
    if (!projectForm.name.trim()) return;
    setSubmitting(true);
    try {
      await createEnergyProject({
        name: projectForm.name.trim(),
        type: projectForm.type,
        status: projectForm.status,
        estimatedSavings: parseFloat(projectForm.estimatedSavings) || 0,
        investment: parseFloat(projectForm.investment) || 0,
        roi: parseFloat(projectForm.roi) || 0,
        propertyId: currentPropertyId || undefined,
      });
      addNotification(`Energy project "${projectForm.name.trim()}" created.`, 'task', 'Maintenance');
      setShowCreateProject(false);
      setProjectForm({ name: '', type: 'LED Upgrade', status: 'Planned', estimatedSavings: '', investment: '', roi: '' });
      load();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to create project', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeProjectStatus = async (id: string, status: EnergyProjectStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await updateEnergyProject(id, { status });
      setProjects(prev => prev.map(p => (p.id === id ? {
        ...p,
        status,
        completion_date: status === 'Completed' ? new Date().toISOString().split('T')[0] : p.completion_date,
      } : p)));
      addNotification(`Project → ${status}.`, 'task', 'Maintenance');
    } catch (err: any) {
      addNotification(err?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeProject = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteEnergyProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
      addNotification(`Energy project deleted.`, 'task', 'Maintenance');
      setDetailProjectId(null);
    } catch (err: any) {
      addNotification(err?.message || 'Failed to delete project', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const saveProjectDetail = async (patch: any) => {
    if (!detailProject) return;
    setActingOn(detailProject.id);
    try {
      await updateEnergyProject(detailProject.id, patch);
      setProjects(prev => prev.map(p => (p.id === detailProject.id ? { ...p, ...patch } : p)));
      addNotification(`Project "${detailProject.name}" updated.`, 'task', 'Maintenance');
    } catch (err: any) {
      addNotification(err?.message || 'Failed to update project', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Actions: Metrics ──────────────────────────────────────────────────
  const submitCreateMetric = async () => {
    if (!metricForm.metricDate) return;
    setSubmitting(true);
    try {
      await createEnergyMetric({
        metricDate: metricForm.metricDate,
        electricityKwh: parseFloat(metricForm.electricityKwh) || 0,
        waterLiters: parseFloat(metricForm.waterLiters) || 0,
        gasM3: parseFloat(metricForm.gasM3) || 0,
        dieselLiters: parseFloat(metricForm.dieselLiters) || 0,
        solarKwh: parseFloat(metricForm.solarKwh) || 0,
        totalCost: parseFloat(metricForm.totalCost) || 0,
        carbonFootprintTons: parseFloat(metricForm.carbonFootprintTons) || 0,
        propertyId: currentPropertyId || undefined,
      });
      addNotification(`Energy metric for ${metricForm.metricDate} recorded.`, 'task', 'Maintenance');
      setShowCreateMetric(false);
      setMetricForm({
        metricDate: new Date().toISOString().split('T')[0],
        electricityKwh: '', waterLiters: '', gasM3: '', dieselLiters: '',
        solarKwh: '', totalCost: '', carbonFootprintTons: '',
      });
      load();
    } catch (err: any) {
      addNotification(err?.message || 'Failed to record metric', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const projectStatusFilters: ('All' | EnergyProjectStatus)[] = ['All', ...PROJECT_STATUS_OPTIONS];
  const effStatusFilters: ('All' | EfficiencyStatus)[] = ['All', ...EFFICIENCY_STATUS_OPTIONS];

  const NEXT_PROJECT_ACTIONS: Record<EnergyProjectStatus, EnergyProjectStatus[]> = {
    Planned: ['In Progress'],
    'In Progress': ['Completed'],
    Completed: [],
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Energy Management"
        subtitle="Energy dashboard, peak demand monitoring, equipment efficiency & sustainability."
        icon={Zap}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowCreateMetric(true)} className={button.secondary}>
              <Plus className="w-4 h-4" /> Log Metric
            </button>
            <button onClick={() => setShowCreateProject(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Project
            </button>
          </div>
        }
      />

      {/* KPIs from latest metric */}
      <div className={layout.kpiGrid}>
        <StatCard title="Today's Electricity" value={latestMetric ? `${latestMetric.electricity_kwh} kWh` : '—'} icon={Zap} tone="warning" />
        <StatCard title="Today's Water" value={latestMetric ? `${latestMetric.water_liters} L` : '—'} icon={Droplets} tone="info" />
        <StatCard title="Carbon Footprint" value={latestMetric ? `${latestMetric.carbon_footprint_tons} t` : '—'} icon={Leaf} tone="success" />
        <StatCard title="Today's Cost" value={latestMetric ? fmtCost(latestMetric.total_cost) : '—'} icon={DollarSign} tone="accent" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* ── Equipment Efficiency ──────────────────────────────────────── */}
      <SectionCard
        title="Equipment Efficiency"
        subtitle="Real-time performance monitoring"
        icon={Activity}
        pad="md"
        actions={
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {effStatusFilters.map(f => (
              <button
                key={f}
                onClick={() => setEffStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  effStatusFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        {loading && (
          <div className="p-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading efficiency data…
          </div>
        )}
        {!loading && !error && filteredEfficiency.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">
            {efficiency.length === 0 ? 'No equipment efficiency records.' : 'No records match the filter.'}
          </div>
        )}
        {!loading && !error && (
          <div className="space-y-3">
            {filteredEfficiency.map(eq => {
              const tone = EFFICIENCY_STATUS_TONE[eq.status] ?? 'neutral';
              const pct = Math.min(100, Number(eq.current_efficiency) || 0);
              return (
                <div key={eq.id} className={`p-4 rounded-xl ${statusTone[tone].soft}`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{eq.equipment_name}</span>
                      <span className="text-xs font-medium text-gray-500 ml-2">{eq.category}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-lg font-bold ${statusTone[tone].text}`}>{Number(eq.current_efficiency).toFixed(0)}%</span>
                      <Badge tone={tone}>{eq.status}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase mb-1">
                        <span>Current</span>
                        <span>Target: {Number(eq.target_efficiency).toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${statusTone[tone].text.replace('text-', 'bg-')}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{fmtDate(eq.last_measured)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Energy Projects ────────────────────────────────────────────── */}
      <SectionCard
        title="Energy Saving Projects"
        subtitle="Capital projects and ROI tracking"
        icon={TrendingUp}
        pad="md"
        actions={
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {projectStatusFilters.map(f => (
              <button
                key={f}
                onClick={() => setProjectStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  projectStatusFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        {loading && (
          <div className="p-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading projects…
          </div>
        )}
        {!loading && !error && filteredProjects.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">
            {projects.length === 0 ? 'No energy projects created yet.' : 'No projects match the filter.'}
          </div>
        )}
      </SectionCard>

      {/* Project list rows */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {!loading && !error && filteredProjects.map(p => {
          const tone = PROJECT_STATUS_TONE[p.status] ?? 'neutral';
          const isMenuOpen = menuOpen === p.id;
          const actions = NEXT_PROJECT_ACTIONS[p.status] || [];

          return (
            <div key={p.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <TrendingUp className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{p.name}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {p.ep_number} · {p.type}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase block">Investment</span>
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{fmtCost(p.investment)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase block">Est. Savings/yr</span>
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{fmtCost(p.estimated_savings)}</span>
                  </div>
                  {p.actual_savings !== null && (
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase block">Actual Savings/yr</span>
                      <span className="text-sm font-bold text-[var(--color-success)]">{fmtCost(p.actual_savings)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Status + ROI */}
              <div className="md:w-40 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <Badge tone={tone}>{p.status}</Badge>
                  <span className="text-sm font-bold text-[var(--color-success)]">{Number(p.roi).toFixed(1)}% ROI</span>
                </div>
              </div>

              {/* Actions */}
              <div className="md:w-32 shrink-0 flex justify-end items-center gap-1.5">
                <button onClick={() => setDetailProjectId(p.id)} className={button.ghost} title="View details">
                  <Eye className="w-4 h-4" />
                </button>
                {actions.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(isMenuOpen ? null : p.id)}
                      disabled={actingOn === p.id}
                      className={button.ghost + ' disabled:opacity-50'}
                    >
                      {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                    </button>
                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                        {actions.map(a => (
                          <button
                            key={a}
                            onClick={() => changeProjectStatus(p.id, a)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          >
                            Mark {a}
                          </button>
                        ))}
                        <button
                          onClick={() => removeProject(p.id)}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* ── Sustainability sidebar ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Sustainability KPIs" subtitle="Environmental impact" icon={Leaf} pad="md">
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Leaf className="w-4 h-4 text-[var(--color-success)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Carbon Reduction</span>
              </div>
              <span className="text-sm font-bold text-[var(--color-success)]">-12%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[var(--color-warning)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Energy Intensity</span>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">245 kWh/m²</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-[var(--color-warning)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Renewable %</span>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">18%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-[var(--color-info)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Water Intensity</span>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">85 L/guest</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Peak Demand" subtitle="Load monitoring" icon={Gauge} pad="md">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl mb-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-[var(--color-danger)]" />
              <span className="text-xs font-bold text-[var(--color-danger)] uppercase tracking-wide">High Demand Period</span>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-200">
              Peak demand reached 450 kW at 14:30. Consider shifting non-critical loads to off-peak hours.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Current Load</span>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">380 kW</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--color-success)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Peak Today</span>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">450 kW</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[var(--color-warning)]" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Contract Limit</span>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">500 kW</span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Create Project modal ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={showCreateProject}
        onClose={() => (submitting ? undefined : setShowCreateProject(false))}
        title="New Energy Project"
        subtitle="Create an energy-saving capital project."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Project'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreateProject}
        showFooter
      >
        <div className="space-y-5">
          <Field label="Project Name">
            <input
              value={projectForm.name}
              onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. LED Lighting Upgrade - Guest Rooms"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <select
                value={projectForm.type}
                onChange={e => setProjectForm(f => ({ ...f, type: e.target.value as EnergyProjectType }))}
                className={inputClass}
              >
                {PROJECT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={projectForm.status}
                onChange={e => setProjectForm(f => ({ ...f, status: e.target.value as EnergyProjectStatus }))}
                className={inputClass}
              >
                {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Investment ($)">
              <input
                type="number"
                step="0.01"
                value={projectForm.investment}
                onChange={e => setProjectForm(f => ({ ...f, investment: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Estimated Savings ($/yr)">
              <input
                type="number"
                step="0.01"
                value={projectForm.estimatedSavings}
                onChange={e => setProjectForm(f => ({ ...f, estimatedSavings: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="ROI (%)">
              <input
                type="number"
                step="0.1"
                value={projectForm.roi}
                onChange={e => setProjectForm(f => ({ ...f, roi: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Create Metric modal ───────────────────────────────────────── */}
      <ModalSystem
        isOpen={showCreateMetric}
        onClose={() => (submitting ? undefined : setShowCreateMetric(false))}
        title="Log Energy Metric"
        subtitle="Record daily energy consumption data."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Save Metric'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreateMetric}
        showFooter
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date">
              <input
                type="date"
                value={metricForm.metricDate}
                onChange={e => setMetricForm(f => ({ ...f, metricDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Electricity (kWh)">
              <input
                type="number"
                step="0.01"
                value={metricForm.electricityKwh}
                onChange={e => setMetricForm(f => ({ ...f, electricityKwh: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Water (L)">
              <input
                type="number"
                step="0.01"
                value={metricForm.waterLiters}
                onChange={e => setMetricForm(f => ({ ...f, waterLiters: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Gas (m³)">
              <input
                type="number"
                step="0.01"
                value={metricForm.gasM3}
                onChange={e => setMetricForm(f => ({ ...f, gasM3: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Diesel (L)">
              <input
                type="number"
                step="0.01"
                value={metricForm.dieselLiters}
                onChange={e => setMetricForm(f => ({ ...f, dieselLiters: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Solar (kWh)">
              <input
                type="number"
                step="0.01"
                value={metricForm.solarKwh}
                onChange={e => setMetricForm(f => ({ ...f, solarKwh: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Total Cost ($)">
              <input
                type="number"
                step="0.01"
                value={metricForm.totalCost}
                onChange={e => setMetricForm(f => ({ ...f, totalCost: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Carbon Footprint (tons)">
              <input
                type="number"
                step="0.01"
                value={metricForm.carbonFootprintTons}
                onChange={e => setMetricForm(f => ({ ...f, carbonFootprintTons: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Project Detail modal ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!detailProjectId}
        onClose={() => setDetailProjectId(null)}
        title={detailProject?.name || 'Energy Project'}
        subtitle={detailProject?.ep_number}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailProject && (
          <div className="space-y-5">
            {/* Status + type */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PROJECT_STATUS_TONE[detailProject.status]}>{detailProject.status}</Badge>
              <Badge tone="info">{detailProject.type}</Badge>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Investment</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailProject.investment)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Est. Savings/yr</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailProject.estimated_savings)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Actual Savings/yr</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailProject.actual_savings)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">ROI</p>
                <p className="text-sm font-bold text-[var(--color-success)]">{Number(detailProject.roi).toFixed(1)}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Completion Date</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailProject.completion_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Created</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailProject.created_at)}</p>
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Status">
                <select
                  value={detailProject.status}
                  onChange={e => saveProjectDetail({ status: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailProject.id}
                >
                  {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select
                  value={detailProject.type}
                  onChange={e => saveProjectDetail({ type: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailProject.id}
                >
                  {PROJECT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Investment ($)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={detailProject.investment}
                  onBlur={e => saveProjectDetail({ investment: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailProject.id}
                />
              </Field>
              <Field label="Estimated Savings ($/yr)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={detailProject.estimated_savings}
                  onBlur={e => saveProjectDetail({ estimatedSavings: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailProject.id}
                />
              </Field>
              <Field label="Actual Savings ($/yr)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={detailProject.actual_savings || 0}
                  onBlur={e => saveProjectDetail({ actualSavings: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailProject.id}
                />
              </Field>
              <Field label="ROI (%)">
                <input
                  type="number"
                  step="0.1"
                  defaultValue={detailProject.roi}
                  onBlur={e => saveProjectDetail({ roi: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailProject.id}
                />
              </Field>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {(NEXT_PROJECT_ACTIONS[detailProject.status] || []).map(a => (
                <button
                  key={a}
                  onClick={() => { changeProjectStatus(detailProject.id, a); setDetailProjectId(null); }}
                  disabled={actingOn === detailProject.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  Mark {a}
                </button>
              ))}
              <button
                onClick={() => { removeProject(detailProject.id); }}
                disabled={actingOn === detailProject.id}
                className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto disabled:opacity-50'}
              >
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default EnergyManagement;
