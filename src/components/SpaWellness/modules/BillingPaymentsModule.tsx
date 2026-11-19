/**
 * Billing & Payments Module
 * DB-backed spa transaction ledger (spa_transactions) with tax/service/tip
 * breakdowns, status workflow and receipt view. Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Plus,
  Search,
  Trash2,
  DollarSign,
  Receipt,
  AlertTriangle,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface BillingPaymentsModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
  onViewAppointment?: (appointmentId: string) => void;
}

type TxnStatus = 'Pending' | 'Completed' | 'Refunded' | 'Failed';

interface Transaction {
  id: string;
  guest_id: string | null;
  guest_name: string | null;
  appointment_id: string | null;
  description: string;
  amount: number;
  tax: number;
  service_charge: number;
  tip: number;
  total: number;
  payment_method: string;
  status: TxnStatus;
  transaction_date: string;
  room_number: string | null;
}

interface GuestOption { id: string; name: string; }

const PAYMENT_METHODS = [
  'Guest Folio', 'Credit/Debit Card', 'Mobile Wallet', 'Cash',
  'Corporate Billing', 'Gift Voucher', 'Membership Credit',
];
const TXN_STATUSES: TxnStatus[] = ['Pending', 'Completed', 'Refunded', 'Failed'];

const STATUS_TONE: Record<TxnStatus, StatusTone> = {
  Completed: 'success',
  Pending: 'warning',
  Refunded: 'info',
  Failed: 'danger',
};
const METHOD_TONE: Record<string, StatusTone> = {
  'Guest Folio': 'accent',
  'Credit/Debit Card': 'info',
  'Mobile Wallet': 'success',
  Cash: 'warning',
  'Corporate Billing': 'neutral',
  'Gift Voucher': 'danger',
  'Membership Credit': 'info',
};

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';
const inlineSelectCls = 'px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-spa)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

const emptyForm = {
  guest_id: '',
  appointment_id: '',
  description: '',
  amount: 0,
  tax: 0,
  service_charge: 0,
  tip: 0,
  payment_method: 'Credit/Debit Card',
  status: 'Completed' as TxnStatus,
  transaction_date: '',
  room_number: '',
};

const BillingPaymentsModule: React.FC<BillingPaymentsModuleProps> = ({
  onViewGuestProfile,
  onViewAppointment,
}) => {
  const { currentPropertyId, addNotification } = useERP();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState({ revenue: 0, pending: 0, refunded: 0, count: 0 });
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [methodFilter, setMethodFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/transactions${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json();
      setTransactions(json.transactions || []);
      if (json.summary) setSummary(json.summary);
    } catch (e: any) {
      setError(e.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchTransactions();
    fetch('/api/spa-wellness/guests', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setGuests)
      .catch(() => {});
  }, [fetchTransactions]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => transactions.filter(t => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || (t.guest_name || '').toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) ||
      (t.room_number || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
    const matchesMethod = methodFilter === 'All' || t.payment_method === methodFilter;
    return matchesSearch && matchesStatus && matchesMethod;
  }), [transactions, search, statusFilter, methodFilter]);

  const formTotal = Number(form.amount || 0) + Number(form.tax || 0) + Number(form.service_charge || 0) + Number(form.tip || 0);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchStatus = async (t: Transaction, status: TxnStatus) => {
    setActingOn(t.id);
    setTransactions(prev => prev.map(x => (x.id === t.id ? { ...x, status } : x)));
    try {
      const res = await fetch(`/api/spa-wellness/transactions/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      fetchTransactions();
    } catch (e: any) {
      setTransactions(prev => prev.map(x => (x.id === t.id ? t : x)));
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const saveTransaction = async () => {
    if (!form.description.trim()) {
      addNotification('Description is required', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/spa-wellness/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          guest_id: form.guest_id || null,
          appointment_id: form.appointment_id.trim() || null,
          description: form.description.trim(),
          amount: Number(form.amount) || 0,
          tax: Number(form.tax) || 0,
          service_charge: Number(form.service_charge) || 0,
          tip: Number(form.tip) || 0,
          payment_method: form.payment_method,
          status: form.status,
          transaction_date: form.transaction_date || undefined,
          room_number: form.room_number || null,
          propertyId: currentPropertyId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setForm({ ...emptyForm });
      addNotification('Transaction recorded', 'success', 'Spa');
      fetchTransactions();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const deleteTransaction = async (t: Transaction) => {
    setActingOn(t.id);
    try {
      const res = await fetch(`/api/spa-wellness/transactions/${t.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setTransactions(prev => prev.filter(x => x.id !== t.id));
      setDeleteTarget(null);
      addNotification(`${t.id} removed`, 'success', 'Spa');
      fetchTransactions();
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Billing & Payments"
        subtitle="Spa billing, payments and financial transactions"
        icon={Receipt}
        actions={
          <button onClick={fetchTransactions} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Revenue" value={money(summary.revenue)} icon={DollarSign} tone="success" />
        <StatCard title="Pending" value={money(summary.pending)} icon={AlertTriangle} tone={summary.pending > 0 ? 'warning' : 'neutral'} />
        <StatCard title="Refunded" value={money(summary.refunded)} icon={RotateCcw} tone="info" />
        <StatCard title="Transactions" value={summary.count} icon={Receipt} tone="accent" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search guest, description, ID, room…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            {TXN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Methods</option>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => { setForm({ ...emptyForm }); setShowForm(true); }} className={button.primary}>
            <Plus className="w-4 h-4" /> New Transaction
          </button>
        </div>
      </SectionCard>

      {/* Transactions table */}
      <SectionCard title="Transactions" subtitle={`${filtered.length} of ${transactions.length} transactions`} icon={Receipt} tone="accent" pad="none">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No transactions match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Transaction</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Guest</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Total</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition">
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-sm text-slate-900 dark:text-white">{t.id}</div>
                      {t.room_number && <div className="text-[11px] text-slate-400">Room {t.room_number}</div>}
                    </td>
                    <td className="px-4 py-3.5">
                      {t.guest_id ? (
                        <button
                          onClick={() => onViewGuestProfile?.(t.guest_id!)}
                          className="text-sm font-medium text-[var(--color-accent-spa)] hover:opacity-80 transition"
                        >
                          {t.guest_name}
                        </button>
                      ) : (
                        <span className="text-sm text-slate-500">{t.guest_name || '—'}</span>
                      )}
                      {t.appointment_id && (
                        <button
                          onClick={() => onViewAppointment?.(t.appointment_id!)}
                          className="block text-[11px] text-slate-400 hover:text-[var(--color-accent-spa)] transition"
                        >
                          {t.appointment_id}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 max-w-[220px] truncate">{t.description}</td>
                    <td className="px-4 py-3.5">
                      <Badge tone={METHOD_TONE[t.payment_method] || 'neutral'}>{t.payment_method}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(t.transaction_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3.5">
                      <select
                        value={t.status}
                        onChange={ev => patchStatus(t, ev.target.value as TxnStatus)}
                        disabled={actingOn === t.id}
                        className={`${inlineSelectCls} ${statusTone[STATUS_TONE[t.status]].soft}`}
                      >
                        {TXN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-sm text-slate-900 dark:text-white">{money(t.total)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => setReceipt(t)} title="Receipt" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Receipt className="w-4 h-4" /></button>
                        {t.status === 'Completed' && (
                          <button onClick={() => patchStatus(t, 'Refunded')} title="Refund" className="p-1.5 text-slate-400 hover:text-amber-500 transition"><RotateCcw className="w-4 h-4" /></button>
                        )}
                        <button onClick={() => setDeleteTarget(t)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── New transaction modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onConfirm={saveTransaction}
        title="New Transaction"
        subtitle="Guest, charge breakdown and payment method"
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={`Record — ${money(formTotal)}`}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Guest">
            <select className={inputCls} value={form.guest_id} onChange={e => setForm(f => ({ ...f, guest_id: e.target.value }))}>
              <option value="">Walk-in / none</option>
              {guests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
            </select>
          </Field>
          <Field label="Appointment ID (optional)">
            <input className={inputCls} value={form.appointment_id} onChange={e => setForm(f => ({ ...f, appointment_id: e.target.value }))} placeholder="APT-001" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description *">
              <input className={inputCls} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Swedish Massage (60 min)" />
            </Field>
          </div>
          <Field label="Amount ($)">
            <input type="number" min={0} step="0.01" className={inputCls} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} />
          </Field>
          <Field label="Tax ($)">
            <input type="number" min={0} step="0.01" className={inputCls} value={form.tax} onChange={e => setForm(f => ({ ...f, tax: Number(e.target.value) }))} />
          </Field>
          <Field label="Service Charge ($)">
            <input type="number" min={0} step="0.01" className={inputCls} value={form.service_charge} onChange={e => setForm(f => ({ ...f, service_charge: Number(e.target.value) }))} />
          </Field>
          <Field label="Tip ($)">
            <input type="number" min={0} step="0.01" className={inputCls} value={form.tip} onChange={e => setForm(f => ({ ...f, tip: Number(e.target.value) }))} />
          </Field>
          <Field label="Payment Method">
            <select className={inputCls} value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as TxnStatus }))}>
              {TXN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className={inputCls} value={form.transaction_date} onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))} />
          </Field>
          <Field label="Room Number">
            <input className={inputCls} value={form.room_number} onChange={e => setForm(f => ({ ...f, room_number: e.target.value }))} placeholder="305" />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Receipt modal ── */}
      <ModalSystem
        isOpen={!!receipt}
        onClose={() => setReceipt(null)}
        title={`Receipt — ${receipt?.id || ''}`}
        subtitle={receipt ? `${receipt.description} · ${new Date(receipt.transaction_date).toLocaleDateString()}` : ''}
        variant="info"
        size="sm"
      >
        {receipt && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge tone={METHOD_TONE[receipt.payment_method] || 'neutral'}>{receipt.payment_method}</Badge>
              <Badge tone={STATUS_TONE[receipt.status]}>{receipt.status}</Badge>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
              <div>Guest: <b className="text-slate-900 dark:text-white">{receipt.guest_name || 'Walk-in'}</b></div>
              {receipt.appointment_id && <div>Appointment: {receipt.appointment_id}</div>}
              {receipt.room_number && <div>Room: {receipt.room_number}</div>}
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 divide-y divide-slate-200 dark:divide-slate-700">
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-500">Subtotal</span><span className="text-slate-900 dark:text-white">{money(receipt.amount)}</span></div>
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-500">Tax</span><span className="text-slate-900 dark:text-white">{money(receipt.tax)}</span></div>
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-500">Service Charge</span><span className="text-slate-900 dark:text-white">{money(receipt.service_charge)}</span></div>
              <div className="flex justify-between px-4 py-2.5 text-sm"><span className="text-slate-500">Tip</span><span className="text-slate-900 dark:text-white">{money(receipt.tip)}</span></div>
              <div className="flex justify-between px-4 py-2.5 text-sm font-bold"><span className="text-slate-900 dark:text-white">Total</span><span className="text-[var(--color-accent-spa)]">{money(receipt.total)}</span></div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteTransaction(deleteTarget)}
        title="Delete Transaction"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete transaction <b>{deleteTarget?.id}</b> for <b>{money(deleteTarget?.total || 0)}</b>? This cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
};

export default BillingPaymentsModule;
