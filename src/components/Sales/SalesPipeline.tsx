import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, TrendingUp, DollarSign, Target, Award,
  Building2, Calendar, LayoutGrid, List, Trash2,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchLeads, createLead, updateLead, deleteLead, fetchSalesAnalytics, type SalesLead, type SalesAnalytics } from '../../services/salesService';

const STAGES = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

const STAGE_TONE: Record<string, string> = {
  Prospect: 'neutral',
  Qualified: 'info',
  Proposal: 'accent',
  Negotiation: 'warning',
  Won: 'success',
  Lost: 'danger',
};

const PRIORITY_TONE: Record<string, string> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'neutral',
};

const SalesPipeline: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [analytics, setAnalytics] = useState<SalesAnalytics | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [deleteTarget, setDeleteTarget] = useState<SalesLead | null>(null);
  const [form, setForm] = useState({
    leadName: '', company: '', contactPerson: '', contactEmail: '', contactPhone: '',
    source: 'Direct', stage: 'Prospect', opportunityValue: 0, expectedCloseDate: '',
    assignedTo: '', priority: 'Medium', notes: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, a] = await Promise.all([fetchLeads(), fetchSalesAnalytics()]);
      setLeads(l);
      setAnalytics(a);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      addNotification('Failed to load pipeline data', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdd = async () => {
    if (!form.leadName.trim()) {
      setError('Lead name is required');
      return;
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
      setError('Invalid email address');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createLead(form);
      addNotification('Lead created', 'success', 'Sales');
      setShowAddModal(false);
      setForm({ leadName: '', company: '', contactPerson: '', contactEmail: '', contactPhone: '', source: 'Direct', stage: 'Prospect', opportunityValue: 0, expectedCloseDate: '', assignedTo: '', priority: 'Medium', notes: '' });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create lead');
      addNotification('Failed to create lead', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStageChange = async (lead: SalesLead, newStage: string) => {
    try {
      const updates: any = { stage: newStage };
      if (newStage === 'Won') updates.conversionDate = new Date().toISOString().split('T')[0];
      if (newStage === 'Lost') updates.lostReason = 'Marked as lost';
      await updateLead(lead.id, updates);
      addNotification(`Lead moved to ${newStage}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update lead');
      addNotification('Failed to update lead stage', 'error', 'Sales');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteLead(deleteTarget.id);
      addNotification('Lead deleted', 'success', 'Sales');
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete lead');
      addNotification('Failed to delete lead', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const leadColumns: Column<SalesLead>[] = [
    {
      key: 'lead_number',
      label: 'Lead #',
      render: (l) => <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">{l.lead_number || l.id.slice(0, 8)}</span>,
    },
    {
      key: 'lead_name',
      label: 'Name',
      sortable: true,
      sortAccessor: (l) => l.lead_name,
      render: (l) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{l.lead_name}</span>,
    },
    {
      key: 'company',
      label: 'Company',
      sortable: true,
      sortAccessor: (l) => l.company || '',
      render: (l) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1">
          {l.company ? <><Building2 size={12} /> {l.company}</> : '—'}
        </span>
      ),
    },
    {
      key: 'stage',
      label: 'Stage',
      align: 'center',
      sortable: true,
      sortAccessor: (l) => l.stage,
      render: (l) => (
        <select
          value={l.stage}
          onChange={(e) => handleStageChange(l, e.target.value)}
          className={`text-[10px] font-bold uppercase tracking-widest border-none outline-none cursor-pointer rounded-lg px-2 py-1 ${statusTone[STAGE_TONE[l.stage] as any]?.soft || statusTone.neutral.soft}`}
        >
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ),
    },
    {
      key: 'opportunity_value',
      label: 'Value',
      align: 'right',
      sortable: true,
      sortAccessor: (l) => l.opportunity_value,
      render: (l) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(l.opportunity_value)}</span>,
    },
    {
      key: 'expected_close_date',
      label: 'Close Date',
      align: 'center',
      sortable: true,
      sortAccessor: (l) => l.expected_close_date || '',
      render: (l) => (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          <Calendar size={12} /> {l.expected_close_date || '—'}
        </span>
      ),
    },
    {
      key: 'assigned_to',
      label: 'Assigned',
      align: 'center',
      sortable: true,
      sortAccessor: (l) => l.assigned_to || '',
      render: (l) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{l.assigned_to || '—'}</span>,
    },
    {
      key: 'priority',
      label: 'Priority',
      align: 'center',
      sortable: true,
      sortAccessor: (l) => l.priority,
      render: (l) => <Badge tone={(PRIORITY_TONE[l.priority] || 'neutral') as any}>{l.priority}</Badge>,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (l) => (
        <button onClick={() => setDeleteTarget(l)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-rose-600" title="Delete">
          <Trash2 size={14} />
        </button>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Sales Pipeline"
        subtitle="Lead-to-contract CRM with stage tracking and conversion analytics · DB-synced · See Opportunities tab for win-probability view"
        icon={TrendingUp}
        actions={
          <>
            <button
              onClick={() => setView(view === 'kanban' ? 'table' : 'kanban')}
              className={button.secondary}
            >
              {view === 'kanban' ? <><List size={16} /> Table View</> : <><LayoutGrid size={16} /> Kanban View</>}
            </button>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowAddModal(true)} className={button.primary}>
              <Plus size={16} /> New Lead
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
        <StatCard title="Total Leads" value={(analytics?.totalLeads ?? '—').toString()} icon={Target} tone="info" />
        <StatCard title="Conversion Rate" value={analytics ? `${analytics.conversionRate.toFixed(1)}%` : '—'} icon={Award} tone="success" />
        <StatCard title="Pipeline Value" value={analytics ? formatAmount(analytics.totalPipelineValue) : '—'} icon={TrendingUp} tone="warning" />
        <StatCard title="Contract Value" value={analytics ? formatAmount(analytics.totalContractValue) : '—'} icon={DollarSign} tone="accent" />
      </div>

      <SectionCard
        title={view === 'kanban' ? 'Pipeline Board' : 'Lead Pipeline'}
        subtitle={view === 'kanban' ? 'Drag-and-stage view by pipeline status' : 'Sortable and filterable lead list'}
      >
        {view === 'kanban' ? (
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 overflow-x-auto">
            {STAGES.map((stage) => {
              const stageLeads = leads.filter((l) => l.stage === stage);
              const stageValue = stageLeads.reduce((s, l) => s + Number(l.opportunity_value || 0), 0);
              return (
                <div key={stage} className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-3 min-w-[200px]">
                  <div className="flex items-center justify-between mb-3">
                    <Badge tone={(STAGE_TONE[stage] as any) || 'neutral'}>{stage}</Badge>
                    <span className="text-[10px] font-black text-slate-400">{stageLeads.length}</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 mb-3">{formatAmount(stageValue)}</p>
                  <div className="space-y-2">
                    {stageLeads.map((lead) => (
                      <div key={lead.id} className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 hover:-translate-y-0.5 hover:card-shadow transition cursor-pointer ${statusTone[STAGE_TONE[lead.stage] as any]?.soft || ''}`}>
                        <p className="text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">{lead.lead_number || lead.id.slice(0, 8)}</p>
                        <p className="text-xs font-semibold text-gray-900 dark:text-white leading-tight mb-1">{lead.lead_name}</p>
                        {lead.company && (
                          <p className="text-[10px] font-medium text-slate-500 flex items-center gap-1">
                            <Building2 size={9} /> {lead.company}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{formatAmount(lead.opportunity_value)}</span>
                          <Badge tone={(PRIORITY_TONE[lead.priority] || 'neutral') as any}>{lead.priority}</Badge>
                        </div>
                        {lead.expected_close_date && (
                          <p className="text-[9px] font-medium text-slate-400 mt-1 flex items-center gap-1">
                            <Calendar size={8} /> {lead.expected_close_date}
                          </p>
                        )}
                        <select
                          value={lead.stage}
                          onChange={(e) => handleStageChange(lead, e.target.value)}
                          className="w-full mt-2 text-[9px] font-bold bg-white/70 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 outline-none"
                        >
                          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    ))}
                    {stageLeads.length === 0 && <p className="text-[9px] text-slate-300 text-center py-4">No leads</p>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6">
            <DataTable
              columns={leadColumns}
              data={leads}
              rowKey={(row) => row.id}
              sortable
              filterable
              filterPlaceholder="Search leads..."
              filterKeys={['lead_name', 'company', 'stage', 'assigned_to']}
              emptyMessage="No leads found."
              containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
            />
          </div>
        )}
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleAdd}
        title="New Sales Lead"
        subtitle="Create a new lead or opportunity in the pipeline"
        confirmLabel="Create Lead"
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Lead Name</label>
              <input value={form.leadName} onChange={(e) => setForm({ ...form, leadName: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Corporate Retreat Inquiry" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Company</label>
              <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Ethiopian Airlines" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contact Person</label>
              <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contact Email</label>
              <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Source</label>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                <option>Direct</option><option>Website</option><option>Referral</option><option>Trade Show</option><option>Corporate</option><option>OTA</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Stage</label>
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {STAGES.filter((s) => s !== 'Lost').map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Opportunity Value ($)</label>
              <input type="number" value={form.opportunityValue} onChange={(e) => setForm({ ...form, opportunityValue: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Expected Close</label>
              <input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
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

      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Lead"
        subtitle={`Are you sure you want to delete "${deleteTarget?.lead_name}"? This action cannot be undone.`}
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

export default SalesPipeline;
