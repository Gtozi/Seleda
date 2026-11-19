import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Megaphone, DollarSign, BarChart3, Zap,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchCampaigns, createCampaign, updateCampaign, type Campaign } from '../../services/salesService';

const CAMPAIGN_TYPES = ['Email Campaign', 'SMS Campaign', 'Social Media Campaign', 'Seasonal Promotion', 'Holiday Promotion', 'Loyalty Campaign', 'Referral Campaign', 'Corporate Campaign'];

const CAMPAIGN_TONE: Record<string, string> = {
  'Email Campaign': 'info',
  'SMS Campaign': 'info',
  'Social Media Campaign': 'accent',
  'Seasonal Promotion': 'warning',
  'Holiday Promotion': 'warning',
  'Loyalty Campaign': 'success',
  'Referral Campaign': 'success',
  'Corporate Campaign': 'accent',
};

const STATUS_TONE: Record<string, string> = {
  Active: 'success',
  Scheduled: 'info',
  Completed: 'neutral',
  Draft: 'warning',
  Paused: 'danger',
};

const EMPTY_FORM = {
  name: '',
  type: 'Email Campaign',
  audience: '',
  budget: 0,
  startDate: '',
  endDate: '',
};

const MarketingCampaigns: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCampaigns(await fetchCampaigns());
    } catch (err: any) {
      setError(err.message || 'Failed to load campaigns');
      addNotification('Failed to load campaigns', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError('Campaign name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createCampaign({
        campaignName: form.name,
        campaignType: form.type,
        audience: form.audience,
        budget: form.budget,
        startDate: form.startDate,
        endDate: form.endDate,
        status: 'Draft',
      });
      addNotification('Campaign created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create campaign');
      addNotification('Failed to create campaign', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (campaign: Campaign, status: string) => {
    try {
      await updateCampaign(campaign.id, { status });
      addNotification(`Campaign status updated to ${status}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update campaign');
      addNotification('Failed to update campaign', 'error', 'Sales');
    }
  };

  const activeCount = useMemo(() => campaigns.filter((c) => c.status === 'Active').length, [campaigns]);
  const totalBudget = useMemo(() => campaigns.reduce((s, c) => s + Number(c.budget || 0), 0), [campaigns]);
  const totalLeads = useMemo(() => campaigns.reduce((s, c) => s + Number(c.leads || 0), 0), [campaigns]);

  const columns: Column<Campaign>[] = [
    {
      key: 'campaign_name',
      label: 'Campaign',
      sortable: true,
      sortAccessor: (c) => c.campaign_name,
      render: (c) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
            <Megaphone size={12} />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{c.campaign_name}</span>
        </div>
      ),
    },
    {
      key: 'campaign_type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.campaign_type || '',
      render: (c) => <Badge tone={(CAMPAIGN_TONE[c.campaign_type || ''] || 'neutral') as any}>{c.campaign_type || '—'}</Badge>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.status,
      render: (c) => <Badge tone={(STATUS_TONE[c.status] || 'neutral') as any}>{c.status}</Badge>,
    },
    {
      key: 'audience',
      label: 'Audience',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.audience || '',
      render: (c) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{c.audience || '—'}</span>,
    },
    {
      key: 'budget',
      label: 'Budget',
      align: 'right',
      sortable: true,
      sortAccessor: (c) => c.budget,
      render: (c) => <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{formatAmount(c.budget)}</span>,
    },
    {
      key: 'spent',
      label: 'Spent',
      align: 'right',
      sortable: true,
      sortAccessor: (c) => c.spent,
      render: (c) => <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{formatAmount(c.spent)}</span>,
    },
    {
      key: 'leads',
      label: 'Leads',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.leads,
      render: (c) => <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{c.leads}</span>,
    },
    {
      key: 'conversions',
      label: 'Conv.',
      align: 'center',
      sortable: true,
      sortAccessor: (c) => c.conversions,
      render: (c) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{c.conversions}</span>,
    },
    {
      key: 'roi',
      label: 'ROI',
      align: 'center',
      sortable: false,
      render: (c) => {
        const roi = c.spent > 0 ? ((c.conversions * 500 - c.spent) / c.spent * 100) : 0;
        return <span className={`text-xs font-black ${roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{roi.toFixed(0)}%</span>;
      },
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (c) => (
        <div className="flex justify-end gap-1">
          {c.status !== 'Active' && c.status !== 'Completed' && (
            <button onClick={() => handleStatusChange(c, 'Active')} className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase hover:bg-emerald-100 transition">Activate</button>
          )}
          {c.status !== 'Paused' && c.status !== 'Completed' && (
            <button onClick={() => handleStatusChange(c, 'Paused')} className="px-2 py-1 rounded-lg bg-amber-50 text-amber-600 text-[9px] font-black uppercase hover:bg-amber-100 transition">Pause</button>
          )}
          {c.status !== 'Completed' && (
            <button onClick={() => handleStatusChange(c, 'Completed')} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[9px] font-black uppercase hover:bg-slate-200 transition">Complete</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Marketing Campaigns"
        subtitle="Campaign types, audience selection, scheduling, automation, budget tracking, and performance analytics · DB-synced"
        icon={Megaphone}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Campaign
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
        <StatCard title="Total Campaigns" value={campaigns.length.toLocaleString()} icon={Megaphone} tone="info" />
        <StatCard title="Active" value={activeCount.toLocaleString()} icon={Zap} tone="success" />
        <StatCard title="Total Budget" value={formatAmount(totalBudget)} icon={DollarSign} tone="warning" />
        <StatCard title="Total Leads" value={totalLeads.toLocaleString()} icon={BarChart3} tone="accent" />
      </div>

      <SectionCard title="Campaign Performance" subtitle="All campaigns, budgets, leads, and conversions">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={campaigns}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search campaigns..."
            filterKeys={['campaign_name', 'campaign_type', 'status', 'audience']}
            emptyMessage="No marketing campaigns created yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="New Marketing Campaign"
        subtitle="Create a campaign with audience and budget"
        confirmLabel="Create Campaign"
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Campaign Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Summer Getaway Promotion" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Campaign Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Target Audience</label>
            <input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Past guests, Corporate clients" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Budget ($)</label>
            <input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
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

export default MarketingCampaigns;
