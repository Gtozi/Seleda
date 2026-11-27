/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Room Inspections module — docs/Housekeeping Portal new.md §9.
 * Digital inspection checklist (12 items) and results: Pass / Fail / Rework Required.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/room-inspections.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useERP } from '../../context/ERPContext';
import {
  BedDouble,
  ShowerHead,
  Layout,
  AppWindow,
  Sofa,
  Lightbulb,
  AirVent,
  Tv,
  Wifi,
  Gift,
  ShieldCheck,
  Sparkles,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ClipboardCheck,
  Loader2,
  ServerCrash,
  Save,
  Printer,
  CalendarClock,
  Play,
  Trash2,
  Power,
  ChevronDown,
  ChevronRight,
  History,
  Users,
  MapPin,
  Flag,
  ClipboardList,
  DoorOpen,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

type InspectionResult = 'Pass' | 'Fail' | 'Rework Required' | 'Pending';
type CheckItem = 'Bed Quality' | 'Bathroom' | 'Floors' | 'Windows' | 'Furniture' | 'Lighting' | 'Air Conditioning' | 'Television' | 'Internet' | 'Amenities' | 'Safety Equipment' | 'Overall Presentation';
type ItemState = 'Pass' | 'Fail' | 'Pending';

interface Inspection {
  id: string;
  room: string;
  floor: string;
  inspector: string;
  date: string;
  result: InspectionResult;
  items: Record<CheckItem, ItemState>;
  notes?: string;
  recommendedAction?: string;
}

const RECOMMENDED_ACTIONS = [
  'Release to PMS',
  'Rework Required',
  'Hold for Maintenance',
  'Deep Cleaning Required',
  'Hold',
] as const;
type RecommendedAction = typeof RECOMMENDED_ACTIONS[number];

const ACTION_TONE: Record<string, StatusTone> = {
  'Release to PMS': 'success',
  'Rework Required': 'warning',
  'Hold for Maintenance': 'danger',
  'Deep Cleaning Required': 'warning',
  'Hold': 'neutral',
};

type IntervalType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'days';

interface InspectionSchedule {
  id: string;
  name: string;
  propertyId?: string;
  roomNumbers: string[];
  floor?: string;
  inspector?: string;
  intervalType: IntervalType;
  timeOfDay: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  intervalDays?: number | null;
  cronExpression?: string;
  enabled: boolean;
  lastRun?: string;
  notes?: string;
}

const INTERVAL_LABELS: Record<IntervalType, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  days: 'Every N Days',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CHECK_ITEMS: { key: CheckItem; icon: LucideIcon }[] = [
  { key: 'Bed Quality', icon: BedDouble },
  { key: 'Bathroom', icon: ShowerHead },
  { key: 'Floors', icon: Layout },
  { key: 'Windows', icon: AppWindow },
  { key: 'Furniture', icon: Sofa },
  { key: 'Lighting', icon: Lightbulb },
  { key: 'Air Conditioning', icon: AirVent },
  { key: 'Television', icon: Tv },
  { key: 'Internet', icon: Wifi },
  { key: 'Amenities', icon: Gift },
  { key: 'Safety Equipment', icon: ShieldCheck },
  { key: 'Overall Presentation', icon: Sparkles },
];

const emptyItems = (): Record<CheckItem, ItemState> =>
  CHECK_ITEMS.reduce((acc, c) => ({ ...acc, [c.key]: 'Pending' }), {} as Record<CheckItem, ItemState>);

const computeResult = (items: Record<CheckItem, ItemState>): InspectionResult => {
  const vals = Object.values(items);
  if (vals.every(v => v === 'Pass')) return 'Pass';
  if (vals.some(v => v === 'Fail')) return 'Fail';
  if (vals.some(v => v === 'Pending')) return 'Pending';
  return 'Rework Required';
};

const RESULT_TONE: Record<InspectionResult, StatusTone> = {
  Pass: 'success',
  Fail: 'danger',
  'Rework Required': 'warning',
  Pending: 'neutral',
};

const ITEM_TONE: Record<ItemState, StatusTone> = {
  Pass: 'success',
  Fail: 'danger',
  Pending: 'neutral',
};

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function normalizeInspection(raw: any): Inspection {
  const items: Record<string, string> = raw.items || {};
  const normalizedItems = CHECK_ITEMS.reduce((acc, c) => {
    const state = items[c.key];
    acc[c.key] = (state === 'Pass' || state === 'Fail' || state === 'Pending') ? state : 'Pending';
    return acc;
  }, {} as Record<CheckItem, ItemState>);

  return {
    id: raw.id,
    room: raw.room,
    floor: raw.floor || '',
    inspector: raw.inspector || '',
    date: raw.date,
    result: RESULT_TONE[raw.result as InspectionResult] ? (raw.result as InspectionResult) : computeResult(normalizedItems),
    items: normalizedItems,
    notes: raw.notes,
    recommendedAction: raw.recommendedAction,
  };
}

// ── Print helpers ──────────────────────────────────────────────────────
const HOTEL_LABEL = 'SELEDA ERP — Housekeeping Inspections';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stateBadge(state: ItemState): string {
  if (state === 'Pass') return `<span class="pill pill-pass">PASS</span>`;
  if (state === 'Fail') return `<span class="pill pill-fail">FAIL</span>`;
  return `<span class="pill pill-pending">PENDING</span>`;
}

function renderInspectionSection(i: Inspection): string {
  const checklistHtml = CHECK_ITEMS.map(({ key, icon }) => {
    const state = i.items[key];
    return `<tr><td class="icon-cell">${icon.name}</td><td class="item-label">${escapeHtml(key)}</td><td class="state-cell">${stateBadge(state)}</td></tr>`;
  }).join('');

  return `<section class="inspection-sheet">
  <h1>Room ${escapeHtml(i.room)} — Inspection Report</h1>
  <div class="meta">
    <div><b>Inspection ID:</b> ${escapeHtml(i.id)}</div>
    <div><b>Room:</b> ${escapeHtml(i.room)}</div>
    <div><b>Floor:</b> ${escapeHtml(i.floor || '—')}</div>
    <div><b>Inspector:</b> ${escapeHtml(i.inspector || 'Unassigned')}</div>
    <div><b>Date:</b> ${escapeHtml(i.date)}</div>
    <div><b>Result:</b> <span class="pill pill-${i.result === 'Pass' ? 'pass' : i.result === 'Fail' ? 'fail' : i.result === 'Pending' ? 'pending' : 'rework'}">${escapeHtml(i.result)}</span></div>
  </div>
  ${i.recommendedAction ? `<div class="action-bar"><b>Recommended Action:</b> <span class="pill pill-rework">${escapeHtml(i.recommendedAction)}</span></div>` : ''}
  <h2>Inspection Checklist</h2>
  <table class="checklist-table"><tbody>${checklistHtml}</tbody></table>
  ${i.notes ? `<h2>Notes</h2><p class="notes">${escapeHtml(i.notes)}</p>` : ''}
  <div class="sign">
    <div class="line">Inspector Signature / Date</div>
    <div class="line">Supervisor Signature / Date</div>
  </div>
</section>`;
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 28px; }
  header { border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  header .brand { font-size: 16px; font-weight: 800; }
  header .id { font-size: 12px; color: #64748b; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin: 18px 0 8px; color: #475569; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 24px; font-size: 12px; margin-bottom: 12px; }
  .meta b { color: #334155; }
  .action-bar { font-size: 12px; margin-bottom: 12px; padding: 8px 12px; background: #fef3c7; border-radius: 8px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  .pill-pass { background: #dcfce7; color: #166534; }
  .pill-fail { background: #fee2e2; color: #991b1b; }
  .pill-pending { background: #e2e8f0; color: #475569; }
  .pill-rework { background: #fef3c7; color: #b45309; }
  .checklist-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .checklist-table tr { border-bottom: 1px solid #e2e8f0; }
  .checklist-table td { padding: 8px 6px; }
  .icon-cell { width: 28px; color: #94a3b8; font-size: 11px; }
  .item-label { font-weight: 600; }
  .state-cell { text-align: right; white-space: nowrap; }
  .notes { font-size: 12px; color: #334155; background: #f8fafc; padding: 10px 14px; border-radius: 8px; white-space: pre-wrap; }
  .sign { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .sign .line { border-top: 1px solid #1e293b; padding-top: 6px; font-size: 11px; color: #64748b; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; }
  section.inspection-sheet { page-break-after: always; padding-bottom: 20px; }
  section.inspection-sheet:last-child { page-break-after: auto; }
  @media print { body { margin: 12mm; } .inspection-sheet, .sign { page-break-inside: avoid; } }
`;

function printInspection(i: Inspection) {
  if (typeof window === 'undefined') return;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(`${i.id} — Room ${i.room}`)}</title><style>${PRINT_STYLES}</style></head>
<body>
  <header><div class="brand">${escapeHtml(HOTEL_LABEL)}</div><div class="id">${escapeHtml(i.id)}</div></header>
  ${renderInspectionSection(i)}
  <div class="footer">Generated ${new Date().toLocaleString()} · SELEDA ERP Room Inspection Report</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};};</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=820,height=720');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

function printAllInspections(list: Inspection[]) {
  if (typeof window === 'undefined' || list.length === 0) return;
  const sections = list.map(renderInspectionSection).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Room Inspections — ${list.length} reports</title><style>${PRINT_STYLES}</style></head>
<body>
  <header><div class="brand">${escapeHtml(HOTEL_LABEL)}</div><div class="id">${list.length} inspection(s) · ${new Date().toLocaleDateString()}</div></header>
  ${sections}
  <div class="footer">Generated ${new Date().toLocaleString()} · SELEDA ERP Room Inspection Reports</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};};</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=820,height=720');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

export default function RoomInspectionsModule() {
  const { currentPropertyId, addNotification } = useERP();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | InspectionResult>('All');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingItem, setSavingItem] = useState<{ id: string; item: CheckItem } | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editAction, setEditAction] = useState<string>('');
  const [editInspector, setEditInspector] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [rooms, setRooms] = useState<{ number: string; floor: string | number | null; type: string | null; status: string }[]>([]);
  const [roomQuery, setRoomQuery] = useState('');
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialState, setInitialState] = useState<'pending' | 'pass'>('pending');
  const [form, setForm] = useState({
    room: '',
    floor: '',
    inspector: '',
    date: new Date().toISOString().slice(0, 16),
    notes: '',
  });
  // Schedule state
  const [schedules, setSchedules] = useState<InspectionSchedule[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [schedForm, setSchedForm] = useState({
    name: '',
    roomNumbers: [] as string[],
    roomInput: '',
    floor: '',
    inspector: '',
    intervalType: 'daily' as IntervalType,
    timeOfDay: '09:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    intervalDays: 2,
    notes: '',
  });

  const fetchInspections = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/room-inspections/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load inspections (${res.status})`);
      const data = (await res.json()) as { inspections: any[] };
      const list = (data.inspections || []).map(normalizeInspection);
      setInspections(list);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
    } catch (e: any) {
      setError(e?.message || 'Failed to load inspections');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, selectedId]);

  // Fetch housekeeping staff for the inspector dropdown (non-fatal on failure).
  const fetchStaff = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hk-portal/task-management/staff/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { staff: { id: string; name: string }[] };
      setStaff(data.staff || []);
    } catch {
      /* non-fatal — inspector field falls back to free text */
    }
  }, [currentPropertyId]);

  // Fetch rooms for the room picker (non-fatal on failure).
  const fetchRooms = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hk-portal/rooms-board/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { rooms: { number: string; floor: string | null; type: string | null; status: string }[] };
      setRooms((data.rooms || []).map(r => ({ number: r.number, floor: r.floor, type: r.type, status: r.status })));
    } catch {
      /* non-fatal — room field falls back to free text */
    }
  }, [currentPropertyId]);

  // Fetch inspection schedules (non-fatal on failure).
  const fetchSchedules = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hk-portal/inspection-schedules/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { schedules: InspectionSchedule[] };
      setSchedules(data.schedules || []);
    } catch {
      /* non-fatal */
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchInspections();
    fetchStaff();
    fetchRooms();
    fetchSchedules();
  }, [fetchInspections, fetchStaff, fetchRooms, fetchSchedules]);

  // ── Schedule CRUD ───────────────────────────────────────────────────
  const openScheduleForm = () => {
    setSchedForm({
      name: '',
      roomNumbers: [],
      roomInput: '',
      floor: '',
      inspector: staff[0]?.name || '',
      intervalType: 'daily',
      timeOfDay: '09:00',
      dayOfWeek: 1,
      dayOfMonth: 1,
      intervalDays: 2,
      notes: '',
    });
    setShowScheduleForm(true);
  };

  const addRoomToSchedule = () => {
    const r = schedForm.roomInput.trim();
    if (!r) return;
    if (schedForm.roomNumbers.includes(r)) {
      setSchedForm(f => ({ ...f, roomInput: '' }));
      return;
    }
    setSchedForm(f => ({ ...f, roomNumbers: [...f.roomNumbers, r], roomInput: '' }));
  };

  const removeRoomFromSchedule = (room: string) => {
    setSchedForm(f => ({ ...f, roomNumbers: f.roomNumbers.filter(r => r !== room) }));
  };

  const createSchedule = async () => {
    if (!currentPropertyId) return;
    if (!schedForm.name.trim()) {
      addNotification('Schedule name is required', 'error', 'Housekeeping');
      return;
    }
    setSavingSchedule(true);
    try {
      const res = await fetch('/api/hk-portal/inspection-schedules', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          name: schedForm.name.trim(),
          roomNumbers: schedForm.roomNumbers,
          floor: schedForm.floor.trim() || null,
          inspector: schedForm.inspector.trim() || null,
          intervalType: schedForm.intervalType,
          timeOfDay: schedForm.timeOfDay,
          dayOfWeek: schedForm.intervalType === 'weekly' ? schedForm.dayOfWeek : null,
          dayOfMonth: (schedForm.intervalType === 'monthly' || schedForm.intervalType === 'quarterly') ? schedForm.dayOfMonth : null,
          intervalDays: schedForm.intervalType === 'days' ? schedForm.intervalDays : null,
          notes: schedForm.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create schedule (${res.status})`);
      const created = (await res.json()) as InspectionSchedule;
      setSchedules(prev => [created, ...prev]);
      setShowScheduleForm(false);
      addNotification(`Schedule "${created.name}" created`, 'success', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Could not create schedule', 'error', 'Housekeeping');
    } finally {
      setSavingSchedule(false);
    }
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/hk-portal/inspection-schedules/${id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      const updated = (await res.json()) as InspectionSchedule;
      setSchedules(prev => prev.map(s => (s.id === id ? updated : s)));
      addNotification(`Schedule ${updated.enabled ? 'enabled' : 'disabled'}`, 'info', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Could not toggle schedule', 'error', 'Housekeeping');
    }
  };

  const triggerSchedule = async (id: string) => {
    setTriggeringId(id);
    try {
      const res = await fetch(`/api/hk-portal/inspection-schedules/${id}/trigger`, {
        method: 'POST',
        headers: authHeaders(true),
      });
      if (!res.ok) throw new Error('Failed to trigger');
      const data = (await res.json()) as { created: number };
      addNotification(`Created ${data.created} inspection(s)`, 'success', 'Housekeeping');
      fetchInspections();
      fetchSchedules();
    } catch (e: any) {
      addNotification(e?.message || 'Could not trigger schedule', 'error', 'Housekeeping');
    } finally {
      setTriggeringId(null);
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/hk-portal/inspection-schedules/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete');
      setSchedules(prev => prev.filter(s => s.id !== id));
      addNotification('Schedule deleted', 'info', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Could not delete schedule', 'error', 'Housekeeping');
    }
  };

  // Filtered rooms for the picker dropdown.
  const filteredRooms = useMemo(() => {
    const q = roomQuery.trim().toLowerCase();
    const sorted = [...rooms].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    if (!q) return sorted.slice(0, 30);
    return sorted
      .filter(r => {
        const floor = r.floor == null ? '' : String(r.floor);
        const type = r.type == null ? '' : String(r.type);
        return r.number.toLowerCase().includes(q) || floor.toLowerCase().includes(q) || type.toLowerCase().includes(q);
      })
      .slice(0, 30);
  }, [rooms, roomQuery]);

  const selectRoom = (r: { number: string; floor: string | number | null }) => {
    const floorStr = r.floor == null ? '' : String(r.floor);
    setForm(f => ({ ...f, room: r.number, floor: floorStr || f.floor }));
    setRoomQuery(r.number);
    setRoomPickerOpen(false);
    setFormError(null);
  };

  const filtered = useMemo(
    () =>
      inspections.filter(i => {
        const matchesFilter = filter === 'All' || i.result === filter;
        const matchesSearch =
          i.room.includes(search) ||
          i.inspector.toLowerCase().includes(search.toLowerCase()) ||
          i.id.toLowerCase().includes(search.toLowerCase());
        return matchesFilter && matchesSearch;
      }),
    [inspections, filter, search]
  );

  // Group filtered inspections by room number. Each group is sorted by date
  // descending so the first entry is the latest inspection.
  const grouped = useMemo(() => {
    const map = new Map<string, Inspection[]>();
    for (const i of filtered) {
      const arr = map.get(i.room) || [];
      arr.push(i);
      map.set(i.room, arr);
    }
    // Sort each group's inspections by date descending
    for (const arr of map.values()) {
      arr.sort((a, b) => b.date.localeCompare(a.date));
    }
    // Return as array of { room, inspections } sorted by room number
    return Array.from(map.entries())
      .map(([room, insps]) => ({ room, inspections: insps }))
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [filtered]);

  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [printSubmenu, setPrintSubmenu] = useState<string | null>(null);
  const printMenuRef = useRef<HTMLDivElement>(null);

  const selected = inspections.find(i => i.id === detailId) ?? null;

  // Sync the editable notes / recommended-action fields when the detail modal
  // opens for a different inspection. We intentionally only depend on
  // `detailId` (not the full `selected` object) so that toggling checklist
  // items — which updates `inspections` and thus `selected` — does NOT reset
  // the user's in-progress edits to the saved values.
  useEffect(() => {
    setEditNotes(selected?.notes || '');
    setEditAction(selected?.recommendedAction || '');
    setEditInspector(selected?.inspector || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  // Close print menu on outside click
  useEffect(() => {
    if (!showPrintMenu) return;
    const handler = (e: MouseEvent) => {
      if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) {
        setShowPrintMenu(false);
        setPrintSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPrintMenu]);

  const saveMeta = async () => {
    if (!selected) return;
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/hk-portal/room-inspections/${selected.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ notes: editNotes, recommendedAction: editAction || null, inspector: editInspector || null }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const raw = await res.json();
      const updated = normalizeInspection(raw);
      setInspections(prev => prev.map(i => (i.id === selected.id ? updated : i)));
      addNotification('Inspection updated', 'success', 'Housekeeping');
      setDetailId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Could not save', 'error', 'Housekeeping');
    } finally {
      setSavingMeta(false);
    }
  };

  const setItem = async (id: string, item: CheckItem, state: ItemState) => {
    setSavingItem({ id, item });
    try {
      const res = await fetch(`/api/hk-portal/room-inspections/${id}/item`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ item, state }),
      });
      if (!res.ok) throw new Error('Failed to update item');
      const raw = await res.json();
      const updated = normalizeInspection(raw);
      setInspections(prev =>
        prev.map(i => (i.id === id ? updated : i))
      );
      addNotification(`${item} marked ${state}`, state === 'Fail' ? 'warning' : 'info', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Could not save item', 'error', 'Housekeeping');
    } finally {
      setSavingItem(null);
    }
  };

  const counts = {
    pass: inspections.filter(i => i.result === 'Pass').length,
    fail: inspections.filter(i => i.result === 'Fail').length,
    rework: inspections.filter(i => i.result === 'Rework Required').length,
    pending: inspections.filter(i => i.result === 'Pending').length,
  };

  const openNewInspectionForm = () => {
    setForm({
      room: '',
      floor: '',
      inspector: staff[0]?.name || '',
      date: new Date().toISOString().slice(0, 16),
      notes: '',
    });
    setRoomQuery('');
    setRoomPickerOpen(false);
    setFormError(null);
    setInitialState('pending');
    setShowForm(true);
  };

  const createInspection = async () => {
    if (!currentPropertyId) {
      addNotification('No property selected', 'error', 'Housekeeping');
      return;
    }
    if (!form.room.trim()) {
      setFormError('Room number is required');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      const items = initialState === 'pass'
        ? CHECK_ITEMS.reduce((acc, c) => ({ ...acc, [c.key]: 'Pass' }), {} as Record<CheckItem, ItemState>)
        : emptyItems();
      const res = await fetch('/api/hk-portal/room-inspections', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          room: form.room.trim(),
          floor: form.floor.trim() || null,
          inspector: form.inspector.trim() || null,
          date: form.date.replace('T', ' '),
          items,
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create inspection (${res.status})`);
      const raw = await res.json();
      const created = normalizeInspection(raw);
      setInspections(prev => [created, ...prev]);
      setDetailId(created.id);
      setShowForm(false);
      addNotification(`Inspection started for Room ${created.room}`, 'info', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Could not start inspection', 'error', 'Housekeeping');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Room Inspections"
        subtitle="Digital inspection checklists & pass/fail/rework results."
        icon={ClipboardCheck}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSchedules(s => !s)}
              className={button.secondary}
            >
              <CalendarClock size={14} /> Schedules {schedules.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-black">{schedules.length}</span>}
            </button>
            <div className="relative" ref={printMenuRef}>
              <button
                onClick={() => setShowPrintMenu(o => !o)}
                disabled={inspections.length === 0}
                className={button.secondary}
                title="Print inspection reports"
              >
                <Printer size={14} /> Print
                <ChevronDown size={12} className={`transition-transform ${showPrintMenu ? 'rotate-180' : ''}`} />
              </button>
              {showPrintMenu && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
                  <div className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 sticky top-0 z-10">
                    Print {filtered.length} inspection{filtered.length === 1 ? '' : 's'}
                  </div>

                  {/* Current filter */}
                  <button
                    onClick={() => { printAllInspections(filtered); setShowPrintMenu(false); setPrintSubmenu(null); }}
                    disabled={filtered.length === 0}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left disabled:opacity-40"
                  >
                    <Printer size={16} className="text-gray-400" />
                    <span className="flex-1">Current filter</span>
                    <span className="text-xs text-gray-400">{filtered.length}</span>
                  </button>

                  {/* All inspections */}
                  <button
                    onClick={() => { printAllInspections(inspections); setShowPrintMenu(false); setPrintSubmenu(null); }}
                    disabled={inspections.length === 0}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left disabled:opacity-40"
                  >
                    <ClipboardCheck size={16} className="text-gray-400" />
                    <span className="flex-1">All inspections</span>
                    <span className="text-xs text-gray-400">{inspections.length}</span>
                  </button>

                  {/* By Inspector — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'inspector' ? null : 'inspector')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <Users size={16} className="text-gray-400" />
                      <span className="flex-1 font-medium">By Inspector</span>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${printSubmenu === 'inspector' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'inspector' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        {Array.from(new Set(inspections.map(i => i.inspector).filter(Boolean))).sort().map(insp => {
                          const list = inspections.filter(i => i.inspector === insp);
                          return (
                            <button
                              key={insp}
                              onClick={() => { printAllInspections(list); setShowPrintMenu(false); setPrintSubmenu(null); }}
                              className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                            >
                              <span className="flex-1 truncate">{insp}</span>
                              <span className="text-gray-400">{list.length}</span>
                            </button>
                          );
                        })}
                        <button
                          onClick={() => { printAllInspections(inspections.filter(i => !i.inspector)); setShowPrintMenu(false); setPrintSubmenu(null); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">Unassigned</span>
                          <span className="text-gray-400">{inspections.filter(i => !i.inspector).length}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* By Room — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'room' ? null : 'room')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <DoorOpen size={16} className="text-gray-400" />
                      <span className="flex-1 font-medium">By Room</span>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${printSubmenu === 'room' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'room' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        <button
                          onClick={() => {
                            const rooms = Array.from(new Set(inspections.map(i => i.room))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                            const latest = rooms.map(room => {
                              const roomInsps = inspections.filter(i => i.room === room).sort((a, b) => b.date.localeCompare(a.date));
                              return roomInsps[0];
                            }).filter(Boolean) as Inspection[];
                            printAllInspections(latest);
                            setShowPrintMenu(false);
                            setPrintSubmenu(null);
                          }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">Latest per room</span>
                          <span className="text-gray-400">{new Set(inspections.map(i => i.room)).size}</span>
                        </button>
                        {Array.from(new Set(inspections.map(i => i.room))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(room => {
                          const list = inspections.filter(i => i.room === room);
                          return (
                            <button
                              key={room}
                              onClick={() => { printAllInspections(list); setShowPrintMenu(false); setPrintSubmenu(null); }}
                              className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                            >
                              <span className="flex-1">Room {room}</span>
                              <span className="text-gray-400">{list.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* By Result — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'result' ? null : 'result')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <ClipboardList size={16} className="text-gray-400" />
                      <span className="flex-1 font-medium">By Result</span>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${printSubmenu === 'result' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'result' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        {(['Pass', 'Fail', 'Rework Required', 'Pending'] as InspectionResult[]).map(r => {
                          const list = inspections.filter(i => i.result === r);
                          return (
                            <button
                              key={r}
                              onClick={() => { printAllInspections(list); setShowPrintMenu(false); setPrintSubmenu(null); }}
                              disabled={list.length === 0}
                              className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left disabled:opacity-40"
                            >
                              <span className={`w-2 h-2 rounded-full ${statusTone[RESULT_TONE[r]].dot}`} />
                              <span className="flex-1">{r}</span>
                              <span className="text-gray-400">{list.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* By Recommendation — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'recommendation' ? null : 'recommendation')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <Flag size={16} className="text-gray-400" />
                      <span className="flex-1 font-medium">By Recommendation</span>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${printSubmenu === 'recommendation' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'recommendation' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        {RECOMMENDED_ACTIONS.map(a => {
                          const list = inspections.filter(i => i.recommendedAction === a);
                          return (
                            <button
                              key={a}
                              onClick={() => { printAllInspections(list); setShowPrintMenu(false); setPrintSubmenu(null); }}
                              disabled={list.length === 0}
                              className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left disabled:opacity-40"
                            >
                              <span className={`w-2 h-2 rounded-full ${statusTone[ACTION_TONE[a] ?? 'neutral'].dot}`} />
                              <span className="flex-1">{a}</span>
                              <span className="text-gray-400">{list.length}</span>
                            </button>
                          );
                        })}
                        <button
                          onClick={() => { printAllInspections(inspections.filter(i => !i.recommendedAction)); setShowPrintMenu(false); setPrintSubmenu(null); }}
                          className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left italic"
                        >
                          <span className="flex-1">No recommendation</span>
                          <span className="text-gray-400">{inspections.filter(i => !i.recommendedAction).length}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* By Floor — expandable */}
                  <div className="border-t border-gray-100 dark:border-slate-700">
                    <button
                      onClick={() => setPrintSubmenu(s => s === 'floor' ? null : 'floor')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition text-left"
                    >
                      <MapPin size={16} className="text-gray-400" />
                      <span className="flex-1 font-medium">By Floor</span>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${printSubmenu === 'floor' ? 'rotate-180' : ''}`} />
                    </button>
                    {printSubmenu === 'floor' && (
                      <div className="bg-slate-50 dark:bg-slate-900/30">
                        {Array.from(new Set(inspections.map(i => i.floor).filter(Boolean))).sort().map(floor => {
                          const list = inspections.filter(i => i.floor === floor);
                          return (
                            <button
                              key={floor}
                              onClick={() => { printAllInspections(list); setShowPrintMenu(false); setPrintSubmenu(null); }}
                              className="w-full flex items-center gap-3 pl-10 pr-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition text-left"
                            >
                              <span className="flex-1">{floor}</span>
                              <span className="text-gray-400">{list.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button onClick={openNewInspectionForm} className={button.primary}>
              <Plus size={14} /> New Inspection
            </button>
          </div>
        }
      />

      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setFormError(null); }}
        onConfirm={createInspection}
        title="New Room Inspection"
        subtitle="Start a digital inspection checklist"
        variant="form"
        size="lg"
        confirmLabel={creating ? 'Creating…' : 'Start Inspection'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        loading={creating}
      >
        <div className="space-y-5">
          {/* Section: Room selection */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Room</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2 flex flex-col gap-1.5 relative">
                <label className="text-xs font-semibold uppercase text-gray-500">Room Number <span className="text-rose-500">*</span></label>
                <input
                  placeholder={rooms.length > 0 ? 'Search room number, floor, type…' : 'e.g. 101'}
                  value={roomQuery}
                  onChange={e => {
                    setRoomQuery(e.target.value);
                    setForm(f => ({ ...f, room: e.target.value }));
                    setRoomPickerOpen(true);
                    setFormError(null);
                  }}
                  onFocus={() => setRoomPickerOpen(true)}
                  onBlur={() => setTimeout(() => setRoomPickerOpen(false), 150)}
                  autoFocus
                  className={`px-3 py-2 text-sm border rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 ${formError ? 'border-rose-400 focus:ring-rose-500' : 'border-gray-200 dark:border-slate-700'}`}
                />
                {formError && <p className="text-[10px] text-rose-500 font-bold">{formError}</p>}
                {roomPickerOpen && filteredRooms.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg">
                    {filteredRooms.map(r => (
                      <button
                        key={r.number}
                        onMouseDown={(e) => { e.preventDefault(); selectRoom(r); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                      >
                        <span className="font-bold text-gray-900 dark:text-white">Room {r.number}</span>
                        <span className="text-[10px] text-slate-400 font-medium">{[r.floor, r.type].filter(v => v != null && v !== '').map(v => String(v)).join(' · ') || r.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase text-gray-500">Floor</label>
                <input
                  placeholder="e.g. 1st Floor"
                  value={form.floor}
                  onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Section: Assignment */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Assignment</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase text-gray-500">Inspector</label>
                <select
                  value={form.inspector}
                  onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select inspector…</option>
                  {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                {staff.length === 0 && <p className="text-[9px] text-slate-400">No staff loaded — type a name manually.</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase text-gray-500">Date & Time</label>
                <input
                  type="datetime-local"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Section: Initial checklist state */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Initial Checklist State</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setInitialState('pending')}
                className={`p-3 rounded-xl border-2 text-left transition ${initialState === 'pending' ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardCheck size={14} className={initialState === 'pending' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-xs font-black uppercase text-slate-700 dark:text-slate-200">All Pending</span>
                </div>
                <p className="text-[10px] text-slate-500">Start with every item unchecked. Inspect each one manually.</p>
              </button>
              <button
                type="button"
                onClick={() => setInitialState('pass')}
                className={`p-3 rounded-xl border-2 text-left transition ${initialState === 'pass' ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={14} className={initialState === 'pass' ? 'text-emerald-600' : 'text-slate-400'} />
                  <span className="text-xs font-black uppercase text-slate-700 dark:text-slate-200">All Pass</span>
                </div>
                <p className="text-[10px] text-slate-500">Pre-mark all items as Pass. Tick off only failures.</p>
              </button>
            </div>
          </div>

          {/* Section: Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase text-gray-500">Notes (optional)</label>
            <textarea
              placeholder="Any context for this inspection…"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Live summary */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Summary</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
              <span>Room: <strong className="text-slate-900 dark:text-white">{form.room || '—'}</strong></span>
              <span>Floor: <strong className="text-slate-900 dark:text-white">{form.floor || '—'}</strong></span>
              <span>Inspector: <strong className="text-slate-900 dark:text-white">{form.inspector || '—'}</strong></span>
              <span>Items: <strong className="text-slate-900 dark:text-white">{initialState === 'pass' ? '12 Pass' : '12 Pending'}</strong></span>
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* Schedule form modal */}
      <ModalSystem
        isOpen={showScheduleForm}
        onClose={() => setShowScheduleForm(false)}
        onConfirm={createSchedule}
        title="Schedule Recurring Inspection"
        subtitle="Auto-create inspections at set intervals"
        variant="form"
        size="lg"
        confirmLabel={savingSchedule ? 'Creating…' : 'Create Schedule'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        loading={savingSchedule}
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase text-gray-500">Schedule Name <span className="text-rose-500">*</span></label>
            <input
              placeholder="e.g. Daily Morning Inspection"
              value={schedForm.name}
              onChange={e => setSchedForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-semibold uppercase text-gray-500">Rooms (blank = all rooms)</label>
              <div className="flex gap-2">
                <input
                  placeholder="Type a room number and press Enter…"
                  value={schedForm.roomInput}
                  onChange={e => setSchedForm(f => ({ ...f, roomInput: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRoomToSchedule(); } }}
                  list="sched-room-options"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={addRoomToSchedule}
                  className="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 text-xs font-black uppercase hover:bg-indigo-100 transition"
                >
                  Add
                </button>
                <datalist id="sched-room-options">
                  {rooms.map(r => <option key={r.number} value={r.number} />)}
                </datalist>
              </div>
              {schedForm.roomNumbers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {schedForm.roomNumbers.map(r => (
                    <span key={r} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[10px] font-black">
                      {r}
                      <button type="button" onClick={() => removeRoomFromSchedule(r)} className="hover:text-rose-500 transition">×</button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSchedForm(f => ({ ...f, roomNumbers: [] }))}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-400 hover:text-rose-500 transition"
                  >
                    Clear all
                  </button>
                </div>
              )}
              {schedForm.roomNumbers.length === 0 && (
                <p className="text-[9px] text-slate-400">No rooms selected = all rooms will be inspected.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Floor (optional)</label>
              <input
                placeholder="e.g. 1st Floor"
                value={schedForm.floor}
                onChange={e => setSchedForm(f => ({ ...f, floor: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Inspector</label>
              <select
                value={schedForm.inspector}
                onChange={e => setSchedForm(f => ({ ...f, inspector: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select inspector…</option>
                {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Time of Day</label>
              <input
                type="time"
                value={schedForm.timeOfDay}
                onChange={e => setSchedForm(f => ({ ...f, timeOfDay: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Interval</p>
            <div className="grid grid-cols-5 gap-2">
              {(['daily', 'weekly', 'monthly', 'quarterly', 'days'] as IntervalType[]).map(it => (
                <button
                  key={it}
                  type="button"
                  onClick={() => setSchedForm(f => ({ ...f, intervalType: it }))}
                  className={`p-2.5 rounded-xl border-2 text-center transition ${schedForm.intervalType === it ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                >
                  <span className={`text-[10px] font-black uppercase ${schedForm.intervalType === it ? 'text-indigo-600' : 'text-slate-500'}`}>{INTERVAL_LABELS[it]}</span>
                </button>
              ))}
            </div>
          </div>

          {schedForm.intervalType === 'days' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Every N Days</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={schedForm.intervalDays}
                  onChange={e => setSchedForm(f => ({ ...f, intervalDays: parseInt(e.target.value) || 2 }))}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 w-28"
                />
                <span className="text-xs text-slate-500 font-medium">day(s)</span>
              </div>
              <p className="text-[9px] text-slate-400">Runs every {schedForm.intervalDays} day(s) at the selected time. e.g. every 2 days, every 3 days, etc.</p>
            </div>
          )}

          {schedForm.intervalType === 'weekly' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Day of Week</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day, idx) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSchedForm(f => ({ ...f, dayOfWeek: idx }))}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition ${schedForm.dayOfWeek === idx ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200'}`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(schedForm.intervalType === 'monthly' || schedForm.intervalType === 'quarterly') && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Day of Month</label>
              <input
                type="number"
                min={1}
                max={28}
                value={schedForm.dayOfMonth}
                onChange={e => setSchedForm(f => ({ ...f, dayOfMonth: parseInt(e.target.value) || 1 }))}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 w-24"
              />
              <p className="text-[9px] text-slate-400">Days 1-28 only (to avoid skipped months).</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase text-gray-500">Notes (optional)</label>
            <textarea
              placeholder="Any context for this schedule…"
              value={schedForm.notes}
              onChange={e => setSchedForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Summary</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
              <span>Interval: <strong className="text-slate-900 dark:text-white">{schedForm.intervalType === 'days' ? `Every ${schedForm.intervalDays} days` : INTERVAL_LABELS[schedForm.intervalType]}</strong></span>
              <span>Time: <strong className="text-slate-900 dark:text-white">{schedForm.timeOfDay}</strong></span>
              {schedForm.intervalType === 'weekly' && <span>Day: <strong className="text-slate-900 dark:text-white">{WEEKDAYS[schedForm.dayOfWeek]}</strong></span>}
              {(schedForm.intervalType === 'monthly' || schedForm.intervalType === 'quarterly') && <span>Date: <strong className="text-slate-900 dark:text-white">{schedForm.dayOfMonth}</strong></span>}
              <span>Rooms: <strong className="text-slate-900 dark:text-white">{schedForm.roomNumbers.length > 0 ? schedForm.roomNumbers.join(', ') : 'All rooms'}</strong></span>
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* Schedules panel */}
      {showSchedules && (
        <SectionCard pad="md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarClock size={16} className="text-indigo-500" />
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Inspection Schedules</h3>
              {schedules.length > 0 && <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-black">{schedules.length}</span>}
            </div>
            <button onClick={openScheduleForm} className={button.primary}>
              <Plus size={14} /> New Schedule
            </button>
          </div>

          {schedules.length === 0 ? (
            <div className="text-center py-8 text-[10px] font-bold text-slate-400 uppercase">
              No schedules configured. Click "New Schedule" to automate recurring inspections.
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map(s => (
                <div key={s.id} className={`flex items-center gap-3 p-3 rounded-2xl border transition ${s.enabled ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900' : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 opacity-60'}`}>
                  <button
                    onClick={() => toggleSchedule(s.id, s.enabled)}
                    title={s.enabled ? 'Disable' : 'Enable'}
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition ${s.enabled ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20' : 'bg-slate-200 text-slate-400 dark:bg-slate-800'}`}
                  >
                    <Power size={14} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900 dark:text-white truncate">{s.name}</span>
                      <Badge tone={s.enabled ? 'success' : 'neutral'} variant="soft">{s.enabled ? 'Active' : 'Paused'}</Badge>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                      {s.intervalType === 'days' ? `Every ${s.intervalDays || 2} days` : INTERVAL_LABELS[s.intervalType]} at {s.timeOfDay}
                      {s.intervalType === 'weekly' && ` · ${WEEKDAYS[s.dayOfWeek ?? 0]}`}
                      {(s.intervalType === 'monthly' || s.intervalType === 'quarterly') && ` · Day ${s.dayOfMonth}`}
                      {s.roomNumbers && s.roomNumbers.length > 0 ? ` · Rooms ${s.roomNumbers.join(', ')}` : ' · All rooms'}
                      {s.inspector && ` · ${s.inspector}`}
                    </p>
                    {s.lastRun && <p className="text-[9px] text-slate-400 font-mono mt-0.5">Last run: {new Date(s.lastRun).toLocaleString()}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => triggerSchedule(s.id)}
                      disabled={triggeringId === s.id}
                      title="Run now — create inspections immediately"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition disabled:opacity-50"
                    >
                      {triggeringId === s.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    </button>
                    <button
                      onClick={() => deleteSchedule(s.id)}
                      title="Delete schedule"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Passed" value={counts.pass} icon={CheckCircle2} tone="success" />
        <StatCard title="Failed" value={counts.fail} icon={XCircle} tone="danger" />
        <StatCard title="Rework Required" value={counts.rework} icon={RefreshCw} tone="warning" />
        <StatCard title="Pending" value={counts.pending} icon={ClipboardCheck} tone="neutral" />
      </div>

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1">
            {(['All', 'Pending', 'Pass', 'Fail', 'Rework Required'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${filter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input placeholder="Search room, inspector..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
          </div>
        </div>
      </SectionCard>

      {loading && inspections.length === 0 && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-10 rounded-2xl flex items-center justify-center gap-3 text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading inspections…
        </div>
      )}

      {error && !loading && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-8 rounded-2xl text-center">
          <ServerCrash className="w-8 h-8 mx-auto mb-2 text-rose-500" />
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={fetchInspections} className={`mt-3 ${button.secondary}`}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Inspection list table — grouped by room */}
          {filtered.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl text-center text-[10px] font-bold text-slate-400 uppercase">
              {search || filter !== 'All' ? 'No inspections match the filters.' : 'No inspections found.'}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700 text-[10px] font-black text-gray-500 uppercase tracking-wider">
                      <th className="text-left px-4 py-3 w-8"></th>
                      <th className="text-left px-4 py-3">Room</th>
                      <th className="text-left px-4 py-3 hidden sm:table-cell">Floor</th>
                      <th className="text-left px-4 py-3 hidden md:table-cell">Last Inspected</th>
                      <th className="text-left px-4 py-3">Latest Result</th>
                      <th className="text-left px-4 py-3">Recommendation</th>
                      <th className="text-left px-4 py-3 hidden lg:table-cell">Inspector</th>
                      <th className="text-left px-4 py-3 hidden xl:table-cell">History</th>
                      <th className="text-left px-4 py-3 w-28">Progress</th>
                      <th className="text-right px-4 py-3 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {grouped.map(({ room, inspections: roomInsps }) => {
                      const latest = roomInsps[0];
                      const isExpanded = expandedRoom === room;
                      const vals = Object.values(latest.items);
                      const done = vals.filter(v => v !== 'Pending').length;
                      const pct = Math.round((done / vals.length) * 100);
                      const decidingTone = latest.recommendedAction
                        ? (ACTION_TONE[latest.recommendedAction] ?? RESULT_TONE[latest.result])
                        : RESULT_TONE[latest.result];
                      // History summary: count by result
                      const historyCount = roomInsps.length;
                      const passCount = roomInsps.filter(i => i.result === 'Pass').length;
                      const failCount = roomInsps.filter(i => i.result === 'Fail').length;
                      return (
                        <React.Fragment key={room}>
                          <tr
                            onClick={() => setDetailId(latest.id)}
                            className={`cursor-pointer transition border-l-4 ${
                              statusTone[decidingTone].border
                            } ${isExpanded ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}
                          >
                            <td className="px-4 py-3" onClick={(e) => { if (historyCount > 1) { e.stopPropagation(); setExpandedRoom(isExpanded ? null : room); } }}>
                              {historyCount > 1 ? (
                                <button className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                                  {isExpanded
                                    ? <ChevronDown size={14} className="text-slate-400" />
                                    : <ChevronRight size={14} className="text-slate-400" />}
                                </button>
                              ) : (
                                <span className="w-3.5" />
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${statusTone[decidingTone].dot}`} />
                                <span className="font-black text-gray-900 dark:text-white">{room}</span>
                                {historyCount > 1 && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[9px] font-black">{historyCount}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell text-gray-600 dark:text-gray-300">{latest.floor || '—'}</td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">{latest.date}</div>
                              <div className="text-[9px] text-slate-400 mt-0.5">
                                {historyCount > 1 ? `${historyCount - 1} prior inspection${historyCount > 2 ? 's' : ''}` : 'First inspection'}
                              </div>
                            </td>
                            <td className="px-4 py-3"><Badge tone={RESULT_TONE[latest.result]} variant="solid">{latest.result}</Badge></td>
                            <td className="px-4 py-3">
                              {latest.recommendedAction ? (
                                <Badge tone={ACTION_TONE[latest.recommendedAction] ?? 'neutral'} variant="soft">{latest.recommendedAction}</Badge>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">No recommendation</span>
                              )}
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{latest.inspector || 'Unassigned'}</td>
                            <td className="px-4 py-3 hidden xl:table-cell">
                              {historyCount > 1 ? (
                                <div className="flex items-center gap-1.5 text-[10px] font-bold">
                                  <span className="text-emerald-600">{passCount}P</span>
                                  <span className="text-rose-500">{failCount}F</span>
                                  <span className="text-slate-400">{historyCount - passCount - failCount}O</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden min-w-[36px]">
                                  <div className={`h-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={`text-[10px] font-bold tabular-nums shrink-0 ${pct === 100 ? 'text-emerald-500' : 'text-indigo-500'}`}>{pct}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={(e) => { e.stopPropagation(); printInspection(latest); }}
                                title={`Print Room ${room} latest inspection`}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition"
                              >
                                <Printer size={14} />
                              </button>
                            </td>
                          </tr>
                          {/* Expanded history rows */}
                          {isExpanded && roomInsps.slice(1).map((i) => {
                            const hVals = Object.values(i.items);
                            const hDone = hVals.filter(v => v !== 'Pending').length;
                            const hPct = Math.round((hDone / hVals.length) * 100);
                            const hTone = i.recommendedAction
                              ? (ACTION_TONE[i.recommendedAction] ?? RESULT_TONE[i.result])
                              : RESULT_TONE[i.result];
                            return (
                              <tr
                                key={i.id}
                                onClick={() => setDetailId(i.id)}
                                className={`cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/40 transition border-l-4 ${statusTone[hTone].border}`}
                              >
                                <td className="px-4 py-2.5">
                                  <History size={12} className="text-slate-300 dark:text-slate-600" />
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-[10px] text-slate-400 font-mono">{i.id}</span>
                                </td>
                                <td className="px-4 py-2.5 hidden sm:table-cell text-[10px] text-slate-400">{i.floor || '—'}</td>
                                <td className="px-4 py-2.5 hidden md:table-cell">
                                  <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{i.date}</span>
                                </td>
                                <td className="px-4 py-2.5"><Badge tone={RESULT_TONE[i.result]} variant="soft">{i.result}</Badge></td>
                                <td className="px-4 py-2.5">
                                  {i.recommendedAction ? (
                                    <Badge tone={ACTION_TONE[i.recommendedAction] ?? 'neutral'} variant="soft">{i.recommendedAction}</Badge>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 hidden lg:table-cell text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[120px]">{i.inspector || 'Unassigned'}</td>
                                <td className="px-4 py-2.5 hidden xl:table-cell">
                                  {i.notes ? (
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate block max-w-[180px]" title={i.notes}>{i.notes}</span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className={`text-[10px] font-bold tabular-nums ${hPct === 100 ? 'text-emerald-500' : 'text-slate-400'}`}>{hPct}%</span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); printInspection(i); }}
                                    title={`Print this inspection`}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition"
                                  >
                                    <Printer size={12} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Inspection detail popup */}
          <ModalSystem
            isOpen={!!selected}
            onClose={() => setDetailId(null)}
            title={selected ? `Room ${selected.room} Inspection` : ''}
            subtitle={selected ? `${selected.id} · ${selected.inspector || 'Unassigned'} · ${selected.date}` : ''}
            variant="form"
            size="lg"
            showFooter={false}
          >
            {selected && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge tone={RESULT_TONE[selected.result]} variant="solid">{selected.result}</Badge>
                    {selected.recommendedAction && (
                      <Badge tone={ACTION_TONE[selected.recommendedAction] ?? 'neutral'} variant="soft">{selected.recommendedAction}</Badge>
                    )}
                  </div>
                  <button
                    onClick={() => printInspection(selected)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${button.secondary}`}
                  >
                    <Printer size={12} /> Print
                  </button>
                </div>

                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Inspection Checklist</p>
                  <div className="space-y-2">
                    {CHECK_ITEMS.map(({ key, icon: Icon }) => {
                      const state = selected.items[key];
                      const isSaving = savingItem?.id === selected.id && savingItem?.item === key;
                      return (
                        <div key={key} className="flex items-center gap-3 p-2.5 rounded-2xl border border-slate-100 dark:border-slate-800">
                          <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400"><Icon size={14} /></div>
                          <span className="text-[11px] font-black uppercase tracking-tight text-slate-700 dark:text-slate-200 flex-1">{key}</span>
                          <div className="flex gap-1">
                            {(['Pass', 'Fail', 'Pending'] as ItemState[]).map(s => (
                              <button
                                key={s}
                                onClick={() => setItem(selected.id, key, s)}
                                disabled={!!isSaving}
                                className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition ${
                                  state === s
                                    ? statusTone[ITEM_TONE[s]].badge
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:bg-slate-100'
                                } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                {isSaving ? <Loader2 size={10} className="animate-spin" /> : (s === 'Pending' ? '—' : s)}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Inspector + recommended action + notes */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Inspector & Recommendation</p>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase text-gray-500">Assigned Inspector</label>
                      <div className="flex gap-2">
                        <select
                          value={editInspector}
                          onChange={e => setEditInspector(e.target.value)}
                          className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="">Unassigned</option>
                          {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                        <input
                          placeholder="or type a name…"
                          value={editInspector && !staff.some(s => s.name === editInspector) ? editInspector : ''}
                          onChange={e => setEditInspector(e.target.value)}
                          className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      {staff.length === 0 && <p className="text-[9px] text-slate-400">No staff loaded — type a name manually.</p>}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase text-gray-500">Recommended Action</label>
                      <div className="flex flex-wrap gap-2">
                        {RECOMMENDED_ACTIONS.map(a => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setEditAction(a)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tight transition border-2 ${
                              editAction === a
                                ? `${statusTone[ACTION_TONE[a] ?? 'neutral'].badge} border-transparent`
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                            }`}
                          >
                            {a}
                          </button>
                        ))}
                        {editAction && (
                          <button
                            type="button"
                            onClick={() => setEditAction('')}
                            className="px-2 py-1.5 rounded-xl text-[10px] font-bold text-slate-400 hover:text-slate-600 transition"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase text-gray-500">Notes</label>
                      <textarea
                        placeholder="Inspector notes, observations, follow-up details…"
                        value={editNotes}
                        onChange={e => setEditNotes(e.target.value)}
                        rows={3}
                        className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    </div>

                    <button
                      onClick={saveMeta}
                      disabled={savingMeta}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition disabled:opacity-50 ${button.primary}`}
                    >
                      {savingMeta ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}
          </ModalSystem>
        </>
      )}
    </div>
  );
}
