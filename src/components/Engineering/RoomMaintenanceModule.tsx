/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest Room Maintenance — Engineering Portal
 * (/erp/maintenance/rooms).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/room-issues
 * (eng_room_issues table) and /api/eng-portal/rooms (rooms table).
 * UI aligned with WorkOrderManagement / BuildingMaintenance — PageHeader,
 * SectionCard, StatCard, Badge, brandTheme tokens, list rows, detail/create
 * modal, loading/error/retry. Multi-property scoping via useERP(). ERP
 * notifications on create/update/delete.
 *
 * Issue lifecycle: Open → In Progress → Resolved.
 * `blocksRoom` takes the room out of inventory (rooms.status → 'Out of Order'
 * server-side); resolving restores the room to 'Vacant Clean', syncing with
 * Front Office & Housekeeping.
 *
 * Room status actions (Mark Out of Order / Out of Service / Return to
 * Inventory) call /api/eng-portal/rooms/:id/status, which writes the
 * canonical rooms.status column shared by the rest of the ERP.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Home, Search, ArrowRight, Loader2, ServerCrash, MoreVertical,
  Eye, Trash2, X, AlertTriangle, ShieldAlert, CheckCircle2, Clock,
  Plus, Droplets, Thermometer, Zap, Lock, Tv, Wifi, Wrench, Lightbulb, Sofa,
  LayoutGrid, ToggleRight, ArrowRightLeft, ExternalLink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchRoomIssues, createRoomIssue, updateRoomIssue, deleteRoomIssue,
  convertRoomIssueToWO,
  fetchEngRooms, updateEngRoomStatus,
  type RoomIssue, type RoomIssueCategory, type RoomIssueStatus, type RoomIssuePriority,
  type EngRoom,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
const CATEGORY_OPTIONS: RoomIssueCategory[] = [
  'Plumbing', 'HVAC', 'Electrical', 'Security', 'Furniture',
  'Lock', 'TV', 'Internet', 'Lighting', 'Other',
];

const STATUS_OPTIONS: RoomIssueStatus[] = ['Open', 'In Progress', 'Resolved'];
const PRIORITY_OPTIONS: RoomIssuePriority[] = ['Emergency', 'High', 'Normal', 'Low'];

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  'Plumbing': Droplets,
  'HVAC': Thermometer,
  'Electrical': Zap,
  'Security': Lock,
  'Furniture': Sofa,
  'Lock': Lock,
  'TV': Tv,
  'Internet': Wifi,
  'Lighting': Lightbulb,
  'Other': Wrench,
};

const STATUS_TONE: Record<RoomIssueStatus, StatusTone> = {
  'Open': 'danger',
  'In Progress': 'warning',
  'Resolved': 'success',
};

const PRIORITY_TONE: Record<RoomIssuePriority, StatusTone> = {
  Emergency: 'danger',
  High: 'warning',
  Normal: 'info',
  Low: 'neutral',
};

const ASSIGNEE_OPTIONS = [
  'Plumbing Team',
  'HVAC Team',
  'Electrical Team',
  'General Maintenance Team',
  'Locksmith',
  'AV / IT Team',
  'External Contractor',
] as const;

// Canonical room statuses (migration 225) — used for the room status action panel.
const ROOM_STATUS_OPTIONS = [
  'Vacant Clean', 'Vacant Dirty', 'Occupied Clean', 'Occupied Dirty',
  'Out of Order', 'Out of Service', 'Maintenance', 'House Use', 'Blocked',
] as const;

