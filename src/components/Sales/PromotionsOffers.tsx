import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Tag, Percent, Calendar, DollarSign,
  TrendingUp, Clock, Play, Pause, XCircle,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchPromotions, createPromotion, updatePromotion, type Promotion } from '../../services/salesService';

const PROMO_TYPES = ['Promo Code', 'Package Promotion', 'Seasonal Discount', 'Corporate Discount', 'Early Booking Offer', 'Last Minute Offer', 'Weekend Package', 'Long Stay Promotion'];

const STATUS_TONE: Record<string, string> = {
  Active: 'success',
  Scheduled: 'info',
  Expired: 'neutral',
  Paused: 'warning',
};

const EMPTY_FORM = {
  name: '',
  type: 'Promo Code',
  code: '',
  discountPercent: 10,
  startDate: '',
  endDate: '',
  maxUses: 100,
};

function daysUntil(date?: string | null) {
  if (!date) return null;
  const end = new Date(date);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return isNaN(diff) ? null : diff;
}

const PromotionsOffers: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPromos(await fetchPromotions());
    } catch (err: any) {
      setError(err.message || 'Failed to load promotions');
      addNotification('Failed to load promotions', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError('Promotion name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createPromotion({ ...form, code: form.code.toUpperCase() });
      addNotification('Promotion created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create promotion');
      addNotification('Failed to create promotion', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (promo: Promotion, status: string) => {
    try {
      await updatePromotion(promo.id, { status });
      addNotification(`Promotion ${status.toLowerCase()}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update promotion');
      addNotification('Failed to update promotion', 'error', 'Sales');
    }
  };

  const activeCount = useMemo(() => promos.filter((p) => p.status === 'Active').length, [promos]);
  const totalRevenue = useMemo(() => promos.reduce((s, p) => s + Number(p.revenue || 0), 0), [promos]);
  const expiringSoon = useMemo(() =>
    promos.filter((p) => {
      const days = daysUntil(p.end_date);
      return days !== null && days > 0 && days <= 7 && p.status !== 'Expired';
    }),
  [promos]);

  const columns: Column<Promotion>[] = [
    {
      key: 'name',
      label: 'Promotion',
      sortable: true,
      sortAccessor: (p) => p.name,
      render: (p) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)]"><Tag size={12} /></div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{p.name}</span>
        </div>
      ),
    },
    {
      key: 'code',
      label: 'Code',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.code || '',
      render: (p) => <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase">{p.code || '—'}</span>,
    },
    {
      key: 'type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.type || '',
      render: (p) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{p.type || '—'}</span>,
    },
    {
      key: 'discount_percent',
      label: 'Discount',
      align: 'right',
      sortable: true,
      sortAccessor: (p) => p.discount_percent,
      render: (p) => <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">{p.discount_percent}%</span>,
    },
    {
      key: 'uses',
      label: 'Uses',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.uses,
      render: (p) => <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{p.uses}/{p.max_uses}</span>,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      align: 'right',
      sortable: true,
      sortAccessor: (p) => p.revenue,
      render: (p) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(p.revenue)}</span>,
    },
    {
      key: 'end_date',
      label: 'Ends',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.end_date || '',
      render: (p) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1"><Calendar size={12} /> {p.end_date || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.status,
      render: (p) => <Badge tone={(STATUS_TONE[p.status] || 'neutral') as any}>{p.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (p) => (
        <div className="flex justify-end gap-1">
          {p.status !== 'Active' && p.status !== 'Expired' && (
            <button onClick={() => handleStatusChange(p, 'Active')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Activate"><Play size={14} /></button>
          )}
          {p.status === 'Active' && (
            <button onClick={() => handleStatusChange(p, 'Paused')} className="p-1.5 text-slate-400 hover:text-amber-500 transition" title="Pause"><Pause size={14} /></button>
          )}
          {p.status !== 'Expired' && (
            <button onClick={() => handleStatusChange(p, 'Expired')} className="p-1.5 text-slate-400 hover:text-slate-500 transition" title="Expire"><XCircle size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Promotions & Offers"
        subtitle="Promo codes, package promotions, seasonal discounts, and special offers · DB-synced"
        icon={Tag}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Promotion
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
        <StatCard title="Total Promos" value={promos.length.toLocaleString()} icon={Tag} tone="info" />
        <StatCard title="Active" value={activeCount.toLocaleString()} icon={TrendingUp} tone="success" />
        <StatCard title="Total Revenue" value={formatAmount(totalRevenue)} icon={DollarSign} tone="warning" />
        <StatCard title="Expiring Soon" value={expiringSoon.length.toLocaleString()} icon={Clock} tone="danger" />
      </div>

      <SectionCard title="Active Promotions" subtitle="All promotions and discount codes">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={promos}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search promotions..."
            filterKeys={['name', 'code', 'type', 'status']}
            emptyMessage="No promotions created yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="New Promotion"
        subtitle="Create a promotional offer or discount code"
        confirmLabel="Create Promotion"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="lg"
      >
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Promotion Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Summer Escape 20% Off" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Promotion Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {PROMO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Promo Code</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-mono font-bold outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="SUMMER20" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Discount (%)</label>
              <input type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Max Uses</label>
              <input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Start Date</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">End Date</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default PromotionsOffers;
