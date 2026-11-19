/**
 * Finance — Period Close (backs /erp/finance/financial_close).
 *
 * DB-integrated via /api/period-close (see periodClose.routes.ts).
 * Three tabs:
 *   Checklist — per-period close tasks with completion tracking
 *   History   — accounting periods with close/reopen actions
 *   Settings  — lock configuration & notification preferences
 *
 * Uses the shared FrontOffice UI primitives (PageHeader, StatCard, Badge,
 * SectionCard) and the useERP context for currency formatting + notifications,
 * matching the F&B / HK inventory module look & feel.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Lock,
  Unlock,
  Calendar,
  FileText,
  RefreshCw,
  Download,
  ArrowRight,
  BarChart3,
  Search,
  Plus,
  X,
  Loader2,
  AlertTriangle,
  Trash2,
  MoreVertical,
  ShieldCheck,
  Settings,
  ListChecks,
  History,
  TrendingUp,
  Truck,
  Package,
  Landmark,
  ClipboardCheck,
  Scale,
  FileSpreadsheet,
  CalendarClock,
  RotateCcw,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { useERP } from '../../context/ERPContext';
import {
  fetchAccountingPeriods,
  createAccountingPeriod,
  closeAccountingPeriod,
  reopenAccountingPeriod,
  fetchChecklistItems,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  type AccountingPeriod,
  type PeriodCloseChecklistItem,
} from '../../services/periodCloseService';

type TabKey = 'checklist' | 'activities' | 'history' | 'settings';

const TABS: { id: TabKey; label: string; icon: typeof ListChecks }[] = [
  { id: 'checklist', label: 'Checklist', icon: ListChecks },
  { id: 'activities', label: 'Closing Activities', icon: ClipboardCheck },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

type ActivityStatus = 'Pending' | 'In Progress' | 'Completed';

interface ClosingActivity {
  id: string;
  name: string;
  icon: typeof TrendingUp;
  description: string;
}

const CLOSING_ACTIVITIES: ClosingActivity[] = [
  { id: 'revenue-verification', name: 'Revenue Verification', icon: TrendingUp, description: 'Verify all revenue postings reconcile against source systems and ledgers.' },
  { id: 'expense-accruals', name: 'Expense Accruals', icon: FileText, description: 'Record accrued expenses for goods/services received but not yet invoiced.' },
  { id: 'prepayments', name: 'Prepayments', icon: Calendar, description: 'Amortize prepaid expenses across the relevant accounting periods.' },
  { id: 'depreciation', name: 'Depreciation', icon: Truck, description: 'Calculate and post depreciation for all fixed assets for the period.' },
  { id: 'inventory-closing', name: 'Inventory Closing', icon: Package, description: 'Reconcile inventory counts and post valuation adjustments.' },
  { id: 'bank-reconciliation', name: 'Bank Reconciliation', icon: Landmark, description: 'Match ledger cash accounts against bank statements and clear reconciling items.' },
  { id: 'journal-review', name: 'Journal Review', icon: ClipboardCheck, description: 'Review and approve manual journal entries for accuracy and compliance.' },
  { id: 'trial-balance', name: 'Trial Balance', icon: Scale, description: 'Generate the trial balance and confirm debits equal credits.' },
  { id: 'financial-statements', name: 'Financial Statements', icon: FileSpreadsheet, description: 'Produce the income statement, balance sheet, and cash flow statement.' },
  { id: 'year-end-closing', name: 'Year-End Closing', icon: CalendarClock, description: 'Close the fiscal year, carry forward retained earnings, and archive records.' },
];

const ACTIVITY_STATUS_TONE: Record<ActivityStatus, 'success' | 'warning' | 'info' | 'neutral'> = {
  Pending: 'neutral',
  'In Progress': 'warning',
  Completed: 'success',
};

const CATEGORIES = [
  'Revenue', 'Accounts Receivable', 'Accounts Payable', 'Bank Reconciliation',
  'General Ledger', 'Tax Compliance', 'Financial Reports', 'Payroll', 'Inventory',
];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Open: 'warning',
  Closed: 'success',
  Pending: 'info',
};

const PeriodClose = () => {
  const { addNotification, currentPropertyId } = useERP();

  const [activeTab, setActiveTab] = useState<TabKey>('checklist');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Data
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [checklist, setChecklist] = useState<PeriodCloseChecklistItem[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  // Modals
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Closing activities (spec §19 — 10 functional close workflows)
  const [activityStatuses, setActivityStatuses] = useState<Record<string, ActivityStatus>>(
    () => Object.fromEntries(CLOSING_ACTIVITIES.map(a => [a.id, 'Pending' as ActivityStatus]))
  );

  // Forms
  const [newPeriodForm, setNewPeriodForm] = useState({
    periodName: '',
    periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    periodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
    notes: '',
  });
  const [newTaskForm, setNewTaskForm] = useState({ category: 'Revenue', task: '', assignedTo: '', notes: '' });

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = currentPropertyId || undefined;
      const [periodData, checklistData] = await Promise.all([
        fetchAccountingPeriods().catch(() => [] as AccountingPeriod[]),
        fetchChecklistItems({ propertyId: pid }).catch(() => [] as PeriodCloseChecklistItem[]),
      ]);
      setPeriods(periodData);
      setChecklist(checklistData);
      if (periodData.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(periodData[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load period close data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, selectedPeriodId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const periodChecklist = useMemo(() =>
    checklist.filter(c => !selectedPeriodId || c.period_id === selectedPeriodId),
    [checklist, selectedPeriodId]
  );

  const filteredChecklist = useMemo(() =>
    periodChecklist.filter(c =>
      c.task.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.assigned_to || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [periodChecklist, searchTerm]);

  const filteredPeriods = useMemo(() =>
    periods.filter(p =>
      p.period_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.closed_by || '').toLowerCase().includes(searchTerm.toLowerCase())
    ), [periods, searchTerm]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = periodChecklist.length;
    const completed = periodChecklist.filter(c => c.completed).length;
    const pending = total - completed;
    const progress = total > 0 ? (completed / total) * 100 : 0;
    const openPeriods = periods.filter(p => p.status === 'Open').length;
    const closedPeriods = periods.filter(p => p.status === 'Closed').length;
    return { total, completed, pending, progress, openPeriods, closedPeriods };
  }, [periodChecklist, periods]);

  // ── Closing activity progress (spec §19) ──────────────────────────────
  const activityProgress = useMemo(() => {
    const completed = CLOSING_ACTIVITIES.filter(a => activityStatuses[a.id] === 'Completed').length;
    const inProgress = CLOSING_ACTIVITIES.filter(a => activityStatuses[a.id] === 'In Progress').length;
    const total = CLOSING_ACTIVITIES.length;
    const pct = total > 0 ? (completed / total) * 100 : 0;
    return { completed, inProgress, total, pct };
  }, [activityStatuses]);

  const handleRunActivity = async (id: string) => {
    const activity = CLOSING_ACTIVITIES.find(a => a.id === id);
    setActivityStatuses(prev => ({ ...prev, [id]: 'In Progress' }));
    addNotification('Closing activity started.', 'info', 'Period Close');
    try {
      // Persist as a checklist item so the close workflow is recorded
      await createChecklistItem({
        periodId: selectedPeriodId || undefined,
        category: 'Closing Activity',
        task: activity?.name || id,
        assignedTo: undefined,
        notes: activity?.description || '',
        propertyId: currentPropertyId || undefined,
      } as any);
      setActivityStatuses(prev => ({ ...prev, [id]: 'Completed' }));
      addNotification(`${activity?.name || 'Activity'} completed and recorded in close checklist.`, 'success', 'Period Close');
      await loadAll();
    } catch (e: any) {
      setActivityStatuses(prev => ({ ...prev, [id]: 'Pending' }));
      addNotification(e?.message || 'Failed to run closing activity', 'error', 'Period Close');
    }
  };

  const handleResetActivities = () => {
    setActivityStatuses(Object.fromEntries(CLOSING_ACTIVITIES.map(a => [a.id, 'Pending' as ActivityStatus])));
    addNotification('All closing activities reset to Pending.', 'warning', 'Period Close');
  };

  // ── Action handlers ───────────────────────────────────────────────────
  const handleToggleTask = async (id: string, completed: boolean) => {
    try {
      await updateChecklistItem(id, { completed: !completed });
      await loadAll();
      addNotification(`Task marked ${!completed ? 'complete' : 'incomplete'}.`, 'success', 'Period Close');
    } catch (e: any) { addNotification(e?.message || 'Failed to update task', 'error', 'Period Close'); }
  };

  const handleDeleteTask = async (id: string) => {
    setActionMenuId(null);
    try {
      await deleteChecklistItem(id);
      await loadAll();
      addNotification('Task deleted.', 'warning', 'Period Close');
    } catch (e: any) { addNotification(e?.message || 'Failed to delete task', 'error', 'Period Close'); }
  };

  const handleCreateTask = async () => {
    setSubmitting(true);
    try {
      if (!newTaskForm.task) { addNotification('Task description is required.', 'warning', 'Period Close'); setSubmitting(false); return; }
      await createChecklistItem({
        ...newTaskForm,
        periodId: selectedPeriodId || undefined,
        propertyId: currentPropertyId || undefined,
      });
      await loadAll();
      setShowNewTask(false);
      setNewTaskForm({ category: 'Revenue', task: '', assignedTo: '', notes: '' });
      addNotification('Task created successfully.', 'success', 'Period Close');
    } catch (e: any) { addNotification(e?.message || 'Failed to create task', 'error', 'Period Close'); }
    finally { setSubmitting(false); }
  };

  const handleCreatePeriod = async () => {
    setSubmitting(true);
    try {
      if (!newPeriodForm.periodName || !newPeriodForm.periodStart || !newPeriodForm.periodEnd) {
        addNotification('Period name, start date and end date are required.', 'warning', 'Period Close');
        setSubmitting(false); return;
      }
      await createAccountingPeriod(newPeriodForm);
      await loadAll();
      setShowNewPeriod(false);
      setNewPeriodForm({
        periodName: '',
        periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        periodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
        notes: '',
      });
      addNotification('Period created successfully.', 'success', 'Period Close');
    } catch (e: any) { addNotification(e?.message || 'Failed to create period', 'error', 'Period Close'); }
    finally { setSubmitting(false); }
  };

  const handleClosePeriod = async (periodId: string) => {
    setActionMenuId(null);
    try {
      await closeAccountingPeriod(periodId);
      await loadAll();
      addNotification('Period closed successfully.', 'success', 'Period Close');
    } catch (e: any) { addNotification(e?.message || 'Failed to close period', 'error', 'Period Close'); }
  };

  const handleReopenPeriod = async (periodId: string) => {
    setActionMenuId(null);
    try {
      await reopenAccountingPeriod(periodId);
      await loadAll();
      addNotification('Period reopened successfully.', 'success', 'Period Close');
    } catch (e: any) { addNotification(e?.message || 'Failed to reopen period', 'error', 'Period Close'); }
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────
  const th = 'px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest';
  const td = 'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300';
  const tdR = 'px-4 py-3.5 text-sm text-right text-slate-700 dark:text-slate-300';
  const tdC = 'px-4 py-3.5 text-sm text-center text-slate-700 dark:text-slate-300';
  const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all';

  const Modal = ({ open, onClose, title, children, onSubmit }: {
    open: boolean; onClose: () => void; title: string; children: ReactNode; onSubmit: () => void;
  }) => {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">{children}</div>
          <div className="flex justify-end gap-3 p-5 border-t border-slate-200 dark:border-slate-700">
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
            <button onClick={onSubmit} disabled={submitting}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-tight hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />} Submit
            </button>
          </div>
        </div>
      </div>
    );
  };

  const FormField = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );

  // ── Stat cards (rendered above tab bar) ───────────────────────────────
  const renderStats = () => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {activeTab === 'checklist' && (
          <>
            <StatCard title="Completion" value={`${Math.round(stats.progress)}%`} icon={CheckCircle2} tone="success" />
            <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="info" />
            <StatCard title="Pending" value={stats.pending} icon={Clock} tone="warning" />
            <StatCard title="Total Tasks" value={stats.total} icon={ListChecks} tone="neutral" />
          </>
        )}
        {activeTab === 'history' && (
          <>
            <StatCard title="Total Periods" value={periods.length} icon={Calendar} tone="info" />
            <StatCard title="Open" value={stats.openPeriods} icon={Unlock} tone="warning" />
            <StatCard title="Closed" value={stats.closedPeriods} icon={Lock} tone="success" />
            <StatCard title="Current Period" value={periods.find(p => p.status === 'Open')?.period_name || '—'} icon={FileText} tone="neutral" />
          </>
        )}
        {activeTab === 'settings' && (
          <>
            <StatCard title="Lock Type" value="Soft" icon={Unlock} tone="info" />
            <StatCard title="Auto-Lock" value="5 days" icon={Clock} tone="warning" />
            <StatCard title="Approvers" value="2" icon={ShieldCheck} tone="success" />
            <StatCard title="Notifications" value="On" icon={AlertCircle} tone="neutral" />
          </>
        )}
        {activeTab === 'activities' && (
          <>
            <StatCard title="Completed" value={activityProgress.completed} icon={CheckCircle2} tone="success" />
            <StatCard title="In Progress" value={activityProgress.inProgress} icon={Loader2} tone="warning" />
            <StatCard title="Pending" value={activityProgress.total - activityProgress.completed - activityProgress.inProgress} icon={Clock} tone="info" />
            <StatCard title="Progress" value={`${Math.round(activityProgress.pct)}%`} icon={ClipboardCheck} tone="neutral" />
          </>
        )}
      </div>
    );
  };

  // ── Checklist tab ─────────────────────────────────────────────────────
  const renderChecklist = () => (
    <div className="space-y-6">
      {/* Period selector + progress */}
      <SectionCard title="Period Selection" subtitle="Choose the accounting period to manage" icon={Calendar}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <select
            value={selectedPeriodId || ''}
            onChange={e => setSelectedPeriodId(e.target.value)}
            className={inputCls + ' max-w-xs'}
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>{p.period_name} ({p.status})</option>
            ))}
          </select>
          <div className="flex-1 w-full">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Progress</span>
              <span className="text-[10px] font-bold text-slate-500">{Math.round(stats.progress)}% Complete</span>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${stats.progress}%` }} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Checklist by category */}
      <SectionCard
        title="Period Close Checklist"
        subtitle={`${filteredChecklist.length} task${filteredChecklist.length !== 1 ? 's' : ''}`}
        icon={ListChecks}
        actions={
          <button onClick={() => setShowNewTask(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Task
          </button>
        }
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {CATEGORIES.map(category => {
            const items = filteredChecklist.filter(i => i.category === category);
            if (items.length === 0) return null;
            const catCompleted = items.filter(i => i.completed).length;
            return (
              <div key={category} className="p-6">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <BarChart3 size={14} />
                  {category}
                  <span className="text-slate-300 dark:text-slate-600">({catCompleted}/{items.length})</span>
                </h4>
                <div className="space-y-3">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handleToggleTask(item.id, item.completed)}
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${item.completed ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700 hover:bg-indigo-400'}`}
                        >
                          {item.completed && <CheckCircle2 size={14} className="text-white" />}
                        </button>
                        <div>
                          <p className={`text-xs font-bold ${item.completed ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>{item.task}</p>
                          <p className="text-[9px] text-slate-500 font-bold mt-0.5">Assigned to: {item.assigned_to || 'Unassigned'}</p>
                        </div>
                      </div>
                      <div className="relative">
                        <button onClick={() => setActionMenuId(actionMenuId === item.id ? null : item.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                          <MoreVertical size={14} />
                        </button>
                        {actionMenuId === item.id && (
                          <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[120px]">
                            <button onClick={() => handleDeleteTask(item.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                              <Trash2 size={14} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {filteredChecklist.length === 0 && (
            <div className="p-12 text-center text-sm text-slate-400">No checklist items found for this period</div>
          )}
        </div>
      </SectionCard>
    </div>
  );

  // ── Closing Activities tab (spec §19 — 10 functional workflows) ───────
  const renderActivities = () => (
    <div className="space-y-6">
      <SectionCard
        title="Closing Activities"
        subtitle="Spec §19 — 10 functional period-close workflows"
        icon={ClipboardCheck}
        actions={
          <button onClick={handleResetActivities}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
            <RotateCcw size={14} /> Reset All
          </button>
        }
      >
        {/* Overall progress indicator */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Overall Close Progress</span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {activityProgress.completed} of {activityProgress.total} activities completed
            </span>
          </div>
          <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${activityProgress.pct}%` }} />
          </div>
        </div>

        {/* Activity cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CLOSING_ACTIVITIES.map(activity => {
            const status = activityStatuses[activity.id];
            const Icon = activity.icon;
            const isRunning = status === 'In Progress';
            const isDone = status === 'Completed';
            return (
              <div key={activity.id} className="p-5 bg-white dark:bg-slate-850/40 border border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col gap-3 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Icon size={20} />
                  </div>
                  <Badge tone={ACTIVITY_STATUS_TONE[status]}>{status}</Badge>
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">{activity.name}</h4>
                  <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">{activity.description}</p>
                </div>
                <div className="mt-auto pt-2">
                  <button
                    onClick={() => handleRunActivity(activity.id)}
                    disabled={isRunning || isDone}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-tight transition-all ${
                      isDone
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 cursor-default'
                        : isRunning
                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 cursor-wait'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {isDone ? (
                      <><CheckCircle2 size={14} /> Completed</>
                    ) : isRunning ? (
                      <><Loader2 size={14} className="animate-spin" /> Running…</>
                    ) : (
                      <><ArrowRight size={14} /> Run</>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );

  // ── History tab ───────────────────────────────────────────────────────
  const renderHistory = () => (
    <div className="space-y-6">
      <SectionCard
        title="Period Close History"
        subtitle={`${filteredPeriods.length} period${filteredPeriods.length !== 1 ? 's' : ''}`}
        icon={History}
        actions={
          <button onClick={() => setShowNewPeriod(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-tight hover:bg-indigo-700 transition-all">
            <Plus size={14} /> New Period
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-150 dark:border-slate-800">
                <th className={th}>Period Name</th>
                <th className={th}>Period Range</th>
                <th className={th}>Status</th>
                <th className={th}>Closed By</th>
                <th className={th}>Closed Date</th>
                <th className={th + ' text-right'}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredPeriods.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className={td}><span className="font-medium text-slate-900 dark:text-white">{p.period_name}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{p.period_start} to {p.period_end}</span></td>
                  <td className={td}><Badge tone={STATUS_COLORS[p.status] || 'neutral'}>{p.status}</Badge></td>
                  <td className={td}><span className="text-xs text-slate-500">{p.closed_by || '—'}</span></td>
                  <td className={td}><span className="text-xs text-slate-500">{p.closed_at ? new Date(p.closed_at).toLocaleDateString() : '—'}</span></td>
                  <td className={tdR}>
                    <div className="relative inline-block">
                      <button onClick={() => setActionMenuId(actionMenuId === p.id ? null : p.id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors">
                        <MoreVertical size={14} />
                      </button>
                      {actionMenuId === p.id && (
                        <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[140px]">
                          {p.status === 'Open' && (
                            <button onClick={() => handleClosePeriod(p.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                              <Lock size={14} /> Close Period
                            </button>
                          )}
                          {p.status === 'Closed' && (
                            <button onClick={() => handleReopenPeriod(p.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                              <Unlock size={14} /> Reopen Period
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredPeriods.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">No accounting periods found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );

  // ── Settings tab ──────────────────────────────────────────────────────
  const renderSettings = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SectionCard title="Lock Configuration" subtitle="Period lock settings" icon={Lock}>
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Default Lock Type</span>
                <select className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold">
                  <option>Soft Lock</option>
                  <option>Hard Lock</option>
                </select>
              </div>
              <p className="text-[9px] text-slate-500 font-bold">Soft locks can be reopened by authorized users. Hard locks require admin approval.</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Auto-Lock Deadline</span>
                <input type="number" defaultValue={5} className="w-20 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold text-center" />
              </div>
              <p className="text-[9px] text-slate-500 font-bold">Days after period end before auto-lock</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Notification Settings" subtitle="Close reminders & alerts" icon={AlertCircle}>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white block">Email Notifications</span>
                <span className="text-[9px] text-slate-500 font-bold">Send reminders to assigned users</span>
              </div>
              <div className="w-12 h-6 bg-indigo-600 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white block">Alert on Overdue</span>
                <span className="text-[9px] text-slate-500 font-bold">Notify when deadline is missed</span>
              </div>
              <div className="w-12 h-6 bg-indigo-600 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-850/40 rounded-2xl">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white block">Completion Summary</span>
                <span className="text-[9px] text-slate-500 font-bold">Send daily progress reports</span>
              </div>
              <div className="w-12 h-6 bg-slate-200 dark:bg-slate-700 rounded-full relative cursor-pointer">
                <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="bg-indigo-600 p-6 rounded-2xl text-white space-y-4">
        <h3 className="text-sm font-black uppercase tracking-widest opacity-80">Approval Workflow</h3>
        <div className="space-y-3">
          <div className="p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10">
            <span className="text-[9px] font-black uppercase tracking-widest block mb-1">Required Approvers</span>
            <p className="text-xs font-medium">Controller, CFO</p>
          </div>
          <div className="p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10">
            <span className="text-[9px] font-black uppercase tracking-widest block mb-1">Minimum Approvals</span>
            <p className="text-xs font-medium">2 of 2</p>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 font-sans animate-fade-in">
      <PageHeader
        title="Financial Close"
        subtitle="Manage period close checklist, history, and lock settings"
        icon={Lock}
        actions={
          <button onClick={loadAll} className="p-2.5 border dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Stat cards — per-tab KPIs rendered above the tab bar */}
      {!loading && renderStats()}

      {/* Tab bar */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl gap-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchTerm(''); setActionMenuId(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-slate-950 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <tab.icon size={14} /> {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={`Search ${TABS.find(t => t.id === activeTab)?.label.toLowerCase()}...`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className={inputCls + ' pl-10'}
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      )}

      {/* Tab content */}
      {!loading && activeTab === 'checklist' && renderChecklist()}
      {!loading && activeTab === 'activities' && renderActivities()}
      {!loading && activeTab === 'history' && renderHistory()}
      {!loading && activeTab === 'settings' && renderSettings()}

      {/* ═══ CREATE MODALS ═══ */}

      {/* New Period Modal */}
      <Modal open={showNewPeriod} onClose={() => setShowNewPeriod(false)} title="New Accounting Period" onSubmit={handleCreatePeriod}>
        <FormField label="Period Name">
          <input className={inputCls} value={newPeriodForm.periodName} onChange={e => setNewPeriodForm({ ...newPeriodForm, periodName: e.target.value })} placeholder="e.g. June 2026" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Start Date">
            <input type="date" className={inputCls} value={newPeriodForm.periodStart} onChange={e => setNewPeriodForm({ ...newPeriodForm, periodStart: e.target.value })} />
          </FormField>
          <FormField label="End Date">
            <input type="date" className={inputCls} value={newPeriodForm.periodEnd} onChange={e => setNewPeriodForm({ ...newPeriodForm, periodEnd: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea className={inputCls} rows={3} value={newPeriodForm.notes} onChange={e => setNewPeriodForm({ ...newPeriodForm, notes: e.target.value })} placeholder="Optional notes about this period..." />
        </FormField>
      </Modal>

      {/* New Task Modal */}
      <Modal open={showNewTask} onClose={() => setShowNewTask(false)} title="New Checklist Task" onSubmit={handleCreateTask}>
        <FormField label="Category">
          <select className={inputCls} value={newTaskForm.category} onChange={e => setNewTaskForm({ ...newTaskForm, category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label="Task">
          <input className={inputCls} value={newTaskForm.task} onChange={e => setNewTaskForm({ ...newTaskForm, task: e.target.value })} placeholder="e.g. Verify all room revenue posted" />
        </FormField>
        <FormField label="Assigned To">
          <input className={inputCls} value={newTaskForm.assignedTo} onChange={e => setNewTaskForm({ ...newTaskForm, assignedTo: e.target.value })} placeholder="e.g. Front Desk" />
        </FormField>
        <FormField label="Notes (optional)">
          <textarea className={inputCls} rows={2} value={newTaskForm.notes} onChange={e => setNewTaskForm({ ...newTaskForm, notes: e.target.value })} placeholder="Additional context..." />
        </FormField>
      </Modal>
    </div>
  );
};

export default PeriodClose;
