import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Target, TrendingUp, DollarSign,
  Trophy, Building2, Calendar,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchLeads, createLead, type SalesLead } from '../../services/salesService';

const STAGES = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

const STAGE_TONE: Record<string, string> = {
  Prospect: 'neutral',
  Qualified: 'info',
  Proposal: 'accent',
  Negotiation: 'warning',
  Won: 'success',
  Lost: 'danger',
};

const WIN_PROBABILITY: Record<string, number> = {
  Prospect: 10, Qualified: 25, Proposal: 50, Negotiation: 75, Won: 100, Lost: 0,
};

const STAGE_BAR: Record<string, string> = {
  Prospect: 'bg-slate-400',
  Qualified: 'bg-[var(--color-info)]',
  Proposal: 'bg-[var(--color-accent-operations)]',
  Negotiation: 'bg-[var(--color-warning)]',
  Won: 'bg-[var(--color-success)]',
};

const EMPTY_FORM = {
  leadName: '',
  company: '',
  opportunityValue: 0,
  expectedCloseDate: '',
  stage: 'Prospect',
  competitor: '',
  assignedTo: '',
  notes: '',
};

const OpportunityManagement: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeads(await fetchLeads());
    } catch (err: any) {
      setError(err.message || 'Failed to load opportunities');
      addNotification('Failed to load opportunities', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const opportunities = useMemo(() => leads.filter((l) => l.stage !== 'Lost'), [leads]);
  const openOpportunities = useMemo(() => opportunities.filter((l) => l.stage !== 'Won'), [opportunities]);
  const wonDeals = useMemo(() => opportunities.filter((l) => l.stage === 'Won'), [opportunities]);

  const totalValue = useMemo(() => opportunities.reduce((s, o) => s + Number(o.opportunity_value || 0), 0), [opportunities]);
  const weightedValue = useMemo(() =>
    openOpportunities.reduce((s, o) => s + Number(o.opportunity_value || 0) * (WIN_PROBABILITY[o.stage] || 0) / 100, 0),
  [openOpportunities]);

  const handleAdd = async () => {
    if (!form.leadName.trim()) {
      setError('Opportunity name is required');
      return;
    }

    setSaving(true);
    setError(null);

    const notes = [
      form.notes,
      form.competitor ? `Competitor: ${form.competitor}` : '',
    ].filter(Boolean).join('\n');

    try {
      await createLead({
        leadName: form.leadName,
        company: form.company,
        opportunityValue: form.opportunityValue,
        expectedCloseDate: form.expectedCloseDate,
        stage: form.stage,
        assignedTo: form.assignedTo,
        priority: 'Medium',
        source: 'Direct',
        contactPerson: '',
        contactEmail: '',
        contactPhone: '',
        notes,
      });
      addNotification('Opportunity created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create opportunity');
      addNotification('Failed to create opportunity', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<SalesLead>[] = [
    {
      key: 'lead_name',
      label: 'Opportunity',
      sortable: true,
      sortAccessor: (o) => o.lead_name,
      render: (o) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{o.lead_name}</span>,
    },
    {
      key: 'company',
      label: 'Account',
      sortable: true,
      sortAccessor: (o) => o.company || '',
      render: (o) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1">
          {o.company ? <><Building2 size={12} /> {o.company}</> : '—'}
        </span>
      ),
    },
    {
      key: 'stage',
      label: 'Stage',
      align: 'center',
      sortable: true,
      sortAccessor: (o) => o.stage,
      render: (o) => <Badge tone={(STAGE_TONE[o.stage] as any) || 'neutral'}>{o.stage}</Badge>,
    },
    {
      key: 'winProbability',
      label: 'Win Prob',
      align: 'center',
      sortable: true,
      sortAccessor: (o) => WIN_PROBABILITY[o.stage] || 0,
      render: (o) => {
        const prob = WIN_PROBABILITY[o.stage] || 0;
        const tone = prob >= 75 ? 'success' : prob >= 50 ? 'warning' : 'neutral';
        return <Badge tone={tone as any}>{prob}%</Badge>;
      },
    },
    {
      key: 'opportunity_value',
      label: 'Value',
      align: 'right',
      sortable: true,
      sortAccessor: (o) => o.opportunity_value,
      render: (o) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(o.opportunity_value)}</span>,
    },
    {
      key: 'expected_close_date',
      label: 'Close Date',
      align: 'center',
      sortable: true,
      sortAccessor: (o) => o.expected_close_date || '',
      render: (o) => (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          <Calendar size={12} /> {o.expected_close_date || '—'}
        </span>
      ),
    },
    {
      key: 'assigned_to',
      label: 'Owner',
      align: 'center',
      sortable: true,
      sortAccessor: (o) => o.assigned_to || '',
      render: (o) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{o.assigned_to || '—'}</span>,
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Opportunity Management"
        subtitle="Sales funnel, revenue forecast, win probability, and competitor tracking · DB-synced · See Sales Pipeline tab for kanban board view"
        icon={Target}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Opportunity
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
        <StatCard title="Open Opportunities" value={openOpportunities.length.toLocaleString()} icon={Target} tone="info" />
        <StatCard title="Total Pipeline" value={formatAmount(totalValue)} icon={DollarSign} tone="success" />
        <StatCard title="Weighted Forecast" value={formatAmount(weightedValue)} icon={TrendingUp} tone="warning" />
        <StatCard title="Won Deals" value={wonDeals.length.toLocaleString()} icon={Trophy} tone="accent" />
      </div>

      <SectionCard title="Sales Funnel" subtitle="Deal distribution and value by pipeline stage">
        <div className="p-6 space-y-2">
          {STAGES.filter((s) => s !== 'Lost').map((stage) => {
            const stageOps = opportunities.filter((o) => o.stage === stage);
            const stageValue = stageOps.reduce((s, o) => s + Number(o.opportunity_value || 0), 0);
            const maxWidth = totalValue > 0 ? (stageValue / totalValue) * 100 : 0;
            return (
              <div key={stage} className="flex items-center gap-4">
                <div className="w-24 text-right">
                  <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">{stage}</span>
                </div>
                <div className="flex-1 bg-slate-50 dark:bg-slate-950 rounded-xl h-8 relative overflow-hidden">
                  <div
                    className={`h-full ${STAGE_BAR[stage]} rounded-xl flex items-center px-3 transition-all`}
                    style={{ width: `${Math.max(maxWidth, 5)}%` }}
                  >
                    <span className="text-[9px] font-black text-white whitespace-nowrap">{stageOps.length} deals</span>
                  </div>
                </div>
                <div className="w-28 text-right">
                  <span className="text-xs font-semibold text-gray-900 dark:text-white">{formatAmount(stageValue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Opportunities" subtitle="Live lead data excluding lost deals">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={opportunities}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search opportunities..."
            filterKeys={['lead_name', 'company', 'stage', 'assigned_to']}
            emptyMessage="No opportunities found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleAdd}
        title="New Opportunity"
        subtitle="Create a sales opportunity with forecast and competitor notes"
        confirmLabel="Create Opportunity"
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Opportunity Name</label>
              <input value={form.leadName} onChange={(e) => setForm({ ...form, leadName: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Company / Account</label>
              <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Value ($)</label>
              <input type="number" value={form.opportunityValue} onChange={(e) => setForm({ ...form, opportunityValue: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Stage</label>
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {STAGES.filter((s) => s !== 'Lost').map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Expected Close</label>
              <input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Competitor</label>
              <input value={form.competitor} onChange={(e) => setForm({ ...form, competitor: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Competitor Hotel" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Assigned To</label>
              <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default OpportunityManagement;
