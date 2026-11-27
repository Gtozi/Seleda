/**
 * Banquet & Events Portal
 * Centralized platform for managing the complete lifecycle of meetings, conferences, weddings, banquets, exhibitions, social functions, and other events
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar,
  CalendarDays,
  Building2,
  ClipboardList,
  FileText,
  Heart,
  Users,
  Utensils,
  Package,
  CheckSquare,
  CheckCircle2,
  Network,
  Clock,
  Armchair,
  Monitor,
  Truck,
  DollarSign,
  MessageSquare,
  BarChart3,
  Settings,
  RefreshCw,
  Bell,
  Plus,
  AlertTriangle,
  TrendingUp,
  Activity,
  Star,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Edit,
  PiggyBank,
  XCircle,
  PartyPopper,
  Bed,
  BedDouble,
  Wine,
  UserPlus,
  Car,
  Trash2,
  Search,
  Eye,
  Download,
  FileBarChart,
  RotateCcw,
  Loader2,
  Printer,
  History
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, sectionTitle } from '../FrontOffice/brandTheme';
import StatCard from '../FrontOffice/StatCard';
import BanquetInventoryModule from './BanquetInventoryModule';
import BanquetStaffManagement from './BanquetStaffManagement';

type BanquetEventsView = 
  | 'dashboard'
  | 'calendar'
  | 'event-setup'
  | 'room-blocks'
  | 'planning'
  | 'catering'
  | 'inventory-requisition'
  | 'logistics'
  | 'beo'
  | 'execution'
  | 'coordination'
  | 'guest-experience'
  | 'staff'
  | 'billing'
  | 'reports'
  | 'configuration';

type EventStatus = 'Inquiry' | 'Tentative' | 'Confirmed' | 'Planning' | 'InProgress' | 'Completed' | 'Cancelled';
type EventType = 'Wedding' | 'Conference' | 'Seminar' | 'Meeting' | 'GalaDinner' | 'Birthday' | 'Anniversary' | 'Graduation' | 'ReligiousEvent' | 'Exhibition' | 'CocktailReception' | 'ProductLaunch' | 'CorporateEvent';
type VenueType = 'Ballroom' | 'ConferenceRoom' | 'MeetingRoom' | 'OutdoorGarden' | 'Poolside' | 'Rooftop' | 'Restaurant' | 'VIPLounge' | 'ExhibitionHall';
type BEOStatus = 'Draft' | 'Review' | 'Approved' | 'Distributed' | 'Revised' | 'Final' | 'Completed';
type TaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Overdue';
type Priority = 'Low' | 'Normal' | 'High' | 'Urgent';

interface Event {
  eventId: string;
  eventName: string;
  eventType: EventType;
  clientId: string;
  clientName: string;
  organizerName: string;
  startDate: string;
  endDate: string;
  venueIds: string[];
  expectedAttendance: number;
  status: EventStatus;
  estimatedRevenue: number;
  actualRevenue: number | null;
  depositAmount: number;
  depositPaid: boolean;
  finalBalance: number;
  finalPaid: boolean;
  packageId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Billing fields from the unified event model (migration 444/445)
  quotedAmount?: number;
  contractedAmount?: number;
  chargesSubtotal?: number;
  discountTotal?: number;
  serviceChargeTotal?: number;
  taxTotal?: number;
  grandTotal?: number;
  depositRequired?: number;
  depositPaidAmount?: number;
  paidTotal?: number;
  balanceDue?: number;
  billingMode?: string;
  billingStatus?: string;
  folioId?: string | null;
  invoiceId?: string | null;
  currency?: string;
  beoGenerated?: boolean;
}

interface Venue {
  venueId: string;
  venueName: string;
  venueType: VenueType;
  capacity: number;
  area: number;
  floor: string;
  features: string[];
  layouts: string[];
  hourlyRate: number;
  dailyRate: number;
  isActive: boolean;
}

interface BEO {
  beoId: string;
  eventId: string;
  eventName: string;
  clientName: string;
  eventDate: string;
  venueIds: string[];
  setupTime: string;
  eventStartTime: string;
  eventEndTime: string;
  breakdownTime: string;
  status: BEOStatus;
  menuItems: string[];
  beverageItems: string[];
  equipment: string[];
  staffing: { role: string; count: number }[];
  specialRequests: string[];
  vipInformation: string[];
  distributedTo: string[];
  distributedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Task {
  taskId: string;
  eventId: string;
  eventName: string;
  title: string;
  description: string;
  assignedTo: string;
  department: string;
  dueDate: string;
  status: TaskStatus;
  priority: Priority;
  createdAt: string;
  completedAt: string | null;
}

interface Alert {
  alertId: string;
  type: 'DepositDue' | 'ContractPending' | 'MenuApprovalPending' | 'RoomSetupDelay' | 'EquipmentShortage' | 'VendorDelay' | 'VIPEvent' | 'LastMinuteChange';
  eventId: string;
  eventName: string;
  message: string;
  severity: 'Info' | 'Warning' | 'Critical';
  isRead: boolean;
  createdAt: string;
}

interface DepartmentReadiness {
  department: string;
  eventId: string;
  eventName: string;
  status: 'NotStarted' | 'InProgress' | 'Ready' | 'Blocked';
  completedTasks: number;
  totalTasks: number;
  notes: string;
  updatedAt: string;
}

interface KPIData {
  eventsToday: number;
  eventsThisWeek: number;
  eventsThisMonth: number;
  confirmedBookings: number;
  tentativeBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  pendingDeposits: number;
  beoCompletion: number;
  taskCompletion: number;
  departmentReadiness: number;
}

interface BanquetEventsPortalProps {
  activeTab?: BanquetEventsView;
  onTabChange?: (tab: BanquetEventsView) => void;
  embedded?: boolean;
  hideNav?: boolean;
}

// Maps active view → label + icon for the portal PageHeader (mirrors F&B modules)
const VIEW_LABELS: Record<BanquetEventsView, string> = {
  dashboard: 'Executive Dashboard',
  calendar: 'Event Calendar',
  'event-setup': 'Event Booking',
  'room-blocks': 'Room Blocks',
  planning: 'Event Planning',
  catering: 'Catering Planning',
  logistics: 'Event Logistics',
  'inventory-requisition': 'Inventory & Requisition',
  beo: 'BEO',
  execution: 'Event Execution',
  coordination: 'Coordination & Comms',
  'guest-experience': 'Guest Experience',
  staff: 'Staff Management',
  billing: 'Billing & Deposits',
  reports: 'Reports',
  configuration: 'Configuration',
};

const VIEW_ICONS: Record<BanquetEventsView, any> = {
  dashboard: BarChart3,
  calendar: Calendar,
  'event-setup': CalendarDays,
  'room-blocks': BedDouble,
  planning: ClipboardList,
  catering: Utensils,
  logistics: Truck,
  'inventory-requisition': Package,
  beo: FileText,
  execution: CheckCircle2,
  coordination: Network,
  'guest-experience': Heart,
  staff: Users,
  billing: DollarSign,
  reports: BarChart3,
  configuration: Settings,
};

// Shared auth + property headers for all banquet-events API calls.
// The property selector persists its choice under 'erp_property_id'; the API
// resolves it from the X-Property-Id header to scope reads and writes.
const banquetHeaders = (withJson = false): Record<string, string> => ({
  ...(withJson ? { 'Content-Type': 'application/json' } : {}),
  Authorization: `Bearer ${localStorage.getItem('hotel_erp_session')}`,
  'X-Property-Id': localStorage.getItem('erp_property_id') || '',
});

const BanquetEventsPortal: React.FC<BanquetEventsPortalProps> = ({ activeTab, embedded = false }) => {
  const { addNotification: addERPNotification } = useERP();
  // Phase 4: prefer activeTab (URL-driven), fall back to internal state
  const [internalActiveView] = useState<BanquetEventsView>('dashboard');
  const activeView = activeTab ?? internalActiveView;
  const [events, setEvents] = useState<Event[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [beos, setBEOs] = useState<BEO[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [kpiData, setKpiData] = useState<KPIData>({
    eventsToday: 0,
    eventsThisWeek: 0,
    eventsThisMonth: 0,
    confirmedBookings: 0,
    tentativeBookings: 0,
    cancelledBookings: 0,
    totalRevenue: 0,
    pendingDeposits: 0,
    beoCompletion: 0,
    taskCompletion: 0,
    departmentReadiness: 0
  });
  const [loading, setLoading] = useState(false);

  const addNotification = (message: string, type: 'success' | 'warning' | 'error' | 'info') => {
    // The ERP notification system doesn't have an 'error' tone; map it to 'warning'.
    const erpType = (type === 'error' ? 'warning' : type) as 'success' | 'warning' | 'info' | 'task';
    addERPNotification(message, erpType, 'Executive');
  };

  const fetchData = async () => {
    setLoading(true);

    const safeJson = async (res: any) => {
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn('Expected JSON but received:', contentType);
        return null;
      }
      try {
        return await res.json();
      } catch (e) {
        console.warn('Failed to parse JSON response:', e);
        return null;
      }
    };

    try {
      const [eventsRes, venuesRes, beosRes, tasksRes, alertsRes, kpiRes] = await Promise.all([
        fetch('/api/banquet-events/events', {
          headers: banquetHeaders()
        }),
        fetch('/api/banquet-events/venues', {
          headers: banquetHeaders()
        }),
        fetch('/api/banquet-events/beos', {
          headers: banquetHeaders()
        }),
        fetch('/api/banquet-events/tasks', {
          headers: banquetHeaders()
        }),
        fetch('/api/banquet-events/alerts', {
          headers: banquetHeaders()
        }),
        fetch('/api/banquet-events/kpis', {
          headers: banquetHeaders()
        })
      ]);

      const events = eventsRes.ok ? await safeJson(eventsRes) : null;
      const venues = venuesRes.ok ? await safeJson(venuesRes) : null;
      const beos = beosRes.ok ? await safeJson(beosRes) : null;
      const tasks = tasksRes.ok ? await safeJson(tasksRes) : null;
      const alerts = alertsRes.ok ? await safeJson(alertsRes) : null;
      const kpi = kpiRes.ok ? await safeJson(kpiRes) : null;

      if (events) setEvents(events);
      if (venues) setVenues(venues);
      if (beos) setBEOs(beos);
      if (tasks) setTasks(tasks);
      if (alerts) setAlerts(alerts);
      if (kpi) setKpiData(kpi);
    } catch (error) {
      console.error('Failed to fetch banquet events data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Helper functions
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Confirmed':
      case 'Approved':
      case 'Ready':
      case 'Completed':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50';
      case 'Tentative':
      case 'Draft':
      case 'NotStarted':
      case 'Pending':
        return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50';
      case 'Planning':
      case 'Review':
      case 'InProgress':
        return 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50';
      case 'Cancelled':
      case 'Blocked':
      case 'Overdue':
        return 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-700/50';
      default:
        return 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700';
    }
  };

  const getPriorityColor = (priority: Priority) => {
    switch (priority) {
      case 'Urgent': return 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-700/50';
      case 'High': return 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50';
      case 'Normal': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50';
      case 'Low': return 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700';
      default: return 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700';
    }
  };

  const getEventTypeIcon = (type: EventType) => {
    switch (type) {
      case 'Wedding': return <Heart className="w-4 h-4" />;
      case 'Conference': return <Users className="w-4 h-4" />;
      case 'Meeting': return <ClipboardList className="w-4 h-4" />;
      case 'GalaDinner': return <Utensils className="w-4 h-4" />;
      case 'Birthday': return <Star className="w-4 h-4" />;
      case 'Exhibition': return <Building2 className="w-4 h-4" />;
      default: return <Calendar className="w-4 h-4" />;
    }
  };

  // Per-user alert acknowledgment (migration 465 / PUT /alerts/:id/ack).
  const acknowledgeAlert = async (alertId: string) => {
    // Optimistic: mark read locally, revert on failure.
    setAlerts(prev => prev.map(a => a.alertId === alertId ? { ...a, isRead: true } : a));
    try {
      const res = await fetch(`/api/banquet-events/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ read: true })
      });
      if (!res.ok) {
        setAlerts(prev => prev.map(a => a.alertId === alertId ? { ...a, isRead: false } : a));
        addNotification('Failed to acknowledge alert', 'warning');
      }
    } catch (e) {
      setAlerts(prev => prev.map(a => a.alertId === alertId ? { ...a, isRead: false } : a));
      addNotification('Failed to acknowledge alert', 'warning');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" id="banquet-events-portal-module">
      {/* Header — hidden when embedded inside the inventory module */}
      {!embedded && activeView !== 'inventory-requisition' && (
      <PageHeader
        title={VIEW_LABELS[activeView] ?? 'Banquet & Events'}
        subtitle={`Banquet & Events · ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`}
        icon={VIEW_ICONS[activeView] ?? BarChart3}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => {
                fetchData();
                addNotification('Data refreshed', 'success', 'Banquet & Events');
              }}
              disabled={loading}
              className={[button.ghost, 'flex items-center gap-2'].join(' ')}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button className={[button.ghost, 'relative flex items-center gap-2'].join(' ')}>
              <Bell className="w-4 h-4" />
              {alerts.filter(a => !a.isRead).length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                  {alerts.filter(a => !a.isRead).length}
                </span>
              )}
            </button>
          </div>
        }
      />
      )}

      {/* Content Views */}
      <div>
        {activeView === 'dashboard' && (
          <ExecutiveDashboardView
            kpiData={kpiData}
            alerts={alerts}
            eventsToday={events.filter((e: Event) => {
              const today = new Date().toISOString().split('T')[0];
              return e.startDate <= today && e.endDate >= today;
            })}
            upcomingEvents={events.filter((e: Event) => e.startDate > new Date().toISOString().split('T')[0]).slice(0, 5)}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            getEventTypeIcon={getEventTypeIcon}
            onAcknowledgeAlert={acknowledgeAlert}
          />
        )}

        {activeView === 'calendar' && (
          <EventCalendarView
            events={events}
            venues={venues}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            getEventTypeIcon={getEventTypeIcon}
          />
        )}

        {activeView === 'event-setup' && (
          <EventSetupView
            venues={venues}
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'room-blocks' && (
          <RoomBlocksView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            addNotification={addNotification}
          />
        )}

        {activeView === 'planning' && (
          <PlanningView
            events={events}
            beos={beos}
            loading={loading}
            onRefresh={fetchData}
            addNotification={addNotification}
          />
        )}

        {activeView === 'catering' && (
          <CateringPlanningView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'inventory-requisition' && <BanquetInventoryModule />}

        {activeView === 'logistics' && (
          <EventLogisticsView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'beo' && (
          <BEOManagementView
            events={events}
            beos={beos}
            loading={loading}
            onRefresh={fetchData}
            addNotification={addNotification}
          />
        )}

        {activeView === 'execution' && (
          <EventExecutionView
            events={events}
            beos={beos}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'coordination' && (
          <CoordinationAndCommunicationView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'guest-experience' && (
          <GuestExperienceView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'staff' && <BanquetStaffManagement />}

        {activeView === 'billing' && (
          <BillingDepositsView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            addNotification={addNotification}
          />
        )}

        {activeView === 'reports' && (
          <ReportsView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}

        {activeView === 'configuration' && (
          <ConfigurationView
            events={events}
            loading={loading}
            onRefresh={fetchData}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        )}
      </div>
    </div>
  );
};

// Generic data hook for event-type sub-views
const useEventTypeData = (type: string, itemsPath: string) => {
  const [items, setItems] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setItemsLoading(true);
    const headers = banquetHeaders();
    const [itemsRes, checklistRes] = await Promise.all([
      fetch(`/api/banquet-events/${itemsPath}`, { headers }),
      fetch(`/api/banquet-events/event-type-checklists?type=${type}`, { headers })
    ]);
    if (itemsRes.ok) {
      try { setItems(await itemsRes.json()); } catch (e) { console.error(`Failed to parse ${itemsPath}:`, e); }
    }
    if (checklistRes.ok) {
      try { setChecklists(await checklistRes.json()); } catch (e) { console.error('Failed to parse checklists:', e); }
    }
    setItemsLoading(false);
  }, [type, itemsPath]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleChecklist = async (id: string, isCompleted: boolean) => {
    try {
      const response = await fetch(`/api/banquet-events/event-type-checklists/${id}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ isCompleted })
      });
      if (response.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Failed to update checklist:', error);
    }
  };

  return { items, checklists, itemsLoading, fetchData, toggleChecklist };
};

// Shared table renderers for event-type sub-views
const EventTypeEventTable = ({ title, events, getStatusColor }: { title: string; events: any[]; getStatusColor: (s: string) => string }) => (
  <SectionCard title={title} icon={Calendar} tone="info" pad="none">
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Event</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Dates</th>
            <th className="px-4 py-3 font-medium">Guests</th>
            <th className="px-4 py-3 font-medium">Revenue</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {events.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-500">No events found</td></tr>
          ) : events.map((event: any) => (
            <tr key={event.eventId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{event.eventName}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.clientName || '—'}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.startDate} {event.endDate && event.endDate !== event.startDate ? ` - ${event.endDate}` : ''}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.expectedAttendance || 0}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">ETB {Math.round((Number(event.grandTotal) || Number(event.quotedAmount) || Number(event.estimatedRevenue) || 0) / 1000)}k</td>
              <td className="px-4 py-3">
                <Badge tone={event.status === 'Confirmed' || event.status === 'Completed' ? 'success' : event.status === 'Cancelled' ? 'danger' : event.status === 'Planning' ? 'warning' : 'info'}>
                  {event.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </SectionCard>
);

const EventTypeChecklistTable = ({ title, checklists, toggleChecklist }: { title: string; checklists: any[]; toggleChecklist: (id: string, v: boolean) => void }) => {
  const [filterEventId, setFilterEventId] = useState<string>('all');
  const eventOptions = Array.from(new Map(checklists.filter((c: any) => c.eventId).map((c: any) => [c.eventId, c.eventName || c.eventId])).entries());

  const filtered = filterEventId === 'all'
    ? checklists
    : checklists.filter((c: any) => c.eventId === filterEventId);

  return (
    <SectionCard title={title} icon={CheckSquare} tone="accent" pad="none">
      <div className="p-4">
        {eventOptions.length > 0 && (
          <select
            value={filterEventId}
            onChange={(e) => setFilterEventId(e.target.value)}
            className="w-full md:w-64 px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 mb-3"
          >
            <option value="all">All Events</option>
            {eventOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium w-12"></th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Assigned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">No checklist items</td></tr>
              ) : filtered.map((item: any) => (
                <tr key={item.checklistId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={item.isCompleted}
                      onChange={(e) => toggleChecklist(item.checklistId, e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    />
                  </td>
                  <td className={`px-4 py-3 ${item.isCompleted ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>{item.itemName}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.eventName || item.eventId || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{item.assignedTo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
};

// Shared expandable events table for event types (mimics Planning UI)
const EventTypeExpandableTable = ({
  title,
  events,
  items,
  checklists,
  itemsLoading,
  getStatusColor,
  itemTitle,
  itemIcon: ItemIcon,
  renderItemRow,
  renderItemForm,
  itemFormState,
  setItemFormState,
  onItemSubmit,
  onChecklistSubmit,
  checklistFormState,
  setChecklistFormState,
  addingItemFor,
  setAddingItemFor,
  addingChecklistFor,
  setAddingChecklistFor,
  toggleChecklist,
  showChecklist = true
}: any) => {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  return (
    <SectionCard title={title} icon={Calendar} tone="info" pad="none">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium w-8"></th>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Dates</th>
              <th className="px-4 py-3 font-medium">Guests</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {events.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-500">No events found</td></tr>
            ) : events.map((event: Event) => {
              const isExpanded = expandedEventId === event.eventId;
              const eventItems = items.filter((it: any) => it.eventId === event.eventId);
              const eventChecklists = checklists.filter((c: any) => c.eventId === event.eventId);
              const completedCount = eventChecklists.filter((c: any) => c.isCompleted).length;
              return (
                <React.Fragment key={event.eventId}>
                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setExpandedEventId(isExpanded ? null : event.eventId)}>
                    <td className="px-4 py-3 text-slate-400">
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{event.eventName}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.clientName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.startDate} - {event.endDate}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.expectedAttendance || 0}</td>
                    <td className="px-4 py-3">
                      <Badge tone={event.status === 'Confirmed' || event.status === 'Completed' ? 'success' : event.status === 'Cancelled' ? 'danger' : event.status === 'Planning' ? 'warning' : 'info'}>
                        {event.status}
                      </Badge>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-50 dark:bg-slate-900/30">
                      <td colSpan={6} className="px-8 py-4">
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 text-[10px] uppercase text-slate-500">
                            <div className="flex items-center gap-2"><ItemIcon size={12} /> {itemTitle}: {eventItems.length}</div>
                            {showChecklist && <div className="flex items-center gap-2"><CheckSquare size={12} /> Checklist: {completedCount}/{eventChecklists.length}</div>}
                          </div>

                          {/* Type-specific items section */}
                          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                              <span className="flex items-center gap-2"><ItemIcon size={12} /> {itemTitle}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingItemFor(addingItemFor === event.eventId ? null : event.eventId);
                                  setItemFormState({ ...itemFormState, eventId: event.eventId });
                                }}
                                className={`${addingItemFor === event.eventId ? button.ghost : button.primary} !text-[10px] !px-2 !py-1 flex items-center gap-1`}
                              >
                                <Plus size={10} />
                                {addingItemFor === event.eventId ? 'Cancel' : 'Add'}
                              </button>
                            </div>

                            {addingItemFor === event.eventId && renderItemForm(event.eventId)}

                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                  {itemsLoading ? (
                                    <tr><td className="px-4 py-3 text-center text-slate-500">Loading...</td></tr>
                                  ) : eventItems.length === 0 ? (
                                    <tr><td className="px-4 py-3 text-center text-slate-500">No {itemTitle.toLowerCase()} yet. Click "Add" to create one.</td></tr>
                                  ) : eventItems.map((item: any) => renderItemRow(item, event))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Checklist section (hidden when showChecklist is false) */}
                          {showChecklist && (
                          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                              <span className="flex items-center gap-2"><CheckSquare size={12} /> Planning Checklist</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingChecklistFor(addingChecklistFor === event.eventId ? null : event.eventId);
                                  setChecklistFormState({ ...checklistFormState, eventId: event.eventId });
                                }}
                                className={`${addingChecklistFor === event.eventId ? button.ghost : button.primary} !text-[10px] !px-2 !py-1 flex items-center gap-1`}
                              >
                                <Plus size={10} />
                                {addingChecklistFor === event.eventId ? 'Cancel' : 'Add Item'}
                              </button>
                            </div>

                            {addingChecklistFor === event.eventId && (
                              <form onSubmit={onChecklistSubmit} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Item Name</label>
                                    <input
                                      type="text"
                                      value={checklistFormState.itemName || ''}
                                      onChange={(e) => setChecklistFormState({ ...checklistFormState, itemName: e.target.value })}
                                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      required
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                                    <select
                                      value={checklistFormState.category || ''}
                                      onChange={(e) => setChecklistFormState({ ...checklistFormState, category: e.target.value })}
                                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                    >
                                      <option value="">Select</option>
                                      <option value="Venue">Venue</option>
                                      <option value="Catering">Catering</option>
                                      <option value="Equipment">Equipment</option>
                                      <option value="Staffing">Staffing</option>
                                      <option value="Logistics">Logistics</option>
                                      <option value="Coordination">Coordination</option>
                                      <option value="Other">Other</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
                                    <input
                                      type="date"
                                      value={checklistFormState.dueDate || ''}
                                      onChange={(e) => setChecklistFormState({ ...checklistFormState, dueDate: e.target.value })}
                                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Assigned To</label>
                                    <input
                                      type="text"
                                      value={checklistFormState.assignedTo || ''}
                                      onChange={(e) => setChecklistFormState({ ...checklistFormState, assignedTo: e.target.value })}
                                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                    />
                                  </div>
                                </div>
                                <div className="flex justify-end">
                                  <button type="submit" className={`${button.primary} !text-xs`}>Add Item</button>
                                </div>
                              </form>
                            )}

                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="text-left text-[10px] uppercase text-slate-500">
                                  <tr>
                                    <th className="px-4 py-2 font-medium w-8"></th>
                                    <th className="px-4 py-2 font-medium">Item</th>
                                    <th className="px-4 py-2 font-medium">Category</th>
                                    <th className="px-4 py-2 font-medium">Due</th>
                                    <th className="px-4 py-2 font-medium">Assigned</th>
                                    <th className="px-4 py-2 font-medium">Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                  {eventChecklists.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-3 text-center text-slate-500">No checklist items yet. Click "Add Item" to create one.</td></tr>
                                  ) : eventChecklists.map((c: any) => (
                                    <tr key={c.checklistId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                      <td className="px-4 py-2">
                                        <input
                                          type="checkbox"
                                          checked={!!c.isCompleted}
                                          onChange={(e) => toggleChecklist(c.checklistId, e.target.checked)}
                                          className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                        />
                                      </td>
                                      <td className={`px-4 py-2 ${c.isCompleted ? 'line-through text-slate-400' : 'font-medium text-slate-900 dark:text-white'}`}>{c.itemName}</td>
                                      <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.category || '—'}</td>
                                      <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.dueDate ? new Date(c.dueDate).toLocaleDateString() : '—'}</td>
                                      <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.assignedTo || '—'}</td>
                                      <td className="px-4 py-2"><Badge tone={c.isCompleted ? 'success' : 'info'}>{c.isCompleted ? 'Done' : 'Open'}</Badge></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          )}

                          {eventItems.length === 0 && (!showChecklist || eventChecklists.length === 0) && (
                            <p className="text-xs text-slate-500 italic">No details for this event yet.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
};

// Event Types Management View — consolidates Wedding, Conference, Meeting, Social and Accommodation
// ── Config-driven event-type management ────────────────────────────────
// Replaces five near-identical per-type views (Wedding/Conference/Meeting/
// Social/GroupAccommodation) with one GenericEventTypeView driven by a
// per-type config object. Each config captures the only things that truly
// differ between the types: the form fields, the row columns, the submit
// endpoint/transform, and the event filter.

type EventTypeFieldType = 'text' | 'number' | 'textarea' | 'select' | 'date' | 'datetime-local' | 'time';

interface EventTypeFieldConfig {
  name: string;
  label: string;
  type: EventTypeFieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
}

interface EventTypeRowColumn {
  label: string;
  key: string;
  format?: 'text' | 'datetime' | 'currency' | 'minutes';
  badge?: { colorMap: Record<string, string>; fallback: string };
}

interface EventTypeConfig {
  id: 'wedding' | 'conference' | 'meeting' | 'social' | 'accommodation';
  label: string;
  icon: any;
  title: string;
  itemTitle: string;
  filter: (events: Event[]) => Event[];
  dataHookArgs: [string, string];
  checklistItemType: string;
  submitEndpoint: string;
  submitTransform: (form: Record<string, any>) => Record<string, any>;
  successMessage: string;
  submitLabel: string;
  formGridCols: number;
  fields: EventTypeFieldConfig[];
  rowColumns: EventTypeRowColumn[];
}

const SOCIAL_EVENT_TYPES = ['Birthday', 'Anniversary', 'Graduation', 'ReligiousEvent'];

const SOCIAL_TYPE_COLORS: Record<string, string> = {
  'Birthday': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'Anniversary': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'Graduation': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'ReligiousEvent': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
};
const SOCIAL_TYPE_FALLBACK = 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300';

const EVENT_TYPE_CONFIGS: EventTypeConfig[] = [
  {
    id: 'wedding',
    label: 'Weddings',
    icon: Heart,
    title: 'Wedding Events',
    itemTitle: 'Wedding Details',
    filter: (events) => events.filter((e) => e.eventType === 'Wedding'),
    dataHookArgs: ['wedding', 'wedding-details'],
    checklistItemType: 'wedding',
    submitEndpoint: '/api/banquet-events/wedding-details',
    submitTransform: (f) => ({ ...f, guestCount: parseInt(f.guestCount), budget: parseFloat(f.budget) }),
    successMessage: 'Wedding details saved successfully',
    submitLabel: 'Save Details',
    formGridCols: 3,
    fields: [
      { name: 'brideName', label: 'Bride Name', type: 'text', required: true },
      { name: 'groomName', label: 'Groom Name', type: 'text', required: true },
      { name: 'ceremonyLocation', label: 'Ceremony Location', type: 'text' },
      { name: 'receptionLocation', label: 'Reception Location', type: 'text' },
      { name: 'guestCount', label: 'Guest Count', type: 'number', required: true },
      { name: 'budget', label: 'Budget', type: 'number', required: true },
      { name: 'theme', label: 'Theme', type: 'text' },
      { name: 'colorScheme', label: 'Color Scheme', type: 'text' },
      { name: 'specialRequests', label: 'Special Requests', type: 'textarea' },
    ],
    rowColumns: [
      { label: 'Bride', key: 'brideName' },
      { label: 'Groom', key: 'groomName' },
      { label: 'Ceremony', key: 'ceremonyLocation' },
      { label: 'Reception', key: 'receptionLocation' },
      { label: 'Guests', key: 'guestCount' },
      { label: 'Budget', key: 'budget', format: 'currency' },
      { label: 'Theme', key: 'theme' },
    ],
  },
  {
    id: 'conference',
    label: 'Conferences',
    icon: Users,
    title: 'Conference Events',
    itemTitle: 'Conference Sessions',
    filter: (events) => events.filter((e) => e.eventType === 'Conference'),
    dataHookArgs: ['conference', 'conference-sessions'],
    checklistItemType: 'conference',
    submitEndpoint: '/api/banquet-events/conference-sessions',
    submitTransform: (f) => ({ ...f, capacity: parseInt(f.capacity) }),
    successMessage: 'Conference session added successfully',
    submitLabel: 'Add Session',
    formGridCols: 3,
    fields: [
      { name: 'sessionTitle', label: 'Session Title', type: 'text', required: true },
      { name: 'speaker', label: 'Speaker', type: 'text' },
      { name: 'room', label: 'Room', type: 'text' },
      { name: 'startTime', label: 'Start Time', type: 'datetime-local', required: true },
      { name: 'endTime', label: 'End Time', type: 'datetime-local', required: true },
      { name: 'capacity', label: 'Capacity', type: 'number' },
      { name: 'equipment', label: 'Equipment', type: 'text' },
    ],
    rowColumns: [
      { label: 'Session', key: 'sessionTitle' },
      { label: 'Speaker', key: 'speaker' },
      { label: 'Room', key: 'room' },
      { label: 'Capacity', key: 'capacity' },
      { label: 'Start', key: 'startTime', format: 'datetime' },
      { label: 'End', key: 'endTime', format: 'datetime' },
    ],
  },
  {
    id: 'meeting',
    label: 'Meetings',
    icon: ClipboardList,
    title: 'Meeting Events',
    itemTitle: 'Meeting Agenda',
    filter: (events) => events.filter((e) => e.eventType === 'Meeting'),
    dataHookArgs: ['meeting', 'meeting-agenda'],
    checklistItemType: 'meeting',
    submitEndpoint: '/api/banquet-events/meeting-agenda',
    submitTransform: (f) => ({ ...f, duration: parseInt(f.duration) }),
    successMessage: 'Agenda item added successfully',
    submitLabel: 'Add Agenda Item',
    formGridCols: 4,
    fields: [
      { name: 'agendaItem', label: 'Agenda Item', type: 'text', required: true },
      { name: 'duration', label: 'Duration (min)', type: 'number', required: true },
      { name: 'presenter', label: 'Presenter', type: 'text' },
      { name: 'timeSlot', label: 'Time Slot', type: 'time' },
    ],
    rowColumns: [
      { label: 'Agenda Item', key: 'agendaItem' },
      { label: 'Presenter', key: 'presenter' },
      { label: 'Duration', key: 'duration', format: 'minutes' },
      { label: 'Time Slot', key: 'timeSlot' },
    ],
  },
  {
    id: 'social',
    label: 'Social Events',
    icon: PartyPopper,
    title: 'Social Events',
    itemTitle: 'Event Details',
    filter: (events) => events.filter((e) => SOCIAL_EVENT_TYPES.includes(e.eventType)),
    dataHookArgs: ['social', 'social-details'],
    checklistItemType: 'social',
    submitEndpoint: '/api/banquet-events/social-details',
    submitTransform: (f) => ({ ...f, age: parseInt(f.age) }),
    successMessage: 'Social event details saved successfully',
    submitLabel: 'Save Details',
    formGridCols: 3,
    fields: [
      {
        name: 'eventType', label: 'Event Type', type: 'select', required: true,
        options: [
          { value: 'Birthday', label: 'Birthday' },
          { value: 'Anniversary', label: 'Anniversary' },
          { value: 'Graduation', label: 'Graduation' },
          { value: 'ReligiousEvent', label: 'Religious Event' },
        ],
      },
      { name: 'honoreeName', label: 'Honoree Name', type: 'text', required: true },
      { name: 'age', label: 'Age/Years', type: 'number' },
      { name: 'theme', label: 'Theme', type: 'text' },
      { name: 'specialRequirements', label: 'Special Requirements', type: 'textarea' },
      { name: 'dietaryRestrictions', label: 'Dietary Restrictions', type: 'textarea' },
    ],
    rowColumns: [
      { label: 'Honoree', key: 'honoreeName' },
      { label: 'Type', key: 'eventType', badge: { colorMap: SOCIAL_TYPE_COLORS, fallback: SOCIAL_TYPE_FALLBACK } },
      { label: 'Age/Years', key: 'age' },
      { label: 'Theme', key: 'theme' },
      { label: 'Dietary', key: 'dietaryRestrictions' },
    ],
  },
  {
    id: 'accommodation',
    label: 'Group Accommodation',
    icon: Bed,
    title: 'Events Requiring Accommodation',
    itemTitle: 'Room Blocks',
    filter: (events) => events.filter((e) => !!e.endDate && e.endDate !== e.startDate),
    dataHookArgs: ['roomblock', 'room-blocks'],
    checklistItemType: 'roomblock',
    submitEndpoint: '/api/banquet-events/room-blocks',
    submitTransform: (f) => ({ ...f, roomCount: parseInt(f.roomCount), ratePerRoom: parseFloat(f.ratePerRoom) }),
    successMessage: 'Room block created successfully',
    submitLabel: 'Create Room Block',
    formGridCols: 3,
    fields: [
      {
        name: 'roomType', label: 'Room Type', type: 'select', required: true,
        options: [
          { value: 'Standard', label: 'Standard Room' },
          { value: 'Deluxe', label: 'Deluxe Room' },
          { value: 'Suite', label: 'Suite' },
          { value: 'Executive', label: 'Executive Suite' },
        ],
      },
      { name: 'roomCount', label: 'Number of Rooms', type: 'number', required: true },
      { name: 'ratePerRoom', label: 'Rate Per Room', type: 'number', required: true },
      { name: 'checkInDate', label: 'Check-in Date', type: 'date', required: true },
      { name: 'checkOutDate', label: 'Check-out Date', type: 'date', required: true },
      { name: 'specialRequests', label: 'Special Requests', type: 'textarea' },
    ],
    rowColumns: [
      { label: 'Room Type', key: 'roomType' },
      { label: 'Rooms', key: 'roomCount' },
      { label: 'Check-in', key: 'checkInDate' },
      { label: 'Check-out', key: 'checkOutDate' },
      { label: 'Rate', key: 'ratePerRoom', format: 'currency' },
    ],
  },
];

const formatEventRowValue = (item: any, col: EventTypeRowColumn): string => {
  const raw = item[col.key];
  switch (col.format) {
    case 'datetime': return raw ? new Date(raw).toLocaleString() : '—';
    case 'currency': return raw ? `ETB ${Number(raw).toLocaleString()}` : '—';
    case 'minutes': return raw ? `${raw} min` : '—';
    default: return raw || '—';
  }
};

const GenericEventTypeView = ({ config, events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const emptyForm: Record<string, string> = { eventId: '', ...Object.fromEntries(config.fields.map((f: EventTypeFieldConfig) => [f.name, ''])) };
  const [itemForm, setItemForm] = useState<Record<string, any>>(emptyForm);
  const [checklistForm, setChecklistForm] = useState({ eventId: '', itemName: '', category: '', dueDate: '', assignedTo: '' });
  const [addingItemFor, setAddingItemFor] = useState<string | null>(null);
  const [addingChecklistFor, setAddingChecklistFor] = useState<string | null>(null);
  const { items, checklists, itemsLoading, fetchData, toggleChecklist } = useEventTypeData(config.dataHookArgs[0], config.dataHookArgs[1]);

  const filteredEvents = config.filter(events);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(config.submitEndpoint, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(config.submitTransform(itemForm))
      });
      if (response.ok) {
        addNotification(config.successMessage, 'success');
        setAddingItemFor(null);
        setItemForm({ ...emptyForm });
        onRefresh();
        fetchData();
      }
    } catch (error) {
      addNotification('Failed to save details', 'warning');
    }
  };

  const handleChecklistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/event-type-checklists', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...checklistForm, itemType: config.checklistItemType })
      });
      if (response.ok) {
        addNotification('Checklist item added successfully', 'success');
        setAddingChecklistFor(null);
        setChecklistForm({ eventId: '', itemName: '', category: '', dueDate: '', assignedTo: '' });
        fetchData();
      }
    } catch (error) {
      addNotification('Failed to add checklist item', 'warning');
    }
  };

  const inputClass = "w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white";

  const renderField = (field: EventTypeFieldConfig) => {
    if (field.type === 'select') {
      return (
        <div key={field.name}>
          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">{field.label}</label>
          <select value={itemForm[field.name] || ''} onChange={(e) => setItemForm({ ...itemForm, [field.name]: e.target.value })} className={inputClass} required={field.required}>
            <option value="">{field.required ? 'Select' : '--'}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      );
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.name}>
          <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">{field.label}</label>
          <textarea value={itemForm[field.name] || ''} onChange={(e) => setItemForm({ ...itemForm, [field.name]: e.target.value })} className={inputClass} rows={2} />
        </div>
      );
    }
    return (
      <div key={field.name}>
        <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">{field.label}</label>
        <input type={field.type} value={itemForm[field.name] || ''} onChange={(e) => setItemForm({ ...itemForm, [field.name]: e.target.value })} className={inputClass} required={field.required} />
      </div>
    );
  };

  const renderItemForm = () => (
    <form onSubmit={handleSubmit} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
      <div className={`grid grid-cols-2 md:grid-cols-${config.formGridCols} gap-3`}>
        {config.fields.filter((f: EventTypeFieldConfig) => f.type !== 'textarea').map(renderField)}
      </div>
      {config.fields.filter((f: EventTypeFieldConfig) => f.type === 'textarea').map(renderField)}
      <div className="flex justify-end">
        <button type="submit" className={`${button.primary} !text-xs`}>{config.submitLabel}</button>
      </div>
    </form>
  );

  const renderItemRow = (item: any) => (
    <tr key={item.itemId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
      <td className="px-4 py-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {config.rowColumns.map((col: EventTypeRowColumn, idx: number) => (
            <div key={col.key}>
              <span className="text-[10px] text-slate-400">{col.label}</span>
              {col.badge ? (
                <div><span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${col.badge.colorMap[item[col.key]] || col.badge.fallback}`}>{item[col.key] || '—'}</span></div>
              ) : (
                <div className={idx === 0 ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}>{formatEventRowValue(item, col)}</div>
              )}
            </div>
          ))}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <EventTypeExpandableTable
        title={config.title}
        events={filteredEvents}
        items={items}
        checklists={checklists}
        itemsLoading={itemsLoading}
        getStatusColor={getStatusColor}
        itemTitle={config.itemTitle}
        itemIcon={config.icon}
        renderItemRow={renderItemRow}
        renderItemForm={renderItemForm}
        itemFormState={itemForm}
        setItemFormState={setItemForm}
        onItemSubmit={handleSubmit}
        onChecklistSubmit={handleChecklistSubmit}
        checklistFormState={checklistForm}
        setChecklistFormState={setChecklistForm}
        addingItemFor={addingItemFor}
        setAddingItemFor={setAddingItemFor}
        addingChecklistFor={addingChecklistFor}
        setAddingChecklistFor={setAddingChecklistFor}
        toggleChecklist={toggleChecklist}
        showChecklist={false}
      />
    </div>
  );
};

// Reusable tab switcher used by the consolidated wrapper views. Supports two
// styling variants: 'color' (per-tab color chip) and 'button' (primary/ghost).
interface TabDef { id: string; label: string; icon: any; color?: string }
const TabSwitcher = <T extends string>({ tabs, active, onChange, variant = 'color', borderB = false }: {
  tabs: readonly TabDef[]; active: T; onChange: (id: T) => void; variant?: 'color' | 'button'; borderB?: boolean;
}) => {
  return (
    <div className={`flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto${borderB ? ' border-b border-gray-200 dark:border-slate-700 pb-4' : ''}`}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id as T)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              isActive
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};

const EventTypeManagementView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [activeEventType, setActiveEventType] = useState<'wedding' | 'conference' | 'meeting' | 'social' | 'accommodation'>('wedding');

  const eventTypeTabs = [
    { id: 'wedding', label: 'Weddings', icon: Heart, color: 'pink' },
    { id: 'conference', label: 'Conferences', icon: Users, color: 'blue' },
    { id: 'meeting', label: 'Meetings', icon: ClipboardList, color: 'emerald' },
    { id: 'social', label: 'Social Events', icon: Star, color: 'amber' },
    { id: 'accommodation', label: 'Group Accommodation', icon: Bed, color: 'indigo' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Event Types</h3>
      </div>

      <TabSwitcher tabs={eventTypeTabs} active={activeEventType} onChange={setActiveEventType} />

      {(() => {
        const config = EVENT_TYPE_CONFIGS.find((c) => c.id === activeEventType);
        if (!config) return null;
        return (
          <GenericEventTypeView
            config={config}
            events={events}
            loading={loading}
            onRefresh={onRefresh}
            getStatusColor={getStatusColor}
            addNotification={addNotification}
          />
        );
      })()}
    </div>
  );
};

const beverageCategories = ['Beer', 'Wine', 'Cocktail', 'Spirits', 'Soft Drinks', 'SoftDrinks', 'Juice', 'Water', 'Coffee', 'Tea', 'Beverage'];
const isFbBeverage = (category?: string) => beverageCategories.some((c) => category?.toLowerCase() === c.toLowerCase());

// Catering Planning View — unified Menu and Beverage planning per event, integrated with F&B catalog
const CateringPlanningView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [beverages, setBeverages] = useState<any[]>([]);
  const [fbMenuItems, setFbMenuItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [addingDishFor, setAddingDishFor] = useState<string | null>(null);
  const [addingBeverageFor, setAddingBeverageFor] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [menuForm, setMenuForm] = useState({
    eventId: '',
    menuItemId: '',
    menuType: '',
    courseType: '',
    dishName: '',
    dietary: '',
    quantity: '',
    unitPrice: '',
    specialNotes: ''
  });
  const [beverageForm, setBeverageForm] = useState({
    eventId: '',
    menuItemId: '',
    beverageType: '',
    category: '',
    name: '',
    quantity: '',
    unitPrice: '',
    serviceType: '',
    specialNotes: ''
  });

  const authHeaders = banquetHeaders();

  const fetchData = useCallback(async () => {
    setItemsLoading(true);
    try {
      const [mRes, bRes, fbRes] = await Promise.all([
        fetch('/api/banquet-events/menu-items', { headers: authHeaders }),
        fetch('/api/banquet-events/beverages', { headers: authHeaders }),
        fetch('/api/banquet-events/fb-menu-items', { headers: authHeaders })
      ]);
      if (mRes.ok) {
        const data = await mRes.json();
        setMenuItems(Array.isArray(data) ? data : []);
      }
      if (bRes.ok) {
        const data = await bRes.json();
        setBeverages(Array.isArray(data) ? data : []);
      }
      if (fbRes.ok) {
        const data = await fbRes.json();
        setFbMenuItems(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load catering data:', e);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fbDishes = fbMenuItems.filter((i: any) => !isFbBeverage(i.category));
  const fbBeverages = fbMenuItems.filter((i: any) => isFbBeverage(i.category));

  const mapFbCategoryToCourse = (cat?: string) => {
    const c = (cat || '').toLowerCase();
    if (c.includes('appetizer') || c.includes('bar bite') || c.includes('starter')) return 'Appetizer';
    if (c.includes('soup')) return 'Soup';
    if (c.includes('salad')) return 'Salad';
    if (c.includes('main') || c.includes('entr') || c.includes('breakfast') || c.includes('lunch')) return 'Main';
    if (c.includes('dessert')) return 'Dessert';
    if (c.includes('beverage') || c.includes('drink')) return 'Beverage';
    return 'Main';
  };

  const mapFbCategoryToBeverage = (cat?: string) => {
    const c = (cat || '').toLowerCase().replace(/\s/g, '');
    if (c === 'cocktail' || c === 'cocktails') return 'Cocktails';
    if (c === 'softdrink' || c === 'softdrinks' || c === 'soft') return 'SoftDrinks';
    if (c === 'tea') return 'Coffee';
    if (['beer', 'wine', 'spirits', 'cocktails', 'softdrinks', 'juice', 'water', 'coffee'].includes(c)) {
      return c.charAt(0).toUpperCase() + c.slice(1);
    }
    return cat || '';
  };

  const inferBeverageType = (cat?: string) => {
    const c = (cat || '').toLowerCase();
    if (['beer', 'wine', 'spirits', 'cocktail'].some(k => c.includes(k))) return 'Alcoholic';
    if (c.includes('non')) return 'NonAlcoholic';
    return 'NonAlcoholic';
  };

  const onSelectFbDish = (menuItemId: string) => {
    const item = fbDishes.find((i: any) => i.menuItemId === menuItemId);
    setMenuForm(f => ({
      ...f,
      menuItemId,
      dishName: item?.name || f.dishName,
      courseType: item?.category ? mapFbCategoryToCourse(item.category) : f.courseType,
      unitPrice: item?.sellingPrice != null ? String(item.sellingPrice) : f.unitPrice
    }));
  };

  const onSelectFbBeverage = (menuItemId: string) => {
    const item = fbBeverages.find((i: any) => i.menuItemId === menuItemId);
    setBeverageForm(f => ({
      ...f,
      menuItemId,
      name: item?.name || f.name,
      beverageType: item?.category ? inferBeverageType(item.category) : f.beverageType,
      category: item?.category ? mapFbCategoryToBeverage(item.category) : f.category,
      unitPrice: item?.sellingPrice != null ? String(item.sellingPrice) : f.unitPrice
    }));
  };

  const handleMenuSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/menu-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...menuForm, quantity: parseInt(menuForm.quantity), unitPrice: menuForm.unitPrice ? parseFloat(menuForm.unitPrice) : undefined })
      });
      if (response.ok) {
        addNotification('Dish added successfully', 'success');
        setAddingDishFor(null);
        setMenuForm({ eventId: '', menuItemId: '', menuType: '', courseType: '', dishName: '', dietary: '', quantity: '', unitPrice: '', specialNotes: '' });
        fetchData();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add dish', 'warning');
    }
  };

  const handleBeverageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/beverages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...beverageForm, quantity: parseInt(beverageForm.quantity), unitPrice: beverageForm.unitPrice ? parseFloat(beverageForm.unitPrice) : undefined })
      });
      if (response.ok) {
        addNotification('Beverage added successfully', 'success');
        setAddingBeverageFor(null);
        setBeverageForm({ eventId: '', menuItemId: '', beverageType: '', category: '', name: '', quantity: '', unitPrice: '', serviceType: '', specialNotes: '' });
        fetchData();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add beverage', 'warning');
    }
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/menu-items/${itemId}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        addNotification('Dish removed', 'success');
        fetchData();
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to remove dish', 'warning');
    }
  };

  // Menu approval workflow (462): event-level decision via PUT
  // /events/:id/menu-status; per-dish approval via generic PUT /menu-items/:id.
  const handleMenuStatus = async (eventId: string, status: string) => {
    try {
      const res = await fetch(`/api/banquet-events/events/${eventId}/menu-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        addNotification(`Menu ${status.toLowerCase()}`, 'success');
        fetchData();
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to update menu status', 'warning');
      }
    } catch (e) {
      addNotification('Failed to update menu status', 'warning');
    }
  };

  const handleItemApproval = async (itemId: string, approvalStatus: string) => {
    try {
      const res = await fetch(`/api/banquet-events/menu-items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ approvalStatus })
      });
      if (res.ok) {
        fetchData();
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to update dish approval', 'warning');
    }
  };

  const handleDeleteBeverage = async (itemId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/beverages/${itemId}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        addNotification('Beverage removed', 'success');
        fetchData();
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to remove beverage', 'warning');
    }
  };

  const getDietaryTone = (d: string): 'success' | 'warning' | 'info' | 'neutral' => {
    if (d === 'Vegan' || d === 'Vegetarian') return 'success';
    if (d === 'GlutenFree' || d === 'Halal' || d === 'Kosher') return 'warning';
    return 'info';
  };

  const getCategoryTone = (c: string): 'success' | 'warning' | 'info' | 'neutral' => {
    const v = (c || '').toLowerCase().replace(/\s/g, '');
    if (v === 'wine' || v === 'spirits') return 'warning';
    if (v === 'cocktails') return 'info';
    if (['softdrinks', 'softdrink', 'water', 'juice', 'coffee', 'tea', 'nonalcoholic'].includes(v)) return 'success';
    return 'neutral';
  };

  const formatPrice = (p: any) => {
    if (p == null || p === '') return '—';
    return `$${Number(p).toFixed(2)}`;
  };

  const filteredEvents = events.filter((e: Event) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term ||
      e.eventName.toLowerCase().includes(term) ||
      e.clientName.toLowerCase().includes(term) ||
      e.eventType.toLowerCase().includes(term);
    const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
    const matchesType = filterType === 'all' || e.eventType === filterType;
    return matchesSearch && matchesStatus && matchesType;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search event, client or type"
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Statuses</option>
          <option value="Inquiry">Inquiry</option>
          <option value="Tentative">Tentative</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Planning">Planning</option>
          <option value="InProgress">In Progress</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Event Types</option>
          <option value="Anniversary">Anniversary</option>
          <option value="Birthday">Birthday</option>
          <option value="CocktailReception">Cocktail Reception</option>
          <option value="Conference">Conference</option>
          <option value="CorporateEvent">Corporate Event</option>
          <option value="Exhibition">Exhibition</option>
          <option value="GalaDinner">Gala Dinner</option>
          <option value="Graduation">Graduation</option>
          <option value="Meeting">Meeting</option>
          <option value="ProductLaunch">Product Launch</option>
          <option value="ReligiousEvent">Religious Event</option>
          <option value="Wedding">Wedding</option>
        </select>
      </div>
      <SectionCard title="Catering Planning" icon={Utensils} tone="warning" pad="none">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium w-8"></th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Dishes</th>
                <th className="px-4 py-3 font-medium">Beverages</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {filteredEvents.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-4 text-center text-slate-500">No events found</td></tr>
              ) : filteredEvents.map((event: Event) => {
                const isExpanded = expandedEventId === event.eventId;
                const eventMenuItems = menuItems.filter((m: any) => m.eventId === event.eventId);
                const eventBeverages = beverages.filter((b: any) => b.eventId === event.eventId);
                return (
                  <React.Fragment key={event.eventId}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setExpandedEventId(isExpanded ? null : event.eventId)}>
                      <td className="px-4 py-3 text-slate-400">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{event.eventName}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.clientName || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.startDate} - {event.endDate}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{eventMenuItems.length}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{eventBeverages.length}</td>
                      <td className="px-4 py-3">
                        <Badge tone={event.status === 'Confirmed' || event.status === 'Completed' ? 'success' : event.status === 'Cancelled' ? 'danger' : event.status === 'Planning' ? 'warning' : 'info'}>
                          {event.status}
                        </Badge>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 dark:bg-slate-900/30">
                        <td colSpan={7} className="px-8 py-4">
                          <div className="space-y-4">
                            {/* Menu Items */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <Utensils size={12} /> Menu Items
                                  {eventMenuItems.length > 0 && (
                                    <Badge tone={event.menuStatus === 'Approved' ? 'success' : event.menuStatus === 'Rejected' ? 'danger' : 'warning'}>
                                      {event.menuStatus || 'Draft'}
                                    </Badge>
                                  )}
                                </span>
                                <span className="flex items-center gap-1">
                                  {eventMenuItems.length > 0 && event.menuStatus !== 'Approved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMenuStatus(event.eventId, 'Approved')}
                                      className="!text-[10px] !px-2 !py-1 flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-lg font-bold hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
                                      title="Approve the full menu"
                                    >
                                      <CheckCircle2 size={10} /> Approve Menu
                                    </button>
                                  )}
                                  {event.menuStatus === 'Approved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMenuStatus(event.eventId, 'Rejected')}
                                      className="!text-[10px] !px-2 !py-1 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 rounded-lg font-bold hover:bg-rose-200 dark:hover:bg-rose-900/50"
                                      title="Send menu back for changes"
                                    >
                                      Request Changes
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddingDishFor(addingDishFor === event.eventId ? null : event.eventId);
                                      setAddingBeverageFor(null);
                                      setMenuForm({ eventId: event.eventId, menuItemId: '', menuType: '', courseType: '', dishName: '', dietary: '', quantity: '', unitPrice: '', specialNotes: '' });
                                    }}
                                    className={`${addingDishFor === event.eventId ? button.ghost : button.primary} !text-[10px] !px-2 !py-1 flex items-center gap-1`}
                                  >
                                    <Plus size={10} />
                                    {addingDishFor === event.eventId ? 'Cancel' : 'Add Dish'}
                                  </button>
                                </span>
                              </div>

                              {addingDishFor === event.eventId && (
                                <form onSubmit={handleMenuSubmit} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div className="col-span-2 md:col-span-3">
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">F&B Menu Item (optional)</label>
                                      <select
                                        value={menuForm.menuItemId}
                                        onChange={(e) => onSelectFbDish(e.target.value)}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      >
                                        <option value="">-- Custom dish --</option>
                                        {fbDishes.map((item: any) => (
                                          <option key={item.menuItemId} value={item.menuItemId}>{item.name} ({item.category}) — {formatPrice(item.sellingPrice)}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Menu Type</label>
                                      <select value={menuForm.menuType} onChange={(e) => setMenuForm({ ...menuForm, menuType: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                                        <option value="">Select</option>
                                        <option value="Buffet">Buffet</option>
                                        <option value="Plated">Plated Service</option>
                                        <option value="Cocktail">Cocktail Reception</option>
                                        <option value="Tea">High Tea</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Course</label>
                                      <select value={menuForm.courseType} onChange={(e) => setMenuForm({ ...menuForm, courseType: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                                        <option value="">Select</option>
                                        <option value="Appetizer">Appetizer</option>
                                        <option value="Soup">Soup</option>
                                        <option value="Salad">Salad</option>
                                        <option value="Main">Main Course</option>
                                        <option value="Dessert">Dessert</option>
                                        <option value="Beverage">Beverage</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Dish Name</label>
                                      <input type="text" value={menuForm.dishName} onChange={(e) => setMenuForm({ ...menuForm, dishName: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Dietary</label>
                                      <select value={menuForm.dietary} onChange={(e) => setMenuForm({ ...menuForm, dietary: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white">
                                        <option value="">Select</option>
                                        <option value="Regular">Regular</option>
                                        <option value="Vegetarian">Vegetarian</option>
                                        <option value="Vegan">Vegan</option>
                                        <option value="GlutenFree">Gluten-Free</option>
                                        <option value="Halal">Halal</option>
                                        <option value="Kosher">Kosher</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                                      <input type="number" value={menuForm.quantity} onChange={(e) => setMenuForm({ ...menuForm, quantity: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Unit Price</label>
                                      <input type="number" step="0.01" value={menuForm.unitPrice} onChange={(e) => setMenuForm({ ...menuForm, unitPrice: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Special Notes</label>
                                      <input type="text" value={menuForm.specialNotes} onChange={(e) => setMenuForm({ ...menuForm, specialNotes: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                                    </div>
                                  </div>
                                  <div className="flex justify-end">
                                    <button type="submit" className={`${button.primary} !text-xs`}>Add Dish</button>
                                  </div>
                                </form>
                              )}

                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-left text-[10px] uppercase text-slate-500">
                                    <tr>
                                      <th className="px-4 py-2 font-medium">Dish</th>
                                      <th className="px-4 py-2 font-medium">F&B Item</th>
                                      <th className="px-4 py-2 font-medium">Menu Type</th>
                                      <th className="px-4 py-2 font-medium">Course</th>
                                      <th className="px-4 py-2 font-medium">Dietary</th>
                                      <th className="px-4 py-2 font-medium">Qty</th>
                                      <th className="px-4 py-2 font-medium">Unit</th>
                                      <th className="px-4 py-2 font-medium">Approval</th>
                                      <th className="px-4 py-2 font-medium">Notes</th>
                                      <th className="px-4 py-2 font-medium"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {itemsLoading ? (
                                      <tr><td colSpan={10} className="px-4 py-3 text-center text-slate-500">Loading...</td></tr>
                                    ) : eventMenuItems.length === 0 ? (
                                      <tr><td colSpan={10} className="px-4 py-3 text-center text-slate-500">No dishes yet. Click "Add Dish" to create one.</td></tr>
                                    ) : eventMenuItems.map((m: any) => (
                                      <tr key={m.itemId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">{m.dishName}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.fbItemName || '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.menuType || '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.courseType || '—'}</td>
                                        <td className="px-4 py-2">{m.dietary ? <Badge tone={getDietaryTone(m.dietary)}>{m.dietary}</Badge> : '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.quantity || 0}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{formatPrice(m.unitPrice != null ? m.unitPrice : m.fbSellingPrice)}</td>
                                        <td className="px-4 py-2">
                                          <button
                                            onClick={() => handleItemApproval(m.itemId, m.approvalStatus === 'Approved' ? 'Pending' : 'Approved')}
                                            title={m.approvalStatus === 'Approved' ? 'Revoke approval' : 'Approve dish'}
                                          >
                                            <Badge tone={m.approvalStatus === 'Approved' ? 'success' : m.approvalStatus === 'Rejected' ? 'danger' : 'neutral'}>
                                              {m.approvalStatus || 'Pending'}
                                            </Badge>
                                          </button>
                                        </td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.specialNotes || '—'}</td>
                                        <td className="px-4 py-2 text-right">
                                          <button onClick={() => handleDeleteMenuItem(m.itemId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                                            <Trash2 size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Beverages */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                                <span className="flex items-center gap-2"><Wine size={12} /> Beverages</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddingBeverageFor(addingBeverageFor === event.eventId ? null : event.eventId);
                                    setAddingDishFor(null);
                                    setBeverageForm({ eventId: event.eventId, menuItemId: '', beverageType: '', category: '', name: '', quantity: '', unitPrice: '', serviceType: '', specialNotes: '' });
                                  }}
                                  className={`${addingBeverageFor === event.eventId ? button.ghost : button.primary} !text-[10px] !px-2 !py-1 flex items-center gap-1`}
                                >
                                  <Plus size={10} />
                                  {addingBeverageFor === event.eventId ? 'Cancel' : 'Add Beverage'}
                                </button>
                              </div>

                              {addingBeverageFor === event.eventId && (
                                <form onSubmit={handleBeverageSubmit} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div className="col-span-2 md:col-span-3">
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">F&B Beverage (optional)</label>
                                      <select
                                        value={beverageForm.menuItemId}
                                        onChange={(e) => onSelectFbBeverage(e.target.value)}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      >
                                        <option value="">-- Custom beverage --</option>
                                        {fbBeverages.map((item: any) => (
                                          <option key={item.menuItemId} value={item.menuItemId}>{item.name} ({item.category}) — {formatPrice(item.sellingPrice)}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Beverage Type</label>
                                      <select value={beverageForm.beverageType} onChange={(e) => setBeverageForm({ ...beverageForm, beverageType: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                                        <option value="">Select</option>
                                        <option value="Alcoholic">Alcoholic</option>
                                        <option value="NonAlcoholic">Non-Alcoholic</option>
                                        <option value="Mixed">Mixed Drinks</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                                      <select value={beverageForm.category} onChange={(e) => setBeverageForm({ ...beverageForm, category: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                                        <option value="">Select</option>
                                        <option value="Wine">Wine</option>
                                        <option value="Beer">Beer</option>
                                        <option value="Spirits">Spirits</option>
                                        <option value="Cocktails">Cocktails</option>
                                        <option value="SoftDrinks">Soft Drinks</option>
                                        <option value="Juice">Juice</option>
                                        <option value="Water">Water</option>
                                        <option value="Coffee">Coffee/Tea</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Name</label>
                                      <input type="text" value={beverageForm.name} onChange={(e) => setBeverageForm({ ...beverageForm, name: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                                      <input type="number" value={beverageForm.quantity} onChange={(e) => setBeverageForm({ ...beverageForm, quantity: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Unit Price</label>
                                      <input type="number" step="0.01" value={beverageForm.unitPrice} onChange={(e) => setBeverageForm({ ...beverageForm, unitPrice: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Service Type</label>
                                      <select value={beverageForm.serviceType} onChange={(e) => setBeverageForm({ ...beverageForm, serviceType: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white">
                                        <option value="">Select</option>
                                        <option value="Bar">Full Bar Service</option>
                                        <option value="Package">Package Service</option>
                                        <option value="SelfServe">Self-Serve</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Special Notes</label>
                                      <input type="text" value={beverageForm.specialNotes} onChange={(e) => setBeverageForm({ ...beverageForm, specialNotes: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                                    </div>
                                  </div>
                                  <div className="flex justify-end">
                                    <button type="submit" className={`${button.primary} !text-xs`}>Add Beverage</button>
                                  </div>
                                </form>
                              )}

                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-left text-[10px] uppercase text-slate-500">
                                    <tr>
                                      <th className="px-4 py-2 font-medium">Name</th>
                                      <th className="px-4 py-2 font-medium">F&B Item</th>
                                      <th className="px-4 py-2 font-medium">Type</th>
                                      <th className="px-4 py-2 font-medium">Category</th>
                                      <th className="px-4 py-2 font-medium">Qty</th>
                                      <th className="px-4 py-2 font-medium">Unit</th>
                                      <th className="px-4 py-2 font-medium">Service</th>
                                      <th className="px-4 py-2 font-medium">Notes</th>
                                      <th className="px-4 py-2 font-medium"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {itemsLoading ? (
                                      <tr><td colSpan={9} className="px-4 py-3 text-center text-slate-500">Loading...</td></tr>
                                    ) : eventBeverages.length === 0 ? (
                                      <tr><td colSpan={9} className="px-4 py-3 text-center text-slate-500">No beverages yet. Click "Add Beverage" to create one.</td></tr>
                                    ) : eventBeverages.map((b: any) => (
                                      <tr key={b.itemId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">{b.name}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.fbItemName || '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.beverageType || '—'}</td>
                                        <td className="px-4 py-2">{b.category ? <Badge tone={getCategoryTone(b.category)}>{b.category}</Badge> : '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.quantity || 0}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{formatPrice(b.unitPrice != null ? b.unitPrice : b.fbSellingPrice)}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.serviceType || '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.specialNotes || '—'}</td>
                                        <td className="px-4 py-2 text-right">
                                          <button onClick={() => handleDeleteBeverage(b.itemId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                                            <Trash2 size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};

// Guest Experience View — consolidates Guests, Registration and Seating
const GuestExperienceView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [activeGuestTab, setActiveGuestTab] = useState<'guests' | 'registration' | 'seating' | 'feedback'>('guests');

  const guestTabs = [
    { id: 'guests', label: 'Guests & Attendees', icon: Users, color: 'blue' },
    { id: 'registration', label: 'Registration', icon: UserPlus, color: 'emerald' },
    { id: 'seating', label: 'Seating', icon: Armchair, color: 'rose' },
    { id: 'feedback', label: 'Feedback', icon: Star, color: 'amber' },
  ] as const;

  return (
    <div className="space-y-6">

      <TabSwitcher tabs={guestTabs} active={activeGuestTab} onChange={setActiveGuestTab} />

      {activeGuestTab === 'guests' && (
        <GuestManagementView
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeGuestTab === 'registration' && (
        <RegistrationManagementView
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeGuestTab === 'seating' && (
        <SeatingManagementView
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeGuestTab === 'feedback' && (
        <GuestFeedbackView
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          addNotification={addNotification}
        />
      )}
    </div>
  );
};

// Guest Feedback — the lifecycle's "Guest Feedback -> Event Closed" step.
// Records satisfactionScore (1-5) and free-text feedback onto the event.
const GuestFeedbackView = ({ events, loading, onRefresh, addNotification }: any) => {
  const completedEvents = events.filter((e: Event) => e.status === 'Completed' || e.status === 'InProgress');
  const [feedbackForm, setFeedbackForm] = useState({ eventId: '', satisfactionScore: '5', feedback: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Per-guest responses & complaints (472) — complements the event rollup.
  const [responses, setResponses] = useState<any[]>([]);
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [responseForm, setResponseForm] = useState({ eventId: '', guestName: '', rating: '5', category: 'General', comments: '' });

  const fetchResponses = useCallback(async () => {
    try {
      const res = await fetch('/api/banquet-events/feedback', { headers: banquetHeaders() });
      if (res.ok) setResponses(await res.json());
    } catch (e) {
      console.error('Failed to load guest responses:', e);
    }
  }, []);

  useEffect(() => { fetchResponses(); }, [fetchResponses]);

  const handleResponseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/banquet-events/feedback', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...responseForm, rating: Number(responseForm.rating) })
      });
      if (res.ok) {
        addNotification('Guest response recorded', 'success');
        setShowResponseForm(false);
        setResponseForm({ eventId: '', guestName: '', rating: '5', category: 'General', comments: '' });
        fetchResponses();
      }
    } catch (err) {
      addNotification('Failed to record response', 'warning');
    }
  };

  const handleResolveResponse = async (id: string, resolved: boolean) => {
    try {
      const res = await fetch(`/api/banquet-events/feedback/${id}`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ resolved })
      });
      if (res.ok) fetchResponses();
    } catch (e) {
      addNotification('Failed to update response', 'warning');
    }
  };

  const handleDeleteResponse = async (id: string) => {
    try {
      const res = await fetch(`/api/banquet-events/feedback/${id}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) fetchResponses();
    } catch (e) {
      addNotification('Failed to remove response', 'warning');
    }
  };

  const startEdit = (event: Event) => {
    setEditingId(event.eventId);
    setFeedbackForm({
      eventId: event.eventId,
      satisfactionScore: String((event as any).satisfactionScore ?? 5),
      feedback: (event as any).feedback || '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackForm.eventId) return;
    try {
      const res = await fetch(`/api/banquet-events/events/${feedbackForm.eventId}`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          satisfactionScore: Number(feedbackForm.satisfactionScore),
          feedback: feedbackForm.feedback,
        }),
      });
      if (res.ok) {
        addNotification('Guest feedback recorded', 'success');
        setEditingId(null);
        setFeedbackForm({ eventId: '', satisfactionScore: '5', feedback: '' });
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to record feedback', 'warning');
      }
    } catch (e) {
      addNotification('Failed to record feedback', 'warning');
    }
  };

  const renderStars = (score: number | null | undefined) => {
    const n = Math.round(Number(score ?? 0));
    if (!n) return <span className="text-xs text-slate-400">No rating</span>;
    return (
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} size={12} className={i < n ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-600'} />
        ))}
      </span>
    );
  };

  const withFeedback = completedEvents.filter((e: any) => e.satisfactionScore != null || e.feedback);
  const withoutFeedback = completedEvents.filter((e: any) => e.satisfactionScore == null && !e.feedback);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[
          { name: 'Events Awaiting Feedback', count: withoutFeedback.length, tone: 'warning' as const },
          { name: 'Feedback Recorded', count: withFeedback.length, tone: 'success' as const },
          {
            name: 'Average Score',
            count: withFeedback.length
              ? (withFeedback.reduce((s: number, e: any) => s + Number(e.satisfactionScore || 0), 0) / withFeedback.length).toFixed(1)
              : '—',
            tone: 'accent' as const,
          },
        ].map((stat) => (
          <div key={stat.name} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{stat.count}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.name}</p>
          </div>
        ))}
      </div>

      <SectionCard title="Event Feedback" icon={Star} tone="warning" pad="none">
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-xs text-slate-500 text-center py-4">Loading…</p>
          ) : completedEvents.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No in-progress or completed events to collect feedback for.</p>
          ) : (
            completedEvents.map((evt: any) => (
              <div key={evt.eventId} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{evt.eventName}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{evt.clientName} · {evt.startDate ? new Date(evt.startDate).toLocaleDateString() : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {renderStars(evt.satisfactionScore)}
                    <button onClick={() => startEdit(evt)} className="p-1.5 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Record feedback">
                      <Edit size={14} />
                    </button>
                  </div>
                </div>
                {evt.feedback && <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 italic">"{evt.feedback}"</p>}
                {editingId === evt.eventId && (
                  <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Satisfaction Score (1-5)</label>
                        <select
                          value={feedbackForm.satisfactionScore}
                          onChange={(e) => setFeedbackForm({ ...feedbackForm, satisfactionScore: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                        >
                          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Guest Comments</label>
                      <textarea
                        value={feedbackForm.feedback}
                        onChange={(e) => setFeedbackForm({ ...feedbackForm, feedback: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className={button.primary}>Save Feedback</button>
                      <button type="button" onClick={() => setEditingId(null)} className={button.secondary}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            ))
          )}
        </div>
      </SectionCard>

      {/* Per-guest responses & complaints (472) */}
      <SectionCard title="Guest Responses & Complaints" icon={Star} tone="accent" pad="none"
        actions={
          <button onClick={() => setShowResponseForm(!showResponseForm)} className={`${button.primary} !text-xs`}>
            <Plus size={14} /> {showResponseForm ? 'Cancel' : 'Log Response'}
          </button>
        }>
        <div className="p-4 space-y-3">
          {showResponseForm && (
            <form onSubmit={handleResponseSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
              <select
                value={responseForm.eventId}
                onChange={(e) => setResponseForm({ ...responseForm, eventId: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              >
                <option value="">Event…</option>
                {events.map((e: Event) => <option key={e.eventId} value={e.eventId}>{e.eventName}</option>)}
              </select>
              <input
                type="text" placeholder="Guest name" value={responseForm.guestName}
                onChange={(e) => setResponseForm({ ...responseForm, guestName: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <select
                value={responseForm.category}
                onChange={(e) => setResponseForm({ ...responseForm, category: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                {['General', 'Food', 'Service', 'Venue', 'AV', 'Billing', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={responseForm.rating}
                onChange={(e) => setResponseForm({ ...responseForm, rating: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} ★</option>)}
              </select>
              <input
                type="text" placeholder="Comments" value={responseForm.comments}
                onChange={(e) => setResponseForm({ ...responseForm, comments: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <button type="submit" className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition md:col-span-5">Log Response</button>
            </form>
          )}
          {responses.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No per-guest responses logged — use this for surveys and categorized complaints.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {responses.map((r: any) => (
                <div key={r.feedbackId} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    {renderStars(r.rating)}
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{r.guestName || 'Anonymous'}</span>
                      <span className="text-xs text-slate-500 ml-2">{r.eventName}</span>
                      {r.comments && <p className="text-xs text-slate-500 italic">"{r.comments}"</p>}
                    </div>
                    <Badge tone="neutral">{r.category}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleResolveResponse(r.feedbackId, !r.resolved)} title={r.resolved ? 'Reopen' : 'Mark resolved'}>
                      <Badge tone={r.resolved ? 'success' : 'warning'}>{r.resolved ? 'Resolved' : 'Open'}</Badge>
                    </button>
                    <button onClick={() => handleDeleteResponse(r.feedbackId)} className="p-1 text-slate-400 hover:text-rose-500" title="Remove"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

// Event Logistics View — consolidates Resources, Equipment, Vendors and Transportation
const EventLogisticsView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [activeLogisticsTab, setActiveLogisticsTab] = useState<'resources' | 'equipment' | 'vendors' | 'transportation'>('resources');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');

  const filteredEvents = events.filter((e: Event) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term ||
      e.eventName.toLowerCase().includes(term) ||
      e.clientName.toLowerCase().includes(term) ||
      e.eventType.toLowerCase().includes(term);
    const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
    const matchesType = filterType === 'all' || e.eventType === filterType;
    return matchesSearch && matchesStatus && matchesType;
  });

  const logisticsTabs = [
    { id: 'resources', label: 'Resources', icon: Package, color: 'blue' },
    { id: 'equipment', label: 'Equipment', icon: Monitor, color: 'cyan' },
    { id: 'vendors', label: 'Vendors', icon: Truck, color: 'orange' },
    { id: 'transportation', label: 'Transportation', icon: Car, color: 'indigo' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search event, client or type"
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Statuses</option>
          <option value="Inquiry">Inquiry</option>
          <option value="Tentative">Tentative</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Planning">Planning</option>
          <option value="InProgress">In Progress</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Event Types</option>
          <option value="Anniversary">Anniversary</option>
          <option value="Birthday">Birthday</option>
          <option value="CocktailReception">Cocktail Reception</option>
          <option value="Conference">Conference</option>
          <option value="CorporateEvent">Corporate Event</option>
          <option value="Exhibition">Exhibition</option>
          <option value="GalaDinner">Gala Dinner</option>
          <option value="Graduation">Graduation</option>
          <option value="Meeting">Meeting</option>
          <option value="ProductLaunch">Product Launch</option>
          <option value="ReligiousEvent">Religious Event</option>
          <option value="Wedding">Wedding</option>
        </select>
      </div>

      <TabSwitcher tabs={logisticsTabs} active={activeLogisticsTab} onChange={setActiveLogisticsTab} />

      {activeLogisticsTab === 'resources' && (
        <ResourceManagementView
          events={filteredEvents}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeLogisticsTab === 'equipment' && (
        <EquipmentManagementView
          events={filteredEvents}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeLogisticsTab === 'vendors' && (
        <VendorCoordinationView
          events={filteredEvents}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeLogisticsTab === 'transportation' && (
        <TransportationCoordinationView
          events={filteredEvents}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
    </div>
  );
};

// Event Execution View — consolidates Tasks and Timeline
// Event Execution — on-event-day operations. Shows only InProgress events.
// Three panels: Department Readiness (BEO-distributed tasks), Live Timeline
// (derived from BEO times + schedules), and Actuals/Issues capture.
const EventExecutionView = ({ events, beos, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const inProgressEvents = events.filter((e: Event) => e.status === 'InProgress');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [actuals, setActuals] = useState<any>({});
  const [execLoading, setExecLoading] = useState(false);
  const [issueForm, setIssueForm] = useState({ issueText: '', severity: 'Medium' });
  const [actualsForm, setActualsForm] = useState({ actualAttendance: '', actualRevenue: '', actualStartTime: '', actualEndTime: '' });

  const selectedEvent = inProgressEvents.find((e: Event) => e.eventId === selectedEventId) || inProgressEvents[0] || null;
  const effectiveEventId = selectedEvent?.eventId || null;

  const fetchExecutionData = useCallback(async (eventId: string) => {
    setExecLoading(true);
    try {
      const [sRes, iRes] = await Promise.all([
        fetch(`/api/banquet-events/schedules`, {
          headers: banquetHeaders()
        }),
        fetch(`/api/banquet-events/events/${eventId}/issues`, {
          headers: banquetHeaders()
        })
      ]);
      if (sRes.ok) {
        const sData = await sRes.json();
        setSchedules(Array.isArray(sData) ? sData.filter((s: any) => s.eventId === eventId) : []);
      }
      if (iRes.ok) {
        const iData = await iRes.json();
        setIssues(Array.isArray(iData) ? iData : []);
      }
      // Pre-fill actuals form from event data
      const evt = events.find((e: Event) => e.eventId === eventId);
      if (evt) {
        setActualsForm({
          actualAttendance: evt.actualAttendance != null ? String(evt.actualAttendance) : '',
          actualRevenue: evt.actualRevenue != null ? String(evt.actualRevenue) : '',
          actualStartTime: evt.actualStartTime ? new Date(evt.actualStartTime).toISOString().slice(0, 16) : '',
          actualEndTime: evt.actualEndTime ? new Date(evt.actualEndTime).toISOString().slice(0, 16) : ''
        });
      }
    } catch (e) {
      console.error('Failed to load execution data:', e);
    } finally {
      setExecLoading(false);
    }
  }, [events]);

  useEffect(() => {
    if (effectiveEventId) fetchExecutionData(effectiveEventId);
  }, [effectiveEventId, fetchExecutionData]);

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveEventId) return;
    try {
      const res = await fetch(`/api/banquet-events/events/${effectiveEventId}/issues`, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(issueForm)
      });
      if (res.ok) {
        addNotification('Issue logged', 'success');
        setIssueForm({ issueText: '', severity: 'Medium' });
        fetchExecutionData(effectiveEventId);
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to log issue', 'warning');
    }
  };

  const handleResolveIssue = async (issueId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/issues/${issueId}/resolve`, {
        method: 'PUT',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Issue resolved', 'success');
        if (effectiveEventId) fetchExecutionData(effectiveEventId);
      }
    } catch (e) {
      addNotification('Failed to resolve issue', 'warning');
    }
  };

  const handleActualsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveEventId) return;
    try {
      const res = await fetch(`/api/banquet-events/events/${effectiveEventId}/actuals`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify(actualsForm)
      });
      if (res.ok) {
        addNotification('Actuals saved', 'success');
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to save actuals', 'warning');
    }
  };

  // Build live timeline from BEO + schedules
  const eventBeo = (beos || []).find((b: any) => b.eventId === effectiveEventId);
  const timelineMilestones: { time: string; label: string; source: string; status: string }[] = [];
  if (eventBeo) {
    if (eventBeo.setupTime) timelineMilestones.push({ time: eventBeo.setupTime, label: 'Venue Setup', source: 'BEO', status: 'Pending' });
    if (eventBeo.eventStartTime) timelineMilestones.push({ time: eventBeo.eventStartTime, label: 'Event Start', source: 'BEO', status: 'Pending' });
    if (eventBeo.eventEndTime) timelineMilestones.push({ time: eventBeo.eventEndTime, label: 'Event End', source: 'BEO', status: 'Pending' });
    if (eventBeo.breakdownTime) timelineMilestones.push({ time: eventBeo.breakdownTime, label: 'Breakdown', source: 'BEO', status: 'Pending' });
  }
  // Add department readiness tasks from distributed BEO
  const beoScheduleTasks = schedules.filter((s: any) => s.taskName && s.taskName.includes('BEO '));
  beoScheduleTasks.forEach((s: any) => {
    timelineMilestones.push({
      time: s.startTime || s.endTime || '',
      label: s.taskName,
      source: s.department || 'Dept',
      status: 'Pending'
    });
  });
  // Sort by time
  timelineMilestones.sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });

  // Department readiness from BEO-distributed schedules
  const deptTasks = schedules.filter((s: any) => s.taskName && s.taskName.includes('BEO '));
  const departments = ['Kitchen', 'Bar', 'Housekeeping', 'Engineering', 'Service', 'AV'];
  const deptReadiness = departments.map(dept => {
    const task = deptTasks.find((t: any) => t.department === dept);
    return { department: dept, hasTask: !!task, task: task || null };
  });

  const openIssues = issues.filter((i: any) => i.status === 'Open');
  const resolvedIssues = issues.filter((i: any) => i.status === 'Resolved');

  const getSeverityTone = (sev: string): 'success' | 'warning' | 'info' | 'neutral' => {
    if (sev === 'Critical') return 'warning';
    if (sev === 'High') return 'warning';
    if (sev === 'Medium') return 'info';
    return 'neutral';
  };

  if (inProgressEvents.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center">
          <Activity size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No events are currently in progress.</p>
          <p className="text-xs text-slate-400 mt-1">Events with status "In Progress" will appear here for on-event-day execution tracking.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Event selector */}
      <div className="flex gap-2 flex-wrap">
        {inProgressEvents.map((e: Event) => (
          <button
            key={e.eventId}
            onClick={() => setSelectedEventId(e.eventId)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              (selectedEventId || inProgressEvents[0].eventId) === e.eventId
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {e.eventName}
          </button>
        ))}
      </div>

      {selectedEvent && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <p className="text-lg font-bold text-emerald-600">{selectedEvent.expectedAttendance || 0}</p>
              <p className="text-[10px] text-slate-500">Expected Guests</p>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <p className="text-lg font-bold text-violet-600">{deptReadiness.filter(d => d.hasTask).length}/{departments.length}</p>
              <p className="text-[10px] text-slate-500">Depts Notified</p>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <p className="text-lg font-bold text-rose-600">{openIssues.length}</p>
              <p className="text-[10px] text-slate-500">Open Issues</p>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <p className="text-lg font-bold text-sky-600">{eventBeo ? 'Yes' : 'No'}</p>
              <p className="text-[10px] text-slate-500">BEO Exists</p>
            </div>
          </div>

          {/* Two-column layout: Timeline + Department Readiness */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Live Timeline */}
            <SectionCard title="Live Timeline" icon={Clock} tone="info" pad="none">
              <div className="p-4">
                {timelineMilestones.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No timeline data. Generate and distribute a BEO to populate timeline milestones.</p>
                ) : (
                  <div className="space-y-3">
                    {timelineMilestones.map((m, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full ${m.status === 'Completed' ? 'bg-green-500' : m.status === 'InProgress' ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}></div>
                          {idx < timelineMilestones.length - 1 && <div className="w-0.5 h-8 bg-slate-200 dark:bg-slate-700"></div>}
                        </div>
                        <div className="flex-1 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">{m.label}</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">{m.source}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5">{m.time ? new Date(m.time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Time TBD'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Department Readiness Board */}
            <SectionCard title="Department Readiness" icon={Network} tone="info" pad="none">
              <div className="p-4 space-y-2">
                {deptReadiness.map((d) => (
                  <div key={d.department} className="flex items-center justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${d.hasTask ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`}></div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{d.department}</span>
                    </div>
                    <div>
                      {d.hasTask ? (
                      <span className="text-[10px] text-green-600 font-bold">Notified</span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-bold">Not Notified</span>
                    )}
                    </div>
                  </div>
                ))}
                {deptReadiness.every(d => !d.hasTask) && (
                  <p className="text-xs text-slate-500 text-center pt-2">No departments notified yet. Distribute the BEO from the BEO tab to notify departments.</p>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Actuals Capture */}
          <SectionCard title="Actuals Capture" icon={TrendingUp} tone="info">
            <form onSubmit={handleActualsSubmit} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Actual Attendance</label>
                  <input type="number" value={actualsForm.actualAttendance} onChange={(e) => setActualsForm({ ...actualsForm, actualAttendance: e.target.value })} placeholder={String(selectedEvent.expectedAttendance || 0)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Actual Revenue (ETB)</label>
                  <input type="number" value={actualsForm.actualRevenue} onChange={(e) => setActualsForm({ ...actualsForm, actualRevenue: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Actual Start Time</label>
                  <input type="datetime-local" value={actualsForm.actualStartTime} onChange={(e) => setActualsForm({ ...actualsForm, actualStartTime: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Actual End Time</label>
                  <input type="datetime-local" value={actualsForm.actualEndTime} onChange={(e) => setActualsForm({ ...actualsForm, actualEndTime: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
                </div>
              </div>
              <button type="submit" className={`${button.primary} !text-xs`}>Save Actuals</button>
            </form>
          </SectionCard>

          {/* Issues Log */}
          <SectionCard title="Issues Log" icon={AlertTriangle} tone="warning" pad="none">
            <div className="p-4 space-y-3">
              {/* Add issue form */}
              <form onSubmit={handleIssueSubmit} className="flex gap-2">
                <select value={issueForm.severity} onChange={(e) => setIssueForm({ ...issueForm, severity: e.target.value })} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white">
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
                <input type="text" value={issueForm.issueText} onChange={(e) => setIssueForm({ ...issueForm, issueText: e.target.value })} placeholder="Describe the issue…" className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
                <button type="submit" className={`${button.primary} !text-xs !px-3`}>Log</button>
              </form>

              {/* Issues list */}
              {issues.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">No issues logged. The event is running smoothly.</p>
              ) : (
                <div className="space-y-2">
                  {issues.map((issue: any) => (
                    <div key={issue.issueId} className="flex items-start justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge tone={getSeverityTone(issue.severity)}>{issue.severity}</Badge>
                          <Badge tone={issue.status === 'Open' ? 'warning' : 'success'}>{issue.status}</Badge>
                        </div>
                        <p className="text-xs text-slate-900 dark:text-white">{issue.issueText}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{new Date(issue.createdAt).toLocaleString()}</p>
                      </div>
                      {issue.status === 'Open' && (
                        <button onClick={() => handleResolveIssue(issue.issueId)} className="ml-2 px-2 py-1 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-[10px] font-bold hover:bg-green-200 dark:hover:bg-green-900/50">
                          Resolve
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

// Planning View — schedules and checklists only. BEO is a separate tab that
// comes after catering and logistics, because it is generated from them.
const PlanningView = ({ events, beos, loading, onRefresh, addNotification }: any) => (
  <div className="space-y-6">
    <EventPlanningView
      events={events}
      beos={beos}
      loading={loading}
      onRefresh={onRefresh}
      addNotification={addNotification}
    />
  </div>
);

// BEO View — generated from catering & logistics captured in earlier tabs.
const BEOManagementView = ({ events, beos, loading, onRefresh, addNotification }: any) => (
  <div className="space-y-6">
    <BEOView
      beos={beos}
      events={events}
      loading={loading}
      onRefresh={onRefresh}
      addNotification={addNotification}
    />
  </div>
);

// Room Blocks View — group accommodation blocks per event. Moved from Event Types
// to Pipeline so room blocks are managed alongside the booking, not in a support tab.
const RoomBlocksView = ({ events, loading, onRefresh, addNotification }: any) => {
  const [blocks, setBlocks] = useState<any[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    eventId: '',
    roomType: 'Standard',
    roomCount: '',
    ratePerRoom: '',
    checkInDate: '',
    checkOutDate: '',
    specialRequests: ''
  });

  const fetchBlocks = useCallback(async () => {
    setBlocksLoading(true);
    try {
      const res = await fetch('/api/banquet-events/room-blocks', {
        headers: banquetHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setBlocks(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load room blocks:', e);
    } finally {
      setBlocksLoading(false);
    }
  }, []);

  useEffect(() => { fetchBlocks(); }, [fetchBlocks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/banquet-events/room-blocks', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(form)
      });
      if (res.ok) {
        addNotification('Room block created successfully', 'success');
        setShowForm(false);
        setForm({ eventId: '', roomType: 'Standard', roomCount: '', ratePerRoom: '', checkInDate: '', checkOutDate: '', specialRequests: '' });
        fetchBlocks();
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to create room block', 'warning');
      }
    } catch (e) {
      addNotification('Failed to create room block', 'warning');
    }
  };

  const handleDelete = async (blockId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/room-blocks/${blockId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Room block deleted', 'success');
        fetchBlocks();
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to delete room block', 'warning');
    }
  };

  const eligibleEvents = events.filter((e: Event) =>
    ['Confirmed', 'Planning', 'InProgress'].includes(e.status)
  );

  // Rooming list (471) — per-guest room details handed to Front Office.
  const [rooming, setRooming] = useState<any[]>([]);
  const [showRoomingForm, setShowRoomingForm] = useState(false);
  const [roomingForm, setRoomingForm] = useState({
    eventId: '', guestName: '', roomType: 'Standard', checkIn: '', checkOut: '', specialRequests: ''
  });

  const fetchRooming = useCallback(async () => {
    try {
      const res = await fetch('/api/banquet-events/rooming-list', { headers: banquetHeaders() });
      if (res.ok) setRooming(await res.json());
    } catch (e) {
      console.error('Failed to load rooming list:', e);
    }
  }, []);

  useEffect(() => { fetchRooming(); }, [fetchRooming]);

  const handleRoomingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/banquet-events/rooming-list', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(roomingForm)
      });
      if (res.ok) {
        addNotification('Rooming entry added', 'success');
        setShowRoomingForm(false);
        setRoomingForm({ eventId: '', guestName: '', roomType: 'Standard', checkIn: '', checkOut: '', specialRequests: '' });
        fetchRooming();
      }
    } catch (err) {
      addNotification('Failed to add rooming entry', 'warning');
    }
  };

  const handleRoomingStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/banquet-events/rooming-list/${id}`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status })
      });
      if (res.ok) fetchRooming();
    } catch (e) {
      addNotification('Failed to update rooming entry', 'warning');
    }
  };

  const handleDeleteRooming = async (id: string) => {
    try {
      const res = await fetch(`/api/banquet-events/rooming-list/${id}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) fetchRooming();
    } catch (e) {
      addNotification('Failed to remove rooming entry', 'warning');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className={`${showForm ? button.ghost : button.primary} !text-xs`}
        >
          <Plus size={14} />
          {showForm ? 'Cancel' : 'New Room Block'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
              <select
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              >
                <option value="">Select Event</option>
                {eligibleEvents.map((e: Event) => (
                  <option key={e.eventId} value={e.eventId}>{e.eventName} — {e.clientName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Room Type</label>
                <select
                  value={form.roomType}
                  onChange={(e) => setForm({ ...form, roomType: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="Standard">Standard Room</option>
                  <option value="Deluxe">Deluxe Room</option>
                  <option value="Suite">Suite</option>
                  <option value="Executive">Executive Suite</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Number of Rooms</label>
                <input type="number" value={form.roomCount} onChange={(e) => setForm({ ...form, roomCount: e.target.value })} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Rate Per Room (ETB)</label>
                <input type="number" value={form.ratePerRoom} onChange={(e) => setForm({ ...form, ratePerRoom: e.target.value })} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Check-in Date</label>
                <input type="date" value={form.checkInDate} onChange={(e) => setForm({ ...form, checkInDate: e.target.value })} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Check-out Date</label>
                <input type="date" value={form.checkOutDate} onChange={(e) => setForm({ ...form, checkOutDate: e.target.value })} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white" required />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Special Requests</label>
              <input type="text" value={form.specialRequests} onChange={(e) => setForm({ ...form, specialRequests: e.target.value })} className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white" />
            </div>
            <div className="flex justify-end">
              <button type="submit" className={`${button.primary} !text-xs`}>Create Room Block</button>
            </div>
          </form>
        </div>
      )}

      <SectionCard title="Room Blocks" icon={BedDouble} tone="info" pad="none">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Room Type</th>
                <th className="px-4 py-3 font-medium">Rooms</th>
                <th className="px-4 py-3 font-medium">Rate/Night</th>
                <th className="px-4 py-3 font-medium">Check-in</th>
                <th className="px-4 py-3 font-medium">Check-out</th>
                <th className="px-4 py-3 font-medium">Special Requests</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {blocksLoading ? (
                <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
              ) : blocks.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-500">No room blocks found</td></tr>
              ) : blocks.map((b: any) => (
                <tr key={b.blockId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{b.eventName}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{b.roomType}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{b.roomCount}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">ETB {Number(b.ratePerRoom || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{b.checkInDate || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{b.checkOutDate || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{b.specialRequests || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(b.blockId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Rooming list (471) — per-guest rooms for events with room blocks */}
      <SectionCard title="Rooming List" icon={BedDouble} tone="neutral" pad="none"
        actions={
          <button onClick={() => setShowRoomingForm(!showRoomingForm)} className={`${button.primary} !text-xs`}>
            <Plus size={14} /> {showRoomingForm ? 'Cancel' : 'Add Guest'}
          </button>
        }>
        <div className="p-4 space-y-3">
          {showRoomingForm && (
            <form onSubmit={handleRoomingSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
              <select
                value={roomingForm.eventId}
                onChange={(e) => setRoomingForm({ ...roomingForm, eventId: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              >
                <option value="">Event…</option>
                {eligibleEvents.map((e: Event) => <option key={e.eventId} value={e.eventId}>{e.eventName}</option>)}
              </select>
              <input
                type="text" placeholder="Guest name" value={roomingForm.guestName}
                onChange={(e) => setRoomingForm({ ...roomingForm, guestName: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
              <select
                value={roomingForm.roomType}
                onChange={(e) => setRoomingForm({ ...roomingForm, roomType: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                {['Standard', 'Deluxe', 'Suite', 'Executive'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                type="date" value={roomingForm.checkIn} title="Check-in"
                onChange={(e) => setRoomingForm({ ...roomingForm, checkIn: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <input
                type="date" value={roomingForm.checkOut} title="Check-out"
                onChange={(e) => setRoomingForm({ ...roomingForm, checkOut: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <input
                type="text" placeholder="Requests" value={roomingForm.specialRequests}
                onChange={(e) => setRoomingForm({ ...roomingForm, specialRequests: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <button type="submit" className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition md:col-span-6">Add to Rooming List</button>
            </form>
          )}
          {rooming.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No rooming entries yet — add per-guest room details for events with room blocks.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {rooming.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{r.guestName}</span>
                    <span className="text-xs text-slate-500">
                      {events.find((e: Event) => e.eventId === r.eventId)?.eventName || r.eventId} · {r.roomType || 'Room'}
                      {r.checkIn ? ` · ${r.checkIn} → ${r.checkOut || '?'}` : ''}
                    </span>
                    {r.specialRequests && <span className="text-xs text-slate-400 italic">{r.specialRequests}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.status === 'Confirmed' ? 'success' : r.status === 'Submitted' ? 'info' : 'neutral'}>{r.status}</Badge>
                    {r.status === 'Pending' && (
                      <button onClick={() => handleRoomingStatus(r.id, 'Submitted')} className="text-[10px] font-bold text-blue-600 hover:text-blue-700">Submit</button>
                    )}
                    {r.status === 'Submitted' && (
                      <button onClick={() => handleRoomingStatus(r.id, 'Confirmed')} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700">Confirm</button>
                    )}
                    <button onClick={() => handleDeleteRooming(r.id)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Remove"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

// Coordination & Communication View — consolidates Department Coordination and Communication
const DepartmentCoordinationView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showCoordForm, setShowCoordForm] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [coordForm, setCoordForm] = useState({
    eventId: '',
    department: '',
    contactPerson: '',
    requirements: '',
    deadline: '',
    status: 'Pending'
  });

  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const res = await fetch('/api/banquet-events/department-coordination', { headers: banquetHeaders() });
      if (res.ok) setRequests(await res.json());
    } catch (e) {
      console.error('Failed to load coordination requests:', e);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleCoordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/department-coordination', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(coordForm)
      });
      if (response.ok) {
        addNotification('Department coordination request sent', 'success');
        setShowCoordForm(false);
        setCoordForm({ eventId: '', department: '', contactPerson: '', requirements: '', deadline: '', status: 'Pending' });
        fetchRequests();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to send coordination request', 'warning');
    }
  };

  const handleCoordStatus = async (coordId: string, status: string) => {
    try {
      const res = await fetch(`/api/banquet-events/department-coordination/${coordId}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        addNotification(`Request marked ${status}`, 'success');
        fetchRequests();
      }
    } catch (e) {
      addNotification('Failed to update request', 'warning');
    }
  };

  const departments = [
    { name: 'Front Office', icon: '🏨', color: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20' },
    { name: 'Housekeeping', icon: '🧹', color: 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20' },
    { name: 'Kitchen', icon: '👨‍🍳', color: 'from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20' },
    { name: 'Maintenance', icon: '🔧', color: 'from-slate-50 to-gray-50 dark:from-slate-900/20 dark:to-gray-900/20' },
    { name: 'Security', icon: '🛡️', color: 'from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20' },
    { name: 'IT Support', icon: '💻', color: 'from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Department Coordination</h3>
        <button
          onClick={() => setShowCoordForm(!showCoordForm)}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition"
        >
          <Users size={14} />
          {showCoordForm ? 'Cancel' : 'Request Coordination'}
        </button>
      </div>

      {showCoordForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleCoordSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select
                  value={coordForm.eventId}
                  onChange={(e) => setCoordForm({ ...coordForm, eventId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (
                    <option key={event.eventId} value={event.eventId}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Department</label>
                <select
                  value={coordForm.department}
                  onChange={(e) => setCoordForm({ ...coordForm, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Department</option>
                  {departments.map((dept) => (
                    <option key={dept.name} value={dept.name}>{dept.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Contact Person</label>
                <input
                  type="text"
                  value={coordForm.contactPerson}
                  onChange={(e) => setCoordForm({ ...coordForm, contactPerson: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Deadline</label>
                <input
                  type="date"
                  value={coordForm.deadline}
                  onChange={(e) => setCoordForm({ ...coordForm, deadline: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Requirements</label>
              <textarea
                value={coordForm.requirements}
                onChange={(e) => setCoordForm({ ...coordForm, requirements: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                rows={3}
                required
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition"
            >
              Send Coordination Request
            </button>
          </form>
        </div>
      )}

      {/* Department Status */}
      <div className="grid grid-cols-3 gap-4">
        {departments.map((dept) => {
          const open = requests.filter((r: any) => r.department === dept.name && r.status === 'Pending').length;
          return (
            <div key={dept.name} className={`p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-gradient-to-r ${dept.color}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{dept.icon}</span>
                <h5 className="text-xs font-bold text-slate-900 dark:text-white">{dept.name}</h5>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${open > 0 ? 'bg-amber-500' : 'bg-green-500'}`}></div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{open > 0 ? `${open} pending request${open > 1 ? 's' : ''}` : 'Available'}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Coordination Requests — live from banquet_dept_coordination */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-4">Coordination Requests</h4>
        <div className="space-y-3">
          {requestsLoading ? (
            <p className="text-xs text-slate-500 text-center py-4">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No coordination requests yet.</p>
          ) : (
            requests.map((req: any) => (
              <div key={req.coordId} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-violet-600" />
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white">{req.department}</h5>
                  </div>
                  <div className="flex items-center gap-2">
                    {req.status === 'Pending' && (
                      <button onClick={() => handleCoordStatus(req.coordId, 'InProgress')} className="text-[10px] font-bold text-blue-600 hover:text-blue-700">Start</button>
                    )}
                    {req.status === 'InProgress' && (
                      <button onClick={() => handleCoordStatus(req.coordId, 'Completed')} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700">Complete</button>
                    )}
                    <Badge tone={req.status === 'Completed' ? 'success' : req.status === 'InProgress' ? 'info' : 'warning'}>{req.status}</Badge>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Event: {req.eventName}</p>
                {req.requirements && <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{req.requirements}</p>}
                <div className="flex justify-between items-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Contact: {req.contactPerson || '—'}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Due: {req.deadline || '—'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const CoordinationAndCommunicationView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [activeCoordTab, setActiveCoordTab] = useState<'coordination' | 'communication'>('coordination');

  const coordTabs = [
    { id: 'coordination', label: 'Department Coordination', icon: Network, color: 'indigo' },
    { id: 'communication', label: 'Communication', icon: MessageSquare, color: 'blue' },
  ] as const;

  return (
    <div className="space-y-6">

      <TabSwitcher tabs={coordTabs} active={activeCoordTab} onChange={setActiveCoordTab} />

      {activeCoordTab === 'coordination' && (
        <DepartmentCoordinationView
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
      {activeCoordTab === 'communication' && (
        <CommunicationCenterView
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          getStatusColor={getStatusColor}
          addNotification={addNotification}
        />
      )}
    </div>
  );
};

// Event Setup View — consolidates Event Booking and Function Space management
const EventSetupView = ({ venues, events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [activeSetupTab, setActiveSetupTab] = useState<'booking' | 'function-space'>('booking');

  const setupTabs = [
    { id: 'booking', label: 'Event Booking', icon: Plus },
    { id: 'function-space', label: 'Function Spaces', icon: Building2 },
  ] as const;

  return (
    <div className="space-y-6">

      <TabSwitcher tabs={setupTabs} active={activeSetupTab} onChange={setActiveSetupTab} variant="button" borderB />

      {activeSetupTab === 'booking' && (
        <EventBookingView
          venues={venues}
          events={events}
          loading={loading}
          onRefresh={onRefresh}
          addNotification={addNotification}
        />
      )}
      {activeSetupTab === 'function-space' && (
        <FunctionSpaceView
          venues={venues}
          loading={loading}
          onRefresh={onRefresh}
          addNotification={addNotification}
        />
      )}
    </div>
  );
};

// Executive Dashboard View
const ExecutiveDashboardView = ({ kpiData, alerts, eventsToday, upcomingEvents, loading, onRefresh, getStatusColor, getEventTypeIcon, onAcknowledgeAlert }: any) => {
  const k = kpiData || {};
  const fmt = (n: number) => `ETB ${(Number(n) || 0).toLocaleString()}`;

  return (
    <div className={layout.sectionStack}>
      {/* Event KPIs */}
      <div>
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Event KPIs</h3>
        <div className={layout.kpiGrid}>
          <StatCard title="Events Today" value={k.eventsToday ?? 0} icon={Calendar} tone="accent" />
          <StatCard title="Events This Week" value={k.eventsThisWeek ?? 0} icon={CalendarDays} tone="info" />
          <StatCard title="Events This Month" value={k.eventsThisMonth ?? 0} icon={Calendar} tone="neutral" />
          <StatCard title="Confirmed" value={k.confirmedBookings ?? 0} icon={CheckCircle2} tone="success" />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Booking Status</h3>
        <div className={layout.kpiGrid}>
          <StatCard title="Tentative" value={k.tentativeBookings ?? 0} icon={Clock} tone="warning" />
          <StatCard title="Planning" value={k.planningBookings ?? 0} icon={ClipboardList} tone="info" />
          <StatCard title="In Progress" value={k.inProgressBookings ?? 0} icon={Activity} tone="accent" />
          <StatCard title="Completed" value={k.completedBookings ?? 0} icon={CheckSquare} tone="success" />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Financial KPIs</h3>
        <div className={layout.kpiGrid}>
          <StatCard title="Total Revenue" value={fmt(k.totalRevenue)} icon={DollarSign} tone="success" />
          <StatCard title="Realised Revenue" value={fmt(k.realisedRevenue)} icon={TrendingUp} tone="accent" />
          <StatCard title="Collected" value={fmt(k.collectedRevenue)} icon={PiggyBank} tone="info" />
          <StatCard title="Pending Deposits" value={fmt(k.pendingDeposits)} icon={AlertTriangle} tone="warning" />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Operational KPIs</h3>
        <div className={layout.kpiGrid}>
          <StatCard title="Avg Event Value" value={fmt(k.averageEventValue)} icon={Activity} tone="neutral" />
          <StatCard title="BEO Completion" value={`${k.beoCompletion ?? 0}%`} icon={FileText} tone="accent" />
          <StatCard title="Task Completion" value={`${k.taskCompletion ?? 0}%`} icon={CheckSquare} tone="success" />
          <StatCard title="Dept Readiness" value={`${k.departmentReadiness ?? 0}%`} icon={Network} tone="info" />
        </div>
      </div>

      {/* Today's Events and Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Events */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className={sectionTitle}>Today's Events</h3>
            <span className="text-sm text-gray-600 dark:text-gray-400">{eventsToday.length} events</span>
          </div>
          {eventsToday.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No events scheduled today</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {eventsToday.map((event: any) => (
                <div key={event.eventId} className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition cursor-pointer">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                    {getEventTypeIcon(event.eventType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{event.eventName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{event.clientName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{event.expectedAttendance} guests</p>
                  </div>
                  <Badge tone={getEventStatusTone(event.status)}>{event.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className={sectionTitle}>Alerts</h3>
            <span className="text-sm text-gray-600 dark:text-gray-400">{alerts.filter((a: any) => !a.isRead).length} unread</span>
          </div>
          {alerts.length === 0 ? (
            <div className="text-center py-12">
              <Bell size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No alerts at this time</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {alerts.slice(0, 6).map((alert: any) => (
                <div key={alert.alertId} className={`flex items-center gap-3 p-4 transition ${!alert.isRead ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${alert.severity === 'Critical' ? 'bg-red-100 dark:bg-red-900/20' : 'bg-amber-100 dark:bg-amber-900/20'}`}>
                    <AlertTriangle size={18} className={alert.severity === 'Critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{alert.eventName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{alert.message}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(alert.createdAt).toLocaleString()}</p>
                  </div>
                  {!alert.isRead && (
                    <button
                      onClick={() => onAcknowledgeAlert?.(alert.alertId)}
                      className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 shrink-0"
                      title="Mark as read"
                    >
                      Ack
                    </button>
                  )}
                  {!alert.isRead && <div className="w-2 h-2 bg-amber-500 rounded-full shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Events */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className={sectionTitle}>Upcoming Events</h3>
          <span className="text-sm text-gray-600 dark:text-gray-400">Next {upcomingEvents.length} events</span>
        </div>
        {upcomingEvents.length === 0 ? (
          <div className="text-center py-12">
            <CalendarDays size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming events</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Event</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Attendance</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Revenue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {upcomingEvents.map((event: any) => (
                  <tr key={event.eventId} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{event.eventName}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getEventTypeIcon(event.eventType)}
                        <Badge tone={getEventTypeTone(event.eventType)}>{event.eventType}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{event.clientName}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{new Date(event.startDate).toLocaleDateString()}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{event.expectedAttendance}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">ETB {(Number(event.grandTotal) || Number(event.quotedAmount) || Number(event.estimatedRevenue) || 0).toLocaleString()}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <Badge tone={getEventStatusTone(event.status)}>{event.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// Event Calendar View
const getEventStatusTone = (status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' => {
  switch (status) {
    case 'Confirmed': case 'Approved': case 'Ready': case 'Completed': return 'success';
    case 'Tentative': case 'Draft': case 'NotStarted': case 'Pending': return 'info';
    case 'Planning': case 'Review': case 'InProgress': return 'warning';
    case 'Cancelled': case 'Blocked': case 'Overdue': return 'danger';
    default: return 'neutral';
  }
};

const getEventTypeTone = (type: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' => {
  switch (type) {
    case 'Wedding': return 'accent';
    case 'Conference': return 'info';
    case 'Meeting': return 'neutral';
    case 'GalaDinner': return 'success';
    case 'Birthday': return 'warning';
    case 'Exhibition': return 'danger';
    case 'CorporateEvent': return 'info';
    default: return 'neutral';
  }
};

const EventCalendarView = ({ events, venues, loading, onRefresh, getStatusColor, getEventTypeIcon }: any) => {
  const [calendarView, setCalendarView] = useState<'daily' | 'weekly' | 'monthly' | 'timeline' | 'function-space' | 'department'>('monthly');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filterType, setFilterType] = useState<'all' | EventType>('all');

  const filteredEvents = filterType === 'all'
    ? events
    : events.filter((e: Event) => e.eventType === filterType);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();
    const days: (Date | null)[] = [];
    for (let i = 0; i < startDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  };

  const getEventsForDate = (date: Date) => {
    if (!date) return [];
    const dateStr = date.toISOString().split('T')[0];
    return filteredEvents.filter((e: Event) => {
      const eventStart = new Date(e.startDate).toISOString().split('T')[0];
      const eventEnd = new Date(e.endDate).toISOString().split('T')[0];
      return dateStr >= eventStart && dateStr <= eventEnd;
    });
  };

  const getWeekDates = (date: Date): Date[] => {
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(date);
    monday.setDate(date.getDate() + diff);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  };

  const daysInMonth = getDaysInMonth(selectedDate);
  const weekDates = getWeekDates(selectedDate);

  // KPIs
  const totalEvents = filteredEvents.length;
  const todayEvents = getEventsForDate(new Date());
  const monthEvents = filteredEvents.filter((e: Event) => {
    const eDate = new Date(e.startDate);
    return eDate.getMonth() === selectedDate.getMonth() && eDate.getFullYear() === selectedDate.getFullYear();
  });
  const confirmedEvents = filteredEvents.filter((e: Event) => e.status === 'Confirmed' || e.status === 'Approved').length;

  return (
    <div className={layout.sectionStack}>
      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Events" value={totalEvents} icon={BarChart3} tone="neutral" />
        <StatCard title="Today" value={todayEvents.length} icon={CalendarDays} tone="info" />
        <StatCard title="This Month" value={monthEvents.length} icon={Calendar} tone="accent" />
        <StatCard title="Confirmed" value={confirmedEvents} icon={CheckCircle2} tone="success" />
      </div>

      {/* Calendar Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1))}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition"
          >
            <ChevronRight size={16} className="rotate-180" />
          </button>
          <h3 className={sectionTitle}>
            {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          <button
            onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1))}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className={button.ghost}
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
            {([
              { id: 'daily', label: 'Daily', icon: Calendar },
              { id: 'weekly', label: 'Weekly', icon: CalendarDays },
              { id: 'monthly', label: 'Monthly', icon: CalendarDays },
              { id: 'timeline', label: 'Timeline', icon: Clock },
              { id: 'function-space', label: 'Function Space', icon: Building2 },
              { id: 'department', label: 'Department', icon: Network },
            ] as const).map((view) => {
              const Icon = view.icon;
              const isActive = calendarView === view.id;
              return (
                <button
                  key={view.id}
                  onClick={() => setCalendarView(view.id as typeof calendarView)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{view.label}</span>
                </button>
              );
            })}
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | EventType)}
            className="px-3 py-2 text-xs font-bold border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          >
            <option value="all">All Event Types</option>
            <option value="Wedding">Weddings</option>
            <option value="Conference">Conferences</option>
            <option value="Meeting">Meetings</option>
            <option value="GalaDinner">Gala Dinners</option>
            <option value="Birthday">Birthdays</option>
            <option value="Anniversary">Anniversaries</option>
            <option value="Exhibition">Exhibitions</option>
            <option value="CorporateEvent">Corporate Events</option>
          </select>
        </div>
      </div>

      {/* Monthly Calendar View */}
      {calendarView === 'monthly' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {daysInMonth.map((date, index) => {
              if (!date) return <div key={index} className="aspect-square" />;
              const dayEvents = getEventsForDate(date);
              const isToday = date.toDateString() === new Date().toDateString();
              return (
                <div
                  key={index}
                  className={`aspect-square p-1.5 rounded-lg border transition cursor-pointer hover:border-[var(--color-accent-operations)] ${
                    isToday
                      ? 'bg-[var(--color-accent-operations)]/5 border-[var(--color-accent-operations)]'
                      : 'bg-gray-50 dark:bg-slate-800/50 border-gray-100 dark:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold text-gray-900 dark:text-white mb-1">
                    {date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map((event: any) => (
                      <div
                        key={event.eventId}
                        className={`text-[9px] font-bold truncate px-1 py-0.5 rounded ${
                          getEventTypeTone(event.eventType) === 'accent' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                          : getEventTypeTone(event.eventType) === 'info' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : getEventTypeTone(event.eventType) === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : getEventTypeTone(event.eventType) === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : getEventTypeTone(event.eventType) === 'danger' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300'
                        }`}
                      >
                        {event.eventName}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-[9px] font-bold text-gray-500 dark:text-gray-400">
                        +{dayEvents.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weekly View */}
      {calendarView === 'weekly' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className={sectionTitle}>
              Week of {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-900/50">
                <tr>
                  {weekDates.map((date, i) => {
                    const isToday = date.toDateString() === new Date().toDateString();
                    return (
                      <th key={i} className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isToday ? 'text-[var(--color-accent-operations)]' : 'text-gray-500 dark:text-gray-400'}`}>
                        {date.toLocaleDateString('en-US', { weekday: 'short' })} {date.getDate()}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                <tr>
                  {weekDates.map((date, i) => {
                    const dayEvents = getEventsForDate(date);
                    return (
                      <td key={i} className="px-4 py-3 align-top min-w-[160px]">
                        <div className="space-y-2">
                          {dayEvents.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500">No events</p>
                          ) : (
                            dayEvents.map((event: any) => (
                              <div key={event.eventId} className="p-2 rounded-lg border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                                <div className="flex items-center gap-1 mb-1">
                                  <Badge tone={getEventTypeTone(event.eventType)}>{event.eventType}</Badge>
                                </div>
                                <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{event.eventName}</p>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">{event.clientName}</p>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">{event.expectedAttendance} guests</p>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Daily View */}
      {calendarView === 'daily' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className={sectionTitle}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </h3>
          </div>
          {getEventsForDate(selectedDate).length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No events scheduled for this day</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-slate-700">
              {getEventsForDate(selectedDate).map((event: any) => (
                <div key={event.eventId} className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition cursor-pointer">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                    {getEventTypeIcon(event.eventType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{event.eventName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{event.clientName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(event.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">•</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{event.expectedAttendance} guests</span>
                    </div>
                  </div>
                  <Badge tone={getEventStatusTone(event.status)}>{event.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline View */}
      {calendarView === 'timeline' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className={sectionTitle}>Event Timeline</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Chronological list of all events</p>
          </div>
          {filteredEvents.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No events to display</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Event</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Client</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Guests</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {filteredEvents
                    .slice()
                    .sort((a: Event, b: Event) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                    .map((event: any) => (
                      <tr key={event.eventId} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{new Date(event.startDate).toLocaleDateString()}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-600 dark:text-gray-400">{new Date(event.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{event.eventName}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-600 dark:text-gray-400">{event.clientName}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Badge tone={getEventTypeTone(event.eventType)}>{event.eventType}</Badge>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{event.expectedAttendance}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Badge tone={getEventStatusTone(event.status)}>{event.status}</Badge>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Function Space View */}
      {calendarView === 'function-space' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className={sectionTitle}>Function Space Availability</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Venue bookings for {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Venue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Capacity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Booked Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {venues.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No venues configured</td>
                  </tr>
                ) : (
                  venues.map((venue: any) => {
                    const venueEvents = filteredEvents.filter((e: Event) =>
                      e.venueIds?.includes(venue.venueId) ||
                      e.venueName?.toLowerCase().includes(venue.venueName?.toLowerCase())
                    );
                    const monthVenueEvents = venueEvents.filter((e: Event) => {
                      const eDate = new Date(e.startDate);
                      return eDate.getMonth() === selectedDate.getMonth() && eDate.getFullYear() === selectedDate.getFullYear();
                    });
                    return (
                      <tr key={venue.venueId} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{venue.venueName}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-600 dark:text-gray-400">{venue.venueType}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{venue.capacity}</p>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <Badge tone={venue.isActive ? 'success' : 'neutral'} variant="solid">{venue.isActive ? 'Active' : 'Inactive'}</Badge>
                        </td>
                        <td className="px-4 py-4">
                          {monthVenueEvents.length === 0 ? (
                            <p className="text-sm text-gray-400 dark:text-gray-500">No bookings this month</p>
                          ) : (
                            <div className="space-y-1">
                              {monthVenueEvents.slice(0, 3).map((event: any) => (
                                <div key={event.eventId} className="flex items-center gap-2">
                                  <Badge tone={getEventTypeTone(event.eventType)}>{new Date(event.startDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</Badge>
                                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{event.eventName}</span>
                                </div>
                              ))}
                              {monthVenueEvents.length > 3 && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">+{monthVenueEvents.length - 3} more</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Department View */}
      {calendarView === 'department' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className={sectionTitle}>Department Load View</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Events grouped by department involvement for {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Events This Month</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Guests</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Upcoming Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {[
                  { dept: 'Catering (F&B)', icon: Utensils, tone: 'success' as const, filter: (e: Event) => e.cateringRequired !== false },
                  { dept: 'Housekeeping', icon: Bed, tone: 'info' as const, filter: (e: Event) => e.requiresAccommodation === true || e.roomBlockId },
                  { dept: 'Audio/Visual', icon: Monitor, tone: 'warning' as const, filter: (e: Event) => e.equipmentRequired !== false },
                  { dept: 'Logistics', icon: Truck, tone: 'neutral' as const, filter: (e: Event) => e.logisticsRequired !== false },
                  { dept: 'Decoration', icon: PartyPopper, tone: 'accent' as const, filter: (e: Event) => e.decorationRequired !== false },
                  { dept: 'Front Office', icon: Building2, tone: 'info' as const, filter: (e: Event) => true },
                ].map(({ dept, icon: Icon, tone, filter }) => {
                  const monthDeptEvents = monthEvents.filter(filter);
                  const totalGuests = monthDeptEvents.reduce((s: number, e: Event) => s + (Number(e.expectedAttendance) || 0), 0);
                  const upcoming = monthDeptEvents.filter((e: Event) => new Date(e.startDate) >= new Date()).length;
                  return (
                    <tr key={dept} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{dept}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Badge tone={tone}>{monthDeptEvents.length} events</Badge>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{totalGuests.toLocaleString()}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{upcoming}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// Initial form states for event setup
const initialFormData = {
  eventType: '' as EventType,
  eventName: '',
  clientId: '',
  clientName: '',
  organizerName: '',
  startDate: '',
  endDate: '',
  venueIds: [] as string[],
  expectedAttendance: '',
  packageId: '',
  notes: '',
  quotedAmount: '',
  depositRequired: ''
};

const initialVenueFormData = {
  venueName: '',
  venueType: 'Ballroom' as VenueType,
  capacity: '',
  area: '',
  floor: '',
  features: '',
  layouts: '',
  hourlyRate: '',
  dailyRate: '',
  isActive: true
};

// Event Booking View
const EventBookingView = ({ venues, events, loading, onRefresh, addNotification }: any) => {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    eventType: '' as EventType,
    eventName: '',
    clientId: '',
    clientName: '',
    organizerName: '',
    startDate: '',
    endDate: '',
    venueIds: [] as string[],
    expectedAttendance: '',
    packageId: '',
    notes: '',
    quotedAmount: '',
    depositRequired: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const statusOptions = ['all', 'Inquiry', 'Tentative', 'Confirmed', 'Planning', 'InProgress', 'Completed', 'Cancelled'];

  const filteredEvents = events.filter((event: any) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
      (event.eventName && event.eventName.toLowerCase().includes(term)) ||
      (event.clientName && event.clientName.toLowerCase().includes(term)) ||
      (event.eventType && event.eventType.toLowerCase().includes(term));
    const matchesStatus = statusFilter === 'all' || event.status === statusFilter;
    const matchesType = typeFilter === 'all' || event.eventType === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const eventTypes: EventType[] = [
    'Wedding', 'Conference', 'Seminar', 'Meeting', 'GalaDinner', 
    'Birthday', 'Anniversary', 'Graduation', 'ReligiousEvent', 
    'Exhibition', 'CocktailReception', 'ProductLaunch', 'CorporateEvent'
  ];

  const getEventTone = (status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
    switch (status) {
      case 'Confirmed':
      case 'Completed':
        return 'success';
      case 'Planning':
      case 'InProgress':
        return 'warning';
      case 'Cancelled':
        return 'danger';
      case 'Tentative':
      case 'Draft':
      default:
        return 'info';
    }
  };

  const getNextEventStatus = (status: string): string | null => {
    switch (status) {
      case 'Inquiry': return 'Tentative';
      case 'Tentative': return 'Confirmed';
      case 'Confirmed': return 'Planning';
      case 'Planning': return 'InProgress';
      case 'InProgress': return 'Completed';
      default: return null;
    }
  };

  const getNextEventActionLabel = (status: string): string => {
    switch (status) {
      case 'Inquiry': return 'Tentative';
      case 'Tentative': return 'Confirm';
      case 'Confirmed': return 'Plan';
      case 'Planning': return 'Start';
      case 'InProgress': return 'Complete';
      default: return '';
    }
  };

  const handleStatusUpdate = async (eventId: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        addNotification(`Event advanced to ${newStatus}`, 'success');
        onRefresh();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to update event status', 'warning');
      }
    } catch (error) {
      console.error('Failed to update event status:', error);
      addNotification('Failed to update event status', 'warning');
    }
  };

  const handleGenerateBEO = async (eventId: string) => {
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/beo`, {
        method: 'POST',
        headers: banquetHeaders()
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        addNotification(data.created ? 'BEO generated from event data' : 'BEO already exists', 'success');
        onRefresh();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to generate BEO', 'warning');
      }
    } catch (error) {
      console.error('Failed to generate BEO:', error);
      addNotification('Failed to generate BEO', 'warning');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/events', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          ...formData,
          expectedAttendance: parseInt(formData.expectedAttendance),
          quotedAmount: parseFloat(formData.quotedAmount) || 0,
          depositRequired: parseFloat(formData.depositRequired) || 0,
          status: 'Inquiry'
        })
      });
      if (response.ok) {
        addNotification('Event inquiry created', 'success');
        setShowForm(false);
        setFormData({ ...initialFormData });
        onRefresh();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to create event', 'warning');
      }
    } catch (error) {
      console.error('Failed to book event:', error);
      addNotification('Failed to create event', 'warning');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className={`${showForm ? button.ghost : button.primary} !text-xs`}
        >
          <Plus size={14} />
          {showForm ? 'Cancel' : 'New Event Booking'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search event, client or type"
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          {statusOptions.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Event Types</option>
          {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Event Type Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event Type</label>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {eventTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFormData({ ...formData, eventType: type })}
                    className={`p-3 rounded-xl text-xs font-bold border transition ${
                      formData.eventType === type
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-600'
                    }`}
                  >
                    {type.replace(/([A-Z])/g, ' $1').trim()}
                  </button>
                ))}
              </div>
            </div>

            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event Name</label>
                <input
                  type="text"
                  value={formData.eventName}
                  onChange={(e) => setFormData({ ...formData, eventName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Organizer Name</label>
                <input
                  type="text"
                  value={formData.organizerName}
                  onChange={(e) => setFormData({ ...formData, organizerName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
            </div>

            {/* Client Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Client Name</label>
                <input
                  type="text"
                  value={formData.clientName}
                  onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Client ID</label>
                <input
                  type="text"
                  value={formData.clientId}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Start Date</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">End Date</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
            </div>

            {/* Venue Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Function Spaces</label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {venues.map((venue: any) => (
                  <label
                    key={venue.venueId}
                    className={`p-3 rounded-xl border cursor-pointer transition ${
                      formData.venueIds.includes(venue.venueId)
                        ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.venueIds.includes(venue.venueId)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, venueIds: [...formData.venueIds, venue.venueId] });
                        } else {
                          setFormData({ ...formData, venueIds: formData.venueIds.filter(id => id !== venue.venueId) });
                        }
                      }}
                      className="sr-only"
                    />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{venue.venueName}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{venue.venueType}</p>
                      </div>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400">Cap: {venue.capacity}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Attendance and Financials */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Expected Attendance</label>
                <input
                  type="number"
                  value={formData.expectedAttendance}
                  onChange={(e) => setFormData({ ...formData, expectedAttendance: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Quoted Amount (ETB)</label>
                <input
                  type="number"
                  value={formData.quotedAmount}
                  onChange={(e) => setFormData({ ...formData, quotedAmount: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Initial quote (charges derived later)"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Deposit Required (ETB)</label>
                <input
                  type="number"
                  value={formData.depositRequired}
                  onChange={(e) => setFormData({ ...formData, depositRequired: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Package */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Package (Optional)</label>
              <input
                type="text"
                value={formData.packageId}
                onChange={(e) => setFormData({ ...formData, packageId: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Enter package ID or name"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                placeholder="Special requests, dietary requirements, etc."
              />
            </div>

            {/* Submit Button */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className={`${button.secondary} !text-xs`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${button.primary} !text-xs`}
              >
                Create Event Inquiry
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <SectionCard title="Event Bookings" icon={Calendar} tone="info" pad="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Attendees</th>
                  <th className="px-4 py-3 font-medium">Quoted / Total</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredEvents.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-500">No event bookings found</td></tr>
                ) : filteredEvents.map((event: any) => {
                  const total = Number(event.grandTotal) || Number(event.quotedAmount) || Number(event.estimatedRevenue) || 0;
                  return (
                  <tr key={event.eventId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {event.eventName}
                      <div className="text-[10px] text-slate-400 mt-0.5">{event.venueIds.length} space(s)</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.clientName}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.eventType}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {new Date(event.startDate).toLocaleDateString()}
                      {event.endDate && event.endDate !== event.startDate && ` - ${new Date(event.endDate).toLocaleDateString()}`}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.expectedAttendance}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">ETB {total.toLocaleString()}</td>
                    <td className="px-4 py-3"><Badge tone={getEventTone(event.status)}>{event.status}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {getNextEventStatus(event.status) && (
                          <button onClick={() => handleStatusUpdate(event.eventId, getNextEventStatus(event.status)!)} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                            {getNextEventActionLabel(event.status)}
                          </button>
                        )}
                        {event.status === 'Confirmed' && !event.beoGenerated && (
                          <button onClick={() => handleGenerateBEO(event.eventId)} className="px-2 py-1 rounded-lg bg-blue-100 dark:bg-blue-900/20 text-[10px] font-bold text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/30" title="Generate BEO from event data">
                            BEO
                          </button>
                        )}
                        {event.status !== 'Cancelled' && event.status !== 'Completed' && (
                          <button onClick={() => handleStatusUpdate(event.eventId, 'Cancelled')} className="px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/20 text-[10px] font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/30">
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
};

// Function Space Management View
const FunctionSpaceView = ({ venues, loading, onRefresh, addNotification }: any) => {
  const [showForm, setShowForm] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [formData, setFormData] = useState(initialVenueFormData);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // Out-of-service windows (469) — bookings on a blacked-out venue are rejected.
  const [blackouts, setBlackouts] = useState<any[]>([]);
  const [showBlackoutForm, setShowBlackoutForm] = useState(false);
  const [blackoutForm, setBlackoutForm] = useState({ venueId: '', startDate: '', endDate: '', reason: '' });

  const fetchBlackouts = useCallback(async () => {
    try {
      const res = await fetch('/api/banquet-events/venue-blackouts', { headers: banquetHeaders() });
      if (res.ok) setBlackouts(await res.json());
    } catch (e) {
      console.error('Failed to load venue blackouts:', e);
    }
  }, []);

  useEffect(() => { fetchBlackouts(); }, [fetchBlackouts]);

  const handleBlackoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/banquet-events/venue-blackouts', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(blackoutForm)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addNotification('Blackout window added', 'success');
        setShowBlackoutForm(false);
        setBlackoutForm({ venueId: '', startDate: '', endDate: '', reason: '' });
        fetchBlackouts();
      } else {
        addNotification(data.error || 'Failed to add blackout', 'warning');
      }
    } catch (e) {
      addNotification('Failed to add blackout', 'warning');
    }
  };

  const handleDeleteBlackout = async (blackoutId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/venue-blackouts/${blackoutId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Blackout removed', 'success');
        fetchBlackouts();
      }
    } catch (e) {
      addNotification('Failed to remove blackout', 'warning');
    }
  };

  const filteredVenues = venues.filter((venue: Venue) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
      (venue.venueName && venue.venueName.toLowerCase().includes(term)) ||
      (venue.venueType && venue.venueType.toLowerCase().includes(term)) ||
      (venue.floor && venue.floor.toLowerCase().includes(term));
    const matchesType = typeFilter === 'all' || venue.venueType === typeFilter;
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? venue.isActive : !venue.isActive);
    return matchesSearch && matchesType && matchesStatus;
  });

  const venueTypes: VenueType[] = [
    'Ballroom', 'ConferenceRoom', 'MeetingRoom', 'OutdoorGarden', 
    'Poolside', 'Rooftop', 'Restaurant', 'VIPLounge', 'ExhibitionHall'
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = selectedVenue ? `/api/banquet-events/venues/${selectedVenue.venueId}` : '/api/banquet-events/venues';
      const response = await fetch(url, {
        method: selectedVenue ? 'PUT' : 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          ...formData,
          capacity: parseInt(formData.capacity),
          area: parseInt(formData.area),
          hourlyRate: parseFloat(formData.hourlyRate),
          dailyRate: parseFloat(formData.dailyRate),
          features: formData.features.split(',').map(f => f.trim()),
          layouts: formData.layouts.split(',').map(l => l.trim())
        })
      });
      if (response.ok) {
        addNotification(selectedVenue ? 'Venue updated successfully' : 'Venue created successfully', 'success');
        setShowForm(false);
        setSelectedVenue(null);
        setFormData(initialVenueFormData);
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to save venue:', error);
      addNotification('Failed to save venue', 'warning');
    }
  };

  const handleEdit = (venue: Venue) => {
    setSelectedVenue(venue);
    setFormData({
      venueName: venue.venueName,
      venueType: venue.venueType,
      capacity: venue.capacity.toString(),
      area: venue.area.toString(),
      floor: venue.floor,
      features: venue.features.join(', '),
      layouts: venue.layouts.join(', '),
      hourlyRate: venue.hourlyRate.toString(),
      dailyRate: venue.dailyRate.toString(),
      isActive: venue.isActive
    });
    setShowForm(true);
  };

  const handleDeleteVenue = async (venueId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/venues/${venueId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Venue deleted', 'success');
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to delete venue', 'warning');
      }
    } catch (e) {
      addNotification('Failed to delete venue', 'warning');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => {
            setSelectedVenue(null);
            setFormData(initialVenueFormData);
            setShowForm(!showForm);
          }}
          className={`${showForm ? button.ghost : button.primary} !text-xs`}
        >
          <Plus size={14} />
          {showForm ? 'Cancel' : 'Add Venue'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search venue, type or floor"
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Venue Types</option>
          {venueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Venue Name</label>
                <input
                  type="text"
                  value={formData.venueName}
                  onChange={(e) => setFormData({ ...formData, venueName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Venue Type</label>
                <select
                  value={formData.venueType}
                  onChange={(e) => setFormData({ ...formData, venueType: e.target.value as VenueType })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                >
                  {venueTypes.map(type => (
                    <option key={type} value={type}>{type.replace(/([A-Z])/g, ' $1').trim()}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Capacity</label>
                <input
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Area (sq ft)</label>
                <input
                  type="number"
                  value={formData.area}
                  onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Floor</label>
                <input
                  type="text"
                  value={formData.floor}
                  onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Hourly Rate</label>
                <input
                  type="number"
                  value={formData.hourlyRate}
                  onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Daily Rate</label>
                <input
                  type="number"
                  value={formData.dailyRate}
                  onChange={(e) => setFormData({ ...formData, dailyRate: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Features (comma-separated)</label>
              <input
                type="text"
                value={formData.features}
                onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., Projector, Sound System, Stage"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Layouts (comma-separated)</label>
              <input
                type="text"
                value={formData.layouts}
                onChange={(e) => setFormData({ ...formData, layouts: e.target.value })}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., Theater, Classroom, Banquet"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="isActive" className="text-xs font-bold text-slate-700 dark:text-slate-300">Active</label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className={`${button.secondary} !text-xs`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${button.primary} !text-xs`}
              >
                {selectedVenue ? 'Update Venue' : 'Create Venue'}
              </button>
            </div>
          </form>
        </div>
      )}

      <SectionCard title="Function Spaces" icon={Building2} tone="accent" pad="none">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Venue</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Capacity</th>
                <th className="px-4 py-3 font-medium">Area</th>
                <th className="px-4 py-3 font-medium">Floor</th>
                <th className="px-4 py-3 font-medium">Hourly</th>
                <th className="px-4 py-3 font-medium">Daily</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
              ) : filteredVenues.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">No venues found</td></tr>
              ) : filteredVenues.map((venue: any) => (
                <tr key={venue.venueId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {venue.venueName}
                    {venue.features.length > 0 && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {venue.features.slice(0, 3).join(', ')}
                        {venue.features.length > 3 ? ` +${venue.features.length - 3}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{venue.venueType}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{venue.capacity}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{venue.area} sq ft</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{venue.floor || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">ETB {Number(venue.hourlyRate).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">ETB {Number(venue.dailyRate).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge tone={venue.isActive ? 'success' : 'neutral'}>{venue.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleEdit(venue)} className="p-1.5 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit"><Edit size={16} /></button>
                    <button onClick={() => handleDeleteVenue(venue.venueId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Out-of-service windows (469) — bookings on a blacked-out venue are rejected */}
      <SectionCard title="Blackout Dates" icon={XCircle} tone="warning" pad="none"
        actions={
          <button onClick={() => setShowBlackoutForm(!showBlackoutForm)} className={`${button.primary} !text-xs`}>
            <Plus size={14} /> {showBlackoutForm ? 'Cancel' : 'Add Blackout'}
          </button>
        }>
        <div className="p-4 space-y-3">
          {showBlackoutForm && (
            <form onSubmit={handleBlackoutSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
              <select
                value={blackoutForm.venueId}
                onChange={(e) => setBlackoutForm({ ...blackoutForm, venueId: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              >
                <option value="">Venue…</option>
                {venues.map((v: any) => <option key={v.venueId} value={v.venueId}>{v.venueName}</option>)}
              </select>
              <input
                type="date" value={blackoutForm.startDate}
                onChange={(e) => setBlackoutForm({ ...blackoutForm, startDate: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
              <input
                type="date" value={blackoutForm.endDate}
                onChange={(e) => setBlackoutForm({ ...blackoutForm, endDate: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
              <input
                type="text" placeholder="Reason (maintenance, renovation…)" value={blackoutForm.reason}
                onChange={(e) => setBlackoutForm({ ...blackoutForm, reason: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <button type="submit" className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition">Block Dates</button>
            </form>
          )}
          {blackouts.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No blackout windows — all active venues are bookable year-round.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {blackouts.map((b: any) => (
                <div key={b.blackoutId} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <Badge tone="danger">{b.venueName || 'Venue'}</Badge>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {new Date(b.startDate).toLocaleDateString()} → {new Date(b.endDate).toLocaleDateString()}
                    </span>
                    {b.reason && <span className="text-xs text-slate-500">{b.reason}</span>}
                  </div>
                  <button onClick={() => handleDeleteBlackout(b.blackoutId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Remove blackout"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

const EventPlanningView = ({ events, beos, loading, onRefresh, addNotification }: any) => {
  const [scheduleForm, setScheduleForm] = useState({
    eventId: '',
    taskName: '',
    startTime: '',
    endTime: '',
    assignedTo: '',
    department: '',
    priority: 'Normal',
    notes: ''
  });
  const [checklistForm, setChecklistForm] = useState({
    eventId: '',
    itemName: '',
    category: '',
    itemType: '',
    dueDate: '',
    assignedTo: ''
  });
  const [schedules, setSchedules] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [addingScheduleFor, setAddingScheduleFor] = useState<string | null>(null);
  const [addingChecklistFor, setAddingChecklistFor] = useState<string | null>(null);
  const [typeDetails, setTypeDetails] = useState<Record<string, any[]>>({});
  const [typeDetailsLoading, setTypeDetailsLoading] = useState<string | null>(null);
  const [addingTypeDetailFor, setAddingTypeDetailFor] = useState<string | null>(null);
  const [typeDetailForm, setTypeDetailForm] = useState<{ itemType: string; itemData: Record<string, any> }>({ itemType: '', itemData: {} });
  const [editingTypeDetailId, setEditingTypeDetailId] = useState<string | null>(null);

  const fetchTypeDetails = useCallback(async (eventId: string) => {
    setTypeDetailsLoading(eventId);
    try {
      const res = await fetch(`/api/banquet-events/events/${eventId}/type-details`, {
        headers: banquetHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setTypeDetails(prev => ({ ...prev, [eventId]: Array.isArray(data) ? data : [] }));
      }
    } catch (e) {
      console.error('Failed to load type details:', e);
    } finally {
      setTypeDetailsLoading(null);
    }
  }, []);

  const handleTypeDetailSubmit = async (e: React.FormEvent, eventId: string) => {
    e.preventDefault();
    try {
      const url = editingTypeDetailId
        ? `/api/banquet-events/type-details/${editingTypeDetailId}`
        : `/api/banquet-events/events/${eventId}/type-details`;
      const method = editingTypeDetailId ? 'PUT' : 'POST';
      const body = editingTypeDetailId
        ? { itemData: typeDetailForm.itemData }
        : { itemType: typeDetailForm.itemType, itemData: typeDetailForm.itemData };
      const res = await fetch(url, {
        method,
        headers: banquetHeaders(true),
        body: JSON.stringify(body)
      });
      if (res.ok) {
        addNotification(editingTypeDetailId ? 'Details updated' : 'Details added', 'success');
        setAddingTypeDetailFor(null);
        setEditingTypeDetailId(null);
        setTypeDetailForm({ itemType: '', itemData: {} });
        fetchTypeDetails(eventId);
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to save details', 'warning');
      }
    } catch (e) {
      addNotification('Failed to save details', 'warning');
    }
  };

  const handleDeleteTypeDetail = async (itemId: string, eventId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/type-details/${itemId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Details deleted', 'success');
        fetchTypeDetails(eventId);
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to delete details', 'warning');
    }
  };

  const startEditTypeDetail = (item: any) => {
    setEditingTypeDetailId(item.itemId);
    setAddingTypeDetailFor(item.itemId); // use itemId as marker for form visibility per item
    setTypeDetailForm({ itemType: item.itemType, itemData: { ...item.itemData } });
  };

  // Field configs for each event type — mirrors the old EventTypeManagementView
  const TYPE_DETAIL_FIELDS: Record<string, { name: string; label: string; type?: string; options?: string[] }[]> = {
    wedding: [
      { name: 'brideName', label: 'Bride Name' },
      { name: 'groomName', label: 'Groom Name' },
      { name: 'ceremonyLocation', label: 'Ceremony Location' },
      { name: 'receptionLocation', label: 'Reception Location' },
      { name: 'guestCount', label: 'Guest Count', type: 'number' },
      { name: 'budget', label: 'Budget (ETB)', type: 'number' },
      { name: 'theme', label: 'Theme' },
      { name: 'colorScheme', label: 'Color Scheme' },
      { name: 'specialRequests', label: 'Special Requests' }
    ],
    conference: [
      { name: 'sessionTitle', label: 'Session Title' },
      { name: 'speaker', label: 'Speaker' },
      { name: 'room', label: 'Room' },
      { name: 'startTime', label: 'Start Time', type: 'datetime-local' },
      { name: 'endTime', label: 'End Time', type: 'datetime-local' },
      { name: 'capacity', label: 'Capacity', type: 'number' },
      { name: 'equipment', label: 'Equipment' }
    ],
    meeting: [
      { name: 'agendaItem', label: 'Agenda Item' },
      { name: 'presenter', label: 'Presenter' },
      { name: 'duration', label: 'Duration (min)', type: 'number' },
      { name: 'timeSlot', label: 'Time Slot' }
    ],
    social: [
      { name: 'eventType', label: 'Event Subtype' },
      { name: 'honoreeName', label: 'Honoree Name' },
      { name: 'age', label: 'Age/Years' },
      { name: 'theme', label: 'Theme' },
      { name: 'specialRequirements', label: 'Special Requirements' },
      { name: 'dietaryRestrictions', label: 'Dietary Restrictions' }
    ]
  };

  const TYPE_DETAIL_LABELS: Record<string, string> = {
    wedding: 'Wedding Details',
    conference: 'Conference Sessions',
    meeting: 'Meeting Agenda',
    social: 'Social Event Details'
  };

  const TYPE_DETAIL_ICONS: Record<string, any> = {
    wedding: Heart,
    conference: Users,
    meeting: ClipboardList,
    social: PartyPopper
  };

  const renderTypeDetailValue = (key: string, value: any) => {
    if (value === null || value === undefined || value === '') return '—';
    if (key === 'budget') return `ETB ${Number(value).toLocaleString()}`;
    if (key === 'startTime' || key === 'endTime') {
      try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(value); }
    }
    return String(value);
  };

  const fetchPlanningData = async () => {
    setPlanningLoading(true);

    const safeJson = async (res: any) => {
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn('Expected JSON from planning endpoint but received:', contentType);
        return null;
      }
      try {
        return await res.json();
      } catch (e) {
        console.warn('Failed to parse planning JSON:', e);
        return null;
      }
    };

    try {
      const [sRes, cRes] = await Promise.all([
        fetch('/api/banquet-events/schedules', {
          headers: banquetHeaders()
        }),
        fetch('/api/banquet-events/checklists/unified', {
          headers: banquetHeaders()
        })
      ]);
      if (sRes.ok) {
        const data = await safeJson(sRes);
        setSchedules(Array.isArray(data) ? data : []);
      }
      if (cRes.ok) {
        const data = await safeJson(cRes);
        setChecklists(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load planning data:', error);
    } finally {
      setPlanningLoading(false);
    }
  };

  useEffect(() => {
    fetchPlanningData();
  }, []);

  const getPlanningTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    if (status === 'Completed') return 'success';
    if (status === 'InProgress' || status === 'Planning') return 'warning';
    if (status === 'Confirmed') return 'info';
    return 'neutral';
  };

  const getNextEventStatus = (status: string): string | null => {
    switch (status) {
      case 'Inquiry': return 'Tentative';
      case 'Tentative': return 'Confirmed';
      case 'Confirmed': return 'Planning';
      case 'Planning': return 'InProgress';
      case 'InProgress': return 'Completed';
      default: return null;
    }
  };

  const getNextEventActionLabel = (status: string): string => {
    switch (status) {
      case 'Inquiry': return 'Tentative';
      case 'Tentative': return 'Confirm';
      case 'Confirmed': return 'Plan';
      case 'Planning': return 'Start';
      case 'InProgress': return 'Complete';
      default: return '';
    }
  };

  const handleStatusUpdate = async (eventId: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        addNotification(`Event status updated to ${newStatus}`, 'success');
        onRefresh();
        fetchPlanningData();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to update event status', 'warning');
      }
    } catch (error) {
      console.error('Failed to update event status:', error);
      addNotification('Failed to update event status', 'warning');
    }
  };

  const planningEvents = events.filter((e: Event) => ['Confirmed', 'Planning', 'InProgress'].includes(e.status));

  const filteredPlanningEvents = planningEvents.filter((event: Event) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
      (event.eventName && event.eventName.toLowerCase().includes(term)) ||
      (event.clientName && event.clientName.toLowerCase().includes(term)) ||
      (event.eventType && event.eventType.toLowerCase().includes(term));
    const matchesStatus = statusFilter === 'all' || event.status === statusFilter;
    const matchesType = typeFilter === 'all' || event.eventType === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/schedules', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(scheduleForm)
      });
      if (response.ok) {
        addNotification('Schedule item added successfully', 'success');
        setAddingScheduleFor(null);
        setScheduleForm({ eventId: '', taskName: '', startTime: '', endTime: '', assignedTo: '', department: '', priority: 'Normal', notes: '' });
        fetchPlanningData();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add schedule item', 'warning');
    }
  };

  const handleChecklistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isEventType = !!checklistForm.itemType;
      const endpoint = isEventType
        ? '/api/banquet-events/event-type-checklists'
        : '/api/banquet-events/checklists';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(checklistForm)
      });
      if (response.ok) {
        addNotification('Checklist item added successfully', 'success');
        setAddingChecklistFor(null);
        setChecklistForm({ eventId: '', itemName: '', category: '', itemType: '', dueDate: '', assignedTo: '' });
        fetchPlanningData();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add checklist item', 'warning');
    }
  };

  const toggleChecklist = async (checklistId: string, isCompleted: boolean, _source?: string) => {
    try {
      // All checklists now live in banquet_checklists (consolidated).
      // The event-type-checklists endpoint is kept for backward compat but
      // the unified checklists table is the single source of truth.
      const endpoint = `/api/banquet-events/checklists/${checklistId}/status`;
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ isCompleted })
      });
      if (response.ok) {
        fetchPlanningData();
      } else if (response.status === 401) {
        addNotification('Session expired. Please log in again.', 'warning');
        window.location.href = '/login';
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to update checklist item', 'warning');
      }
    } catch (error) {
      addNotification('Failed to update checklist item', 'warning');
    }
  };

  // Mark a schedule task done / reopen it (461 added real status columns).
  const handleScheduleStatus = async (scheduleId: string, status: string) => {
    try {
      const res = await fetch(`/api/banquet-events/schedules/${scheduleId}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchPlanningData();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to update task status', 'warning');
      }
    } catch (e) {
      addNotification('Failed to update task status', 'warning');
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Schedule task removed', 'success');
        fetchPlanningData();
      }
    } catch (e) {
      addNotification('Failed to remove schedule task', 'warning');
    }
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/checklists/${checklistId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Checklist item removed', 'success');
        fetchPlanningData();
      }
    } catch (e) {
      addNotification('Failed to remove checklist item', 'warning');
    }
  };

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search event, client or type"
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Statuses</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Planning">Planning</option>
          <option value="InProgress">In Progress</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Event Types</option>
          {Array.from(new Set(events.map((e: Event) => e.eventType).filter(Boolean))).sort().map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <SectionCard title="Events in Planning" icon={Calendar} tone="info" pad="none">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium w-8"></th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Guests</th>
                <th className="px-4 py-3 font-medium">Revenue</th>
                <th className="px-4 py-3 font-medium">Days Left</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
              ) : filteredPlanningEvents.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-4 text-center text-slate-500">No events in planning stage</td></tr>
              ) : filteredPlanningEvents.map((event: Event) => {
                const isExpanded = expandedEventId === event.eventId;
                const eventSchedules = schedules.filter((s: any) => s.eventId === event.eventId);
                const eventChecklists = checklists.filter((c: any) => c.eventId === event.eventId);
                const eventBeos = (beos || []).filter((b: any) => b.eventId === event.eventId);
                const completedCount = eventChecklists.filter((c: any) => c.isCompleted).length;
                const eventTypeItems = typeDetails[event.eventId] || [];
                return (
                  <React.Fragment key={event.eventId}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => {
                      const newExpanded = isExpanded ? null : event.eventId;
                      setExpandedEventId(newExpanded);
                      if (newExpanded && !typeDetails[event.eventId]) {
                        fetchTypeDetails(event.eventId);
                      }
                    }}>
                      <td className="px-4 py-3 text-slate-400">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{event.eventName}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.startDate} - {event.endDate}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{event.expectedAttendance || 0}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">ETB {Math.round((Number(event.grandTotal) || Number(event.quotedAmount) || Number(event.estimatedRevenue) || 0) / 1000)}k</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{Math.max(0, Math.floor((new Date(event.startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))}</td>
                      <td className="px-4 py-3"><Badge tone={getPlanningTone(event.status)}>{event.status}</Badge></td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          {getNextEventStatus(event.status) && (
                            <button onClick={() => handleStatusUpdate(event.eventId, getNextEventStatus(event.status)!)} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                              {getNextEventActionLabel(event.status)}
                            </button>
                          )}
                          {event.status !== 'Cancelled' && event.status !== 'Completed' && (
                            <button onClick={() => handleStatusUpdate(event.eventId, 'Cancelled')} className="px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/20 text-[10px] font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/30">
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 dark:bg-slate-900/30">
                        <td colSpan={8} className="px-8 py-4">
                          <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-3 text-[10px] uppercase text-slate-500">
                              <div className="flex items-center gap-2"><Clock size={12} /> Schedules: {eventSchedules.length}</div>
                              <div className="flex items-center gap-2"><CheckSquare size={12} /> Checklist: {completedCount}/{eventChecklists.length}</div>
                              <div className="flex items-center gap-2"><FileText size={12} /> BEOs: {eventBeos.length}</div>
                            </div>

                            {/* Event-Type Details (wedding, conference, meeting, social) */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                                <span className="flex items-center gap-2"><Heart size={12} /> Event-Type Details</span>
                                <div className="flex items-center gap-2">
                                  {!addingTypeDetailFor && (
                                    <select
                                      value={typeDetailForm.itemType}
                                      onChange={(e) => {
                                        setTypeDetailForm({ itemType: e.target.value, itemData: {} });
                                        setAddingTypeDetailFor(event.eventId);
                                        setEditingTypeDetailId(null);
                                      }}
                                      className="!text-[10px] !px-2 !py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                                    >
                                      <option value="">+ Add Details…</option>
                                      <option value="wedding">Wedding</option>
                                      <option value="conference">Conference</option>
                                      <option value="meeting">Meeting</option>
                                      <option value="social">Social</option>
                                    </select>
                                  )}
                                </div>
                              </div>

                              {typeDetailsLoading === event.eventId ? (
                                <div className="px-4 py-3 text-center text-slate-500 text-xs">Loading details…</div>
                              ) : eventTypeItems.length === 0 && !addingTypeDetailFor ? (
                                <div className="px-4 py-3 text-center text-slate-500 text-xs">No type-specific details yet. Use the dropdown above to add wedding, conference, meeting, or social details.</div>
                              ) : (
                                <div className="divide-y divide-gray-200 dark:divide-slate-700">
                                  {eventTypeItems.map((item: any) => {
                                    const Icon = TYPE_DETAIL_ICONS[item.itemType] || FileText;
                                    const fields = TYPE_DETAIL_FIELDS[item.itemType] || [];
                                    const isEditingThis = editingTypeDetailId === item.itemId;
                                    return (
                                      <div key={item.itemId} className="p-4">
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                                            <Icon size={14} />
                                            {TYPE_DETAIL_LABELS[item.itemType] || item.itemType}
                                          </span>
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => isEditingThis ? (setEditingTypeDetailId(null), setAddingTypeDetailFor(null), setTypeDetailForm({ itemType: '', itemData: {} })) : startEditTypeDetail(item)}
                                              className="p-1 text-slate-400 hover:text-violet-600"
                                              title={isEditingThis ? 'Cancel' : 'Edit'}
                                            >
                                              {isEditingThis ? <XCircle size={14} /> : <Edit size={14} />}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteTypeDetail(item.itemId, event.eventId)}
                                              className="p-1 text-slate-400 hover:text-rose-500"
                                              title="Delete"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </div>
                                        {isEditingThis ? (
                                          <form onSubmit={(e) => handleTypeDetailSubmit(e, event.eventId)} className="space-y-3">
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                              {fields.map((f) => (
                                                <div key={f.name}>
                                                  <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">{f.label}</label>
                                                  <input
                                                    type={f.type || 'text'}
                                                    value={typeDetailForm.itemData[f.name] ?? ''}
                                                    onChange={(e) => setTypeDetailForm({ ...typeDetailForm, itemData: { ...typeDetailForm.itemData, [f.name]: e.target.value } })}
                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                                  />
                                                </div>
                                              ))}
                                            </div>
                                            <button type="submit" className={`${button.primary} !text-xs`}>Save Changes</button>
                                          </form>
                                        ) : (
                                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {fields.map((f) => (
                                              <div key={f.name} className="text-xs">
                                                <span className="text-slate-500 dark:text-slate-400 font-medium">{f.label}: </span>
                                                <span className="text-slate-900 dark:text-white">{renderTypeDetailValue(f.name, item.itemData?.[f.name])}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}

                                  {addingTypeDetailFor === event.eventId && !editingTypeDetailId && typeDetailForm.itemType && (
                                    <form onSubmit={(e) => handleTypeDetailSubmit(e, event.eventId)} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40">
                                      <div className="flex items-center justify-between">
                                        <span className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                                          {(() => { const Icon = TYPE_DETAIL_ICONS[typeDetailForm.itemType] || Plus; return <Icon size={14} />; })()}
                                          New {TYPE_DETAIL_LABELS[typeDetailForm.itemType]}
                                        </span>
                                        <button type="button" onClick={() => { setAddingTypeDetailFor(null); setTypeDetailForm({ itemType: '', itemData: {} }); }} className="p-1 text-slate-400 hover:text-rose-500">
                                          <XCircle size={14} />
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {(TYPE_DETAIL_FIELDS[typeDetailForm.itemType] || []).map((f) => (
                                          <div key={f.name}>
                                            <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">{f.label}</label>
                                            <input
                                              type={f.type || 'text'}
                                              value={typeDetailForm.itemData[f.name] ?? ''}
                                              onChange={(e) => setTypeDetailForm({ ...typeDetailForm, itemData: { ...typeDetailForm.itemData, [f.name]: e.target.value } })}
                                              className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                      <button type="submit" className={`${button.primary} !text-xs`}>Add Details</button>
                                    </form>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                                <span className="flex items-center gap-2"><Clock size={12} /> Event Schedule</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddingScheduleFor(addingScheduleFor === event.eventId ? null : event.eventId);
                                    setScheduleForm({ eventId: event.eventId, taskName: '', startTime: '', endTime: '', assignedTo: '', department: '', notes: '' });
                                  }}
                                  className={`${addingScheduleFor === event.eventId ? button.ghost : button.primary} !text-[10px] !px-2 !py-1 flex items-center gap-1`}
                                >
                                  <Plus size={10} />
                                  {addingScheduleFor === event.eventId ? 'Cancel' : 'Add Task'}
                                </button>
                              </div>

                              {addingScheduleFor === event.eventId && (
                                <form onSubmit={handleScheduleSubmit} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Task Name</label>
                                      <input
                                        type="text"
                                        value={scheduleForm.taskName}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, taskName: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                        required
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Department</label>
                                      <select
                                        value={scheduleForm.department}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, department: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      >
                                        <option value="">Select</option>
                                        <option value="F&B">F&B</option>
                                        <option value="Housekeeping">Housekeeping</option>
                                        <option value="Engineering">Engineering</option>
                                        <option value="Security">Security</option>
                                        <option value="Front Office">Front Office</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Assigned To</label>
                                      <input
                                        type="text"
                                        value={scheduleForm.assignedTo}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, assignedTo: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Start</label>
                                      <input
                                        type="datetime-local"
                                        value={scheduleForm.startTime}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                        required
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">End</label>
                                      <input
                                        type="datetime-local"
                                        value={scheduleForm.endTime}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                        required
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Priority</label>
                                      <select
                                        value={scheduleForm.priority}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, priority: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      >
                                        <option value="Low">Low</option>
                                        <option value="Normal">Normal</option>
                                        <option value="High">High</option>
                                        <option value="Urgent">Urgent</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                                      <input
                                        type="text"
                                        value={scheduleForm.notes}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex justify-end">
                                    <button type="submit" className={`${button.primary} !text-xs`}>Add Task</button>
                                  </div>
                                </form>
                              )}

                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-left text-[10px] uppercase text-slate-500">
                                    <tr>
                                      <th className="px-4 py-2 font-medium">Task</th>
                                      <th className="px-4 py-2 font-medium">Department</th>
                                      <th className="px-4 py-2 font-medium">Priority</th>
                                      <th className="px-4 py-2 font-medium">Start</th>
                                      <th className="px-4 py-2 font-medium">End</th>
                                      <th className="px-4 py-2 font-medium">Assigned</th>
                                      <th className="px-4 py-2 font-medium">Status</th>
                                      <th className="px-4 py-2 font-medium">Notes</th>
                                      <th className="px-4 py-2 font-medium"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {eventSchedules.length === 0 ? (
                                      <tr><td colSpan={9} className="px-4 py-3 text-center text-slate-500">No schedule tasks yet. Click "Add Task" to create one.</td></tr>
                                    ) : eventSchedules.map((s: any) => (
                                      <tr key={s.scheduleId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">{s.taskName}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{s.department || '—'}</td>
                                        <td className="px-4 py-2">
                                          <Badge tone={s.priority === 'Urgent' ? 'danger' : s.priority === 'High' ? 'warning' : 'neutral'}>{s.priority || 'Normal'}</Badge>
                                        </td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{s.startTime ? new Date(s.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{s.endTime ? new Date(s.endTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{s.assignedTo || '—'}</td>
                                        <td className="px-4 py-2">
                                          <Badge tone={s.status === 'Completed' ? 'success' : s.status === 'InProgress' ? 'info' : s.status === 'Cancelled' ? 'danger' : 'neutral'}>
                                            {s.status || 'Pending'}
                                          </Badge>
                                        </td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{s.notes || '—'}</td>
                                        <td className="px-4 py-2 text-right whitespace-nowrap">
                                          {s.status !== 'Completed' && s.status !== 'Cancelled' && (
                                            <button onClick={() => handleScheduleStatus(s.scheduleId, 'Completed')} className="p-1.5 text-slate-400 hover:text-emerald-500" title="Mark complete">
                                              <CheckCircle2 size={14} />
                                            </button>
                                          )}
                                          {s.status === 'Completed' && (
                                            <button onClick={() => handleScheduleStatus(s.scheduleId, 'Pending')} className="p-1.5 text-slate-400 hover:text-amber-500" title="Reopen">
                                              <RotateCcw size={14} />
                                            </button>
                                          )}
                                          <button onClick={() => handleDeleteSchedule(s.scheduleId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                                            <Trash2 size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                                <span className="flex items-center gap-2"><CheckSquare size={12} /> Planning Checklist</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/banquet-events/events/${event.eventId}/seed-checklists`, {
                                          method: 'POST',
                                          headers: banquetHeaders()
                                        });
                                        if (res.ok) {
                                          const data = await res.json();
                                          const seeded = data?.seeded ?? 0;
                                          addNotification(seeded > 0 ? `Seeded ${seeded} checklist items from templates` : 'Checklists already up to date', 'success');
                                          fetchPlanningData();
                                        } else {
                                          addNotification('Failed to seed checklists', 'warning');
                                        }
                                      } catch (e) {
                                        addNotification('Failed to seed checklists', 'warning');
                                      }
                                    }}
                                    className="!text-[10px] !px-2 !py-1 flex items-center gap-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-lg font-bold hover:bg-violet-200 dark:hover:bg-violet-900/50"
                                    title="Seed checklist items from Configuration templates"
                                  >
                                    <RefreshCw size={10} />
                                    Seed from Templates
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddingChecklistFor(addingChecklistFor === event.eventId ? null : event.eventId);
                                      setChecklistForm({ eventId: event.eventId, itemName: '', category: '', dueDate: '', assignedTo: '' });
                                    }}
                                    className={`${addingChecklistFor === event.eventId ? button.ghost : button.primary} !text-[10px] !px-2 !py-1 flex items-center gap-1`}
                                  >
                                    <Plus size={10} />
                                    {addingChecklistFor === event.eventId ? 'Cancel' : 'Add Item'}
                                  </button>
                                </div>
                              </div>

                              {addingChecklistFor === event.eventId && (
                                <form onSubmit={handleChecklistSubmit} className="p-4 space-y-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Item Name</label>
                                      <input
                                        type="text"
                                        value={checklistForm.itemName}
                                        onChange={(e) => setChecklistForm({ ...checklistForm, itemName: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                        required
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                                      <select
                                        value={checklistForm.category}
                                        onChange={(e) => setChecklistForm({ ...checklistForm, category: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      >
                                        <option value="">Select</option>
                                        <option value="Venue">Venue</option>
                                        <option value="Catering">Catering</option>
                                        <option value="Equipment">Equipment</option>
                                        <option value="Staffing">Staffing</option>
                                        <option value="Logistics">Logistics</option>
                                        <option value="Coordination">Coordination</option>
                                        <option value="Other">Other</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Type (optional)</label>
                                      <select
                                        value={checklistForm.itemType}
                                        onChange={(e) => setChecklistForm({ ...checklistForm, itemType: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      >
                                        <option value="">General</option>
                                        <option value="wedding">Wedding</option>
                                        <option value="conference">Conference</option>
                                        <option value="meeting">Meeting</option>
                                        <option value="social">Social</option>
                                        <option value="roomblock">Room Block</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
                                      <input
                                        type="date"
                                        value={checklistForm.dueDate}
                                        onChange={(e) => setChecklistForm({ ...checklistForm, dueDate: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mb-1">Assigned To</label>
                                      <input
                                        type="text"
                                        value={checklistForm.assignedTo}
                                        onChange={(e) => setChecklistForm({ ...checklistForm, assignedTo: e.target.value })}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex justify-end">
                                    <button type="submit" className={`${button.primary} !text-xs`}>Add Item</button>
                                  </div>
                                </form>
                              )}

                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-left text-[10px] uppercase text-slate-500">
                                    <tr>
                                      <th className="px-4 py-2 font-medium w-8"></th>
                                      <th className="px-4 py-2 font-medium">Item</th>
                                      <th className="px-4 py-2 font-medium">Source</th>
                                      <th className="px-4 py-2 font-medium">Due</th>
                                      <th className="px-4 py-2 font-medium">Assigned</th>
                                      <th className="px-4 py-2 font-medium">Status</th>
                                      <th className="px-4 py-2 font-medium"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {eventChecklists.length === 0 ? (
                                      <tr><td colSpan={7} className="px-4 py-3 text-center text-slate-500">No checklist items yet. Click "Seed from Templates" to auto-generate from Configuration, or "Add Item" to create one manually.</td></tr>
                                    ) : eventChecklists.map((c: any) => (
                                      <tr key={c.checklistId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <td className="px-4 py-2">
                                          <input
                                            type="checkbox"
                                            checked={!!c.isCompleted}
                                            onChange={(e) => toggleChecklist(c.checklistId, e.target.checked, c.source)}
                                            className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                          />
                                        </td>
                                        <td className={`px-4 py-2 ${c.isCompleted ? 'line-through text-slate-400' : 'font-medium text-slate-900 dark:text-white'}`}>{c.itemName}</td>
                                        <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${c.source === 'template' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : c.source === 'event-type' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>{c.source === 'template' ? 'template' : c.source === 'event-type' ? (c.itemType || 'type') : 'manual'}</span></td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.dueDate ? new Date(c.dueDate).toLocaleDateString() : '—'}</td>
                                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.assignedTo || '—'}</td>
                                        <td className="px-4 py-2"><Badge tone={c.isCompleted ? 'success' : 'info'}>{c.isCompleted ? 'Done' : 'Open'}</Badge></td>
                                        <td className="px-4 py-2 text-right">
                                          <button onClick={() => handleDeleteChecklist(c.checklistId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                                            <Trash2 size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {eventBeos.length > 0 && (
                              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                                <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between">
                                  <span className="flex items-center gap-2"><FileText size={12} /> Banquet Event Orders</span>
                                  <span className="text-[9px] font-normal text-slate-400">Manage BEO status in the BEO tab</span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="text-left text-[10px] uppercase text-slate-500">
                                      <tr>
                                        <th className="px-4 py-2 font-medium">Setup</th>
                                        <th className="px-4 py-2 font-medium">Start</th>
                                        <th className="px-4 py-2 font-medium">End</th>
                                        <th className="px-4 py-2 font-medium">Breakdown</th>
                                        <th className="px-4 py-2 font-medium">Menu</th>
                                        <th className="px-4 py-2 font-medium">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                      {eventBeos.map((b: any) => (
                                        <tr key={b.beoId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.setupTime ? new Date(b.setupTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.eventStartTime ? new Date(b.eventStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.eventEndTime ? new Date(b.eventEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{b.breakdownTime ? new Date(b.breakdownTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{Array.isArray(b.menuItems) ? b.menuItems.length : 0} items</td>
                                          <td className="px-4 py-2"><Badge tone={b.status === 'Distributed' || b.status === 'Final' || b.status === 'Completed' ? 'success' : b.status === 'Approved' || b.status === 'Revised' ? 'warning' : 'info'}>{b.status}</Badge></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {eventSchedules.length === 0 && eventChecklists.length === 0 && eventBeos.length === 0 && (
                              <p className="text-xs text-slate-500 italic">No schedules, checklists, or BEOs for this event yet.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};

// Banquet Event Orders (BEO) View
const BEOView = ({ beos, events, loading, onRefresh, addNotification }: any) => {
  const [showForm, setShowForm] = useState(false);
  const [selectedBEO, setSelectedBEO] = useState<BEO | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | BEOStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [generateEventId, setGenerateEventId] = useState('');
  const [formData, setFormData] = useState({
    eventId: '',
    setupTime: '',
    eventStartTime: '',
    eventEndTime: '',
    breakdownTime: '',
    menuItems: '',
    beverageItems: '',
    equipment: '',
    staffing: '',
    specialRequests: '',
    vipInformation: ''
  });

  const beosByStatus = filterStatus === 'all'
    ? beos
    : beos.filter((b: BEO) => b.status === filterStatus);

  const filteredBEOs = beosByStatus.filter((b: BEO) => {
    const term = searchTerm.toLowerCase();
    return !searchTerm ||
      (b.eventName && b.eventName.toLowerCase().includes(term)) ||
      (b.clientName && b.clientName.toLowerCase().includes(term)) ||
      (b.status && b.status.toLowerCase().includes(term));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = selectedBEO ? `/api/banquet-events/beos/${selectedBEO.beoId}` : '/api/banquet-events/beos';
      const response = await fetch(url, {
        method: selectedBEO ? 'PUT' : 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          ...formData,
          menuItems: formData.menuItems.split('\n').filter(i => i.trim()),
          beverageItems: formData.beverageItems.split('\n').filter(i => i.trim()),
          equipment: formData.equipment.split('\n').filter(i => i.trim()),
          specialRequests: formData.specialRequests.split('\n').filter(i => i.trim()),
          vipInformation: formData.vipInformation.split('\n').filter(i => i.trim()),
          staffing: formData.staffing.split('\n').map(s => {
            const [role, count] = s.split(':');
            return { role: role?.trim() || '', count: parseInt(count?.trim() || '0') };
          }),
          status: 'Draft' as BEOStatus,
          beoId: selectedBEO?.beoId
        })
      });
      if (response.ok) {
        addNotification(selectedBEO ? 'BEO updated successfully' : 'BEO created successfully', 'success');
        setShowForm(false);
        setSelectedBEO(null);
        setFormData({
          eventId: '',
          setupTime: '',
          eventStartTime: '',
          eventEndTime: '',
          breakdownTime: '',
          menuItems: '',
          beverageItems: '',
          equipment: '',
          staffing: '',
          specialRequests: '',
          vipInformation: ''
        });
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to save BEO:', error);
      addNotification('Failed to save BEO', 'warning');
    }
  };

  const handleEdit = (beo: BEO) => {
    setSelectedBEO(beo);
    setFormData({
      eventId: beo.eventId,
      setupTime: beo.setupTime,
      eventStartTime: beo.eventStartTime,
      eventEndTime: beo.eventEndTime,
      breakdownTime: beo.breakdownTime,
      menuItems: beo.menuItems.join('\n'),
      beverageItems: beo.beverageItems.join('\n'),
      equipment: beo.equipment.join('\n'),
      staffing: beo.staffing.map(s => `${s.role}: ${s.count}`).join('\n'),
      specialRequests: beo.specialRequests.join('\n'),
      vipInformation: beo.vipInformation.join('\n')
    });
    setShowForm(true);
  };

  const handleGenerateBEO = async (eventId: string) => {
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/beo`, {
        method: 'POST',
        headers: banquetHeaders()
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        addNotification(data.created ? 'BEO generated from event catering & logistics' : 'BEO already exists for this event', 'success');
        onRefresh();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to generate BEO', 'warning');
      }
    } catch (error) {
      console.error('Failed to generate BEO:', error);
      addNotification('Failed to generate BEO', 'warning');
    }
  };

  const updateBEOStatus = async (beoId: string, newStatus: BEOStatus) => {
    try {
      const response = await fetch(`/api/banquet-events/beos/${beoId}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        addNotification(`BEO status updated to ${newStatus}`, 'success');
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to update BEO status:', error);
      addNotification('Failed to update BEO status', 'warning');
    }
  };

  const distributeBEO = async (beoId: string) => {
    try {
      const response = await fetch(`/api/banquet-events/beos/${beoId}/status`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status: 'Distributed' })
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        addNotification(`BEO distributed to departments${data.tasksCreated ? ` (${data.tasksCreated} tasks created)` : ''}`, 'success');
        onRefresh();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || 'Failed to distribute BEO', 'warning');
      }
    } catch (error) {
      console.error('Failed to distribute BEO:', error);
      addNotification('Failed to distribute BEO', 'warning');
    }
  };

  const handleDeleteBeo = async (beoId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/beos/${beoId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Draft BEO deleted', 'success');
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to delete BEO', 'warning');
      }
    } catch (e) {
      addNotification('Failed to delete BEO', 'warning');
    }
  };

  // Print a formatted BEO document (spec §BEO — printable banquet order).
  const printBEO = (beo: any) => {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const list = (items: any[]) => (items || []).length
      ? `<ul>${items.map(i => `<li>${esc(typeof i === 'object' ? `${i.role || i.name || ''} ${i.count ? '× ' + i.count : ''}` : i)}</li>`).join('')}</ul>`
      : '<em>None</em>';
    const t = (d: any) => d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    w.document.write(`<!DOCTYPE html><html><head><title>BEO — ${esc(beo.eventName)}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 32px; color: #111; font-size: 13px; }
        h1 { font-size: 20px; margin: 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #999; padding-bottom: 4px; margin: 20px 0 8px; }
        .meta { color: #555; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        td, th { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 12px; }
        ul { margin: 4px 0; padding-left: 20px; }
        .status { display: inline-block; padding: 2px 10px; border: 1px solid #333; border-radius: 4px; font-weight: bold; }
      </style></head><body>
      <h1>Banquet Event Order</h1>
      <p class="meta"><strong>${esc(beo.eventName)}</strong> — ${esc(beo.clientName)} · ${esc(new Date(beo.eventDate).toLocaleDateString())} · <span class="status">${esc(beo.status)}</span></p>
      <h2>Schedule</h2>
      <table><tr><th>Setup</th><th>Event Start</th><th>Event End</th><th>Breakdown</th></tr>
      <tr><td>${t(beo.setupTime)}</td><td>${t(beo.eventStartTime)}</td><td>${t(beo.eventEndTime)}</td><td>${t(beo.breakdownTime)}</td></tr></table>
      <h2>Menu</h2>${list(beo.menuItems)}
      <h2>Beverages</h2>${list(beo.beverageItems)}
      <h2>Equipment</h2>${list(beo.equipment)}
      <h2>Staffing</h2>${list(beo.staffing)}
      <h2>Special Requests</h2>${list(beo.specialRequests)}
      <h2>VIP Information</h2>${list(beo.vipInformation)}
      ${beo.distributedAt ? `<p class="meta">Distributed ${t(beo.distributedAt)} to ${esc((beo.distributedTo || []).join(', '))}</p>` : ''}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  // Revision history (467): each UPDATE on the BEO snapshots the prior state.
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [beoVersions, setBeoVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const loadVersions = async (beoId: string) => {
    setVersionsFor(beoId);
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/banquet-events/beos/${beoId}/versions`, { headers: banquetHeaders() });
      if (res.ok) setBeoVersions(await res.json());
    } catch (e) {
      console.error('Failed to load BEO versions:', e);
    } finally {
      setVersionsLoading(false);
    }
  };

  const getBeoTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'Distributed':
      case 'Final':
      case 'Completed':
        return 'success';
      case 'Approved':
      case 'Revised':
        return 'warning';
      case 'Draft':
      case 'Review':
      default:
        return 'info';
    }
  };

  const getNextStatus = (status: BEOStatus): BEOStatus | null => {
    switch (status) {
      case 'Draft': return 'Review';
      case 'Review': return 'Approved';
      case 'Approved': return 'Distributed';
      case 'Distributed': return 'Final';
      case 'Final': return 'Completed';
      default: return null;
    }
  };

  const getNextActionLabel = (status: BEOStatus): string => {
    switch (status) {
      case 'Draft': return 'Review';
      case 'Review': return 'Approve';
      case 'Approved': return 'Distribute';
      case 'Distributed': return 'Finalize';
      case 'Final': return 'Complete';
      default: return '';
    }
  };

  // Events that are confirmed/planning but have no BEO yet — candidates for generation.
  const eventsWithoutBEO = events.filter((e: any) =>
    ['Confirmed', 'Planning', 'InProgress'].includes(e.status) &&
    !beos.some((b: BEO) => b.eventId === e.eventId)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-end gap-2 w-full md:w-auto">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search BEO or client"
            className="w-full md:w-64 px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | BEOStatus)}
            className="px-3 py-2 text-xs font-bold bg-slate-100 dark:bg-slate-800 rounded-lg border-0 text-slate-900 dark:text-white"
          >
            <option value="all">All Status</option>
            <option value="Draft">Draft</option>
            <option value="Review">Review</option>
            <option value="Approved">Approved</option>
            <option value="Distributed">Distributed</option>
            <option value="Revised">Revised</option>
            <option value="Final">Final</option>
            <option value="Completed">Completed</option>
          </select>
          <select
            value={generateEventId}
            onChange={(e) => setGenerateEventId(e.target.value)}
            className="px-3 py-2 text-xs font-bold bg-slate-100 dark:bg-slate-800 rounded-lg border-0 text-slate-900 dark:text-white"
          >
            <option value="">Generate BEO for…</option>
            {eventsWithoutBEO.map((e: any) => (
              <option key={e.eventId} value={e.eventId}>{e.eventName}</option>
            ))}
          </select>
          <button
            onClick={() => generateEventId && handleGenerateBEO(generateEventId)}
            disabled={!generateEventId}
            className={`${button.primary} !text-xs disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Plus size={14} />
            Generate BEO
          </button>
      </div>

      {eventsWithoutBEO.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300">
          <strong>{eventsWithoutBEO.length} event(s)</strong> are confirmed or in progress without a BEO.
          BEOs are generated automatically from the catering menu, beverages, equipment, and logistics
          already captured in their respective tabs — no duplicate data entry needed.
        </div>
      )}

      {showForm && selectedBEO && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-xs text-slate-500">
              Editing BEO for <strong>{selectedBEO.eventName}</strong>. Menu, beverages, and equipment
              are derived from the Catering & Logistics tabs and cannot be edited here.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Setup Time</label>
                <input
                  type="datetime-local"
                  value={formData.setupTime}
                  onChange={(e) => setFormData({ ...formData, setupTime: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event Start</label>
                <input
                  type="datetime-local"
                  value={formData.eventStartTime}
                  onChange={(e) => setFormData({ ...formData, eventStartTime: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event End</label>
                <input
                  type="datetime-local"
                  value={formData.eventEndTime}
                  onChange={(e) => setFormData({ ...formData, eventEndTime: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Breakdown Time</label>
                <input
                  type="datetime-local"
                  value={formData.breakdownTime}
                  onChange={(e) => setFormData({ ...formData, breakdownTime: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Staffing (role: count, one per line)</label>
              <textarea
                value={formData.staffing}
                onChange={(e) => setFormData({ ...formData, staffing: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                placeholder="Waiters: 10&#10;Bartenders: 3&#10;Chefs: 5"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Special Requests (one per line)</label>
                <textarea
                  value={formData.specialRequests}
                  onChange={(e) => setFormData({ ...formData, specialRequests: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  placeholder="Gluten-free options needed&#10;Vegetarian menu for 5 guests"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">VIP Information (one per line)</label>
                <textarea
                  value={formData.vipInformation}
                  onChange={(e) => setFormData({ ...formData, vipInformation: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  placeholder="VIP Guest: John Doe - Table 1&#10;VIP Guest: Jane Smith - Table 2"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setSelectedBEO(null); }}
                className={`${button.secondary} !text-xs`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${button.primary} !text-xs`}
              >
                Update BEO
              </button>
            </div>
          </form>
        </div>
      )}

      <SectionCard title="Banquet Event Orders" icon={FileText} tone="accent" pad="none">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Event Date</th>
                <th className="px-4 py-3 font-medium">Setup</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">End</th>
                <th className="px-4 py-3 font-medium">Breakdown</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
              ) : filteredBEOs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-4 text-center text-slate-500">No BEOs found</td></tr>
              ) : filteredBEOs.map((beo: any) => (
                <tr key={beo.beoId} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {beo.eventName}
                    <div className="text-[10px] text-slate-400 mt-0.5">{beo.menuItems.length} menu · {beo.beverageItems.length} beverage · {beo.equipment.length} equipment · {beo.staffing.length} staff</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{beo.clientName}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{new Date(beo.eventDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{new Date(beo.setupTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{new Date(beo.eventStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{new Date(beo.eventEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{new Date(beo.breakdownTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3"><Badge tone={getBeoTone(beo.status)}>{beo.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {getNextStatus(beo.status) && (
                        <button onClick={() => updateBEOStatus(beo.beoId, getNextStatus(beo.status)!)} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" title={getNextActionLabel(beo.status)}>{getNextActionLabel(beo.status)}</button>
                      )}
                      {beo.status === 'Approved' && (
                        <button onClick={() => distributeBEO(beo.beoId)} className="px-2 py-1 rounded-lg bg-blue-100 dark:bg-blue-900/20 text-[10px] font-bold text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/30" title="Distribute to departments">
                          Distribute
                        </button>
                      )}
                      <button onClick={() => printBEO(beo)} className="p-1.5 text-slate-400 hover:text-blue-500" title="Print BEO"><Printer size={16} /></button>
                      <button onClick={() => versionsFor === beo.beoId ? setVersionsFor(null) : loadVersions(beo.beoId)} className="p-1.5 text-slate-400 hover:text-violet-500" title="Revision history"><History size={16} /></button>
                      <button onClick={() => handleEdit(beo)} className="p-1.5 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit timing & staffing"><Edit size={16} /></button>
                      {beo.status === 'Draft' && (
                        <button onClick={() => handleDeleteBeo(beo.beoId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete draft BEO"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {versionsFor && (
                <tr className="bg-slate-50 dark:bg-slate-900/40">
                  <td colSpan={9} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Revision History</p>
                      <button onClick={() => setVersionsFor(null)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600">Close</button>
                    </div>
                    {versionsLoading ? (
                      <p className="text-xs text-slate-500">Loading versions…</p>
                    ) : beoVersions.length === 0 ? (
                      <p className="text-xs text-slate-500">No prior revisions — this BEO has never been edited.</p>
                    ) : (
                      <div className="space-y-1">
                        {beoVersions.map((v: any) => (
                          <div key={v.id} className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                            <Badge tone="neutral">v{v.versionNo}</Badge>
                            <Badge tone={getBeoTone(v.status)}>{v.status}</Badge>
                            <span>{new Date(v.createdAt).toLocaleString()}</span>
                            <span className="text-slate-400">
                              setup {v.snapshot?.setup_time ? new Date(v.snapshot.setup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                              · {(v.snapshot?.menu_items || []).length} menu items
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};

const ResourceManagementView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceForm, setResourceForm] = useState({
    eventId: '',
    resourceType: '',
    resourceName: '',
    quantity: '',
    allocatedTo: '',
    startDate: '',
    endDate: '',
    notes: ''
  });
  const [resources, setResources] = useState<any[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  const fetchResources = useCallback(async () => {
    setResourcesLoading(true);
    try {
      const res = await fetch('/api/banquet-events/resources', { headers: banquetHeaders() });
      if (res.ok) setResources(await res.json());
    } catch (e) {
      console.error('Failed to load resources:', e);
    } finally {
      setResourcesLoading(false);
    }
  }, []);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  const handleResourceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/resources', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...resourceForm, quantity: parseInt(resourceForm.quantity) })
      });
      if (response.ok) {
        addNotification('Resource allocated successfully', 'success');
        setShowResourceForm(false);
        setResourceForm({ eventId: '', resourceType: '', resourceName: '', quantity: '', allocatedTo: '', startDate: '', endDate: '', notes: '' });
        fetchResources();
      }
    } catch (error) {
      addNotification('Failed to allocate resource', 'warning');
    }
  };

  const handleDeleteResource = async (resourceId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/resources/${resourceId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Resource removed', 'success');
        fetchResources();
      }
    } catch (e) {
      addNotification('Failed to remove resource', 'warning');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Resource Management</h3>
        <button
          onClick={() => setShowResourceForm(!showResourceForm)}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition"
        >
          <Package size={14} />
          {showResourceForm ? 'Cancel' : 'Allocate Resource'}
        </button>
      </div>

      {showResourceForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleResourceSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select
                  value={resourceForm.eventId}
                  onChange={(e) => setResourceForm({ ...resourceForm, eventId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (
                    <option key={event.eventId} value={event.eventId}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Resource Type</label>
                <select
                  value={resourceForm.resourceType}
                  onChange={(e) => setResourceForm({ ...resourceForm, resourceType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Type</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Furniture">Furniture</option>
                  <option value="Linens">Linens</option>
                  <option value="Decorations">Decorations</option>
                  <option value="Staff">Staff</option>
                  <option value="Vehicles">Vehicles</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Resource Name</label>
                <input
                  type="text"
                  value={resourceForm.resourceName}
                  onChange={(e) => setResourceForm({ ...resourceForm, resourceName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Quantity</label>
                <input
                  type="number"
                  value={resourceForm.quantity}
                  onChange={(e) => setResourceForm({ ...resourceForm, quantity: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Allocated To</label>
                <input
                  type="text"
                  value={resourceForm.allocatedTo}
                  onChange={(e) => setResourceForm({ ...resourceForm, allocatedTo: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Start Date</label>
                <input
                  type="date"
                  value={resourceForm.startDate}
                  onChange={(e) => setResourceForm({ ...resourceForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">End Date</label>
                <input
                  type="date"
                  value={resourceForm.endDate}
                  onChange={(e) => setResourceForm({ ...resourceForm, endDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Notes</label>
              <textarea
                value={resourceForm.notes}
                onChange={(e) => setResourceForm({ ...resourceForm, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                rows={2}
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition"
            >
              Allocate Resource
            </button>
          </form>
        </div>
      )}

      <SectionCard title={`Allocated Resources (${resources.length})`} loading={resourcesLoading}>
        {resources.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No resources allocated yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Event</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Resource</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Type</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Qty</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Dates</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Notes</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {resources.map((r: any) => (
                <tr key={r.resourceId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{r.eventName || r.eventId}</td>
                  <td className="px-4 py-2 text-slate-900 dark:text-white font-medium">{r.resourceName}</td>
                  <td className="px-4 py-2"><Badge tone="info">{r.resourceType}</Badge></td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{r.quantity || 0}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{r.startDate} → {r.endDate}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{r.notes || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDeleteResource(r.resourceId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

    </div>
  );
};
const getRsvpTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (status === 'Confirmed') return 'success';
  if (status === 'Pending') return 'warning';
  if (status === 'Declined') return 'danger';
  return 'neutral';
};

const GuestManagementView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guests, setGuests] = useState<any[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestForm, setGuestForm] = useState({
    eventId: '', guestName: '', email: '', phone: '', dietaryRestrictions: '', specialRequirements: '', rsvpStatus: 'Pending'
  });

  const fetchGuests = useCallback(async () => {
    setGuestsLoading(true);
    try {
      const res = await fetch('/api/banquet-events/guests', {
        headers: banquetHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setGuests(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load guests:', e);
    } finally {
      setGuestsLoading(false);
    }
  }, []);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/guests', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(guestForm)
      });
      if (response.ok) {
        addNotification('Guest added successfully', 'success');
        setShowGuestForm(false);
        setGuestForm({ eventId: '', guestName: '', email: '', phone: '', dietaryRestrictions: '', specialRequirements: '', rsvpStatus: 'Pending' });
        fetchGuests();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add guest', 'warning');
    }
  };

  const handleRsvpChange = async (guestId: string, newRsvp: string) => {
    try {
      const res = await fetch(`/api/banquet-events/guests/${guestId}/rsvp`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ rsvpStatus: newRsvp })
      });
      if (res.ok) {
        addNotification(`RSVP updated to ${newRsvp}`, 'success');
        fetchGuests();
      }
    } catch (e) {
      addNotification('Failed to update RSVP', 'warning');
    }
  };

  const handleDeleteGuest = async (guestId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/guests/${guestId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Guest removed', 'success');
        fetchGuests();
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to remove guest', 'warning');
    }
  };

  const confirmedCount = guests.filter(g => g.rsvpStatus === 'Confirmed').length;
  const pendingCount = guests.filter(g => g.rsvpStatus === 'Pending').length;
  const declinedCount = guests.filter(g => g.rsvpStatus === 'Declined').length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Guest & Attendee Management</h3>
        <button onClick={() => setShowGuestForm(!showGuestForm)} className={button.primary}>
          <UserPlus size={14} />
          {showGuestForm ? 'Cancel' : 'Add Guest'}
        </button>
      </div>

      {showGuestForm && (
        <SectionCard title="New Guest" icon={UserPlus} tone="accent" pad="md">
          <form onSubmit={handleGuestSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select value={guestForm.eventId} onChange={(e) => setGuestForm({ ...guestForm, eventId: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (<option key={event.eventId} value={event.eventId}>{event.eventName}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Guest Name</label>
                <input type="text" value={guestForm.guestName} onChange={(e) => setGuestForm({ ...guestForm, guestName: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Email</label>
                <input type="email" value={guestForm.email} onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Phone</label>
                <input type="tel" value={guestForm.phone} onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">RSVP Status</label>
                <select value={guestForm.rsvpStatus} onChange={(e) => setGuestForm({ ...guestForm, rsvpStatus: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white">
                  <option value="Pending">Pending</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Declined">Declined</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Dietary Restrictions</label>
              <textarea value={guestForm.dietaryRestrictions} onChange={(e) => setGuestForm({ ...guestForm, dietaryRestrictions: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" rows={2} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Special Requirements</label>
              <textarea value={guestForm.specialRequirements} onChange={(e) => setGuestForm({ ...guestForm, specialRequirements: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" rows={2} />
            </div>
            <button type="submit" className={button.primary}>Add Guest</button>
          </form>
        </SectionCard>
      )}

      {/* Guest Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { name: 'Total Guests', count: guests.length, tone: 'neutral' as const },
          { name: 'Confirmed', count: confirmedCount, tone: 'success' as const },
          { name: 'Pending', count: pendingCount, tone: 'warning' as const },
          { name: 'Declined', count: declinedCount, tone: 'danger' as const }
        ].map((stat) => (
          <div key={stat.name} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{stat.count}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.name}</p>
          </div>
        ))}
      </div>

      {/* Guest List */}
      <SectionCard title="Guest List" icon={Users} tone="info" pad="none">
        <div className="p-4 space-y-3">
          {guestsLoading ? (
            <p className="text-xs text-slate-500 text-center py-4">Loading guests…</p>
          ) : guests.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No guests yet. Click "Add Guest" to add one.</p>
          ) : (
            guests.map((guest: any) => (
              <div key={guest.guestId} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{guest.guestName}</span>
                    <Badge tone="neutral">{guest.eventName}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {guest.rsvpStatus === 'Confirmed' || guest.rsvpStatus === 'Declined' ? (
                      <Badge tone={getRsvpTone(guest.rsvpStatus)} variant="solid">{guest.rsvpStatus}</Badge>
                    ) : (
                      <select value={guest.rsvpStatus} onChange={(e) => handleRsvpChange(guest.guestId, e.target.value)} className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] text-slate-900 dark:text-white">
                        <option value="Pending">Pending</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Declined">Declined</option>
                      </select>
                    )}
                    <button onClick={() => handleDeleteGuest(guest.guestId)} className="p-1 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
                  <span>{guest.email || 'No email'} · {guest.phone || 'No phone'}</span>
                  <span>{guest.dietaryRestrictions && guest.dietaryRestrictions !== 'None' ? `Dietary: ${guest.dietaryRestrictions}` : ''}</span>
                </div>
                {guest.specialRequirements && (
                  <p className="text-[10px] text-slate-400 mt-1">Special: {guest.specialRequirements}</p>
                )}
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
};

const getPaymentTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (status === 'Paid') return 'success';
  if (status === 'Unpaid') return 'warning';
  if (status === 'Refunded') return 'danger';
  return 'neutral';
};

const getRegTypeTone = (type: string): 'accent' | 'info' | 'success' | 'neutral' => {
  if (type === 'VIP') return 'accent';
  if (type === 'EarlyBird') return 'info';
  if (type === 'Student') return 'success';
  return 'neutral';
};

const RegistrationManagementView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [regLoading, setRegLoading] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [registrationForm, setRegistrationForm] = useState({
    eventId: '', attendeeName: '', email: '', phone: '', organization: '', registrationType: 'Standard', paymentStatus: 'Unpaid', isWalkIn: false
  });

  const fetchRegistrations = useCallback(async () => {
    setRegLoading(true);
    try {
      const res = await fetch('/api/banquet-events/registrations', {
        headers: banquetHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setRegistrations(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load registrations:', e);
    } finally {
      setRegLoading(false);
    }
  }, []);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/registrations', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(registrationForm)
      });
      if (response.ok) {
        addNotification('Registration added successfully', 'success');
        setShowRegistrationForm(false);
        setRegistrationForm({ eventId: '', attendeeName: '', email: '', phone: '', organization: '', registrationType: 'Standard', paymentStatus: 'Unpaid', isWalkIn: false });
        fetchRegistrations();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add registration', 'warning');
    }
  };

  const handlePaymentChange = async (regId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/banquet-events/registrations/${regId}/payment`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ paymentStatus: newStatus })
      });
      if (res.ok) {
        addNotification(`Payment status updated to ${newStatus}`, 'success');
        fetchRegistrations();
      }
    } catch (e) {
      addNotification('Failed to update payment status', 'warning');
    }
  };

  const handleDeleteRegistration = async (regId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/registrations/${regId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Registration removed', 'success');
        fetchRegistrations();
        onRefresh();
      }
    } catch (e) {
      addNotification('Failed to remove registration', 'warning');
    }
  };

  // Toggle a registration's check-in state (manual door control).
  const handleCheckIn = async (regId: string, checkedIn: boolean) => {
    try {
      const res = await fetch(`/api/banquet-events/registrations/${regId}/check-in`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ checkedIn })
      });
      if (res.ok) {
        addNotification(checkedIn ? 'Attendee checked in' : 'Check-in reverted', 'success');
        fetchRegistrations();
      }
    } catch (e) {
      addNotification('Failed to update check-in', 'warning');
    }
  };

  // Badge printing (spec §Registration — Badge Printing): opens a printable
  // badge card with the attendee's name, org, type and check-in code.
  const printBadge = (reg: any) => {
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    w.document.write(`<!DOCTYPE html><html><head><title>Badge — ${esc(reg.attendeeName)}</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; padding: 24px; }
        .badge { width: 340px; border: 2px solid #111; border-radius: 12px; padding: 28px 20px; text-align: center; }
        .event { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: #555; }
        .name { font-size: 26px; font-weight: 700; margin: 14px 0 4px; }
        .org { font-size: 14px; color: #444; }
        .type { display: inline-block; margin-top: 14px; padding: 3px 14px; border: 1px solid #111; border-radius: 999px; font-size: 11px; font-weight: 700; }
        .code { margin-top: 18px; font-family: monospace; font-size: 16px; letter-spacing: .2em; border-top: 1px dashed #999; padding-top: 12px; }
      </style></head><body>
      <div class="badge">
        <div class="event">${esc(reg.eventName || 'Event')}</div>
        <div class="name">${esc(reg.attendeeName)}</div>
        <div class="org">${esc(reg.organization || '')}</div>
        <div class="type">${esc(reg.registrationType || 'Attendee')}</div>
        <div class="code">${esc(reg.registrationCode || '')}</div>
      </div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  // QR/badge path: resolve a registration_code and check the attendee in.
  const handleCodeCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanCode.trim();
    if (!code) return;
    try {
      const res = await fetch('/api/banquet-events/registrations/check-in-by-code', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ code })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addNotification(
          data.alreadyCheckedIn
            ? `${data.registration?.attendee_name || 'Attendee'} was already checked in`
            : `${data.registration?.attendee_name || 'Attendee'} checked in`,
          'success'
        );
        setScanCode('');
        fetchRegistrations();
      } else {
        addNotification(data.error || 'Code not found', 'warning');
      }
    } catch (err) {
      addNotification('Failed to check in by code', 'warning');
    }
  };

  const paidCount = registrations.filter(r => r.paymentStatus === 'Paid').length;
  const unpaidCount = registrations.filter(r => r.paymentStatus === 'Unpaid').length;
  const vipCount = registrations.filter(r => r.registrationType === 'VIP').length;
  const checkedInCount = registrations.filter(r => r.checkedIn).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Registration Management</h3>
        <button onClick={() => setShowRegistrationForm(!showRegistrationForm)} className={button.primary}>
          <ClipboardList size={14} />
          {showRegistrationForm ? 'Cancel' : 'Add Registration'}
        </button>
      </div>

      {showRegistrationForm && (
        <SectionCard title="New Registration" icon={UserPlus} tone="accent" pad="md">
          <form onSubmit={handleRegistrationSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select value={registrationForm.eventId} onChange={(e) => setRegistrationForm({ ...registrationForm, eventId: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (<option key={event.eventId} value={event.eventId}>{event.eventName}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Attendee Name</label>
                <input type="text" value={registrationForm.attendeeName} onChange={(e) => setRegistrationForm({ ...registrationForm, attendeeName: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Email</label>
                <input type="email" value={registrationForm.email} onChange={(e) => setRegistrationForm({ ...registrationForm, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Phone</label>
                <input type="tel" value={registrationForm.phone} onChange={(e) => setRegistrationForm({ ...registrationForm, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Organization</label>
                <input type="text" value={registrationForm.organization} onChange={(e) => setRegistrationForm({ ...registrationForm, organization: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Registration Type</label>
                <select value={registrationForm.registrationType} onChange={(e) => setRegistrationForm({ ...registrationForm, registrationType: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white">
                  <option value="Standard">Standard</option>
                  <option value="VIP">VIP</option>
                  <option value="EarlyBird">Early Bird</option>
                  <option value="Student">Student</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="regWalkIn" checked={registrationForm.isWalkIn} onChange={(e) => setRegistrationForm({ ...registrationForm, isWalkIn: e.target.checked })} className="w-4 h-4 rounded border-slate-300" />
              <label htmlFor="regWalkIn" className="text-xs font-bold text-slate-700 dark:text-slate-300">Walk-in (registered at the door)</label>
            </div>
            <button type="submit" className={button.primary}>Add Registration</button>
          </form>
        </SectionCard>
      )}

      {/* Badge / QR code check-in — enter or scan the REG-XXXXXX code */}
      <SectionCard title="Check-in by Code" icon={UserPlus} tone="accent" pad="md">
        <form onSubmit={handleCodeCheckIn} className="flex items-center gap-3">
          <input
            type="text"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value.toUpperCase())}
            placeholder="Scan or type code, e.g. REG-AB12CD"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-white"
          />
          <button type="submit" className={button.primary} disabled={!scanCode.trim()}>
            Check In
          </button>
        </form>
      </SectionCard>

      {/* Registration Summary */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { name: 'Total Registrations', count: registrations.length, tone: 'neutral' as const },
          { name: 'Checked In', count: checkedInCount, tone: 'info' as const },
          { name: 'Paid', count: paidCount, tone: 'success' as const },
          { name: 'Unpaid', count: unpaidCount, tone: 'warning' as const },
          { name: 'VIP', count: vipCount, tone: 'accent' as const }
        ].map((stat) => (
          <div key={stat.name} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{stat.count}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.name}</p>
          </div>
        ))}
      </div>

      {/* Registrations List */}
      <SectionCard title="Registrations" icon={ClipboardList} tone="info" pad="none">
        <div className="p-4 space-y-3">
          {regLoading ? (
            <p className="text-xs text-slate-500 text-center py-4">Loading registrations…</p>
          ) : registrations.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No registrations yet. Click "Add Registration" to create one.</p>
          ) : (
            registrations.map((reg: any) => (
              <div key={reg.registrationId} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{reg.attendeeName}</span>
                    <Badge tone={getRegTypeTone(reg.registrationType)}>{reg.registrationType}</Badge>
                    {reg.isWalkIn && <Badge tone="warning">Walk-in</Badge>}
                    <Badge tone="neutral">{reg.eventName}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {reg.checkedIn ? (
                      <button onClick={() => handleCheckIn(reg.registrationId, false)} title="Undo check-in">
                        <Badge tone="success" variant="solid">Checked In</Badge>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCheckIn(reg.registrationId, true)}
                        className="px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                      >
                        Check In
                      </button>
                    )}
                    {reg.paymentStatus === 'Paid' ? (
                      <Badge tone={getPaymentTone(reg.paymentStatus)} variant="solid">{reg.paymentStatus}</Badge>
                    ) : (
                      <select value={reg.paymentStatus} onChange={(e) => handlePaymentChange(reg.registrationId, e.target.value)} className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] text-slate-900 dark:text-white">
                        <option value="Unpaid">Unpaid</option>
                        <option value="Paid">Paid</option>
                        <option value="Refunded">Refunded</option>
                      </select>
                    )}
                    <button onClick={() => printBadge(reg)} className="p-1 text-slate-400 hover:text-blue-500" title="Print badge">
                      <Printer size={14} />
                    </button>
                    <button onClick={() => handleDeleteRegistration(reg.registrationId)} className="p-1 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
                  <span>{reg.email || 'No email'} · {reg.organization || 'No org'}</span>
                  <span className="font-mono">{reg.registrationCode || ''}</span>
                </div>
                {reg.checkedInAt && (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
                    Checked in {new Date(reg.checkedInAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
};

const TABLE_TYPES = ['Round', 'Rectangular', 'U-Shape', 'Classroom', 'Theater', 'Cocktail'] as const;

const SeatingManagementView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showSeatingForm, setShowSeatingForm] = useState(false);
  const [tables, setTables] = useState<any[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [seatingForm, setSeatingForm] = useState({
    eventId: '', tableName: '', tableType: 'Round', capacity: '', location: '', specialRequests: '', assignedTo: '', isVip: false
  });
  const [floorPlanEventId, setFloorPlanEventId] = useState('');

  const fetchTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const res = await fetch('/api/banquet-events/seating', {
        headers: banquetHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setTables(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load seating:', e);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => { fetchTables(); }, [fetchTables]);

  const handleSeatingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/seating', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...seatingForm, capacity: parseInt(seatingForm.capacity) || 8, isReserved: true })
      });
      if (response.ok) {
        addNotification('Seating arrangement added successfully', 'success');
        setShowSeatingForm(false);
        setSeatingForm({ eventId: '', tableName: '', tableType: 'Round', capacity: '', location: '', specialRequests: '', assignedTo: '', isVip: false });
        fetchTables();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to add seating arrangement', 'warning');
    }
  };

  const handleDeleteTable = async (seatingId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/seating/${seatingId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Table removed', 'success');
        fetchTables();
      }
    } catch (e) {
      addNotification('Failed to remove table', 'warning');
    }
  };

  const totalSeats = tables.reduce((sum, t) => sum + (t.capacity || 0), 0);
  const vipTables = tables.filter(t => t.isVip).length;
  const reservedTables = tables.filter(t => t.isReserved).length;

  // Per-type counts
  const typeCounts = TABLE_TYPES.map(type => ({
    type,
    count: tables.filter(t => t.tableType === type).length
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Seating Management</h3>
        <button onClick={() => setShowSeatingForm(!showSeatingForm)} className={button.primary}>
          <Armchair size={14} />
          {showSeatingForm ? 'Cancel' : 'Add Table'}
        </button>
      </div>

      {showSeatingForm && (
        <SectionCard title="New Table" icon={Plus} tone="accent" pad="md">
          <form onSubmit={handleSeatingSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select value={seatingForm.eventId} onChange={(e) => setSeatingForm({ ...seatingForm, eventId: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (<option key={event.eventId} value={event.eventId}>{event.eventName}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Table Name</label>
                <input type="text" value={seatingForm.tableName} onChange={(e) => setSeatingForm({ ...seatingForm, tableName: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Table Type</label>
                <select value={seatingForm.tableType} onChange={(e) => setSeatingForm({ ...seatingForm, tableType: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required>
                  {TABLE_TYPES.map((type) => (<option key={type} value={type}>{type}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Capacity</label>
                <input type="number" value={seatingForm.capacity} onChange={(e) => setSeatingForm({ ...seatingForm, capacity: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Location</label>
                <input type="text" value={seatingForm.location} onChange={(e) => setSeatingForm({ ...seatingForm, location: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Assigned To</label>
                <input type="text" value={seatingForm.assignedTo} onChange={(e) => setSeatingForm({ ...seatingForm, assignedTo: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isVip" checked={seatingForm.isVip} onChange={(e) => setSeatingForm({ ...seatingForm, isVip: e.target.checked })} className="w-4 h-4 rounded border-slate-300" />
              <label htmlFor="isVip" className="text-xs font-bold text-slate-700 dark:text-slate-300">VIP Table</label>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Special Requests</label>
              <textarea value={seatingForm.specialRequests} onChange={(e) => setSeatingForm({ ...seatingForm, specialRequests: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white" rows={2} />
            </div>
            <button type="submit" className={button.primary}>Add Table</button>
          </form>
        </SectionCard>
      )}

      {/* Seating Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { name: 'Total Tables', count: tables.length, tone: 'neutral' as const },
          { name: 'Total Seats', count: totalSeats, tone: 'info' as const },
          { name: 'VIP Tables', count: vipTables, tone: 'accent' as const },
          { name: 'Reserved', count: reservedTables, tone: 'success' as const }
        ].map((stat) => (
          <div key={stat.name} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{stat.count}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.name}</p>
          </div>
        ))}
      </div>

      {/* Table Type Distribution */}
      <SectionCard title="Table Types" icon={Armchair} tone="accent" pad="md">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {typeCounts.map((tc) => (
            <div key={tc.type} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-center">
              <p className="text-lg font-bold text-slate-900 dark:text-white">{tc.count}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">{tc.type}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Floor plan — visual layout of the selected event's tables */}
      {(() => {
        const eventIds = [...new Set(tables.map((t: any) => t.eventId))];
        const planEventId = floorPlanEventId || eventIds[0] || '';
        const planTables = tables.filter((t: any) => t.eventId === planEventId);
        if (eventIds.length === 0) return null;
        return (
          <SectionCard title="Floor Plan" icon={Armchair} tone="neutral" pad="md"
            actions={
              <select
                value={planEventId}
                onChange={(e) => setFloorPlanEventId(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                {eventIds.map((id: any) => (
                  <option key={id} value={id}>{tables.find((t: any) => t.eventId === id)?.eventName || id}</option>
                ))}
              </select>
            }>
            <div className="flex flex-wrap gap-4 justify-center py-4">
              {planTables.map((t: any) => {
                const seats = Math.min(Number(t.capacity) || 0, 20);
                const round = ['Round', 'Cocktail'].includes(t.tableType);
                return (
                  <div key={t.seatingId} className="flex flex-col items-center gap-1">
                    <div
                      className={`relative flex items-center justify-center border-2 transition ${
                        t.isVip
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                          : t.isReserved
                            ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                            : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800'
                      } ${round ? 'rounded-full w-24 h-24' : 'rounded-xl w-28 h-16'}`}
                      title={`${t.tableName} · ${t.capacity} seats${t.assignedTo ? ` · ${t.assignedTo}` : ''}`}
                    >
                      <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 text-center px-1 leading-tight">{t.tableName}</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-0.5 max-w-28">
                      {Array.from({ length: seats }).map((_, i) => (
                        <span key={i} className={`w-1.5 h-1.5 rounded-full ${t.assignedTo ? 'bg-slate-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      ))}
                    </div>
                    <span className="text-[9px] text-slate-400">{t.capacity} seats{t.assignedTo ? ` · ${t.assignedTo}` : ''}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        );
      })()}

      {/* Tables List */}
      <SectionCard title="Seating Arrangements" icon={Armchair} tone="info" pad="none">
        <div className="p-4 space-y-3">
          {tablesLoading ? (
            <p className="text-xs text-slate-500 text-center py-4">Loading tables…</p>
          ) : tables.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No tables yet. Click "Add Table" to create one.</p>
          ) : (
            tables.map((table: any) => (
              <div key={table.seatingId} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{table.tableName}</span>
                    <Badge tone="neutral">{table.tableType}</Badge>
                    {table.isVip && <Badge tone="accent" variant="solid">VIP</Badge>}
                    <Badge tone="neutral">{table.eventName}</Badge>
                  </div>
                  <button onClick={() => handleDeleteTable(table.seatingId)} className="text-slate-400 hover:text-rose-500 transition">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
                  <span>{table.location || 'No location'} · {table.capacity} seats</span>
                  <span>{table.assignedTo || 'Unassigned'}</span>
                </div>
                {table.specialRequests && (
                  <p className="text-[10px] text-slate-400 mt-1">Special: {table.specialRequests}</p>
                )}
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
};

const EquipmentManagementView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showEquipmentForm, setShowEquipmentForm] = useState(false);
  const [equipmentForm, setEquipmentForm] = useState({
    eventId: '',
    equipmentName: '',
    equipmentType: '',
    quantity: '',
    specifications: '',
    assignedTo: '',
    status: 'Available',
    catalogItemId: ''
  });
  const [equipment, setEquipment] = useState<any[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [showCatalogForm, setShowCatalogForm] = useState(false);
  const [catalogForm, setCatalogForm] = useState({ itemName: '', category: 'Audio Visual', totalQuantity: '', notes: '' });

  const fetchEquipment = useCallback(async () => {
    setEquipmentLoading(true);
    try {
      const res = await fetch('/api/banquet-events/equipment', { headers: banquetHeaders() });
      if (res.ok) setEquipment(await res.json());
    } catch (e) {
      console.error('Failed to load equipment:', e);
    } finally {
      setEquipmentLoading(false);
    }
  }, []);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch('/api/banquet-events/equipment-catalog', { headers: banquetHeaders() });
      if (res.ok) setCatalog(await res.json());
    } catch (e) {
      console.error('Failed to load equipment catalog:', e);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => { fetchEquipment(); fetchCatalog(); }, [fetchEquipment, fetchCatalog]);

  const handleEquipmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/equipment', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...equipmentForm, quantity: parseInt(equipmentForm.quantity) })
      });
      if (response.ok) {
        addNotification('Equipment added successfully', 'success');
        setShowEquipmentForm(false);
        setEquipmentForm({ eventId: '', equipmentName: '', equipmentType: '', quantity: '', specifications: '', assignedTo: '', status: 'Available', catalogItemId: '' });
        fetchEquipment();
        fetchCatalog();
      }
    } catch (error) {
      addNotification('Failed to add equipment', 'warning');
    }
  };

  const handleCatalogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/equipment-catalog', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...catalogForm, totalQuantity: parseInt(catalogForm.totalQuantity) || 0 })
      });
      if (response.ok) {
        addNotification('Catalog item added', 'success');
        setShowCatalogForm(false);
        setCatalogForm({ itemName: '', category: 'Audio Visual', totalQuantity: '', notes: '' });
        fetchCatalog();
      }
    } catch (error) {
      addNotification('Failed to add catalog item', 'warning');
    }
  };

  const handleDeleteCatalogItem = async (catalogItemId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/equipment-catalog/${catalogItemId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Catalog item removed', 'success');
        fetchCatalog();
      }
    } catch (e) {
      addNotification('Failed to remove catalog item', 'warning');
    }
  };

  const handleDeleteEquipment = async (equipmentId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/equipment/${equipmentId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Equipment removed', 'success');
        fetchEquipment();
      }
    } catch (e) {
      addNotification('Failed to remove equipment', 'warning');
    }
  };

  const equipmentTypes = [
    { name: 'Audio Visual', icon: '🎤', color: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20' },
    { name: 'Lighting', icon: '💡', color: 'from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20' },
    { name: 'Staging', icon: '🎭', color: 'from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20' },
    { name: 'Furniture', icon: '🪑', color: 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20' },
    { name: 'Kitchen', icon: '👨‍🍳', color: 'from-rose-50 to-red-50 dark:from-rose-900/20 dark:to-red-900/20' },
    { name: 'Decor', icon: '🎨', color: 'from-pink-50 to-fuchsia-50 dark:from-pink-900/20 dark:to-fuchsia-900/20' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Equipment Management</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCatalogForm(!showCatalogForm)}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition"
          >
            <Settings size={14} />
            {showCatalogForm ? 'Cancel' : 'Catalog Item'}
          </button>
          <button
            onClick={() => setShowEquipmentForm(!showEquipmentForm)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition"
          >
            <Settings size={14} />
            {showEquipmentForm ? 'Cancel' : 'Add Equipment'}
          </button>
        </div>
      </div>

      {showCatalogForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleCatalogSubmit} className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Item Name</label>
              <input
                type="text"
                value={catalogForm.itemName}
                onChange={(e) => setCatalogForm({ ...catalogForm, itemName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Category</label>
              <select
                value={catalogForm.category}
                onChange={(e) => setCatalogForm({ ...catalogForm, category: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                {equipmentTypes.map((type) => (
                  <option key={type.name} value={type.name}>{type.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Total Stock</label>
              <input
                type="number" min="0"
                value={catalogForm.totalQuantity}
                onChange={(e) => setCatalogForm({ ...catalogForm, totalQuantity: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Notes</label>
              <input
                type="text"
                value={catalogForm.notes}
                onChange={(e) => setCatalogForm({ ...catalogForm, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition">
              Add to Catalog
            </button>
          </form>
        </div>
      )}

      {/* Central stock — committed/available across live events */}
      <SectionCard title={`Stock Catalog (${catalog.length})`} loading={catalogLoading}>
        {catalog.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No catalog items. Add stock (projectors, staging, …) to enable availability checks and shortage alerts.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Item</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Category</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Stock</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Committed</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Available</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Status</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {catalog.map((c: any) => (
                <tr key={c.catalogItemId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 text-slate-900 dark:text-white font-medium">{c.itemName}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.category || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400 tabular-nums">{c.totalQuantity}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400 tabular-nums">{c.committed}</td>
                  <td className={`px-4 py-2 text-right font-bold tabular-nums ${c.available < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{c.available}</td>
                  <td className="px-4 py-2">
                    {c.available < 0
                      ? <Badge tone="danger" variant="solid">Shortage</Badge>
                      : c.available === 0
                        ? <Badge tone="warning">Fully Booked</Badge>
                        : <Badge tone="success">In Stock</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDeleteCatalogItem(c.catalogItemId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {showEquipmentForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleEquipmentSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select
                  value={equipmentForm.eventId}
                  onChange={(e) => setEquipmentForm({ ...equipmentForm, eventId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (
                    <option key={event.eventId} value={event.eventId}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Catalog Item</label>
                <select
                  value={equipmentForm.catalogItemId}
                  onChange={(e) => {
                    const cat = catalog.find((c: any) => c.catalogItemId === e.target.value);
                    setEquipmentForm({
                      ...equipmentForm,
                      catalogItemId: e.target.value,
                      equipmentName: cat ? cat.itemName : equipmentForm.equipmentName,
                      equipmentType: cat ? cat.category : equipmentForm.equipmentType
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">— Custom (not from stock) —</option>
                  {catalog.map((c: any) => (
                    <option key={c.catalogItemId} value={c.catalogItemId}>
                      {c.itemName} ({c.available} avail)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Equipment Name</label>
                <input
                  type="text"
                  value={equipmentForm.equipmentName}
                  onChange={(e) => setEquipmentForm({ ...equipmentForm, equipmentName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Equipment Type</label>
                <select
                  value={equipmentForm.equipmentType}
                  onChange={(e) => setEquipmentForm({ ...equipmentForm, equipmentType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Type</option>
                  {equipmentTypes.map((type) => (
                    <option key={type.name} value={type.name}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Quantity</label>
                <input
                  type="number"
                  value={equipmentForm.quantity}
                  onChange={(e) => setEquipmentForm({ ...equipmentForm, quantity: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Assigned To</label>
                <input
                  type="text"
                  value={equipmentForm.assignedTo}
                  onChange={(e) => setEquipmentForm({ ...equipmentForm, assignedTo: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Status</label>
                <select
                  value={equipmentForm.status}
                  onChange={(e) => setEquipmentForm({ ...equipmentForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="Available">Available</option>
                  <option value="InUse">In Use</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Reserved">Reserved</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Specifications</label>
              <textarea
                value={equipmentForm.specifications}
                onChange={(e) => setEquipmentForm({ ...equipmentForm, specifications: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                rows={2}
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition"
            >
              Add Equipment
            </button>
          </form>
        </div>
      )}

      <SectionCard title={`Equipment Items (${equipment.length})`} loading={equipmentLoading}>
        {equipment.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No equipment added yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Event</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Equipment</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Type</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Qty</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Assigned</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Status</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Specs</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {equipment.map((eq: any) => (
                <tr key={eq.equipmentId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{eq.eventName || eq.eventId}</td>
                  <td className="px-4 py-2 text-slate-900 dark:text-white font-medium">
                    {eq.equipmentName}
                    {eq.catalogItemId && <Badge tone="info" > Stock</Badge>}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{eq.equipmentType}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{eq.quantity || 0}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{eq.assignedTo || '—'}</td>
                  <td className="px-4 py-2"><Badge tone={eq.status === 'Available' ? 'success' : eq.status === 'In Use' ? 'info' : 'warning'}>{eq.status}</Badge></td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{eq.specifications || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDeleteEquipment(eq.equipmentId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
};

const VendorCoordinationView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [vendorForm, setVendorForm] = useState({
    eventId: '',
    vendorName: '',
    vendorType: '',
    contactPerson: '',
    phone: '',
    email: '',
    services: '',
    contractValue: '',
    status: 'Pending',
    registryId: ''
  });
  const [vendors, setVendors] = useState<any[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  // Reusable vendor master (470) — pick from the registry to prefill the form.
  const [vendorRegistry, setVendorRegistry] = useState<any[]>([]);
  const [showRegistryForm, setShowRegistryForm] = useState(false);
  const [registryForm, setRegistryForm] = useState({ vendorName: '', vendorType: '', contactPerson: '', phone: '', email: '', services: '' });

  const fetchVendors = useCallback(async () => {
    setVendorsLoading(true);
    try {
      const res = await fetch('/api/banquet-events/vendors', { headers: banquetHeaders() });
      if (res.ok) setVendors(await res.json());
    } catch (e) {
      console.error('Failed to load vendors:', e);
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await fetch('/api/banquet-events/vendor-registry', { headers: banquetHeaders() });
      if (res.ok) setVendorRegistry(await res.json());
    } catch (e) {
      console.error('Failed to load vendor registry:', e);
    }
  }, []);

  useEffect(() => { fetchVendors(); fetchRegistry(); }, [fetchVendors, fetchRegistry]);

  const handleRegistrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/banquet-events/vendor-registry', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify(registryForm)
      });
      if (res.ok) {
        addNotification('Vendor added to registry', 'success');
        setShowRegistryForm(false);
        setRegistryForm({ vendorName: '', vendorType: '', contactPerson: '', phone: '', email: '', services: '' });
        fetchRegistry();
      }
    } catch (e) {
      addNotification('Failed to add vendor to registry', 'warning');
    }
  };

  const handleDeactivateRegistry = async (registryId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/vendor-registry/${registryId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Vendor deactivated', 'success');
        fetchRegistry();
      }
    } catch (e) {
      addNotification('Failed to deactivate vendor', 'warning');
    }
  };

  const handleVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/vendors', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...vendorForm, contractValue: parseFloat(vendorForm.contractValue) })
      });
      if (response.ok) {
        addNotification('Vendor added successfully', 'success');
        setShowVendorForm(false);
        setVendorForm({ eventId: '', vendorName: '', vendorType: '', contactPerson: '', phone: '', email: '', services: '', contractValue: '', status: 'Pending', registryId: '' });
        fetchVendors();
      }
    } catch (error) {
      addNotification('Failed to add vendor', 'warning');
    }
  };

  const handleVendorStatus = async (vendorId: string, status: string) => {
    try {
      const res = await fetch(`/api/banquet-events/vendors/${vendorId}`, {
        method: 'PUT',
        headers: banquetHeaders(true),
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        addNotification(`Vendor marked ${status}`, 'success');
        fetchVendors();
      }
    } catch (e) {
      addNotification('Failed to update vendor', 'warning');
    }
  };

  const handleDeleteVendor = async (vendorId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/vendors/${vendorId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Vendor removed', 'success');
        fetchVendors();
      }
    } catch (e) {
      addNotification('Failed to remove vendor', 'warning');
    }
  };

  const vendorTypes = [
    { name: 'Catering', icon: '🍽️', color: 'from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20' },
    { name: 'Florist', icon: '💐', color: 'from-pink-50 to-rose-50 dark:from-pink-900/20 dark:to-rose-900/20' },
    { name: 'Photography', icon: '📸', color: 'from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20' },
    { name: 'Entertainment', icon: '🎵', color: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20' },
    { name: 'Decor', icon: '🎨', color: 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20' },
    { name: 'Transportation', icon: '🚗', color: 'from-slate-50 to-gray-50 dark:from-slate-900/20 dark:to-gray-900/20' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Vendor Coordination</h3>
        <button
          onClick={() => setShowVendorForm(!showVendorForm)}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition"
        >
          <Building2 size={14} />
          {showVendorForm ? 'Cancel' : 'Add Vendor'}
        </button>
      </div>

      {showVendorForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleVendorSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select
                  value={vendorForm.eventId}
                  onChange={(e) => setVendorForm({ ...vendorForm, eventId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (
                    <option key={event.eventId} value={event.eventId}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">From Registry</label>
                <select
                  value={vendorForm.registryId}
                  onChange={(e) => {
                    const reg = vendorRegistry.find((r: any) => r.id === e.target.value);
                    setVendorForm({
                      ...vendorForm,
                      registryId: e.target.value,
                      ...(reg ? {
                        vendorName: reg.vendorName || vendorForm.vendorName,
                        vendorType: reg.vendorType || vendorForm.vendorType,
                        contactPerson: reg.contactPerson || vendorForm.contactPerson,
                        phone: reg.phone || vendorForm.phone,
                        email: reg.email || vendorForm.email,
                        services: reg.services || vendorForm.services
                      } : {})
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">New / one-off vendor</option>
                  {vendorRegistry.map((r: any) => (
                    <option key={r.id} value={r.id}>{r.vendorName}{r.vendorType ? ` (${r.vendorType})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Vendor Name</label>
                <input
                  type="text"
                  value={vendorForm.vendorName}
                  onChange={(e) => setVendorForm({ ...vendorForm, vendorName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Vendor Type</label>
                <select
                  value={vendorForm.vendorType}
                  onChange={(e) => setVendorForm({ ...vendorForm, vendorType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Type</option>
                  {vendorTypes.map((type) => (
                    <option key={type.name} value={type.name}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Contact Person</label>
                <input
                  type="text"
                  value={vendorForm.contactPerson}
                  onChange={(e) => setVendorForm({ ...vendorForm, contactPerson: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Phone</label>
                <input
                  type="tel"
                  value={vendorForm.phone}
                  onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Email</label>
                <input
                  type="email"
                  value={vendorForm.email}
                  onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Contract Value</label>
                <input
                  type="number"
                  value={vendorForm.contractValue}
                  onChange={(e) => setVendorForm({ ...vendorForm, contractValue: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Status</label>
                <select
                  value={vendorForm.status}
                  onChange={(e) => setVendorForm({ ...vendorForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="Pending">Pending</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Services</label>
              <textarea
                value={vendorForm.services}
                onChange={(e) => setVendorForm({ ...vendorForm, services: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                rows={2}
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition"
            >
              Add Vendor
            </button>
          </form>
        </div>
      )}

      <SectionCard title={`Vendors (${vendors.length})`} loading={vendorsLoading}>
        {vendors.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No vendors added yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Event</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Vendor</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Type</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Contact</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Services</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Value</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Status</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {vendors.map((v: any) => (
                <tr key={v.vendorId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{v.eventName || v.eventId}</td>
                  <td className="px-4 py-2 text-slate-900 dark:text-white font-medium">{v.vendorName}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{v.vendorType}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{v.contactPerson}<br/><span className="text-slate-400">{v.phone}</span></td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{v.services || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">${(v.contractValue || 0).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge tone={v.status === 'Confirmed' ? 'success' : v.status === 'Pending' ? 'warning' : 'neutral'}>{v.status}</Badge></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {v.status === 'Pending' && (
                      <button onClick={() => handleVendorStatus(v.vendorId, 'Confirmed')} className="p-1.5 text-slate-400 hover:text-emerald-500" title="Confirm vendor">
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                    <button onClick={() => handleDeleteVendor(v.vendorId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Vendor registry (470) — reusable vendor master; picking one in the form above prefills details */}
      <SectionCard title="Vendor Registry" icon={Building2} tone="neutral" pad="none"
        actions={
          <button onClick={() => setShowRegistryForm(!showRegistryForm)} className={`${button.primary} !text-xs`}>
            <Plus size={14} /> {showRegistryForm ? 'Cancel' : 'Register Vendor'}
          </button>
        }>
        <div className="p-4 space-y-3">
          {showRegistryForm && (
            <form onSubmit={handleRegistrySubmit} className="grid grid-cols-1 md:grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
              <input
                type="text" placeholder="Vendor name" value={registryForm.vendorName}
                onChange={(e) => setRegistryForm({ ...registryForm, vendorName: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
              <select
                value={registryForm.vendorType}
                onChange={(e) => setRegistryForm({ ...registryForm, vendorType: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                <option value="">Type…</option>
                {vendorTypes.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <input
                type="text" placeholder="Contact person" value={registryForm.contactPerson}
                onChange={(e) => setRegistryForm({ ...registryForm, contactPerson: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <input
                type="tel" placeholder="Phone" value={registryForm.phone}
                onChange={(e) => setRegistryForm({ ...registryForm, phone: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <input
                type="email" placeholder="Email" value={registryForm.email}
                onChange={(e) => setRegistryForm({ ...registryForm, email: e.target.value })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
              <button type="submit" className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold transition">Register</button>
            </form>
          )}
          {vendorRegistry.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No registered vendors — register frequently-used vendors once and reuse them across events.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {vendorRegistry.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{r.vendorName}</span>
                    {r.vendorType && <Badge tone="neutral">{r.vendorType}</Badge>}
                    {r.contactPerson && <span className="text-xs text-slate-500">{r.contactPerson}{r.phone ? ` · ${r.phone}` : ''}</span>}
                  </div>
                  <button onClick={() => handleDeactivateRegistry(r.id)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Deactivate"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

const TransportationCoordinationView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showTransportForm, setShowTransportForm] = useState(false);
  const [transportForm, setTransportForm] = useState({
    eventId: '',
    guestName: '',
    pickupLocation: '',
    dropoffLocation: '',
    pickupTime: '',
    vehicleType: 'Sedan',
    passengerCount: '',
    specialRequests: '',
    driverName: '',
    contactNumber: ''
  });
  const [transportation, setTransportation] = useState<any[]>([]);
  const [transportationLoading, setTransportationLoading] = useState(false);

  const fetchTransportation = useCallback(async () => {
    setTransportationLoading(true);
    try {
      const res = await fetch('/api/banquet-events/transportation', { headers: banquetHeaders() });
      if (res.ok) setTransportation(await res.json());
    } catch (e) {
      console.error('Failed to load transportation:', e);
    } finally {
      setTransportationLoading(false);
    }
  }, []);

  useEffect(() => { fetchTransportation(); }, [fetchTransportation]);

  const handleTransportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/transportation', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...transportForm, passengerCount: parseInt(transportForm.passengerCount) })
      });
      if (response.ok) {
        addNotification('Transportation added successfully', 'success');
        setShowTransportForm(false);
        setTransportForm({ eventId: '', guestName: '', pickupLocation: '', dropoffLocation: '', pickupTime: '', vehicleType: 'Sedan', passengerCount: '', specialRequests: '', driverName: '', contactNumber: '' });
        fetchTransportation();
      }
    } catch (error) {
      addNotification('Failed to add transportation', 'warning');
    }
  };

  const handleDeleteTransport = async (transportId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/transportation/${transportId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Transport removed', 'success');
        fetchTransportation();
      }
    } catch (e) {
      addNotification('Failed to remove transport', 'warning');
    }
  };

  const vehicleTypes = [
    { name: 'Sedan', icon: '🚗', capacity: 4, color: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20' },
    { name: 'SUV', icon: '🚙', capacity: 6, color: 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20' },
    { name: 'Van', icon: '🚐', capacity: 12, color: 'from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20' },
    { name: 'Bus', icon: '🚌', capacity: 30, color: 'from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20' },
    { name: 'Luxury', icon: '🏎️', capacity: 3, color: 'from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20' },
    { name: 'Shuttle', icon: '🚕', capacity: 8, color: 'from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Transportation Coordination</h3>
        <button
          onClick={() => setShowTransportForm(!showTransportForm)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition"
        >
          <Car size={14} />
          {showTransportForm ? 'Cancel' : 'Add Transport'}
        </button>
      </div>

      {showTransportForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <form onSubmit={handleTransportSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select
                  value={transportForm.eventId}
                  onChange={(e) => setTransportForm({ ...transportForm, eventId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (
                    <option key={event.eventId} value={event.eventId}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Guest Name</label>
                <input
                  type="text"
                  value={transportForm.guestName}
                  onChange={(e) => setTransportForm({ ...transportForm, guestName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Pickup Location</label>
                <input
                  type="text"
                  value={transportForm.pickupLocation}
                  onChange={(e) => setTransportForm({ ...transportForm, pickupLocation: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Dropoff Location</label>
                <input
                  type="text"
                  value={transportForm.dropoffLocation}
                  onChange={(e) => setTransportForm({ ...transportForm, dropoffLocation: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Pickup Time</label>
                <input
                  type="datetime-local"
                  value={transportForm.pickupTime}
                  onChange={(e) => setTransportForm({ ...transportForm, pickupTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Vehicle Type</label>
                <select
                  value={transportForm.vehicleType}
                  onChange={(e) => setTransportForm({ ...transportForm, vehicleType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  {vehicleTypes.map((type) => (
                    <option key={type.name} value={type.name}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Passenger Count</label>
                <input
                  type="number"
                  value={transportForm.passengerCount}
                  onChange={(e) => setTransportForm({ ...transportForm, passengerCount: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Driver Name</label>
                <input
                  type="text"
                  value={transportForm.driverName}
                  onChange={(e) => setTransportForm({ ...transportForm, driverName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Contact Number</label>
                <input
                  type="tel"
                  value={transportForm.contactNumber}
                  onChange={(e) => setTransportForm({ ...transportForm, contactNumber: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Special Requests</label>
              <textarea
                value={transportForm.specialRequests}
                onChange={(e) => setTransportForm({ ...transportForm, specialRequests: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                rows={2}
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition"
            >
              Add Transport
            </button>
          </form>
        </div>
      )}

      <SectionCard title={`Transportation Trips (${transportation.length})`} loading={transportationLoading}>
        {transportation.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No transportation trips added yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Event</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Guest</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Vehicle</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Passengers</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Route</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Pickup</th>
                <th className="text-left px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Driver</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600 dark:text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {transportation.map((t: any) => (
                <tr key={t.transportId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{t.eventName || t.eventId}</td>
                  <td className="px-4 py-2 text-slate-900 dark:text-white font-medium">{t.guestName}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{t.vehicleType}</td>
                  <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{t.passengerCount}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{t.pickupLocation} → {t.dropoffLocation}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{t.pickupTime ? new Date(t.pickupTime).toLocaleString() : '—'}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{t.driverName || '—'}<br/><span className="text-slate-400">{t.contactNumber}</span></td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDeleteTransport(t.transportId)} className="p-1.5 text-slate-400 hover:text-rose-500" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
};

const getCommStatusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (status === 'Sent') return 'success';
  if (status === 'Pending') return 'warning';
  if (status === 'Failed') return 'danger';
  return 'neutral';
};

const getPriorityTone = (priority: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (priority === 'Urgent') return 'danger';
  if (priority === 'High') return 'warning';
  if (priority === 'Normal') return 'neutral';
  return 'success';
};

const getCommTypeIcon = (type: string) => {
  switch (type) {
    case 'SMS': return MessageSquare;
    case 'WhatsApp': return MessageSquare;
    case 'In-App': return Bell;
    default: return MessageSquare;
  }
};

const CommunicationCenterView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageForm, setMessageForm] = useState({
    eventId: '',
    recipient: '',
    recipientType: 'Guest',
    subject: '',
    message: '',
    communicationType: 'Email',
    priority: 'Normal',
    parentId: ''
  });

  const fetchMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const res = await fetch('/api/banquet-events/communications', {
        headers: banquetHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const handleMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/communications', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ ...messageForm, parentId: messageForm.parentId || undefined })
      });
      if (response.ok) {
        addNotification('Message sent successfully', 'success');
        setShowMessageForm(false);
        setMessageForm({ eventId: '', recipient: '', recipientType: 'Guest', subject: '', message: '', communicationType: 'Email', priority: 'Normal', parentId: '' });
        fetchMessages();
        onRefresh();
      }
    } catch (error) {
      addNotification('Failed to send message', 'warning');
    }
  };

  const handleDeleteMessage = async (commId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/communications/${commId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Message removed', 'success');
        fetchMessages();
      }
    } catch (e) {
      addNotification('Failed to remove message', 'warning');
    }
  };

  const sentCount = messages.filter(m => m.status === 'Sent').length;
  const pendingCount = messages.filter(m => m.status === 'Pending').length;
  const failedCount = messages.filter(m => m.status === 'Failed').length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Communication Center</h3>
        <button
          onClick={() => setShowMessageForm(!showMessageForm)}
          className={button.primary}
        >
          <MessageSquare size={14} />
          {showMessageForm ? 'Cancel' : 'Send Message'}
        </button>
      </div>

      {showMessageForm && (
        <SectionCard title="New Message" icon={Plus} tone="accent" pad="md">
          <form onSubmit={handleMessageSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
                <select
                  value={messageForm.eventId}
                  onChange={(e) => setMessageForm({ ...messageForm, eventId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="">Select Event</option>
                  {events.map((event: Event) => (
                    <option key={event.eventId} value={event.eventId}>{event.eventName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Recipient Type</label>
                <select
                  value={messageForm.recipientType}
                  onChange={(e) => setMessageForm({ ...messageForm, recipientType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="Guest">Guest</option>
                  <option value="Vendor">Vendor</option>
                  <option value="Staff">Staff</option>
                  <option value="All">All Attendees</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Recipient</label>
                <input
                  type="text"
                  value={messageForm.recipient}
                  onChange={(e) => setMessageForm({ ...messageForm, recipient: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Communication Type</label>
                <select
                  value={messageForm.communicationType}
                  onChange={(e) => setMessageForm({ ...messageForm, communicationType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="Email">Email</option>
                  <option value="SMS">SMS</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="In-App">In-App</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Priority</label>
                <select
                  value={messageForm.priority}
                  onChange={(e) => setMessageForm({ ...messageForm, priority: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="Low">Low</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Subject</label>
              <input
                type="text"
                value={messageForm.subject}
                onChange={(e) => setMessageForm({ ...messageForm, subject: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Message</label>
              <textarea
                value={messageForm.message}
                onChange={(e) => setMessageForm({ ...messageForm, message: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                rows={4}
                required
              />
            </div>
            <button type="submit" className={button.primary}>Send Message</button>
          </form>
        </SectionCard>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { name: 'Total Messages', count: messages.length, tone: 'neutral' as const },
          { name: 'Sent', count: sentCount, tone: 'success' as const },
          { name: 'Pending', count: pendingCount, tone: 'warning' as const },
          { name: 'Failed', count: failedCount, tone: 'danger' as const }
        ].map((stat) => (
          <div key={stat.name} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{stat.count}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.name}</p>
          </div>
        ))}
      </div>

      {/* Messages List */}
      <SectionCard title="Message Log" icon={MessageSquare} tone="info" pad="none">
        <div className="p-4 space-y-3">
          {messagesLoading ? (
            <p className="text-xs text-slate-500 text-center py-4">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No messages yet. Click "Send Message" to compose one.</p>
          ) : (
            messages.map((msg: any) => {
              const CommIcon = getCommTypeIcon(msg.communicationType);
              return (
                <div key={msg.commId} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <CommIcon className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{msg.recipient}</span>
                      <Badge tone="neutral">{msg.recipientType}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={getPriorityTone(msg.priority)}>{msg.priority}</Badge>
                      <Badge tone={getCommStatusTone(msg.status)} variant="solid">{msg.status}</Badge>
                      <button
                        onClick={() => {
                          setMessageForm({
                            eventId: msg.eventId || '',
                            recipient: msg.recipient || '',
                            recipientType: msg.recipientType || 'Guest',
                            subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || 'message'}`,
                            message: '',
                            communicationType: 'In-App',
                            priority: 'Normal',
                            parentId: msg.commId
                          });
                          setShowMessageForm(true);
                        }}
                        className="p-1 text-slate-400 hover:text-blue-500"
                        title="Reply in thread"
                      >
                        <MessageSquare size={14} />
                      </button>
                      {msg.status !== 'Sent' && (
                        <button onClick={() => handleDeleteMessage(msg.commId)} className="p-1 text-slate-400 hover:text-rose-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {msg.parentId && (
                    <p className="text-[10px] text-slate-400 mb-1">
                      ↳ in reply to "{messages.find((p: any) => p.commId === msg.parentId)?.subject || 'earlier message'}"
                    </p>
                  )}
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">{msg.subject || '(no subject)'}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">{msg.message}</p>
                  <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-500">
                    <span>{msg.eventName} · {msg.communicationType}</span>
                    <span>{new Date(msg.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SectionCard>
    </div>
  );
};

type BEReportCategory = 'event_summary' | 'revenue' | 'occupancy' | 'vendor' | 'resource' | 'guest_feedback';
type BEReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
type BEReportFormat = 'PDF' | 'Excel' | 'CSV';

interface BEReport {
  id: string;
  category: BEReportCategory;
  name: string;
  description: string;
  last_run: string | null;
  status: BEReportStatus;
  format: BEReportFormat;
  frequency: string;
  updated_at?: string;
}

const BE_REPORT_STATUS_TONE: Record<BEReportStatus, 'success' | 'warning' | 'info' | 'danger'> = {
  Ready: 'success',
  Scheduled: 'info',
  Generating: 'warning',
  Failed: 'danger',
};

const BE_REPORT_FORMAT_TONE: Record<BEReportFormat, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

const BE_CATEGORY_LABELS: Record<BEReportCategory, string> = {
  event_summary: 'Event Summary',
  revenue: 'Revenue Report',
  occupancy: 'Occupancy Analysis',
  vendor: 'Vendor Performance',
  resource: 'Resource Utilization',
  guest_feedback: 'Guest Feedback',
};

const BE_CATEGORY_ORDER: BEReportCategory[] = ['event_summary', 'revenue', 'occupancy', 'vendor', 'resource', 'guest_feedback'];

const BE_DEPT_TAG = 'BE';

// ── Period resolution (mirrors F&B Reports) ─────────────────────────
type BEPeriod = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';
const BE_PERIODS: BEPeriod[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

function beToISODate(d: Date): string { return d.toISOString().split('T')[0]; }
function beStartOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function bePeriodDateRange(p: BEPeriod, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = beToISODate(now);
  switch (p) {
    case 'Today': return { from: today, to: today };
    case 'WTD': return { from: beToISODate(beStartOfWeek(now)), to: today };
    case 'MTD': return { from: beToISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'YTD': return { from: beToISODate(new Date(now.getFullYear(), 0, 1)), to: today };
    case 'Custom':
    default: return { from: customFrom, to: customTo };
  }
}
function beDefaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  return { from: beToISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: beToISODate(now) };
}
function bePeriodLabel(p: BEPeriod, from: string, to: string): string {
  const range = bePeriodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}

function beFormatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ReportsView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<BEPeriod>('MTD');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [allReports, setAllReports] = useState<BEReport[]>([]);
  const [generatedReports, setGeneratedReports] = useState<any[]>([]);
  const [stats, setStats] = useState<{ total: number; ready: number; scheduled: number; failed: number; byCategory: Record<string, number> } | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const API = '/api/banquet-events/reports';
  const headers = banquetHeaders();

  const fetchAll = useCallback(async () => {
    setReportsLoading(true);
    try {
      const [reportsRes, statsRes, generatedRes] = await Promise.all([
        fetch(API, { headers }),
        fetch(`${API}/stats`, { headers }),
        fetch(`${API}/generated`, { headers }),
      ]);
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setAllReports(Array.isArray(data) ? data : []);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (generatedRes.ok) {
        const data = await generatedRes.json();
        setGeneratedReports(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
      addNotification('Failed to load reports', 'warning');
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Concrete date range + display label for the active period
  const activeRange = useMemo(() => bePeriodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => bePeriodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  // Filter by search only — always show ALL reports even if zero matches
  const reports = useMemo(() =>
    allReports
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.description.toLowerCase().includes(search.toLowerCase())
      ),
    [allReports, search]
  );

  // Group by category — always render every category even if zero reports
  const reportsByCategory = useMemo(() => {
    const map: Record<BEReportCategory, BEReport[]> = {
      event_summary: [], revenue: [], occupancy: [], vendor: [], resource: [], guest_feedback: []
    };
    for (const r of reports) {
      if (map[r.category]) map[r.category].push(r);
    }
    return map;
  }, [reports]);

  const totalReports = stats?.total ?? allReports.length;
  const ready = stats?.ready ?? allReports.filter(r => r.status === 'Ready').length;
  const scheduled = stats?.scheduled ?? allReports.filter(r => r.status === 'Scheduled').length;
  const failed = stats?.failed ?? allReports.filter(r => r.status === 'Failed').length;

  // Live KPIs from events prop
  const totalRevenue = events.reduce((s: number, e: Event) => s + (Number(e.grandTotal) || 0), 0);
  const totalCollected = events.reduce((s: number, e: Event) => s + (Number(e.paidTotal) || 0), 0);
  const totalAttendance = events.reduce((s: number, e: Event) => s + (Number(e.actualAttendance) || Number(e.expectedAttendance) || 0), 0);

  const runReport = async (r: BEReport) => {
    setRunningId(r.id);
    setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Generating' } : x)));
    try {
      const res = await fetch(`${API}/${encodeURIComponent(r.id)}/run`, { method: 'POST', headers });
      if (res.ok) {
        const updated = await res.json();
        setAllReports(prev => prev.map(x => (x.id === r.id ? updated : x)));
        addNotification(`${r.name} refreshed`, 'success');
      } else {
        setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
        addNotification(`Failed to run ${r.name}`, 'warning');
      }
    } catch (e) {
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
      addNotification('Failed to run report', 'warning');
    } finally {
      setRunningId(null);
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const res = await fetch(`${API}/run-all`, { method: 'POST', headers });
      if (res.ok) {
        const result = await res.json();
        await fetchAll();
        addNotification(`${result.refreshed || 0} report(s) refreshed`, 'success');
      } else {
        addNotification('Failed to run all reports', 'warning');
      }
    } catch (e) {
      addNotification('Failed to run all reports', 'warning');
    } finally {
      setRunningAll(false);
    }
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Banquet & Event Reports"
        subtitle="All banquet reports — select a period to view, run, and export"
        icon={FileText}
        actions={
          <>
            {/* Period toggle + custom dates */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {BE_PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      if (p === 'Custom') {
                        const range = beDefaultCustomRange();
                        setCustomFrom(range.from);
                        setCustomTo(range.to);
                      }
                      setPeriod(p);
                    }}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      period === p
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {period === 'Custom' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                </div>
              )}
            </div>
            <button
              onClick={fetchAll}
              disabled={reportsLoading}
              className={[button.ghost, 'flex items-center gap-2'].join(' ')}
              title="Refresh"
            >
              {reportsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button
              onClick={runAll}
              disabled={runningAll || reportsLoading}
              className={[button.primary, 'flex items-center gap-2'].join(' ')}
            >
              {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
              Run All
            </button>
          </>
        }
      />

      {/* Live KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Revenue" value={`ETB ${totalRevenue.toLocaleString()}`} icon={DollarSign} tone="success" />
        <StatCard title="Total Collected" value={`ETB ${totalCollected.toLocaleString()}`} icon={TrendingUp} tone="info" />
        <StatCard title="Total Attendance" value={totalAttendance.toLocaleString()} icon={Users} tone="accent" />
        <StatCard title="Total Events" value={events.length} icon={BarChart3} tone="neutral" />
      </div>

      {/* Report catalog stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={totalReports} icon={FileText} tone="accent" />
        <StatCard title="Ready" value={ready} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={scheduled} icon={Clock} tone="info" />
        <StatCard title="Failed" value={failed} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Search toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reports..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* Reports grouped by category — always show ALL categories even if zero */}
      {reportsLoading && allReports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
            Loading reports…
          </div>
        </SectionCard>
      ) : (
        BE_CATEGORY_ORDER.map(cat => {
          const groupReports = reportsByCategory[cat] || [];
          return (
            <SectionCard
              key={cat}
              title={`${BE_CATEGORY_LABELS[cat]} · ${activeLabel}`}
              icon={FileBarChart}
              tone="accent"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Description</th>
                      <th className="px-6 py-3 font-medium">Last Run</th>
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium">Frequency</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {groupReports.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-6 text-center text-slate-500 dark:text-slate-400">
                          No reports in this category.
                        </td>
                      </tr>
                    ) : (
                      groupReports.map(r => {
                        const isRunning = runningId === r.id;
                        return (
                          <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <td className="px-6 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  {BE_DEPT_TAG}
                                </span>
                                <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.id}</span>
                              </span>
                            </td>
                            <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                            <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.description}</td>
                            <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{beFormatLastRun(r.last_run)}</td>
                            <td className="px-6 py-3"><Badge tone={BE_REPORT_FORMAT_TONE[r.format]}>{r.format}</Badge></td>
                            <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.frequency}</td>
                            <td className="px-6 py-3"><Badge tone={BE_REPORT_STATUS_TONE[r.status]}>{r.status}</Badge></td>
                            <td className="px-6 py-3 whitespace-nowrap">
                              {period === 'Custom' ? (
                                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                  {activeRange.from} → {activeRange.to}
                                </span>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <Badge tone={period === 'Today' ? 'info' : period === 'WTD' ? 'warning' : period === 'MTD' ? 'success' : 'accent'}>
                                    {period}
                                  </Badge>
                                  <span className="text-[10px] text-slate-400 font-mono">{activeRange.from} → {activeRange.to}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  onClick={() => runReport(r)}
                                  disabled={isRunning}
                                  className={button.ghost}
                                  title="Run now"
                                >
                                  {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                  Run
                                </button>
                                <button
                                  onClick={() => addNotification(`${r.name}: ${r.description}`, 'info')}
                                  className={button.ghost}
                                  title="View details"
                                >
                                  <Eye className="w-4 h-4" />
                                  View
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          );
        })
      )}

      {/* Generated report outputs */}
      {generatedReports.length > 0 && (
        <SectionCard title="Generated Reports" icon={FileBarChart} tone="success" pad="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Report</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Period</th>
                  <th className="px-6 py-3 font-medium">Generated</th>
                  <th className="px-6 py-3 font-medium">Summary</th>
                  <th className="px-6 py-3 font-medium text-right">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {generatedReports.map((g: any) => (
                  <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{g.report_name}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{g.report_type}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{g.date_range_start} → {g.date_range_end}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{beFormatLastRun(g.generated_at)}</td>
                    <td className="px-6 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono max-w-md truncate" title={JSON.stringify(g.summary)}>
                      {g.summary ? JSON.stringify(g.summary).slice(0, 120) : '—'}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={async () => {
                          const res = await fetch(`/api/banquet-events/reports/generated/${g.id}/export?format=csv`, { headers: banquetHeaders() });
                          if (!res.ok) { addNotification('Export failed', 'warning'); return; }
                          const blob = await res.blob();
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `${(g.report_name || 'report').replace(/[^a-z0-9]+/gi, '_')}.csv`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                        className="p-1.5 text-slate-400 hover:text-emerald-500"
                        title="Download CSV"
                      >
                        <Download size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-6 border border-amber-200 dark:border-amber-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          Report Delivery
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Reports are generated automatically based on their schedule and can be delivered to Finance, Executive BI, and Banquet leadership. Manual re-runs are available for users with report access.
        </p>
      </div>
    </div>
  );
};

const ConfigurationView = ({ events, loading, onRefresh, getStatusColor, addNotification }: any) => {
  const [activeTab, setActiveTab] = useState('general');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Checklist templates state
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    itemName: '',
    category: '',
    dueOffsetDays: '0',
    isActive: true
  });
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const headers = banquetHeaders();

  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await fetch('/api/banquet-events/config', { headers });
      if (res.ok) {
        const data = await res.json();
        setConfig(data || {});
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/banquet-events/checklist-templates', { headers });
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to load checklist templates:', e);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); fetchTemplates(); }, [fetchConfig, fetchTemplates]);

  const updateConfig = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveConfig = async (e: React.FormEvent, keys: string[]) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const k of keys) payload[k] = String(config[k] ?? '');
      const res = await fetch('/api/banquet-events/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        addNotification('Configuration saved successfully', 'success');
        await fetchConfig();
      } else {
        addNotification('Failed to save configuration', 'warning');
      }
    } catch (e) {
      addNotification('Failed to save configuration', 'warning');
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingTemplateId
        ? `/api/banquet-events/checklist-templates/${editingTemplateId}`
        : '/api/banquet-events/checklist-templates';
      const method = editingTemplateId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(templateForm)
      });
      if (res.ok) {
        addNotification(editingTemplateId ? 'Template updated' : 'Template created', 'success');
        setTemplateForm({ itemName: '', category: '', dueOffsetDays: '0', isActive: true });
        setEditingTemplateId(null);
        fetchTemplates();
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to save template', 'warning');
      }
    } catch (e) {
      addNotification('Failed to save template', 'warning');
    }
  };

  const handleEditTemplate = (t: any) => {
    setEditingTemplateId(t.templateId);
    setTemplateForm({
      itemName: t.itemName,
      category: t.category || '',
      dueOffsetDays: String(t.dueOffsetDays || 0),
      isActive: t.isActive
    });
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/banquet-events/checklist-templates/${id}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        addNotification('Template deleted', 'success');
        fetchTemplates();
      }
    } catch (e) {
      addNotification('Failed to delete template', 'warning');
    }
  };

  const configTabs = [
    { id: 'general', name: 'General', icon: Settings },
    { id: 'booking', name: 'Booking', icon: Calendar },
    { id: 'checklist-templates', name: 'Checklist Templates', icon: ClipboardList },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'integrations', name: 'Integrations', icon: Network }
  ];

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]";
  const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2";

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="System Configuration"
        subtitle="Banquet & Events portal settings — property-scoped, DB-backed"
        icon={Settings}
        actions={
          <button onClick={() => { fetchConfig(); fetchTemplates(); }} disabled={configLoading} className={[button.ghost, 'flex items-center gap-2'].join(' ')}>
            {configLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      {/* Configuration Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {configTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm font-medium">{tab.name}</span>
            </button>
          );
        })}
      </div>

      {/* General Settings */}
      {activeTab === 'general' && (
        <SectionCard title="General Settings" icon={Settings} tone="accent">
          {configLoading ? (
            <div className="px-6 py-10 text-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…
            </div>
          ) : (
            <form onSubmit={(e) => handleSaveConfig(e, ['hotel_name', 'default_currency', 'timezone', 'language'])} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Hotel Name</label>
                  <input type="text" value={config.hotel_name || ''} onChange={(e) => updateConfig('hotel_name', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Default Currency</label>
                  <select value={config.default_currency || 'ETB'} onChange={(e) => updateConfig('default_currency', e.target.value)} className={inputCls}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="ETB">ETB</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Timezone</label>
                  <select value={config.timezone || 'EAT'} onChange={(e) => updateConfig('timezone', e.target.value)} className={inputCls}>
                    <option value="UTC">UTC</option>
                    <option value="EST">EST</option>
                    <option value="EAT">EAT (East Africa)</option>
                    <option value="GMT">GMT</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Language</label>
                  <select value={config.language || 'en'} onChange={(e) => updateConfig('language', e.target.value)} className={inputCls}>
                    <option value="en">English</option>
                    <option value="am">Amharic</option>
                    <option value="fr">French</option>
                    <option value="ar">Arabic</option>
                  </select>
                </div>
              </div>
              <button type="submit" disabled={saving} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save Settings
              </button>
            </form>
          )}
        </SectionCard>
      )}

      {/* Booking Settings */}
      {activeTab === 'booking' && (
        <SectionCard title="Booking Settings" icon={Calendar} tone="info">
          {configLoading ? (
            <div className="px-6 py-10 text-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…
            </div>
          ) : (
            <form onSubmit={(e) => handleSaveConfig(e, ['booking_lead_time_days', 'cancellation_policy', 'deposit_required', 'deposit_percentage'])} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Booking Lead Time (days)</label>
                  <input type="number" min="0" value={config.booking_lead_time_days || '7'} onChange={(e) => updateConfig('booking_lead_time_days', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Cancellation Policy</label>
                  <select value={config.cancellation_policy || '24 hours'} onChange={(e) => updateConfig('cancellation_policy', e.target.value)} className={inputCls}>
                    <option value="24 hours">24 hours</option>
                    <option value="48 hours">48 hours</option>
                    <option value="72 hours">72 hours</option>
                    <option value="7 days">7 days</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Deposit Required</label>
                  <select value={config.deposit_required || 'true'} onChange={(e) => updateConfig('deposit_required', e.target.value)} className={inputCls}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Deposit Percentage (%)</label>
                  <input type="number" min="0" max="100" value={config.deposit_percentage || '20'} onChange={(e) => updateConfig('deposit_percentage', e.target.value)} className={inputCls} />
                </div>
              </div>
              <button type="submit" disabled={saving} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save Settings
              </button>
            </form>
          )}
        </SectionCard>
      )}

      {/* Checklist Templates */}
      {activeTab === 'checklist-templates' && (
        <div className={layout.sectionStack}>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <strong>How it works:</strong> Templates defined here are automatically seeded as checklist items when an event enters the <strong>Planning</strong> stage. The due date is calculated as <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40">event.start_date − due_offset_days</code>.
            </p>
          </div>

          <SectionCard title={editingTemplateId ? 'Edit Template' : 'Add New Template'} icon={ClipboardList} tone="accent">
            <form onSubmit={handleTemplateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className={labelCls}>Item Name</label>
                  <input type="text" value={templateForm.itemName} onChange={(e) => setTemplateForm({ ...templateForm, itemName: e.target.value })} placeholder="e.g. Confirm venue booking" className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <input type="text" value={templateForm.category} onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })} placeholder="e.g. Venue" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Due Offset (days before event)</label>
                  <input type="number" min="0" value={templateForm.dueOffsetDays} onChange={(e) => setTemplateForm({ ...templateForm, dueOffsetDays: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={templateForm.isActive} onChange={(e) => setTemplateForm({ ...templateForm, isActive: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-[var(--color-accent-operations)]" />
                  Active
                </label>
                <button type="submit" className={[button.primary, 'flex items-center gap-2'].join(' ')}>
                  <Plus className="w-4 h-4" />
                  {editingTemplateId ? 'Update Template' : 'Add Template'}
                </button>
                {editingTemplateId && (
                  <button type="button" onClick={() => { setEditingTemplateId(null); setTemplateForm({ itemName: '', category: '', dueOffsetDays: '0', isActive: true }); }} className={button.ghost}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Active Templates" icon={ClipboardList} tone="info" pad="none">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item Name</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Due Offset (days)</th>
                    <th className="px-4 py-3 font-medium">Active</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {templatesLoading ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" /> Loading…
                    </td></tr>
                  ) : templates.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No templates found</td></tr>
                  ) : templates.map((t) => (
                    <tr key={t.templateId} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{t.itemName}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.category || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 tabular-nums">{t.dueOffsetDays}</td>
                      <td className="px-4 py-3">
                        <Badge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button onClick={() => handleEditTemplate(t)} className="p-1.5 text-gray-400 hover:text-[var(--color-accent-operations)]" title="Edit">
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDeleteTemplate(t.templateId)} className="p-1.5 text-gray-400 hover:text-red-500" title="Delete">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Notifications */}
      {activeTab === 'notifications' && (
        <SectionCard title="Notification Settings" icon={Bell} tone="warning">
          {configLoading ? (
            <div className="px-6 py-10 text-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…
            </div>
          ) : (
            <form onSubmit={(e) => handleSaveConfig(e, ['notify_new_booking', 'notify_status_change', 'notify_payment', 'notify_alert_critical'])} className="space-y-4">
              <div className="space-y-3">
                {[
                  { key: 'notify_new_booking', label: 'New Booking Created', desc: 'Notify when a new event booking is created' },
                  { key: 'notify_status_change', label: 'Status Change', desc: 'Notify when an event status changes' },
                  { key: 'notify_payment', label: 'Payment Received', desc: 'Notify when a payment is posted' },
                  { key: 'notify_alert_critical', label: 'Critical Alerts', desc: 'Notify on critical-severity alerts' }
                ].map(({ key, label, desc }) => (
                  <label key={key} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={config[key] === 'true'}
                      onChange={(e) => updateConfig(key, e.target.checked ? 'true' : 'false')}
                      className="w-5 h-5 rounded border-gray-300 text-[var(--color-accent-operations)]"
                    />
                  </label>
                ))}
              </div>
              <button type="submit" disabled={saving} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save Settings
              </button>
            </form>
          )}
        </SectionCard>
      )}

      {/* Integrations */}
      {activeTab === 'integrations' && (
        <SectionCard title="Integration Settings" icon={Network} tone="info">
          {configLoading ? (
            <div className="px-6 py-10 text-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…
            </div>
          ) : (
            <form onSubmit={(e) => handleSaveConfig(e, ['integrate_pos', 'integrate_accounting', 'integrate_calendar', 'integrate_email', 'integrate_sms'])} className="space-y-4">
              <div className="space-y-3">
                {[
                  { key: 'integrate_pos', label: 'POS System', desc: 'Sync charges with the property POS' },
                  { key: 'integrate_accounting', label: 'Accounting / GL', desc: 'Push invoices and payments to the GL' },
                  { key: 'integrate_calendar', label: 'External Calendar', desc: 'Two-way sync with Google / Outlook calendars' },
                  { key: 'integrate_email', label: 'Email Notifications', desc: 'Send booking confirmations and BEOs by email' },
                  { key: 'integrate_sms', label: 'SMS Notifications', desc: 'Send reminders and alerts via SMS' }
                ].map(({ key, label, desc }) => (
                  <label key={key} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/50">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={config[key] === 'true'}
                      onChange={(e) => updateConfig(key, e.target.checked ? 'true' : 'false')}
                      className="w-5 h-5 rounded border-gray-300 text-[var(--color-accent-operations)]"
                    />
                  </label>
                ))}
              </div>
              <button type="submit" disabled={saving} className={[button.primary, 'flex items-center gap-2'].join(' ')}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save Settings
              </button>
            </form>
          )}
        </SectionCard>
      )}

      {/* Config summary stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Config Keys" value={Object.keys(config).length} icon={Settings} tone="accent" />
        <StatCard title="Templates" value={templates.length} icon={ClipboardList} tone="info" />
        <StatCard title="Active Templates" value={templates.filter(t => t.isActive).length} icon={CheckCircle2} tone="success" />
        <StatCard title="Integrations On" value={['integrate_pos', 'integrate_accounting', 'integrate_calendar', 'integrate_email', 'integrate_sms'].filter(k => config[k] === 'true').length} icon={Network} tone="neutral" />
      </div>
    </div>
  );
};

const getBillingStatusTone = (status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' => {
  if (status === 'Paid' || status === 'Settled') return 'success';
  if (status === 'Partial' || status === 'DepositDue') return 'warning';
  if (status === 'Overdue') return 'danger';
  if (status === 'Invoiced') return 'accent';
  if (status === 'DepositPaid') return 'info';
  return 'neutral';
};

const getChargeTypeTone = (type: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' => {
  if (type === 'VenueRental') return 'accent';
  if (type === 'Catering') return 'success';
  if (type === 'Beverage') return 'info';
  if (type === 'Equipment') return 'warning';
  if (type === 'Decoration') return 'danger';
  return 'neutral';
};

const BillingDepositsView = ({ events, loading, onRefresh, addNotification }: any) => {
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [charges, setCharges] = useState<Record<string, any[]>>({});
  const [payments, setPayments] = useState<Record<string, any[]>>({});
  const [depositSchedules, setDepositSchedules] = useState<Record<string, any[]>>({});
  const [invoices, setInvoices] = useState<Record<string, any[]>>({});
  const [depositForm, setDepositForm] = useState<{ eventId: string; label: string; dueDate: string; amount: string } | null>(null);
  const [budgets, setBudgets] = useState<Record<string, any[]>>({});
  const [budgetLines, setBudgetLines] = useState<Record<string, any[]>>({});
  const [budgetForm, setBudgetForm] = useState<{ eventId: string; category: string; item: string; budgetedAmount: string } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    eventId: '',
    amount: '',
    paymentMethod: 'CreditCard' as 'CreditCard' | 'BankTransfer' | 'Cash' | 'Check' | 'MobileMoney',
    isDeposit: false,
    referenceNumber: '',
    notes: ''
  });

  const fmt = (n: number | undefined) => `ETB ${(Number(n) || 0).toLocaleString()}`;

  const totalContracted = events.reduce((s: number, e: Event) => s + (Number(e.grandTotal) || Number(e.estimatedRevenue) || 0), 0);
  const totalDepositsRequired = events.reduce((s: number, e: Event) => s + (Number(e.depositRequired) || Number(e.depositAmount) || 0), 0);
  const totalDepositsCollected = events.reduce((s: number, e: Event) => s + (Number(e.depositPaidAmount) || 0), 0);
  const totalCollected = events.reduce((s: number, e: Event) => s + (Number(e.paidTotal) || 0), 0);
  const totalOutstanding = events.reduce((s: number, e: Event) => s + (Number(e.balanceDue) || Number(e.finalBalance) || 0), 0);

  const fetchEventDetails = useCallback(async (eventId: string) => {
    setDetailsLoading(eventId);
    try {
      const headers = banquetHeaders();
      const [chargesRes, paymentsRes, schedRes, invRes, budRes, budLinesRes] = await Promise.all([
        fetch(`/api/banquet-events/events/${eventId}/charges`, { headers }),
        fetch(`/api/banquet-events/events/${eventId}/payments`, { headers }),
        fetch(`/api/banquet-events/events/${eventId}/deposit-schedule`, { headers }),
        fetch(`/api/banquet-events/events/${eventId}/invoices`, { headers }),
        fetch(`/api/banquet-events/events/${eventId}/budget-variance`, { headers }),
        fetch(`/api/banquet-events/events/${eventId}/budget`, { headers })
      ]);
      const chargesData = chargesRes.ok ? await chargesRes.json() : [];
      const paymentsData = paymentsRes.ok ? await paymentsRes.json() : [];
      const schedData = schedRes.ok ? await schedRes.json() : [];
      const invData = invRes.ok ? await invRes.json() : [];
      const budData = budRes.ok ? await budRes.json() : [];
      const budLines = budLinesRes.ok ? await budLinesRes.json() : [];
      setCharges(prev => ({ ...prev, [eventId]: Array.isArray(chargesData) ? chargesData : [] }));
      setPayments(prev => ({ ...prev, [eventId]: Array.isArray(paymentsData) ? paymentsData : [] }));
      setDepositSchedules(prev => ({ ...prev, [eventId]: Array.isArray(schedData) ? schedData : [] }));
      setInvoices(prev => ({ ...prev, [eventId]: Array.isArray(invData) ? invData : [] }));
      setBudgets(prev => ({ ...prev, [eventId]: Array.isArray(budData) ? budData : [] }));
      setBudgetLines(prev => ({ ...prev, [eventId]: Array.isArray(budLines) ? budLines : [] }));
    } catch (e) {
      console.error('Failed to load event details:', e);
    } finally {
      setDetailsLoading(null);
    }
  }, []);

  const toggleEventExpand = (eventId: string) => {
    if (expandedEvent === eventId) {
      setExpandedEvent(null);
    } else {
      setExpandedEvent(eventId);
      if (!charges[eventId] && !payments[eventId]) {
        fetchEventDetails(eventId);
      }
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/banquet-events/payments', {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          ...paymentForm,
          amount: parseFloat(paymentForm.amount)
        })
      });
      if (response.ok) {
        addNotification('Payment recorded successfully', 'success');
        setShowPaymentForm(false);
        setPaymentForm({
          eventId: '',
          amount: '',
          paymentMethod: 'CreditCard',
          isDeposit: false,
          referenceNumber: '',
          notes: ''
        });
        onRefresh();
        if (expandedEvent) fetchEventDetails(expandedEvent);
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || `Payment failed (${response.status})`, 'warning');
      }
    } catch (error) {
      console.error('Failed to record payment:', error);
      addNotification('Failed to record payment', 'warning');
    }
  };

  const handleRefundPayment = async (eventId: string, payment: any) => {
    const reason = window.prompt(`Refund ${fmt(Math.abs(Number(payment.amount)))} for this payment?\n\nReason:`);
    if (reason === null) return;
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/refund`, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          amount: Math.abs(Number(payment.amount)),
          paymentMethod: payment.paymentMethod,
          reason: reason || 'Customer refund',
          referenceNumber: payment.referenceNumber || null,
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        addNotification('Refund recorded', 'success');
        onRefresh();
        fetchEventDetails(eventId);
      } else {
        addNotification(data.error || `Refund failed (${response.status})`, 'warning');
      }
    } catch {
      addNotification('Failed to record refund', 'warning');
    }
  };

  const handleVoidPayment = async (eventId: string, payment: any) => {
    const reason = window.prompt(`Void this ${fmt(Math.abs(Number(payment.amount)))} payment? (for payments recorded in error)\n\nReason:`);
    if (reason === null) return;
    try {
      const response = await fetch(`/api/banquet-events/payments/${encodeURIComponent(payment.paymentId)}/void`, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({ reason: reason || 'Recorded in error' })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        addNotification('Payment voided', 'success');
        onRefresh();
        fetchEventDetails(eventId);
      } else {
        addNotification(data.error || `Void failed (${response.status})`, 'warning');
      }
    } catch {
      addNotification('Failed to void payment', 'warning');
    }
  };

  const handleSettle = async (eventId: string) => {    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/settle`, {
        method: 'POST',
        headers: banquetHeaders()
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        addNotification(data.message || 'Event settled — invoice generated', 'success');
        onRefresh();
        if (expandedEvent === eventId) fetchEventDetails(eventId);
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || `Settlement failed (${response.status})`, 'warning');
      }
    } catch (error) {
      console.error('Failed to settle event:', error);
      addNotification('Failed to settle event', 'warning');
    }
  };

  const handlePostCharges = async (eventId: string) => {
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/post-charges`, {
        method: 'POST',
        headers: banquetHeaders()
      });
      if (response.ok) {
        addNotification('Charges posted to folio', 'success');
        onRefresh();
        if (expandedEvent === eventId) fetchEventDetails(eventId);
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || `Post charges failed (${response.status})`, 'warning');
      }
    } catch (error) {
      console.error('Failed to post charges:', error);
      addNotification('Failed to post charges', 'warning');
    }
  };

  const handleRebuildCharges = async (eventId: string) => {
    try {
      const response = await fetch(`/api/banquet-events/events/${eventId}/charges/rebuild`, {
        method: 'POST',
        headers: banquetHeaders()
      });
      if (response.ok) {
        addNotification('Charges rebuilt from catering & logistics', 'success');
        fetchEventDetails(eventId);
        onRefresh();
      } else {
        const err = await response.json().catch(() => ({}));
        addNotification(err.error || `Rebuild failed (${response.status})`, 'warning');
      }
    } catch (error) {
      console.error('Failed to rebuild charges:', error);
      addNotification('Failed to rebuild charges', 'warning');
    }
  };

  // Deposit schedule — milestone plan; paid status comes from EventDeposit payments.
  const handleAddDepositItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositForm) return;
    try {
      const res = await fetch(`/api/banquet-events/events/${depositForm.eventId}/deposit-schedule`, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          label: depositForm.label,
          dueDate: depositForm.dueDate || null,
          amount: parseFloat(depositForm.amount)
        })
      });
      if (res.ok) {
        addNotification('Deposit milestone added', 'success');
        setDepositForm(null);
        fetchEventDetails(depositForm.eventId);
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to add deposit milestone', 'warning');
      }
    } catch (err) {
      addNotification('Failed to add deposit milestone', 'warning');
    }
  };

  const handleDeleteDepositItem = async (eventId: string, scheduleId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/deposit-schedule/${scheduleId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Deposit milestone removed', 'success');
        fetchEventDetails(eventId);
      }
    } catch (e) {
      addNotification('Failed to remove deposit milestone', 'warning');
    }
  };

  // Progressive billing — invoice the unbilled delta without settling.
  const handleInterimInvoice = async (eventId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/events/${eventId}/invoice-interim`, {
        method: 'POST',
        headers: banquetHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addNotification(`Interim invoice ${data.invoiceNumber || ''} issued — ${fmt(data.invoiceTotal)}`, 'success');
        fetchEventDetails(eventId);
        onRefresh();
      } else {
        addNotification(data.error || `Interim invoice failed (${res.status})`, 'warning');
      }
    } catch (e) {
      addNotification('Failed to issue interim invoice', 'warning');
    }
  };

  // Event budget lines (468) — budgeted vs actual per charge-type category.
  const handleAddBudgetLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetForm) return;
    try {
      const res = await fetch(`/api/banquet-events/events/${budgetForm.eventId}/budget`, {
        method: 'POST',
        headers: banquetHeaders(true),
        body: JSON.stringify({
          category: budgetForm.category,
          item: budgetForm.item,
          budgetedAmount: parseFloat(budgetForm.budgetedAmount)
        })
      });
      if (res.ok) {
        addNotification('Budget line added', 'success');
        setBudgetForm(null);
        fetchEventDetails(budgetForm.eventId);
      } else {
        const err = await res.json().catch(() => ({}));
        addNotification(err.error || 'Failed to add budget line', 'warning');
      }
    } catch (err) {
      addNotification('Failed to add budget line', 'warning');
    }
  };

  const handleDeleteBudgetLine = async (eventId: string, budgetId: string) => {
    try {
      const res = await fetch(`/api/banquet-events/budgets/${budgetId}`, {
        method: 'DELETE',
        headers: banquetHeaders()
      });
      if (res.ok) {
        addNotification('Budget line removed', 'success');
        fetchEventDetails(eventId);
      }
    } catch (e) {
      addNotification('Failed to remove budget line', 'warning');
    }
  };

  return (
    <div className={layout.sectionStack}>
      {/* Financial Summary — StatCard tiles matching Front Office style */}
      <div className={layout.kpiGrid}>
        <StatCard title="Contracted" value={fmt(totalContracted)} icon={DollarSign} tone="success" />
        <StatCard title="Deposits Due" value={fmt(totalDepositsRequired)} icon={PiggyBank} tone="info" />
        <StatCard title="Deposits Collected" value={fmt(totalDepositsCollected)} icon={CheckCircle2} tone="accent" />
        <StatCard title="Total Collected" value={fmt(totalCollected)} icon={TrendingUp} tone="success" />
      </div>
      <div className={layout.kpiGrid}>
        <StatCard title="Outstanding" value={fmt(totalOutstanding)} icon={AlertTriangle} tone="danger" />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowPaymentForm(!showPaymentForm)}
          className={button.primary}
        >
          <Plus size={14} />
          {showPaymentForm ? 'Cancel' : 'Record Payment'}
        </button>
      </div>

      {showPaymentForm && (
        <SectionCard title="Record Payment" icon={DollarSign} tone="accent" pad="md">
          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Event</label>
              <select
                value={paymentForm.eventId}
                onChange={(e) => setPaymentForm({ ...paymentForm, eventId: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                required
              >
                <option value="">Select Event</option>
                {events.map((event: any) => (
                  <option key={event.eventId} value={event.eventId}>{event.eventName} — {fmt(event.grandTotal || event.estimatedRevenue)}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Amount (ETB)</label>
                <input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Payment Method</label>
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  required
                >
                  <option value="CreditCard">Credit Card</option>
                  <option value="BankTransfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Check">Cheque</option>
                  <option value="MobileMoney">Mobile Money</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDeposit"
                checked={paymentForm.isDeposit}
                onChange={(e) => setPaymentForm({ ...paymentForm, isDeposit: e.target.checked })}
                className="rounded border-slate-300 dark:border-slate-700"
              />
              <label htmlFor="isDeposit" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                This is a deposit payment
              </label>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Reference Number</label>
              <input
                type="text"
                value={paymentForm.referenceNumber}
                onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Notes</label>
              <textarea
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white resize-none"
              />
            </div>

            <button type="submit" className={button.primary}>Record Payment</button>
          </form>
        </SectionCard>
      )}

      {/* Events Billing Table — Front Office table style */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className={sectionTitle}>Event Billing</h3>
          <div className="text-sm text-gray-600 dark:text-gray-400">{events.length} events</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8"></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Event</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Client</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deposit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Collected</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {events.map((event: any) => {
                const grand = Number(event.grandTotal) || Number(event.estimatedRevenue) || 0;
                const depReq = Number(event.depositRequired) || Number(event.depositAmount) || 0;
                const depPaid = Number(event.depositPaidAmount) || 0;
                const collected = Number(event.paidTotal) || 0;
                const balance = Number(event.balanceDue) || Number(event.finalBalance) || 0;
                const bStatus = event.billingStatus || (balance <= 0 ? 'Paid' : collected > 0 ? 'Partial' : 'Unbilled');
                const isExpanded = expandedEvent === event.eventId;
                const eventCharges = charges[event.eventId] || [];
                const eventPayments = payments[event.eventId] || [];
                const chargesTotal = eventCharges.reduce((s: number, c: any) => s + (Number(c.totalAmount) || 0), 0);
                const paymentsTotal = eventPayments.reduce((s: number, p: any) => s + (p.isVoided ? 0 : Number(p.amount) || 0), 0);

                return (
                  <React.Fragment key={event.eventId}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          onClick={() => toggleEventExpand(event.eventId)}
                          className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{event.eventName}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-600 dark:text-gray-400">{event.clientName}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-600 dark:text-gray-400">{new Date(event.startDate).toLocaleDateString()}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmt(grand)}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{fmt(depReq)}</p>
                        {depPaid > 0 && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">({fmt(depPaid)} paid)</p>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">{fmt(collected)}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <p className={`text-sm font-bold tabular-nums ${balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmt(balance)}</p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Badge tone={getBillingStatusTone(bStatus)} variant={bStatus === 'Paid' || bStatus === 'Settled' || bStatus === 'DepositPaid' ? 'solid' : 'soft'}>
                            {bStatus}
                          </Badge>
                          {event.billingMode === 'corporate' && (
                            <Badge tone="accent">AR</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              setSelectedEvent(event);
                              setPaymentForm({ ...paymentForm, eventId: event.eventId });
                              setShowPaymentForm(true);
                            }}
                            className="px-2 py-1 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 transition"
                          >
                            Pay
                          </button>
                          <button
                            onClick={() => handlePostCharges(event.eventId)}
                            className="px-2 py-1 rounded-lg text-xs font-bold bg-blue-100 dark:bg-blue-900/20 hover:bg-blue-200 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-400 transition"
                            title="Post charges to folio"
                          >
                            Post
                          </button>
                          <button
                            onClick={() => handleInterimInvoice(event.eventId)}
                            className="px-2 py-1 rounded-lg text-xs font-bold bg-violet-100 dark:bg-violet-900/20 hover:bg-violet-200 dark:hover:bg-violet-900/30 text-violet-700 dark:text-violet-400 transition"
                            title="Issue interim invoice for unbilled charges (progressive billing)"
                          >
                            Invoice
                          </button>
                          <button
                            onClick={() => handleSettle(event.eventId)}
                            className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-100 dark:bg-emerald-900/20 hover:bg-emerald-200 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 transition"
                            title="Generate invoice and settle"
                          >
                            Settle
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-50 dark:bg-slate-900/40">
                        <td colSpan={10} className="p-4">
                          {detailsLoading === event.eventId ? (
                            <div className="flex items-center justify-center py-6">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-accent-operations)]"></div>
                              <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">Loading charge breakdown and payments…</span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {/* Charge Breakdown */}
                              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                                <div className="flex justify-between items-center mb-3">
                                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">Charge Breakdown</h5>
                                  <button
                                    onClick={() => handleRebuildCharges(event.eventId)}
                                    className="px-2 py-1 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 transition"
                                  >
                                    Rebuild
                                  </button>
                                </div>
                                {eventCharges.length === 0 ? (
                                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">No charges recorded. Click "Rebuild" to derive from catering & logistics.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {eventCharges.filter((c: any) => !c.isVoided).map((charge: any) => (
                                      <div key={charge.chargeId} className="flex justify-between items-start p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-1">
                                            <Badge tone={getChargeTypeTone(charge.chargeType)}>{charge.chargeType}</Badge>
                                            {charge.isPosted && <Badge tone="success" variant="solid">Posted</Badge>}
                                            {charge.isManual && <Badge tone="neutral">Manual</Badge>}
                                          </div>
                                          <p className="text-sm text-gray-700 dark:text-gray-300">{charge.description}</p>
                                          <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                                            {charge.quantity} × {fmt(Number(charge.unitPrice))}
                                            {Number(charge.discountPercent) > 0 && ` · -${charge.discountPercent}%`}
                                          </p>
                                        </div>
                                        <div className="text-right ml-2">
                                          <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmt(Number(charge.totalAmount))}</p>
                                          {Number(charge.taxAmount) > 0 && (
                                            <p className="text-xs text-gray-500 tabular-nums">incl. tax {fmt(Number(charge.taxAmount))}</p>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                    <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-slate-700">
                                      <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Total Charges</span>
                                      <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmt(chargesTotal)}</span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Payment History */}
                              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                                <h5 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Payment History</h5>
                                {eventPayments.length === 0 ? (
                                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">No payments recorded yet.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {eventPayments.map((payment: any) => (
                                      <div key={payment.paymentId} className={`flex justify-between items-start p-2 rounded-lg border ${payment.isVoided ? 'border-red-200 dark:border-red-800 opacity-60' : 'border-gray-100 dark:border-slate-700'}`}>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <Badge tone={payment.isRefund ? 'danger' : payment.isDeposit ? 'info' : 'success'} variant="solid">
                                              {payment.isRefund ? 'Refund' : payment.isDeposit ? 'Deposit' : 'Payment'}
                                            </Badge>
                                            <Badge tone="neutral">{payment.paymentMethod}</Badge>
                                            {payment.isVoided && <Badge tone="danger" variant="solid">Voided</Badge>}
                                            {payment.postedToGl && !payment.isVoided && <Badge tone="success">GL Posted</Badge>}
                                          </div>
                                          <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {new Date(payment.paymentDate).toLocaleDateString()}
                                            {payment.referenceNumber && ` · Ref: ${payment.referenceNumber}`}
                                          </p>
                                          {payment.notes && (
                                            <p className="text-xs text-gray-400 mt-1">{payment.notes}</p>
                                          )}
                                          {payment.voidReason && (
                                            <p className="text-xs text-red-500 mt-1">Voided: {payment.voidReason}</p>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 ml-2">
                                          <p className={`text-sm font-bold tabular-nums ${payment.isRefund ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                            {payment.isRefund ? '−' : ''}{fmt(Math.abs(Number(payment.amount)))}
                                          </p>
                                          {!payment.isVoided && !payment.isRefund && (
                                            <div className="flex gap-1">
                                              <button
                                                onClick={() => handleRefundPayment(event.eventId, payment)}
                                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                                                title="Refund this payment"
                                              >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                              {!payment.postedToGl && (
                                                <button
                                                  onClick={() => handleVoidPayment(event.eventId, payment)}
                                                  className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition"
                                                  title="Void (recorded in error)"
                                                >
                                                  <XCircle className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                    <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-slate-700">
                                      <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Net Paid</span>
                                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(paymentsTotal)}</span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Deposit Schedule — staged deposits, paid status derived from EventDeposit payments */}
                              <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                                <div className="flex justify-between items-center mb-3">
                                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">Deposit Schedule</h5>
                                  <button
                                    onClick={() => setDepositForm(depositForm?.eventId === event.eventId ? null : { eventId: event.eventId, label: 'Deposit', dueDate: '', amount: '' })}
                                    className="px-2 py-1 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 transition"
                                  >
                                    {depositForm?.eventId === event.eventId ? 'Cancel' : 'Add Milestone'}
                                  </button>
                                </div>
                                {depositForm?.eventId === event.eventId && (
                                  <form onSubmit={handleAddDepositItem} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3 p-3 rounded-lg bg-gray-50 dark:bg-slate-900/40 border border-gray-200 dark:border-slate-700">
                                    <input
                                      type="text" placeholder="Label (e.g. Booking deposit)"
                                      value={depositForm.label}
                                      onChange={(e) => setDepositForm({ ...depositForm, label: e.target.value })}
                                      className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                                      required
                                    />
                                    <input
                                      type="date"
                                      value={depositForm.dueDate}
                                      onChange={(e) => setDepositForm({ ...depositForm, dueDate: e.target.value })}
                                      className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                                    />
                                    <input
                                      type="number" placeholder="Amount (ETB)" min="0" step="0.01"
                                      value={depositForm.amount}
                                      onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                                      className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                                      required
                                    />
                                    <button type="submit" className="px-2 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition">Add</button>
                                  </form>
                                )}
                                {(depositSchedules[event.eventId] || []).length === 0 ? (
                                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">
                                    No deposit milestones. Use "Add Milestone" for staged deposits (e.g. 20% on signing, 30% at T-30).
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {(depositSchedules[event.eventId] || []).map((ms: any) => (
                                      <div key={ms.scheduleId} className="flex justify-between items-center p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <Badge tone={ms.status === 'Paid' ? 'success' : ms.status === 'Overdue' ? 'danger' : ms.status === 'PartiallyPaid' ? 'info' : 'neutral'}>
                                            {ms.status}
                                          </Badge>
                                          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{ms.label}</span>
                                          {ms.dueDate && (
                                            <span className="text-xs text-gray-500 dark:text-gray-400">due {new Date(ms.dueDate).toLocaleDateString()}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 ml-2">
                                          <span className="text-xs text-gray-500 tabular-nums">{fmt(ms.amountPaid)} / {fmt(ms.amount)}</span>
                                          <button
                                            onClick={() => handleDeleteDepositItem(event.eventId, ms.scheduleId)}
                                            className="p-1 text-slate-400 hover:text-rose-500 transition" title="Remove"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Invoices — interim (progressive) + final settlement */}
                              <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                                <h5 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Invoices</h5>
                                {(invoices[event.eventId] || []).length === 0 ? (
                                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">
                                    No invoices yet. "Invoice" issues an interim invoice for unbilled charges; "Settle" produces the final one.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {(invoices[event.eventId] || []).map((inv: any) => (
                                      <div key={inv.id} className="flex justify-between items-center p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <Badge tone={inv.invoiceType === 'Interim' ? 'info' : 'accent'}>{inv.invoiceType || 'Invoice'}</Badge>
                                          <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{inv.invoiceNumber}</span>
                                          {inv.isVoided && <Badge tone="danger" variant="solid">Voided</Badge>}
                                        </div>
                                        <div className="text-right ml-2">
                                          <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmt(Number(inv.total))}</span>
                                          {inv.dueDate && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                              due {new Date(inv.dueDate).toLocaleDateString()} · {inv.status}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Budget vs Actual — event_budgets vs event_charges by category */}
                              <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                                <div className="flex justify-between items-center mb-3">
                                  <h5 className="text-sm font-bold text-gray-900 dark:text-white">Budget vs Actual</h5>
                                  <button
                                    onClick={() => setBudgetForm(budgetForm?.eventId === event.eventId ? null : { eventId: event.eventId, category: 'Catering', item: '', budgetedAmount: '' })}
                                    className="px-2 py-1 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 transition"
                                  >
                                    {budgetForm?.eventId === event.eventId ? 'Cancel' : 'Add Budget Line'}
                                  </button>
                                </div>
                                {budgetForm?.eventId === event.eventId && (
                                  <form onSubmit={handleAddBudgetLine} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3 p-3 rounded-lg bg-gray-50 dark:bg-slate-900/40 border border-gray-200 dark:border-slate-700">
                                    <select
                                      value={budgetForm.category}
                                      onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
                                      className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                                    >
                                      {['VenueRental', 'Catering', 'Beverage', 'Equipment', 'Decoration', 'Staffing', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <input
                                      type="text" placeholder="Item (optional)"
                                      value={budgetForm.item}
                                      onChange={(e) => setBudgetForm({ ...budgetForm, item: e.target.value })}
                                      className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                                    />
                                    <input
                                      type="number" placeholder="Budgeted (ETB)" min="0" step="0.01"
                                      value={budgetForm.budgetedAmount}
                                      onChange={(e) => setBudgetForm({ ...budgetForm, budgetedAmount: e.target.value })}
                                      className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                                      required
                                    />
                                    <button type="submit" className="px-2 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition">Add</button>
                                  </form>
                                )}
                                {(budgets[event.eventId] || []).length === 0 && (budgetLines[event.eventId] || []).length === 0 ? (
                                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">No budget lines. Add lines per category to track budget vs actual spend.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {(budgets[event.eventId] || []).map((b: any) => (
                                      <div key={`var-${b.category}`} className="flex justify-between items-center p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                        <div className="flex items-center gap-2">
                                          <Badge tone={getChargeTypeTone(b.category)}>{b.category}</Badge>
                                          <span className="text-xs text-gray-500 tabular-nums">budget {fmt(Number(b.budgeted))}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">actual {fmt(Number(b.actual))}</span>
                                          <span className={`text-xs font-bold tabular-nums ${Number(b.variance) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                            {Number(b.variance) < 0 ? '−' : '+'}{fmt(Math.abs(Number(b.variance)))}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    {(budgetLines[event.eventId] || []).map((bl: any) => (
                                      <div key={bl.id} className="flex justify-between items-center px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                                        <span>{bl.category}{bl.item ? ` — ${bl.item}` : ''}</span>
                                        <div className="flex items-center gap-2">
                                          <span className="tabular-nums">{fmt(Number(bl.budgetedAmount))}</span>
                                          <button onClick={() => handleDeleteBudgetLine(event.eventId, bl.id)} className="p-1 text-slate-400 hover:text-rose-500" title="Remove">
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BanquetEventsPortal;
