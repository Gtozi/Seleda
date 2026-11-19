/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Building Maintenance — Engineering Portal
 * (/erp/maintenance/building-maintenance).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/building-maintenance
 * (building_maintenance_tasks table).
 * UI aligned with WorkOrderManagement — PageHeader, SectionCard, StatCard, Badge,
 * brandTheme tokens, list rows, detail/create modal, loading/error/retry.
 * Multi-property scoping via useERP(). ERP notifications on create/update/delete.
 *
 * Lifecycle: Scheduled → In Progress → Completed (+ On Hold / Cancelled side-branches).
 * Areas: Guest Rooms, Public Areas, Roof, Exterior, Parking, Landscaping,
 *        Water Systems, Electrical Systems, Mechanical Systems.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Home, Car, Trees, Droplets, Zap, Wrench,
  Plus, Search, ArrowRight, Loader2, ServerCrash, MoreVertical,
  Eye, Trash2, X, MapPin, Calendar, User, AlertTriangle,
  CheckCircle2, Clock, FileText,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchBuildingTasks, createBuildingTask, updateBuildingTask, deleteBuildingTask,
  type BuildingTask, type BuildingArea, type BuildingTaskStatus, type BuildingTaskPriority,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
const AREA_OPTIONS: BuildingArea[] = [
  'Guest Rooms', 'Public Areas', 'Roof', 'Exterior', 'Parking',
  'Landscaping', 'Water Systems', 'Electrical Systems', 'Mechanical Systems',
];

const STATUS_OPTIONS: BuildingTaskStatus[] = ['Scheduled', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
const PRIORITY_OPTIONS: BuildingTaskPriority[] = ['Emergency', 'High', 'Normal', 'Low'];

const AREA_ICON: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  'Guest Rooms': Home,
  'Public Areas': Building2,
  'Roof': Building2,
  'Exterior': Building2,
  'Parking': Car,
  'Landscaping': Trees,
  'Water Systems': Droplets,
  'Electrical Systems': Zap,
  'Mechanical Systems': Wrench,
};

const STATUS_TONE: Record<BuildingTaskStatus, StatusTone> = {
  'Scheduled': 'neutral',
  'In Progress': 'warning',
  'Completed': 'success',
  'On Hold': 'warning',
  'Cancelled': 'danger',
};

