import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  RefreshCw,
  Building2,
  DollarSign,
  CreditCard,
  FileText,
  Mail,
  Phone,
  AlertTriangle,
  Search,
  Pencil,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { DataTable, Column } from '../Shared/DataTable';
import { ModalSystem } from '../Shared/ModalSystem';
import {
  fetchCorporateAccounts,
  createCorporateAccount,
  updateCorporateAccount,
  type CorporateAccount,
} from '../../services/salesService';

const INDUSTRIES = [
  'Aviation',
  'Government',
  'NGO',
  'Corporate Client',
  'Travel Agency',
  'Tour Operator',
  'Event Organizer',
  'Wedding Planner',
  'Education',
  'Other',
];

const CREDIT_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Prepaid'];

const EMPTY_FORM = {
  companyName: '',
  contactPerson: '',
  contactEmail: '',
  contactPhone: '',
  discountPercent: 0,
  creditLimit: 0,
  creditTerms: 'Net 30',
  billingAddress: '',
  taxId: '',
  industry: '',
  notes: '',
  unpaidBalance: 0,
  activeBookings: 0,
};

function creditUtilization(unpaid: number, limit: number) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((unpaid / limit) * 100));
}

const CorporateAccountMaster: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState<CorporateAccount | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCorporateAccounts();
      setAccounts(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load corporate accounts');
      addNotification('Failed to load corporate accounts', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let data = accounts;
    if (industryFilter !== 'all') {
      data = data.filter((a) => a.industry === industryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      data = data.filter((a) =>
        [a.company_name, a.contact_person, a.contact_email, a.contact_phone, a.industry, a.tax_id]
          .some((v) => (v || '').toLowerCase().includes(q))
      );
    }
    return data;
  }, [accounts, industryFilter, search]);

  const totalCreditLimit = accounts.reduce((s, a) => s + Number(a.credit_limit || 0), 0);
  const totalAR = accounts.reduce((s, a) => s + Number(a.unpaid_balance || 0), 0);
  const totalActiveBookings = accounts.reduce((s, a) => s + Number(a.active_bookings || 0), 0);
  const overLimitCount = accounts.filter((a) => a.credit_limit > 0 && a.unpaid_balance > a.credit_limit).length;

  const validate = (payload: typeof EMPTY_FORM | CorporateAccount | null, isEdit = false) => {
    if (!payload) return 'No data';
    const name = isEdit ? (payload as CorporateAccount).company_name : (payload as typeof EMPTY_FORM).companyName;
    if (!name?.trim()) return 'Company name is required';
    const email = isEdit ? (payload as CorporateAccount).contact_email : (payload as typeof EMPTY_FORM).contactEmail;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email address';
    return null;
  };

  const handleAdd = async () => {
    const msg = validate(form);
    if (msg) { setError(msg); return; }

    setSaving(true);
    setError(null);
    try {
      await createCorporateAccount(form);
      addNotification('Corporate account created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
      addNotification('Failed to create corporate account', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editForm) return;
    const msg = validate(editForm, true);
    if (msg) { setError(msg); return; }

    setSaving(true);
    setError(null);
    try {
      await updateCorporateAccount(editForm.id, {
        companyName: editForm.company_name,
        contactPerson: editForm.contact_person,
        contactEmail: editForm.contact_email,
        contactPhone: editForm.contact_phone,
        discountPercent: editForm.discount_percent,
        creditLimit: editForm.credit_limit,
        creditTerms: editForm.credit_terms,
        billingAddress: editForm.billing_address,
        taxId: editForm.tax_id,
        industry: editForm.industry,
        notes: editForm.notes,
        unpaidBalance: editForm.unpaid_balance,
        activeBookings: editForm.active_bookings,
      });
      addNotification('Corporate account updated', 'success', 'Sales');
      setShowEditModal(false);
      setEditForm(null);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update account');
      addNotification('Failed to update corporate account', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<CorporateAccount>[] = [
    {
      key: 'company_name',
      label: 'Company',
      sortable: true,
      sortAccessor: (a) => a.company_name,
      render: (a) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
            <Building2 size={14} />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{a.company_name}</span>
        </div>
      ),
    },
    {
      key: 'contact_person',
      label: 'Contact',
      sortable: true,
      sortAccessor: (a) => a.contact_person || '',
      render: (a) => <span className="text-sm text-slate-600 dark:text-slate-400">{a.contact_person || '—'}</span>,
    },
    {
      key: 'industry',
      label: 'Industry',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.industry || '',
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.industry || '—'}</span>,
    },
    {
      key: 'discount_percent',
      label: 'Discount',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.discount_percent,
      render: (a) => <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{a.discount_percent}%</span>,
    },
    {
      key: 'credit_limit',
      label: 'Credit Limit',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.credit_limit,
      render: (a) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatAmount(a.credit_limit)}</span>,
    },
    {
      key: 'credit_terms',
      label: 'Terms',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.credit_terms || '',
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.credit_terms || '—'}</span>,
    },
    {
      key: 'unpaid_balance',
      label: 'AR Balance',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.unpaid_balance,
      render: (a) => {
        const overLimit = a.credit_limit > 0 && a.unpaid_balance > a.credit_limit;
        return <span className={`text-sm font-semibold ${overLimit ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatAmount(a.unpaid_balance)}</span>;
      },
    },
    {
      key: 'credit_utilization',
      label: 'Utilization',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => creditUtilization(a.unpaid_balance, a.credit_limit),
      render: (a) => {
        const util = creditUtilization(a.unpaid_balance, a.credit_limit);
        let tone = 'success' as any;
        if (util >= 90) tone = 'danger';
        else if (util >= 70) tone = 'warning';
        else if (util > 0) tone = 'info';
        return <Badge tone={tone}>{util}%</Badge>;
      },
    },
    {
      key: 'active_bookings',
      label: 'Bookings',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.active_bookings,
      render: (a) => <span className="text-sm text-slate-600 dark:text-slate-400">{a.active_bookings}</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (a) => (
        <button
          onClick={() => { setEditForm(a); setShowEditModal(true); setError(null); }}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-[var(--color-accent-operations)] transition"
          title="Edit"
        >
          <Pencil size={16} />
        </button>
      ),
    },
  ];

  const renderForm = (
    state: typeof EMPTY_FORM | CorporateAccount | null,
    setState: React.Dispatch<React.SetStateAction<any>>,
    isEdit = false
  ) => {
    if (!state) return null;
    const get = (k: string) => (state as any)[k] ?? '';
    const set = (k: string, v: any) => setState((prev: any) => ({ ...prev, [k]: v }));

    return (
      <div className="p-6 space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Company Name</label>
            <input value={isEdit ? get('company_name') : get('companyName')} onChange={e => set(isEdit ? 'company_name' : 'companyName', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Industry</label>
            <select value={get('industry')} onChange={e => set('industry', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
              <option value="">— Select —</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contact Person</label>
            <input value={get('contactPerson') || get('contact_person')} onChange={e => set(isEdit ? 'contact_person' : 'contactPerson', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2 flex items-center gap-1"><Mail size={10} /> Email</label>
            <input value={get('contactEmail') || get('contact_email')} onChange={e => set(isEdit ? 'contact_email' : 'contactEmail', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2 flex items-center gap-1"><Phone size={10} /> Phone</label>
            <input value={get('contactPhone') || get('contact_phone')} onChange={e => set(isEdit ? 'contact_phone' : 'contactPhone', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Credit Limit ($)</label>
            <input type="number" value={get('creditLimit') ?? get('credit_limit')} onChange={e => set(isEdit ? 'credit_limit' : 'creditLimit', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Credit Terms</label>
            <select value={get('creditTerms') || get('credit_terms')} onChange={e => set(isEdit ? 'credit_terms' : 'creditTerms', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
              {CREDIT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Discount (%)</label>
            <input type="number" value={get('discountPercent') ?? get('discount_percent')} onChange={e => set(isEdit ? 'discount_percent' : 'discountPercent', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Billing Address</label>
            <input value={get('billingAddress') || get('billing_address')} onChange={e => set(isEdit ? 'billing_address' : 'billingAddress', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Tax ID</label>
            <input value={get('taxId') || get('tax_id')} onChange={e => set(isEdit ? 'tax_id' : 'taxId', e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>

        {isEdit && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">AR Balance ($)</label>
              <input type="number" value={get('unpaid_balance')} onChange={e => set('unpaid_balance', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Active Bookings</label>
              <input type="number" value={get('active_bookings')} onChange={e => set('active_bookings', Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
          <textarea value={get('notes')} onChange={e => set('notes', e.target.value)} rows={3} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
      </div>
    );
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Corporate Account Master"
        subtitle="Centralized corporate accounts with credit terms, AR balance, and booking history · DB-synced"
        icon={Building2}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowAddModal(true)} className={button.primary}>
              <Plus size={16} /> Add Account
            </button>
          </>
        }
      />

      {error && !showAddModal && !showEditModal && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Accounts" value={accounts.length.toLocaleString()} icon={Building2} tone="accent" />
        <StatCard title="Total Credit Limit" value={formatAmount(totalCreditLimit)} icon={CreditCard} tone="info" />
        <StatCard title="Total AR Balance" value={formatAmount(totalAR)} icon={DollarSign} tone={totalAR > totalCreditLimit ? 'danger' : 'success'} />
        <StatCard title="Over Limit Accounts" value={overLimitCount.toLocaleString()} icon={AlertTriangle} tone={overLimitCount > 0 ? 'danger' : 'neutral'} />
      </div>

      <SectionCard
        title="Account Directory"
        subtitle="Filter by industry and search by company, contact, or tax ID"
        actions={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        }
      >
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={() => setIndustryFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                industryFilter === 'all'
                  ? `${statusTone.accent.soft} border-[var(--color-accent-operations)]/30`
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
              }`}
            >
              All ({accounts.length})
            </button>
            {INDUSTRIES.map((ind) => {
              const count = accounts.filter((a) => a.industry === ind).length;
              if (count === 0) return null;
              const active = industryFilter === ind;
              return (
                <button
                  key={ind}
                  onClick={() => setIndustryFilter(active ? 'all' : ind)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                    active
                      ? `${statusTone.info.soft} border-[var(--color-accent-operations)]/30`
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
                  }`}
                >
                  {ind} ({count})
                </button>
              );
            })}
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            rowKey={(row) => row.id}
            sortable
            pagination
            pageSize={10}
            emptyMessage="No corporate accounts found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleAdd}
        title="New Corporate Account"
        subtitle="Register a corporate account with credit terms"
        confirmLabel="Add Account"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="lg"
      >
        {renderForm(form, setForm, false)}
      </ModalSystem>

      <ModalSystem
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setEditForm(null); setError(null); }}
        onConfirm={handleEdit}
        title="Edit Corporate Account"
        subtitle="Update account details, AR balance, and active bookings"
        confirmLabel="Save Changes"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="lg"
      >
        {renderForm(editForm, setEditForm, true)}
      </ModalSystem>
    </div>
  );
};

export default CorporateAccountMaster;
