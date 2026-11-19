/**
 * Spa & Wellness Dashboard Module
 * Executive dashboard: KPIs computed live by GET /api/spa-wellness/dashboard,
 * alert feed backed by spa_alerts (read/dismiss), quick actions that deep-link
 * into the other spa modules.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Users,
  Home,
  DollarSign,
  TrendingDown,
  Clock,
  Sparkles,
  AlertTriangle,
  UserX,
  Package,
  Wrench,
  Crown,
  Ticket,
  Plus,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  X,
  Flag,
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import { PageHeader, SectionCard, Badge, QuickActionButton } from '../../FrontOffice/ui';
import StatCard from '../../FrontOffice/StatCard';
import { button, layout, statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

interface SpaWellnessDashboardModuleProps {
  onViewGuestProfile?: (guestId: string) => void;
  onViewAppointment?: (appointmentId: string) => void;
  onViewTherapist?: (therapistId: string) => void;
  /** Navigate to another spa tab (quick actions). */
  onNavigate?: (tab: string) => void;
  /** Open the new-appointment form. */
  onNewAppointment?: () => void;
}

type Severity = 'Info' | 'Warning' | 'Critical';

interface DashboardKpis {
  todaysAppointments: number;
  activeTreatments: number;
  therapistUtilization: number;
  treatmentRoomOccupancy: number;
  membershipCount: number;
  retailRevenue: number;
  spaRevenue: number;
  programsEnrolled: number;
  averageTreatmentValue: number;
  cancellationRate: number;
}

interface SpaAlert {
  id: string;
  alert_type: string;
  message: string;
  severity: Severity;
  guest_id: string | null;
  appointment_id: string | null;
  therapist_id: string | null;
  is_read: boolean;
  created_at: string;
}

const SEVERITY_TONE: Record<Severity, StatusTone> = {
  Critical: 'danger',
  Warning: 'warning',
  Info: 'info',
};

const ALERT_ICON: Record<string, any> = {
  'Therapist Unavailable': UserX,
  'Appointment Conflict': AlertTriangle,
  'Low Inventory': Package,
  'Membership Expiry': Ticket,
  'Equipment Maintenance Due': Wrench,
  'VIP Appointment': Crown,
  'Package Expiry': Ticket,
};

