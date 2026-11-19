/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Housekeeping Reports module — docs/Housekeeping Portal new.md §23.
 * Four report categories: Operational (6), Staff (4), Inventory (5),
 * Quality (4) — 19 reports total.
 *
 * DB-integrated: mimics the F&B reports pattern (FBReports.tsx).
 * All data is served from the `hk_reports` registry table via the
 * /api/hk-portal/reports routes. Run / Run All actions persist status +
 * last_run back to the DB. View opens a detail modal with metadata.
 * Schedule opens a modal to edit frequency / format / status per report,
 * persisted via PATCH /api/hk-portal/reports/:id.
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
  Save,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import {
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  type ReportDocument,
  type ReportSection,
} from '../FrontDesk/reportExportUtils';

type ReportCategory = 'operational' | 'staff' | 'inventory' | 'quality';
type ReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
type ReportFormat = 'PDF' | 'Excel' | 'CSV';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

interface Report {
  id: string;
  category: ReportCategory;
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

const API = '/api/hk-portal/reports';

const DEPT_TAG = 'HK';
const taggedId = (id: string) => `${DEPT_TAG}-${id}`;

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  operational: 'Operational Reports',
  staff: 'Staff Reports',
  inventory: 'Inventory Reports',
  quality: 'Quality Reports',
};

const CATEGORY_ORDER: ReportCategory[] = ['operational', 'staff', 'inventory', 'quality'];

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

// ── Concrete date-range resolution ────────────────────────────────────
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
    case 'Today':
      return { from: today, to: today };
    case 'WTD':
      return { from: toISODate(startOfWeek(now)), to: today };
    case 'MTD':
      return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'YTD':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today };
    case 'Custom':
    default:
      return { from: customFrom, to: customTo };
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

