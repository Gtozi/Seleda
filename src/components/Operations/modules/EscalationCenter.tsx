/**
 * Escalation Center — Operations Portal (/erp/operations/escalation).
 *
 * Two layers: a live auto-detection feed that scans the other portals
 * (Emergency work orders, Urgent/stale guest requests, Critical security
 * incidents, overdue HK tasks, stale recovery cases) and a persisted
 * ops_escalations lifecycle (open → acknowledged → in-progress → resolved).
 * Adopting a candidate creates a tracked escalation; dedup via source_ref.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  Clock,
  ArrowUp,
  Users,
  Wrench,
  AlertCircle,
  RefreshCw,
  Loader2,
  Plus,
  ArrowUpCircle,
  CheckCircle2,
  Trash2,
  Radar,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsEscalations,
  createEscalation,
  adoptEscalation,
  updateEscalation,
  deleteEscalation,
  type OpsEscalation,
  type EscalationType,
  type EscalationSeverity,
  type EscalationStatus,
} from '../../../services/operationsService';

const TYPE_META: Record<EscalationType, { label: string; icon: React.ElementType }> = {
  'sla-violation': { label: 'SLA Violation', icon: TrendingUp },
  'guest-complaint': { label: 'Guest Complaint', icon: Users },
  'delayed-task': { label: 'Delayed Task', icon: Clock },
  'equipment-failure': { label: 'Equipment Failure', icon: Wrench },
  'staff-shortage': { label: 'Staff Shortage', icon: Users },
  'high-risk-incident': { label: 'High-Risk Incident', icon: AlertCircle },
  other: { label: 'Other', icon: AlertTriangle },
};

const severityTone = (s: EscalationSeverity): 'danger' | 'warning' | 'info' | 'neutral' =>
  ({ critical: 'danger', major: 'warning', moderate: 'info', minor: 'neutral' }[s]);

const statusTone = (s: EscalationStatus): 'danger' | 'warning' | 'info' | 'success' =>
  ({ open: 'danger', acknowledged: 'warning', 'in-progress': 'info', resolved: 'success' }[s]);

const NEXT_STATUS: Partial<Record<EscalationStatus, { to: EscalationStatus; label: string }>> = {
  open: { to: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { to: 'in-progress', label: 'Start Work' },
  'in-progress': { to: 'resolved', label: 'Resolve' },
};

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const ageLabel = (ts?: string) => {
  if (!ts) return '';
  const h = (Date.now() - new Date(ts).getTime()) / 3_600_000;
  return h >= 24 ? `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h ago` : h >= 1 ? `${Math.floor(h)}h ago` : `${Math.max(1, Math.round(h * 60))}m ago`;
};

const EscalationCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [data, setData] = useState<{ escalations: OpsEscalation[]; candidates: any[]; stats: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | EscalationStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | EscalationType>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'other' as EscalationType, severity: 'moderate' as EscalationSeverity, description: '', escalatedTo: 'General Manager' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await fetchOpsEscalations(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load escalations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const escalations = data?.escalations || [];
  const candidates = data?.candidates || [];
  const stats = data?.stats || { open: 0, acknowledged: 0, inProgress: 0, resolved: 0, detected: 0, overdue: 0 };

  const filtered = useMemo(() => escalations.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    return true;
  }), [escalations, statusFilter, typeFilter]);

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

  const submitCreate = () => {
    if (!form.description.trim()) return;
    act('create', async () => {
      await createEscalation({ propertyId: currentPropertyId, ...form });
      setForm({ type: 'other', severity: 'moderate', description: '', escalatedTo: 'General Manager' });
      setShowForm(false);
    }, 'Escalation created.');
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={AlertTriangle}
        title="Escalation Center"
        subtitle="Auto-detected SLA breaches and critical issues from every portal — adopt, acknowledge, resolve"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.primary} onClick={() => setShowForm(!showForm)}>
              <Plus size={16} /> New Escalation
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
        <StatCard title="Open Escalations" icon={AlertTriangle} tone="danger" value={stats.open}
          caption={stats.overdue ? `${stats.overdue} overdue` : undefined} />
        <StatCard title="In Progress" icon={Clock} tone="info" value={stats.inProgress + stats.acknowledged} />
        <StatCard title="Auto-Detected" icon={Radar} tone="warning" value={stats.detected} caption="awaiting adoption" />
        <StatCard title="Resolved" icon={CheckCircle2} tone="success" value={stats.resolved} />
      </div>

      {/* New escalation form */}
      {showForm && (
        <SectionCard title="New Escalation" icon={Plus} pad="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EscalationType })}>
                {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as EscalationSeverity })}>
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
              <select className={inputCls} value={form.escalatedTo} onChange={(e) => setForm({ ...form, escalatedTo: e.target.value })}>
                {['General Manager', 'Hotel Manager', 'Operations Manager', 'Rooms Division Manager', 'Security Manager', 'Chief Engineer'].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <input className={inputCls} placeholder="Description *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="flex gap-2">
              <button className={button.primary} onClick={submitCreate} disabled={busy === 'create' || !form.description.trim()}>
                {busy === 'create' ? 'Creating…' : 'Create Escalation'}
              </button>
              <button className={button.secondary} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Auto-detected candidates */}
      {candidates.length > 0 && (
        <SectionCard title="Auto-Detected Escalations" subtitle="Live breaches detected across portals — adopt to track" icon={Radar} tone="warning" pad="md">
          <div className="flex flex-col gap-2">
            {candidates.map((c) => (
              <div key={c.sourceRef} className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10">
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={severityTone(c.severity)}>{c.severity}</Badge>
                    <Badge tone="neutral">{TYPE_META[c.type as EscalationType]?.label || c.type}</Badge>
                    <Badge tone="info">{c.source}</Badge>
                    <span className="text-xs text-slate-400">{ageLabel(c.detectedAt)}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{c.description}</p>
                </div>
                <button className={button.secondary} disabled={busy === `ad-${c.sourceRef}`}
                  onClick={() => act(`ad-${c.sourceRef}`, () => adoptEscalation({ ...c, propertyId: currentPropertyId }), 'Escalation adopted — tracking started.')}>
                  {busy === `ad-${c.sourceRef}` ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
                  Adopt
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Tracked escalations */}
      <SectionCard
        title="Tracked Escalations"
        subtitle={`${filtered.length} escalations`}
        icon={ArrowUp}
        pad="md"
        actions={
          <div className="flex items-center gap-2">
            <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="in-progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
            <select className={inputCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
              <option value="all">All types</option>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        }
      >
        {loading && escalations.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={20} className="animate-spin" /> Loading escalations…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No tracked escalations — adopt detected items above or create one manually.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((e) => {
              const Meta = TYPE_META[e.type] || TYPE_META.other;
              const overdue = e.due_by && e.status !== 'resolved' && new Date(e.due_by).getTime() < Date.now();
              const next = NEXT_STATUS[e.status];
              return (
                <div key={e.id} className={`p-4 rounded-lg border ${overdue ? 'border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/10' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 shrink-0">
                        <Meta.icon size={18} className="text-slate-600 dark:text-slate-300" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-slate-900 dark:text-white">{Meta.label}</span>
                          <Badge tone={severityTone(e.severity)}>{e.severity}</Badge>
                          <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                          {e.source && <Badge tone="neutral">{e.source}</Badge>}
                          {overdue && <Badge tone="danger">Overdue</Badge>}
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{e.description}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 flex-wrap">
                          <span>→ {e.escalated_to || 'Unassigned'}</span>
                          <span>Created {ageLabel(e.created_at)}</span>
                          {e.due_by && <span className={overdue ? 'text-rose-600 font-medium' : ''}>Due {new Date(e.due_by).toLocaleString()}</span>}
                          {e.resolved_at && <span>Resolved {new Date(e.resolved_at).toLocaleString()}</span>}
                        </div>
                        {e.resolution && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Resolution: {e.resolution}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {next && (
                        <button className={button.primary} disabled={busy === `st-${e.id}`}
                          onClick={() => act(`st-${e.id}`, async () => {
                            let resolution: string | undefined;
                            if (next.to === 'resolved') {
                              resolution = prompt('Resolution note (optional)') || undefined;
                            }
                            await updateEscalation(e.id, { status: next.to, resolution });
                          })}>
                          {busy === `st-${e.id}` ? <Loader2 size={14} className="animate-spin" /> : null}
                          {next.label}
                        </button>
                      )}
                      {e.status !== 'resolved' && (
                        <button className={button.ghost} title="Delete" disabled={busy === `del-${e.id}`}
                          onClick={() => act(`del-${e.id}`, () => deleteEscalation(e.id))}>
                          <Trash2 size={15} className="text-rose-500" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default EscalationCenter;
