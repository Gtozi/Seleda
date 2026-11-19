import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Gift, Ticket, DollarSign,
  CheckCircle2, XCircle, Clock, Check, Ban,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchGiftVouchers, createGiftVoucher, updateGiftVoucher, type GiftVoucher } from '../../services/salesService';

const VOUCHER_TYPES = ['Gift Card', 'Promotional Voucher', 'Discount Coupon', 'Corporate Voucher'];

const TYPE_TONE: Record<string, string> = {
  'Gift Card': 'danger',
  'Promotional Voucher': 'accent',
  'Discount Coupon': 'warning',
  'Corporate Voucher': 'info',
};

const STATUS_TONE: Record<string, string> = {
  Active: 'success',
  Redeemed: 'neutral',
  Expired: 'danger',
  Suspended: 'warning',
};

const EMPTY_FORM = {
  type: 'Gift Card',
  value: 100,
  recipient: '',
  expiryDate: '',
};

const GiftCardsVouchers: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [vouchers, setVouchers] = useState<GiftVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVouchers(await fetchGiftVouchers());
    } catch (err: any) {
      setError(err.message || 'Failed to load vouchers');
      addNotification('Failed to load vouchers', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.recipient.trim()) {
      setError('Recipient is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createGiftVoucher({ ...form, balance: form.value });
      addNotification('Voucher issued', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to issue voucher');
      addNotification('Failed to issue voucher', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (voucher: GiftVoucher, status: string) => {
    try {
      const update: any = { status };
      if (status === 'Redeemed') update.balance = 0;
      await updateGiftVoucher(voucher.id, update);
      addNotification(`Voucher ${status.toLowerCase()}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update voucher');
      addNotification('Failed to update voucher', 'error', 'Sales');
    }
  };

  const activeCount = useMemo(() => vouchers.filter((v) => v.status === 'Active').length, [vouchers]);
  const outstandingBalance = useMemo(() => vouchers.filter((v) => v.status === 'Active').reduce((s, v) => s + Number(v.balance || 0), 0), [vouchers]);
  const redeemedCount = useMemo(() => vouchers.filter((v) => v.status === 'Redeemed').length, [vouchers]);

  const columns: Column<GiftVoucher>[] = [
    {
      key: 'code',
      label: 'Code',
      sortable: true,
      sortAccessor: (v) => v.code,
      render: (v) => <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase">{v.code}</span>,
    },
    {
      key: 'type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (v) => v.type || '',
      render: (v) => <Badge tone={(TYPE_TONE[v.type || ''] || 'neutral') as any}>{v.type || '—'}</Badge>,
    },
    {
      key: 'value',
      label: 'Value',
      align: 'right',
      sortable: true,
      sortAccessor: (v) => v.value,
      render: (v) => <span className="text-sm font-semibold text-slate-900 dark:text-white">{formatAmount(v.value)}</span>,
    },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      sortable: true,
      sortAccessor: (v) => v.balance,
      render: (v) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(v.balance)}</span>,
    },
    {
      key: 'recipient',
      label: 'Recipient',
      sortable: true,
      sortAccessor: (v) => v.recipient || '',
      render: (v) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{v.recipient || '—'}</span>,
    },
    {
      key: 'expiry_date',
      label: 'Expires',
      align: 'center',
      sortable: true,
      sortAccessor: (v) => v.expiry_date || '',
      render: (v) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1"><Clock size={12} /> {v.expiry_date || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (v) => v.status,
      render: (v) => <Badge tone={(STATUS_TONE[v.status] || 'neutral') as any}>{v.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (v) => (
        <div className="flex justify-end gap-1">
          {v.status === 'Active' && (
            <button onClick={() => handleStatusChange(v, 'Redeemed')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Redeem"><Check size={14} /></button>
          )}
          {v.status === 'Active' && (
            <button onClick={() => handleStatusChange(v, 'Suspended')} className="p-1.5 text-slate-400 hover:text-amber-500 transition" title="Suspend"><Ban size={14} /></button>
          )}
          {v.status !== 'Expired' && v.status !== 'Active' && (
            <button onClick={() => handleStatusChange(v, 'Active')} className="p-1.5 text-slate-400 hover:text-[var(--color-info)] transition" title="Activate"><CheckCircle2 size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Gift Cards & Vouchers"
        subtitle="Gift cards, promotional vouchers, discount coupons, redemption tracking, and expiration management · DB-synced"
        icon={Gift}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Voucher
            </button>
          </>
        }
      />

      {error && !showAddModal && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Vouchers" value={vouchers.length.toLocaleString()} icon={Ticket} tone="info" />
        <StatCard title="Active" value={activeCount.toLocaleString()} icon={CheckCircle2} tone="success" />
        <StatCard title="Outstanding Balance" value={formatAmount(outstandingBalance)} icon={DollarSign} tone="warning" />
        <StatCard title="Redeemed" value={redeemedCount.toLocaleString()} icon={XCircle} tone="neutral" />
      </div>

      <SectionCard title="Voucher Inventory" subtitle="All issued gift cards, vouchers, and coupons">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={vouchers}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search vouchers..."
            filterKeys={['code', 'type', 'recipient', 'status']}
            emptyMessage="No gift cards or vouchers issued yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="New Gift Card / Voucher"
        subtitle="Issue a gift card, voucher, or coupon"
        confirmLabel="Issue Voucher"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="md"
      >
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {VOUCHER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Value ($)</label>
              <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Recipient</label>
            <input value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="Recipient name" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Expiry Date</label>
            <input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default GiftCardsVouchers;
