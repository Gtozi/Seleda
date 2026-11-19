/**
 * Reports — /erp/inventory/reports
 * DB-integrated via /api/uinv-portal/reports/*.
 * Standard inventory reports per spec §17.
 *
 * UI mirrors F&B reports: period selector (Today/WTD/MTD/YTD/Custom) in the
 * header, report catalog in a table with View + Download actions, and a
 * detail modal with live data preview.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Clock, Loader2, ServerCrash, Download, BarChart3,
  Search, Eye, RefreshCw, AlertTriangle, FileBarChart,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import { fetchReport, type ReportData } from '../../services/inventoryService';
import InventoryTable from './InventoryTable';
import PeriodSelector, { usePeriodRange, type Period } from './PeriodSelector';
import {
  exportReportToCSV,
  type ReportDocument,
} from '../FrontDesk/reportExportUtils';

// ── Report catalog ────────────────────────────────────────────────────
type ReportCategory = 'stock' | 'movement' | 'consumption' | 'valuation' | 'counts' | 'waste' | 'expiry' | 'audit';

interface ReportDef {
  id: string;
  category: ReportCategory;
  name: string;
  description: string;
  format: 'PDF' | 'Excel' | 'CSV';
  frequency: string;
}

const REPORTS: ReportDef[] = [
  { id: 'stock-summary',       category: 'stock',       name: 'Stock Summary',              description: 'On-hand value by store and category.',           format: 'Excel', frequency: 'Daily' },
  { id: 'movement-analysis',   category: 'movement',    name: 'Movement Analysis',          description: 'In/out flows over a period.',                    format: 'Excel', frequency: 'Weekly' },
  { id: 'slow-moving',         category: 'movement',    name: 'Slow-Moving Inventory',      description: 'Items with no movement in 90+ days.',            format: 'Excel', frequency: 'Monthly' },
  { id: 'dead-stock',          category: 'movement',    name: 'Dead Stock',                 description: 'Items with no movement in 180+ days.',           format: 'Excel', frequency: 'Monthly' },
  { id: 'consumption-by-dept', category: 'consumption', name: 'Consumption by Department',  description: 'Issues grouped by consuming department.',        format: 'Excel', frequency: 'Weekly' },
  { id: 'valuation-summary',   category: 'valuation',   name: 'Valuation Summary',          description: 'Inventory value by costing method.',             format: 'PDF',   frequency: 'Monthly' },
  { id: 'variance-report',     category: 'counts',      name: 'Count Variance Report',      description: 'Stock count variances with value impact.',       format: 'Excel', frequency: 'Per Count' },
  { id: 'waste-summary',       category: 'waste',       name: 'Waste Summary',              description: 'Waste/spoilage totals by reason.',               format: 'Excel', frequency: 'Weekly' },
  { id: 'expiry-report',       category: 'expiry',      name: 'Expiry Report',              description: 'Batches near or past expiry.',                   format: 'Excel', frequency: 'Daily' },
  { id: 'ledger-audit',        category: 'audit',       name: 'Stock Ledger Audit',         description: 'Immutable movement ledger entries.',             format: 'CSV',   frequency: 'On Demand' },
];

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  stock: 'Stock & Valuation',
  movement: 'Movement Analysis',
  consumption: 'Consumption',
  valuation: 'Stock & Valuation',
  counts: 'Counts & Variance',
  waste: 'Waste & Spoilage',
  expiry: 'Expiry & Shelf Life',
  audit: 'Audit & Compliance',
};

const CATEGORY_ORDER: ReportCategory[] = ['stock', 'movement', 'consumption', 'counts', 'waste', 'expiry', 'audit'];

const FORMAT_TONE: Record<string, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

const DEPT_TAG = 'INV';
const taggedId = (id: string) => `${DEPT_TAG}-${id}`;

const ReportsModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId } = useERP();
  const [search, setSearch] = useState('');
  const { period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, activeRange, activeLabel } = usePeriodRange();

  // Report data
  const [viewReport, setViewReport] = useState<ReportDef | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async (reportId: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchReport(reportId, {
        propertyId: currentPropertyId || undefined,
        startDate: activeRange.from,
        endDate: activeRange.to,
      });
      setData(d);
    } catch (e: any) {
      setError(e?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, activeRange.from, activeRange.to]);

  const openView = useCallback((r: ReportDef) => {
    setViewReport(r);
    setData(null);
    setError(null);
    load(r.id);
  }, [load]);

  const closeView = () => {
    setViewReport(null);
    setData(null);
    setError(null);
  };

  // Reload the open report when the period changes
  useEffect(() => {
    if (viewReport) load(viewReport.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRange.from, activeRange.to]);

  const downloadReport = useCallback((r: ReportDef) => {
    setDownloadingId(r.id);
    try {
      const rows = (data?.rows as any[]) || [];
      const doc: ReportDocument = {
        title: `${r.name} — ${activeLabel}`,
        generatedAt: new Date().toISOString(),
        sections: [{
          title: r.name,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          rows,
        }],
      };
      const ext = r.format === 'PDF' ? 'csv' : r.format === 'Excel' ? 'csv' : 'csv';
      exportReportToCSV(doc, `${taggedId(r.id)}.${ext}`);
    } finally {
      setDownloadingId(null);
    }
  }, [data, activeLabel]);

  // Filter reports by search
  const filteredReports = useMemo(() => {
    if (!search) return REPORTS;
    const q = search.toLowerCase();
    return REPORTS.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
    );
  }, [search]);

  // Group reports by category label
  const reportsByCategory = useMemo(() => {
    const map: Record<string, ReportDef[]> = {};
    for (const r of filteredReports) {
      const label = CATEGORY_LABELS[r.category];
      if (!map[label]) map[label] = [];
      map[label].push(r);
    }
    return map;
  }, [filteredReports]);

  const groupOrder = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const cat of CATEGORY_ORDER) {
      const label = CATEGORY_LABELS[cat];
      if (!seen.has(label) && reportsByCategory[label]) {
        seen.add(label);
        ordered.push(label);
      }
    }
    return ordered;
  }, [reportsByCategory]);

  const rows = (data?.rows as any[]) || [];
  const columns = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);

  // ── Live preview renderer ────────────────────────────────────────────
  const renderPreview = () => {
    if (!viewReport) return null;
    if (loading) {
      return (
        <div className="text-sm text-slate-500 py-6 text-center">
          <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
          Loading preview…
        </div>
      );
    }
    if (error) {
      return (
        <div className="text-sm text-red-600 dark:text-red-400 py-6 text-center flex items-center justify-center gap-2">
          <ServerCrash className="w-4 h-4" /> {error}
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
          No preview data available for {activeLabel}.
        </div>
      );
    }

    // Summary stats from the first few numeric columns
    const summaryStats = columns.slice(0, 4).map(col => {
      const sample = rows[0][col];
      const isNumeric = typeof sample === 'number' || (!isNaN(Number(sample)) && sample !== '' && sample !== null);
      if (!isNumeric) return { label: col.replace(/_/g, ' '), value: '—' as string | number };
      const total = rows.reduce((s, r) => s + Number(r[col] || 0), 0);
      return { label: col.replace(/_/g, ' '), value: total };
    });

    return (
      <div>
        {/* Summary stats */}
        {summaryStats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {summaryStats.map(s => (
              <div key={s.label} className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">{s.label}</div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Data table */}
        <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
              <tr>
                {columns.map(c => (
                  <th key={c} className="px-3 py-2 font-medium">{c.replace(/_/g, ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  {columns.map(c => (
                    <td key={c} className="px-3 py-2 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {String(row[c] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">{rows.length} records · {activeLabel}</p>
      </div>
    );
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Inventory Reports"
        subtitle="All inventory reports — select a period to view and export"
        icon={FileText}
        actions={
          <>
            {/* Period toggle + custom dates */}
            <PeriodSelector
              period={period}
              onPeriodChange={setPeriod}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFromChange={setCustomFrom}
              onCustomToChange={setCustomTo}
            />
            <button onClick={() => viewReport && load(viewReport.id)} disabled={loading || !viewReport} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={REPORTS.length} icon={FileText} tone="accent" />
        <StatCard title="Categories" value={groupOrder.length} icon={BarChart3} tone="info" />
        <StatCard title="Period" value={period} icon={Clock} tone="neutral" caption={activeLabel} />
        <StatCard title="Viewing" value={viewReport?.name || 'None'} icon={FileBarChart} tone="warning" />
      </div>

      {subTabBar}

      {/* ── Unified toolbar: search ──── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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

      {/* ── Reports grouped by category ──── */}
      {groupOrder.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports found matching "{search}".</div>
        </SectionCard>
      ) : (
        groupOrder.map(label => {
          const groupReports = reportsByCategory[label];
          if (!groupReports || groupReports.length === 0) return null;
          return (
            <SectionCard
              key={label}
              title={`${label} · ${activeLabel}`}
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
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium">Frequency</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {groupReports.map(r => (
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
                        <td className="px-6 py-3"><Badge tone={FORMAT_TONE[r.format]}>{r.format}</Badge></td>
                        <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.frequency}</td>
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
                              onClick={() => { openView(r); setTimeout(() => downloadReport(r), 100); }}
                              disabled={downloadingId === r.id}
                              className={button.ghost}
                              title={`Download as ${r.format}`}
                            >
                              {downloadingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                              Download
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
          Reports are generated on-demand using the selected period. Export to {FORMAT_TONE.Excel ? 'Excel' : 'CSV'} or PDF for offline analysis. Stock Summary and Expiry reports run daily; Movement and Consumption reports are most meaningful over WTD/MTD ranges.
        </p>
      </div>

      {/* ── View Modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={closeView}
        title={viewReport?.name || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport.id)} · ${CATEGORY_LABELS[viewReport.category]}` : ''}
        variant="info"
        size="xl"
        showFooter={true}
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {viewReport && `Period: ${activeLabel}`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => viewReport && load(viewReport.id)}
                disabled={loading}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
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
                onClick={closeView}
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
    </div>
  );
};

export default ReportsModule;
