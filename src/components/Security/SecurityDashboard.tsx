/**
 * Security Executive Dashboard — /erp/security/dashboard.
 *
 * DB-integrated via GET /api/sec-portal/dashboard/overview (migration 623):
 * the server aggregates KPIs + chart series live from the sec_* tables and
 * runs a Smart Alert Engine (mirroring hk_dashboard_alerts) that upserts
 * alerts into sec_dashboard_alerts, auto-resolving cleared triggers.
 * Acknowledge / Snooze actions persist back via POST /dashboard/alerts/:id.
 *
 * UI follows the HK/F&B portal pattern: PageHeader, StatCard KPIs,
 * SectionCard chart containers, Badge, brandTheme, recharts visualizations,
 * ERP notifications. Multi-property scoping via useERP().currentPropertyId.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldAlert, AlertTriangle, ClipboardList, Users, Camera, Key,
  MapPin, Flame, Bell, Eye, Lock, UserCheck, RefreshCw, Loader2,
  ServerCrash, CheckCheck, TimerOff, Package, Activity,
  type LucideIcon,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, PieChart, Pie, Legend,
} from 'recharts';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecDashboardOverview,
  acknowledgeSecAlert,
  snoozeSecAlert,
  type SecDashboardOverview,
  type SecDashboardAlert,
  type SecAlertPriority,
} from '../../services/securityService';

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#14b8a6', '#ec4899'];

const PRIORITY_TONE: Record<SecAlertPriority, StatusTone> = {
  Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral',
};

const PRIORITY_DOT: Record<SecAlertPriority, string> = {
  Critical: 'bg-rose-500', High: 'bg-amber-500', Medium: 'bg-blue-500', Low: 'bg-slate-400',
};

const ALERT_ICON: Record<string, LucideIcon> = {
  'Active Alarm': Bell,
  'Critical Incident': AlertTriangle,
  'Emergency Active': ShieldAlert,
  'Fire Equipment Overdue': Flame,
  'Fire Equipment Down': Flame,
  'CCTV Offline': Camera,
  'Risk Review Overdue': ClipboardList,
  'Training Expired': UserCheck,
  'Access Violation': Lock,
  'Key Lost': Key,
  'Blacklisted Visitor': Eye,
  'Patrol Missed': MapPin,
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function riskTone(level: string): StatusTone {
  if (level === 'Critical') return 'danger';
  if (level === 'High') return 'warning';
  if (level === 'Medium') return 'info';
  if (level === 'Low') return 'success';
  return 'neutral';
}

const SecurityDashboard: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [data, setData] = useState<SecDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSecDashboardOverview(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load security dashboard');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const acknowledge = async (a: SecDashboardAlert) => {
    setActingOn(a.id);
    try {
      const updated = await acknowledgeSecAlert(a.id);
      setData(prev => prev ? { ...prev, alerts: prev.alerts.map(x => (x.id === a.id ? updated : x)) } : prev);
      addNotification(`Alert acknowledged: ${a.type}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Acknowledge failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const snooze = async (a: SecDashboardAlert) => {
    setActingOn(a.id);
    try {
      const updated = await snoozeSecAlert(a.id, 4);
      setData(prev => prev ? { ...prev, alerts: prev.alerts.map(x => (x.id === a.id ? updated : x)) } : prev);
      addNotification(`Alert snoozed for 4h: ${a.type}`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Snooze failed', 'warning', 'Security');
    } finally {
      setActingOn(null);
    }
  };

  const k = data?.kpis;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Security Executive Dashboard"
        subtitle="Real-time security operations overview"
        icon={ShieldAlert}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading && !data ? (
        <div className="py-16 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading security overview…
        </div>
      ) : k ? (
        <>
          {/* KPI Stats */}
          <div className={layout.kpiGrid}>
            <StatCard title="Active Incidents" value={k.activeIncidents} icon={AlertTriangle} tone={k.activeIncidents > 0 ? 'danger' : 'success'} caption={`${k.criticalIncidents} critical / high`} />
            <StatCard title="Open Investigations" value={k.openInvestigations} icon={ClipboardList} tone={k.highPriorityInvestigations > 0 ? 'warning' : 'neutral'} caption={`${k.highPriorityInvestigations} high priority`} />
            <StatCard title="Patrol Completion" value={`${k.patrolCompletion}%`} icon={MapPin} tone={k.patrolCompletion >= 90 ? 'success' : k.patrolCompletion >= 70 ? 'warning' : 'danger'} caption={`${k.patrolsToday} scheduled today`} />
            <StatCard title="Security Alerts" value={k.activeAlarms} icon={Bell} tone={k.activeAlarms > 0 ? 'danger' : 'success'} caption={`${k.unacknowledgedAlarms} unacknowledged`} />
            <StatCard title="Access Violations" value={k.accessViolations} icon={Lock} tone={k.accessViolations > 0 ? 'warning' : 'success'} caption="Last 24h" />
            <StatCard title="Visitors On Property" value={k.visitorsOnProperty} icon={Users} tone="info" caption="Checked in now" />
            <StatCard title="Lost & Found Open" value={k.lostFoundOpen} icon={Package} tone="accent" caption={`${k.lostFoundPendingClaims} claim(s) pending`} />
            <StatCard title="Fire Safety" value={k.fireIssues === 0 && k.fireOverdue === 0 ? 'Normal' : `${k.fireIssues + k.fireOverdue} issue(s)`} icon={Flame} tone={k.fireIssues + k.fireOverdue === 0 ? 'success' : 'danger'} caption={k.fireOverdue > 0 ? `${k.fireOverdue} inspection(s) overdue` : 'All systems OK'} />
            <StatCard title="CCTV Online" value={`${k.cctvOnlinePct}%`} icon={Camera} tone={k.cctvOnlinePct >= 95 ? 'success' : 'warning'} caption={`${k.cctvTotal} cameras`} />
            <StatCard title="Top Risk Level" value={k.topRiskLevel} icon={ShieldAlert} tone={riskTone(k.topRiskLevel)} caption={`${k.highCriticalRisks} high/critical open`} />
            <StatCard title="Staff on Duty" value={k.staffOnDuty} icon={UserCheck} tone="accent" caption={`of ${k.staffTotal} rostered`} />
            <StatCard title="Keys / Cards Issued" value={k.keysIssued} icon={Key} tone="info" caption="Currently issued" />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Incidents by Category" icon={AlertTriangle} tone="accent" pad="md">
              {data!.incidentCategories.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">No incidents on record.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={data!.incidentCategories}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      dataKey="value"
                    >
                      {data!.incidentCategories.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Incident Trend (7 Days)" icon={Activity} tone="accent" pad="md">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data!.incidentTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="incidents" stroke="#ef4444" strokeWidth={2} name="Reported" />
                  <Line type="monotone" dataKey="resolved" stroke="#22c55e" strokeWidth={2} name="Resolved" />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          {/* Risk by Category & Patrol Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Avg Risk Score by Category" subtitle="Open risks · score = likelihood × impact" icon={ShieldAlert} tone="accent" pad="md">
              {data!.riskByCategory.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">No open risks.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data!.riskByCategory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 25]} />
                    <Tooltip />
                    <Bar dataKey="risk" fill="#f59e0b" name="Avg Score" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Patrol Activity" subtitle="Completed patrols per officer · last 7 days" icon={MapPin} tone="accent" pad="md">
              {data!.patrolActivity.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">No patrols recorded this week.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data!.patrolActivity}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="patrols" fill="#3b82f6" name="Patrols Completed" />
                    <Bar yAxisId="right" dataKey="completion" fill="#22c55e" name="Completion %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          {/* Smart Alert Feed */}
          <SectionCard
            title="Smart Security Alerts"
            subtitle={`${data!.alerts.length} active — generated live from operations data`}
            icon={Bell}
            tone="accent"
            pad="none"
          >
            {data!.alerts.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
                <CheckCheck size={16} className="text-emerald-500" /> All clear — no active alerts.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {data!.alerts.map(a => {
                  const Icon = ALERT_ICON[a.type] || Bell;
                  return (
                    <div key={a.id} className={`flex items-start gap-3 px-6 py-3.5 ${a.status === 'Snoozed' ? 'opacity-60' : ''}`}>
                      <div className={`p-2 rounded-lg ${PRIORITY_DOT[a.priority]} mt-0.5 shrink-0`}>
                        <Icon className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm text-slate-900 dark:text-white">{a.type}</p>
                          <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>
                          {a.status !== 'Active' && <Badge tone="neutral">{a.status}</Badge>}
                          {a.ref_id && <span className="text-[10px] font-mono text-slate-400">{a.ref_id}</span>}
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{a.message}</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {timeAgo(a.created_at)}{a.location ? ` · ${a.location}` : ''}
                          {a.status === 'Snoozed' && a.snoozed_until ? ` · snoozed until ${new Date(a.snoozed_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {a.status === 'Active' && (
                          <button
                            onClick={() => acknowledge(a)}
                            disabled={actingOn === a.id}
                            className="p-1.5 text-slate-400 hover:text-emerald-500 rounded-lg transition disabled:opacity-50"
                            title="Acknowledge"
                          >
                            {actingOn === a.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                          </button>
                        )}
                        {a.status === 'Active' && (
                          <button
                            onClick={() => snooze(a)}
                            disabled={actingOn === a.id}
                            className="p-1.5 text-slate-400 hover:text-amber-500 rounded-lg transition disabled:opacity-50"
                            title="Snooze 4h"
                          >
                            <TimerOff size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
};

export default SecurityDashboard;
