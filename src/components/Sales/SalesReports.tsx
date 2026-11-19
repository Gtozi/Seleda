import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Download, Search, Clock, CheckCircle2, AlertTriangle,
  Eye, FileBarChart, Loader2, RefreshCw, Save,
  DollarSign, Users, Percent, BarChart3,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import {
  fetchSalesReports, fetchSalesReportStats, runSalesReport, runAllSalesReports,
  previewSalesReport, updateSalesReport, type SalesReport, type SalesReportStats,
} from '../../services/salesService';
import {
  exportReportToPDF, exportReportToExcel, exportReportToCSV,
  type ReportDocument, type ReportSection,
} from '../FrontDesk/reportExportUtils';

type ReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
type ReportFormat = 'PDF' | 'Excel' | 'CSV';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

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
const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];
const DEPT_TAG = 'SLS';
const taggedId = (id: string) => `${DEPT_TAG}-${id}`;

const CATEGORY_ORDER = ['Sales Reports', 'Marketing Reports', 'CRM Reports', 'Financial Reports', 'Operational Reports'];

const CATEGORY_LABELS: Record<string, string> = {
  'Sales Reports': 'Sales & Pipeline',
  'Marketing Reports': 'Marketing & Campaigns',
  'CRM Reports': 'CRM & Loyalty',
  'Financial Reports': 'Financial & Accounts',
  'Operational Reports': 'Operational & Booking',
};

const CATEGORY_ICONS: Record<string, any> = {
  'Sales Reports': DollarSign,
  'Marketing Reports': BarChart3,
  'CRM Reports': Users,
  'Financial Reports': DollarSign,
  'Operational Reports': Percent,
};

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

function buildGenericReportDoc(report: SalesReport, data: any[]): ReportDocument {
  const businessDate = new Date().toISOString().split('T')[0];
  const cols = data.length > 0 ? Object.keys(data[0]) : ['Field', 'Value'];
  const section: ReportSection = data.length > 0
    ? { title: `${report.name} — Preview`, columns: cols, rows: data.map(r => cols.map(c => String(r[c] ?? '—'))) }
    : { title: 'No preview data', columns: ['Field', 'Value'], rows: [['Status', 'No data available for the selected period']] };
  return {
    reportName: `${DEPT_TAG} ${report.name}`,
    businessDate,
    propertyName: 'SELEDA Hotel ERP — Sales',
    sections: [section],
  };
}

function fmt(n: any): string {
  if (n === null || n === undefined) return '—';
  if (typeof n === 'number') return n.toLocaleString();
  return String(n);
}

