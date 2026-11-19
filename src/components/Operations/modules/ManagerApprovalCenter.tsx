/**
 * Manager Approval Center — Operations Portal (/erp/operations/approvals).
 *
 * Centralized approval inbox aggregating the *real* approval tables of
 * the other portals — fin_approval_requests (multi-level finance
 * workflow), fin_journal_approvals, hr_approval_requests,
 * hr_manager_approvals, hr_overtime_requests, uinv_approval_requests —
 * plus ops-native requests in ops_approval_requests (migration 632,
 * seeded with the former mock items).
 *
 * Approve / Reject / Escalate write back to each request's *source*
 * table via POST /api/ops-portal/approvals/:source/:id/decide, so the
 * originating portal sees its request resolved. Escalate is offered
 * only where the source model supports it (finance level advance,
 * ops-native status='escalated').
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens) — same as the HK / Engineering /
 * F&B modules and the other Operations tabs.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  DollarSign,
  Bed,
  Utensils,
  Wrench,
  ShoppingCart,
  FileText,
  Users,
  Shield,
  Search,
  ChevronRight,
  X,
  Briefcase,
  Loader2,
  RefreshCw,
  CheckSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsApprovals,
  decideApproval,
  type OpsApprovalRequest,
  type ApprovalStatus,
  type ApprovalUrgency,
  type ApprovalDecision,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const DEPARTMENTS: Array<{ id: string; name: string; icon: LucideIcon }> = [
  { id: 'FrontOffice', name: 'Front Office', icon: Users },
  { id: 'Housekeeping', name: 'Housekeeping', icon: Bed },
  { id: 'FandB', name: 'Food & Beverage', icon: Utensils },
  { id: 'Procurement', name: 'Procurement', icon: ShoppingCart },
  { id: 'Engineering', name: 'Engineering', icon: Wrench },
  { id: 'Finance', name: 'Finance', icon: DollarSign },
  { id: 'HR', name: 'Human Resources', icon: Briefcase },
  { id: 'Security', name: 'Security', icon: Shield },
];

const STATUS_TONE: Record<ApprovalStatus, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  escalated: 'info',
};

const URGENCY_TONE: Record<ApprovalUrgency, StatusTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const SOURCE_LABEL: Record<string, string> = {
  fin: 'Finance workflow',
  fj: 'Journal approval',
  hr: 'HR workflow',
  hrm: 'Manager approvals',
  ot: 'Overtime',
  uinv: 'Inventory',
  ops: 'Ops request',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const deptIcon = (id: string): LucideIcon =>
  DEPARTMENTS.find(d => d.id === id)?.icon || FileText;

// ── Component ────────────────────────────────────────────────────────────

const ManagerApprovalCenter: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [requests, setRequests] = useState<OpsApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'all' | ApprovalStatus>('pending');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const data = await fetchOpsApprovals(currentPropertyId || undefined);
      setRequests(data.requests);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load approvals');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => requests.filter(r => {
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter ||
      (statusFilter === 'pending' && r.status === 'escalated');
    const matchesDept = deptFilter === 'all' || r.department === deptFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch = !q ||
      r.title.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.requestedBy.toLowerCase().includes(q);
    return matchesStatus && matchesDept && matchesSearch;
  }), [requests, statusFilter, deptFilter, search]);

  const selected = useMemo(
    () => requests.find(r => r.id === selectedId) || null,
    [requests, selectedId],
  );

  const stats = useMemo(() => {
    const open = requests.filter(r => r.status === 'pending' || r.status === 'escalated');
    return {
      pending: open.length,
      critical: open.filter(r => r.urgency === 'critical').length,
      decided: requests.filter(r => r.status === 'approved' || r.status === 'rejected').length,
      value: open.reduce((s, r) => s + (r.amount || 0), 0),
    };
  }, [requests]);

  // ── Decisions — write back to the source table, optimistic + rollback ──

  const decide = async (request: OpsApprovalRequest, decision: ApprovalDecision) => {
    const newStatus: ApprovalStatus =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'escalated';
    const previous = requests;
    setDeciding(true);
    setRequests(prev => prev.map(r => (r.id === request.id ? { ...r, status: newStatus } : r)));
    setSelectedId(null);
    try {
      await decideApproval(request.source, request.sourceId, decision, decisionNotes || undefined);
      addNotification(`Request ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'escalated'}.`, 'task', 'Executive');
      setDecisionNotes('');
    } catch (e: any) {
      setRequests(previous);
      addNotification(e?.message || `Failed to ${decision} request`, 'warning', 'Executive');
    } finally {
      setDeciding(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && requests.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Manager Approval Center"
        subtitle="Centralized approval inbox across all departments"
        icon={CheckSquare}
        actions={
          <>
            {stats.critical > 0 && (
              <Badge tone="danger" icon={AlertTriangle}>{stats.critical} critical</Badge>
            )}
            <Badge tone="warning" icon={Clock}>{stats.pending} pending</Badge>
            <button onClick={() => load(true)} disabled={refreshing} className={button.secondary} title="Refresh">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <AlertTriangle size={18} className="text-[var(--color-warning)] shrink-0" />
          <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{error}</p>
          <button onClick={() => load()} className={button.secondary}>Retry</button>
        </div>
      )}

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Pending" value={stats.pending} icon={Clock} tone="warning" caption="awaiting decision" />
        <StatCard title="Critical" value={stats.critical} icon={AlertTriangle} tone="danger" caption="need immediate attention" />
        <StatCard title="Value Pending" value={formatAmount(stats.value)} icon={DollarSign} tone="info" caption="sum of open requests" />
        <StatCard title="Decided" value={stats.decided} icon={CheckCircle2} tone="success" caption="approved or rejected" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search approvals…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="escalated">Escalated</option>
        </select>
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Departments</option>
          {DEPARTMENTS.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Master-detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Request list */}
        <div className="lg:col-span-2 space-y-3">
          {filtered.length === 0 ? (
            <SectionCard pad="lg">
              <div className="text-center py-8">
                <FileText size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No approval requests match your filters</p>
              </div>
            </SectionCard>
          ) : (
            filtered.map(request => {
              const DeptIcon = deptIcon(request.department);
              const isSelected = selected?.id === request.id;
              return (
                <button
                  key={request.id}
                  onClick={() => { setSelectedId(request.id); setDecisionNotes(''); }}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-[var(--color-accent-operations)]/5 border-[var(--color-accent-operations)]/40'
                      : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`shrink-0 p-2 rounded-xl ${statusTone[URGENCY_TONE[request.urgency]].soft}`}>
                      <DeptIcon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-mono uppercase text-gray-500 font-bold">
                            {request.category}
                          </span>
                          <h4 className="font-semibold text-gray-900 dark:text-white mt-0.5 truncate">
                            {request.title}
                          </h4>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge tone={URGENCY_TONE[request.urgency]} className="capitalize">{request.urgency}</Badge>
                          <Badge tone={STATUS_TONE[request.status]} className="capitalize">{request.status}</Badge>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                        {request.description}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-500 flex-wrap">
                        <span>{request.requestedBy}</span>
                        <span>·</span>
                        <span>{timeAgo(request.requestedAt)}</span>
                        {request.amount != null && (
                          <>
                            <span>·</span>
                            <span className="font-semibold text-gray-700 dark:text-gray-300">
                              {formatAmount(request.amount)}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <Badge tone="neutral">{SOURCE_LABEL[request.source] || request.source}</Badge>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-400 shrink-0 mt-1" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-1">
          {selected ? (
            <SectionCard
              title="Request Details"
              pad="md"
              className="sticky top-6"
              actions={
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors"
                >
                  <X size={18} className="text-gray-400" />
                </button>
              }
            >
              <div className="space-y-4">
                <div>
                  <span className="text-xs font-mono uppercase text-gray-500 font-bold">
                    {selected.category} · {SOURCE_LABEL[selected.source] || selected.source}
                  </span>
                  <h4 className="font-semibold text-gray-900 dark:text-white mt-1">{selected.title}</h4>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <Badge tone={STATUS_TONE[selected.status]} className="capitalize">{selected.status}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Urgency</span>
                    <Badge tone={URGENCY_TONE[selected.urgency]} className="capitalize">{selected.urgency}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Requested by</span>
                    <span className="font-medium text-gray-900 dark:text-white">{selected.requestedBy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Requested</span>
                    <span className="text-gray-900 dark:text-white">{timeAgo(selected.requestedAt)}</span>
                  </div>
                  {selected.amount != null && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Amount</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {formatAmount(selected.amount)}
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400">{selected.description}</p>

                {Object.keys(selected.details || {}).length > 0 && (
                  <div className="p-3 bg-gray-50 dark:bg-slate-900/50 rounded-xl space-y-2">
                    <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">
                      Additional Details
                    </h5>
                    {Object.entries(selected.details)
                      .filter(([, v]) => v !== undefined && v !== null && v !== '')
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-3 text-xs">
                          <span className="text-gray-500 capitalize shrink-0">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white text-right break-all">
                            {String(value)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                {selected.status === 'pending' && (
                  <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                    <textarea
                      value={decisionNotes}
                      onChange={e => setDecisionNotes(e.target.value)}
                      placeholder="Decision notes (optional — required context for rejections)"
                      rows={2}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
                    />
                    <button
                      onClick={() => decide(selected, 'approve')}
                      disabled={deciding}
                      className="w-full py-2 bg-[var(--color-success)] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 size={17} />
                      Approve
                    </button>
                    <button
                      onClick={() => decide(selected, 'reject')}
                      disabled={deciding}
                      className="w-full py-2 bg-[var(--color-danger)] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <XCircle size={17} />
                      Reject
                    </button>
                    {selected.canEscalate && (
                      <button
                        onClick={() => decide(selected, 'escalate')}
                        disabled={deciding}
                        className="w-full py-2 bg-[var(--color-warning)] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <AlertTriangle size={17} />
                        Escalate
                      </button>
                    )}
                  </div>
                )}
              </div>
            </SectionCard>
          ) : (
            <SectionCard pad="lg" className="sticky top-6">
              <div className="text-center py-10">
                <CheckSquare size={40} className="text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select a request to review and decide
                </p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagerApprovalCenter;
