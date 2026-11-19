/**
 * Event & Group Coordination — Operations Portal (/erp/operations/event-coordination).
 *
 * Live coordination board sourced from the Events portal's own tables
 * (banquet_events + banquet_venues + banquet_checklists), FO group_blocks,
 * and ops_cross_dept_tasks for department coverage. Status changes, new
 * events, checklist toggles and coordination tasks all persist to the
 * originating portal tables.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Users,
  MapPin,
  Clock,
  RefreshCw,
  Search,
  Loader2,
  Plus,
  ChevronRight,
  AlertTriangle,
  CheckSquare,
  Square,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchEventCoordination,
  createCoordinationEvent,
  updateCoordinationEvent,
  createEventCoordinationTask,
  toggleChecklistItem,
  BANQUET_EVENT_STATUSES,
  type CoordinationEvent,
  type CoordEventType,
  type CoordEventStatus,
} from '../../../services/operationsService';

const typeLabel = (t: CoordEventType): string =>
  ({ conference: 'Conference', wedding: 'Wedding', banquet: 'Banquet', 'group-checkin': 'Group Check-in', 'group-checkout': 'Group Check-out', event: 'Event' }[t]);

const typeTone = (t: CoordEventType): 'info' | 'danger' | 'warning' | 'success' | 'neutral' =>
  ({ conference: 'info', wedding: 'danger', banquet: 'warning', 'group-checkin': 'success', 'group-checkout': 'neutral', event: 'info' }[t] as any);

const statusTone = (s: CoordEventStatus): 'info' | 'warning' | 'success' | 'neutral' =>
  ({ planning: 'info', setup: 'warning', 'in-progress': 'success', completed: 'neutral' }[s]);

const EVENT_TYPE_OPTIONS = ['Conference', 'Wedding', 'Banquet', 'Meeting', 'CorporateEvent', 'ProductLaunch', 'Exhibition', 'Seminar', 'Birthday', 'Other'];

const toTitle = (s: string) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const EventGroupCoordination: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [stats, setStats] = useState({ total: 0, upcoming: 0, inProgress: 0, attendees: 0, checklistDone: 0, checklistTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | CoordEventType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CoordEventStatus>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', eventType: 'Banquet', date: '', endDate: '', clientName: '', attendees: '', revenue: '', notes: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchEventCoordination(currentPropertyId);
      setEvents(data.events);
      setStats(data.stats);
    } catch (e: any) {
      setError(e?.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const filtered = useMemo(() => events.filter((e) => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (![e.name, e.location, e.coordinator].some((v) => v?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [events, typeFilter, statusFilter, query]);

  const selected = filtered.find((e) => e.id === selectedId) || filtered[0] || null;

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    try { await fn(); await load(); }
    catch (e: any) { addNotification(e?.message || 'Action failed', 'error', 'Executive'); }
    finally { setBusy(null); }
  };

  const submitCreate = () => {
    if (!form.name.trim() || !form.date) return;
    act('create', async () => {
      await createCoordinationEvent({
        propertyId: currentPropertyId,
        name: form.name.trim(),
        date: form.date,
        endDate: form.endDate || undefined,
        eventType: form.eventType,
        clientName: form.clientName || undefined,
        attendees: form.attendees ? Number(form.attendees) : undefined,
        revenue: form.revenue ? Number(form.revenue) : undefined,
        notes: form.notes || undefined,
      });
      setForm({ name: '', eventType: 'Banquet', date: '', endDate: '', clientName: '', attendees: '', revenue: '', notes: '' });
      setShowForm(false);
      addNotification(`${form.name} created — visible in the Events portal.`, 'task', 'Executive');
    });
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={Sparkles}
        title="Event & Group Coordination"
        subtitle="Banquet events, group arrivals and cross-department readiness — sourced live from the Events, Front Office and Ops portals"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.primary} onClick={() => setShowForm(!showForm)}>
              <Plus size={16} /> Add Event
            </button>
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Upcoming Events" icon={Calendar} tone="accent" value={stats.upcoming}
          caption={`${stats.total} total on board`} />
        <StatCard title="In Progress" icon={Clock} tone="success" value={stats.inProgress} />
        <StatCard title="Expected Attendees" icon={Users} tone="info" value={stats.attendees.toLocaleString()} />
        <StatCard title="Checklist Progress" icon={ListChecks} tone="warning"
          value={stats.checklistTotal ? `${Math.round((stats.checklistDone / stats.checklistTotal) * 100)}%` : '—'}
          caption={stats.checklistTotal ? `${stats.checklistDone} of ${stats.checklistTotal} items done` : undefined} />
      </div>

      {/* New event form */}
      {showForm && (
        <SectionCard title="New Event" subtitle="Creates a banquet_events record — appears in the Events portal" icon={Plus} pad="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <input className={inputCls} placeholder="Event name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className={inputCls} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
                {EVENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <input className={inputCls} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              <input className={inputCls} placeholder="Client name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
              <input className={inputCls} type="number" placeholder="Attendees" value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} />
              <input className={inputCls} type="number" placeholder="Est. revenue" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} />
            </div>
            <input className={inputCls} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex gap-2">
              <button className={button.primary} onClick={submitCreate} disabled={busy === 'create' || !form.name.trim() || !form.date}>
                {busy === 'create' ? 'Creating…' : 'Create Event'}
              </button>
              <button className={button.secondary} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Coordination board */}
      <SectionCard
        title="Coordination Board"
        subtitle={`${filtered.length} events`}
        icon={Calendar}
        pad="md"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <Search size={14} className="text-slate-400" />
              <input placeholder="Search events, venues, coordinators…" value={query} onChange={(e) => setQuery(e.target.value)}
                className="bg-transparent outline-none text-sm w-44 text-slate-900 dark:text-white placeholder:text-slate-400" />
            </div>
            <select className={inputCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
              <option value="all">All types</option>
              {(['conference', 'wedding', 'banquet', 'group-checkin', 'group-checkout', 'event'] as CoordEventType[]).map((t) => (
                <option key={t} value={t}>{typeLabel(t)}</option>
              ))}
            </select>
            <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              {(['planning', 'setup', 'in-progress', 'completed'] as CoordEventStatus[]).map((s) => (
                <option key={s} value={s}>{toTitle(s)}</option>
              ))}
            </select>
          </div>
        }
      >
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={20} className="animate-spin" /> Loading events…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No events match the current filters.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-4 items-start">
            {/* Event list */}
            <div className="flex flex-col gap-2 max-h-[620px] overflow-y-auto pr-1">
              {filtered.map((e) => (
                <button key={e.id} onClick={() => setSelectedId(e.id)}
                  className={`text-left p-3 rounded-lg border transition-all hover:shadow-md ${
                    selected?.id === e.id
                      ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/5 ring-1 ring-[var(--color-accent-operations)]'
                      : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">{e.name}</span>
                    <ChevronRight size={14} className="text-slate-400 shrink-0 mt-0.5" />
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    <Badge tone={typeTone(e.type)}>{typeLabel(e.type)}</Badge>
                    <Badge tone={statusTone(e.status)}>{toTitle(e.status)}</Badge>
                    {e.source === 'group' && <Badge tone="neutral">Group</Badge>}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                    <span className="inline-flex items-center gap-1"><Calendar size={12} /> {e.date}</span>
                    {e.location && <span className="inline-flex items-center gap-1 truncate"><MapPin size={12} /> {e.location}</span>}
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {e.attendees}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{selected.name}</h3>
                    <div className="flex gap-1.5 flex-wrap">
                      <Badge tone={typeTone(selected.type)}>{typeLabel(selected.type)}</Badge>
                      <Badge tone={statusTone(selected.status)}>{selected.rawStatus}</Badge>
                      {selected.menuPackage && <Badge tone="neutral">Menu: {selected.menuPackage}</Badge>}
                    </div>
                  </div>
                  {selected.revenue != null && (
                    <span className="text-base font-bold text-slate-900 dark:text-white shrink-0">{formatAmount(selected.revenue)}</span>
                  )}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-sm">
                  <div><p className="text-xs text-slate-500">Date</p><p className="text-slate-900 dark:text-white font-medium">{selected.date}{selected.endDate && selected.endDate !== selected.date ? ` → ${selected.endDate}` : ''}</p></div>
                  <div><p className="text-xs text-slate-500">Venue</p><p className="text-slate-900 dark:text-white font-medium">{selected.location || 'TBD'}</p></div>
                  <div><p className="text-xs text-slate-500">Attendees</p><p className="text-slate-900 dark:text-white font-medium">{selected.attendees}</p></div>
                  <div><p className="text-xs text-slate-500">Coordinator</p><p className="text-slate-900 dark:text-white font-medium">{selected.coordinator}</p></div>
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Departments</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {selected.departments.map((d) => <Badge key={d} tone="neutral">{d}</Badge>)}
                  </div>
                </div>

                {selected.checklist.total > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Setup Checklist — {selected.checklist.done}/{selected.checklist.total} done
                      </p>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mb-2">
                      <div className="h-1.5 rounded-full bg-[var(--color-accent-operations)] transition-all"
                        style={{ width: `${(selected.checklist.done / selected.checklist.total) * 100}%` }} />
                    </div>
                    <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto">
                      {selected.checklist.items.map((item) => (
                        <button key={item.id} disabled={busy === `cl-${item.id}`}
                          onClick={() => act(`cl-${item.id}`, () => toggleChecklistItem(item.id, !item.completed))}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50">
                          {item.completed
                            ? <CheckSquare size={14} className="text-emerald-500 shrink-0" />
                            : <Square size={14} className="text-slate-400 shrink-0" />}
                          <span className={item.completed ? 'line-through opacity-60' : ''}>{item.name}</span>
                          {item.category && <Badge tone="neutral">{item.category}</Badge>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100 dark:border-slate-700">
                  {selected.source === 'banquet' ? (
                    <>
                      <select className={inputCls} value={selected.rawStatus}
                        disabled={busy === `st-${selected.id}`}
                        onChange={(e) => act(`st-${selected.id}`, () => updateCoordinationEvent(selected.id, { status: e.target.value }))}>
                        {BANQUET_EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {selected.linkedTask ? (
                        <Badge tone="info" icon={ListChecks}>Coordination task: {selected.linkedTask.status}</Badge>
                      ) : (
                        <button className={button.secondary}
                          disabled={busy === `task-${selected.id}`}
                          onClick={() => act(`task-${selected.id}`, () => createEventCoordinationTask(selected.id, { propertyId: currentPropertyId }))}>
                          {busy === `task-${selected.id}` ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                          Create Coordination Task
                        </button>
                      )}
                    </>
                  ) : (
                    <Badge tone="neutral">Managed via Front Office group blocks</Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default EventGroupCoordination;
