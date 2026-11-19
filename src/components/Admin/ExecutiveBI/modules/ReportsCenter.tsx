/**
 * Reports Center Module — live data from /api/executive/reports-center
 *
 * Mimics the HK reports pattern (HKReportsModule): category-grouped report
 * tables with Run / Run All / Download / View / Schedule actions persisted
 * to each portal's catalog table (fin_reports, fb_reports, hk_reports,
 * eng_reports, ops_reports, rms_reports, sales_reports, sec_reports,
 * hr_reports, concierge_reports, banquet_event_reports, report_schedules).
 * Downloads generate real PDF/Excel/CSV files via reportExportUtils.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Download,
  Search,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Eye,
  FileBarChart,
  Loader2,
  RefreshCw,
  Activity,
  Printer,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import StatCard from '../../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../../FrontOffice/ui';
import { button, layout } from '../../../FrontOffice/brandTheme';
import { ModalSystem } from '../../../Shared/ModalSystem';
import {
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  printReport,
  type ReportDocument,
  type ReportSection,
} from '../../../FrontDesk/reportExportUtils';
import {
  fetchReportsCenter,
  runExecReport,
  runAllExecReports,
  updateExecReport,
  runExplorerQuery,
  type ExecReport,
  type ExecReportRunResult,
  type ReportCategory,
  type ReportsCenterResponse,
} from '../../../../services/executiveService';

type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

const DEPT_TAG = 'EXEC';
const taggedId = (r: ExecReport) => `${DEPT_TAG}-${r.source.toUpperCase().slice(0, 4)}-${r.rawId ?? r.id}`;

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  executive: 'Executive Reports',
  financial: 'Financial Reports',
  operational: 'Operational Reports',
  forecast: 'Forecast Reports',
  custom: 'Custom & Scheduled',
};
const CATEGORY_ORDER: ReportCategory[] = ['executive', 'financial', 'operational', 'forecast', 'custom'];

const STATUS_TONE: Record<string, 'success' | 'warning' | 'info' | 'danger'> = {
  ready: 'success',
  scheduled: 'info',
  generating: 'warning',
  failed: 'danger',
};
const FORMAT_TONE: Record<string, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

const ALL_STATUSES = ['ready', 'scheduled', 'generating', 'failed'] as const;
const ALL_FORMATS = ['PDF', 'Excel', 'CSV'];
const ALL_FREQS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'on_demand'];
const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

function formatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
function toISODate(d: Date): string { return d.toISOString().split('T')[0]; }
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  return monday;
}
function periodDateRange(p: Period, customFrom: string, customTo: string) {
  const now = new Date();
  const today = toISODate(now);
  switch (p) {
    case 'Today': return { from: today, to: today };
    case 'WTD': return { from: toISODate(startOfWeek(now)), to: today };
    case 'MTD': return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'YTD': return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today };
    default: return { from: customFrom, to: customTo };
  }
}
function defaultCustomRange() {
  const now = new Date();
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
}
function periodLabel(p: Period, from: string, to: string): string {
  const range = periodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}
function rangeToDays(from: string, to: string): number {
  const a = new Date(from).getTime(), b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 30;
  return Math.min(Math.max(Math.round((b - a) / 86400000) + 1, 1), 365);
}

export default function ReportsCenter() {
  const { addNotification, currentPropertyId } = useERP();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('MTD');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return toISODate(d);
  });
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()));

  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeDays = useMemo(() => rangeToDays(activeRange.from, activeRange.to), [activeRange]);

  const [data, setData] = useState<ReportsCenterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [viewReport, setViewReport] = useState<ExecReport | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: string; status: string; recipients: string; sendDay: string }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchReportsCenter(currentPropertyId));
    } catch (e: any) {
      addNotification(e.message || 'Failed to load reports', 'warning', 'Executive');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNotification, currentPropertyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const allReports = data?.reports ?? [];
  const canRun = (r: ExecReport) => !!r.sourceKey && !!r.rawId;

  const reports = useMemo(
    () => allReports.filter(r =>
      `${r.name} ${r.description} ${r.source}`.toLowerCase().includes(search.toLowerCase())),
    [allReports, search],
  );

  const reportsByCategory = useMemo(() => {
    const map: Record<ReportCategory, ExecReport[]> = { executive: [], financial: [], operational: [], forecast: [], custom: [] };
    for (const r of reports) if (map[r.category]) map[r.category].push(r);
    return map;
  }, [reports]);

  const patchLocal = (id: string, patch: Partial<ExecReport>) =>
    setData(prev => prev ? { ...prev, reports: prev.reports.map(x => x.id === id ? { ...x, ...patch } : x) } : prev);

  // ── Actions ───────────────────────────────────────────────────────
  const runReport = async (r: ExecReport) => {
    if (!canRun(r)) return;
    setRunningId(r.id);
    patchLocal(r.id, { status: 'generating' });
    try {
      const res = await runExecReport(r.sourceKey!, r.rawId!, { days: activeDays, propertyId: currentPropertyId });
      patchLocal(r.id, { status: (res.status as ExecReport['status']) || 'ready', lastRun: res.lastRun });
      addNotification(
        `${r.name} refreshed${res.query ? ` — ${res.query.rowCount} live rows in ${res.query.tookMs}ms` : ''}`,
        'success', 'Executive');
    } catch (e: any) {
      patchLocal(r.id, { status: r.status });
      addNotification(e.message || `Failed to run ${r.name}`, 'warning', 'Executive');
    } finally {
      setRunningId(null);
    }
  };

  /** Execute the report's mapped live query — via run when runnable, directly otherwise. */
  const fetchReportData = async (r: ExecReport): Promise<ExecReportRunResult['query']> => {
    // reportschedules "run" dispatches email — never trigger it from
    // download/view flows; execute the mapped live query directly instead.
    if (canRun(r) && r.sourceKey !== 'reportschedules') {
      const res = await runExecReport(r.sourceKey!, r.rawId!, { days: activeDays, propertyId: currentPropertyId });
      patchLocal(r.id, { status: 'ready', lastRun: res.lastRun });
      return res.query;
    }
    if (r.queryId) {
      const res = await runExplorerQuery(r.queryId, currentPropertyId, activeDays);
      return { id: res.id, columns: res.columns, rows: res.rows, rowCount: res.rowCount, tookMs: res.tookMs, comparison: res.comparison };
    }
    return null;
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const result = await runAllExecReports();
      await fetchAll();
      addNotification(`${result.refreshed} report(s) queued for refresh`, 'info', 'Executive');
    } catch (e: any) {
      addNotification(e.message || 'Failed to run all reports', 'warning', 'Executive');
    } finally {
      setRunningAll(false);
    }
  };

  /** Merge previous-period rows into the current result: adds Prev <measure> and Δ% columns. */
  const mergeComparison = (q: NonNullable<ExecReportRunResult['query']>) => {
    const prev = q.comparison?.previousRows;
    if (!prev || !prev.length) return { columns: q.columns, rows: q.rows };
    const keyCol = q.columns[0];
    const measureCol = q.columns.slice(1).find(c => q.rows.some(rw => typeof rw[c] === 'number'));
    if (!measureCol) return { columns: q.columns, rows: q.rows };
    const prevByKey = new Map(prev.map(p => [String(p[keyCol]), p]));
    const columns = [...q.columns, `Prev ${measureCol}`, 'Δ %'];
    const rows = q.rows.map(rw => {
      const p = prevByKey.get(String(rw[keyCol]));
      const cur = Number(rw[measureCol]) || 0;
      const pv = p ? Number(p[measureCol]) : null;
      return {
        ...rw,
        [`Prev ${measureCol}`]: pv === null || Number.isNaN(pv) ? '—' : pv,
        'Δ %': pv ? `${cur >= pv ? '+' : ''}${Math.round((cur - pv) / pv * 100)}%` : '—',
      };
    });
    return { columns, rows };
  };

  const buildReportDoc = (r: ExecReport, query: ExecReportRunResult['query']): ReportDocument => {
    const sections: ReportSection[] = [];
    if (query && query.rows.length > 0) {
      const merged = mergeComparison(query);
      sections.push({
        title: `${r.name} — ${activeLabel} (${query.rowCount} rows, live${query.comparison?.previousRows ? ', vs prev period' : ''})`,
        columns: merged.columns,
        rows: merged.rows,
      });
    }
    if (query?.comparison?.benchmarks?.length) {
      sections.push({
        title: 'Benchmarks — configured KPI targets',
        columns: ['Metric', 'Module', 'Department', 'Target', 'Unit', 'Direction'],
        rows: query.comparison.benchmarks.map(b => ({
          Metric: b.metric, Module: b.module, Department: b.department,
          Target: b.target ?? '—', Unit: b.unit, Direction: b.direction,
        })),
      });
    }
    sections.push({
      title: 'Report Info',
      columns: ['Field', 'Value'],
      rows: [
        { Field: 'Report ID', Value: taggedId(r) },
        { Field: 'Portal', Value: r.source },
        { Field: 'Category', Value: CATEGORY_LABELS[r.category] },
        { Field: 'Description', Value: r.description },
        { Field: 'Status', Value: r.status },
        { Field: 'Format', Value: r.format },
        { Field: 'Frequency', Value: r.frequency },
        { Field: 'Last Run', Value: formatLastRun(r.lastRun) },
        { Field: 'Period', Value: activeLabel },
        ...(query ? [{ Field: 'Live Query', Value: `${query.id} · ${query.rowCount} rows · ${query.tookMs}ms` }] : []),
      ],
    });
    return { title: `${DEPT_TAG} ${r.name}`, generatedAt: new Date().toISOString(), sections };
  };

  const downloadReport = async (r: ExecReport, format?: string) => {
    const fmt = format || r.format;
    setDownloadingId(r.id);
    try {
      const query = await fetchReportData(r);
      const doc = buildReportDoc(r, query);
      const filename = `${taggedId(r)}.${fmt === 'Excel' ? 'csv' : fmt.toLowerCase()}`;
      if (fmt === 'PDF') exportReportToPDF(doc, filename);
      else if (fmt === 'Excel') exportReportToExcel(doc, filename);
      else exportReportToCSV(doc, filename);
      addNotification(
        `${r.name} downloaded as ${fmt}${query ? ` — ${query.rowCount} live rows` : ' (metadata only — no live query mapped)'}`,
        'success', 'Executive');
    } catch (e: any) {
      addNotification(e.message || `Failed to download ${r.name}`, 'warning', 'Executive');
    } finally {
      setDownloadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  const printReportNow = async (r: ExecReport) => {
    setDownloadingId(r.id);
    try {
      const query = await fetchReportData(r);
      printReport(buildReportDoc(r, query));
    } catch (e: any) {
      addNotification(e.message || `Failed to print ${r.name}`, 'warning', 'Executive');
    } finally {
      setDownloadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  // ── Schedule modal ────────────────────────────────────────────────
  const openSchedule = () => {
    const draft: Record<string, { frequency: string; format: string; status: string; recipients: string; sendDay: string }> = {};
    for (const r of allReports.filter(canRun)) {
      draft[r.id] = {
        frequency: r.frequency, format: r.format, status: r.status,
        recipients: (r.recipients || []).join(', '),
        sendDay: r.sendDay || '',
      };
    }
    setScheduleDraft(draft);
    setScheduleOpen(true);
  };

  const isSchedRow = (r: ExecReport) => r.sourceKey === 'reportschedules';
  const draftChanged = (r: ExecReport) => {
    const d = scheduleDraft[r.id];
    if (!d) return false;
    if (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status) return true;
    if (isSchedRow(r)) {
      if (d.recipients !== (r.recipients || []).join(', ')) return true;
      if (d.sendDay !== (r.sendDay || '')) return true;
    }
    return false;
  };

  const scheduleDirty = useMemo(() =>
    allReports.some(r => canRun(r) && draftChanged(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allReports, scheduleDraft]);

  const saveSchedule = async () => {
    const changed = allReports.filter(r => canRun(r) && draftChanged(r));
    if (changed.length === 0) { setScheduleOpen(false); return; }
    setScheduleSaving(true);
    let ok = 0, fail = 0;
    await Promise.all(changed.map(async r => {
      const d = scheduleDraft[r.id];
      try {
        await updateExecReport(r.sourceKey!, r.rawId!, {
          frequency: d.frequency,
          format: d.format,
          status: d.status.charAt(0).toUpperCase() + d.status.slice(1),
          ...(isSchedRow(r) ? {
            recipients: d.recipients.split(',').map(s => s.trim()).filter(Boolean),
            sendDay: d.sendDay || null,
          } : {}),
        });
        ok++;
      } catch { fail++; }
    }));
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) addNotification(`${ok} report(s) updated`, 'success', 'Executive');
    else addNotification(`${ok} updated, ${fail} failed`, 'warning', 'Executive');
  };

  const totalReports = data?.summary.total ?? allReports.length;
  const ready = data?.summary.ready ?? 0;
  const scheduled = data?.summary.scheduled ?? 0;
  const failed = data?.summary.failed ?? 0;

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Reports Center"
        subtitle="Executive, financial, operational & forecast reports from every portal."
        icon={FileText}
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      if (p === 'Custom') {
                        const range = defaultCustomRange();
                        setCustomFrom(range.from);
                        setCustomTo(range.to);
                      }
                      setPeriod(p);
                    }}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      period === p
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {period === 'Custom' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                  <span className="text-slate-400">→</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                </div>
              )}
            </div>
            <button className={button.secondary} onClick={openSchedule}>
              <Clock size={14} /> Schedule
            </button>
            <button onClick={runAll} disabled={runningAll || loading}
              className={[button.primary, 'flex items-center gap-2'].join(' ')}>
              {runningAll ? <Loader2 size={14} className="animate-spin" /> : <FileBarChart size={14} />}
              Run All
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={totalReports} icon={FileText} tone="accent" caption={activeLabel} />
        <StatCard title="Ready" value={ready} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={scheduled} icon={Clock} tone="info" />
        <StatCard title="Failed" value={failed} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={fetchAll} disabled={loading}
            className={[button.ghost, 'flex items-center gap-2'].join(' ')} title="Refresh">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
          </div>
        </div>
        {data && data.summary.bySource.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.summary.bySource.map(s => `${s.source} ${s.count}`).join(' · ')}
          </p>
        )}
      </div>

      {/* Reports grouped by category — HK-style tables */}
      {loading && reports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" /> Loading reports…
          </div>
        </SectionCard>
      ) : reports.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports found.</div>
        </SectionCard>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const group = reportsByCategory[cat];
          if (group.length === 0) return null;
          return (
            <SectionCard key={cat} title={`${CATEGORY_LABELS[cat]} · ${activeLabel}`} icon={FileBarChart} tone="accent">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Source</th>
                      <th className="px-6 py-3 font-medium">Last Run</th>
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium">Frequency</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {group.map(r => {
                      const isRunning = runningId === r.id;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {DEPT_TAG}
                              </span>
                              <span className="text-xs font-mono text-slate-600 dark:text-slate-400 max-w-[120px] truncate" title={r.rawId}>{r.rawId ?? r.id}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <p className="font-medium text-gray-900 dark:text-white">{r.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate" title={r.description}>{r.description}</p>
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <Badge tone="accent">{r.source}</Badge>
                              {r.queryId && <Badge tone="success">live</Badge>}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatLastRun(r.lastRun)}</td>
                          <td className="px-6 py-3"><Badge tone={FORMAT_TONE[r.format] || 'info'}>{r.format}</Badge></td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 capitalize">{r.frequency.replace(/_/g, ' ')}</td>
                          <td className="px-6 py-3"><Badge tone={STATUS_TONE[r.status] || 'info'}>{r.status}</Badge></td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button onClick={() => setViewReport(r)} className={button.ghost}>
                                <Eye size={14} /> View
                              </button>
                              {canRun(r) && (
                                <button onClick={() => runReport(r)} disabled={isRunning}
                                  className={button.ghost} title="Re-run report">
                                  {isRunning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                  {isRunning ? 'Running' : 'Run'}
                                </button>
                              )}
                              <button onClick={() => downloadReport(r)} disabled={isRunning || downloadingId === r.id}
                                className={button.ghost} title={`Download as ${r.format}`}>
                                {downloadingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                {downloadingId === r.id ? 'Downloading' : 'Download'}
                              </button>
                              <button onClick={() => downloadReport(r, 'PDF')} disabled={isRunning || downloadingId === r.id}
                                className={button.ghost} title="Download as PDF">
                                <FileText size={14} /> PDF
                              </button>
                              <button onClick={() => printReportNow(r)} disabled={isRunning || downloadingId === r.id}
                                className={button.ghost} title="Print report">
                                <Printer size={14} /> Print
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          );
        })
      )}

      {/* Recent runs + schedules */}
      {data && (data.panels.recentRuns.length > 0 || data.panels.scheduledReports.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Recent Runs" icon={Activity} tone="accent">
            <div className="px-6 py-4 space-y-3">
              {data.panels.recentRuns.slice(0, 8).map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {r.source}{r.by ? ` · ${r.by}` : ''} · {formatDateTime(r.at)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[r.status?.toLowerCase()] || 'info'}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Scheduled Deliveries" icon={Clock} tone="accent">
            <div className="px-6 py-4 space-y-3">
              {data.panels.scheduledReports.length === 0 ? (
                <p className="text-sm text-slate-500">No scheduled deliveries configured.</p>
              ) : data.panels.scheduledReports.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {s.frequency} · {s.format} · {s.recipients} recipient{s.recipients === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">{s.lastSent ? formatDateTime(s.lastSent) : 'never sent'}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* View modal */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport)} · ${CATEGORY_LABELS[viewReport.category]} · ${viewReport.source}` : ''}
        variant="info"
        size="lg"
        showFooter={true}
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {viewReport && `Last run: ${formatDateTime(viewReport.lastRun)}`}
            </div>
            <div className="flex gap-2">
              {viewReport && canRun(viewReport) && (
                <button onClick={() => runReport(viewReport)} disabled={!!runningId}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2">
                  {runningId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Run Now
                </button>
              )}
              {viewReport && (
                <button onClick={() => printReportNow(viewReport)} disabled={!!downloadingId}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2">
                  <Printer size={14} /> Print
                </button>
              )}
              <button onClick={() => viewReport && downloadReport(viewReport)} disabled={!!downloadingId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2">
                {downloadingId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Download {viewReport?.format}
              </button>
            </div>
          </div>
        }
      >
        {viewReport && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600 dark:text-slate-400">{viewReport.description}</p>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-slate-500 uppercase">Portal</p><p className="font-medium text-gray-900 dark:text-white">{viewReport.source}</p></div>
              <div><p className="text-xs text-slate-500 uppercase">Category</p><p className="font-medium text-gray-900 dark:text-white">{CATEGORY_LABELS[viewReport.category]}</p></div>
              <div><p className="text-xs text-slate-500 uppercase">Status</p><Badge tone={STATUS_TONE[viewReport.status]}>{viewReport.status}</Badge></div>
              <div><p className="text-xs text-slate-500 uppercase">Format</p><Badge tone={FORMAT_TONE[viewReport.format]}>{viewReport.format}</Badge></div>
              <div><p className="text-xs text-slate-500 uppercase">Frequency</p><p className="font-medium text-gray-900 dark:text-white capitalize">{viewReport.frequency.replace(/_/g, ' ')}</p></div>
              <div><p className="text-xs text-slate-500 uppercase">Period</p><p className="font-medium text-gray-900 dark:text-white">{activeLabel}</p></div>
              <div><p className="text-xs text-slate-500 uppercase">Live Data</p>
                {viewReport.queryId
                  ? <Badge tone="success">live query · {viewReport.queryId}</Badge>
                  : <p className="font-medium text-gray-900 dark:text-white">metadata only</p>}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Schedule modal — edits frequency / format / status per report */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Report Schedule"
        subtitle="Edit frequency, format and status per report — saved to each portal catalog"
        variant="form"
        size="xl"
        showFooter={true}
        cancelLabel="Cancel"
        confirmLabel={scheduleSaving ? 'Saving…' : 'Save Changes'}
        onConfirm={scheduleDirty ? saveSchedule : undefined}
        loading={scheduleSaving}
      >
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-slate-800 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 font-medium">Report</th>
                <th className="py-2 font-medium">Portal</th>
                <th className="py-2 font-medium">Frequency</th>
                <th className="py-2 font-medium">Format</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Recipients / Send Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {allReports.filter(canRun).map(r => {
                const d = scheduleDraft[r.id];
                if (!d) return null;
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white max-w-[200px] truncate" title={r.name}>{r.name}</td>
                    <td className="py-2 pr-3"><Badge tone="accent">{r.source}</Badge></td>
                    <td className="py-2 pr-3">
                      <select value={d.frequency}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, frequency: e.target.value } }))}
                        className="px-2 py-1 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white capitalize">
                        {(isSchedRow(r) ? ['daily', 'weekly', 'monthly', 'quarterly'] : ALL_FREQS).map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select value={d.format}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, format: e.target.value } }))}
                        className="px-2 py-1 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                        {(isSchedRow(r) ? [...ALL_FORMATS.slice(0, 2), 'Both'] : ALL_FORMATS).map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select value={d.status}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, status: e.target.value } }))}
                        className="px-2 py-1 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white capitalize">
                        {(isSchedRow(r) ? ['scheduled', 'ready'] : ALL_STATUSES).map(s => <option key={s} value={s}>{isSchedRow(r) && s === 'ready' ? 'paused' : s}</option>)}
                      </select>
                    </td>
                    <td className="py-2">
                      {isSchedRow(r) ? (
                        <div className="space-y-1">
                          <input type="text" value={d.recipients} placeholder="email@x.com, email@y.com"
                            onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, recipients: e.target.value } }))}
                            className="w-52 px-2 py-1 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                          <input type="text" value={d.sendDay} placeholder="send day (e.g. Monday / 1)"
                            onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, sendDay: e.target.value } }))}
                            className="w-52 px-2 py-1 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ModalSystem>
    </div>
  );
}