const SpaWellnessDashboardModule: React.FC<SpaWellnessDashboardModuleProps> = ({
  onViewGuestProfile,
  onViewAppointment,
  onViewTherapist,
  onNavigate,
  onNewAppointment,
}) => {
  const { currentPropertyId, addNotification } = useERP();
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [alerts, setAlerts] = useState<SpaAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRead, setShowRead] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/dashboard${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const data = await res.json();
      setKpis(data.kpis || null);
      setAlerts(data.alerts || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const visibleAlerts = useMemo(
    () => (showRead ? alerts : alerts.filter(a => !a.is_read)),
    [alerts, showRead]
  );
  const unreadCount = useMemo(() => alerts.filter(a => !a.is_read).length, [alerts]);

  const patchAlert = async (id: string, updates: Record<string, unknown>) => {
    setActingOn(id);
    const previous = alerts;
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, ...updates } as SpaAlert : a)));
    try {
      const res = await fetch(`/api/spa-wellness/alerts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      setAlerts(previous);
      addNotification(`Alert update failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const dismissAlert = async (alert: SpaAlert) => {
    setActingOn(alert.id);
    try {
      const res = await fetch(`/api/spa-wellness/alerts/${encodeURIComponent(alert.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAlerts(prev => prev.filter(a => a.id !== alert.id));
    } catch (e: any) {
      addNotification(`Dismiss failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  const handleAlertClick = (alert: SpaAlert) => {
    if (!alert.is_read) patchAlert(alert.id, { is_read: true });
    if (alert.guest_id && onViewGuestProfile) onViewGuestProfile(alert.guest_id);
    else if (alert.appointment_id && onViewAppointment) onViewAppointment(alert.appointment_id);
    else if (alert.therapist_id && onViewTherapist) onViewTherapist(alert.therapist_id);
  };

  const quickActions: { label: string; icon: any; tone: StatusTone; onClick: () => void }[] = [
    { label: 'New Appointment', icon: Plus, tone: 'accent', onClick: () => (onNewAppointment ? onNewAppointment() : onNavigate?.('appointments')) },
    { label: 'Guest Check-in', icon: Users, tone: 'success', onClick: () => onNavigate?.('appointments') },
    { label: 'View Schedule', icon: Calendar, tone: 'info', onClick: () => onNavigate?.('appointments') },
    { label: 'Process Payment', icon: DollarSign, tone: 'warning', onClick: () => onNavigate?.('billing-payments') },
    { label: 'Retail Sale', icon: Package, tone: 'neutral', onClick: () => onNavigate?.('retail-shop') },
    { label: 'Membership', icon: Ticket, tone: 'danger', onClick: () => onNavigate?.('memberships') },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Spa & Wellness Dashboard"
        subtitle="Spa operations overview and real-time alerts"
        icon={Sparkles}
        actions={
          <button onClick={fetchDashboard} disabled={loading} className={button.secondary}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {loading && !kpis ? (
        <div className="flex items-center justify-center py-14 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading dashboard…
        </div>
      ) : (
        <>
          {/* KPI cards — all live aggregates */}
          <div className={layout.kpiGrid}>
            <StatCard title="Today's Appointments" value={String(kpis?.todaysAppointments ?? 0)} caption="Scheduled today" icon={Calendar} tone="accent" />
            <StatCard title="Active Treatments" value={String(kpis?.activeTreatments ?? 0)} caption="Catalog services" icon={Sparkles} tone="info" />
            <StatCard title="Therapist Utilization" value={`${kpis?.therapistUtilization ?? 0}%`} caption="Booked today" icon={Users} tone="success" />
            <StatCard title="Room Occupancy" value={`${kpis?.treatmentRoomOccupancy ?? 0}%`} caption="Bookable rooms in use" icon={Home} tone="warning" />
            <StatCard title="Active Memberships" value={String(kpis?.membershipCount ?? 0)} caption="Current members" icon={Crown} tone="neutral" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Retail Revenue (MTD)" value={`$${(kpis?.retailRevenue ?? 0).toLocaleString()}`} caption="Shop sales this month" icon={Package} tone="success" />
            <StatCard title="Spa Revenue (MTD)" value={`$${(kpis?.spaRevenue ?? 0).toLocaleString()}`} caption="Completed payments" icon={DollarSign} tone="accent" />
            <StatCard title="Program Enrollments" value={String(kpis?.programsEnrolled ?? 0)} caption="Active participants" icon={Flag} tone="info" />
            <StatCard title="Avg Treatment Value" value={`$${kpis?.averageTreatmentValue ?? 0}`} caption="Per completed visit" icon={Ticket} tone="warning" />
            <StatCard title="Cancellation Rate" value={`${kpis?.cancellationRate ?? 0}%`} caption="Cancelled + no-show" icon={TrendingDown} tone="danger" />
          </div>

          {/* Alerts */}
          <SectionCard
            title="Real-time Alerts"
            subtitle={`${unreadCount} unread · ${alerts.length} total`}
            icon={AlertTriangle}
            tone="warning"
            pad="none"
            actions={
              <button onClick={() => setShowRead(s => !s)} className={button.ghost}>
                {showRead ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showRead ? 'Hide read' : 'Show read'}
              </button>
            }
          >
            {visibleAlerts.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-slate-400">
                {alerts.length === 0 ? 'No alerts — operations look normal.' : 'All alerts read.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {visibleAlerts.map(alert => {
                  const Icon = ALERT_ICON[alert.alert_type] || AlertTriangle;
                  const linked = !!(alert.guest_id || alert.appointment_id || alert.therapist_id);
                  return (
                    <div
                      key={alert.id}
                      className={`flex items-start gap-3 px-5 py-3.5 transition ${linked ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''} ${alert.is_read ? 'opacity-60' : ''}`}
                      onClick={() => linked && handleAlertClick(alert)}
                    >
                      <div className={`mt-0.5 w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${statusTone[SEVERITY_TONE[alert.severity]].soft}`}>
                        <Icon size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-slate-900 dark:text-white">{alert.alert_type}</span>
                          <Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Badge>
                          {!alert.is_read && <span className="w-2 h-2 rounded-full bg-[var(--color-accent-spa)]" title="Unread" />}
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{alert.message}</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {alert.id} · {new Date(alert.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        {!alert.is_read && (
                          <button
                            onClick={() => patchAlert(alert.id, { is_read: true })}
                            disabled={actingOn === alert.id}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[var(--color-accent-spa)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                            title="Mark as read"
                          >
                            {actingOn === alert.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          onClick={() => dismissAlert(alert)}
                          disabled={actingOn === alert.id}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-[var(--color-danger)] hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="Dismiss"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Quick Actions */}
          <SectionCard title="Quick Actions" icon={Clock} tone="accent" pad="md">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {quickActions.map(action => (
                <QuickActionButton
                  key={action.label}
                  label={action.label}
                  icon={action.icon}
                  tone={action.tone}
                  onClick={action.onClick}
                />
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default SpaWellnessDashboardModule;
