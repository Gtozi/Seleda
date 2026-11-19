/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Room Status module — docs/Housekeeping Portal new.md §5.
 *
 * DB-integrated: fetches the live room matrix from
 *   GET  /api/hk-portal/rooms-board/:propertyId
 * and persists every control through the housekeeping portal API:
 *   PUT  /api/hk-portal/rooms-board/room-status   (change status / clean / inspect / clear DND)
 *   POST /api/hk-portal/rooms-board/assign         (assign housekeeper)
 *   POST /api/hk-portal/rooms-board/priority       (priority queue toggle)
 *   POST /api/hk-portal/rooms-board/maintenance    (dispatch maintenance)
 *
 * Renders the full set of room conditions (11) and the per-room controls:
 * Change Status, Lock Room, Release Room, Mark Cleaning Started,
 * Mark Cleaning Completed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BedDouble,
  Lock,
  Unlock,
  PlayCircle,
  CheckCircle2,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  Star,
  UserCircle2,
  Wrench,
  Ban,
  DoorOpen,
  Loader2,
  ServerCrash,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type RoomCondition =
  | 'Vacant Clean'
  | 'Vacant Dirty'
  | 'Occupied Clean'
  | 'Occupied Dirty'
  | 'Inspected'
  | 'Ready'
  | 'Pickup'
  | 'Sleep-Out'
  | 'Do Not Disturb'
  | 'Out of Order'
  | 'Out of Service';

interface BoardRoom {
  id: string;
  number: string;
  type: string;
  floor: number;
  rate: number | string;
  status: string;
  canonicalStatus: string;
  dnd: boolean;
  lastCleaned: string | null;
  lastInspected: string | null;
  housekeeperId: string | null;
  arrival: string | null;
  departure: string | null;
}

interface BoardStaff {
  id: string;
  name: string;
  avatar: string;
  status: string;
  solvedToday: number;
  qualityScore: number;
  assignedRooms: string[];
}

interface RoomsBoardResponse {
  propertyId: string;
  rooms: BoardRoom[];
  staff: BoardStaff[];
  priorityQueue: string[];
  generatedAt: string;
}

const CONDITION_TONE: Record<RoomCondition, StatusTone> = {
  'Vacant Clean': 'success',
  'Vacant Dirty': 'warning',
  'Occupied Clean': 'info',
  'Occupied Dirty': 'danger',
  Inspected: 'info',
  Ready: 'success',
  Pickup: 'info',
  'Sleep-Out': 'neutral',
  'Do Not Disturb': 'danger',
  'Out of Order': 'neutral',
  'Out of Service': 'warning',
};

const CONDITION_CODE: Record<RoomCondition, string> = {
  'Vacant Clean': 'VC',
  'Vacant Dirty': 'VD',
  'Occupied Clean': 'OC',
  'Occupied Dirty': 'OD',
  Inspected: 'IN',
  Ready: 'RD',
  Pickup: 'PK',
  'Sleep-Out': 'SO',
  'Do Not Disturb': 'DND',
  'Out of Order': 'OOO',
  'Out of Service': 'OOS',
};

const ALL_CONDITIONS = Object.keys(CONDITION_CODE) as RoomCondition[];

// Conditions that represent a "locked" / unavailable room (§5 Lock Room).
const LOCKED_CONDITIONS: ReadonlySet<RoomCondition> = new Set(['Out of Order', 'Out of Service']);

