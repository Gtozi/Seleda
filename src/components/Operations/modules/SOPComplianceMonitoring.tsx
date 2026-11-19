/**
 * SOP & Compliance Monitoring — Operations Portal (/erp/operations/sop-compliance).
 *
 * Live compliance board aggregated from every portal's own register:
 * sec_compliance_items (Security), eng_compliance_items (Engineering),
 * risk_compliance (Risk), fb_service_standards (F&B), fin_compliance_issues
 * (Finance), plus a unified audit feed from sec_compliance_audits and
 * fb_compliance_audits. Status changes write back to the source table
 * (mapped to its own vocabulary); Record Audit writes sec_compliance_audits.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  RefreshCw,
  Loader2,
  ShieldAlert,
  FileCheck2,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchSopCompliance,
  setComplianceStatus,
  recordComplianceAudit,
  type SopComplianceItem,
  type SopStatus,
} from '../../../services/operationsService';

const DEPT_OPTIONS = ['all', 'Security', 'Engineering', 'Risk & Compliance', 'F&B', 'Finance'] as const;

const statusTone = (s: SopStatus): 'success' | 'danger' | 'warning' =>
  ({ compliant: 'success', 'non-compliant': 'danger', 'pending-audit': 'warning' }[s]);

const statusLabel = (s: SopStatus) =>
  ({ compliant: 'Compliant', 'non-compliant': 'Non-Compliant', 'pending-audit': 'Pending Audit' }[s]);

const sourceTone = (s: string): 'info' | 'warning' | 'danger' | 'success' | 'neutral' =>
  ({ security: 'danger', engineering: 'warning', risk: 'info', 'f&b': 'success', finance: 'neutral' }[s] as any || 'neutral');

const WRITABLE = new Set(['security', 'engineering', 'risk']);

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const scoreColor = (score: number) =>
  score >= 90 ? 'text-emerald-600 dark:text-emerald-400' : score >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';

const barColor = (score: number) =>
  score >= 90 ? 'bg-emerald-500' : score >= 75 ? 'bg-amber-500' : 'bg-rose-500';

const SOPComplianceMonitoring: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [items, setItems] = useState<SopComplianceItem[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, compliant: 0, nonCompliant: 0, pendingAudit: 0, score: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | SopStatus>('all');
  const [showAuditForm, setShowAuditForm] = useState(false);
  const [auditForm, setAuditForm] = useState({ title: '', scope: '', result: 'Pass', findings: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await fetchSopCompliance(currentPropertyId);
      setItems(d.items);
      setAudits(d.audits);
      setStats(d.stats);
    } catch (e: any) {
      setError(e?.message || 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const filtered = useMemo(() => items.filter((i) => {
    if (deptFilter !== 'all' && i.department !== deptFilter) return false;
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    return true;
  }), [items, deptFilter, statusFilter]);

  const act = async (key: string, fn: () => Promise<any>, note?: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      if (note) addNotification(note, 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Action failed', 'error', 'Executive');
    } finally {
      setBusy(null);
    }
  };

  const submitAudit = () => {
    if (!auditForm.title.trim()) return;
    act('audit', async () => {
      await recordComplianceAudit({
        propertyId: currentPropertyId,
        title: auditForm.title.trim(),
        scope: auditForm.scope || undefined,
        result: auditForm.result,
        findings: auditForm.findings || undefined,
      });
      setAuditForm({ title: '', scope: '', result: 'Pass', findings: '' });
      setShowAuditForm(false);
    }, 'Audit recorded — visible in the Security portal.');
  };

  const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={ListChecks}
        title="SOP & Compliance Monitoring"
        subtitle="Live compliance registers from Security, Engineering, Risk, F&B and Finance — plus the audit trail"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.primary} onClick={() => setShowAuditForm(!showAuditForm)}>
              <ClipboardCheck size={16} /> Record Audit
            </button>
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Overall Compliance" icon={FileCheck2} tone="accent" value={`${stats.score}%`} caption={`${stats.total} tracked items`} />
        <StatCard title="Compliant" icon={CheckCircle2} tone="success" value={stats.compliant} />
        <StatCard title="Non-Compliant" icon={AlertTriangle} tone="danger" value={stats.nonCompliant} />
        <StatCard title="Pending Audit" icon={ClipboardCheck} tone="warning" value={stats.pendingAudit} />
      </div>

      {/* Record audit form */}
      {showAuditForm && (
        <SectionCard title="Record Audit Result" subtitle="Writes a sec_compliance_audits row — visible in the Security portal" icon={ClipboardCheck} pad="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <input className={inputCls} placeholder="Audit title *" value={auditForm.title} onChange={(e) => setAuditForm({ ...auditForm, title: e.target.value })} />
              <input className={inputCls} placeholder="Scope (e.g. Fire Safety)" value={auditForm.scope} onChange={(e) => setAuditForm({ ...auditForm, scope: e.target.value })} />
              <select className={inputCls} value={auditForm.result} onChange={(e) => setAuditForm({ ...auditForm, result: e.target.value })}>
                <option value="Pass">Pass</option>
                <option value="Fail">Fail</option>
                <option value="Conditional">Conditional</option>
              </select>
            </div>
            <input className={inputCls} placeholder="Findings" value={auditForm.findings} onChange={(e) => setAuditForm({ ...auditForm, findings: e.target.value })} />
            <div className="flex gap-2">
              <button className={button.primary} onClick={submitAudit} disabled={busy === 'audit' || !auditForm.title.trim()}>
                {busy === 'audit' ? 'Recording…' : 'Record Audit'}
              </button>
              <button className={button.secondary} onClick={() => setShowAuditForm(false)}>Cancel</button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Compliance board */}
      <SectionCard
        title="Compliance Register"
        subtitle={`${filtered.length} items`}
        icon={ListChecks}
        pad="md"
        actions={
          <div className="flex items-center gap-2">
            <select className={inputCls} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              {DEPT_OPTIONS.map((d) => <option key={d} value={d}>{d === 'all' ? 'All Departments' : d}</option>)}
            </select>
            <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              <option value="compliant">Compliant</option>
              <option value="non-compliant">Non-Compliant</option>
              <option value="pending-audit">Pending Audit</option>
            </select>
          </div>
        }
      >
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={20} className="animate-spin" /> Loading compliance register…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No compliance items match the current filters.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((item) => (
              <div key={`${item.source}-${item.id}`} className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-mono uppercase text-slate-500 font-bold">{item.category.replace(/-/g, ' ')}</span>
                    <h4 className="font-semibold text-slate-900 dark:text-white mt-0.5 truncate">{item.name}</h4>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge tone={sourceTone(item.source)}>{item.department}</Badge>
                    </div>
                  </div>
                  <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                </div>

                {item.score != null && (
                  <div className="mt-3">
                    <span className={`text-2xl font-bold ${scoreColor(item.score)}`}>{item.score}%</span>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-1.5">
                      <div className={`h-1.5 rounded-full ${barColor(item.score)}`} style={{ width: `${item.score}%` }} />
                    </div>
                  </div>
                )}

                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-slate-500">Last audit</span><span className="text-slate-900 dark:text-white">{fmtDate(item.lastAudit)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Next / expiry</span><span className="text-slate-900 dark:text-white">{fmtDate(item.nextAudit)}</span></div>
                </div>

                {item.findings.length > 0 && (
                  <ul className="mt-3 text-xs text-slate-600 dark:text-slate-400 list-disc list-inside space-y-0.5">
                    {item.findings.slice(0, 3).map((f, i) => <li key={i} className="truncate">{f}</li>)}
                  </ul>
                )}

                {WRITABLE.has(item.source) && (
                  <div className="flex gap-1.5 mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                    {(['compliant', 'non-compliant', 'pending-audit'] as SopStatus[]).filter((s) => s !== item.status).map((s) => (
                      <button key={s}
                        disabled={busy === `${item.source}-${item.id}`}
                        onClick={() => act(`${item.source}-${item.id}`, () => setComplianceStatus(item.source, item.id, s), `${item.name} → ${statusLabel(s)}`)}
                        className="px-2 py-1 rounded-md text-xs font-medium border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Audit feed */}
      <SectionCard title="Recent Audit Activity" subtitle={`${audits.length} audits across Security and F&B`} icon={ShieldAlert} pad="md">
        {audits.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No audit records yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {audits.slice(0, 15).map((a) => (
              <div key={`${a.source}-${a.id}`} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-slate-900 dark:text-white">{a.title}</span>
                    <Badge tone={sourceTone(a.source)}>{a.source === 'f&b' ? 'F&B' : 'Security'}</Badge>
                    {a.result && <Badge tone={a.result === 'Pass' ? 'success' : 'danger'}>{a.result}</Badge>}
                    {a.score != null && <Badge tone="info">{a.score}%</Badge>}
                    {a.status && <Badge tone="neutral">{a.status}</Badge>}
                  </div>
                  {a.findings && <p className="text-xs text-slate-500 mt-0.5 truncate">{a.findings}</p>}
                </div>
                <div className="text-right shrink-0 text-xs text-slate-500">
                  <p>{a.auditor || '—'}</p>
                  <p>{fmtDate(a.at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default SOPComplianceMonitoring;
