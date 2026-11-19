import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, FileText, FileSignature, CheckCircle2, XCircle,
  ChevronRight, Calendar, Users, DollarSign, ArrowRight, Zap,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import {
  fetchProposals, createProposal, updateProposal,
  fetchContracts, createContract, updateContract,
  createGroupBlock, createBEO,
  fetchLeads,
  type Proposal, type Contract, type SalesLead,
} from '../../services/salesService';

const PROPOSAL_TONE: Record<string, string> = {
  Draft: 'neutral',
  Sent: 'info',
  Accepted: 'success',
  Rejected: 'danger',
};

const CONTRACT_TONE: Record<string, string> = {
  Active: 'success',
  Completed: 'neutral',
  Cancelled: 'danger',
  Pending: 'warning',
};

const ProposalContract: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [showPropModal, setShowPropModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [propForm, setPropForm] = useState({
    leadId: '', title: '', eventType: 'Conference', eventDates: '',
    guestCount: 0, roomNights: 0, proposedRevenue: 0, discountPercent: 0,
    validUntil: '', termsConditions: 'Standard terms and conditions apply.', notes: '',
  });
  const [contractForm, setContractForm] = useState({
    proposalId: '', leadId: '', title: '', eventType: '', startDate: '', endDate: '',
    guestCount: 0, roomNights: 0, totalValue: 0, depositAmount: 0,
    terms: 'Contract terms per signed agreement.', signedByClient: '', signedDate: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, l] = await Promise.all([fetchProposals(), fetchContracts(), fetchLeads()]);
      setProposals(p);
      setContracts(c);
      setLeads(l);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      addNotification('Failed to load proposals and contracts', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateProposal = async () => {
    if (!propForm.title.trim()) {
      setError('Proposal title is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createProposal(propForm);
      addNotification('Proposal created', 'success', 'Sales');
      setShowPropModal(false);
      setPropForm({ leadId: '', title: '', eventType: 'Conference', eventDates: '', guestCount: 0, roomNights: 0, proposedRevenue: 0, discountPercent: 0, validUntil: '', termsConditions: 'Standard terms and conditions apply.', notes: '' });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create proposal');
      addNotification('Failed to create proposal', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleSendProposal = async (prop: Proposal) => {
    try {
      await updateProposal(prop.id, { status: 'Sent', sentDate: new Date().toISOString().split('T')[0] });
      addNotification('Proposal marked as sent', 'info', 'Sales');
      loadData();
    } catch (err: any) { setError(err.message || 'Failed to send proposal'); addNotification('Failed to send proposal', 'error', 'Sales'); }
  };

  const handleAcceptProposal = async (prop: Proposal) => {
    try {
      await updateProposal(prop.id, { status: 'Accepted', acceptedDate: new Date().toISOString().split('T')[0] });
      addNotification('Proposal accepted', 'success', 'Sales');
      loadData();
    } catch (err: any) { setError(err.message || 'Failed to accept proposal'); addNotification('Failed to accept proposal', 'error', 'Sales'); }
  };

  const handleRejectProposal = async (prop: Proposal) => {
    try {
      await updateProposal(prop.id, { status: 'Rejected', rejectedDate: new Date().toISOString().split('T')[0] });
      addNotification('Proposal rejected', 'error', 'Sales');
      loadData();
    } catch (err: any) { setError(err.message || 'Failed to reject proposal'); addNotification('Failed to reject proposal', 'error', 'Sales'); }
  };

  const handleCreateContract = async () => {
    if (!contractForm.title.trim()) {
      setError('Contract title is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createContract(contractForm);
      addNotification('Contract created', 'success', 'Sales');
      setShowContractModal(false);
      setContractForm({ proposalId: '', leadId: '', title: '', eventType: '', startDate: '', endDate: '', guestCount: 0, roomNights: 0, totalValue: 0, depositAmount: 0, terms: 'Contract terms per signed agreement.', signedByClient: '', signedDate: '' });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create contract');
      addNotification('Failed to create contract', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateGroupBlock = async (contract: Contract) => {
    try { await createGroupBlock(contract.id); addNotification('Group block created', 'success', 'Sales'); loadData(); }
    catch (err: any) { setError(err.message || 'Failed to create group block'); addNotification('Failed to create group block', 'error', 'Sales'); }
  };

  const handleCreateBEO = async (contract: Contract) => {
    try { await createBEO(contract.id); addNotification('BEO created', 'success', 'Sales'); loadData(); }
    catch (err: any) { setError(err.message || 'Failed to create BEO'); addNotification('Failed to create BEO', 'error', 'Sales'); }
  };

  const draftValue = proposals
    .filter((p) => p.status === 'Draft')
    .reduce((s, p) => s + Number(p.proposed_revenue || 0), 0);
  const activeContractValue = contracts
    .filter((c) => c.status === 'Active')
    .reduce((s, c) => s + Number(c.total_value || 0), 0);

  const propColumns: Column<Proposal>[] = [
    {
      key: 'proposal_number',
      label: 'Proposal #',
      render: (p) => <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">{p.proposal_number || p.id.slice(0, 8)}</span>,
    },
    {
      key: 'title',
      label: 'Title',
      sortable: true,
      sortAccessor: (p) => p.title,
      render: (p) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{p.title}</span>,
    },
    {
      key: 'lead',
      label: 'Lead',
      sortable: true,
      sortAccessor: (p) => p.sales_leads?.lead_name || '',
      render: (p) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{p.sales_leads?.lead_name || '—'}</span>,
    },
    {
      key: 'event_type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.event_type || '',
      render: (p) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{p.event_type || '—'}</span>,
    },
    {
      key: 'proposed_revenue',
      label: 'Revenue',
      align: 'right',
      sortable: true,
      sortAccessor: (p) => p.proposed_revenue,
      render: (p) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(p.proposed_revenue)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (p) => p.status,
      render: (p) => <Badge tone={(PROPOSAL_TONE[p.status] || 'neutral') as any}>{p.status}</Badge>,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'center',
      sortable: false,
      render: (p) => (
        <div className="flex justify-center gap-1">
          {p.status === 'Draft' && (
            <button onClick={() => handleSendProposal(p)} className="p-1.5 text-slate-400 hover:text-[var(--color-info)] transition" title="Send">
              <ArrowRight size={14} />
            </button>
          )}
          {p.status === 'Sent' && (
            <>
              <button onClick={() => handleAcceptProposal(p)} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Accept"><CheckCircle2 size={14} /></button>
              <button onClick={() => handleRejectProposal(p)} className="p-1.5 text-slate-400 hover:text-rose-500 transition" title="Reject"><XCircle size={14} /></button>
            </>
          )}
        </div>
      ),
    },
  ];

  const contractColumns: Column<Contract>[] = [
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
      key: 'account',
      label: 'Account',
      sortable: true,
      sortAccessor: (c) => c.corporate_accounts?.company_name || '',
      render: (c) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{c.corporate_accounts?.company_name || c.sales_proposals?.title || '—'}</span>,
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
      render: (c) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1"><Calendar size={12} /> {c.start_date || '—'}</span>,
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
      key: 'handoff',
      label: 'Handoff',
      align: 'center',
      sortable: false,
      render: (c) => (
        <div className="flex justify-center gap-1">
          {!c.group_block_id ? (
            <button onClick={() => handleCreateGroupBlock(c)} className="p-1.5 text-slate-400 hover:text-[var(--color-accent-operations)] transition" title="Create Group Block"><Users size={14} /></button>
          ) : (
            <span className="px-1.5 py-0.5 bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] rounded text-[9px] font-black uppercase">Block</span>
          )}
          {!c.beo_id ? (
            <button onClick={() => handleCreateBEO(c)} className="p-1.5 text-slate-400 hover:text-[var(--color-warning)] transition" title="Create BEO"><Zap size={14} /></button>
          ) : (
            <span className="px-1.5 py-0.5 bg-[var(--color-warning)]/10 text-[var(--color-warning)] rounded text-[9px] font-black uppercase">BEO</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Proposals & Contracts"
        subtitle="Generate proposals, convert to contracts, create group blocks and BEOs · DB-synced"
        icon={FileText}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setContractForm({ proposalId: '', leadId: '', title: '', eventType: '', startDate: '', endDate: '', guestCount: 0, roomNights: 0, totalValue: 0, depositAmount: 0, terms: 'Contract terms per signed agreement.', signedByClient: '', signedDate: '' }); setShowContractModal(true); setError(null); }} className={button.secondary}>
              <FileSignature size={16} /> New Contract
            </button>
            <button onClick={() => { setPropForm({ leadId: '', title: '', eventType: 'Conference', eventDates: '', guestCount: 0, roomNights: 0, proposedRevenue: 0, discountPercent: 0, validUntil: '', termsConditions: 'Standard terms and conditions apply.', notes: '' }); setShowPropModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Proposal
            </button>
          </>
        }
      />

      {error && !showPropModal && !showContractModal && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Proposals" value={proposals.length.toLocaleString()} icon={FileText} tone="info" />
        <StatCard title="Draft Value" value={formatAmount(draftValue)} icon={DollarSign} tone="warning" />
        <StatCard title="Active Contracts" value={contracts.filter((c) => c.status === 'Active').length.toLocaleString()} icon={FileSignature} tone="success" />
        <StatCard title="Contract Value" value={formatAmount(activeContractValue)} icon={DollarSign} tone="accent" />
      </div>

      <SectionCard title={`Proposals (${proposals.length})`} subtitle="Draft, sent, accepted, and rejected proposals" icon={FileText}>
        <div className="p-6">
          <DataTable
            columns={propColumns}
            data={proposals}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search proposals..."
            filterKeys={['title', 'status', 'event_type']}
            emptyMessage="No proposals yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <SectionCard title={`Contracts (${contracts.length})`} subtitle="Active and completed contracts with handoff status" icon={FileSignature}>
        <div className="p-6">
          <DataTable
            columns={contractColumns}
            data={contracts}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search contracts..."
            filterKeys={['title', 'status', 'contract_number']}
            emptyMessage="No contracts yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      {/* Proposal Modal */}
      <ModalSystem
        isOpen={showPropModal}
        onClose={() => { setShowPropModal(false); setError(null); }}
        onConfirm={handleCreateProposal}
        title="New Proposal"
        subtitle="Generate a proposal from a lead"
        confirmLabel="Create Proposal"
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

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Select Lead</label>
            <select value={propForm.leadId} onChange={(e) => setPropForm({ ...propForm, leadId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
              <option value="">— Select Lead —</option>
              {leads.filter((l) => l.stage !== 'Lost').map((l) => (
                <option key={l.id} value={l.id}>{l.lead_name} ({l.company || '—'}) — {formatAmount(l.opportunity_value)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Proposal Title</label>
            <input value={propForm.title} onChange={(e) => setPropForm({ ...propForm, title: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Annual Corporate Retreat Package" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Event Type</label>
              <select value={propForm.eventType} onChange={(e) => setPropForm({ ...propForm, eventType: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                <option>Conference</option><option>Wedding</option><option>Corporate Retreat</option><option>Banquet</option><option>Meeting</option><option>Other</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Event Dates</label>
              <input value={propForm.eventDates} onChange={(e) => setPropForm({ ...propForm, eventDates: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Mar 15-18, 2026" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Guests</label>
              <input type="number" value={propForm.guestCount} onChange={(e) => setPropForm({ ...propForm, guestCount: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Room Nights</label>
              <input type="number" value={propForm.roomNights} onChange={(e) => setPropForm({ ...propForm, roomNights: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Revenue ($)</label>
              <input type="number" value={propForm.proposedRevenue} onChange={(e) => setPropForm({ ...propForm, proposedRevenue: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Discount (%)</label>
              <input type="number" value={propForm.discountPercent} onChange={(e) => setPropForm({ ...propForm, discountPercent: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Valid Until</label>
              <input type="date" value={propForm.validUntil} onChange={(e) => setPropForm({ ...propForm, validUntil: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Terms & Conditions</label>
              <input value={propForm.termsConditions} onChange={(e) => setPropForm({ ...propForm, termsConditions: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
            <textarea value={propForm.notes} onChange={(e) => setPropForm({ ...propForm, notes: e.target.value })} rows={2} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>

      {/* Contract Modal */}
      <ModalSystem
        isOpen={showContractModal}
        onClose={() => { setShowContractModal(false); setError(null); }}
        onConfirm={handleCreateContract}
        title="New Contract"
        subtitle="Convert accepted proposal to contract"
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

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Select Accepted Proposal</label>
            <select value={contractForm.proposalId} onChange={(e) => {
              const prop = proposals.find((p) => p.id === e.target.value);
              setContractForm({
                ...contractForm,
                proposalId: e.target.value,
                leadId: prop?.lead_id || '',
                title: prop?.title || '',
                eventType: prop?.event_type || '',
                guestCount: prop?.guest_count || 0,
                roomNights: prop?.room_nights || 0,
                totalValue: prop?.proposed_revenue || 0,
              });
            }} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
              <option value="">— Select Proposal —</option>
              {proposals.filter((p) => p.status === 'Accepted').map((p) => (
                <option key={p.id} value={p.id}>{p.proposal_number} — {p.title}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Contract Title</label>
              <input value={contractForm.title} onChange={(e) => setContractForm({ ...contractForm, title: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Event Type</label>
              <input value={contractForm.eventType} onChange={(e) => setContractForm({ ...contractForm, eventType: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Start Date</label>
              <input type="date" value={contractForm.startDate} onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">End Date</label>
              <input type="date" value={contractForm.endDate} onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Guests</label>
              <input type="number" value={contractForm.guestCount} onChange={(e) => setContractForm({ ...contractForm, guestCount: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Room Nights</label>
              <input type="number" value={contractForm.roomNights} onChange={(e) => setContractForm({ ...contractForm, roomNights: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Value ($)</label>
              <input type="number" value={contractForm.totalValue} onChange={(e) => setContractForm({ ...contractForm, totalValue: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Deposit ($)</label>
              <input type="number" value={contractForm.depositAmount} onChange={(e) => setContractForm({ ...contractForm, depositAmount: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Signed By (Client)</label>
              <input value={contractForm.signedByClient} onChange={(e) => setContractForm({ ...contractForm, signedByClient: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="Client name" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Signed Date</label>
              <input type="date" value={contractForm.signedDate} onChange={(e) => setContractForm({ ...contractForm, signedDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Terms</label>
            <textarea value={contractForm.terms} onChange={(e) => setContractForm({ ...contractForm, terms: e.target.value })} rows={2} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default ProposalContract;
