/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task Management module — docs/Housekeeping Portal new.md §6.
 * DB-integrated: fetches and persists tasks from /api/hk-portal/task-management.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  ClipboardList,
  Zap,
  Crown,
  Moon,
  Sun,
  Brush,
  SprayCan,
  Building2,
  AlertTriangle,
  Biohazard,
  RefreshCw,
  MessageSquareWarning,
  Clock,
  CheckCircle2,
  PlayCircle,
  Trash2,
  Printer,
  Loader2,
  ServerCrash,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useHKDocs, getChecklistForType } from '../../config/hkDocs';
import { useERP } from '../../context/ERPContext';

type TaskType =
  | 'Checkout Cleaning' | 'Stayover Service' | 'VIP Preparation' | 'Turndown Service'
  | 'Early Arrival Preparation' | 'Deep Cleaning' | 'Preventive Cleaning' | 'Public Area Cleaning'
  | 'Special Cleaning' | 'Emergency Cleaning' | 'Biohazard Cleaning' | 'Room Refresh' | 'Guest Complaint Follow-up';

type Category = 'Automatic' | 'Manual';
type Status = 'Pending' | 'In Progress' | 'Completed' | 'Verified';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';

interface Task {
  id: string;
  type: TaskType;
  category: Category;
  location: string;
  assignedTo?: string;
  priority: Priority;
  dueDate: string;
  status: Status;
  progress: number;
}

interface TaskStaff {
  id: string;
  name: string;
  status: string;
}

const AUTOMATIC_TYPES: TaskType[] = ['Checkout Cleaning','Stayover Service','VIP Preparation','Turndown Service','Early Arrival Preparation','Deep Cleaning','Preventive Cleaning','Public Area Cleaning'];
const MANUAL_TYPES: TaskType[] = ['Special Cleaning','Emergency Cleaning','Biohazard Cleaning','Room Refresh','Guest Complaint Follow-up'];

const TYPE_ICON: Record<TaskType, LucideIcon> = {
  'Checkout Cleaning': ClipboardList, 'Stayover Service': RefreshCw, 'VIP Preparation': Crown,
  'Turndown Service': Moon, 'Early Arrival Preparation': Sun, 'Deep Cleaning': Brush,
  'Preventive Cleaning': SprayCan, 'Public Area Cleaning': Building2, 'Special Cleaning': SprayCan,
  'Emergency Cleaning': Zap, 'Biohazard Cleaning': Biohazard, 'Room Refresh': RefreshCw,
  'Guest Complaint Follow-up': MessageSquareWarning,
};

