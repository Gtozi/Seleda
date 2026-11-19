/**
 * CCTV Management — /erp/security/cctv.
 *
 * DB-integrated via /api/sec-portal/soc/cctv routes (migrations 600/606).
 * Shares the sec_cctv_cameras table with the SOC camera board — one source
 * of truth. Camera actions (motion, snapshot, playback requests, recording
 * and status changes) persist to sec_cctv_events as a real activity log.
 *
 * UI follows the HK StaffManagementModule / F&B StaffOperations pattern:
 * PageHeader, StatCard KPIs, SectionCard + DataTable, Badge status pills,
 * ModalSystem forms, ERP notifications on mutations.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Camera, Plus, Search, CheckCircle2, Eye, Pencil, Trash2, Video,
  Monitor, AlertTriangle, RefreshCw, Loader2, ServerCrash, Filter,
  MapPin, Radio, HardDrive, History, Clock, CircleDot,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecCameras, fetchSecCamera, createSecCamera, updateSecCamera,
  deleteSecCamera, addSecCameraEvent,
  type SecCamera, type SecCameraDetail, type SecCameraStatus,
  type SecCameraHealth, type SecCctvEventType,
} from '../../services/securityService';

// ── Static registries ────────────────────────────────────────────────────

const LOCATIONS = ['Main Building', 'Exterior', 'Parking', 'Recreation', 'Service Areas', 'Public Areas'];
const RESOLUTIONS = ['720p', '1080p', '4K'];
const HEALTHS: SecCameraHealth[] = ['Good', 'Fair', 'Poor'];

const CAMERA_STATUSES: SecCameraStatus[] = ['Online', 'Offline', 'Maintenance', 'Recording', 'Standby'];

const STATUS_TONE: Record<SecCameraStatus, StatusTone> = {
  Online: 'success',
  Offline: 'danger',
  Maintenance: 'warning',
  Recording: 'info',
  Standby: 'neutral',
};

const HEALTH_TONE: Record<SecCameraHealth, StatusTone> = {
  Good: 'success', Fair: 'warning', Poor: 'danger',
};

const EVENT_DOT: Record<SecCctvEventType, string> = {
  'Motion Detected': 'bg-amber-500',
  Snapshot: 'bg-blue-500',
  'Playback Requested': 'bg-purple-500',
  'Recording Started': 'bg-emerald-500',
  'Recording Stopped': 'bg-slate-400',
  'Status Change': 'bg-blue-500',
  Maintenance: 'bg-orange-500',
  Note: 'bg-slate-400',
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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
            <tr><td colSpan={emptyColSpan} className="px-6 py-8 text-center text-slate-400">No cameras found.</td></tr>
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

const CCTVManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [cameras, setCameras] = useState<SecCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SecCameraStatus>('all');
  const [filterLocation, setFilterLocation] = useState<'all' | string>('all');

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SecCamera | null>(null);
  const [detail, setDetail] = useState<SecCameraDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SecCamera | null>(null);

  const emptyForm = {
    name: '', location: 'Main Building', ipAddress: '', model: '',
    resolution: '1080p', retentionDays: 30, health: 'Good' as SecCameraHealth,
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadCameras = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCameras(await fetchSecCameras(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load cameras');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchSecCamera(id));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load camera detail', 'warning', 'Security');
    } finally {
      setDetailLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadCameras(); }, [loadCameras]);

  const openDetail = (c: SecCamera) => {
    setDetail(null);
    loadDetail(c.id);
  };

  const refreshAll = async () => {
    await loadCameras();
    if (detail) await loadDetail(detail.camera.id);
    addNotification('Camera registry refreshed', 'task', 'Security');
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: cameras.length,
    online: cameras.filter(c => c.status === 'Online' || c.status === 'Recording').length,
    offline: cameras.filter(c => c.status === 'Offline').length,
    recording: cameras.filter(c => c.recording).length,
  }), [cameras]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cameras.filter(c => {
      const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
      const matchesLocation = filterLocation === 'all' || c.location === filterLocation;
      const matchesSearch = !q ||
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.ip_address?.includes(q) ?? false) ||
        (c.model?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesLocation && matchesSearch;
    });
  }, [cameras, filterStatus, filterLocation, search]);

  const locationsInUse = useMemo(() => [...new Set(cameras.map(c => c.location))], [cameras]);

  // ── Mutations ──────────────────────────────────────────────────────────

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (c: SecCamera) => {
    setEditing(c);
    setForm({
      name: c.name,
      location: c.location,
      ipAddress: c.ip_address || '',
      model: c.model || '',
      resolution: c.resolution,
      retentionDays: c.retention_days,
      health: c.health,
    });
    setShowForm(true);
  };

  const saveCamera = async () => {
    if (!form.name.trim()) {
      addNotification('Camera name is required', 'warning', 'Security');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location,
        ipAddress: form.ipAddress || null,
        model: form.model || null,
        resolution: form.resolution,
        retentionDays: form.retentionDays,
        health: form.health,
      };
      if (editing) {
        const res = await updateSecCamera(editing.id, payload);
        setCameras(prev => prev.map(c => (c.id === editing.id ? res.camera : c)));
        if (detail?.camera.id === editing.id) loadDetail(editing.id);
        addNotification(`Camera ${editing.id} updated`, 'task', 'Security');
      } else {
        const created = await createSecCamera({ propertyId: currentPropertyId, ...payload });
        setCameras(prev => [created, ...prev]);
        addNotification(`Camera ${created.name} added (${created.id})`, 'task', 'Security');
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save camera', 'warning', 'Security');
    } finally {
      setSubmitting(false);
    }
  };

  const patchCamera = async (c: SecCamera, patch: Parameters<typeof updateSecCamera>[1], toast?: string) => {
    setActingOn(c.id);
    try {
      const res = await updateSecCamera(c.id, patch);
      setCameras(prev => prev.map(x => (x.id === c.id ? res.camera : x)));
      if (detail?.camera.id === c.id) loadDetail(c.id);
      addNotification(toast || `Camera ${c.id} updated`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const logEvent = async (c: SecCamera, eventType: SecCctvEventType, detailText?: string) => {
    setActingOn(c.id);
    try {
      await addSecCameraEvent(c.id, { eventType, detail: detailText || null });
      if (detail?.camera.id === c.id) loadDetail(c.id);
      if (eventType === 'Motion Detected') loadCameras();
      addNotification(`${eventType} logged on ${c.name}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Event log failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const removeCamera = async () => {
    if (!deleteTarget) return;
    setActingOn(deleteTarget.id);
    try {
      await deleteSecCamera(deleteTarget.id);
      setCameras(prev => prev.filter(c => c.id !== deleteTarget.id));
      if (detail?.camera.id === deleteTarget.id) setDetail(null);
      addNotification(`Camera ${deleteTarget.id} removed`, 'task', 'Security');
      setDeleteTarget(null);
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
        title="CCTV Management"
        subtitle="Monitor and manage security cameras and recording"
        icon={Video}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={openNew} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Camera
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Cameras" value={stats.total} icon={Camera} tone="accent" />
        <StatCard title="Online" value={stats.online} icon={CheckCircle2} tone="success" />
        <StatCard title="Offline" value={stats.offline} icon={AlertTriangle} tone="danger" />
        <StatCard title="Recording" value={stats.recording} icon={CircleDot} tone="info" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={loadCameras} className={button.ghost + ' ml-auto'}>Retry</button>
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
              placeholder="Search name, ID, IP, model…"
              className={inputClass + ' pl-9'}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-400" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className={filterSelect}>
              <option value="all">All Status</option>
              {CAMERA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-slate-400" />
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} className={filterSelect}>
              <option value="all">All Locations</option>
              {locationsInUse.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </SectionCard>

      {/* Camera registry */}
      <SectionCard title="Camera Registry" subtitle="Camera · Location · Status · Health · Recording" icon={Camera} tone="accent" pad="none">
        {loading ? <LoadingRow /> : (
          <DataTable
            headers={['Camera', 'Location', 'Status', 'Health', 'Recording', 'Last Motion', '']}
            rows={filtered.map(c => [
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 shrink-0">
                  <Camera className="w-4 h-4 text-[var(--color-accent-operations)]" />
                </div>
                <div className="min-w-0">
                  <button onClick={() => openDetail(c)} className="font-medium text-slate-900 dark:text-white hover:text-[var(--color-accent-operations)]">{c.name}</button>
                  <div className="text-[10px] text-slate-400 font-mono">{c.id}{c.ip_address ? ` · ${c.ip_address}` : ''}</div>
                </div>
              </div>,
              <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{c.location}</span>,
              <select
                value={c.status}
                onChange={e => patchCamera(c, { status: e.target.value as SecCameraStatus }, `${c.name} → ${e.target.value}`)}
                disabled={actingOn === c.id}
                className={inlineStatusSelect}
              >
                {CAMERA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
              <Badge tone={HEALTH_TONE[c.health]}>{c.health}</Badge>,
              <button
                onClick={() => patchCamera(c, { recording: !c.recording }, `${c.name} recording ${c.recording ? 'stopped' : 'started'}`)}
                disabled={actingOn === c.id}
                className="flex items-center gap-1.5 text-xs font-semibold"
                title={c.recording ? 'Stop recording' : 'Start recording'}
              >
                <span className={`w-2 h-2 rounded-full ${c.recording ? 'bg-red-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
                {c.recording ? 'REC' : 'Off'}
              </button>,
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} />{fmtDateTime(c.last_motion_at)}</span>,
              <div className="inline-flex gap-2">
                <button onClick={() => openDetail(c)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="View"><Eye className="w-4 h-4" /></button>
                <button onClick={() => openEdit(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setDeleteTarget(c)} disabled={actingOn === c.id} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete">
                  {actingOn === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>,
            ])}
            empty={filtered.length === 0}
            emptyColSpan={7}
          />
        )}
      </SectionCard>

      {/* Add / Edit camera modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveCamera}
        title={editing ? `Edit ${editing.name}` : 'Add New Camera'}
        subtitle={editing ? `Camera ${editing.id}` : 'Register a camera in the registry'}
        variant="form"
        loading={submitting}
        confirmLabel={editing ? 'Save Changes' : 'Add Camera'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Camera Name">
              <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Lobby Entrance" />
            </Field>
            <Field label="Location">
              <select className={inputClass} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="IP Address">
              <input className={inputClass} value={form.ipAddress} onChange={e => setForm(f => ({ ...f, ipAddress: e.target.value }))} placeholder="e.g., 192.168.1.101" />
            </Field>
            <Field label="Model">
              <input className={inputClass} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="e.g., AXIS M3065" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Resolution">
              <select className={inputClass} value={form.resolution} onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))}>
                {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Retention (days)">
              <input type="number" min={1} className={inputClass} value={form.retentionDays} onChange={e => setForm(f => ({ ...f, retentionDays: parseInt(e.target.value) || 30 }))} />
            </Field>
            <Field label="Health">
              <select className={inputClass} value={form.health} onChange={e => setForm(f => ({ ...f, health: e.target.value as SecCameraHealth }))}>
                {HEALTHS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* Camera detail modal */}
      <ModalSystem
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={detail ? `Camera ${detail.camera.id}` : 'Camera Detail'}
        subtitle={detail ? `${detail.camera.name} · ${detail.camera.location}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailLoading || !detail ? <LoadingRow /> : (
          <div className="space-y-5">
            {/* Feed indicator */}
            <div className="rounded-xl bg-slate-900 aspect-video flex items-center justify-center relative overflow-hidden">
              <div className="text-center">
                <Monitor className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm font-medium">{detail.camera.name}</p>
                <p className="text-slate-500 text-xs">{detail.camera.ip_address || 'No IP configured'} · {detail.camera.resolution}</p>
              </div>
              {detail.camera.recording && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded bg-red-600/90 text-white text-[10px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> REC
                </div>
              )}
              <div className="absolute top-3 left-3 px-2 py-1 rounded bg-slate-800/90 text-[10px] font-bold">
                <Badge tone={STATUS_TONE[detail.camera.status]}>{detail.camera.status}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <Badge tone={STATUS_TONE[detail.camera.status]}>{detail.camera.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Health</p>
                <Badge tone={HEALTH_TONE[detail.camera.health]}>{detail.camera.health}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Model</p>
                <p className="font-medium text-slate-900 dark:text-white">{detail.camera.model || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Retention</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><HardDrive size={11} />{detail.camera.retention_days} days</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Motion</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><Clock size={11} />{fmtDateTime(detail.camera.last_motion_at)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Recording</p>
                <p className={`font-medium ${detail.camera.recording ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {detail.camera.recording ? 'Active' : 'Inactive'}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => patchCamera(detail.camera, { recording: !detail.camera.recording })}
                disabled={actingOn === detail.camera.id}
                className={button.primary + ' disabled:opacity-50'}
              >
                <CircleDot className="w-4 h-4" /> {detail.camera.recording ? 'Stop Recording' : 'Start Recording'}
              </button>
              <button onClick={() => logEvent(detail.camera, 'Motion Detected', `Manual motion event — ${detail.camera.location}`)} disabled={actingOn === detail.camera.id} className={button.secondary}>
                <Radio className="w-4 h-4" /> Log Motion
              </button>
              <button onClick={() => logEvent(detail.camera, 'Snapshot')} disabled={actingOn === detail.camera.id} className={button.secondary}>
                <Camera className="w-4 h-4" /> Snapshot
              </button>
              <button onClick={() => logEvent(detail.camera, 'Playback Requested')} disabled={actingOn === detail.camera.id} className={button.secondary}>
                <Video className="w-4 h-4" /> Request Playback
              </button>
              <button onClick={() => { setDetail(null); openEdit(detail.camera); }} className={button.secondary}>
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => setDeleteTarget(detail.camera)} className={button.secondary + ' text-[var(--color-danger)]'}>
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>

            {/* Event log */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[var(--color-accent-operations)]" /> Event Log
              </h4>
              <div className="space-y-0 max-h-48 overflow-y-auto">
                {detail.events.map((ev, idx) => (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 ${EVENT_DOT[ev.event_type] || 'bg-slate-400'}`} />
                      {idx < detail.events.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="pb-3 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{ev.event_type}</p>
                      {ev.detail && <p className="text-xs text-slate-500">{ev.detail}</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock size={10} />{fmtDateTime(ev.created_at)}{ev.actor ? ` · ${ev.actor}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {detail.events.length === 0 && <p className="text-xs text-slate-400">No events logged.</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Delete confirm */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeCamera}
        title="Remove Camera"
        subtitle={deleteTarget ? `Permanently remove camera ${deleteTarget.id} (${deleteTarget.name}) and its event log?` : ''}
        variant="confirm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Remove"
        confirmColor="rose"
      />
    </div>
  );
};

export default CCTVManagement;
