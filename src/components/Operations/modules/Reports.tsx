/**
 * Reports — Operations Portal (/erp/operations/reports).
 *
 * Mimics the Housekeeping reports module (HKReportsModule / hk_reports):
 * a persisted report-definition registry in `ops_reports` (migration 642)
 * served via /api/ops-portal/reports — list, stats, run, run-all, PATCH.
 *
 * Beyond HK parity: each Run computes a live cross-portal metrics
 * `summary` (occupancy, WOs, requests, incidents, escalations,
 * approvals, feedback, inspections…) stored on the row — shown in the
 * View modal and embedded in PDF/Excel/CSV exports.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, ModalSystem, reportExportUtils).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Save,
  Play,
  Printer,
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { ModalSystem } from '../../Shared/ModalSystem';
import {
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  printReport,
  type ReportDocument,
  type ReportSection,
} from '../../FrontDesk/reportExportUtils';
import {
  fetchOpsReports,
  fetchOpsReportStats,
  runOpsReport,
  runAllOpsReports,
  updateOpsReport,
  type OpsReport,
  type OpsReportStats,
  type OpsReportCategory,
  type OpsReportFormat,
  type OpsReportStatus,
} from '../../../services/operationsService';

type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

const STATUS_TONE: Record<OpsReportStatus, 'success' | 'warning' | 'info' | 'danger'> = {
  Ready: 'success',
  Scheduled: 'info',
  Generating: 'warning',
  Failed: 'danger',
};

const FORMAT_TONE: Record<OpsReportFormat, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

const ALL_STATUSES: OpsReportStatus[] = ['Ready', 'Scheduled', 'Generating', 'Failed'];
const ALL_FORMATS: OpsReportFormat[] = ['PDF', 'Excel', 'CSV'];
const FREQUENCIES = ['Daily', 'Per Shift', 'Weekly', 'Monthly', 'On Demand'];

const CATEGORY_LABELS: Record<OpsReportCategory, string> = {
  operations: 'Operations Reports',
  guest: 'Guest Reports',
  approval: 'Approval Reports',
  executive: 'Executive Reports',
};

const CATEGORY_ORDER: OpsReportCategory[] = ['operations', 'guest', 'approval', 'executive'];
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
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function periodDateRange(p: Period, customFrom: string, customTo: string): { from: string; to: string } {
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
function defaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
}
function periodLabel(p: Period, from: string, to: string): string {
  const range = periodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}

const Reports: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Today');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toISODate(d);
  });
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()));

  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  const [allReports, setAllReports] = useState<OpsReport[]>([]);
  const [stats, setStats] = useState<OpsReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const [viewReport, setViewReport] = useState<OpsReport | null>(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: OpsReportFormat; status: OpsReportStatus }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [reports, s] = await Promise.all([
        fetchOpsReports(currentPropertyId || undefined),
        fetchOpsReportStats(currentPropertyId || undefined),
      ]);
      setAllReports(reports);
      setStats(s);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load operations reports', 'warning', 'Executive');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const reports = useMemo(
    () =>
      allReports
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter(
          r =>
            r.name.toLowerCase().includes(search.toLowerCase()) ||
            r.description.toLowerCase().includes(search.toLowerCase()),
        ),
    [allReports, search],
  );

  const reportsByCategory = useMemo(() => {
    const map: Record<OpsReportCategory, OpsReport[]> = { operations: [], guest: [], approval: [], executive: [] };
    for (const r of reports) {
      if (map[r.category]) map[r.category].push(r);
    }
    return map;
  }, [reports]);

  const totalReports = stats?.total ?? allReports.length;
  const ready = stats?.ready ?? allReports.filter(r => r.status === 'Ready').length;
  const scheduled = stats?.scheduled ?? allReports.filter(r => r.status === 'Scheduled').length;
  const failed = stats?.failed ?? allReports.filter(r => r.status === 'Failed').length;

  const runReport = async (r: OpsReport) => {
    setRunningId(r.id);
    setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Generating' } : x)));
    try {
      const updated = await runOpsReport(r.id, currentPropertyId || undefined);
      setAllReports(prev => prev.map(x => (x.id === r.id ? updated : x)));
      addNotification(`${r.name} refreshed with live data`, 'success', 'Executive');
    } catch (e: any) {
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
      addNotification(e?.message || `Failed to run ${r.name}`, 'warning', 'Executive');
    } finally {
      setRunningId(null);
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const result = await runAllOpsReports(currentPropertyId || undefined);
      await fetchAll();
      addNotification(`${result.refreshed || 0} report(s) refreshed with live data`, 'info', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to run all reports', 'warning', 'Executive');
    } finally {
      setRunningAll(false);
    }
  };

  // ── Download: real file (PDF / Excel / CSV) including live summary ──
  const buildReportDoc = (r: OpsReport): ReportDocument => {
    const metaRows = [
      { Field: 'Report ID', Value: r.id },
      { Field: 'Category', Value: CATEGORY_LABELS[r.category] },
      { Field: 'Description', Value: r.description },
      { Field: 'Status', Value: r.status },
      { Field: 'Format', Value: r.format },
      { Field: 'Frequency', Value: r.frequency },
      { Field: 'Last Run', Value: formatLastRun(r.last_run) },
      { Field: 'Period', Value: activeLabel },
    ];
    const sections: ReportSection[] = [
      { title: `${r.name} — ${CATEGORY_LABELS[r.category]} — ${activeLabel}`, columns: ['Field', 'Value'], rows: metaRows },
    ];
    if (Array.isArray(r.summary) && r.summary.length) {
      sections.push({
        title: 'Live Metrics (at last run)',
        columns: ['Metric', 'Value'],
        rows: r.summary.map(m => ({ Metric: m.label, Value: m.value })),
      });
    }
    return { title: `OPS ${r.name}`, generatedAt: new Date().toISOString(), sections };
  };

  const downloadReport = async (r: OpsReport, format?: OpsReportFormat) => {
    const fmt = format || r.format;
    setDownloadingId(r.id);
    try {
      const doc = buildReportDoc(r);
      const filename = `OPS-${r.id}.${fmt === 'Excel' ? 'xlsx' : fmt.toLowerCase()}`;
      if (fmt === 'PDF') exportReportToPDF(doc, filename);
      else if (fmt === 'Excel') exportReportToExcel(doc, filename);
      else exportReportToCSV(doc, filename);
      addNotification(`${r.id} · ${r.name} downloaded as ${fmt}`, 'success', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || `Failed to download ${r.name}`, 'warning', 'Executive');
    } finally {
      setDownloadingId(null);
    }
  };

  const printReportNow = (r: OpsReport) => {
    printReport(buildReportDoc(r));
  };

  // ── Schedule modal ────────────────────────────────────────────────
  const openSchedule = () => {
    const draft: Record<string, { frequency: string; format: OpsReportFormat; status: OpsReportStatus }> = {};
    for (const r of allReports) {
      draft[r.id] = { frequency: r.frequency, format: r.format, status: r.status };
    }
    setScheduleDraft(draft);
    setScheduleOpen(true);
  };

  const scheduleDirty = useMemo(
    () =>
      allReports.some(r => {
        const d = scheduleDraft[r.id];
        return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
      }),
    [allReports, scheduleDraft],
  );

  const saveSchedule = async () => {
    const changed = allReports.filter(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
    if (!changed.length) {
      setScheduleOpen(false);
      return;
    }
    setScheduleSaving(true);
    let ok = 0;
    let fail = 0;
    await Promise.all(
      changed.map(async r => {
        const d = scheduleDraft[r.id];
        try {
          await updateOpsReport(r.id, { frequency: d.frequency, format: d.format, status: d.status });
          ok++;
        } catch {
          fail++;
        }
      }),
    );
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) addNotification(`${ok} report(s) updated`, 'success', 'Executive');
    else addNotification(`${ok} updated, ${fail} failed`, 'warning', 'Executive');
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Reports"
        subtitle="Operations, guest, approval & executive reports — live data on every run."
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
            <button onClick={runAll} disabled={runningAll || loading} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
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

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={fetchAll} disabled={loading} className={[button.ghost, 'flex items-center gap-2'].join(' ')} title="Refresh">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Each run captures live metrics from all portals — open View to see the last snapshot.
        </p>
      </div>

      {/* ── Reports grouped by category (HK listing pattern) ──── */}
      {loading && reports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" />
            Loading reports…
          </div>
        </SectionCard>
      ) : reports.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports found.</div>
        </SectionCard>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const groupReports = reportsByCategory[cat];
          if (groupReports.length === 0) return null;
          return (
            <SectionCard
              key={cat}
              title={`${CATEGORY_LABELS[cat]} · ${activeLabel}`}
              icon={FileBarChart}
              tone="accent"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Description</th>
                      <th className="px-6 py-3 font-medium">Last Run</th>
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium">Frequency</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {groupReports.map(r => {
                      const isRunning = runningId === r.id;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                OPS
                              </span>
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.id}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.description}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatLastRun(r.last_run)}</td>
                          <td className="px-6 py-3"><Badge tone={FORMAT_TONE[r.format]}>{r.format}</Badge></td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.frequency}</td>
                          <td className="px-6 py-3"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            {period === 'Custom' ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                {activeRange.from} → {activeRange.to}
                              </span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <Badge tone={period === 'Today' ? 'info' : period === 'WTD' ? 'warning' : period === 'MTD' ? 'success' : 'accent'}>
                                  {period}
                                </Badge>
                                <span className="text-[10px] text-slate-400 font-mono">{activeRange.from} → {activeRange.to}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button onClick={() => runReport(r)} disabled={isRunning || downloadingId === r.id} className={button.ghost} title="Run now (captures live metrics)">
                                {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                {isRunning ? 'Running' : 'Run'}
                              </button>
                              <button onClick={() => setViewReport(r)} className={button.ghost}>
                                <Eye size={14} /> View
                              </button>
                              <button
                                onClick={() => downloadReport(r)}
                                disabled={isRunning || downloadingId === r.id}
                                className={button.ghost}
                                title={`Download as ${r.format}`}
                              >
                                {downloadingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                {downloadingId === r.id ? 'Downloading' : 'Download'}
                              </button>
                              <button
                                onClick={() => downloadReport(r, 'PDF')}
                                disabled={isRunning || downloadingId === r.id}
                                className={button.ghost}
                                title="Download as PDF"
                              >
                                <FileText size={14} /> PDF
                              </button>
                              <button
                                onClick={() => printReportNow(r)}
                                disabled={isRunning || downloadingId === r.id}
                                className={button.ghost}
                                title="Print report"
                              >
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

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-6 border border-amber-200 dark:border-amber-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
          Report Delivery
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Reports are generated on demand with a live cross-portal metrics snapshot and can be delivered to Operations leadership, duty managers, and Executive BI inboxes. Manual re-runs are available for users with report access.
        </p>
      </div>

      {/* ── View modal: report metadata + live metrics snapshot ── */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `OPS-${viewReport.id} · ${CATEGORY_LABELS[viewReport.category]}` : ''}
        variant="info"
        size="lg"
        showFooter={true}
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {viewReport && `Last run: ${formatDateTime(viewReport.last_run)}`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => viewReport && runReport(viewReport)}
                disabled={!!runningId}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {runningId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Run Now
              </button>
              <button
                onClick={() => viewReport && downloadReport(viewReport, 'PDF')}
                disabled={!!downloadingId}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                <FileText size={14} />
                PDF
              </button>
              <button
                onClick={() => viewReport && printReportNow(viewReport)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center gap-2"
              >
                <Printer size={14} />
                Print
              </button>
              <button
                onClick={() => viewReport && downloadReport(viewReport)}
                disabled={!!downloadingId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
              >
                {downloadingId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Download {viewReport?.format}
              </button>
              <button
                onClick={() => setViewReport(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        }
      >
        {viewReport && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Status</div>
                <Badge tone={STATUS_TONE[viewReport.status]}>{viewReport.status}</Badge>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Format</div>
                <Badge tone={FORMAT_TONE[viewReport.format]}>{viewReport.format}</Badge>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Frequency</div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{viewReport.frequency}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Category</div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{CATEGORY_LABELS[viewReport.category]}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Period</div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{activeLabel}</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-1">Description</div>
              <p className="text-sm text-slate-700 dark:text-slate-300">{viewReport.description}</p>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Eye size={16} /> Live Metrics (captured at last run)
              </h4>
              {Array.isArray(viewReport.summary) && viewReport.summary.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {viewReport.summary.map((m, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{m.label}</p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-white">{m.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">No metrics captured yet — run this report to snapshot live data.</p>
              )}
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Schedule modal: frequency / format / status per report ── */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onConfirm={saveSchedule}
        title="Report Schedule"
        subtitle="Edit frequency, output format and status per report"
        size="xl"
        loading={scheduleSaving}
        confirmLabel="Save Changes"
        confirmColor="indigo"
        footer={
          <>
            <button className={button.ghost} onClick={() => setScheduleOpen(false)}>Cancel</button>
            <button className={button.primary} onClick={saveSchedule} disabled={!scheduleDirty || scheduleSaving}>
              {scheduleSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes
            </button>
          </>
        }
      >
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {allReports.map(r => {
            const d = scheduleDraft[r.id];
            if (!d) return null;
            return (
              <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{r.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{CATEGORY_LABELS[r.category]}</p>
                </div>
                <select
                  value={d.frequency}
                  onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, frequency: e.target.value } }))}
                  className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={d.format}
                  onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, format: e.target.value as OpsReportFormat } }))}
                  className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  {ALL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={d.status}
                  onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, status: e.target.value as OpsReportStatus } }))}
                  className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </ModalSystem>
    </div>
  );
};

export default Reports;
