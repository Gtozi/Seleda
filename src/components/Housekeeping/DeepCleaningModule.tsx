/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deep Cleaning module — docs/Housekeeping Portal new.md §18.
 * Schedule (Weekly/Monthly/Quarterly/Annual) and tasks (6 types).
 *
 * Now backed by the shared housekeeping_task_mgmt engine via
 * /api/hk-portal/task-management/:propertyId?type=Deep Cleaning, so deep
 * cleaning tasks participate in workload, supervisor console, and reports
 * alongside all other HK tasks. The "schedule" field is read from the task's
 * `frequency` column; "Overdue" is derived from due_date < today && status
 * is still Pending/In Progress.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Brush,
  Wind,
  BedDouble,
  Sofa,
  BrickWall,
  AirVent,
  Plus,
  Search,
  Calendar,
  CheckCircle2,
  PlayCircle,
  Clock,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type Schedule = 'Weekly' | 'Monthly' | 'Quarterly' | 'Annual' | 'One-off';
type DeepTaskType = 'Carpet Shampoo' | 'Curtain Cleaning' | 'Mattress Rotation' | 'Upholstery Cleaning' | 'Wall Cleaning' | 'Air Vent Cleaning';
// UI status derived from DB status + due date.
type UiStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Overdue';

interface TaskRow {
  id: string;
  type: string;
  category: string;
  location: string;
  assignedTo?: string;
  attendantId?: string | null;
  priority: string;
  dueDate: string;
  status: string; // DB status: Pending | In Progress | Completed | Verified
  progress: number;
  frequency?: string;
  subtype?: string;
  notes?: string;
}

interface DeepTask {
  id: string;
  type: DeepTaskType;
  schedule: Schedule;
  location: string;
  assignedTo?: string;
  attendantId?: string | null;
  dueDate: string;
  status: UiStatus;
  priority: string;
  notes?: string;
}

const TYPE_ICON: Record<DeepTaskType, LucideIcon> = {
  'Carpet Shampoo': Brush,
  'Curtain Cleaning': Wind,
  'Mattress Rotation': BedDouble,
  'Upholstery Cleaning': Sofa,
  'Wall Cleaning': BrickWall,
  'Air Vent Cleaning': AirVent,
};

const STATUS_TONE: Record<UiStatus, StatusTone> = {
  Scheduled: 'neutral',
  'In Progress': 'info',
  Completed: 'success',
  Overdue: 'danger',
};

