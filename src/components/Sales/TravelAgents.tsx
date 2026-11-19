import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  RefreshCw,
  Plane,
  Percent,
  FileText,
  TrendingUp,
  Search,
  Pencil,
  DollarSign,
  Mail,
  Phone,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { DataTable, Column } from '../Shared/DataTable';
import { ModalSystem } from '../Shared/ModalSystem';
import {
  fetchTravelAgents,
  createTravelAgent,
  updateTravelAgent,
  type TravelAgentRecord,
} from '../../services/salesService';

interface AgentMetrics {
  commissionRate: number;
  totalBookings: number;
  totalRevenue: number;
  productionScore: number;
  notesText: string;
}

interface TravelAgentDisplay extends TravelAgentRecord {
  metrics: AgentMetrics;
  contractStatus: string;
}

const CONTRACT_STATUSES = ['Active', 'Pending', 'Expired', 'Inactive'];
const COMMISSION_MODELS = ['net', 'commissionable'];
const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Prepaid'];

const EMPTY_FORM = {
  name: '',
  code: '',
  contactName: '',
  email: '',
  phone: '',
  commissionRate: 10,
  commissionModel: 'commissionable' as 'net' | 'commissionable',
  contractStatus: 'Active',
  paymentTerms: 'Net 30',
  creditLimit: 0,
  totalBookings: 0,
  totalRevenue: 0,
  productionScore: 0,
  notesText: '',
};

function parseNotes(notes: string | null): AgentMetrics {
  if (!notes) return { commissionRate: 0, totalBookings: 0, totalRevenue: 0, productionScore: 0, notesText: '' };
  try {
    const parsed = JSON.parse(notes);
    return {
      commissionRate: Number(parsed.commissionRate) || 0,
      totalBookings: Number(parsed.totalBookings) || 0,
      totalRevenue: Number(parsed.totalRevenue) || 0,
      productionScore: Number(parsed.productionScore) || 0,
      notesText: String(parsed.notesText || ''),
    };
  } catch {
    return { commissionRate: 0, totalBookings: 0, totalRevenue: 0, productionScore: 0, notesText: notes };
  }
}

function serializeNotes(form: typeof EMPTY_FORM) {
  return JSON.stringify({
    commissionRate: form.commissionRate,
    totalBookings: form.totalBookings,
    totalRevenue: form.totalRevenue,
    productionScore: form.productionScore,
    notesText: form.notesText,
  });
}

function recordToForm(record: TravelAgentRecord): typeof EMPTY_FORM {
  const metrics = parseNotes(record.notes);
  return {
    name: record.name,
    code: record.code,
    contactName: record.contact_name || '',
    email: record.contact_email || '',
    phone: record.contact_phone || '',
    commissionRate: metrics.commissionRate,
    commissionModel: record.commission_model || 'commissionable',
    contractStatus: record.is_active ? 'Active' : 'Inactive',
    paymentTerms: record.payment_terms || 'Net 30',
    creditLimit: record.credit_limit || 0,
    totalBookings: metrics.totalBookings,
    totalRevenue: metrics.totalRevenue,
    productionScore: metrics.productionScore,
    notesText: metrics.notesText,
  };
}

function formToPayload(form: typeof EMPTY_FORM, existingId?: string) {
  return {
    id: existingId,
    code: form.code,
    name: form.name,
    contact_name: form.contactName,
    contact_email: form.email,
    contact_phone: form.phone,
    commission_model: form.commissionModel,
    payment_terms: form.paymentTerms,
    credit_limit: form.creditLimit,
    is_active: form.contractStatus === 'Active',
    notes: serializeNotes(form),
  };
}

function getStatusTone(status: string) {
  switch (status) {
    case 'Active': return 'success';
    case 'Pending': return 'warning';
    case 'Expired': return 'danger';
    case 'Inactive': return 'neutral';
    default: return 'neutral';
  }
}

