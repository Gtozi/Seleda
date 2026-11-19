/**
 * Duty Manager Workspace — Operations Portal (/erp/operations/duty-manager).
 *
 * Shift-based operational management backed by live data:
 *   - Shift Logbook   → ops_shift_log_entries (migration 633), real add-entry
 *   - Guest Issues    → real `guest_requests` — same records the Front
 *                       Office portal manages (status normalized)
 *   - Incidents       → real `sec_incidents` — the Security portal's records
 *   - Walkthrough     → ops_walkthrough_items; a standard checklist is
 *                       auto-seeded per property+shift+date, checks persist
 *   - Shift Handover  → ops_shift_handovers; "Create Handover" auto-collects
 *                       open items from live guest requests, unresolved
 *                       incidents and walkthrough issues; acknowledge persists
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Book,
  AlertTriangle,
  Users,
  ClipboardCheck,
  LogOut,
  LogIn,
  Plus,
  Clock,
  ChevronRight,
  Flame,
  MapPin,
  Loader2,
  RefreshCw,
  CheckCircle2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchDutyManager,
  addShiftLogEntry,
  updateWalkthroughItem,
  createHandover,
  acknowledgeHandover,
  type DutyShift,
  type DutyShiftLogEntry,
  type DutyGuestIssue,
  type DutyIncident,
  type DutyWalkthroughItem,
  type DutyHandover,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const SHIFTS: DutyShift[] = ['Morning', 'Afternoon', 'Evening', 'Night'];

const NEXT_SHIFT: Record<DutyShift, DutyShift> = {
  Morning: 'Afternoon',
  Afternoon: 'Evening',
  Evening: 'Night',
  Night: 'Morning',
};

const PRIORITY_TONE: Record<string, StatusTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
};

const SEVERITY_TONE: Record<string, StatusTone> = {
  minor: 'neutral',
  moderate: 'warning',
  major: 'danger',
  critical: 'danger',
};

const ISSUE_STATUS_TONE: Record<string, StatusTone> = {
  open: 'warning',
  'in-progress': 'info',
  resolved: 'success',
};

const INCIDENT_STATUS_TONE: Record<string, StatusTone> = {
  open: 'warning',
  investigating: 'info',
  resolved: 'success',
};

const WALK_STATUS_TONE: Record<string, StatusTone> = {
  pending: 'neutral',
  completed: 'success',
  issue: 'danger',
};

const LOG_CATEGORIES = ['General', 'VIP Arrival', 'Maintenance', 'Guest Issue', 'Staffing', 'Security'];

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Component ────────────────────────────────────────────────────────────

const DutyManagerWorkspace: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [activeTab, setActiveTab] = useState<'logbook' | 'issues' | 'incidents' | 'walkthrough' | 'handover'>('logbook');
  const [selectedShift, setSelectedShift] = useState<DutyShift>('Morning');
  const [selectedDate, setSelectedDate] = useState<string>(today());

  const [data, setData] = useState<{
    shiftLogs: DutyShiftLogEntry[];
    guestIssues: DutyGuestIssue[];
    incidents: DutyIncident[];
    walkthrough: DutyWalkthroughItem[];
    handovers: DutyHandover[];
    stats: { openIssues: number; openIncidents: number; walkthroughDone: number; walkthroughTotal: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Logbook add-entry form
  const [isEditing, setIsEditing] = useState(false);
  const [newLog, setNewLog] = useState({ category: 'General', description: '', priority: 'medium' as 'low' | 'medium' | 'high' });

  // Handover create form
  const [showHandoverForm, setShowHandoverForm] = useState(false);
  const [handoverForm, setHandoverForm] = useState({ toManager: '', summary: '' });

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetchDutyManager(currentPropertyId || undefined, selectedShift, selectedDate);
      setData({
        shiftLogs: res.shiftLogs,
        guestIssues: res.guestIssues,
        incidents: res.incidents,
        walkthrough: res.walkthrough,
        handovers: res.handovers,
        stats: res.stats,
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load duty manager workspace');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPropertyId, selectedShift, selectedDate]);

  useEffect(() => { load(); }, [load]);

  const stats = data?.stats || { openIssues: 0, openIncidents: 0, walkthroughDone: 0, walkthroughTotal: 0 };

  // ── Actions ────────────────────────────────────────────────────────────

  const submitLogEntry = async () => {
    if (!newLog.description.trim()) return;
    setBusy(true);
    try {
      await addShiftLogEntry({
        propertyId: currentPropertyId || undefined,
        shift: selectedShift,
        date: selectedDate,
        category: newLog.category,
        description: newLog.description.trim(),
        priority: newLog.priority,
      });
      setNewLog({ category: 'General', description: '', priority: 'medium' });
      setIsEditing(false);
      addNotification('Logbook entry added.', 'task', 'Executive');
      load(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add entry', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const setWalkStatus = async (id: string, status: DutyWalkthroughItem['status']) => {
    // Optimistic update
    setData(prev => prev && ({
      ...prev,
      walkthrough: prev.walkthrough.map(w => w.id === id ? { ...w, status } : w),
    }));
    try {
      await updateWalkthroughItem(id, status);
      load(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update checklist item', 'warning', 'Executive');
      load(true);
    }
  };

  const submitHandover = async () => {
    if (!handoverForm.toManager.trim()) return;
    setBusy(true);
    try {
      await createHandover({
        propertyId: currentPropertyId || undefined,
        date: selectedDate,
        fromShift: selectedShift,
        toShift: NEXT_SHIFT[selectedShift],
        toManager: handoverForm.toManager.trim(),
        summary: handoverForm.summary.trim() || undefined,
      });
      setHandoverForm({ toManager: '', summary: '' });
      setShowHandoverForm(false);
      addNotification(`Handover created for ${selectedShift} → ${NEXT_SHIFT[selectedShift]} shift.`, 'task', 'Executive');
      load(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create handover', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const ackHandover = async (id: string) => {
    setBusy(true);
    try {
      await acknowledgeHandover(id);
      addNotification('Handover acknowledged.', 'task', 'Executive');
      load(true);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to acknowledge handover', 'warning', 'Executive');
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: typeof activeTab; label: string; icon: LucideIcon; count?: number }> = useMemo(() => [
    { id: 'logbook', label: 'Shift Logbook', icon: Book, count: data?.shiftLogs.length },
    { id: 'issues', label: 'Guest Issues', icon: Users, count: stats.openIssues },
    { id: 'incidents', label: 'Incidents', icon: AlertTriangle, count: stats.openIncidents },
    { id: 'walkthrough', label: 'Walkthrough', icon: ClipboardCheck, count: stats.walkthroughTotal ? stats.walkthroughTotal - stats.walkthroughDone : 0 },
    { id: 'handover', label: 'Shift Handover', icon: LogOut, count: data?.handovers.filter(h => !h.acknowledgedAt).length },
  ], [data, stats]);

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Duty Manager Workspace"
        subtitle={`${selectedShift} shift · ${selectedDate}`}
        icon={Briefcase}
        actions={
          <>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
            />
            <select
              value={selectedShift}
              onChange={e => setSelectedShift(e.target.value as DutyShift)}
              className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
            >
              {SHIFTS.map(s => <option key={s} value={s}>{s} Shift</option>)}
            </select>
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
        <StatCard title="Open Guest Issues" value={stats.openIssues} icon={Users} tone={stats.openIssues ? 'warning' : 'success'} caption="live from Front Office" />
        <StatCard title="Open Incidents" value={stats.openIncidents} icon={Flame} tone={stats.openIncidents ? 'danger' : 'success'} caption="live from Security" />
        <StatCard title="Walkthrough" value={`${stats.walkthroughDone}/${stats.walkthroughTotal}`} icon={ClipboardCheck} tone={stats.walkthroughDone === stats.walkthroughTotal && stats.walkthroughTotal > 0 ? 'success' : 'info'} caption="checklist completed" />
        <StatCard title="Log Entries" value={data?.shiftLogs.length ?? 0} icon={Book} tone="neutral" caption={`${selectedShift} shift`} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700'
              }`}
            >
              <Icon size={16} />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Logbook ─────────────────────────────────────────────────── */}
      {activeTab === 'logbook' && (
        <SectionCard
          title="Shift Logbook"
          subtitle={`${selectedShift} shift · ${selectedDate}`}
          icon={Book}
          pad="lg"
          actions={
            <button onClick={() => setIsEditing(!isEditing)} className={button.primary}>
              {isEditing ? <X size={16} /> : <Plus size={16} />}
              {isEditing ? 'Cancel' : 'Add Entry'}
            </button>
          }
        >
          {isEditing && (
            <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl space-y-3 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <select
                  value={newLog.category}
                  onChange={e => setNewLog({ ...newLog, category: e.target.value })}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                >
                  {LOG_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={newLog.priority}
                  onChange={e => setNewLog({ ...newLog, priority: e.target.value as any })}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
                <button
                  onClick={submitLogEntry}
                  disabled={!newLog.description.trim() || busy}
                  className={button.primary}
                >
                  <Plus size={16} /> Add Entry
                </button>
              </div>
              <textarea
                placeholder="Enter log entry description…"
                value={newLog.description}
                onChange={e => setNewLog({ ...newLog, description: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none resize-none"
                rows={2}
              />
            </div>
          )}

          {data && data.shiftLogs.length === 0 ? (
            <div className="text-center py-10">
              <Book size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No logbook entries for this shift yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.shiftLogs.map(log => (
                <div key={log.id} className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-mono text-gray-500">{fmtTime(log.timestamp)}</span>
                    <Badge tone={PRIORITY_TONE[log.priority]} className="capitalize">{log.priority}</Badge>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{log.category}</span>
                  </div>
                  <p className="text-gray-900 dark:text-white mt-1 text-sm">{log.description}</p>
                  <p className="text-xs text-gray-500 mt-1">By {log.author || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Guest Issues (live guest_requests) ──────────────────────── */}
      {activeTab === 'issues' && (
        <SectionCard title="Guest Issues" subtitle="Live from Front Office guest requests" icon={Users} pad="lg">
          {data && data.guestIssues.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No guest requests on record</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.guestIssues.map(issue => (
                <div key={issue.id} className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {issue.roomNumber ? `Room ${issue.roomNumber}` : '—'}
                    </span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">{issue.guestName || 'Guest'}</span>
                    <Badge tone="neutral">{issue.type}</Badge>
                    <Badge tone={PRIORITY_TONE[issue.priority]} className="capitalize">{issue.priority}</Badge>
                    <Badge tone={ISSUE_STATUS_TONE[issue.status]} className="capitalize">{issue.status.replace('-', ' ')}</Badge>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white mt-1">{issue.issue}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span>Reported: {fmtTime(issue.reportedAt)}</span>
                    {issue.assignedTo && <span>Assigned to: {issue.assignedTo}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Incidents (live sec_incidents) ──────────────────────────── */}
      {activeTab === 'incidents' && (
        <SectionCard title="Incident Reports" subtitle="Live from Security portal" icon={Flame} pad="lg">
          {data && data.incidents.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No incidents on record</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.incidents.map(incident => (
                <div key={incident.id} className="p-4 bg-rose-50 dark:bg-rose-950/20 rounded-xl border border-rose-200 dark:border-rose-900/50">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Flame size={18} className="text-rose-600 dark:text-rose-400 shrink-0" />
                    <span className="font-medium text-gray-900 dark:text-white">{incident.type}</span>
                    <Badge tone={SEVERITY_TONE[incident.severity]} className="capitalize">{incident.severity}</Badge>
                    <Badge tone={INCIDENT_STATUS_TONE[incident.status]} className="capitalize">{incident.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white mt-1">{incident.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    {incident.location && (
                      <span className="flex items-center gap-1"><MapPin size={12} />{incident.location}</span>
                    )}
                    {incident.reportedBy && <span>Reported by: {incident.reportedBy}</span>}
                    <span>{fmtTime(incident.reportedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Walkthrough ─────────────────────────────────────────────── */}
      {activeTab === 'walkthrough' && (
        <SectionCard
          title="Walkthrough Checklist"
          subtitle={`${selectedShift} shift · ${selectedDate}`}
          icon={ClipboardCheck}
          pad="lg"
          actions={
            <Badge tone={stats.walkthroughDone === stats.walkthroughTotal && stats.walkthroughTotal > 0 ? 'success' : 'info'}>
              {stats.walkthroughDone}/{stats.walkthroughTotal} done
            </Badge>
          }
        >
          {data && data.walkthrough.length === 0 ? (
            <div className="text-center py-10">
              <ClipboardCheck size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No checklist items for this shift</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.walkthrough.map(item => (
                <div key={item.id} className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-bold text-gray-500 uppercase">{item.area}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{item.item}</span>
                      <Badge tone={WALK_STATUS_TONE[item.status]} className="capitalize">{item.status}</Badge>
                    </div>
                    {item.notes && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Note: {item.notes}</p>}
                    {item.completedAt && (
                      <p className="text-xs text-gray-500 mt-1">
                        Completed {fmtTime(item.completedAt)}{item.completedBy ? ` by ${item.completedBy}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setWalkStatus(item.id, 'completed')}
                      disabled={item.status === 'completed'}
                      className="p-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors disabled:opacity-40"
                      title="Mark Complete"
                    >
                      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                    </button>
                    <button
                      onClick={() => setWalkStatus(item.id, 'issue')}
                      disabled={item.status === 'issue'}
                      className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded transition-colors disabled:opacity-40"
                      title="Flag Issue"
                    >
                      <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400" />
                    </button>
                    <button
                      onClick={() => setWalkStatus(item.id, 'pending')}
                      disabled={item.status === 'pending'}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors disabled:opacity-40"
                      title="Reset to Pending"
                    >
                      <Clock size={16} className="text-gray-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Handover ────────────────────────────────────────────────── */}
      {activeTab === 'handover' && (
        <SectionCard
          title="Shift Handover"
          subtitle="Handovers auto-collect open issues, incidents and walkthrough flags"
          icon={LogOut}
          pad="lg"
          actions={
            <button onClick={() => setShowHandoverForm(!showHandoverForm)} className={button.primary}>
              {showHandoverForm ? <X size={16} /> : <Plus size={16} />}
              {showHandoverForm ? 'Cancel' : 'Create Handover'}
            </button>
          }
        >
          {showHandoverForm && (
            <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl space-y-3 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
                  {selectedShift} → {NEXT_SHIFT[selectedShift]} · {selectedDate}
                </div>
                <input
                  type="text"
                  placeholder="Incoming manager name…"
                  value={handoverForm.toManager}
                  onChange={e => setHandoverForm({ ...handoverForm, toManager: e.target.value })}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                />
              </div>
              <textarea
                placeholder="Shift summary (optional — open items are collected automatically)…"
                value={handoverForm.summary}
                onChange={e => setHandoverForm({ ...handoverForm, summary: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none resize-none"
                rows={2}
              />
              <button
                onClick={submitHandover}
                disabled={!handoverForm.toManager.trim() || busy}
                className={button.primary}
              >
                <LogOut size={16} /> Create Handover
              </button>
            </div>
          )}

          {data && data.handovers.length === 0 ? (
            <div className="text-center py-10">
              <LogOut size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No handovers on record</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.handovers.map(handover => (
                <div key={handover.id} className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-xl">
                  <div className="flex items-center gap-3 flex-wrap">
                    <LogOut size={16} className="text-gray-500 shrink-0" />
                    <span className="font-medium text-gray-900 dark:text-white">{handover.fromManager}</span>
                    <ChevronRight size={16} className="text-gray-400" />
                    <LogIn size={16} className="text-gray-500 shrink-0" />
                    <span className="font-medium text-gray-900 dark:text-white">{handover.toManager}</span>
                    {handover.acknowledgedAt
                      ? <Badge tone="success" icon={CheckCircle2}>acknowledged</Badge>
                      : <Badge tone="warning" icon={Clock}>awaiting ack</Badge>}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {handover.shiftPeriod} — {handover.shiftDate}
                  </p>
                  {handover.summary && (
                    <p className="text-sm text-gray-900 dark:text-white mt-2">{handover.summary}</p>
                  )}
                  {handover.openItems.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase">Open Items:</p>
                      <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-0.5">
                        {handover.openItems.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    <span>Created: {fmtTime(handover.createdAt)}</span>
                    {handover.acknowledgedAt && (
                      <span>Acknowledged: {fmtTime(handover.acknowledgedAt)}{handover.acknowledgedBy ? ` by ${handover.acknowledgedBy}` : ''}</span>
                    )}
                    {!handover.acknowledgedAt && (
                      <button
                        onClick={() => ackHandover(handover.id)}
                        disabled={busy}
                        className="ml-auto px-3 py-1 text-xs font-medium rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] hover:bg-[var(--color-accent-operations)]/20 transition-colors disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
};

export default DutyManagerWorkspace;
