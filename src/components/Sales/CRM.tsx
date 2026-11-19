import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  RefreshCw,
  Users,
  Building2,
  Plane,
  Briefcase,
  Search,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { DataTable, Column } from '../Shared/DataTable';
import { ModalSystem } from '../Shared/ModalSystem';
import {
  fetchLeads,
  fetchCorporateAccounts,
  createLead,
  createCorporateAccount,
  updateLead,
  type SalesLead,
  type CorporateAccount,
} from '../../services/salesService';

const CUSTOMER_TYPES = [
  'Individual Guest',
  'Corporate Client',
  'Travel Agency',
  'Tour Operator',
  'Government',
  'Airlines',
  'Event Organizer',
  'Wedding Planner',
];

const STAGES = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const SOURCES = ['Direct', 'Website', 'Referral', 'Social Media', 'Trade Show', 'OTA', 'Walk-in', 'Telephone'];

const STAGE_TONE: Record<string, string> = {
  Active: 'success',
  Won: 'success',
  Prospect: 'neutral',
  Qualified: 'info',
  Proposal: 'info',
  Negotiation: 'warning',
  Lost: 'danger',
};

const TYPE_ICON: Record<string, React.ElementType> = {
  'Individual Guest': Users,
  'Corporate Client': Building2,
  'Travel Agency': Plane,
  'Tour Operator': Briefcase,
  Government: Building2,
  Airlines: Plane,
  'Event Organizer': Briefcase,
  'Wedding Planner': Briefcase,
};

interface CRMRecord {
  id: string;
  kind: 'lead' | 'account';
  type: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  totalStays: number;
  totalRevenue: number;
  lastContact: string | null;
  notes: string | null;
}

const EMPTY_FORM = {
  type: 'Individual Guest',
  name: '',
  contactPerson: '',
  company: '',
  email: '',
  phone: '',
  source: 'Direct',
  opportunityValue: '',
  notes: '',
};