const SalesReports: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Today');
  const [customFrom, setCustomFrom] = useState(() => defaultCustomRange().from);
  const [customTo, setCustomTo] = useState(() => defaultCustomRange().to);

  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  const [allReports, setAllReports] = useState<SalesReport[]>([]);
  const [stats, setStats] = useState<SalesReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const [viewReport, setViewReport] = useState<SalesReport | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [reports, s] = await Promise.all([fetchSalesReports(), fetchSalesReportStats()]);
      setAllReports(reports);
      setStats(s);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load reports', 'warning', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openView = useCallback(async (r: SalesReport) => {
    setViewReport(r);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const data = await previewSalesReport(r.id);
      setPreviewData(data || []);
    } catch {
      setPreviewData([]);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const runReport = async (r: SalesReport) => {
    setRunningId(r.id);
    setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Generating' } : x)));
    try {
      const updated = await runSalesReport(r.id);
      setAllReports(prev => prev.map(x => (x.id === r.id ? updated as unknown as SalesReport : x)));
      addNotification(`${r.name} refreshed`, 'success', 'Sales');
    } catch (e: any) {
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
      addNotification(e.message || `Failed to run ${r.name}`, 'warning', 'Sales');
    } finally {
      setRunningId(null);
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const result = await runAllSalesReports();
      await fetchAll();
      addNotification(`${result.refreshed || 0} report(s) queued for refresh`, 'info', 'Sales');
    } catch (e: any) {
      addNotification(e.message || 'Failed to run all reports', 'warning', 'Sales');
    } finally {
      setRunningAll(false);
    }
  };

  const downloadReport = async (r: SalesReport) => {
    setDownloadingId(r.id);
    try {
      const data = await previewSalesReport(r.id);
      const doc = buildGenericReportDoc(r, data || []);
      if (r.format === 'PDF') exportReportToPDF(doc);
      else if (r.format === 'Excel') exportReportToExcel(doc);
      else exportReportToCSV(doc);
      addNotification(`${taggedId(r.id)} · ${r.name} downloaded as ${r.format}`, 'success', 'Sales');
      runReport(r);
    } catch (e: any) {
      addNotification(e.message || `Failed to download ${r.name}`, 'warning', 'Sales');
    } finally {
      setDownloadingId(null);
    }
  };

  const openSchedule = () => {
    const draft: Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }> = {};
    for (const r of allReports) {
      draft[r.id] = { frequency: r.frequency, format: (r.format as ReportFormat) || 'PDF', status: (r.status as ReportStatus) || 'Ready' };
    }
    setScheduleDraft(draft);
    setScheduleOpen(true);
  };

  const scheduleDirty = useMemo(() => allReports.some(r => {
    const d = scheduleDraft[r.id];
    return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
  }), [allReports, scheduleDraft]);

  const saveSchedule = async () => {
    const changed = allReports.filter(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
    if (changed.length === 0) { setScheduleOpen(false); return; }
    setScheduleSaving(true);
    let ok = 0; let fail = 0;
    await Promise.all(changed.map(async (r) => {
      const d = scheduleDraft[r.id];
      try {
        await updateSalesReport(r.id, { frequency: d.frequency, format: d.format, status: d.status });
        ok++;
      } catch { fail++; }
    }));
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) addNotification(`${ok} report(s) updated`, 'success', 'Sales');
    else addNotification(`${ok} updated, ${fail} failed`, 'warning', 'Sales');
  };

  const reports = useMemo(() =>
    allReports
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || (r.description || '').toLowerCase().includes(search.toLowerCase())),
  [allReports, search]);

  const reportsByCategory = useMemo(() => {
    const map: Record<string, SalesReport[]> = {};
    CATEGORY_ORDER.forEach(c => map[c] = []);
    for (const r of reports) { if (map[r.category || '']) map[r.category || ''].push(r); }
    return map;
  }, [reports]);

  const totalReports = stats?.total ?? allReports.length;
  const ready = stats?.ready ?? allReports.filter(r => r.status === 'Ready').length;
  const scheduled = stats?.scheduled ?? allReports.filter(r => r.status === 'Scheduled').length;
  const failed = stats?.failed ?? allReports.filter(r => r.status === 'Failed').length;

  const previewColumns = useMemo<Column<any>[]>(() => {
    if (!previewData || previewData.length === 0) return [];
    const keys = Object.keys(previewData[0]);
    return keys.map(k => ({
      key: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      sortable: true,
      sortAccessor: (row: any) => row[k],
      render: (row: any) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{fmt(row[k])}</span>,
    }));
  }, [previewData]);

  return (
    <div className={['accent-sales', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Sales Reports"
        subtitle="All sales reports — select a period to view, run, and export"
        icon={FileText}
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      if (p === 'Custom') { const r = defaultCustomRange(); setCustomFrom(r.from); setCustomTo(r.to); }
                      setPeriod(p);
                    }}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      period === p ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {period === 'Custom' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                  <span className="text-slate-400">→</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                </div>
              )}
            </div>
            <button className={button.secondary} onClick={openSchedule}>
              <Clock className="w-4 h-4" /> Schedule
            </button>
            <button onClick={runAll} disabled={runningAll || loading} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
              {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
              Run All
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={totalReports} icon={FileText} tone="accent" />
        <StatCard title="Ready" value={ready} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={scheduled} icon={Clock} tone="info" />
        <StatCard title="Failed" value={failed} icon={AlertTriangle} tone="danger" />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={fetchAll} disabled={loading} className={[button.ghost, 'flex items-center gap-2'].join(' ')} title="Refresh">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports..." className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
          </div>
        </div>
      </div>

      {loading && allReports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading reports…</div>
        </SectionCard>
      ) : allReports.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports found.</div>
        </SectionCard>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const group = reportsByCategory[cat] || [];
          if (group.length === 0) return null;
          const Icon = CATEGORY_ICONS[cat] || FileText;
          return (
            <SectionCard key={cat} title={`${CATEGORY_LABELS[cat] || cat} · ${activeLabel}`} icon={Icon} tone="accent">
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
                    {group.map(r => {
                      const isRunning = runningId === r.id;
                      const isDownloading = downloadingId === r.id;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">{DEPT_TAG}</span>
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.id}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.description}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatLastRun(r.last_run)}</td>
                          <td className="px-6 py-3"><Badge tone={FORMAT_TONE[(r.format as ReportFormat) || 'PDF']}>{r.format || 'PDF'}</Badge></td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.frequency || 'Daily'}</td>
                          <td className="px-6 py-3"><Badge tone={STATUS_TONE[(r.status as ReportStatus) || 'Ready']}>{r.status}</Badge></td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              <Badge tone={period === 'Today' ? 'info' : period === 'WTD' ? 'warning' : period === 'MTD' ? 'success' : 'accent'}>{period}</Badge>
                              <span className="text-[10px] text-slate-400 font-mono">{activeRange.from} → {activeRange.to}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button onClick={() => openView(r)} className={button.ghost}><Eye className="w-4 h-4" /> View</button>
                              <button onClick={() => downloadReport(r)} disabled={isRunning || isDownloading} className={button.ghost} title={`Download as ${r.format || 'PDF'}`}>
                                {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                {isDownloading ? 'Downloading' : 'Download'}
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" /> Report Delivery</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">Reports are generated automatically and can be delivered to Finance, Executive BI, and Sales leadership inboxes. Manual re-runs are available for users with report access.</p>
      </div>

      {/* View modal */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport.id)} · ${CATEGORY_LABELS[viewReport.category || ''] || viewReport.category}` : ''}
        variant="info"
        size="xl"
        showFooter
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">{viewReport && `Last run: ${formatDateTime(viewReport.last_run)}`}</div>
            <div className="flex gap-2">
              <button onClick={() => viewReport && runReport(viewReport)} disabled={!!runningId} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2">
                {runningId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Run Now
              </button>
              <button onClick={() => viewReport && downloadReport(viewReport)} disabled={!!downloadingId} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2">
                {downloadingId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download {viewReport?.format}
              </button>
              <button onClick={() => setViewReport(null)} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition">Close</button>
            </div>
          </div>
        }
      >
        {viewReport && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3"><div className="text-xs text-slate-500 mb-1">Status</div><Badge tone={STATUS_TONE[(viewReport.status as ReportStatus) || 'Ready']}>{viewReport.status}</Badge></div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3"><div className="text-xs text-slate-500 mb-1">Format</div><Badge tone={FORMAT_TONE[(viewReport.format as ReportFormat) || 'PDF']}>{viewReport.format}</Badge></div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3"><div className="text-xs text-slate-500 mb-1">Frequency</div><div className="text-sm font-medium text-slate-700 dark:text-slate-200">{viewReport.frequency}</div></div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3"><div className="text-xs text-slate-500 mb-1">Category</div><div className="text-sm font-medium text-slate-700 dark:text-slate-200">{CATEGORY_LABELS[viewReport.category || ''] || viewReport.category}</div></div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3"><div className="text-xs text-slate-500 mb-1">Period</div><div className="text-sm font-medium text-slate-700 dark:text-slate-200">{activeLabel}</div></div>
            </div>
            <div><div className="text-xs text-slate-500 mb-1">Description</div><p className="text-sm text-slate-700 dark:text-slate-300">{viewReport.description}</p></div>
            {viewReport.updated_at && <div className="text-xs text-slate-400">Last updated: {formatDateTime(viewReport.updated_at)}</div>}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2"><Eye className="w-4 h-4" /> Live Data Preview</h4>
              {previewLoading ? <div className="text-sm text-slate-500 py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline-block mr-2" /> Loading preview…</div> : (
                !previewData || previewData.length === 0
                  ? <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">No preview data available for {activeLabel}.</div>
                  : <DataTable columns={previewColumns} data={previewData} rowKey={(row, i) => `${row.id || i}`} sortable />
              )}
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Schedule modal */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Report Scheduling"
        subtitle="Edit frequency, format, and status for all sales reports"
        variant="form"
        size="xl"
        loading={scheduleSaving}
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">{scheduleDirty ? 'Unsaved changes' : 'No changes'}</div>
            <div className="flex gap-2">
              <button onClick={() => setScheduleOpen(false)} disabled={scheduleSaving} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-40">Cancel</button>
              <button onClick={saveSchedule} disabled={scheduleSaving || !scheduleDirty} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2">
                {scheduleSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes
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
                    <td className="px-3 py-2"><div className="font-medium text-slate-700 dark:text-slate-200">{r.name}</div><div className="text-xs text-slate-400 font-mono">{taggedId(r.id)}</div></td>
                    <td className="px-3 py-2 text-slate-500">{CATEGORY_LABELS[r.category || ''] || r.category}</td>
                    <td className="px-3 py-2"><input type="text" value={d.frequency} onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], frequency: e.target.value } }))} className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200" /></td>
                    <td className="px-3 py-2">
                      <select value={d.format} onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], format: e.target.value as ReportFormat } }))} className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                        {ALL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={d.status} onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], status: e.target.value as ReportStatus } }))} className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
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

export default SalesReports;
