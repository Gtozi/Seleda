/**
 * Front Office Dashboard Module
 * Operational KPIs and Alerts
 */

import { useState, useEffect } from 'react';
import {
  Users,
  DollarSign,
  TrendingUp,
  Calendar,
  BedDouble,
  AlertTriangle,
  Star,
  Shield,
  Clock,
  XCircle,
  RefreshCw,
  Bell,
  UserCheck,
  UserX,
  CreditCard,
  Heart,
  Home,
  Wrench,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  BarChart3,
  PieChart,
  Globe,
  UsersRound,
  Baby,
  CalendarX,
  AlertCircle,
  ClipboardList,
  Sparkles,
  FileText,
  Key,
} from 'lucide-react';
import StatCard, { type StatCardProps } from '../StatCard';
import { PageHeader, SectionCard, QuickActionButton, Badge } from '../ui';
import { button, statusTone, layout, animation, type StatusTone } from '../brandTheme';

interface KPICard {
  title: string;
  value: string | number;
  change?: number;
  icon: any;
  color: string;
  tone?: StatCardProps['tone'];
}

interface Alert {
  id: string;
  type: 'vip' | 'birthday' | 'anniversary' | 'long-stay' | 'no-show' | 'overbooking' | 'high-balance' | 'payment-failed' | 'blacklist' | 'room-assignment' | 'late-checkout' | 'unpaid-arrival' | 'pending-request' | 'dirty-rooms-blocking' | 'group-arrival';
  message: string;
  guestName?: string;
  roomNumber?: string;
  time: string;
  priority: 'high' | 'medium' | 'low';
}

interface TrendDay {
  date: string;
  label: string;
  occupancy: number;
  revenue: number;
  arrivals: number;
}

interface BookingSource {
  channel: string;
  count: number;
  revenue: number;
}

interface RoomTypeBreakdown {
  roomType: string;
  count: number;
  revenue: number;
}

interface WeeklyTrends {
  days: TrendDay[];
  sources: BookingSource[];
  roomTypes?: RoomTypeBreakdown[];
  summary: {
    totalArrivals: number;
    totalRevenue: number;
    avgOccupancy: number;
    totalRooms: number;
  };
}