function isRoomCondition(value: string): value is RoomCondition {
  return Object.prototype.hasOwnProperty.call(CONDITION_CODE, value);
}

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export default function RoomBoardModule() {
  const { currentPropertyId, addNotification } = useERP();

  const [rooms, setRooms] = useState<BoardRoom[]>([]);
  const [staff, setStaff] = useState<BoardStaff[]>([]);
  const [priorityQueue, setPriorityQueue] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [conditionFilter, setConditionFilter] = useState<'All' | RoomCondition>('All');
  const [floorFilter, setFloorFilter] = useState<'All' | number>('All');
  const [search, setSearch] = useState('');

  const fetchBoard = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/rooms-board/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load room board (${res.status})`);
      const data = (await res.json()) as RoomsBoardResponse;
      setRooms(data.rooms || []);
      setStaff(data.staff || []);
      setPriorityQueue(data.priorityQueue || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load room board');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const staffById = useMemo(() => {
    const map: Record<string, BoardStaff> = {};
    staff.forEach(s => (map[s.id] = s));
    return map;
  }, [staff]);

  const floors = useMemo(() => [...new Set(rooms.map(r => r.floor))].sort((a, b) => a - b), [rooms]);

  const counts = useMemo(() => {
    const map = {} as Record<RoomCondition, number>;
    ALL_CONDITIONS.forEach(c => (map[c] = 0));
    rooms.forEach(r => {
      if (isRoomCondition(r.status)) map[r.status] += 1;
    });
    return map;
  }, [rooms]);

  const filtered = useMemo(
    () =>
      rooms.filter(r => {
        const matchesCond = conditionFilter === 'All' || r.status === conditionFilter;
        const matchesFloor = floorFilter === 'All' || r.floor === floorFilter;
        const matchesSearch =
          r.number.toLowerCase().includes(search.toLowerCase()) ||
          r.type.toLowerCase().includes(search.toLowerCase()) ||
          (staffById[r.housekeeperId ?? '']?.name.toLowerCase().includes(search.toLowerCase()) ?? false);
        return matchesCond && matchesFloor && matchesSearch;
      }),
    [rooms, conditionFilter, floorFilter, search, staffById]
  );

  // ── Mutations ───────────────────────────────────────────────────────────
  const patchRoom = (number: string, patch: Partial<BoardRoom>) =>
    setRooms(prev => prev.map(r => (r.number === number ? { ...r, ...patch } : r)));

  const changeStatus = async (room: BoardRoom, status: RoomCondition) => {
    if (!currentPropertyId) return;
    setActingOn(room.number);
    patchRoom(room.number, { status });
    try {
      const res = await fetch('/api/hk-portal/rooms-board/room-status', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, roomNumber: room.number, status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      addNotification(`Room ${room.number} status → ${status}`, 'success', 'Housekeeping');
    } catch {
      patchRoom(room.number, { status: room.status }); // rollback
      addNotification(`Failed to update Room ${room.number} status`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const completeCleaning = async (room: BoardRoom) => {
    if (!currentPropertyId) return;
    const stamp = nowTimeLabel();
    setActingOn(room.number);
    patchRoom(room.number, { status: 'Inspected', lastCleaned: stamp, lastInspected: stamp, dnd: false });
    try {
      const res = await fetch('/api/hk-portal/rooms-board/room-status', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          roomNumber: room.number,
          status: 'Inspected',
          lastCleaned: stamp,
          lastInspected: stamp,
          clearDnd: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to mark cleaning complete');
      addNotification(`Room ${room.number} cleaning completed & inspected`, 'success', 'Housekeeping');
    } catch {
      patchRoom(room.number, { status: room.status, lastCleaned: room.lastCleaned, lastInspected: room.lastInspected, dnd: room.dnd });
      addNotification(`Failed to complete Room ${room.number}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const togglePriority = async (room: BoardRoom) => {
    if (!currentPropertyId) return;
    const isPriority = priorityQueue.includes(room.number);
    const action = isPriority ? 'remove' : 'add';
    setPriorityQueue(prev => (isPriority ? prev.filter(n => n !== room.number) : [...prev, room.number]));
    try {
      const res = await fetch('/api/hk-portal/rooms-board/priority', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, roomNumber: room.number, action }),
      });
      if (!res.ok) throw new Error('Failed to toggle priority');
      addNotification(`Room ${room.number} ${isPriority ? 'removed from' : 'added to'} priority`, 'info', 'Housekeeping');
    } catch {
      setPriorityQueue(prev => (isPriority ? [...prev, room.number] : prev.filter(n => n !== room.number)));
      addNotification(`Failed to update priority for Room ${room.number}`, 'error', 'Housekeeping');
    }
  };

  const assignHousekeeper = async (room: BoardRoom, staffId: string | null) => {
    if (!currentPropertyId) return;
    patchRoom(room.number, { housekeeperId: staffId });
    try {
      const res = await fetch('/api/hk-portal/rooms-board/assign', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, roomNumber: room.number, staffId }),
      });
      if (!res.ok) throw new Error('Failed to assign housekeeper');
      addNotification(`Room ${room.number} ${staffId ? `assigned to ${staffById[staffId]?.name ?? staffId}` : 'unassigned'}`, 'success', 'Housekeeping');
    } catch {
      patchRoom(room.number, { housekeeperId: room.housekeeperId });
      addNotification(`Failed to assign Room ${room.number}`, 'error', 'Housekeeping');
    }
  };

  const dispatchMaintenance = async (room: BoardRoom) => {
    if (!currentPropertyId) return;
    setActingOn(room.number);
    patchRoom(room.number, { status: 'Out of Order' });
    try {
      const res = await fetch('/api/hk-portal/rooms-board/maintenance', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, roomNumber: room.number, issueType: 'General', notes: 'Reported from Room Status board' }),
      });
      if (!res.ok) throw new Error('Failed to dispatch maintenance');
      addNotification(`Maintenance dispatched for Room ${room.number}`, 'warning', 'Housekeeping');
    } catch {
      patchRoom(room.number, { status: room.status });
      addNotification(`Failed to dispatch maintenance for Room ${room.number}`, 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const totalRooms = rooms.length;
  const priorityCount = priorityQueue.length;
  const dndCount = rooms.filter(r => r.dnd).length;
  const needsAttention = rooms.filter(r => isRoomCondition(r.status) && ['Vacant Dirty', 'Occupied Dirty', 'Out of Order', 'Out of Service', 'Do Not Disturb'].includes(r.status)).length;

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Room Status" subtitle="Live room conditions & housekeeping controls" icon={BedDouble} />
        <SectionCard pad="md">
          <div className="flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5" /> Select a property in the header to load the room board.
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Room Status"
        subtitle="Live room conditions & housekeeping controls · DB-synced"
        icon={BedDouble}
        actions={
          <button onClick={fetchBoard} disabled={loading} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Board
          </button>
        }
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Total Rooms" value={totalRooms} tone="info" icon={BedDouble} />
        <SummaryTile label="Needs Attention" value={needsAttention} tone="danger" icon={AlertTriangle} />
        <SummaryTile label="Priority Queue" value={priorityCount} tone="warning" icon={Star} />
        <SummaryTile label="Do Not Disturb" value={dndCount} tone="neutral" icon={Ban} />
      </div>

      {/* Condition legend / counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11 gap-2">
        {ALL_CONDITIONS.map(c => {
          const tone = statusTone[CONDITION_TONE[c]];
          return (
            <button
              key={c}
              onClick={() => setConditionFilter(conditionFilter === c ? 'All' : c)}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                conditionFilter === c ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30' : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
              } ${tone.soft}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold font-mono">{CONDITION_CODE[c]}</span>
                <span className="text-sm font-bold">{counts[c]}</span>
              </div>
              <p className="text-[10px] font-semibold uppercase leading-tight">{c}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={String(conditionFilter)}
              onChange={e => setConditionFilter(e.target.value as 'All' | RoomCondition)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none cursor-pointer"
            >
              <option value="All">All Conditions</option>
              {ALL_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={String(floorFilter)}
              onChange={e => setFloorFilter(e.target.value === 'All' ? 'All' : Number(e.target.value))}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none cursor-pointer"
            >
              <option value="All">All Floors</option>
              {floors.map(f => <option key={f} value={f}>Floor {f}</option>)}
            </select>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search room, type, attendant..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </SectionCard>

      {/* States */}
      {loading && rooms.length === 0 && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-10 rounded-2xl flex items-center justify-center gap-3 text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading room board…
        </div>
      )}
      {error && !loading && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-8 rounded-2xl text-center">
          <ServerCrash className="w-8 h-8 mx-auto mb-2 text-rose-500" />
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={fetchBoard} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      )}

      {/* Room grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(room => {
            const condition = isRoomCondition(room.status) ? room.status : 'Vacant Dirty';
            const tone = statusTone[CONDITION_TONE[condition]];
            const locked = LOCKED_CONDITIONS.has(condition);
            const isPriority = priorityQueue.includes(room.number);
            const housekeeper = room.housekeeperId ? staffById[room.housekeeperId] : undefined;
            const busy = actingOn === room.number;
            return (
              <div key={room.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow smooth-transition overflow-hidden">
                <div className={`h-1 ${tone.dot}`} />
                <div className="p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-gray-500">
                        <BedDouble className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Room {room.number}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-500">Floor {room.floor} · {room.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => togglePriority(room)}
                        title={isPriority ? 'Remove from priority' : 'Add to priority'}
                        className={`p-1.5 rounded-lg transition ${
                          isPriority ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                        }`}
                      >
                        <Star className={`w-4 h-4 ${isPriority ? 'fill-current' : ''}`} />
                      </button>
                      {locked && <Badge tone="danger" icon={Lock}>Locked</Badge>}
                      {room.dnd && <Badge tone="neutral" icon={Ban}>DND</Badge>}
                    </div>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-xl ${tone.soft} mb-3`}>
                    <div>
                      <span className="text-xs font-bold font-mono">{CONDITION_CODE[condition]}</span>
                      <p className="text-sm font-bold uppercase leading-tight">{condition}</p>
                    </div>
                    <select
                      value={condition}
                      onChange={e => changeStatus(room, e.target.value as RoomCondition)}
                      disabled={busy}
                      className="bg-white/70 dark:bg-slate-900/70 border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 outline-none cursor-pointer disabled:opacity-50"
                      title="Change Status"
                    >
                      {ALL_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* Housekeeper assignment */}
                  <div className="flex items-center gap-2 mb-3">
                    <UserCircle2 className="w-4 h-4 text-slate-400 shrink-0" />
                    <select
                      value={room.housekeeperId ?? ''}
                      onChange={e => assignHousekeeper(room, e.target.value || null)}
                      className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 outline-none cursor-pointer"
                    >
                      <option value="">Unassigned</option>
                      {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {housekeeper && (
                      <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap">{housekeeper.solvedToday} today</span>
                    )}
                  </div>

                  {/* Meta: last cleaned / inspected + arrival/departure */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
                    <MetaCell label="Last Cleaned" value={room.lastCleaned || '—'} />
                    <MetaCell label="Last Inspected" value={room.lastInspected || '—'} />
                    <MetaCell label="Arrival" value={room.arrival || '—'} />
                    <MetaCell label="Departure" value={room.departure || '—'} />
                  </div>

                  {/* §5 Controls */}
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                    <button
                      onClick={() => changeStatus(room, locked ? 'Ready' : 'Out of Order')}
                      disabled={busy}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition disabled:opacity-40 ${
                        locked
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100'
                          : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 hover:bg-rose-100'
                      }`}
                    >
                      {locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      {locked ? 'Unlock' : 'Lock'}
                    </button>
                    <button
                      onClick={() => changeStatus(room, 'Ready')}
                      disabled={busy}
                      className="flex items-center justify-center gap-1.5 py-2 bg-slate-50 dark:bg-slate-900/40 text-gray-600 dark:text-gray-300 hover:text-teal-600 rounded-lg text-xs font-medium transition disabled:opacity-40"
                    >
                      <DoorOpen className="w-3.5 h-3.5" /> Release
                    </button>
                    <button
                      onClick={() => changeStatus(room, 'Vacant Dirty')}
                      disabled={busy || condition === 'Vacant Dirty'}
                      className="flex items-center justify-center gap-1.5 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 rounded-lg text-xs font-medium transition disabled:opacity-40"
                    >
                      <PlayCircle className="w-3.5 h-3.5" /> Start
                    </button>
                    <button
                      onClick={() => completeCleaning(room)}
                      disabled={busy || condition === 'Inspected'}
                      className="flex items-center justify-center gap-1.5 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 rounded-lg text-xs font-medium transition disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Complete
                    </button>
                  </div>

                  {/* Maintenance escalation */}
                  {condition !== 'Out of Order' && (
                    <button
                      onClick={() => dispatchMaintenance(room)}
                      disabled={busy}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition disabled:opacity-40"
                    >
                      <Wrench className="w-3.5 h-3.5" /> Dispatch Maintenance
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-8 rounded-2xl text-center text-sm text-gray-500">
          No rooms match the current filters.
        </div>
      )}
    </div>
  );
}

// ── Small presentational helpers ───────────────────────────────────────────

function SummaryTile({ label, value, tone, icon: Icon }: { label: string; value: number; tone: StatusTone; icon: LucideIcon }) {
  const t = statusTone[tone];
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 flex items-center gap-3 card-shadow">
      <div className={`p-2.5 rounded-xl ${t.soft}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{value}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{value}</p>
    </div>
  );
}