// ── Sub-tab definitions ──────────────────────────────────────────────────
type SubTab = 'board' | 'issues' | 'actions';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'board',   label: 'Status Board',   icon: LayoutGrid },
  { id: 'issues',  label: 'Room Issues',    icon: AlertTriangle },
  { id: 'actions', label: 'Status Actions', icon: ToggleRight },
];

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

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function elapsed(s: string | null): string {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  if (isNaN(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

// ── Component ────────────────────────────────────────────────────────────
const RoomMaintenanceModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [issues, setIssues] = useState<RoomIssue[]>([]);
  const [rooms, setRooms] = useState<EngRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | RoomIssueStatus>('All');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('board');

  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<{
    roomNumber: string;
    category: RoomIssueCategory;
    description: string;
    priority: RoomIssuePriority;
    blocksRoom: boolean;
    reportedBy: string;
    assignedTo: string;
    notes: string;
  }>({
    roomNumber: '',
    category: 'Plumbing',
    description: '',
    priority: 'Normal',
    blocksRoom: false,
    reportedBy: '',
    assignedTo: '',
    notes: '',
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailIssue = issues.find(i => i.id === detailId) || null;

  const [convertId, setConvertId] = useState<string | null>(null);
  const convertIssue = issues.find(i => i.id === convertId) || null;
  const [convertForm, setConvertForm] = useState({ assignedTo: '', scheduledDate: '', notes: '' });
  const [converting, setConverting] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [issueData, roomData] = await Promise.all([
        fetchRoomIssues({ propertyId: currentPropertyId || undefined }),
        fetchEngRooms({ propertyId: currentPropertyId || undefined }),
      ]);
      setIssues(issueData);
      setRooms(roomData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load room maintenance data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived lists ─────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      issues.filter(i => {
        const matchesStatus = statusFilter === 'All' || i.status === statusFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (i.ri_number || '').toLowerCase().includes(q) ||
          (i.room_number || '').toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q) ||
          (i.category || '').toLowerCase().includes(q) ||
          (i.assigned_to || '').toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
      }),
    [issues, statusFilter, search]
  );

  const counts = {
    open: issues.filter(i => i.status === 'Open').length,
    inProgress: issues.filter(i => i.status === 'In Progress').length,
    resolved: issues.filter(i => i.status === 'Resolved').length,
    blocking: issues.filter(i => i.blocks_room && i.status !== 'Resolved').length,
  };

  const roomCounts = {
    total: rooms.length,
    outOfOrder: rooms.filter(r => r.status === 'Out of Order').length,
    withIssues: rooms.filter(r => r.activeIssueCount > 0).length,
    available: rooms.filter(r => r.status === 'Vacant Clean' && !r.hasBlockingIssue).length,
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.roomNumber.trim() || !form.description.trim()) return;
    setSubmitting(true);
    try {
      await createRoomIssue({
        roomNumber: form.roomNumber.trim(),
        category: form.category,
        description: form.description.trim(),
        priority: form.priority,
        blocksRoom: form.blocksRoom,
        reportedBy: form.reportedBy.trim() || undefined,
        assignedTo: form.assignedTo || undefined,
        notes: form.notes.trim() || undefined,
        propertyId: currentPropertyId || undefined,
      });
      addNotification(`Room issue for ${form.roomNumber.trim()} created.`, 'task', 'Maintenance');
      setShowCreate(false);
      setForm({
        roomNumber: '', category: 'Plumbing', description: '', priority: 'Normal',
        blocksRoom: false, reportedBy: '', assignedTo: '', notes: '',
      });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create room issue', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (id: string, status: RoomIssueStatus) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const { issue } = await updateRoomIssue(id, { status });
      setIssues(prev => prev.map(i => (i.id === id ? issue : i)));
      // Room status may have changed server-side (block/restore) — refresh rooms.
      fetchEngRooms({ propertyId: currentPropertyId || undefined })
        .then(setRooms)
        .catch(() => {});
      addNotification(`Room issue → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to update status to ${status}`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeIssue = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteRoomIssue(id);
      setIssues(prev => prev.filter(i => i.id !== id));
      addNotification(`Room issue deleted.`, 'task', 'Maintenance');
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete issue', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const submitConvert = async () => {
    if (!convertIssue) return;
    setConverting(true);
    try {
      const { issue, workOrder } = await convertRoomIssueToWO(convertIssue.id, {
        assignedTo: convertForm.assignedTo || undefined,
        scheduledDate: convertForm.scheduledDate || undefined,
        notes: convertForm.notes || undefined,
      });
      setIssues(prev => prev.map(i => (i.id === convertIssue.id ? issue : i)));
      addNotification(
        `Room issue converted to work order ${workOrder.wo_number}.`,
        'task', 'Maintenance',
      );
      setConvertId(null);
      setConvertForm({ assignedTo: '', scheduledDate: '', notes: '' });
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to convert to work order', 'warning', 'Maintenance');
    } finally {
      setConverting(false);
    }
  };

  const saveDetail = async (patch: any) => {
    if (!detailIssue) return;
    setActingOn(detailIssue.id);
    try {
      const { issue } = await updateRoomIssue(detailIssue.id, patch);
      setIssues(prev => prev.map(i => (i.id === detailIssue.id ? issue : i)));
      addNotification(`Room issue "${detailIssue.ri_number}" updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update issue', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const changeRoomStatus = async (roomNumber: string, status: string) => {
    setActingOn(`room-${roomNumber}`);
    try {
      await updateEngRoomStatus(roomNumber, status);
      setRooms(prev => prev.map(r => (r.number === roomNumber ? { ...r, status } : r)));
      addNotification(`Room ${roomNumber} → ${status}.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to set room ${roomNumber} status`, 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const statusFilters: ('All' | RoomIssueStatus)[] = ['All', ...STATUS_OPTIONS];

  // Status transition actions per current status
  const NEXT_ACTIONS: Record<RoomIssueStatus, RoomIssueStatus[]> = {
    'Open': ['In Progress', 'Resolved'],
    'In Progress': ['Resolved', 'Open'],
    'Resolved': ['Open'],
  };
  const ACTION_LABELS: Record<RoomIssueStatus, string> = {
    'Open': 'Re-open',
    'In Progress': 'Start Work',
    'Resolved': 'Mark Resolved',
  };

  // Issues grouped by room for the room grid
  const issuesByRoom = useMemo(() => {
    const map: Record<string, RoomIssue[]> = {};
    issues.forEach(i => {
      if (i.status === 'Resolved') return;
      if (!map[i.room_number]) map[i.room_number] = [];
      map[i.room_number].push(i);
    });
    return map;
  }, [issues]);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Guest Room Maintenance"
        subtitle="Room-specific fault tracking and room status management."
        icon={Home}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowCreate(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Issue
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Open Issues" value={counts.open} icon={AlertTriangle} tone="danger" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Wrench} tone="warning" />
        <StatCard title="Resolved" value={counts.resolved} icon={CheckCircle2} tone="success" />
        <StatCard title="Rooms Blocked" value={counts.blocking} icon={ShieldAlert} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => {
          const activeCount = t.id === 'issues' ? counts.open + counts.inProgress : t.id === 'actions' ? roomCounts.outOfOrder + counts.blocking : 0;
          return (
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
              {activeCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-info)]/15 text-[var(--color-info)]">{activeCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══ Status Board sub-tab ════════════════════════════════════════ */}
      {subTab === 'board' && (
        <SectionCard
          title="Room Status Board"
          subtitle={`${roomCounts.total} rooms · ${roomCounts.outOfOrder} out of order · ${roomCounts.withIssues} with active issues`}
          icon={Home}
          pad="md"
        >
          {loading && (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading rooms…
            </div>
          )}

          {!loading && rooms.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              No rooms found. Rooms are managed in the Front Office / Property configuration.
            </div>
          )}

          {!loading && rooms.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {rooms.map((room) => {
                const ooo = room.status === 'Out of Order';
                const oos = room.status === 'Out of Service';
                const maintenance = room.status === 'Maintenance';
                const roomIssues = issuesByRoom[room.number] || [];
                const hasIssue = roomIssues.length > 0;
                const blocking = room.hasBlockingIssue;

                const toneStyles = statusTone[
                  (ooo || blocking ? 'danger' : oos || maintenance ? 'warning' : hasIssue ? 'warning' : 'neutral') as StatusTone
                ];

                return (
                  <div
                    key={room.id}
                    className={`p-3 rounded-2xl border transition-all relative ${toneStyles.soft} ${toneStyles.border}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-mono font-black text-gray-700 dark:text-gray-200">#{room.number}</span>
                      {(ooo || blocking) && <ShieldAlert size={12} className="text-rose-500 animate-pulse" />}
                      {(oos || maintenance) && <Wrench size={12} className="text-amber-500" />}
                      {hasIssue && !ooo && !blocking && !oos && !maintenance && <AlertTriangle size={12} className="text-amber-500" />}
                    </div>
                    <span className={`text-[8px] font-black uppercase tracking-tight block ${toneStyles.text}`}>
                      {room.status}
                    </span>

                    {hasIssue && (
                      <div className="mt-2 pt-2 border-t border-gray-200/50 dark:border-slate-700/50 space-y-1">
                        {roomIssues.slice(0, 2).map(i => (
                          <span key={i.id} className="text-[9px] font-bold text-gray-700 dark:text-gray-300 block truncate">
                            {i.category}: {i.description}
                          </span>
                        ))}
                        {roomIssues.length > 2 && (
                          <span className="text-[9px] font-bold text-gray-400">+{roomIssues.length - 2} more</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* ══ Room Issues sub-tab ═════════════════════════════════════════ */}
      {subTab === 'issues' && (
        <>
          {/* Filters section */}
          <SectionCard
            title="Room Issues"
            subtitle="Fault tracking by room, category, and status"
            icon={AlertTriangle}
            pad="md"
          >
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
                  placeholder="Search room, number, description…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                />
              </div>
            </div>
          </SectionCard>

          {/* Issue list */}
          <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
            {loading && (
              <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading issues…
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                {issues.length === 0 ? 'No room issues reported yet.' : 'No issues match the filters.'}
              </div>
            )}

            {!loading && !error && filtered.map(i => {
              const tone = STATUS_TONE[i.status] ?? 'neutral';
              const priorityTone = PRIORITY_TONE[i.priority] ?? 'neutral';
              const CatIcon = CATEGORY_ICON[i.category] ?? Wrench;
              const isMenuOpen = menuOpen === i.id;
              const actions = NEXT_ACTIONS[i.status] || [];

              return (
                <div key={i.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  {/* Identity */}
                  <div className="flex items-center gap-3 md:w-64 shrink-0">
                    <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                      <CatIcon className={`w-4 h-4 ${statusTone[tone].text}`} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">Room {i.room_number}</h4>
                      <p className="text-xs text-gray-500 font-mono truncate">
                        {i.ri_number} · {i.category}
                      </p>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200 line-clamp-2">{i.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
                      {i.assigned_to && (
                        <span className="inline-flex items-center gap-1">
                          <Wrench className="w-3.5 h-3.5" /> {i.assigned_to}
                        </span>
                      )}
                      {i.reported_by && (
                        <>
                          <span>·</span>
                          <span>Reported by {i.reported_by}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {elapsed(i.created_at)} elapsed
                      </span>
                      {i.blocks_room && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold">
                            <ShieldAlert className="w-3.5 h-3.5" /> Blocks room
                          </span>
                        </>
                      )}
                      {i.converted_work_order_id && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-[var(--color-accent-operations)] font-bold">
                            <ArrowRightLeft className="w-3.5 h-3.5" /> WO linked
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status + priority */}
                  <div className="md:w-48 shrink-0">
                    <div className="flex items-center justify-between text-xs">
                      <Badge tone={tone}>{i.status}</Badge>
                      <Badge tone={priorityTone} variant="solid">{i.priority}</Badge>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="md:w-36 shrink-0 flex justify-end items-center gap-1.5">
                    <button
                      onClick={() => setDetailId(i.id)}
                      className={button.ghost}
                      title="View details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {actions.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setMenuOpen(isMenuOpen ? null : i.id)}
                          disabled={actingOn === i.id}
                          className={button.ghost + ' disabled:opacity-50'}
                        >
                          {actingOn === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                        </button>
                        {isMenuOpen && (
                          <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                            {actions.map(a => (
                              <button
                                key={a}
                                onClick={() => changeStatus(i.id, a)}
                                className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                              >
                                {ACTION_LABELS[a]}
                              </button>
                            ))}
                            {!i.converted_work_order_id && (
                              <button
                                onClick={() => { setConvertId(i.id); setMenuOpen(null); }}
                                className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--color-accent-operations)] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition border-t border-gray-100 dark:border-slate-700"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5 inline mr-1" /> Convert to Work Order
                              </button>
                            )}
                            <button
                              onClick={() => removeIssue(i.id)}
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
        </>
      )}

      {/* ══ Status Actions sub-tab ══════════════════════════════════════ */}
      {subTab === 'actions' && (
        <SectionCard
          title="Room Status Actions"
          subtitle="Set room inventory status — syncs with Front Office & Housekeeping"
          icon={ShieldAlert}
          pad="md"
        >
          {rooms.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">No rooms available.</div>
          ) : (
            <div className="space-y-2">
              {rooms
                .filter(r => r.status === 'Out of Order' || r.status === 'Out of Service' || r.status === 'Maintenance' || r.hasBlockingIssue)
                .slice(0, 8)
                .map(room => (
                  <div key={room.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-bold text-gray-900 dark:text-white">#{room.number}</span>
                      <Badge tone={
                        room.status === 'Out of Order' ? 'danger' :
                        room.status === 'Out of Service' || room.status === 'Maintenance' ? 'warning' : 'neutral'
                      }>
                        {room.status}
                      </Badge>
                      {room.hasBlockingIssue && (
                        <span className="text-xs text-rose-600 dark:text-rose-400 font-bold">Blocking issue active</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={room.status}
                        onChange={e => changeRoomStatus(room.number, e.target.value)}
                        disabled={actingOn === `room-${room.number}`}
                        className={inputClass + ' w-40 disabled:opacity-50'}
                      >
                        {ROOM_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {actingOn === `room-${room.number}` && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    </div>
                  </div>
                ))}
              {rooms.filter(r => r.status === 'Out of Order' || r.status === 'Out of Service' || r.status === 'Maintenance' || r.hasBlockingIssue).length === 0 && (
                <div className="p-4 text-center text-sm text-gray-500">
                  All rooms are in normal inventory status. No actions required.
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Create modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showCreate}
        onClose={() => (submitting ? undefined : setShowCreate(false))}
        title="New Room Issue"
        subtitle="Report a room-specific maintenance fault."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Issue'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreate}
        showFooter
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Room Number">
              <input
                value={form.roomNumber}
                onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))}
                placeholder="e.g. 101"
                list="eng-room-numbers"
                className={inputClass}
              />
              <datalist id="eng-room-numbers">
                {rooms.map(r => <option key={r.id} value={r.number} />)}
              </datalist>
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as RoomIssueCategory }))}
                className={inputClass}
              >
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as RoomIssuePriority }))}
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
            <Field label="Reported By (optional)">
              <input
                value={form.reportedBy}
                onChange={e => setForm(f => ({ ...f, reportedBy: e.target.value }))}
                placeholder="e.g. Front Desk"
                className={inputClass}
              />
            </Field>
            <Field label="Blocks Room?">
              <label className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  checked={form.blocksRoom}
                  onChange={e => setForm(f => ({ ...f, blocksRoom: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  Takes room out of inventory (sets status to Out of Order)
                </span>
              </label>
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the fault…"
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
        title={detailIssue ? `Room ${detailIssue.room_number}` : 'Room Issue'}
        subtitle={detailIssue?.ri_number}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailIssue && (
          <div className="space-y-5">
            {/* Status + priority + category */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detailIssue.status]}>{detailIssue.status}</Badge>
              <Badge tone={PRIORITY_TONE[detailIssue.priority]} variant="solid">{detailIssue.priority}</Badge>
              <Badge tone="info">{detailIssue.category}</Badge>
              {detailIssue.blocks_room && (
                <Badge tone="danger" variant="solid" icon={ShieldAlert}>Blocks Room</Badge>
              )}
              {detailIssue.converted_work_order_id && (
                <Badge tone="accent" variant="solid" icon={ArrowRightLeft}>
                  WO {detailIssue.converted_work_order_id.slice(-10)}
                </Badge>
              )}
            </div>

            {/* Description */}
            {detailIssue.description && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-sm text-gray-700 dark:text-gray-200">{detailIssue.description}</p>
              </div>
            )}

            {/* Notes */}
            {detailIssue.notes && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 whitespace-pre-wrap">{detailIssue.notes}</p>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Room</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailIssue.room_number}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Reported By</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailIssue.reported_by || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Assigned To</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{detailIssue.assigned_to || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Resolved At</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDateTime(detailIssue.resolved_at)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Created</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDateTime(detailIssue.created_at)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Updated</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDateTime(detailIssue.updated_at)}</p>
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Status">
                <select
                  value={detailIssue.status}
                  onChange={e => saveDetail({ status: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailIssue.id}
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={detailIssue.priority}
                  onChange={e => saveDetail({ priority: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailIssue.id}
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Category">
                <select
                  value={detailIssue.category}
                  onChange={e => saveDetail({ category: e.target.value })}
                  className={inputClass}
                  disabled={actingOn === detailIssue.id}
                >
                  {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Assigned To">
                <select
                  value={detailIssue.assigned_to || ''}
                  onChange={e => saveDetail({ assignedTo: e.target.value || null })}
                  className={inputClass}
                  disabled={actingOn === detailIssue.id}
                >
                  <option value="">— Unassigned —</option>
                  {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Blocks Room?">
                  <label className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      checked={detailIssue.blocks_room}
                      onChange={e => saveDetail({ blocksRoom: e.target.checked })}
                      disabled={actingOn === detailIssue.id}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                      Takes room out of inventory (sets status to Out of Order)
                    </span>
                  </label>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea
                    defaultValue={detailIssue.notes || ''}
                    onBlur={e => saveDetail({ notes: e.target.value })}
                    rows={2}
                    className={inputClass}
                    disabled={actingOn === detailIssue.id}
                  />
                </Field>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              {(NEXT_ACTIONS[detailIssue.status] || []).map(a => (
                <button
                  key={a}
                  onClick={() => { changeStatus(detailIssue.id, a); setDetailId(null); }}
                  disabled={actingOn === detailIssue.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  {ACTION_LABELS[a]}
                </button>
              ))}
              {!detailIssue.converted_work_order_id && (
                <button
                  onClick={() => { setConvertId(detailIssue.id); }}
                  disabled={actingOn === detailIssue.id}
                  className={button.secondary + ' disabled:opacity-50'}
                >
                  <ArrowRightLeft className="w-4 h-4 inline mr-1" /> Convert to Work Order
                </button>
              )}
              <button
                onClick={() => { removeIssue(detailIssue.id); }}
                disabled={actingOn === detailIssue.id}
                className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto disabled:opacity-50'}
              >
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Convert to Work Order modal ──────────────────────────────── */}
      <ModalSystem
        isOpen={!!convertId}
        onClose={() => (converting ? undefined : setConvertId(null))}
        title="Convert to Work Order"
        subtitle={convertIssue ? `Room ${convertIssue.room_number} · ${convertIssue.ri_number}` : ''}
        variant="form"
        size="md"
        loading={converting}
        confirmLabel={converting ? 'Converting…' : 'Convert'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitConvert}
        showFooter
      >
        {convertIssue && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl text-sm">
              <p className="font-bold text-gray-900 dark:text-white">{convertIssue.description}</p>
              <p className="text-xs text-gray-500 mt-1">
                {convertIssue.category} · {convertIssue.priority} priority · Room {convertIssue.room_number}
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Creates a new work order in the Work Order Management console
              (<span className="font-mono">/erp/maintenance/workorders</span>) and links it back to this room issue.
              The issue status advances to <strong>In Progress</strong>.
            </p>
            <Field label="Assigned To (optional)">
              <select
                value={convertForm.assignedTo}
                onChange={e => setConvertForm(f => ({ ...f, assignedTo: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Use issue assignee —</option>
                {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Scheduled Date (optional)">
              <input
                type="date"
                value={convertForm.scheduledDate}
                onChange={e => setConvertForm(f => ({ ...f, scheduledDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Notes (optional)">
              <textarea
                value={convertForm.notes}
                onChange={e => setConvertForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Additional notes for the work order…"
                rows={2}
                className={inputClass}
              />
            </Field>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default RoomMaintenanceModule;