const SCHEDULES: Schedule[] = ['Weekly', 'Monthly', 'Quarterly', 'Annual', 'One-off'];
const TYPES: DeepTaskType[] = ['Carpet Shampoo', 'Curtain Cleaning', 'Mattress Rotation', 'Upholstery Cleaning', 'Wall Cleaning', 'Air Vent Cleaning'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// housekeeping_task_mgmt.due_date is free-form TEXT — values in the wild
// include '2026-08-21 08:00', '07:00 AM' and ''. Only return a YYYY-MM-DD
// date when the value actually starts with one, so overdue comparisons are
// never done against a time-only or empty string.
function parseDueDate(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Map a DB task row to the deep-cleaning UI shape.
function toDeepTask(row: TaskRow): DeepTask {
  const today = new Date().toISOString().slice(0, 10);
  const dueDay = parseDueDate(row.dueDate);
  const isPastDue = dueDay !== null && dueDay < today;
  const dbStatus = row.status;
  let uiStatus: UiStatus;
  if (dbStatus === 'Completed' || dbStatus === 'Verified') uiStatus = 'Completed';
  else if (dbStatus === 'In Progress') uiStatus = isPastDue ? 'Overdue' : 'In Progress';
  else uiStatus = isPastDue ? 'Overdue' : 'Scheduled';

  const freq = (row.frequency || 'One-off').trim();
  const schedule: Schedule = SCHEDULES.includes(freq as Schedule) ? (freq as Schedule) : 'One-off';

  // The task `type` is always 'Deep Cleaning' from the engine filter; the
  // specific deep-cleaning subtype lives in the dedicated `subtype` column
  // (migration 311). Fall back to the first type if missing.
  const subtype = (row.subtype && TYPES.includes(row.subtype.trim() as DeepTaskType))
    ? (row.subtype.trim() as DeepTaskType)
    : TYPES[0];

  return {
    id: row.id,
    type: subtype,
    schedule,
    location: row.location,
    assignedTo: row.assignedTo,
    attendantId: row.attendantId,
    dueDate: dueDay || (row.dueDate || '').trim(),
    status: uiStatus,
    priority: row.priority || 'Medium',
    notes: row.notes,
  };
}

export default function DeepCleaningModule() {
  const { addNotification, currentPropertyId } = useERP();
  const [tasks, setTasks] = useState<DeepTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'All' | Schedule>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | UiStatus>('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'Carpet Shampoo' as DeepTaskType,
    schedule: 'Quarterly' as Schedule,
    location: '',
    assignedTo: '',
    dueDate: new Date().toISOString().slice(0, 10),
  });

  const loadTasks = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/hk-portal/task-management/${currentPropertyId}?type=${encodeURIComponent('Deep Cleaning')}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setTasks((json.tasks || []).map(toDeepTask));
    } catch (err) {
      console.error('Error loading deep cleaning tasks:', err);
      addNotification('Failed to load deep cleaning tasks', 'warning', 'Housekeeping');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const filtered = useMemo(
    () =>
      tasks.filter(t => {
        const matchesSched = filter === 'All' || t.schedule === filter;
        const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
        const s = search.toLowerCase();
        const matchesSearch =
          t.location.toLowerCase().includes(s) ||
          t.type.toLowerCase().includes(s) ||
          (t.assignedTo?.toLowerCase().includes(s) ?? false);
        return matchesSched && matchesStatus && matchesSearch;
      }),
    [tasks, filter, statusFilter, search]
  );

  const advance = async (id: string, current: UiStatus) => {
    try {
      const res = await fetch(`/api/hk-portal/task-management/${id}/advance`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      addNotification(`Deep cleaning task ${id} ${current === 'Scheduled' || current === 'Overdue' ? 'started' : 'completed'}`, current === 'Completed' ? 'success' : 'info', 'Housekeeping');
      // Surface consumption warnings so stock drift is never silent.
      if (data.consumptionWarnings) {
        for (const w of data.consumptionWarnings) addNotification(w, 'warning', 'Housekeeping');
      }
      loadTasks();
    } catch (err) {
      console.error(err);
      addNotification('Failed to advance task', 'warning', 'Housekeeping');
    }
  };

  const submitTask = async () => {
    if (!currentPropertyId) {
      addNotification('No active property selected', 'warning', 'Housekeeping');
      return;
    }
    if (!form.location.trim()) {
      addNotification('Location is required', 'warning', 'Housekeeping');
      return;
    }
    try {
      const res = await fetch('/api/hk-portal/task-management', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          priority: 'Medium',
          dueDate: form.dueDate,
          tasks: [{
            type: 'Deep Cleaning',
            location: form.location.trim(),
            assignedTo: form.assignedTo.trim() || undefined,
            frequency: form.schedule,
            subtype: form.type, // dedicated column — keeps `notes` user-owned
          }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`${form.type} scheduled for ${form.location}`, 'success', 'Housekeeping');
      setShowForm(false);
      setForm({ type: 'Carpet Shampoo', schedule: 'Quarterly', location: '', assignedTo: '', dueDate: new Date().toISOString().slice(0, 10) });
      loadTasks();
    } catch (err: any) {
      addNotification(err.message || 'Failed to schedule task', 'warning', 'Housekeeping');
    }
  };

  const counts = {
    scheduled: tasks.filter(t => t.status === 'Scheduled').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    overdue: tasks.filter(t => t.status === 'Overdue').length,
    completed: tasks.filter(t => t.status === 'Completed').length,
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Deep Cleaning"
        subtitle="Scheduled deep cleaning tasks across property."
        icon={Brush}
        actions={
          <div className="flex gap-2">
            <button onClick={loadTasks} disabled={loading} className={button.ghost + ' text-xs'}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Schedule Task
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Scheduled" value={counts.scheduled} icon={Calendar} tone="neutral" />
        <StatCard title="In Progress" value={counts.inProgress} icon={PlayCircle} tone="info" />
        <StatCard title="Overdue" value={counts.overdue} icon={Clock} tone="danger" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
      </div>

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <select value={filter} onChange={e => setFilter(e.target.value as 'All' | Schedule)} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 outline-none cursor-pointer">
              <option value="All">All Schedules</option>
              {SCHEDULES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | UiStatus)} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 outline-none cursor-pointer">
              <option value="All">All Statuses</option>
              {(['Scheduled', 'In Progress', 'Completed', 'Overdue'] as UiStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search type, location..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(t => {
          const Icon = TYPE_ICON[t.type];
          const tone = STATUS_TONE[t.status];
          return (
            <div key={t.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow smooth-transition overflow-hidden">
              <div className={`h-1 ${statusTone[tone].dot}`} />
              <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]"><Icon className="w-4 h-4" /></div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase leading-tight">{t.type}</h3>
                      <p className="text-xs text-gray-500">{t.id}</p>
                    </div>
                  </div>
                  <Badge tone="neutral">{t.schedule}</Badge>
                </div>
                <div className="space-y-1.5 text-xs mb-3">
                  <p className="text-gray-700 dark:text-gray-300">Location: {t.location}</p>
                  <p className="text-gray-700 dark:text-gray-300">Due: {t.dueDate}</p>
                  <p className="text-gray-700 dark:text-gray-300">Assigned: {t.assignedTo || 'Unassigned'}</p>
                </div>
                <div className="pt-3 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between">
                  <Badge tone={tone}>{t.status}</Badge>
                  {t.status !== 'Completed' && (
                    <button onClick={() => advance(t.id, t.status)} className={button.ghost + ' text-xs'}>
                      {t.status === 'Scheduled' || t.status === 'Overdue' ? 'Start' : 'Complete'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-8 rounded-2xl text-center text-sm text-gray-500">{loading ? 'Loading…' : 'No deep cleaning tasks match the filters.'}</div>}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Schedule Deep Cleaning Task</h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as DeepTaskType })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Location *</label>
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Room 401, Lobby, Floor 2" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Schedule</label>
                  <select value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value as Schedule })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    {SCHEDULES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Assignee (optional)</label>
                <input value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-gray-200 dark:border-slate-700">
              <button onClick={() => setShowForm(false)} className={button.ghost}>Cancel</button>
              <button onClick={submitTask} className={button.primary}>Schedule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
