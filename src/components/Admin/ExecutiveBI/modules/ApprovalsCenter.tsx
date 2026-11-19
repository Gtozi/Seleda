/**
 * Approvals & Decisions Module
 *
 * Executive-level decision queue backed by GET /api/executive/approvals —
 * aggregates pending items from ops_approval_requests, fin_approval_requests
 * and expense_requests — plus POST /api/executive/approvals/:itemId/decide
 * which writes the decision back to the owning source table so the
 * originating portal sees its request resolved.
 *
 * Requires exec:approvals:decide for mutations (viewers see the queue
 * read-only).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  RefreshCw,
  AlertTriangle,
  Loader2,
  ClipboardCheck,
  ExternalLink,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { useNavigate } from 'react-router-dom';
import {
  fetchExecApprovals,
  decideExecApproval,
  type ExecApprovalItem,
} from '../../../../services/executiveService';

const SOURCE_LABEL: Record<string, string> = {
  operations: 'Operations',
  finance: 'Finance',
  expenses: 'Expenses',
};

const URGENCY_STYLE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const ApprovalsCenter = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExecApprovalItem[]>([]);
  const [summary, setSummary] = useState<{ total: number; escalated: number; critical: number; pendingAmount: number } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pendingDecision, setPendingDecision] = useState<'reject' | 'escalate' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchExecApprovals(currentPropertyId);
      setItems(res.items);
      setSummary(res.summary);
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const filtered = useMemo(
    () => items.filter(i => sourceFilter === 'all' || i.source === sourceFilter),
    [items, sourceFilter],
  );

  const decide = async (item: ExecApprovalItem, decision: 'approve' | 'reject' | 'escalate', notes?: string) => {
    setBusyId(item.id);
    setFeedback(null);
    try {
      await decideExecApproval(item.id, decision, notes);
      setItems(prev => prev.filter(i => i.id !== item.id));
      setFeedback(`${decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Escalated'}: ${item.title}`);
      setNoteFor(null);
      setNote('');
      setPendingDecision(null);
    } catch (e: any) {
      setFeedback(`Failed to ${decision}: ${e?.message || 'unknown error'}`);
    } finally {
      setBusyId(null);
    }
  };

  const openNoteFor = (item: ExecApprovalItem, decision: 'reject' | 'escalate') => {
    setNoteFor(item.id);
    setPendingDecision(decision);
    setNote('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Approvals &amp; Decisions</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Enterprise approval queue — decisions write back to the owning department
            {generatedAt && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                · updated {new Date(generatedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="all">All Sources</option>
            <option value="operations">Operations</option>
            <option value="finance">Finance</option>
            <option value="expenses">Expenses</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Pending Items</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{summary.total}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">High / Critical</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">{summary.critical}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Escalated</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{summary.escalated}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Pending Amount</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{formatAmount(summary.pendingAmount)}</p>
          </div>
        </div>
      )}

      {/* Feedback + error banners */}
      {feedback && (
        <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg text-indigo-700 dark:text-indigo-300 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 text-sm">{error}</span>
          <button onClick={load} className="text-sm font-medium underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* Queue */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-3" />
          <span>Loading approval queue…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No pending approvals{sourceFilter !== 'all' ? ` from ${SOURCE_LABEL[sourceFilter]}` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <div
              key={item.id}
              className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_STYLE[item.urgency] || URGENCY_STYLE.medium}`}>
                      {item.urgency}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {SOURCE_LABEL[item.source] || item.source}
                    </span>
                    {item.status === 'escalated' && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        escalated
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {item.department || '—'} · requested by {item.requestedBy || '—'}
                    {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {item.amount !== null && (
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{formatAmount(item.amount)}</p>
                  )}
                </div>
              </div>

              {/* Decision actions */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => decide(item, 'approve')}
                  disabled={busyId === item.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Approve
                </button>
                <button
                  onClick={() => openNoteFor(item, 'reject')}
                  disabled={busyId === item.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-sm rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
                <button
                  onClick={() => openNoteFor(item, 'escalate')}
                  disabled={busyId === item.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Escalate
                </button>
                <button
                  onClick={() => navigate(item.drillPath)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:underline ml-auto"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in {SOURCE_LABEL[item.source] || 'source'} portal
                </button>
              </div>

              {/* Note input for reject/escalate */}
              {noteFor === item.id && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={pendingDecision === 'reject' ? 'Rejection reason (optional)' : 'Escalation note (optional)'}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    autoFocus
                  />
                  <button
                    onClick={() => decide(item, pendingDecision!, note || undefined)}
                    disabled={busyId === item.id}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    Confirm {pendingDecision}
                  </button>
                  <button
                    onClick={() => { setNoteFor(null); setPendingDecision(null); setNote(''); }}
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ApprovalsCenter;
