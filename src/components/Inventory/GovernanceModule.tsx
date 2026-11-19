/**
 * Governance — /erp/inventory/audit
 *
 * DB-backed:
 *   - Inventory Periods (uinv_inventory_periods)
 *   - Audit Log (uinv_audit_logs)
 *   - Approval Requests (uinv_approval_requests)
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Shield, Calendar, ClipboardCheck, CheckCircle2, XCircle, Plus, Search, Clock, Loader2,
  ServerCrash, MoreVertical, Trash2, FileText, Eye, Lock, Unlock, DollarSign,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchInventoryPeriods, createInventoryPeriod, updateInventoryPeriod, deleteInventoryPeriod, type UinvInventoryPeriod,
  fetchAuditLogs, type UinvAuditLog,
  fetchApprovalRequests, createApprovalRequest, updateApprovalRequest, deleteApprovalRequest, type UinvApprovalRequest,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';
import { JournalsTab } from './OperationalEnhancementsModule';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const SUB_TABS = [
  { id: 'periods', label: 'Inventory Periods', icon: Calendar },
  { id: 'audit', label: 'Audit Log', icon: ClipboardCheck },
  { id: 'approvals', label: 'Approval Requests', icon: Shield },
  { id: 'journals', label: 'Journal Posting', icon: DollarSign },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

function statusToneFor(status: string): Tone {
  if (['Closed', 'Approved', 'Released', 'Completed', 'OK'].includes(status)) return 'success';
  if (['Open', 'Pending', 'Frozen', 'In Progress'].includes(status)) return 'warning';
  if (['Rejected', 'Cancelled', 'Disputed'].includes(status)) return 'danger';
  if (['Reviewed', 'Partially Approved'].includes(status)) return 'info';
  return 'neutral';
}

function periodStatusAction(status: UinvInventoryPeriod['status']): { label: string; status: UinvInventoryPeriod['status'] }[] {
  if (status === 'Open') return [{ label: 'Freeze', status: 'Frozen' }, { label: 'Close', status: 'Closed' }];
  if (status === 'Frozen') return [{ label: 'Re-open', status: 'Open' }, { label: 'Close', status: 'Closed' }];
  return [{ label: 'Re-open', status: 'Open' }];
}

function approvalAction(status: UinvApprovalRequest['status']): { label: string; status: UinvApprovalRequest['status'] }[] {
  if (status === 'Pending') return [{ label: 'Approve', status: 'Approved' }, { label: 'Reject', status: 'Rejected' }];
  return [{ label: 'Re-open', status: 'Pending' }, { label: 'Cancel', status: 'Cancelled' }];
}

const formatJson = (o: Record<string, any> | null) => (o ? JSON.stringify(o, null, 2).slice(0, 500) : '—');

const GovernanceModule: React.FC<{ initialTab?: SubTab }> = ({ initialTab = 'periods' }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [sub, setSub] = useState<SubTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Notify wrapper for the JournalsTab sub-component
  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    addNotification?.(msg, type, 'Inventory');
  }, [addNotification]);

  const [periods, setPeriods] = useState<UinvInventoryPeriod[]>([]);
  const [auditLogs, setAuditLogs] = useState<UinvAuditLog[]>([]);
  const [approvals, setApprovals] = useState<UinvApprovalRequest[]>([]);

  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [periodForm, setPeriodForm] = useState<Partial<UinvInventoryPeriod>>({});
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [approvalForm, setApprovalForm] = useState<Partial<UinvApprovalRequest>>({});
  const [detailLog, setDetailLog] = useState<UinvAuditLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [p, a, r] = await Promise.all([
        fetchInventoryPeriods({ propertyId }),
        fetchAuditLogs({ propertyId }),
        fetchApprovalRequests({ propertyId }),
      ]);
      setPeriods(p);
      setAuditLogs(a);
      setApprovals(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to load governance data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const matchSearch = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());

  const kpis = useMemo(() => ({
    openPeriods: periods.filter(p => p.status === 'Open').length,
    frozenPeriods: periods.filter(p => p.status === 'Frozen').length,
    auditEntries: auditLogs.length,
    pendingApprovals: approvals.filter(a => a.status === 'Pending').length,
    approvedApprovals: approvals.filter(a => a.status === 'Approved').length,
    rejectedApprovals: approvals.filter(a => a.status === 'Rejected').length,
  }), [periods, auditLogs, approvals]);

  const menu = (id: string, children: ReactNode) => (
    <div className="relative">
      <IconButton title="Actions" onClick={() => setMenuOpen(menuOpen === id ? null : id)}><MoreVertical className="w-4 h-4" /></IconButton>
      {menuOpen === id && (
        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1" onMouseLeave={() => setMenuOpen(null)}>
          {children}
        </div>
      )}
    </div>
  );

  // ── Periods ──
  const openPeriodForm = () => { setPeriodForm({ property_id: currentPropertyId, status: 'Open', period_type: 'Monthly', period_name: '', start_date: '', end_date: '' }); setShowPeriodForm(true); };
  const submitPeriod = async () => {
    if (!periodForm.period_name || !periodForm.start_date || !periodForm.end_date) return addNotification('Name, start and end dates are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createInventoryPeriod({ ...periodForm, property_id: currentPropertyId }); addNotification('Period created.', 'success', 'Inventory'); setShowPeriodForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create period', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const updatePeriodStatus = async (p: UinvInventoryPeriod, status: UinvInventoryPeriod['status']) => {
    if (!p.id) return;
    setActingOn(p.id);
    try {
      await updateInventoryPeriod(p.id, { status, closed_at: status === 'Closed' ? new Date().toISOString() : p.closed_at, frozen_at: status === 'Frozen' ? new Date().toISOString() : p.frozen_at });
      addNotification(`Period → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Update failed', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removePeriod = async (id: string) => { setActingOn(id); try { await deleteInventoryPeriod(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // ── Approvals ──
  const openApprovalForm = () => { setApprovalForm({ property_id: currentPropertyId, status: 'Pending', approval_type: 'Other', requester: '', requester_department: '', entity_type: '' }); setShowApprovalForm(true); };
  const submitApproval = async () => {
    if (!approvalForm.approval_type || !approvalForm.requester || !approvalForm.reason) return addNotification('Type, requester and reason are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createApprovalRequest({ ...approvalForm, property_id: currentPropertyId }); addNotification('Approval request created.', 'success', 'Inventory'); setShowApprovalForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create request', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const updateApprovalStatus = async (a: UinvApprovalRequest, status: UinvApprovalRequest['status']) => {
    setActingOn(a.id);
    try {
      await updateApprovalRequest(a.id, { status, approved_at: ['Approved', 'Rejected'].includes(status) ? new Date().toISOString() : null });
      addNotification(`Approval → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Update failed', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removeApproval = async (id: string) => { setActingOn(id); try { await deleteApprovalRequest(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Governance"
        subtitle="Inventory periods, audit logs and approval requests."
        icon={Shield}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            {sub === 'periods' && <button onClick={openPeriodForm} className={button.primary}><Plus className="w-4 h-4" /> New Period</button>}
            {sub === 'approvals' && <button onClick={openApprovalForm} className={button.primary}><Plus className="w-4 h-4" /> New Approval</button>}
          </div>
        }
      />

      {sub !== 'journals' && (
        <div className={layout.kpiGrid}>
          <StatCard title="Open Periods" value={kpis.openPeriods} icon={Calendar} tone="warning" />
          <StatCard title="Frozen Periods" value={kpis.frozenPeriods} icon={Lock} tone="info" />
          <StatCard title="Audit Entries" value={kpis.auditEntries} icon={ClipboardCheck} tone="neutral" />
          <StatCard title="Pending Approvals" value={kpis.pendingApprovals} icon={Shield} tone="warning" />
          <StatCard title="Approved" value={kpis.approvedApprovals} icon={CheckCircle2} tone="success" />
          <StatCard title="Rejected" value={kpis.rejectedApprovals} icon={XCircle} tone="danger" />
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {SUB_TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => { setSub(t.id); setSearch(''); setMenuOpen(null); }}
                  className={['px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                    sub === t.id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'].join(' ')}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
          {sub !== 'journals' && (
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Periods ── */}
      {sub === 'periods' && (
        <InventoryTable
          rows={periods.filter(p => matchSearch(p.period_name) || matchSearch(p.period_type))}
          rowKey={p => p.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No inventory periods."
          columns={[
            { key: 'name', header: 'Period', render: p => <span className="font-medium text-slate-900 dark:text-white">{p.period_name}</span> },
            { key: 'type', header: 'Type', widthClass: 'md:w-28 shrink-0', render: p => <Badge tone="neutral">{p.period_type}</Badge> },
            { key: 'start', header: 'Start', widthClass: 'md:w-32 shrink-0', render: p => <span className="text-xs text-slate-500">{p.start_date}</span> },
            { key: 'end', header: 'End', widthClass: 'md:w-32 shrink-0', render: p => <span className="text-xs text-slate-500">{p.end_date}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: p => <Badge tone={statusToneFor(p.status)} variant="solid">{p.status}</Badge> },
            { key: 'closed', header: 'Closed At', widthClass: 'md:w-36 shrink-0', render: p => <span className="text-xs text-slate-500">{p.closed_at ? new Date(p.closed_at).toLocaleString() : '—'}</span> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-32 shrink-0', align: 'right', render: p => (
              <OpsCell>
                {p.status === 'Open' && <IconButton onClick={() => updatePeriodStatus(p, 'Frozen')} title="Freeze"><Lock className="w-4 h-4" /></IconButton>}
                {menu(p.id, <>
                  {periodStatusAction(p.status).map(act => <button key={act.status} onClick={() => updatePeriodStatus(p, act.status)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">{act.status === 'Open' ? <Unlock className="w-4 h-4" /> : act.status === 'Closed' ? <CheckCircle2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}{act.label}</button>)}
                  <button onClick={() => removePeriod(p.id)} disabled={actingOn === p.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                </>)}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Audit Log ── */}
      {sub === 'audit' && (
        <InventoryTable
          rows={auditLogs.filter(l => matchSearch(l.transaction_type) || matchSearch(l.user_name) || matchSearch(l.entity_type) || matchSearch(l.reason || ''))}
          rowKey={l => l.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No audit log entries."
          columns={[
            { key: 'time', header: 'Timestamp', widthClass: 'md:w-36 shrink-0', render: l => <span className="text-xs text-slate-500">{new Date(l.timestamp).toLocaleString()}</span> },
            { key: 'user', header: 'User', widthClass: 'md:w-32 shrink-0', render: l => <span className="text-sm text-slate-700 dark:text-slate-300">{l.user_name}</span> },
            { key: 'dept', header: 'Dept', widthClass: 'md:w-28 shrink-0', render: l => <Badge tone="neutral">{l.department || '—'}</Badge> },
            { key: 'transaction', header: 'Transaction', widthClass: 'md:w-36 shrink-0', render: l => <span className="text-sm font-medium text-slate-900 dark:text-white">{l.transaction_type}</span> },
            { key: 'entity', header: 'Entity', render: l => <span className="text-sm text-slate-600">{l.entity_type} / {l.entity_id ? l.entity_id.slice(0, 8) : '—'}</span> },
            { key: 'item', header: 'Item / Asset', widthClass: 'md:w-44 shrink-0', render: l => <span className="text-sm text-slate-600">{l.item_or_asset || '—'}</span> },
            { key: 'reason', header: 'Reason', render: l => <span className="text-sm text-slate-500 truncate max-w-xs">{l.reason || '—'}</span> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: l => (
              <OpsCell>
                <IconButton onClick={() => setDetailLog(l)} title="View Details"><Eye className="w-4 h-4" /></IconButton>
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Approvals ── */}
      {sub === 'approvals' && (
        <InventoryTable
          rows={approvals.filter(a => matchSearch(a.request_number) || matchSearch(a.approval_type) || matchSearch(a.requester) || matchSearch(a.reason || ''))}
          rowKey={a => a.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No approval requests."
          columns={[
            { key: 'number', header: 'Request #', widthClass: 'md:w-40 shrink-0', render: a => <span className="font-medium text-slate-900 dark:text-white">{a.request_number}</span> },
            { key: 'type', header: 'Type', widthClass: 'md:w-40 shrink-0', render: a => <Badge tone="neutral">{a.approval_type}</Badge> },
            { key: 'requester', header: 'Requester', widthClass: 'md:w-36 shrink-0', render: a => <span className="text-sm text-slate-700 dark:text-slate-300">{a.requester}</span> },
            { key: 'entity', header: 'Entity', render: a => <span className="text-sm text-slate-600">{a.entity_type} {a.entity_id ? ` / ${a.entity_id.slice(0, 8)}` : ''}</span> },
            { key: 'value', header: 'Value', widthClass: 'md:w-28 shrink-0', align: 'right', render: a => <span className="text-sm font-medium">{a.value?.toLocaleString() || '—'}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: a => <Badge tone={statusToneFor(a.status)} variant="solid">{a.status}</Badge> },
            { key: 'approver', header: 'Approver', widthClass: 'md:w-32 shrink-0', render: a => <span className="text-sm text-slate-600">{a.approver || '—'}</span> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: a => (
              <OpsCell>
                {a.status === 'Pending' && <IconButton onClick={() => updateApprovalStatus(a, 'Approved')} title="Approve"><CheckCircle2 className="w-4 h-4 text-emerald-600" /></IconButton>}
                {menu(a.id, <>
                  {approvalAction(a.status).map(act => <button key={act.status} onClick={() => updateApprovalStatus(a, act.status)} className={['w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2', act.status === 'Rejected' ? 'text-red-600' : ''].join(' ')}>{act.label}</button>)}
                  <button onClick={() => removeApproval(a.id)} disabled={actingOn === a.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                </>)}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Journal Posting Log (Finance integration) ── */}
      {sub === 'journals' && (
        <JournalsTab notify={notify} />
      )}

      {/* ── Modals ── */}
      <ModalSystem isOpen={showPeriodForm} onClose={() => setShowPeriodForm(false)} onConfirm={submitPeriod} title="New Inventory Period" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Period Name *"><input className={inputClass} value={periodForm.period_name || ''} onChange={e => setPeriodForm({ ...periodForm, period_name: e.target.value })} /></Field>
          <Field label="Period Type"><select className={inputClass} value={periodForm.period_type || 'Monthly'} onChange={e => setPeriodForm({ ...periodForm, period_type: e.target.value as any })}>{['Daily','Weekly','Monthly','Quarterly','Yearly'].map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Start Date *"><input type="date" className={inputClass} value={periodForm.start_date || ''} onChange={e => setPeriodForm({ ...periodForm, start_date: e.target.value })} /></Field>
          <Field label="End Date *"><input type="date" className={inputClass} value={periodForm.end_date || ''} onChange={e => setPeriodForm({ ...periodForm, end_date: e.target.value })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={periodForm.notes || ''} onChange={e => setPeriodForm({ ...periodForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showApprovalForm} onClose={() => setShowApprovalForm(false)} onConfirm={submitApproval} title="New Approval Request" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Approval Type"><select className={inputClass} value={approvalForm.approval_type || 'Other'} onChange={e => setApprovalForm({ ...approvalForm, approval_type: e.target.value as any })}>{['High-Value Stock Adjustment','High-Value Waste','Asset Transfer','Inter-Property Transfer','Asset Disposal','Missing Asset','High-Value Issue','Count Variance','Quarantine Release','Other'].map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Entity Type"><input className={inputClass} value={approvalForm.entity_type || ''} onChange={e => setApprovalForm({ ...approvalForm, entity_type: e.target.value })} /></Field>
          <Field label="Entity ID"><input className={inputClass} value={approvalForm.entity_id || ''} onChange={e => setApprovalForm({ ...approvalForm, entity_id: e.target.value || null })} /></Field>
          <Field label="Requester *"><input className={inputClass} value={approvalForm.requester || ''} onChange={e => setApprovalForm({ ...approvalForm, requester: e.target.value })} /></Field>
          <Field label="Requester Department"><input className={inputClass} value={approvalForm.requester_department || ''} onChange={e => setApprovalForm({ ...approvalForm, requester_department: e.target.value || null })} /></Field>
          <Field label="Value"><input type="number" className={inputClass} value={approvalForm.value ?? 0} onChange={e => setApprovalForm({ ...approvalForm, value: Number(e.target.value) })} /></Field>
          <Field label="Quantity"><input type="number" className={inputClass} value={approvalForm.quantity ?? 0} onChange={e => setApprovalForm({ ...approvalForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Reason *"><textarea className={inputClass} rows={2} value={approvalForm.reason || ''} onChange={e => setApprovalForm({ ...approvalForm, reason: e.target.value })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={approvalForm.notes || ''} onChange={e => setApprovalForm({ ...approvalForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={!!detailLog} onClose={() => setDetailLog(null)} title="Audit Log Detail" variant="info" confirmLabel="Close" onConfirm={() => setDetailLog(null)}>
        {detailLog && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <div><p className="text-[10px] uppercase font-black text-slate-400">User</p><p className="font-bold">{detailLog.user_name}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Department</p><p className="font-bold">{detailLog.department || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Transaction</p><p className="font-bold">{detailLog.transaction_type}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Entity</p><p className="font-bold">{detailLog.entity_type} {detailLog.entity_id ? ` / ${detailLog.entity_id.slice(0, 12)}` : ''}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Item / Asset</p><p className="font-bold">{detailLog.item_or_asset || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Quantity</p><p className="font-bold">{detailLog.quantity ?? '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Value</p><p className="font-bold">{detailLog.value ?? '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Location</p><p className="font-bold">{detailLog.location || '—'}</p></div>
            </div>
            <div><p className="text-[10px] uppercase font-black text-slate-400 mb-1">Reason</p><p className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">{detailLog.reason || '—'}</p></div>
            <div><p className="text-[10px] uppercase font-black text-slate-400 mb-1">Previous State</p><pre className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-xs overflow-auto max-h-32">{formatJson(detailLog.previous_state)}</pre></div>
            <div><p className="text-[10px] uppercase font-black text-slate-400 mb-1">New State</p><pre className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-xs overflow-auto max-h-32">{formatJson(detailLog.new_state)}</pre></div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default GovernanceModule;
