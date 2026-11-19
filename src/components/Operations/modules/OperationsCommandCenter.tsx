/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Operations Command Center — Operations Portal
 * (/erp/operations/command-center).
 *
 * Live operational overview across every department portal in the system.
 *
 * DB-integrated: fetches /api/ops-portal/command-center, which computes
 * department statuses and generates alerts from the real tables of the
 * other portals (housekeeping tasks, engineering work orders, security
 * incidents, transport, spa, F&B orders, laundry, events, guest requests,
 * inventory). Alerts persist in ops_command_alerts (migration 627) and
 * acknowledge writes back to the DB.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme tokens) — same as the HK / Engineering /
 * F&B modules. Department cards click through to that department's portal.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Command,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Users,
  BedDouble,
  Utensils,
  ChefHat,
  Shirt,
  Flower2,
  Wrench,
  Shield,
  Car,
  CalendarDays,
  ConciergeBell,
  Package,
  RefreshCw,
  Bell,
  Search,
  Play,
  Pause,
  Radio,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import { DEPARTMENT_BY_KEY, type DepartmentKey } from '../../../config/departments';
import {
  fetchCommandCenterOverview,
  acknowledgeCommandCenterAlert,
  type CommandCenterAlert,
  type CommandCenterDepartment,
  type CommandCenterDeptStatus,
  type CommandCenterOverview,
  type CommandCenterSeverity,
} from '../../../services/operationsService';

// ── Static registries ────────────────────────────────────────────────────

const DEPT_ICON: Record<string, LucideIcon> = {
  frontoffice: Users,
  housekeeping: BedDouble,
  engineering: Wrench,
  fnb: Utensils,
  kitchen: ChefHat,
  laundry: Shirt,
  spa: Flower2,
  security: Shield,
  transportation: Car,
  events: CalendarDays,
  concierge: ConciergeBell,
  inventory: Package,
};

const STATUS_TONE: Record<CommandCenterDeptStatus, StatusTone> = {
  operational: 'success',
  degraded: 'warning',
  critical: 'danger',
  offline: 'neutral',
};

const SEVERITY_TONE: Record<CommandCenterSeverity, StatusTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

const SEVERITY_ICON: Record<CommandCenterSeverity, LucideIcon> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Bell,
};

const STATUS_LABEL: Record<CommandCenterDeptStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  critical: 'Critical',
  offline: 'Offline',
};

const POLL_MS = 30_000;

// ── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Component ────────────────────────────────────────────────────────────

