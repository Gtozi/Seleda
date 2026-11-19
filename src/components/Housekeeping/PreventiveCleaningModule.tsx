/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preventive Cleaning module — docs/Housekeeping Portal new.md §19.
 * Air Filters, Furniture Polish, Tile Grout, Window Cleaning, Balcony
 * Cleaning, Ceiling Cleaning.
 *
 * Now backed by the shared housekeeping_task_mgmt engine via
 * /api/hk-portal/task-management/:propertyId?type=Preventive Cleaning, so
 * preventive tasks participate in workload, supervisor console, and reports.
 * The preventive subtype is stored in the task's `notes` field; `frequency`
 * holds the recurring cadence; `lastCleaned` is derived from `completed_at`
 * when available.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AirVent,
  Sparkles,
  Grid3x3,
  AppWindow,
  Sun,
  LayoutPanelTop,
  Plus,
  Search,
  Calendar,
  CheckCircle2,
  PlayCircle,
  Clock,
  RefreshCw,
  X,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type PreventiveType = 'Air Filters' | 'Furniture Polish' | 'Tile Grout' | 'Window Cleaning' | 'Balcony Cleaning' | 'Ceiling Cleaning';
type UiStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Overdue';

interface TaskRow {
  id: string;
  type: string;
  location: string;
  assignedTo?: string;
  attendantId?: string | null;
  priority: string;
  dueDate: string;
  status: string;
  progress: number;
  frequency?: string;
  subtype?: string;
  notes?: string;
  lastCleaned?: string;
  completedAt?: string;
}

interface PreventiveTask {
  id: string;
  type: PreventiveType;
  location: string;
  frequency: string;
  assignedTo?: string;
  dueDate: string;
  lastDone?: string;
  status: UiStatus;
}

const TYPE_ICON: Record<PreventiveType, LucideIcon> = {
  'Air Filters': AirVent,
  'Furniture Polish': Sparkles,
  'Tile Grout': Grid3x3,
  'Window Cleaning': AppWindow,
  'Balcony Cleaning': Sun,
  'Ceiling Cleaning': LayoutPanelTop,
};

const STATUS_TONE: Record<UiStatus, StatusTone> = {
  'Scheduled': 'neutral',
  'In Progress': 'info',
  'Completed': 'success',
  'Overdue': 'danger',
};

const TYPES: PreventiveType[] = ['Air Filters', 'Furniture Polish', 'Tile Grout', 'Window Cleaning', 'Balcony Cleaning', 'Ceiling Cleaning'];

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

function toPreventiveTask(row: TaskRow): PreventiveTask {
  const today = new Date().toISOString().slice(0, 10);
  const dueDay = parseDueDate(row.dueDate);
  const isPastDue = dueDay !== null && dueDay < today;
  const dbStatus = row.status;
  let uiStatus: UiStatus;
  if (dbStatus === 'Completed' || dbStatus === 'Verified') uiStatus = 'Completed';
  else if (dbStatus === 'In Progress') uiStatus = isPastDue ? 'Overdue' : 'In Progress';
  else uiStatus = isPastDue ? 'Overdue' : 'Scheduled';

  // Subtype lives in the dedicated `subtype` column (migration 311) so the
  // user-facing `notes` field stays free for supervisor notes.
  const subtype = (row.subtype && TYPES.includes(row.subtype.trim() as PreventiveType))
    ? (row.subtype.trim() as PreventiveType)
    : TYPES[0];

  const lastDone = row.lastCleaned || (row.completedAt ? row.completedAt.slice(0, 10) : undefined);

  return {
    id: row.id,
    type: subtype,
    location: row.location,
    frequency: row.frequency || 'One-off',
    assignedTo: row.assignedTo,
    dueDate: dueDay || (row.dueDate || '').trim(),
    lastDone,
    status: uiStatus,
  };
}

