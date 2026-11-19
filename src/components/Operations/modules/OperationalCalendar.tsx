/**
 * Operational Calendar — Operations Portal (/erp/operations/calandar).
 *
 * Central planning calendar aggregating live events from every portal:
 * banquet_events (weddings/conferences/galas), VIP arrivals
 * (reservations join guests.status='VIP'), pm_schedules (Engineering),
 * hr_training_sessions, fb/rms/sales promotions, sec_compliance_audits,
 * fin_external_audits, group_blocks, and ops_cross_dept_tasks — plus
 * ops-native rows in ops_calendar_events (migration 635: holidays,
 * drills, manual items), which are the only editable events.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  MapPin,
  Users,
  Star,
  Wrench,
  Flame,
  Award,
  Briefcase,
  Heart,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ClipboardCheck,
  Trash2,
  Building,
  ArrowRightLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsCalendar,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type OpsCalendarEvent,
  type CalendarEventType,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; icon: LucideIcon; tone: StatusTone; chip: string }> = {
  conference: { label: 'Conference', icon: Users, tone: 'info', chip: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  wedding: { label: 'Wedding', icon: Heart, tone: 'info', chip: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300' },
  holiday: { label: 'Holiday', icon: Award, tone: 'success', chip: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
  vip: { label: 'VIP', icon: Star, tone: 'warning', chip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  maintenance: { label: 'Maintenance', icon: Wrench, tone: 'neutral', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
  promotion: { label: 'Promotion', icon: Briefcase, tone: 'info', chip: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  drill: { label: 'Drill', icon: Flame, tone: 'danger', chip: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
  training: { label: 'Training', icon: ClipboardCheck, tone: 'info', chip: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
  audit: { label: 'Audit', icon: Award, tone: 'info', chip: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
  event: { label: 'Event', icon: Calendar, tone: 'neutral', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
  group: { label: 'Group Check-in', icon: Building, tone: 'info', chip: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
  task: { label: 'Coordination Task', icon: ArrowRightLeft, tone: 'warning', chip: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' },
};

const meta = (t: string) => TYPE_META[t] || TYPE_META.event;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ── Component ────────────────────────────────────────────────────────────

const OperationalCalendar: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [typeFilter, setTypeFilter] = useState<'all' | CalendarEventType>('all');
  const [events, setEvents] = useState<OpsCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<OpsCalendarEvent | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '', date: isoDay(new Date()), endDate: '', type: 'event' as CalendarEventType,
    location: '', attendees: '', description: '',
  });

  const anchorDate = isoDay(currentDate);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetchOpsCalendar(currentPropertyId || undefined, anchorDate);
      setEvents(res.events);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load calendar');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPropertyId, anchorDate]);

  useEffect(() => { load(); }, [load]);

  const filteredEvents = useMemo(
    () => events.filter(e => typeFilter === 'all' || e.type === typeFilter),
    [events, typeFilter],
  );

  const eventsByDay = useMemo(() => {
    const m = new Map<string, OpsCalendarEvent[]>();
    for (const e of filteredEvents) {
      const key = String(e.date).slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [filteredEvents]);

  // Week / day windows
  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
  }), [weekStart]);

  const stats = useMemo(() => {
    const inMonth = filteredEvents.filter(e => String(e.date).startsWith(anchorDate.slice(0, 7)));
    return {
      total: filteredEvents.length,
      thisMonth: inMonth.length,
      upcoming: filteredEvents.filter(e => String(e.date) >= isoDay(new Date())).length,
      vip: filteredEvents.filter(e => e.type === 'vip' || e.type === 'wedding').length,
    };
  }, [filteredEvents, anchorDate]);

  // ── Actions ────────────────────────────────────────────────────────────

  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const submitCreate = async () => {
    if (!newEvent.title.trim() || !newEvent.date) return;
    setBusy(true);
    try {
      await createCalendarEvent({
        propertyId: currentPropertyId || undefined,
        title: newEvent.title.trim(),
        date: newEvent.date,
        endDate: newEvent.endDate || undefined,
        type: newEvent.type,
        location: newEvent.location.trim() || undefined,
        attendees: newEvent.attendees ? Number(newEvent.attendees) : undefined,
        description: newEvent.description.trim() || undefined,
      });
      setNewEvent({ title: '', date: isoDay(new Date()), endDate: '', type: 'event', location: '', attendees: '', description: '' });
      setIsCreating(false);
      addNotification('Event added to the operational calendar.', 'task', 'Executive');
      load(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create event', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (e: OpsCalendarEvent) => {
    if (!e.editable || !e.sourceId) return;
    setBusy(true);
    try {
      await deleteCalendarEvent(e.sourceId);
      setSelectedEvent(null);
      addNotification('Event deleted.', 'task', 'Executive');
      load(true);
    } catch (err: any) {
      addNotification(err?.message || 'Failed to delete event', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const eventChip = (e: OpsCalendarEvent) => {
    const Icon = meta(e.type).icon;
    return (
      <button
        key={e.id}
        onClick={() => setSelectedEvent(e)}
        className={`w-full text-left text-xs px-1.5 py-0.5 rounded truncate flex items-center gap-1 ${meta(e.type).chip}`}
        title={e.title}
      >
        <Icon size={10} className="shrink-0" />
        <span className="truncate">{e.title}</span>
      </button>
    );
  };

  const renderDayCell = (day: Date, inMonth: boolean) => {
    const key = isoDay(day);
    const dayEvents = eventsByDay.get(key) || [];
    const isToday = key === isoDay(new Date());
    return (
      <div
        key={key}
        className={`min-h-[96px] border border-gray-100 dark:border-slate-700/60 p-1.5 ${
          inMonth ? 'bg-white dark:bg-slate-800' : 'bg-gray-50 dark:bg-slate-900/50'
        } ${isToday ? 'ring-1 ring-inset ring-[var(--color-accent-operations)]' : ''}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs font-semibold ${inMonth ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600'} ${isToday ? 'text-[var(--color-accent-operations)]' : ''}`}>
            {day.getDate()}
          </span>
          {dayEvents.length > 0 && <span className="text-[10px] text-gray-400">{dayEvents.length}</span>}
        </div>
        <div className="space-y-0.5">
          {dayEvents.slice(0, 3).map(eventChip)}
          {dayEvents.length > 3 && (
            <div className="text-[10px] text-gray-500 px-1">+{dayEvents.length - 3} more</div>
          )}
        </div>
      </div>
    );
  };

  const monthGrid = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const cells: React.ReactNode[] = [];
    for (let i = first.getDay(); i > 0; i--) {
      const d = new Date(first); d.setDate(d.getDate() - i);
      cells.push(renderDayCell(d, false));
    }
    for (let d = 1; d <= last.getDate(); d++) {
      cells.push(renderDayCell(new Date(year, month, d), true));
    }
    let padDay = 1;
    while (cells.length % 7 !== 0) {
      cells.push(renderDayCell(new Date(year, month + 1, padDay++), false));
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, eventsByDay]);

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Operational Calendar"
        subtitle="Central planning calendar — live events from all departments"
        icon={Calendar}
        actions={
          <>
            <Badge tone="info">{stats.thisMonth} this month</Badge>
            <button onClick={() => setIsCreating(!isCreating)} className={button.primary}>
              {isCreating ? <X size={16} /> : <Plus size={16} />}
              {isCreating ? 'Cancel' : 'Add Event'}
            </button>
            <button onClick={() => load(true)} disabled={refreshing} className={button.secondary} title="Refresh">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <AlertTriangle size={18} className="text-[var(--color-warning)] shrink-0" />
          <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{error}</p>
          <button onClick={() => load()} className={button.secondary}>Retry</button>
        </div>
      )}

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Events in Window" value={stats.total} icon={Calendar} tone="info" caption="all departments" />
        <StatCard title="This Month" value={stats.thisMonth} icon={Clock} tone="neutral" caption={currentDate.toLocaleDateString('en-US', { month: 'long' })} />
        <StatCard title="Upcoming" value={stats.upcoming} icon={ChevronRight} tone="success" caption="from today onward" />
        <StatCard title="VIP / Weddings" value={stats.vip} icon={Star} tone="warning" caption="high-touch events" />
      </div>

      {/* Create form */}
      {isCreating && (
        <SectionCard title="New Calendar Event" icon={Plus} pad="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" placeholder="Event title…" value={newEvent.title}
                onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none md:col-span-2" />
              <select value={newEvent.type} onChange={e => setNewEvent({ ...newEvent, type: e.target.value as CalendarEventType })}
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none">
                {Object.entries(TYPE_META).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date</label>
                <input type="date" value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">End (optional)</label>
                <input type="date" value={newEvent.endDate} onChange={e => setNewEvent({ ...newEvent, endDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none" />
              </div>
              <input type="text" placeholder="Location…" value={newEvent.location}
                onChange={e => setNewEvent({ ...newEvent, location: e.target.value })}
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none self-end" />
              <input type="number" placeholder="Attendees" value={newEvent.attendees}
                onChange={e => setNewEvent({ ...newEvent, attendees: e.target.value })}
                className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none self-end" />
            </div>
            <textarea placeholder="Description…" value={newEvent.description} rows={2}
              onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none resize-none" />
            <button onClick={submitCreate} disabled={!newEvent.title.trim() || !newEvent.date || busy} className={button.primary}>
              <Plus size={16} /> Add Event
            </button>
          </div>
        </SectionCard>
      )}

      {/* Controls */}
      <SectionCard pad="md">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <ChevronLeft size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {viewMode === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {viewMode === 'week' && `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
              {viewMode === 'day' && currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h2>
            <button onClick={() => navigate(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <ChevronRight size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className={button.secondary}>Today</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
              {(['month', 'week', 'day'] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none">
              <option value="all">All Events</option>
              {Object.entries(TYPE_META).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Views */}
      {viewMode === 'month' ? (
        <SectionCard pad="none" className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-200 dark:border-slate-700">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-3 text-center text-sm font-semibold text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-slate-900/50">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">{monthGrid}</div>
        </SectionCard>
      ) : viewMode === 'week' ? (
        <SectionCard title={`Week of ${weekStart.toLocaleDateString()}`} icon={Calendar} pad="md">
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {weekDays.map(d => {
              const dayEvents = eventsByDay.get(isoDay(d)) || [];
              return (
                <div key={isoDay(d)} className="min-h-[140px] rounded-xl border border-gray-200 dark:border-slate-700 p-2 bg-gray-50 dark:bg-slate-900/40">
                  <p className={`text-xs font-bold mb-2 ${isoDay(d) === isoDay(new Date()) ? 'text-[var(--color-accent-operations)]' : 'text-gray-600 dark:text-gray-400'}`}>
                    {d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                  </p>
                  <div className="space-y-1">{dayEvents.map(eventChip)}</div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title={currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} icon={Calendar} pad="lg">
          {(eventsByDay.get(isoDay(currentDate)) || []).length === 0 ? (
            <div className="text-center py-10">
              <Calendar size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No events scheduled</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(eventsByDay.get(isoDay(currentDate)) || []).map(e => {
                const Icon = meta(e.type).icon;
                return (
                  <button key={e.id} onClick={() => setSelectedEvent(e)}
                    className="w-full text-left p-4 rounded-xl bg-gray-50 dark:bg-slate-900/50 hover:shadow transition-all flex items-center gap-3">
                    <Icon size={18} className="text-[var(--color-accent-operations)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{e.title}</p>
                      <p className="text-xs text-gray-500">{e.source}{e.location ? ` · ${e.location}` : ''}</p>
                    </div>
                    <Badge tone={meta(e.type).tone}>{meta(e.type).label}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* Legend */}
      <SectionCard pad="md">
        <div className="flex items-center gap-4 flex-wrap text-xs text-gray-500">
          <span className="font-semibold uppercase tracking-wide">Sources:</span>
          {Array.from(new Set(events.map(e => e.source))).map(s => <span key={s}>{s}</span>)}
        </div>
      </SectionCard>

      {/* Event detail modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedEvent(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 dark:text-white">Event Details</h3>
              <button onClick={() => setSelectedEvent(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors">
                <X size={20} className="text-gray-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge tone={meta(selectedEvent.type).tone} icon={meta(selectedEvent.type).icon}>
                  {meta(selectedEvent.type).label}
                </Badge>
                <Badge tone="neutral">{selectedEvent.source}</Badge>
                {selectedEvent.editable && <Badge tone="success">Editable</Badge>}
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white text-lg">{selectedEvent.title}</h4>
                {selectedEvent.description && (
                  <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">{selectedEvent.description}</p>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-gray-500" />
                  <span className="text-gray-900 dark:text-white">
                    {new Date(selectedEvent.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    {selectedEvent.endDate && selectedEvent.endDate !== selectedEvent.date &&
                      ` → ${new Date(selectedEvent.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </span>
                </div>
                {selectedEvent.location && (
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-gray-500" />
                    <span className="text-gray-900 dark:text-white">{selectedEvent.location}</span>
                  </div>
                )}
                {selectedEvent.attendees != null && (
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-gray-500" />
                    <span className="text-gray-900 dark:text-white">{selectedEvent.attendees} attendees</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                {selectedEvent.editable && (
                  <button onClick={() => removeEvent(selectedEvent)} disabled={busy}
                    className="flex-1 py-2 bg-[var(--color-danger)]/10 text-[var(--color-danger)] rounded-lg hover:bg-[var(--color-danger)]/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                    <Trash2 size={16} /> Delete
                  </button>
                )}
                <button onClick={() => setSelectedEvent(null)} className={`${button.secondary} flex-1`}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperationalCalendar;
