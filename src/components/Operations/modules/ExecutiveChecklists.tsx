/**
 * Executive Checklists — Operations Portal (/erp/operations/executive-checklists).
 *
 * Recurring daily/weekly/monthly executive checklist templates persisted
 * in `ops_exec_checklists` via /api/ops-portal/executive-checklists.
 * Effective status auto-resets each period server-side (completed_at in
 * current day/week/month → completed, started_at → in-progress).
 *
 * Each card also surfaces a live cross-portal context line (open
 * escalations, critical incidents, pending audits…) so the exec knows
 * what the checklist will actually find.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Calendar,
  MapPin,
  Building2,
  Shield,
  Search,
  Plus,
  Clock,
  RefreshCw,
  Loader2,
  Play,
  CheckCircle2,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchExecutiveChecklists,
  createExecutiveChecklist,
  updateExecutiveChecklist,
  deleteExecutiveChecklist,
  type ExecChecklistItem,
  type ExecChecklistFrequency,
} from '../../../services/operationsService';

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType }> = {
  walkthrough: { label: 'Walkthrough', icon: MapPin },
  inspection: { label: 'Inspection', icon: Building2 },
  review: { label: 'Review', icon: CheckSquare },
  safety: { label: 'Safety', icon: Shield },
  audit: { label: 'Audit', icon: Activity },
  compliance: { label: 'Compliance', icon: Shield },
  operational: { label: 'Operational', icon: CheckSquare },
};

const CATEGORY_OPTIONS = Object.keys(CATEGORY_META);

const statusTone = (s: ExecChecklistItem['status']): 'success' | 'info' | 'neutral' =>
  ({ completed: 'success', 'in-progress': 'info', pending: 'neutral' } as const)[s];

const fmtTs = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const ExecutiveChecklists: React.FC = () => {
  const { currentPropertyId } = useERP();
  const [items, setItems] = useState<ExecChecklistItem[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, inProgress: 0, pending: 0, daily: 0, weekly: 0, monthly: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [frequency, setFrequency] = useState<'all' | ExecChecklistFrequency>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ExecChecklistItem['status']>('all');
  const [search, setSearch] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', frequency: 'daily' as ExecChecklistFrequency, category: 'operational', assignedTo: '', dueBy: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExecutiveChecklists(currentPropertyId || undefined);
      setItems(data.items);
      setStats(data.stats);
    } catch (e: any) {
      setError(e?.message || 'Failed to load executive checklists');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'start' | 'complete' | 'reset') => {
    setBusy(id);
    try {
      await updateExecutiveChecklist(id, { action });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this checklist item?')) return;
    setBusy(id);
    try {
      await deleteExecutiveChecklist(id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const submitCreate = async () => {
    if (!form.title.trim()) return;
    setBusy('create');
    try {
      await createExecutiveChecklist({
        title: form.title.trim(),
        frequency: form.frequency,
        category: form.category,
        assignedTo: form.assignedTo || undefined,
        dueBy: form.dueBy || undefined,
        propertyId: currentPropertyId || undefined,
      });
      setForm({ title: '', frequency: 'daily', category: 'operational', assignedTo: '', dueBy: '' });
      setShowCreate(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Create failed');
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => items.filter(item => {
    if (frequency !== 'all' && item.frequency !== frequency) return false;
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !(item.assignedTo || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, frequency, statusFilter, search]);

  const completionPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Executive Checklists"
        subtitle="Recurring daily, weekly and monthly executive duties — status auto-resets each period"
        actions={
          <>
            <button className={button.secondary} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button className={button.primary} onClick={() => setShowCreate(v => !v)}>
              <Plus size={16} /> Add Checklist
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Completion" value={`${completionPct}%`} caption={`${stats.completed} of ${stats.total} items`} icon={CheckSquare} tone={completionPct >= 80 ? 'success' : completionPct >= 40 ? 'info' : 'warning'} />
        <StatCard label="Completed" value={stats.completed} caption="this period" icon={CheckCircle2} tone="success" />
        <StatCard label="In Progress" value={stats.inProgress} caption="started, not finished" icon={Clock} tone="info" />
        <StatCard label="Pending" value={stats.pending} caption={`${stats.daily}D · ${stats.weekly}W · ${stats.monthly}M`} icon={AlertTriangle} tone={stats.pending > 0 ? 'warning' : 'neutral'} />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {showCreate && (
        <SectionCard title="New Checklist Item" subtitle="Recurring executive duty">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input className={`${inputCls} md:col-span-2`} placeholder="Checklist title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <select className={inputCls} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as ExecChecklistFrequency }))}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <select className={inputCls} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
            </select>
            <input className={inputCls} placeholder="Assigned to" value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <input className={`${inputCls} flex-1`} placeholder="Due hint (e.g. Today 10:00, Friday 16:00, Month End)" value={form.dueBy} onChange={e => setForm(f => ({ ...f, dueBy: e.target.value }))} />
            <button className={button.primary} onClick={submitCreate} disabled={busy === 'create' || !form.title.trim()}>
              {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create
            </button>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Checklists"
        subtitle={`${filtered.length} of ${items.length} items`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-8 w-44`} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {(['all', 'daily', 'weekly', 'monthly'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFrequency(f)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    frequency === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <select className={inputCls} value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading checklists…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No checklist items match the filters.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => {
              const meta = CATEGORY_META[item.category] || CATEGORY_META.operational;
              const CategoryIcon = meta.icon;
              const isBusy = busy === item.id;
              return (
                <div key={item.id} className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800/60">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${
                        item.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                        : item.status === 'in-progress' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400'
                      }`}>
                        <CategoryIcon size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 dark:text-white">{item.title}</span>
                          <Badge tone={statusTone(item.status)}>{item.status.replace('-', ' ')}</Badge>
                          <Badge tone="neutral">{meta.label}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-sm text-slate-600 dark:text-slate-400 flex-wrap">
                          <span className="flex items-center gap-1"><Calendar size={14} />{item.frequency}</span>
                          {item.dueBy && <span className="flex items-center gap-1"><Clock size={14} />{item.dueBy}</span>}
                          {item.assignedTo && <span>Assigned to: {item.assignedTo}</span>}
                        </div>
                        {item.context && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                            <AlertTriangle size={12} /> {item.context}
                          </p>
                        )}
                        {item.lastCompleted && (
                          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                            Last completed: {fmtTs(item.lastCompleted)}{item.completedBy ? ` by ${item.completedBy}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'pending' && (
                        <button className={button.secondary} onClick={() => act(item.id, 'start')} disabled={isBusy}>
                          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start
                        </button>
                      )}
                      {item.status !== 'completed' && (
                        <button className={button.primary} onClick={() => act(item.id, 'complete')} disabled={isBusy}>
                          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Complete
                        </button>
                      )}
                      {item.status !== 'pending' && (
                        <button className={button.ghost} onClick={() => act(item.id, 'reset')} disabled={isBusy} title="Reset this period">
                          <RotateCcw size={14} />
                        </button>
                      )}
                      <button className={button.ghost} onClick={() => remove(item.id)} disabled={isBusy} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default ExecutiveChecklists;
