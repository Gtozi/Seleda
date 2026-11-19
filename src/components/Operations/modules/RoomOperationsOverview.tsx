/**
 * Room Operations Overview — Operations Portal (/erp/operations/room-operations).
 *
 * Live room board — the shared `rooms` table is the source of truth, enriched
 * per room with CheckedIn reservations (FO), open housekeeping tasks (HK),
 * open work orders (Engineering), latest room inspection (HK) and open
 * concierge requests (FO). Status changes PATCH back to `rooms` (shared with
 * the FO room rack / HK board); "Request Cleaning" creates a real
 * housekeeping_task_mgmt row; "New Work Order" writes a real work_orders row.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bed,
  RefreshCw,
  MapPin,
  Users,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
  Sparkles,
  ClipboardList,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchRoomOperations,
  setRoomStatus,
  createRoomCleaningTask,
  createRoomWorkOrder,
  type RoomOpsItem,
  type RoomBoardStatus,
  type RoomOpsOverview,
  ROOM_STATUS_OPTIONS,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const BOARD_META: Record<RoomBoardStatus, { label: string; tone: StatusTone; icon: LucideIcon; tile: string }> = {
  occupied: { label: 'Occupied', tone: 'info', icon: Users, tile: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300' },
  vacant: { label: 'Vacant', tone: 'neutral', icon: XCircle, tile: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300' },
  dirty: { label: 'Dirty', tone: 'warning', icon: AlertTriangle, tile: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300' },
  clean: { label: 'Clean', tone: 'success', icon: CheckCircle2, tile: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' },
  inspected: { label: 'Inspected', tone: 'info', icon: CheckCircle2, tile: 'bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 text-cyan-800 dark:text-cyan-300' },
  'out-of-order': { label: 'Out of Order', tone: 'danger', icon: XCircle, tile: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300' },
  'out-of-service': { label: 'Out of Service', tone: 'danger', icon: XCircle, tile: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-300' },
  maintenance: { label: 'Maintenance', tone: 'warning', icon: Wrench, tile: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300' },
};
const BOARD_ORDER: RoomBoardStatus[] = ['occupied', 'dirty', 'clean', 'inspected', 'vacant', 'maintenance', 'out-of-order', 'out-of-service'];

const meta = (s: string) => BOARD_META[s as RoomBoardStatus] || BOARD_META.vacant;

// ── Component ────────────────────────────────────────────────────────────

const RoomOperationsOverview: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [data, setData] = useState<RoomOpsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<'all' | number>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | RoomBoardStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [woTitle, setWoTitle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRoomOperations(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load room operations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const rooms = data?.rooms || [];
  const selectedRoom = rooms.find((r) => r.id === selectedId) || null;

  const filteredRooms = useMemo(() => rooms.filter((room) => {
    const matchesFloor = selectedFloor === 'all' || room.floor === selectedFloor;
    const matchesStatus = selectedStatus === 'all' || room.status === selectedStatus;
    const q = searchQuery.toLowerCase();
    const matchesSearch = q === '' || String(room.roomNumber).toLowerCase().includes(q) ||
      (room.guestName || '').toLowerCase().includes(q);
    return matchesFloor && matchesStatus && matchesSearch;
  }), [rooms, selectedFloor, selectedStatus, searchQuery]);

  const mutate = async (fn: () => Promise<any>, okMsg: string) => {
    setSaving(true);
    try {
      await fn();
      addNotification(okMsg, 'task', 'Executive');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={Bed}
        title="Room Operations Overview"
        subtitle="Live room status board — occupancy, housekeeping, maintenance and inspections in one view"
        actions={
          <button className={button.ghost} onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Occupied" value={stats?.occupied ?? '—'} icon={Users} tone="info" />
        <StatCard title="Ready (Clean+Inspected)" value={stats?.ready ?? '—'} icon={CheckCircle2} tone="success" />
        <StatCard title="Dirty / Needs Cleaning" value={stats?.dirty ?? '—'} icon={Sparkles} tone="warning" />
        <StatCard title="Blocked (OOO/OOS/Maint)" value={stats?.blocked ?? '—'} icon={XCircle} tone="danger" />
        <StatCard title="Needs Attention" value={stats?.needsAttention ?? '—'} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text" placeholder="Search room or guest…"
          value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none w-56"
        />
        <select
          value={String(selectedFloor)}
          onChange={(e) => setSelectedFloor(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Floors</option>
          {(data?.floors || []).map((f) => <option key={f} value={f}>Floor {f}</option>)}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Status</option>
          {BOARD_ORDER.map((s) => <option key={s} value={s}>{meta(s).label}</option>)}
        </select>
      </div>

      {/* Status count chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {BOARD_ORDER.filter((s) => (stats?.byStatus[s] || 0) > 0).map((s) => {
          const Icon = meta(s).icon;
          return (
            <button
              key={s}
              onClick={() => setSelectedStatus(selectedStatus === s ? 'all' : s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${meta(s).tile} ${selectedStatus === s ? 'ring-2 ring-offset-1 ring-[var(--color-accent-operations)]' : ''}`}
            >
              <Icon size={13} /> {meta(s).label}: {stats?.byStatus[s]}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
          <Loader2 size={20} className="animate-spin" /> Loading room board…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Room grid */}
          <div className="lg:col-span-2">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredRooms.length === 0 && (
                <div className="col-span-full text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                  <Bed size={48} className="text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-600 dark:text-slate-400">No rooms match your filters</p>
                </div>
              )}
              {filteredRooms.map((room) => {
                const m = meta(room.status);
                const Icon = m.icon;
                return (
                  <button
                    key={room.id}
                    onClick={() => setSelectedId(room.id)}
                    className={`p-3 rounded-lg border text-left transition-all hover:shadow-md ${m.tile} ${selectedId === room.id ? 'ring-2 ring-[var(--color-accent-operations)]' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{room.roomNumber}</span>
                      <div className="flex items-center gap-1">
                        {room.needsAttention && <AlertTriangle size={13} className="text-rose-500" />}
                        {room.openRequests > 0 && <ClipboardList size={13} />}
                        <Icon size={15} />
                      </div>
                    </div>
                    <p className="text-xs opacity-80 mt-1">{room.roomType || 'Room'}</p>
                    {room.guestName && <p className="text-xs mt-1 truncate font-medium">{room.guestName}</p>}
                    <p className="text-xs opacity-70 mt-1">{m.label}{room.floor ? ` · F${room.floor}` : ''}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Room detail */}
          <div className="lg:col-span-1">
            {selectedRoom ? (
              <SectionCard
                title={`Room ${selectedRoom.roomNumber}`}
                icon={Bed}
                pad="none"
                className="sticky top-6"
                actions={
                  <button onClick={() => setSelectedId(null)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors">
                    <X size={18} className="text-slate-400" />
                  </button>
                }
              >
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={meta(selectedRoom.status).tone} icon={meta(selectedRoom.status).icon}>
                      {selectedRoom.rawStatus}
                    </Badge>
                    {selectedRoom.guestName && <Badge tone="info" icon={Users}>{selectedRoom.guestName}</Badge>}
                    {selectedRoom.openRequests > 0 && <Badge tone="warning">{selectedRoom.openRequests} open request{selectedRoom.openRequests > 1 ? 's' : ''}</Badge>}
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Type</span><span className="text-slate-900 dark:text-white">{selectedRoom.roomType || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Floor</span><span className="text-slate-900 dark:text-white">{selectedRoom.floor || '—'}</span></div>
                    {selectedRoom.rate != null && <div className="flex justify-between"><span className="text-slate-500">Rate</span><span className="text-slate-900 dark:text-white">{formatAmount(selectedRoom.rate)}</span></div>}
                    {selectedRoom.checkOutDate && <div className="flex justify-between"><span className="text-slate-500">Check-out</span><span className="text-slate-900 dark:text-white">{new Date(selectedRoom.checkOutDate).toLocaleDateString()}</span></div>}
                    {selectedRoom.lastInspection && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Last inspection</span>
                        <span className="text-slate-900 dark:text-white">
                          {selectedRoom.lastInspection.result} · {new Date(selectedRoom.lastInspection.date).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {selectedRoom.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selectedRoom.features.map((f) => <Badge key={f} tone="neutral">{f}</Badge>)}
                    </div>
                  )}

                  {selectedRoom.hkTasks.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1.5">HK Tasks</h5>
                      {selectedRoom.hkTasks.map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-sm py-1">
                          <span className="text-slate-700 dark:text-slate-300">{t.type}{t.assignedTo ? ` · ${t.assignedTo}` : ''}</span>
                          <Badge tone={t.status === 'In Progress' ? 'info' : 'warning'}>{t.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedRoom.workOrders.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1.5">Work Orders</h5>
                      {selectedRoom.workOrders.map((w) => (
                        <div key={w.id} className="flex items-center justify-between text-sm py-1">
                          <span className="text-slate-700 dark:text-slate-300 truncate">{w.title}</span>
                          <Badge tone={w.priority === 'Emergency' || w.priority === 'High' ? 'danger' : 'info'}>{w.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-3 border-t border-gray-200 dark:border-slate-700 space-y-2">
                    <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">Set Status</h5>
                    <select
                      value={selectedRoom.rawStatus}
                      disabled={saving}
                      onChange={(e) => mutate(
                        () => setRoomStatus(selectedRoom.id, e.target.value),
                        `Room ${selectedRoom.roomNumber} → ${e.target.value}.`,
                      )}
                      className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                    >
                      {ROOM_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>

                    <button
                      className={button.secondary}
                      disabled={saving}
                      onClick={() => mutate(
                        () => createRoomCleaningTask(selectedRoom.id, { propertyId: currentPropertyId }),
                        `Cleaning task queued for Room ${selectedRoom.roomNumber} (Housekeeping).`,
                      )}
                    >
                      <Sparkles size={14} /> Request Cleaning
                    </button>

                    <div className="flex gap-2">
                      <input
                        value={woTitle}
                        onChange={(e) => setWoTitle(e.target.value)}
                        placeholder="Work order title…"
                        className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                      />
                      <button
                        className={button.secondary}
                        disabled={saving || !woTitle.trim()}
                        onClick={() => mutate(
                          () => createRoomWorkOrder(selectedRoom.id, { propertyId: currentPropertyId, title: woTitle.trim(), priority: 'Medium' }),
                          `Work order created for Room ${selectedRoom.roomNumber} (Engineering).`,
                        ).then(() => setWoTitle(''))}
                      >
                        <Wrench size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-8 text-center sticky top-6">
                <Bed size={48} className="text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">Select a room to see live detail</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomOperationsOverview;
