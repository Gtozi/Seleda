/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Reports & Analytics — HR, Attendance, Payroll, Performance, and
 * Executive reports.
 *
 * DB-integrated via /api/hr-portal/analytics/* routes. Uses the hr_reports
 * table from migration 432.
 *
 * UI mimics the Housekeeping Reports module: period selector, KPIs,
 * search/refresh toolbar, and reports grouped by category with status,
 * format, last run, period, and action columns.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Users,
  TrendingUp,
  DollarSign,
  Calendar,
  Download,
  Search,
  FileText,
  Award,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout } from '../FrontOffice/brandTheme';

type ReportCategory = 'hr' | 'attendance' | 'payroll' | 'performance' | 'executive';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';
type ReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';

interface HRReport {
  id: string;
  report_type: ReportCategory;
  report_id: string;
  name: string;
  description: string | null;
  category: string | null;
  last_generated: string | null;
  generated_by: string | null;
  format: string | null;
  file_url: string | null;
  is_scheduled: boolean;
}

type HRReportWithStatus = HRReport & { status: ReportStatus };

type ReportFormat = 'PDF' | 'Excel' | 'CSV';

const CATEGORY_ORDER: ReportCategory[] = ['hr', 'attendance', 'payroll', 'performance', 'executive'];

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  hr: 'HR Reports',
  attendance: 'Attendance Reports',
  payroll: 'Payroll Reports',
  performance: 'Performance Reports',
  executive: 'Executive Reports',
};

const CATEGORY_ICONS: Record<ReportCategory, any> = {
  hr: Users, attendance: Clock, payroll: DollarSign, performance: Award, executive: TrendingUp,
};

const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

const ALL_FORMATS: ReportFormat[] = ['PDF', 'Excel', 'CSV'];

const STATUS_TONE: Record<ReportStatus, 'success' | 'info' | 'warning' | 'danger'> = {
  Ready: 'success', Scheduled: 'info', Generating: 'warning', Failed: 'danger',
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

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
    case 'Custom':
    default: return { from: customFrom, to: customTo };
  }
}

function defaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
}

function periodLabel(p: Period, from: string, to: string): string {
  return p === 'Custom' ? `${from} → ${to}` : `${p} (${from} → ${to})`;
}

function formatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resolveStatus(r: HRReport): ReportStatus {
  if (r.is_scheduled) return 'Scheduled';
  return 'Ready';
}

const ReportsAnalytics = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [period, setPeriod] = useState<Period>('Today');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toISODate(d);
  });
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()));

  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  const [allReports, setAllReports] = useState<HRReportWithStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    reportId: '', name: '', description: '', category: '', lastGenerated: '', generatedBy: '', format: 'PDF' as ReportFormat | '', fileUrl: '', isScheduled: false,
  });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr-portal/analytics/all/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as { reports: HRReport[] };
      setAllReports((data.reports || []).map((r) => ({ ...r, status: resolveStatus(r) })));
    } catch (e: any) {
      addNotification(e.message || 'Failed to load HR reports', 'warning', 'HR');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, addNotification]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const reports = useMemo(() => {
    return allReports
      .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()) || (r.description || '').toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.report_id.localeCompare(b.report_id));
  }, [allReports, search]);

  const reportsByCategory = useMemo(() => {
    const map: Record<ReportCategory, HRReportWithStatus[]> = { hr: [], attendance: [], payroll: [], performance: [], executive: [] };
    for (const r of reports) if (map[r.report_type]) map[r.report_type].push(r);
    return map;
  }, [reports]);

  const totalReports = allReports.length;
  const ready = allReports.filter((r) => r.status === 'Ready').length;
  const scheduled = allReports.filter((r) => r.status === 'Scheduled').length;
  const failed = allReports.filter((r) => r.status === 'Failed').length;

  const openCreate = () => {
    setEditingId(null);
    setForm({ reportId: '', name: '', description: '', category: '', lastGenerated: new Date().toISOString().slice(0, 10), generatedBy: '', format: 'PDF', fileUrl: '', isScheduled: false });
    setShowModal(true);
  };

  const openEdit = (r: HRReportWithStatus) => {
    setEditingId(r.id);
    setForm({
      reportId: r.report_id, name: r.name, description: r.description || '', category: r.category || '',
      lastGenerated: r.last_generated || '', generatedBy: r.generated_by || '',
      format: (r.format as any) || 'PDF', fileUrl: r.file_url || '', isScheduled: r.is_scheduled,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingId ? `/api/hr-portal/analytics/${editingId}` : '/api/hr-portal/analytics/';
      const method = editingId ? 'PUT' : 'POST';
      const body = {
        propertyId: currentPropertyId, reportType: (editingId ? undefined : (form.category?.toLowerCase() as ReportCategory)) || 'hr',
        reportId: form.reportId, name: form.name, description: form.description, category: form.category,
        lastGenerated: form.lastGenerated, generatedBy: form.generatedBy, format: form.format, fileUrl: form.fileUrl, isScheduled: form.isScheduled,
      };
      const res = await fetch(endpoint, { method, headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setShowModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this report?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/analytics/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDownload = async (r: HRReportWithStatus) => {
    setDownloadingId(r.id);
    try {
      if (r.file_url) {
        const a = document.createElement('a');
        a.href = r.file_url; a.target = '_blank'; a.download = `${r.report_id}.${(r.format || 'PDF').toLowerCase()}`; a.click();
        addNotification(`${r.report_id} · ${r.name} downloaded`, 'success', 'HR');
      } else {
        addNotification('No file URL attached to report', 'warning', 'HR');
      }
    } catch (e: any) { addNotification(e?.message || 'Download failed', 'danger', 'HR'); } finally { setDownloadingId(null); }
  };

  const CategoryIcon = (cat: ReportCategory) => {
    const Icon = CATEGORY_ICONS[cat] || FileText;
    return <Icon size={14} />;
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Reports & Analytics" subtitle="Generate and view HR reports and analytics dashboards" icon={BarChart3} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <BarChart3 className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view reports.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Reports & Analytics"
        subtitle={`HR, attendance, payroll, performance and executive reports · ${activeLabel}`}
        icon={BarChart3}
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {PERIODS.map((p) => (
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
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openCreate} className={button.primary}><Plus className="w-4 h-4" /> Custom Report</button>
            </div>
          </>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={String(totalReports)} icon={FileText} tone="accent" caption={activeLabel} />
        <StatCard title="Ready" value={String(ready)} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={String(scheduled)} icon={Clock} tone="info" />
        <StatCard title="Failed" value={String(failed)} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={fetchAll} disabled={loading} className={[button.ghost, 'flex items-center gap-2'].join(' ')} title="Refresh">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* Reports grouped by category */}
      {loading && allReports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileText} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" />
            Loading reports…
          </div>
        </SectionCard>
      ) : allReports.length === 0 ? (
        <SectionCard title="No Reports" icon={FileText} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports found.</div>
        </SectionCard>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const groupReports = reportsByCategory[cat];
          if (groupReports.length === 0) return null;
          return (
            <SectionCard key={cat} title={`${CATEGORY_LABELS[cat]} · ${activeLabel}`} icon={CATEGORY_ICONS[cat]} tone="accent">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Description</th>
                      <th className="px-6 py-3 font-medium">Last Run</th>
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {groupReports.map((r) => {
                      const isDownloading = downloadingId === r.id;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">HR</span>
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.report_id}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.description || '—'}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatLastRun(r.last_generated)}</td>
                          <td className="px-6 py-3"><Badge tone={(r.format || '').toLowerCase() === 'pdf' ? 'danger' : (r.format || '').toLowerCase().includes('excel') ? 'success' : 'info'}>{r.format || '—'}</Badge></td>
                          <td className="px-6 py-3"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            {period === 'Custom' ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{activeRange.from} → {activeRange.to}</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <Badge tone={period === 'Today' ? 'info' : period === 'WTD' ? 'warning' : period === 'MTD' ? 'success' : 'accent'}>{period}</Badge>
                                <span className="text-[10px] text-slate-400 font-mono">{activeRange.from} → {activeRange.to}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button onClick={() => openEdit(r)} className={button.ghost}><Pencil size={14} /> Edit</button>
                              <button onClick={() => handleDownload(r)} disabled={isDownloading} className={button.ghost}>
                                {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                {isDownloading ? 'Downloading' : 'Download'}
                              </button>
                              <button onClick={() => handleDelete(r.id)} className={button.ghost} title="Delete"><Trash2 size={14} className="text-rose-400" /></button>
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

      {/* Modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSave}
        title={editingId ? 'Edit Report' : 'Custom Report'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Report ID"><input className={inputCls} value={form.reportId} onChange={(e) => setForm(f => ({ ...f, reportId: e.target.value }))} /></Field></div>
          <div className="col-span-2"><Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></Field></div>
          <Field label="Category (for new report)">
            <select className={inputCls} value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select className={inputCls} value={form.format} onChange={(e) => setForm(f => ({ ...f, format: e.target.value as ReportFormat }))}>
              {ALL_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Generated By"><input className={inputCls} value={form.generatedBy} onChange={(e) => setForm(f => ({ ...f, generatedBy: e.target.value }))} /></Field>
          <Field label="Last Generated"><input type="date" className={inputCls} value={form.lastGenerated} onChange={(e) => setForm(f => ({ ...f, lastGenerated: e.target.value }))} /></Field>
          <Field label="Scheduled">
            <select className={inputCls} value={String(form.isScheduled)} onChange={(e) => setForm(f => ({ ...f, isScheduled: e.target.value === 'true' }))}>
              <option value="false">Ready</option>
              <option value="true">Scheduled</option>
            </select>
          </Field>
          <Field label="File URL"><input className={inputCls} value={form.fileUrl} onChange={(e) => setForm(f => ({ ...f, fileUrl: e.target.value }))} /></Field>
          <div className="col-span-2"><label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Description</label><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        </div>
      </ModalSystem>
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export default ReportsAnalytics;
