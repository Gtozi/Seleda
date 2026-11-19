/**
 * Guest Recovery — Operations Portal (/erp/operations/guest-recovery).
 *
 * Service-recovery case workflow backed by ops_recovery_cases (migration 637):
 *   logged → investigating → compensation-pending → corrective-action
 *          → follow-up → guest-confirmation → closed
 *
 * Cross-portal integration:
 *   guest_feedback (rating ≤ 3)  — live complaint intake queue (FO)
 *   work_orders                  — "Create Work Order" writes a real WO that
 *                                  appears in the Engineering portal
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Heart,
  Search,
  Plus,
  ChevronRight,
  Clock,
  CheckCircle2,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  MessageSquareWarning,
  Wrench,
  Save,
  Trash2,
  Star,
  UserCheck,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchGuestRecovery,
  createRecoveryCase,
  createRecoveryFromFeedback,
  updateRecoveryCase,
  createRecoveryWorkOrder,
  deleteRecoveryCase,
  type RecoveryCase,
  type RecoveryStatus,
  type RecoveryCategory,
  type GuestRecoveryOverview,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const STATUS_FLOW: RecoveryStatus[] = [
  'logged', 'investigating', 'compensation-pending', 'corrective-action',
  'follow-up', 'guest-confirmation', 'closed',
];

const STATUS_META: Record<RecoveryStatus, { label: string; tone: StatusTone }> = {
  'logged': { label: 'Logged', tone: 'neutral' },
  'investigating': { label: 'Investigating', tone: 'info' },
  'compensation-pending': { label: 'Comp. Pending', tone: 'warning' },
  'corrective-action': { label: 'Corrective Action', tone: 'info' },
  'follow-up': { label: 'Follow Up', tone: 'info' },
  'guest-confirmation': { label: 'Guest Confirmation', tone: 'warning' },
  'closed': { label: 'Closed', tone: 'success' },
};

const CATEGORIES: RecoveryCategory[] = [
  'Maintenance', 'Housekeeping', 'F&B', 'Facilities', 'Front Office', 'Security', 'Spa', 'Other',
];

const PRIORITY_TONE: Record<string, StatusTone> = { high: 'danger', medium: 'warning', low: 'neutral' };

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d?: string) => (d ? new Date(d).toLocaleString() : '—');

// ── Component ────────────────────────────────────────────────────────────

const GuestRecovery: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [data, setData] = useState<GuestRecoveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | RecoveryStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editAssigned, setEditAssigned] = useState('');
  const [editComp, setEditComp] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editFollowUp, setEditFollowUp] = useState('');
  const [addForm, setAddForm] = useState({ guestName: '', roomNumber: '', complaint: '', category: 'Other' as RecoveryCategory, priority: 'medium' as const });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchGuestRecovery(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load recovery cases');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const cases = data?.cases || [];
  const selectedCase = cases.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    if (selectedCase) {
      setEditAssigned(selectedCase.assignedTo || '');
      setEditComp(selectedCase.compensationAmount != null ? String(selectedCase.compensationAmount) : '');
      setEditAction(selectedCase.correctiveAction || '');
      setEditFollowUp(selectedCase.followUpDate || '');
    }
  }, [selectedId, data]);

  const filteredCases = useMemo(() => cases.filter((c) => {
    const matchesFilter = selectedFilter === 'all' || c.status === selectedFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = q === '' ||
      c.guestName.toLowerCase().includes(q) ||
      c.complaint.toLowerCase().includes(q) ||
      (c.roomNumber || '').toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  }), [cases, selectedFilter, searchQuery]);

  const mutate = async (fn: () => Promise<any>, okMsg: string) => {
    setSaving(true);
    try {
      await fn();
      addNotification(okMsg, 'task', 'Executive');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = (c: RecoveryCase, status: RecoveryStatus) =>
    mutate(() => updateRecoveryCase(c.id, { status }), `Case moved to ${STATUS_META[status].label}.`);

  const saveDetails = (c: RecoveryCase) =>
    mutate(() => updateRecoveryCase(c.id, {
      assignedTo: editAssigned || undefined,
      compensationAmount: editComp === '' ? undefined : Number(editComp),
      correctiveAction: editAction || undefined,
      followUpDate: editFollowUp || undefined,
    }), 'Case details saved.');

  const stats = data?.stats;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={Heart}
        title="Guest Recovery"
        subtitle="Service recovery cases — complaint intake, compensation, corrective action and follow-up"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button className={button.primary} onClick={() => setShowAdd((v) => !v)}>
              <Plus size={16} /> New Case
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Open Cases" value={stats?.open ?? '—'} icon={Heart} tone="accent" />
        <StatCard title="Comp. Pending" value={stats?.compensationPending ?? '—'} icon={Clock} tone="warning" />
        <StatCard title="Comp. Exposure" value={stats ? formatAmount(stats.compensationTotal) : '—'} icon={AlertTriangle} tone="danger" />
        <StatCard title="Feedback to Triage" value={stats?.awaitingFeedbackTriage ?? '—'} icon={MessageSquareWarning} tone="info" />
      </div>

      {/* Feedback intake queue */}
      {(data?.feedbackQueue.length || 0) > 0 && (
        <SectionCard title="Complaint Intake — Negative Feedback" icon={MessageSquareWarning} tone="warning" pad="md">
          <div className="space-y-2">
            {data!.feedbackQueue.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-slate-900 dark:text-white">{f.guestName}</span>
                    {f.roomNumber && <span className="text-slate-500">Room {f.roomNumber}</span>}
                    <Badge tone="danger" icon={Star}>{f.rating}/5</Badge>
                    <Badge tone="neutral">{f.category}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">{f.comments || 'No comment'} · {fmtDateTime(f.submittedAt)}</p>
                </div>
                <button
                  className={button.secondary}
                  disabled={saving}
                  onClick={() => mutate(
                    () => createRecoveryFromFeedback(f.id, currentPropertyId),
                    `Recovery case opened for ${f.guestName}.`,
                  )}
                >
                  <ArrowRight size={14} /> Open Case
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* New case form */}
      {showAdd && (
        <SectionCard title="New Recovery Case" icon={Plus} pad="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Guest name *" value={addForm.guestName} onChange={(e) => setAddForm((f) => ({ ...f, guestName: e.target.value }))} />
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Room" value={addForm.roomNumber} onChange={(e) => setAddForm((f) => ({ ...f, roomNumber: e.target.value }))} />
            <select className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value as RecoveryCategory }))}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" value={addForm.priority} onChange={(e) => setAddForm((f) => ({ ...f, priority: e.target.value as any }))}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <textarea className="mt-3 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm resize-none" rows={2} placeholder="Complaint details *" value={addForm.complaint} onChange={(e) => setAddForm((f) => ({ ...f, complaint: e.target.value }))} />
          <div className="flex justify-end gap-2 mt-3">
            <button className={button.ghost} onClick={() => setShowAdd(false)}>Cancel</button>
            <button
              className={button.primary}
              disabled={saving || !addForm.guestName.trim() || !addForm.complaint.trim()}
              onClick={() => mutate(
                () => createRecoveryCase({ ...addForm, propertyId: currentPropertyId }),
                'Recovery case created.',
              ).then(() => setShowAdd(false))}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create
            </button>
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Search cases..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
          />
        </div>
        <select
          value={selectedFilter}
          onChange={(e) => setSelectedFilter(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Status</option>
          {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
          <Loader2 size={20} className="animate-spin" /> Loading recovery cases…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Case list */}
          <div className="lg:col-span-2 space-y-3">
            {filteredCases.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                <Heart size={48} className="text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">No recovery cases match your filters</p>
              </div>
            ) : (
              filteredCases.map((c) => {
                const sm = STATUS_META[c.status];
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                      selectedId === c.id
                        ? 'bg-[var(--color-accent-operations)]/5 border-[var(--color-accent-operations)]/40'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">{c.guestName}</span>
                          {c.roomNumber && <span className="text-sm text-slate-500">Room {c.roomNumber}</span>}
                          <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">{c.complaint}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                          <span>{c.category}</span>
                          <span>·</span>
                          <span>{fmtDateTime(c.loggedAt)}</span>
                          {c.workOrderId && <><span>·</span><span className="flex items-center gap-1"><Wrench size={11} /> WO linked</span></>}
                        </div>
                      </div>
                      <Badge tone={sm.tone}>{sm.label}</Badge>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Case details */}
          <div className="lg:col-span-1">
            {selectedCase ? (
              <SectionCard
                title="Case Details"
                icon={Heart}
                pad="none"
                className="sticky top-6"
                actions={
                  <button onClick={() => setSelectedId(null)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors">
                    <X size={18} className="text-slate-400" />
                  </button>
                }
              >
                <div className="p-4 space-y-4">
                  {/* Status stepper */}
                  <div className="flex flex-wrap gap-1">
                    {STATUS_FLOW.map((s) => (
                      <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        s === selectedCase.status
                          ? 'bg-[var(--color-accent-operations)] text-white font-semibold'
                          : STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(selectedCase.status)
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {STATUS_META[s].label}
                      </span>
                    ))}
                  </div>

                  <div>
                    <Badge tone={PRIORITY_TONE[selectedCase.priority]}>{selectedCase.priority} priority</Badge>
                    <h4 className="font-semibold text-slate-900 dark:text-white mt-2">{selectedCase.complaint}</h4>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Guest</span><span className="text-slate-900 dark:text-white">{selectedCase.guestName}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Room</span><span className="text-slate-900 dark:text-white">{selectedCase.roomNumber || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Category</span><span className="text-slate-900 dark:text-white">{selectedCase.category}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Logged</span><span className="text-slate-900 dark:text-white">{fmtDateTime(selectedCase.loggedAt)}</span></div>
                    {selectedCase.loggedBy && <div className="flex justify-between"><span className="text-slate-500">Logged by</span><span className="text-slate-900 dark:text-white">{selectedCase.loggedBy}</span></div>}
                    {selectedCase.closedAt && <div className="flex justify-between"><span className="text-slate-500">Closed</span><span className="text-slate-900 dark:text-white">{fmtDateTime(selectedCase.closedAt)}</span></div>}
                  </div>

                  {/* Linked work order */}
                  {selectedCase.workOrder ? (
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Wrench size={14} className="text-slate-400" /> {selectedCase.workOrder.id}
                      </span>
                      <Badge tone={selectedCase.workOrder.status === 'Completed' ? 'success' : 'info'}>
                        {selectedCase.workOrder.status || 'Open'}
                      </Badge>
                    </div>
                  ) : (selectedCase.category === 'Maintenance' || selectedCase.category === 'Facilities') && (
                    <button
                      className={button.secondary}
                      disabled={saving}
                      onClick={() => mutate(
                        () => createRecoveryWorkOrder(selectedCase.id, { propertyId: currentPropertyId }),
                        'Work order created in the Engineering portal.',
                      )}
                    >
                      <Wrench size={14} /> Create Work Order
                    </button>
                  )}

                  {/* Editable fields */}
                  <div className="space-y-2">
                    <input value={editAssigned} onChange={(e) => setEditAssigned(e.target.value)} placeholder="Assigned to" className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
                    <div className="flex gap-2">
                      <input value={editComp} onChange={(e) => setEditComp(e.target.value)} placeholder="Compensation" type="number" className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
                      <input value={editFollowUp} onChange={(e) => setEditFollowUp(e.target.value)} type="date" className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
                    </div>
                    <textarea value={editAction} onChange={(e) => setEditAction(e.target.value)} placeholder="Corrective action taken…" rows={2} className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm resize-none" />
                    <button className={button.secondary} onClick={() => saveDetails(selectedCase)} disabled={saving}>
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Details
                    </button>
                  </div>

                  {/* Status actions */}
                  <div className="pt-3 border-t border-gray-200 dark:border-slate-700">
                    <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">Advance Status</h5>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_FLOW.filter((s) => s !== selectedCase.status).map((s) => (
                        <button
                          key={s}
                          disabled={saving}
                          onClick={() => advanceStatus(selectedCase, s)}
                          className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                        >
                          {STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    className="text-xs text-[var(--color-danger)] flex items-center gap-1 hover:underline"
                    disabled={saving}
                    onClick={() => mutate(() => deleteRecoveryCase(selectedCase.id), 'Case deleted.').then(() => setSelectedId(null))}
                  >
                    <Trash2 size={12} /> Delete case
                  </button>
                </div>
              </SectionCard>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-8 text-center sticky top-6">
                <Heart size={48} className="text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">Select a case to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GuestRecovery;
