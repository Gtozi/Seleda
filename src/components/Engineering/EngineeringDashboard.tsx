/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Engineering Dashboard — Engineering Portal
 * (/erp/maintenance/dashboard).
 *
 * DB-integrated: fetches KPIs, alerts, and productivity from
 * /api/eng-portal/dashboard/* routes. Mimics the Housekeeping dashboard
 * pattern (HKDashboard.tsx). Alerts can be acknowledged and snoozed,
 * persisted back to the eng_dashboard_alerts table.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Clock,
  Heart,
  Users,
  Activity,
  TrendingUp,
  Bell,
  Flame,
  ShieldAlert,
  Radio,
  Gauge,
  Thermometer,
  Droplets,
  Package,
  FileCheck,
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
  source: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkOrderStats {
  open: number;
  completedToday: number;
  overdue: number;
  emergency: number;
  total: number;
}

interface PMStats {
  active: number;
  overdue: number;
  dueToday: number;
  compliancePct: number;
}

interface ComplianceStats {
  valid: number;
  overdue: number;
  failed: number;
  total: number;
}

interface AssetStats {
  total: number;
  operational: number;
  availabilityPct: number;
}

interface RoomStats {
  outOfOrder: number;
}

interface TechStats {
  active: number;
  utilizationPct: number;
}

interface KpiData {
  workOrderStats: WorkOrderStats;
  pmStats: PMStats;
  complianceStats: ComplianceStats;
  assetStats: AssetStats;
  roomStats: RoomStats;
  techStats: TechStats;
  woStatusDist: { name: string; value: number; color: string }[];
}

interface ProductivityData {
  days: { name: string; completed: number; verified: number }[];
}

const API = '/api/eng-portal/dashboard';

const ALERT_ICON: Record<string, LucideIcon> = {
  'Critical Equipment Failure': Flame,
  'Safety Incident': ShieldAlert,
  'Fire System Fault': Radio,
  'Generator Alarm': Gauge,
  'HVAC Alarm': Thermometer,
  'Water Leak': Droplets,
  'Low Spare Parts Stock': Package,
  'Compliance Inspection Due': FileCheck,
  'PM Overdue': Wrench,
  'Room Out of Order': AlertTriangle,
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

export default function EngineeringDashboard() {
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
      console.error('Failed to fetch Engineering dashboard data:', e);
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
  const woStats = kpis?.workOrderStats;
  const pmStats = kpis?.pmStats;
  const compStats = kpis?.complianceStats;
  const assetStats = kpis?.assetStats;
  const roomStats = kpis?.roomStats;
  const techStats = kpis?.techStats;
  const woStatusDist = kpis?.woStatusDist || [];

  const sortedAlerts = [...alerts].sort((a, b) => {
    const po = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (po !== 0) return po;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const activeAlerts = sortedAlerts.filter(a => a.status === 'Active');
  const productivityDays = productivity?.days || [];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Engineering Dashboard"
        subtitle="Operational KPIs & Smart Alert Engine · Real-time maintenance status"
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
          {/* Operational KPIs — Work Orders (6 tiles) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard title="Open WOs" value={woStats?.open ?? 0} icon={ClipboardList} tone="accent" caption={`of ${woStats?.total ?? 0} total`} />
            <StatCard title="Completed Today" value={woStats?.completedToday ?? 0} icon={CheckCircle2} tone="success" />
            <StatCard title="Overdue WOs" value={woStats?.overdue ?? 0} icon={AlertTriangle} tone="danger" caption="Requires attention" />
            <StatCard title="Emergency" value={woStats?.emergency ?? 0} icon={AlertTriangle} tone="danger" caption="Critical action" />
            <StatCard title="PM Due Today" value={pmStats?.dueToday ?? 0} icon={Wrench} tone="warning" caption={`${pmStats?.overdue ?? 0} overdue`} />
            <StatCard title="Room OOO" value={roomStats?.outOfOrder ?? 0} icon={AlertTriangle} tone="warning" caption="Out of order" />
          </div>

          {/* Performance KPIs (4 tiles) */}
          <div className={layout.kpiGrid}>
            <StatCard
              title="PM Compliance"
              value={`${pmStats?.compliancePct ?? 100}%`}
              icon={CheckCircle2}
              tone="success"
              caption={`${pmStats?.active ?? 0} active schedules`}
            />
            <StatCard
              title="Asset Availability"
              value={`${assetStats?.availabilityPct ?? 100}%`}
              icon={Heart}
              tone="info"
              caption={`${assetStats?.operational ?? 0} of ${assetStats?.total ?? 0} assets`}
            />
            <StatCard
              title="Tech Utilization"
              value={`${techStats?.utilizationPct ?? 0}%`}
              icon={Users}
              tone="accent"
              caption={`${techStats?.active ?? 0} active techs`}
            />
            <StatCard
              title="Compliance Issues"
              value={(compStats?.overdue ?? 0) + (compStats?.failed ?? 0)}
              icon={FileCheck}
              tone="danger"
              caption={`${compStats?.overdue ?? 0} overdue, ${compStats?.failed ?? 0} failed`}
            />
          </div>

          {/* Charts + Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <SectionCard
              title="Work Order Status Distribution"
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
                      data={woStatusDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {woStatusDist.map((d, i) => (
                        <Cell key={`cell-${i}`} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 justify-center">
                {woStatusDist.map(d => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-gray-600 dark:text-gray-400 font-medium">{d.name}: {d.value}</span>
                  </span>
                ))}
              </div>
            </SectionCard>

            {/* Smart Alert Engine */}
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
                    const isActive = alert.status === 'Active';
                    return (
                      <div key={alert.id} className="py-4 px-6 space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge tone={PRIORITY_TONE[alert.priority]} variant="soft">{alert.type}</Badge>
                            <Badge tone={STATUS_TONE[alert.status]} variant="soft">{alert.status}</Badge>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">
                            {isActive ? 'LIVE' : alert.snoozed_until ? 'Snoozed' : ''}
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

          {/* PM Compliance breakdown */}
          <SectionCard
            title="Preventive Maintenance Compliance"
            subtitle="Schedule adherence"
            icon={Wrench}
            tone="info"
            pad="md"
          >
            <div className="space-y-4">
              <div className="flex justify-between items-end mb-1">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">Overall Compliance</span>
                <span className="text-xl font-black text-slate-900 dark:text-white leading-none">{pmStats?.compliancePct ?? 100}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all"
                  style={{ width: `${pmStats?.compliancePct ?? 100}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="text-center">
                  <div className="text-2xl font-black text-slate-900 dark:text-white">{pmStats?.active ?? 0}</div>
                  <div className="text-xs text-slate-400 uppercase font-bold">Active Schedules</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-amber-500">{pmStats?.overdue ?? 0}</div>
                  <div className="text-xs text-slate-400 uppercase font-bold">Overdue</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-indigo-500">{pmStats?.dueToday ?? 0}</div>
                  <div className="text-xs text-slate-400 uppercase font-bold">Due Today</div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Productivity chart */}
          <SectionCard
            title="Work Order Productivity — Completed vs. Verified"
            subtitle="7-Day Trend"
            icon={TrendingUp}
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
                  <Bar dataKey="completed" name="WOs Completed" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="verified" name="WOs Verified" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