const CRM: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, a] = await Promise.all([
        fetchLeads(),
        fetchCorporateAccounts(),
      ]);
      setLeads(l);
      setAccounts(a);
    } catch (err: any) {
      setError(err.message || 'Failed to load CRM data');
      addNotification('Failed to load CRM data', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const crmRecords = useMemo<CRMRecord[]>(() => {
    const records: CRMRecord[] = [];

    accounts.forEach((a) => {
      const type = a.industry && CUSTOMER_TYPES.includes(a.industry) ? a.industry : 'Corporate Client';
      records.push({
        id: a.id,
        kind: 'account',
        type,
        name: a.company_name,
        company: a.company_name,
        email: a.contact_email,
        phone: a.contact_phone,
        source: 'Corporate',
        status: 'Active',
        totalStays: Number(a.active_bookings || 0),
        totalRevenue: Number(a.unpaid_balance || 0),
        lastContact: a.updated_at,
        notes: a.notes,
      });
    });

    leads.forEach((l) => {
      const account = l.corporate_accounts;
      let type = 'Individual Guest';
      if (l.corporate_account_id && account?.industry && CUSTOMER_TYPES.includes(account.industry)) {
        type = account.industry;
      } else if (l.company) {
        type = 'Corporate Client';
      }
      records.push({
        id: l.id,
        kind: 'lead',
        type,
        name: l.lead_name,
        company: l.company || account?.company_name || null,
        email: l.contact_email,
        phone: l.contact_phone,
        source: l.source,
        status: l.stage,
        totalStays: 0,
        totalRevenue: Number(l.opportunity_value || 0),
        lastContact: l.updated_at,
        notes: l.notes,
      });
    });

    return records;
  }, [leads, accounts]);

  const filtered = useMemo(() => {
    let data = crmRecords;
    if (filterType !== 'all') {
      data = data.filter((r) => r.type === filterType);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      data = data.filter((r) =>
        [r.name, r.company, r.email, r.phone].some((v) =>
          (v || '').toLowerCase().includes(q)
        )
      );
    }
    return data;
  }, [crmRecords, filterType, search]);

  const totalCustomers = crmRecords.length;
  const activeAccounts = accounts.length;
  const pipelineValue = useMemo(
    () => crmRecords.filter((r) => r.kind === 'lead' && r.status !== 'Won' && r.status !== 'Lost').reduce((s, r) => s + r.totalRevenue, 0),
    [crmRecords]
  );
  const totalRevenue = useMemo(() => crmRecords.reduce((s, r) => s + r.totalRevenue, 0), [crmRecords]);

  const handleStageChange = async (id: string, stage: string) => {
    try {
      await updateLead(id, { stage });
      addNotification(`Lead moved to ${stage}`, 'success', 'Sales');
      loadData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to update lead', 'error', 'Sales');
    }
  };

  const handleAdd = async () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.email.trim()) {
      setError('Email is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (form.type === 'Individual Guest') {
        await createLead({
          leadName: form.name,
          company: form.company,
          contactPerson: form.name,
          contactEmail: form.email,
          contactPhone: form.phone,
          source: form.source,
          stage: 'Prospect',
          opportunityValue: Number(form.opportunityValue) || 0,
          priority: 'Medium',
          notes: form.notes,
        });
      } else {
        await createCorporateAccount({
          companyName: form.name,
          contactPerson: form.contactPerson || form.name,
          contactEmail: form.email,
          contactPhone: form.phone,
          industry: form.type,
          notes: form.notes,
        });
      }
      addNotification(`${form.type === 'Individual Guest' ? 'Lead' : 'Account'} added to CRM`, 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to add customer');
      addNotification('Failed to add customer', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<CRMRecord>[] = [
    {
      key: 'name',
      label: 'Customer',
      sortable: true,
      sortAccessor: (r) => r.name,
      render: (r) => {
        const Icon = TYPE_ICON[r.type] || Building2;
        return (
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
              <Icon size={14} />
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.name}</span>
          </div>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.type,
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.type}</span>,
    },
    {
      key: 'company',
      label: 'Company',
      sortable: true,
      sortAccessor: (r) => r.company || '',
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.company || '—'}</span>,
    },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      sortAccessor: (r) => r.email || '',
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.email || '—'}</span>,
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.phone || '—'}</span>,
    },
    {
      key: 'source',
      label: 'Source',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.source,
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.source}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.status,
      render: (r) =>
        r.kind === 'account' ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <select
            value={r.status}
            onChange={(e) => handleStageChange(r.id, e.target.value)}
            className="px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        ),
    },
    {
      key: 'totalStays',
      label: 'Bookings',
      align: 'right',
      sortable: true,
      sortAccessor: (r) => r.totalStays,
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.totalStays}</span>,
    },
    {
      key: 'totalRevenue',
      label: 'Value',
      align: 'right',
      sortable: true,
      sortAccessor: (r) => r.totalRevenue,
      render: (r) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatAmount(r.totalRevenue)}</span>,
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Customer Relationship Management"
        subtitle="360° customer view across all customer types and lifecycle stages · DB-synced"
        icon={Users}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowAddModal(true)} className={button.primary}>
              <Plus size={16} /> Add Customer
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Customers" value={totalCustomers.toLocaleString()} icon={Users} tone="accent" />
        <StatCard title="Active Accounts" value={activeAccounts.toLocaleString()} icon={Building2} tone="info" />
        <StatCard title="Pipeline Value" value={formatAmount(pipelineValue)} icon={TrendingUp} tone="warning" caption="Open opportunities" />
        <StatCard title="Total Value" value={formatAmount(totalRevenue)} icon={DollarSign} tone="success" caption="Bookings + opportunities" />
      </div>

      <SectionCard
        title="Customer Directory"
        subtitle="Filter by type and search by name, company, or email"
        actions={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        }
      >
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {CUSTOMER_TYPES.map((type) => {
              const count = crmRecords.filter((r) => r.type === type).length;
              const active = filterType === type;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(active ? 'all' : type)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                    active
                      ? `${statusTone.accent.soft} border-[var(--color-accent-operations)]/30`
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
                  }`}
                >
                  {type} ({count})
                </button>
              );
            })}
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                filterType === 'all'
                  ? `${statusTone.accent.soft} border-[var(--color-accent-operations)]/30`
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
              }`}
            >
              All ({crmRecords.length})
            </button>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            rowKey={(row) => row.id}
            sortable
            pagination
            pageSize={10}
            emptyMessage="No CRM records found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setForm(EMPTY_FORM); setError(null); }}
        onConfirm={handleAdd}
        title="New Customer"
        subtitle="Register a new customer or lead in the CRM"
        confirmLabel="Add Customer"
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Customer Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              >
                {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {form.type === 'Individual Guest' && (
              <div>
                <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Source</label>
                <select
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                >
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">
              {form.type === 'Individual Guest' ? 'Full Name' : 'Company / Account Name'}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              placeholder={form.type === 'Individual Guest' ? 'Full name' : 'Company or account name'}
            />
          </div>

          {form.type !== 'Individual Guest' && (
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Primary Contact Person</label>
              <input
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                placeholder="Contact person name"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              />
            </div>
          </div>

          {form.type === 'Individual Guest' && (
            <>
              <div>
                <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Company (optional)</label>
                <input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Opportunity Value</label>
                <input
                  type="number"
                  value={form.opportunityValue}
                  onChange={(e) => setForm({ ...form, opportunityValue: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                  placeholder="0"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default CRM;
