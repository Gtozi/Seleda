/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Billing & Charges — trip billing, charges, and payment processing.
 * DB-integrated via /api/transport/billing/* (transport_billing_charges).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DollarSign,
  Search,
  Plus,
  Eye,
  Pencil,
  Trash2,
  Download,
  FileText,
  CreditCard,
  Building2,
  User,
  Calendar,
  Loader2,
  RefreshCw,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface Charge {
  id: string;
  charge_number: string;
  trip_id: string | null;
  guest_name: string | null;
  room: string | null;
  type: string | null;
  billing_type: string;
  amount: number;
  status: string;
  charge_date: string;
  payment_method: string | null;
  reference: string | null;
  transport_requests: { request_number: string; guest_name: string | null; room: string | null; type: string | null } | null;
}

interface Trip { id: string; request_number: string; guest_name: string | null; room: string | null; type: string | null; amount: number | null; payment_method: string | null; }

const BILLING_TYPES = ['Guest Folio', 'Corporate Account', 'Event Master Account', 'Internal Cost Center'];
const CHARGE_STATUSES = ['Pending', 'Posted', 'Failed', 'Refunded'];
const PAYMENT_METHODS = ['Room Charge', 'Credit Card', 'Cash', 'Corporate Credit', 'Internal Transfer'];

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
    case 'Posted': return 'success';
    case 'Pending': return 'warning';
    case 'Failed': return 'danger';
    case 'Refunded': return 'neutral';
    default: return 'neutral';
  }
}

function BillingIcon({ type }: { type: string }) {
  switch (type) {
    case 'Guest Folio': return <User className="w-4 h-4" />;
    case 'Corporate Account': return <Building2 className="w-4 h-4" />;
    case 'Event Master Account': return <FileText className="w-4 h-4" />;
    case 'Internal Cost Center': return <Building2 className="w-4 h-4" />;
    default: return <CreditCard className="w-4 h-4" />;
  }
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyForm = {
  tripId: '', guestName: '', room: '', type: '', billingType: 'Guest Folio',
  amount: '', status: 'Pending', chargeDate: '', paymentMethod: 'Room Charge', reference: '',
};

const BillingCharges = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [charges, setCharges] = useState<Charge[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showView, setShowView] = useState(false);
  const [editing, setEditing] = useState<Charge | null>(null);
  const [viewing, setViewing] = useState<Charge | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [cRes, tRes] = await Promise.all([
        fetch(`/api/transport/billing/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/requests/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (cRes.ok) setCharges(((await cRes.json()) as { charges: Charge[] }).charges || []);
      if (tRes.ok) setTrips(((await tRes.json()) as { requests: Trip[] }).requests || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filtered = useMemo(() => {
    let list = charges;
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter);
    if (typeFilter !== 'all') list = list.filter((c) => c.billing_type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        (c.guest_name || '').toLowerCase().includes(q) ||
        (c.room || '').toLowerCase().includes(q) ||
        c.charge_number.toLowerCase().includes(q) ||
        (c.reference || '').toLowerCase().includes(q) ||
        (c.transport_requests?.request_number || '').toLowerCase().includes(q));
    }
    return list;
  }, [charges, statusFilter, typeFilter, search]);

  const stats = useMemo(() => ({
    total: charges.reduce((s, c) => s + Number(c.amount), 0),
    posted: charges.filter((c) => c.status === 'Posted').reduce((s, c) => s + Number(c.amount), 0),
    pending: charges.filter((c) => c.status === 'Pending').reduce((s, c) => s + Number(c.amount), 0),
    folio: charges.filter((c) => c.billing_type === 'Guest Folio').length,
  }), [charges]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, chargeDate: new Date().toISOString().slice(0, 10) });
    setShowModal(true);
  };

  const openEdit = (c: Charge) => {
    setEditing(c);
    setForm({
      tripId: c.trip_id || '',
      guestName: c.guest_name || '',
      room: c.room || '',
      type: c.type || '',
      billingType: c.billing_type,
      amount: String(c.amount),
      status: c.status,
      chargeDate: c.charge_date || '',
      paymentMethod: c.payment_method || 'Room Charge',
      reference: c.reference || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editing ? `/api/transport/billing/${editing.id}` : '/api/transport/billing/';
      const body = {
        propertyId: currentPropertyId,
        tripId: form.tripId || null,
        guestName: form.guestName || null,
        room: form.room || null,
        type: form.type || null,
        billingType: form.billingType,
        amount: Number(form.amount) || 0,
        status: form.status,
        chargeDate: form.chargeDate || null,
        paymentMethod: form.paymentMethod || null,
        reference: form.reference || null,
      };
      const res = await fetch(endpoint, { method: editing ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editing ? 'Charge updated' : 'Charge created', 'success', 'Transportation');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleStatus = async (c: Charge, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/billing/${c.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Charge ${status.toLowerCase()}`, 'success', 'Transportation');
      setShowView(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this charge?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/billing/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Charge deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleExport = () => {
    const header = 'Charge ID,Trip,Guest,Room,Type,Billing Type,Amount,Payment Method,Date,Status,Reference';
    const rows = filtered.map((c) => [
      c.charge_number,
      c.transport_requests?.request_number || '',
      `"${(c.guest_name || '').replace(/"/g, '""')}"`,
      c.room || '',
      `"${(c.type || '').replace(/"/g, '""')}"`,
      c.billing_type,
      Number(c.amount).toFixed(2),
      c.payment_method || '',
      c.charge_date,
      c.status,
      c.reference || '',
    ].join(','));
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transport-charges-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification(`Exported ${filtered.length} charge(s)`, 'success', 'Transportation');
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Billing & Charges" subtitle="Trip billing, charges, and payment processing" icon={DollarSign} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><DollarSign className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view charges.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Billing & Charges"
        subtitle="Trip billing, charges, and payment processing"
        icon={DollarSign}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> Manual Charge</button>
            <button onClick={handleExport} className={button.secondary}><Download className="w-4 h-4" /> Export</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Revenue" value={formatAmount(stats.total)} icon={DollarSign} tone="accent" />
        <StatCard title="Posted" value={formatAmount(stats.posted)} icon={FileText} tone="success" />
        <StatCard title="Pending" value={formatAmount(stats.pending)} icon={Calendar} tone="warning" />
        <StatCard title="Guest Folio" value={String(stats.folio)} icon={User} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            placeholder="Search by guest, room, ID, or reference..."
            className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={filterSelectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          {CHARGE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={filterSelectCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All Billing Types</option>
          {BILLING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Charges Table */}
      <SectionCard pad="none">
        <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Charges</h3></div>
        {loading && charges.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><DollarSign className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No charges found.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Charge ID</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Guest</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Billing Type</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Amount</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Payment Method</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Date</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500">Status</th>
                  <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{c.charge_number}</p>
                      {c.transport_requests && <p className="text-xs text-slate-400">{c.transport_requests.request_number}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{c.guest_name || '—'}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{c.room ? `Room ${c.room}` : 'No room'}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{c.type || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1 bg-indigo-100 dark:bg-indigo-900 rounded text-indigo-600 dark:text-indigo-400"><BillingIcon type={c.billing_type} /></div>
                        <span className="text-sm text-slate-900 dark:text-white">{c.billing_type}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">{formatAmount(Number(c.amount))}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{c.payment_method || '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{formatDate(c.charge_date)}</td>
                    <td className="px-6 py-4"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => { setViewing(c); setShowView(true); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Eye size={14} className="text-slate-400" /></button>
                        <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"><Pencil size={14} className="text-slate-400" /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
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
        title={editing ? `Edit ${editing.charge_number}` : 'Manual Charge'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Linked Trip">
            <select className={inputCls} value={form.tripId} onChange={(e) => {
              const t = trips.find((x) => x.id === e.target.value);
              setForm(f => ({
                ...f,
                tripId: e.target.value,
                guestName: t?.guest_name || f.guestName,
                room: t?.room || f.room,
                type: t?.type || f.type,
                amount: t?.amount != null && !f.amount ? String(t.amount) : f.amount,
              }));
            }}>
              <option value="">No linked trip</option>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.request_number} · {t.guest_name || 'Guest'}</option>)}
            </select>
          </Field>
          <Field label="Guest / Account"><input className={inputCls} value={form.guestName} onChange={(e) => setForm(f => ({ ...f, guestName: e.target.value }))} /></Field>
          <Field label="Room"><input className={inputCls} value={form.room} onChange={(e) => setForm(f => ({ ...f, room: e.target.value }))} /></Field>
          <Field label="Type"><input className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))} placeholder="e.g. Airport Pickup" /></Field>
          <Field label="Billing Type">
            <select className={inputCls} value={form.billingType} onChange={(e) => setForm(f => ({ ...f, billingType: e.target.value }))}>
              {BILLING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Amount"><input type="number" step="0.01" min={0} className={inputCls} value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Payment Method">
            <select className={inputCls} value={form.paymentMethod} onChange={(e) => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
              {CHARGE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className={inputCls} value={form.chargeDate} onChange={(e) => setForm(f => ({ ...f, chargeDate: e.target.value }))} /></Field>
          <Field label="Reference"><input className={inputCls} value={form.reference} onChange={(e) => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="e.g. FOLIO-302-001" /></Field>
        </div>
      </ModalSystem>

      {/* View Modal */}
      <ModalSystem
        isOpen={showView}
        onClose={() => setShowView(false)}
        title={`Charge ${viewing?.charge_number || ''}`}
        variant="info"
        size="md"
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Guest</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.guest_name || '—'}{viewing.room ? ` · Room ${viewing.room}` : ''}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Status</p>
                <Badge tone={statusTone(viewing.status)}>{viewing.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Trip</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.transport_requests?.request_number || '—'}{viewing.type ? ` · ${viewing.type}` : ''}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Amount</p>
                <p className="text-lg font-bold text-slate-900 dark:text-white">{formatAmount(Number(viewing.amount))}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Billing Type</p>
                <p className="font-medium text-slate-900 dark:text-white flex items-center gap-1"><BillingIcon type={viewing.billing_type} /> {viewing.billing_type}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Payment Method</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.payment_method || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Date</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatDate(viewing.charge_date)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Reference</p>
                <p className="font-medium text-slate-900 dark:text-white">{viewing.reference || '—'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              {viewing.status === 'Pending' && (
                <button onClick={() => handleStatus(viewing, 'Posted')} disabled={saving} className={button.primary}><CheckCircle2 size={14} /> Post</button>
              )}
              {viewing.status === 'Pending' && (
                <button onClick={() => handleStatus(viewing, 'Failed')} disabled={saving} className={button.ghost}><RotateCcw size={14} /> Mark Failed</button>
              )}
              {viewing.status === 'Posted' && (
                <button onClick={() => handleStatus(viewing, 'Refunded')} disabled={saving} className={button.secondary}><RotateCcw size={14} /> Refund</button>
              )}
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default BillingCharges;
