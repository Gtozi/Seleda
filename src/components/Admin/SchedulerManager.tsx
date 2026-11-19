import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Play, Clock, CheckCircle2, XCircle, Settings2,
  Calendar, Zap, AlertCircle, History, Timer, ListChecks, AlertTriangle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { adminAuthHeaders } from './shared/ResourceManager';

interface ScheduledJob {
  id: string;
  name: string;
  type: string;
  schedule_cron: string;
  config: any;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at?: string;
}

interface JobRun {
  id: string;
  job_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result: any;
  error: string | null;
  created_at: string;
}

interface SchedulerStats {
  total: number;
  active: number;
  disabled: number;
  runs24h: number;
  failed24h: number;
}

const TYPE_TONES: Record<string, 'info' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  night_audit: 'accent',
  allotment_release: 'warning',
  report_email: 'info',
  backup: 'success',
};

const runTone = (s?: string) =>
  s === 'success' || s === 'completed' ? 'success' as const
  : s === 'failed' ? 'danger' as const
  : s === 'running' ? 'info' as const
  : 'warning' as const;

const SchedulerManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [runs, setRuns] = useState<Record<string, JobRun[]>>({});
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editJob, setEditJob] = useState<ScheduledJob | null>(null);
  const [editForm, setEditForm] = useState({ name: '', scheduleCron: '', enabled: true });
  const [busy, setBusy] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/scheduler/jobs', { headers: adminAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load jobs');
      setJobs(data.jobs || []);
      setStats(data.stats || null);
    } catch (err: any) { setError(err.message || 'Failed to load jobs'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadRuns = async (jobId: string) => {
    try {
      const res = await fetch(`/api/admin/scheduler/jobs/${jobId}/runs`, { headers: adminAuthHeaders() });
      const data = await res.json();
      setRuns(prev => ({ ...prev, [jobId]: data.runs || [] }));
    } catch (err: any) { setError(err.message); }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); await loadData(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const handleToggle = (job: ScheduledJob) => run(`toggle-${job.id}`, async () => {
    await fetch(`/api/admin/scheduler/jobs/${job.id}`, {
      method: 'PATCH', headers: adminAuthHeaders(), body: JSON.stringify({ enabled: !job.enabled }),
    });
  });

  const handleTrigger = (job: ScheduledJob) => run(`trigger-${job.id}`, async () => {
    const res = await fetch(`/api/admin/scheduler/jobs/${job.id}/trigger`, { method: 'POST', headers: adminAuthHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Trigger failed');
    if (expandedJob === job.id) loadRuns(job.id);
  });

  const handleEditSave = () => run('edit-save', async () => {
    if (!editJob) return;
    const res = await fetch(`/api/admin/scheduler/jobs/${editJob.id}`, {
      method: 'PATCH', headers: adminAuthHeaders(), body: JSON.stringify(editForm),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Save failed');
    setShowEditModal(false);
  });

  const cards = [
    { title: 'Total Jobs', value: stats?.total ?? jobs.length, icon: ListChecks, tone: 'accent' as const },
    { title: 'Active', value: stats?.active ?? '—', icon: CheckCircle2, tone: 'success' as const },
    { title: 'Disabled', value: stats?.disabled ?? '—', icon: XCircle, tone: 'neutral' as const },
    { title: 'Runs (24h)', value: stats?.runs24h ?? '—', icon: Timer, tone: 'info' as const },
    { title: 'Failed (24h)', value: stats?.failed24h ?? '—', icon: AlertTriangle, tone: 'danger' as const },
  ];

  return (
    <div className="space-y-6 animate-fade-in pt-4">
      <PageHeader
        title="Scheduler & Job Engine"
        subtitle="Live cron job runner — night audit, allotment release, reports, and backups"
        icon={Calendar}
        actions={
          <button onClick={loadData} disabled={loading} className={button.secondary}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {error && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map(c => <StatCard key={c.title} title={c.title} value={c.value} icon={c.icon} tone={c.tone} />)}
      </div>

      <SectionCard
        title="Scheduled Jobs"
        subtitle={`${jobs.length} jobs · node-cron engine`}
        icon={Zap}
        tone="info"
        pad="none"
      >
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{loading ? 'Loading jobs…' : 'No scheduled jobs.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="px-5 py-3">Job</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Schedule</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Last Run</th>
                  <th className="px-5 py-3">Next Run</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {jobs.map(j => (
                  <React.Fragment key={j.id}>
                    <tr className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 ${expandedJob === j.id ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`}>
                      <td className="px-5 py-3">
                        <button onClick={() => { if (expandedJob === j.id) setExpandedJob(null); else { setExpandedJob(j.id); loadRuns(j.id); } }}
                          className="text-left">
                          <span className="text-sm font-bold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">{j.name}</span>
                          <span className="block text-[10px] font-mono text-gray-400">{j.id.slice(0, 8)}</span>
                        </button>
                      </td>
                      <td className="px-5 py-3"><Badge tone={TYPE_TONES[j.type] || 'neutral'}>{j.type?.replace(/_/g, ' ') || 'job'}</Badge></td>
                      <td className="px-5 py-3"><code className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">{j.schedule_cron}</code></td>
                      <td className="px-5 py-3">
                        <button onClick={() => handleToggle(j)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${j.enabled ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                          {j.enabled ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{j.last_run ? new Date(j.last_run).toLocaleString() : 'Never'}</td>
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">{j.next_run ? new Date(j.next_run).toLocaleString() : '—'}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => handleTrigger(j)} disabled={busy === `trigger-${j.id}`}
                            className={`${button.ghost} disabled:opacity-40`} title="Run now">
                            {busy === `trigger-${j.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                          </button>
                          <button onClick={() => { setEditJob(j); setEditForm({ name: j.name, scheduleCron: j.schedule_cron, enabled: j.enabled }); setShowEditModal(true); }}
                            className={button.ghost} title="Edit">
                            <Settings2 size={14} />
                          </button>
                          <button onClick={() => { if (expandedJob === j.id) setExpandedJob(null); else { setExpandedJob(j.id); loadRuns(j.id); } }}
                            className={button.ghost} title="Run history">
                            <History size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedJob === j.id && (
                      <tr>
                        <td colSpan={7} className="px-5 py-4 bg-slate-50/60 dark:bg-slate-800/30">
                          <RunHistory runs={runs[j.id] || []} loading={!runs[j.id]} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Edit Modal */}
      <ModalSystem isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Scheduled Job" subtitle="Modify schedule and settings" variant="form" size="md" showFooter={false}>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Job Name</label>
            <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Cron Schedule</label>
            <input value={editForm.scheduleCron} onChange={e => setEditForm({ ...editForm, scheduleCron: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500" placeholder="0 2 * * *" />
            <p className="text-[9px] font-bold text-slate-400 mt-1">Format: minute hour day month weekday (e.g., "0 2 * * *" = daily at 2 AM)</p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Enabled</label>
            <select value={String(editForm.enabled)} onChange={e => setEditForm({ ...editForm, enabled: e.target.value === 'true' })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="true">Active</option><option value="false">Disabled</option>
            </select>
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-950">
          <button onClick={() => setShowEditModal(false)} className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleEditSave} disabled={busy === 'edit-save'} className="px-6 py-2.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition disabled:opacity-50">
            {busy === 'edit-save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </ModalSystem>
    </div>
  );
};

function RunHistory({ runs, loading }: { runs: JobRun[]; loading: boolean }) {
  if (loading) return <div className="py-4 text-center text-xs text-gray-400">Loading run history…</div>;
  if (runs.length === 0) return <div className="py-4 text-center text-xs text-gray-400">No runs recorded.</div>;
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
        <Clock size={11} /> Recent Runs ({runs.length})
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-700">
        {runs.slice(0, 10).map(run => (
          <div key={run.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={runTone(run.status)}>{run.status}</Badge>
                <span className="text-[10px] font-bold text-gray-400">{new Date(run.created_at).toLocaleString()}</span>
              </div>
              {run.error && <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1"><AlertCircle size={9} /> {run.error}</p>}
              {run.result != null && <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mt-1 truncate max-w-xl">{typeof run.result === 'string' ? run.result : JSON.stringify(run.result)}</p>}
            </div>
            <span className="text-[9px] font-bold text-gray-400 shrink-0">
              {run.started_at && run.completed_at
                ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
                : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SchedulerManager;
