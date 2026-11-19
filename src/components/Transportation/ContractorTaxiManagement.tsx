/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contractor & Taxi Management — external transportation partners.
 * DB-integrated via /api/transport/contractors/* (transport_contractors + transport_contractor_trips).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  Search,
  Plus,
  Pencil,
  Trash2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Star,
  FileText,
  Phone,
  Mail,
  Loader2,
  RefreshCw,
  CarTaxiFront,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Contractor {
  id: string;
  contractor_number: string;
  name: string;
  type: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  contract_start: string | null;
  contract_end: string | null;
  rate_structure: string;
  base_rate: number;
  per_mile_rate: number;
  performance: number;
  total_trips: number;
  on_time_rate: number;
  rating: number;
}

interface ContractorTrip {
  id: string;
  trip_number: string;
  contractor_id: string | null;
  trip_date: string;
  destination: string | null;
  amount: number;
  status: string;
  transport_contractors: { contractor_number: string; name: string; type: string } | null;
}

interface ContractorInvoice {
  id: string;
  invoice_number: string;
  contractor_id: string | null;
  period_start: string | null;
  period_end: string | null;
  trip_count: number;
  amount: number;
  expected_amount: number | null;
  variance: number | null;
  status: string;
  notes: string | null;
  submitted_date: string;
  verified_by: string | null;
  verified_at: string | null;
  paid_at: string | null;
  transport_contractors: { contractor_number: string; name: string; type: string } | null;
}

const CONTRACTOR_TYPES = ['Taxi Company', 'Chauffeur Service', 'Bus Operator', 'Tour Operator'];
const CONTRACTOR_STATUSES = ['Active', 'Pending', 'Inactive'];
const RATE_STRUCTURES = ['Per Mile', 'Hourly', 'Per Trip', 'Package'];
const TRIP_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const INVOICE_STATUSES = ['Submitted', 'Under Review', 'Verified', 'Disputed', 'Paid', 'Rejected'];

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
    case 'Pending': return 'warning';
    case 'Inactive': return 'danger';
    case 'Completed': return 'success';
    case 'In Progress': return 'info';
    case 'Scheduled': return 'accent';
    case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

function invoiceTone(status: string): StatusTone {
  switch (status) {
    case 'Paid': return 'success';
    case 'Verified': return 'info';
    case 'Submitted': return 'warning';
    case 'Under Review': return 'accent';
    case 'Disputed': return 'danger';
    case 'Rejected': return 'danger';
    default: return 'neutral';
  }
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyContractorForm = {
  name: '', type: 'Taxi Company', contact: '', phone: '', email: '', status: 'Pending',
  contractStart: '', contractEnd: '', rateStructure: 'Per Trip', baseRate: '', perMileRate: '',
  performance: '0', totalTrips: '0', onTimeRate: '0', rating: '0',
};
const emptyTripForm = { contractorId: '', tripDate: '', destination: '', amount: '', status: 'Scheduled' };
const emptyInvoiceForm = { contractorId: '', periodStart: '', periodEnd: '', tripCount: '', amount: '', notes: '' };

const ContractorTaxiManagement = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [trips, setTrips] = useState<ContractorTrip[]>([]);
  const [invoices, setInvoices] = useState<ContractorInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');
  const [showContractorModal, setShowContractorModal] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null);
  const [editingTrip, setEditingTrip] = useState<ContractorTrip | null>(null);
  const [viewing, setViewing] = useState<Contractor | null>(null);
  const [contractorForm, setContractorForm] = useState({ ...emptyContractorForm });
  const [tripForm, setTripForm] = useState({ ...emptyTripForm });
  const [invoiceForm, setInvoiceForm] = useState({ ...emptyInvoiceForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [res, invRes] = await Promise.all([
        fetch(`/api/transport/contractors/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/contractors/${currentPropertyId}/invoices`, { headers: authHeaders() }),
      ]);
      if (res.ok) {
        const data = (await res.json()) as { contractors: Contractor[]; trips: ContractorTrip[] };
        setContractors(data.contractors || []);
        setTrips(data.trips || []);
      }
      if (invRes.ok) setInvoices(((await invRes.json()) as { invoices: ContractorInvoice[] }).invoices || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = contractors;
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contact || '').toLowerCase().includes(q) ||
        c.contractor_number.toLowerCase().includes(q));
    }
    return list;
  }, [contractors, statusFilter, search]);

  const stats = useMemo(() => {
    const active = contractors.filter((c) => c.status === 'Active');
    const rated = active.filter((c) => c.rating > 0);
    const onTime = active.filter((c) => c.on_time_rate > 0);
    return {
      active: active.length,
      avgOnTime: onTime.length ? Math.round(onTime.reduce((s, c) => s + c.on_time_rate, 0) / onTime.length) : 0,
      avgRating: rated.length ? (rated.reduce((s, c) => s + Number(c.rating), 0) / rated.length).toFixed(1) : '0.0',
      pending: contractors.filter((c) => c.status === 'Pending').length,
    };
  }, [contractors]);

  const ratingStars = (rating: number) =>
    Array(5).fill(0).map((_, i) => (
      <Star key={i} className={`w-4 h-4 ${i < Math.round(rating) ? 'text-amber-500 fill-amber-500' : 'text-slate-300 dark:text-slate-600'}`} />
    ));

  const openCreateContractor = () => {
    setEditingContractor(null);
    setContractorForm({ ...emptyContractorForm });
    setShowContractorModal(true);
  };

  const openEditContractor = (c: Contractor) => {
    setEditingContractor(c);
    setContractorForm({
      name: c.name, type: c.type, contact: c.contact || '', phone: c.phone || '', email: c.email || '',
      status: c.status, contractStart: c.contract_start || '', contractEnd: c.contract_end || '',
      rateStructure: c.rate_structure, baseRate: String(c.base_rate), perMileRate: String(c.per_mile_rate),
      performance: String(c.performance), totalTrips: String(c.total_trips),
      onTimeRate: String(c.on_time_rate), rating: String(c.rating),
    });
    setShowContractorModal(true);
  };

  const openCreateTrip = () => {
    setEditingTrip(null);
    setTripForm({ ...emptyTripForm, tripDate: new Date().toISOString().slice(0, 10) });
    setShowTripModal(true);
  };

  const openEditTrip = (t: ContractorTrip) => {
    setEditingTrip(t);
    setTripForm({
      contractorId: t.contractor_id || '',
      tripDate: t.trip_date || '',
      destination: t.destination || '',
      amount: String(t.amount),
      status: t.status,
    });
    setShowTripModal(true);
  };

  const handleSaveContractor = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingContractor ? `/api/transport/contractors/contractors/${editingContractor.id}` : '/api/transport/contractors/contractors';
      const body = {
        propertyId: currentPropertyId,
        name: contractorForm.name, type: contractorForm.type,
        contact: contractorForm.contact || null, phone: contractorForm.phone || null, email: contractorForm.email || null,
        status: contractorForm.status, contractStart: contractorForm.contractStart || null, contractEnd: contractorForm.contractEnd || null,
        rateStructure: contractorForm.rateStructure,
        baseRate: Number(contractorForm.baseRate) || 0, perMileRate: Number(contractorForm.perMileRate) || 0,
        performance: Number(contractorForm.performance) || 0, totalTrips: Number(contractorForm.totalTrips) || 0,
        onTimeRate: Number(contractorForm.onTimeRate) || 0, rating: Number(contractorForm.rating) || 0,
      };
      const res = await fetch(endpoint, { method: editingContractor ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingContractor ? 'Contractor updated' : 'Contractor created', 'success', 'Transportation');
      setShowContractorModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleSaveTrip = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingTrip ? `/api/transport/contractors/trips/${editingTrip.id}` : '/api/transport/contractors/trips';
      const body = {
        propertyId: currentPropertyId,
        contractorId: tripForm.contractorId || null,
        tripDate: tripForm.tripDate || null,
        destination: tripForm.destination || null,
        amount: Number(tripForm.amount) || 0,
        status: tripForm.status,
      };
      const res = await fetch(endpoint, { method: editingTrip ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingTrip ? 'Trip updated' : 'Trip recorded', 'success', 'Transportation');
      setShowTripModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleContractorStatus = async (c: Contractor, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/contractors/contractors/${c.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Contractor ${status.toLowerCase()}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeleteContractor = async (id: string) => {
    if (!confirm('Delete this contractor?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/contractors/contractors/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Contractor deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeleteTrip = async (id: string) => {
    if (!confirm('Delete this trip?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/contractors/trips/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Trip deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const openCreateInvoice = () => {
    setInvoiceForm({ ...emptyInvoiceForm });
    setShowInvoiceModal(true);
  };

  const handleSaveInvoice = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        contractorId: invoiceForm.contractorId || null,
        periodStart: invoiceForm.periodStart || null,
        periodEnd: invoiceForm.periodEnd || null,
        tripCount: Number(invoiceForm.tripCount) || 0,
        amount: Number(invoiceForm.amount) || 0,
        notes: invoiceForm.notes || null,
      };
      const res = await fetch('/api/transport/contractors/invoices', {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Invoice submitted', 'success', 'Transportation');
      setShowInvoiceModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleInvoiceStatus = async (inv: ContractorInvoice, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/contractors/invoices/${inv.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Invoice ${status.toLowerCase()}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeleteInvoice = async (id: string) => {
    if (!confirm('Delete this invoice?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/contractors/invoices/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Invoice deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Contractor & Taxi Management" subtitle="External transportation partners and contractors" icon={CarTaxiFront} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Building2 className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view contractors.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Contractor & Taxi Management"
        subtitle="External transportation partners and contractors"
        icon={CarTaxiFront}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreateInvoice} className={button.secondary}><FileText className="w-4 h-4" /> Submit Invoice</button>
            <button onClick={openCreateTrip} className={button.secondary}><Plus className="w-4 h-4" /> Record Trip</button>
            <button onClick={openCreateContractor} className={button.primary}><Plus className="w-4 h-4" /> Add Contractor</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Contractors" value={String(stats.active)} icon={Building2} tone="accent" />
        <StatCard title="Avg On-Time Rate" value={`${stats.avgOnTime}%`} icon={CheckCircle2} tone="success" />
        <StatCard title="Avg Rating" value={stats.avgRating} icon={Star} tone="info" />
        <StatCard title="Pending Approval" value={String(stats.pending)} icon={AlertTriangle} tone="warning" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            placeholder="Search by name, contact, or ID..."
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={filterSelectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          {CONTRACTOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contractors */}
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Contractors</h3></div>
          <div className="p-4 space-y-4 max-h-[560px] overflow-y-auto">
            {loading && filtered.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><Building2 className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No contractors.</p></div>
            ) : filtered.map((c) => (
              <div key={c.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{c.contractor_number}</span>
                      <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">{c.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{c.type}</p>
                  </div>
                  <div className="flex gap-0.5">{ratingStars(Number(c.rating))}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <Phone className="w-4 h-4 shrink-0" />
                    <span className="truncate">{c.contact || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <FileText className="w-4 h-4 shrink-0" />
                    {c.rate_structure}
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {c.on_time_rate}% on-time
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <Star className="w-4 h-4 shrink-0" />
                    {c.total_trips} trips
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-slate-600 dark:text-slate-400">Base Rate: </span>
                    <span className="font-medium text-slate-900 dark:text-white">{formatAmount(Number(c.base_rate))}</span>
                    {Number(c.per_mile_rate) > 0 && <span className="text-slate-500 text-xs"> + {formatAmount(Number(c.per_mile_rate))}/mi</span>}
                  </div>
                  <div className="flex gap-1">
                    {c.status === 'Pending' && (
                      <button onClick={() => handleContractorStatus(c, 'Active')} disabled={saving} title="Approve" className="p-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition"><CheckCircle2 size={14} className="text-emerald-500" /></button>
                    )}
                    {c.status === 'Active' && (
                      <button onClick={() => handleContractorStatus(c, 'Inactive')} disabled={saving} title="Deactivate" className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><AlertTriangle size={14} className="text-rose-400" /></button>
                    )}
                    <button onClick={() => { setViewing(c); setShowView(true); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                    <button onClick={() => openEditContractor(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                    <button onClick={() => handleDeleteContractor(c.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Recent Contractor Trips */}
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Recent Contractor Trips</h3></div>
          <div className="p-4 space-y-3 max-h-[560px] overflow-y-auto">
            {trips.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><CarTaxiFront className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No contractor trips.</p></div>
            ) : trips.map((t) => (
              <div key={t.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 group">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{t.trip_number}</span>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      {t.transport_contractors ? `${t.transport_contractors.contractor_number} · ${t.transport_contractors.name}` : 'No contractor'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(t.trip_date)}</p>
                  </div>
                  <div className="text-right flex items-start gap-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{formatAmount(Number(t.amount))}</p>
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => openEditTrip(t)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"><Pencil size={12} className="text-slate-400" /></button>
                      <button onClick={() => handleDeleteTrip(t.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={12} className="text-rose-400" /></button>
                    </div>
                  </div>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Destination: {t.destination || '—'}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Contractor Invoices */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Contractor Invoices</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{invoices.filter((i) => ['Submitted', 'Under Review'].includes(i.status)).length} awaiting review</span>
            <select className={filterSelectCls} value={invoiceStatusFilter} onChange={(e) => setInvoiceStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
          {(invoiceStatusFilter === 'all' ? invoices : invoices.filter((i) => i.status === invoiceStatusFilter)).length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400"><FileText className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No invoices submitted.</p></div>
          ) : (invoiceStatusFilter === 'all' ? invoices : invoices.filter((i) => i.status === invoiceStatusFilter)).map((inv) => (
            <div key={inv.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 group">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 dark:text-white">{inv.invoice_number}</span>
                    <Badge tone={invoiceTone(inv.status)}>{inv.status}</Badge>
                    {inv.variance != null && Math.abs(inv.variance) > 0.01 && (
                      <Badge tone="danger"><span title={`Expected ${formatAmount(Number(inv.expected_amount))}`}>Var {formatAmount(Number(inv.variance))}</span></Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {inv.transport_contractors ? `${inv.transport_contractors.contractor_number} · ${inv.transport_contractors.name}` : 'No contractor'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDate(inv.period_start)} → {formatDate(inv.period_end)} · {inv.trip_count} trip(s) · submitted {formatDate(inv.submitted_date)}
                  </p>
                </div>
                <div className="text-right flex items-start gap-1">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{formatAmount(Number(inv.amount))}</p>
                    {inv.expected_amount != null && <p className="text-xs text-slate-500">expected {formatAmount(Number(inv.expected_amount))}</p>}
                  </div>
                  <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={12} className="text-rose-400" /></button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {inv.status === 'Submitted' && (
                  <button onClick={() => handleInvoiceStatus(inv, 'Under Review')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 transition">Review</button>
                )}
                {['Submitted', 'Under Review'].includes(inv.status) && (
                  <>
                    <button onClick={() => handleInvoiceStatus(inv, 'Verified')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 transition">Verify</button>
                    <button onClick={() => handleInvoiceStatus(inv, 'Disputed')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 hover:bg-amber-200 transition">Dispute</button>
                    <button onClick={() => handleInvoiceStatus(inv, 'Rejected')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-200 transition">Reject</button>
                  </>
                )}
                {inv.status === 'Verified' && (
                  <button onClick={() => handleInvoiceStatus(inv, 'Paid')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-200 transition">Mark Paid</button>
                )}
                {inv.notes && <span className="text-xs text-slate-400 truncate ml-1">{inv.notes}</span>}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Contractor Modal */}
      <ModalSystem
        isOpen={showContractorModal}
        onClose={() => setShowContractorModal(false)}
        onConfirm={handleSaveContractor}
        title={editingContractor ? `Edit ${editingContractor.contractor_number}` : 'Add Contractor'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input className={inputCls} value={contractorForm.name} onChange={(e) => setContractorForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={contractorForm.type} onChange={(e) => setContractorForm(f => ({ ...f, type: e.target.value }))}>
              {CONTRACTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Contact"><input className={inputCls} value={contractorForm.contact} onChange={(e) => setContractorForm(f => ({ ...f, contact: e.target.value }))} /></Field>
          <Field label="Phone"><input className={inputCls} value={contractorForm.phone} onChange={(e) => setContractorForm(f => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={contractorForm.email} onChange={(e) => setContractorForm(f => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={contractorForm.status} onChange={(e) => setContractorForm(f => ({ ...f, status: e.target.value }))}>
              {CONTRACTOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Contract Start"><input type="date" className={inputCls} value={contractorForm.contractStart} onChange={(e) => setContractorForm(f => ({ ...f, contractStart: e.target.value }))} /></Field>
          <Field label="Contract End"><input type="date" className={inputCls} value={contractorForm.contractEnd} onChange={(e) => setContractorForm(f => ({ ...f, contractEnd: e.target.value }))} /></Field>
          <Field label="Rate Structure">
            <select className={inputCls} value={contractorForm.rateStructure} onChange={(e) => setContractorForm(f => ({ ...f, rateStructure: e.target.value }))}>
              {RATE_STRUCTURES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Base Rate"><input type="number" step="0.01" min={0} className={inputCls} value={contractorForm.baseRate} onChange={(e) => setContractorForm(f => ({ ...f, baseRate: e.target.value }))} /></Field>
          <Field label="Per-Mile Rate"><input type="number" step="0.01" min={0} className={inputCls} value={contractorForm.perMileRate} onChange={(e) => setContractorForm(f => ({ ...f, perMileRate: e.target.value }))} /></Field>
          <Field label="Performance (0-5)"><input type="number" step="0.1" min={0} max={5} className={inputCls} value={contractorForm.performance} onChange={(e) => setContractorForm(f => ({ ...f, performance: e.target.value }))} /></Field>
          <Field label="Total Trips"><input type="number" min={0} className={inputCls} value={contractorForm.totalTrips} onChange={(e) => setContractorForm(f => ({ ...f, totalTrips: e.target.value }))} /></Field>
          <Field label="On-Time %"><input type="number" min={0} max={100} className={inputCls} value={contractorForm.onTimeRate} onChange={(e) => setContractorForm(f => ({ ...f, onTimeRate: e.target.value }))} /></Field>
          <Field label="Rating (0-5)"><input type="number" step="0.1" min={0} max={5} className={inputCls} value={contractorForm.rating} onChange={(e) => setContractorForm(f => ({ ...f, rating: e.target.value }))} /></Field>
        </div>
      </ModalSystem>

      {/* Trip Modal */}
      <ModalSystem
        isOpen={showTripModal}
        onClose={() => setShowTripModal(false)}
        onConfirm={handleSaveTrip}
        title={editingTrip ? `Edit ${editingTrip.trip_number}` : 'Record Contractor Trip'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contractor">
            <select className={inputCls} value={tripForm.contractorId} onChange={(e) => setTripForm(f => ({ ...f, contractorId: e.target.value }))}>
              <option value="">Select contractor</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.contractor_number} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className={inputCls} value={tripForm.tripDate} onChange={(e) => setTripForm(f => ({ ...f, tripDate: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={tripForm.destination} onChange={(e) => setTripForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Amount"><input type="number" step="0.01" min={0} className={inputCls} value={tripForm.amount} onChange={(e) => setTripForm(f => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={tripForm.status} onChange={(e) => setTripForm(f => ({ ...f, status: e.target.value }))}>
              {TRIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* Invoice Modal */}
      <ModalSystem
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        onConfirm={handleSaveInvoice}
        title="Submit Contractor Invoice"
        variant="form"
        size="md"
        confirmLabel={saving ? 'Submitting…' : 'Submit'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contractor">
            <select className={inputCls} value={invoiceForm.contractorId} onChange={(e) => setInvoiceForm(f => ({ ...f, contractorId: e.target.value }))}>
              <option value="">Select contractor</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.contractor_number} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Trip Count"><input type="number" min={0} className={inputCls} value={invoiceForm.tripCount} onChange={(e) => setInvoiceForm(f => ({ ...f, tripCount: e.target.value }))} /></Field>
          <Field label="Period Start"><input type="date" className={inputCls} value={invoiceForm.periodStart} onChange={(e) => setInvoiceForm(f => ({ ...f, periodStart: e.target.value }))} /></Field>
          <Field label="Period End"><input type="date" className={inputCls} value={invoiceForm.periodEnd} onChange={(e) => setInvoiceForm(f => ({ ...f, periodEnd: e.target.value }))} /></Field>
          <Field label="Amount"><input type="number" step="0.01" min={0} className={inputCls} value={invoiceForm.amount} onChange={(e) => setInvoiceForm(f => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Notes"><input className={inputCls} value={invoiceForm.notes} onChange={(e) => setInvoiceForm(f => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
        <p className="text-xs text-slate-400 mt-2">The expected amount is computed from the contractor's rate card for verification.</p>
      </ModalSystem>

      {/* Contractor Detail Modal */}
      <ModalSystem
        isOpen={showView}
        onClose={() => setShowView(false)}
        title={`${viewing?.contractor_number || ''} — ${viewing?.name || ''}`}
        variant="info"
        size="md"
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Type / Status</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.type} · <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge></p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Rating</p>
                <div className="flex items-center gap-1">{ratingStars(Number(viewing.rating))}<span className="text-xs text-slate-500 ml-1">{viewing.rating}</span></div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Contact</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.contact || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Phone / Email</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><Phone size={12} />{viewing.phone || '—'}</p>
                <p className="text-xs text-slate-500 flex items-center gap-1"><Mail size={12} />{viewing.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Contract</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatDate(viewing.contract_start)} → {formatDate(viewing.contract_end)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Rates</p>
                <p className="font-medium text-slate-900 dark:text-white">
                  {viewing.rate_structure}: {formatAmount(Number(viewing.base_rate))}
                  {Number(viewing.per_mile_rate) > 0 && ` + ${formatAmount(Number(viewing.per_mile_rate))}/mi`}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Performance</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.performance}/5 · {viewing.on_time_rate}% on-time · {viewing.total_trips} trips</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              {viewing.status === 'Pending' && (
                <button onClick={() => { handleContractorStatus(viewing, 'Active'); setShowView(false); }} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Approve</button>
              )}
              {viewing.status === 'Active' && (
                <button onClick={() => { handleContractorStatus(viewing, 'Inactive'); setShowView(false); }} disabled={saving} className={button.ghost}><AlertTriangle size={14} /> Deactivate</button>
              )}
              {viewing.status === 'Inactive' && (
                <button onClick={() => { handleContractorStatus(viewing, 'Active'); setShowView(false); }} disabled={saving} className={button.secondary}><CheckCircle2 size={14} /> Reactivate</button>
              )}
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default ContractorTaxiManagement;
