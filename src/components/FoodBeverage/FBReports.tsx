/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Reports module — F&B Portal.
 * 9 function-based reports: pnl, outlet, menu, cost, discount, labor, waste,
 * procurement, banquet. Per spec §29 (F&B Reports).
 *
 * All data is served from the `fb_reports` registry table via the
 * /api/fb/reports routes (see src/server/routes/fbReports.routes.ts).
 * Run / Run All actions persist status + last_run back to the DB.
 * View opens a detail modal with a live analytics preview pulled from
 * /api/fb/analytics/* (mapped by report function). outlet/menu/cost read
 * pre-aggregated snapshots (?period=); waste/procurement/banquet/labor
 * read raw transactional tables with a real date range (?from=&to=), so
 * Custom periods are exact for those.
 * Schedule opens a modal to edit frequency / format / status per report,
 * persisted via PATCH /api/fb/reports/:id.
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
  DollarSign,
  Users,
  Percent,
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

type ReportFunction = 'outlet' | 'menu' | 'cost' | 'discount' | 'labor' | 'waste' | 'procurement' | 'banquet' | 'pnl';
type ReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
type ReportFormat = 'PDF' | 'Excel' | 'CSV';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

interface Report {
  id: string;
  category: ReportFunction;
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

const API = '/api/fb/reports';
const ANALYTICS_API = '/api/fb/analytics';

// Department tag prepended to report IDs and download filenames
const DEPT_TAG = 'FB';
const taggedId = (id: string) => `${DEPT_TAG}-${id}`;

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

// ── Analytics preview mapping ────────────────────────────────────────
// Maps a report's function (category) to which analytics endpoint + columns
// to preview. This is a direct 1:1 mapping now that reports are consolidated
// by function — no more name-based regex guessing.
//
// Two flavors of source, distinguished by `dateRanged`:
//   - snapshot kinds (outlet/menu/cost) query pre-aggregated tables with
//     ?period=Today|WTD|MTD|YTD (Custom falls back to the MTD snapshot).
//   - date-ranged kinds (waste/procurement/banquet/staffProductivity) query
//     raw transactional tables with ?from=&to= — exact for every period,
//     including Custom.
type PreviewKind = 'outlet' | 'menu' | 'cost' | 'waste' | 'procurement' | 'banquet' | 'staffProductivity' | 'pnl' | null;

const KIND_ENDPOINT: Record<Exclude<PreviewKind, null>, { path: string; dateRanged: boolean }> = {
  outlet: { path: 'outlet-analytics', dateRanged: false },
  menu: { path: 'menu-engineering', dateRanged: false },
  cost: { path: 'cost-analytics', dateRanged: false },
  waste: { path: 'waste-log', dateRanged: true },
  procurement: { path: 'procurement', dateRanged: true },
  banquet: { path: 'banquet-events', dateRanged: true },
  staffProductivity: { path: 'staff-productivity', dateRanged: true },
  pnl: { path: 'pnl', dateRanged: false },
};

const FUNCTION_TO_PREVIEW: Record<ReportFunction, PreviewKind> = {
  outlet: 'outlet',
  menu: 'menu',
  cost: 'cost',
  discount: 'outlet', // no dedicated discount analytics table — fall back to outlet
  labor: 'staffProductivity',
  waste: 'waste',
  procurement: 'procurement',
  banquet: 'banquet',
  pnl: 'pnl',
};

function previewKindFor(report: Report): PreviewKind {
  return FUNCTION_TO_PREVIEW[report.category] ?? null;
}

// Builds the analytics request path for a given preview kind, branching on
// whether the source is a period snapshot or a raw date-ranged table.
function analyticsPath(kind: PreviewKind, period: Period, range: { from: string; to: string }): string | null {
  if (!kind) return null;
  const { path, dateRanged } = KIND_ENDPOINT[kind];
  return dateRanged ? `/${path}?from=${range.from}&to=${range.to}` : `/${path}?period=${apiPeriod(period)}`;
}

const PREVIEW_KIND_LABEL: Record<Exclude<PreviewKind, null>, string> = {
  outlet: 'All Outlets',
  menu: 'All Items',
  cost: 'All Outlets',
  waste: 'All Waste Logs',
  procurement: 'All Purchase Orders',
  banquet: 'All Events',
  staffProductivity: 'All Employees',
  pnl: 'All Outlets',
};

// Human-readable labels for each function group, used in section headers
const FUNCTION_LABELS: Record<ReportFunction, string> = {
  outlet: 'Outlet Sales & Performance',
  menu: 'Menu Engineering',
  cost: 'Cost & Variance',
  discount: 'Discounts & Promotions',
  labor: 'Labor Productivity',
  waste: 'Waste & Spoilage',
  procurement: 'Procurement & Suppliers',
  banquet: 'Banquet & Events',
  pnl: 'P&L by Outlet & Total',
};

// Display order for the function groups in the UI
const FUNCTION_ORDER: ReportFunction[] = ['pnl', 'outlet', 'menu', 'cost', 'waste', 'discount', 'procurement', 'banquet', 'labor'];

interface SummaryField { label: string; value: number | string }

// Rolls up the full period dataset into a handful of headline figures —
// e.g. selecting MTD on "Daily Outlet Sales" returns every outlet's MTD
// row PLUS this summary (Total Revenue, Total Covers, etc.) so the report
// reads as a complete period rollup, not just a raw data dump.
function computeAnalyticsSummary(kind: PreviewKind, data: any[]): SummaryField[] {
  if (!kind || data.length === 0) return [];
  const sum = (k: string) => data.reduce((a, row) => a + Number(row[k] || 0), 0);
  const avg = (k: string) => (data.length ? Number((sum(k) / data.length).toFixed(2)) : 0);
  const round2 = (n: number) => Number(n.toFixed(2));

  switch (kind) {
    case 'outlet':
      return [
        { label: 'Total Revenue', value: round2(sum('revenue')) },
        { label: 'Total Covers', value: sum('covers') },
        { label: 'Avg Change %', value: avg('change_percent') },
        { label: 'Outlets Included', value: data.length },
      ];
    case 'menu':
      return [
        { label: 'Total Sold', value: sum('sold') },
        { label: 'Total Margin', value: round2(sum('margin')) },
        { label: 'Avg Food Cost %', value: avg('food_cost_pct') },
        { label: 'Items Included', value: data.length },
      ];
    case 'cost':
      return [
        { label: 'Avg Food Cost %', value: avg('food_cost_pct') },
        { label: 'Avg Bev Cost %', value: avg('bev_cost_pct') },
        { label: 'Total Waste', value: round2(sum('waste')) },
        { label: 'Outlets Included', value: data.length },
      ];
    case 'staffProductivity':
      return [
        { label: 'Total Revenue', value: round2(sum('revenue')) },
        { label: 'Total Covers', value: sum('covers_served') },
        { label: 'Avg Rev/Hour', value: avg('rev_per_hour') },
        { label: 'Employees Included', value: data.length },
      ];
    case 'waste':
      return [
        { label: 'Total Waste Cost', value: round2(sum('cost_value')) },
        { label: 'Total Quantity', value: round2(sum('quantity')) },
        { label: 'Records Included', value: data.length },
      ];
    case 'procurement': {
      const openStatuses = new Set(['draft', 'submitted', 'acknowledged', 'partial']);
      const supplierIds = new Set(data.map((r: any) => r.supplier_id).filter(Boolean));
      return [
        { label: 'Total Spend', value: round2(sum('total_amount')) },
        { label: 'Open Orders', value: data.filter((r: any) => openStatuses.has(r.status)).length },
        { label: 'Suppliers Included', value: supplierIds.size },
        { label: 'Orders Included', value: data.length },
      ];
    }
    case 'banquet': {
      const upcoming = new Set(['Draft', 'Confirmed']);
      return [
        { label: 'Total Revenue', value: round2(sum('actual_revenue') || sum('estimated_revenue')) },
        { label: 'Total Guests', value: sum('guest_count') },
        { label: 'Upcoming Events', value: data.filter((r: any) => upcoming.has(r.status)).length },
        { label: 'Events Included', value: data.length },
      ];
    }
    case 'pnl': {
      // The endpoint appends a consolidated TOTAL row (is_total=true).
      // Prefer it when present; otherwise aggregate the per-outlet rows.
      const total = data.find((r: any) => r.is_total);
      const rows = total ? [total] : data;
      const s = (k: string) => rows.reduce((a, row) => a + Number(row[k] || 0), 0);
      return [
        { label: 'Total Revenue', value: round2(s('revenue')) },
        { label: 'Total COGS', value: round2(s('cogs')) },
        { label: 'Gross Profit', value: round2(s('gross_profit')) },
        { label: 'Total Waste', value: round2(s('waste')) },
        { label: 'Total Labor Cost', value: round2(s('labor_cost')) },
        { label: 'Net Profit', value: round2(s('net_profit')) },
        { label: 'Net Margin %', value: total ? total.net_margin_pct : (rows.length ? Number((s('net_profit') / s('revenue') * 100).toFixed(2)) : 0) },
        { label: 'Outlets Included', value: data.filter((r: any) => !r.is_total).length },
      ];
    }
    default:
      return [];
  }
}

// Every period is applicable to every report category — selecting MTD on a
// "Daily" report doesn't restrict it to a single day; it rolls up all the
// daily-level records that fall within that period (plus a summary), same
// as picking MTD on a Weekly/Monthly/Executive report. Switching category
// still preselects the period that's most natural for that category, but
// nothing is disabled.
const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];
// Custom falls back to the MTD snapshot for its underlying analytics query
// (the analytics tables are pre-aggregated by Today/WTD/MTD/YTD, not
// per-day, so there's no raw transactional data to slice an arbitrary
// range from). The UI still labels Custom with the exact dates picked.
const apiPeriod = (p: Period): 'Today' | 'WTD' | 'MTD' | 'YTD' => (p === 'Custom' ? 'MTD' : p);

// ── Concrete date-range resolution ────────────────────────────────────
// Abstract labels like "MTD" are ambiguous on their own — this resolves
// them to the concrete calendar dates they represent so every KPI,
// preview, and exported document is auditable against a real date range.
function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
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
// Sensible default Custom range applied the moment a user switches into
// Custom mode — defaults to the current month-to-date.
function defaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

// Human-readable period label with the concrete date range resolved, e.g.
// "MTD (2026-08-01 → 2026-08-19)". Custom shows just the picked range.
function periodLabel(p: Period, from: string, to: string): string {
  const range = periodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}

export default function FBReports() {
  const { addNotification, formatAmount } = useERP();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Today');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  // Concrete date range + display label for the active period, memoized so
  // every consumer (KPIs, table, modals, exports) resolves the exact same
  // dates for a given period selection.
  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  const [allReports, setAllReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  // View modal
  const [viewReport, setViewReport] = useState<Report | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Analytics summary for the selected period (drives period-aware KPIs + list)
  interface AnalyticsSummary {
    period: string;
    totalRevenue: number;
    totalCovers: number;
    avgChange: number;
    avgFoodCost: number;
    avgBevCost: number;
    totalWaste: number;
    outletCount: number;
  }
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Schedule modal
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // ── API helpers ───────────────────────────────────────────────────
  const apiGet = async (base: string, path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const apiPost = async (path: string) => {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const apiPatch = async (path: string, body: any) => {
    const r = await fetch(`${API}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [reports, s] = await Promise.all([apiGet(API, ''), apiGet(API, '/stats')]);
      setAllReports(reports as Report[]);
      setStats(s as ReportStats);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load F&B reports', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNotification]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Fetch analytics summary whenever the period changes
  const fetchSummary = useCallback(async (p: Period) => {
    setSummaryLoading(true);
    try {
      const data = await apiGet(ANALYTICS_API, `/summary?period=${apiPeriod(p)}`);
      setSummary(data as AnalyticsSummary);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchSummary(period);
  }, [period, fetchSummary]);

  // ── Derived data ──────────────────────────────────────────────────
  // Flat list of all reports, filtered only by search.
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

  // Reports grouped by function for sectioned UI rendering.
  const reportsByFunction = useMemo(() => {
    const map: Record<ReportFunction, Report[]> = { outlet: [], menu: [], cost: [], discount: [], labor: [], waste: [], procurement: [], banquet: [], pnl: [] };
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
      addNotification(`${r.name} refreshed`, 'success', 'F&B');
    } catch (e: any) {
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
      addNotification(e.message || `Failed to run ${r.name}`, 'warning', 'F&B');
    } finally {
      setRunningId(null);
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const result = await apiPost('/run-all');
      await fetchAll();
      addNotification(`${result.refreshed || 0} report(s) queued for refresh`, 'info', 'F&B');
    } catch (e: any) {
      addNotification(e.message || 'Failed to run all reports', 'warning', 'F&B');
    } finally {
      setRunningAll(false);
    }
  };

  // ── Download: generate a real file (PDF / Excel / CSV) ────────────
  const buildReportDoc = (r: Report, data: any[]): ReportDocument => {
    const kind = previewKindFor(r);
    const businessDate = new Date().toISOString().split('T')[0];

    let section: ReportSection;
    if (kind === 'outlet') {
      section = {
        title: `Outlet Analytics — ${PREVIEW_KIND_LABEL.outlet} — ${activeLabel}`,
        columns: ['Outlet', 'Revenue', 'Covers', 'Avg Check', 'RevPASH', 'Occupancy %', 'Turnover', 'Change %'],
        rows: data.map((o: any) => [
          o.outlets?.name || '—',
          Number(o.revenue || 0),
          o.covers || 0,
          Number(o.avg_check || 0),
          Number(o.rev_pash || 0),
          Number(o.occupancy || 0),
          Number(o.turnover || 0),
          Number(o.change_percent || 0),
        ]),
      };
    } else if (kind === 'menu') {
      section = {
        title: `Menu Engineering — ${PREVIEW_KIND_LABEL.menu} — ${activeLabel}`,
        columns: ['Item', 'Category', 'Sold', 'Price', 'Cost', 'Margin', 'Food Cost %', 'Classification'],
        rows: data.map((m: any) => [
          m.item_name || '—',
          m.category || '—',
          m.sold || 0,
          Number(m.price || 0),
          Number(m.cost || 0),
          Number(m.margin || 0),
          Number(m.food_cost_pct || 0),
          m.classification || '—',
        ]),
      };
    } else if (kind === 'cost') {
      section = {
        title: `Cost Analytics — ${PREVIEW_KIND_LABEL.cost} — ${activeLabel}`,
        columns: ['Outlet', 'Food Cost %', 'Bev Cost %', 'Waste', 'Variance %', 'Theoretical', 'Actual'],
        rows: data.map((c: any) => [
          c.outlets?.name || '—',
          Number(c.food_cost_pct || 0),
          Number(c.bev_cost_pct || 0),
          Number(c.waste || 0),
          Number(c.variance || 0),
          Number(c.theoretical || 0),
          Number(c.actual || 0),
        ]),
      };
    } else if (kind === 'staffProductivity') {
      section = {
        title: `Staff Productivity — ${PREVIEW_KIND_LABEL.staffProductivity} — ${activeLabel}`,
        columns: ['Employee', 'Outlet', 'Covers Served', 'Revenue', 'Hours', 'Rev/Hour'],
        rows: data.map((s: any) => [
          s.employee_id || '—',
          s.outlets?.name || '—',
          s.covers_served || 0,
          Number(s.revenue || 0),
          Number(s.hours || 0),
          Number(s.rev_per_hour || 0),
        ]),
      };
    } else if (kind === 'waste') {
      section = {
        title: `Waste & Spoilage — ${PREVIEW_KIND_LABEL.waste} — ${activeLabel}`,
        columns: ['Ingredient', 'Location', 'Quantity', 'Unit', 'Reason', 'Cost', 'Logged By', 'Date'],
        rows: data.map((w: any) => [
          w.ingredients?.name || '—',
          w.stock_locations?.name || '—',
          Number(w.quantity || 0),
          w.unit || '—',
          w.reason || '—',
          Number(w.cost_value || 0),
          w.logged_by || '—',
          formatLastRun(w.created_at),
        ]),
      };
    } else if (kind === 'procurement') {
      section = {
        title: `Procurement & Suppliers — ${PREVIEW_KIND_LABEL.procurement} — ${activeLabel}`,
        columns: ['PO Number', 'Supplier', 'Status', 'Order Date', 'Expected Delivery', 'Total Amount', 'Payment Status'],
        rows: data.map((p: any) => [
          p.po_number || '—',
          p.fb_suppliers?.name || '—',
          p.status || '—',
          formatLastRun(p.order_date),
          formatLastRun(p.expected_delivery_date),
          Number(p.total_amount || 0),
          p.payment_status || '—',
        ]),
      };
    } else if (kind === 'banquet') {
      section = {
        title: `Banquet & Events — ${PREVIEW_KIND_LABEL.banquet} — ${activeLabel}`,
        columns: ['Event', 'Client', 'Date', 'Guests', 'Status', 'Estimated Revenue', 'Actual Revenue'],
        rows: data.map((b: any) => [
          b.event_name || '—',
          b.client_name || '—',
          b.event_date || '—',
          b.guest_count || 0,
          b.status || '—',
          Number(b.estimated_revenue || 0),
          Number(b.actual_revenue || 0),
        ]),
      };
    } else if (kind === 'pnl') {
      section = {
        title: `P&L by Outlet & Total — ${PREVIEW_KIND_LABEL.pnl} — ${activeLabel}`,
        columns: ['Outlet', 'Revenue', 'COGS', 'Gross Profit', 'Gross Margin %', 'Waste', 'Labor Hours', 'Labor Cost', 'Total Op. Cost', 'Net Profit', 'Net Margin %'],
        rows: data.map((p: any) => [
          p.outlet_name || '—',
          Number(p.revenue || 0),
          Number(p.cogs || 0),
          Number(p.gross_profit || 0),
          Number(p.gross_margin_pct || 0),
          Number(p.waste || 0),
          Number(p.labor_hours || 0),
          Number(p.labor_cost || 0),
          Number(p.total_operating_cost || 0),
          Number(p.net_profit || 0),
          Number(p.net_margin_pct || 0),
        ]),
      };
    } else {
      // Fallback: report metadata only
      section = {
        title: 'Report Metadata',
        columns: ['Field', 'Value'],
        rows: [
          ['Report ID', taggedId(r.id)],
          ['Function', FUNCTION_LABELS[r.category]],
          ['Status', r.status],
          ['Format', r.format],
          ['Frequency', r.frequency],
          ['Last Run', formatLastRun(r.last_run)],
        ],
      };
    }

    // Prepend a rollup Summary section so the exported document reads as a
    // complete period report, not just a raw data dump.
    const summaryStats = computeAnalyticsSummary(kind, data);
    const summarySection: ReportSection | null = summaryStats.length > 0
      ? {
          title: `Summary — ${activeLabel}`,
          columns: ['Metric', 'Value'],
          rows: summaryStats.map(s => [s.label, s.value]),
        }
      : null;

    return {
      reportName: `${DEPT_TAG} ${r.name}`,
      businessDate,
      propertyName: 'SELEDA Hotel ERP — F&B',
      sections: summarySection ? [summarySection, section] : [section],
    };
  };

  const downloadReport = async (r: Report) => {
    setDownloadingId(r.id);
    try {
      const kind = previewKindFor(r);
      let data: any[] = [];
      const path = analyticsPath(kind, period, activeRange);
      if (path) {
        data = await apiGet(ANALYTICS_API, path);
      }
      const doc = buildReportDoc(r, data || []);
      if (r.format === 'PDF') {
        exportReportToPDF(doc);
      } else if (r.format === 'Excel') {
        exportReportToExcel(doc);
      } else {
        exportReportToCSV(doc);
      }
      addNotification(`${taggedId(r.id)} · ${r.name} downloaded as ${r.format}`, 'success', 'F&B');
      // Also mark as run in the DB
      runReport(r);
    } catch (e: any) {
      addNotification(e.message || `Failed to download ${r.name}`, 'warning', 'F&B');
    } finally {
      setDownloadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  // ── View modal: fetch analytics preview ───────────────────────────
  // Shows the FULL set of records for the selected period (not a capped
  // sample) — e.g. "Daily Outlet Sales" + MTD returns every outlet's MTD
  // rollup row, plus a computed summary panel above the table.
  const openView = useCallback(async (r: Report) => {
    setViewReport(r);
    setPreviewData(null);
    const kind = previewKindFor(r);
    const path = analyticsPath(kind, period, activeRange);
    if (!path) return;
    setPreviewLoading(true);
    try {
      const data = await apiGet(ANALYTICS_API, path);
      setPreviewData(data || []);
    } catch (e: any) {
      setPreviewData([]);
    } finally {
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, activeRange]);

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
          await apiPatch(`/${encodeURIComponent(r.id)}`, {
            frequency: d.frequency,
            format: d.format,
            status: d.status,
          });
          ok++;
        } catch {
          fail++;
        }
      }),
    );
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) addNotification(`${ok} report(s) updated`, 'success', 'F&B');
    else addNotification(`${ok} updated, ${fail} failed`, 'warning', 'F&B');
  };

  // ── Preview table renderer ────────────────────────────────────────
  const renderPreview = () => {
    if (!viewReport) return null;
    const kind = previewKindFor(viewReport);
    if (!kind) {
      return (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
          No live preview available for this report type. Run the report to generate output.
        </div>
      );
    }
    if (previewLoading) {
      return (
        <div className="text-sm text-slate-500 py-6 text-center">
          <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
          Loading preview…
        </div>
      );
    }
    if (!previewData || previewData.length === 0) {
      return (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
          No preview data available for {activeLabel}.
        </div>
      );
    }
    const fmt = (n: any) => (typeof n === 'number' ? formatAmount ? formatAmount(Number(n)) : Number(n).toLocaleString() : String(n ?? '—'));
    const scopeLabel = PREVIEW_KIND_LABEL[kind];
    const summaryStats = computeAnalyticsSummary(kind, previewData);
    const isCurrency = (label: string) => /revenue|margin|waste/i.test(label);
    const isPercent = (label: string) => /%/.test(label);

    const summaryPanel = summaryStats.length > 0 && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {summaryStats.map(s => (
          <div key={s.label} className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {typeof s.value === 'number' && isCurrency(s.label)
                ? fmt(s.value)
                : typeof s.value === 'number' && isPercent(s.label)
                  ? `${s.value}%`
                  : typeof s.value === 'number'
                    ? s.value.toLocaleString()
                    : s.value}
            </div>
          </div>
        ))}
      </div>
    );

    if (kind === 'outlet') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">Outlet analytics — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">Covers</th>
                  <th className="px-3 py-2 font-medium text-right">Avg Check</th>
                  <th className="px-3 py-2 font-medium text-right">RevPASH</th>
                  <th className="px-3 py-2 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((o: any, i: number) => (
                  <tr key={o.id || i}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{o.outlets?.name || '—'}</td>
                    <td className="px-3 py-2 text-right">{fmt(o.revenue)}</td>
                    <td className="px-3 py-2 text-right">{o.covers}</td>
                    <td className="px-3 py-2 text-right">{fmt(o.avg_check)}</td>
                    <td className="px-3 py-2 text-right">{fmt(o.rev_pash)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={Number(o.change_percent) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                        {Number(o.change_percent) >= 0 ? '+' : ''}{o.change_percent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (kind === 'menu') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">Menu engineering — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium text-right">Sold</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                  <th className="px-3 py-2 font-medium text-right">Margin</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((m: any, i: number) => (
                  <tr key={m.id || i}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{m.item_name}</td>
                    <td className="px-3 py-2 text-slate-500">{m.category}</td>
                    <td className="px-3 py-2 text-right">{m.sold}</td>
                    <td className="px-3 py-2 text-right">{fmt(m.price)}</td>
                    <td className="px-3 py-2 text-right">{fmt(m.margin)}</td>
                    <td className="px-3 py-2"><Badge tone={m.classification === 'Star' ? 'success' : m.classification === 'Puzzle' ? 'warning' : m.classification === 'Dog' ? 'danger' : 'info'}>{m.classification}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (kind === 'staffProductivity') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">Staff productivity — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium text-right">Covers Served</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">Hours</th>
                  <th className="px-3 py-2 font-medium text-right">Rev/Hour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((s: any, i: number) => (
                  <tr key={s.id || i}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-mono">{s.employee_id || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{s.outlets?.name || '—'}</td>
                    <td className="px-3 py-2 text-right">{s.covers_served}</td>
                    <td className="px-3 py-2 text-right">{fmt(s.revenue)}</td>
                    <td className="px-3 py-2 text-right">{s.hours}</td>
                    <td className="px-3 py-2 text-right">{fmt(s.rev_per_hour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (kind === 'waste') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">Waste & spoilage — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Ingredient</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium text-right">Quantity</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                  <th className="px-3 py-2 font-medium">Logged By</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((w: any, i: number) => (
                  <tr key={w.id || i}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{w.ingredients?.name || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{w.stock_locations?.name || '—'}</td>
                    <td className="px-3 py-2 text-right">{w.quantity} {w.unit}</td>
                    <td className="px-3 py-2"><Badge tone={w.reason === 'Theft' ? 'danger' : w.reason === 'Spoilage' ? 'warning' : 'info'}>{w.reason}</Badge></td>
                    <td className="px-3 py-2 text-right">{fmt(w.cost_value)}</td>
                    <td className="px-3 py-2 text-slate-500">{w.logged_by || '—'}</td>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatLastRun(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (kind === 'procurement') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">Procurement & suppliers — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">PO Number</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Order Date</th>
                  <th className="px-3 py-2 font-medium text-right">Total Amount</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((p: any, i: number) => (
                  <tr key={p.id || i}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-mono">{p.po_number || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{p.fb_suppliers?.name || '—'}</td>
                    <td className="px-3 py-2"><Badge tone={p.status === 'received' || p.status === 'closed' ? 'success' : p.status === 'cancelled' ? 'danger' : 'info'}>{p.status}</Badge></td>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatLastRun(p.order_date)}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.total_amount)}</td>
                    <td className="px-3 py-2"><Badge tone={p.payment_status === 'paid' ? 'success' : p.payment_status === 'overdue' ? 'danger' : 'warning'}>{p.payment_status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (kind === 'banquet') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">Banquet & events — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium text-right">Guests</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Est. Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">Actual Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((b: any, i: number) => (
                  <tr key={b.id || i}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{b.event_name || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{b.client_name || '—'}</td>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{b.event_date || '—'}</td>
                    <td className="px-3 py-2 text-right">{b.guest_count}</td>
                    <td className="px-3 py-2"><Badge tone={b.status === 'Completed' ? 'success' : b.status === 'Cancelled' ? 'danger' : b.status === 'Confirmed' ? 'info' : 'warning'}>{b.status}</Badge></td>
                    <td className="px-3 py-2 text-right">{fmt(b.estimated_revenue)}</td>
                    <td className="px-3 py-2 text-right">{fmt(b.actual_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (kind === 'pnl') {
      return (
        <div>
          <p className="text-xs text-slate-500 mb-2">P&L by outlet & total — {scopeLabel} — {activeLabel} ({previewData.length} rows)</p>
          {summaryPanel}
          <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">COGS</th>
                  <th className="px-3 py-2 font-medium text-right">Gross Profit</th>
                  <th className="px-3 py-2 font-medium text-right">GM %</th>
                  <th className="px-3 py-2 font-medium text-right">Waste</th>
                  <th className="px-3 py-2 font-medium text-right">Labor Hrs</th>
                  <th className="px-3 py-2 font-medium text-right">Labor Cost</th>
                  <th className="px-3 py-2 font-medium text-right">Net Profit</th>
                  <th className="px-3 py-2 font-medium text-right">NM %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {previewData.map((p: any, i: number) => (
                  <tr key={p.outlet_id || i} className={p.is_total ? 'bg-slate-100 dark:bg-slate-700/40 font-semibold' : ''}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{p.outlet_name || '—'}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.revenue)}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.cogs)}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.gross_profit)}</td>
                    <td className="px-3 py-2 text-right">{p.gross_margin_pct}%</td>
                    <td className="px-3 py-2 text-right">{fmt(p.waste)}</td>
                    <td className="px-3 py-2 text-right">{p.labor_hours}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.labor_cost)}</td>
                    <td className={`px-3 py-2 text-right ${Number(p.net_profit) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(p.net_profit)}</td>
                    <td className="px-3 py-2 text-right">{p.net_margin_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    // cost
    return (
      <div>
        <p className="text-xs text-slate-500 mb-2">Cost analytics — {scopeLabel} — {activeLabel} ({previewData.length} records)</p>
        {summaryPanel}
        <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 font-medium">Outlet</th>
                <th className="px-3 py-2 font-medium text-right">Food Cost %</th>
                <th className="px-3 py-2 font-medium text-right">Bev Cost %</th>
                <th className="px-3 py-2 font-medium text-right">Waste</th>
                <th className="px-3 py-2 font-medium text-right">Variance</th>
                <th className="px-3 py-2 font-medium text-right">Theoretical</th>
                <th className="px-3 py-2 font-medium text-right">Actual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {previewData.map((c: any, i: number) => (
                <tr key={c.id || i}>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{c.outlets?.name || '—'}</td>
                  <td className="px-3 py-2 text-right">{c.food_cost_pct}%</td>
                  <td className="px-3 py-2 text-right">{c.bev_cost_pct}%</td>
                  <td className="px-3 py-2 text-right">{fmt(c.waste)}</td>
                  <td className="px-3 py-2 text-right">{c.variance}%</td>
                  <td className="px-3 py-2 text-right">{fmt(c.theoretical)}</td>
                  <td className="px-3 py-2 text-right">{fmt(c.actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="F&B Reports"
        subtitle="All F&B reports — select a period to view, run, and export"
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
                  <span
                    className="flex items-center text-amber-500"
                    title={`Custom dates are exact for Waste, Procurement, Banquet, and Labor reports (real transaction dates). Outlet, Menu, Cost, Discount, and P&L reports fall back to the nearest available snapshot (${apiPeriod(period)}) since those are pre-aggregated, not day-level.`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </span>
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

      <div className={layout.kpiGrid}>
        <StatCard
          title="Total Revenue"
          value={summaryLoading ? '—' : (summary ? (formatAmount ? formatAmount(summary.totalRevenue) : summary.totalRevenue.toLocaleString()) : '—')}
          icon={DollarSign}
          tone="accent"
          change={summary?.avgChange}
          changeLabel={activeLabel}
        />
        <StatCard
          title="Total Covers"
          value={summaryLoading ? '—' : (summary?.totalCovers ?? '—')}
          icon={Users}
          tone="neutral"
          caption={activeLabel}
        />
        <StatCard
          title="Avg Food Cost"
          value={summaryLoading ? '—' : (summary ? `${summary.avgFoodCost}%` : '—')}
          icon={Percent}
          tone="warning"
          caption={activeLabel}
        />
        <StatCard
          title="Avg Bev Cost"
          value={summaryLoading ? '—' : (summary ? `${summary.avgBevCost}%` : '—')}
          icon={Percent}
          tone="info"
          caption={activeLabel}
        />
      </div>

      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={totalReports} icon={FileText} tone="accent" />
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
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <div className="relative w-full sm:w-56">
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

      {/* ── Reports grouped by function ──── */}
      {loading && reports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
            Loading reports…
          </div>
        </SectionCard>
      ) : reports.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports found.</div>
        </SectionCard>
      ) : (
        FUNCTION_ORDER.map(fn => {
          const groupReports = reportsByFunction[fn];
          if (groupReports.length === 0) return null;
          return (
            <SectionCard
              key={fn}
              title={`${FUNCTION_LABELS[fn]} · ${activeLabel}`}
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
                                onClick={() => openView(r)}
                                className={button.ghost}
                              >
                                <Eye className="w-4 h-4" /> View
                              </button>
                              <button
                                onClick={() => downloadReport(r)}
                                disabled={isRunning || downloadingId === r.id}
                                className={button.ghost}
                                title={`Download as ${r.format}`}
                              >
                                {downloadingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
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
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          Report Delivery
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Reports are generated automatically and can be delivered to Finance, Executive BI, and F&B leadership inboxes. Manual re-runs are available for users with report access.
        </p>
      </div>

      {/* ── View Modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport.id)} · ${FUNCTION_LABELS[viewReport.category]}` : ''}
        variant="info"
        size="xl"
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
            {/* Metadata grid */}
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
                <div className="text-xs text-slate-500 mb-1">Function</div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{FUNCTION_LABELS[viewReport.category]}</div>
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

            {/* Live preview */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4" /> Live Data Preview
              </h4>
              {renderPreview()}
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Schedule Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Report Scheduling"
        subtitle="Edit frequency, format, and status for all F&B reports"
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
                <th className="px-3 py-2 font-medium">Function</th>
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
                    <td className="px-3 py-2 text-slate-500">{FUNCTION_LABELS[r.category]}</td>
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
