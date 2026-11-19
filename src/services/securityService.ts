/**
 * Security Portal service — backs /erp/security/soc and /erp/security/staff.
 * Mirrors the engineeringService.ts pattern: thin typed wrappers over
 * /api/sec-portal routes with bearer auth from localStorage.
 */

const API_BASE = '/api/sec-portal';

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

// ── Types ────────────────────────────────────────────────────────────────

export type SecPriority = 'Critical' | 'High' | 'Medium' | 'Low';
// Union of the SOC dispatch statuses and the full Incident Management lifecycle.
// Canonical lifecycle: Draft → Reported → Classified → Assigned → In Progress →
// Investigation → Corrective Action → Closed.
export type SecIncidentStatus =
  | 'Draft' | 'Reported' | 'Classified' | 'Assigned' | 'In Progress'
  | 'Investigation' | 'Corrective Action' | 'Closed'
  | 'Active' | 'Pending' | 'Resolved';
export type SecPatrolStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled';
export type SecCameraStatus = 'Online' | 'Offline' | 'Maintenance' | 'Recording' | 'Standby';
export type SecCameraHealth = 'Good' | 'Fair' | 'Poor';
export type SecCctvEventType =
  | 'Motion Detected' | 'Snapshot' | 'Playback Requested'
  | 'Recording Started' | 'Recording Stopped' | 'Status Change'
  | 'Maintenance' | 'Note';
export type SecAlarmStatus = 'Active' | 'Cleared' | 'Resolved';
export type SecAccessStatus = 'Normal' | 'Warning' | 'Flagged';
export type SecEmergencyStatus = 'Active' | 'In Progress' | 'Scheduled' | 'Resolved';
export type SecEvacuationStatus = 'Not Required' | 'Standby' | 'In Progress' | 'Complete';
export type SecEmergencyResponseAction =
  | 'Alert Raised' | 'Team Dispatched' | 'Commander Assigned'
  | 'Evacuation Ordered' | 'Evacuation Complete'
  | 'Status Update' | 'All Clear' | 'Resolved' | 'Note';
export type SecStaffStatus = 'On Duty' | 'On Break' | 'Off Duty';
export type SecShift = 'Day' | 'Evening' | 'Night';
export type SecRole =
  | 'Security Officer' | 'Security Supervisor' | 'Security Manager'
  | 'Patrol Officer' | 'CCTV Operator' | 'Access Control Specialist';
export type SecCaseStatus =
  | 'Open' | 'In Progress' | 'Evidence Collection'
  | 'Interviews' | 'Analysis' | 'Review' | 'Closed';
export type SecEvidenceType =
  | 'CCTV Footage' | 'Photo' | 'Document' | 'Statement'
  | 'Log' | 'Physical' | 'Digital' | 'Other';
export type SecCaseActivityType =
  | 'Case Opened' | 'Status Change' | 'Witness Added'
  | 'Evidence Added' | 'Note' | 'Case Closed';
export type SecVisitorType =
  | 'Contractor' | 'Vendor' | 'Interview Candidate' | 'Delivery Personnel'
  | 'Government Official' | 'VIP Visitor' | 'General Visitor';
export type SecVisitorStatus =
  | 'Pre-registered' | 'Checked In' | 'Checked Out' | 'Blacklisted' | 'Expired';
export type SecAccessType =
  | 'Employee Access' | 'Guest Access' | 'Contractor Access'
  | 'Temporary Access' | 'Emergency Access';
export type SecAccessGrantStatus =
  | 'Active' | 'Inactive' | 'Suspended' | 'Expired' | 'Revoked';
export type SecAccessSchedule = '24-7' | 'business' | 'dayshift' | 'nightshift' | 'custom';
export type SecKeyType =
  | 'Master Key' | 'Department Key' | 'Emergency Key' | 'Spare Key'
  | 'Guest Keycard' | 'Mobile Key' | 'Staff Card' | 'Contractor Card';
export type SecKeyStatus =
  | 'Issued' | 'Available' | 'Lost' | 'Damaged' | 'Inactive' | 'Decommissioned';
export type SecKeyLogAction =
  | 'Registered' | 'Issued' | 'Returned' | 'Reported Lost' | 'Reported Found'
  | 'Marked Damaged' | 'Decommissioned' | 'Audited' | 'Edited' | 'Note';

