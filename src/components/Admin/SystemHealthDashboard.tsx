import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Server, Database, Wifi, RefreshCw, AlertTriangle, Bug, HardDrive, XCircle, Shield, Clock, CheckCircle2 } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button } from '../FrontOffice/brandTheme';
import { adminAuthHeaders } from './shared/ResourceManager';

interface HealthResponse {
  status: string;
  system: string;
  authStore: string;
  timestamp: string;
}

interface AuditEvent {
  id: string;
  action: string;
  module?: string;
  outcome?: string;
  timestamp?: string;
  user_name?: string;
}

interface ErrorLog {
  id: string;
  level: string;
  message: string;
  stack_trace: string | null;
  context: any;
  timestamp: string;
}

interface FailedJob {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  scheduled_jobs?: { name: string } | null;
}

export default function SystemHealthDashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const [totalTables, setTotalTables] = useState<number>(0);
  const [countedTables, setCountedTables] = useState<number>(0);
  const [dbStatsPartial, setDbStatsPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const started = performance.now();
      const res = await fetch('/api/health');
      const elapsed = Math.round(performance.now() - started);
      if (!res.ok) throw new Error(`Health check failed (${res.status})`);
      const data: HealthResponse = await res.json();
      setHealth(data);
      setLatencyMs(elapsed);
      setLastChecked(new Date());
    } catch (err: any) {
      setHealth(null);
      setError(err?.message || 'Unable to reach the API node');
    }

    try {
      const res = await fetch('/api/audit/events', { headers: adminAuthHeaders(), credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEvents(Array.isArray(data?.events) ? data.events.slice(0, 12) : []);
      } else {
        setEvents([]);
      }
    } catch {
      setEvents([]);
    }

    try {
      const [errRes, jobRes, dbRes] = await Promise.all([
        fetch('/api/admin/health/error-logs', { headers: adminAuthHeaders() }).then(r => r.json()).catch(() => ({ logs: [] })),
        fetch('/api/admin/health/job-failures', { headers: adminAuthHeaders() }).then(r => r.json()).catch(() => ({ failedJobs: [] })),
        fetch('/api/admin/health/db-stats', { headers: adminAuthHeaders() }).then(r => r.json()).catch(() => ({ tableCounts: {} })),
      ]);
      setErrorLogs(errRes.logs || []);
      setFailedJobs(jobRes.failedJobs || []);
      setTableCounts(dbRes.tableCounts || {});
      setTotalTables(typeof dbRes.totalTables === 'number' ? dbRes.totalTables : Object.keys(dbRes.tableCounts || {}).length);
      setCountedTables(typeof dbRes.countedTables === 'number' ? dbRes.countedTables : Object.keys(dbRes.tableCounts || {}).length);
      setDbStatsPartial(Boolean(dbRes.partial));
    } catch {
      // non-critical
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const tableEntries = Object.entries(tableCounts).sort((a, b) => b[1] - a[1]);
  const visibleTables = tableEntries.slice(0, 60);

  const apiUp = Boolean(health) && !error;
  const errorEvents = events.filter(e => {
    const a = (e.action || '').toLowerCase();
    return e.outcome === 'denied' || a.includes('fail') || a.includes('error') || a.includes('denied');
  });

  const cards = [
    {
      icon: Server,
      title: 'API Status',
      value: apiUp ? (health?.status === 'operational' ? 'Operational' : health?.status || 'Up') : 'Down',
      tone: apiUp ? 'success' as const : 'danger' as const,
    },
    {
      icon: Activity,
      title: 'API Latency',
      value: latencyMs != null ? `${latencyMs}ms` : '--',
      tone: latencyMs != null && latencyMs < 500 ? 'success' as const : 'warning' as const,
    },
    {
      icon: Database,
      title: 'Auth Store',
      value: health?.authStore === 'database' ? 'Database' : health?.authStore === 'development-fallback' ? 'Dev Fallback' : '--',
      tone: health?.authStore === 'database' ? 'success' as const : 'warning' as const,
    },
    {
      icon: AlertTriangle,
      title: 'Recent Errors',
      value: errorEvents.length,
      tone: errorEvents.length === 0 ? 'success' as const : 'danger' as const,
    },
    {
      icon: HardDrive,
      title: 'DB Tables',
      value: totalTables || Object.keys(tableCounts).length,
      tone: 'info' as const,
    },
    {
      icon: XCircle,
      title: 'Failed Jobs',
      value: failedJobs.length,
      tone: failedJobs.length === 0 ? 'success' as const : 'danger' as const,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pt-4">
      <PageHeader
        title="System Health & Monitoring"
        subtitle="Live API status, database health, error logs, and scheduler monitoring"
        icon={Activity}
        actions={
          <>
            {lastChecked && (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Clock size={12} /> Last checked {lastChecked.toLocaleTimeString()}
              </span>
            )}
            <button onClick={load} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 rounded-xl text-sm font-bold flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((card, i) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            tone={card.tone}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Node Information */}
        <SectionCard title="Node Information" subtitle="API node status and configuration" icon={Server} tone="accent" pad="md">
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">System</span>
              <span className="text-sm font-mono font-bold text-gray-900 dark:text-white">{health?.system || '--'}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">Server Time</span>
              <span className="text-sm font-mono font-bold text-gray-900 dark:text-white">{health?.timestamp ? new Date(health.timestamp).toLocaleString() : '--'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
              <Badge tone={apiUp ? 'success' : 'danger'}>
                {apiUp ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {apiUp ? 'Operational' : 'Down'}
              </Badge>
            </div>
          </div>
        </SectionCard>

        {/* Database Table Counts */}
        <SectionCard title="Database Table Counts" subtitle={`${totalTables || Object.keys(tableCounts).length} relations in schema · ${countedTables || Object.keys(tableCounts).length} counted${dbStatsPartial ? ' (partial)' : ''}`} icon={Database} tone="info" pad="md">
          {tableEntries.length === 0 ? (
            <div className="h-32 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-center text-sm text-gray-400">
              No data available
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {visibleTables.map(([table, count]) => (
                <div key={table} className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <span className="text-xs font-mono font-bold text-gray-600 dark:text-gray-400 truncate">{table}</span>
                  <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">{count.toLocaleString()}</span>
                </div>
              ))}
              {tableEntries.length > visibleTables.length && (
                <div className="col-span-full text-center text-xs text-gray-400 pt-1">+{(tableEntries.length - visibleTables.length).toLocaleString()} more relations not shown</div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Recent Audit Events */}
      <SectionCard title="Recent Audit Events" subtitle="Latest system audit trail" icon={Activity} tone="accent" pad="none">
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {events.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              {loading ? 'Loading events...' : 'No audit events available (requires audit:view permission)'}
            </div>
          ) : (
            events.map((e, i) => {
              const isError = errorEvents.includes(e);
              return (
                <div key={e.id || i} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                  <span className="text-xs font-mono text-gray-400 w-40 shrink-0">{e.timestamp ? new Date(e.timestamp).toLocaleString() : '--'}</span>
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300 w-44 shrink-0 truncate">{e.action}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{e.module || 'system'}{e.user_name ? ` · ${e.user_name}` : ''}</span>
                  {isError && <Badge tone="danger">Error</Badge>}
                </div>
              );
            })
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error Logs */}
        <SectionCard title="Error Logs" subtitle={`${errorLogs.length} recent errors`} icon={Bug} tone="danger" pad="none">
          <div className="divide-y divide-gray-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
            {errorLogs.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No error logs recorded</div>
            ) : (
              errorLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${log.level === 'error' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                  <span className="text-xs font-mono text-gray-400 w-36 shrink-0">{new Date(log.timestamp).toLocaleString()}</span>
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300 truncate">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        {/* Failed Jobs */}
        <SectionCard title="Failed Jobs" subtitle={`${failedJobs.length} failed scheduler jobs`} icon={XCircle} tone="danger" pad="none">
          <div className="divide-y divide-gray-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
            {failedJobs.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No failed jobs</div>
            ) : (
              failedJobs.map((job) => (
                <div key={job.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                  <XCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                  <span className="text-xs font-mono text-gray-400 w-36 shrink-0">{new Date(job.created_at).toLocaleString()}</span>
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300 w-32 shrink-0 truncate">{job.scheduled_jobs?.name || 'Unknown'}</span>
                  <span className="text-xs text-rose-600 dark:text-rose-400 truncate">{job.error}</span>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
