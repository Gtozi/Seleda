/**
 * Gift Cards & Vouchers Module
 * DB-backed spa gift cards, treatment vouchers and promotional coupons
 * (spa_gift_cards) with balance redemption. Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  CreditCard,
  Plus,
  Search,
  Pencil,
  Trash2,
  Calendar,
  Gift,
  Tag,
  Loader2,
  RefreshCw,
  TicketCheck,
  Wallet,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface GiftCardsVouchersModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
}

type CardStatus = 'Active' | 'Redeemed' | 'Expired' | 'Suspended';

interface GiftCard {
  id: string;
  card_type: string;
  code: string;
  value: number;
  remaining_balance: number;
  status: CardStatus;
  purchaser_id: string | null;
  purchaser_name: string | null;
  recipient_id: string | null;
  recipient_name: string | null;
  issue_date: string;
  expiry_date: string | null;
  applicable_treatments: string[];
  notes: string | null;
}

interface GuestOption { id: string; name: string; }

const CARD_TYPES = ['Spa Gift Card', 'Treatment Voucher', 'Promotional Coupon', 'Membership Credit'];
const CARD_STATUSES: CardStatus[] = ['Active', 'Redeemed', 'Expired', 'Suspended'];

const STATUS_TONE: Record<CardStatus, StatusTone> = {
  Active: 'success',
  Redeemed: 'info',
  Expired: 'danger',
  Suspended: 'warning',
};
const TYPE_TONE: Record<string, StatusTone> = {
  'Spa Gift Card': 'accent',
  'Treatment Voucher': 'danger',
  'Promotional Coupon': 'warning',
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

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

const emptyForm = {
  card_type: 'Spa Gift Card',
  code: '',
  value: 100,
  purchaser_id: '',
  recipient_id: '',
  issue_date: '',
  expiry_date: '',
  applicable_treatments: 'All Services',
  notes: '',
};

const GiftCardsVouchersModule: React.FC<GiftCardsVouchersModuleProps> = ({ onViewGuestProfile }) => {
  const { currentPropertyId, addNotification } = useERP();

  const [cards, setCards] = useState<GiftCard[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GiftCard | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<GiftCard | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<GiftCard | null>(null);
  const [redeemAmount, setRedeemAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/gift-cards${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setCards(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load gift cards');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchCards();
    fetch('/api/spa-wellness/guests', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setGuests)
      .catch(() => {});
  }, [fetchCards]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => cards.filter(c => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.code.toLowerCase().includes(q) ||
      (c.purchaser_name || '').toLowerCase().includes(q) ||
      (c.recipient_name || '').toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    const matchesType = typeFilter === 'All' || c.card_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  }), [cards, search, statusFilter, typeFilter]);

  const stats = useMemo(() => {
    const soon = Date.now() + 30 * 86400000;
    return {
      total: cards.length,
      active: cards.filter(c => c.status === 'Active').length,
      outstanding: cards.filter(c => c.status === 'Active').reduce((n, c) => n + Number(c.remaining_balance || 0), 0),
      expiring: cards.filter(c => c.status === 'Active' && c.expiry_date && new Date(c.expiry_date).getTime() < soon && new Date(c.expiry_date) > new Date()).length,
    };
  }, [cards]);

  const daysLeft = (c: GiftCard) => {
    if (!c.expiry_date) return null;
    const d = Math.ceil((new Date(c.expiry_date).getTime() - Date.now()) / 86400000);
    return d;
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const patchCard = async (id: string, updates: Record<string, unknown>, revert?: Partial<GiftCard>) => {
    setActingOn(id);
    setCards(prev => prev.map(c => (c.id === id ? { ...c, ...updates } as GiftCard : c)));
    try {
      const res = await fetch(`/api/spa-wellness/gift-cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      setCards(prev => prev.map(c => (c.id === id ? saved : c)));
      return saved;
    } catch (e: any) {
      if (revert) setCards(prev => prev.map(c => (c.id === id ? { ...c, ...revert } : c)));
      else fetchCards();
      addNotification(`Update failed: ${e.message}`, 'warning', 'Spa');
      return null;
    } finally {
      setActingOn(null);
    }
  };

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };

  const openEdit = (c: GiftCard) => {
    setEditing(c);
    setForm({
      card_type: c.card_type,
      code: c.code,
      value: c.value,
      purchaser_id: c.purchaser_id || '',
      recipient_id: c.recipient_id || '',
      issue_date: c.issue_date || '',
      expiry_date: c.expiry_date || '',
      applicable_treatments: (c.applicable_treatments || []).join(', '),
      notes: c.notes || '',
    });
    setShowForm(true);
  };

  const saveCard = async () => {
    if (!form.value || Number(form.value) <= 0) {
      addNotification('Card value must be greater than zero', 'warning', 'Spa');
      return;
    }
    setSaving(true);
    const payload = {
      card_type: form.card_type,
      code: form.code.trim() || undefined,
      value: Number(form.value),
      purchaser_id: form.purchaser_id || null,
      recipient_id: form.recipient_id || null,
      issue_date: form.issue_date || undefined,
      expiry_date: form.expiry_date || null,
      applicable_treatments: form.applicable_treatments.split(',').map(s => s.trim()).filter(Boolean),
      notes: form.notes || null,
      propertyId: currentPropertyId || null,
    };
    try {
      const res = await fetch(editing ? `/api/spa-wellness/gift-cards/${editing.id}` : '/api/spa-wellness/gift-cards', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setShowForm(false);
      setEditing(null);
      addNotification(editing ? 'Gift card updated' : 'Gift card issued', 'success', 'Spa');
      fetchCards();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSaving(false);
    }
  };

  const redeem = async () => {
    if (!redeemTarget || redeemAmount <= 0) return;
    setActingOn('redeem');
    try {
      const res = await fetch(`/api/spa-wellness/gift-cards/${redeemTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ redeem: redeemAmount }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const saved = await res.json();
      addNotification(
        saved.status === 'Redeemed' ? 'Card fully redeemed' : `$${redeemAmount} redeemed — $${saved.remaining_balance} remaining`,
        'success', 'Spa'
      );
      setRedeemTarget(null);
      fetchCards();
    } catch (e: any) {
      addNotification(`Redemption failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const deleteCard = async (c: GiftCard) => {
    setActingOn(c.id);
    try {
      const res = await fetch(`/api/spa-wellness/gift-cards/${c.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setCards(prev => prev.filter(x => x.id !== c.id));
      setDeleteTarget(null);
      addNotification(`${c.code} removed`, 'success', 'Spa');
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
        title="Gift Cards & Vouchers"
        subtitle="Spa gift cards, treatment vouchers and promotional coupons"
        icon={CreditCard}
        actions={
          <button onClick={fetchCards} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Cards Issued" value={stats.total} icon={CreditCard} tone="accent" />
        <StatCard title="Active" value={stats.active} icon={TicketCheck} tone="success" />
        <StatCard title="Outstanding Balance" value={`$${stats.outstanding.toLocaleString()}`} icon={Wallet} tone="info" />
        <StatCard title="Expiring ≤30d" value={stats.expiring} icon={Calendar} tone={stats.expiring > 0 ? 'warning' : 'success'} />
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
              placeholder="Search code, purchaser, recipient…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={inputCls + ' pl-9'}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Types</option>
            {CARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls + ' w-auto'}>
            <option value="All">All Status</option>
            {CARD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openAdd} className={button.primary}>
            <Plus className="w-4 h-4" /> Issue Gift Card
          </button>
        </div>
      </SectionCard>

      {/* Cards */}
      <SectionCard title="Gift Cards" subtitle={`${filtered.length} of ${cards.length} cards`} icon={CreditCard} tone="accent" pad="none">
        {loading ? <LoadingRow /> : filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No gift cards match the current filters.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
            {filtered.map(c => {
              const days = daysLeft(c);
              return (
                <div key={c.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-accent-spa)]/10 flex items-center justify-center">
                        <CreditCard className="w-5 h-5 text-[var(--color-accent-spa)]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">{c.code}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{c.id}</p>
                      </div>
                    </div>
                    <select
                      value={c.status}
                      onChange={ev => patchCard(c.id, { status: ev.target.value }, { status: c.status })}
                      disabled={actingOn === c.id}
                      className={`${inlineSelectCls} ${statusTone[STATUS_TONE[c.status]].soft}`}
                    >
                      {CARD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <Badge tone={TYPE_TONE[c.card_type] || 'neutral'}>{c.card_type}</Badge>
                    {days != null && days >= 0 && days <= 30 && c.status === 'Active' && (
                      <Badge tone="warning">Expires in {days}d</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="font-bold text-sm text-slate-900 dark:text-white">${c.remaining_balance}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Balance / ${c.value}</div>
                    </div>
                    <div className="text-center p-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <div className="font-bold text-sm text-slate-900 dark:text-white">
                        {days == null ? '—' : days < 0 ? 'Expired' : `${days}d`}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Remaining</div>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-4 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <Gift className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        Purchaser:{' '}
                        {c.purchaser_id ? (
                          <button
                            onClick={() => onViewGuestProfile?.(c.purchaser_id!)}
                            className="text-[var(--color-accent-spa)] hover:opacity-80 transition font-medium"
                          >
                            {c.purchaser_name}
                          </button>
                        ) : (c.purchaser_name || '—')}
                      </span>
                    </div>
                    {c.recipient_name && (
                      <div className="flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Recipient: {c.recipient_name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      <span>Expires: {c.expiry_date ? new Date(c.expiry_date).toLocaleDateString() : 'No expiry'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                    <button
                      onClick={() => { setRedeemTarget(c); setRedeemAmount(Number(c.remaining_balance)); }}
                      disabled={c.status !== 'Active' || Number(c.remaining_balance) <= 0}
                      className="text-xs font-medium text-[var(--color-accent-spa)] hover:opacity-80 disabled:opacity-40 transition"
                    >
                      Redeem
                    </button>
                    <div className="flex gap-1.5">
                      <button onClick={() => openEdit(c)} title="Edit" className="p-1.5 text-slate-400 hover:text-[var(--color-accent-spa)] transition"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget(c)} title="Delete" className="p-1.5 text-slate-400 hover:text-[var(--color-danger)] transition"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Issue / Edit modal ── */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onConfirm={saveCard}
        title={editing ? `Edit ${editing.code}` : 'Issue Gift Card'}
        subtitle={editing ? editing.id : 'Type, value, purchaser/recipient and expiry'}
        variant="form"
        size="lg"
        loading={saving}
        confirmLabel={editing ? 'Save Changes' : 'Issue Card'}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Type">
            <select className={inputCls} value={form.card_type} onChange={e => setForm(f => ({ ...f, card_type: e.target.value }))}>
              {CARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Code (blank = auto-generated)">
            <input className={inputCls} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="SPA-GIFT-2026-XXX" />
          </Field>
          <Field label="Value ($) *">
            <input type="number" min={1} step="0.01" className={inputCls} value={form.value} onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))} />
          </Field>
          <Field label="Purchaser">
            <select className={inputCls} value={form.purchaser_id} onChange={e => setForm(f => ({ ...f, purchaser_id: e.target.value }))}>
              <option value="">None / walk-in</option>
              {guests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
            </select>
          </Field>
          <Field label="Recipient">
            <select className={inputCls} value={form.recipient_id} onChange={e => setForm(f => ({ ...f, recipient_id: e.target.value }))}>
              <option value="">None</option>
              {guests.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
            </select>
          </Field>
          <Field label="Issue Date">
            <input type="date" className={inputCls} value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
          </Field>
          <Field label="Expiry Date">
            <input type="date" className={inputCls} value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
          </Field>
          <Field label="Applicable Treatments (comma separated)">
            <input className={inputCls} value={form.applicable_treatments} onChange={e => setForm(f => ({ ...f, applicable_treatments: e.target.value }))} placeholder="All Services" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <textarea className={inputCls + ' min-h-[60px]'} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Birthday gift, promotion details…" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Redeem modal ── */}
      <ModalSystem
        isOpen={!!redeemTarget}
        onClose={() => setRedeemTarget(null)}
        onConfirm={redeem}
        title={`Redeem — ${redeemTarget?.code || ''}`}
        subtitle={redeemTarget ? `Balance $${redeemTarget.remaining_balance} of $${redeemTarget.value}` : ''}
        variant="form"
        size="sm"
        loading={actingOn === 'redeem'}
        confirmLabel="Redeem"
      >
        <Field label="Amount to redeem ($)">
          <input
            type="number"
            min={1}
            max={redeemTarget?.remaining_balance}
            step="0.01"
            className={inputCls}
            value={redeemAmount}
            onChange={e => setRedeemAmount(Number(e.target.value))}
          />
        </Field>
        {redeemTarget && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Remaining after redemption:{' '}
            <b className="text-slate-900 dark:text-white">
              ${Math.max(0, Number(redeemTarget.remaining_balance) - redeemAmount).toFixed(2)}
            </b>
            {Number(redeemTarget.remaining_balance) - redeemAmount <= 0 && redeemAmount > 0 && ' — card will be marked Redeemed'}
          </p>
        )}
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteCard(deleteTarget)}
        title="Delete Gift Card"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.code}</b> ({deleteTarget?.id})?
          {deleteTarget && Number(deleteTarget.remaining_balance) > 0 && ` It still has a $${deleteTarget.remaining_balance} balance.`}
        </p>
      </ModalSystem>
    </div>
  );
};

export default GiftCardsVouchersModule;
