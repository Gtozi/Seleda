/**
 * Patrol Management — /erp/security/patrols.
 *
 * DB-integrated via /api/sec-portal/soc/patrols routes (migrations 600/607).
 * Shares the `sec_patrols` table with the SOC patrol board — one source of
 * truth. `sec_patrol_checkpoints` backs a real QR/NFC checkpoint list:
 * scanning a checkpoint stamps scanned_at/scanned_by and derives patrol
 * progress + completion server-side.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MapPin, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, Clock, Play, Flag, ShieldCheck,
  QrCode, ScanLine, Route as RouteIcon, User, CalendarClock, History,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecPatrols, fetchSecPatrol, createSecPatrol, updateSecPatrol,
  deleteSecPatrol, scanSecPatrolCheckpoint, fetchSecStaff,
  type SecPatrol, type SecPatrolDetail, type SecPatrolStatus,
  type SecShift, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const PATROL_STATUSES: SecPatrolStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const SHIFTS: SecShift[] = ['Day', 'Evening', 'Night'];
const ROUTES = ['Guest Floors', 'Public Areas', 'Perimeter', 'Parking', 'Back of House', 'Exterior Grounds'];

const STATUS_TONE: Record<SecPatrolStatus, StatusTone> = {
  Scheduled: 'neutral',
  'In Progress': 'info',
  Completed: 'success',
  Cancelled: 'danger',
};

const SHIFT_TONE: Record<SecShift, StatusTone> = {
  Day: 'warning', Evening: 'info', Night: 'accent',
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const filterSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 outline-none cursor-pointer';

const inlineStatusSelect =
  'bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-lg px-2 py-1 text-[9px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer disabled:opacity-50';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-6 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-6 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No patrols found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="min-w-[110px]">
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span>{done}/{total || '—'} checkpoints</span>
        <span className="font-bold">{total > 0 ? `${pct}%` : '—'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-[var(--color-accent-operations)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

const PatrolManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [patrols, setPatrols] = useState<SecPatrol[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecPatrolStatus>('all');
  const [filterShift, setFilterShift] = useState<'all' | SecShift>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecPatrol | null>(null);
  const [detail, setDetail] = useState<SecPatrolDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecPatrol | null>(null);

  const emptyForm = {
    officer: '', route: 'Guest Floors', shift: 'Day' as SecShift,
    scheduledStart: '', scheduledEnd: '', notes: '',
    checkpoints: [''],
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        fetchSecPatrols(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setPatrols(p);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load patrols');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecPatrol(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load patrol detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (p: SecPatrol) => {
    setDetail(null);
    loadDetail(p.id);
  };

  const refreshAll = async () => {
    await load();
    if (detail) await loadDetail(detail.patrol.id);
    addNotification('Patrol schedule refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: patrols.length,
    inProgress: patrols.filter(p => p.status === 'In Progress').length,
    scheduled: patrols.filter(p => p.status === 'Scheduled').length,
    completed: patrols.filter(p => p.status === 'Completed').length,
  }), [patrols]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return patrols.filter(p => {
      const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
      const matchesShift = filterShift === 'all' || p.shift === filterShift;
      const matchesSearch = !q ||
        p.id.toLowerCase().includes(q) ||
        p.officer.toLowerCase().includes(q) ||
        p.route.toLowerCase().includes(q);
      return matchesStatus && matchesShift && matchesSearch;
    });
  }, [patrols, filterStatus, filterShift, search]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (p: SecPatrol) => {
    setEditing(p);
    setForm({
      officer: p.officer,
      route: p.route,
      shift: p.shift || 'Day',
      scheduledStart: toLocalInput(p.scheduled_start),
      scheduledEnd: toLocalInput(p.scheduled_end),
      notes: p.notes || '',
      checkpoints: [''],
    });
    setShowForm(true);
  };

  const savePatrol = async () => {
    if (!form.officer.trim()) {
      addNotification('Officer is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        officer: form.officer.trim(),
        route: form.route,
        shift: form.shift,
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
        scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : null,
        notes: form.notes || null,
      };
      if (editing) {
        const res = await updateSecPatrol(editing.id, payload);
        setPatrols(prev => prev.map(p => (p.id === editing.id ? res.patrol : p)));
        if (detail?.patrol.id === editing.id) loadDetail(editing.id);
        addNotification(`Patrol ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecPatrol({
          propertyId: currentPropertyId,
          ...payload,
          checkpoints: form.checkpoints
            .filter(n => n.trim())
            .map(n => ({ name: n.trim(), location: form.route })),
        });
        setPatrols(prev => [created, ...prev]);
        addNotification(`Patrol ${created.route} scheduled for ${created.officer} (${created.id})`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save patrol', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchPatrol = async (p: SecPatrol, patch: Parameters<typeof updateSecPatrol>[1], toast?: string) => {
    setActingOn(p.id);
    try {
      const res = await updateSecPatrol(p.id, patch);
      setPatrols(prev => prev.map(x => (x.id === p.id ? res.patrol : x)));
      if (detail?.patrol.id === p.id) loadDetail(p.id);
      addNotification(toast || `Patrol ${p.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const scanCheckpoint = async (patrolId: string, checkpointId: string, cpName: string) => {
    setActingOn(checkpointId);
    try {
      const res = await scanSecPatrolCheckpoint(patrolId, checkpointId);
      setPatrols(prev => prev.map(p => (p.id === patrolId ? res.patrol : p)));
      await loadDetail(patrolId);
      addNotification(`Checkpoint "${cpName}" scanned`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Scan failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removePatrol = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecPatrol(deleteTarget.id);
      setPatrols(prev => prev.filter(p => p.id !== deleteTarget.id));
      if (detail?.patrol.id === deleteTarget.id) setDetail(null);
      addNotification(`Patrol ${deleteTarget.id} removed`, 'task', 'Security');
      setDeleteTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const setCheckpointName = (idx: number, value: string) => {
    setForm(f => {
      const next = [...f.checkpoints];
      next[idx] = value;
      return { ...f, checkpoints: next };
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Patrol Management"
        subtitle="Schedule and monitor security patrols with QR/NFC checkpoints"
        icon={MapPin}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> New Patrol
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Patrols" value={stats.total} icon={RouteIcon} tone="accent" />
        <StatCard title="In Progress" value={stats.inProgress} icon={Play} tone="info" />
        <StatCard title="Scheduled" value={stats.scheduled} icon={CalendarClock} tone="warning" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search officer, route, ID…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {PATROL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-slate-400" />
            <select value={filterShift} onChange={e => setFilterShift(e.target.value as any)} className={filterSelect}>
              <option value="all">All Shifts</option>
              {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Patrol register */}
      <SectionCard title="Patrol Register" subtitle="Route · Officer · Schedule · Checkpoints · Status" icon={MapPin} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Patrol', 'Officer', 'Schedule', 'Progress', 'Status', 'Last Checkpoint', '']}
            rows={filtered.map(p => [
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 shrink-0">
                  <RouteIcon className="w-4 h-4 text-[var(--color-accent-operations)]" />
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(p)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{p.route}</button>
                  <div className="text-[10px] text-slate-400 font-mono">{p.id}</div>
                </div>
              </div>,
              <span className="flex items-center gap-1"><User size={11} className="text-slate-400" />{p.officer}</span>,
              <div>
                <div className="text-xs">{fmtTime(p.scheduled_start)}{p.scheduled_end ? ` – ${fmtTime(p.scheduled_end)}` : ''}</div>
                {p.shift && <Badge tone={SHIFT_TONE[p.shift]}>{p.shift} shift</Badge>}
              </div>,
              <ProgressBar done={p.checkpoint_done} total={p.checkpoint_total} />,
              <select
                value={p.status}
                onChange={e => patchPatrol(p, { status: e.target.value as SecPatrolStatus }, `Patrol ${p.id} → ${e.target.value}`)}
                disabled={actingOn === p.id}
                className={inlineStatusSelect}
              >
                {PATROL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <span className="text-xs text-slate-500">{p.last_checkpoint || '—'}</span>,
              <div className="inline-flex gap-2">
                <button onClick={() => openDetail(p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(p)} disabled={actingOn === p.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(p)} disabled={actingOn === p.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={7}
          />
        )}
      </SectionCard>

      {/* New / Edit patrol modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={savePatrol}
        title={editing ? `Edit Patrol ${editing.id}` : 'Schedule New Patrol'}
        subtitle={editing ? editing.route : 'Assign an officer, route, schedule and checkpoints'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Schedule Patrol'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Officer">
              <input
                className={inputClass}
                list="sec-patrol-officers"
                value={form.officer}
                onChange={e => setForm(f => ({ ...f, officer: e.target.value }))}
                placeholder="Select or type officer name"
              />
              <datalist id="sec-patrol-officers">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Route">
              <select className={inputClass} value={form.route} onChange={e => setForm(f => ({ ...f, route: e.target.value }))}>
                {ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Shift">
              <select className={inputClass} value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value as SecShift }))}>
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Scheduled Start">
              <input type="datetime-local" className={inputClass} value={form.scheduledStart} onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))} />
            </Field>
            <Field label="Scheduled End">
              <input type="datetime-local" className={inputClass} value={form.scheduledEnd} onChange={e => setForm(f => ({ ...f, scheduledEnd: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputClass + ' min-h-[64px]'} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Patrol instructions, areas of concern…" />
          </Field>
          {!editing && (
            <Field label={`Checkpoints (${form.checkpoints.filter(c => c.trim()).length})`}>
              <div className="space-y-2">
                {form.checkpoints.map((cp, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <QrCode size={14} className="text-slate-400 shrink-0" />
                    <input
                      className={inputClass}
                      value={cp}
                      onChange={e => setCheckpointName(idx, e.target.value)}
                      placeholder={`Checkpoint ${idx + 1} name (e.g., Floor 3 Stairwell)`}
                    />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, checkpoints: f.checkpoints.filter((_, i) => i !== idx) }))}
                      className="p-1.5 text-slate-400 hover:text-[var(--color-danger)]"
                      disabled={form.checkpoints.length <= 1}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, checkpoints: [...f.checkpoints, ''] }))}
                  className={button.secondary + ' text-xs'}
                >
                  <Plus size={12} /> Add Checkpoint
                </button>
              </div>
            </Field>
          )}
        </div>
      </ModalSystem>

      {/* Patrol detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Patrol ${detail.patrol.id}` : 'Patrol Detail'}
        subtitle={detail ? `${detail.patrol.route} · ${detail.patrol.officer}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.patrol.status]}>{detail.patrol.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Officer</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><User size={11} />{detail.patrol.officer}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Shift</p>
                {detail.patrol.shift ? <Badge tone={SHIFT_TONE[detail.patrol.shift]}>{detail.patrol.shift}</Badge> : <p className="text-slate-400">—</p>}
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Route</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.patrol.route}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Schedule</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtTime(detail.patrol.scheduled_start)} – {fmtTime(detail.patrol.scheduled_end)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Started</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtTime(detail.patrol.started_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Ended</p>
                <p className="font-medium text-slate-900 dark:text-white">{fmtTime(detail.patrol.ended_at)}</p>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Progress</p>
                <ProgressBar done={detail.patrol.checkpoint_done} total={detail.patrol.checkpoint_total} />
              </div>
              {detail.patrol.notes && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{detail.patrol.notes}</p>
                </div>
              )}
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {detail.patrol.status === 'Scheduled' && (
                <button
                  onClick={() => patchPatrol(detail.patrol, { status: 'In Progress' }, `Patrol ${detail.patrol.id} started`)}
                  disabled={actingOn === detail.patrol.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  <Play className="w-4 h-4" /> Start Patrol
                </button>
              )}
              {detail.patrol.status === 'In Progress' && (
                <button
                  onClick={() => patchPatrol(detail.patrol, { status: 'Completed' }, `Patrol ${detail.patrol.id} completed`)}
                  disabled={actingOn === detail.patrol.id}
                  className={button.primary + ' disabled:opacity-50'}
                >
                  <Flag className="w-4 h-4" /> Complete Patrol
                </button>
              )}
              {(detail.patrol.status === 'Scheduled' || detail.patrol.status === 'In Progress') && (
                <button
                  onClick={() => patchPatrol(detail.patrol, { status: 'Cancelled' }, `Patrol ${detail.patrol.id} cancelled`)}
                  disabled={actingOn === detail.patrol.id}
                  className={button.secondary + ' text-[var(--color-danger)]'}
                >
                  Cancel Patrol
                </button>
              )}
              <button onClick={() => { setDetail(null); openEdit(detail.patrol); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.patrol)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Checkpoints */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" />
                Checkpoints ({detail.patrol.checkpoint_done}/{detail.patrol.checkpoint_total})
              </h4>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {detail.checkpoints.map((cp, idx) => (
                  <div key={cp.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${
                        cp.scanned_at ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                      }`}>
                        {cp.scanned_at ? <CheckCircle2 size={13} /> : <span className="text-[10px] font-bold">{cp.order_no}</span>}
                      </div>
                      {idx < detail.checkpoints.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1 flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-medium ${cp.scanned_at ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{cp.name}</p>
                        <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={10} />{cp.location}</p>
                        {cp.scanned_at && (
                          <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <Clock size={10} />{fmtTime(cp.scanned_at)}{cp.scanned_by ? ` · ${cp.scanned_by}` : ''}
                          </p>
                        )}
                      </div>
                      {!cp.scanned_at && detail.patrol.status !== 'Completed' && detail.patrol.status !== 'Cancelled' && (
                        <button
                          onClick={() => scanCheckpoint(detail.patrol.id, cp.id, cp.name)}
                          disabled={actingOn === cp.id}
                          className={button.secondary + ' text-xs shrink-0 disabled:opacity-50'}
                        >
                          {actingOn === cp.id ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />} Scan
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {detail.checkpoints.length === 0 && (
                  <p className="text-xs text-slate-400 flex items-center gap-2"><ShieldCheck size={12} />No checkpoints defined for this patrol.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removePatrol}
        title="Remove Patrol"
        subtitle={deleteTarget ? `Permanently remove patrol ${deleteTarget.id} (${deleteTarget.route}) and its checkpoints?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default PatrolManagement;
