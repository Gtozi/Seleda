/**
 * Service Quality Management — Operations Portal (/erp/operations/service-quality).
 *
 * Pure live-data module — metrics are computed server-side from real portal
 * tables (guest feedback across FO/F&B/Events, room inspections, F&B quality
 * standards + compliance audits, guest request response times, engineering
 * inspections, security audits/safety inspections). The audit feed shows real
 * records from all those sources; "Run Audit" schedules a real Quality
 * Standards audit in sec_compliance_audits (Security portal).
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  FileText,
  Star,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ClipboardCheck,
  Plus,
  X,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchServiceQuality,
  scheduleQualityAudit,
  type QualityMetric,
  type QualityPeriod,
  type ServiceQualityOverview,
} from '../../../services/operationsService';

// ── Helpers ──────────────────────────────────────────────────────────────

const DEPARTMENTS = ['all', 'Guest Experience', 'Housekeeping', 'Food & Beverage', 'Front Office', 'Engineering', 'Security'] as const;

const trendIcon = (trend: string, lowerIsBetter?: boolean) => {
  if (trend === 'up') return <TrendingUp size={16} className="text-emerald-500" />;
  if (trend === 'down') return <TrendingDown size={16} className="text-rose-500" />;
  return <Minus size={16} className="text-slate-400" />;
};

const scoreTone = (m: QualityMetric): StatusTone => {
  if (m.currentScore == null) return 'neutral';
  const onTarget = m.lowerIsBetter ? m.currentScore <= m.targetScore : m.currentScore >= m.targetScore * 0.9;
  const close = m.lowerIsBetter ? m.currentScore <= m.targetScore * 1.5 : m.currentScore >= m.targetScore * 0.75;
  return onTarget ? 'success' : close ? 'warning' : 'danger';
};

const scoreText = (m: QualityMetric): string => {
  if (m.currentScore == null) return 'text-slate-400';
  const t = scoreTone(m);
  return t === 'success' ? 'text-emerald-600 dark:text-emerald-400'
    : t === 'warning' ? 'text-amber-600 dark:text-amber-400'
    : 'text-rose-600 dark:text-rose-400';
};

const barColor = (m: QualityMetric): string => {
  const t = scoreTone(m);
  return t === 'success' ? 'bg-emerald-500' : t === 'warning' ? 'bg-amber-500' : 'bg-rose-500';
};

const fmtScore = (m: QualityMetric) =>
  m.currentScore == null ? '—'
    : m.unit === 'rating' ? m.currentScore.toFixed(1)
    : m.unit === 'hours' ? `${m.currentScore.toFixed(1)}h`
    : `${Math.round(m.currentScore)}%`;

const fmtTarget = (m: QualityMetric) =>
  m.unit === 'rating' ? `/ ${m.targetScore}` : m.unit === 'hours' ? `≤ ${m.targetScore}h` : `/ ${m.targetScore}%`;

const pctOfTarget = (m: QualityMetric) => {
  if (m.currentScore == null) return 0;
  if (m.lowerIsBetter) return Math.min(100, (m.targetScore / Math.max(m.currentScore, 0.01)) * 100);
  const denom = m.unit === 'rating' ? 5 : m.targetScore;
  return Math.min(100, (m.currentScore / denom) * 100);
};

const auditScoreTone = (s: number | null): StatusTone =>
  s == null ? 'neutral' : s >= 90 ? 'success' : s >= 75 ? 'warning' : 'danger';

// ── Component ────────────────────────────────────────────────────────────

const ServiceQualityManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [period, setPeriod] = useState<QualityPeriod>('month');
  const [department, setDepartment] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [data, setData] = useState<ServiceQualityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuditForm, setShowAuditForm] = useState(false);
  const [auditForm, setAuditForm] = useState({ title: '', scope: 'Operations', date: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchServiceQuality(currentPropertyId, period));
    } catch (e: any) {
      setError(e?.message || 'Failed to load service quality');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, period]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => (data?.metrics || []).filter((m) =>
    department === 'all' || m.category === department), [data, department]);

  const audits = useMemo(() => (data?.audits || []).filter((a) => {
    if (department !== 'all' && a.department !== department &&
        !(department === 'Food & Beverage' && a.department === 'F&B')) return false;
    const q = auditSearch.toLowerCase();
    return q === '' || (a.title || '').toLowerCase().includes(q) ||
      (a.auditType || '').toLowerCase().includes(q) || (a.auditor || '').toLowerCase().includes(q);
  }), [data, department, auditSearch]);

  const runAudit = async () => {
    if (!auditForm.title.trim()) return;
    setSaving(true);
    try {
      await scheduleQualityAudit({
        propertyId: currentPropertyId,
        title: auditForm.title.trim(),
        scope: auditForm.scope,
        date: auditForm.date || undefined,
      });
      addNotification('Quality audit scheduled in the Security portal.', 'task', 'Executive');
      setShowAuditForm(false);
      setAuditForm({ title: '', scope: 'Operations', date: '' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to schedule audit');
    } finally {
      setSaving(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={Award}
        title="Service Quality Management"
        subtitle="Live quality metrics and audits aggregated across all departments"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as QualityPeriod)}
              className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
            </select>
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button className={button.primary} onClick={() => setShowAuditForm((v) => !v)}>
              <FileText size={16} /> Run Audit
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Metrics On Target" value={stats ? `${stats.metricsOnTarget}/${data!.metrics.length}` : '—'} icon={ClipboardCheck} tone="success" />
        <StatCard title="Avg Satisfaction" value={stats?.avgSatisfaction != null ? `${stats.avgSatisfaction}/5` : '—'} icon={Star} tone="accent" />
        <StatCard title="Feedback Samples" value={stats?.feedbackCount ?? '—'} icon={FileText} tone="info" caption={`last ${data?.days ?? 30} days`} />
        <StatCard title="Completed Audits" value={stats?.auditsCompleted ?? '—'} icon={Award} tone="warning" />
      </div>

      {/* Run Audit form */}
      {showAuditForm && (
        <SectionCard title="Schedule Quality Audit" icon={FileText} pad="md">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Audit title *" value={auditForm.title} onChange={(e) => setAuditForm((f) => ({ ...f, title: e.target.value }))} />
            <select className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" value={auditForm.scope} onChange={(e) => setAuditForm((f) => ({ ...f, scope: e.target.value }))}>
              {['Operations', 'Front Office', 'Housekeeping', 'Food & Beverage', 'Engineering', 'Security'].map((d) => <option key={d}>{d}</option>)}
            </select>
            <input type="date" className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" value={auditForm.date} onChange={(e) => setAuditForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button className={button.ghost} onClick={() => setShowAuditForm(false)}>Cancel</button>
            <button className={button.primary} onClick={runAudit} disabled={saving || !auditForm.title.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Schedule
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">Creates a real entry in sec_compliance_audits — visible in the Security portal.</p>
        </SectionCard>
      )}

      {/* Department filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {DEPARTMENTS.map((d) => (
          <button
            key={d}
            onClick={() => setDepartment(d)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              department === d
                ? 'bg-[var(--color-accent-operations)] text-white'
                : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {d === 'all' ? 'All Departments' : d}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
          <Loader2 size={20} className="animate-spin" /> Computing quality metrics…
        </div>
      ) : (
        <>
          {/* Metrics grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {metrics.map((m) => (
              <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-gray-200 dark:border-slate-700">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge tone="neutral" className="uppercase">{m.category}</Badge>
                    <h4 className="font-semibold text-slate-900 dark:text-white mt-2">{m.name}</h4>
                  </div>
                  {trendIcon(m.trend, m.lowerIsBetter)}
                </div>
                <div className="mt-3">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${scoreText(m)}`}>{fmtScore(m)}</span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">{fmtTarget(m)}</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mt-2">
                    <div className={`h-2 rounded-full transition-all ${barColor(m)}`} style={{ width: `${pctOfTarget(m)}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {m.currentScore == null ? 'No data in period' : `${m.sampleSize} sample${m.sampleSize === 1 ? '' : 's'} · ${data!.days}-day window`}
                  </p>
                </div>
              </div>
            ))}
            {metrics.length === 0 && (
              <div className="col-span-full text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                <Award size={48} className="text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">No metrics for this department</p>
              </div>
            )}
          </div>

          {/* Audit feed */}
          <SectionCard
            title="Audit & Inspection Results"
            subtitle="Real records from F&B compliance, security audits, safety inspections, engineering and room inspections"
            icon={ClipboardCheck}
            actions={
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search audits…"
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm outline-none w-48"
                />
              </div>
            }
            pad="none"
          >
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {audits.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-8">No audits match your filters</p>
              )}
              {audits.slice(0, 25).map((audit) => (
                <div key={audit.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-white">{audit.title || audit.auditType}</span>
                        <Badge tone="neutral">{audit.department}</Badge>
                        <Badge tone="info">{audit.auditType}</Badge>
                        {audit.location && <Badge tone="neutral">{audit.location}</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {audit.auditor ? `${audit.auditor} · ` : ''}{audit.date ? new Date(audit.date).toLocaleDateString() : ''}
                        {audit.status ? ` · ${audit.status}` : ''}
                      </p>
                    </div>
                    <span className={`text-2xl font-bold shrink-0 ${
                      audit.score == null ? 'text-slate-400'
                        : audit.score >= 90 ? 'text-emerald-600 dark:text-emerald-400'
                        : audit.score >= 75 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {audit.score == null ? '—' : `${audit.score}%`}
                    </span>
                  </div>
                  {audit.findings.length > 0 && (
                    <ul className="text-sm text-slate-600 dark:text-slate-400 list-disc list-inside mt-2">
                      {audit.findings.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default ServiceQualityManagement;
