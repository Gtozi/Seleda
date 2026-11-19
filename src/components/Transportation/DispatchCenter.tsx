/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dispatch Center — live dispatch operations and vehicle assignment.
 * DB-integrated via /api/transport/requests/*, /api/transport/vehicles/* and
 * /api/transport/drivers/*.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MapPin,
  Car,
  Users,
  Clock,
  Navigation,
  Radio,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  Phone,
  MessageSquare,
  Loader2,
  RefreshCw,
  Calendar,
  Luggage,
  UserCheck,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface TransportRequest {
  id: string;
  request_number: string;
  guest_name: string;
  room: string | null;
  type: string;
  source: string;
  pickup_location: string;
  destination: string;
  scheduled_time: string;
  passenger_count: number;
  luggage_count: number;
  status: string;
  priority: string;
  special_instructions: string | null;
  assigned_vehicle: string | null;
  driver_id: string | null;
  transport_drivers: { id: string; employees: { name: string; phone: string | null } | null } | null;
}

interface Vehicle {
  id: string;
  vehicle_number: string;
  make: string | null;
  model: string | null;
  category: string;
  capacity: number;
  status: string;
  current_location: string | null;
  fuel_level: number;
  condition: string;
  driver_id: string | null;
  transport_drivers: { id: string; employees: { name: string; phone: string | null } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  status: string;
  employees: { name: string; phone: string | null } | null;
}

const ACTIVE_TRIP_STATUSES = ['Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress'];
const PENDING_STATUSES = ['Requested', 'Confirmed'];
const NEXT_STATUS: Record<string, string> = {
  'Assigned': 'Driver En Route',
  'Driver En Route': 'Guest Picked Up',
  'Guest Picked Up': 'In Progress',
  'In Progress': 'Completed',
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

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
    case 'Completed': return 'success';
    case 'Cancelled': case 'No Show': return 'danger';
    case 'Requested': return 'warning';
    case 'Confirmed': return 'info';
    default: return 'accent';
  }
}

function priorityTone(priority: string): StatusTone {
  switch (priority) {
    case 'Critical': return 'danger';
    case 'High': return 'warning';
    case 'Normal': return 'info';
    default: return 'neutral';
  }
}

function vehicleStatusTone(status: string): StatusTone {
  switch (status) {
    case 'Active': return 'success';
    case 'In Use': return 'info';
    case 'Maintenance': case 'Service Required': return 'warning';
    case 'Out of Service': case 'Retired': return 'danger';
    default: return 'neutral';
  }
}

function formatTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function etaLabel(ts?: string | null): string {
  if (!ts) return '—';
  const diff = Math.round((new Date(ts).getTime() - Date.now()) / 60000);
  if (diff > 60) return `in ${Math.round(diff / 60)}h ${diff % 60}m`;
  if (diff > 0) return `in ${diff} min`;
  if (diff > -60) return `${-diff} min ago`;
  return 'overdue';
}

function fuelColor(level: number) {
  if (level > 50) return 'bg-emerald-500';
  if (level > 25) return 'bg-amber-500';
  return 'bg-rose-500';
}

const DispatchCenter = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [requests, setRequests] = useState<TransportRequest[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TransportRequest | null>(null);
  const [assigning, setAssigning] = useState<TransportRequest | null>(null);
  const [assignForm, setAssignForm] = useState({ driverId: '', vehicleId: '' });
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergencyForm, setEmergencyForm] = useState({ guestName: '', pickupLocation: '', destination: '', passengerCount: 1 });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [rRes, vRes, dRes] = await Promise.all([
        fetch(`/api/transport/requests/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (rRes.ok) setRequests(((await rRes.json()) as { requests: TransportRequest[] }).requests || []);
      if (vRes.ok) setVehicles(((await vRes.json()) as { vehicles: Vehicle[] }).vehicles || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const activeTrips = useMemo(
    () => requests.filter((r) => ACTIVE_TRIP_STATUSES.includes(r.status)),
    [requests]
  );
  const pendingRequests = useMemo(
    () => requests.filter((r) => PENDING_STATUSES.includes(r.status) && !r.driver_id),
    [requests]
  );
  const activeDrivers = useMemo(() => drivers.filter((d) => d.status === 'Active'), [drivers]);
  const availableVehicles = useMemo(() => vehicles.filter((v) => v.status === 'Active'), [vehicles]);

  const stats = useMemo(() => ({
    activeTrips: activeTrips.length,
    available: availableVehicles.length,
    pending: pendingRequests.length,
    onDuty: activeDrivers.length,
  }), [activeTrips, availableVehicles, pendingRequests, activeDrivers]);

  const patchRequest = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/transport/requests/${id}`, {
      method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
  };

  const patchVehicle = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/transport/vehicles/${id}`, {
      method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
  };

  const openAssign = (r: TransportRequest) => {
    setAssigning(r);
    setAssignForm({ driverId: '', vehicleId: selectedVehicleId || '' });
  };

  const handleAssignDriverChange = (driverId: string) => {
    const driver = drivers.find((d) => d.id === driverId);
    const linkedVehicle = vehicles.find((v) => v.vehicle_number === driver?.assigned_vehicle && v.status === 'Active');
    setAssignForm((f) => ({ ...f, driverId, vehicleId: f.vehicleId || linkedVehicle?.id || '' }));
  };

  const handleAssignVehicleChange = (vehicleId: string) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    setAssignForm((f) => ({ ...f, vehicleId, driverId: f.driverId || vehicle?.driver_id || '' }));
  };

  const assignRequest = async (r: TransportRequest, driverId: string, vehicleId: string) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    await patchRequest(r.id, {
      driverId: driverId || null,
      assignedVehicle: vehicle?.vehicle_number || null,
      status: 'Assigned',
    });
    if (vehicleId) await patchVehicle(vehicleId, { status: 'In Use' });
  };

  const handleAssign = async () => {
    if (!assigning) return;
    setSaving(true);
    try {
      await assignRequest(assigning, assignForm.driverId, assignForm.vehicleId);
      addNotification(`Request ${assigning.request_number} assigned`, 'success', 'Transportation');
      setAssigning(null); setSelectedVehicleId(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDecline = async (r: TransportRequest) => {
    if (!confirm(`Decline request ${r.request_number}?`)) return;
    setSaving(true);
    try {
      await patchRequest(r.id, { status: 'Cancelled' });
      addNotification(`Request ${r.request_number} declined`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleAdvance = async (r: TransportRequest) => {
    const next = NEXT_STATUS[r.status];
    if (!next) return;
    setSaving(true);
    try {
      await patchRequest(r.id, { status: next });
      if (next === 'Completed' && r.assigned_vehicle) {
        const vehicle = vehicles.find((v) => v.vehicle_number === r.assigned_vehicle);
        if (vehicle) await patchVehicle(vehicle.id, { status: 'Active', current_location: 'Hotel Garage' });
      }
      addNotification(`${r.request_number} → ${next}`, 'success', 'Transportation');
      setTracking(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleAutoAssign = async () => {
    if (pendingRequests.length === 0) {
      addNotification('No pending requests to assign', 'info', 'Transportation');
      return;
    }
    setSaving(true);
    try {
      const freeVehicles = [...availableVehicles];
      const busyDriverIds = new Set(activeTrips.map((t) => t.driver_id).filter(Boolean));
      let assigned = 0;
      for (const r of pendingRequests) {
        const vIdx = freeVehicles.findIndex((v) => v.capacity >= r.passenger_count);
        const vehicle = vIdx >= 0 ? freeVehicles.splice(vIdx, 1)[0] : null;
        const driver = activeDrivers.find((d) => !busyDriverIds.has(d.id) && (!vehicle?.driver_id || d.id === vehicle.driver_id))
          || activeDrivers.find((d) => !busyDriverIds.has(d.id));
        if (!vehicle && !driver) break;
        if (driver) busyDriverIds.add(driver.id);
        await assignRequest(r, driver?.id || '', vehicle?.id || '');
        assigned += 1;
      }
      addNotification(assigned ? `Auto-assigned ${assigned} request(s)` : 'No available vehicles or drivers', assigned ? 'success' : 'warning', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Auto-assign failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleEmergency = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/transport/requests/', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          guestName: emergencyForm.guestName || 'Emergency Dispatch',
          type: 'City Transfer',
          source: 'Front Office',
          pickupLocation: emergencyForm.pickupLocation,
          destination: emergencyForm.destination,
          scheduledTime: new Date().toISOString(),
          passengerCount: emergencyForm.passengerCount,
          priority: 'Critical',
          status: 'Requested',
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      const created = (await res.json()) as TransportRequest;
      const vehicle = availableVehicles.find((v) => v.capacity >= emergencyForm.passengerCount) || availableVehicles[0];
      const driver = activeDrivers.find((d) => !activeTrips.some((t) => t.driver_id === d.id));
      if (vehicle || driver) {
        await assignRequest(created, driver?.id || '', vehicle?.id || '');
      }
      addNotification('Emergency dispatch created', 'success', 'Transportation');
      setShowEmergency(false);
      setEmergencyForm({ guestName: '', pickupLocation: '', destination: '', passengerCount: 1 });
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const driverPhone = (r: TransportRequest) => r.transport_drivers?.employees?.phone || null;

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Dispatch Center" subtitle="Live dispatch operations and vehicle assignment" icon={Radio} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Radio className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view dispatch.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Dispatch Center"
        subtitle="Live dispatch operations and vehicle assignment"
        icon={Radio}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={handleAutoAssign} disabled={saving} className={button.secondary}><Zap className="w-4 h-4" /> Auto-Assign</button>
            <button onClick={() => setShowEmergency(true)} className={button.primary}><Radio className="w-4 h-4" /> Emergency Dispatch</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Trips" value={String(stats.activeTrips)} icon={Car} tone="accent" />
        <StatCard title="Available Vehicles" value={String(stats.available)} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending Assignments" value={String(stats.pending)} icon={Clock} tone="warning" />
        <StatCard title="Drivers on Duty" value={String(stats.onDuty)} icon={Users} tone="info" />
      </div>

      {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Trips */}
            <SectionCard title="Active Trips" subtitle="Trips currently assigned or in progress" icon={Navigation} tone="accent">
              <div className="space-y-4 p-6">
                {activeTrips.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No active trips.</p> : activeTrips.map((trip) => (
                  <div key={trip.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-white">{trip.request_number}</span>
                          <Badge tone={priorityTone(trip.priority)} variant={trip.priority === 'Critical' ? 'solid' : 'soft'}>{trip.priority}</Badge>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">{trip.guest_name}{trip.room ? ` — Room ${trip.room}` : ''}</p>
                      </div>
                      <Badge tone={statusTone(trip.status)}>{trip.status}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2 text-slate-500">
                        <Car size={14} />
                        {trip.assigned_vehicle || 'No vehicle'} — {trip.transport_drivers?.employees?.name || 'No driver'}
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <Clock size={14} />
                        {formatTime(trip.scheduled_time)} ({etaLabel(trip.scheduled_time)})
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 col-span-2">
                        <MapPin size={14} />
                        {trip.pickup_location} → {trip.destination}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setTracking(trip)} className={button.secondary}><Navigation className="w-3 h-3" /> Track</button>
                      {driverPhone(trip) && (
                        <a href={`tel:${driverPhone(trip)}`} className={button.secondary}><Phone className="w-3 h-3" /> Call Driver</a>
                      )}
                      {driverPhone(trip) && (
                        <a href={`sms:${driverPhone(trip)}`} className={button.ghost}><MessageSquare className="w-3 h-3" /> Message</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Fleet */}
            <SectionCard title="Fleet" subtitle="Vehicle availability and fuel level" icon={Car} tone="accent">
              <div className="space-y-3 p-6">
                {vehicles.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No vehicles.</p> : vehicles.map((vehicle) => {
                  const selectable = vehicle.status === 'Active';
                  return (
                    <div
                      key={vehicle.id}
                      className={`p-4 rounded-xl border transition ${selectedVehicleId === vehicle.id
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                        : selectable
                          ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 cursor-pointer'
                          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 opacity-60'
                      }`}
                      onClick={() => selectable && setSelectedVehicleId(selectedVehicleId === vehicle.id ? null : vehicle.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                            <Car className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">{vehicle.vehicle_number}</p>
                            <p className="text-xs text-slate-500">{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.category} • {vehicle.capacity} seats</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{vehicle.transport_drivers?.employees?.name || 'Unassigned'}</p>
                          <p className="text-xs text-slate-500">{vehicle.current_location || '—'}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="bg-slate-200 dark:bg-slate-700 rounded-full h-2 w-24 overflow-hidden">
                            <div className={`h-2 rounded-full ${fuelColor(vehicle.fuel_level)}`} style={{ width: `${vehicle.fuel_level}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{vehicle.fuel_level}%</span>
                        </div>
                        <Badge tone={vehicleStatusTone(vehicle.status)}>{vehicle.status}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          {/* Pending Assignments */}
          <SectionCard title="Pending Assignments" subtitle="Requests awaiting vehicle and driver assignment" icon={AlertTriangle} tone="warning">
            <div className="space-y-4 p-6">
              {pendingRequests.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No pending assignments.</p> : pendingRequests.map((r) => (
                <div key={r.id} className="p-4 bg-amber-50/60 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-800/40">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{r.request_number}</span>
                        <Badge tone={priorityTone(r.priority)} variant={r.priority === 'Critical' ? 'solid' : 'soft'}>{r.priority}</Badge>
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{r.guest_name}{r.room ? ` — Room ${r.room}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{r.type}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 justify-end"><Calendar size={11} />{formatTime(r.scheduled_time)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div className="flex items-center gap-2 text-slate-500"><MapPin size={14} />{r.pickup_location}</div>
                    <div className="flex items-center gap-2 text-slate-500"><Navigation size={14} />{r.destination}</div>
                    <div className="flex items-center gap-2 text-slate-500"><Users size={14} />{r.passenger_count} passengers</div>
                    <div className="flex items-center gap-2 text-slate-500"><Luggage size={14} />{r.luggage_count} bags</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openAssign(r)} className={button.primary}><Car className="w-3 h-3" /> Assign Vehicle</button>
                    <button onClick={() => handleDecline(r)} disabled={saving} className={button.secondary}><XCircle className="w-3 h-3" /> Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}

      {/* Assign Modal */}
      <ModalSystem
        isOpen={!!assigning}
        onClose={() => setAssigning(null)}
        onConfirm={handleAssign}
        title={assigning ? `Assign ${assigning.request_number}` : 'Assign Request'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Assigning…' : 'Assign'}
        confirmColor="indigo"
        loading={saving}
      >
        {assigning && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-sm text-slate-600 dark:text-slate-300">
              {assigning.guest_name} • {assigning.pickup_location} → {assigning.destination} • {assigning.passenger_count} pax
            </div>
            <Field label="Driver">
              <select className={inputCls} value={assignForm.driverId} onChange={(e) => handleAssignDriverChange(e.target.value)}>
                <option value="">Select driver…</option>
                {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}{d.assigned_vehicle ? ` (${d.assigned_vehicle})` : ''}</option>)}
              </select>
            </Field>
            <Field label="Vehicle">
              <select className={inputCls} value={assignForm.vehicleId} onChange={(e) => handleAssignVehicleChange(e.target.value)}>
                <option value="">Select vehicle…</option>
                {availableVehicles.map((v) => (
                  <option key={v.id} value={v.id} disabled={v.capacity < assigning.passenger_count}>
                    {v.vehicle_number} — {[v.make, v.model].filter(Boolean).join(' ') || v.category} ({v.capacity} seats){v.capacity < assigning.passenger_count ? ' — too small' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </ModalSystem>

      {/* Emergency Dispatch Modal */}
      <ModalSystem
        isOpen={showEmergency}
        onClose={() => setShowEmergency(false)}
        onConfirm={handleEmergency}
        title="Emergency Dispatch"
        subtitle="Creates a critical-priority request and assigns the nearest available driver"
        variant="form"
        size="md"
        confirmLabel={saving ? 'Dispatching…' : 'Dispatch Now'}
        confirmColor="rose"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest / Requester"><input className={inputCls} value={emergencyForm.guestName} onChange={(e) => setEmergencyForm(f => ({ ...f, guestName: e.target.value }))} placeholder="Emergency Dispatch" /></Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={emergencyForm.passengerCount} onChange={(e) => setEmergencyForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Pickup Location"><input className={inputCls} value={emergencyForm.pickupLocation} onChange={(e) => setEmergencyForm(f => ({ ...f, pickupLocation: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={emergencyForm.destination} onChange={(e) => setEmergencyForm(f => ({ ...f, destination: e.target.value }))} /></Field>
        </div>
      </ModalSystem>

      {/* Track Modal */}
      <ModalSystem
        isOpen={!!tracking}
        onClose={() => setTracking(null)}
        title={tracking ? `Tracking ${tracking.request_number}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {tracking && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{tracking.guest_name}</p>
                <p className="text-xs text-slate-500">{tracking.room ? `Room ${tracking.room} • ` : ''}{tracking.type}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(tracking.status)}>{tracking.status}</Badge>
                <Badge tone={priorityTone(tracking.priority)}>{tracking.priority}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Car size={14} />{tracking.assigned_vehicle || 'No vehicle'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><UserCheck size={14} />{tracking.transport_drivers?.employees?.name || 'No driver'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Clock size={14} />{formatTime(tracking.scheduled_time)} ({etaLabel(tracking.scheduled_time)})</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{tracking.passenger_count} pax / {tracking.luggage_count} bags</div>
              <div className="col-span-2 flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{tracking.pickup_location} → {tracking.destination}</div>
            </div>
            {tracking.special_instructions && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />{tracking.special_instructions}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {NEXT_STATUS[tracking.status] && (
                <button onClick={() => handleAdvance(tracking)} disabled={saving} className={button.primary}>
                  <CheckCircle2 size={14} /> Advance to {NEXT_STATUS[tracking.status]}
                </button>
              )}
              {driverPhone(tracking) && (
                <a href={`tel:${driverPhone(tracking)}`} className={button.secondary}><Phone size={14} /> Call Driver</a>
              )}
              <button onClick={async () => { if (confirm(`Mark ${tracking.request_number} as No Show?`)) { setSaving(true); try { await patchRequest(tracking.id, { status: 'No Show' }); addNotification('Marked as no show', 'success', 'Transportation'); setTracking(null); fetchAll(); } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); } } }} disabled={saving} className={button.ghost}>
                <XCircle size={14} /> No Show
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default DispatchCenter;
