/**
 * Concierge Dashboard — live KPIs and operational alerts.
 *
 * All figures come from /api/concierge/dashboard/kpi and
 * /api/concierge/dashboard/alerts (guest_requests, reservations,
 * guests, concierge_settings). Alert items deep-link into Guest
 * Requests / Guest Profiles; quick actions navigate to the
 * owning module tab via onNavigate.
 */

import { conciergeFetch } from '../conciergeApi';
import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Bell,
  AlertTriangle,
  Star,
  Clock,
  CheckCircle2,
  TrendingUp,
  Calendar,
  Car,
  Utensils,
  MapPin,
  Ticket,
  Package,
  Crown,
  MessageSquare,
  ArrowRight,
  RefreshCw,
  Loader2,
  ConciergeBell,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';

type ConciergeTabId =
  | 'guest-requests'
  | 'restaurant-reservations'
  | 'transportation'
  | 'tour-management'
  | 'ticketing'
  | 'parcel-management'
  | 'service-center';

interface ConciergeDashboardModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
  onViewRequest?: (requestId: string) => void;
  onNavigate?: (tab: ConciergeTabId) => void;
}

interface KPIData {
  activeGuestRequests: number;
  vipGuestsInHouse: number;
  openConciergeTasks: number;
  transportationRequests: number;
  restaurantReservations: number;
  tourBookings: number;
  pendingDeliveries: number;
  guestSatisfactionScore: number;
  averageResponseTime: number;
  serviceCompletionRate: number;
  overdueRequests: number;
  escalationThreshold: number;
}

type AlertType =
  | 'VIP Arrival'
  | 'Urgent Guest Request'
  | 'Overdue Request'
  | 'Transportation Delay'
  | 'Missed Reservation'
  | 'Package Arrival'
  | 'Special Occasion'
  | 'Flight Delay'
  | 'Vendor Cancellation'
  | 'Wake-up Call';

interface Alert {
  id: string;
  type: AlertType;
  message: string;
  severity: 'Info' | 'Warning' | 'Critical';
  timestamp: string;
  guestId?: string;
  requestId?: string;
}

const SEVERITY_TONE: Record<Alert['severity'], 'danger' | 'warning' | 'info'> = {
  Critical: 'danger',
  Warning: 'warning',
  Info: 'info',
};

const SEVERITY_BORDER: Record<Alert['severity'], string> = {
  Critical: 'border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-900/10',
  Warning: 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10',
  Info: 'border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/10',
};

const ALERT_ICONS: Record<AlertType, typeof Bell> = {
  'VIP Arrival': Crown,
  'Urgent Guest Request': AlertTriangle,
  'Overdue Request': Clock,
  'Transportation Delay': Car,
  'Missed Reservation': Calendar,
  'Package Arrival': Package,
  'Special Occasion': Star,
  'Flight Delay': Clock,
  'Vendor Cancellation': AlertTriangle,
  'Wake-up Call': ConciergeBell,
};

