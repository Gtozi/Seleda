/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supervisor Console module — docs/Housekeeping Portal new.md §11.
 * Live Room Monitor, Reassign Tasks, Priority Override, Inspection Approval,
 * Escalations, Staff Performance, Shift Summary.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/supervisor/*.
 * Integrates with: Attendance, Shift Requirements, Staffing Requirements,
 * Training, Lost & Found, Room Extras, Priority Queue, Productivity,
 * Guest Requests modules (read-only oversight views).
 */

import { useCallback, useEffect, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import {
  Monitor,
  ClipboardCheck,
  AlertTriangle,
  Gauge,
  ClipboardList,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  Loader2,
  ServerCrash,
  RefreshCw,
  CalendarCheck,
  CalendarDays,
  Users,
  GraduationCap,
  PackageSearch,
  DoorClosed,
  ListOrdered,
  Activity,
  ConciergeBell,
  LayoutDashboard,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

// ── Types ──────────────────────────────────────────────────────────────

type EscalationLevel = 'Low' | 'Medium' | 'High' | 'Critical';
// Matches housekeeping_task_mgmt.priority domain (see TaskManagementModule's
// TaskPriority). Previously typed as 'Normal' | 'High' | 'Critical', which
// didn't match the actual data or the backend's validation set.
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
const PRIORITY_LEVELS: Priority[] = ['Low', 'Medium', 'High', 'Critical'];

interface LiveRoom {
  taskId: string;
  room: string;
  floor: number | string;
  status: string;
  attendant?: string;
  priority: Priority;
  eta: string;
}

interface Escalation {
  id: string;
  room: string;
  issue: string;
  level: EscalationLevel;
  raisedAt: string;
}

interface Approval {
  id: string;
  room: string;
  inspector: string;
  score: number;
  status: 'Pending Approval';
}

interface StaffPerf {
  id: string;
  name: string;
  role?: string;
  rooms: number;
  score: number;
  trend: string;
}

interface ShiftSummary {
  roomsCompleted: number;
  roomsInspected: number;
  failedInspections: number;
  avgCleanTime: string;
  guestRequests: number;
  escalations: number;
}

interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  status: string;
  shift: string;
  checkIn: string | null;
  checkOut: string | null;
  hoursWorked: number;
  overtimeHours: number;
}

interface AttendanceData {
  today: AttendanceRecord[];
  present: number;
  absent: number;
  onLeave: number;
  total: number;
}

interface ShiftGap {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  assigned: number;
  required: number;
  gap: number;
}

interface StaffingGap {
  id: string;
  floor: number | null;
  zone: string | null;
  role: string;
  required: number;
  assigned: number;
  gap: number;
  shift: string;
}

interface TrainingAlert {
  id: string;
  course: string;
  staffId: string;
  dueDate: string;
  status: string;
}

interface LostFoundItem {
  id: string;
  itemName: string;
  category: string;
  status: string;
  roomNumber: string;
  foundDate: string;
  storageLocation: string;
  followUpRequired: boolean;
}

interface RoomExtra {
  id: string;
  roomNumber: string;
  dnd: boolean;
  hkStatus: string;
  lastCleaned: string;
  lastInspected: string;
  housekeeperId: string;
}

interface RoomExtrasData {
  all: RoomExtra[];
  dndCount: number;
  dndRooms: RoomExtra[];
}

interface PriorityQueueItem {
  id: string;
  roomNumber: string;
  createdAt: string;
}

interface ProductivityRecord {
  id: string;
  employeeId: string;
  staffId: string;
  roomsCleaned: number;
  hours: number;
  inspectionScore: number;
  productivityScore: number;
  periodDate: string;
}

interface GuestRequest {
  id: string;
  requestNumber: string;
  roomNumber: string;
  guestName: string;
  requestType: string;
  priority: string;
  status: string;
  assignedTo: string;
  submittedAt: string;
}

interface ConsoleData {
  propertyId: string;
  liveRooms: LiveRoom[];
  escalations: Escalation[];
  approvals: Approval[];
  staffPerf: StaffPerf[];
  shiftSummary: ShiftSummary;
  attendance: AttendanceData;
  shiftGaps: ShiftGap[];
  staffingGaps: StaffingGap[];
  trainingAlerts: TrainingAlert[];
  lostFound: LostFoundItem[];
  roomExtras: RoomExtrasData;
  priorityQueue: PriorityQueueItem[];
  productivity: ProductivityRecord[];
  guestRequests: GuestRequest[];
  generatedAt: string;
}

// ── Sub-tab definitions ────────────────────────────────────────────────

type SubTab = 'overview' | 'operations' | 'staff' | 'compliance';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'operations', label: 'Operations', icon: Monitor },
  { id: 'staff', label: 'Staff & Workforce', icon: Users },
  { id: 'compliance', label: 'Compliance', icon: GraduationCap },
];

// ── Tone maps ──────────────────────────────────────────────────────────

