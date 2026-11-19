/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vehicle Registry — complete vehicle information and documentation
 * (insurance, registration, valuation). DB-integrated via
 * /api/transport/vehicles/* (transport_vehicles table).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Car,
  Search,
  Plus,
  Pencil,
  Trash2,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  DollarSign,
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
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  condition: string;
  transport_drivers: { id: string; employees: { name: string } | null } | null;
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

interface ExpiryInfo {
  color: string;
  icon: typeof AlertTriangle;
  text: string;
}

function expiryStatus(expiryDate?: string | null): ExpiryInfo {
  if (!expiryDate) return { color: 'text-slate-400', icon: CheckCircle2, text: 'Not set' };
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { color: 'text-rose-600 dark:text-rose-400', icon: AlertTriangle, text: 'Expired' };
  if (days <= 30) return { color: 'text-amber-600 dark:text-amber-400', icon: AlertTriangle, text: `${days} days` };
  return { color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2, text: `${days} days` };
}

function docExpiring(v: Vehicle): boolean {
  const ins = expiryStatus(v.insurance_expiry);
  const reg = expiryStatus(v.registration_expiry);
  return ins.icon === AlertTriangle || reg.icon === AlertTriangle;
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyForm = {
  vehicleNumber: '', registrationNumber: '', vin: '', make: '', model: '', year: '',
  color: '', category: 'Sedan', capacity: 4, fuelType: 'Gasoline',
  insuranceProvider: '', insurancePolicy: '', insuranceExpiry: '', registrationExpiry: '',
  status: 'Active', purchaseDate: '', purchasePrice: '', currentValue: '', condition: 'Good',
};

const VehicleRegistry = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setVehicles(((await res.json()) as { vehicles: Vehicle[] }).vehicles || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = vehicles;
    if (statusFilter !== 'all') list = list.filter((v) => v.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((v) =>
      v.vehicle_number.toLowerCase().includes(q) ||
      (v.registration_number || '').toLowerCase().includes(q) ||
      (v.make || '').toLowerCase().includes(q) ||
      (v.model || '').toLowerCase().includes(q) ||
      (v.vin || '').toLowerCase().includes(q)
    );
  }, [vehicles, search, statusFilter]);

  const stats = useMemo(() => ({
    total: vehicles.length,
    active: vehicles.filter((v) => v.status === 'Active' || v.status === 'In Use').length,
    docsExpiring: vehicles.filter(docExpiring).length,
    fleetValue: vehicles.reduce((s, v) => s + (v.current_value || 0), 0),
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
      status: v.status,
      purchaseDate: v.purchase_date || '',
      purchasePrice: String(v.purchase_price ?? ''), currentValue: String(v.current_value ?? ''),
      condition: v.condition,
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
        status: form.status,
        purchaseDate: form.purchaseDate || null,
        purchasePrice: form.purchasePrice === '' ? 0 : Number(form.purchasePrice),
        currentValue: form.currentValue === '' ? 0 : Number(form.currentValue),
        condition: form.condition,
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Vehicle updated' : 'Vehicle registered', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this vehicle from the registry?')) return;
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
        <PageHeader title="Vehicle Registry" subtitle="Complete vehicle information and documentation" icon={Car} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Car className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view the registry.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Vehicle Registry"
        subtitle="Complete vehicle information and documentation"
        icon={Car}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> Add Vehicle</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Vehicles" value={String(stats.total)} icon={Car} tone="accent" />
        <StatCard title="Active" value={String(stats.active)} icon={CheckCircle2} tone="success" />
        <StatCard title="Docs Expiring" value={String(stats.docsExpiring)} icon={AlertTriangle} tone="warning" />
        <StatCard title="Fleet Value" value={formatAmount(stats.fleetValue)} icon={DollarSign} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by number, plate, make, model, or VIN..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Vehicles Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Registered Vehicles</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Car className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No vehicles found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Vehicle ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Vehicle Info</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Registration</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Category</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Insurance</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Registration Expiry</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Value</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((v) => {
                  const ins = expiryStatus(v.insurance_expiry);
                  const reg = expiryStatus(v.registration_expiry);
                  const InsIcon = ins.icon;
                  const RegIcon = reg.icon;
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{v.vehicle_number}</td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{v.make} {v.model}</p>
                          <p className="text-xs text-slate-500">{v.year || '—'} • {v.color || '—'} • {v.fuel_type}</p>
                          {v.vin && <p className="text-xs text-slate-400">VIN: {v.vin}</p>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{v.registration_number || '—'}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{v.category} ({v.capacity} seats)</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <InsIcon className={`w-4 h-4 ${ins.color}`} />
                          <div>
                            <p className="text-sm text-slate-900 dark:text-white">{v.insurance_provider || '—'}</p>
                            <p className={`text-xs ${ins.color}`}>{ins.text}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <RegIcon className={`w-4 h-4 ${reg.color}`} />
                          <div>
                            <p className="text-sm text-slate-900 dark:text-white">{formatDate(v.registration_expiry)}</p>
                            <p className={`text-xs ${reg.color}`}>{reg.text}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4"><Badge tone={statusTone(v.status)}>{v.status}</Badge></td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">{formatAmount(v.current_value || 0)}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => setViewing(v)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                          <button onClick={() => openEdit(v)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                          <button onClick={() => handleDelete(v.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create / Edit Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Vehicle' : 'Register Vehicle'}
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
          <Field label="Color"><input className={inputCls} value={form.color} onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))} /></Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}>
              {VEHICLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Capacity"><input type="number" min={1} className={inputCls} value={form.capacity} onChange={(e) => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></Field>
          <Field label="Fuel Type">
            <select className={inputCls} value={form.fuelType} onChange={(e) => setForm(f => ({ ...f, fuelType: e.target.value }))}>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select className={inputCls} value={form.condition} onChange={(e) => setForm(f => ({ ...f, condition: e.target.value }))}>
              {VEHICLE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Insurance Provider"><input className={inputCls} value={form.insuranceProvider} onChange={(e) => setForm(f => ({ ...f, insuranceProvider: e.target.value }))} /></Field>
          <Field label="Insurance Policy"><input className={inputCls} value={form.insurancePolicy} onChange={(e) => setForm(f => ({ ...f, insurancePolicy: e.target.value }))} /></Field>
          <Field label="Insurance Expiry"><input type="date" className={inputCls} value={form.insuranceExpiry} onChange={(e) => setForm(f => ({ ...f, insuranceExpiry: e.target.value }))} /></Field>
          <Field label="Registration Expiry"><input type="date" className={inputCls} value={form.registrationExpiry} onChange={(e) => setForm(f => ({ ...f, registrationExpiry: e.target.value }))} /></Field>
          <Field label="Purchase Date"><input type="date" className={inputCls} value={form.purchaseDate} onChange={(e) => setForm(f => ({ ...f, purchaseDate: e.target.value }))} /></Field>
          <Field label="Purchase Price"><input type="number" min={0} step="0.01" className={inputCls} value={form.purchasePrice} onChange={(e) => setForm(f => ({ ...f, purchasePrice: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="Current Value"><input type="number" min={0} step="0.01" className={inputCls} value={form.currentValue} onChange={(e) => setForm(f => ({ ...f, currentValue: e.target.value }))} /></Field></div>
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
                <p className="text-xs text-slate-500">{viewing.category} • {viewing.color || '—'} • {viewing.fuel_type} • {viewing.capacity} seats</p>
              </div>
              <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-300">
              <div>Plate: <span className="font-medium text-slate-900 dark:text-white">{viewing.registration_number || '—'}</span></div>
              <div>VIN: <span className="font-medium text-slate-900 dark:text-white">{viewing.vin || '—'}</span></div>
              <div>Insurance: <span className="font-medium text-slate-900 dark:text-white">{viewing.insurance_provider || '—'}</span> ({viewing.insurance_policy || '—'})</div>
              <div>Driver: <span className="font-medium text-slate-900 dark:text-white">{viewing.transport_drivers?.employees?.name || 'Unassigned'}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
              <span className={expiryStatus(viewing.insurance_expiry).color}>Insurance expiry: {formatDate(viewing.insurance_expiry)} — {expiryStatus(viewing.insurance_expiry).text}</span>
              <span className={expiryStatus(viewing.registration_expiry).color}>Registration expiry: {formatDate(viewing.registration_expiry)} — {expiryStatus(viewing.registration_expiry).text}</span>
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">Purchased {formatDate(viewing.purchase_date)} for {formatAmount(viewing.purchase_price || 0)}</span>
              <span className="font-semibold text-slate-900 dark:text-white">Current value: {formatAmount(viewing.current_value || 0)}</span>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default VehicleRegistry;
