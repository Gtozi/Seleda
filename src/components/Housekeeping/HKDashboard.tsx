/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Housekeeping Dashboard — docs/Housekeeping Portal new.md §4.
 * DB-integrated: fetches KPIs, alerts, and productivity from
 * /api/hk-portal/dashboard/* routes. Alerts can be acknowledged
 * and snoozed, persisted back to the hk_dashboard_alerts table.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCheck,
  Clock,
  Sparkles,
  Activity,
  User,
  Layers,
  Wrench,
  AlertTriangle,
  Info,
  Bell,
  Crown,
  Sun,
  ClipboardCheck,
  Droplets,
  Wine,
  Brush,
  Hammer,
  RefreshCw,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type AlertPriority = 'Critical' | 'High' | 'Medium' | 'Low';
type AlertStatus = 'Active' | 'Acknowledged' | 'Snoozed' | 'Resolved';

interface DashboardAlert {
  id: string;
  type: string;
  message: string;
  priority: AlertPriority;
  status: AlertStatus;
  room: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomStats {
  dirty: number;
  clean: number;
  ready: number;
  inspected: number;
  occupied: number;
  vacant: number;
  ooo: number;
  oos: number;
  totalRooms: number;
}

interface TaskStats {
  pending: number;
  inProgress: number;
  completed: number;
  verified: number;
  total: number;
  cleaningProgress: number;
}

interface MaintenanceStats {
  openIssues: number;
  total: number;
}

interface GuestRequestStats {
  outstanding: number;
}

interface KpiData {
  roomStats: RoomStats;
  taskStats: TaskStats;
  maintenanceStats: MaintenanceStats;
  guestRequestStats?: GuestRequestStats;
  roomStatusDist: { name: string; value: number; color: string }[];
}

interface ProductivityData {
  days: { name: string; completed: number; inspected: number }[];
  avgCleaningTime: number;
}

const API = '/api/hk-portal/dashboard';

const ALERT_ICON: Record<string, LucideIcon> = {
  'VIP Arrival': Crown,
  'Early Arrival': Sun,
  'Late Check-out': Clock,
  'Failed Inspection': ClipboardCheck,
  'Linen Shortage': Droplets,
  'Minibar Pending': Wine,
  'Deep Cleaning Due': Brush,
  'Maintenance Awaiting': Hammer,
};

const PRIORITY_TONE: Record<AlertPriority, StatusTone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

const STATUS_TONE: Record<AlertStatus, StatusTone> = {
  Active: 'danger',
  Acknowledged: 'info',
  Snoozed: 'neutral',
  Resolved: 'success',
};

const PRIORITY_ORDER: Record<AlertPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export default function HKDashboard() {
  const { currentPropertyId } = useERP();
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [productivity, setProductivity] = useState<ProductivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const apiGet = async (path: string) => {
    const r = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.json();
  };

  const apiPost = async (path: string, body?: any) => {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
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
      const qs = currentPropertyId ? `?propertyId=${encodeURIComponent(currentPropertyId)}` : '';
      const [k, a, p] = await Promise.all([
        apiGet(`/kpis${qs}`),
        apiGet(`/alerts${qs}`),
        apiGet(`/productivity${qs}`),
      ]);
      setKpis(k);
      setAlerts(a);
      setProductivity(p);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch HK dashboard data:', e);
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const acknowledgeAlert = async (id: string) => {
    setActionLoading(id);
    try {
      const updated: DashboardAlert = await apiPost(`/alerts/${encodeURIComponent(id)}/acknowledge`);
      setAlerts(prev => prev.map(a => (a.id === id ? updated : a)));
    } catch (e) {
      console.error('Failed to acknowledge alert:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const snoozeAlert = async (id: string) => {
    setActionLoading(id);
    try {
      const updated: DashboardAlert = await apiPost(`/alerts/${encodeURIComponent(id)}/snooze`, { hours: 1 });
      setAlerts(prev => prev.map(a => (a.id === id ? updated : a)));
    } catch (e) {
      console.error('Failed to snooze alert:', e);
    } finally {
      setActionLoading(null);
    }
  };

  // Derived display data
  const roomStats = kpis?.roomStats;
  const taskStats = kpis?.taskStats;
  const maintStats = kpis?.maintenanceStats;
  const guestReqStats = kpis?.guestRequestStats;
  const roomStatusDist = kpis?.roomStatusDist || [];

  const sortedAlerts = [...alerts].sort((a, b) => {
    const po = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (po !== 0) return po;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const activeAlerts = sortedAlerts.filter(a => a.status === 'Active');
  const productivityDays = productivity?.days || [];
  const avgCleaningTime = productivity?.avgCleaningTime || 0;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Housekeeping Dashboard"
        subtitle="Operational KPIs & Smart Alert Engine · Real-time room status"
        icon={Activity}
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <div className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </div>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-sm smooth-transition focus-ring disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
        }
      />

      {loading && !kpis ? (
        <SectionCard title="Loading Dashboard…" icon={Activity} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={20} className="animate-spin inline-block mr-2" />
            Loading dashboard data…
          </div>
        </SectionCard>
      ) : (
        <>
          {/* §4 Operational KPIs — Room Status (8 tiles) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-4">
            <StatCard title="Rooms Ready" value={roomStats?.ready ?? 0} icon={CheckCheck} tone="success" />
            <StatCard title="Dirty Rooms" value={roomStats?.dirty ?? 0} icon={Clock} tone="danger" />
            <StatCard title="Clean Rooms" value={roomStats?.clean ?? 0} icon={Sparkles} tone="success" />
            <StatCard title="Inspected" value={roomStats?.inspected ?? 0} icon={Activity} tone="info" />
            <StatCard title="Occupied" value={roomStats?.occupied ?? 0} icon={User} tone="accent" />
            <StatCard title="Vacant" value={roomStats?.vacant ?? 0} icon={Layers} tone="neutral" />
            <StatCard title="Out of Order" value={roomStats?.ooo ?? 0} icon={Wrench} tone="neutral" />
            <StatCard title="Out of Service" value={roomStats?.oos ?? 0} icon={AlertTriangle} tone="warning" />
          </div>

          {/* §4 Operational KPIs — Performance (4 tiles) */}
          <div className={layout.kpiGrid}>
            <StatCard
              title="Cleaning Progress"
              value={`${taskStats?.cleaningProgress ?? 0}%`}
              icon={Activity}
              tone="success"
              caption={`${taskStats?.completed ?? 0} of ${taskStats?.total ?? 0} tasks`}
            />
            <StatCard
              title="Avg Cleaning Time"
              value={avgCleaningTime > 0 ? `${avgCleaningTime}m` : '—'}
              icon={Clock}
              tone="info"
              caption="Per room"
            />
            <StatCard
              title="Pending Tasks"
              value={taskStats?.pending ?? 0}
              icon={Info}
              tone="warning"
              caption="Awaiting action"
            />
            <StatCard
              title="Open Maintenance Issues"
              value={maintStats?.openIssues ?? 0}
              icon={Wrench}
              tone="danger"
              caption={`of ${maintStats?.total ?? 0} total`}
            />
            <StatCard
              title="Outstanding Guest Requests"
              value={guestReqStats?.outstanding ?? 0}
              icon={Bell}
              tone="warning"
              caption="Awaiting HK action"
            />
          </div>

          {/* Charts + Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <SectionCard
              title="Room Status Distribution"
              subtitle="Operations Metrics"
              icon={Activity}
              tone="accent"
              pad="md"
              className="lg:col-span-7"
            >
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={roomStatusDist.filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {roomStatusDist.map((d, i) => (
                        <Cell key={`cell-${i}`} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 justify-center">
                {roomStatusDist.map(d => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-gray-600 dark:text-gray-400 font-medium">{d.name}: {d.value}</span>
                  </span>
                ))}
              </div>
            </SectionCard>

            {/* §4 Smart Alert Engine */}
            <SectionCard
              title={`Alerts (${activeAlerts.length} active)`}
              subtitle="Smart Alert Engine"
              icon={AlertTriangle}
              tone="danger"
              className="lg:col-span-5"
              bodyClassName="max-h-[28rem] overflow-y-auto"
            >
              {sortedAlerts.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500">
                  <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  No alerts.
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-slate-700">
                  {sortedAlerts.map(alert => {
                    const AlertIcon = ALERT_ICON[alert.type] ?? Bell;
                    const tone = statusTone[PRIORITY_TONE[alert.priority]];
                    const isActive = alert.status === 'Active';
                    return (
                      <div key={alert.id} className="py-4 px-6 space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge tone={PRIORITY_TONE[alert.priority]} variant="soft">{alert.type}</Badge>
                            <Badge tone={STATUS_TONE[alert.status]} variant="soft">{alert.status}</Badge>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">
                            {isActive ? 'LIVE' : alert.snoozed_until ? `Snoozed` : ''}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                          <AlertIcon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                          {alert.message}
                        </p>
                        {isActive && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => acknowledgeAlert(alert.id)}
                              disabled={actionLoading === alert.id}
                              className="px-3 py-1.5 bg-[var(--color-accent-operations)] text-white rounded-lg text-xs font-medium hover:bg-[var(--color-accent-operations-hover)] transition disabled:opacity-50 flex items-center gap-1"
                            >
                              {actionLoading === alert.id && <Loader2 size={12} className="animate-spin" />}
                              Acknowledge
                            </button>
                            <button
                              onClick={() => snoozeAlert(alert.id)}
                              disabled={actionLoading === alert.id}
                              className="px-3 py-1.5 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-1"
                            >
                              {actionLoading === alert.id && <Loader2 size={12} className="animate-spin" />}
                              Snooze
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Productivity chart */}
          <SectionCard
            title="Cleaning Productivity — Rooms Completed vs. Inspected"
            subtitle="7-Day Trend"
            icon={Activity}
            tone="info"
            pad="md"
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productivityDays}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} iconType="circle" />
                  <Bar dataKey="completed" name="Rooms Completed" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="inspected" name="Rooms Inspected" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