const PRIORITY_TONE: Record<Priority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

// Left-border accent per priority — gives Live Room Monitor rows an instant
// visual rank, mirroring the pattern used in TaskManagementModule.
const PRIORITY_BORDER: Record<Priority, string> = {
  Critical: 'border-l-4 border-l-[var(--color-danger)]',
  High: 'border-l-4 border-l-[var(--color-warning)]',
  Medium: 'border-l-4 border-l-[var(--color-info)]',
  Low: 'border-l-4 border-l-transparent',
};

const LEVEL_TONE: Record<EscalationLevel, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

const ATT_STATUS_TONE: Record<string, StatusTone> = {
  Present: 'success', Late: 'warning', Absent: 'danger',
  'On Leave': 'info', Sick: 'neutral', 'Half Day': 'info',
  'Day Off': 'neutral', 'Public Holiday': 'accent',
  'Work From Home': 'info', Mission: 'warning', 'Training Day': 'info',
};

const TRAIN_TONE: Record<string, StatusTone> = {
  'Not Started': 'info',
  'In Progress': 'warning',
  Completed: 'success',
  Overdue: 'danger',
};

function statusToTone(status: string): StatusTone {
  const s = (status || '').toLowerCase();
  if (['pending', 'acknowledged', 'in progress', 'not started', 'stored', 'found', 'sleep-out', 'dirty'].includes(s)) return 'warning';
  if (['completed', 'verified', 'pass', 'passed', 'inspected', 'clean', 'present', 'resolved', 'active'].includes(s)) return 'success';
  if (['fail', 'failed', 'absent', 'overdue', 'cancelled', 'rejected', 'critical', 'open'].includes(s)) return 'danger';
  if (['on leave', 'sick', 'late', 'half day', 'dnd', 'do not disturb'].includes(s)) return 'warning';
  if (['info', 'mission', 'training day', 'work from home', 'day off', 'public holiday'].includes(s)) return 'info';
  return 'neutral';
}

