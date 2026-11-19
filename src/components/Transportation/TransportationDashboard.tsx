/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transportation Executive Dashboard — live operational overview.
 * All KPIs, chart series, and alerts are aggregated server-side from the
 * transport tables via GET /api/transport/dashboard/:propertyId (30s cache).
 * Follows the shared F&B / HK ERP component pattern.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Car,
  MapPin,
  Users,
  Clock,
  Fuel,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Plane,
  Calendar,
  DollarSign,
  Activity,
  Wrench,
  Gauge,
  Loader2,
  RefreshCw,
  Download,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

interface DashboardKpis {
  activeTrips: number;
  enRoute: number;
  scheduledToday: number;
  completedToday: number;
  airportPickups: number;
  airportDropoffs: number;
  fleetUtilization: number;
  vehiclesAvailable: number;
  totalVehicles: number;
  driversOnDuty: number;
  totalDrivers: number;
  pendingRequests: number;
  onTimeRate: number | null;
  fuelToday: number;
  revenueToday: number;
  alertsCount: number;
}

interface DashboardAlert {
  type: string;
  message: string;
  time: string | null;
  severity: 'warning' | 'critical';
}

interface DashboardData {
  kpis: DashboardKpis;
  tripsByType: { name: string; value: number }[];
  revenueTrend: { date: string; revenue: number; trips: number }[];
  vehicleUtilization: { vehicle: string; utilization: number }[];
  driverPerformance: { name: string; trips: number; onTime: number }[];
  alerts: DashboardAlert[];
}

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#eab308', '#ec4899', '#06b6d4', '#64748b'];

