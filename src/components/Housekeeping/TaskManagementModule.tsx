/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified Task Management module — docs/Housekeeping Portal new.md §6/§7/§8.
 *
 * Consolidates Task Management (§6), Room Cleaning (§7), and Public Area
 * Cleaning (§8) into a single master-detail interface. The interactive
 * checklist is driven by getChecklistForType() from hkDocs, so each task
 * type shows its own tailored checklist (room types get the 8-step
 * standard cleaning, public area types get floor sweeping/mopping/etc,
 * turndown types get curtains/bed/lighting, etc).
 *
 * DB-integrated: fetches and persists via /api/hk-portal/task-management.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Sparkles,
  ChevronDown,
  Users,
  MapPin,
  Tag,
  Flag,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useHKDocs, getChecklistForType } from '../../config/hkDocs';
import { useERP } from '../../context/ERPContext';

// Format an ISO timestamp (or legacy time label) for compact display.
function fmtTime(ts: string | undefined): string {
  if (!ts) return '';
  // Legacy time-only labels ("09:41 AM") pass through unchanged.
  if (!ts.includes('T')) return ts;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type TaskType =
  | 'Checkout Cleaning' | 'Stayover Service' | 'VIP Preparation' | 'Turndown Service'
  | 'Early Arrival Preparation' | 'Deep Cleaning' | 'Preventive Cleaning' | 'Public Area Cleaning'
  | 'Special Cleaning' | 'Emergency Cleaning' | 'Biohazard Cleaning' | 'Room Refresh' | 'Guest Complaint Follow-up';

type Category = 'Automatic' | 'Manual';
type Status = 'Pending' | 'In Progress' | 'Completed' | 'Verified';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type ServiceType = 'Full Service' | 'Stayover Service' | 'Express Service' | 'Eco Service' | 'Turndown Service';

interface Task {
  id: string;
  type: TaskType;
  category: Category;
  location: string;
  assignedTo?: string;
  attendantId?: string | null;
  priority: Priority;
  dueDate: string;
  status: Status;
  progress: number;
  checklist?: Record<string, boolean>;
  serviceType?: ServiceType;
  floor?: string;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  frequency?: string;
  lastCleaned?: string;
}

interface TaskStaff {
  id: string;
  name: string;
  status: string;
}

const AUTOMATIC_TYPES: TaskType[] = ['Checkout Cleaning','Stayover Service','VIP Preparation','Turndown Service','Early Arrival Preparation','Deep Cleaning','Preventive Cleaning','Public Area Cleaning'];
const MANUAL_TYPES: TaskType[] = ['Special Cleaning','Emergency Cleaning','Biohazard Cleaning','Room Refresh','Guest Complaint Follow-up'];
const ALL_SERVICE_TYPES: ServiceType[] = ['Full Service', 'Stayover Service', 'Express Service', 'Eco Service', 'Turndown Service'];

const TYPE_ICON: Record<TaskType, LucideIcon> = {
  'Checkout Cleaning': ClipboardList, 'Stayover Service': RefreshCw, 'VIP Preparation': Crown,
  'Turndown Service': Moon, 'Early Arrival Preparation': Sun, 'Deep Cleaning': Brush,
  'Preventive Cleaning': SprayCan, 'Public Area Cleaning': Building2, 'Special Cleaning': SprayCan,
  'Emergency Cleaning': Zap, 'Biohazard Cleaning': Biohazard, 'Room Refresh': RefreshCw,
  'Guest Complaint Follow-up': MessageSquareWarning,
};

const PRIORITY_TONE: Record<Priority, StatusTone> = { Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' };
const STATUS_TONE: Record<Status, StatusTone> = { Pending: 'neutral', 'In Progress': 'info', Completed: 'success', Verified: 'success' };

// Left-border accent color per priority — gives list cards an instant visual rank.
const PRIORITY_BORDER: Record<Priority, string> = {
  Critical: 'border-l-[var(--color-danger)]',
  High: 'border-l-[var(--color-warning)]',
  Medium: 'border-l-[var(--color-info)]',
  Low: 'border-l-gray-300 dark:border-l-slate-600',
};

const categoryOf = (t: TaskType): Category => (AUTOMATIC_TYPES.includes(t) ? 'Automatic' : 'Manual');

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

// ── Progress helper ────────────────────────────────────────────────────
function computeProgress(task: Task, checklistItems: string[]): number {
  if (checklistItems.length === 0) return task.progress;
  const done = checklistItems.filter(item => task.checklist?.[item]).length;
  return Math.round((done / checklistItems.length) * 100);
}

// ── Task ID shortener ──────────────────────────────────────────────────
// "TSK-1787238819250-1" → "#1" (just the sequence suffix, the meaningful part)
function shortId(fullId: string): string {
  const parts = fullId.split('-');
  if (parts.length >= 2) return `#${parts[parts.length - 1]}`;
  return fullId;
}

// ── Datetime helpers ───────────────────────────────────────────────────
// The DB stores due_date as free-form text (e.g. "2026-08-20 09:00" or
// "07:00 AM"). The <input type="datetime-local"> needs "YYYY-MM-DDTHH:MM".
function toDatetimeLocal(value: string | undefined): string {
  if (!value) return '';
  // Already in the right format (contains 'T')
  if (value.includes('T')) return value.slice(0, 16);
  // "2026-08-20 09:00" → "2026-08-20T09:00"
  const m = value.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}`;
  // Time-only or other formats — can't convert, return empty
  return '';
}

function fromDatetimeLocal(value: string): string {
  // "2026-08-20T09:00" → "2026-08-20 09:00" (DB format)
  return value.replace('T', ' ');
}

// ── Due-date display helper ────────────────────────────────────────────
// Returns { label, tone } for display on list cards.
function dueDateDisplay(dueDate: string): { label: string; overdue: boolean; dueSoon: boolean } {
  if (!dueDate) return { label: '—', overdue: false, dueSoon: false };
  // Try to parse "2026-08-20 09:00" or "2026-08-20T09:00"
  const normalized = dueDate.includes('T') ? dueDate : dueDate.replace(' ', 'T');
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return { label: dueDate, overdue: false, dueSoon: false };

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const label = date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return {
    label,
    overdue: diffMs < 0,
    dueSoon: diffHours >= 0 && diffHours <= 4,
  };
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

// Print all filtered tasks in a SINGLE window (one section per task) to
// avoid the browser pop-up blocker that kills the N-windows approach.
// Supports optional grouping by a key extractor — groups get a header banner.
type PrintGroupKey = 'none' | 'staff' | 'location' | 'type' | 'priority' | 'status';

function printAllTaskSheets(
  tasks: Task[],
  docs: ReturnType<typeof useHKDocs>['docs'],
  groupBy: PrintGroupKey = 'none',
) {
  if (typeof window === 'undefined' || tasks.length === 0) return;

  const renderTaskSection = (task: Task) => {
    const items = getChecklistForType(docs, task.type);
    const checklistHtml = items
      .map((item) => `<li><span class="box"></span><span class="label">${escapeHtml(item)}</span></li>`)
      .join('');
    return `<section class="task-sheet">
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
</section>`;
  };

  const groupLabel = (key: PrintGroupKey): string => {
    switch (key) {
      case 'staff': return 'Staff Member';
      case 'location': return 'Location';
      case 'type': return 'Task Type';
      case 'priority': return 'Priority';
      case 'status': return 'Status';
      default: return '';
    }
  };

  const groupValue = (task: Task, key: PrintGroupKey): string => {
    switch (key) {
      case 'staff': return task.assignedTo || 'Unassigned';
      case 'location': return task.location;
      case 'type': return task.type;
      case 'priority': return task.priority;
      case 'status': return task.status;
      default: return '';
    }
  };

  // Build sections — optionally grouped
  let sectionsHtml: string;
  let titleSuffix = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

  if (groupBy === 'none') {
    sectionsHtml = tasks.map(renderTaskSection).join('<div class="page-break"></div>');
  } else {
    // Group tasks
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = groupValue(task, groupBy);
      const arr = groups.get(key) ?? [];
      arr.push(task);
      groups.set(key, arr);
    }
    // Sort group keys — priority by severity, status by workflow order, others alpha
    const priorityOrder = ['Critical', 'High', 'Medium', 'Low'];
    const statusOrder = ['Pending', 'In Progress', 'Completed', 'Verified'];
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (groupBy === 'priority') return priorityOrder.indexOf(a) - priorityOrder.indexOf(b);
      if (groupBy === 'status') return statusOrder.indexOf(a) - statusOrder.indexOf(b);
      return a.localeCompare(b);
    });

    titleSuffix = `${tasks.length} task${tasks.length === 1 ? '' : 's'} · Grouped by ${groupLabel(groupBy)}`;

    sectionsHtml = sortedKeys.map(key => {
      const groupTasks = groups.get(key)!;
      const groupHeader = `<div class="group-header">${escapeHtml(groupLabel(groupBy))}: ${escapeHtml(key)} <span class="group-count">${groupTasks.length}</span></div>`;
      const taskSections = groupTasks.map(renderTaskSection).join('<div class="page-break"></div>');
      return groupHeader + taskSections;
    }).join('<div class="page-break"></div>');
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Housekeeping Task Sheets — ${escapeHtml(titleSuffix)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 28px; }
  header { border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  header .brand { font-size: 16px; font-weight: 800; }
  header .count { font-size: 12px; color: #64748b; }
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
  .group-header { background: #1e293b; color: #fff; padding: 8px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .group-header .group-count { background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  .page-break { page-break-after: always; height: 0; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print {
    body { margin: 12mm; }
    ul.checklist, .sign { page-break-inside: avoid; }
    .group-header { page-break-after: avoid; }
    .page-break { page-break-after: always; }
  }
</style>
</head>
<body>
  <header>
    <div class="brand">${escapeHtml(HOTEL_LABEL)}</div>
    <div class="count">${escapeHtml(titleSuffix)}</div>
  </header>
  ${sectionsHtml}
  <div class="footer">Generated ${new Date().toLocaleString()} · SELEDA ERP Housekeeping Task Sheets</div>
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

// ── Field wrapper (labeled form field) ─────────────────────────────────
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

interface BatchRow {
  id: number;
  type: TaskType;
  location: string;
  serviceType?: ServiceType;
  floor?: string;
}

export default function TaskManagementModule() {
  const { currentPropertyId, addNotification } = useERP();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<TaskStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'All' | Category>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | Status>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | TaskType>('All');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [printSubmenu, setPrintSubmenu] = useState<'staff' | 'location' | 'type' | 'priority' | 'status' | null>(null);
  const printMenuRef = useRef<HTMLDivElement>(null);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([{ id: 1, type: 'Checkout Cleaning', location: '' }]);
  const [shared, setShared] = useState<{ assignedTo: string; priority: Priority; dueDate: string }>({
    assignedTo: '', priority: 'Medium', dueDate: '',
  });
  const { docs: hkDocs } = useHKDocs();
  const batchRowIdRef = useRef(1);

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

  // Close print menu on outside click
  useEffect(() => {
    if (!printMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) {
        setPrintMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [printMenuOpen]);

  const staffById = useMemo(() => {
    const map: Record<string, TaskStaff> = {};
    staff.forEach(s => (map[s.id] = s));
    return map;
  }, [staff]);

  const filtered = useMemo(
    () => tasks.filter(t => {
      const matchesCat = categoryFilter === 'All' || t.category === categoryFilter;
      const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
      const matchesType = typeFilter === 'All' || t.type === typeFilter;
      const matchesSearch =
        t.location.toLowerCase().includes(search.toLowerCase()) ||
        t.type.toLowerCase().includes(search.toLowerCase()) ||
        (t.assignedTo?.toLowerCase().includes(search.toLowerCase()) ?? false);
      return matchesCat && matchesStatus && matchesType && matchesSearch;
    }),
    [tasks, categoryFilter, statusFilter, typeFilter, search]
  );

  // Unique staff + locations + types + priorities + statuses from filtered tasks — for the print submenu
  const printStaffList = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      const key = t.assignedTo || 'Unassigned';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const printLocationList = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      map.set(t.location, (map.get(t.location) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const printTypeList = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      map.set(t.type, (map.get(t.type) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const printPriorityList = useMemo(() => {
    const order = ['Critical', 'High', 'Medium', 'Low'];
    const map = new Map<string, number>();
    for (const t of filtered) {
      map.set(t.priority, (map.get(t.priority) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [filtered]);

  const printStatusList = useMemo(() => {
    const order = ['Pending', 'In Progress', 'Completed', 'Verified'];
    const map = new Map<string, number>();
    for (const t of filtered) {
      map.set(t.status, (map.get(t.status) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [filtered]);

  // selected is only set by explicit click — no auto-select (modal stays closed)
  const selected = tasks.find(t => t.id === selectedId) ?? null;

  const selectedChecklistItems = useMemo(
    () => selected ? getChecklistForType(hkDocs, selected.type) : [],
    [selected, hkDocs]
  );

  const counts = useMemo(() => ({
    Automatic: tasks.filter(t => t.category === 'Automatic').length,
    Manual: tasks.filter(t => t.category === 'Manual').length,
    Pending: tasks.filter(t => t.status === 'Pending').length,
    InProgress: tasks.filter(t => t.status === 'In Progress').length,
    Completed: tasks.filter(t => t.status === 'Completed').length,
    Verified: tasks.filter(t => t.status === 'Verified').length,
  }), [tasks]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const patchTask = (id: string, patch: Partial<Task>) =>
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const advance = async (id: string) => {
    const current = tasks.find(t => t.id === id);
    if (!current || current.status === 'Verified') return;

    const next: Status = current.status === 'Pending' ? 'In Progress' : current.status === 'In Progress' ? 'Completed' : 'Verified';
    const nextProgress = next === 'Completed' || next === 'Verified' ? 100 : current.progress === 0 ? 30 : current.progress;

    patchTask(id, { status: next, progress: nextProgress });
    setActingOn(id);

    try {
      const res = await fetch(`/api/hk-portal/task-management/${id}/advance`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error('Failed to advance task');
      const updated = (await res.json()) as Task & { consumptionWarnings?: string[] };
      patchTask(id, updated);
      addNotification(`${current.type} ${current.location} advanced to ${next}`, 'success', 'Housekeeping');
      // Surface consumption warnings so stock drift is never silent.
      if (updated.consumptionWarnings) {
        for (const w of updated.consumptionWarnings) addNotification(w, 'warning', 'Housekeeping');
      }
    } catch {
      patchTask(id, current); // rollback
      addNotification(`Failed to advance ${current.type}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const startTask = async (id: string) => {
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    patchTask(id, { status: 'In Progress', startedAt: new Date().toISOString(), progress: 30 });
    setActingOn(id);
    try {
      const res = await fetch(`/api/hk-portal/task-management/${id}/start`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error('Failed to start task');
      const updated = (await res.json()) as Task;
      patchTask(id, updated);
      addNotification(`${current.type} ${current.location} started`, 'info', 'Housekeeping');
    } catch {
      patchTask(id, current);
      addNotification(`Failed to start ${current.type}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const toggleStep = async (taskId: string, step: string) => {
    // Read the latest task state functionally so concurrent toggles don't
    // overwrite each other (each call builds on the most recent checklist).
    let taskBeforeToggle: Task | undefined;
    let nextValue: boolean;
    let optimisticChecklist: Record<string, boolean>;
    let optimisticStatus: Status;

    setTasks(prev => {
      const task = prev.find(t => t.id === taskId);
      if (!task) return prev;
      taskBeforeToggle = task;
      const items = getChecklistForType(hkDocs, task.type);
      nextValue = !task.checklist?.[step];
      optimisticChecklist = { ...(task.checklist || {}), [step]: nextValue };
      const doneCount = items.filter(item => optimisticChecklist[item]).length;
      const allDone = items.length > 0 && doneCount === items.length;
      optimisticStatus = allDone ? 'Completed' : task.status === 'Pending' && nextValue ? 'In Progress' : task.status;
      const nowLabel = new Date().toISOString();
      return prev.map(t => t.id === taskId ? {
        ...t,
        checklist: optimisticChecklist,
        status: optimisticStatus,
        ...(allDone ? { completedAt: nowLabel, progress: 100 } : {}),
        ...(nextValue && !t.startedAt ? { startedAt: nowLabel } : {}),
      } : t);
    });

    // Send the API request (fire-and-forget per-step; server reconciles)
    try {
      const res = await fetch(`/api/hk-portal/task-management/${taskId}/checklist`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ step, value: nextValue!, status: optimisticStatus! }),
      });
      if (!res.ok) throw new Error('Failed to update checklist');
      const updated = (await res.json()) as Task;
      // Merge server response but preserve any checklist items toggled
      // concurrently that the server might not know about yet
      setTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        const mergedChecklist = { ...(updated.checklist || {}), ...t.checklist };
        return { ...updated, checklist: mergedChecklist };
      }));
    } catch {
      // Rollback only this step
      if (taskBeforeToggle) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...taskBeforeToggle!, ...t, checklist: taskBeforeToggle!.checklist } : t));
      }
      addNotification(`Failed to update checklist`, 'error', 'Housekeeping');
    }
  };

  const markAllComplete = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const items = getChecklistForType(hkDocs, task.type);
    const fullChecklist = items.reduce((acc, item) => ({ ...acc, [item]: true }), {} as Record<string, boolean>);
    patchTask(taskId, {
      checklist: fullChecklist,
      status: 'Completed',
      progress: 100,
      completedAt: new Date().toISOString(),
    });
    setActingOn(taskId);
    try {
      const res = await fetch(`/api/hk-portal/task-management/${taskId}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ checklist: fullChecklist, status: 'Completed' }),
      });
      if (!res.ok) throw new Error('Failed to complete task');
      const updated = (await res.json()) as Task & { consumptionWarnings?: string[] };
      patchTask(taskId, updated);
      addNotification(`${task.type} ${task.location} completed — ready for inspection`, 'success', 'Housekeeping');
      // Surface consumption warnings so stock drift is never silent.
      if (updated.consumptionWarnings) {
        for (const w of updated.consumptionWarnings) addNotification(w, 'warning', 'Housekeeping');
      }
    } catch {
      patchTask(taskId, task);
      addNotification(`Failed to complete ${task.type}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const reassignAttendant = async (taskId: string, attendantId: string | null) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const attendantName = attendantId ? staffById[attendantId]?.name ?? attendantId : undefined;
    patchTask(taskId, { attendantId, assignedTo: attendantName });
    try {
      const res = await fetch(`/api/hk-portal/task-management/${taskId}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ attendantId, assignedTo: attendantName || null }),
      });
      if (!res.ok) throw new Error('Failed to reassign');
      addNotification(`${task.location} ${attendantId ? `assigned to ${attendantName}` : 'unassigned'}`, 'success', 'Housekeeping');
    } catch {
      patchTask(taskId, { attendantId: task.attendantId, assignedTo: task.assignedTo });
      addNotification(`Failed to reassign ${task.location}`, 'error', 'Housekeeping');
    }
  };

  const updateTaskField = async (taskId: string, patch: Partial<Task>) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    patchTask(taskId, patch);
    // Map to server field names
    const body: Record<string, any> = {};
    if (patch.serviceType !== undefined) body.serviceType = patch.serviceType;
    if (patch.floor !== undefined) body.floor = patch.floor;
    if (patch.notes !== undefined) body.notes = patch.notes;
    if (patch.frequency !== undefined) body.frequency = patch.frequency;
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.dueDate !== undefined) body.dueDate = patch.dueDate;
    try {
      const res = await fetch(`/api/hk-portal/task-management/${taskId}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update task');
    } catch {
      patchTask(taskId, task); // rollback
      addNotification('Failed to update task', 'error', 'Housekeeping');
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
      if (selectedId === id) setSelectedId(null);
      addNotification(`${current.type} ${current.location} deleted`, 'info', 'Housekeeping');
    } catch {
      addNotification(`Failed to delete ${current.type}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  // ── Batch create ──────────────────────────────────────────────────────
  const addRow = () => {
    batchRowIdRef.current += 1;
    setBatchRows(prev => [...prev, { id: batchRowIdRef.current, type: 'Checkout Cleaning', location: '' }]);
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
        serviceType: r.serviceType,
        floor: r.floor,
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

    batchRowIdRef.current = 1;
    setBatchRows([{ id: 1, type: 'Checkout Cleaning', location: '' }]);
    setShared({ assignedTo: '', priority: 'Medium', dueDate: '' });
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Task Management" subtitle="Unified housekeeping tasks · room cleaning · public area" icon={ClipboardList} />
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
        subtitle="Unified housekeeping tasks · room cleaning · public area · DB-synced"
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchTasks} disabled={loading} className={button.secondary}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {/* Print dropdown */}
            <div className="relative" ref={printMenuRef}>
              <button
                onClick={() => setPrintMenuOpen(o => !o)}
                disabled={filtered.length === 0}
                className={button.secondary}
                title="Print task sheets"
              >
                <Printer className="w-4 h-4" /> Print
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${printMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {printMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
                  <div className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 sticky top-0 z-10">
                    Print {filtered.length} task{filtered.length === 1 ? '' : 's'}
                  </div>

                  {/* All (no grouping) */}
                  <button
                    onClick={() => { printAllTaskSheets(filtered, hkDocs, 'none'); setPrintMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                  >
                    <Printer className="w-4 h-4 text-gray-400" />
                    <span className="flex-1">All tasks</span>
                    <span className="text-xs text-gray-400">{filtered.length}</span>
                  </button>

                  {/* Staff — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'staff' ? null : 'staff')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <Users className="w-4 h-4 text-gray-400" />
                      <span className="flex-1 font-medium">By Staff Member</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${printSubmenu === 'staff' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'staff' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        <button
                          onClick={() => { printAllTaskSheets(filtered, hkDocs, 'staff'); setPrintMenuOpen(false); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">All staff (grouped)</span>
                          <span className="text-gray-400">{printStaffList.length}</span>
                        </button>
                        {printStaffList.map(([name, count]) => (
                          <button
                            key={name}
                            onClick={() => { printAllTaskSheets(filtered.filter(t => (t.assignedTo || 'Unassigned') === name), hkDocs, 'none'); setPrintMenuOpen(false); }}
                            className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                          >
                            <span className="flex-1 truncate">{name}</span>
                            <span className="text-gray-400">{count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Location — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'location' ? null : 'location')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <span className="flex-1 font-medium">By Location</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${printSubmenu === 'location' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'location' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        <button
                          onClick={() => { printAllTaskSheets(filtered, hkDocs, 'location'); setPrintMenuOpen(false); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">All locations (grouped)</span>
                          <span className="text-gray-400">{printLocationList.length}</span>
                        </button>
                        {printLocationList.map(([loc, count]) => (
                          <button
                            key={loc}
                            onClick={() => { printAllTaskSheets(filtered.filter(t => t.location === loc), hkDocs, 'none'); setPrintMenuOpen(false); }}
                            className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                          >
                            <span className="flex-1 truncate">{loc}</span>
                            <span className="text-gray-400">{count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Type — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'type' ? null : 'type')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="flex-1 font-medium">By Task Type</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${printSubmenu === 'type' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'type' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        <button
                          onClick={() => { printAllTaskSheets(filtered, hkDocs, 'type'); setPrintMenuOpen(false); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">All types (grouped)</span>
                          <span className="text-gray-400">{printTypeList.length}</span>
                        </button>
                        {printTypeList.map(([type, count]) => (
                          <button
                            key={type}
                            onClick={() => { printAllTaskSheets(filtered.filter(t => t.type === type), hkDocs, 'none'); setPrintMenuOpen(false); }}
                            className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                          >
                            <span className="flex-1 truncate">{type}</span>
                            <span className="text-gray-400">{count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Priority — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'priority' ? null : 'priority')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <Flag className="w-4 h-4 text-gray-400" />
                      <span className="flex-1 font-medium">By Priority</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${printSubmenu === 'priority' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'priority' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        <button
                          onClick={() => { printAllTaskSheets(filtered, hkDocs, 'priority'); setPrintMenuOpen(false); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">All priorities (grouped)</span>
                          <span className="text-gray-400">{printPriorityList.length}</span>
                        </button>
                        {printPriorityList.map(([pri, count]) => (
                          <button
                            key={pri}
                            onClick={() => { printAllTaskSheets(filtered.filter(t => t.priority === pri), hkDocs, 'none'); setPrintMenuOpen(false); }}
                            className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                          >
                            <span className="flex-1 truncate">{pri}</span>
                            <span className="text-gray-400">{count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'status' ? null : 'status')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <ClipboardList className="w-4 h-4 text-gray-400" />
                      <span className="flex-1 font-medium">By Status</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${printSubmenu === 'status' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'status' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        <button
                          onClick={() => { printAllTaskSheets(filtered, hkDocs, 'status'); setPrintMenuOpen(false); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">All statuses (grouped)</span>
                          <span className="text-gray-400">{printStatusList.length}</span>
                        </button>
                        {printStatusList.map(([status, count]) => (
                          <button
                            key={status}
                            onClick={() => { printAllTaskSheets(filtered.filter(t => t.status === status), hkDocs, 'none'); setPrintMenuOpen(false); }}
                            className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                          >
                            <span className="flex-1 truncate">{status}</span>
                            <span className="text-gray-400">{count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setShowForm(true)} className={button.primary}><Plus className="w-4 h-4" /> New Task</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Automatic" value={counts.Automatic} icon={Zap} tone="accent" />
        <StatCard title="Manual" value={counts.Manual} icon={ClipboardList} tone="warning" />
        <StatCard title="Pending" value={counts.Pending} icon={Clock} tone="neutral" />
        <StatCard title="In Progress" value={counts.InProgress} icon={PlayCircle} tone="info" />
        <StatCard title="Completed" value={counts.Completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Verified" value={counts.Verified} icon={Sparkles} tone="accent" />
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
              <div key={row.id} className="flex items-center gap-2 flex-wrap">
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
                {AUTOMATIC_TYPES.includes(row.type) && row.type !== 'Public Area Cleaning' && (
                  <select value={row.serviceType ?? ''} onChange={e => updateRow(row.id, { serviceType: (e.target.value || undefined) as ServiceType })} className="px-3 py-2 text-xs border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none w-36">
                    <option value="">Service…</option>
                    {ALL_SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {AUTOMATIC_TYPES.includes(row.type) && row.type !== 'Public Area Cleaning' && (
                  <input placeholder="Floor" value={row.floor ?? ''} onChange={e => updateRow(row.id, { floor: e.target.value })} className="px-3 py-2 text-xs border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none w-20" />
                )}
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
            {(['All', 'Automatic', 'Manual'] as const).map(f => {
              const count = f === 'All' ? tasks.length : f === 'Automatic' ? counts.Automatic : counts.Manual;
              return (
                <button key={f} onClick={() => setCategoryFilter(f)} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${categoryFilter === f ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {f}
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${categoryFilter === f ? 'bg-[var(--color-accent-operations)]/15 text-[var(--color-accent-operations)]' : 'bg-slate-200 dark:bg-slate-700 text-gray-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'All' | TaskType)} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none cursor-pointer">
              <option value="All">All Types</option>
              <optgroup label="Automatic">
                {AUTOMATIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
              <optgroup label="Manual">
                {MANUAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            </select>
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
        <>
          {/* Task list — full-width grid of cards */}
          {filtered.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-12 rounded-2xl text-center">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-gray-500">No tasks match the filters.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl card-shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                      <th className="text-left px-4 py-3 w-10"></th>
                      <th className="text-left px-4 py-3">Task</th>
                      <th className="text-left px-4 py-3 hidden md:table-cell">Assigned To</th>
                      <th className="text-left px-4 py-3">Priority</th>
                      <th className="text-left px-4 py-3 hidden lg:table-cell">Due</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3 w-32">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {filtered.map(t => {
                      const Icon = TYPE_ICON[t.type];
                      const items = getChecklistForType(hkDocs, t.type);
                      const p = computeProgress(t, items);
                      const busy = actingOn === t.id;
                      const due = dueDateDisplay(t.dueDate);
                      return (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedId(t.id)}
                          className={`cursor-pointer smooth-transition border-l-4 ${PRIORITY_BORDER[t.priority]} ${
                            selected?.id === t.id ? 'bg-[var(--color-accent-operations)]/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
                          } ${busy ? 'animate-pulse' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className={`p-1.5 rounded-lg ${t.category === 'Automatic' ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-gray-900 dark:text-white truncate">{t.type}</div>
                            <div className="text-xs text-gray-500 truncate">{t.location}</div>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-300 truncate max-w-[140px]">{t.assignedTo || 'Unassigned'}</td>
                          <td className="px-4 py-3"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <span className={`flex items-center gap-1 text-xs ${due.overdue ? 'text-[var(--color-danger)] font-bold' : due.dueSoon ? 'text-[var(--color-warning)] font-semibold' : 'text-gray-500'}`}>
                              <Clock className="w-3 h-3 shrink-0" />
                              {due.overdue ? 'Overdue · ' : due.dueSoon ? 'Soon · ' : ''}{due.label}
                            </span>
                          </td>
                          <td className="px-4 py-3"><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden min-w-[40px]">
                                <div className={`h-full transition-all duration-500 ${p === 100 ? 'bg-emerald-500' : 'bg-[var(--color-accent-operations)]'}`} style={{ width: `${p}%` }} />
                              </div>
                              <span className={`text-xs font-bold tabular-nums shrink-0 ${p === 100 ? 'text-emerald-500' : 'text-[var(--color-accent-operations)]'}`}>{p}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Task detail modal */}
      <ModalSystem
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.type ?? ''}
        subtitle={selected ? `${shortId(selected.id)} · ${selected.location}${selected.floor ? ` · Floor ${selected.floor}` : ''}${selected.serviceType ? ` · ${selected.serviceType}` : ''}` : ''}
        variant="form"
        size="xl"
        showFooter={false}
      >
        {selected && (
          <div className="space-y-5">
            {/* Status + timestamps row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[selected.status]}>{selected.status}</Badge>
                <Badge tone={PRIORITY_TONE[selected.priority]}>{selected.priority}</Badge>
                <Badge tone={selected.category === 'Automatic' ? 'accent' : 'warning'}>{selected.category}</Badge>
              </div>
              {(selected.startedAt || selected.completedAt) && (
                <div className="flex items-center gap-3 text-xs">
                  {selected.startedAt && <span className="flex items-center gap-1 text-gray-500"><Clock className="w-3.5 h-3.5" /> Started {fmtTime(selected.startedAt)}</span>}
                  {selected.completedAt && <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 className="w-3.5 h-3.5" /> Done {fmtTime(selected.completedAt)}</span>}
                </div>
              )}
            </div>

            {/* Metadata + assignment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Assigned To">
                <select
                  value={selected.attendantId ?? ''}
                  onChange={e => reassignAttendant(selected.id, e.target.value || null)}
                  className={inputClass + ' cursor-pointer'}
                >
                  <option value="">Unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.status}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={selected.priority}
                  onChange={e => updateTaskField(selected.id, { priority: e.target.value as Priority })}
                  className={inputClass + ' cursor-pointer'}
                >
                  {(['Low', 'Medium', 'High', 'Critical'] as Priority[]).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              {selected.type !== 'Public Area Cleaning' && (
                <Field label="Service Type">
                  <select
                    value={selected.serviceType ?? ''}
                    onChange={e => updateTaskField(selected.id, { serviceType: (e.target.value || undefined) as ServiceType })}
                    className={inputClass + ' cursor-pointer'}
                  >
                    <option value="">Not specified</option>
                    {ALL_SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              )}
              {selected.type === 'Public Area Cleaning' && (
                <Field label="Frequency">
                  <input
                    placeholder="e.g. Hourly, Daily, 4x Daily"
                    value={selected.frequency ?? ''}
                    onChange={e => updateTaskField(selected.id, { frequency: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              )}
              <Field label="Due Date & Time">
                <input
                  type="datetime-local"
                  value={toDatetimeLocal(selected.dueDate)}
                  onChange={e => updateTaskField(selected.id, { dueDate: fromDatetimeLocal(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              {selected.type === 'Public Area Cleaning' && selected.lastCleaned && (
                <Field label="Last Cleaned">
                  <input
                    value={selected.lastCleaned}
                    readOnly
                    className={inputClass + ' bg-slate-50 dark:bg-slate-900/40 cursor-default'}
                  />
                </Field>
              )}
            </div>

            {/* Notes editor */}
            <Field label="Notes">
              <textarea
                value={selected.notes ?? ''}
                onChange={e => updateTaskField(selected.id, { notes: e.target.value })}
                rows={2}
                placeholder="Add notes (e.g. 'VIP arrival at 2 PM', 'Guest requested extra towels')…"
                className={inputClass + ' resize-none'}
              />
            </Field>

            {/* Interactive checklist + progress bar */}
            {selectedChecklistItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Checklist</p>
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-300 tabular-nums">
                    {selectedChecklistItems.filter(item => selected.checklist?.[item]).length} / {selectedChecklistItems.length}
                  </span>
                </div>
                {/* Visual progress bar */}
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-4">
                  <div
                    className={`h-full transition-all duration-500 ${computeProgress(selected, selectedChecklistItems) === 100 ? 'bg-emerald-500' : 'bg-[var(--color-accent-operations)]'}`}
                    style={{ width: `${computeProgress(selected, selectedChecklistItems)}%` }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {selectedChecklistItems.map(item => {
                    const done = selected.checklist?.[item] ?? false;
                    return (
                      <button
                        key={item}
                        onClick={() => toggleStep(selected.id, item)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          done ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg ${done ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-gray-400'}`}>
                          {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-current" />}
                        </div>
                        <span className={`text-sm font-medium flex-1 ${done ? 'text-emerald-700 dark:text-emerald-400 line-through' : 'text-gray-700 dark:text-gray-300'}`}>{item}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action bar */}
            <div className="pt-4 border-t border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => printTaskSheet(selected, hkDocs)} title="Print task sheet with checklist" className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition flex items-center gap-1">
                  <Printer className="w-3 h-3" /> Print
                </button>
                <button onClick={() => { setDeleteTarget(selected); setSelectedId(null); }} disabled={actingOn === selected.id} title="Delete task" className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                {selected.status === 'Pending' && (
                  <button onClick={() => startTask(selected.id)} disabled={actingOn === selected.id} className={button.primary + ' disabled:opacity-50'}>
                    {actingOn === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} Start
                  </button>
                )}
                {selected.status === 'In Progress' && selectedChecklistItems.length > 0 && (
                  <button onClick={() => markAllComplete(selected.id)} disabled={actingOn === selected.id} className={button.primary + ' bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50'}>
                    {actingOn === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Mark All Complete
                  </button>
                )}
                {selected.status === 'In Progress' && selectedChecklistItems.length === 0 && (
                  <button onClick={() => advance(selected.id)} disabled={actingOn === selected.id} className={button.primary + ' text-xs px-3 py-1.5 disabled:opacity-50'}>
                    Complete
                  </button>
                )}
                {selected.status === 'Completed' && (
                  <button onClick={() => advance(selected.id)} disabled={actingOn === selected.id} className={button.primary + ' text-xs px-3 py-1.5 disabled:opacity-50'}>
                    {actingOn === selected.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Verify
                  </button>
                )}
                {selected.status === 'Verified' && (
                  <Badge tone="success" icon={Sparkles}>Verified</Badge>
                )}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirmation */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteTask(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title="Delete Task"
        subtitle={`${deleteTarget?.type} · ${deleteTarget?.location}`}
        variant="confirm"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmColor="rose"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          This will permanently remove the task and its checklist progress. This action cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
}
