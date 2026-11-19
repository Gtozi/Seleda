/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Route Management — standard routes, dynamic routing, and optimization.
 * DB-integrated via /api/transport/routes/* (transport_routes table).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Route,
  MapPin,
  Search,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Clock,
  Navigation,
  DollarSign,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface TransportRoute {
  id: string;
  route_number: string;
  name: string;
  type: string;
  category: string;
  start_point: string;
  end_point: string;
  distance: number;
  estimated_time: number;
  toll_cost: number;
  fuel_cost: number;
  status: string;
  frequent_stops: string[];
}

const ROUTE_TYPES = ['Standard Route', 'Dynamic Route', 'Express Route'];
const ROUTE_CATEGORIES = ['Airport Transfer', 'City Transfer', 'Corporate Transfer', 'Tour Transportation', 'Staff Transportation'];
const ROUTE_STATUSES = ['Active', 'Inactive', 'Seasonal'];

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
    case 'Seasonal': return 'warning';
    case 'Inactive': return 'neutral';
    default: return 'neutral';
  }
}

const emptyForm = {
  name: '', type: 'Standard Route', category: 'City Transfer',
  startPoint: '', endPoint: '', distance: '', estimatedTime: '',
  tollCost: '', fuelCost: '', status: 'Active', frequentStops: '',
};

const RouteManagement = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TransportRoute | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/transport/routes/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setRoutes(((await res.json()) as { routes: TransportRoute[] }).routes || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = routes;
    if (typeFilter !== 'all') list = list.filter((r) => r.type === typeFilter);
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.route_number.toLowerCase().includes(q) ||
      r.start_point.toLowerCase().includes(q) ||
      r.end_point.toLowerCase().includes(q)
    );
  }, [routes, search, typeFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: routes.length,
    active: routes.filter((r) => r.status === 'Active').length,
    totalDistance: routes.reduce((s, r) => s + Number(r.distance || 0), 0),
    avgToll: routes.length ? routes.reduce((s, r) => s + Number(r.toll_cost || 0), 0) / routes.length : 0,
  }), [routes]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (r: TransportRoute) => {
    setEditingId(r.id);
    setForm({
      name: r.name, type: r.type, category: r.category,
      startPoint: r.start_point, endPoint: r.end_point,
      distance: String(r.distance), estimatedTime: String(r.estimated_time),
      tollCost: String(r.toll_cost), fuelCost: String(r.fuel_cost),
      status: r.status, frequentStops: (r.frequent_stops || []).join(', '),
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/routes/${editingId}` : '/api/transport/routes/';
      const body = {
        propertyId: currentPropertyId,
        name: form.name, type: form.type, category: form.category,
        startPoint: form.startPoint, endPoint: form.endPoint,
        distance: form.distance === '' ? 0 : Number(form.distance),
        estimatedTime: form.estimatedTime === '' ? 0 : Number(form.estimatedTime),
        tollCost: form.tollCost === '' ? 0 : Number(form.tollCost),
        fuelCost: form.fuelCost === '' ? 0 : Number(form.fuelCost),
        status: form.status,
        frequentStops: form.frequentStops.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Route updated' : 'Route created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (r: TransportRoute, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/routes/${r.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Route ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewing(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this route?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/routes/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Route deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Route Management" subtitle="Standard routes, dynamic routing, and optimization" icon={Route} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Route className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view routes.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Route Management"
        subtitle="Standard routes, dynamic routing, and optimization"
        icon={Route}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> New Route</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Routes" value={String(stats.total)} icon={Route} tone="accent" />
        <StatCard title="Active Routes" value={String(stats.active)} icon={Navigation} tone="success" />
        <StatCard title="Total Distance" value={`${stats.totalDistance} km`} icon={MapPin} tone="info" />
        <StatCard title="Avg Toll Cost" value={formatAmount(stats.avgToll)} icon={DollarSign} tone="warning" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by name, ID, or location..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Types</option>
          {ROUTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {ROUTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Routes Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Routes</h3></div>
        {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div> : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Route className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No routes found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Route ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Name</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Route</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Distance</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Est. Time</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Toll Cost</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Fuel Cost</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{r.route_number}</td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white block">{r.name}</span>
                        <span className="text-xs text-slate-400">{r.type} • {r.category}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 max-w-xs">
                      <div className="flex items-center gap-1 truncate"><MapPin size={12} />{r.start_point} → {r.end_point}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{r.distance} km</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-slate-500"><Clock size={12} />{r.estimated_time} min</div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{formatAmount(r.toll_cost)}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{formatAmount(r.fuel_cost)}</td>
                    <td className="px-6 py-4"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => setViewing(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                        <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
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
        title={editingId ? 'Edit Route' : 'New Route'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Hotel to JFK Airport" /></Field></div>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
              {ROUTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}>
              {ROUTE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Start Point"><input className={inputCls} value={form.startPoint} onChange={(e) => setForm(f => ({ ...f, startPoint: e.target.value }))} /></Field>
          <Field label="End Point"><input className={inputCls} value={form.endPoint} onChange={(e) => setForm(f => ({ ...f, endPoint: e.target.value }))} /></Field>
          <Field label="Distance (km)"><input type="number" min={0} step="0.1" className={inputCls} value={form.distance} onChange={(e) => setForm(f => ({ ...f, distance: e.target.value }))} /></Field>
          <Field label="Est. Time (min)"><input type="number" min={0} className={inputCls} value={form.estimatedTime} onChange={(e) => setForm(f => ({ ...f, estimatedTime: e.target.value }))} /></Field>
          <Field label="Toll Cost"><input type="number" min={0} step="0.01" className={inputCls} value={form.tollCost} onChange={(e) => setForm(f => ({ ...f, tollCost: e.target.value }))} /></Field>
          <Field label="Fuel Cost"><input type="number" min={0} step="0.01" className={inputCls} value={form.fuelCost} onChange={(e) => setForm(f => ({ ...f, fuelCost: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {ROUTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <div className="col-span-2"><Field label="Frequent Stops (comma separated)"><input className={inputCls} value={form.frequentStops} onChange={(e) => setForm(f => ({ ...f, frequentStops: e.target.value }))} /></Field></div>
        </div>
      </ModalSystem>

      {/* Detail Modal */}
      <ModalSystem
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.route_number} — ${viewing.name}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewing.name}</p>
                <p className="text-xs text-slate-500">{viewing.type} • {viewing.category}</p>
              </div>
              <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewing.start_point} → {viewing.end_point}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Clock size={14} />{viewing.estimated_time} min • {viewing.distance} km</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><DollarSign size={14} />Tolls {formatAmount(viewing.toll_cost)} • Fuel {formatAmount(viewing.fuel_cost)}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Navigation size={14} />{(viewing.frequent_stops || []).length} frequent stops</div>
            </div>
            {(viewing.frequent_stops || []).length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Frequent Stops</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.frequent_stops.map((stop, i) => (
                    <span key={i} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-300">{stop}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {viewing.status !== 'Active' && <button onClick={() => handleStatusChange(viewing, 'Active')} disabled={saving} className={button.primary}><Navigation size={14} /> Activate</button>}
              {viewing.status === 'Active' && <button onClick={() => handleStatusChange(viewing, 'Inactive')} disabled={saving} className={button.secondary}>Deactivate</button>}
              {viewing.status !== 'Seasonal' && <button onClick={() => handleStatusChange(viewing, 'Seasonal')} disabled={saving} className={button.ghost}>Mark Seasonal</button>}
              <button onClick={() => { setViewing(null); openEdit(viewing); }} className={button.ghost}><Pencil size={14} /> Edit</button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default RouteManagement;
