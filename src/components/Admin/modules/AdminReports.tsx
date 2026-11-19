/**
 * Admin Reports — /erp/admin/reports
 * Mirrors the F&B Reports module (FBReports.tsx): a DB-backed report registry
 * (`admin_reports` table) where each report is bound to a live admin dataset.
 * Run executes the real dataset query via POST /api/admin/reports/:id/run,
 * View opens a modal with a live row preview, Download exports the result as
 * PDF / Excel / CSV via reportExportUtils, and Schedule persists per-report
 * frequency / format / status via PATCH.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Download, Search, Clock, CheckCircle2, AlertTriangle, Eye,
  FileBarChart, Loader2, RefreshCw, Play, Database,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { ModalSystem } from '../../Shared/ModalSystem';
import { adminAuthHeaders } from '../shared/ResourceManager';
import {
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  type ReportDocument,
  type ReportSection,
} from '../../FrontDesk/reportExportUtils';

type ReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
type ReportFormat = 'PDF' | 'Excel' | 'CSV';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

interface DateRange { from: string; to: string }

function computeRange(period: Period, customFrom: string, customTo: string): DateRange | null {
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  switch (period) {
    case 'Today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'WTD': {
      const d = new Date(now);
      const day = d.getDay(); // 0=Sun
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      d.setHours(0, 0, 0, 0);
      from = d;
      break;
    }
    case 'MTD':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'YTD':
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case 'Custom': {
      if (!customFrom || !customTo) return null;
      return {
        from: new Date(`${customFrom}T00:00:00`).toISOString(),
        to: new Date(`${customTo}T23:59:59.999`).toISOString(),
      };
    }
  }
  return { from: from.toISOString(), to };
}

interface AdminReport {
  id: string;
  dataset: string;
  datasetLabel?: string;
  datasetAvailable?: boolean;
  dateColumn?: string | null;
  category: string;
  name: string;
  description: string;
  last_run: string | null;
  status: ReportStatus;
  format: ReportFormat;
  frequency: string;
  updated_at?: string;
}

interface ReportStats {
  total: number;
  ready: number;
  scheduled: number;
  failed: number;
  generating: number;
  byCategory: Record<string, number>;
}

const STATUS_TONE: Record<ReportStatus, 'success' | 'warning' | 'info' | 'danger'> = {
  Ready: 'success',
  Scheduled: 'info',
  Generating: 'warning',
  Failed: 'danger',
};

const FORMAT_TONE: Record<ReportFormat, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

const ALL_STATUSES: ReportStatus[] = ['Ready', 'Scheduled', 'Generating', 'Failed'];
const ALL_FORMATS: ReportFormat[] = ['PDF', 'Excel', 'CSV'];
const CATEGORY_ORDER = ['Administration', 'Master data', 'Operations', 'Finance', 'Compliance'];

const API = '/api/admin/reports';
const DEPT_TAG = 'ADMIN';
const taggedId = (id: string) => `${DEPT_TAG}-${id}`;

const cell = (v: any) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function formatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const AdminReports: React.FC = () => {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('MTD');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // View modal state
  const [viewReport, setViewReport] = useState<AdminReport | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Schedule modal state
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${API}${path}`, { headers: adminAuthHeaders(), ...opts });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, s] = await Promise.all([
        api(''),
        api('/stats').catch(() => null),
      ]);
      setReports(Array.isArray(list) ? list : []);
      setStats(s);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const activeRange = useMemo(() => computeRange(period, customFrom, customTo), [period, customFrom, customTo]);

  // ── Run a single report: executes the live dataset query ──────────
  const runReport = useCallback(async (r: AdminReport, limit = 5000): Promise<{ rows: any[]; report: AdminReport } | null> => {
    setRunningId(r.id);
    try {
      const range = r.dateColumn ? activeRange : null;
      const qs = new URLSearchParams({ limit: String(limit) });
      if (range) { qs.set('from', range.from); qs.set('to', range.to); }
      const res = await api(`/${encodeURIComponent(r.id)}/run?${qs.toString()}`, { method: 'POST' });
      setReports(prev => prev.map(x => (x.id === r.id ? { ...x, ...(res.report || {}), status: 'Ready', last_run: res.report?.last_run || new Date().toISOString() } : x)));
      return { rows: res.rows || [], report: res.report || r };
    } catch (e: any) {
      setError(e.message);
      setReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Failed' } : x)));
      return null;
    } finally {
      setRunningId(null);
    }
  }, [api, activeRange]);

  const runAll = async () => {
    setRunningAll(true);
    try {
      const res = await api('/run-all', { method: 'POST' });
      if (res.reports) setReports(res.reports);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunningAll(false);
    }
  };

  // ── View modal: run the dataset live for preview ──────────────────
  const openView = useCallback(async (r: AdminReport) => {
    setViewReport(r);
    setPreviewRows(null);
    setPreviewError(null);
    setPreviewLoading(true);
    const res = await runReport(r, 500);
    setPreviewLoading(false);
    if (res) setPreviewRows(res.rows);
    else setPreviewError('Failed to load preview data.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runReport]);

  // ── Download: run then export via shared report utils ─────────────
  const downloadReport = async (r: AdminReport) => {
    setDownloadingId(r.id);
    try {
      const res = await runReport(r, 5000);
      if (!res) return;
      const { rows } = res;
      const cols = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).slice(0, 12);
      const section: ReportSection = {
        title: `${r.name} — ${r.datasetLabel || r.dataset}`,
        columns: cols,
        rows,
      };
      const doc: ReportDocument = {
        title: `${DEPT_TAG} ${r.name}`,
        generatedAt: new Date().toLocaleString(),
        sections: [section],
      };
      const filename = `${taggedId(r.id)}-${r.dataset}-${new Date().toISOString().slice(0, 10)}`;
      if (r.format === 'PDF') exportReportToPDF(doc, filename);
      else if (r.format === 'Excel') exportReportToExcel(doc, filename);
      else exportReportToCSV(doc, filename);
    } finally {
      setDownloadingId(null);
    }
  };

  // ── Schedule modal ────────────────────────────────────────────────
  const openSchedule = () => {
    const draft: Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }> = {};
    for (const r of reports) draft[r.id] = { frequency: r.frequency, format: r.format, status: r.status };
    setScheduleDraft(draft);
    setScheduleOpen(true);
  };

  const scheduleDirty = useMemo(() => reports.some(r => {
    const d = scheduleDraft[r.id];
    return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
  }), [reports, scheduleDraft]);

  const saveSchedule = async () => {
    const changed = reports.filter(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
    if (changed.length === 0) { setScheduleOpen(false); return; }
    setScheduleSaving(true);
    let ok = 0, fail = 0;
    await Promise.all(changed.map(async r => {
      const d = scheduleDraft[r.id];
      try {
        await api(`/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ frequency: d.frequency, format: d.format, status: d.status }) });
        ok++;
      } catch { fail++; }
    }));
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) setError(null);
    else setError(`${ok} report(s) updated, ${fail} failed`);
  };

  // ── Derived data ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.datasetLabel || r.dataset).toLowerCase().includes(q)
    );
  }, [reports, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, AdminReport[]>();
    for (const r of filtered) {
      const arr = map.get(r.category) || [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return CATEGORY_ORDER.map(c => [c, map.get(c) || []] as [string, AdminReport[]])
      .concat(Array.from(map.entries()).filter(([c]) => !CATEGORY_ORDER.includes(c)));
  }, [filtered]);

  const previewCols = useMemo(() => {
    if (!previewRows?.length) return [] as string[];
    return Array.from(new Set(previewRows.flatMap(r => Object.keys(r)))).slice(0, 10);
  }, [previewRows]);

  const totalReports = stats?.total ?? reports.length;
  const ready = stats?.ready ?? reports.filter(r => r.status === 'Ready').length;
  const scheduled = stats?.scheduled ?? reports.filter(r => r.status === 'Scheduled').length;
  const failed = stats?.failed ?? reports.filter(r => r.status === 'Failed').length;

  return (
    <div className={['accent-admin', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Admin Reports"
        subtitle="Live administration reports — run, preview, and export dataset extracts"
        icon={FileText}
        actions={
          <>
            {/* Period toggle + custom dates */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      if (p === 'Custom' && !customFrom && !customTo) {
                        const now = new Date();
                        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                        setCustomFrom(monthStart.toISOString().slice(0, 10));
                        setCustomTo(now.toISOString().slice(0, 10));
                      }
                      setPeriod(p);
                    }}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      period === p
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {period === 'Custom' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                </div>
              )}
            </div>
            <button className={button.secondary} onClick={openSchedule}>
              <Clock className="w-4 h-4" /> Schedule
            </button>
            <button
              onClick={runAll}
              disabled={runningAll || loading}
              className={[button.primary, 'flex items-center gap-2'].join(' ')}
            >
              {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
              Run All
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={totalReports} icon={FileText} tone="accent" />
        <StatCard title="Ready" value={ready} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={scheduled} icon={Clock} tone="info" />
        <StatCard title="Failed" value={failed} icon={AlertTriangle} tone="danger" />
      </div>

      {/* ── Toolbar: refresh + search ──── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={fetchAll} disabled={loading} className={[button.ghost, 'flex items-center gap-2'].join(' ')} title="Refresh">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reports..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* ── Reports grouped by category ──── */}
      {loading && reports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading reports…
          </div>
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">{search ? 'No reports match your search.' : 'No reports found.'}</div>
        </SectionCard>
      ) : (
        grouped.map(([category, groupReports]) => {
          if (groupReports.length === 0) return null;
          return (
            <SectionCard key={category} title={`${category} · ${groupReports.length} report(s)`} icon={FileBarChart} tone="accent" pad="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Dataset</th>
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
                                {DEPT_TAG}
                              </span>
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.id}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{r.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{r.description}</div>
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                              <Database className="w-3.5 h-3.5" /> {r.datasetLabel || r.dataset}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatLastRun(r.last_run)}</td>
                          <td className="px-6 py-3"><Badge tone={FORMAT_TONE[r.format] || 'neutral'}>{r.format}</Badge></td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.frequency}</td>
                          <td className="px-6 py-3"><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            {r.dateColumn && activeRange ? (
                              <div className="flex flex-col gap-0.5">
                                <Badge tone={period === 'Today' ? 'info' : period === 'WTD' ? 'warning' : period === 'MTD' ? 'success' : period === 'YTD' ? 'accent' : 'neutral'}>
                                  {period}
                                </Badge>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {activeRange.from.slice(0, 10)} → {activeRange.to.slice(0, 10)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">All records</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button onClick={() => openView(r)} disabled={isRunning} className={button.ghost}>
                                <Eye className="w-4 h-4" /> View
                              </button>
                              <button onClick={() => runReport(r)} disabled={isRunning} className={button.ghost} title="Run report">
                                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run
                              </button>
                              <button
                                onClick={() => downloadReport(r)}
                                disabled={isRunning || downloadingId === r.id}
                                className={button.ghost}
                                title={`Download as ${r.format}`}
                              >
                                {downloadingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                {downloadingId === r.id ? 'Exporting' : 'Download'}
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

      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl p-6 border border-indigo-200 dark:border-indigo-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          Report Delivery
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Reports query live administration datasets on demand. Each run is recorded in the audit trail, and scheduled frequencies can be configured per report via the Schedule panel.
        </p>
      </div>

      {/* ── View Modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport.id)} · ${viewReport.datasetLabel || viewReport.dataset}` : ''}
        variant="info"
        size="xl"
        showFooter={true}
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-500">
              {previewRows ? `${previewRows.length} row(s) returned (preview limit 500)` : ''}
            </span>
            <div className="flex gap-2">
              <button onClick={() => viewReport && downloadReport(viewReport)} disabled={!previewRows?.length} className={button.secondary}>
                <Download className="w-4 h-4" /> {viewReport?.format || 'CSV'}
              </button>
            </div>
          </div>
        }
      >
        <div className="p-6">
          {previewLoading ? (
            <div className="text-sm text-slate-500 py-6 text-center">
              <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" /> Running report…
            </div>
          ) : previewError ? (
            <div className="text-sm text-red-600 py-6 text-center flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {previewError}
            </div>
          ) : !previewRows || previewRows.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
              No data returned for this dataset.
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[28rem] rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                  <tr>
                    {previewCols.map(c => <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {previewRows.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      {previewCols.map(c => (
                        <td key={c} className="px-3 py-2 text-slate-700 dark:text-slate-200 max-w-[220px] truncate" title={cell(row[c])}>
                          {cell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewRows.length > 200 && (
                <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-700">
                  Showing first 200 of {previewRows.length} rows — download for the full extract.
                </div>
              )}
            </div>
          )}
        </div>
      </ModalSystem>

      {/* ── Schedule Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Report Schedule"
        subtitle="Configure generation frequency, output format, and status per report"
        variant="form"
        size="xl"
        showFooter={true}
        cancelLabel="Cancel"
        confirmLabel={scheduleSaving ? 'Saving…' : scheduleDirty ? 'Save Changes' : 'No Changes'}
        loading={scheduleSaving}
        onConfirm={scheduleDirty ? saveSchedule : undefined}
      >
        <div className="p-6 overflow-x-auto max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <th className="px-4 py-2 font-medium">Report</th>
                <th className="px-4 py-2 font-medium">Frequency</th>
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {reports.map(r => {
                const d = scheduleDraft[r.id] || { frequency: r.frequency, format: r.format, status: r.status };
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900 dark:text-white">{r.name}</div>
                      <div className="text-xs text-slate-500">{taggedId(r.id)} · {r.category}</div>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={d.frequency}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, frequency: e.target.value } }))}
                        className="w-32 px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        placeholder="e.g. Daily 06:00"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={d.format}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, format: e.target.value as ReportFormat } }))}
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      >
                        {ALL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={d.status}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...d, status: e.target.value as ReportStatus } }))}
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                      >
                        {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
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
};

export default AdminReports;