function productionTone(score: number) {
  if (score >= 90) return 'accent';
  if (score >= 70) return 'info';
  if (score >= 50) return 'warning';
  return 'neutral';
}

const TravelAgents: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<TravelAgentDisplay[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTravelAgents();
      const mapped: TravelAgentDisplay[] = (data || []).map((a) => ({
        ...a,
        metrics: parseNotes(a.notes),
        contractStatus: a.is_active ? 'Active' : 'Inactive',
      }));
      setAgents(mapped);
    } catch (err: any) {
      setError(err.message || 'Failed to load travel agents');
      addNotification('Failed to load travel agents', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let data = agents;
    if (statusFilter !== 'all') {
      data = data.filter((a) => a.contractStatus === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      data = data.filter((a) =>
        [a.name, a.code, a.contact_name, a.contact_email, a.contact_phone, a.commission_model, a.payment_terms]
          .some((v) => (v || '').toLowerCase().includes(q))
      );
    }
    return data;
  }, [agents, statusFilter, search]);

  const totalAgencies = agents.length;
  const activeContracts = agents.filter((a) => a.contractStatus === 'Active').length;
  const avgCommission = agents.length > 0
    ? agents.reduce((s, a) => s + a.metrics.commissionRate, 0) / agents.length
    : 0;
  const totalRevenue = agents.reduce((s, a) => s + a.metrics.totalRevenue, 0);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      setError('Agency name and code are required');
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Invalid email address');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createTravelAgent(formToPayload(form));
      addNotification('Travel agent created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create travel agent');
      addNotification('Failed to create travel agent', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingId) return;
    if (!form.name.trim() || !form.code.trim()) {
      setError('Agency name and code are required');
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Invalid email address');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateTravelAgent(editingId, formToPayload(form, editingId));
      addNotification('Travel agent updated', 'success', 'Sales');
      setShowEditModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update travel agent');
      addNotification('Failed to update travel agent', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (agent: TravelAgentDisplay) => {
    setForm(recordToForm(agent));
    setEditingId(agent.id);
    setShowEditModal(true);
    setError(null);
  };

  const columns: Column<TravelAgentDisplay>[] = [
    {
      key: 'name',
      label: 'Agency',
      sortable: true,
      sortAccessor: (a) => a.name,
      render: (a) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
            <Plane size={14} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{a.name}</div>
            <div className="text-[10px] font-medium text-slate-400">{a.code}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'contact_name',
      label: 'Contact',
      sortable: true,
      sortAccessor: (a) => a.contact_name || '',
      render: (a) => <span className="text-sm text-slate-600 dark:text-slate-400">{a.contact_name || '—'}</span>,
    },
    {
      key: 'contact_email',
      label: 'Email',
      sortable: true,
      sortAccessor: (a) => a.contact_email || '',
      render: (a) => (
        <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
          <Mail size={12} />
          {a.contact_email || '—'}
        </div>
      ),
    },
    {
      key: 'contact_phone',
      label: 'Phone',
      render: (a) => (
        <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
          <Phone size={12} />
          {a.contact_phone || '—'}
        </div>
      ),
    },
    {
      key: 'commissionRate',
      label: 'Commission',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.metrics.commissionRate,
      render: (a) => (
        <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center justify-end gap-1">
          <Percent size={12} /> {a.metrics.commissionRate}%
        </span>
      ),
    },
    {
      key: 'contractStatus',
      label: 'Contract',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.contractStatus,
      render: (a) => <Badge tone={getStatusTone(a.contractStatus) as any}>{a.contractStatus}</Badge>,
    },
    {
      key: 'totalBookings',
      label: 'Bookings',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.metrics.totalBookings,
      render: (a) => <span className="text-sm text-slate-600 dark:text-slate-400">{a.metrics.totalBookings}</span>,
    },
    {
      key: 'totalRevenue',
      label: 'Revenue',
      align: 'right',
      sortable: true,
      sortAccessor: (a) => a.metrics.totalRevenue,
      render: (a) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatAmount(a.metrics.totalRevenue)}</span>,
    },
    {
      key: 'productionScore',
      label: 'Score',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.metrics.productionScore,
      render: (a) => <Badge tone={productionTone(a.metrics.productionScore) as any}>{a.metrics.productionScore}</Badge>,
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
      key: 'payment_terms',
      label: 'Terms',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.payment_terms || '',
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.payment_terms || '—'}</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (a) => (
        <button
          onClick={() => openEdit(a)}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-[var(--color-accent-operations)] transition"
          title="Edit"
        >
          <Pencil size={16} />
        </button>
      ),
    },
  ];

  const renderForm = () => (
    <div className="p-6 space-y-4">
      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Agency Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Code</label>
          <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contact Person</label>
          <input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Email</label>
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Phone</label>
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Commission Rate (%)</label>
          <input type="number" value={form.commissionRate} onChange={e => setForm({ ...form, commissionRate: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Commission Model</label>
          <select value={form.commissionModel} onChange={e => setForm({ ...form, commissionModel: e.target.value as any })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
            {COMMISSION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contract Status</label>
          <select value={form.contractStatus} onChange={e => setForm({ ...form, contractStatus: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
            {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Payment Terms</label>
          <select value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
            {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Credit Limit ($)</label>
          <input type="number" value={form.creditLimit} onChange={e => setForm({ ...form, creditLimit: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Production Score</label>
          <input type="number" min={0} max={100} value={form.productionScore} onChange={e => setForm({ ...form, productionScore: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Bookings</label>
          <input type="number" value={form.totalBookings} onChange={e => setForm({ ...form, totalBookings: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Revenue ($)</label>
          <input type="number" value={form.totalRevenue} onChange={e => setForm({ ...form, totalRevenue: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
        <textarea value={form.notesText} onChange={e => setForm({ ...form, notesText: e.target.value })} rows={3} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
      </div>
    </div>
  );

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Travel Agent Management"
        subtitle="Agency profiles, commission plans, contracts, and production reports · DB-synced"
        icon={Plane}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> Add Agency
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
        <StatCard title="Total Agencies" value={totalAgencies.toLocaleString()} icon={Plane} tone="accent" />
        <StatCard title="Active Contracts" value={activeContracts.toLocaleString()} icon={FileText} tone="success" />
        <StatCard title="Avg Commission" value={`${avgCommission.toFixed(1)}%`} icon={Percent} tone="info" />
        <StatCard title="Total Revenue" value={formatAmount(totalRevenue)} icon={DollarSign} tone="warning" />
      </div>

      <SectionCard
        title="Agency Directory"
        subtitle="Filter by contract status and search by agency, contact, or terms"
        actions={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agencies..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        }
      >
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {['all', ...CONTRACT_STATUSES].map((status) => {
              const count = status === 'all' ? agents.length : agents.filter((a) => a.contractStatus === status).length;
              const active = statusFilter === status;
              const tone = status === 'all' ? 'accent' : getStatusTone(status);
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                    active
                      ? `${statusTone[tone as any]?.soft || statusTone.accent.soft} border-[var(--color-accent-operations)]/30`
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
                  }`}
                >
                  {status === 'all' ? 'All' : status} ({count})
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
            emptyMessage="No travel agents found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleAdd}
        title="New Travel Agency"
        subtitle="Register a travel agency with commission plan and production metrics"
        confirmLabel="Add Agency"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="lg"
      >
        {renderForm()}
      </ModalSystem>

      <ModalSystem
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setEditingId(null); setForm(EMPTY_FORM); setError(null); }}
        onConfirm={handleEdit}
        title="Edit Travel Agency"
        subtitle="Update agency details, commission, and performance metrics"
        confirmLabel="Save Changes"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="lg"
      >
        {renderForm()}
      </ModalSystem>
    </div>
  );
};

export default TravelAgents;
