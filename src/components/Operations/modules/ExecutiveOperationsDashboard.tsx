/**
 * Executive Operations Dashboard — Operations Portal (/erp/operations/executive-dashboard).
 *
 * Fully DB-integrated via `GET /api/ops-portal/dashboard` — same layout
 * pattern as HKDashboard / other department dashboards:
 *
 *   Row 1: 8 room/flow StatCards (occupancy, available, OOO, arrivals,
 *          departures, VIP, in-house, events)
 *   Row 2: revenue StatCards (period revenue, ADR, RevPAR, forecast)
 *   Row 3: guest + operations StatCards (complaints, satisfaction,
 *          recovery, feedback, WOs, incidents, HK done, staffing)
 *   Row 4: room-status pie chart + live cross-portal alerts panel
 *          (escalation alerts carry a working Acknowledge action that
 *          PATCHes ops_escalations)
 *   Row 5: 7-day flow bar chart (arrivals vs departures vs events)
 *
 * The Today / Week / Month selector re-queries with real
 * previous-period deltas. Data sources: rooms, reservations, VIP
 * guests, hk tasks, work_orders, guest_requests, sec_incidents,
 * emergencies, escalations, recovery cases, feedback, attendance,
 * banquet events.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Bed,
  BedDouble,
  DoorOpen,
  DoorClosed,
  Crown,
  Users,
  CalendarDays,
  Wrench,
  DollarSign,
  TrendingUp,
  Gauge,
  AlertTriangle,
  Star,
  HeartHandshake,
  MessageSquare,
  Shield,
  ClipboardCheck,
  UserCheck,
  RefreshCw,
  Loader2,
  Bell,
  CheckCheck,
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
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsDashboard,
  updateEscalation,
  type OpsDashboard,
  type OpsDashboardAlert,
} from '../../../services/operationsService';

type Period = 'today' | 'week' | 'month';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

const PRIORITY_TONE: Record<OpsDashboardAlert['type'], StatusTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'ongoing';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return String(iso).slice(0, 10);
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const ExecutiveOperationsDashboard: React.FC = () => {
  const { currentPropertyId, formatAmount, addNotification } = useERP();
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<OpsDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchOpsDashboard(period, currentPropertyId || undefined));
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [period, currentPropertyId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  const acknowledge = async (alert: OpsDashboardAlert) => {
    if (!alert.acknowledgeable) return;
    setActionLoading(alert.id);
    try {
      await updateEscalation(alert.acknowledgeable, { status: 'acknowledged' });
      setData(prev => prev ? { ...prev, alerts: prev.alerts.filter(a => a.id !== alert.id) } : prev);
      addNotification('Escalation acknowledged', 'success', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Acknowledge failed', 'warning', 'Executive');
    } finally {
      setActionLoading(null);
    }
  };

  const k = (group: keyof OpsDashboard['groups'], title: string) =>
    data?.groups[group].find(x => x.title === title);

  const money = (v: string | number | undefined) =>
    typeof v === 'number' ? formatAmount(v) : (v ?? '—');

  const delta = (change?: number, caption?: string) => {
    const parts: string[] = [];
    if (change) parts.push(`${change > 0 ? '+' : ''}${change}% vs prev`);
    if (caption) parts.push(caption);
    return parts.join(' · ') || undefined;
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Executive Operations Dashboard"
        subtitle="Cross-portal KPIs & live alert feed · Rooms, revenue, guests, operations"
        icon={LayoutDashboard}
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <div className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </div>
            )}
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    period === p.key
                      ? 'bg-[var(--color-accent-operations)] text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-sm smooth-transition focus-ring disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <SectionCard title="Loading Dashboard…" icon={LayoutDashboard} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={20} className="animate-spin inline-block mr-2" />
            Computing live metrics…
          </div>
        </SectionCard>
      ) : data ? (
        <>
          {/* Rooms & flow — 8 tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-4">
            <StatCard title="Occupancy" value={k('rooms', 'Occupancy')?.value ?? '—'} icon={BedDouble} tone="accent" caption={k('rooms', 'Occupancy')?.caption} />
            <StatCard title="Available" value={k('rooms', 'Available Rooms')?.value ?? 0} icon={DoorOpen} tone="success" />
            <StatCard title="Out of Order" value={k('rooms', 'Out of Order')?.value ?? 0} icon={Wrench} tone="neutral" />
            <StatCard title="Arrivals" value={k('rooms', 'Arrivals')?.value ?? 0} icon={DoorClosed} tone="info" caption={delta(k('rooms', 'Arrivals')?.change)} />
            <StatCard title="Departures" value={k('rooms', 'Departures')?.value ?? 0} icon={DoorOpen} tone="warning" caption={delta(k('rooms', 'Departures')?.change)} />
            <StatCard title="VIP Arrivals" value={k('rooms', 'VIP Arrivals')?.value ?? 0} icon={Crown} tone="accent" />
            <StatCard title="In-House" value={k('rooms', 'In-House Guests')?.value ?? 0} icon={Users} tone="info" />
            <StatCard title="Events" value={k('rooms', 'Events')?.value ?? 0} icon={CalendarDays} tone="neutral" caption={k('rooms', 'Events')?.caption} />
          </div>

          {/* Revenue — 4 tiles */}
          <div className={layout.kpiGrid}>
            <StatCard title={`Revenue (${period})`} value={money(k('revenue', 'Revenue')?.value)} icon={DollarSign} tone="success" caption={delta(k('revenue', 'Revenue')?.change, k('revenue', 'Revenue')?.caption)} />
            <StatCard title="ADR" value={money(k('revenue', 'ADR')?.value)} icon={Bed} tone="info" caption="Avg daily rate" />
            <StatCard title="RevPAR" value={money(k('revenue', 'RevPAR')?.value)} icon={Gauge} tone="accent" caption="Revenue per available room" />
            <StatCard title="Forecast (next)" value={money(k('revenue', 'Forecast (next)')?.value)} icon={TrendingUp} tone="warning" caption="Next equivalent period" />
          </div>

          {/* Guest + Operations — 8 tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-4">
            <StatCard title="Open Complaints" value={k('guest', 'Open Complaints')?.value ?? 0} icon={AlertTriangle} tone="danger" caption={delta(k('guest', 'Open Complaints')?.change)} />
            <StatCard title="Satisfaction" value={k('guest', 'Guest Satisfaction')?.value ?? '—'} icon={Star} tone="accent" />
            <StatCard title="Recovery Cases" value={k('guest', 'Service Recovery')?.value ?? 0} icon={HeartHandshake} tone="warning" />
            <StatCard title="Feedback" value={k('guest', 'Feedback Received')?.value ?? 0} icon={MessageSquare} tone="info" caption="in period" />
            <StatCard title="Open Work Orders" value={k('operations', 'Open Work Orders')?.value ?? 0} icon={Wrench} tone="danger" caption={k('operations', 'Open Work Orders')?.caption} />
            <StatCard title="HK Done" value={k('operations', 'Housekeeping Done')?.value ?? '—'} icon={ClipboardCheck} tone="success" caption={k('operations', 'Housekeeping Done')?.caption} />
            <StatCard title="Open Incidents" value={k('operations', 'Open Incidents')?.value ?? 0} icon={Shield} tone="warning" caption={delta(k('operations', 'Open Incidents')?.change)} />
            <StatCard title="Staffing" value={k('operations', 'Staffing Today')?.value ?? '—'} icon={UserCheck} tone="info" caption={k('operations', 'Staffing Today')?.caption} />
          </div>

          {/* Room status pie + alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <SectionCard
              title="Room Status Distribution"
              subtitle="Live rooms table"
              icon={Bed}
              tone="accent"
              pad="md"
              className="lg:col-span-7"
            >
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(data.roomStatusDist || []).filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {(data.roomStatusDist || []).map((d, i) => (
                        <Cell key={`cell-${i}`} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 justify-center">
                {(data.roomStatusDist || []).map(d => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-gray-600 dark:text-gray-400 font-medium">{d.name}: {d.value}</span>
                  </span>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title={`Alerts (${data.alerts.filter(a => a.type === 'critical').length} critical)`}
              subtitle="Cross-portal live feed"
              icon={AlertTriangle}
              tone="danger"
              className="lg:col-span-5"
              bodyClassName="max-h-[28rem] overflow-y-auto"
            >
              {data.alerts.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500">
                  <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  No active alerts — all departments clear.
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-slate-700">
                  {data.alerts.map(alert => {
                    const tone = statusTone[PRIORITY_TONE[alert.type]];
                    return (
                      <div key={alert.id} className="py-4 px-6 space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge tone={PRIORITY_TONE[alert.type]} variant="soft">{alert.type}</Badge>
                            <Badge tone="neutral" variant="soft">{alert.department}</Badge>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">
                            {timeAgo(alert.time)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{alert.title}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${tone.text}`} />
                          {alert.description}
                        </p>
                        {alert.acknowledgeable && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => acknowledge(alert)}
                              disabled={actionLoading === alert.id}
                              className="px-3 py-1.5 bg-[var(--color-accent-operations)] text-white rounded-lg text-xs font-medium hover:bg-[var(--color-accent-operations-hover)] transition disabled:opacity-50 flex items-center gap-1"
                            >
                              {actionLoading === alert.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
                              Acknowledge Escalation
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

          {/* 7-day flow chart */}
          <SectionCard
            title="7-Day Flow — Arrivals vs Departures vs Events"
            subtitle="Booking & event movement"
            icon={CalendarDays}
            tone="info"
            pad="md"
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.flow7d || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} iconType="circle" />
                  <Bar dataKey="arrivals" name="Arrivals" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="departures" name="Departures" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="events" name="Events" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
};

export default ExecutiveOperationsDashboard;
