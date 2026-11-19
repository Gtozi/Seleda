/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preventive Maintenance Scheduler — Engineering Portal
 * (/erp/maintenance/pm).
 *
 * Recurring PM schedules, checklist templates, and auto-generated work orders.
 * Schedules flow: Active → Inactive (deactivate) or hard-delete.
 * "Generate PM WOs" calls the generate_pm_work_orders RPC, which creates real
 * work_orders rows from due schedules — integrating with the Work Order
 * Management console (/erp/maintenance/workorders).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/pm-schedules +
 * /api/eng-portal/work-orders.
 * UI follows the Housekeeping portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens) — aligned with WorkOrderManagement.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  Plus,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Zap,
  Loader2,
  ServerCrash,
  MoreVertical,
  User,
  Calendar,
  ClipboardCheck,
  Trash2,
  Eye,
  X,
  RefreshCw,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchPMSchedules, createPMSchedule, updatePMSchedule, generatePMWorkOrders,
  deletePMSchedule,
  fetchWorkOrders, updateWorkOrder,
  type PMSchedule, type WorkOrder,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
const FREQUENCY_OPTIONS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annual'] as const;
const FREQUENCY_DAYS: Record<string, number> = {
  Daily: 1, Weekly: 7, Monthly: 30, Quarterly: 90, Annual: 365,
};
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'] as const;

const PRIORITY_TONE: Record<string, StatusTone> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'neutral',
};

const SCHEDULE_STATUS_TONE: Record<string, StatusTone> = {
  Active: 'success',
  Inactive: 'neutral',
};

const WO_STATUS_TONE: Record<string, StatusTone> = {
  Open: 'neutral',
  Assigned: 'info',
  'In Progress': 'warning',
  'Waiting for Parts': 'warning',
  'Waiting for Vendor': 'warning',
  Completed: 'accent',
  Verified: 'success',
  Closed: 'neutral',
  Cancelled: 'danger',
};