// ── Helpers ────────────────────────────────────────────────────────────

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// Progress bar — color based on percentage.
function ProgressBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: StatusTone }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const barColor: Record<StatusTone, string> = {
    success: 'bg-[var(--color-success)]',
    warning: 'bg-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger)]',
    info: 'bg-[var(--color-info)]',
    neutral: 'bg-gray-400',
    accent: 'bg-[var(--color-accent-operations)]',
  };
  return (
    <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${barColor[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Count badge for section headers.
function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: StatusTone }) {
  const toneMap: Record<StatusTone, string> = {
    success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
    warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
    info: 'bg-[var(--color-info)]/10 text-[var(--color-info)]',
    neutral: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300',
    accent: 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]',
  };
  return (
    <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-full text-xs font-bold ${toneMap[tone]}`}>
      {count}
    </span>
  );
}

// Empty state with icon.
function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 gap-2">
      <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600">
        <Icon className="w-7 h-7" />
      </div>
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 text-center">{message}</p>
    </div>
  );
}

// Section divider label.
function SectionLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
      <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</h3>
      <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
    </div>
  );
}

// Avatar with gradient.
const AVATAR_GRADIENT = 'bg-gradient-to-br from-[var(--color-accent-operations)] to-[var(--color-accent-finance)]';

// ── Component ──────────────────────────────────────────────────────────

export default function SupervisorConsoleModule() {
  const { currentPropertyId, addNotification } = useERP();
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [escalationModalOpen, setEscalationModalOpen] = useState(false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  const fetchConsole = useCallback(async (silent = false) => {
    if (!currentPropertyId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/supervisor/console/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load supervisor console (${res.status})`);
      const json = (await res.json()) as ConsoleData;
      setData(json);
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Failed to load supervisor console');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchConsole(); }, [fetchConsole]);

  // Auto-refresh every 30s while the console is open — keeps the "real-time
  // oversight" promise honest without requiring a manual click. Silent mode
  // avoids flashing the full-page loading state on each tick.
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => fetchConsole(true), 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchConsole]);

  // ── Actions ──────────────────────────────────────────────────────────

  const overridePriority = async (room: LiveRoom, newPriority: Priority) => {
    if (newPriority === room.priority) return;
    setActionLoading(`priority-${room.taskId}`);
    try {
      const res = await fetch(`/api/hk-portal/supervisor/tasks/${room.taskId}/priority`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ priority: newPriority }),
      });
      if (!res.ok) throw new Error('Failed to override priority');
      addNotification(`Room ${room.room} priority set to ${newPriority}`, 'warning', 'Housekeeping');
      setData(prev => prev ? { ...prev, liveRooms: prev.liveRooms.map(r => r.taskId === room.taskId ? { ...r, priority: newPriority } : r) } : prev);
    } catch (e: any) { addNotification(e?.message || 'Failed to override priority', 'danger', 'Housekeeping'); }
    finally { setActionLoading(null); }
  };

  const reassign = async (room: LiveRoom, assignedTo: string) => {
    if (!assignedTo || assignedTo === room.attendant) return;
    setActionLoading(`reassign-${room.taskId}`);
    try {
      const res = await fetch(`/api/hk-portal/supervisor/tasks/${room.taskId}/reassign`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ assignedTo }),
      });
      if (!res.ok) throw new Error('Failed to reassign task');
      addNotification(`Room ${room.room} reassigned to ${assignedTo}`, 'info', 'Housekeeping');
      setData(prev => prev ? { ...prev, liveRooms: prev.liveRooms.map(r => r.taskId === room.taskId ? { ...r, attendant: assignedTo } : r) } : prev);
    } catch (e: any) { addNotification(e?.message || 'Failed to reassign task', 'danger', 'Housekeeping'); }
    finally { setActionLoading(null); }
  };

  const resolveEscalation = async (id: string) => {
    setActionLoading(`resolve-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/supervisor/escalations/${id}/resolve`, { method: 'PUT', headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to resolve escalation');
      addNotification(`Escalation ${id} resolved`, 'success', 'Housekeeping');
      setData(prev => prev ? { ...prev, escalations: prev.escalations.filter(e => e.id !== id), shiftSummary: { ...prev.shiftSummary, escalations: prev.shiftSummary.escalations - 1 } } : prev);
    } catch (e: any) { addNotification(e?.message || 'Failed to resolve escalation', 'danger', 'Housekeeping'); }
    finally { setActionLoading(null); }
  };

  const createEscalation = async (form: { room: string; issue: string; level: EscalationLevel }) => {
    if (!currentPropertyId) return;
    setActionLoading('create-escalation');
    try {
      const res = await fetch('/api/hk-portal/supervisor/escalations', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, room: form.room, issue: form.issue, level: form.level }),
      });
      if (!res.ok) throw new Error('Failed to create escalation');
      const created = await res.json();
      addNotification(`Escalation raised${form.room ? ` for Room ${form.room}` : ''}`, 'warning', 'Housekeeping');
      setData(prev => prev ? {
        ...prev,
        escalations: [created, ...prev.escalations],
        shiftSummary: { ...prev.shiftSummary, escalations: prev.shiftSummary.escalations + 1 },
      } : prev);
      setEscalationModalOpen(false);
    } catch (e: any) { addNotification(e?.message || 'Failed to create escalation', 'danger', 'Housekeeping'); }
    finally { setActionLoading(null); }
  };

  const handleApprove = async (id: string, room: string) => {
    setActionLoading(`approve-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/supervisor/inspections/${id}/approve`, { method: 'PUT', headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to approve inspection');
      addNotification(`Inspection approved for Room ${room}`, 'success', 'Housekeeping');
      setData(prev => prev ? { ...prev, approvals: prev.approvals.filter(a => a.id !== id) } : prev);
    } catch (e: any) { addNotification(e?.message || 'Failed to approve inspection', 'danger', 'Housekeeping'); }
    finally { setActionLoading(null); }
  };

  const handleReject = async (id: string, room: string) => {
    setActionLoading(`reject-${id}`);
    try {
      const res = await fetch(`/api/hk-portal/supervisor/inspections/${id}/reject`, { method: 'PUT', headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to reject inspection');
      addNotification(`Inspection rejected for Room ${room}`, 'danger', 'Housekeeping');
      setData(prev => prev ? { ...prev, approvals: prev.approvals.filter(a => a.id !== id) } : prev);
    } catch (e: any) { addNotification(e?.message || 'Failed to reject inspection', 'danger', 'Housekeeping'); }
    finally { setActionLoading(null); }
  };

  // ── Loading / Error states ───────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Supervisor Console" subtitle="Real-time oversight, approvals & escalations." icon={Monitor} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-[var(--color-accent-operations)]" size={32} />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Loading console…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Supervisor Console" subtitle="Real-time oversight, approvals & escalations." icon={Monitor} />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ServerCrash className="text-rose-500" size={32} />
          <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">{error}</p>
          <button onClick={fetchConsole} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      </div>
    );
  }

  // ── Data extraction ──────────────────────────────────────────────────

  const liveRooms = data?.liveRooms || [];
  const escalations = data?.escalations || [];
  const approvals = data?.approvals || [];
  const staffPerf = data?.staffPerf || [];
  const shiftSummary = data?.shiftSummary || { roomsCompleted: 0, roomsInspected: 0, failedInspections: 0, avgCleanTime: 'N/A', guestRequests: 0, escalations: 0 };
  const attendance = data?.attendance || { today: [], present: 0, absent: 0, onLeave: 0, total: 0 };
  const shiftGaps = data?.shiftGaps || [];
  const staffingGaps = data?.staffingGaps || [];
  const trainingAlerts = data?.trainingAlerts || [];
  const lostFound = data?.lostFound || [];
  const roomExtras = data?.roomExtras || { all: [], dndCount: 0, dndRooms: [] };
  const priorityQueue = data?.priorityQueue || [];
  const productivity = data?.productivity || [];
  const guestRequests = data?.guestRequests || [];

  const attentionRooms = roomExtras.all.filter(r => r.dnd || r.hkStatus === 'Sleep-Out' || r.hkStatus === 'Dirty');
  const totalShiftGap = shiftGaps.reduce((sum, s) => sum + Math.max(0, s.gap), 0);

  const d = density; // alias for brevity in class strings
  const sectionGap = d === 'compact' ? 'space-y-4' : 'space-y-6';
  // cardPad was used by the old card-row layout; tables use their own
  // padding classes so it is no longer needed.
  // listRowPad/listText were used by the old card-row layout; tables use
  // their own padding classes so these are no longer needed.

  return (
    <div className={`w-full max-w-none ${sectionGap}`}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <PageHeader
        title="Supervisor Console"
        subtitle="Real-time oversight, approvals & escalations."
        icon={Monitor}
        actions={
          <div className="flex items-center gap-3">
            {data?.generatedAt && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-medium">
                <span className="relative flex h-2 w-2">
                  {autoRefresh && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${autoRefresh ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                </span>
                Updated {formatDateTime(data.generatedAt)}
              </span>
            )}
            <button
              onClick={() => setAutoRefresh(v => !v)}
              title={autoRefresh ? 'Auto-refresh on (every 30s) — click to pause' : 'Auto-refresh paused — click to resume'}
              className={`hidden sm:inline-flex text-xs font-semibold px-2.5 py-1.5 rounded-lg transition ${
                autoRefresh
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              Auto {autoRefresh ? 'On' : 'Off'}
            </button>
            <button
              onClick={() => setDensity(d => d === 'comfortable' ? 'compact' : 'comfortable')}
              title={d === 'comfortable' ? 'Switch to compact density' : 'Switch to comfortable density'}
              className={`hidden sm:inline-flex text-xs font-semibold px-2.5 py-1.5 rounded-lg transition ${
                d === 'compact'
                  ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {d === 'comfortable' ? 'Comfort' : 'Compact'}
            </button>
            <button onClick={() => fetchConsole()} disabled={loading} className={button.secondary + ' flex items-center gap-1.5'}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {/* ── Sub-tab navigation ─────────────────────────────────────────── */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
            {t.id === 'overview' && escalations.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-danger)]/15 text-[var(--color-danger)]">{escalations.length}</span>
            )}
            {t.id === 'operations' && approvals.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-info)]/15 text-[var(--color-info)]">{approvals.length}</span>
            )}
            {t.id === 'staff' && staffingGaps.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-danger)]/15 text-[var(--color-danger)]">{staffingGaps.length}</span>
            )}
            {t.id === 'compliance' && trainingAlerts.filter(t => t.status === 'Overdue').length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-warning)]/15 text-[var(--color-warning)]">{trainingAlerts.filter(t => t.status === 'Overdue').length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ── OVERVIEW TAB ───────────────────────────────────────────────── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {subTab === 'overview' && (
        <>
          {/* Shift Summary KPIs */}
          <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 ${d === 'compact' ? 'lg:gap-2' : ''}`}>
            <StatCard title="Rooms Completed" value={shiftSummary.roomsCompleted} icon={CheckCircle2} tone="success" caption="This shift" />
            <StatCard title="Rooms Inspected" value={shiftSummary.roomsInspected} icon={ClipboardCheck} tone="info" caption="Total" />
            <StatCard title="Failed Inspections" value={shiftSummary.failedInspections} icon={XCircle} tone="danger" caption="Needs rework" />
            <StatCard title="Avg Clean Time" value={shiftSummary.avgCleanTime} icon={Clock} tone="neutral" caption="Per room" />
            <StatCard title="Guest Requests" value={shiftSummary.guestRequests} icon={ClipboardList} tone="warning" caption="Active" />
            <StatCard title="Escalations" value={shiftSummary.escalations} icon={AlertTriangle} tone="danger" caption="Open" />
          </div>

          {/* Operations Summary KPIs */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 ${d === 'compact' ? 'lg:gap-2' : ''}`}>
            <StatCard title="Present Today" value={attendance.present} icon={CalendarCheck} tone="success" />
            <StatCard title="Absent" value={attendance.absent} icon={XCircle} tone="danger" />
            <StatCard title="On Leave / Sick" value={attendance.onLeave} icon={Clock} tone="warning" />
            <StatCard title="Staffing Gaps" value={staffingGaps.length} icon={Users} tone={staffingGaps.length > 0 ? 'danger' : 'success'} />
            <StatCard title="DND Rooms" value={roomExtras.dndCount} icon={DoorClosed} tone={roomExtras.dndCount > 0 ? 'warning' : 'success'} />
            <StatCard title="Priority Queue" value={priorityQueue.length} icon={ListOrdered} tone={priorityQueue.length > 0 ? 'warning' : 'success'} />
            <StatCard title="Lost & Found" value={lostFound.length} icon={PackageSearch} tone="info" />
            <StatCard title="Guest Requests" value={guestRequests.length} icon={ConciergeBell} tone={guestRequests.length > 0 ? 'warning' : 'success'} />
          </div>

          <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${d === 'compact' ? 'lg:gap-4' : ''}`}>
            {/* Live Room Monitor */}
            <div className="lg:col-span-7">
              <SectionCard
                title="Live Room Monitor"
                subtitle="Active room tasks — real-time"
                icon={Monitor}
                tone="accent"
                pad="none"
                actions={<CountBadge count={liveRooms.length} tone="accent" />}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                        <th className="text-left px-4 py-3">Room</th>
                        <th className="text-left px-4 py-3 hidden sm:table-cell">Floor</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3 hidden md:table-cell">ETA</th>
                        <th className="text-left px-4 py-3">Attendant</th>
                        <th className="text-left px-4 py-3">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {liveRooms.map(r => {
                        const busy = actionLoading === `reassign-${r.taskId}` || actionLoading === `priority-${r.taskId}`;
                        return (
                        <tr key={r.taskId} className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${PRIORITY_BORDER[r.priority]} ${busy ? 'animate-pulse' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] shrink-0">
                                <Eye className="w-3.5 h-3.5" />
                              </div>
                              <span className="font-bold text-gray-900 dark:text-white">Room {r.room}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 font-mono">{r.floor}</td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200 font-semibold">{r.status}</td>
                          <td className="px-4 py-3 hidden md:table-cell text-gray-500 font-mono">{r.eta}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={r.attendant || ''}
                                onChange={e => reassign(r, e.target.value)}
                                disabled={busy}
                                title="Reassign attendant"
                                className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg pl-2 pr-6 py-1.5 outline-none cursor-pointer disabled:opacity-50 max-w-[140px]"
                              >
                                {!r.attendant && <option value="">Unassigned</option>}
                                {staffPerf.map(s => (
                                  <option key={s.id} value={s.name}>{s.name}</option>
                                ))}
                              </select>
                              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={r.priority}
                              onChange={e => overridePriority(r, e.target.value as Priority)}
                              disabled={busy}
                              title="Override priority"
                              className={`text-xs font-bold rounded-lg pl-2 pr-6 py-1.5 outline-none cursor-pointer disabled:opacity-50 ${
                                r.priority === 'Critical' ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                                : r.priority === 'High' ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                                : r.priority === 'Medium' ? 'bg-[var(--color-info)]/10 text-[var(--color-info)]'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {PRIORITY_LEVELS.map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {liveRooms.length === 0 && <EmptyState icon={Monitor} message="No active room tasks." />}
              </SectionCard>
            </div>

            {/* Escalations */}
            <div className="lg:col-span-5">
              <SectionCard
                title="Escalations"
                subtitle="Open issues requiring attention"
                icon={AlertTriangle}
                tone="danger"
                pad="none"
                actions={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEscalationModalOpen(true)}
                      title="Raise a new escalation"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white text-xs font-bold transition"
                    >
                      <Plus className="w-3.5 h-3.5" /> New
                    </button>
                    <CountBadge count={escalations.length} tone="danger" />
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                        <th className="text-left px-4 py-3">Level</th>
                        <th className="text-left px-4 py-3">Room</th>
                        <th className="text-left px-4 py-3">Issue</th>
                        <th className="text-left px-4 py-3 hidden md:table-cell">Raised</th>
                        <th className="text-right px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {escalations.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-3"><Badge tone={LEVEL_TONE[e.level]} variant="solid">{e.level}</Badge></td>
                          <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{e.room ? `Room ${e.room}` : '—'}</td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-200 font-semibold">{e.issue}</td>
                          <td className="px-4 py-3 hidden md:table-cell text-slate-400 font-mono text-xs">{formatDateTime(e.raisedAt)}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => resolveEscalation(e.id)}
                              disabled={actionLoading === `resolve-${e.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent-operations)] text-white text-xs font-semibold hover:bg-[var(--color-accent-operations-hover)] transition disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {actionLoading === `resolve-${e.id}` ? 'Resolving…' : 'Resolve'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {escalations.length === 0 && <EmptyState icon={CheckCircle2} message="No active escalations." />}
              </SectionCard>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ── OPERATIONS TAB ─────────────────────────────────────────────── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {subTab === 'operations' && (
        <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${d === 'compact' ? 'lg:gap-4' : ''}`}>
          {/* Inspection Approval */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Inspection Approval"
            subtitle="Pending quality approvals"
            icon={ClipboardCheck}
            tone="info"
            pad="none"
            actions={<CountBadge count={approvals.length} tone="info" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Room</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Inspector</th>
                    <th className="text-left px-4 py-3">Score</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {approvals.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--color-info)]/10 text-[var(--color-info)] shrink-0">
                            <ClipboardCheck className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white">Room {a.room}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 font-mono text-xs">{a.inspector || '—'}</td>
                      <td className="px-4 py-3"><span className="font-bold tabular-nums">{a.score}%</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleApprove(a.id, a.room)}
                            disabled={actionLoading === `approve-${a.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-success)]/10 text-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-white text-xs font-bold uppercase transition disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => handleReject(a.id, a.room)}
                            disabled={actionLoading === `reject-${a.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white text-xs font-bold uppercase transition disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {approvals.length === 0 && <EmptyState icon={CheckCircle2} message="No pending approvals." />}
          </SectionCard>
        </div>

        {/* Priority Queue */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Priority Queue"
            subtitle="Rooms flagged for immediate attention"
            icon={ListOrdered}
            tone="danger"
            pad="none"
            actions={<CountBadge count={priorityQueue.length} tone="danger" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Room</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Queued</th>
                    <th className="text-right px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {priorityQueue.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
                            <ListOrdered className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white">Room {p.roomNumber}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-400 font-mono text-xs">{formatDateTime(p.createdAt)}</td>
                      <td className="px-4 py-3 text-right"><Badge tone="danger" variant="solid">Priority</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {priorityQueue.length === 0 && <EmptyState icon={ListOrdered} message="Priority queue empty." />}
          </SectionCard>
        </div>

        {/* Room Status & DND */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Room Status & DND"
            subtitle="Do-not-disturb and dirty rooms"
            icon={DoorClosed}
            tone="warning"
            pad="none"
            actions={<CountBadge count={attentionRooms.length} tone="warning" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Room</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Cleaned</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Inspected</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Housekeeper</th>
                    <th className="text-right px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {attentionRooms.slice(0, 15).map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${r.dnd ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]' : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'}`}>
                            <DoorClosed className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white">Room {r.roomNumber}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-400 font-mono text-xs">{r.lastCleaned || '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-400 font-mono text-xs">{r.lastInspected || '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-gray-600 dark:text-gray-300 text-xs">{r.housekeeperId || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          {r.dnd && <Badge tone="danger" variant="solid">DND</Badge>}
                          <Badge tone={statusToTone(r.hkStatus)} variant="soft">{r.hkStatus}</Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attentionRooms.length === 0 && <EmptyState icon={DoorClosed} message="No DND or dirty rooms." />}
          </SectionCard>
        </div>

        {/* Guest Requests */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Guest Requests"
            subtitle="HK-department requests in progress"
            icon={ConciergeBell}
            tone="warning"
            pad="none"
            actions={<CountBadge count={guestRequests.length} tone="warning" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Request</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Guest / Room</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Assigned To</th>
                    <th className="text-left px-4 py-3">Priority</th>
                    <th className="text-right px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {guestRequests.map(g => (
                    <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--color-warning)]/10 text-[var(--color-warning)] shrink-0">
                            <ConciergeBell className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white truncate">{g.requestNumber || g.requestType || 'Request'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 text-xs truncate max-w-[140px]">{g.guestName || '—'}{g.roomNumber ? ` · Room ${g.roomNumber}` : ''}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-300 text-xs">{g.requestType || '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-gray-600 dark:text-gray-300 text-xs truncate max-w-[120px]">{g.assignedTo || '—'}</td>
                      <td className="px-4 py-3"><Badge tone={PRIORITY_TONE[(g.priority as Priority)] || 'neutral'} variant="solid">{g.priority}</Badge></td>
                      <td className="px-4 py-3 text-right"><Badge tone={statusToTone(g.status)} variant="soft">{g.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {guestRequests.length === 0 && <EmptyState icon={ConciergeBell} message="No active guest requests." />}
          </SectionCard>
        </div>

        {/* Lost & Found */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Lost & Found"
            subtitle="Unclaimed items in storage"
            icon={PackageSearch}
            tone="info"
            pad="none"
            actions={<CountBadge count={lostFound.length} tone="info" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Item</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Category</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Room</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Found</th>
                    <th className="text-left px-4 py-3 hidden xl:table-cell">Storage</th>
                    <th className="text-right px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {lostFound.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--color-info)]/10 text-[var(--color-info)] shrink-0">
                            <PackageSearch className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white truncate">{l.itemName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 text-xs">{l.category || 'Unknown'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-300 text-xs">{l.roomNumber || '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-slate-400 font-mono text-xs">{l.foundDate || '—'}</td>
                      <td className="px-4 py-3 hidden xl:table-cell text-gray-600 dark:text-gray-300 text-xs">{l.storageLocation || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          {l.followUpRequired && <Badge tone="warning" variant="solid">Follow-up</Badge>}
                          <Badge tone="info" variant="soft">{l.status}</Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lostFound.length === 0 && <EmptyState icon={PackageSearch} message="No unclaimed items." />}
          </SectionCard>
        </div>
      </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ── STAFF & WORKFORCE TAB ──────────────────────────────────────── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {subTab === 'staff' && (
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${d === 'compact' ? 'lg:gap-4' : ''}`}>
        {/* Attendance Today */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Attendance Today"
            subtitle={`${attendance.present} present · ${attendance.absent} absent · ${attendance.onLeave} on leave`}
            icon={CalendarCheck}
            tone="success"
            pad="none"
            actions={<CountBadge count={attendance.total} tone="success" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Staff</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Shift</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Check In</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Check Out</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Hours</th>
                    <th className="text-right px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {attendance.today.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-full ${AVATAR_GRADIENT} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
                            {initials(a.staffName)}
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white truncate">{a.staffName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 text-xs font-mono">{a.shift}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs font-mono">{formatTime(a.checkIn)}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs font-mono">{formatTime(a.checkOut)}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{a.hoursWorked > 0 ? `${a.hoursWorked.toFixed(1)}h` : '—'}</span>
                        {a.overtimeHours > 0 && <span className="text-amber-500 font-semibold ml-1">+{a.overtimeHours.toFixed(1)}h OT</span>}
                      </td>
                      <td className="px-4 py-3 text-right"><Badge tone={ATT_STATUS_TONE[a.status] || 'neutral'} variant="solid">{a.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attendance.today.length === 0 && <EmptyState icon={CalendarCheck} message="No attendance records for today." />}
          </SectionCard>
        </div>

        {/* Staff Performance */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Staff Performance"
            subtitle="Top performers this shift"
            icon={Gauge}
            tone="accent"
            pad="none"
            actions={<CountBadge count={staffPerf.length} tone="accent" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Staff</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Rooms</th>
                    <th className="text-left px-4 py-3">Score</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell w-40">Progress</th>
                    <th className="text-right px-4 py-3">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {staffPerf.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-full ${AVATAR_GRADIENT} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
                            {initials(s.name)}
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white truncate">{s.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 tabular-nums">{s.rooms}</td>
                      <td className="px-4 py-3"><span className="font-bold tabular-nums">{s.score}%</span></td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <ProgressBar value={s.score} max={100} tone={s.score >= 90 ? 'success' : s.score >= 75 ? 'warning' : 'danger'} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`flex items-center gap-1 text-xs font-bold justify-end ${s.trend.startsWith('+') ? 'text-[var(--color-success)]' : s.trend.startsWith('-') ? 'text-[var(--color-danger)]' : 'text-slate-400'}`}>
                          <TrendingUp className="w-3.5 h-3.5" /> {s.trend}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {staffPerf.length === 0 && <EmptyState icon={Gauge} message="No staff data." />}
          </SectionCard>
        </div>

        {/* Shift Staffing */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Shift Staffing"
            subtitle={totalShiftGap > 0 ? `${totalShiftGap} staff short across shifts` : 'All shifts fully covered'}
            icon={CalendarDays}
            tone="info"
            pad="none"
            actions={<CountBadge count={shiftGaps.length} tone="info" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Shift</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Time</th>
                    <th className="text-left px-4 py-3">Assigned / Required</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell w-40">Coverage</th>
                    <th className="text-right px-4 py-3">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {shiftGaps.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{s.name}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-500 font-mono text-xs">{s.startTime} – {s.endTime}</td>
                      <td className="px-4 py-3"><span className="font-bold text-gray-700 dark:text-gray-200 tabular-nums">{s.assigned}/{s.required}</span></td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <ProgressBar value={s.assigned} max={s.required} tone={s.gap > 0 ? 'danger' : 'success'} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.gap > 0 ? <Badge tone="danger" variant="solid">−{s.gap} short</Badge>
                          : s.gap < 0 ? <Badge tone="success" variant="solid">+{Math.abs(s.gap)} over</Badge>
                          : <Badge tone="success" variant="solid">OK</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shiftGaps.length === 0 && <EmptyState icon={CalendarDays} message="No shift requirements configured." />}
          </SectionCard>
        </div>

        {/* Staffing Gaps */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Staffing Gaps"
            subtitle="Understaffed floors & zones"
            icon={Users}
            tone="danger"
            pad="none"
            actions={<CountBadge count={staffingGaps.length} tone="danger" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Role</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Floor / Zone</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Shift</th>
                    <th className="text-left px-4 py-3">Assigned / Required</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell w-40">Coverage</th>
                    <th className="text-right px-4 py-3">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {staffingGaps.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] shrink-0">
                            <Users className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white">{s.role}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 text-xs">{s.floor != null ? `Floor ${s.floor}` : s.zone || '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-300 text-xs">{s.shift}</td>
                      <td className="px-4 py-3"><span className="font-bold text-gray-700 dark:text-gray-200 tabular-nums">{s.assigned}/{s.required}</span></td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <ProgressBar value={s.assigned} max={s.required} tone="danger" />
                      </td>
                      <td className="px-4 py-3 text-right"><Badge tone="danger" variant="solid">−{s.gap} needed</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {staffingGaps.length === 0 && <EmptyState icon={CheckCircle2} message="All floors fully staffed." />}
          </SectionCard>
        </div>
      </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ── COMPLIANCE & TRAINING TAB ──────────────────────────────────── */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {subTab === 'compliance' && (
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 ${d === 'compact' ? 'lg:gap-4' : ''}`}>
        {/* Training Alerts */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Training Alerts"
            subtitle="Overdue & incomplete training"
            icon={GraduationCap}
            tone="warning"
            pad="none"
            actions={<CountBadge count={trainingAlerts.length} tone="warning" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Course</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Staff</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Due Date</th>
                    <th className="text-right px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {trainingAlerts.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--color-warning)]/10 text-[var(--color-warning)] shrink-0">
                            <GraduationCap className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white truncate">{t.course}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 text-xs">{t.staffId || 'Unassigned'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-400 font-mono text-xs">{t.dueDate || 'N/A'}</td>
                      <td className="px-4 py-3 text-right"><Badge tone={TRAIN_TONE[t.status] || 'neutral'} variant="solid">{t.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {trainingAlerts.length === 0 && <EmptyState icon={GraduationCap} message="No pending training." />}
          </SectionCard>
        </div>

        {/* Staff Productivity */}
        <div className="lg:col-span-6">
          <SectionCard
            title="Staff Productivity"
            subtitle="Latest period metrics"
            icon={Activity}
            tone="success"
            pad="none"
            actions={<CountBadge count={productivity.length} tone="success" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Staff</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Rooms</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Hours</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Period</th>
                    <th className="text-left px-4 py-3">Inspection</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell w-32">Progress</th>
                    <th className="text-right px-4 py-3">Productivity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {productivity.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-full ${AVATAR_GRADIENT} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
                            {initials(p.employeeId || p.staffId || '??')}
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white">{p.employeeId || p.staffId || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 tabular-nums">{p.roomsCleaned}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300 tabular-nums">{p.hours.toFixed(1)}h</td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-400 font-mono text-xs">{p.periodDate || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${p.inspectionScore >= 90 ? 'text-[var(--color-success)]' : p.inspectionScore >= 75 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}`}>{p.inspectionScore}%</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <ProgressBar value={p.inspectionScore} max={100} tone={p.inspectionScore >= 90 ? 'success' : p.inspectionScore >= 75 ? 'warning' : 'danger'} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-bold ${p.productivityScore >= 90 ? 'text-[var(--color-success)]' : p.productivityScore >= 75 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}`}>{p.productivityScore.toFixed(1)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {productivity.length === 0 && <EmptyState icon={Activity} message="No productivity records." />}
          </SectionCard>
        </div>
      </div>
      )}

      <EscalationModal
        open={escalationModalOpen}
        onClose={() => setEscalationModalOpen(false)}
        onSubmit={createEscalation}
        submitting={actionLoading === 'create-escalation'}
      />
    </div>
  );
}

// ── New Escalation modal ─────────────────────────────────────────────────
// Backs the "New" button on the Escalations panel — POSTs to
// /api/hk-portal/supervisor/escalations. Previously there was no UI path to
// create an escalation even though the backend supported it.
function EscalationModal({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { room: string; issue: string; level: EscalationLevel }) => Promise<void>;
  submitting: boolean;
}) {
  const [room, setRoom] = useState('');
  const [issue, setIssue] = useState('');
  const [level, setLevel] = useState<EscalationLevel>('Medium');

  useEffect(() => {
    if (open) { setRoom(''); setIssue(''); setLevel('Medium'); }
  }, [open]);

  if (!open) return null;

  const canSubmit = issue.trim().length > 0 && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-black text-gray-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--color-danger)]" /> New Escalation
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Room (optional)</label>
            <input
              type="text"
              value={room}
              onChange={e => setRoom(e.target.value)}
              placeholder="e.g. 502"
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Issue</label>
            <textarea
              value={issue}
              onChange={e => setIssue(e.target.value)}
              placeholder="Describe the issue requiring supervisor attention…"
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Severity</label>
            <div className="grid grid-cols-4 gap-2">
              {(['Low', 'Medium', 'High', 'Critical'] as EscalationLevel[]).map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-bold transition ${
                    level === l
                      ? l === 'Critical' ? 'bg-[var(--color-danger)] text-white'
                      : l === 'High' ? 'bg-[var(--color-warning)] text-white'
                      : l === 'Medium' ? 'bg-[var(--color-info)] text-white'
                      : 'bg-slate-500 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className={button.secondary}>Cancel</button>
          <button
            onClick={() => onSubmit({ room: room.trim(), issue: issue.trim(), level })}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--color-danger)] text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {submitting ? 'Raising…' : 'Raise Escalation'}
          </button>
        </div>
      </div>
    </div>
  );
}
