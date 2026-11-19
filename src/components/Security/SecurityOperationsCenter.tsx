/**
 * Security Operations Center — /erp/security/soc.
 *
 * DB-integrated via /api/sec-portal/soc/* routes (migration 600).
 * Staff Availability was moved to the dedicated Staff Management tab
 * (/erp/security/staff — StaffManagement.tsx).
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, pill sub-tab bar, SectionCard + DataTable,
 * Badge status pills, ModalSystem forms, ERP notifications on mutations.
 * Multi-property scoping via useERP().currentPropertyId.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, MapPin, Camera, Radio, ShieldAlert, Lock, Monitor,
  RefreshCw, Loader2, ServerCrash, Plus, CheckCircle2, Bell, Siren,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSocOverview,
  createSecIncident,
  updateSecIncident,
  updateSecPatrol,
  updateSecAlarm,
  updateSecEmergency,
  type SecIncident,
  type SecPatrol,
  type SecCamera,
  type SecAlarm,
  type SecAccessEvent,
  type SecEmergency,
  type SecPriority,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

type SubTab = 'incidents' | 'patrols' | 'cctv' | 'alarms' | 'access' | 'emergency';

const PRIORITY_TONE: Record<SecPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const INCIDENT_STATUS_TONE: Record<SecIncident['status'], StatusTone> = {
  Active: 'info', Pending: 'neutral', 'In Progress': 'warning', Resolved: 'success',
  Draft: 'neutral', Reported: 'info', Classified: 'accent', Assigned: 'warning',
  Investigation: 'info', 'Corrective Action': 'success', Closed: 'success',
};

const CLOSED_INCIDENT_STATUSES: SecIncident['status'][] = ['Resolved', 'Closed'];

const PATROL_STATUS_TONE: Record<SecPatrol['status'], StatusTone> = {
  Scheduled: 'neutral', 'In Progress': 'info', Completed: 'success', Cancelled: 'danger',
};

const CAMERA_STATUS_TONE: Record<SecCamera['status'], StatusTone> = {
  Online: 'success', Offline: 'danger', Maintenance: 'warning',
  Recording: 'info', Standby: 'neutral',
};

const ALARM_STATUS_TONE: Record<SecAlarm['status'], StatusTone> = {
  Active: 'danger', Cleared: 'info', Resolved: 'success',
};

const ACCESS_STATUS_TONE: Record<SecAccessEvent['status'], StatusTone> = {
  Normal: 'success', Warning: 'warning', Flagged: 'danger',
};

const EMERGENCY_STATUS_TONE: Record<SecEmergency['status'], StatusTone> = {
  Active: 'danger', 'In Progress': 'warning', Scheduled: 'info', Resolved: 'success',
};

// ── UI helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const actionBtn =
  'px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 transition-colors';

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
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── F&B-style DataTable ───────────────────────────────────────────────
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No records found.</td></tr>
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

const SecurityOperationsCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('incidents');

  const [incidents, setIncidents] = useState<SecIncident[]>([]);
  const [patrols, setPatrols] = useState<SecPatrol[]>([]);
  const [cameras, setCameras] = useState<SecCamera[]>([]);
  const [alarms, setAlarms] = useState<SecAlarm[]>([]);
  const [accessEvents, setAccessEvents] = useState<SecAccessEvent[]>([]);
  const [emergencies, setEmergencies] = useState<SecEmergency[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // New Incident modal
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const emptyIncidentForm = {
    incidentType: '', location: '', priority: 'Medium' as SecPriority, assignedTo: '', description: '',
  };
  const [incidentForm, setIncidentForm] = useState({ ...emptyIncidentForm });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await fetchSocOverview(currentPropertyId);
      setIncidents(overview.incidents);
      setPatrols(overview.patrols);
      setCameras(overview.cameras);
      setAlarms(overview.alarms);
      setAccessEvents(overview.accessEvents);
      setEmergencies(overview.emergencies);
    } catch (e: any) {
      setError(e?.message || 'Failed to load security operations data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshAll = async () => {
    await loadAll();
    addNotification('Security operations refreshed', 'task', 'Security');
  };

  // ── Mutations ──────────────────────────────────────────────────────────

  const patchIncident = async (id: string, status: SecIncident['status']) => {
    setActingOn(id);
    try {
      const res = await updateSecIncident(id, { status });
      setIncidents(prev => prev.map(i => (i.id === id ? res.incident : i)));
      addNotification(`Incident ${id} → ${status}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Incident update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const completePatrol = async (id: string) => {
    setActingOn(id);
    try {
      const res = await updateSecPatrol(id, { status: 'Completed' });
      setPatrols(prev => prev.map(p => (p.id === id ? res.patrol : p)));
      addNotification(`Patrol ${id} completed`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Patrol update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const patchAlarm = async (id: string, patch: { acknowledged?: boolean; status?: SecAlarm['status'] }, label: string) => {
    setActingOn(id);
    try {
      const res = await updateSecAlarm(id, patch);
      setAlarms(prev => prev.map(a => (a.id === id ? res.alarm : a)));
      addNotification(`Alarm ${id} ${label}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Alarm update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const resolveEmergency = async (id: string) => {
    setActingOn(id);
    try {
      const res = await updateSecEmergency(id, { status: 'Resolved' });
      setEmergencies(prev => prev.map(e => (e.id === id ? res.emergency : e)));
      addNotification(`Emergency ${id} resolved`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Resolve failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const saveIncident = async () => {
    if (!incidentForm.incidentType.trim() || !incidentForm.location.trim()) {
      addNotification('Incident type and location are required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSecIncident({
        propertyId: currentPropertyId,
        incidentType: incidentForm.incidentType,
        location: incidentForm.location,
        priority: incidentForm.priority,
        assignedTo: incidentForm.assignedTo || null,
        description: incidentForm.description || null,
      });
      setIncidents(prev => [created, ...prev]);
      addNotification(`Incident ${created.id} created`, 'task', 'Security');
      setShowIncidentModal(false);
      setIncidentForm({ ...emptyIncidentForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create incident', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    activeIncidents: incidents.filter(i => !CLOSED_INCIDENT_STATUSES.includes(i.status)).length,
    patrolsLive: patrols.filter(p => p.status === 'In Progress').length,
    camerasOnline: cameras.filter(c => c.status === 'Online').length,
    camerasTotal: cameras.length,
    activeAlarms: alarms.filter(a => a.status === 'Active').length,
    unackedAlarms: alarms.filter(a => !a.acknowledged).length,
    flaggedAccess: accessEvents.filter(e => e.status === 'Flagged').length,
    activeEmergencies: emergencies.filter(e => e.status === 'Active').length,
  }), [incidents, patrols, cameras, alarms, accessEvents, emergencies]);

  const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon; count?: number }[] = [
    { id: 'incidents', label: 'Incident Queue', icon: AlertTriangle, count: stats.activeIncidents },
    { id: 'patrols', label: 'Active Patrols', icon: MapPin, count: stats.patrolsLive },
    { id: 'cctv', label: 'CCTV Status', icon: Camera, count: stats.camerasOnline },
    { id: 'alarms', label: 'Alarm Status', icon: Radio, count: stats.activeAlarms },
    { id: 'access', label: 'Access Events', icon: Lock, count: stats.flaggedAccess },
    { id: 'emergency', label: 'Emergency', icon: ShieldAlert, count: stats.activeEmergencies },
  ];

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Security Operations Center"
        subtitle="Real-time security monitoring and dispatch"
        icon={Monitor}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowIncidentModal(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Incident
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Incidents" value={stats.activeIncidents} icon={AlertTriangle} tone="danger" />
        <StatCard title="Patrols In Progress" value={stats.patrolsLive} icon={MapPin} tone="info" />
        <StatCard title="Cameras Online" value={`${stats.camerasOnline}/${stats.camerasTotal}`} icon={Camera} tone="success" />
        <StatCard title="Active Alarms" value={stats.activeAlarms} icon={Bell} tone="warning" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadAll} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Sub-tab navigation — HK/F&B pill style */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
            {t.count !== undefined && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ Incident Queue ══════════════════════════════════════════════ */}
      {subTab === 'incidents' && (
        <SectionCard title="Incident Queue" subtitle="Priority · Status · Assignment · Reported" icon={AlertTriangle} tone="accent" pad="none">
          {error ? (
            <div className="flex items-center gap-3 text-[var(--color-danger)] px-6 py-4">
              <ServerCrash size={18} /><span className="text-sm font-bold">{error}</span>
              <button onClick={loadAll} className="ml-auto text-xs underline">Retry</button>
            </div>
          ) : loading ? <LoadingRow /> : (
            <DataTable
              headers={['ID', 'Type', 'Location', 'Priority', 'Status', 'Assigned To', 'Reported', '']}
              rows={incidents.map(i => [
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{i.id}</span>,
                <span className="font-medium text-slate-900 dark:text-white">{i.incident_type}</span>,
                i.location,
                <Badge tone={PRIORITY_TONE[i.priority]}>{i.priority}</Badge>,
                <Badge tone={INCIDENT_STATUS_TONE[i.status]}>{i.status}</Badge>,
                i.assigned_to || <span className="text-slate-400">Unassigned</span>,
                <span className="text-xs text-slate-500">{fmtTime(i.reported_at)}</span>,
                !CLOSED_INCIDENT_STATUSES.includes(i.status) ? (
                  <button
                    onClick={() => patchIncident(i.id, i.status === 'In Progress' || i.status === 'Investigation' ? 'Resolved' : 'In Progress')}
                    disabled={actingOn === i.id}
                    className={`${actionBtn} ${i.status === 'In Progress' || i.status === 'Investigation' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300'}`}
                  >
                    {actingOn === i.id ? '…' : i.status === 'In Progress' || i.status === 'Investigation' ? 'Resolve' : 'Start'}
                  </button>
                ) : <CheckCircle2 size={14} className="text-emerald-500" />,
              ])}
              empty={incidents.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* ══ Active Patrols ══════════════════════════════════════════════ */}
      {subTab === 'patrols' && (
        <SectionCard title="Active Patrols" subtitle="Officer · Route · Checkpoint · Progress" icon={MapPin} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['ID', 'Officer', 'Route', 'Last Checkpoint', 'Progress', 'Status', 'Started', '']}
              rows={patrols.map(p => [
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{p.id}</span>,
                <span className="font-medium text-slate-900 dark:text-white">{p.officer}</span>,
                p.route,
                p.last_checkpoint || '—',
                <div className="w-28">
                  <div className="flex items-center justify-between text-[9px] font-mono mb-1">
                    <span className="font-black text-slate-700 dark:text-slate-200">{p.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--color-accent-operations)]" style={{ width: `${p.progress}%` }} />
                  </div>
                </div>,
                <Badge tone={PATROL_STATUS_TONE[p.status]}>{p.status}</Badge>,
                <span className="text-xs text-slate-500">{fmtTime(p.started_at)}</span>,
                p.status === 'In Progress' ? (
                  <button
                    onClick={() => completePatrol(p.id)}
                    disabled={actingOn === p.id}
                    className={`${actionBtn} bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300`}
                  >
                    {actingOn === p.id ? '…' : 'Complete'}
                  </button>
                ) : null,
              ])}
              empty={patrols.length === 0}
              emptyColSpan={8}
            />
          )}
        </SectionCard>
      )}

      {/* ══ CCTV Status ═════════════════════════════════════════════════ */}
      {subTab === 'cctv' && (
        <SectionCard title="CCTV Status" subtitle="Camera · Location · Recording · Last motion" icon={Camera} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['Camera', 'ID', 'Location', 'Status', 'Recording', 'Last Motion']}
              rows={cameras.map(c => [
                <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  <Camera size={14} className={c.status === 'Online' ? 'text-emerald-500' : 'text-rose-500'} />
                  {c.name}
                </span>,
                <span className="font-mono text-xs">{c.id}</span>,
                c.location,
                <Badge tone={CAMERA_STATUS_TONE[c.status]}>{c.status}</Badge>,
                c.recording ? <Badge tone="info">Recording</Badge> : <span className="text-xs text-slate-400">Off</span>,
                <span className="text-xs text-slate-500">{fmtTime(c.last_motion_at)}</span>,
              ])}
              empty={cameras.length === 0}
              emptyColSpan={6}
            />
          )}
        </SectionCard>
      )}

      {/* ══ Alarm Status ════════════════════════════════════════════════ */}
      {subTab === 'alarms' && (
        <SectionCard title="Alarm Status" subtitle="Type · Location · Acknowledgement" icon={Radio} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['ID', 'Type', 'Location', 'Status', 'Acknowledged', 'Triggered', '']}
              rows={alarms.map(a => [
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{a.id}</span>,
                <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  <Radio size={14} className={a.status === 'Active' ? 'text-rose-500' : 'text-emerald-500'} />
                  {a.alarm_type}
                </span>,
                a.location,
                <Badge tone={ALARM_STATUS_TONE[a.status]}>{a.status}</Badge>,
                a.acknowledged
                  ? <Badge tone="success" icon={CheckCircle2}>Acked</Badge>
                  : <Badge tone="warning">Pending</Badge>,
                <span className="text-xs text-slate-500">{fmtTime(a.triggered_at)}</span>,
                <div className="inline-flex gap-1.5">
                  {!a.acknowledged && (
                    <button
                      onClick={() => patchAlarm(a.id, { acknowledged: true }, 'acknowledged')}
                      disabled={actingOn === a.id}
                      className={`${actionBtn} bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300`}
                    >
                      {actingOn === a.id ? '…' : 'Ack'}
                    </button>
                  )}
                  {a.status === 'Active' && (
                    <button
                      onClick={() => patchAlarm(a.id, { status: 'Resolved' }, 'resolved')}
                      disabled={actingOn === a.id}
                      className={`${actionBtn} bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300`}
                    >
                      {actingOn === a.id ? '…' : 'Resolve'}
                    </button>
                  )}
                </div>,
              ])}
              empty={alarms.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* ══ Access Events ═══════════════════════════════════════════════ */}
      {subTab === 'access' && (
        <SectionCard title="Access Control Events" subtitle="Event · User · Location · Status" icon={Lock} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['ID', 'Event', 'User', 'Location', 'Status', 'Time']}
              rows={accessEvents.map(e => [
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{e.id}</span>,
                <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  <Lock size={14} className={e.status === 'Flagged' ? 'text-rose-500' : e.status === 'Warning' ? 'text-amber-500' : 'text-emerald-500'} />
                  {e.event_type}
                </span>,
                e.user_name || <span className="text-slate-400">Unknown</span>,
                e.location,
                <Badge tone={ACCESS_STATUS_TONE[e.status]}>{e.status}</Badge>,
                <span className="text-xs text-slate-500">{fmtTime(e.occurred_at)}</span>,
              ])}
              empty={accessEvents.length === 0}
              emptyColSpan={6}
            />
          )}
        </SectionCard>
      )}

      {/* ══ Emergency ═══════════════════════════════════════════════════ */}
      {subTab === 'emergency' && (
        <SectionCard title="Emergency Notifications" subtitle="Type · Location · Priority · Status" icon={Siren} tone="accent" pad="none">
          {loading ? <LoadingRow /> : (
            <DataTable
              headers={['ID', 'Type', 'Location', 'Priority', 'Status', 'Time', '']}
              rows={emergencies.map(e => [
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{e.id}</span>,
                <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  <ShieldAlert size={14} className={e.priority === 'Critical' ? 'text-rose-500' : e.priority === 'High' ? 'text-amber-500' : 'text-blue-500'} />
                  {e.emergency_type}
                </span>,
                e.location,
                <Badge tone={PRIORITY_TONE[e.priority]}>{e.priority}</Badge>,
                <Badge tone={EMERGENCY_STATUS_TONE[e.status]}>{e.status}</Badge>,
                <span className="text-xs text-slate-500">{fmtTime(e.occurred_at)}</span>,
                (e.status === 'Active' || e.status === 'In Progress') ? (
                  <button
                    onClick={() => resolveEmergency(e.id)}
                    disabled={actingOn === e.id}
                    className={`${actionBtn} bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300`}
                  >
                    {actingOn === e.id ? '…' : 'Resolve'}
                  </button>
                ) : null,
              ])}
              empty={emergencies.length === 0}
              emptyColSpan={7}
            />
          )}
        </SectionCard>
      )}

      {/* New Incident modal */}
      <ModalSystem
        isOpen={showIncidentModal}
        onClose={() => setShowIncidentModal(false)}
        onConfirm={saveIncident}
        title="New Incident"
        subtitle="Log a security incident to the operations queue"
        variant="form"
        loading={submitting}
        confirmLabel="Create Incident"
      >
        <div className="space-y-4">
          <Field label="Incident Type">
            <input
              className={inputClass}
              value={incidentForm.incidentType}
              onChange={e => setIncidentForm(f => ({ ...f, incidentType: e.target.value }))}
              placeholder="e.g. Unauthorized Access"
            />
          </Field>
          <Field label="Location">
            <input
              className={inputClass}
              value={incidentForm.location}
              onChange={e => setIncidentForm(f => ({ ...f, location: e.target.value }))}
              placeholder="e.g. Rear Entrance"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Priority">
              <select
                className={inputClass}
                value={incidentForm.priority}
                onChange={e => setIncidentForm(f => ({ ...f, priority: e.target.value as SecPriority }))}
              >
                {(['Critical', 'High', 'Medium', 'Low'] as SecPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Assign To">
              <input
                className={inputClass}
                value={incidentForm.assignedTo}
                onChange={e => setIncidentForm(f => ({ ...f, assignedTo: e.target.value }))}
                placeholder="Officer name (optional)"
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              className={inputClass}
              rows={3}
              value={incidentForm.description}
              onChange={e => setIncidentForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional details…"
            />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default SecurityOperationsCenter;
