/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Corporate Transportation — corporate billing contracts and contract-linked trips.
 * DB-integrated via /api/transport/corporate/*.
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Briefcase,
  Building2,
  Search,
  Calendar,
  MapPin,
  Users,
  Car,
  Plus,
  Eye,
  Pencil,
  Trash2,
  DollarSign,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Contract {
  id: string;
  contract_number: string;
  company: string;
  contact: string;
  email: string | null;
  phone: string | null;
  type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  monthly_volume: number;
  rate_type: string;
  standard_rate: number;
  billing_cycle: string;
  credit_limit: number;
  current_balance: number;
}

interface CorporateTrip {
  id: string;
  trip_number: string;
  contract_id: string | null;
  company: string | null;
  guest_name: string;
  type: string | null;
  pickup: string;
  destination: string;
  scheduled_time: string;
  assigned_vehicle: string | null;
  driver_id: string | null;
  passenger_count: number;
  status: string;
  amount: number | null;
  billed_to: string | null;
  transport_corporate_contracts: { contract_number: string; company: string } | null;
  transport_drivers: { id: string; employees: { name: string } | null } | null;
}

interface Driver {
  id: string;
  assigned_vehicle: string | null;
  employees: { name: string } | null;
}

interface CorporateInvoice {
  id: string;
  invoice_number: string;
  contract_id: string | null;
  company: string | null;
  period_start: string;
  period_end: string;
  charge_count: number;
  total_amount: number;
  status: string;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  transport_corporate_contracts: { contract_number: string; company: string } | null;
}

const CONTRACT_TYPES = ['Executive Transfer', 'Business Meetings', 'Airport Transfers'];
const CONTRACT_STATUSES = ['Active', 'Pending', 'Expired', 'Cancelled'];
const RATE_TYPES = ['Fixed Rate', 'Distance-Based', 'Time-Based', 'Package Rate'];
const BILLING_CYCLES = ['Monthly', 'Weekly', 'Per Trip'];
const TRIP_STATUSES = ['Requested', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'];
const INVOICE_STATUSES = ['Draft', 'Issued', 'Paid', 'Overdue', 'Cancelled'];

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

function contractTone(status: string): StatusTone {
  switch (status) {
    case 'Active': return 'success';
    case 'Pending': return 'warning';
    case 'Expired': case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

function tripTone(status: string): StatusTone {
  switch (status) {
    case 'Completed': return 'success';
    case 'Cancelled': return 'danger';
    case 'In Progress': return 'accent';
    case 'Confirmed': return 'info';
    default: return 'warning';
  }
}

function invoiceTone(status: string): StatusTone {
  switch (status) {
    case 'Paid': return 'success';
    case 'Issued': return 'info';
    case 'Overdue': return 'danger';
    case 'Cancelled': return 'neutral';
    default: return 'warning';
  }
}

function formatTime(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts?: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyContractForm = {
  company: '', contact: '', email: '', phone: '', type: 'Executive Transfer',
  status: 'Pending', startDate: '', endDate: '', monthlyVolume: 0,
  rateType: 'Fixed Rate', standardRate: 0, billingCycle: 'Monthly',
  creditLimit: 0, currentBalance: 0,
};

const emptyTripForm = {
  contractId: '', guestName: '', type: '', pickup: '', destination: '',
  scheduledTime: '', assignedVehicle: '', driverId: '', passengerCount: 1,
  status: 'Confirmed', amount: '',
};

const emptyInvoiceForm = { contractId: '', periodStart: '', periodEnd: '', dueDate: '', notes: '' };

const CorporateTransportation = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [trips, setTrips] = useState<CorporateTrip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [invoices, setInvoices] = useState<CorporateInvoice[]>([]);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [contractModal, setContractModal] = useState(false);
  const [tripModal, setTripModal] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingTrip, setViewingTrip] = useState<CorporateTrip | null>(null);
  const [contractForm, setContractForm] = useState({ ...emptyContractForm });
  const [tripForm, setTripForm] = useState({ ...emptyTripForm });
  const [invoiceForm, setInvoiceForm] = useState({ ...emptyInvoiceForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [cRes, dRes, iRes] = await Promise.all([
        fetch(`/api/transport/corporate/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/corporate/${currentPropertyId}/invoices`, { headers: authHeaders() }),
      ]);
      if (cRes.ok) {
        const data = (await cRes.json()) as { contracts: Contract[]; trips: CorporateTrip[] };
        setContracts(data.contracts || []);
        setTrips(data.trips || []);
      }
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
      if (iRes.ok) setInvoices(((await iRes.json()) as { invoices: CorporateInvoice[] }).invoices || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filteredContracts = useMemo(() => {
    let list = contracts;
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((c) =>
      c.company.toLowerCase().includes(q) ||
      c.contact.toLowerCase().includes(q) ||
      c.contract_number.toLowerCase().includes(q)
    );
  }, [contracts, search, statusFilter]);

  const stats = useMemo(() => {
    const now = new Date();
    return {
      active: contracts.filter((c) => c.status === 'Active').length,
      monthlyRevenue: contracts.filter((c) => c.status === 'Active')
        .reduce((s, c) => s + c.monthly_volume * c.standard_rate, 0),
      tripsThisMonth: trips.filter((t) => {
        const d = new Date(t.scheduled_time);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      pending: contracts.filter((c) => c.status === 'Pending').length,
    };
  }, [contracts, trips]);

  const openContractCreate = () => {
    setEditingId(null);
    setContractForm({ ...emptyContractForm });
    setContractModal(true);
  };

  const openContractEdit = (c: Contract) => {
    setEditingId(c.id);
    setContractForm({
      company: c.company, contact: c.contact, email: c.email || '', phone: c.phone || '',
      type: c.type, status: c.status,
      startDate: c.start_date || '', endDate: c.end_date || '',
      monthlyVolume: c.monthly_volume, rateType: c.rate_type, standardRate: c.standard_rate,
      billingCycle: c.billing_cycle, creditLimit: c.credit_limit, currentBalance: c.current_balance,
    });
    setContractModal(true);
  };

  const openTripCreate = () => {
    setEditingId(null);
    setTripForm({ ...emptyTripForm, contractId: contracts[0]?.id || '' });
    setTripModal(true);
  };

  const handleContractSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/transport/corporate/contracts/${editingId}` : '/api/transport/corporate/contracts';
      const res = await fetch(endpoint, {
        method: editingId ? 'PUT' : 'POST', headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, ...contractForm }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Contract updated' : 'Contract created', 'success', 'Transportation');
      setContractModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleTripSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const contract = contracts.find((c) => c.id === tripForm.contractId);
      const endpoint = editingId ? `/api/transport/corporate/trips/${editingId}` : '/api/transport/corporate/trips';
      const body = {
        propertyId: currentPropertyId,
        contractId: tripForm.contractId || null,
        company: contract?.company || null,
        guestName: tripForm.guestName,
        type: tripForm.type || null,
        pickup: tripForm.pickup,
        destination: tripForm.destination,
        scheduledTime: tripForm.scheduledTime ? new Date(tripForm.scheduledTime).toISOString() : null,
        assignedVehicle: tripForm.assignedVehicle || null,
        driverId: tripForm.driverId || null,
        passengerCount: tripForm.passengerCount,
        status: tripForm.status,
        amount: tripForm.amount === '' ? null : Number(tripForm.amount),
        billedTo: 'Corporate Account',
      };
      const res = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingId ? 'Trip updated' : 'Trip created', 'success', 'Transportation');
      setTripModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleTripStatus = async (t: CorporateTrip, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/corporate/trips/${t.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Trip ${status.toLowerCase()}`, 'success', 'Transportation');
      setViewingTrip(null); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const openInvoiceGenerate = (contractId?: string) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    setInvoiceForm({ ...emptyInvoiceForm, contractId: contractId || contracts[0]?.id || '', periodStart: start, periodEnd: end });
    setInvoiceModal(true);
  };

  const handleGenerateInvoice = async () => {
    if (!currentPropertyId || !invoiceForm.contractId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/corporate/contracts/${invoiceForm.contractId}/generate-invoice`, {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          periodStart: invoiceForm.periodStart,
          periodEnd: invoiceForm.periodEnd,
          dueDate: invoiceForm.dueDate || null,
          notes: invoiceForm.notes || null,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Invoice generated', 'success', 'Transportation');
      setInvoiceModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleInvoiceStatus = async (inv: CorporateInvoice, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/corporate/invoices/${inv.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Invoice ${status.toLowerCase()}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (kind: 'contracts' | 'trips', id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/corporate/${kind}/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Corporate Transportation" subtitle="Corporate contracts and business transportation" icon={Briefcase} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Briefcase className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view contracts.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Corporate Transportation"
        subtitle="Corporate contracts and business transportation"
        icon={Briefcase}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => openInvoiceGenerate()} className={button.secondary}><DollarSign className="w-4 h-4" /> Generate Invoice</button>
            <button onClick={openTripCreate} className={button.secondary}><Car className="w-4 h-4" /> New Trip</button>
            <button onClick={openContractCreate} className={button.primary}><Plus className="w-4 h-4" /> New Contract</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Active Contracts" value={String(stats.active)} icon={Building2} tone="accent" />
        <StatCard title="Monthly Contracted" value={formatAmount(stats.monthlyRevenue)} icon={DollarSign} tone="success" />
        <StatCard title="Trips This Month" value={String(stats.tripsThisMonth)} icon={Car} tone="info" />
        <StatCard title="Pending Approval" value={String(stats.pending)} icon={Briefcase} tone="warning" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input type="text" placeholder="Search by company, contact, or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
          <option value="all">All Status</option>
          {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Corporate Contracts */}
        <SectionCard title="Corporate Contracts" subtitle="Billing accounts and rate agreements" icon={Building2} tone="accent" pad="none">
          <div className="p-5 space-y-4">
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
              : filteredContracts.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No contracts found.</p>
              : filteredContracts.map((c) => (
                <div key={c.id} className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700/50">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500">{c.contract_number}</span>
                        <Badge tone={contractTone(c.status)}>{c.status}</Badge>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{c.company}</p>
                      <p className="text-xs text-slate-500">{c.type}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{formatAmount(c.standard_rate)}</p>
                      <p className="text-xs text-slate-500">{c.rate_type}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400 mb-3">
                    <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5" />{c.contact}</div>
                    <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5" />{c.billing_cycle}</div>
                    <div className="flex items-center gap-2"><Car className="w-3.5 h-3.5" />{c.monthly_volume}/month</div>
                    <div className="flex items-center gap-2"><DollarSign className="w-3.5 h-3.5" />Limit: {formatAmount(c.credit_limit)}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="text-slate-500">Balance: </span>
                      <span className="font-semibold text-slate-900 dark:text-white">{formatAmount(c.current_balance)}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openInvoiceGenerate(c.id)} title="Generate invoice" className="p-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition"><DollarSign size={14} className="text-emerald-500" /></button>
                      <button onClick={() => openContractEdit(c)} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                      <button onClick={() => handleDelete('contracts', c.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>

        {/* Recent Corporate Trips */}
        <SectionCard title="Corporate Trips" subtitle="Contract-billed trips" icon={Car} tone="info" pad="none">
          <div className="p-5 space-y-3">
            {loading ? <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
              : trips.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No corporate trips.</p>
              : trips.map((t) => (
                <div key={t.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700/50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500">{t.trip_number}</span>
                        <Badge tone={tripTone(t.status)}>{t.status}</Badge>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{t.company || t.transport_corporate_contracts?.company || '—'}</p>
                      <p className="text-xs text-slate-500">{t.guest_name}{t.type ? ` — ${t.type}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{t.amount !== null ? formatAmount(t.amount) : '—'}</p>
                      <p className="text-xs text-slate-500">{t.billed_to || 'Corporate Account'}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{t.pickup} → {t.destination}</div>
                    <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(t.scheduled_time)}</div>
                    <div className="flex items-center gap-1"><Car className="w-3 h-3" />{t.assigned_vehicle || 'Unassigned'} {t.transport_drivers?.employees?.name ? `• ${t.transport_drivers.employees.name}` : ''}</div>
                    <div className="flex items-center gap-1"><Users className="w-3 h-3" />{t.passenger_count} passengers</div>
                  </div>
                  <div className="flex justify-end gap-1 mt-2">
                    <button onClick={() => setViewingTrip(t)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"><Eye size={13} className="text-slate-400" /></button>
                    <button onClick={() => handleDelete('trips', t.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={13} className="text-rose-400" /></button>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      </div>

      {/* Corporate Invoices */}
      <SectionCard title="Corporate Invoices" subtitle="Periodic billing generated from unbilled Corporate Account charges" icon={DollarSign} tone="success" pad="none">
        <div className="p-5 space-y-3">
          <div className="flex justify-end">
            <select className={filterSelectCls} value={invoiceStatusFilter} onChange={(e) => setInvoiceStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {(invoiceStatusFilter === 'all' ? invoices : invoices.filter((i) => i.status === invoiceStatusFilter)).length === 0 && !loading ? (
            <p className="text-sm text-slate-400 text-center py-8">No invoices yet — generate one from a contract.</p>
          ) : (invoiceStatusFilter === 'all' ? invoices : invoices.filter((i) => i.status === invoiceStatusFilter)).map((inv) => (
            <div key={inv.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-700/50">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">{inv.invoice_number}</span>
                    <Badge tone={invoiceTone(inv.status)}>{inv.status}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{inv.company || inv.transport_corporate_contracts?.company || '—'}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(inv.period_start)} → {formatDate(inv.period_end)} · {inv.charge_count} charge(s)
                    {inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ''}
                  </p>
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{formatAmount(Number(inv.total_amount))}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {inv.status === 'Issued' && (
                  <>
                    <button onClick={() => handleInvoiceStatus(inv, 'Paid')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-200 transition">Mark Paid</button>
                    <button onClick={() => handleInvoiceStatus(inv, 'Overdue')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 hover:bg-amber-200 transition">Overdue</button>
                  </>
                )}
                {['Issued', 'Overdue'].includes(inv.status) && (
                  <button onClick={() => handleInvoiceStatus(inv, 'Cancelled')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 transition">Cancel</button>
                )}
                {inv.status === 'Overdue' && (
                  <button onClick={() => handleInvoiceStatus(inv, 'Paid')} disabled={saving} className="px-2 py-1 text-xs rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-200 transition">Mark Paid</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Contract Create / Edit Modal */}
      <ModalSystem
        isOpen={contractModal}
        onClose={() => setContractModal(false)}
        onConfirm={handleContractSave}
        title={editingId ? 'Edit Contract' : 'New Corporate Contract'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company"><input className={inputCls} value={contractForm.company} onChange={(e) => setContractForm(f => ({ ...f, company: e.target.value }))} /></Field>
          <Field label="Contact"><input className={inputCls} value={contractForm.contact} onChange={(e) => setContractForm(f => ({ ...f, contact: e.target.value }))} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={contractForm.email} onChange={(e) => setContractForm(f => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Phone"><input className={inputCls} value={contractForm.phone} onChange={(e) => setContractForm(f => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Type">
            <select className={inputCls} value={contractForm.type} onChange={(e) => setContractForm(f => ({ ...f, type: e.target.value }))}>
              {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={contractForm.status} onChange={(e) => setContractForm(f => ({ ...f, status: e.target.value }))}>
              {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Start Date"><input type="date" className={inputCls} value={contractForm.startDate} onChange={(e) => setContractForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
          <Field label="End Date"><input type="date" className={inputCls} value={contractForm.endDate} onChange={(e) => setContractForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
          <Field label="Monthly Volume"><input type="number" min={0} className={inputCls} value={contractForm.monthlyVolume} onChange={(e) => setContractForm(f => ({ ...f, monthlyVolume: Number(e.target.value) }))} /></Field>
          <Field label="Rate Type">
            <select className={inputCls} value={contractForm.rateType} onChange={(e) => setContractForm(f => ({ ...f, rateType: e.target.value }))}>
              {RATE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Standard Rate"><input type="number" min={0} step="0.01" className={inputCls} value={contractForm.standardRate} onChange={(e) => setContractForm(f => ({ ...f, standardRate: Number(e.target.value) }))} /></Field>
          <Field label="Billing Cycle">
            <select className={inputCls} value={contractForm.billingCycle} onChange={(e) => setContractForm(f => ({ ...f, billingCycle: e.target.value }))}>
              {BILLING_CYCLES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Credit Limit"><input type="number" min={0} step="0.01" className={inputCls} value={contractForm.creditLimit} onChange={(e) => setContractForm(f => ({ ...f, creditLimit: Number(e.target.value) }))} /></Field>
          <Field label="Current Balance"><input type="number" min={0} step="0.01" className={inputCls} value={contractForm.currentBalance} onChange={(e) => setContractForm(f => ({ ...f, currentBalance: Number(e.target.value) }))} /></Field>
        </div>
      </ModalSystem>

      {/* Trip Create / Edit Modal */}
      <ModalSystem
        isOpen={tripModal}
        onClose={() => setTripModal(false)}
        onConfirm={handleTripSave}
        title="New Corporate Trip"
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contract">
            <select className={inputCls} value={tripForm.contractId} onChange={(e) => setTripForm(f => ({ ...f, contractId: e.target.value }))}>
              <option value="">No contract</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number} — {c.company}</option>)}
            </select>
          </Field>
          <Field label="Guest / Party"><input className={inputCls} value={tripForm.guestName} onChange={(e) => setTripForm(f => ({ ...f, guestName: e.target.value }))} placeholder="e.g. Executive Team" /></Field>
          <Field label="Type"><input className={inputCls} value={tripForm.type} onChange={(e) => setTripForm(f => ({ ...f, type: e.target.value }))} placeholder="e.g. Executive Transfer" /></Field>
          <Field label="Scheduled"><input type="datetime-local" className={inputCls} value={tripForm.scheduledTime} onChange={(e) => setTripForm(f => ({ ...f, scheduledTime: e.target.value }))} /></Field>
          <Field label="Pickup"><input className={inputCls} value={tripForm.pickup} onChange={(e) => setTripForm(f => ({ ...f, pickup: e.target.value }))} /></Field>
          <Field label="Destination"><input className={inputCls} value={tripForm.destination} onChange={(e) => setTripForm(f => ({ ...f, destination: e.target.value }))} /></Field>
          <Field label="Driver">
            <select className={inputCls} value={tripForm.driverId} onChange={(e) => {
              const d = drivers.find((x) => x.id === e.target.value);
              setTripForm(f => ({ ...f, driverId: e.target.value, assignedVehicle: d?.assigned_vehicle || f.assignedVehicle }));
            }}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Vehicle"><input className={inputCls} value={tripForm.assignedVehicle} onChange={(e) => setTripForm(f => ({ ...f, assignedVehicle: e.target.value }))} /></Field>
          <Field label="Passengers"><input type="number" min={1} className={inputCls} value={tripForm.passengerCount} onChange={(e) => setTripForm(f => ({ ...f, passengerCount: Number(e.target.value) }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={tripForm.status} onChange={(e) => setTripForm(f => ({ ...f, status: e.target.value }))}>
              {TRIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Amount"><input type="number" min={0} step="0.01" className={inputCls} value={tripForm.amount} onChange={(e) => setTripForm(f => ({ ...f, amount: e.target.value }))} /></Field>
        </div>
      </ModalSystem>

      {/* Generate Invoice Modal */}
      <ModalSystem
        isOpen={invoiceModal}
        onClose={() => setInvoiceModal(false)}
        onConfirm={handleGenerateInvoice}
        title="Generate Corporate Invoice"
        variant="form"
        size="md"
        confirmLabel={saving ? 'Generating…' : 'Generate'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contract">
            <select className={inputCls} value={invoiceForm.contractId} onChange={(e) => setInvoiceForm(f => ({ ...f, contractId: e.target.value }))}>
              <option value="">Select contract</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number} — {c.company}</option>)}
            </select>
          </Field>
          <Field label="Due Date"><input type="date" className={inputCls} value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))} /></Field>
          <Field label="Period Start"><input type="date" className={inputCls} value={invoiceForm.periodStart} onChange={(e) => setInvoiceForm(f => ({ ...f, periodStart: e.target.value }))} /></Field>
          <Field label="Period End"><input type="date" className={inputCls} value={invoiceForm.periodEnd} onChange={(e) => setInvoiceForm(f => ({ ...f, periodEnd: e.target.value }))} /></Field>
          <Field label="Notes"><input className={inputCls} value={invoiceForm.notes} onChange={(e) => setInvoiceForm(f => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
        <p className="text-xs text-slate-400 mt-2">All unbilled Corporate Account charges for the contract's trips in this period are rolled into the invoice and marked Posted.</p>
      </ModalSystem>

      {/* Trip Detail Modal */}
      <ModalSystem
        isOpen={!!viewingTrip}
        onClose={() => setViewingTrip(null)}
        title={viewingTrip ? `Trip ${viewingTrip.trip_number}` : ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewingTrip && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{viewingTrip.company || '—'}</p>
                <p className="text-xs text-slate-500">{viewingTrip.guest_name}{viewingTrip.type ? ` • ${viewingTrip.type}` : ''}</p>
              </div>
              <Badge tone={tripTone(viewingTrip.status)}>{viewingTrip.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin size={14} />{viewingTrip.pickup} → {viewingTrip.destination}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Clock size={14} />{formatTime(viewingTrip.scheduled_time)} — {formatDate(viewingTrip.scheduled_time)}</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Users size={14} />{viewingTrip.passenger_count} passengers</div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Car size={14} />{viewingTrip.transport_drivers?.employees?.name || 'No driver'} {viewingTrip.assigned_vehicle ? `• ${viewingTrip.assigned_vehicle}` : ''}</div>
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">Billed to {viewingTrip.billed_to || 'Corporate Account'}</span>
              <span className="font-semibold text-slate-900 dark:text-white">{viewingTrip.amount !== null ? formatAmount(viewingTrip.amount) : '—'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {viewingTrip.status === 'Requested' && <button onClick={() => handleTripStatus(viewingTrip, 'Confirmed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Confirm</button>}
              {viewingTrip.status === 'Confirmed' && <button onClick={() => handleTripStatus(viewingTrip, 'In Progress')} disabled={saving} className={button.primary}><Car size={14} /> Start</button>}
              {viewingTrip.status === 'In Progress' && <button onClick={() => handleTripStatus(viewingTrip, 'Completed')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Complete</button>}
              {!['Completed', 'Cancelled'].includes(viewingTrip.status) && <button onClick={() => handleTripStatus(viewingTrip, 'Cancelled')} disabled={saving} className={button.secondary}>Cancel</button>}
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default CorporateTransportation;