const ALERT_ICON: Record<string, React.ElementType> = {
  'Flight Delayed': Plane,
  'Flight Cancelled': Plane,
  'Flight Diverted': Plane,
  'Vehicle In Maintenance': Wrench,
  'Maintenance Request': Wrench,
  'Low Fuel': Fuel,
  'GPS Offline': MapPin,
  'License Expiry': AlertTriangle,
  'License Expired': AlertTriangle,
  'Unassigned Trips': Users,
  'Delayed Pickup': Clock,
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatAlertTime(iso: string | null): string {
  if (!iso) return 'now';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  if (Math.abs(diffMs) < 3600000 && diffMs > -3600000) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TransportationDashboard: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/transport/dashboard/${currentPropertyId}`, { headers: authHeaders() });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load dashboard (${r.status})`);
      }
      setData((await r.json()) as DashboardData);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
      addNotification(e.message || 'Failed to load transportation dashboard', 'warning', 'Transportation');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, addNotification]);

  useEffect(() => {
    fetchDashboard();
    const timer = setInterval(fetchDashboard, 60000);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  const exportCsv = () => {
    if (!data) return;
    const lines: string[] = ['Section,Metric,Value'];
    const k = data.kpis;
    lines.push(`KPIs,Active Trips,${k.activeTrips}`);
    lines.push(`KPIs,Scheduled Today,${k.scheduledToday}`);
    lines.push(`KPIs,Completed Today,${k.completedToday}`);
    lines.push(`KPIs,Airport Pickups,${k.airportPickups}`);
    lines.push(`KPIs,Airport Drop-offs,${k.airportDropoffs}`);
    lines.push(`KPIs,Fleet Utilization %,${k.fleetUtilization}`);
    lines.push(`KPIs,Vehicles Available,${k.vehiclesAvailable}`);
    lines.push(`KPIs,Drivers On Duty,${k.driversOnDuty}`);
    lines.push(`KPIs,Pending Requests,${k.pendingRequests}`);
    lines.push(`KPIs,On-Time Rate %,${k.onTimeRate ?? 'n/a'}`);
    lines.push(`KPIs,Fuel Today,${k.fuelToday}`);
    lines.push(`KPIs,Revenue Today,${k.revenueToday}`);
    data.tripsByType.forEach(t => lines.push(`Trips by Type,${t.name},${t.value}`));
    data.revenueTrend.forEach(t => lines.push(`Revenue Trend,${t.date},revenue=${t.revenue};trips=${t.trips}`));
    data.vehicleUtilization.forEach(v => lines.push(`Vehicle Utilization,${v.vehicle},${v.utilization}%`));
    data.driverPerformance.forEach(d => lines.push(`Driver Performance,${d.name},trips=${d.trips};onTime=${d.onTime}%`));
    data.alerts.forEach(a => lines.push(`Alert,${a.type},"${a.message.replace(/"/g, '""')}"`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transport-dashboard-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification('Dashboard data exported', 'success', 'Transportation');
  };

  const k = data?.kpis;

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Transportation Executive Dashboard" subtitle="Real-time fleet and trip operations overview" icon={Activity} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Activity className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view the dashboard.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Transportation Executive Dashboard"
        subtitle="Real-time fleet and trip operations overview."
        icon={Activity}
        actions={
          <>
            {lastRefresh && (
              <span className="text-xs text-slate-400 self-center">
                Updated {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={fetchDashboard} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            <button onClick={exportCsv} disabled={!data} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
              <Download size={14} />
              Export Data
            </button>
          </>
        }
      />

      {error && !data && (
        <SectionCard>
          <div className="py-10 text-center text-rose-500 text-sm">{error}</div>
        </SectionCard>
      )}

      {loading && !data ? (
        <SectionCard>
          <div className="py-16 text-center text-slate-500">
            <Loader2 size={20} className="animate-spin inline-block mr-2" />
            Loading dashboard…
          </div>
        </SectionCard>
      ) : data && k ? (
        <>
          {/* KPI Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <StatCard title="Active Trips" value={k.activeTrips} icon={Car} tone="accent" caption={`${k.enRoute} en route`} />
            <StatCard title="Scheduled Trips" value={k.scheduledToday} icon={Calendar} tone="info" caption="Today" />
            <StatCard title="Completed Trips" value={k.completedToday} icon={CheckCircle2} tone="success" caption="Today" />
            <StatCard title="Airport Pickups" value={k.airportPickups} icon={Plane} tone="accent" caption="Arrivals today" />
            <StatCard title="Airport Drop-offs" value={k.airportDropoffs} icon={Plane} tone="info" caption="Departures today" />
            <StatCard title="Fleet Utilization" value={`${k.fleetUtilization}%`} icon={Gauge} tone="accent" caption="Fleet average" />
            <StatCard title="Vehicle Availability" value={k.vehiclesAvailable} icon={Car} tone="success" caption={`of ${k.totalVehicles} active`} />
            <StatCard title="Driver Availability" value={k.driversOnDuty} icon={Users} tone="info" caption={`of ${k.totalDrivers} on duty`} />
            <StatCard title="Pending Requests" value={k.pendingRequests} icon={Clock} tone="warning" caption="Awaiting assignment" />
            <StatCard
              title="On-Time Performance"
              value={k.onTimeRate != null ? `${k.onTimeRate}%` : '—'}
              icon={TrendingUp}
              tone="success"
              caption="Active contractors"
            />
            <StatCard title="Fuel Consumption" value={`${k.fuelToday} gal`} icon={Fuel} tone="warning" caption="Today" />
            <StatCard title="Transport Revenue" value={formatAmount(k.revenueToday)} icon={DollarSign} tone="success" caption="Today" />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Trips by Type" icon={PieChart as any} tone="accent">
              {data.tripsByType.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">No trips in the last 7 days.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={data.tripsByType}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      dataKey="value"
                    >
                      {data.tripsByType.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Revenue Trend (7 Days)" icon={TrendingUp} tone="accent">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.revenueTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name="Revenue" />
                  <Line type="monotone" dataKey="trips" stroke="#22c55e" strokeWidth={2} name="Trips" />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          {/* Vehicle Utilization & Driver Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Vehicle Utilization" icon={Gauge} tone="accent">
              {data.vehicleUtilization.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">No vehicles registered.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.vehicleUtilization}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="vehicle" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="utilization" fill="#3b82f6" name="Utilization %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Driver Performance" icon={Users} tone="accent">
              {data.driverPerformance.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">No drivers registered.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.driverPerformance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="trips" fill="#8b5cf6" name="Trips" />
                    <Bar dataKey="onTime" fill="#22c55e" name="Performance %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          {/* Alerts */}
          <SectionCard
            title={`Active Alerts · ${data.alerts.length}`}
            icon={AlertTriangle}
            tone={data.alerts.some(a => a.severity === 'critical') ? 'danger' : 'warning'}
          >
            {data.alerts.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                No active alerts — operations running normally.
              </div>
            ) : (
              <div className="space-y-3">
                {data.alerts.map((alert, index) => {
                  const Icon = ALERT_ICON[alert.type] || AlertTriangle;
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-100 dark:border-slate-700"
                    >
                      <div className={`p-2 rounded-lg ${alert.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'}`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900 dark:text-white">{alert.type}</p>
                          <Badge tone={alert.severity === 'critical' ? 'danger' : 'warning'}>
                            {alert.severity === 'critical' ? 'Critical' : 'Warning'}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{alert.message}</p>
                      </div>
                      <div className="text-sm text-slate-500">{formatAlertTime(alert.time)}</div>
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

export default TransportationDashboard;