export interface SecIncident {
  id: string;
  property_id: string | null;
  incident_type: string;
  category: string | null;
  location: string;
  priority: SecPriority;
  status: SecIncidentStatus;
  reported_at: string;
  reported_by: string | null;
  assigned_to: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecPatrol {
  id: string;
  property_id: string | null;
  officer: string;
  route: string;
  status: SecPatrolStatus;
  progress: number;
  last_checkpoint: string | null;
  started_at: string | null;
  ended_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  shift: SecShift | null;
  checkpoint_total: number;
  checkpoint_done: number;
  notes: string | null;
  created_at: string;
}

export interface SecPatrolCheckpoint {
  id: string;
  patrol_id: string;
  name: string;
  location: string;
  order_no: number;
  scanned_at: string | null;
  scanned_by: string | null;
  created_at: string;
}

export interface SecPatrolDetail {
  patrol: SecPatrol;
  checkpoints: SecPatrolCheckpoint[];
}

export interface SecCamera {
  id: string;
  property_id: string | null;
  name: string;
  location: string;
  status: SecCameraStatus;
  recording: boolean;
  last_motion_at: string | null;
  ip_address: string | null;
  health: SecCameraHealth;
  retention_days: number;
  resolution: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecCctvEvent {
  id: string;
  camera_id: string;
  event_type: SecCctvEventType;
  detail: string | null;
  actor: string | null;
  created_at: string;
}

export interface SecCameraDetail {
  camera: SecCamera;
  events: SecCctvEvent[];
}

export interface SecAlarm {
  id: string;
  property_id: string | null;
  alarm_type: string;
  location: string;
  status: SecAlarmStatus;
  triggered_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  source?: string | null;
  external_id?: string | null;
  created_at: string;
}

export interface SecAccessEvent {
  id: string;
  property_id: string | null;
  event_type: string;
  user_name: string | null;
  location: string;
  occurred_at: string;
  status: SecAccessStatus;
  source?: string | null;
  external_id?: string | null;
  created_at: string;
}

export interface SecEmergency {
  id: string;
  property_id: string | null;
  emergency_type: string;
  location: string;
  status: SecEmergencyStatus;
  priority: SecPriority;
  description: string | null;
  commander: string | null;
  response_team: string | null;
  evacuation: SecEvacuationStatus;
  resolved_at: string | null;
  occurred_at: string;
  created_by: string | null;
  created_at: string;
}

export interface SecEmergencyResponse {
  id: string;
  emergency_id: string;
  action: SecEmergencyResponseAction;
  detail: string | null;
  actor: string | null;
  created_at: string;
}

export interface SecEmergencyDetail {
  emergency: SecEmergency;
  responses: SecEmergencyResponse[];
}

export interface SecStaff {
  id: string;
  property_id: string | null;
  name: string;
  avatar: string | null;
  role: SecRole;
  status: SecStaffStatus;
  is_active: boolean;
  location: string | null;
  shift: SecShift;
  radio_channel: string | null;
  phone: string | null;
  email: string | null;
  employee_id: string | null;
  hire_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecOverview {
  incidents: SecIncident[];
  patrols: SecPatrol[];
  cameras: SecCamera[];
  alarms: SecAlarm[];
  accessEvents: SecAccessEvent[];
  emergencies: SecEmergency[];
}

export interface SecInvestigation {
  id: string;
  property_id: string | null;
  title: string;
  incident_id: string | null;
  description: string | null;
  lead_investigator: string | null;
  priority: SecPriority;
  status: SecCaseStatus;
  target_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  witness_count?: number;
  evidence_count?: number;
}

export interface SecWitness {
  id: string;
  case_id: string;
  name: string;
  contact: string | null;
  statement: string | null;
  created_at: string;
}

export interface SecEvidence {
  id: string;
  case_id: string;
  item_type: SecEvidenceType;
  description: string;
  collected_by: string | null;
  collected_at: string;
  created_at: string;
}

export interface SecCaseActivity {
  id: string;
  case_id: string;
  activity_type: SecCaseActivityType;
  description: string;
  actor: string | null;
  created_at: string;
}

export interface SecInvestigationDetail {
  case: SecInvestigation;
  witnesses: SecWitness[];
  evidence: SecEvidence[];
  activities: SecCaseActivity[];
}

export interface SecVisitor {
  id: string;
  property_id: string | null;
  name: string;
  company: string | null;
  visitor_type: SecVisitorType;
  host: string | null;
  purpose: string | null;
  status: SecVisitorStatus;
  badge_number: string | null;
  phone: string | null;
  email: string | null;
  expected_arrival_at: string | null;
  expected_departure_at: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  blacklist_status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecAccessGrant {
  id: string;
  property_id: string | null;
  user_ref: string | null;
  user_name: string;
  access_type: SecAccessType;
  role: string | null;
  zones: string[];
  door_count: number;
  schedule: SecAccessSchedule;
  status: SecAccessGrantStatus;
  valid_from: string | null;
  valid_until: string | null;
  last_access_at: string | null;
  access_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecKey {
  id: string;
  property_id: string | null;
  key_type: SecKeyType;
  key_number: string;
  assigned_to: string | null;
  department: string | null;
  access_level: string | null;
  status: SecKeyStatus;
  issued_date: string | null;
  return_date: string | null;
  last_audit_date: string | null;
  location: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecKeyLog {
  id: string;
  key_id: string;
  action: SecKeyLogAction;
  detail: string | null;
  actor: string | null;
  created_at: string;
}

export interface SecKeyDetail {
  key: SecKey;
  logs: SecKeyLog[];
}

// ── SOC overview ─────────────────────────────────────────────────────────

export function fetchSocOverview(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecOverview>(`${API_BASE}/soc/overview${qs}`);
}

// ── Incidents ────────────────────────────────────────────────────────────

export function fetchSecIncidents(propertyId?: string | null, filters?: { status?: string; priority?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.priority) params.set('priority', filters.priority);
  const qs = params.toString();
  return apiRequest<SecIncident[]>(`${API_BASE}/soc/incidents${qs ? `?${qs}` : ''}`);
}

export function createSecIncident(body: {
  propertyId?: string | null;
  incidentType: string;
  category?: string | null;
  location: string;
  priority?: SecPriority;
  status?: SecIncidentStatus;
  reportedBy?: string | null;
  assignedTo?: string | null;
  description?: string | null;
}) {
  return apiRequest<SecIncident>(`${API_BASE}/soc/incidents`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecIncident(id: string, patch: Partial<{
  incidentType: string; category: string | null; location: string; priority: SecPriority;
  status: SecIncidentStatus; reportedBy: string | null; assignedTo: string | null;
  description: string | null;
}>) {
  return apiRequest<{ success: boolean; incident: SecIncident }>(`${API_BASE}/soc/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecIncident(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/soc/incidents/${id}`, { method: 'DELETE' });
}

// ── Patrols ──────────────────────────────────────────────────────────────

export function fetchSecPatrols(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecPatrol[]>(`${API_BASE}/soc/patrols${qs}`);
}

export function fetchSecPatrol(id: string) {
  return apiRequest<SecPatrolDetail>(`${API_BASE}/soc/patrols/${id}`);
}

export function createSecPatrol(body: {
  propertyId?: string | null;
  officer: string;
  route: string;
  status?: SecPatrolStatus;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  shift?: SecShift | null;
  notes?: string | null;
  checkpoints?: Array<{ name: string; location?: string }>;
}) {
  return apiRequest<SecPatrol>(`${API_BASE}/soc/patrols`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecPatrol(id: string, patch: Partial<{
  officer: string; route: string; status: SecPatrolStatus;
  progress: number; lastCheckpoint: string | null;
  scheduledStart: string | null; scheduledEnd: string | null;
  shift: SecShift | null; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; patrol: SecPatrol }>(`${API_BASE}/soc/patrols/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function scanSecPatrolCheckpoint(patrolId: string, checkpointId: string) {
  return apiRequest<{ success: boolean; patrol: SecPatrol; checkpoint: SecPatrolCheckpoint }>(
    `${API_BASE}/soc/patrols/${patrolId}/scan`, { method: 'POST', body: JSON.stringify({ checkpointId }) });
}

export function deleteSecPatrol(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/soc/patrols/${id}`, { method: 'DELETE' });
}

// ── CCTV ─────────────────────────────────────────────────────────────────

export function fetchSecCameras(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecCamera[]>(`${API_BASE}/soc/cctv${qs}`);
}

export function fetchSecCamera(id: string) {
  return apiRequest<SecCameraDetail>(`${API_BASE}/soc/cctv/${id}`);
}

export function createSecCamera(body: {
  propertyId?: string | null;
  name: string;
  location: string;
  status?: SecCameraStatus;
  recording?: boolean;
  ipAddress?: string | null;
  health?: SecCameraHealth;
  retentionDays?: number;
  resolution?: string;
  model?: string | null;
}) {
  return apiRequest<SecCamera>(`${API_BASE}/soc/cctv`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecCamera(id: string, patch: Partial<{
  name: string; location: string; status: SecCameraStatus; recording: boolean;
  ipAddress: string | null; health: SecCameraHealth; retentionDays: number;
  resolution: string; model: string | null; lastMotionAt: string | null;
}>) {
  return apiRequest<{ success: boolean; camera: SecCamera }>(`${API_BASE}/soc/cctv/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function addSecCameraEvent(cameraId: string, body: { eventType: SecCctvEventType; detail?: string | null }) {
  return apiRequest<SecCctvEvent>(`${API_BASE}/soc/cctv/${cameraId}/events`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecCamera(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/soc/cctv/${id}`, { method: 'DELETE' });
}

// ── Alarms ───────────────────────────────────────────────────────────────

export function fetchSecAlarms(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecAlarm[]>(`${API_BASE}/soc/alarms${qs}`);
}

export function createSecAlarm(body: { propertyId?: string | null; alarmType: string; location: string; status?: SecAlarmStatus }) {
  return apiRequest<SecAlarm>(`${API_BASE}/soc/alarms`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecAlarm(id: string, patch: Partial<{
  alarmType: string; location: string; status: SecAlarmStatus; acknowledged: boolean;
}>) {
  return apiRequest<{ success: boolean; alarm: SecAlarm }>(`${API_BASE}/soc/alarms/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecAlarm(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/soc/alarms/${id}`, { method: 'DELETE' });
}

// ── Access events ────────────────────────────────────────────────────────

export function fetchSecAccessEvents(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecAccessEvent[]>(`${API_BASE}/soc/access-events${qs}`);
}

export function createSecAccessEvent(body: { propertyId?: string | null; eventType: string; location: string; userName?: string | null; status?: SecAccessStatus }) {
  return apiRequest<SecAccessEvent>(`${API_BASE}/soc/access-events`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecAccessEvent(id: string, patch: Partial<{
  eventType: string; userName: string | null; location: string; status: SecAccessStatus;
}>) {
  return apiRequest<{ success: boolean; event: SecAccessEvent }>(`${API_BASE}/soc/access-events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecAccessEvent(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/soc/access-events/${id}`, { method: 'DELETE' });
}

// ── Emergency notifications ──────────────────────────────────────────────

export function fetchSecEmergencies(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecEmergency[]>(`${API_BASE}/soc/emergency${qs}`);
}

export function fetchSecEmergency(id: string) {
  return apiRequest<SecEmergencyDetail>(`${API_BASE}/soc/emergency/${id}`);
}

export function createSecEmergency(body: {
  propertyId?: string | null;
  emergencyType: string;
  location: string;
  status?: SecEmergencyStatus;
  priority?: SecPriority;
  description?: string | null;
  commander?: string | null;
  responseTeam?: string | null;
  evacuation?: SecEvacuationStatus;
}) {
  return apiRequest<SecEmergency>(`${API_BASE}/soc/emergency`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecEmergency(id: string, patch: Partial<{
  emergencyType: string; location: string; status: SecEmergencyStatus; priority: SecPriority;
  description: string | null; commander: string | null;
  responseTeam: string | null; evacuation: SecEvacuationStatus;
}>) {
  return apiRequest<{ success: boolean; emergency: SecEmergency }>(`${API_BASE}/soc/emergency/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function addSecEmergencyResponse(emergencyId: string, body: {
  action: SecEmergencyResponseAction; detail?: string | null;
}) {
  return apiRequest<SecEmergencyResponse>(`${API_BASE}/soc/emergency/${emergencyId}/responses`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecEmergency(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/soc/emergency/${id}`, { method: 'DELETE' });
}

// ── Staff ────────────────────────────────────────────────────────────────

export function fetchSecStaff(propertyId?: string | null, filters?: { role?: string; shift?: string; status?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.role) params.set('role', filters.role);
  if (filters?.shift) params.set('shift', filters.shift);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiRequest<SecStaff[]>(`${API_BASE}/staff${qs ? `?${qs}` : ''}`);
}

export function createSecStaff(body: {
  propertyId?: string | null;
  name: string;
  role?: SecRole;
  status?: SecStaffStatus;
  shift?: SecShift;
  location?: string | null;
  radioChannel?: string | null;
  phone?: string | null;
  email?: string | null;
  employeeId?: string | null;
  hireDate?: string | null;
}) {
  return apiRequest<SecStaff>(`${API_BASE}/staff`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecStaff(id: string, patch: Partial<{
  name: string; role: SecRole; status: SecStaffStatus; shift: SecShift;
  location: string | null; radioChannel: string | null;
  phone: string | null; email: string | null;
  employeeId: string | null; isActive: boolean;
}>) {
  return apiRequest<{ success: boolean; staff: SecStaff }>(`${API_BASE}/staff/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecStaff(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/staff/${id}`, { method: 'DELETE' });
}

// ── Investigations ───────────────────────────────────────────────────────

export function fetchSecInvestigations(propertyId?: string | null, filters?: { status?: string; priority?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.priority) params.set('priority', filters.priority);
  const qs = params.toString();
  return apiRequest<SecInvestigation[]>(`${API_BASE}/investigations${qs ? `?${qs}` : ''}`);
}

export function fetchSecInvestigation(id: string) {
  return apiRequest<SecInvestigationDetail>(`${API_BASE}/investigations/${id}`);
}

export function createSecInvestigation(body: {
  propertyId?: string | null;
  title: string;
  incidentId?: string | null;
  description?: string | null;
  leadInvestigator?: string | null;
  priority?: SecPriority;
  status?: SecCaseStatus;
  targetDate?: string | null;
}) {
  return apiRequest<SecInvestigation>(`${API_BASE}/investigations`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecInvestigation(id: string, patch: Partial<{
  title: string; incidentId: string | null; description: string | null;
  leadInvestigator: string | null; priority: SecPriority;
  status: SecCaseStatus; targetDate: string | null;
}>) {
  return apiRequest<{ success: boolean; case: SecInvestigation }>(`${API_BASE}/investigations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecInvestigation(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/investigations/${id}`, { method: 'DELETE' });
}

export function addSecWitness(caseId: string, body: { name: string; contact?: string | null; statement?: string | null }) {
  return apiRequest<SecWitness>(`${API_BASE}/investigations/${caseId}/witnesses`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecWitness(caseId: string, witnessId: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/investigations/${caseId}/witnesses/${witnessId}`, { method: 'DELETE' });
}

export function addSecEvidence(caseId: string, body: { itemType?: SecEvidenceType; description: string; collectedBy?: string | null }) {
  return apiRequest<SecEvidence>(`${API_BASE}/investigations/${caseId}/evidence`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecEvidence(caseId: string, evidenceId: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/investigations/${caseId}/evidence/${evidenceId}`, { method: 'DELETE' });
}

export function addSecCaseNote(caseId: string, note: string) {
  return apiRequest<SecCaseActivity>(`${API_BASE}/investigations/${caseId}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
}

// ── Visitors ─────────────────────────────────────────────────────────────

export function fetchSecVisitors(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecVisitor[]>(`${API_BASE}/visitors${qs ? `?${qs}` : ''}`);
}

export function createSecVisitor(body: {
  propertyId?: string | null;
  name: string;
  company?: string | null;
  visitorType?: SecVisitorType;
  host?: string | null;
  purpose?: string | null;
  phone?: string | null;
  email?: string | null;
  expectedArrivalAt?: string | null;
  expectedDepartureAt?: string | null;
}) {
  return apiRequest<SecVisitor>(`${API_BASE}/visitors`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecVisitor(id: string, patch: Partial<{
  name: string; company: string | null; visitorType: SecVisitorType;
  host: string | null; purpose: string | null; phone: string | null;
  email: string | null; status: SecVisitorStatus;
  expectedArrivalAt: string | null; expectedDepartureAt: string | null;
  blacklistStatus: string | null;
}>) {
  return apiRequest<{ success: boolean; visitor: SecVisitor }>(`${API_BASE}/visitors/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecVisitor(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/visitors/${id}`, { method: 'DELETE' });
}

// ── Access grants ────────────────────────────────────────────────────────

export function fetchSecAccessGrants(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecAccessGrant[]>(`${API_BASE}/access-grants${qs ? `?${qs}` : ''}`);
}

export function createSecAccessGrant(body: {
  propertyId?: string | null;
  userRef?: string | null;
  userName: string;
  accessType?: SecAccessType;
  role?: string | null;
  zones?: string[];
  doorCount?: number;
  schedule?: SecAccessSchedule;
  status?: SecAccessGrantStatus;
  validFrom?: string | null;
  validUntil?: string | null;
}) {
  return apiRequest<SecAccessGrant>(`${API_BASE}/access-grants`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecAccessGrant(id: string, patch: Partial<{
  userRef: string | null; userName: string; accessType: SecAccessType;
  role: string | null; zones: string[]; doorCount: number;
  schedule: SecAccessSchedule; status: SecAccessGrantStatus;
  validFrom: string | null; validUntil: string | null;
  lastAccessAt: string | null; accessCount: number;
}>) {
  return apiRequest<{ success: boolean; grant: SecAccessGrant }>(`${API_BASE}/access-grants/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecAccessGrant(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/access-grants/${id}`, { method: 'DELETE' });
}

// ── Keys & keycards ──────────────────────────────────────────────────────

export function fetchSecKeys(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecKey[]>(`${API_BASE}/keys${qs ? `?${qs}` : ''}`);
}

export function fetchSecKey(id: string) {
  return apiRequest<SecKeyDetail>(`${API_BASE}/keys/${id}`);
}

export function createSecKey(body: {
  propertyId?: string | null;
  keyType?: SecKeyType;
  keyNumber: string;
  assignedTo?: string | null;
  department?: string | null;
  accessLevel?: string | null;
  status?: SecKeyStatus;
  location?: string | null;
  returnDate?: string | null;
}) {
  return apiRequest<SecKey>(`${API_BASE}/keys`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecKey(id: string, patch: Partial<{
  keyType: SecKeyType; keyNumber: string; assignedTo: string | null;
  department: string | null; accessLevel: string | null;
  status: SecKeyStatus; location: string | null;
  returnDate: string | null; lastAuditDate: string | null;
  transitionNote: string;
}>) {
  return apiRequest<{ success: boolean; key: SecKey }>(`${API_BASE}/keys/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function reportSecKeyFound(id: string) {
  return apiRequest<{ success: boolean; key: SecKey }>(`${API_BASE}/keys/${id}/found`, { method: 'POST' });
}

export function deleteSecKey(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/keys/${id}`, { method: 'DELETE' });
}

// ── Lost & Found ─────────────────────────────────────────────────────────

export type SecLostFoundStatus =
  | 'Reported' | 'Found' | 'In Storage'
  | 'Claim Pending' | 'Returned' | 'Disposed';

export type SecLostFoundCategory =
  | 'Electronics' | 'Jewelry & Watches' | 'Documents' | 'Clothing'
  | 'Bag & Luggage' | 'Keys' | 'Personal Items' | 'Other';

export type SecCustodyAction =
  | 'Registered' | 'Item Found' | 'Placed in Storage'
  | 'Claim Submitted' | 'Claim Verified' | 'Released to Owner'
  | 'Disposed' | 'Transferred' | 'Edited' | 'Note';

export interface SecLostFoundCase {
  id: string;
  property_id: string | null;
  item_name: string;
  description: string | null;
  category: SecLostFoundCategory;
  status: SecLostFoundStatus;
  location_lost: string | null;
  location_found: string | null;
  storage_location: string | null;
  reported_by: string | null;
  reporter_contact: string | null;
  finder_name: string | null;
  claimed_by: string | null;
  claim_notes: string | null;
  estimated_value: number | null;
  reported_at: string;
  found_at: string | null;
  claimed_at: string | null;
  returned_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecCustodyEntry {
  id: string;
  case_id: string;
  action: SecCustodyAction;
  from_person: string | null;
  to_person: string | null;
  location: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
}

export interface SecLostFoundDetail {
  case: SecLostFoundCase;
  custody: SecCustodyEntry[];
}

export function fetchSecLostFound(propertyId?: string | null, filters?: { status?: string; category?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.category) params.set('category', filters.category);
  const qs = params.toString();
  return apiRequest<SecLostFoundCase[]>(`${API_BASE}/lostfound${qs ? `?${qs}` : ''}`);
}

export function fetchSecLostFoundCase(id: string) {
  return apiRequest<SecLostFoundDetail>(`${API_BASE}/lostfound/${id}`);
}

export function createSecLostFoundCase(body: {
  propertyId?: string | null;
  itemName: string;
  description?: string | null;
  category?: SecLostFoundCategory;
  status?: SecLostFoundStatus;
  locationLost?: string | null;
  locationFound?: string | null;
  storageLocation?: string | null;
  reportedBy?: string | null;
  reporterContact?: string | null;
  finderName?: string | null;
  estimatedValue?: number | null;
}) {
  return apiRequest<SecLostFoundCase>(`${API_BASE}/lostfound`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecLostFoundCase(id: string, patch: Partial<{
  itemName: string; description: string | null;
  category: SecLostFoundCategory; status: SecLostFoundStatus;
  locationLost: string | null; locationFound: string | null;
  storageLocation: string | null; reportedBy: string | null;
  reporterContact: string | null; finderName: string | null;
  claimedBy: string | null; claimNotes: string | null;
  estimatedValue: number | null; custodyNote: string;
}>) {
  return apiRequest<{ success: boolean; case: SecLostFoundCase }>(`${API_BASE}/lostfound/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function addSecCustodyEntry(caseId: string, body: {
  action: SecCustodyAction;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  note?: string | null;
}) {
  return apiRequest<SecCustodyEntry>(`${API_BASE}/lostfound/${caseId}/custody`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecLostFoundCase(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/lostfound/${id}`, { method: 'DELETE' });
}

// ── Fire & Life Safety ───────────────────────────────────────────────────

export type SecFireEquipmentType =
  | 'Fire Alarm Panel' | 'Smoke Detector' | 'Heat Detector' | 'Sprinkler'
  | 'Fire Extinguisher' | 'Exit Sign' | 'Emergency Light' | 'Pull Station'
  | 'Fire Door' | 'Fire Hose' | 'Fire Pump' | 'Other';

export type SecFireEquipmentStatus =
  | 'Operational' | 'Needs Service' | 'Out of Service' | 'Under Test';

export type SecFireActivityType = 'Inspection' | 'Alarm Test' | 'Drill' | 'Maintenance';
export type SecFireActivityStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Overdue' | 'Cancelled';
export type SecFireResult = 'Pass' | 'Pass with Notes' | 'Fail';

export interface SecFireEquipment {
  id: string;
  property_id: string | null;
  name: string;
  equipment_type: SecFireEquipmentType;
  location: string;
  zone: string | null;
  status: SecFireEquipmentStatus;
  serial_number: string | null;
  model: string | null;
  installed_date: string | null;
  last_inspection: string | null;
  next_due: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecFireActivity {
  id: string;
  property_id: string | null;
  equipment_id: string | null;
  activity_type: SecFireActivityType;
  title: string;
  scope: string | null;
  status: SecFireActivityStatus;
  result: SecFireResult | null;
  inspector: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  participants: number | null;
  evacuation_time_sec: number | null;
  findings: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sec_fire_equipment?: { name: string } | null;
}

export function fetchSecFireEquipment(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecFireEquipment[]>(`${API_BASE}/fire-equipment${qs ? `?${qs}` : ''}`);
}

export function createSecFireEquipment(body: {
  propertyId?: string | null;
  name: string;
  equipmentType?: SecFireEquipmentType;
  location: string;
  zone?: string | null;
  status?: SecFireEquipmentStatus;
  serialNumber?: string | null;
  model?: string | null;
  installedDate?: string | null;
  lastInspection?: string | null;
  nextDue?: string | null;
  notes?: string | null;
}) {
  return apiRequest<SecFireEquipment>(`${API_BASE}/fire-equipment`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecFireEquipment(id: string, patch: Partial<{
  name: string; equipmentType: SecFireEquipmentType; location: string;
  zone: string | null; status: SecFireEquipmentStatus;
  serialNumber: string | null; model: string | null;
  installedDate: string | null; lastInspection: string | null;
  nextDue: string | null; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; equipment: SecFireEquipment }>(`${API_BASE}/fire-equipment/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecFireEquipment(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/fire-equipment/${id}`, { method: 'DELETE' });
}

export function fetchSecFireActivities(propertyId?: string | null, filters?: { status?: string; type?: string; equipmentId?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.equipmentId) params.set('equipmentId', filters.equipmentId);
  const qs = params.toString();
  return apiRequest<SecFireActivity[]>(`${API_BASE}/fire-activities${qs ? `?${qs}` : ''}`);
}

export function createSecFireActivity(body: {
  propertyId?: string | null;
  equipmentId?: string | null;
  activityType: SecFireActivityType;
  title: string;
  scope?: string | null;
  status?: SecFireActivityStatus;
  inspector?: string | null;
  scheduledAt?: string | null;
  participants?: number | null;
  evacuationTimeSec?: number | null;
  findings?: string | null;
}) {
  return apiRequest<SecFireActivity>(`${API_BASE}/fire-activities`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecFireActivity(id: string, patch: Partial<{
  equipmentId: string | null; activityType: SecFireActivityType;
  title: string; scope: string | null; status: SecFireActivityStatus;
  result: SecFireResult | null; inspector: string | null;
  scheduledAt: string | null; participants: number | null;
  evacuationTimeSec: number | null; findings: string | null;
}>) {
  return apiRequest<{ success: boolean; activity: SecFireActivity }>(`${API_BASE}/fire-activities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecFireActivity(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/fire-activities/${id}`, { method: 'DELETE' });
}

// ── Risk Management ──────────────────────────────────────────────────────

export type SecRiskCategory =
  | 'Physical Security' | 'Safety' | 'Cyber' | 'Operational'
  | 'Financial' | 'Compliance' | 'Reputational';

export type SecRiskStatus = 'Open' | 'Assessed' | 'Mitigating' | 'Monitoring' | 'Closed';
export type SecRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type SecRiskActionType = 'Mitigation Action' | 'Review' | 'Status Change' | 'Note';

export interface SecRisk {
  id: string;
  property_id: string | null;
  title: string;
  description: string | null;
  category: SecRiskCategory;
  likelihood: number;
  impact: number;
  risk_score: number;
  risk_level: SecRiskLevel;
  status: SecRiskStatus;
  owner: string | null;
  mitigation_plan: string | null;
  next_review: string | null;
  identified_at: string;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecRiskAction {
  id: string;
  risk_id: string;
  action: SecRiskActionType;
  description: string;
  owner: string | null;
  due_date: string | null;
  done: boolean;
  completed_at: string | null;
  actor: string | null;
  created_at: string;
}

export interface SecRiskDetail {
  risk: SecRisk;
  actions: SecRiskAction[];
}

export function fetchSecRisks(propertyId?: string | null, filters?: { status?: string; level?: string; category?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.level) params.set('level', filters.level);
  if (filters?.category) params.set('category', filters.category);
  const qs = params.toString();
  return apiRequest<SecRisk[]>(`${API_BASE}/risks${qs ? `?${qs}` : ''}`);
}

export function fetchSecRisk(id: string) {
  return apiRequest<SecRiskDetail>(`${API_BASE}/risks/${id}`);
}

export function createSecRisk(body: {
  propertyId?: string | null;
  title: string;
  description?: string | null;
  category?: SecRiskCategory;
  likelihood?: number;
  impact?: number;
  status?: SecRiskStatus;
  owner?: string | null;
  mitigationPlan?: string | null;
  nextReview?: string | null;
}) {
  return apiRequest<SecRisk>(`${API_BASE}/risks`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecRisk(id: string, patch: Partial<{
  title: string; description: string | null; category: SecRiskCategory;
  likelihood: number; impact: number; status: SecRiskStatus;
  owner: string | null; mitigationPlan: string | null; nextReview: string | null;
}>) {
  return apiRequest<{ success: boolean; risk: SecRisk }>(`${API_BASE}/risks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function addSecRiskAction(riskId: string, body: {
  action?: SecRiskActionType;
  description: string;
  owner?: string | null;
  dueDate?: string | null;
}) {
  return apiRequest<SecRiskAction>(`${API_BASE}/risks/${riskId}/actions`, { method: 'POST', body: JSON.stringify(body) });
}

export function toggleSecRiskAction(riskId: string, actionId: string, done: boolean) {
  return apiRequest<{ success: boolean; action: SecRiskAction }>(
    `${API_BASE}/risks/${riskId}/actions/${actionId}`, { method: 'PATCH', body: JSON.stringify({ done }) });
}

export function deleteSecRisk(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/risks/${id}`, { method: 'DELETE' });
}

// ── Business Continuity ──────────────────────────────────────────────────

export type SecBcpPlanType =
  | 'Disaster Recovery' | 'Business Continuity' | 'Emergency Response'
  | 'IT Recovery' | 'Utility Outage' | 'Pandemic Response' | 'Other';

export type SecBcpPlanStatus = 'Draft' | 'Active' | 'Under Review' | 'Archived';
export type SecBcpExerciseType = 'Tabletop' | 'Simulation' | 'Full Test' | 'Review';
export type SecBcpExerciseStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled';
export type SecBcpExerciseResult = 'Pass' | 'Issues Found' | 'Fail';

export interface SecBcpPlan {
  id: string;
  property_id: string | null;
  title: string;
  plan_type: SecBcpPlanType;
  criticality: SecPriority;
  status: SecBcpPlanStatus;
  owner: string | null;
  scope: string | null;
  activation_trigger: string | null;
  recovery_steps: string | null;
  rto_hours: number | null;
  rpo_hours: number | null;
  version: string;
  last_tested: string | null;
  next_test_due: string | null;
  review_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecBcpExercise {
  id: string;
  property_id: string | null;
  plan_id: string;
  exercise_type: SecBcpExerciseType;
  title: string;
  status: SecBcpExerciseStatus;
  result: SecBcpExerciseResult | null;
  conducted_by: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  participants: number | null;
  findings: string | null;
  created_by: string | null;
  created_at: string;
  sec_bcp_plans?: { title: string } | null;
}

export interface SecBcpPlanDetail {
  plan: SecBcpPlan;
  exercises: SecBcpExercise[];
}

export function fetchSecBcpPlans(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecBcpPlan[]>(`${API_BASE}/bcp/plans${qs ? `?${qs}` : ''}`);
}

export function fetchSecBcpPlan(id: string) {
  return apiRequest<SecBcpPlanDetail>(`${API_BASE}/bcp/plans/${id}`);
}

export function createSecBcpPlan(body: {
  propertyId?: string | null;
  title: string;
  planType?: SecBcpPlanType;
  criticality?: SecPriority;
  status?: SecBcpPlanStatus;
  owner?: string | null;
  scope?: string | null;
  activationTrigger?: string | null;
  recoverySteps?: string | null;
  rtoHours?: number | null;
  rpoHours?: number | null;
  version?: string;
  nextTestDue?: string | null;
  reviewDate?: string | null;
}) {
  return apiRequest<SecBcpPlan>(`${API_BASE}/bcp/plans`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecBcpPlan(id: string, patch: Partial<{
  title: string; planType: SecBcpPlanType; criticality: SecPriority;
  status: SecBcpPlanStatus; owner: string | null;
  scope: string | null; activationTrigger: string | null; recoverySteps: string | null;
  rtoHours: number | null; rpoHours: number | null; version: string;
  lastTested: string | null; nextTestDue: string | null; reviewDate: string | null;
}>) {
  return apiRequest<{ success: boolean; plan: SecBcpPlan }>(`${API_BASE}/bcp/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecBcpPlan(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/bcp/plans/${id}`, { method: 'DELETE' });
}

export function fetchSecBcpExercises(propertyId?: string | null, filters?: { status?: string; planId?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.planId) params.set('planId', filters.planId);
  const qs = params.toString();
  return apiRequest<SecBcpExercise[]>(`${API_BASE}/bcp/exercises${qs ? `?${qs}` : ''}`);
}

export function createSecBcpExercise(planId: string, body: {
  propertyId?: string | null;
  exerciseType: SecBcpExerciseType;
  title: string;
  conductedBy?: string | null;
  scheduledAt?: string | null;
  findings?: string | null;
}) {
  return apiRequest<SecBcpExercise>(`${API_BASE}/bcp/plans/${planId}/exercises`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecBcpExercise(id: string, patch: Partial<{
  exerciseType: SecBcpExerciseType; title: string; status: SecBcpExerciseStatus;
  result: SecBcpExerciseResult | null; conductedBy: string | null;
  scheduledAt: string | null; participants: number | null; findings: string | null;
}>) {
  return apiRequest<{ success: boolean; exercise: SecBcpExercise }>(`${API_BASE}/bcp/exercises/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecBcpExercise(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/bcp/exercises/${id}`, { method: 'DELETE' });
}

// ── Crisis Management ────────────────────────────────────────────────────

export type SecCrisisType =
  | 'Security Threat' | 'Natural Disaster' | 'Public Health' | 'Media & PR'
  | 'Cyber Incident' | 'Utility Failure' | 'Structural' | 'Civil Unrest' | 'Other';

export type SecCrisisStatus = 'Monitoring' | 'Active' | 'Stabilizing' | 'Resolved' | 'Debrief';

export type SecCrisisUpdateType =
  | 'Crisis Declared' | 'Team Mobilized' | 'Status Update' | 'Communication'
  | 'Decision' | 'Escalation' | 'BCP Activated' | 'Resolved' | 'Note';

export interface SecCrisis {
  id: string;
  property_id: string | null;
  title: string;
  crisis_type: SecCrisisType;
  severity: SecPriority;
  status: SecCrisisStatus;
  location: string | null;
  crisis_lead: string | null;
  comms_channel: string | null;
  summary: string | null;
  incident_id: string | null;
  bcp_plan_id: string | null;
  activated_at: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sec_bcp_plans?: { title: string } | null;
  sec_incidents?: { description: string } | null;
}

export interface SecCrisisUpdate {
  id: string;
  crisis_id: string;
  update_type: SecCrisisUpdateType;
  message: string;
  actor: string | null;
  created_at: string;
}

export interface SecCrisisDetail {
  crisis: SecCrisis;
  updates: SecCrisisUpdate[];
}

export function fetchSecCrises(propertyId?: string | null, filters?: { status?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.severity) params.set('severity', filters.severity);
  const qs = params.toString();
  return apiRequest<SecCrisis[]>(`${API_BASE}/crises${qs ? `?${qs}` : ''}`);
}

export function fetchSecCrisis(id: string) {
  return apiRequest<SecCrisisDetail>(`${API_BASE}/crises/${id}`);
}

export function createSecCrisis(body: {
  propertyId?: string | null;
  title: string;
  crisisType?: SecCrisisType;
  severity?: SecPriority;
  status?: SecCrisisStatus;
  location?: string | null;
  crisisLead?: string | null;
  commsChannel?: string | null;
  summary?: string | null;
  incidentId?: string | null;
  bcpPlanId?: string | null;
}) {
  return apiRequest<SecCrisis>(`${API_BASE}/crises`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecCrisis(id: string, patch: Partial<{
  title: string; crisisType: SecCrisisType; severity: SecPriority;
  status: SecCrisisStatus; location: string | null; crisisLead: string | null;
  commsChannel: string | null; summary: string | null;
  incidentId: string | null; bcpPlanId: string | null;
}>) {
  return apiRequest<{ success: boolean; crisis: SecCrisis }>(`${API_BASE}/crises/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function addSecCrisisUpdate(crisisId: string, body: { updateType?: SecCrisisUpdateType; message: string }) {
  return apiRequest<SecCrisisUpdate>(`${API_BASE}/crises/${crisisId}/updates`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecCrisis(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/crises/${id}`, { method: 'DELETE' });
}

// ── Health & Safety Coordination ─────────────────────────────────────────

export type SecInspectionType =
  | 'Routine' | 'Fire Safety' | 'Pool Safety' | 'Kitchen Hygiene'
  | 'Workplace' | 'Compliance' | 'Other';

export type SecInspectionStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled';
export type SecInspectionResult = 'Pass' | 'Pass with Notes' | 'Fail';

export type SecHazardType =
  | 'Slip-Trip-Fall' | 'Electrical' | 'Chemical' | 'Fire'
  | 'Structural' | 'Ergonomic' | 'Biological' | 'Other';

export type SecHazardStatus = 'Reported' | 'Assessed' | 'Corrective Action' | 'Resolved' | 'Closed';

export interface SecSafetyInspection {
  id: string;
  property_id: string | null;
  title: string;
  inspection_type: SecInspectionType;
  area: string | null;
  inspector: string | null;
  status: SecInspectionStatus;
  result: SecInspectionResult | null;
  findings: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecSafetyHazard {
  id: string;
  property_id: string | null;
  title: string;
  hazard_type: SecHazardType;
  severity: SecPriority;
  status: SecHazardStatus;
  location: string | null;
  description: string | null;
  corrective_action: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  inspection_id: string | null;
  identified_at: string;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sec_safety_inspections?: { title: string } | null;
}

export function fetchSecSafetyInspections(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecSafetyInspection[]>(`${API_BASE}/safety-inspections${qs ? `?${qs}` : ''}`);
}

export function createSecSafetyInspection(body: {
  propertyId?: string | null;
  title: string;
  inspectionType?: SecInspectionType;
  area?: string | null;
  inspector?: string | null;
  scheduledAt?: string | null;
  findings?: string | null;
}) {
  return apiRequest<SecSafetyInspection>(`${API_BASE}/safety-inspections`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecSafetyInspection(id: string, patch: Partial<{
  title: string; inspectionType: SecInspectionType; area: string | null;
  inspector: string | null; status: SecInspectionStatus;
  result: SecInspectionResult | null; findings: string | null;
  scheduledAt: string | null;
}>) {
  return apiRequest<{ success: boolean; inspection: SecSafetyInspection }>(`${API_BASE}/safety-inspections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecSafetyInspection(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/safety-inspections/${id}`, { method: 'DELETE' });
}

export function fetchSecSafetyHazards(propertyId?: string | null, filters?: { status?: string; severity?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.severity) params.set('severity', filters.severity);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecSafetyHazard[]>(`${API_BASE}/safety-hazards${qs ? `?${qs}` : ''}`);
}

export function createSecSafetyHazard(body: {
  propertyId?: string | null;
  title: string;
  hazardType?: SecHazardType;
  severity?: SecPriority;
  location?: string | null;
  description?: string | null;
  correctiveAction?: string | null;
  reportedBy?: string | null;
  assignedTo?: string | null;
  inspectionId?: string | null;
}) {
  return apiRequest<SecSafetyHazard>(`${API_BASE}/safety-hazards`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecSafetyHazard(id: string, patch: Partial<{
  title: string; hazardType: SecHazardType; severity: SecPriority;
  status: SecHazardStatus; location: string | null; description: string | null;
  correctiveAction: string | null; reportedBy: string | null;
  assignedTo: string | null; inspectionId: string | null;
}>) {
  return apiRequest<{ success: boolean; hazard: SecSafetyHazard }>(`${API_BASE}/safety-hazards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecSafetyHazard(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/safety-hazards/${id}`, { method: 'DELETE' });
}

// ── Compliance Management ────────────────────────────────────────────────

export type SecComplianceCategory =
  | 'License' | 'Certification' | 'Permit' | 'Regulatory'
  | 'Policy' | 'Training' | 'Insurance' | 'Other';

export type SecComplianceStatus =
  | 'Compliant' | 'Pending' | 'Expiring Soon' | 'Expired' | 'Non-Compliant';

export type SecAuditType = 'Internal' | 'External' | 'Regulatory' | 'Insurance';
export type SecAuditStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled';
export type SecAuditResult = 'Pass' | 'Pass with Findings' | 'Fail';

export interface SecComplianceItem {
  id: string;
  property_id: string | null;
  title: string;
  category: SecComplianceCategory;
  authority: string | null;
  reference_no: string | null;
  status: SecComplianceStatus;
  issue_date: string | null;
  expiry_date: string | null;
  last_audit: string | null;
  responsible: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecComplianceAudit {
  id: string;
  property_id: string | null;
  title: string;
  audit_type: SecAuditType;
  auditor: string | null;
  scope: string | null;
  status: SecAuditStatus;
  result: SecAuditResult | null;
  findings: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export function fetchSecComplianceItems(propertyId?: string | null, filters?: { status?: string; category?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.category) params.set('category', filters.category);
  const qs = params.toString();
  return apiRequest<SecComplianceItem[]>(`${API_BASE}/compliance-items${qs ? `?${qs}` : ''}`);
}

export function createSecComplianceItem(body: {
  propertyId?: string | null;
  title: string;
  category?: SecComplianceCategory;
  authority?: string | null;
  referenceNo?: string | null;
  status?: SecComplianceStatus;
  issueDate?: string | null;
  expiryDate?: string | null;
  lastAudit?: string | null;
  responsible?: string | null;
  notes?: string | null;
}) {
  return apiRequest<SecComplianceItem>(`${API_BASE}/compliance-items`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecComplianceItem(id: string, patch: Partial<{
  title: string; category: SecComplianceCategory; authority: string | null;
  referenceNo: string | null; status: SecComplianceStatus;
  issueDate: string | null; expiryDate: string | null; lastAudit: string | null;
  responsible: string | null; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; item: SecComplianceItem }>(`${API_BASE}/compliance-items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecComplianceItem(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/compliance-items/${id}`, { method: 'DELETE' });
}

export function fetchSecComplianceAudits(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecComplianceAudit[]>(`${API_BASE}/compliance-audits${qs ? `?${qs}` : ''}`);
}

export function createSecComplianceAudit(body: {
  propertyId?: string | null;
  title: string;
  auditType?: SecAuditType;
  auditor?: string | null;
  scope?: string | null;
  scheduledAt?: string | null;
  findings?: string | null;
}) {
  return apiRequest<SecComplianceAudit>(`${API_BASE}/compliance-audits`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecComplianceAudit(id: string, patch: Partial<{
  title: string; auditType: SecAuditType; auditor: string | null;
  scope: string | null; status: SecAuditStatus; result: SecAuditResult | null;
  findings: string | null; scheduledAt: string | null;
}>) {
  return apiRequest<{ success: boolean; audit: SecComplianceAudit }>(`${API_BASE}/compliance-audits/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecComplianceAudit(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/compliance-audits/${id}`, { method: 'DELETE' });
}

// ── Asset Protection ─────────────────────────────────────────────────────

export type SecAssetType =
  | 'Artwork' | 'Cash & Valuables' | 'Electronics' | 'Vehicle'
  | 'Equipment' | 'Documents' | 'Furniture' | 'Other';

export type SecAssetStatus = 'Secured' | 'In Transit' | 'Under Review' | 'Missing' | 'Compromised';
export type SecAssetLevel = 'Maximum' | 'High' | 'Standard';
export type SecAssetLogAction =
  | 'Registered' | 'Check Performed' | 'Moved' | 'Status Change'
  | 'Security Review' | 'Alarm Test' | 'Note';

export interface SecAsset {
  id: string;
  property_id: string | null;
  name: string;
  asset_type: SecAssetType;
  location: string | null;
  estimated_value: number | null;
  serial_no: string | null;
  custodian: string | null;
  security_level: SecAssetLevel;
  status: SecAssetStatus;
  protection_measures: string | null;
  last_check: string | null;
  next_check_due: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecAssetLog {
  id: string;
  asset_id: string;
  action: SecAssetLogAction;
  detail: string | null;
  location: string | null;
  actor: string | null;
  created_at: string;
}

export interface SecAssetDetail {
  asset: SecAsset;
  logs: SecAssetLog[];
}

export function fetchSecAssets(propertyId?: string | null, filters?: { status?: string; type?: string; level?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.level) params.set('level', filters.level);
  const qs = params.toString();
  return apiRequest<SecAsset[]>(`${API_BASE}/assets${qs ? `?${qs}` : ''}`);
}

export function fetchSecAsset(id: string) {
  return apiRequest<SecAssetDetail>(`${API_BASE}/assets/${id}`);
}

export function createSecAsset(body: {
  propertyId?: string | null;
  name: string;
  assetType?: SecAssetType;
  location?: string | null;
  estimatedValue?: number | null;
  serialNo?: string | null;
  custodian?: string | null;
  securityLevel?: SecAssetLevel;
  status?: SecAssetStatus;
  protectionMeasures?: string | null;
  nextCheckDue?: string | null;
  notes?: string | null;
}) {
  return apiRequest<SecAsset>(`${API_BASE}/assets`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecAsset(id: string, patch: Partial<{
  name: string; assetType: SecAssetType; location: string | null;
  estimatedValue: number | null; serialNo: string | null;
  custodian: string | null; securityLevel: SecAssetLevel;
  status: SecAssetStatus; protectionMeasures: string | null;
  nextCheckDue: string | null; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; asset: SecAsset }>(`${API_BASE}/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function checkSecAsset(id: string, detail?: string) {
  return apiRequest<{ success: boolean; asset: SecAsset }>(`${API_BASE}/assets/${id}/check`, { method: 'POST', body: JSON.stringify({ detail }) });
}

export function addSecAssetLog(assetId: string, body: { action: SecAssetLogAction; detail?: string; location?: string }) {
  return apiRequest<SecAssetLog>(`${API_BASE}/assets/${assetId}/logs`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecAsset(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/assets/${id}`, { method: 'DELETE' });
}

// ── Fraud Prevention ─────────────────────────────────────────────────────

export type SecFraudType =
  | 'Payment Fraud' | 'Internal Theft' | 'Expense Fraud' | 'Identity Fraud'
  | 'Refund Fraud' | 'Card Fraud' | 'Vendor Fraud' | 'Other';

export type SecFraudStatus =
  | 'Flagged' | 'Under Review' | 'Investigating'
  | 'Substantiated' | 'Unfounded' | 'Closed';

export type SecFraudSource = 'System Alert' | 'Manual Report' | 'Audit Finding' | 'External';

export type SecFraudAlertType =
  | 'Large Transaction' | 'Unusual Refund' | 'Velocity Anomaly'
  | 'Card Mismatch' | 'Duplicate Charge' | 'After-Hours Access'
  | 'Discount Abuse' | 'Other';

export type SecFraudAlertStatus = 'New' | 'Reviewed' | 'Escalated' | 'Dismissed';

export interface SecFraudCase {
  id: string;
  property_id: string | null;
  title: string;
  fraud_type: SecFraudType;
  amount: number | null;
  severity: SecPriority;
  status: SecFraudStatus;
  source: SecFraudSource;
  description: string | null;
  assigned_to: string | null;
  investigation_id: string | null;
  resolution: string | null;
  reported_at: string;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sec_investigations?: { id: string; title: string } | null;
}

export interface SecFraudAlert {
  id: string;
  property_id: string | null;
  alert_type: SecFraudAlertType;
  title: string;
  description: string | null;
  amount: number | null;
  source: string | null;
  severity: SecPriority;
  status: SecFraudAlertStatus;
  case_id: string | null;
  created_at: string;
  sec_fraud_cases?: { id: string; title: string } | null;
}

export function fetchSecFraudCases(propertyId?: string | null, filters?: { status?: string; type?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.severity) params.set('severity', filters.severity);
  const qs = params.toString();
  return apiRequest<SecFraudCase[]>(`${API_BASE}/fraud-cases${qs ? `?${qs}` : ''}`);
}

export function createSecFraudCase(body: {
  propertyId?: string | null;
  title: string;
  fraudType?: SecFraudType;
  amount?: number | null;
  severity?: SecPriority;
  status?: SecFraudStatus;
  source?: SecFraudSource;
  description?: string | null;
  assignedTo?: string | null;
  investigationId?: string | null;
}) {
  return apiRequest<SecFraudCase>(`${API_BASE}/fraud-cases`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecFraudCase(id: string, patch: Partial<{
  title: string; fraudType: SecFraudType; amount: number | null;
  severity: SecPriority; status: SecFraudStatus; source: SecFraudSource;
  description: string | null; assignedTo: string | null;
  investigationId: string | null; resolution: string | null;
}>) {
  return apiRequest<{ success: boolean; case: SecFraudCase }>(`${API_BASE}/fraud-cases/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecFraudCase(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/fraud-cases/${id}`, { method: 'DELETE' });
}

export function fetchSecFraudAlerts(propertyId?: string | null, filters?: { status?: string; type?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.severity) params.set('severity', filters.severity);
  const qs = params.toString();
  return apiRequest<SecFraudAlert[]>(`${API_BASE}/fraud-alerts${qs ? `?${qs}` : ''}`);
}

export function createSecFraudAlert(body: {
  propertyId?: string | null;
  alertType?: SecFraudAlertType;
  title: string;
  description?: string | null;
  amount?: number | null;
  source?: string | null;
  severity?: SecPriority;
}) {
  return apiRequest<SecFraudAlert>(`${API_BASE}/fraud-alerts`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecFraudAlert(id: string, patch: Partial<{
  title: string; alertType: SecFraudAlertType; description: string | null;
  amount: number | null; source: string | null; severity: SecPriority;
  status: SecFraudAlertStatus; caseId: string | null;
}>) {
  return apiRequest<{ success: boolean; alert: SecFraudAlert }>(`${API_BASE}/fraud-alerts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function escalateSecFraudAlert(id: string, body?: { assignedTo?: string | null; fraudType?: SecFraudType }) {
  return apiRequest<{ success: boolean; case: SecFraudCase }>(`${API_BASE}/fraud-alerts/${id}/escalate`, { method: 'POST', body: JSON.stringify(body || {}) });
}

export function deleteSecFraudAlert(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/fraud-alerts/${id}`, { method: 'DELETE' });
}

// ── Evidence Management ──────────────────────────────────────────────────
// Standalone evidence register (sec_evidence + sec_evidence_custody) — the
// /erp/security/evidence tab. Distinct from the investigation-scoped
// SecEvidence/sec_investigation_evidence attachment list above; names are
// suffixed "Item" to avoid collisions.

export type SecEvidenceItemType =
  | 'Photo' | 'Video' | 'Document' | 'Physical Item' | 'Digital File' | 'Audio' | 'Other';

export type SecEvidenceStatus = 'Collected' | 'Secured' | 'In Analysis' | 'Released' | 'Archived';

export type SecEvidenceCustodyAction =
  | 'Collected' | 'Logged' | 'Transferred' | 'Analysis Started'
  | 'Analysis Complete' | 'Released' | 'Archived' | 'Note';

export interface SecEvidenceItem {
  id: string;
  property_id: string | null;
  title: string;
  evidence_type: SecEvidenceItemType;
  status: SecEvidenceStatus;
  description: string | null;
  location: string | null;
  storage_location: string | null;
  collected_by: string | null;
  collected_at: string;
  source: string | null;
  incident_id: string | null;
  investigation_id: string | null;
  case_id: string | null;
  released_to: string | null;
  released_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sec_incidents?: { id: string; description: string } | null;
  sec_investigations?: { id: string; title: string } | null;
  sec_fraud_cases?: { id: string; title: string } | null;
}

export interface SecEvidenceCustodyEntry {
  id: number;
  evidence_id: string;
  action: SecEvidenceCustodyAction;
  actor: string | null;
  recipient: string | null;
  location: string | null;
  detail: string | null;
  created_at: string;
}

export interface SecEvidenceItemDetail {
  evidence: SecEvidenceItem;
  custody: SecEvidenceCustodyEntry[];
}

export function fetchSecEvidenceItems(propertyId?: string | null, filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return apiRequest<SecEvidenceItem[]>(`${API_BASE}/evidence${qs ? `?${qs}` : ''}`);
}

export function fetchSecEvidenceItem(id: string) {
  return apiRequest<SecEvidenceItemDetail>(`${API_BASE}/evidence/${id}`);
}

export function createSecEvidenceItem(body: {
  propertyId?: string | null;
  title: string;
  evidenceType?: SecEvidenceItemType;
  description?: string | null;
  location?: string | null;
  storageLocation?: string | null;
  collectedBy?: string | null;
  collectedAt?: string | null;
  source?: string | null;
  incidentId?: string | null;
  investigationId?: string | null;
  caseId?: string | null;
  notes?: string | null;
}) {
  return apiRequest<SecEvidenceItem>(`${API_BASE}/evidence`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecEvidenceItem(id: string, patch: Partial<{
  title: string; evidenceType: SecEvidenceItemType; status: SecEvidenceStatus;
  description: string | null; location: string | null; storageLocation: string | null;
  collectedBy: string | null; collectedAt: string | null; source: string | null;
  incidentId: string | null; investigationId: string | null; caseId: string | null;
  releasedTo: string | null; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; evidence: SecEvidenceItem }>(`${API_BASE}/evidence/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function addSecEvidenceCustody(id: string, body: { action: SecEvidenceCustodyAction; recipient?: string | null; location?: string | null; detail?: string | null }) {
  return apiRequest<SecEvidenceCustodyEntry>(`${API_BASE}/evidence/${id}/custody`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecEvidenceItem(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/evidence/${id}`, { method: 'DELETE' });
}

// ── Communication Center ─────────────────────────────────────────────────

export type SecMessageType = 'Dispatch' | 'Internal' | 'Broadcast' | 'Emergency';
export type SecMessagePriority = 'Emergency' | 'Urgent' | 'Routine';
export type SecMessageChannel = 'Radio' | 'App' | 'Email' | 'PA System';
export type SecMessageAudience =
  | 'All Security' | 'Shift Supervisors' | 'Patrol Officers'
  | 'Control Room' | 'Management' | 'Custom';
export type SecMessageStatus = 'Sent' | 'Acknowledged' | 'Expired' | 'Recalled';

export interface SecMessage {
  id: string;
  property_id: string | null;
  msg_type: SecMessageType;
  priority: SecMessagePriority;
  channel: SecMessageChannel;
  audience: SecMessageAudience;
  recipient: string | null;
  subject: string;
  body: string | null;
  sender: string | null;
  status: SecMessageStatus;
  sent_at: string;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ack_count?: number;
}

export interface SecMessageAck {
  id: number;
  message_id: string;
  acked_by: string;
  note: string | null;
  created_at: string;
}

export interface SecMessageDetail {
  message: SecMessage;
  acks: SecMessageAck[];
}

export function fetchSecMessages(propertyId?: string | null, filters?: { status?: string; type?: string; priority?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.priority) params.set('priority', filters.priority);
  const qs = params.toString();
  return apiRequest<SecMessage[]>(`${API_BASE}/messages${qs ? `?${qs}` : ''}`);
}

export function fetchSecMessage(id: string) {
  return apiRequest<SecMessageDetail>(`${API_BASE}/messages/${id}`);
}

export function createSecMessage(body: {
  propertyId?: string | null;
  msgType?: SecMessageType;
  priority?: SecMessagePriority;
  channel?: SecMessageChannel;
  audience?: SecMessageAudience;
  recipient?: string | null;
  subject: string;
  body?: string | null;
  sender?: string | null;
  expiresAt?: string | null;
}) {
  return apiRequest<SecMessage>(`${API_BASE}/messages`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecMessage(id: string, patch: Partial<{
  msgType: SecMessageType; priority: SecMessagePriority; channel: SecMessageChannel;
  audience: SecMessageAudience; recipient: string | null; subject: string;
  body: string | null; status: SecMessageStatus; expiresAt: string | null;
}>) {
  return apiRequest<{ success: boolean; message: SecMessage }>(`${API_BASE}/messages/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function ackSecMessage(id: string, body: { ackedBy: string; note?: string | null }) {
  return apiRequest<SecMessageAck>(`${API_BASE}/messages/${id}/ack`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSecMessage(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/messages/${id}`, { method: 'DELETE' });
}

// ── Staff Management sub-modules ─────────────────────────────────────────
// Mirror the HK StaffManagementModule sub-tabs for /erp/security/staff:
// Roster (existing /staff CRUD) + Shifts + Coverage + Training +
// Attendance + Performance.

export interface SecShiftDef {
  id: string;
  property_id: string | null;
  name: string;
  start_time: string;
  end_time: string;
  required_staff: number;
  notes: string | null;
  created_at: string;
  assigned_staff?: number;   // derived live from sec_staff at read time
}

export interface SecStaffingReq {
  id: string;
  property_id: string | null;
  post: string;
  role: SecRole;
  shift: SecShift;
  required_count: number;
  notes: string | null;
  created_at: string;
  assigned_count?: number;   // derived live from sec_staff at read time
}

export type SecTrainingStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Expired';

export interface SecTraining {
  id: string;
  property_id: string | null;
  staff_id: string;
  course: string;
  provider: string | null;
  completed_at: string | null;
  expires_at: string | null;
  status: SecTrainingStatus;
  notes: string | null;
  created_at: string;
  sec_staff?: { id: string; name: string; role: SecRole } | null;
}

export type SecAttendanceStatus =
  | 'Present' | 'Late' | 'Absent' | 'On Leave' | 'Sick'
  | 'Half Day' | 'Day Off' | 'Training Day';

export interface SecAttendance {
  id: string;
  property_id: string | null;
  staff_id: string;
  attendance_date: string;
  shift: SecShift;
  check_in: string | null;
  check_out: string | null;
  status: SecAttendanceStatus;
  hours_worked: number;
  overtime_hours: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  sec_staff?: { id: string; name: string; role: SecRole } | null;
}

export interface SecAttendanceSummary {
  staffId: string;
  staffName: string;
  role: SecRole | null;
  records: SecAttendance[];
  present: number; late: number; absent: number; onLeave: number; sick: number;
  halfDay: number; dayOff: number; trainingDay: number;
  totalHours: number; totalOvertime: number; totalDays: number;
  attendanceRate: number;
}

export interface SecPerformance {
  id: string;
  property_id: string | null;
  staff_id: string;
  period_date: string;
  patrols_completed: number;
  incidents_responded: number;
  reports_filed: number;
  hours: number;
  score: number;
  notes: string | null;
  created_at: string;
  sec_staff?: { id: string; name: string; role: SecRole } | null;
}

export function fetchSecShiftDefs(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecShiftDef[]>(`${API_BASE}/staff/shifts${qs}`);
}

export function createSecShiftDef(body: {
  propertyId?: string | null; name: string; startTime: string; endTime: string;
  requiredStaff?: number; notes?: string | null;
}) {
  return apiRequest<SecShiftDef>(`${API_BASE}/staff/shifts`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecShiftDef(id: string, patch: Partial<{
  name: string; startTime: string; endTime: string; requiredStaff: number; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; shift: SecShiftDef }>(`${API_BASE}/staff/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecShiftDef(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/staff/shifts/${id}`, { method: 'DELETE' });
}

export function fetchSecCoverage(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecStaffingReq[]>(`${API_BASE}/staff/coverage${qs}`);
}

export function createSecCoverage(body: {
  propertyId?: string | null; post: string; role: SecRole; shift: SecShift;
  requiredCount?: number; notes?: string | null;
}) {
  return apiRequest<SecStaffingReq>(`${API_BASE}/staff/coverage`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecCoverage(id: string, patch: Partial<{
  post: string; role: SecRole; shift: SecShift; requiredCount: number; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; requirement: SecStaffingReq }>(`${API_BASE}/staff/coverage/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecCoverage(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/staff/coverage/${id}`, { method: 'DELETE' });
}

export function fetchSecTraining(propertyId?: string | null, filters?: { staffId?: string; status?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.staffId) params.set('staffId', filters.staffId);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiRequest<SecTraining[]>(`${API_BASE}/staff/training${qs ? `?${qs}` : ''}`);
}

export function createSecTraining(body: {
  propertyId?: string | null; staffId: string; course: string; provider?: string | null;
  completedAt?: string | null; expiresAt?: string | null; status?: SecTrainingStatus; notes?: string | null;
}) {
  return apiRequest<SecTraining>(`${API_BASE}/staff/training`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecTraining(id: string, patch: Partial<{
  staffId: string; course: string; provider: string | null; completedAt: string | null;
  expiresAt: string | null; status: SecTrainingStatus; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; training: SecTraining }>(`${API_BASE}/staff/training/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecTraining(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/staff/training/${id}`, { method: 'DELETE' });
}

export function fetchSecAttendance(propertyId?: string | null, filters?: { date?: string; staffId?: string }) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (filters?.date) params.set('date', filters.date);
  if (filters?.staffId) params.set('staffId', filters.staffId);
  const qs = params.toString();
  return apiRequest<SecAttendance[]>(`${API_BASE}/staff/attendance${qs ? `?${qs}` : ''}`);
}

export function fetchSecAttendanceSummary(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<{ summary: SecAttendanceSummary[] }>(`${API_BASE}/staff/attendance/summary${qs}`);
}

export function createSecAttendance(body: {
  propertyId?: string | null; staffId: string; date?: string; shift?: SecShift;
  status?: SecAttendanceStatus; checkIn?: string | null; notes?: string | null;
}) {
  return apiRequest<SecAttendance>(`${API_BASE}/staff/attendance`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecAttendance(id: string, patch: Partial<{
  date: string; shift: SecShift; status: SecAttendanceStatus;
  checkIn: string | null; checkOut: string | null;
  hoursWorked: number; overtimeHours: number; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; record: SecAttendance }>(`${API_BASE}/staff/attendance/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecAttendance(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/staff/attendance/${id}`, { method: 'DELETE' });
}

export function fetchSecPerformance(propertyId?: string | null, staffId?: string) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (staffId) params.set('staffId', staffId);
  const qs = params.toString();
  return apiRequest<SecPerformance[]>(`${API_BASE}/staff/performance${qs ? `?${qs}` : ''}`);
}

export function createSecPerformance(body: {
  propertyId?: string | null; staffId: string; periodDate: string;
  patrolsCompleted?: number; incidentsResponded?: number; reportsFiled?: number;
  hours?: number; score?: number; notes?: string | null;
}) {
  return apiRequest<SecPerformance>(`${API_BASE}/staff/performance`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSecPerformance(id: string, patch: Partial<{
  periodDate: string; patrolsCompleted: number; incidentsResponded: number;
  reportsFiled: number; hours: number; score: number; notes: string | null;
}>) {
  return apiRequest<{ success: boolean; record: SecPerformance }>(`${API_BASE}/staff/performance/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteSecPerformance(id: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/staff/performance/${id}`, { method: 'DELETE' });
}

// ── Security Reports Registry ────────────────────────────────────────────
// Backs /erp/security/reports (SecurityReports.tsx). Mimics the HK reports
// pattern (hk_reports + HKReportsModule). Each row is a report definition
// with last-run, status, format and frequency; Run/Run All/Schedule persist
// back to `sec_reports` via /api/sec-portal/reports.

export type SecReportCategory = 'operational' | 'staff' | 'compliance' | 'executive';
export type SecReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
export type SecReportFormat = 'PDF' | 'Excel' | 'CSV';

export interface SecReport {
  id: string;
  category: SecReportCategory;
  name: string;
  description: string;
  last_run: string | null;
  status: SecReportStatus;
  format: SecReportFormat;
  frequency: string;
  updated_at?: string;
}

export interface SecReportStats {
  total: number;
  ready: number;
  scheduled: number;
  failed: number;
  byCategory: Record<string, number>;
}

export function fetchSecReports(propertyId?: string | null, category?: string) {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (category) params.set('category', category);
  const qs = params.toString();
  return apiRequest<SecReport[]>(`${API_BASE}/reports${qs ? `?${qs}` : ''}`);
}

export function fetchSecReportStats(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecReportStats>(`${API_BASE}/reports/stats${qs}`);
}

export function fetchSecReport(id: string) {
  return apiRequest<SecReport>(`${API_BASE}/reports/${encodeURIComponent(id)}`);
}

export function runSecReport(id: string) {
  return apiRequest<SecReport>(`${API_BASE}/reports/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

export function runAllSecReports(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<{ refreshed: number; reports: SecReport[] }>(`${API_BASE}/reports/run-all${qs}`, { method: 'POST' });
}

export function updateSecReport(id: string, patch: Partial<{
  frequency: string; format: SecReportFormat; status: SecReportStatus;
}>) {
  return apiRequest<SecReport>(`${API_BASE}/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

// ── Security Configuration ───────────────────────────────────────────────
// Backs /erp/security/configuration (SecurityConfiguration.tsx). JSON-blob
// config per property per section, mirroring the HK hk_config / Eng
// eng_config pattern. Sections: zones, patrols, incidents, access.

export type SecConfigSection = 'zones' | 'patrols' | 'incidents' | 'access';

export const SEC_CONFIG_SECTIONS: SecConfigSection[] = [
  'zones', 'patrols', 'incidents', 'access',
];

export const fetchSecConfig = (propertyId: string, section: SecConfigSection) =>
  apiRequest<Record<string, any>>(`${API_BASE}/config/${propertyId}/${section}`);

export const saveSecConfig = (propertyId: string, section: SecConfigSection, data: Record<string, any>) =>
  apiRequest<Record<string, any>>(`${API_BASE}/config/${propertyId}/${section}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

// ── Security Dashboard ───────────────────────────────────────────────────
// Backs /erp/security/dashboard (SecurityDashboard.tsx). Mimics the HK
// dashboard pattern (hk_dashboard_alerts): GET /dashboard/overview returns
// live KPIs + chart series + the smart-alert feed; the server regenerates
// alerts from the sec_* tables on each call.

export type SecAlertPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type SecAlertStatus = 'Active' | 'Acknowledged' | 'Snoozed' | 'Resolved';

export interface SecDashboardAlert {
  id: string;
  property_id: string | null;
  type: string;
  message: string;
  priority: SecAlertPriority;
  status: SecAlertStatus;
  ref_id: string | null;
  location: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecDashboardKpis {
  activeIncidents: number;
  criticalIncidents: number;
  openInvestigations: number;
  highPriorityInvestigations: number;
  patrolCompletion: number;
  patrolsToday: number;
  activeAlarms: number;
  unacknowledgedAlarms: number;
  accessViolations: number;
  visitorsOnProperty: number;
  lostFoundOpen: number;
  lostFoundPendingClaims: number;
  fireIssues: number;
  fireOverdue: number;
  cctvOnlinePct: number;
  cctvTotal: number;
  topRiskLevel: string;
  highCriticalRisks: number;
  staffOnDuty: number;
  staffTotal: number;
  keysIssued: number;
}

export interface SecDashboardOverview {
  kpis: SecDashboardKpis;
  incidentCategories: { name: string; value: number }[];
  incidentTrend: { date: string; label: string; incidents: number; resolved: number }[];
  riskByCategory: { name: string; risk: number }[];
  patrolActivity: { name: string; patrols: number; completion: number }[];
  alerts: SecDashboardAlert[];
}

export function fetchSecDashboardOverview(propertyId?: string | null) {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  return apiRequest<SecDashboardOverview>(`${API_BASE}/dashboard/overview${qs}`);
}

export function acknowledgeSecAlert(id: string) {
  return apiRequest<SecDashboardAlert>(`${API_BASE}/dashboard/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
}

export function snoozeSecAlert(id: string, hours?: number) {
  return apiRequest<SecDashboardAlert>(`${API_BASE}/dashboard/alerts/${encodeURIComponent(id)}/snooze`, {
    method: 'POST',
    body: JSON.stringify({ hours: hours ?? 4 }),
  });
}