const OperationsCommandCenter: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const navigate = useNavigate();

  const [overview, setOverview] = useState<CommandCenterOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState<'all' | CommandCenterSeverity>('all');
  const [search, setSearch] = useState('');

  // ── Load ──────────────────────────────────────────────────────────────
  // silent=true keeps the current data on screen during background polls.
  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchCommandCenterOverview(currentPropertyId || undefined);
      setOverview(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load command center');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // Live mode polls the aggregated endpoint; pausing stops the interval.
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [isLive, load]);

  // ── Derived ───────────────────────────────────────────────────────────
  const departments = useMemo(() => overview?.departments || [], [overview]);
  const alerts = useMemo(() => overview?.alerts || [], [overview]);

  const filteredAlerts = useMemo(
    () =>
      alerts.filter(a => {
        const matchesSeverity = severityFilter === 'all' || a.type === severityFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          a.message.toLowerCase().includes(q) ||
          a.department.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q);
        return matchesSeverity && matchesSearch;
      }),
    [alerts, severityFilter, search]
  );

  const stats = useMemo(() => {
    const critical = alerts.filter(a => a.type === 'critical' && !a.acknowledged).length;
    const degraded = departments.filter(d => d.status === 'degraded' || d.status === 'critical').length;
    const issues = departments.reduce((sum, d) => sum + d.activeIssues, 0);
    const reporting = departments.length;
    return { critical, degraded, issues, reporting };
  }, [alerts, departments]);

  // ── Actions ───────────────────────────────────────────────────────────
  const acknowledge = async (alertId: string) => {
    const previous = alerts;
    setAcknowledging(alertId);
    // Optimistic update — the row dims immediately.
    setOverview(prev =>
      prev
        ? {
            ...prev,
            alerts: prev.alerts.map(a => (a.id === alertId ? { ...a, acknowledged: true } : a)),
          }
        : prev);
    try {
      await acknowledgeCommandCenterAlert(alertId);
      addNotification('Alert acknowledged.', 'task', 'Executive');
    } catch (e: any) {
      setOverview(prev => (prev ? { ...prev, alerts: previous } : prev));
      addNotification(e?.message || 'Failed to acknowledge alert', 'warning', 'Executive');
    } finally {
      setAcknowledging(null);
    }
  };

  const openDepartment = (card: CommandCenterDepartment) => {
    const dept = DEPARTMENT_BY_KEY[card.deptKey as DepartmentKey];
    if (dept) navigate(`/erp/${dept.urlSegment}/${dept.defaultTab}`);
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-[var(--color-accent-operations)]" />
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Operations Command Center"
        subtitle="Live operational overview across all departments"
        icon={Command}
        actions={
          <>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isLive ? statusTone.success.dot + ' animate-pulse' : 'bg-gray-400'}`} />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isLive ? 'Live' : 'Paused'}
              </span>
            </div>
            <button
              onClick={() => setIsLive(v => !v)}
              className={button.secondary}
              title={isLive ? 'Pause live updates' : 'Resume live updates'}
            >
              {isLive ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className={button.secondary}
              title="Refresh now"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            {overview && (
              <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
                Updated {timeAgo(overview.generatedAt)}
              </span>
            )}
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <AlertTriangle size={18} className="text-[var(--color-warning)] shrink-0" />
          <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{error}</p>
          <button onClick={() => load()} className={button.secondary}>Retry</button>
        </div>
      )}

      {/* KPI row */}
      <div className={layout.kpiGrid}>
        <StatCard title="Critical Alerts" value={stats.critical} icon={XCircle} tone="danger" caption="unacknowledged" />
        <StatCard title="Degraded Departments" value={stats.degraded} icon={AlertTriangle} tone="warning" caption="degraded or critical" />
        <StatCard title="Open Issues" value={stats.issues} icon={Activity} tone="info" caption="across all departments" />
        <StatCard title="Departments Reporting" value={stats.reporting} icon={Radio} tone="accent" caption="live feeds" />
      </div>

      {/* Department status grid */}
      <SectionCard
        title="Live Department Status"
        subtitle="Click a department to open its portal"
        icon={Radio}
        tone="info"
        pad="md"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {departments.map(dept => {
            const Icon = DEPT_ICON[dept.key] || Activity;
            const tone = STATUS_TONE[dept.status];
            const toneStyles = statusTone[tone];
            return (
              <button
                key={dept.key}
                onClick={() => openDepartment(dept)}
                className="text-left p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[var(--color-accent-operations)] hover:shadow-sm smooth-transition group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 p-1.5 rounded-lg ${toneStyles.soft}`}>
                      <Icon size={15} />
                    </span>
                    <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {dept.name}
                    </span>
                  </div>
                  <Badge tone={tone} icon={dept.status === 'operational' ? CheckCircle2 : dept.status === 'degraded' ? AlertTriangle : XCircle}>
                    {STATUS_LABEL[dept.status]}
                  </Badge>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 font-medium">
                  {dept.statusText}
                </p>
                <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-gray-500">
                  <span>{dept.lastUpdate ? `Updated ${timeAgo(dept.lastUpdate)}` : '—'}</span>
                  <span className="inline-flex items-center gap-1 text-gray-400 group-hover:text-[var(--color-accent-operations)] smooth-transition">
                    Open <ChevronRight size={12} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Live alerts feed */}
      <SectionCard
        title="Live Alerts"
        subtitle="Generated from live data across every portal — acknowledge to clear"
        icon={Bell}
        tone="danger"
        pad="none"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search alerts..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm w-44 sm:w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-[var(--color-accent-operations)] outline-none text-gray-900 dark:text-white"
              />
            </div>
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value as 'all' | CommandCenterSeverity)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-[var(--color-accent-operations)] outline-none text-gray-900 dark:text-white"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>
        }
        bodyClassName="divide-y divide-gray-100 dark:divide-slate-700/60"
      >
        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-500 dark:text-gray-400">
            <CheckCircle2 size={24} className="mb-2 text-[var(--color-success)]" />
            <p className="text-sm">No alerts match your filters</p>
          </div>
        ) : (
          filteredAlerts.map(alert => {
            const SevIcon = SEVERITY_ICON[alert.type];
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-4 px-6 py-4 border-l-4 ${statusTone[SEVERITY_TONE[alert.type]].border} ${alert.acknowledged ? 'opacity-55' : ''}`}
              >
                <span className={`shrink-0 mt-0.5 p-2 rounded-lg ${statusTone[SEVERITY_TONE[alert.type]].soft}`}>
                  <SevIcon size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {alert.category}
                    </span>
                    <Badge tone={SEVERITY_TONE[alert.type]}>{alert.type}</Badge>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {timeAgo(alert.timestamp)}
                    </span>
                  </div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white mt-1">
                    {alert.message}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {alert.department}
                    {alert.acknowledged && alert.acknowledgedBy ? ` — acknowledged by ${alert.acknowledgedBy}` : ''}
                  </p>
                </div>
                {!alert.acknowledged && (
                  <button
                    onClick={() => acknowledge(alert.id)}
                    disabled={acknowledging === alert.id}
                    className={button.secondary + ' shrink-0 !px-3 !py-1.5 text-xs'}
                  >
                    {acknowledging === alert.id ? <Loader2 size={14} className="animate-spin" /> : 'Acknowledge'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
};

export default OperationsCommandCenter;
