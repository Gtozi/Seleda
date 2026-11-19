/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fleet Management — complete fleet overview and vehicle status.
 * DB-integrated via /api/transport/vehicles/* (transport_vehicles table).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Car,
  Search,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Fuel,
  Wrench,
  Plus,
  Eye,
  Pencil,
  Trash2,
  MapPin,
  Users,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Vehicle {
  id: string;
  vehicle_number: string;
  registration_number: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  category: string;
  capacity: number;
  fuel_type: string;
  insurance_provider: string | null;
  insurance_policy: string | null;
  insurance_expiry: string | null;
  registration_expiry: string | null;
  status: string;
  mileage: number;
  last_service: string | null;
  next_service: string | null;
  driver_id: string | null;
  current_location: string | null;
  fuel_level: number;
  utilization: number;
  condition: string;
  transport_drivers: { id: string; employees: { name: string; phone: string | null } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  employees: { name: string } | null;
}

const VEHICLE_CATEGORIES = ['Sedan', 'SUV', 'Van', 'Minibus', 'Luxury', 'Shuttle Bus', 'Utility Vehicle', 'Motorcycle', 'Electric', 'Electric Vehicle'];
const VEHICLE_STATUSES = ['Active', 'In Use', 'Maintenance', 'Out of Service', 'Retired', 'Sold'];
const VEHICLE_CONDITIONS = ['Excellent', 'Good', 'Fair', 'Service Required'];
const FUEL_TYPES = ['Gasoline', 'Diesel', 'Electric', 'Hybrid'];

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
    case 'Active': return 'success';
    case 'In Use': return 'info';
    case 'Maintenance': return 'warning';
    case 'Out of Service': case 'Retired': case 'Sold': return 'danger';
    default: return 'neutral';
  }
}

function conditionTone(condition: string): StatusTone {
  switch (condition) {
    case 'Excellent': return 'success';
    case 'Good': return 'info';
    case 'Fair': return 'warning';
    case 'Service Required': return 'danger';
    default: return 'neutral';
  }
}

function fuelBar(level: number): string {
  if (level >= 50) return 'bg-emerald-500';
  if (level >= 25) return 'bg-amber-500';
  return 'bg-rose-500';
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function serviceDueWithin(nextService: string | null, days: number): boolean {
  if (!nextService) return false;
  const diff = (new Date(nextService).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff <= days;
}

const emptyForm = {
  vehicleNumber: '', registrationNumber: '', vin: '', make: '', model: '', year: '',
  color: '', category: 'Sedan', capacity: 4, fuelType: 'Gasoline',
  insuranceProvider: '', insurancePolicy: '', insuranceExpiry: '', registrationExpiry: '',
  status: 'Active', mileage: 0, lastService: '', nextService: '',
  driverId: '', currentLocation: '', fuelLevel: 100, utilization: 0, condition: 'Good',
};

const FleetManagement = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [vRes, dRes] = await Promise.all([
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (vRes.ok) setVehicles(((await vRes.json()) as { vehicles: Vehicle[] }).vehicles || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = vehicles;
    if (statusFilter !== 'all') list = list.filter((v) => v.status === statusFilter);
    if (categoryFilter !== 'all') list = list.filter((v) => v.category === categoryFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((v) =>
      v.vehicle_number.toLowerCase().includes(q) ||
      (v.make || '').toLowerCase().includes(q) ||
      (v.model || '').toLowerCase().includes(q) ||
      (v.registration_number || '').toLowerCase().includes(q)
    );
  }, [vehicles, search, statusFilter, categoryFilter]);

  const stats = useMemo(() => ({
    total: vehicles.length,
    active: vehicles.filter((v) => v.status === 'Active').length,
    inUse: vehicles.filter((v) => v.status === 'In Use').length,
    maintenance: vehicles.filter((v) => v.status === 'Maintenance').length,
    avgUtilization: vehicles.length ? Math.round(vehicles.reduce((s, v) => s + v.utilization, 0) / vehicles.length) : 0,
    serviceDue: vehicles.filter((v) => serviceDueWithin(v.next_service, 30)).length,
  }), [vehicles]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditingId(v.id);
    setForm({
      vehicleNumber: v.vehicle_number, registrationNumber: v.registration_number || '',
      vin: v.vin || '', make: v.make || '', model: v.model || '',
      year: v.year !== null ? String(v.year) : '', color: v.color || '',
      category: v.category, capacity: v.capacity, fuelType: v.fuel_type,
      insuranceProvider: v.insurance_provider || '', insurancePolicy: v.insurance_policy || '',
      insuranceExpiry: v.insurance_expiry || '', registrationExpiry: v.registration_expiry || '',
      status: v.status, mileage: v.mileage,
      lastService: v.last_service || '', nextService: v.next_service || '',
      driverId: v.driver_id || '', currentLocation: v.current_location || '',
      fuelLevel: v.fuel_level, utilization: v.utilization, condition: v.condition,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/vehicles/${editingId}` : '/api/transport/vehicles/';
      const body = {
        propertyId: currentPropertyId,
        vehicleNumber: form.vehicleNumber,
        registrationNumber: form.registrationNumber || null,
        vin: form.vin || null,
        make: form.make || null, model: form.model || null,
        year: form.year === '' ? null : Number(form.year),
        color: form.color || null,
        category: form.category, capacity: form.capacity, fuelType: form.fuelType,
        insuranceProvider: form.insuranceProvider || null, insurancePolicy: form.insurancePolicy || null,
        insuranceExpiry: form.insuranceExpiry || null, registrationExpiry: form.registrationExpiry || null,
        status: form.status, mileage: form.mileage,
        lastService: form.lastService || null, nextService: form.nextService || null,
        driverId: form.driverId || null, currentLocation: form.currentLocation || null,
        fuelLevel: form.fuelLevel, utilization: form.utilization, condition: form.condition,
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Vehicle updated' : 'Vehicle added', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (v: Vehicle, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/vehicles/${v.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Vehicle ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewing(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this vehicle from the fleet?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/vehicles/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Vehicle removed', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Fleet Management" subtitle="Complete fleet overview and vehicle status" icon={Car} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view the fleet.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Fleet Management"
        subtitle="Complete fleet overview and vehicle status"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> Add Vehicle</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Total Fleet" value={String(stats.total)} icon={Car} tone="accent" />
        <StatCard title="Active" value={String(stats.active)} icon={CheckCircle2} tone="success" />
        <StatCard title="In Use" value={String(stats.inUse)} icon={Gauge} tone="info" />
        <StatCard title="Maintenance" value={String(stats.maintenance)} icon={Wrench} tone="warning" />
        <StatCard title="Avg Utilization" value={`${stats.avgUtilization}%`} icon={Gauge} tone="neutral" />
        <StatCard title="Service Due" value={String(stats.serviceDue)} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by ID, make, model, or plate..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Categories</option>
          {VEHICLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Fleet Grid */}
      {loading ? <SectionCard><div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div></SectionCard>
        : filtered.length === 0 ? <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No vehicles found.</p></div></SectionCard>
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((v) => (
              <SectionCard key={v.id} pad="none">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{v.vehicle_number}</span>
                        <Badge tone={statusTone(v.status)}>{v.status}</Badge>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">{v.make} {v.model}</p>
                      <p className="text-xs text-slate-500">{v.year || '—'} • {v.category}</p>
                    </div>
                    <Badge tone={conditionTone(v.condition)}>{v.condition}</Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Plate</span>
                      <span className="font-medium text-slate-900 dark:text-white">{v.registration_number || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Driver</span>
                      <span className="font-medium text-slate-900 dark:text-white">{v.transport_drivers?.employees?.name || 'Unassigned'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Location</span>
                      <span className="font-medium text-slate-900 dark:text-white truncate ml-2">{v.current_location || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Mileage</span>
                      <span className="font-medium text-slate-900 dark:text-white">{Number(v.mileage).toLocaleString()} km</span>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 flex items-center gap-1"><Fuel size={11} /> Fuel</span>
                      <span className="font-medium text-slate-900 dark:text-white">{v.fuel_level}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                      <div className={`h-2 rounded-full ${fuelBar(v.fuel_level)}`} style={{ width: `${v.fuel_level}%` }} />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Gauge size={11} /> Utilization: {v.utilization}%</span>
                    <span className={`flex items-center gap-1 ${serviceDueWithin(v.next_service, 30) ? 'text-rose-500 font-semibold' : ''}`}>
                      <Clock size={11} /> Next: {formatDate(v.next_service)}
                    </span>
                  </div>

                  <div className="mt-3 flex gap-1">
                    <button onClick={() => setViewing(v)} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"><Eye size={12} /> View</button>
                    <button onClick={() => openEdit(v)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                    <button onClick={() => handleDelete(v.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                  </div>
                </div>
              </SectionCard>
            ))}
          </div>
        )}

      {/* Create / Edit Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Vehicle' : 'Add Vehicle'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vehicle Number"><input className={inputCls} value={form.vehicleNumber} onChange={(e) => setForm(f => ({ ...f, vehicleNumber: e.target.value }))} placeholder="e.g. VH-010" /></Field>
          <Field label="Plate"><input className={inputCls} value={form.registrationNumber} onChange={(e) => setForm(f => ({ ...f, registrationNumber: e.target.value }))} /></Field>
          <Field label="Make"><input className={inputCls} value={form.make} onChange={(e) => setForm(f => ({ ...f, make: e.target.value }))} /></Field>
          <Field label="Model"><input className={inputCls} value={form.model} onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))} /></Field>
          <Field label="Year"><input type="number" className={inputCls} value={form.year} onChange={(e) => setForm(f => ({ ...f, year: e.target.value }))} /></Field>
          <Field label="VIN"><input className={inputCls} value={form.vin} onChange={(e) => setForm(f => ({ ...f, vin: e.target.value }))} /></Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}>
              {VEHICLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Capacity"><input type="number" min={1} className={inputCls} value={form.capacity} onChange={(e) => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></Field>
          <Field label="Fuel Type">
            <select className={inputCls} value={form.fuelType} onChange={(e) => setForm(f => ({ ...f, fuelType: e.target.value }))}>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select className={inputCls} value={form.condition} onChange={(e) => setForm(f => ({ ...f, condition: e.target.value }))}>
              {VEHICLE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Fuel Level %"><input type="number" min={0} max={100} className={inputCls} value={form.fuelLevel} onChange={(e) => setForm(f => ({ ...f, fuelLevel: Number(e.target.value) }))} /></Field>
          <Field label="Mileage (km)"><input type="number" min={0} className={inputCls} value={form.mileage} onChange={(e) => setForm(f => ({ ...f, mileage: Number(e.target.value) }))} /></Field>
          <Field label="Utilization %"><input type="number" min={0} max={100} className={inputCls} value={form.utilization} onChange={(e) => setForm(f => ({ ...f, utilization: Number(e.target.value) }))} /></Field>
          <Field label="Current Location"><input className={inputCls} value={form.currentLocation} onChange={(e) => setForm(f => ({ ...f, currentLocation: e.target.value }))} placeholder="e.g. Hotel Garage" /></Field>
          <Field label="Driver">
            <select className={inputCls} value={form.driverId} onChange={(e) => setForm(f => ({ ...f, driverId: e.target.value }))}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Last Service"><input type="date" className={inputCls} value={form.lastService} onChange={(e) => setForm(f => ({ ...f, lastService: e.target.value }))} /></Field>
          <Field label="Next Service"><input type="date" className={inputCls} value={form.nextService} onChange={(e) => setForm(f => ({ ...f, nextService: e.target.value }))} /></Field>
          <Field label="Insurance Provider"><input className={inputCls} value={form.insuranceProvider} onChange={(e) => setForm(f => ({ ...f, insuranceProvider: e.target.value }))} /></Field>
          <Field label="Insurance Expiry"><input type="date" className={inputCls} value={form.insuranceExpiry} onChange={(e) => setForm(f => ({ ...f, insuranceExpiry: e.target.value }))} /></Field>
          <Field label="Registration Expiry"><input type="date" className={inputCls} value={form.registrationExpiry} onChange={(e) => setForm(f => ({ ...f, registrationExpiry: e.target.value }))} /></Field>
        </div>
      </ModalSystem>

      {/* Detail Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.vehicle_number} — ${viewing.make || ''} ${viewing.model || ''}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.year} {viewing.make} {viewing.model}</p>
                <p className="text-xs text-slate-500">{viewing.category} • {viewing.registration_number || 'No plate'} • {viewing.fuel_type}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={conditionTone(viewing.condition)}>{viewing.condition}</Badge>
                <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewing.transport_drivers?.employees?.name || 'Unassigned'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewing.current_location || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Gauge size={14} />{Number(viewing.mileage).toLocaleString()} km • {viewing.utilization}% util.</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Fuel size={14} />{viewing.fuel_level}% fuel • cap. {viewing.capacity}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
              <span>Last service: {formatDate(viewing.last_service)}</span>
              <span className={serviceDueWithin(viewing.next_service, 30) ? 'text-rose-500 font-semibold' : ''}>Next service: {formatDate(viewing.next_service)}</span>
              <span>Insurance: {viewing.insurance_provider || '—'} (exp. {formatDate(viewing.insurance_expiry)})</span>
              <span>Reg. expiry: {formatDate(viewing.registration_expiry)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {viewing.status !== 'Active' && viewing.status !== 'In Use' && <button onClick={() => handleStatusChange(viewing, 'Active')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Mark Active</button>}
              {viewing.status !== 'Maintenance' && <button onClick={() => handleStatusChange(viewing, 'Maintenance')} disabled={saving} className={button.secondary}><Wrench size={14} /> Send to Maintenance</button>}
              {viewing.status !== 'Out of Service' && <button onClick={() => handleStatusChange(viewing, 'Out of Service')} disabled={saving} className={button.ghost}><AlertTriangle size={14} /> Out of Service</button>}
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default FleetManagement;
