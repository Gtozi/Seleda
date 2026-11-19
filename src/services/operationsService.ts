/**
 * Operations portal service — client for /api/ops-portal/* endpoints.
 *
 * Backs two Operations portal tabs:
 *  - Command Center (/erp/operations/command-center): the overview
 *    aggregates live data from every other portal's real tables
 *    server-side, and alert acknowledgement persists to ops_command_alerts.
 *  - Daily Briefing (/erp/operations/daily-briefing): the briefing is
 *    aggregated live across portals; "Generate" persists a snapshot to
 *    ops_daily_briefings (migration 628) retrievable by date.
 */

const API_BASE = '/api/ops-portal';

async function apiRequest<T = any>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ── Command Center ───────────────────────────────────────────────────────

export type CommandCenterSeverity = 'critical' | 'warning' | 'info';
export type CommandCenterDeptStatus = 'operational' | 'degraded' | 'critical' | 'offline';

export interface CommandCenterDepartment {
  /** Card identity (e.g. 'kitchen', 'laundry'). */
  key: string;
  /** Department registry key for click-through (e.g. 'f&b', 'housekeeping'). */
  deptKey: string;
  name: string;
  status: CommandCenterDeptStatus;
  statusText: string;
  activeIssues: number;
  lastUpdate: string | null;
}

export interface CommandCenterAlert {
  id: string;
  type: CommandCenterSeverity;
  category: string;
  message: string;
  department: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  timestamp: string;
  source: 'seed' | 'generated';
}

export interface CommandCenterOverview {
  generatedAt: string;
  departments: CommandCenterDepartment[];
  alerts: CommandCenterAlert[];
}

export async function fetchCommandCenterOverview(propertyId?: string): Promise<CommandCenterOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<CommandCenterOverview>(`${API_BASE}/command-center${qs}`);
}

