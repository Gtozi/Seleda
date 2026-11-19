/**
 * Cross-Department Task Center — Operations Portal
 * (/erp/operations/cross-department-tasks).
 *
 * Multi-department coordination backed by live data:
 *   - Tasks persist to ops_cross_dept_tasks (migration 634, seeded with
 *     the former mock rows). Per-department status, priority, dates and
 *     progress are all server-persisted; progress is derived from
 *     department completion.
 *   - "Suggested tasks" are detected live from the other portals —
 *     upcoming banquet_events, VIP arrivals, group_blocks, and
 *     Emergency-priority work_orders — and can be adopted into real
 *     tasks with one click (deduplicated via source_ref).
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Plus,
  Search,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Trash2,
  Star,
  MapPin,
  Briefcase,
  Target,
  Flame,
  Heart,
  Wrench,
  X,
  Sparkles,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchCrossDeptTasks,
  createCrossDeptTask,
  adoptCrossDeptSuggestion,
  updateCrossDeptTask,
  deleteCrossDeptTask,
  type CrossDeptTask,
  type CrossDeptSuggestion,
  type CrossDeptTaskType,
  type CrossDeptTaskStatus,
  type DeptAssignmentStatus,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const TASK_TYPES: Array<{ id: CrossDeptTaskType; name: string; icon: LucideIcon }> = [
  { id: 'vip-arrival', name: 'VIP Arrival', icon: Star },
  { id: 'wedding', name: 'Wedding', icon: Heart },
  { id: 'conference', name: 'Conference', icon: Users },
  { id: 'emergency', name: 'Emergency', icon: Flame },
  { id: 'maintenance', name: 'Maintenance', icon: Wrench },
  { id: 'renovation', name: 'Renovation', icon: Briefcase },
  { id: 'other', name: 'Other', icon: Target },
];

const ALL_DEPARTMENTS = [
  'Front Office', 'Housekeeping', 'Engineering', 'F&B', 'Security',
  'Events', 'Transportation', 'IT', 'Procurement', 'Finance', 'HR', 'Spa',
];

const STATUS_TONE: Record<CrossDeptTaskStatus, StatusTone> = {
  planning: 'neutral',
  'in-progress': 'info',
  completed: 'success',
  'on-hold': 'warning',
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const DEPT_STATUS_DOT: Record<DeptAssignmentStatus, string> = {
  completed: 'bg-emerald-500',
  'in-progress': 'bg-blue-500',
  pending: 'bg-slate-400',
  'on-hold': 'bg-amber-500',
};

const NEXT_DEPT_STATUS: Record<DeptAssignmentStatus, DeptAssignmentStatus> = {
  pending: 'in-progress',
  'in-progress': 'completed',
  completed: 'pending',
  'on-hold': 'pending',
};

// ── Helpers ──────────────────────────────────────────────────────────────

const typeIcon = (t: string): LucideIcon => TASK_TYPES.find(x => x.id === t)?.icon || Target;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
};

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Component ────────────────────────────────────────────────────────────

const CrossDepartmentTaskCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [tasks, setTasks] = useState<CrossDeptTask[]>([]);
  const [suggestions, setSuggestions] = useState<CrossDeptSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'all' | CrossDeptTaskStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | CrossDeptTaskType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '', description: '', type: 'other' as CrossDeptTaskType,
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    departments: [] as string[], startDate: '', endDate: '',
  });

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetchCrossDeptTasks(currentPropertyId || undefined);
      setTasks(res.tasks);
      setSuggestions(res.suggestions);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filteredTasks = useMemo(() => tasks.filter(t => {
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesType = typeFilter === 'all' || t.type === typeFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    return matchesStatus && matchesType && matchesSearch;
  }), [tasks, statusFilter, typeFilter, searchQuery]);

  const selected = useMemo(() => tasks.find(t => t.id === selectedId) || null, [tasks, selectedId]);

  const stats = useMemo(() => ({
    total: tasks.length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    critical: tasks.filter(t => t.priority === 'critical' && t.status !== 'completed').length,
    suggested: suggestions.length,
  }), [tasks, suggestions]);

  // ── Actions ────────────────────────────────────────────────────────────

  const submitCreate = async () => {
    if (!newTask.title.trim() || newTask.departments.length === 0) return;
    setBusy(true);
    try {
      await createCrossDeptTask({
        propertyId: currentPropertyId || undefined,
        title: newTask.title.trim(),
        description: newTask.description.trim() || undefined,
        type: newTask.type,
        priority: newTask.priority,
        departments: newTask.departments,
        startDate: newTask.startDate || undefined,
        endDate: newTask.endDate || undefined,
      });
      setNewTask({ title: '', description: '', type: 'other', priority: 'medium', departments: [], startDate: '', endDate: '' });
      setIsCreating(false);
      addNotification('Coordination task created.', 'task', 'Executive');
      load(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create task', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const adopt = async (s: CrossDeptSuggestion) => {
    setBusy(true);
    try {
      const { task } = await adoptCrossDeptSuggestion(currentPropertyId || undefined, s.sourceRef);
      setSuggestions(prev => prev.filter(x => x.sourceRef !== s.sourceRef));
      setTasks(prev => [task, ...prev]);
      addNotification(`Adopted "${s.title}" as a coordination task.`, 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to adopt suggestion', 'warning', 'Executive');
      load(true);
    } finally {
      setBusy(false);
    }
  };

  const setTaskStatus = async (id: string, status: CrossDeptTaskStatus) => {
    setBusy(true);
    try {
      const { task } = await updateCrossDeptTask(id, { status });
      setTasks(prev => prev.map(t => (t.id === id ? task : t)));
      addNotification(`Task marked ${status}.`, 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update task', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const cycleDeptStatus = async (task: CrossDeptTask, department: string, current: DeptAssignmentStatus) => {
    const next = NEXT_DEPT_STATUS[current];
    setBusy(true);
    try {
      const { task: updated } = await updateCrossDeptTask(task.id, {
        departmentUpdate: { department, status: next },
      });
      setTasks(prev => prev.map(t => (t.id === task.id ? updated : t)));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update department', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async (id: string) => {
    setBusy(true);
    try {
      await deleteCrossDeptTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
      if (selectedId === id) setSelectedId(null);
      addNotification('Task deleted.', 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete task', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const toggleNewDept = (d: string) =>
    setNewTask(prev => ({
      ...prev,
      departments: prev.departments.includes(d)
        ? prev.departments.filter(x => x !== d)
        : [...prev.departments, d],
    }));

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Cross-Department Task Center"
        subtitle="Coordinate activities involving multiple departments"
        icon={ArrowRightLeft}
        actions={
          <>
            {stats.critical > 0 && <Badge tone="danger" icon={AlertTriangle}>{stats.critical} critical</Badge>}
            <button onClick={() => setIsCreating(!isCreating)} className={button.primary}>
              {isCreating ? <X size={16} /> : <Plus size={16} />}
              {isCreating ? 'Cancel' : 'New Task'}
            </button>
            <button onClick={() => load(true)} disabled={refreshing} className={button.secondary} title="Refresh">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <AlertTriangle size={18} className="text-[var(--color-warning)] shrink-0" />
          <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{error}</p>
          <button onClick={() => load()} className={button.secondary}>Retry</button>
        </div>
      )}

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Tasks" value={stats.total} icon={ArrowRightLeft} tone="info" caption={`${stats.inProgress} in progress`} />
        <StatCard title="Critical" value={stats.critical} icon={Flame} tone="danger" caption="need immediate attention" />
        <StatCard title="In Progress" value={stats.inProgress} icon={Clock} tone="warning" caption="departments coordinating" />
        <StatCard title="Suggestions" value={stats.suggested} icon={Sparkles} tone="success" caption="detected across portals" />
      </div>

      {/* Live suggestions */}
      {suggestions.length > 0 && (
        <SectionCard
          title="Detected Coordination Needs"
          subtitle="Live events and requests from other portals that need multi-department coordination"
          icon={Sparkles}
          pad="lg"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suggestions.map(s => {
              const TypeIcon = typeIcon(s.type);
              return (
                <div key={s.sourceRef} className="p-4 rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TypeIcon size={16} className="shrink-0 text-[var(--color-accent-operations)]" />
                      <h5 className="font-semibold text-sm text-gray-900 dark:text-white truncate">{s.title}</h5>
                    </div>
                    <Badge tone={PRIORITY_TONE[s.priority]} className="capitalize shrink-0">{s.priority}</Badge>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{s.description}</p>
                  <div className="flex items-center justify-between mt-3 gap-2">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                      <Badge tone="neutral">{s.source}</Badge>
                      <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(s.startDate)}</span>
                      <span className="flex items-center gap-1"><Users size={11} />{s.suggestedDepartments.length} depts</span>
                    </div>
                    <button
                      onClick={() => adopt(s)}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
                    >
                      Adopt Task
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Create form */}
      {isCreating && (
        <SectionCard title="New Coordination Task" icon={Plus} pad="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text" placeholder="Task title…" value={newTask.title}
                onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newTask.type}
                  onChange={e => setNewTask({ ...newTask, type: e.target.value as CrossDeptTaskType })}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                >
                  {TASK_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select
                  value={newTask.priority}
                  onChange={e => setNewTask({ ...newTask, priority: e.target.value as any })}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <textarea
              placeholder="Description…" value={newTask.description} rows={2}
              onChange={e => setNewTask({ ...newTask, description: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none resize-none"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Start</label>
                <input type="datetime-local" value={newTask.startDate}
                  onChange={e => setNewTask({ ...newTask, startDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">End</label>
                <input type="datetime-local" value={newTask.endDate}
                  onChange={e => setNewTask({ ...newTask, endDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase block mb-2">
                Departments involved
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_DEPARTMENTS.map(d => (
                  <button
                    key={d}
                    onClick={() => toggleNewDept(d)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      newTask.departments.includes(d)
                        ? 'bg-[var(--color-accent-operations)] text-white border-transparent'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-[var(--color-accent-operations)]/50'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={submitCreate}
              disabled={!newTask.title.trim() || newTask.departments.length === 0 || busy}
              className={button.primary}
            >
              <Plus size={16} /> Create Task
            </button>
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" placeholder="Search tasks…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Status</option>
          <option value="planning">Planning</option>
          <option value="in-progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="on-hold">On Hold</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Types</option>
          {TASK_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Master-detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task list */}
        <div className="lg:col-span-2 space-y-3">
          {filteredTasks.length === 0 ? (
            <SectionCard pad="lg">
              <div className="text-center py-8">
                <Target size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No tasks match your filters</p>
              </div>
            </SectionCard>
          ) : (
            filteredTasks.map(task => {
              const TypeIcon = typeIcon(task.type);
              const isSelected = selected?.id === task.id;
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedId(task.id)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-[var(--color-accent-operations)]/5 border-[var(--color-accent-operations)]/40'
                      : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`shrink-0 p-2 rounded-xl ${statusTone[PRIORITY_TONE[task.priority]].soft}`}>
                      <TypeIcon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-semibold text-gray-900 dark:text-white truncate">{task.title}</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">{task.description}</p>
                        </div>
                        <Badge tone={STATUS_TONE[task.status]} className="capitalize shrink-0">{task.status.replace('-', ' ')}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1"><Users size={12} />{task.departments.length} departments</span>
                        <span className="flex items-center gap-1"><Calendar size={12} />{fmtDate(task.startDate)}</span>
                        <span className="flex items-center gap-1"><Clock size={12} />{task.progress}% complete</span>
                        {task.sourceRef && <Badge tone="neutral">adopted</Badge>}
                      </div>
                      <div className="mt-3 w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
                        <div
                          className="bg-[var(--color-accent-operations)] h-1.5 rounded-full transition-all"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-400 shrink-0 mt-1" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-1">
          {selected ? (
            <SectionCard
              title="Task Details"
              pad="md"
              className="sticky top-6"
              actions={
                <button onClick={() => setSelectedId(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              }
            >
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">{selected.title}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{selected.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 dark:bg-slate-900/50 rounded-xl">
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <Badge tone={STATUS_TONE[selected.status]} className="capitalize">{selected.status.replace('-', ' ')}</Badge>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-slate-900/50 rounded-xl">
                    <p className="text-xs text-gray-500 mb-1">Priority</p>
                    <Badge tone={PRIORITY_TONE[selected.priority]} className="capitalize">{selected.priority}</Badge>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Start</span>
                    <span className="text-gray-900 dark:text-white">{fmtDateTime(selected.startDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">End</span>
                    <span className="text-gray-900 dark:text-white">{fmtDateTime(selected.endDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Created by</span>
                    <span className="text-gray-900 dark:text-white">{selected.createdBy || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Created</span>
                    <span className="text-gray-900 dark:text-white">{timeAgo(selected.createdAt)}</span>
                  </div>
                </div>

                <div>
                  <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2">
                    Department Progress <span className="normal-case font-normal text-gray-400">(click to advance)</span>
                  </h5>
                  <div className="space-y-1.5">
                    {selected.assignedDepartments.map((dept, i) => (
                      <button
                        key={i}
                        onClick={() => cycleDeptStatus(selected, dept.department, dept.status)}
                        disabled={busy || selected.status === 'completed'}
                        className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-900/40 transition-colors disabled:opacity-60 text-left"
                        title={`Set to ${NEXT_DEPT_STATUS[dept.status]}`}
                      >
                        <div className={`w-2 h-2 rounded-full shrink-0 ${DEPT_STATUS_DOT[dept.status]}`} />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{dept.department}</span>
                        <span className="text-xs text-gray-500">{dept.lead || ''}</span>
                        <Badge tone={dept.status === 'completed' ? 'success' : dept.status === 'in-progress' ? 'info' : dept.status === 'on-hold' ? 'warning' : 'neutral'} className="capitalize">
                          {dept.status.replace('-', ' ')}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2">Overall Progress</h5>
                  <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3">
                    <div className="bg-[var(--color-accent-operations)] h-3 rounded-full transition-all" style={{ width: `${selected.progress}%` }} />
                  </div>
                  <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-1">{selected.progress}% complete</p>
                </div>

                <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-slate-700 flex-wrap">
                  {selected.status !== 'in-progress' && selected.status !== 'completed' && (
                    <button onClick={() => setTaskStatus(selected.id, 'in-progress')} disabled={busy} className={button.primary}>
                      Start
                    </button>
                  )}
                  {selected.status === 'in-progress' && (
                    <button onClick={() => setTaskStatus(selected.id, 'completed')} disabled={busy}
                      className="px-4 py-2 bg-[var(--color-success)] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50">
                      <CheckCircle2 size={16} /> Complete
                    </button>
                  )}
                  {selected.status !== 'on-hold' && selected.status !== 'completed' && (
                    <button onClick={() => setTaskStatus(selected.id, 'on-hold')} disabled={busy} className={button.secondary}>
                      Hold
                    </button>
                  )}
                  {selected.status === 'on-hold' && (
                    <button onClick={() => setTaskStatus(selected.id, 'planning')} disabled={busy} className={button.secondary}>
                      Resume
                    </button>
                  )}
                  <button onClick={() => removeTask(selected.id)} disabled={busy}
                    className="px-4 py-2 bg-[var(--color-danger)]/10 text-[var(--color-danger)] rounded-lg hover:bg-[var(--color-danger)]/20 transition-colors flex items-center gap-2 disabled:opacity-50">
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard pad="lg" className="sticky top-6">
              <div className="text-center py-10">
                <Target size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Select a task to view details</p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
};

export default CrossDepartmentTaskCenter;