const ASSIGNEE_OPTIONS = [
  'Electrical Team',
  'Plumbing Team',
  'HVAC Team',
  'Carpentry Team',
  'Painting Team',
  'General Maintenance Team',
  'External Contractor',
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
  return isNaN(d.getTime()) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(s: PMSchedule): boolean {
  return s.status === 'Active' && new Date(s.next_due_date) <= new Date();
}

// ── Component ────────────────────────────────────────────────────────────
const PreventiveMaintenanceScheduler: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [schedules, setSchedules] = useState<PMSchedule[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [scheduleStatusFilter, setScheduleStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [woStatusFilter, setWoStatusFilter] = useState<'All' | string>('All');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  const [form, setForm] = useState<{
    scheduleName: string;
    frequency: string;
    intervalDays: number;
    nextDueDate: string;
    assignedTechnician: string;
    priority: string;
  }>({
    scheduleName: '',
    frequency: 'Monthly',
    intervalDays: 30,
    nextDueDate: new Date().toISOString().split('T')[0],
    assignedTechnician: '',
    priority: 'Medium',
  });
  const [checklist, setChecklist] = useState<string[]>(['']);

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailSched = schedules.find(s => s.id === detailId) || null;

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scheds, wos] = await Promise.all([
        fetchPMSchedules({ propertyId: currentPropertyId || undefined }),
        fetchWorkOrders(),
      ]);
      setSchedules(scheds);
      setWorkOrders(wos);
    } catch (e: any) {
      setError(e?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived lists ─────────────────────────────────────────────────────
  const filteredSchedules = useMemo(
    () =>
      schedules.filter(s => {
        const matchesStatus = scheduleStatusFilter === 'All' || s.status === scheduleStatusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (s.schedule_name || '').toLowerCase().includes(q) ||
          (s.assigned_technician || '').toLowerCase().includes(q) ||
          (s.frequency || '').toLowerCase().includes(q) ||
          (s.fixed_assets?.asset_name || '').toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
      }),
    [schedules, scheduleStatusFilter, search]
  );

  // Only show PM-generated work orders (type Preventive) in this tab.
  const pmWorkOrders = useMemo(
    () => workOrders.filter(w => w.type === 'Preventive'),
    [workOrders]
  );

  const filteredWOs = useMemo(
    () =>
      pmWorkOrders.filter(w => {
        const matchesStatus = woStatusFilter === 'All' || w.status === woStatusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (w.wo_number || '').toLowerCase().includes(q) ||
          (w.title || '').toLowerCase().includes(q) ||
          (w.assigned_to || '').toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
      }),
    [pmWorkOrders, woStatusFilter, search]
  );

  const counts = {
    active: schedules.filter(s => s.status === 'Active').length,
    overdue: schedules.filter(s => isOverdue(s)).length,
    openWOs: pmWorkOrders.filter(w => w.status === 'Open' || w.status === 'Assigned' || w.status === 'In Progress').length,
    completed: pmWorkOrders.filter(w => w.status === 'Completed' || w.status === 'Verified').length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.scheduleName.trim()) return;
    setSubmitting(true);
    try {
      const checklistTemplate = checklist.filter(c => c.trim()).map((desc, i) => ({ id: `CL-${i + 1}`, description: desc }));
      await createPMSchedule({
        scheduleName: form.scheduleName.trim(),
        frequency: form.frequency,
        intervalDays: form.intervalDays,
        nextDueDate: form.nextDueDate,
        assignedTechnician: form.assignedTechnician.trim() || undefined,
        priority: form.priority,
        checklistTemplate,
        propertyId: currentPropertyId || undefined,
      });
      addNotification(`PM schedule "${form.scheduleName.trim()}" created.`, 'task', 'Maintenance');
      setShowCreate(false);
      setForm({
        scheduleName: '', frequency: 'Monthly', intervalDays: 30,
        nextDueDate: new Date().toISOString().split('T')[0],
        assignedTechnician: '', priority: 'Medium',
      });
      setChecklist(['']);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create schedule', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerate = async () => {
    setActingOn('generate');
    setGenResult(null);
    try {
      const result = await generatePMWorkOrders();
      const generated = (result as any).generated || [];
      setGenResult(`Generated ${generated.length} work order(s)${generated.length > 0 ? ': ' + generated.map((g: any) => g.wo_number).join(', ') : ''}`);
      addNotification(`Generated ${generated.length} PM work order(s).`, 'task', 'Maintenance');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to generate work orders', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const changeScheduleStatus = async (id: string, status: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await updatePMSchedule(id, { status });
      setSchedules(prev => prev.map(s => (s.id === id ? { ...s, status } : s)));
      addNotification(`PM schedule ${id} → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeSchedule = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deletePMSchedule(id);
      setSchedules(prev => prev.filter(s => s.id !== id));
      addNotification(`PM schedule ${id} deleted.`, 'task', 'Maintenance');
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete schedule', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const saveDetail = async (patch: any) => {
    if (!detailSched) return;
    setActingOn(detailSched.id);
    try {
      await updatePMSchedule(detailSched.id, patch);
      setSchedules(prev => prev.map(s => (s.id === detailSched.id ? { ...s, ...patch } : s)));
      addNotification(`PM schedule "${detailSched.schedule_name}" updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update schedule', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const startWO = async (wo: WorkOrder) => {
    setActingOn(wo.id);
    try {
      await updateWorkOrder(wo.id, { status: 'In Progress', startedAt: new Date().toISOString() });
      addNotification(`Work order ${wo.wo_number || wo.id.slice(0, 8)} started.`, 'task', 'Maintenance');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to start work order', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const completeWO = async (wo: WorkOrder) => {
    setActingOn(wo.id);
    try {
      await updateWorkOrder(wo.id, { status: 'Completed', completedChecklist: wo.checklist || [] });
      addNotification(`Work order ${wo.wo_number || wo.id.slice(0, 8)} completed.`, 'success', 'Maintenance');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to complete work order', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // Checklist helpers for the create form
  const updateChecklistItem = (idx: number, value: string) => {
    setChecklist(prev => prev.map((c, i) => (i === idx ? value : c)));
  };
  const addChecklistItem = () => setChecklist(prev => [...prev, '']);
  const removeChecklistItem = (idx: number) => setChecklist(prev => prev.filter((_, i) => i !== idx));

  // ── Render ────────────────────────────────────────────────────────────
  const scheduleStatusFilters: ('All' | 'Active' | 'Inactive')[] = ['All', 'Active', 'Inactive'];
  const woStatusFilters: ('All' | string)[] = ['All', 'Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor', 'Completed', 'Verified', 'Closed', 'Cancelled'];

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Preventive Maintenance"
        subtitle="Recurring PM schedules, checklist templates, and auto-generated work orders."
        icon={CalendarClock}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={handleGenerate} disabled={actingOn === 'generate'} className={button.secondary + ' disabled:opacity-50'}>
              {actingOn === 'generate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Generate PM WOs
            </button>
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Schedule
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Schedules" value={counts.active} icon={CalendarClock} tone="info" />
        <StatCard title="Overdue" value={counts.overdue} icon={AlertTriangle} tone="danger" />
        <StatCard title="Open PM WOs" value={counts.openWOs} icon={Wrench} tone="warning" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
      </div>

      {genResult && (
        <div className="px-4 py-3 rounded-xl bg-[var(--color-success)]/10 text-sm text-[var(--color-success)] border border-[var(--color-success)]/20 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {genResult}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* ── PM Schedules section ──────────────────────────────────────── */}
      <SectionCard
        title="PM Schedules"
        subtitle="Recurring preventive maintenance schedules"
        icon={CalendarClock}
        pad="md"
      >
        {/* Schedule status filter + search */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {scheduleStatusFilters.map(f => (
              <button
                key={f}
                onClick={() => setScheduleStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  scheduleStatusFilter === f
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
              placeholder="Search name, technician, asset…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </SectionCard>

      {/* Schedule list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading schedules…
          </div>
        )}

        {!loading && !error && filteredSchedules.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {schedules.length === 0 ? 'No PM schedules created yet.' : 'No schedules match the filters.'}
          </div>
        )}

        {!loading && !error && filteredSchedules.map(s => {
          const tone = SCHEDULE_STATUS_TONE[s.status] ?? 'neutral';
          const priorityTone = PRIORITY_TONE[s.priority] ?? 'neutral';
          const overdue = isOverdue(s);
          const isMenuOpen = menuOpen === s.id;
          const checklistItems: any[] = Array.isArray(s.checklist_template) ? s.checklist_template : [];

          return (
            <div key={s.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <CalendarClock className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{s.schedule_name}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {s.frequency} · {s.interval_days}d
                    {s.fixed_assets?.asset_name ? ` · ${s.fixed_assets.asset_name}` : ''}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {s.assigned_technician && (
                    <span className="inline-flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {s.assigned_technician}
                    </span>
                  )}
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" /> Due {s.next_due_date}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <ClipboardCheck className="w-3.5 h-3.5" /> {checklistItems.length} steps
                  </span>
                  {s.last_completed_date && (
                    <>
                      <span>·</span>
                      <span>Last done {s.last_completed_date}</span>
                    </>
                  )}
                </div>
                {overdue && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-[var(--color-danger)]">
                    <AlertTriangle className="w-3.5 h-3.5" /> Overdue
                  </div>
                )}
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <Badge tone={tone}>{s.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{s.priority}</Badge>
                </div>
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                <button
                  onClick={() => setDetailId(s.id)}
                  className={button.ghost}
                  title="View details"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(isMenuOpen ? null : s.id)}
                    disabled={actingOn === s.id}
                    className={button.ghost + ' disabled:opacity-50'}
                  >
                    {actingOn === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                      {s.status === 'Active' && (
                        <button
                          onClick={() => changeScheduleStatus(s.id, 'Inactive')}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          Deactivate
                        </button>
                      )}
                      {s.status === 'Inactive' && (
                        <button
                          onClick={() => changeScheduleStatus(s.id, 'Active')}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        onClick={() => removeSchedule(s.id)}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition border-t border-gray-100 dark:border-slate-700"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* ── PM Work Orders section ────────────────────────────────────── */}
      <SectionCard
        title="Generated Work Orders"
        subtitle="Work orders auto-created from PM schedules"
        icon={Wrench}
        pad="md"
      >
        {/* WO status filter */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap">
            {woStatusFilters.map(f => (
              <button
                key={f}
                onClick={() => setWoStatusFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  woStatusFilter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* WO list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading work orders…
          </div>
        )}

        {!loading && !error && filteredWOs.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            {pmWorkOrders.length === 0 ? 'No PM work orders generated yet. Click "Generate PM WOs" to create some.' : 'No work orders match the filters.'}
          </div>
        )}

        {!loading && !error && filteredWOs.map(w => {
          const tone = WO_STATUS_TONE[w.status] ?? 'neutral';
          const priorityTone = PRIORITY_TONE[w.priority] ?? 'neutral';

          return (
            <div key={w.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              {/* Identity */}
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <Wrench className={`w-4 h-4 ${statusTone[tone].text}`} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{w.title}</h4>
                  <p className="text-xs text-gray-500 font-mono truncate">
                    {w.wo_number || '—'}{w.room_number ? ` · Room ${w.room_number}` : ''}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{w.description || '—'}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                  {w.assigned_to && (
                    <span className="inline-flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {w.assigned_to}
                    </span>
                  )}
                  {w.scheduled_date && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" /> {w.scheduled_date}
                      </span>
                    </>
                  )}
                  {Number(w.labor_hours) > 0 && (
                    <>
                      <span>·</span>
                      <span>{w.labor_hours}h labor</span>
                    </>
                  )}
                </div>
              </div>

              {/* Status + priority */}
              <div className="md:w-48 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <Badge tone={tone}>{w.status}</Badge>
                  <Badge tone={priorityTone} variant="solid">{w.priority}</Badge>
                </div>
              </div>

              {/* Actions */}
              <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                {w.status === 'Open' && (
                  <button
                    onClick={() => startWO(w)}
                    disabled={actingOn === w.id}
                    className={button.ghost + ' disabled:opacity-50'}
                    title="Start work"
                  >
                    {actingOn === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  </button>
                )}
                {w.status !== 'Completed' && w.status !== 'Verified' && w.status !== 'Closed' && (
                  <button
                    onClick={() => completeWO(w)}
                    disabled={actingOn === w.id}
                    className={button.ghost + ' disabled:opacity-50'}
                    title="Mark completed"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* ── Create Schedule modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={showCreate}
        onClose={() => (submitting ? undefined : setShowCreate(false))}
        title="New PM Schedule"
        subtitle="Create a recurring preventive maintenance schedule."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Schedule'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-5">
          <Field label="Schedule Name">
            <input
              value={form.scheduleName}
              onChange={e => setForm(f => ({ ...f, scheduleName: e.target.value }))}
              placeholder="e.g. Monthly Generator Inspection"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Frequency">
              <select
                value={form.frequency}
                onChange={e => {
                  const freq = e.target.value;
                  setForm(f => ({ ...f, frequency: freq, intervalDays: FREQUENCY_DAYS[freq] || 30 }));
                }}
                className={inputClass}
              >
                {FREQUENCY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="Interval (days)">
              <input
                type="number"
                value={form.intervalDays}
                onChange={e => setForm(f => ({ ...f, intervalDays: Number(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Next Due Date">
              <input
                type="date"
                value={form.nextDueDate}
                onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className={inputClass}
              >
                {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Assigned Technician (optional)">
              <select
                value={form.assignedTechnician}
                onChange={e => setForm(f => ({ ...f, assignedTechnician: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          </div>

          {/* Checklist template builder */}
          <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[var(--color-accent-operations)]" />
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Checklist Template</span>
              </div>
              <span className="text-[10px] text-gray-400">Carried to each generated work order</span>
            </div>
            <div className="space-y-2">
              {checklist.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                  <input
                    value={item}
                    onChange={e => updateChecklistItem(idx, e.target.value)}
                    className={inputClass}
                    placeholder="Checklist step…"
                  />
                  <button
                    onClick={() => removeChecklistItem(idx)}
                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addChecklistItem} className={button.ghost + ' text-xs'}>
              <Plus className="w-3.5 h-3.5" /> Add Step
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* ── Schedule Detail modal ─────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!detailId}
        onClose={() => setDetailId(null)}
        title={detailSched?.schedule_name || 'PM Schedule'}
        subtitle={detailSched?.fixed_assets?.asset_name ? `Asset: ${detailSched.fixed_assets.asset_name}` : 'Recurring schedule'}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailSched && (
          <div className="space-y-5">
            {/* Status + priority */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SCHEDULE_STATUS_TONE[detailSched.status] ?? 'neutral'}>{detailSched.status}</Badge>
              <Badge tone={PRIORITY_TONE[detailSched.priority] ?? 'neutral'} variant="solid">{detailSched.priority}</Badge>
              <Badge tone="info">{detailSched.frequency}</Badge>
              {isOverdue(detailSched) && (
                <Badge tone="danger" icon={AlertTriangle}>Overdue</Badge>
              )}
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Frequency</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailSched.frequency} ({detailSched.interval_days}d)</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Next Due</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailSched.next_due_date}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Last Completed</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailSched.last_completed_date || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Assigned To</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailSched.assigned_technician || '—'}</p>
              </div>
            </div>

            {/* Checklist template — editable */}
            <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-[var(--color-accent-operations)]" />
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Checklist Template</span>
                </div>
                <button onClick={addChecklistItem} className={button.ghost + ' text-xs'}>
                  <Plus className="w-3.5 h-3.5" /> Add Step
                </button>
              </div>
              {Array.isArray(detailSched.checklist_template) && detailSched.checklist_template.length > 0 ? (
                <div className="space-y-1.5">
                  {detailSched.checklist_template.map((item: any, idx: number) => {
                    const itemText = typeof item === 'string' ? item : (item.description || item.text || `Step ${idx + 1}`);
                    return (
                      <div key={idx} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <CheckCircle2 className="w-4 h-4 text-gray-300 shrink-0" />
                        <input
                          defaultValue={itemText}
                          onBlur={(e) => {
                            const tmpl = Array.isArray(detailSched.checklist_template) ? [...detailSched.checklist_template] : [];
                            tmpl[idx] = { id: `CL-${idx + 1}`, description: e.target.value };
                            saveDetail({ checklistTemplate: tmpl });
                          }}
                          className="flex-1 text-sm bg-transparent border-none outline-none text-gray-700 dark:text-gray-200"
                        />
                        <button
                          onClick={() => {
                            const tmpl = Array.isArray(detailSched.checklist_template) ? [...detailSched.checklist_template] : [];
                            tmpl.splice(idx, 1);
                            saveDetail({ checklistTemplate: tmpl });
                          }}
                          className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No checklist steps. Click "Add Step" to create one.</p>
              )}
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Assigned To">
                <select
                  value={detailSched.assigned_technician || ''}
                  onChange={e => saveDetail({ assignedTechnician: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailSched.id}
                >
                  <option value="">— Unassigned —</option>
                  {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={detailSched.priority}
                  onChange={e => saveDetail({ priority: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailSched.id}
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Frequency">
                <select
                  value={detailSched.frequency}
                  onChange={e => {
                    const freq = e.target.value;
                    saveDetail({ frequency: freq, intervalDays: FREQUENCY_DAYS[freq] || detailSched.interval_days });
                  }}
                  className={inputClass}
                  disabled={actingOn === detailSched.id}
                >
                  {FREQUENCY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Next Due Date">
                <input
                  type="date"
                  defaultValue={detailSched.next_due_date}
                  onBlur={e => saveDetail({ nextDueDate: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailSched.id}
                />
              </Field>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {detailSched.status === 'Active' && (
                <button
                  onClick={() => { changeScheduleStatus(detailSched.id, 'Inactive'); setDetailId(null); }}
                  disabled={actingOn === detailSched.id}
                  className={button.secondary + ' disabled:opacity-50'}
                >
                  Deactivate
                </button>
              )}
              {detailSched.status === 'Inactive' && (
                <button
                  onClick={() => { changeScheduleStatus(detailSched.id, 'Active'); setDetailId(null); }}
                  disabled={actingOn === detailSched.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  Reactivate
                </button>
              )}
              <button
                onClick={() => { removeSchedule(detailSched.id); }}
                disabled={actingOn === detailSched.id}
                className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto disabled:opacity-50'}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default PreventiveMaintenanceScheduler;