const QUICK_ACTIONS: { label: string; icon: typeof Bell; tab: ConciergeTabId; chip: string }[] = [
  { label: 'New Request', icon: MessageSquare, tab: 'guest-requests', chip: 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20' },
  { label: 'Restaurant', icon: Utensils, tab: 'restaurant-reservations', chip: 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20' },
  { label: 'Transport', icon: Car, tab: 'transportation', chip: 'text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20' },
  { label: 'Tour Booking', icon: MapPin, tab: 'tour-management', chip: 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20' },
  { label: 'Tickets', icon: Ticket, tab: 'ticketing', chip: 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20' },
  { label: 'Packages', icon: Package, tab: 'parcel-management', chip: 'text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20' },
];

const EMPTY_KPI: KPIData = {
  activeGuestRequests: 0,
  vipGuestsInHouse: 0,
  openConciergeTasks: 0,
  transportationRequests: 0,
  restaurantReservations: 0,
  tourBookings: 0,
  pendingDeliveries: 0,
  guestSatisfactionScore: 0,
  averageResponseTime: 0,
  serviceCompletionRate: 0,
  overdueRequests: 0,
  escalationThreshold: 45,
};

const timeAgo = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!isFinite(mins) || mins < 0) return 'just now';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function ConciergeDashboardModule({
  onViewGuestProfile,
  onViewRequest,
  onNavigate,
}: ConciergeDashboardModuleProps) {
  const [kpi, setKpi] = useState<KPIData>(EMPTY_KPI);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpiRes, alertsRes] = await Promise.all([
        conciergeFetch('/api/concierge/dashboard/kpi'),
        conciergeFetch('/api/concierge/dashboard/alerts'),
      ]);
      if (!kpiRes.ok || !alertsRes.ok) throw new Error('Failed to load dashboard data');
      setKpi({ ...EMPTY_KPI, ...(await kpiRes.json()) });
      setAlerts(await alertsRes.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleAlertClick = (alert: Alert) => {
    if (alert.guestId && onViewGuestProfile) onViewGuestProfile(alert.guestId);
    else if (alert.requestId && onViewRequest) onViewRequest(alert.requestId);
  };

  const criticalCount = alerts.filter(a => a.severity === 'Critical').length;

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Concierge Dashboard"
        subtitle="Guest services overview and real-time alerts."
        icon={LayoutDashboard}
        actions={
          <button className={button.ghost} onClick={fetchAll} disabled={loading} title="Refresh">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── KPI grid ──── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard title="Active Requests" value={kpi.activeGuestRequests} icon={Users} tone="accent" />
        <StatCard title="VIP Guests In House" value={kpi.vipGuestsInHouse} icon={Crown} tone="warning" />
        <StatCard
          title="Open Tasks"
          value={kpi.openConciergeTasks}
          icon={CheckCircle2}
          tone="success"
          caption={kpi.overdueRequests > 0 ? `${kpi.overdueRequests} overdue` : undefined}
        />
        <StatCard title="Transportation" value={kpi.transportationRequests} icon={Car} tone="info" />
        <StatCard title="Restaurant Bookings" value={kpi.restaurantReservations} icon={Utensils} tone="danger" />
        <StatCard title="Tour Bookings" value={kpi.tourBookings} icon={MapPin} tone="accent" />
        <StatCard title="Pending Deliveries" value={kpi.pendingDeliveries} icon={Package} tone="warning" />
        <StatCard title="Satisfaction" value={kpi.guestSatisfactionScore} icon={Star} tone="success" caption="avg rating / 5" />
        <StatCard title="Avg Response" value={kpi.averageResponseTime} icon={Clock} tone="info" caption="minutes to acknowledge" />
        <StatCard title="Completion Rate" value={`${kpi.serviceCompletionRate}%`} icon={TrendingUp} tone="success" />
      </div>

      {/* ── Alerts ──── */}
      <SectionCard
        title="Real-time Alerts"
        subtitle={`${alerts.length} active · ${criticalCount} critical`}
        icon={Bell}
        tone="accent"
      >
        {loading && alerts.length === 0 ? (
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" />
            Loading alerts…
          </div>
        ) : alerts.length === 0 ? (
          <div className="px-6 py-10 text-center text-slate-500">
            No active alerts — the desk is clear.
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {alerts.map(alert => {
              const Icon = ALERT_ICONS[alert.type] || Bell;
              return (
                <button
                  key={alert.id}
                  onClick={() => handleAlertClick(alert)}
                  className={`w-full text-left p-4 rounded-xl border hover:shadow-md transition flex items-start gap-3 ${SEVERITY_BORDER[alert.severity]}`}
                >
                  <span className="flex-shrink-0 mt-0.5 text-slate-600 dark:text-slate-300">
                    <Icon size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-900 dark:text-white">{alert.type}</span>
                        <Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Badge>
                      </span>
                      <span className="text-xs text-slate-400">{timeAgo(alert.timestamp)}</span>
                    </span>
                    <span className="block text-sm text-slate-600 dark:text-slate-300 mt-1">{alert.message}</span>
                  </span>
                  <ArrowRight size={16} className="flex-shrink-0 text-slate-400 mt-1" />
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Quick actions ──── */}
      <SectionCard title="Quick Actions" icon={LayoutDashboard} tone="accent">
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.tab}
                onClick={() => onNavigate?.(action.tab)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 transition ${action.chip}`}
              >
                <Icon size={20} />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{action.label}</span>
              </button>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