export default function HKReportsModule() {
  const { addNotification } = useERP();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Today');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  const [allReports, setAllReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const [viewReport, setViewReport] = useState<Report | null>(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // ── API helpers ───────────────────────────────────────────────────
  // Session cookie is sent automatically with same-origin fetch; no
  // explicit Authorization header needed (matches FBReports pattern).
  const apiGet = async (path: string) => {
    const r = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const apiPost = async (path: string) => {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const apiPatch = async (path: string, body: any) => {
    const r = await fetch(`${API}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [reports, s] = await Promise.all([apiGet(''), apiGet('/stats')]);
      setAllReports(reports as Report[]);
      setStats(s as ReportStats);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load HK reports', 'warning', 'Housekeeping');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNotification]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Derived data ──────────────────────────────────────────────────
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
    const map: Record<ReportCategory, Report[]> = { operational: [], staff: [], inventory: [], quality: [] };
    for (const r of reports) {
      if (map[r.category]) map[r.category].push(r);
    }
    return map;
  }, [reports]);

  const totalReports = stats?.total ?? allReports.length;
  const ready = stats?.ready ?? allReports.filter(r => r.status === 'Ready').length;
  const scheduled = stats?.scheduled ?? allReports.filter(r => r.status === 'Scheduled').length;
  const failed = stats?.failed ?? allReports.filter(r => r.status === 'Failed').length;

  // ── Actions ───────────────────────────────────────────────────────
  const runReport = async (r: Report) => {
    setRunningId(r.id);
    setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Generating' } : x)));
    try {
      const updated: Report = await apiPost(`/${encodeURIComponent(r.id)}/run`);
      setAllReports(prev => prev.map(x => (x.id === r.id ? updated : x)));
      setStats(prev =>
        prev
          ? {
              ...prev,
              ready: prev.ready + (r.status !== 'Ready' ? 1 : 0),
              scheduled: Math.max(0, prev.scheduled - (r.status === 'Scheduled' ? 1 : 0)),
              failed: Math.max(0, prev.failed - (r.status === 'Failed' ? 1 : 0)),
            }
          : prev,
      );
      addNotification(`${r.name} refreshed`, 'success', 'Housekeeping');
    } catch (e: any) {
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
      addNotification(e.message || `Failed to run ${r.name}`, 'warning', 'Housekeeping');
    } finally {
      setRunningId(null);
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const result = await apiPost('/run-all');
      await fetchAll();
      addNotification(`${result.refreshed || 0} report(s) queued for refresh`, 'info', 'Housekeeping');
    } catch (e: any) {
      addNotification(e.message || 'Failed to run all reports', 'warning', 'Housekeeping');
    } finally {
      setRunningAll(false);
    }
  };

  // ── Download: generate a real file (PDF / Excel / CSV) ────────────
  const buildReportDoc = (r: Report): ReportDocument => {
    const businessDate = new Date().toISOString().split('T')[0];
    const section: ReportSection = {
      title: `${r.name} — ${CATEGORY_LABELS[r.category]} — ${activeLabel}`,
      columns: ['Field', 'Value'],
      rows: [
        { Field: 'Report ID', Value: taggedId(r.id) },
        { Field: 'Category', Value: CATEGORY_LABELS[r.category] },
        { Field: 'Description', Value: r.description },
        { Field: 'Status', Value: r.status },
        { Field: 'Format', Value: r.format },
        { Field: 'Frequency', Value: r.frequency },
        { Field: 'Last Run', Value: formatLastRun(r.last_run) },
        { Field: 'Period', Value: activeLabel },
      ],
    };
    return {
      title: `${DEPT_TAG} ${r.name}`,
      generatedAt: new Date().toISOString(),
      sections: [section],
    };
  };

  const downloadReport = async (r: Report) => {
    setDownloadingId(r.id);
    try {
      const doc = buildReportDoc(r);
      const filename = `${DEPT_TAG}-${r.id}.${r.format === 'Excel' ? 'csv' : r.format.toLowerCase()}`;
      if (r.format === 'PDF') {
        exportReportToPDF(doc, filename);
      } else if (r.format === 'Excel') {
        exportReportToExcel(doc, filename);
      } else {
        exportReportToCSV(doc, filename);
      }
      addNotification(`${taggedId(r.id)} · ${r.name} downloaded as ${r.format}`, 'success', 'Housekeeping');
      runReport(r);
    } catch (e: any) {
      addNotification(e.message || `Failed to download ${r.name}`, 'warning', 'Housekeeping');
    } finally {
      setDownloadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  // ── Schedule modal ────────────────────────────────────────────────
  const openSchedule = () => {
    const draft: Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }> = {};
    for (const r of allReports) {
      draft[r.id] = { frequency: r.frequency, format: r.format, status: r.status };
    }
    setScheduleDraft(draft);
    setScheduleOpen(true);
  };

  const scheduleDirty = useMemo(() => {
    return allReports.some(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
  }, [allReports, scheduleDraft]);

  const saveSchedule = async () => {
    const changed = allReports.filter(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
    if (changed.length === 0) {
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
          await apiPatch(`/${encodeURIComponent(r.id)}`, { frequency: d.frequency, format: d.format, status: d.status });
          ok++;
        } catch {
          fail++;
        }
      }),
    );
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) addNotification(`${ok} report(s) updated`, 'success', 'Housekeeping');
    else addNotification(`${ok} updated, ${fail} failed`, 'warning', 'Housekeeping');
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Reports"
        subtitle="Operational, staff, inventory & quality reports."
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
              <Clock size={14} /> Schedule
            </button>
            <button
              onClick={runAll}
              disabled={runningAll || loading}
              className={[button.primary, 'flex items-center gap-2'].join(' ')}
            >
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

      {/* ── Unified toolbar: refresh + search ──── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={loading}
            className={[button.ghost, 'flex items-center gap-2'].join(' ')}
            title="Refresh"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
                                {DEPT_TAG}
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
                              <button
                                onClick={() => setViewReport(r)}
                                className={button.ghost}
                              >
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
          Reports are generated automatically and can be delivered to Housekeeping leadership, Operations, and Executive BI inboxes. Manual re-runs are available for users with report access.
        </p>
      </div>

      {/* ── View Modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport.id)} · ${CATEGORY_LABELS[viewReport.category]}` : ''}
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

            {viewReport.updated_at && (
              <div className="text-xs text-slate-400">
                Last updated: {formatDateTime(viewReport.updated_at)}
              </div>
            )}

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Eye size={16} /> Report Details
              </h4>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-4">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Report ID</td>
                      <td className="py-2 text-slate-700 dark:text-slate-200 font-mono">{taggedId(viewReport.id)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Category</td>
                      <td className="py-2 text-slate-700 dark:text-slate-200">{CATEGORY_LABELS[viewReport.category]}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Status</td>
                      <td className="py-2"><Badge tone={STATUS_TONE[viewReport.status]}>{viewReport.status}</Badge></td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Format</td>
                      <td className="py-2"><Badge tone={FORMAT_TONE[viewReport.format]}>{viewReport.format}</Badge></td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Frequency</td>
                      <td className="py-2 text-slate-700 dark:text-slate-200">{viewReport.frequency}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Last Run</td>
                      <td className="py-2 text-slate-700 dark:text-slate-200">{formatDateTime(viewReport.last_run)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-500 font-medium">Period</td>
                      <td className="py-2 text-slate-700 dark:text-slate-200">{activeLabel}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Schedule Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Report Scheduling"
        subtitle="Edit frequency, format, and status for all Housekeeping reports"
        variant="form"
        size="xl"
        loading={scheduleSaving}
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {scheduleDirty ? 'Unsaved changes' : 'No changes'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setScheduleOpen(false)}
                disabled={scheduleSaving}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={saveSchedule}
                disabled={scheduleSaving || !scheduleDirty}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
              >
                {scheduleSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Frequency</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {allReports.map(r => {
                const d = scheduleDraft[r.id];
                if (!d) return null;
                const changed = d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status;
                return (
                  <tr key={r.id} className={changed ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700 dark:text-slate-200">{r.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{taggedId(r.id)}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{CATEGORY_LABELS[r.category]}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={d.frequency}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], frequency: e.target.value } }))}
                        className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.format}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], format: e.target.value as ReportFormat } }))}
                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      >
                        {ALL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.status}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], status: e.target.value as ReportStatus } }))}
                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
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
}
