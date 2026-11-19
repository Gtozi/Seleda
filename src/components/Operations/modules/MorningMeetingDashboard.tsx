/**
 * Morning Meeting Dashboard — Operations Portal
 * (/erp/operations/morning-meeting).
 *
 * Daily morning meeting agenda + performance snapshot, DB-integrated via
 * /api/ops-portal/morning-meeting (migration 629):
 *  - Header KPIs are computed live from the other portals' real tables —
 *    yesterday's occupancy / revenue / ADR / guest satisfaction and
 *    today's expected occupancy / arrivals / departures / VIP arrivals.
 *  - Agenda items persist in ops_meeting_agenda_items. First view of a
 *    date auto-seeds the standard 10-item agenda (source='template')
 *    with descriptions filled from live counts (open complaints, work
 *    orders, staffing gaps, event names, revenue). Add / status-toggle /
 *    notes / delete all write back to the DB.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens) — same as the HK / Engineering /
 * F&B modules and the other Operations tabs.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Calendar,
  Star,
  Wrench,
  Bed,
  Utensils,
  Briefcase,
  DollarSign,
  CheckSquare,
  Clock,
  Plus,
  Edit,
  Trash2,
  Save,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Sun,
  Loader2,
  RefreshCw,
  AlertTriangle,
  BedDouble,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchMorningMeeting,
  createAgendaItem,
  updateAgendaItem,
  deleteAgendaItem,
  type MorningMeeting,
  type MorningMeetingAgendaItem,
  type AgendaItemStatus,
  type AgendaItemPriority,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<string, LucideIcon> = {
  Performance: TrendingUp,
  Operations: Briefcase,
  VIP: Star,
  'Guest Experience': Users,
  Maintenance: Wrench,
  Housekeeping: Bed,
  Events: Calendar,
  Staffing: Users,
  Revenue: DollarSign,
  'Action Items': CheckSquare,
  'Food & Beverage': Utensils,
  Rooms: BedDouble,
};

const PRIORITY_TONE: Record<AgendaItemPriority, StatusTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const STATUS_TONE: Record<AgendaItemStatus, StatusTone> = {
  completed: 'success',
  'in-progress': 'info',
  pending: 'neutral',
};

const CATEGORIES = [
  'General', 'Performance', 'Operations', 'VIP', 'Guest Experience',
  'Maintenance', 'Housekeeping', 'Events', 'Staffing', 'Revenue', 'Action Items',
];

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Component ────────────────────────────────────────────────────────────

const MorningMeetingDashboard: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [meeting, setMeeting] = useState<MorningMeeting | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [newItem, setNewItem] = useState({
    category: 'General',
    title: '',
    description: '',
    priority: 'medium' as AgendaItemPriority,
    estimatedTime: '' as number | '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMorningMeeting(currentPropertyId || undefined, selectedDate);
      setMeeting(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load morning meeting');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, selectedDate]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => meeting?.agendaItems || [], [meeting]);
  const completedCount = useMemo(() => items.filter(i => i.status === 'completed').length, [items]);
  const totalMinutes = useMemo(
    () => items.reduce((s, i) => s + (i.status === 'completed' ? 0 : (i.estimatedTime || 0)), 0),
    [items],
  );

  // ── Agenda item actions — optimistic update + server persist ─────────

  const patchItem = async (itemId: string, patch: Parameters<typeof updateAgendaItem>[1]) => {
    const previous = items;
    setMeeting(prev => prev
      ? { ...prev, agendaItems: prev.agendaItems.map(i => (i.id === itemId ? { ...i, ...patch } : i)) }
      : prev);
    try {
      await updateAgendaItem(itemId, patch);
    } catch (e: any) {
      setMeeting(prev => (prev ? { ...prev, agendaItems: previous } : prev));
      addNotification(e?.message || 'Failed to update item', 'warning', 'Executive');
    }
  };

  const toggleComplete = (item: MorningMeetingAgendaItem) =>
    patchItem(item.id, { status: item.status === 'completed' ? 'pending' : 'completed' });

  const removeItem = async (itemId: string) => {
    const previous = items;
    setMeeting(prev => prev
      ? { ...prev, agendaItems: prev.agendaItems.filter(i => i.id !== itemId) }
      : prev);
    try {
      await deleteAgendaItem(itemId);
    } catch (e: any) {
      setMeeting(prev => (prev ? { ...prev, agendaItems: previous } : prev));
      addNotification(e?.message || 'Failed to delete item', 'warning', 'Executive');
    }
  };

  const addItem = async () => {
    if (!newItem.title.trim()) return;
    try {
      const { id } = await createAgendaItem({
        propertyId: currentPropertyId || undefined,
        meetingDate: selectedDate,
        category: newItem.category,
        title: newItem.title.trim(),
        description: newItem.description.trim() || undefined,
        priority: newItem.priority,
        estimatedTime: newItem.estimatedTime === '' ? undefined : Number(newItem.estimatedTime),
      });
      setMeeting(prev => prev
        ? {
            ...prev,
            agendaItems: [
              ...prev.agendaItems,
              {
                id,
                category: newItem.category,
                title: newItem.title.trim(),
                description: newItem.description.trim(),
                status: 'pending',
                priority: newItem.priority,
                assignedTo: null,
                estimatedTime: newItem.estimatedTime === '' ? null : Number(newItem.estimatedTime),
                notes: null,
                sortOrder: 100,
                source: 'manual',
              },
            ],
          }
        : prev);
      setNewItem({ category: 'General', title: '', description: '', priority: 'medium', estimatedTime: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add item', 'warning', 'Executive');
    }
  };

  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && !meeting) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  const perf = meeting?.previousDayPerformance;
  const occ = meeting?.todaysOccupancy;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Morning Meeting"
        subtitle={`Daily operations meeting agenda — ${fmtDate(selectedDate)}`}
        icon={Sun}
        actions={
          <>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-[var(--color-accent-operations)] outline-none"
            />
            <button onClick={load} disabled={loading} className={button.secondary} title="Reload">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setIsEditing(v => !v)}
              className={isEditing ? button.primary : button.secondary}
            >
              {isEditing ? <Save size={16} /> : <Edit size={16} />}
              {isEditing ? 'Done' : 'Edit Agenda'}
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <AlertTriangle size={18} className="text-[var(--color-warning)] shrink-0" />
          <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{error}</p>
          <button onClick={load} className={button.secondary}>Retry</button>
        </div>
      )}

      {meeting && perf && occ && (
        <>
          {/* KPI row */}
          <div className={layout.kpiGrid}>
            <StatCard
              title="Yesterday Occupancy"
              value={`${perf.occupancy}%`}
              icon={BedDouble}
              tone="info"
              caption={`ADR ${formatAmount(perf.adr)}`}
            />
            <StatCard
              title="Yesterday Revenue"
              value={formatAmount(perf.revenue)}
              icon={DollarSign}
              tone="success"
              caption={perf.satisfaction !== null ? `${perf.satisfaction}/5 guest satisfaction (30d)` : 'no recent guest feedback'}
            />
            <StatCard
              title="Today Expected"
              value={`${occ.expected}%`}
              icon={TrendingUp}
              tone="accent"
              caption={`${occ.arrivals} arrivals · ${occ.departures} departures`}
            />
            <StatCard
              title="VIP Arrivals"
              value={occ.vipArrivals}
              icon={Star}
              tone="warning"
              caption="special attention required"
            />
          </div>

          {/* Agenda */}
          <SectionCard
            title="Meeting Agenda"
            subtitle={`${completedCount} of ${items.length} items completed${totalMinutes > 0 ? ` · ~${totalMinutes} min remaining` : ''}`}
            icon={CheckSquare}
            tone="accent"
            pad="md"
            actions={
              <div className="w-28 h-2 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-success)] transition-all"
                  style={{ width: `${items.length ? (completedCount / items.length) * 100 : 0}%` }}
                />
              </div>
            }
          >
            <div className="space-y-2">
              {items.map(item => {
                const Icon = CATEGORY_ICON[item.category] || Briefcase;
                const isExpanded = expandedItems.has(item.id);
                const done = item.status === 'completed';

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border transition-all ${
                      done
                        ? 'bg-gray-50 dark:bg-slate-900/50 border-gray-200 dark:border-slate-700 opacity-60'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleComplete(item)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            done
                              ? 'bg-[var(--color-success)] border-[var(--color-success)] text-white'
                              : 'border-gray-300 dark:border-slate-600 hover:border-[var(--color-success)]'
                          }`}
                          title={done ? 'Mark pending' : 'Mark completed'}
                        >
                          {done && <CheckSquare size={12} />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Icon size={15} className="text-gray-400" />
                              <span className="text-xs font-mono uppercase text-gray-500 font-bold">
                                {item.category}
                              </span>
                              {item.source === 'manual' && <Badge tone="info">custom</Badge>}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge tone={PRIORITY_TONE[item.priority]} className="capitalize">
                                {item.priority}
                              </Badge>
                              {item.status === 'in-progress' && (
                                <Badge tone="info">in progress</Badge>
                              )}
                              {item.estimatedTime != null && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                  <Clock size={12} />
                                  {item.estimatedTime}m
                                </span>
                              )}
                            </div>
                          </div>

                          <h4 className={`font-semibold mt-1 ${done ? 'line-through text-gray-500 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                            {item.title}
                          </h4>

                          {isExpanded && (
                            <div className="mt-2 space-y-2">
                              {item.description && (
                                <p className="text-sm text-gray-600 dark:text-gray-400">{item.description}</p>
                              )}
                              {item.assignedTo && (
                                <p className="text-xs text-gray-500">Assigned to: {item.assignedTo}</p>
                              )}
                              {isEditing ? (
                                <textarea
                                  defaultValue={item.notes || ''}
                                  placeholder="Add meeting notes…"
                                  onBlur={e => {
                                    if (e.target.value !== (item.notes || '')) {
                                      patchItem(item.id, { notes: e.target.value });
                                    }
                                  }}
                                  rows={2}
                                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-xs focus:ring-1 focus:ring-[var(--color-accent-operations)] outline-none"
                                />
                              ) : (
                                item.notes && (
                                  <div className="p-2 bg-gray-50 dark:bg-slate-900/50 rounded text-xs text-gray-600 dark:text-gray-400">
                                    <strong>Notes:</strong> {item.notes}
                                  </div>
                                )
                              )}
                              {!done && item.status !== 'in-progress' && (
                                <button
                                  onClick={() => patchItem(item.id, { status: 'in-progress' })}
                                  className="text-xs text-[var(--color-accent-operations)] hover:underline"
                                >
                                  Mark in progress
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => toggleExpand(item.id)}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors text-gray-500"
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                          {isEditing && (
                            <button
                              onClick={() => removeItem(item.id)}
                              className="p-1 hover:bg-[var(--color-danger)]/10 rounded transition-colors text-[var(--color-danger)]"
                              title="Delete item"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add new item — edit mode only */}
            {isEditing && (
              <div className="mt-4 p-4 rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900/50">
                <h4 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2 text-sm">
                  <Plus size={15} />
                  Add Agenda Item
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={newItem.category}
                    onChange={e => setNewItem({ ...newItem, category: e.target.value })}
                    className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    value={newItem.priority}
                    onChange={e => setNewItem({ ...newItem, priority: e.target.value as AgendaItemPriority })}
                    className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Item title"
                    value={newItem.title}
                    onChange={e => setNewItem({ ...newItem, title: e.target.value })}
                    className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                  />
                  <input
                    type="number"
                    placeholder="Estimated time (minutes)"
                    value={newItem.estimatedTime}
                    onChange={e => setNewItem({ ...newItem, estimatedTime: e.target.value === '' ? '' : parseInt(e.target.value) })}
                    className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                  />
                  <textarea
                    placeholder="Description"
                    value={newItem.description}
                    onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                    rows={2}
                    className="md:col-span-2 px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                  />
                </div>
                <div className="flex justify-end mt-3">
                  <button onClick={addItem} disabled={!newItem.title.trim()} className={button.primary}>
                    <Plus size={15} />
                    Add Item
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default MorningMeetingDashboard;
