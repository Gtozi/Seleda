/**
 * Daily Flash Reports — Operations Portal (/erp/operations/flash-reports).
 *
 * Generates and stores real operational report snapshots in
 * `ops_flash_reports` via /api/ops-portal/flash-reports. Each generation
 * computes a live cross-portal snapshot (occupancy, revenue, HK,
 * maintenance, guest experience, safety, events, escalations) — the
 * report type selects which sections are captured.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileBarChart,
  Download,
  Calendar,
  RefreshCw,
  Loader2,
  Eye,
  Trash2,
  Play,
  Clock,
  Layers,
  Printer,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchFlashReports,
  fetchFlashReport,
  generateFlashReport,
  deleteFlashReport,
  type FlashReportRow,
  type FlashReportPayload,
  type FlashReportMetric,
} from '../../../services/operationsService';

const fmtTs = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const statusTone = (s: string): 'success' | 'info' | 'danger' =>
  ({ ready: 'success', generating: 'info', failed: 'danger' } as Record<string, 'success' | 'info' | 'danger'>)[s] || 'info';

const metricToneCls = (tone?: FlashReportMetric['tone']) =>
  tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
  : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
  : tone === 'bad' ? 'text-rose-600 dark:text-rose-400'
  : 'text-slate-900 dark:text-white';

const DailyFlashReports: React.FC = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [reports, setReports] = useState<FlashReportRow[]>([]);
  const [reportTypes, setReportTypes] = useState<{ key: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [genType, setGenType] = useState('daily-operations');
  const [viewing, setViewing] = useState<{ id: string; name: string; payload: FlashReportPayload } | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFlashReports(currentPropertyId || undefined);
      setReports(data.reports);
      setReportTypes(data.reportTypes);
      if (!data.reportTypes.find(t => t.key === genType)) setGenType('daily-operations');
    } catch (e: any) {
      setError(e?.message || 'Failed to load flash reports');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy('generate');
    try {
      await generateFlashReport({ type: genType, propertyId: currentPropertyId || undefined });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Report generation failed');
    } finally {
      setBusy(null);
    }
  };

  const view = async (id: string) => {
    setBusy(`view-${id}`);
    try {
      const { report } = await fetchFlashReport(id);
      setViewing({ id: report.id, name: report.name, payload: report.payload as FlashReportPayload });
    } catch (e: any) {
      setError(e?.message || 'Failed to load report');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this report?')) return;
    setBusy(`del-${id}`);
    try {
      await deleteFlashReport(id);
      if (viewing?.id === id) setViewing(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(
    () => reports.filter(r => typeFilter === 'all' || r.type === typeFilter),
    [reports, typeFilter]
  );

  const todayCount = reports.filter(r => r.periodDate === new Date().toISOString().slice(0, 10)).length;
  const typesUsed = new Set(reports.map(r => r.type)).size;

  const renderMetric = (sectionKey: string, m: FlashReportMetric) => (
    <div key={m.label} className="rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">{m.label}</p>
      <p className={`text-lg font-semibold ${metricToneCls(m.tone)}`}>
        {sectionKey === 'revenue' && typeof m.value === 'number' ? formatAmount(m.value) : m.value}
      </p>
    </div>
  );

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Daily Flash Reports"
        subtitle="Generate and archive live cross-portal operational snapshots"
        icon={FileBarChart}
        actions={
          <button className={button.secondary} onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Reports Generated" value={reports.length} caption={`${todayCount} today`} icon={FileBarChart} tone="info" />
        <StatCard label="Today's Reports" value={todayCount} caption="current period" icon={Calendar} tone="success" />
        <StatCard label="Report Types Used" value={typesUsed} caption={`${reportTypes.length} available`} icon={Layers} tone="neutral" />
        <StatCard label="Last Generated" value={reports[0] ? fmtTs(reports[0].generatedAt) : '—'} caption={reports[0]?.name || 'none yet'} icon={Clock} tone="neutral" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <SectionCard
        title="Generate Report"
        subtitle="Computes a live snapshot across all portals and stores it"
        icon={Play}
      >
        <div className="flex items-center gap-3 flex-wrap p-4">
          <select className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white" value={genType} onChange={e => setGenType(e.target.value)}>
            {reportTypes.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
          <button className={button.primary} onClick={generate} disabled={busy === 'generate'}>
            {busy === 'generate' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Generate Now
          </button>
          <select className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white ml-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {reportTypes.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </div>
      </SectionCard>

      {viewing && (
        <SectionCard
          title={viewing.name}
          subtitle={`Generated ${fmtTs(viewing.payload.generatedAt)} · Period ${viewing.payload.periodDate}`}
          icon={Eye}
          actions={
            <>
              <button className={button.ghost} onClick={() => window.print()} title="Print">
                <Printer size={14} />
              </button>
              <button className={button.secondary} onClick={() => setViewing(null)}>Close</button>
            </>
          }
          pad="md"
        >
          <div className="space-y-5">
            {Object.entries(viewing.payload.sections).map(([key, section]) => (
              <div key={key}>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">{section.label}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {section.metrics.map(m => renderMetric(key, m))}
                </div>
                {section.highlights.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {section.highlights.map((h, i) => (
                      <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />{h}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Report Archive" subtitle={`${filtered.length} of ${reports.length} reports`} icon={FileBarChart}>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading reports…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No reports yet — generate one above.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {filtered.map(report => (
              <div key={report.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <FileBarChart size={18} className="text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">{report.name}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{reportTypes.find(t => t.key === report.type)?.name || report.type}</span>
                      <span>·</span>
                      <span>{fmtTs(report.generatedAt)}</span>
                      <span>·</span>
                      <span>{report.generatedBy || 'system'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge tone={statusTone(report.status)}>{report.status}</Badge>
                  <button className={button.ghost} onClick={() => view(report.id)} disabled={busy === `view-${report.id}`} title="View">
                    {busy === `view-${report.id}` ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  </button>
                  <button className={button.ghost} onClick={() => remove(report.id)} disabled={busy === `del-${report.id}`} title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default DailyFlashReports;
