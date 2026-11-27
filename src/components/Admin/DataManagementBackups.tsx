/**
 * Data Management & Backups — live DB-integrated admin module.
 * 1. Backups & Restore  → backup_jobs / backup_schedules / backup_restorations
 * 2. Data Retention     → data_retention_policies (per-table policies)
 * 3. Manual Exports     → live table dumps via /api/admin/exports/:dataset
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Archive, Download, ShieldCheck,
  Clock, Save, CheckCircle2, AlertTriangle, Trash2, HardDrive,
  FileJson, FileSpreadsheet, Calendar, CheckCircle, Database,
  Play, RotateCcw, Plus, XCircle, History, Table2, Loader2
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { adminAuthHeaders } from './shared/ResourceManager';
import { AdminSubTabBar } from './shared/AdminSubTabBar';

type BackupTab = 'backups' | 'retention' | 'exports';

const TAB_META: { id: BackupTab; label: string; icon: React.ReactNode }[] = [
  { id: 'backups', label: 'Backups & Restore', icon: <Archive size={14} /> },
  { id: 'retention', label: 'Data Retention', icon: <Clock size={14} /> },
  { id: 'exports', label: 'Manual Exports', icon: <Download size={14} /> },
];

const api = async (path: string, opts: RequestInit = {}) => {
  const res = await fetch(`/api/admin${path}`, { headers: adminAuthHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
};

const fmtBytes = (bytes?: number | null) => {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');

const statusTone = (s?: string) =>
  s === 'completed' || s === 'success' ? 'success' as const
  : s === 'failed' || s === 'error' ? 'danger' as const
  : s === 'running' || s === 'pending' ? 'warning' as const
  : 'neutral' as const;

const CRON_PRESETS = [
  { value: '0 2 * * *', label: 'Daily at 02:00' },
  { value: '0 2 * * 0', label: 'Weekly (Sun) at 02:00' },
  { value: '0 2 1 * *', label: 'Monthly (1st) at 02:00' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
];

export default function DataManagementBackups({ embedded }: { embedded?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<BackupTab>('backups');

  return (
    <div className="space-y-6 animate-fade-in">
      {!embedded && (
        <PageHeader
          title="Data Management & Backups"
          subtitle="Live backup jobs, schedules, retention policies, and data exports"
          icon={Database}
        />
      )}
      <div>
        <AdminSubTabBar tabs={TAB_META} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      <div>
        {activeTab === 'backups' && <BackupsModule />}
        {activeTab === 'retention' && <RetentionModule />}
        {activeTab === 'exports' && <ExportsModule />}
      </div>
    </div>
  );
}

// ─────────────────────────── Backups & Restore ───────────────────────────

function BackupsModule() {
  const [stats, setStats] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [restorations, setRestorations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // new schedule form
  const [schedForm, setSchedForm] = useState({ scheduleName: '', backupType: 'full', cronSchedule: '0 2 * * *', retentionDays: 30, storageLocation: 'supabase' });
  const [showSchedForm, setShowSchedForm] = useState(false);
  // trigger backup form
  const [backupType, setBackupType] = useState('full');
  const [storageLocation, setStorageLocation] = useState('supabase');

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, jb, sc, rs] = await Promise.all([
        api('/backups/statistics').catch(() => ({ statistics: null })),
        api('/backups').catch(() => ({ backups: [] })),
        api('/backup-schedules').catch(() => ({ schedules: [] })),
        api('/backups/restorations').catch(() => ({ restorations: [] })),
      ]);
      setStats(st.statistics);
      setJobs(jb.backups || []);
      setSchedules(sc.schedules || []);
      setRestorations(rs.restorations || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>, okMsg: string) => {
    setBusy(key);
    try { await fn(); notify(okMsg); await load(); }
    catch (e: any) { notify(e?.message || 'Action failed', 'error'); }
    finally { setBusy(null); }
  };

  const cards = [
    { title: 'Total Backups', value: stats?.total_backups ?? jobs.length, icon: Archive, tone: 'accent' as const },
    { title: 'Successful', value: stats?.successful_backups ?? '—', icon: CheckCircle2, tone: 'success' as const },
    { title: 'Failed', value: stats?.failed_backups ?? '—', icon: XCircle, tone: 'danger' as const },
    { title: 'Storage Used', value: fmtBytes(stats?.total_size_bytes), icon: HardDrive, tone: 'info' as const },
    { title: 'Last Backup', value: stats?.last_backup_time ? new Date(stats.last_backup_time).toLocaleDateString() : 'Never', icon: Clock, tone: 'warning' as const },
    { title: 'Active Schedules', value: schedules.filter(s => s.is_active).length, icon: Calendar, tone: 'neutral' as const },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map(c => <StatCard key={c.title} title={c.title} value={c.value} icon={c.icon} tone={c.tone} />)}
      </div>

      {toast && (
        <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-2 border ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20'
            : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-500/20'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Schedules */}
        <SectionCard
          title="Backup Schedules"
          subtitle={`${schedules.length} configured schedules`}
          icon={Calendar}
          tone="info"
          pad="md"
          actions={
            <button onClick={() => setShowSchedForm(v => !v)} className={button.secondary}>
              <Plus size={14} /> New
            </button>
          }
        >
          {showSchedForm && (
            <div className="mb-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input placeholder="Schedule name" value={schedForm.scheduleName}
                onChange={e => setSchedForm(f => ({ ...f, scheduleName: e.target.value }))}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
              <select value={schedForm.backupType} onChange={e => setSchedForm(f => ({ ...f, backupType: e.target.value }))}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none">
                <option value="full">Full</option>
                <option value="incremental">Incremental</option>
                <option value="schema_only">Schema Only</option>
              </select>
              <select value={schedForm.cronSchedule} onChange={e => setSchedForm(f => ({ ...f, cronSchedule: e.target.value }))}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none">
                {CRON_PRESETS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input type="number" min={1} placeholder="Retention (days)" value={schedForm.retentionDays}
                onChange={e => setSchedForm(f => ({ ...f, retentionDays: Number(e.target.value) }))}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
              <div className="sm:col-span-2 flex gap-2">
                <button className={button.primary} disabled={busy === 'sched-create' || !schedForm.scheduleName.trim()}
                  onClick={() => run('sched-create', async () => {
                    await api('/backup-schedules', { method: 'POST', body: JSON.stringify(schedForm) });
                    setShowSchedForm(false);
                    setSchedForm(f => ({ ...f, scheduleName: '' }));
                  }, 'Schedule created')}>
                  {busy === 'sched-create' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Create Schedule
                </button>
                <button className={button.ghost} onClick={() => setShowSchedForm(false)}>Cancel</button>
              </div>
            </div>
          )}
          <div className="divide-y divide-gray-100 dark:divide-slate-700 max-h-80 overflow-y-auto">
            {schedules.length === 0 && !loading && (
              <div className="py-8 text-center text-sm text-gray-400">No backup schedules configured</div>
            )}
            {schedules.map(sc => (
              <div key={sc.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{sc.schedule_name}</span>
                    <Badge tone={sc.is_active ? 'success' : 'neutral'}>{sc.is_active ? 'Active' : 'Paused'}</Badge>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {sc.backup_type} · cron <code className="font-mono">{sc.cron_schedule}</code> · retain {sc.retention_days}d · {sc.storage_location}
                    {sc.next_run_at && <> · next {fmtDate(sc.next_run_at)}</>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button title={sc.is_active ? 'Pause' : 'Resume'}
                    onClick={() => run(`sched-toggle-${sc.id}`, () => api(`/backup-schedules/${sc.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !sc.is_active }) }).then(() => {}), sc.is_active ? 'Schedule paused' : 'Schedule resumed')}
                    className={button.ghost}>
                    <PowerIcon active={sc.is_active} />
                  </button>
                  <button title="Delete"
                    onClick={() => run(`sched-del-${sc.id}`, () => api(`/backup-schedules/${sc.id}`, { method: 'DELETE' }), 'Schedule deleted')}
                    className={`${button.ghost} hover:text-rose-600`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Trigger + Jobs */}
        <SectionCard
          title="Backup Jobs"
          subtitle={`${jobs.length} recent jobs`}
          icon={Archive}
          tone="accent"
          pad="md"
          actions={
            <div className="flex items-center gap-2">
              <select value={backupType} onChange={e => setBackupType(e.target.value)}
                className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none">
                <option value="full">Full</option>
                <option value="incremental">Incremental</option>
                <option value="schema_only">Schema Only</option>
              </select>
              <button className={button.primary} disabled={busy === 'backup-create'}
                onClick={() => run('backup-create', async () => {
                  await api('/backups/create', { method: 'POST', body: JSON.stringify({ backupType, storageLocation }) });
                }, 'Backup job queued')}>
                {busy === 'backup-create' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run Now
              </button>
            </div>
          }
        >
          <div className="divide-y divide-gray-100 dark:divide-slate-700 max-h-96 overflow-y-auto">
            {jobs.length === 0 && !loading && (
              <div className="py-8 text-center text-sm text-gray-400">No backup jobs yet — run your first backup</div>
            )}
            {jobs.map(job => (
              <div key={job.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white capitalize">{job.backup_type?.replace('_', ' ')}</span>
                    <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {fmtBytes(job.backup_size_bytes)} · {job.storage_location} · started {fmtDate(job.initiated_at)}
                    {job.completed_at && <> · finished {fmtDate(job.completed_at)}</>}
                  </div>
                  {job.error_message && <div className="text-xs text-rose-500 mt-0.5 truncate">{job.error_message}</div>}
                </div>
                {job.status === 'completed' && job.storage_path && (
                  <button title="Download backup manifest"
                    disabled={busy === `dl-${job.id}`}
                    onClick={() => run(`dl-${job.id}`, async () => {
                      const res = await api(`/backups/${job.id}/download`);
                      window.open(res.url, '_blank');
                    }, 'Download ready')}
                    className={button.ghost}>
                    {busy === `dl-${job.id}` ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  </button>
                )}
                <button title="Restore this backup"
                  disabled={job.status !== 'completed' || busy === `restore-${job.id}`}
                  onClick={() => run(`restore-${job.id}`, async () => {
                    await api(`/backups/${job.id}/restore`, { method: 'POST', body: JSON.stringify({}) });
                  }, 'Restore requested')}
                  className={`${button.ghost} disabled:opacity-40`}>
                  {busy === `restore-${job.id}` ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Restore history */}
      <SectionCard title="Restore History" subtitle={`${restorations.length} restoration records`} icon={History} tone="warning" pad="md">
        <div className="divide-y divide-gray-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
          {restorations.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-gray-400">No restorations recorded</div>
          )}
          {restorations.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-white capitalize">{r.backup_jobs?.backup_type?.replace('_', ' ') || 'Backup'}</span>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  requested {fmtDate(r.initiated_at)}
                  {r.rows_restored != null && <> · {r.rows_restored.toLocaleString()} rows restored</>}
                </div>
                {r.error_message && <div className="text-xs text-rose-500 mt-0.5 truncate">{r.error_message}</div>}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Cleanup */}
      <div className="flex justify-end">
        <button className={button.secondary}
          disabled={busy === 'cleanup'}
          onClick={() => run('cleanup', async () => {
            const days = prompt('Delete completed backups older than how many days?', '30');
            if (!days) return;
            const res = await api('/backups/cleanup', { method: 'POST', body: JSON.stringify({ retentionDays: Number(days) }) });
            notify(`Cleanup complete — ${res.deletedCount ?? 0} backup records removed`);
          }, 'Cleanup done')}>
          {busy === 'cleanup' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Cleanup Old Backups
        </button>
      </div>
    </div>
  );
}

function PowerIcon({ active }: { active: boolean }) {
  return active ? <CheckCircle size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-gray-400" />;
}

// ─────────────────────────── Data Retention ───────────────────────────

interface RetentionPolicy {
  id: string;
  table_name: string;
  retention_days: number;
  action: string;
  enabled: boolean;
  property_id?: string | null;
}

function RetentionModule() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/compliance/retention-policies').catch(() => ({ policies: [] }));
      setPolicies(res.policies || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (p: RetentionPolicy, updates: Partial<RetentionPolicy>) => {
    setBusyId(p.id);
    try {
      await api(`/compliance/retention-policies/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          retentionDays: updates.retention_days,
          action: updates.action,
          enabled: updates.enabled,
        }),
      });
      setPolicies(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
    } catch (e: any) { notify(e?.message || 'Save failed', 'error'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-6 animate-fade-in pt-4 max-w-6xl mx-auto">
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 text-sm">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>Retention policies are enforced per table. Shorter windows free storage; longer windows preserve audit history. Changes apply to future retention runs.</span>
      </div>

      {toast && (
        <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-2 border ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100'
            : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-100'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      <SectionCard title="Per-Table Retention Policies" subtitle={`${policies.filter(p => p.enabled).length} of ${policies.length} policies enabled`} icon={ShieldCheck} tone="warning" pad="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                <th className="px-5 py-3">Table</th>
                <th className="px-5 py-3">Retention (days)</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Enabled</th>
                <th className="px-5 py-3 text-right">Save</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {policies.map(p => (
                <PolicyRow key={p.id} policy={p} busy={busyId === p.id} onSave={save} />
              ))}
              {policies.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">No retention policies configured</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function PolicyRow({ policy, busy, onSave }: { policy: RetentionPolicy; busy: boolean; onSave: (p: RetentionPolicy, u: Partial<RetentionPolicy>) => void }) {
  const [days, setDays] = useState(policy.retention_days);
  const [action, setAction] = useState(policy.action);
  const [enabled, setEnabled] = useState(policy.enabled);
  const dirty = days !== policy.retention_days || action !== policy.action || enabled !== policy.enabled;

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
      <td className="px-5 py-3">
        <span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200">{policy.table_name}</span>
      </td>
      <td className="px-5 py-3">
        <input type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))}
          className="w-24 px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
      </td>
      <td className="px-5 py-3">
        <select value={action} onChange={e => setAction(e.target.value)}
          className="px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none capitalize">
          <option value="archive">Archive</option>
          <option value="delete">Delete</option>
          <option value="anonymize">Anonymize</option>
        </select>
      </td>
      <td className="px-5 py-3">
        <button role="switch" aria-checked={enabled} onClick={() => setEnabled(v => !v)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </td>
      <td className="px-5 py-3 text-right">
        <button disabled={!dirty || busy} onClick={() => onSave(policy, { retention_days: days, action, enabled })}
          className={`${button.ghost} disabled:opacity-40`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </td>
    </tr>
  );
}

// ─────────────────────────── Manual Exports ───────────────────────────

interface ExportDataset { label: string; table: string; count: number }

function ExportsModule() {
  const [datasets, setDatasets] = useState<Record<string, ExportDataset>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api('/exports/summary').catch(() => ({ datasets: {} }));
        setDatasets(res.datasets || {});
      } finally { setLoading(false); }
    })();
  }, []);

  const download = async (key: string, format: 'csv' | 'json') => {
    setExporting(`${key}-${format}`);
    try {
      const res = await api(`/exports/${key}?limit=20000`);
      const rows: any[] = res.rows || [];
      const label = datasets[key]?.label || key;
      if (format === 'json') {
        const blob = new Blob([JSON.stringify({ dataset: label, table: res.table, exportedAt: res.exportedAt, rows }, null, 2)], { type: 'application/json' });
        triggerDownload(blob, `${label.toLowerCase().replace(/\s+/g, '_')}_export.json`);
      } else {
        const headers = rows.length ? Object.keys(rows[0]) : [];
        const csvRows = rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
        const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv' });
        triggerDownload(blob, `${label.toLowerCase().replace(/\s+/g, '_')}_export.csv`);
      }
      notify(res.truncated ? `Exported ${rows.length.toLocaleString()} of ${res.count.toLocaleString()} rows (truncated)` : `Exported ${rows.length.toLocaleString()} rows`, res.truncated ? 'error' : 'success');
    } catch (e: any) { notify(e?.message || 'Export failed', 'error'); }
    finally { setExporting(null); }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const entries = Object.entries(datasets);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {entries.map(([key, ds]) => (
          <StatCard key={key} title={ds.label} value={ds.count.toLocaleString()} icon={Table2} tone="info" />
        ))}
        {loading && entries.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-gray-400">Loading datasets…</div>
        )}
      </div>

      {toast && (
        <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-2 border ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100'
            : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-100'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      <SectionCard title="Manual Data Export" subtitle="Download live table data as CSV or JSON" icon={Download} tone="info" pad="md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entries.map(([key, ds]) => (
            <div key={key} className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-bold text-gray-900 dark:text-white">{ds.label}</span>
                <span className="text-[10px] font-mono text-gray-400 block">{ds.table} · {ds.count.toLocaleString()} records</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => download(key, 'csv')} disabled={exporting !== null}
                  className="px-3 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-700 transition flex items-center gap-1 disabled:opacity-40">
                  {exporting === `${key}-csv` ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />} CSV
                </button>
                <button onClick={() => download(key, 'json')} disabled={exporting !== null}
                  className="px-3 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-700 transition flex items-center gap-1 disabled:opacity-40">
                  {exporting === `${key}-json` ? <Loader2 size={12} className="animate-spin" /> : <FileJson size={12} />} JSON
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
