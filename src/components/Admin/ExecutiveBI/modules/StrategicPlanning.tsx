/**
 * Strategic Planning Module — live data from /api/executive/strategic-planning
 *
 * Sources: budget_forecasts, fin_bi_forecasts, rms_bi_yoy_metrics, proc_budgets,
 * hr_labor_cost_analysis, eng_projects, eng_project_phases, energy_projects,
 * sales_campaigns, sales_contracts, banquet_events, plus live KPI targets
 * computed from reservations, housekeeping, attendance, audits, PM schedules.
 */

import { useEffect, useState } from 'react';
import {
  Target,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  Calendar,
  Building2,
  DollarSign,
  Award,
  Flag,
  Briefcase,
  RefreshCw,
  Loader2,
  AlertCircle,
  Filter,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { ModalSystem, ConfirmDialog } from '../../../Shared/ModalSystem';
import {
  fetchStrategicPlanning,
  createStrategicItem,
  updateStrategicItem,
  deleteStrategicItem,
  type StrategicPlanningResponse,
  type StrategicItem,
  type StrategicItemInput,
  type StratCategory,
  type StratMetric,
  type StratStatus,
} from '../../../../services/executiveService';

const CATEGORIES: { id: StratCategory | 'all'; label: string; icon: typeof Target }[] = [
  { id: 'all', label: 'All Items', icon: Target },
  { id: 'business_plan', label: 'Business Plan', icon: Briefcase },
  { id: 'objectives', label: 'Objectives', icon: Flag },
  { id: 'okrs', label: 'OKRs', icon: Target },
  { id: 'kpi_targets', label: 'KPI Targets', icon: Award },
  { id: 'department_goals', label: 'Department Goals', icon: Building2 },
  { id: 'capital_projects', label: 'Capital Projects', icon: DollarSign },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
];

const STATUS_META: Record<StratStatus, { label: string; cls: string; dot: string }> = {
  on_track: { label: 'On Track', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  at_risk: { label: 'At Risk', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  behind: { label: 'Behind', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400', dot: 'bg-rose-500' },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', dot: 'bg-blue-500' },
};

const progressBar = (p: number) =>
  p >= 100 ? 'bg-emerald-500' : p >= 70 ? 'bg-blue-500' : p >= 40 ? 'bg-amber-500' : 'bg-rose-500';

const campaignStatus = (s: string): StratStatus => {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'completed') return 'completed';
  if (v === 'active' || v === 'in progress' || v === 'inprogress') return 'on_track';
  return 'at_risk';
};

/** What an item's percentage measures — `progress` means different things per source. */
const METRIC_LABEL: Record<StratMetric, string> = {
  completion: 'Completion',
  attainment: 'Target attainment',
  confidence: 'Plan confidence',
  utilization: 'Budget utilization',
  adherence: 'Budget adherence',
  elapsed: 'Time elapsed',
  pipeline: 'Pipeline',
};

interface ItemDraft {
  title: string;
  category: StratCategory;
  metric: StratMetric;
  department: string;
  owner: string;
  description: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  progress: string;
  startDate: string;
  dueDate: string;
  status: StratStatus | '';
}

const emptyDraft: ItemDraft = {
  title: '', category: 'objectives', metric: 'completion', department: '', owner: '',
  description: '', targetValue: '', currentValue: '', unit: '%', progress: '',
  startDate: '', dueDate: '', status: '',
};

const fieldCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white';
const labelCls = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1';

const StrategicPlanning = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<StrategicPlanningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [category, setCategory] = useState<StratCategory | 'all'>('all');
  const [status, setStatus] = useState<StratStatus | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StrategicItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StrategicItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchStrategicPlanning(currentPropertyId, days));
    } catch (e: any) {
      setError(e?.message || 'Failed to load strategic planning data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentPropertyId, days]);

  const openCreate = () => {
    setEditTarget(null);
    setDraft(emptyDraft);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (item: StrategicItem) => {
    setEditTarget(item);
    setDraft({
      title: item.title,
      category: item.category,
      metric: item.metric,
      department: item.department ?? '',
      owner: item.owner ?? '',
      description: item.description,
      targetValue: item.targetValue != null ? String(item.targetValue) : '',
      currentValue: item.currentValue != null ? String(item.currentValue) : '',
      unit: item.unit ?? '%',
      progress: String(item.progress),
      startDate: item.startDate ?? '',
      dueDate: item.dueDate ?? '',
      status: item.status,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const draftToInput = (): StrategicItemInput => ({
    title: draft.title.trim(),
    description: draft.description.trim(),
    category: draft.category,
    department: draft.department.trim() || undefined,
    owner: draft.owner.trim() || undefined,
    metric: draft.metric,
    targetValue: draft.targetValue !== '' ? Number(draft.targetValue) : null,
    currentValue: draft.currentValue !== '' ? Number(draft.currentValue) : null,
    unit: draft.unit || '%',
    progress: draft.progress !== '' ? Number(draft.progress) : undefined,
    status: draft.status || undefined,
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    propertyId: currentPropertyId,
  });

  const saveItem = async () => {
    if (!draft.title.trim()) { setFormError('Title is required'); return; }
    setSaving(true);
    setFormError(null);
    try {
      const input = draftToInput();
      if (editTarget?.rawId) await updateStrategicItem(editTarget.rawId, input);
      else await createStrategicItem(input);
      setFormOpen(false);
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.rawId) return;
    setSaving(true);
    try {
      await deleteStrategicItem(deleteTarget.rawId);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [
      ['Title', 'Category', 'Status', 'Progress %', 'Metric', 'Due Date', 'Source', 'Department', 'Description'],
      ...data.items.map(i => [
        i.title, i.category, i.status, String(i.progress), METRIC_LABEL[i.metric] ?? i.metric, i.dueDate ?? '',
        i.source, i.department ?? '', i.description,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `strategic-planning-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = (data?.items ?? []).filter(i =>
    (category === 'all' || i.category === category) &&
    (status === 'all' || i.status === status));

  const catCount = (c: StratCategory) => data?.items.filter(i => i.category === c).length ?? 0;
  const catAvg = (c: StratCategory) => data?.summary.byCategory.find(x => x.category === c)?.avgProgress ?? 0;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle className="w-10 h-10 text-rose-500" />
        <p className="text-gray-600 dark:text-gray-400">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Strategic Planning</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Business plans, OKRs, KPI targets & capital projects — live from all portals
          </p>
          {data && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={e => setStatus(e.target.value as StratStatus | 'all')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Status</option>
            <option value="on_track">On Track</option>
            <option value="at_risk">At Risk</option>
            <option value="behind">Behind</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            <Plus className="w-4 h-4" />
            <span>New Item</span>
          </button>
        </div>
      </div>

      {/* Category chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const count = cat.id === 'all' ? (data?.summary.total ?? 0) : catCount(cat.id);
          const avg = cat.id === 'all' ? (data?.summary.avgProgress ?? 0) : catAvg(cat.id);
          const active = category === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              disabled={count === 0 && cat.id !== 'all'}
              className={`p-3 rounded-lg border transition-all ${
                active
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
              } ${count === 0 && cat.id !== 'all' ? 'opacity-50' : ''}`}
            >
              <Icon className="w-5 h-5 mx-auto mb-1 text-indigo-600" />
              <p className="text-xs font-medium text-gray-900 dark:text-white text-center">{cat.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-0.5">
                {count} · {avg}%
              </p>
            </button>
          );
        })}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(['on_track', 'at_risk', 'behind', 'completed'] as StratStatus[]).map(s => {
          const count = s === 'on_track' ? data?.summary.onTrack
            : s === 'at_risk' ? data?.summary.atRisk
            : s === 'behind' ? data?.summary.behind : data?.summary.completed;
          return (
            <div key={s} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-center">
              <div className={`w-3 h-3 rounded-full ${STATUS_META[s].dot} mx-auto mb-2`} />
              <p className="text-sm font-medium text-gray-900 dark:text-white">{STATUS_META[s].label}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{count ?? 0}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">items</p>
            </div>
          );
        })}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-center">
          <TrendingUp className="w-4 h-4 mx-auto mb-2 text-indigo-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-white">Avg Score</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{data?.summary.avgProgress ?? 0}%</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{data?.summary.total ?? 0} items</p>
        </div>
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-10 text-center">
          <Filter className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-600 dark:text-gray-400">No strategic items match the selected filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map(item => {
            const sm = STATUS_META[item.status];
            return (
              <div key={item.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${sm.cls}`}>
                        {item.status === 'on_track' || item.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" />
                          : item.status === 'at_risk' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                        {sm.label}
                      </span>
                      <span className="px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {item.source}
                      </span>
                      {item.department && (
                        <span className="px-2 py-1 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">
                          {item.department}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{item.description}</p>
                    {item.detail && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Status: {item.detail}</p>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    {item.custom && (
                      <div className="flex items-center justify-end gap-1 mb-1">
                        <button onClick={() => openEdit(item)} title="Edit item"
                          className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget(item)} title="Delete item"
                          className="p-1.5 rounded-md text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{item.progress}%</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{METRIC_LABEL[item.metric] ?? 'Progress'}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    {/* Bar length = magnitude; color = status, so e.g. 100% utilization
                        on an over-budget dept renders rose, not green. */}
                    <div className={`h-2 rounded-full transition-all ${sm.dot}`}
                      style={{ width: `${Math.min(item.progress, 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{item.dueDate ? `Due: ${item.dueDate}` : 'Ongoing'}</span>
                    <span className="capitalize">{item.category.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Capital projects + upcoming deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-indigo-500" /> Capital Projects
          </h3>
          {data && data.panels.capitalProjects.length > 0 ? (
            <div className="space-y-4">
              {data.panels.capitalProjects.map((p, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {p.source} · {p.status} · {formatAmount(p.spent)} / {formatAmount(p.budget)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{p.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className={`h-2 rounded-full ${progressBar(p.progress)}`} style={{ width: `${Math.min(p.progress, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No capital projects recorded.</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-500" /> Upcoming Deadlines (60 days)
          </h3>
          {data && data.panels.upcomingDeadlines.length > 0 ? (
            <div className="space-y-3">
              {data.panels.upcomingDeadlines.map((d, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_META[d.status].dot}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{d.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{d.source}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{d.dueDate}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{d.progress}%</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No deadlines due in the next 60 days.</p>
          )}
        </div>
      </div>

      {/* Department budgets + campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-500" /> Department Budget Utilization
          </h3>
          {data && data.panels.departmentBudgets.length > 0 ? (
            <div className="space-y-4">
              {data.panels.departmentBudgets.map((d, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{d.department}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatAmount(d.actual + d.committed)} / {formatAmount(d.budgeted)} · {d.utilization}%
                    </p>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${d.utilization > 100 ? 'bg-rose-500' : d.utilization > 90 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(d.utilization, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No department budgets recorded.</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-500" /> Growth Campaigns
          </h3>
          {data && data.panels.campaigns.length > 0 ? (
            <div className="space-y-3">
              {data.panels.campaigns.map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {c.type || 'Campaign'} · {c.leads} leads · {c.conversions} conversions
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {formatAmount(c.spent)} / {formatAmount(c.budget)}
                    </p>
                    <p className={`text-xs ${STATUS_META[campaignStatus(c.status)].cls.split(' ')[1]}`}>
                      {c.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No sales campaigns recorded.</p>
          )}
        </div>
      </div>

      {/* Create / edit modal — user-authored items only */}
      <ModalSystem
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editTarget ? 'Edit Strategic Item' : 'New Strategic Item'}
        subtitle="Authored plans tracked alongside live operational data"
        variant="form"
        size="lg"
        showFooter={true}
        cancelLabel="Cancel"
        confirmLabel={saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Item'}
        onConfirm={saveItem}
        loading={saving}
      >
        <div className="space-y-4 text-sm">
          {formError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{formError}</p>
          )}
          <div>
            <label className={labelCls}>Title *</label>
            <input type="text" value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="e.g. Achieve 75% annual occupancy"
              className={fieldCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category *</label>
              <select value={draft.category}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value as StratCategory }))}
                className={fieldCls}>
                {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Metric — what the % measures</label>
              <select value={draft.metric}
                onChange={e => setDraft(d => ({ ...d, metric: e.target.value as StratMetric }))}
                className={fieldCls}>
                {(Object.keys(METRIC_LABEL) as StratMetric[]).map(m => (
                  <option key={m} value={m}>{METRIC_LABEL[m]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Department</label>
              <input type="text" value={draft.department}
                onChange={e => setDraft(d => ({ ...d, department: e.target.value }))}
                placeholder="e.g. Housekeeping"
                className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Owner</label>
              <input type="text" value={draft.owner}
                onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}
                placeholder="e.g. HK Director"
                className={fieldCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea value={draft.description} rows={2}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className={fieldCls} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Target Value</label>
              <input type="number" value={draft.targetValue}
                onChange={e => setDraft(d => ({ ...d, targetValue: e.target.value }))}
                placeholder="e.g. 75"
                className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Current Value</label>
              <input type="number" value={draft.currentValue}
                onChange={e => setDraft(d => ({ ...d, currentValue: e.target.value }))}
                placeholder="e.g. 62"
                className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Unit</label>
              <input type="text" value={draft.unit}
                onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))}
                placeholder="%, ETB, /5…"
                className={fieldCls} />
            </div>
          </div>
          {draft.targetValue === '' && (
            <div>
              <label className={labelCls}>Manual Progress % (no target set)</label>
              <input type="number" min={0} max={100} value={draft.progress}
                onChange={e => setDraft(d => ({ ...d, progress: e.target.value }))}
                className={fieldCls} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Start Date</label>
              <input type="date" value={draft.startDate}
                onChange={e => setDraft(d => ({ ...d, startDate: e.target.value }))}
                className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input type="date" value={draft.dueDate}
                onChange={e => setDraft(d => ({ ...d, dueDate: e.target.value }))}
                className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Status (auto if blank)</label>
              <select value={draft.status}
                onChange={e => setDraft(d => ({ ...d, status: e.target.value as StratStatus | '' }))}
                className={fieldCls}>
                <option value="">Auto</option>
                <option value="on_track">On Track</option>
                <option value="at_risk">At Risk</option>
                <option value="behind">Behind</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
        </div>
      </ModalSystem>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Strategic Item"
        message={`Delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
};

export default StrategicPlanning;