export async function acknowledgeCommandCenterAlert(alertId: string): Promise<CommandCenterAlert> {
  return apiRequest<CommandCenterAlert>(
    `${API_BASE}/command-center/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

// ── Daily Briefing ───────────────────────────────────────────────────────

export interface DailyBriefingOccupancy {
  current: number;
  expected: number;
  pickup: number;
  roomsTotal: number;
  occupied: number;
  arrivals: number;
  departures: number;
  inHouseGuests: number;
}

export interface DailyBriefingVipArrival {
  name: string;
  room: string;
  status: string;
  notes: string;
  source: 'Reservation' | 'Housekeeping' | string;
}

export interface DailyBriefingGroupArrival {
  name: string;
  rooms: number;
  guests: number;
  source: string;
}

export interface DailyBriefingEvent {
  name: string;
  type: string;
  location: string;
  attendees: number;
  status: string;
  dateRange: string;
}

export interface DailyBriefingMaintenance {
  task: string;
  location: string;
  priority: string;
  status: string;
  source: string;
}

export interface DailyBriefingFlight {
  airline: string;
  flight: string;
  scheduledTime: string;
  flightStatus: string;
  delay: string | null;
  guests: number;
  guestName: string;
  direction: string;
}

export interface DailyBriefingStaffingDept {
  name: string;
  required: number;
  assigned: number | null;
  gap: number | null;
  status: string;
}

export interface DailyBriefingRevenue {
  yesterday: number;
  forecast: number;
  variance: number;
  yesterdayBreakdown: Array<{ label: string; amount: number }>;
  forecastBreakdown: Array<{ label: string; amount: number }>;
}

export interface DailyBriefingIssue {
  issue: string;
  department: string;
  priority: string;
}

export interface DailyBriefing {
  date: string;
  generatedAt: string;
  /** true when returned from ops_daily_briefings; false when computed live. */
  persisted: boolean;
  generatedBy: string | null;
  occupancy: DailyBriefingOccupancy;
  vipArrivals: DailyBriefingVipArrival[];
  groupArrivals: DailyBriefingGroupArrival[];
  events: DailyBriefingEvent[];
  maintenance: DailyBriefingMaintenance[];
  flights: DailyBriefingFlight[];
  staffing: { overall: number | null; departments: DailyBriefingStaffingDept[] };
  revenue: DailyBriefingRevenue;
  outstandingIssues: DailyBriefingIssue[];
}

export async function fetchDailyBriefing(propertyId?: string, date?: string): Promise<DailyBriefing> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (date) params.set('date', date);
  const qs = params.toString();
  return apiRequest<DailyBriefing>(`${API_BASE}/daily-briefing${qs ? `?${qs}` : ''}`);
}

export async function generateDailyBriefing(propertyId: string | undefined, date: string): Promise<DailyBriefing> {
  return apiRequest<DailyBriefing>(`${API_BASE}/daily-briefing/generate`, {
    method: 'POST',
    body: JSON.stringify({ propertyId, date }),
  });
}

// ── Morning Meeting ──────────────────────────────────────────────────────

export type AgendaItemStatus = 'pending' | 'in-progress' | 'completed';
export type AgendaItemPriority = 'low' | 'medium' | 'high';

export interface MorningMeetingAgendaItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: AgendaItemStatus;
  priority: AgendaItemPriority;
  assignedTo: string | null;
  estimatedTime: number | null;
  notes: string | null;
  sortOrder: number;
  source: 'template' | 'manual';
}

export interface MorningMeeting {
  date: string;
  generatedAt: string;
  previousDayPerformance: {
    occupancy: number;
    revenue: number;
    adr: number;
    /** 30-day trailing average guest rating, null when no feedback. */
    satisfaction: number | null;
  };
  todaysOccupancy: {
    expected: number;
    arrivals: number;
    departures: number;
    vipArrivals: number;
  };
  agendaItems: MorningMeetingAgendaItem[];
}

export async function fetchMorningMeeting(propertyId?: string, date?: string): Promise<MorningMeeting> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (date) params.set('date', date);
  const qs = params.toString();
  return apiRequest<MorningMeeting>(`${API_BASE}/morning-meeting${qs ? `?${qs}` : ''}`);
}

export interface NewAgendaItem {
  propertyId?: string;
  meetingDate: string;
  category?: string;
  title: string;
  description?: string;
  priority?: AgendaItemPriority;
  assignedTo?: string;
  estimatedTime?: number;
}

export async function createAgendaItem(item: NewAgendaItem): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`${API_BASE}/morning-meeting/items`, {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export async function updateAgendaItem(
  itemId: string,
  patch: Partial<Omit<NewAgendaItem, 'propertyId' | 'meetingDate'>> & {
    status?: AgendaItemStatus;
    notes?: string;
    sortOrder?: number;
  },
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    `${API_BASE}/morning-meeting/items/${encodeURIComponent(itemId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function deleteAgendaItem(itemId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    `${API_BASE}/morning-meeting/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  );
}

// ── Manager Approval Center ──────────────────────────────────────────────

export type ApprovalUrgency = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';
export type ApprovalDecision = 'approve' | 'reject' | 'escalate';

/** Aggregated approval request. `source` identifies the backing table. */
export interface OpsApprovalRequest {
  /** Composite id `${source}-${sourceId}` — unique across sources. */
  id: string;
  source: 'ops' | 'fin' | 'fj' | 'hr' | 'hrm' | 'ot' | 'uinv';
  /** Raw id in the source table. */
  sourceId: string;
  type: string;
  category: string;
  department: string;
  title: string;
  description: string;
  amount: number | null;
  requestedBy: string;
  requestedAt: string;
  urgency: ApprovalUrgency;
  status: ApprovalStatus;
  details: Record<string, any>;
  /** Whether the source model supports escalation. */
  canEscalate: boolean;
}

export interface OpsApprovalsOverview {
  generatedAt: string;
  requests: OpsApprovalRequest[];
  stats: { pending: number; critical: number; total: number };
}

export async function fetchOpsApprovals(propertyId?: string): Promise<OpsApprovalsOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<OpsApprovalsOverview>(`${API_BASE}/approvals${qs}`);
}

export async function decideApproval(
  source: string,
  sourceId: string,
  decision: ApprovalDecision,
  notes?: string,
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    `${API_BASE}/approvals/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}/decide`,
    { method: 'POST', body: JSON.stringify({ decision, notes }) },
  );
}

// ── Duty Manager Workspace ───────────────────────────────────────────────

export type DutyShift = 'Morning' | 'Afternoon' | 'Evening' | 'Night';

export interface DutyShiftLogEntry {
  id: string;
  timestamp: string;
  category: string;
  description: string;
  author: string;
  priority: 'low' | 'medium' | 'high';
}

export interface DutyGuestIssue {
  id: string;
  roomNumber: string | null;
  guestName: string | null;
  issue: string;
  type: string;
  status: 'open' | 'in-progress' | 'resolved';
  priority: 'low' | 'medium' | 'high';
  reportedAt: string;
  assignedTo?: string;
}

export interface DutyIncident {
  id: string;
  type: string;
  description: string;
  location: string | null;
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  status: 'open' | 'investigating' | 'resolved';
  reportedAt: string;
  reportedBy: string | null;
}

export interface DutyWalkthroughItem {
  id: string;
  area: string;
  item: string;
  status: 'pending' | 'completed' | 'issue';
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export interface DutyHandover {
  id: string;
  fromManager: string;
  toManager: string;
  shiftDate: string;
  shiftPeriod: string;
  summary: string;
  openItems: string[];
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface DutyManagerOverview {
  generatedAt: string;
  shift: DutyShift;
  date: string;
  shiftLogs: DutyShiftLogEntry[];
  guestIssues: DutyGuestIssue[];
  incidents: DutyIncident[];
  walkthrough: DutyWalkthroughItem[];
  handovers: DutyHandover[];
  stats: {
    openIssues: number;
    openIncidents: number;
    walkthroughDone: number;
    walkthroughTotal: number;
  };
}

export async function fetchDutyManager(
  propertyId: string | undefined,
  shift: DutyShift,
  date: string,
): Promise<DutyManagerOverview> {
  const qs = new URLSearchParams({ shift, date });
  if (propertyId) qs.set('propertyId', propertyId);
  return apiRequest<DutyManagerOverview>(`${API_BASE}/duty-manager?${qs}`);
}

export async function addShiftLogEntry(input: {
  propertyId?: string;
  shift: DutyShift;
  date?: string;
  category: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
}): Promise<{ ok: boolean; entry: DutyShiftLogEntry }> {
  return apiRequest(`${API_BASE}/duty-manager/log`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWalkthroughItem(
  id: string,
  status: 'pending' | 'completed' | 'issue',
  notes?: string,
): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/duty-manager/walkthrough/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, notes }),
  });
}

export async function createHandover(input: {
  propertyId?: string;
  date?: string;
  fromShift: DutyShift;
  toShift: DutyShift;
  toManager: string;
  summary?: string;
}): Promise<{ ok: boolean; handover: DutyHandover }> {
  return apiRequest(`${API_BASE}/duty-manager/handovers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function acknowledgeHandover(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/duty-manager/handovers/${encodeURIComponent(id)}/acknowledge`, {
    method: 'POST',
  });
}

// ── Cross-Department Task Center ─────────────────────────────────────────

export type CrossDeptTaskType =
  'vip-arrival' | 'wedding' | 'conference' | 'emergency' | 'maintenance' | 'renovation' | 'other';
export type CrossDeptTaskStatus = 'planning' | 'in-progress' | 'completed' | 'on-hold';
export type DeptAssignmentStatus = 'pending' | 'in-progress' | 'completed' | 'on-hold';

export interface DeptAssignment {
  department: string;
  status: DeptAssignmentStatus;
  lead?: string;
}

export interface CrossDeptTask {
  id: string;
  title: string;
  description: string;
  type: CrossDeptTaskType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: CrossDeptTaskStatus;
  departments: string[];
  assignedDepartments: DeptAssignment[];
  startDate: string | null;
  endDate: string | null;
  progress: number;
  sourceRef: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Live coordination opportunity detected from another portal. */
export interface CrossDeptSuggestion {
  sourceRef: string;
  title: string;
  description: string;
  type: CrossDeptTaskType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  suggestedDepartments: string[];
  startDate: string | null;
  endDate: string | null;
  /** Human-readable origin portal, e.g. 'Events portal'. */
  source: string;
}

export interface CrossDeptTasksOverview {
  generatedAt: string;
  tasks: CrossDeptTask[];
  suggestions: CrossDeptSuggestion[];
  stats: { total: number; inProgress: number; critical: number; suggested: number };
}

export async function fetchCrossDeptTasks(propertyId?: string): Promise<CrossDeptTasksOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<CrossDeptTasksOverview>(`${API_BASE}/cross-dept-tasks${qs}`);
}

export async function createCrossDeptTask(input: {
  propertyId?: string;
  title: string;
  description?: string;
  type: CrossDeptTaskType;
  priority?: string;
  departments: Array<string | DeptAssignment>;
  startDate?: string;
  endDate?: string;
}): Promise<{ ok: boolean; task: CrossDeptTask }> {
  return apiRequest(`${API_BASE}/cross-dept-tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function adoptCrossDeptSuggestion(
  propertyId: string | undefined,
  sourceRef: string,
): Promise<{ ok: boolean; task: CrossDeptTask }> {
  return apiRequest(`${API_BASE}/cross-dept-tasks/adopt`, {
    method: 'POST',
    body: JSON.stringify({ propertyId, sourceRef }),
  });
}

export async function updateCrossDeptTask(
  id: string,
  patch: {
    status?: CrossDeptTaskStatus;
    priority?: string;
    title?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    departmentUpdate?: { department: string; status: DeptAssignmentStatus; lead?: string };
  },
): Promise<{ ok: boolean; task: CrossDeptTask }> {
  return apiRequest(`${API_BASE}/cross-dept-tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCrossDeptTask(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/cross-dept-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Operational Calendar ─────────────────────────────────────────────────

export type CalendarEventType =
  'conference' | 'wedding' | 'holiday' | 'vip' | 'maintenance' | 'promotion' |
  'drill' | 'training' | 'audit' | 'event' | 'group' | 'task';

export interface OpsCalendarEvent {
  /** Composite id — `cal-*` rows are editable ops events. */
  id: string;
  /** Raw id in ops_calendar_events (editable rows only). */
  sourceId?: string;
  title: string;
  date: string;
  endDate?: string;
  type: CalendarEventType;
  location?: string;
  attendees?: number;
  description?: string;
  /** Human-readable origin portal, e.g. 'Events portal'. */
  source: string;
  editable: boolean;
}

export interface OpsCalendarOverview {
  generatedAt: string;
  from: string;
  to: string;
  events: OpsCalendarEvent[];
  stats: { total: number; byType: Record<string, number> };
}

export async function fetchOpsCalendar(
  propertyId: string | undefined,
  anchorDate: string,
): Promise<OpsCalendarOverview> {
  const qs = new URLSearchParams({ date: anchorDate });
  if (propertyId) qs.set('propertyId', propertyId);
  return apiRequest<OpsCalendarOverview>(`${API_BASE}/operational-calendar?${qs}`);
}

export async function createCalendarEvent(input: {
  propertyId?: string;
  title: string;
  date: string;
  endDate?: string;
  type?: CalendarEventType;
  location?: string;
  attendees?: number;
  description?: string;
}): Promise<{ ok: boolean; event: any }> {
  return apiRequest(`${API_BASE}/operational-calendar/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCalendarEvent(
  id: string,
  patch: Partial<{
    title: string; date: string; endDate: string; type: CalendarEventType;
    location: string; attendees: number; description: string;
  }>,
): Promise<{ ok: boolean; event: any }> {
  return apiRequest(`${API_BASE}/operational-calendar/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCalendarEvent(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/operational-calendar/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── VIP Guest Management ─────────────────────────────────────────────────

export type VipCategory =
  'VIP' | 'VVIP' | 'Loyalty Elite' | 'Corporate Executive' | 'Government Official' | 'Celebrity';
export type VipStayStatus = 'arrived' | 'expected' | 'departed';

export interface VipGuestRequest {
  id: string;
  type: string;
  description?: string;
  priority?: string;
  status?: string;
  submittedAt?: string;
}

export interface VipTransfer {
  id: string;
  service?: string;
  flightNumber?: string;
  airline?: string;
  scheduledTime?: string;
  status?: string;
  route?: string;
}

export interface VipSpaAppointment {
  id: string;
  treatment?: string;
  therapist?: string;
  date?: string;
  time?: string;
  status?: string;
}

export interface VipPrepTask {
  id: string;
  type?: string;
  location?: string;
  assignedTo?: string;
  status?: string;
  dueDate?: string;
}

export interface VipGuest {
  id: string;
  name: string;
  category: VipCategory;
  roomNumber?: string;
  reservationId?: string;
  checkInDate?: string;
  checkOutDate?: string;
  status: VipStayStatus;
  preferences: string[];
  specialRequests: string[];
  butlerAssigned?: string;
  notifications: boolean;
  email?: string;
  phone?: string;
  nationality?: string;
  loyaltyPoints: number;
  totalSpend: number;
  profileNotes?: string;
  openRequests: VipGuestRequest[];
  transfers: VipTransfer[];
  spaAppointments: VipSpaAppointment[];
  prepTasks: VipPrepTask[];
}

export interface VipGuestsOverview {
  generatedAt: string;
  guests: VipGuest[];
  stats: {
    total: number;
    arrived: number;
    expected: number;
    departed: number;
    openRequests: number;
  };
}

export async function fetchVipGuests(propertyId?: string): Promise<VipGuestsOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<VipGuestsOverview>(`${API_BASE}/vip-guests${qs}`);
}

export async function createVipGuest(input: {
  propertyId?: string;
  name: string;
  category?: VipCategory;
  email?: string;
  phone?: string;
  nationality?: string;
  butler?: string;
  specialRequests?: string;
  notes?: string;
}): Promise<{ ok: boolean; guestId: string }> {
  return apiRequest(`${API_BASE}/vip-guests`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateVipProfile(
  guestId: string,
  patch: Partial<{
    category: VipCategory; butler: string; notifications: boolean; notes: string; propertyId: string;
  }>,
): Promise<{ ok: boolean; profile: any }> {
  return apiRequest(`${API_BASE}/vip-guests/${encodeURIComponent(guestId)}/profile`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function createVipRequest(
  guestId: string,
  input: { propertyId?: string; type?: string; description: string; priority?: string; department?: string },
): Promise<{ ok: boolean; request: any }> {
  return apiRequest(`${API_BASE}/vip-guests/${encodeURIComponent(guestId)}/requests`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Guest Recovery ───────────────────────────────────────────────────────

export type RecoveryStatus =
  'logged' | 'investigating' | 'compensation-pending' | 'corrective-action' |
  'follow-up' | 'guest-confirmation' | 'closed';
export type RecoveryCategory =
  'Maintenance' | 'Housekeeping' | 'F&B' | 'Facilities' | 'Front Office' |
  'Security' | 'Spa' | 'Other';
export type RecoveryPriority = 'low' | 'medium' | 'high';

export interface RecoveryCase {
  id: string;
  guestName: string;
  roomNumber?: string;
  complaint: string;
  category: RecoveryCategory;
  status: RecoveryStatus;
  priority: RecoveryPriority;
  loggedAt: string;
  assignedTo?: string;
  compensationAmount?: number;
  correctiveAction?: string;
  followUpDate?: string;
  feedbackId?: string;
  workOrderId?: string;
  workOrder?: { id: string; title?: string; status?: string; assigned_to?: string };
  notes?: string;
  loggedBy?: string;
  closedAt?: string;
}

export interface RecoveryFeedbackItem {
  id: string;
  guestName: string;
  roomNumber?: string;
  rating?: number;
  category: RecoveryCategory;
  sourceCategory?: string;
  comments?: string;
  submittedAt?: string;
}

export interface GuestRecoveryOverview {
  generatedAt: string;
  cases: RecoveryCase[];
  feedbackQueue: RecoveryFeedbackItem[];
  stats: {
    total: number;
    open: number;
    compensationPending: number;
    compensationTotal: number;
    awaitingFeedbackTriage: number;
  };
}

export async function fetchGuestRecovery(propertyId?: string): Promise<GuestRecoveryOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<GuestRecoveryOverview>(`${API_BASE}/guest-recovery${qs}`);
}

export async function createRecoveryCase(input: {
  propertyId?: string;
  guestName: string;
  roomNumber?: string;
  complaint: string;
  category?: RecoveryCategory;
  priority?: RecoveryPriority;
  assignedTo?: string;
  feedbackId?: string;
}): Promise<{ ok: boolean; case: RecoveryCase }> {
  return apiRequest(`${API_BASE}/guest-recovery`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createRecoveryFromFeedback(
  feedbackId: string,
  propertyId?: string,
): Promise<{ ok: boolean; case: RecoveryCase }> {
  return apiRequest(`${API_BASE}/guest-recovery/from-feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedbackId, propertyId }),
  });
}

export async function updateRecoveryCase(
  id: string,
  patch: Partial<{
    status: RecoveryStatus; priority: RecoveryPriority; category: RecoveryCategory;
    assignedTo: string; compensationAmount: number; correctiveAction: string;
    followUpDate: string; notes: string;
  }>,
): Promise<{ ok: boolean; case: RecoveryCase }> {
  return apiRequest(`${API_BASE}/guest-recovery/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function createRecoveryWorkOrder(
  id: string,
  input?: { title?: string; description?: string; propertyId?: string },
): Promise<{ ok: boolean; workOrder: any }> {
  return apiRequest(`${API_BASE}/guest-recovery/${encodeURIComponent(id)}/work-order`, {
    method: 'POST',
    body: JSON.stringify(input || {}),
  });
}

export async function deleteRecoveryCase(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/guest-recovery/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Service Quality ──────────────────────────────────────────────────────

export type QualityPeriod = 'week' | 'month' | 'quarter';

export interface QualityMetric {
  id: string;
  name: string;
  category: string;
  unit: 'rating' | 'percent' | 'hours';
  lowerIsBetter?: boolean;
  currentScore: number | null;
  targetScore: number;
  trend: 'up' | 'down' | 'stable';
  sampleSize: number;
}

export interface QualityAudit {
  id: string;
  department: string;
  auditType: string;
  score: number | null;
  status?: string;
  date?: string;
  auditor?: string;
  findings: string[];
  title?: string;
  location?: string;
}

export interface ServiceQualityOverview {
  generatedAt: string;
  period: string;
  days: number;
  metrics: QualityMetric[];
  audits: QualityAudit[];
  stats: {
    metricsOnTarget: number;
    auditsCompleted: number;
    avgSatisfaction: number | null;
    feedbackCount: number;
  };
}

export async function fetchServiceQuality(
  propertyId?: string,
  period: QualityPeriod = 'month',
): Promise<ServiceQualityOverview> {
  const qs = new URLSearchParams({ period });
  if (propertyId) qs.set('propertyId', propertyId);
  return apiRequest<ServiceQualityOverview>(`${API_BASE}/service-quality?${qs}`);
}

export async function scheduleQualityAudit(input: {
  propertyId?: string;
  title: string;
  scope?: string;
  date?: string;
}): Promise<{ ok: boolean; audit: any }> {
  return apiRequest(`${API_BASE}/service-quality/audits`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Room Operations ──────────────────────────────────────────────────────

export type RoomBoardStatus =
  'occupied' | 'vacant' | 'dirty' | 'clean' | 'inspected' |
  'out-of-order' | 'out-of-service' | 'maintenance';

/** Canonical rooms.status vocabulary shared with FO/HK. */
export const ROOM_STATUS_OPTIONS = [
  'Occupied Clean', 'Occupied Dirty', 'Vacant Clean', 'Vacant Dirty',
  'Inspected', 'Out of Order', 'Out of Service', 'Maintenance',
] as const;

export interface RoomOpsItem {
  id: string;
  roomNumber: string;
  roomType?: string;
  floor: number;
  rawStatus: string;
  status: RoomBoardStatus;
  cleanliness?: 'clean' | 'dirty';
  rate?: number;
  features: string[];
  guestName?: string;
  reservationId?: string;
  checkOutDate?: string;
  hkTasks: { id: string; type?: string; status?: string; assignedTo?: string; priority?: string }[];
  workOrders: { id: string; title?: string; status?: string; priority?: string; assignedTo?: string }[];
  lastInspection?: { result: string; date: string; inspector?: string };
  openRequests: number;
  needsAttention: boolean;
}

export interface RoomOpsOverview {
  generatedAt: string;
  rooms: RoomOpsItem[];
  floors: number[];
  stats: {
    total: number;
    byStatus: Record<string, number>;
    occupied: number;
    ready: number;
    dirty: number;
    blocked: number;
    needsAttention: number;
  };
}

export async function fetchRoomOperations(propertyId?: string): Promise<RoomOpsOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<RoomOpsOverview>(`${API_BASE}/room-operations${qs}`);
}

export async function setRoomStatus(
  roomId: string,
  status: string,
): Promise<{ ok: boolean; room: any }> {
  return apiRequest(`${API_BASE}/room-operations/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function createRoomCleaningTask(
  roomId: string,
  input?: { propertyId?: string; type?: string; priority?: string; notes?: string },
): Promise<{ ok: boolean; task: any }> {
  return apiRequest(`${API_BASE}/room-operations/rooms/${encodeURIComponent(roomId)}/cleaning-task`, {
    method: 'POST',
    body: JSON.stringify(input || {}),
  });
}

export async function createRoomWorkOrder(
  roomId: string,
  input: { propertyId?: string; title: string; description?: string; priority?: string },
): Promise<{ ok: boolean; workOrder: any }> {
  return apiRequest(`${API_BASE}/room-operations/rooms/${encodeURIComponent(roomId)}/work-order`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Occupancy Forecast ───────────────────────────────────────────────────

export interface OccupancyDay {
  date: string;
  bookedRooms: number;
  transientRooms: number;
  groupRooms: number;
  occupancy: number;
  arrivals: number;
  departures: number;
  revenue: number;
  isToday: boolean;
  isPast: boolean;
}

export interface UpcomingGroup {
  id: string;
  name?: string;
  arrival?: string;
  departure?: string;
  rooms?: number;
  status?: string;
}

export interface OccupancyForecastOverview {
  generatedAt: string;
  days: number;
  totalRooms: number;
  sellableRooms: number;
  blockedRooms: number;
  avgRate: number;
  forecast: OccupancyDay[];
  today: OccupancyDay & {
    availableRooms: number;
    occupancyDelta: number;
    arrivalsDelta: number;
    departuresDelta: number;
    availableDelta: number;
  };
  upcomingGroups: UpcomingGroup[];
}

export async function fetchOccupancyForecast(
  propertyId?: string,
  days: 7 | 30 = 7,
): Promise<OccupancyForecastOverview> {
  const qs = new URLSearchParams({ days: String(days) });
  if (propertyId) qs.set('propertyId', propertyId);
  return apiRequest<OccupancyForecastOverview>(`${API_BASE}/occupancy-forecast?${qs}`);
}

// ── Event & Group Coordination ───────────────────────────────────────────

export type CoordEventType = 'conference' | 'wedding' | 'banquet' | 'group-checkin' | 'group-checkout' | 'event';
export type CoordEventStatus = 'planning' | 'setup' | 'in-progress' | 'completed';

export interface EventChecklistItem {
  id: string;
  name: string;
  category?: string;
  dueDate?: string;
  assignedTo?: string;
  completed: boolean;
}

export interface CoordinationEvent {
  id: string;
  name: string;
  type: CoordEventType;
  date: string;
  endDate?: string;
  location?: string;
  attendees: number;
  status: CoordEventStatus;
  rawStatus: string;
  departments: string[];
  coordinator: string;
  menuPackage?: string;
  revenue?: number;
  checklist: { total: number; done: number; items: EventChecklistItem[] };
  linkedTask: { id: string; status: string; progress?: number } | null;
  source: 'banquet' | 'group';
}

export interface EventCoordinationOverview {
  generatedAt: string;
  events: CoordinationEvent[];
  stats: {
    total: number;
    upcoming: number;
    inProgress: number;
    attendees: number;
    checklistDone: number;
    checklistTotal: number;
  };
}

export const BANQUET_EVENT_STATUSES = [
  'Inquiry', 'Tentative', 'Planning', 'Confirmed', 'InProgress', 'Completed', 'Cancelled',
] as const;

export async function fetchEventCoordination(propertyId?: string): Promise<EventCoordinationOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<EventCoordinationOverview>(`${API_BASE}/event-coordination${qs}`);
}

export async function createCoordinationEvent(input: {
  propertyId?: string;
  name: string;
  date: string;
  endDate?: string;
  eventType?: string;
  clientName?: string;
  coordinator?: string;
  attendees?: number;
  revenue?: number;
  notes?: string;
}): Promise<{ ok: boolean; event: any }> {
  return apiRequest(`${API_BASE}/event-coordination/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCoordinationEvent(
  id: string,
  patch: Partial<{ status: string; coordinator: string; attendees: number; notes: string }>,
): Promise<{ ok: boolean; event: any }> {
  return apiRequest(`${API_BASE}/event-coordination/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function createEventCoordinationTask(
  eventId: string,
  input?: { propertyId?: string; departments?: string[] },
): Promise<{ ok: boolean; task: any }> {
  return apiRequest(`${API_BASE}/event-coordination/events/${encodeURIComponent(eventId)}/coordination-task`, {
    method: 'POST',
    body: JSON.stringify(input || {}),
  });
}

export async function toggleChecklistItem(
  itemId: string,
  completed: boolean,
): Promise<{ ok: boolean; item: any }> {
  return apiRequest(`${API_BASE}/event-coordination/checklists/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ completed }),
  });
}

// ── Emergency Coordination ───────────────────────────────────────────────

export interface EmergencyResponseEntry {
  id: string;
  action: string;
  detail?: string;
  actor?: string;
  at: string;
}

export interface OpsEmergency {
  id: string;
  type: string;
  location: string;
  status: string;
  priority: string;
  description?: string;
  commander?: string;
  responseTeam?: string;
  evacuation?: string;
  occurredAt?: string;
  resolvedAt?: string;
  responses: EmergencyResponseEntry[];
}

export interface OpsCriticalIncident {
  id: string;
  type: string;
  location?: string;
  priority: string;
  status: string;
  reportedAt?: string;
  assignedTo?: string;
  reportedBy?: string;
  description?: string;
}

export interface EmergencyCoordinationOverview {
  generatedAt: string;
  emergencies: OpsEmergency[];
  criticalIncidents: OpsCriticalIncident[];
  stats: {
    active: number;
    critical: number;
    evacuationInProgress: number;
    resolvedToday: number;
    openCriticalIncidents: number;
  };
}

// Must match the sec_emergency_notifications CHECK constraints.
export const EMERGENCY_STATUS_OPTIONS = ['Active', 'In Progress', 'Scheduled', 'Resolved'] as const;
export const EMERGENCY_PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'] as const;
export const EVACUATION_OPTIONS = ['Not Required', 'Standby', 'In Progress', 'Complete'] as const;

export async function fetchOpsEmergencies(propertyId?: string): Promise<EmergencyCoordinationOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<EmergencyCoordinationOverview>(`${API_BASE}/emergency${qs}`);
}

export async function raiseEmergency(input: {
  propertyId?: string;
  emergencyType: string;
  location: string;
  priority?: string;
  status?: string;
  description?: string;
  commander?: string;
  responseTeam?: string;
  evacuation?: string;
}): Promise<{ ok: boolean; emergency: any }> {
  return apiRequest(`${API_BASE}/emergency`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateEmergency(
  id: string,
  patch: Partial<{ status: string; priority: string; location: string; description: string; commander: string; responseTeam: string; evacuation: string }>,
): Promise<{ ok: boolean; emergency: any }> {
  return apiRequest(`${API_BASE}/emergency/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function addEmergencyResponse(
  id: string,
  action: string,
  detail?: string,
): Promise<{ ok: boolean; response: any }> {
  return apiRequest(`${API_BASE}/emergency/${encodeURIComponent(id)}/responses`, {
    method: 'POST',
    body: JSON.stringify({ action, detail }),
  });
}

export async function escalateIncidentToEmergency(
  incidentId: string,
  propertyId?: string,
): Promise<{ ok: boolean; emergency: any }> {
  return apiRequest(`${API_BASE}/emergency/escalate-incident`, {
    method: 'POST',
    body: JSON.stringify({ incidentId, propertyId }),
  });
}

// ── Operational Communication Center ─────────────────────────────────────

export type CommSource = 'front-office' | 'housekeeping' | 'engineering' | 'security' | 'f&b' | 'system';
export type CommType = 'chat' | 'broadcast' | 'department';

export interface CommMessage {
  id: string;
  source: CommSource;
  type: CommType;
  from: string;
  to: string;
  subject?: string;
  content: string;
  channel?: string;
  priority?: string;
  sentAt?: string;
  read: boolean;
}

export interface CommunicationOverview {
  generatedAt: string;
  messages: CommMessage[];
  stats: {
    total: number;
    unread: number;
    broadcasts: number;
    today: number;
    sources: number;
  };
}

export async function fetchOpsCommunication(propertyId?: string): Promise<CommunicationOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<CommunicationOverview>(`${API_BASE}/communication${qs}`);
}

export async function sendOpsMessage(input: {
  propertyId?: string;
  type: 'broadcast' | 'department' | 'message';
  to?: string;
  subject?: string;
  content: string;
  priority?: string;
}): Promise<{ ok: boolean; message: any }> {
  return apiRequest(`${API_BASE}/communication`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function markCommRead(source: string, id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/communication/${encodeURIComponent(source)}/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
  });
}

// ── Escalation Center ────────────────────────────────────────────────────

export type EscalationType = 'sla-violation' | 'guest-complaint' | 'delayed-task' | 'equipment-failure' | 'staff-shortage' | 'high-risk-incident' | 'other';
export type EscalationSeverity = 'minor' | 'moderate' | 'major' | 'critical';
export type EscalationStatus = 'open' | 'acknowledged' | 'in-progress' | 'resolved';

export interface OpsEscalation {
  id: string;
  type: EscalationType;
  severity: EscalationSeverity;
  description: string;
  source?: string;
  source_ref?: string;
  escalated_to?: string;
  status: EscalationStatus;
  due_by?: string;
  acknowledged_at?: string;
  resolved_at?: string;
  resolution?: string;
  created_by?: string;
  created_at: string;
}

export interface EscalationCandidate {
  sourceRef: string;
  type: EscalationType;
  severity: EscalationSeverity;
  description: string;
  source: string;
  escalatedTo: string;
  ageHours: number;
  detectedAt?: string;
}

export interface EscalationOverview {
  generatedAt: string;
  escalations: OpsEscalation[];
  candidates: EscalationCandidate[];
  stats: {
    open: number;
    acknowledged: number;
    inProgress: number;
    resolved: number;
    detected: number;
    overdue: number;
  };
}

export async function fetchOpsEscalations(propertyId?: string): Promise<EscalationOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<EscalationOverview>(`${API_BASE}/escalations${qs}`);
}

export async function createEscalation(input: {
  propertyId?: string;
  type?: EscalationType;
  severity?: EscalationSeverity;
  description: string;
  source?: string;
  escalatedTo?: string;
  dueBy?: string;
}): Promise<{ ok: boolean; escalation: OpsEscalation }> {
  return apiRequest(`${API_BASE}/escalations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function adoptEscalation(candidate: EscalationCandidate & { propertyId?: string }): Promise<{ ok: boolean; escalation: OpsEscalation }> {
  return apiRequest(`${API_BASE}/escalations/adopt`, {
    method: 'POST',
    body: JSON.stringify(candidate),
  });
}

export async function updateEscalation(
  id: string,
  patch: Partial<{ status: EscalationStatus; severity: EscalationSeverity; escalatedTo: string; dueBy: string; resolution: string }>,
): Promise<{ ok: boolean; escalation: OpsEscalation }> {
  return apiRequest(`${API_BASE}/escalations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteEscalation(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/escalations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── SOP & Compliance Monitoring ──────────────────────────────────────────

export type SopStatus = 'compliant' | 'non-compliant' | 'pending-audit';
export type SopSource = 'security' | 'engineering' | 'risk' | 'f&b' | 'finance';

export interface SopComplianceItem {
  id: string;
  source: SopSource;
  department: string;
  category: string;
  name: string;
  status: SopStatus;
  score?: number;
  lastAudit?: string;
  nextAudit?: string;
  findings: string[];
}

export interface SopAuditRecord {
  id: string;
  source: string;
  title: string;
  auditor?: string;
  scope?: string;
  status?: string;
  result?: string;
  findings?: string;
  at?: string;
  score?: number;
}

export interface SopComplianceOverview {
  generatedAt: string;
  items: SopComplianceItem[];
  audits: SopAuditRecord[];
  stats: {
    total: number;
    compliant: number;
    nonCompliant: number;
    pendingAudit: number;
    score: number;
  };
}

export async function fetchSopCompliance(propertyId?: string): Promise<SopComplianceOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SopComplianceOverview>(`${API_BASE}/sop-compliance${qs}`);
}

export async function setComplianceStatus(
  source: string,
  id: string,
  status: SopStatus,
): Promise<{ ok: boolean; item: any; mappedStatus: string }> {
  return apiRequest(`${API_BASE}/sop-compliance/${encodeURIComponent(source)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function recordComplianceAudit(input: {
  propertyId?: string;
  title: string;
  scope?: string;
  result?: string;
  findings?: string;
  source?: string;
  itemId?: string;
}): Promise<{ ok: boolean; audit: any }> {
  return apiRequest(`${API_BASE}/sop-compliance/audit`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Executive Checklists ────────────────────────────────────────────────

export type ExecChecklistFrequency = 'daily' | 'weekly' | 'monthly';
export type ExecChecklistStatus = 'pending' | 'in-progress' | 'completed';

export interface ExecChecklistItem {
  id: string;
  title: string;
  frequency: ExecChecklistFrequency;
  category: string;
  status: ExecChecklistStatus;
  assignedTo?: string | null;
  dueBy?: string | null;
  lastCompleted?: string | null;
  completedBy?: string | null;
  notes?: string | null;
  context?: string | null;
}

export interface ExecChecklistsOverview {
  items: ExecChecklistItem[];
  stats: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
}

export async function fetchExecutiveChecklists(propertyId?: string): Promise<ExecChecklistsOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<ExecChecklistsOverview>(`${API_BASE}/executive-checklists${qs}`);
}

export async function createExecutiveChecklist(input: {
  title: string;
  frequency?: ExecChecklistFrequency;
  category?: string;
  assignedTo?: string;
  dueBy?: string;
  notes?: string;
  propertyId?: string;
}): Promise<{ ok: boolean; item: any }> {
  return apiRequest(`${API_BASE}/executive-checklists`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateExecutiveChecklist(
  id: string,
  input: {
    action?: 'start' | 'complete' | 'reset';
    title?: string;
    assignedTo?: string | null;
    dueBy?: string | null;
    notes?: string | null;
    frequency?: ExecChecklistFrequency;
    category?: string;
    active?: boolean;
  }
): Promise<{ ok: boolean; item: any }> {
  return apiRequest(`${API_BASE}/executive-checklists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteExecutiveChecklist(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/executive-checklists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Daily Flash Reports ─────────────────────────────────────────────────

export interface FlashReportMetric {
  label: string;
  value: string | number;
  tone?: 'good' | 'warn' | 'bad';
}

export interface FlashReportSection {
  label: string;
  metrics: FlashReportMetric[];
  highlights: string[];
}

export interface FlashReportPayload {
  generatedAt: string;
  periodDate: string;
  sections: Record<string, FlashReportSection>;
}

export interface FlashReportRow {
  id: string;
  name: string;
  type: string;
  periodDate: string;
  generatedAt: string;
  generatedBy?: string | null;
  status: 'ready' | 'generating' | 'failed';
}

export interface FlashReportsOverview {
  reports: FlashReportRow[];
  reportTypes: { key: string; name: string }[];
}

export async function fetchFlashReports(propertyId?: string): Promise<FlashReportsOverview> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<FlashReportsOverview>(`${API_BASE}/flash-reports${qs}`);
}

export async function fetchFlashReport(id: string): Promise<{ report: any }> {
  return apiRequest(`${API_BASE}/flash-reports/${encodeURIComponent(id)}`);
}

export async function generateFlashReport(input: {
  type: string;
  propertyId?: string;
}): Promise<{ ok: boolean; report: any }> {
  return apiRequest(`${API_BASE}/flash-reports`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteFlashReport(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/flash-reports/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Operations Reports (registry — mimics hk_reports pattern) ───────────

export type OpsReportCategory = 'operations' | 'guest' | 'approval' | 'executive';
export type OpsReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
export type OpsReportFormat = 'PDF' | 'Excel' | 'CSV';

export interface OpsReport {
  id: string;
  category: OpsReportCategory;
  name: string;
  description: string;
  last_run: string | null;
  status: OpsReportStatus;
  format: OpsReportFormat;
  frequency: string;
  summary: { label: string; value: number | string }[];
  updated_at?: string;
}

export interface OpsReportStats {
  total: number;
  ready: number;
  scheduled: number;
  failed: number;
  byCategory: Record<string, number>;
}

export async function fetchOpsReports(propertyId?: string, category?: string): Promise<OpsReport[]> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (category) params.set('category', category);
  const qs = params.toString() ? `?${params}` : '';
  return apiRequest<OpsReport[]>(`${API_BASE}/reports${qs}`);
}

export async function fetchOpsReportStats(propertyId?: string): Promise<OpsReportStats> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<OpsReportStats>(`${API_BASE}/reports/stats${qs}`);
}

export async function runOpsReport(id: string, propertyId?: string): Promise<OpsReport> {
  return apiRequest(`${API_BASE}/reports/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify({ propertyId }),
  });
}

export async function runAllOpsReports(propertyId?: string): Promise<{ refreshed: number; reports: OpsReport[] }> {
  return apiRequest(`${API_BASE}/reports/run-all`, {
    method: 'POST',
    body: JSON.stringify({ propertyId }),
  });
}

export async function updateOpsReport(
  id: string,
  input: { frequency?: string; format?: OpsReportFormat; status?: OpsReportStatus }
): Promise<OpsReport> {
  return apiRequest(`${API_BASE}/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ── Operations Configuration ────────────────────────────────────────────

export interface ApprovalLevel {
  id: string;
  name: string;
  level: number;
  spendingLimit: number;
  approvers: string[];
  requiresUnanimous: boolean;
  description?: string | null;
  status: string;
}

export interface OpsConfigSection {
  id: string;
  section: string;
  data: Record<string, any>;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface DeptConfigOverview {
  dept: string;
  table: string;
  sections: string[];
  count: number;
  lastUpdated?: string | null;
}

export interface OpsConfiguration {
  approvalLevels: ApprovalLevel[];
  opsConfig: OpsConfigSection[];
  globalSettings: Record<string, any>;
  deptConfigs: DeptConfigOverview[];
}

export async function fetchOpsConfiguration(propertyId?: string): Promise<OpsConfiguration> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<OpsConfiguration>(`${API_BASE}/configuration${qs}`);
}

export async function createApprovalLevel(input: {
  name: string;
  level?: number;
  spendingLimit?: number;
  approvers?: string[];
  requiresUnanimous?: boolean;
  description?: string;
  propertyId?: string;
}): Promise<{ ok: boolean; level: any }> {
  return apiRequest(`${API_BASE}/configuration/approval-levels`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateApprovalLevel(
  id: string,
  input: Partial<{
    name: string;
    level: number;
    spendingLimit: number;
    approvers: string[];
    requiresUnanimous: boolean;
    description: string | null;
    status: 'active' | 'inactive';
  }>
): Promise<{ ok: boolean; level: any }> {
  return apiRequest(`${API_BASE}/configuration/approval-levels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteApprovalLevel(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/configuration/approval-levels/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function saveOpsConfigSection(
  section: string,
  data: Record<string, any>,
  propertyId?: string
): Promise<{ ok: boolean; section: any }> {
  return apiRequest(`${API_BASE}/configuration/section/${encodeURIComponent(section)}`, {
    method: 'PUT',
    body: JSON.stringify({ data, propertyId }),
  });
}

export async function updateGlobalSettings(
  input: Record<string, any>
): Promise<{ ok: boolean; globalSettings: Record<string, any> }> {
  return apiRequest(`${API_BASE}/configuration/global`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ── Operations Executive Dashboard ──────────────────────────────────────

export interface OpsDashboardKpi {
  title: string;
  value: string | number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  caption?: string;
  money?: boolean;
}

export interface OpsDashboardAlert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  time: string | null;
  department: string;
  acknowledgeable?: string; // ops_escalations id — PATCH /escalations/:id status=acknowledged
}

export interface OpsDashboard {
  period: string;
  generatedAt: string;
  groups: {
    rooms: OpsDashboardKpi[];
    revenue: OpsDashboardKpi[];
    guest: OpsDashboardKpi[];
    operations: OpsDashboardKpi[];
  };
  roomStatusDist: { name: string; value: number; color: string }[];
  flow7d: { name: string; arrivals: number; departures: number; events: number }[];
  alerts: OpsDashboardAlert[];
}

export async function fetchOpsDashboard(period: 'today' | 'week' | 'month', propertyId?: string): Promise<OpsDashboard> {
  const qs = new URLSearchParams({ period });
  if (propertyId) qs.set('propertyId', propertyId);
  return apiRequest<OpsDashboard>(`${API_BASE}/dashboard?${qs}`);
}
