/**
 * Fire & Life Safety — /erp/security/fire-safety.
 *
 * DB-integrated via /api/sec-portal/fire-equipment and /fire-activities
 * routes (migration 610). Two views:
 *   - Equipment register: alarm panels, detectors, sprinklers,
 *     extinguishers, exit signs, emergency lights, pull stations, doors.
 *   - Inspections & Drills: inspection/test/drill/maintenance activities;
 *     completing an equipment-linked inspection updates the equipment's
 *     last_inspection/next_due and status server-side.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, pill sub-tabs, SectionCard + DataTable,
 * Badge status pills, ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Flame, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, RefreshCw,
  Loader2, ServerCrash, Filter, MapPin, CalendarClock,
  ClipboardCheck, Siren, Users, Wrench, ShieldAlert, Play, Flag,
  AlertOctagon, Tag,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecFireEquipment, createSecFireEquipment, updateSecFireEquipment,
  deleteSecFireEquipment,
  fetchSecFireActivities, createSecFireActivity, updateSecFireActivity,
  deleteSecFireActivity, fetchSecStaff,
  type SecFireEquipment, type SecFireActivity, type SecFireEquipmentType,
  type SecFireEquipmentStatus, type SecFireActivityType,
  type SecFireActivityStatus, type SecFireResult, type SecStaff,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const EQUIPMENT_TYPES: SecFireEquipmentType[] = [
  'Fire Alarm Panel', 'Smoke Detector', 'Heat Detector', 'Sprinkler',
  'Fire Extinguisher', 'Exit Sign', 'Emergency Light', 'Pull Station',
  'Fire Door', 'Fire Hose', 'Fire Pump', 'Other',
];

const EQUIPMENT_STATUSES: SecFireEquipmentStatus[] = [
  'Operational', 'Needs Service', 'Out of Service', 'Under Test',
];

const ACTIVITY_TYPES: SecFireActivityType[] = ['Inspection', 'Alarm Test', 'Drill', 'Maintenance'];
const ACTIVITY_STATUSES: SecFireActivityStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Overdue', 'Cancelled'];
const RESULTS: SecFireResult[] = ['Pass', 'Pass with Notes', 'Fail'];

const EQ_STATUS_TONE: Record<SecFireEquipmentStatus, StatusTone> = {
  Operational: 'success',
  'Needs Service': 'warning',
  'Out of Service': 'danger',
  'Under Test': 'info',
};

const ACT_STATUS_TONE: Record<SecFireActivityStatus, StatusTone> = {
  Scheduled: 'neutral',
  'In Progress': 'info',
  Completed: 'success',
  Overdue: 'danger',
  Cancelled: 'neutral',
};

const RESULT_TONE: Record<SecFireResult, StatusTone> = {
  Pass: 'success', 'Pass with Notes': 'warning', Fail: 'danger',
};

const ACTIVITY_ICON: Record<SecFireActivityType, typeof ClipboardCheck> = {
  Inspection: ClipboardCheck,
  'Alarm Test': Siren,
  Drill: Users,
  Maintenance: Wrench,
};

type TabId = 'equipment' | 'activities';

const SUB_TABS: { id: TabId; label: string; icon: typeof Flame }[] = [
  { id: 'equipment', label: 'Equipment Register', icon: ShieldAlert },
  { id: 'activities', label: 'Inspections & Drills', icon: ClipboardCheck },
];

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
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

function isOverdue(nextDue: string | null | undefined): boolean {
  if (!nextDue) return false;
  return new Date(nextDue) < new Date();
}

function DataTable({ headers, rows, empty, emptyColSpan, emptyLabel }: {
  headers: string[];
  rows: ReactNode[][];
  empty: boolean;
  emptyColSpan: number;
  emptyLabel: string;
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">{emptyLabel}</td></tr>
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

// ── Component ────────────────────────────────────────────────────────────

const FireLifeSafety: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [tab, setTab] = useState<TabId>('equipment');
  const [equipment, setEquipment] = useState<SecFireEquipment[]>([]);
  const [activities, setActivities] = useState<SecFireActivity[]>([]);
  const [staff, setStaff] = useState<SecStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [eqStatusFilter, setEqStatusFilter] = useState<'all' | SecFireEquipmentStatus>('all');
  const [eqTypeFilter, setEqTypeFilter] = useState<'all' | SecFireEquipmentType>('all');
  const [actStatusFilter, setActStatusFilter] = useState<'all' | SecFireActivityStatus>('all');
  const [actTypeFilter, setActTypeFilter] = useState<'all' | SecFireActivityType>('all');

  // Equipment modals
  const [showEqForm, setShowEqForm] = useState(false);
  const [editingEq, setEditingEq] = useState<SecFireEquipment | null>(null);
  const [viewingEq, setViewingEq] = useState<SecFireEquipment | null>(null);
  const [deleteEqTarget, setDeleteEqTarget] = useState<SecFireEquipment | null>(null);

  // Activity modals
  const [showActForm, setShowActForm] = useState(false);
  const [editingAct, setEditingAct] = useState<SecFireActivity | null>(null);
  const [viewingAct, setViewingAct] = useState<SecFireActivity | null>(null);
  const [deleteActTarget, setDeleteActTarget] = useState<SecFireActivity | null>(null);
  const [completeTarget, setCompleteTarget] = useState<SecFireActivity | null>(null);

  const emptyEqForm = {
    name: '', equipmentType: 'Fire Extinguisher' as SecFireEquipmentType,
    location: '', zone: '', serialNumber: '', model: '',
    installedDate: '', lastInspection: '', nextDue: '', notes: '',
  };
  const [eqForm, setEqForm] = useState({ ...emptyEqForm });

  const emptyActForm = {
    activityType: 'Inspection' as SecFireActivityType,
    title: '', scope: '', equipmentId: '', inspector: '',
    scheduledAt: '',
  };
  const [actForm, setActForm] = useState({ ...emptyActForm });

  const [completeForm, setCompleteForm] = useState({
    result: 'Pass' as SecFireResult, findings: '',
    participants: '' as string, evacuationTimeSec: '' as string,
  });

  // ── Data loading ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eq, act, s] = await Promise.all([
        fetchSecFireEquipment(currentPropertyId),
        fetchSecFireActivities(currentPropertyId),
        fetchSecStaff(currentPropertyId),
      ]);
      setEquipment(eq);
      setActivities(act);
      setStaff(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load fire safety data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const refreshAll = async () => {
    await load();
    addNotification('Fire safety data refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: equipment.length,
    operational: equipment.filter(e => e.status === 'Operational').length,
    issues: equipment.filter(e => e.status === 'Needs Service' || e.status === 'Out of Service').length,
    overdueInspections: equipment.filter(e => isOverdue(e.next_due)).length,
    upcoming: activities.filter(a => a.status === 'Scheduled' || a.status === 'In Progress').length,
  }), [equipment, activities]);

  const filteredEq = useMemo(() => {
    const q = search.toLowerCase();
    return equipment.filter(e => {
      const matchesStatus = eqStatusFilter === 'all' || e.status === eqStatusFilter;
      const matchesType = eqTypeFilter === 'all' || e.equipment_type === eqTypeFilter;
      const matchesSearch = !q ||
        e.id.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (e.serial_number?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [equipment, eqStatusFilter, eqTypeFilter, search]);

  const filteredAct = useMemo(() => {
    const q = search.toLowerCase();
    return activities.filter(a => {
      const matchesStatus = actStatusFilter === 'all' || a.status === actStatusFilter;
      const matchesType = actTypeFilter === 'all' || a.activity_type === actTypeFilter;
      const matchesSearch = !q ||
        a.id.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        (a.inspector?.toLowerCase().includes(q) ?? false) ||
        (a.scope?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [activities, actStatusFilter, actTypeFilter, search]);

  // ── Equipment mutations ────────────────────────────────────────────────

  const openNewEq = () => {
    setEditingEq(null);
    setEqForm({ ...emptyEqForm });
    setShowEqForm(true);
  };

  const openEditEq = (e: SecFireEquipment) => {
    setEditingEq(e);
    setEqForm({
      name: e.name,
      equipmentType: e.equipment_type,
      location: e.location,
      zone: e.zone || '',
      serialNumber: e.serial_number || '',
      model: e.model || '',
      installedDate: e.installed_date || '',
      lastInspection: e.last_inspection || '',
      nextDue: e.next_due || '',
      notes: e.notes || '',
    });
    setShowEqForm(true);
  };

  const saveEq = async () => {
    if (!eqForm.name.trim() || !eqForm.location.trim()) {
      addNotification('Name and location are required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: eqForm.name.trim(),
        equipmentType: eqForm.equipmentType,
        location: eqForm.location.trim(),
        zone: eqForm.zone || null,
        serialNumber: eqForm.serialNumber || null,
        model: eqForm.model || null,
        installedDate: eqForm.installedDate || null,
        lastInspection: eqForm.lastInspection || null,
        nextDue: eqForm.nextDue || null,
        notes: eqForm.notes || null,
      };
      if (editingEq) {
        const res = await updateSecFireEquipment(editingEq.id, payload);
        setEquipment(prev => prev.map(e => (e.id === editingEq.id ? res.equipment : e)));
        addNotification(`Equipment ${editingEq.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecFireEquipment({ propertyId: currentPropertyId, ...payload });
        setEquipment(prev => [created, ...prev]);
        addNotification(`Equipment "${created.name}" registered (${created.id})`, 'task', 'Security');
      }
      setShowEqForm(false);
      setEditingEq(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save equipment', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchEq = async (e: SecFireEquipment, patch: Parameters<typeof updateSecFireEquipment>[1], toast?: string) => {
    setActingOn(e.id);
    try {
      const res = await updateSecFireEquipment(e.id, patch);
      setEquipment(prev => prev.map(x => (x.id === e.id ? res.equipment : x)));
      addNotification(toast || `Equipment ${e.id} updated`, 'task', 'Security');
    } catch (err: any) {
      addNotification(err?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeEq = async () => {
    if (!deleteEqTarget) return;
    setActingOn(deleteEqTarget.id);
    try {
      await deleteSecFireEquipment(deleteEqTarget.id);
      setEquipment(prev => prev.filter(e => e.id !== deleteEqTarget.id));
      addNotification(`Equipment ${deleteEqTarget.id} removed`, 'task', 'Security');
      setDeleteEqTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Activity mutations ─────────────────────────────────────────────────

  const openNewAct = () => {
    setEditingAct(null);
    setActForm({ ...emptyActForm });
    setShowActForm(true);
  };

  const openEditAct = (a: SecFireActivity) => {
    setEditingAct(a);
    setActForm({
      activityType: a.activity_type,
      title: a.title,
      scope: a.scope || '',
      equipmentId: a.equipment_id || '',
      inspector: a.inspector || '',
      scheduledAt: toLocalInput(a.scheduled_at),
    });
    setShowActForm(true);
  };

  const saveAct = async () => {
    if (!actForm.title.trim()) {
      addNotification('Title is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        activityType: actForm.activityType,
        title: actForm.title.trim(),
        scope: actForm.scope || null,
        equipmentId: actForm.equipmentId || null,
        inspector: actForm.inspector || null,
        scheduledAt: actForm.scheduledAt ? new Date(actForm.scheduledAt).toISOString() : null,
      };
      if (editingAct) {
        const res = await updateSecFireActivity(editingAct.id, payload);
        setActivities(prev => prev.map(a => (a.id === editingAct.id ? res.activity : a)));
        addNotification(`Activity ${editingAct.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecFireActivity({ propertyId: currentPropertyId, ...payload });
        setActivities(prev => [created, ...prev]);
        addNotification(`${created.activity_type} scheduled — ${created.title} (${created.id})`, 'task', 'Security');
      }
      setShowActForm(false);
      setEditingAct(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save activity', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchAct = async (a: SecFireActivity, patch: Parameters<typeof updateSecFireActivity>[1], toast?: string) => {
    setActingOn(a.id);
    try {
      const res = await updateSecFireActivity(a.id, patch);
      setActivities(prev => prev.map(x => (x.id === a.id ? res.activity : x)));
      addNotification(toast || `Activity ${a.id} updated`, 'task', 'Security');
    } catch (err: any) {
      addNotification(err?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const openComplete = (a: SecFireActivity) => {
    setCompleteTarget(a);
    setCompleteForm({ result: 'Pass', findings: a.findings || '', participants: '', evacuationTimeSec: '' });
  };

  const confirmComplete = async () => {
    if (!completeTarget) return;
    setActingOn(completeTarget.id);
    try {
      const res = await updateSecFireActivity(completeTarget.id, {
        status: 'Completed',
        result: completeForm.result,
        findings: completeForm.findings || null,
        participants: completeForm.participants ? parseInt(completeForm.participants) : null,
        evacuationTimeSec: completeForm.evacuationTimeSec ? parseInt(completeForm.evacuationTimeSec) : null,
      });
      setActivities(prev => prev.map(a => (a.id === completeTarget.id ? res.activity : a)));
      if (res.activity.equipment_id) load(); // equipment status/dates may have changed
      addNotification(`${completeTarget.activity_type} completed — ${completeForm.result}`, 'task', 'Security');
      setCompleteTarget(null);
      setViewingAct(null);
    } catch (e: any) {
      addNotification(e?.message || 'Complete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeAct = async () => {
    if (!deleteActTarget) return;
    setActingOn(deleteActTarget.id);
    try {
      await deleteSecFireActivity(deleteActTarget.id);
      setActivities(prev => prev.filter(a => a.id !== deleteActTarget.id));
      addNotification(`Activity ${deleteActTarget.id} removed`, 'task', 'Security');
      setDeleteActTarget(null);
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Fire & Life Safety"
        subtitle="Monitor fire alarms, equipment inspections, and safety drills"
        icon={Flame}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            {tab === 'equipment' ? (
              <button onClick={openNewEq} className={button.primary}>
                <Plus className="w-4 h-4" /> Add Equipment
              </button>
            ) : (
              <button onClick={openNewAct} className={button.primary}>
                <Plus className="w-4 h-4" /> New Inspection
              </button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Equipment Items" value={stats.total} icon={ShieldAlert} tone="accent" />
        <StatCard title="Operational" value={stats.operational} icon={CheckCircle2} tone="success" />
        <StatCard title="Service Issues" value={stats.issues} icon={Wrench} tone="warning" />
        <StatCard title="Overdue Inspections" value={stats.overdueInspections} icon={AlertOctagon} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl w-fit">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearch(''); }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                active
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={tab === 'equipment' ? 'Search name, location, serial…' : 'Search title, inspector, scope…'}
              className={inputClass + ' pl-9'}
            />
          </div>
          {tab === 'equipment' ? (
            <>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={eqStatusFilter} onChange={e => setEqStatusFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={eqTypeFilter} onChange={e => setEqTypeFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <Filter size={12} className="text-slate-400" />
                <select value={actStatusFilter} onChange={e => setActStatusFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Status</option>
                  {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-slate-400" />
                <select value={actTypeFilter} onChange={e => setActTypeFilter(e.target.value as any)} className={filterSelect}>
                  <option value="all">All Types</option>
                  {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </SectionCard>

      {/* Equipment register */}
      {tab === 'equipment' && (
        <SectionCard title="Equipment Register" subtitle="Equipment · Type · Location · Status · Inspection dates" icon={ShieldAlert} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Equipment', 'Type', 'Location', 'Status', 'Last Inspection', 'Next Due', '']}
              emptyLabel="No equipment found."
              rows={filteredEq.map(e => [
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${isOverdue(e.next_due) ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                    <Flame className={`w-4 h-4 ${isOverdue(e.next_due) ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => setViewingEq(e)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{e.name}</button>
                    <div className="text-[10px] text-slate-400 font-mono">{e.id}{e.serial_number ? ` · ${e.serial_number}` : ''}</div>
                  </div>
                </div>,
                <Badge tone="neutral">{e.equipment_type}</Badge>,
                <span className="flex items-center gap-1 text-xs"><MapPin size={11} className="text-slate-400" />{e.location}</span>,
                <select
                  value={e.status}
                  onChange={ev => patchEq(e, { status: ev.target.value as SecFireEquipmentStatus }, `${e.name} → ${ev.target.value}`)}
                  disabled={actingOn === e.id}
                  className={inlineStatusSelect}
                >
                  {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>,
                <span className="text-xs text-slate-500">{fmtDate(e.last_inspection)}</span>,
                <span className={`text-xs font-semibold ${isOverdue(e.next_due) ? 'text-red-600' : 'text-slate-500'}`}>
                  {isOverdue(e.next_due) ? `OVERDUE · ${fmtDate(e.next_due)}` : fmtDate(e.next_due)}
                </span>,
                <div className="inline-flex gap-2">
                  <button onClick={() => setViewingEq(e)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => openEditEq(e)} disabled={actingOn === e.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteEqTarget(e)} disabled={actingOn === e.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                    {actingOn === e.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>,
              ])}
              empty={filteredEq.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Activities */}
      {tab === 'activities' && (
        <SectionCard title="Inspections & Drills" subtitle="Activity · Equipment · Schedule · Result · Inspector" icon={ClipboardCheck} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Activity', 'Type', 'Equipment / Scope', 'Status', 'Result', 'Scheduled', '']}
              emptyLabel="No activities found."
              rows={filteredAct.map(a => {
                const Icon = ACTIVITY_ICON[a.activity_type] || ClipboardCheck;
                return [
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${a.status === 'Overdue' ? 'bg-red-500/10' : 'bg-[var(--color-accent-operations)]/10'}`}>
                      <Icon className={`w-4 h-4 ${a.status === 'Overdue' ? 'text-red-500' : 'text-[var(--color-accent-operations)]'}`} />
                    </div>
                    <div className="min-w-0">
                      <button onClick={() => setViewingAct(a)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{a.title}</button>
                      <div className="text-[10px] text-slate-400 font-mono">{a.id}{a.inspector ? ` · ${a.inspector}` : ''}</div>
                    </div>
                  </div>,
                  <Badge tone={a.activity_type === 'Drill' ? 'info' : 'neutral'}>{a.activity_type}</Badge>,
                  <span className="text-xs">{a.sec_fire_equipment?.name || a.scope || '—'}</span>,
                  <select
                    value={a.status}
                    onChange={ev => patchAct(a, { status: ev.target.value as SecFireActivityStatus }, `Activity ${a.id} → ${ev.target.value}`)}
                    disabled={actingOn === a.id}
                    className={inlineStatusSelect}
                  >
                    {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>,
                  a.result ? <Badge tone={RESULT_TONE[a.result]}>{a.result}</Badge> : <span className="text-xs text-slate-400">—</span>,
                  <span className="text-xs text-slate-500">{fmtDateTime(a.scheduled_at)}</span>,
                  <div className="inline-flex gap-2 items-center">
                    {(a.status === 'Scheduled' || a.status === 'In Progress' || a.status === 'Overdue') && (
                      <button
                        onClick={() => openComplete(a)}
                        disabled={actingOn === a.id}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                      >
                        Complete
                      </button>
                    )}
                    <button onClick={() => setViewingAct(a)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openEditAct(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteActTarget(a)} disabled={actingOn === a.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                      {actingOn === a.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>,
                ];
              })}
              empty={filteredAct.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* Equipment form modal */}
      <ModalSystem
        isOpen={showEqForm}
        onClose={() => { setShowEqForm(false); setEditingEq(null); }}
        onConfirm={saveEq}
        title={editingEq ? `Edit ${editingEq.name}` : 'Register Equipment'}
        subtitle={editingEq ? `Equipment ${editingEq.id}` : 'Add fire/life-safety equipment to the register'}
        variant="form"
        loading={submitting}
        confirmLabel={editingEq ? 'Save Changes' : 'Register'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Equipment Name">
              <input className={inputClass} value={eqForm.name} onChange={e => setEqForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Extinguisher — Lobby" />
            </Field>
            <Field label="Type">
              <select className={inputClass} value={eqForm.equipmentType} onChange={e => setEqForm(f => ({ ...f, equipmentType: e.target.value as SecFireEquipmentType }))}>
                {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location">
              <input className={inputClass} value={eqForm.location} onChange={e => setEqForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g., Lobby - Pillar 2" />
            </Field>
            <Field label="Zone">
              <input className={inputClass} value={eqForm.zone} onChange={e => setEqForm(f => ({ ...f, zone: e.target.value }))} placeholder="e.g., Public Areas" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Serial Number">
              <input className={inputClass} value={eqForm.serialNumber} onChange={e => setEqForm(f => ({ ...f, serialNumber: e.target.value }))} />
            </Field>
            <Field label="Model">
              <input className={inputClass} value={eqForm.model} onChange={e => setEqForm(f => ({ ...f, model: e.target.value }))} placeholder="e.g., Amerex 10lb ABC" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Installed">
              <input type="date" className={inputClass} value={eqForm.installedDate} onChange={e => setEqForm(f => ({ ...f, installedDate: e.target.value }))} />
            </Field>
            <Field label="Last Inspection">
              <input type="date" className={inputClass} value={eqForm.lastInspection} onChange={e => setEqForm(f => ({ ...f, lastInspection: e.target.value }))} />
            </Field>
            <Field label="Next Due">
              <input type="date" className={inputClass} value={eqForm.nextDue} onChange={e => setEqForm(f => ({ ...f, nextDue: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputClass + ' min-h-[56px]'} value={eqForm.notes} onChange={e => setEqForm(f => ({ ...f, notes: e.target.value }))} placeholder="Service contract, known issues…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Equipment detail modal */}
      <ModalSystem
        isOpen={!!viewingEq}
        onClose={() => setViewingEq(null)}
        title={viewingEq ? `Equipment ${viewingEq.id}` : 'Equipment Detail'}
        subtitle={viewingEq ? `${viewingEq.name} · ${viewingEq.equipment_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewingEq && (
          <div className="space-y-5">
            {isOverdue(viewingEq.next_due) && (
              <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                <AlertOctagon className="w-4 h-4 shrink-0" /> INSPECTION OVERDUE — was due {fmtDate(viewingEq.next_due)}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={EQ_STATUS_TONE[viewingEq.status]}>{viewingEq.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Type</p>
                <Badge tone="neutral">{viewingEq.equipment_type}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Serial</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">{viewingEq.serial_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Model</p>
                <p className="text-slate-600 dark:text-slate-300">{viewingEq.model || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Location</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><MapPin size={11} />{viewingEq.location}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Zone</p>
                <p className="text-slate-600 dark:text-slate-300">{viewingEq.zone || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Inspection</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDate(viewingEq.last_inspection)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Next Due</p>
                <p className={`font-semibold ${isOverdue(viewingEq.next_due) ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>{fmtDate(viewingEq.next_due)}</p>
              </div>
              {viewingEq.notes && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{viewingEq.notes}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {viewingEq.status !== 'Operational' && (
                <button onClick={() => { patchEq(viewingEq, { status: 'Operational' }, `${viewingEq.name} returned to service`); setViewingEq(null); }} className={button.primary}>
                  <CheckCircle2 className="w-4 h-4" /> Return to Service
                </button>
              )}
              <button onClick={() => { setViewingEq(null); openEditEq(viewingEq); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteEqTarget(viewingEq)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Activity form modal */}
      <ModalSystem
        isOpen={showActForm}
        onClose={() => { setShowActForm(false); setEditingAct(null); }}
        onConfirm={saveAct}
        title={editingAct ? `Edit ${editingAct.id}` : 'Schedule Activity'}
        subtitle={editingAct ? editingAct.title : 'Inspection, alarm test, drill, or maintenance'}
        variant="form"
        loading={submitting}
        confirmLabel={editingAct ? 'Save Changes' : 'Schedule'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Activity Type">
              <select className={inputClass} value={actForm.activityType} onChange={e => setActForm(f => ({ ...f, activityType: e.target.value as SecFireActivityType }))}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Title">
              <input className={inputClass} value={actForm.title} onChange={e => setActForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g., Quarterly Alarm Panel Inspection" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Linked Equipment (optional)">
              <select className={inputClass} value={actForm.equipmentId} onChange={e => setActForm(f => ({ ...f, equipmentId: e.target.value }))}>
                <option value="">— Area-wide / none —</option>
                {equipment.map(e => <option key={e.id} value={e.id}>{e.id} — {e.name}</option>)}
              </select>
            </Field>
            <Field label="Scope / Area">
              <input className={inputClass} value={actForm.scope} onChange={e => setActForm(f => ({ ...f, scope: e.target.value }))} placeholder="e.g., All Areas, Kitchen" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Inspector / Lead">
              <input
                className={inputClass}
                list="sec-fire-inspectors"
                value={actForm.inspector}
                onChange={e => setActForm(f => ({ ...f, inspector: e.target.value }))}
                placeholder="Staff member or vendor"
              />
              <datalist id="sec-fire-inspectors">
                {staff.map(s => <option key={s.id} value={s.name}>{s.role}</option>)}
              </datalist>
            </Field>
            <Field label="Scheduled At">
              <input type="datetime-local" className={inputClass} value={actForm.scheduledAt} onChange={e => setActForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Activity detail modal */}
      <ModalSystem
        isOpen={!!viewingAct}
        onClose={() => setViewingAct(null)}
        title={viewingAct ? `Activity ${viewingAct.id}` : 'Activity Detail'}
        subtitle={viewingAct ? `${viewingAct.title} · ${viewingAct.activity_type}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewingAct && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={ACT_STATUS_TONE[viewingAct.status]}>{viewingAct.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Type</p>
                <Badge tone="neutral">{viewingAct.activity_type}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Result</p>
                {viewingAct.result ? <Badge tone={RESULT_TONE[viewingAct.result]}>{viewingAct.result}</Badge> : <span className="text-slate-400">—</span>}
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Inspector</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewingAct.inspector || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Equipment</p>
                <p className="text-slate-600 dark:text-slate-300">{viewingAct.sec_fire_equipment?.name || viewingAct.equipment_id || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Scope</p>
                <p className="text-slate-600 dark:text-slate-300">{viewingAct.scope || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Scheduled</p>
                <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1"><CalendarClock size={11} />{fmtDateTime(viewingAct.scheduled_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Completed</p>
                <p className="text-slate-600 dark:text-slate-300">{fmtDateTime(viewingAct.completed_at)}</p>
              </div>
              {viewingAct.activity_type === 'Drill' && (
                <>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Participants</p>
                    <p className="text-slate-600 dark:text-slate-300">{viewingAct.participants ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Evac Time</p>
                    <p className="text-slate-600 dark:text-slate-300">{viewingAct.evacuation_time_sec != null ? `${viewingAct.evacuation_time_sec}s` : '—'}</p>
                  </div>
                </>
              )}
              {viewingAct.findings && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Findings</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{viewingAct.findings}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(viewingAct.status === 'Scheduled' || viewingAct.status === 'Overdue') && (
                <button onClick={() => patchAct(viewingAct, { status: 'In Progress' }, `Activity ${viewingAct.id} started`)} disabled={actingOn === viewingAct.id} className={button.secondary + ' disabled:opacity-50'}>
                  <Play className="w-4 h-4" /> Start
                </button>
              )}
              {viewingAct.status !== 'Completed' && viewingAct.status !== 'Cancelled' && (
                <button onClick={() => openComplete(viewingAct)} disabled={actingOn === viewingAct.id} className={button.primary + ' disabled:opacity-50'}>
                  <Flag className="w-4 h-4" /> Record Result
                </button>
              )}
              <button onClick={() => { setViewingAct(null); openEditAct(viewingAct); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteActTarget(viewingAct)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Complete activity modal */}
      <ModalSystem
        isOpen={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        onConfirm={confirmComplete}
        title={completeTarget ? `Complete ${completeTarget.id}` : 'Complete Activity'}
        subtitle={completeTarget ? `${completeTarget.title} — record the result${completeTarget.equipment_id ? ' (updates equipment inspection dates)' : ''}` : ''}
        variant="form"
        loading={actingOn === completeTarget?.id}
        confirmLabel="Complete"
      >
        <div className="space-y-4">
          <Field label="Result">
            <div className="flex gap-2">
              {RESULTS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCompleteForm(f => ({ ...f, result: r }))}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition ${
                    completeForm.result === r
                      ? r === 'Fail'
                        ? 'bg-red-500/10 border-red-500 text-red-600'
                        : 'bg-emerald-500/10 border-emerald-500 text-emerald-600'
                      : 'border-gray-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
          {completeTarget?.activity_type === 'Drill' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Participants">
                <input type="number" min={0} className={inputClass} value={completeForm.participants} onChange={e => setCompleteForm(f => ({ ...f, participants: e.target.value }))} placeholder="Headcount" />
              </Field>
              <Field label="Evacuation Time (sec)">
                <input type="number" min={0} className={inputClass} value={completeForm.evacuationTimeSec} onChange={e => setCompleteForm(f => ({ ...f, evacuationTimeSec: e.target.value }))} placeholder="e.g., 240" />
              </Field>
            </div>
          )}
          <Field label="Findings">
            <textarea className={inputClass + ' min-h-[64px]'} value={completeForm.findings} onChange={e => setCompleteForm(f => ({ ...f, findings: e.target.value }))} placeholder="Inspection findings, deficiencies, follow-ups…" />
          </Field>
        </div>
      </ModalSystem>

      {/* Delete confirms */}
      <ModalSystem
        isOpen={!!deleteEqTarget}
        onClose={() => setDeleteEqTarget(null)}
        onConfirm={removeEq}
        title="Remove Equipment"
        subtitle={deleteEqTarget ? `Permanently remove ${deleteEqTarget.id} (${deleteEqTarget.name})? Linked activities are kept but unlinked.` : ''}
        variant="confirm"
        loading={actingOn === deleteEqTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
      <ModalSystem
        isOpen={!!deleteActTarget}
        onClose={() => setDeleteActTarget(null)}
        onConfirm={removeAct}
        title="Remove Activity"
        subtitle={deleteActTarget ? `Permanently remove activity ${deleteActTarget.id} (${deleteActTarget.title})?` : ''}
        variant="confirm"
        loading={actingOn === deleteActTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default FireLifeSafety;