const PRIORITY_TONE: Record<BuildingTaskPriority, StatusTone> = {
  Emergency: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

const ASSIGNEE_OPTIONS = [
  'Painting Team A',
  'Painting Team B',
  'Flooring Specialist',
  'External Contractor',
  'Cleaning Services',
  'Electrical Team',
  'Plumbing Team',
  'HVAC Team',
  'Carpentry Team',
  'General Maintenance Team',
  'Landscaping Team',
] as const;

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
const BuildingMaintenance: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [tasks, setTasks] = useState<BuildingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [areaFilter, setAreaFilter] = useState<'All' | BuildingArea>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | BuildingTaskStatus>('All');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<{
    area: BuildingArea;
    location: string;
    taskType: string;
    description: string;
    priority: BuildingTaskPriority;
    assignedTo: string;
    scheduledDate: string;
    estimatedCost: string;
    notes: string;
  }>({
    area: 'Guest Rooms',
    location: '',
    taskType: '',
    description: '',
    priority: 'Normal',
    assignedTo: '',
    scheduledDate: new Date().toISOString().split('T')[0],
    estimatedCost: '',
    notes: '',
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTask = tasks.find(t => t.id === detailId) || null;

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBuildingTasks({ propertyId: currentPropertyId || undefined });
      setTasks(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load building maintenance tasks');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived lists ─────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      tasks.filter(t => {
        const matchesArea = areaFilter === 'All' || t.area === areaFilter;
        const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (t.bm_number || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          (t.location || '').toLowerCase().includes(q) ||
          (t.task_type || '').toLowerCase().includes(q) ||
          (t.assigned_to || '').toLowerCase().includes(q);
        return matchesArea && matchesStatus && matchesSearch;
      }),
    [tasks, areaFilter, statusFilter, search]
  );

  const counts = {
    scheduled: tasks.filter(t => t.status === 'Scheduled').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    highPriority: tasks.filter(t => t.priority === 'High' || t.priority === 'Emergency').length,
  };

  const costSummary = useMemo(() => {
    const estimated = tasks.reduce((sum, t) => sum + (Number(t.estimated_cost) || 0), 0);
    const actual = tasks.reduce((sum, t) => sum + (Number(t.actual_cost) || 0), 0);
    return { estimated, actual, remaining: estimated - actual };
  }, [tasks]);

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.taskType.trim() || !form.description.trim()) return;
    setSubmitting(true);
    try {
      await createBuildingTask({
        area: form.area,
        location: form.location.trim() || undefined,
        taskType: form.taskType.trim(),
        description: form.description.trim(),
        priority: form.priority,
        assignedTo: form.assignedTo || undefined,
        scheduledDate: form.scheduledDate,
        estimatedCost: form.estimatedCost ? parseFloat(form.estimatedCost) : undefined,
        notes: form.notes.trim() || undefined,
        propertyId: currentPropertyId || undefined,
      });
      addNotification(`Building task "${form.taskType.trim()}" created.`, 'task', 'Maintenance');
      setShowCreate(false);
      setForm({
        area: 'Guest Rooms', location: '', taskType: '', description: '',
        priority: 'Normal', assignedTo: '',
        scheduledDate: new Date().toISOString().split('T')[0],
        estimatedCost: '', notes: '',
      });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create building task', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: BuildingTaskStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await updateBuildingTask(id, { status });
      setTasks(prev => prev.map(t => (t.id === id ? {
        ...t,
        status,
        completion_date: status === 'Completed' ? new Date().toISOString().split('T')[0] : t.completion_date,
      } : t)));
      addNotification(`Building task → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeTask = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteBuildingTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
      addNotification(`Building task deleted.`, 'task', 'Maintenance');
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete task', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const saveDetail = async (patch: any) => {
    if (!detailTask) return;
    setActingOn(detailTask.id);
    try {
      await updateBuildingTask(detailTask.id, patch);
      setTasks(prev => prev.map(t => (t.id === detailTask.id ? { ...t, ...patch } : t)));
      addNotification(`Building task "${detailTask.bm_number}" updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update task', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const areaFilters: ('All' | BuildingArea)[] = ['All', ...AREA_OPTIONS];
  const statusFilters: ('All' | BuildingTaskStatus)[] = ['All', ...STATUS_OPTIONS];

  // Status transition actions per current status
  const NEXT_ACTIONS: Record<BuildingTaskStatus, BuildingTaskStatus[]> = {
    'Scheduled': ['In Progress', 'On Hold', 'Cancelled'],
    'In Progress': ['Completed', 'On Hold', 'Cancelled'],
    'On Hold': ['Scheduled', 'In Progress', 'Cancelled'],
    'Completed': [],
    'Cancelled': [],
  };
  const ACTION_LABELS: Record<BuildingTaskStatus, string> = {
    'Scheduled': 'Schedule',
    'In Progress': 'Start Work',
    'Completed': 'Mark Completed',
    'On Hold': 'Put On Hold',
    'Cancelled': 'Cancel',
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Building Maintenance"
        subtitle="Guest rooms, public areas, exterior, and infrastructure maintenance."
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Task
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Scheduled" value={counts.scheduled} icon={Calendar} tone="info" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Wrench} tone="warning" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="High Priority" value={counts.highPriority} icon={AlertTriangle} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters section */}
      <SectionCard
        title="Building Tasks"
        subtitle="Maintenance tasks by area and status"
        icon={Building2}
        pad="md"
      >
        {/* Area filter */}
        <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap mb-3">
          {areaFilters.map(f => {
            const Icon = f === 'All' ? Building2 : AREA_ICON[f] ?? Building2;
            return (
              <button
                key={f}
                onClick={() => setAreaFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap flex items-center gap-1.5',
                  areaFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                <Icon className="w-3 h-3" />
                {f}
              </button>
            );
          })}
        </div>

        {/* Status filter + search */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {statusFilters.map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  statusFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Search number, description, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </SectionCard>

      {/* Task list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading tasks…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {tasks.length === 0 ? 'No building maintenance tasks created yet.' : 'No tasks match the filters.'}
          </div>
        )}

        {!loading && !error && filtered.map(t => {
          const tone = STATUS_TONE[t.status] ?? 'neutral';
          const priorityTone = PRIORITY_TONE[t.priority] ?? 'neutral';
          const AreaIcon = AREA_ICON[t.area] ?? Building2;
          const isMenuOpen = menuOpen === t.id;
          const actions = NEXT_ACTIONS[t.status] || [];

          return (
            <div key={t.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <AreaIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{t.task_type}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {t.bm_number} · {t.area}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{t.description}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  {t.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {t.location}
                    </span>
                  )}
                  {t.assigned_to && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {t.assigned_to}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" /> {fmtDate(t.scheduled_date)}
                  </span>
                  {Number(t.estimated_cost) > 0 && (
                    <>
                      <span>·</span>
                      <span>Est. {fmtCost(t.estimated_cost)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <Badge tone={tone}>{t.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{t.priority}</Badge>
                </div>
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <button
                  onClick={() => setDetailId(t.id)}
                  className={button.ghost}
                  title="View details"
                >
                  <Eye className="w-4 h-4" />
                </button>
                {actions.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(isMenuOpen ? null : t.id)}
                      disabled={actingOn === t.id}
                      className={button.ghost + ' disabled:opacity-50'}
                    >
                      {actingOn === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                    </button>
                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                        {actions.map(a => (
                          <button
                            key={a}
                            onClick={() => changeStatus(t.id, a)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          >
                            {ACTION_LABELS[a]}
                          </button>
                        ))}
                        <button
                          onClick={() => removeTask(t.id)}
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

      {/* ── Cost summary sidebar-style card ─────────────────────────────── */}
      <SectionCard
        title="Cost Summary"
        subtitle="Budget tracking across all building maintenance tasks"
        icon={FileText}
        pad="md"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Estimated Total</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{fmtCost(costSummary.estimated)}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Actual Spent</p>
            <p className="text-xl font-bold text-[var(--color-success)] mt-1">{fmtCost(costSummary.actual)}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Remaining Budget</p>
            <p className="text-xl font-bold text-[var(--color-warning)] mt-1">{fmtCost(costSummary.remaining)}</p>
          </div>
        </div>
      </SectionCard>

      {/* ── Create modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showCreate}
        onClose={() => (submitting ? undefined : setShowCreate(false))}
        title="New Building Maintenance Task"
        subtitle="Schedule a building maintenance task."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Task'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Area">
              <select
                value={form.area}
                onChange={e => setForm(f => ({ ...f, area: e.target.value as BuildingArea }))}
                className={inputClass}
              >
                {AREA_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Task Type">
              <input
                value={form.taskType}
                onChange={e => setForm(f => ({ ...f, taskType: e.target.value }))}
                placeholder="e.g. Painting, Flooring, Inspection"
                className={inputClass}
              />
            </Field>
            <Field label="Location">
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Room 205-210, Lobby Floor"
                className={inputClass}
              />
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as BuildingTaskPriority }))}
                className={inputClass}
              >
                {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Assigned To (optional)">
              <select
                value={form.assignedTo}
                onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Scheduled Date">
              <input
                type="date"
                value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Estimated Cost (optional)">
              <input
                type="number"
                step="0.01"
                value={form.estimatedCost}
                onChange={e => setForm(f => ({ ...f, estimatedCost: e.target.value }))}
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the maintenance task…"
              rows={3}
              className={inputClass}
            />
          </Field>
          <Field label="Notes (optional)">
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional notes…"
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Detail modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!detailId}
        onClose={() => setDetailId(null)}
        title={detailTask?.task_type || 'Building Task'}
        subtitle={detailTask?.bm_number}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailTask && (
          <div className="space-y-5">
            {/* Status + priority + area */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detailTask.status]}>{detailTask.status}</Badge>
              <Badge tone={PRIORITY_TONE[detailTask.priority]} variant="solid">{detailTask.priority}</Badge>
              <Badge tone="info">{detailTask.area}</Badge>
            </div>

            {/* Description */}
            {detailTask.description && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-sm text-gray-700 dark:text-gray-200">{detailTask.description}</p>
              </div>
            )}

            {/* Notes */}
            {detailTask.notes && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 whitespace-pre-wrap">{detailTask.notes}</p>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Location</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailTask.location || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Assigned To</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailTask.assigned_to || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Scheduled</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailTask.scheduled_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Completed</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailTask.completion_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Estimated Cost</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailTask.estimated_cost)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Actual Cost</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtCost(detailTask.actual_cost)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Created</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailTask.created_at)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Updated</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(detailTask.updated_at)}</p>
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Status">
                <select
                  value={detailTask.status}
                  onChange={e => saveDetail({ status: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={detailTask.priority}
                  onChange={e => saveDetail({ priority: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Assigned To">
                <select
                  value={detailTask.assigned_to || ''}
                  onChange={e => saveDetail({ assignedTo: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                >
                  <option value="">— Unassigned —</option>
                  {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Scheduled Date">
                <input
                  type="date"
                  defaultValue={detailTask.scheduled_date}
                  onBlur={e => saveDetail({ scheduledDate: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                />
              </Field>
              <Field label="Estimated Cost">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={detailTask.estimated_cost || 0}
                  onBlur={e => saveDetail({ estimatedCost: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                />
              </Field>
              <Field label="Actual Cost">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={detailTask.actual_cost || 0}
                  onBlur={e => saveDetail({ actualCost: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                />
              </Field>
              <Field label="Completion Date">
                <input
                  type="date"
                  defaultValue={detailTask.completion_date || ''}
                  onBlur={e => saveDetail({ completionDate: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailTask.id}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea
                    defaultValue={detailTask.notes || ''}
                    onBlur={e => saveDetail({ notes: e.target.value })}
                    rows={2}
                    className={inputClass}
                    disabled={actingOn === detailTask.id}
                  />
                </Field>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {(NEXT_ACTIONS[detailTask.status] || []).map(a => (
                <button
                  key={a}
                  onClick={() => { changeStatus(detailTask.id, a); setDetailId(null); }}
                  disabled={actingOn === detailTask.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  {ACTION_LABELS[a]}
                </button>
              ))}
              <button
                onClick={() => { removeTask(detailTask.id); }}
                disabled={actingOn === detailTask.id}
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

export default BuildingMaintenance;
