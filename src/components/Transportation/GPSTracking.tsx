/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GPS Tracking — real-time vehicle location and telemetry.
 * DB-integrated via /api/transport/gps/* (transport_vehicle_telemetry).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MapPin,
  Navigation,
  Car,
  Search,
  Clock,
  Gauge,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Activity,
  Pencil,
  Radio,
  Crosshair,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Telemetry {
  id: string;
  vehicle_id: string;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number;
  heading: number;
  status: string;
  location_label: string | null;
  last_update: string;
  destination: string | null;
  eta_minutes: number | null;
  trip_id: string | null;
  route_deviation: boolean;
  transport_vehicles: {
    vehicle_number: string;
    make: string | null;
    model: string | null;
    status: string;
    current_location: string | null;
    transport_drivers: { employees: { name: string; phone: string | null } | null } | null;
  } | null;
  transport_requests: {
    request_number: string;
    pickup_location: string | null;
    destination: string | null;
    status: string;
    scheduled_time: string | null;
  } | null;
}

interface Geofence {
  id: string;
  name: string;
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  active: boolean;
}

interface GeofenceEvent {
  id: string;
  geofence_id: string | null;
  vehicle_id: string | null;
  event_type: string;
  latitude: number | null;
  longitude: number | null;
  occurred_at: string;
  alerted: boolean;
  transport_vehicles: { vehicle_number: string } | null;
}

const TELEMETRY_STATUSES = ['In Transit', 'Parked', 'Waiting', 'Offline'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';
const filterSelectCls = 'px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans w-auto';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'In Transit': return 'info';
    case 'Parked': return 'success';
    case 'Waiting': return 'warning';
    case 'Offline': return 'danger';
    default: return 'neutral';
  }
}

function relativeTime(ts?: string | null): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 45000) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)} day${hrs >= 48 ? 's' : ''} ago`;
}

const emptyForm = {
  locationLabel: '', latitude: '', longitude: '', speedKmh: 0, heading: 0,
  status: 'Parked', destination: '', etaMinutes: '', routeDeviation: false,
};

const emptyGeofenceForm = {
  name: '', centerLatitude: '', centerLongitude: '', radiusKm: '1',
  alertOnEnter: true, alertOnExit: false, active: true,
};

const GPSTracking = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [positions, setPositions] = useState<Telemetry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showTrip, setShowTrip] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editing, setEditing] = useState<Telemetry | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [geofenceEvents, setGeofenceEvents] = useState<GeofenceEvent[]>([]);
  const [showGeofence, setShowGeofence] = useState(false);
  const [editingGeofence, setEditingGeofence] = useState<Geofence | null>(null);
  const [geofenceForm, setGeofenceForm] = useState({ ...emptyGeofenceForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [res, gRes, eRes] = await Promise.all([
        fetch(`/api/transport/gps/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/gps/geofences/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/gps/geofence-events/${currentPropertyId}?limit=50`, { headers: authHeaders() }),
      ]);
      if (res.ok) setPositions(((await res.json()) as { positions: Telemetry[] }).positions || []);
      if (gRes.ok) setGeofences(((await gRes.json()) as { geofences: Geofence[] }).geofences || []);
      if (eRes.ok) setGeofenceEvents(((await eRes.json()) as { events: GeofenceEvent[] }).events || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!currentPropertyId) return;
    const t = setInterval(fetchAll, 30000);
    return () => clearInterval(t);
  }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = positions;
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        (p.transport_vehicles?.vehicle_number || '').toLowerCase().includes(q) ||
        (p.transport_vehicles?.transport_drivers?.employees?.name || '').toLowerCase().includes(q) ||
        (p.location_label || '').toLowerCase().includes(q) ||
        (p.transport_requests?.request_number || '').toLowerCase().includes(q));
    }
    return list;
  }, [positions, statusFilter, search]);

  const selected = useMemo(() => positions.find((p) => p.id === selectedId) || null, [positions, selectedId]);

  const stats = useMemo(() => {
    const moving = positions.filter((p) => p.speed_kmh > 0);
    return {
      tracked: positions.filter((p) => p.status !== 'Offline').length,
      inTransit: positions.filter((p) => p.status === 'In Transit').length,
      offline: positions.filter((p) => p.status === 'Offline').length,
      avgSpeed: moving.length ? Math.round(moving.reduce((s, p) => s + p.speed_kmh, 0) / moving.length) : 0,
      deviations: positions.filter((p) => p.route_deviation).length,
    };
  }, [positions]);

  // Normalize coordinates into the map panel
  const bounds = useMemo(() => {
    const pts = positions.filter((p) => p.latitude != null && p.longitude != null);
    if (pts.length === 0) return null;
    const lats = pts.map((p) => Number(p.latitude));
    const lngs = pts.map((p) => Number(p.longitude));
    const pad = 0.002;
    return {
      minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad,
    };
  }, [positions]);

  const pinPos = (p: Telemetry) => {
    if (!bounds || p.latitude == null || p.longitude == null) return null;
    const x = ((Number(p.longitude) - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
    const y = (1 - (Number(p.latitude) - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
    return { x: Math.min(95, Math.max(5, x)), y: Math.min(90, Math.max(8, y)) };
  };

  const openEdit = (p: Telemetry) => {
    setEditing(p);
    setForm({
      locationLabel: p.location_label || '',
      latitude: p.latitude != null ? String(p.latitude) : '',
      longitude: p.longitude != null ? String(p.longitude) : '',
      speedKmh: p.speed_kmh,
      heading: p.heading,
      status: p.status,
      destination: p.destination || '',
      etaMinutes: p.eta_minutes != null ? String(p.eta_minutes) : '',
      routeDeviation: p.route_deviation,
    });
    setShowEdit(true);
  };

  const handleSaveTelemetry = async () => {
    if (!editing || !currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/gps/vehicle/${editing.vehicle_id}`, {
        method: 'PUT', headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          locationLabel: form.locationLabel || null,
          latitude: form.latitude === '' ? null : Number(form.latitude),
          longitude: form.longitude === '' ? null : Number(form.longitude),
          speedKmh: Number(form.speedKmh) || 0,
          heading: Number(form.heading) || 0,
          status: form.status,
          destination: form.destination || null,
          etaMinutes: form.etaMinutes === '' ? null : Number(form.etaMinutes),
          routeDeviation: form.routeDeviation,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Telemetry updated', 'success', 'Transportation');
      setShowEdit(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleQuickStatus = async (p: Telemetry, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/gps/vehicle/${p.vehicle_id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`${p.transport_vehicles?.vehicle_number || 'Vehicle'} marked ${status}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const openCreateGeofence = () => {
    setEditingGeofence(null);
    // Pre-fill the centre from the selected vehicle's position when available.
    setGeofenceForm({
      ...emptyGeofenceForm,
      centerLatitude: selected?.latitude != null ? String(selected.latitude) : '',
      centerLongitude: selected?.longitude != null ? String(selected.longitude) : '',
    });
    setShowGeofence(true);
  };

  const openEditGeofence = (g: Geofence) => {
    setEditingGeofence(g);
    setGeofenceForm({
      name: g.name,
      centerLatitude: String(g.center_latitude),
      centerLongitude: String(g.center_longitude),
      radiusKm: String(g.radius_km),
      alertOnEnter: g.alert_on_enter,
      alertOnExit: g.alert_on_exit,
      active: g.active,
    });
    setShowGeofence(true);
  };

  const handleSaveGeofence = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        name: geofenceForm.name,
        centerLatitude: Number(geofenceForm.centerLatitude),
        centerLongitude: Number(geofenceForm.centerLongitude),
        radiusKm: Number(geofenceForm.radiusKm) || 1,
        alertOnEnter: geofenceForm.alertOnEnter,
        alertOnExit: geofenceForm.alertOnExit,
        active: geofenceForm.active,
      };
      const endpoint = editingGeofence ? `/api/transport/gps/geofences/${editingGeofence.id}` : '/api/transport/gps/geofences';
      const res = await fetch(endpoint, { method: editingGeofence ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingGeofence ? 'Geofence updated' : 'Geofence created', 'success', 'Transportation');
      setShowGeofence(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeleteGeofence = async (id: string) => {
    if (!confirm('Delete this geofence?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/gps/geofences/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Geofence deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const geofenceName = (id: string | null) => geofences.find((g) => g.id === id)?.name || '—';

  const openTripReplay = async () => {
    if (!selected) {
      addNotification('Select a tracked vehicle first', 'info', 'Transportation');
      return;
    }
    if (!selected.transport_requests) {
      addNotification('No linked trip for this vehicle', 'info', 'Transportation');
      return;
    }
    setShowTrip(true);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const qs = selected.trip_id ? `?tripId=${encodeURIComponent(selected.trip_id)}` : '';
      const res = await fetch(`/api/transport/gps/vehicle/${selected.vehicle_id}/history${qs}`, { headers: authHeaders() });
      if (res.ok) setHistory(((await res.json()) as { history: any[] }).history || []);
    } catch { /* non-fatal */ } finally { setHistoryLoading(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="GPS Tracking" subtitle="Real-time vehicle location and tracking" icon={MapPin} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><MapPin className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view tracking.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="GPS Tracking"
        subtitle="Real-time vehicle location and tracking"
        icon={MapPin}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openTripReplay} className={button.secondary}><Activity className="w-4 h-4" /> Trip Replay</button>
            <button onClick={openCreateGeofence} className={button.secondary}><Crosshair className="w-4 h-4" /> New Geofence</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Tracked Vehicles" value={String(stats.tracked)} icon={Car} tone="accent" />
        <StatCard title="In Transit" value={String(stats.inTransit)} icon={Navigation} tone="info" />
        <StatCard title="Offline" value={String(stats.offline)} icon={AlertTriangle} tone="danger" />
        <StatCard title="Avg Speed" value={`${stats.avgSpeed} km/h`} icon={Gauge} tone="success" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            placeholder="Search by vehicle, driver, location, or trip..."
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={filterSelectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          {TELEMETRY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Deviation alert */}
      {stats.deviations > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {stats.deviations} vehicle{stats.deviations > 1 ? 's' : ''} off planned route
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Map */}
        <SectionCard className="lg:col-span-2" pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Live Map</h3>
            <Badge tone="info">{positions.filter((p) => p.latitude != null).length} positioned</Badge>
          </div>
          <div className="relative bg-slate-100 dark:bg-slate-800/60 h-96 overflow-hidden rounded-b-2xl">
            {/* grid backdrop */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage: 'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
                backgroundSize: '40px 40px',
                color: '#94a3b8',
              }}
            />
            {loading && positions.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading positions…</div>
            ) : positions.filter((p) => p.latitude != null).length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                <Crosshair className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">No positioned vehicles</p>
              </div>
            ) : (
              positions.filter((p) => p.latitude != null).map((p) => {
                const pos = pinPos(p);
                if (!pos) return null;
                const num = p.transport_vehicles?.vehicle_number || '?';
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    title={`${num} — ${p.location_label || ''}`}
                  >
                    <span className={`flex items-center justify-center w-8 h-8 rounded-full border-2 shadow transition ${
                      selectedId === p.id ? 'ring-2 ring-indigo-400 scale-110' : ''
                    } ${
                      p.status === 'In Transit' ? 'bg-blue-500 border-blue-200' :
                      p.status === 'Waiting' ? 'bg-amber-500 border-amber-200' :
                      p.status === 'Parked' ? 'bg-emerald-500 border-emerald-200' :
                      'bg-rose-500 border-rose-200'
                    }`}>
                      <Navigation className="w-4 h-4 text-white" style={{ transform: `rotate(${p.heading}deg)` }} />
                    </span>
                    <span className="absolute left-1/2 -translate-x-1/2 top-9 whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 shadow opacity-0 group-hover:opacity-100 transition">
                      {num} · {p.speed_kmh} km/h
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>

        {/* Vehicle Status List */}
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Vehicle Status</h3></div>
          <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
            {loading && filtered.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No tracked vehicles.</p></div>
            ) : filtered.map((p) => {
              const num = p.transport_vehicles?.vehicle_number || '—';
              const driver = p.transport_vehicles?.transport_drivers?.employees?.name || 'No driver';
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition ${
                    selectedId === p.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{num}</span>
                        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{driver}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {p.route_deviation && <span title="Route deviation"><AlertTriangle className="w-5 h-5 text-amber-600" /></span>}
                      <button onClick={(e) => { e.stopPropagation(); openEdit(p); }} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"><Pencil size={13} className="text-slate-400" /></button>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <MapPin className="w-4 h-4 shrink-0" />
                      <span className="truncate">{p.location_label || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <Gauge className="w-4 h-4" />
                        <span>{p.speed_kmh} km/h</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <Clock className="w-4 h-4" />
                        <span>{relativeTime(p.last_update)}</span>
                      </div>
                    </div>
                    {p.destination && (
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <Navigation className="w-4 h-4 shrink-0" />
                        <span className="truncate">To: {p.destination}</span>
                        {p.eta_minutes != null && <span className="text-xs text-slate-500">ETA: {p.eta_minutes} min</span>}
                      </div>
                    )}
                    {p.transport_requests && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Radio className="w-3.5 h-3.5" />
                        <span>Trip {p.transport_requests.request_number}</span>
                      </div>
                    )}
                  </div>
                  {/* quick status actions */}
                  <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                    {p.status !== 'In Transit' && p.status !== 'Offline' && (
                      <button onClick={() => handleQuickStatus(p, 'In Transit')} disabled={saving} className="px-2 py-1 text-[10px] font-bold rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 transition">Depart</button>
                    )}
                    {p.status === 'In Transit' && (
                      <button onClick={() => handleQuickStatus(p, 'Parked')} disabled={saving} className="px-2 py-1 text-[10px] font-bold rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition">Arrived</button>
                    )}
                    {p.status !== 'Offline' && (
                      <button onClick={() => handleQuickStatus(p, 'Offline')} disabled={saving} className="px-2 py-1 text-[10px] font-bold rounded-md bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 transition">Mark Offline</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Selected vehicle detail strip */}
      {selected && (
        <SectionCard>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Selected</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{selected.transport_vehicles?.vehicle_number}</p>
              <p className="text-xs text-slate-500">{selected.transport_vehicles?.make} {selected.transport_vehicles?.model}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Driver</p>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{selected.transport_vehicles?.transport_drivers?.employees?.name || 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Coordinates</p>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {selected.latitude != null ? `${Number(selected.latitude).toFixed(4)}, ${Number(selected.longitude).toFixed(4)}` : 'No signal'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Heading</p>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{selected.heading}°</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Last Update</p>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{relativeTime(selected.last_update)}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Geofences + recent enter/exit events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Geofences</h3>
            <Badge tone="info">{geofences.filter((g) => g.active).length} active</Badge>
          </div>
          <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
            {geofences.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><Crosshair className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No geofences defined.</p></div>
            ) : geofences.map((g) => (
              <div key={g.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 group">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{g.name}</span>
                      <Badge tone={g.active ? 'success' : 'neutral'}>{g.active ? 'Active' : 'Disabled'}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {Number(g.center_latitude).toFixed(4)}, {Number(g.center_longitude).toFixed(4)} · r {g.radius_km} km
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Alerts: {g.alert_on_enter ? 'enter' : ''}{g.alert_on_enter && g.alert_on_exit ? ' + ' : ''}{g.alert_on_exit ? 'exit' : ''}{!g.alert_on_enter && !g.alert_on_exit ? 'off' : ''}
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => openEditGeofence(g)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"><Pencil size={12} className="text-slate-400" /></button>
                    <button onClick={() => handleDeleteGeofence(g.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={12} className="text-rose-400" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Geofence Events</h3></div>
          <div className="p-4 space-y-2 max-h-[300px] overflow-y-auto">
            {geofenceEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><Activity className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No enter/exit events recorded.</p></div>
            ) : geofenceEvents.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <span className={`w-2 h-2 rounded-full shrink-0 ${ev.event_type === 'enter' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-slate-900 dark:text-white">
                    {ev.transport_vehicles?.vehicle_number || 'Vehicle'} {ev.event_type === 'enter' ? 'entered' : 'exited'} {geofenceName(ev.geofence_id)}
                  </p>
                  <p className="text-xs text-slate-500">{new Date(ev.occurred_at).toLocaleString()}{ev.alerted ? ' · alerted' : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Geofence Modal */}
      <ModalSystem
        isOpen={showGeofence}
        onClose={() => setShowGeofence(false)}
        onConfirm={handleSaveGeofence}
        title={editingGeofence ? `Edit Geofence — ${editingGeofence.name}` : 'New Geofence'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input className={inputCls} value={geofenceForm.name} onChange={(e) => setGeofenceForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Airport Zone" /></Field>
          <Field label="Radius (km)"><input type="number" min={0.1} step={0.1} className={inputCls} value={geofenceForm.radiusKm} onChange={(e) => setGeofenceForm(f => ({ ...f, radiusKm: e.target.value }))} /></Field>
          <Field label="Center Latitude"><input type="number" step="0.000001" className={inputCls} value={geofenceForm.centerLatitude} onChange={(e) => setGeofenceForm(f => ({ ...f, centerLatitude: e.target.value }))} /></Field>
          <Field label="Center Longitude"><input type="number" step="0.000001" className={inputCls} value={geofenceForm.centerLongitude} onChange={(e) => setGeofenceForm(f => ({ ...f, centerLongitude: e.target.value }))} /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={geofenceForm.alertOnEnter} onChange={(e) => setGeofenceForm(f => ({ ...f, alertOnEnter: e.target.checked }))} className="rounded" />
            Alert on enter
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={geofenceForm.alertOnExit} onChange={(e) => setGeofenceForm(f => ({ ...f, alertOnExit: e.target.checked }))} className="rounded" />
            Alert on exit
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={geofenceForm.active} onChange={(e) => setGeofenceForm(f => ({ ...f, active: e.target.checked }))} className="rounded" />
            Geofence active
          </label>
        </div>
      </ModalSystem>

      {/* Telemetry Edit Modal */}
      <ModalSystem
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        onConfirm={handleSaveTelemetry}
        title={`Update Telemetry — ${editing?.transport_vehicles?.vehicle_number || ''}`}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location Label"><input className={inputCls} value={form.locationLabel} onChange={(e) => setForm(f => ({ ...f, locationLabel: e.target.value }))} placeholder="e.g. JFK Airport - Terminal 4" /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {TELEMETRY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Latitude"><input type="number" step="0.000001" className={inputCls} value={form.latitude} onChange={(e) => setForm(f => ({ ...f, latitude: e.target.value }))} /></Field>
          <Field label="Longitude"><input type="number" step="0.000001" className={inputCls} value={form.longitude} onChange={(e) => setForm(f => ({ ...f, longitude: e.target.value }))} /></Field>
          <Field label="Speed (km/h)"><input type="number" min={0} className={inputCls} value={form.speedKmh} onChange={(e) => setForm(f => ({ ...f, speedKmh: Number(e.target.value) }))} /></Field>
          <Field label="Heading (°)"><input type="number" min={0} max={360} className={inputCls} value={form.heading} onChange={(e) => setForm(f => ({ ...f, heading: Number(e.target.value) }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={form.destination} onChange={(e) => setForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="ETA (min)"><input type="number" min={0} className={inputCls} value={form.etaMinutes} onChange={(e) => setForm(f => ({ ...f, etaMinutes: e.target.value }))} /></Field>
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.routeDeviation} onChange={(e) => setForm(f => ({ ...f, routeDeviation: e.target.checked }))} className="rounded" />
            Route deviation detected
          </label>
        </div>
      </ModalSystem>

      {/* Trip Replay Modal — linked trip timeline */}
      <ModalSystem
        isOpen={showTrip}
        onClose={() => setShowTrip(false)}
        title={`Trip Replay — ${selected?.transport_requests?.request_number || ''}`}
        variant="info"
        size="md"
      >
        {selected?.transport_requests && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Vehicle</p>
                <p className="font-medium text-slate-900 dark:text-white">{selected.transport_vehicles?.vehicle_number}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Trip Status</p>
                <Badge tone={statusTone(selected.transport_requests.status)}>{selected.transport_requests.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Pickup</p>
                <p className="font-medium text-slate-900 dark:text-white">{selected.transport_requests.pickup_location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Destination</p>
                <p className="font-medium text-slate-900 dark:text-white">{selected.transport_requests.destination || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Scheduled</p>
                <p className="font-medium text-slate-900 dark:text-white">
                  {selected.transport_requests.scheduled_time ? new Date(selected.transport_requests.scheduled_time).toLocaleString() : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Current Position</p>
                <p className="font-medium text-slate-900 dark:text-white">{selected.location_label || 'Unknown'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <Gauge className="w-4 h-4" />
              <span>{selected.speed_kmh} km/h</span>
              <span className="mx-1">·</span>
              <Clock className="w-4 h-4" />
              <span>Updated {relativeTime(selected.last_update)}</span>
              {selected.eta_minutes != null && (
                <>
                  <span className="mx-1">·</span>
                  <Navigation className="w-4 h-4" />
                  <span>ETA {selected.eta_minutes} min</span>
                </>
              )}
            </div>
            {/* Position history timeline */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Route History</p>
              {historyLoading ? (
                <div className="flex items-center justify-center py-6 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading route…
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No recorded positions for this trip yet.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  {history.map((h, i) => (
                    <div key={h.id || i} className="flex items-center gap-3 text-sm">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${i === history.length - 1 ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-white">
                          {h.location_label || `${Number(h.latitude).toFixed(4)}, ${Number(h.longitude).toFixed(4)}`}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(h.recorded_at).toLocaleTimeString()}
                          {h.speed_kmh != null && ` · ${h.speed_kmh} km/h`}
                          {h.status && ` · ${h.status}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default GPSTracking;
