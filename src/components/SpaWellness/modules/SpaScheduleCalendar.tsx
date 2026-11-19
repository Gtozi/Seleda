/**
 * Spa Schedule Calendar
 * Day-view resource scheduler for Appointment Management. Columns can be
 * grouped by Providers (therapists/trainers), Rooms, Facilities (room types),
 * or Specialties. Clicking an appointment opens its detail; clicking an empty
 * slot opens the create form seeded with that date/time/resource.
 *
 * Data: GET /api/spa-wellness/appointments?date=… plus the same lookup lists
 * (treatments, therapists, rooms) already loaded by the parent module.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
  Home,
  LayoutGrid,
  Sparkles,
  Loader2,
  Pencil,
  X,
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { SectionCard, Badge } from '../../FrontOffice/ui';
import { button, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

export interface CalendarAppointment {
  id: string;
  guestName: string;
  guestId: string;
  treatment: string;
  treatmentId: string;
  therapist: string;
  therapistId: string;
  room: string;
  roomId: string;
  date: string;
  time: string;
  duration: number;
  status: string;
}

export interface CalendarTreatment {
  id: string;
  name: string;
  category: string;
  room_type?: string | null;
}

export interface CalendarTherapist {
  id: string;
  name: string;
  title: string;
  specialties?: string[];
  status?: string;
}

export interface CalendarRoom {
  id: string;
  name: string;
  room_type: string;
  status?: string;
  category?: string;
}

export interface CreateSeed {
  date: string;
  time: string;
  therapistId?: string;
  roomId?: string;
}

interface SpaScheduleCalendarProps {
  treatments: CalendarTreatment[];
  therapists: CalendarTherapist[];
  rooms: CalendarRoom[];
  onSelect: (appointmentId: string) => void;
  onCreateAt: (seed: CreateSeed) => void;
}

type GroupBy = 'provider' | 'room' | 'facility' | 'specialty';

const DAY_START_MIN = 7 * 60;   // 07:00
const DAY_END_MIN = 21 * 60;    // 21:00
const PX_PER_HOUR = 56;
const TOTAL_MIN = DAY_END_MIN - DAY_START_MIN;
const GRID_HEIGHT = (TOTAL_MIN / 60) * PX_PER_HOUR;

const STATUS_TONE: Record<string, StatusTone> = {
  Requested: 'neutral',
  Confirmed: 'info',
  'Checked In': 'accent',
  'In Treatment': 'warning',
  Completed: 'success',
  Cancelled: 'danger',
  'No Show': 'danger',
  Rescheduled: 'warning',
};

const GROUP_OPTIONS: { key: GroupBy; label: string; icon: any }[] = [
  { key: 'provider', label: 'Providers', icon: Users },
  { key: 'room', label: 'Rooms', icon: Home },
  { key: 'facility', label: 'Facilities', icon: LayoutGrid },
  { key: 'specialty', label: 'Specialties', icon: Sparkles },
];

function toMinutes(t: string): number {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Lane {
  key: string;
  label: string;
  sublabel?: string;
  resourceId?: string;
  resourceKind?: 'provider' | 'room';
  offline?: boolean;
}

interface ProviderSchedule {
  therapist_id: string;
  employee_id: string | null;
  rostered: boolean;
  shift: string;
  is_off: boolean;
  window: { start: number; end: number } | null;
}

const ROSTER_SHIFTS = ['Morning', 'Evening', 'Night', 'Off'] as const;

const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';
const labelCls = 'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5';

const SpaScheduleCalendar: React.FC<SpaScheduleCalendarProps> = ({
  treatments,
  therapists,
  rooms,
  onSelect,
  onCreateAt,
}) => {
  const { currentPropertyId } = useERP();
  const [calDate, setCalDate] = useState(todayIso());
  const [groupBy, setGroupBy] = useState<GroupBy>('provider');
  const [specialtyFilter, setSpecialtyFilter] = useState('All');
  const [facilityFilter, setFacilityFilter] = useState('All');
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [schedule, setSchedule] = useState<Record<string, ProviderSchedule>>({});
  const [loading, setLoading] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<ProviderSchedule | null>(null);
  const [editorShift, setEditorShift] = useState<string>('Morning');
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const fetchDay = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: calDate });
      if (currentPropertyId) params.append('propertyId', currentPropertyId);
      const [res, schedRes] = await Promise.all([
        fetch(`/api/spa-wellness/appointments?${params}`, { credentials: 'include' }),
        fetch(`/api/spa-wellness/provider-schedule?${params}`, { credentials: 'include' }),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (schedRes.ok) {
        const sched = await schedRes.json();
        const map: Record<string, ProviderSchedule> = {};
        for (const p of sched.providers || []) map[p.therapist_id] = p;
        setSchedule(map);
      }
      setAppointments((rows || []).map((r: any) => ({
        id: r.id,
        guestName: r.guest_name,
        guestId: r.guest_id || '',
        treatment: r.treatment,
        treatmentId: r.treatment_id || '',
        therapist: r.therapist || 'Unassigned',
        therapistId: r.therapist_id || '',
        room: r.room || 'TBD',
        roomId: r.room_id || '',
        date: r.appointment_date,
        time: r.start_time,
        duration: r.duration_minutes,
        status: r.status,
      })));
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [calDate, currentPropertyId]);

  useEffect(() => { fetchDay(); }, [fetchDay]);

  const allSpecialties = useMemo(
    () => [...new Set(therapists.flatMap(t => t.specialties || []))].sort(),
    [therapists]
  );
  const allFacilities = useMemo(
    () => [...new Set(rooms.map(r => r.room_type))].sort(),
    [rooms]
  );

  // Build the lane list for the active grouping.
  const lanes: Lane[] = useMemo(() => {
    if (groupBy === 'provider') {
      const filtered = specialtyFilter === 'All'
        ? therapists
        : therapists.filter(t => (t.specialties || []).includes(specialtyFilter));
      return [
        ...filtered.map(t => {
          const sched = schedule[t.id];
          const off = sched?.is_off || t.status === 'Inactive';
          const sub = off
            ? 'Day Off'
            : sched?.window
              ? `${sched.shift} · ${fmtTime(sched.window.start)}–${fmtTime(Math.min(sched.window.end, DAY_END_MIN))}`
              : t.title;
          return {
            key: t.id, label: t.name, sublabel: sub,
            resourceId: t.id, resourceKind: 'provider' as const,
            offline: off,
          };
        }),
        { key: '__none', label: 'Unassigned', sublabel: 'No provider' },
      ];
    }
    if (groupBy === 'room') {
      const filtered = facilityFilter === 'All'
        ? rooms
        : rooms.filter(r => r.room_type === facilityFilter);
      return [
        ...filtered.map(r => ({
          key: r.id, label: r.name, sublabel: r.room_type,
          resourceId: r.id, resourceKind: 'room' as const,
          offline: r.status === 'Maintenance' || r.status === 'Out of Service',
        })),
        { key: '__none', label: 'Unassigned', sublabel: 'No room' },
      ];
    }
    if (groupBy === 'facility') {
      const filtered = facilityFilter === 'All'
        ? allFacilities
        : allFacilities.filter(f => f === facilityFilter);
      return [
        ...filtered.map(f => ({ key: f, label: f, sublabel: `${rooms.filter(r => r.room_type === f).length} rooms` })),
        { key: '__none', label: 'Unassigned', sublabel: 'No room' },
      ];
    }
    // specialty
    const filtered = specialtyFilter === 'All'
      ? allSpecialties
      : allSpecialties.filter(s => s === specialtyFilter);
    return [
      ...filtered.map(s => ({
        key: s, label: s,
        sublabel: `${therapists.filter(t => (t.specialties || []).includes(s)).length} providers`,
      })),
      { key: '__none', label: 'Other', sublabel: 'No matching specialty' },
    ];
  }, [groupBy, therapists, rooms, allFacilities, allSpecialties, specialtyFilter, facilityFilter, schedule]);

  // Map each appointment into a lane.
  const laneOf = useCallback((a: CalendarAppointment): string => {
    if (groupBy === 'provider') return a.therapistId || '__none';
    if (groupBy === 'room') return a.roomId || '__none';
    if (groupBy === 'facility') {
      const room = rooms.find(r => r.id === a.roomId);
      return room?.room_type || '__none';
    }
    // specialty: prefer a therapist specialty that appears in the treatment name/category
    const th = therapists.find(t => t.id === a.therapistId);
    const specs = th?.specialties || [];
    const tname = `${a.treatment} ${treatments.find(t => t.id === a.treatmentId)?.category || ''}`.toLowerCase();
    const match = specs.find(s => tname.includes(s.toLowerCase()));
    return match || specs[0] || '__none';
  }, [groupBy, rooms, therapists, treatments]);

  const byLane = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    for (const a of appointments) {
      const k = laneOf(a);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [appointments, laneOf]);

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) marks.push(m);
    return marks;
  }, []);

  const saveSchedule = async () => {
    if (!scheduleEditor) return;
    setEditorSaving(true);
    setEditorError(null);
    try {
      const res = await fetch('/api/spa-wellness/provider-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          therapistId: scheduleEditor.therapist_id,
          date: calDate,
          shift: editorShift,
          propertyId: currentPropertyId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setScheduleEditor(null);
      await fetchDay();
    } catch (e: any) {
      setEditorError(e.message || 'Failed to save schedule');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleLaneClick = (lane: Lane, e: React.MouseEvent<HTMLDivElement>) => {
    if (lane.resourceKind === 'provider' && lane.offline) return; // day off — no bookings
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    const raw = DAY_START_MIN + frac * TOTAL_MIN;
    const snapped = Math.round(raw / 30) * 30;
    if (snapped >= DAY_END_MIN) return;
    onCreateAt({
      date: calDate,
      time: fmtTime(snapped),
      therapistId: lane.resourceKind === 'provider' ? lane.resourceId : undefined,
      roomId: lane.resourceKind === 'room' ? lane.resourceId : undefined,
    });
  };

  const dayLabel = new Date(calDate + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <SectionCard
      title="Schedule Calendar"
      subtitle={`${dayLabel} · ${appointments.length} appointment${appointments.length === 1 ? '' : 's'}`}
      icon={CalendarDays}
      tone="accent"
      pad="none"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          {/* Grouping selector */}
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {GROUP_OPTIONS.map(g => (
              <button
                key={g.key}
                onClick={() => setGroupBy(g.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
                  groupBy === g.key
                    ? 'bg-[var(--color-accent-spa)] text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <g.icon className="w-3.5 h-3.5" /> {g.label}
              </button>
            ))}
          </div>
          {/* Specialty filter (providers / specialty views) */}
          {(groupBy === 'provider' || groupBy === 'specialty') && (
            <select
              value={specialtyFilter}
              onChange={e => setSpecialtyFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              <option value="All">All Specialties</option>
              {allSpecialties.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {/* Facility filter (rooms / facility views) */}
          {(groupBy === 'room' || groupBy === 'facility') && (
            <select
              value={facilityFilter}
              onChange={e => setFacilityFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              <option value="All">All Facilities</option>
              {allFacilities.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => setCalDate(d => shiftDate(d, -1))} className={button.ghost} title="Previous day">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setCalDate(todayIso())} className={button.ghost}>Today</button>
            <button onClick={() => setCalDate(d => shiftDate(d, 1))} className={button.ghost} title="Next day">
              <ChevronRight className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={calDate}
              onChange={e => e.target.value && setCalDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading schedule…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Lane header */}
            <div className="flex border-b border-slate-200 dark:border-slate-700">
              <div className="w-14 shrink-0" />
              {lanes.map(lane => (
                <div key={lane.key} className="flex-1 min-w-[140px] px-2 py-2.5 border-l border-slate-100 dark:border-slate-700/60">
                  <div className="flex items-center gap-1">
                    <div className={`text-xs font-semibold truncate flex-1 ${lane.offline ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>
                      {lane.label}
                    </div>
                    {lane.resourceKind === 'provider' && lane.resourceId && schedule[lane.resourceId]?.employee_id && (
                      <button
                        onClick={() => {
                          const s = schedule[lane.resourceId!];
                          setScheduleEditor(s);
                          setEditorShift(s?.shift && s.shift !== 'Off' ? s.shift : 'Morning');
                          setEditorError(null);
                        }}
                        className="p-0.5 rounded text-slate-300 hover:text-[var(--color-accent-spa)] transition"
                        title="Edit shift / day off"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {lane.offline ? `${lane.sublabel} · offline` : lane.sublabel}
                  </div>
                </div>
              ))}
            </div>

            {/* Time grid */}
            <div className="flex">
              {/* Time labels */}
              <div className="w-14 shrink-0 relative" style={{ height: GRID_HEIGHT }}>
                {hourMarks.map(m => (
                  <div
                    key={m}
                    className="absolute right-2 text-[10px] text-slate-400 -translate-y-1/2"
                    style={{ top: ((m - DAY_START_MIN) / TOTAL_MIN) * GRID_HEIGHT }}
                  >
                    {fmtTime(m)}
                  </div>
                ))}
              </div>

              {/* Lanes */}
              {lanes.map(lane => {
                const laneAppts = byLane.get(lane.key) || [];
                const sched = lane.resourceKind === 'provider' && lane.resourceId ? schedule[lane.resourceId] : undefined;
                const win = sched?.window;
                const shadeTop = win ? Math.max(win.start - DAY_START_MIN, 0) : 0;
                const shadeBottom = win ? Math.max(DAY_END_MIN - win.end, 0) : 0;
                return (
                  <div
                    key={lane.key}
                    onClick={e => handleLaneClick(lane, e)}
                    className={`flex-1 min-w-[140px] relative border-l border-slate-100 dark:border-slate-700/60 ${
                      lane.offline ? 'bg-red-50/40 dark:bg-red-900/10' : 'cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                    }`}
                    style={{ height: GRID_HEIGHT }}
                    title={lane.offline ? 'Day off — not bookable' : 'Click to book this slot'}
                  >
                    {/* Hour lines */}
                    {hourMarks.map(m => (
                      <div
                        key={m}
                        className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-700/50"
                        style={{ top: ((m - DAY_START_MIN) / TOTAL_MIN) * GRID_HEIGHT }}
                      />
                    ))}
                    {/* Off-shift shading (before/after the provider's window) */}
                    {sched && !sched.is_off && win && shadeTop > 0 && (
                      <div
                        className="absolute left-0 right-0 bg-slate-100/70 dark:bg-slate-800/50 pointer-events-none"
                        style={{ top: 0, height: (shadeTop / TOTAL_MIN) * GRID_HEIGHT }}
                      />
                    )}
                    {sched && !sched.is_off && win && shadeBottom > 0 && (
                      <div
                        className="absolute left-0 right-0 bottom-0 bg-slate-100/70 dark:bg-slate-800/50 pointer-events-none"
                        style={{ height: (shadeBottom / TOTAL_MIN) * GRID_HEIGHT }}
                      />
                    )}
                    {/* Day-off banner */}
                    {sched?.is_off && (
                      <div className="absolute inset-x-2 top-2 rounded-md bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 px-2 py-1 text-center text-[10px] font-semibold text-red-600 dark:text-red-300 pointer-events-none">
                        DAY OFF
                      </div>
                    )}
                    {/* Appointment blocks */}
                    {laneAppts.map(a => {
                      const start = toMinutes(a.time);
                      const top = Math.max(((start - DAY_START_MIN) / TOTAL_MIN) * GRID_HEIGHT, 0);
                      const height = Math.max((a.duration / TOTAL_MIN) * GRID_HEIGHT, 22);
                      const tone = STATUS_TONE[a.status] || 'neutral';
                      const cancelled = a.status === 'Cancelled' || a.status === 'No Show';
                      const conflict = Boolean(
                        sched && !cancelled && (
                          sched.is_off ||
                          (win && (start < win.start || start + a.duration > win.end))
                        )
                      );
                      return (
                        <button
                          key={a.id}
                          onClick={e => { e.stopPropagation(); onSelect(a.id); }}
                          className={`absolute left-1 right-1 rounded-lg px-2 py-1 text-left overflow-hidden border shadow-sm hover:shadow-md hover:z-10 transition ${statusTone[tone].soft} ${
                            cancelled ? 'opacity-50 line-through' : ''
                          } ${conflict ? 'ring-2 ring-red-500' : ''}`}
                          style={{ top, height }}
                          title={`${a.guestName} · ${a.treatment} · ${a.time} (${a.duration}m)${conflict ? ' — outside provider schedule!' : ''}`}
                        >
                          <div className="text-[11px] font-semibold leading-tight truncate">{a.time} · {a.guestName}</div>
                          {height > 40 && (
                            <div className="text-[10px] leading-tight truncate opacity-80">
                              {a.treatment}
                              {groupBy !== 'provider' && a.therapistId ? ` · ${a.therapist}` : ''}
                              {groupBy !== 'room' && groupBy !== 'facility' && a.roomId ? ` · ${a.room}` : ''}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status</span>
              {(['Requested', 'Confirmed', 'Checked In', 'In Treatment', 'Completed', 'Cancelled'] as const).map(s => (
                <span key={s} className="flex items-center gap-1.5">
                  <Badge tone={STATUS_TONE[s]}>{s}</Badge>
                </span>
              ))}
              <span className="ml-auto text-[10px] text-slate-400">Click an empty slot to book · click a block for details</span>
            </div>
          </div>
        </div>
      )}

      {/* Provider schedule editor — writes into the shared HR roster */}
      {scheduleEditor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full ring-1 ring-black/5 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-accent-spa)] to-[var(--color-accent-guest)] rounded-t-2xl" />
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {therapists.find(t => t.id === scheduleEditor.therapist_id)?.name || scheduleEditor.therapist_id}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Roster for {new Date(calDate + 'T00:00:00').toLocaleDateString()}
                  {scheduleEditor.rostered ? ' · from HR roster' : ' · no roster entry yet'}
                </p>
              </div>
              <button onClick={() => setScheduleEditor(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {editorError && (
                <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                  {editorError}
                </div>
              )}
              <label className="block">
                <span className={labelCls}>Shift</span>
                <select value={editorShift} onChange={e => setEditorShift(e.target.value)} className={inputCls}>
                  {ROSTER_SHIFTS.map(s => <option key={s} value={s}>{s === 'Off' ? 'Off (day off)' : s}</option>)}
                </select>
              </label>
              <p className="text-[11px] text-slate-400">
                Saved to the shared HR roster (hr_team_roster) — the same grid staff management edits.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 rounded-b-2xl">
              <button onClick={() => setScheduleEditor(null)} className={button.secondary}>Cancel</button>
              <button onClick={saveSchedule} disabled={editorSaving} className={button.primary}>
                {editorSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editorSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
};

export default SpaScheduleCalendar;
