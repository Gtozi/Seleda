import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, FileSignature,
  DollarSign, CheckCircle2, XCircle,
  Calendar,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchContracts, createContract, type Contract } from '../../services/salesService';

const CONTRACT_TYPES = ['Corporate Contract', 'Travel Agent Agreement', 'Group Contract', 'Event Agreement', 'Rate Agreement', 'Commission Agreement'];

const CONTRACT_TONE: Record<string, string> = {
  Active: 'success',
  Completed: 'neutral',
  Cancelled: 'danger',
  Pending: 'warning',
};

const EMPTY_FORM = {
  title: '',
  contractType: 'Corporate Contract',
  startDate: '',
  endDate: '',
  totalValue: 0,
  depositAmount: 0,
  signedByClient: '',
  signedDate: '',
  terms: 'Contract terms per signed agreement.',
};

function daysUntil(date?: string | null) {
  if (!date) return null;
  const end = new Date(date);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return isNaN(diff) ? null : diff;
}

const ContractsAgreements: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContracts(await fetchContracts());
    } catch (err: any) {
      setError(err.message || 'Failed to load contracts');
      addNotification('Failed to load contracts', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const expiringSoon = useMemo(() =>
    contracts.filter((c) => {
      const days = daysUntil(c.end_date);
      return days !== null && days > 0 && days <= 30;
    }),
  [contracts]);

  const totalValue = useMemo(() => contracts.reduce((s, c) => s + Number(c.total_value || 0), 0), [contracts]);

  const handleCreateContract = async () => {
    if (!form.title.trim()) {
      setError('Contract title is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createContract({
        title: form.title,
        eventType: form.contractType,
        startDate: form.startDate,
        endDate: form.endDate,
        totalValue: form.totalValue,
        depositAmount: form.depositAmount,
        signedByClient: form.signedByClient,
        signedDate: form.signedDate,
        terms: form.terms,
        proposalId: '',
        leadId: '',
        guestCount: 0,
        roomNights: 0,
      });
      addNotification('Contract created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create contract');
      addNotification('Failed to create contract', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Contract>[] = [
    {
      key: 'contract_number',
      label: 'Contract #',
      render: (c) => <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">{c.contract_number || c.id.slice(0, 8)}</span>,
    },
    {
      key: 'title',
      label: 'Title',
      sortable: true,
      sortAccessor: (c) => c.title,
      render: (c) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>,
    },
    {
      key: 'event_type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.event_type || '',
      render: (c) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{c.event_type || '—'}</span>,
    },
    {
      key: 'total_value',
      label: 'Value',
      align: 'right',
      sortable: true,
      sortAccessor: (c) => c.total_value,
      render: (c) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(c.total_value)}</span>,
    },
    {
      key: 'start_date',
      label: 'Start',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.start_date || '',
      render: (c) => (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          <Calendar size={12} /> {c.start_date || '—'}
        </span>
      ),
    },
    {
      key: 'end_date',
      label: 'End',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.end_date || '',
      render: (c) => (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          <Calendar size={12} /> {c.end_date || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.status,
      render: (c) => <Badge tone={(CONTRACT_TONE[c.status] || 'neutral') as any}>{c.status}</Badge>,
    },
    {
      key: 'signed_by_client',
      label: 'Signed By',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.signed_by_client || '',
      render: (c) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{c.signed_by_client || '—'}</span>,
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Contracts & Agreements"
        subtitle="Corporate contracts, travel agent agreements, group contracts, and digital signatures · DB-synced"
        icon={FileSignature}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Contract
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
        <StatCard title="Total Contracts" value={contracts.length.toLocaleString()} icon={FileSignature} tone="info" />
        <StatCard title="Active" value={contracts.filter((c) => c.status === 'Active').length.toLocaleString()} icon={CheckCircle2} tone="success" />
        <StatCard title="Total Value" value={formatAmount(totalValue)} icon={DollarSign} tone="accent" />
        <StatCard title="Expiring Soon" value={expiringSoon.length.toLocaleString()} icon={XCircle} tone="danger" />
      </div>

      <SectionCard title="Contract Directory" subtitle="All contracts and agreements">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={contracts}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search contracts..."
            filterKeys={['title', 'event_type', 'status', 'signed_by_client']}
            emptyMessage="No contracts found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreateContract}
        title="New Contract"
        subtitle="Create a contract or agreement"
        confirmLabel="Create Contract"
        cancelLabel="Cancel"
        confirmColor="indigo"
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contract Type</label>
              <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Value ($)</label>
              <input type="number" value={form.totalValue} onChange={(e) => setForm({ ...form, totalValue: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Deposit ($)</label>
              <input type="number" value={form.depositAmount} onChange={(e) => setForm({ ...form, depositAmount: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Signed By</label>
              <input value={form.signedByClient} onChange={(e) => setForm({ ...form, signedByClient: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Signed Date</label>
              <input type="date" value={form.signedDate} onChange={(e) => setForm({ ...form, signedDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Terms & Conditions</label>
            <textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={3} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ContractsAgreements;