const Dashboard = ({ onTabChange }: { onTabChange?: (tab: string) => void }) => {
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [alertsCollapsed, setAlertsCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Default KPIs with zero values — tones map to the earthy luxury palette
  // (accent = terracotta/operations, plus semantic success/warning/danger/info).
  const defaultKpis: KPICard[] = [
    // ── Revenue & Performance ──
    { title: 'Occupancy %', value: '0.0', change: 0, icon: Users, color: 'blue', tone: 'accent' },
    { title: 'ADR', value: '$0', change: 0, icon: DollarSign, color: 'green', tone: 'success' },
    { title: 'RevPAR', value: '$0', change: 0, icon: TrendingUp, color: 'purple', tone: 'info' },
    { title: "Today's Revenue", value: '$0', change: 0, icon: DollarSign, color: 'emerald', tone: 'success' },
    // ── Arrivals & Departures ──
    { title: 'Arrivals Today', value: 0, icon: Calendar, color: 'orange', tone: 'info' },
    { title: 'Departures Today', value: 0, icon: Clock, color: 'red', tone: 'warning' },
    { title: 'Stayovers', value: 0, icon: BedDouble, color: 'indigo', tone: 'accent' },
    { title: 'Expected Check-ins', value: 0, icon: UserCheck, color: 'cyan', tone: 'info' },
    { title: 'Expected Check-outs', value: 0, icon: UserX, color: 'rose', tone: 'warning' },
    // ── Room Status ──
    { title: 'Available Rooms', value: 0, icon: Home, color: 'green', tone: 'success' },
    { title: 'Out of Order', value: 0, icon: Wrench, color: 'yellow', tone: 'warning' },
    { title: 'Out of Service', value: 0, icon: XCircle, color: 'gray', tone: 'danger' },
    // ── In-house Guests ──
    { title: 'In-house Guests', value: 0, icon: UsersRound, color: 'blue', tone: 'accent' },
    { title: 'Adults in House', value: 0, icon: UserCheck, color: 'cyan', tone: 'info' },
    { title: 'Children in House', value: 0, icon: Baby, color: 'rose', tone: 'info' },
    // ── Operational Exceptions ──
    { title: 'Cancellations Today', value: 0, icon: CalendarX, color: 'red', tone: 'danger' },
    { title: 'No-shows Today', value: 0, icon: UserX, color: 'orange', tone: 'warning' },
    { title: 'Late Check-outs', value: 0, icon: Clock, color: 'amber', tone: 'warning' },
    { title: 'Dirty Rooms', value: 0, icon: Wrench, color: 'yellow', tone: 'warning' },
    { title: 'Pending Requests', value: 0, icon: Bell, color: 'purple', tone: 'info' },
  ];
  
  const [kpis, setKpis] = useState<KPICard[]>(defaultKpis);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [trends, setTrends] = useState<WeeklyTrends | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Fetch KPIs
      const kpisRes = await fetch('/api/front-office/dashboard/kpis');
      if (kpisRes.ok) {
        const contentType = kpisRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const kpisData = await kpisRes.json();
          // Use API data if available, otherwise keep default zero values
          if (kpisData.kpis && kpisData.kpis.length > 0) {
            const merged = defaultKpis.map((defaultKpi) => {
              const apiKpi = kpisData.kpis.find((k: any) => k.title === defaultKpi.title);
              return apiKpi
                ? { ...defaultKpi, value: apiKpi.value, change: typeof apiKpi.change === 'number' ? apiKpi.change : defaultKpi.change }
                : defaultKpi;
            });
            setKpis(merged);
          }
          if (kpisData.lastUpdated) {
            setLastUpdated(new Date(kpisData.lastUpdated));
          }
        } else {
          console.error('KPIs endpoint returned non-JSON response');
        }
      } else {
        console.error('KPIs endpoint returned:', kpisRes.status);
      }

      // Fetch alerts
      const alertsRes = await fetch('/api/front-office/alerts');
      if (alertsRes.ok) {
        const contentType = alertsRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const alertsData = await alertsRes.json();
          setAlerts(alertsData.alerts || []);
        } else {
          console.error('Alerts endpoint returned non-JSON response');
        }
      } else {
        console.error('Alerts endpoint returned:', alertsRes.status);
      }

      // Fetch weekly trends (occupancy + revenue + booking sources)
      try {
        const trendsRes = await fetch('/api/front-office/dashboard/weekly-trends');
        if (trendsRes.ok) {
          const trendsData = await trendsRes.json();
          if (trendsData.days && Array.isArray(trendsData.days)) {
            setTrends(trendsData);
          }
        } else {
          console.error('Weekly trends endpoint returned:', trendsRes.status);
        }
      } catch (trendsErr) {
        console.error('Failed to fetch weekly trends:', trendsErr);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    // Refresh data every 5 minutes
    const interval = setInterval(fetchDashboardData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    fetchDashboardData();
  };

  const handleViewAllAlerts = () => {
    // In a real implementation, this would navigate to a full alerts page
    console.log('Navigate to all alerts page');
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      const res = await fetch(`/api/front-office/alerts/${alertId}/dismiss`, {
        method: 'POST',
      });
      if (res.ok) {
        // Remove the alert from the local state
        setAlerts(alerts.filter(a => a.id !== alertId));
      } else {
        console.warn('Failed to dismiss alert:', res.status);
        // Still remove from local state for better UX even if backend fails
        setAlerts(alerts.filter(a => a.id !== alertId));
      }
    } catch (error) {
      console.error('Failed to dismiss alert:', error);
      // Still remove from local state for better UX even if backend fails
      setAlerts(alerts.filter(a => a.id !== alertId));
    }
  };

  const handleCheckInGuest = () => {
    if (onTabChange) {
      onTabChange('check-in');
    }
  };

  const handleCheckOutGuest = () => {
    if (onTabChange) {
      onTabChange('check-out');
    }
  };

  const handleNewReservation = () => {
    if (onTabChange) {
      onTabChange('reservations');
    }
  };

  const handleAssignRoom = () => {
    if (onTabChange) {
      onTabChange('room-assignment');
    }
  };

  const handleFolioBilling = () => {
    if (onTabChange) {
      onTabChange('folio-billing');
    }
  };

  const alertIcons = {
    vip: Star,
    birthday: Calendar,
    anniversary: Heart,
    'long-stay': Clock,
    'no-show': XCircle,
    overbooking: AlertTriangle,
    'high-balance': DollarSign,
    'payment-failed': CreditCard,
    blacklist: Shield,
    'room-assignment': BedDouble,
    'late-checkout': Clock,
    'unpaid-arrival': CreditCard,
    'pending-request': ClipboardList,
    'dirty-rooms-blocking': AlertCircle,
    'group-arrival': UsersRound,
  };

  // Map alert priority → semantic tone from the brand theme.
  const priorityTone: Record<Alert['priority'], StatusTone> = {
    high: 'danger',
    medium: 'warning',
    low: 'info',
  };

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Front Office Dashboard"
        subtitle="Real-time operational overview"
        icon={LayoutDashboard}
        actions={
          <>
            <button onClick={handleRefresh} className={button.secondary}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <div className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          </>
        }
      />

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent-operations)]"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading dashboard data...</span>
        </div>
      )}

      {/* Dashboard Content */}
      {!loading && (
        <>
          {/* KPI Cards */}
          <div className={layout.kpiGrid}>
            {kpis.map((kpi, index) => (
              <StatCard
                key={index}
                title={kpi.title}
                value={kpi.value}
                icon={kpi.icon}
                tone={kpi.tone ?? 'accent'}
                change={kpi.change}
                interactive
                className={animation.fadeInUp}
              />
            ))}
          </div>

          {/* Weekly Trends + Booking Sources */}
          {trends && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Occupancy & Revenue Chart — spans 2 columns */}
              <div className="lg:col-span-2">
                <SectionCard
                  icon={BarChart3}
                  title="Weekly Occupancy & Revenue Trend"
                  tone="info"
                  actions={
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                        <span className="w-3 h-3 rounded bg-[var(--color-accent-operations)]"></span>
                        Occupancy %
                      </span>
                      <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                        <span className="w-3 h-3 rounded bg-[var(--color-success)]"></span>
                        Revenue
                      </span>
                    </div>
                  }
                >
                  <div className="p-6">
                    {/* Summary row */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Avg Occupancy</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{trends.summary.avgOccupancy}%</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Revenue</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">${trends.summary.totalRevenue.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Arrivals</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{trends.summary.totalArrivals}</p>
                      </div>
                    </div>

                    {/* Bar chart */}
                    <div className="flex items-end justify-between gap-2 h-48">
                      {trends.days.map((day, idx) => {
                        const maxRevenue = Math.max(...trends.days.map(d => d.revenue), 1);
                        const revenueHeight = Math.max((day.revenue / maxRevenue) * 100, 2);
                        const occupancyHeight = Math.max(day.occupancy, 2);
                        const isToday = idx === trends.days.length - 1;
                        return (
                          <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                            {/* Bars */}
                            <div className="relative w-full flex items-end justify-center gap-1 h-36">
                              {/* Occupancy bar */}
                              <div
                                className={`w-1/2 rounded-t-md smooth-transition ${isToday ? 'bg-[var(--color-accent-operations)]' : 'bg-[var(--color-accent-operations)]/60 group-hover:bg-[var(--color-accent-operations)]'}`}
                                style={{ height: `${occupancyHeight}%` }}
                                title={`Occupancy: ${day.occupancy}%`}
                              />
                              {/* Revenue bar */}
                              <div
                                className={`w-1/2 rounded-t-md smooth-transition ${isToday ? 'bg-[var(--color-success)]' : 'bg-[var(--color-success)]/60 group-hover:bg-[var(--color-success)]'}`}
                                style={{ height: `${revenueHeight}%` }}
                                title={`Revenue: $${day.revenue.toLocaleString()}`}
                              />
                              {/* Tooltip on hover */}
                              <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 smooth-transition pointer-events-none z-10">
                                <div className="bg-gray-900 dark:bg-slate-700 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                                  <div className="font-medium">{day.date}</div>
                                  <div className="text-[var(--color-accent-operations)]">Occ: {day.occupancy}%</div>
                                  <div className="text-[var(--color-success)]">Rev: ${day.revenue.toLocaleString()}</div>
                                  <div className="text-gray-300">Arrivals: {day.arrivals}</div>
                                </div>
                              </div>
                            </div>
                            {/* Day label */}
                            <div className={`text-xs ${isToday ? 'font-bold text-[var(--color-accent-operations)]' : 'font-medium text-gray-500 dark:text-gray-400'}`}>
                              {day.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </SectionCard>
              </div>

              {/* Booking Sources — 1 column */}
              <div>
                <SectionCard
                  icon={Globe}
                  title="Booking Sources"
                  tone="accent"
                >
                  <div className="p-6">
                    {trends.sources.length === 0 ? (
                      <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                        No bookings in the last 7 days
                      </div>
                    ) : (
                      <>
                        {/* Source bars */}
                        <div className="space-y-4">
                          {trends.sources.map((source, idx) => {
                            const totalBookings = trends.summary.totalArrivals || 1;
                            const pct = Math.round((source.count / totalBookings) * 100);
                            const sourceColors = [
                              'bg-[var(--color-accent-operations)]',
                              'bg-[var(--color-success)]',
                              'bg-[var(--color-info)]',
                              'bg-[var(--color-warning)]',
                              'bg-[var(--color-danger)]',
                              'bg-gray-400',
                            ];
                            const barColor = sourceColors[idx % sourceColors.length];
                            return (
                              <div key={idx}>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${barColor}`} />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{source.channel}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 text-xs">
                                    <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{source.count}</span>
                                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">{pct}%</span>
                                  </div>
                                </div>
                                {/* Progress bar */}
                                <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full smooth-transition ${barColor}`}
                                    style={{ width: `${Math.max(pct, 2)}%` }}
                                  />
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 tabular-nums">
                                  ${source.revenue.toLocaleString()} revenue
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Summary footer */}
                        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-slate-700">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-600 dark:text-gray-400">Total Bookings</span>
                            <span className="font-bold text-gray-900 dark:text-white tabular-nums">{trends.summary.totalArrivals}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm mt-2">
                            <span className="font-medium text-gray-600 dark:text-gray-400">Total Revenue</span>
                            <span className="font-bold text-gray-900 dark:text-white tabular-nums">${trends.summary.totalRevenue.toLocaleString()}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </SectionCard>
              </div>
            </div>
          )}

          {/* Top Room Types — weekly breakdown by room category */}
          {trends && trends.roomTypes && trends.roomTypes.length > 0 && (
            <SectionCard
              icon={BedDouble}
              title="Top Room Types"
              subtitle="Bookings & revenue by room category · last 7 days"
              tone="accent"
              actions={
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                    <span className="w-3 h-3 rounded bg-[var(--color-accent-operations)]"></span>
                    Bookings
                  </span>
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                    <span className="w-3 h-3 rounded bg-[var(--color-success)]"></span>
                    Revenue
                  </span>
                </div>
              }
            >
              <div className="p-6">
                <div className="space-y-4">
                  {trends.roomTypes.slice(0, 6).map((rt, idx) => {
                    const maxCount = Math.max(...trends.roomTypes!.map(r => r.count), 1);
                    const maxRevenue = Math.max(...trends.roomTypes!.map(r => r.revenue), 1);
                    const countPct = Math.max((rt.count / maxCount) * 100, 2);
                    const revenuePct = Math.max((rt.revenue / maxRevenue) * 100, 2);
                    const sharePct = trends.summary.totalArrivals > 0
                      ? Math.round((rt.count / trends.summary.totalArrivals) * 100)
                      : 0;
                    const isTop = idx === 0;
                    return (
                      <div key={idx}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            {isTop && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{rt.roomType}</span>
                            <Badge tone={isTop ? 'warning' : 'neutral'} variant="soft">{sharePct}%</Badge>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-xs">
                            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{rt.count} bookings</span>
                            <span className="text-gray-500 dark:text-gray-400 tabular-nums">${rt.revenue.toLocaleString()}</span>
                          </div>
                        </div>
                        {/* Dual progress bars: bookings (accent) + revenue (success) */}
                        <div className="space-y-1">
                          <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full smooth-transition bg-[var(--color-accent-operations)]"
                              style={{ width: `${countPct}%` }}
                              title={`Bookings: ${rt.count}`}
                            />
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full smooth-transition bg-[var(--color-success)]"
                              style={{ width: `${revenuePct}%` }}
                              title={`Revenue: $${rt.revenue.toLocaleString()}`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Summary footer */}
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-slate-700 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Room Types Sold</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{trends.roomTypes.length}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Top Category</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white mt-1 truncate">{trends.roomTypes[0].roomType}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Top Category Revenue</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white mt-1 tabular-nums">${trends.roomTypes[0].revenue.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Alerts Section */}
          <SectionCard
            icon={Bell}
            title="Operational Alerts"
            tone="warning"
            actions={
              <>
                <Badge tone="danger" variant="soft">
                  {alerts.filter(a => a.priority === 'high').length} High
                </Badge>
                <Badge tone="warning" variant="soft">
                  {alerts.filter(a => a.priority === 'medium').length} Med
                </Badge>
                <Badge tone="info" variant="soft">
                  {alerts.filter(a => a.priority === 'low').length} Low
                </Badge>
                <button onClick={handleViewAllAlerts} className="text-sm text-[var(--color-accent-operations)] hover:underline">
                  View All
                </button>
                <button
                  onClick={() => setAlertsCollapsed(!alertsCollapsed)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg smooth-transition"
                  aria-label={alertsCollapsed ? 'Expand alerts' : 'Collapse alerts'}
                >
                  {alertsCollapsed ? <ChevronDown className="w-5 h-5 text-gray-600 dark:text-gray-400" /> : <ChevronUp className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
                </button>
              </>
            }
          >
            {!alertsCollapsed && (
              <div className="divide-y divide-gray-200 dark:divide-slate-700">
                {alerts.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                    No active alerts
                  </div>
                ) : (
                  // Sort by priority: high → medium → low
                  [...alerts]
                    .sort((a, b) => {
                      const order = { high: 0, medium: 1, low: 2 };
                      return order[a.priority] - order[b.priority];
                    })
                    .map((alert) => {
                    const AlertIcon = alertIcons[alert.type] || Bell;
                    const tone = priorityTone[alert.priority];
                    const toneStyles = statusTone[tone];
                    return (
                      <div key={alert.id} className={`p-4 border-l-4 ${toneStyles.border} ${toneStyles.soft}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 flex-1">
                            <div className={`shrink-0 p-2 rounded-lg ${toneStyles.soft}`}>
                              <AlertIcon className={`w-5 h-5 ${toneStyles.text}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-gray-900 dark:text-white">{alert.message}</p>
                                <Badge tone={tone} variant="soft" className="capitalize !text-[10px] !px-1.5 !py-0.5">
                                  {alert.type.replace(/-/g, ' ')}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-600 dark:text-gray-400">
                                {alert.guestName && <span>{alert.guestName}</span>}
                                {alert.roomNumber && <span>Room {alert.roomNumber}</span>}
                                <span>{alert.time}</span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDismissAlert(alert.id)}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg smooth-transition"
                            aria-label="Dismiss alert"
                          >
                            <XCircle className="w-5 h-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </SectionCard>

          {/* Quick Actions */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Quick Actions</h3>
            <div className={layout.actionGrid}>
              <QuickActionButton label="Check-In Guest" icon={Key} onClick={handleCheckInGuest} tone="success" description="Registration & key management" />
              <QuickActionButton label="Check-Out Guest" icon={UserX} onClick={handleCheckOutGuest} tone="danger" description="Settlement & folio closure" />
              <QuickActionButton label="Folio & Billing" icon={FileText} onClick={handleFolioBilling} tone="info" description="Charge posting & folio management" />
              <QuickActionButton label="New Reservation" icon={Calendar} onClick={handleNewReservation} tone="accent" description="Create a new booking" />
              <QuickActionButton label="Assign Room" icon={BedDouble} onClick={handleAssignRoom} tone="neutral" description="Auto & manual room assignment" />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;