const PRIORITY_TONE: Record<Priority, StatusTone> = { Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' };
const STATUS_TONE: Record<Status, StatusTone> = { Pending: 'neutral', 'In Progress': 'info', Completed: 'success', Verified: 'success' };

const categoryOf = (t: TaskType): Category => (AUTOMATIC_TYPES.includes(t) ? 'Automatic' : 'Manual');

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// ── Print helper ───────────────────────────────────────────────────────
const HOTEL_LABEL = 'SELEDA ERP — Housekeeping';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function printTaskSheet(task: Task, docs: ReturnType<typeof useHKDocs>['docs']) {
  if (typeof window === 'undefined') return;
  const items = getChecklistForType(docs, task.type);
  const checklistHtml = items
    .map((item) => `<li><span class="box"></span><span class="label">${escapeHtml(item)}</span></li>`)
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(`${task.id} — ${task.type}`)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 28px; }
  header { border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  header .brand { font-size: 16px; font-weight: 800; }
  header .id { font-size: 12px; color: #64748b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 12px; margin-bottom: 18px; }
  .meta b { color: #334155; }
  .priority { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .priority-Critical { background: #fee2e2; color: #b91c1c; }
  .priority-High { background: #fef3c7; color: #b45309; }
  .priority-Medium { background: #dbeafe; color: #1d4ed8; }
  .priority-Low { background: #e2e8f0; color: #475569; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin: 18px 0 8px; color: #475569; }
  ul.checklist { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 32px; }
  ul.checklist li { display: flex; align-items: center; gap: 10px; padding: 6px 0; break-inside: avoid; font-size: 13px; }
  .box { width: 16px; height: 16px; border: 2px solid #1e293b; border-radius: 4px; display: inline-block; flex-shrink: 0; }
  .sign { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .sign .line { border-top: 1px solid #1e293b; padding-top: 6px; font-size: 11px; color: #64748b; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print {
    body { margin: 12mm; }
    ul.checklist, .sign { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    <div class="brand">${escapeHtml(HOTEL_LABEL)}</div>
    <div class="id">${escapeHtml(task.id)}</div>
  </header>
  <h1>${escapeHtml(task.type)}</h1>
  <div class="meta">
    <div><b>Location:</b> ${escapeHtml(task.location)}</div>
    <div><b>Category:</b> ${escapeHtml(task.category)}</div>
    <div><b>Assigned To:</b> ${escapeHtml(task.assignedTo || 'Unassigned')}</div>
    <div><b>Due:</b> ${escapeHtml(task.dueDate)}</div>
    <div><b>Priority:</b> <span class="priority priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span></div>
    <div><b>Status:</b> ${escapeHtml(task.status)}</div>
  </div>
  <h2>Cleaning Checklist</h2>
  <ul class="checklist">${checklistHtml}</ul>
  <div class="sign">
    <div class="line">Attendant Signature / Date</div>
    <div class="line">Supervisor Signature / Date</div>
  </div>
  <div class="footer">Generated ${new Date().toLocaleString()} · SELEDA ERP Housekeeping Task Sheet</div>
  <script>
    window.onload = function () { window.focus(); window.print(); window.onafterprint = function () { window.close(); }; };
  </script>
</body>
</html>`;

  const printWindow = window.open('', '_blank', 'width=820,height=720');
  if (!printWindow) {
    console.warn('Print window blocked by browser pop-up settings.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

interface BatchRow {
  id: number;
  type: TaskType;
  location: string;
  assignedTo?: string;
  priority?: Priority;
  dueDate?: string;
}

let batchRowId = 1;

export default function TaskManagementModule() {
  const { currentPropertyId, addNotification } = useERP();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<TaskStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'All' | Category>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | Status>('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([{ id: batchRowId, type: 'Checkout Cleaning', location: '' }]);
  const [shared, setShared] = useState<{ assignedTo: string; priority: Priority; dueDate: string }>({
    assignedTo: '', priority: 'Medium', dueDate: '',
  });
  const { docs: hkDocs } = useHKDocs();

  const fetchTasks = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/task-management/${currentPropertyId}?status=all&category=all`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const fetchStaff = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hk-portal/task-management/staff/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { staff: TaskStaff[] };
      setStaff(data.staff || []);
    } catch {
      /* non-fatal — assignee dropdown falls back to free text */
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchTasks();
    fetchStaff();
  }, [fetchTasks, fetchStaff]);

  const staffById = useMemo(() => {
    const map: Record<string, TaskStaff> = {};
    staff.forEach(s => (map[s.id] = s));
    return map;
  }, [staff]);

  const filtered = useMemo(
    () => tasks.filter(t => {
      const matchesCat = categoryFilter === 'All' || t.category === categoryFilter;
      const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
      const matchesSearch =
        t.location.toLowerCase().includes(search.toLowerCase()) ||
        t.type.toLowerCase().includes(search.toLowerCase()) ||
        (t.assignedTo?.toLowerCase().includes(search.toLowerCase()) ?? false);
      return matchesCat && matchesStatus && matchesSearch;
    }),
    [tasks, categoryFilter, statusFilter, search]
  );

  const counts = useMemo(() => ({
    Automatic: tasks.filter(t => t.category === 'Automatic').length,
    Manual: tasks.filter(t => t.category === 'Manual').length,
    Pending: tasks.filter(t => t.status === 'Pending').length,
    InProgress: tasks.filter(t => t.status === 'In Progress').length,
    Completed: tasks.filter(t => t.status === 'Completed' || t.status === 'Verified').length,
  }), [tasks]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const advance = async (id: string) => {
    const current = tasks.find(t => t.id === id);
    if (!current || current.status === 'Verified') return;

    const next: Status = current.status === 'Pending' ? 'In Progress' : current.status === 'In Progress' ? 'Completed' : 'Verified';
    const nextProgress = next === 'Completed' || next === 'Verified' ? 100 : current.progress === 0 ? 30 : current.progress;

    // Optimistic update
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: next, progress: nextProgress } : t)));
    setActingOn(id);

    try {
      const res = await fetch(`/api/hk-portal/task-management/${id}/advance`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error('Failed to advance task');
      const updated = (await res.json()) as Task;
      setTasks(prev => prev.map(t => (t.id === id ? updated : t)));
      addNotification(`${current.type} ${current.location} advanced to ${next}`, 'success', 'Housekeeping');
    } catch {
      setTasks(prev => prev.map(t => (t.id === id ? current : t))); // rollback
      addNotification(`Failed to advance ${current.type}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const deleteTask = async (id: string) => {
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    setActingOn(id);
    try {
      const res = await fetch(`/api/hk-portal/task-management/${id}`, {
        method: 'DELETE',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error('Failed to delete task');
      setTasks(prev => prev.filter(t => t.id !== id));
      addNotification(`${current.type} ${current.location} deleted`, 'info', 'Housekeeping');
    } catch {
      addNotification(`Failed to delete ${current.type}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const addRow = () => {
    batchRowId += 1;
    setBatchRows(prev => [...prev, { id: batchRowId, type: 'Checkout Cleaning', location: '' }]);
  };

  const removeRow = (id: number) =>
    setBatchRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.id !== id)));

  const updateRow = (id: number, patch: Partial<BatchRow>) =>
    setBatchRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const validRows = batchRows.filter(r => r.location.trim());

  const createTasks = async () => {
    if (validRows.length === 0 || !currentPropertyId) return;

    const due = shared.dueDate || new Date().toISOString().slice(0, 16);
    const payload = {
      propertyId: currentPropertyId,
      assignedTo: shared.assignedTo.trim() || undefined,
      priority: shared.priority,
      dueDate: due,
      tasks: validRows.map(r => ({
        type: r.type,
        location: r.location.trim(),
        assignedTo: r.assignedTo?.trim(),
        priority: r.priority,
        dueDate: r.dueDate,
      })),
    };

    try {
      const res = await fetch('/api/hk-portal/task-management', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create tasks');
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(prev => [...(data.tasks || []), ...prev]);
      setShowForm(false);
      addNotification(`${(data.tasks || []).length} task(s) created`, 'success', 'Housekeeping');
    } catch {
      addNotification('Failed to create tasks', 'error', 'Housekeeping');
      return;
    }

    batchRowId = 1;
    setBatchRows([{ id: batchRowId, type: 'Checkout Cleaning', location: '' }]);
    setShared({ assignedTo: '', priority: 'Medium', dueDate: '' });
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Task Management" subtitle="Automatic & manual housekeeping tasks" icon={ClipboardList} />
        <SectionCard pad="md">
          <div className="flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5" /> Select a property in the header to load tasks.
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Task Management"
        subtitle="Automatic & manual housekeeping tasks · DB-synced"
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchTasks} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => filtered.forEach(t => printTaskSheet(t, hkDocs))} disabled={filtered.length === 0} className={button.secondary} title="Print all filtered tasks">
              <Printer className="w-4 h-4" /> Print All
            </button>
            <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Task</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard title="Automatic Tasks" value={counts.Automatic} icon={Zap} tone="accent" />
        <StatCard title="Manual Tasks" value={counts.Manual} icon={ClipboardList} tone="warning" />
        <StatCard title="Pending" value={counts.Pending} icon={Clock} tone="neutral" />
        <StatCard title="In Progress" value={counts.InProgress} icon={PlayCircle} tone="info" />
        <StatCard title="Completed" value={counts.Completed} icon={CheckCircle2} tone="success" />
      </div>

      <ModalSystem
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onConfirm={createTasks}
        title="New Housekeeping Tasks"
        subtitle={`Create multiple tasks at once · ${validRows.length} ready`}
        variant="form"
        size="lg"
        confirmLabel={`Create ${validRows.length || ''} Task${validRows.length === 1 ? '' : 's'}`}
        cancelLabel="Cancel"
        confirmColor="indigo"
      >
        <div className="space-y-5">
          {/* Shared fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Assigned To (all)</label>
              <select
                value={shared.assignedTo}
                onChange={e => setShared(s => ({ ...s, assignedTo: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
              >
                <option value="">Unassigned / Free text</option>
                {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Priority (all)</label>
              <select value={shared.priority} onChange={e => setShared(s => ({ ...s, priority: e.target.value as Priority }))} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none">
                {(['Low', 'Medium', 'High', 'Critical'] as Priority[]).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Due Date & Time (all)</label>
              <input type="datetime-local" value={shared.dueDate} onChange={e => setShared(s => ({ ...s, dueDate: e.target.value }))} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
            </div>
          </div>

          {/* Task rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-gray-500">Tasks</label>
              <span className="text-xs text-gray-400">{batchRows.length} row{batchRows.length === 1 ? '' : 's'}</span>
            </div>
            {batchRows.map((row, idx) => (
              <div key={row.id} className="flex items-center gap-2">
                <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                <select value={row.type} onChange={e => updateRow(row.id, { type: e.target.value as TaskType })} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none flex-1 min-w-0">
                  <optgroup label="Automatic">
                    {AUTOMATIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                  <optgroup label="Manual">
                    {MANUAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                </select>
                <input placeholder="Location / Room" value={row.location} onChange={e => updateRow(row.id, { location: e.target.value })} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none flex-1 min-w-0" />
                <button onClick={() => removeRow(row.id)} disabled={batchRows.length === 1} title="Remove row" className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <button onClick={addRow} className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 hover:border-[var(--color-accent-operations)] hover:text-[var(--color-accent-operations)] transition text-sm font-medium`}>
            <Plus className="w-4 h-4" /> Add Another Task
          </button>
        </div>
      </ModalSystem>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {(['All', 'Automatic', 'Manual'] as const).map(f => (
              <button key={f} onClick={() => setCategoryFilter(f)} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${categoryFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{f}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | Status)} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none cursor-pointer">
              <option value="All">All Statuses</option>
              {(['Pending', 'In Progress', 'Completed', 'Verified'] as Status[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search type, location, assignee..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      {/* States */}
      {loading && tasks.length === 0 && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-10 rounded-2xl flex items-center justify-center gap-3 text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading tasks…
        </div>
      )}
      {error && !loading && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-8 rounded-2xl text-center">
          <ServerCrash className="w-8 h-8 mx-auto mb-2 text-rose-500" />
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={fetchTasks} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <SectionCard title="Tasks" icon={ClipboardList} tone="accent">
          <div className="divide-y divide-gray-200 dark:divide-slate-700">
            {filtered.map(t => {
              const Icon = TYPE_ICON[t.type];
              const busy = actingOn === t.id;
              return (
                <div key={t.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-3 md:w-72 shrink-0">
                    <div className={`p-2 rounded-xl ${t.category === 'Automatic' ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'} ${busy ? 'animate-pulse' : ''}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">{t.type}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-500">{t.id} · {t.category}</p>
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><span className="block text-xs text-gray-500 uppercase">Location</span><span className="font-medium text-gray-900 dark:text-white">{t.location}</span></div>
                    <div><span className="block text-xs text-gray-500 uppercase">Assigned</span><span className="font-medium text-gray-900 dark:text-white">{t.assignedTo || 'Unassigned'}</span></div>
                    <div><span className="block text-xs text-gray-500 uppercase">Due</span><span className="font-medium text-gray-900 dark:text-white">{t.dueDate}</span></div>
                    <div className="flex items-center"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></div>
                  </div>
                  <div className="flex items-center gap-3 md:w-56 shrink-0">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className={`font-bold ${statusTone[STATUS_TONE[t.status]].text}`}>{t.status}</span>
                        <span className="text-gray-500">{t.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full ${t.progress === 100 ? 'bg-emerald-500' : 'bg-[var(--color-accent-operations)]'}`} style={{ width: `${t.progress}%` }} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {t.status !== 'Verified' && (
                        <button onClick={() => advance(t.id)} disabled={busy} className={button.primary + ' text-xs px-3 py-1.5'}>
                          {t.status === 'Pending' ? 'Start' : t.status === 'In Progress' ? 'Complete' : 'Verify'}
                        </button>
                      )}
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => printTaskSheet(t, hkDocs)} title="Print task sheet with checklist" className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition flex items-center justify-center gap-1">
                          <Printer className="w-3 h-3" /> Print
                        </button>
                        <button onClick={() => deleteTask(t.id)} disabled={busy} title="Delete task" className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No tasks match the filters.</div>}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