export default function PreventiveCleaningModule() {
  const { addNotification, currentPropertyId } = useERP();
  const [tasks, setTasks] = useState<PreventiveTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'All' | UiStatus>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | PreventiveType>('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'Air Filters' as PreventiveType,
    location: '',
    frequency: 'Monthly',
    assignedTo: '',
    dueDate: new Date().toISOString().slice(0, 10),
  });

  const loadTasks = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/hk-portal/task-management/${currentPropertyId}?type=${encodeURIComponent('Preventive Cleaning')}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setTasks((json.tasks || []).map(toPreventiveTask));
    } catch (err) {
      console.error('Error loading preventive tasks:', err);
      addNotification('Failed to load preventive tasks', 'warning', 'Housekeeping');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const filtered = useMemo(
    () =>
      tasks.filter(t => {
        const matchesStatus = filter === 'All' || t.status === filter;
        const matchesType = typeFilter === 'All' || t.type === typeFilter;
        const s = search.toLowerCase();
        const matchesSearch =
          t.location.toLowerCase().includes(s) ||
          (t.assignedTo?.toLowerCase().includes(s) ?? false);
        return matchesStatus && matchesType && matchesSearch;
      }),
    [tasks, filter, typeFilter, search]
  );

  const advance = async (id: string) => {
    try {
      const res = await fetch(`/api/hk-portal/task-management/${id}/advance`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      addNotification(`Preventive task ${id} advanced.`, 'task', 'Housekeeping');
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
          priority: 'Low',
          dueDate: form.dueDate,
          tasks: [{
            type: 'Preventive Cleaning',
            location: form.location.trim(),
            assignedTo: form.assignedTo.trim() || undefined,
            frequency: form.frequency,
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
      setForm({ type: 'Air Filters', location: '', frequency: 'Monthly', assignedTo: '', dueDate: new Date().toISOString().slice(0, 10) });
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
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Preventive Cleaning"
        subtitle="Recurring preventive cleaning across property."
        icon={Sparkles}
        actions={
          <div className="flex gap-2">
            <button onClick={loadTasks} disabled={loading} className={button.ghost + ' text-xs'}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}>
              <Plus size={14} /> Schedule Task
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

      {/* Type quick filter */}
      <SectionCard pad="md" tone="accent">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {(Object.keys(TYPE_ICON) as PreventiveType[]).map(t => {
            const Icon = TYPE_ICON[t];
            const active = typeFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : t)}
                className={[
                  'p-2.5 rounded-2xl border text-center smooth-transition',
                  active
                    ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                    : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]',
                ].join(' ')}
              >
                <Icon size={16} className="mx-auto text-[var(--color-accent-operations)] mb-1" />
                <p className="text-[8px] font-black uppercase leading-tight text-gray-600 dark:text-gray-300">{t}</p>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Filters + search */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1">
            {(['All', 'Scheduled', 'In Progress', 'Completed', 'Overdue'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={[
                  'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase smooth-transition',
                  filter === f
                    ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="Search location, assignee..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)] font-sans"
            />
          </div>
        </div>
      </SectionCard>

      {/* Task list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {filtered.map(t => {
          const Icon = TYPE_ICON[t.type];
          const tone = STATUS_TONE[t.status];
          return (
            <div key={t.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 md:w-64 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone === 'neutral' ? 'neutral' : tone].soft}`}>
                  <Icon size={16} className={statusTone[tone].text} />
                </div>
                <div>
                  <h4 className="text-[11px] font-black text-gray-900 dark:text-white uppercase">{t.type}</h4>
                  <p className="text-[9px] text-gray-400 font-mono">{t.id} · {t.frequency}</p>
                </div>
              </div>
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px] font-mono">
                <div><span className="block text-[8px] font-black text-gray-400 uppercase">Location</span><span className="font-bold text-gray-700 dark:text-gray-200">{t.location}</span></div>
                <div><span className="block text-[8px] font-black text-gray-400 uppercase">Due</span><span className="font-bold text-gray-700 dark:text-gray-200">{t.dueDate}</span></div>
                <div><span className="block text-[8px] font-black text-gray-400 uppercase">Last Done</span><span className="font-bold text-gray-700 dark:text-gray-200">{t.lastDone || '—'}</span></div>
              </div>
              <div className="flex items-center gap-3 md:w-40 shrink-0 justify-between md:justify-end">
                <Badge tone={tone} variant="soft">{t.status}</Badge>
                {t.status !== 'Completed' && (
                  <button
                    onClick={() => advance(t.id)}
                    className={button.ghost + ' bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] hover:bg-[var(--color-accent-operations)] hover:text-white'}
                  >
                    {t.status === 'Scheduled' || t.status === 'Overdue' ? 'Start' : 'Complete'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="p-8 text-center text-[10px] font-bold text-gray-400 uppercase">{loading ? 'Loading…' : 'No preventive tasks match the filters.'}</div>}
      </SectionCard>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Schedule Preventive Task</h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as PreventiveType })} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Location *</label>
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. All Floors, Lobby, Rooms 501-510" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Frequency</label>
                  <input value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} placeholder="Weekly, Monthly, Quarterly…" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
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
