/**
 * Billing & Charges Module
 * Post and track concierge service charges on guest folios.
 *
 * DB-integrated: charges live in the shared folio system — folio_lines
 * tagged source_module='concierge' on Guest folios linked to real
 * reservations. Posting a charge resolves (or creates) the guest's
 * open folio and keeps its balance in sync.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Receipt,
  Plus,
  RefreshCw,
  CreditCard,
  ClipboardList,
  AlertTriangle,
  Loader2,
  Wallet,
  Banknote,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';

interface BillingChargesModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

interface Charge {
  id: string;
  folio_id: string;
  description: string;
  amount: number;
  quantity: number;
  unit_price: number;
  line_type: string;
  is_voided: boolean;
  posting_date: string;
  reservation_id: string | null;
  guest_name?: string | null;
  room_number?: string | null;
  guest_id?: string | null;
  folio_status?: string | null;
  currency?: string | null;
}

interface OverviewGuest {
  reservationId: string;
  name: string;
  roomNumber: string;
  isVIP?: boolean;
}

const FOLIO_TONE: Record<string, StatusTone> = {
  Open: 'warning',
  Closed: 'success',
};

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const BillingChargesModule: React.FC<BillingChargesModuleProps> = ({ onViewGuestProfile }) => {
  const { addNotification, formatAmount } = useERP();
  const [charges, setCharges] = useState<Charge[]>([]);
  const [guests, setGuests] = useState<OverviewGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ reservationId: '', description: '', amount: '', quantity: '1' });
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const parseJson = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Unexpected response (${response.status})`);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [chargesRes, overviewRes] = await Promise.all([
        conciergeFetch('/api/concierge/billing/charges?limit=100'),
        conciergeFetch('/api/concierge/service-center/overview'),
      ]);
      setCharges(await parseJson(chargesRes));
      const overview = await parseJson(overviewRes);
      const seen = new Set<string>();
      setGuests(
        [...(overview.inHouse || []), ...(overview.arriving || []), ...(overview.departing || [])]
          .map((g: any) => ({ reservationId: g.reservationId, name: g.name, roomNumber: g.roomNumber, isVIP: g.isVIP }))
          .filter((g: OverviewGuest) => {
            if (!g.reservationId || seen.has(g.reservationId)) return false;
            seen.add(g.reservationId);
            return true;
          })
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load charges');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stats = useMemo(() => {
    const active = charges.filter((c) => !c.is_voided);
    const open = active.filter((c) => c.folio_status === 'Open');
    const closed = active.filter((c) => c.folio_status === 'Closed');
    const total = active.reduce((s, c) => s + Number(c.amount), 0);
    return {
      outstanding: open.reduce((s, c) => s + Number(c.amount), 0),
      collected: closed.reduce((s, c) => s + Number(c.amount), 0),
      count: active.length,
      avg: active.length ? total / active.length : 0,
    };
  }, [charges]);

  const selectedGuest = guests.find((g) => g.reservationId === form.reservationId);

  const handlePostCharge = async () => {
    if (!selectedGuest) {
      setFormError('Please select a guest');
      return;
    }
    if (!form.description.trim()) {
      setFormError('Description is required');
      return;
    }
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      setFormError('Enter a valid amount');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const response = await conciergeFetch('/api/concierge/billing/charges', {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          reservation_id: selectedGuest.reservationId,
          description: form.description.trim(),
          amount,
          quantity: Number(form.quantity) || 1,
        }),
      });
      await parseJson(response);
      setShowForm(false);
      setForm({ reservationId: '', description: '', amount: '', quantity: '1' });
      addNotification(`Charge posted to ${selectedGuest.name}'s folio`, 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to post charge');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (c: Charge) => {
    if (!window.confirm(`Void "${c.description}" (${formatAmount(Number(c.amount))})? The folio balance will be reversed.`)) return;
    const reason = window.prompt('Reason for voiding (optional):') || '';
    try {
      setVoidingId(c.id);
      setError(null);
      const response = await conciergeFetch(`/api/concierge/billing/charges/${c.id}/void`, {
        method: 'POST',
        json: true,
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      await parseJson(response);
      addNotification('Charge voided', 'success', 'Concierge');
      fetchAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to void charge');
    } finally {
      setVoidingId(null);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Billing & Charges"
        subtitle="Post and track concierge service charges on guest folios"
        icon={Receipt}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchAll} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button type="button" onClick={() => { setFormError(null); setShowForm(true); }} className={button.primary}>
              <Plus size={16} />
              Post Charge
            </button>
          </div>
        }
      />

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Outstanding (Open Folios)" value={formatAmount(stats.outstanding)} icon={Wallet} tone="warning" />
        <StatCard title="Collected (Closed)" value={formatAmount(stats.collected)} icon={Banknote} tone="success" />
        <StatCard title="Total Charges" value={stats.count} icon={ClipboardList} tone="info" />
        <StatCard title="Average Charge" value={formatAmount(stats.avg)} icon={CreditCard} tone="accent" />
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Post charge form */}
      {showForm && (
        <SectionCard title="Post Charge" subtitle="Added to the guest's open folio" icon={Plus} tone="accent" pad="md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className={labelClass}>Guest</label>
              <select
                value={form.reservationId}
                onChange={(e) => setForm({ ...form, reservationId: e.target.value })}
                className={inputClass}
                disabled={loading}
              >
                <option value="">{loading ? 'Loading guests…' : 'Select guest…'}</option>
                {guests.map((g) => (
                  <option key={g.reservationId} value={g.reservationId}>
                    {g.name} — Room {g.roomNumber}{g.isVIP ? ' (VIP)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className={labelClass}>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputClass}
                placeholder="e.g. Airport transfer — executive sedan"
              />
            </div>
            <div>
              <label className={labelClass}>Unit Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className={labelClass}>Quantity</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          {formError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={14} />
              {formError}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Total: <span className="font-bold text-indigo-600 dark:text-indigo-400">{formatAmount((Number(form.amount) || 0) * (Number(form.quantity) || 1))}</span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className={button.secondary}>
                Cancel
              </button>
              <button type="button" onClick={handlePostCharge} disabled={submitting || loading} className={button.primary}>
                {submitting ? 'Posting…' : 'Post Charge'}
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Charges table */}
      <SectionCard title="Concierge Charges" subtitle={`${charges.length} charge${charges.length === 1 ? '' : 's'} posted`} icon={Receipt} tone="info" pad="none">
        {loading && charges.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : charges.length === 0 ? (
          <div className="py-12 text-center">
            <Receipt size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No charges posted yet</p>
            <p className="mt-1 text-xs text-slate-400">Post a charge to a guest folio above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Guest</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Room</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Charge</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Folio</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Posted</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {charges.map((c) => (
                  <tr key={c.id} className={`transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${c.is_voided ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => c.guest_id && onViewGuestProfile?.(c.guest_id)}
                        className={`text-sm font-medium ${c.guest_id ? 'text-indigo-600 hover:underline dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}
                      >
                        {c.guest_name || '—'}
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      {c.room_number ? (
                        <span className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                          {c.room_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="max-w-md px-5 py-3.5">
                      <div className="truncate text-sm text-slate-700 dark:text-slate-300">
                        {c.description}
                        {c.is_voided && <Badge tone="danger">Voided</Badge>}
                      </div>
                      {Number(c.quantity) > 1 && (
                        <div className="text-xs text-slate-400">
                          {Number(c.quantity)} × {formatAmount(Number(c.unit_price))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {formatAmount(Number(c.amount))}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {c.folio_status ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${statusTone[FOLIO_TONE[c.folio_status] || 'neutral'].dot}`} />
                          <Badge tone={FOLIO_TONE[c.folio_status] || 'neutral'}>{c.folio_status}</Badge>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">{timeAgo(c.posting_date)}</td>
                    <td className="px-5 py-3.5 text-right">
                      {!c.is_voided && (
                        <button
                          type="button"
                          onClick={() => handleVoid(c)}
                          disabled={voidingId === c.id}
                          className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                        >
                          {voidingId === c.id ? 'Voiding…' : 'Void'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default BillingChargesModule;
