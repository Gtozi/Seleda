import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Building2, DollarSign, TrendingUp,
  Crown, Users, Plus, Trash2, Pencil,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import {
  fetchCorporateAccounts, createCorporateAccount, updateCorporateAccount, deleteCorporateAccount,
  type CorporateAccount,
} from '../../services/salesService';

const EMPTY_FORM = {
  companyName: '',
  contactPerson: '',
  contactEmail: '',
  contactPhone: '',
  industry: '',
  discountPercent: 0,
  creditLimit: 0,
  creditTerms: 'Net 30',
  billingAddress: '',
  taxId: '',
  notes: '',
};

const AccountManagement: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<CorporateAccount | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await fetchCorporateAccounts());
    } catch (err: any) {
      setError(err.message || 'Failed to load accounts');
      addNotification('Failed to load accounts', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const keyAccounts = useMemo(() =>
    accounts.filter((a) => Number(a.unpaid_balance || 0) > 0 || Number(a.active_bookings || 0) > 0),
  [accounts]);

  const totalRevenue = useMemo(() => accounts.reduce((s, a) => s + Number(a.unpaid_balance || 0), 0), [accounts]);
  const totalActiveBookings = useMemo(() => accounts.reduce((s, a) => s + Number(a.active_bookings || 0), 0), [accounts]);
  const upsellTargets = useMemo(() => accounts.filter((a) => Number(a.active_bookings) > 2).length, [accounts]);

  const handleSave = async () => {
    if (!form.companyName || !form.contactPerson || !form.contactEmail) {
      setError('Company name, contact person, and email are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateCorporateAccount(editingId, form);
        addNotification('Account updated', 'success', 'Sales');
      } else {
        await createCorporateAccount(form);
        addNotification('Account created', 'success', 'Sales');
      }
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to save account');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (account: CorporateAccount) => {
    setEditingId(account.id);
    setForm({
      companyName: account.company_name,
      contactPerson: account.contact_person || '',
      contactEmail: account.contact_email || '',
      contactPhone: account.contact_phone || '',
      industry: account.industry || '',
      discountPercent: Number(account.discount_percent || 0),
      creditLimit: Number(account.credit_limit || 0),
      creditTerms: account.credit_terms || 'Net 30',
      billingAddress: account.billing_address || '',
      taxId: account.tax_id || '',
      notes: account.notes || '',
    });
    setShowModal(true);
    setError(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteCorporateAccount(deleteTarget.id);
      addNotification('Account deleted', 'success', 'Sales');
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete account');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<CorporateAccount>[] = [
    {
      key: 'company_name',
      label: 'Key Account',
      sortable: true,
      sortAccessor: (a) => a.company_name,
      render: (a) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
            <Building2 size={12} />
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{a.company_name}</span>
            {a.industry && <p className="text-[10px] font-medium text-slate-400">{a.industry}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'contact_person',
      label: 'Account Manager',
      sortable: true,
      sortAccessor: (a) => a.contact_person || '',
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.contact_person || '—'}</span>,
    },
    {
      key: 'active_bookings',
      label: 'Bookings',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.active_bookings,
      render: (a) => <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{a.active_bookings}</span>,
    },
    {
      key: 'unpaid_balance',
      label: 'Revenue',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.unpaid_balance,
      render: (a) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(a.unpaid_balance)}</span>,
    },
    {
      key: 'credit_limit',
      label: 'Credit Limit',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.credit_limit,
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatAmount(a.credit_limit)}</span>,
    },
    {
      key: 'discount_percent',
      label: 'Discount',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.discount_percent,
      render: (a) => <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{a.discount_percent}%</span>,
    },
    {
      key: 'upsell',
      label: 'Upsell',
      align: 'center',
      sortable: false,
      render: (a) => {
        const hasUpsell = Number(a.active_bookings) > 2;
        return hasUpsell ? <Badge tone="success">Opportunity</Badge> : <span className="text-xs text-slate-400">—</span>;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (a) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => handleEdit(a)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600" title="Edit">
            <Pencil size={14} />
          </button>
          <button onClick={() => setDeleteTarget(a)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-rose-600" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Account Management"
        subtitle="Key accounts, revenue tracking, production analysis, and upselling opportunities · DB-synced"
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Account
            </button>
          </div>
        }
      />

      {error && !showModal && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Key Accounts" value={keyAccounts.length.toLocaleString()} icon={Building2} tone="info" />
        <StatCard title="Total Revenue" value={formatAmount(totalRevenue)} icon={DollarSign} tone="success" />
        <StatCard title="Active Bookings" value={totalActiveBookings.toLocaleString()} icon={TrendingUp} tone="warning" />
        <StatCard title="Upsell Targets" value={upsellTargets.toLocaleString()} icon={Crown} tone="accent" />
      </div>

      <SectionCard title="Key Accounts" subtitle="Corporate and production accounts with revenue and credit metrics">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={accounts}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search key accounts..."
            filterKeys={['company_name', 'contact_person', 'industry']}
            emptyMessage="No key accounts found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingId(null); setError(null); }}
        onConfirm={handleSave}
        title={editingId ? 'Edit Account' : 'New Account'}
        subtitle="Corporate account details, credit terms, and contact info"
        confirmLabel={editingId ? 'Save Changes' : 'Create Account'}
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Company Name *</label>
              <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Industry</label>
              <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contact Person *</label>
              <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Email *</label>
              <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Phone</label>
              <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Discount %</label>
              <input type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Credit Limit</label>
              <input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Credit Terms</label>
              <select value={form.creditTerms} onChange={(e) => setForm({ ...form, creditTerms: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 45">Net 45</option>
                <option value="Net 60">Net 60</option>
                <option value="Prepaid">Prepaid</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Billing Address</label>
              <input value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Tax ID</label>
              <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>

      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Account"
        subtitle={`Are you sure you want to delete "${deleteTarget?.company_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmColor="rose"
        showFooter
        loading={saving}
        size="md"
      />
    </div>
  );
};

export default AccountManagement;
