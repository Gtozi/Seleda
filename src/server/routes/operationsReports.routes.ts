/**
 * Operations Reports routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/reports tab (Reports.tsx). Mimics the
 * Housekeeping reports pattern (hk_reports / HKReportsModule) — a
 * registry of report definitions in `ops_reports` (migration 642) with
 * run metadata. Unlike HK, each run also computes a real `summary`
 * JSONB of live cross-portal headline metrics, shown in the View modal
 * and included in PDF/Excel/CSV exports.
 *
 *   GET   /reports?propertyId=       — list report definitions
 *   GET   /reports/stats             — aggregated KPI counts
 *   GET   /reports/:id               — single report (with last summary)
 *   POST  /reports/:id/run           — compute live metrics, store summary,
 *                                      stamp last_run + status Ready
 *   POST  /reports/run-all           — run every report
 *   PATCH /reports/:id               — update frequency / format / status
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

const OPS_REPORT_CATEGORIES = ['operations', 'guest', 'approval', 'executive'] as const;
const OPS_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const OPS_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;
const OPS_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, summary, updated_at';

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-reports] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-reports] ${tag}: ${e?.message || e}`);
    return [];
  }
}

function scoped(query: any, propertyId: string | null) {
  return propertyId ? query.eq('property_id', propertyId) : query;
}

// Registry tables (ops_reports) treat NULL property_id as global — include them under any scope.
function scopedRegistry(query: any, propertyId: string | null) {
  return propertyId ? query.or(`property_id.is.null,property_id.eq.${propertyId}`) : query;
}

const OPEN_WO = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor'];
const OPEN_INCIDENT = ['Draft', 'Reported', 'Classified', 'Assigned', 'In Progress', 'Investigation', 'Corrective Action', 'Active', 'Pending'];
const OPEN_REQ = ['Open', 'In Progress', 'Assigned'];

type CounterMap = Record<string, number>;

async function computeCounters(propertyId: string | null): Promise<CounterMap> {
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const ago4h = new Date(Date.now() - 4 * 3600000).toISOString();

  const [
    rooms, reservations, vipGuests, hkTasks, workOrders, guestRequests,
    incidents, emergencies, events, escalations, recoveryCases, crossDept,
    inspections, fbStandards, feedback, shiftLog,
    finApprovals, opsApprovals, uinvApprovals, hrApprovals,
  ] = await Promise.all([
    fetchRows(scoped(supabaseAdmin!.from('rooms').select('id, status'), propertyId), 'rooms'),
    fetchRows(scoped(supabaseAdmin!.from('reservations').select('id, guest_name, check_in_date, check_out_date, status'), propertyId), 'reservations'),
    fetchRows(scoped(supabaseAdmin!.from('guests').select('id, name').in('status', ['VIP', 'Loyalty Member']), propertyId), 'vip_guests'),
    fetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt').select('id, status, due_date, created_at'), propertyId), 'hk_tasks'),
    fetchRows(scoped(supabaseAdmin!.from('work_orders').select('id, status, priority'), propertyId), 'work_orders'),
    fetchRows(scoped(supabaseAdmin!.from('guest_requests').select('id, status, priority, request_type, created_at'), propertyId), 'guest_requests'),
    fetchRows(scoped(supabaseAdmin!.from('sec_incidents').select('id, status, priority, reported_at'), propertyId), 'sec_incidents'),
    fetchRows(scoped(supabaseAdmin!.from('sec_emergency_notifications').select('id, status'), propertyId), 'emergencies'),
    fetchRows(scoped(supabaseAdmin!.from('banquet_events').select('id, event_date, status'), propertyId), 'events'),
    fetchRows(scoped(supabaseAdmin!.from('ops_escalations').select('id, status, severity, due_by'), propertyId), 'escalations'),
    fetchRows(scoped(supabaseAdmin!.from('ops_recovery_cases').select('id, status, compensation_amount'), propertyId), 'recovery'),
    fetchRows(scoped(supabaseAdmin!.from('ops_cross_dept_tasks').select('id, status'), propertyId), 'cross_dept'),
    fetchRows(scoped(supabaseAdmin!.from('room_inspections').select('id, result, inspection_date').gte('inspection_date', ago30), propertyId), 'inspections'),
    fetchRows(supabaseAdmin!.from('fb_service_standards').select('id, status'), 'fb_standards'),
    fetchRows(supabaseAdmin!.from('guest_feedback').select('id, rating').gte('created_at', ago30), 'feedback'),
    fetchRows(scoped(supabaseAdmin!.from('ops_shift_log_entries').select('id, created_at'), propertyId), 'shift_log'),
    fetchRows(scoped(supabaseAdmin!.from('fin_approval_requests').select('id, status, created_at, approved_at, rejected_at'), propertyId), 'fin_appr'),
    fetchRows(scoped(supabaseAdmin!.from('ops_approval_requests').select('id, status, created_at, decided_at'), propertyId), 'ops_appr'),
    fetchRows(scoped(supabaseAdmin!.from('uinv_approval_requests').select('id, status, created_at, approved_at'), propertyId), 'uinv_appr'),
    fetchRows(scoped(supabaseAdmin!.from('hr_approval_requests').select('id, request_status, created_at'), propertyId), 'hr_appr'),
  ]);

  const isPending = (s: any) => /pending|submitted|awaiting|escalated|in.?review/i.test(String(s || ''));

  const occupied = rooms.filter(r => /^occupied/i.test(r.status || '')).length;
  const ooo = rooms.filter(r => /out.?of.?(order|service)|maintenance/i.test(r.status || '')).length;
  const sellable = Math.max(rooms.length - ooo, 0);
  const activeRes = reservations.filter(r => ['Confirmed', 'CheckedIn', 'Booked', 'InHouse'].includes(r.status));
  const vipNames = new Set(vipGuests.map(g => String(g.name || '').toLowerCase()));
  const inHouse = activeRes.filter(r => r.check_in_date <= today && r.check_out_date > today);

  const openWOs = workOrders.filter(w => OPEN_WO.includes(w.status));
  const hkPending = hkTasks.filter(t => /pending|open|assigned/i.test(t.status || ''));
  const hkOverdue = hkTasks.filter(t => t.due_date && t.due_date < today && !/completed|verified|cancelled/i.test(t.status || ''));
  const openReqs = guestRequests.filter(r => OPEN_REQ.includes(r.status));
  const staleReqs = openReqs.filter(r => (r.created_at || '') < ago4h);
  const openIncidents = incidents.filter(i => OPEN_INCIDENT.includes(i.status));
  const openEsc = escalations.filter(e => e.status !== 'resolved');
  const openRecovery = recoveryCases.filter(r => r.status !== 'closed');
  const rated = feedback.map(f => Number(f.rating)).filter(v => v > 0);
  const inspDone = inspections.filter(i => i.result === 'Pass' || i.result === 'Fail');
  const fbMeeting = fbStandards.filter(s => ['Meeting', 'Exceeded'].includes(s.status));

  const approvalRows = [
    ...finApprovals.map(a => ({ pending: isPending(a.status), decided: a.approved_at || a.rejected_at, created: a.created_at })),
    ...opsApprovals.map(a => ({ pending: isPending(a.status), decided: a.decided_at, created: a.created_at })),
    ...uinvApprovals.map(a => ({ pending: isPending(a.status), decided: a.approved_at, created: a.created_at })),
    ...hrApprovals.map(a => ({ pending: isPending(a.request_status), decided: null, created: a.created_at })),
  ];
  const decided = approvalRows.filter(a => a.decided && a.created);
  const turnaroundHrs = decided.length
    ? Math.round(decided.reduce((n, a) => n + (new Date(a.decided).getTime() - new Date(a.created).getTime()) / 3600000, 0) / decided.length * 10) / 10
    : 0;

  return {
    roomsTotal: rooms.length,
    roomsOccupied: occupied,
    occPct: sellable ? Math.round((occupied / sellable) * 100) : 0,
    outOfOrder: ooo,
    arrivalsToday: activeRes.filter(r => r.check_in_date === today).length,
    departuresToday: activeRes.filter(r => r.check_out_date === today).length,
    inHouse: inHouse.length,
    vipInHouse: inHouse.filter(r => vipNames.has(String(r.guest_name || '').toLowerCase())).length,
    openWorkOrders: openWOs.length,
    emergencyWOs: openWOs.filter(w => w.priority === 'Emergency').length,
    hkPending: hkPending.length,
    hkOverdue: hkOverdue.length,
    hkCompletedToday: hkTasks.filter(t => /completed|verified/i.test(t.status || '') && String(t.created_at || '').slice(0, 10) === today).length,
    openRequests: openReqs.length,
    urgentRequests: openReqs.filter(r => /urgent|critical|high/i.test(r.priority || '')).length,
    staleRequests: staleReqs.length,
    complaintRequests: openReqs.filter(r => /complaint/i.test(r.request_type || '')).length,
    incidentsToday: incidents.filter(i => String(i.reported_at || '').slice(0, 10) === today).length,
    openCriticalIncidents: openIncidents.filter(i => ['Critical', 'High'].includes(i.priority)).length,
    openIncidents: openIncidents.length,
    activeEmergencies: emergencies.filter(e => ['Active', 'In Progress'].includes(e.status)).length,
    eventsToday: events.filter(e => e.event_date === today).length,
    upcomingEvents7d: events.filter(e => e.event_date > today && e.event_date <= in7).length,
    openEscalations: openEsc.length,
    criticalEscalations: openEsc.filter(e => e.severity === 'critical').length,
    overdueEscalations: openEsc.filter(e => e.due_by && e.due_by < new Date().toISOString()).length,
    openRecoveryCases: openRecovery.length,
    compExposure: openRecovery.reduce((n, r) => n + (Number(r.compensation_amount) || 0), 0),
    crossDeptOpen: crossDept.filter(t => t.status !== 'Completed').length,
    crossDeptCompleted: crossDept.filter(t => t.status === 'Completed').length,
    pendingApprovals: approvalRows.filter(a => a.pending).length,
    totalApprovals: approvalRows.length,
    approvalsDecided: decided.length,
    avgApprovalHours: turnaroundHrs,
    negativeFeedback30d: feedback.filter(f => Number(f.rating) > 0 && Number(f.rating) <= 3).length,
    avgRating30d: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : 0,
    inspections30d: inspDone.length,
    inspectionPassRate: inspDone.length ? Math.round((inspDone.filter(i => i.result === 'Pass').length / inspDone.length) * 100) : 0,
    fbStandardsMeeting: fbMeeting.length,
    fbStandardsTotal: fbStandards.length,
    shiftNotesToday: shiftLog.filter(s => String(s.created_at || '').slice(0, 10) === today).length,
  };
}

/** report id → live metrics captured in summary on each run. */
const REPORT_METRICS: Record<string, { label: string; key: keyof CounterMap }[]> = {
  'ops-rpt-01': [
    { label: 'Occupancy %', key: 'occPct' }, { label: 'Arrivals Today', key: 'arrivalsToday' },
    { label: 'Departures Today', key: 'departuresToday' }, { label: 'Open Work Orders', key: 'openWorkOrders' },
    { label: 'Open Guest Requests', key: 'openRequests' }, { label: 'Incidents Today', key: 'incidentsToday' },
  ],
  'ops-rpt-02': [
    { label: 'Shift Notes Today', key: 'shiftNotesToday' }, { label: 'HK Tasks Pending', key: 'hkPending' },
    { label: 'HK Completed Today', key: 'hkCompletedToday' }, { label: 'Active Emergencies', key: 'activeEmergencies' },
  ],
  'ops-rpt-03': [
    { label: 'HK Pending Tasks', key: 'hkPending' }, { label: 'Open Work Orders', key: 'openWorkOrders' },
    { label: 'Open Incidents', key: 'openIncidents' }, { label: 'Open Requests', key: 'openRequests' },
    { label: 'Events Today', key: 'eventsToday' },
  ],
  'ops-rpt-04': [
    { label: 'Open Cross-Dept Tasks', key: 'crossDeptOpen' }, { label: 'Completed', key: 'crossDeptCompleted' },
  ],
  'ops-rpt-05': [
    { label: 'Overdue HK Tasks', key: 'hkOverdue' }, { label: 'Stale Requests (>4h)', key: 'staleRequests' },
    { label: 'Overdue Escalations', key: 'overdueEscalations' }, { label: 'Emergency WOs', key: 'emergencyWOs' },
  ],
  'ops-rpt-06': [
    { label: 'VIP Guests In-House', key: 'vipInHouse' }, { label: 'Arrivals Today', key: 'arrivalsToday' },
  ],
  'ops-rpt-07': [
    { label: 'Open Recovery Cases', key: 'openRecoveryCases' }, { label: 'Compensation Exposure', key: 'compExposure' },
  ],
  'ops-rpt-08': [
    { label: 'Open Complaint Requests', key: 'complaintRequests' },
    { label: 'Negative Feedback (30d)', key: 'negativeFeedback30d' }, { label: 'Open Recovery Cases', key: 'openRecoveryCases' },
  ],
  'ops-rpt-09': [
    { label: 'Avg Feedback Rating (30d)', key: 'avgRating30d' }, { label: 'Inspection Pass Rate %', key: 'inspectionPassRate' },
    { label: 'F&B Standards Meeting', key: 'fbStandardsMeeting' }, { label: 'F&B Standards Total', key: 'fbStandardsTotal' },
  ],
  'ops-rpt-10': [
    { label: 'Pending Approvals', key: 'pendingApprovals' }, { label: 'Total Approval Records', key: 'totalApprovals' },
  ],
  'ops-rpt-11': [
    { label: 'Avg Turnaround (hours)', key: 'avgApprovalHours' }, { label: 'Decided Approvals', key: 'approvalsDecided' },
  ],
  'ops-rpt-12': [
    { label: 'Open Escalations', key: 'openEscalations' }, { label: 'Critical', key: 'criticalEscalations' },
    { label: 'Past SLA', key: 'overdueEscalations' },
  ],
  'ops-rpt-13': [
    { label: 'Occupancy %', key: 'occPct' }, { label: 'In-House Guests', key: 'inHouse' },
    { label: 'Active Emergencies', key: 'activeEmergencies' }, { label: 'Open Escalations', key: 'openEscalations' },
    { label: 'Out of Order Rooms', key: 'outOfOrder' },
  ],
  'ops-rpt-14': [
    { label: 'HK Pending', key: 'hkPending' }, { label: 'Eng Open WOs', key: 'openWorkOrders' },
    { label: 'Sec Open Incidents', key: 'openIncidents' }, { label: 'FO Open Requests', key: 'openRequests' },
    { label: 'Inspection Pass Rate %', key: 'inspectionPassRate' },
  ],
  'ops-rpt-15': [
    { label: 'Occupancy %', key: 'occPct' }, { label: 'Arrivals', key: 'arrivalsToday' },
    { label: 'Departures', key: 'departuresToday' }, { label: 'Events Today', key: 'eventsToday' },
    { label: 'Active Emergencies', key: 'activeEmergencies' },
  ],
  'ops-rpt-16': [
    { label: 'Inspections (30d)', key: 'inspections30d' }, { label: 'Inspection Pass Rate %', key: 'inspectionPassRate' },
    { label: 'Upcoming Events (7d)', key: 'upcomingEvents7d' }, { label: 'Cross-Dept Completed', key: 'crossDeptCompleted' },
  ],
  'ops-rpt-17': [
    { label: 'Occupancy %', key: 'occPct' }, { label: 'Avg Feedback (30d)', key: 'avgRating30d' },
    { label: 'Inspection Pass Rate %', key: 'inspectionPassRate' }, { label: 'Approvals Decided', key: 'approvalsDecided' },
    { label: 'Open Escalations', key: 'openEscalations' },
  ],
};

function buildSummary(reportId: string, c: CounterMap) {
  return (REPORT_METRICS[reportId] || [{ label: 'Occupancy %', key: 'occPct' }])
    .map(m => ({ label: m.label, value: c[m.key] ?? 0 }));
}

// GET /api/ops-portal/reports — list (optional ?category=)
router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query.propertyId as string) || null;
  const category = req.query.category as string;
  const cacheKey = `ops-reports:${propertyId || 'all'}:${category || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  let q = scopedRegistry(supabaseAdmin!.from('ops_reports').select(OPS_REPORT_SELECT).order('id', { ascending: true }), propertyId);
  if (category && (OPS_REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  cacheService.set(cacheKey, data || [], CACHE_TTL_MS);
  return res.json(data || []);
});

// GET /api/ops-portal/reports/stats — aggregated KPI counts
router.get('/reports/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query.propertyId as string) || null;
  const { data, error } = await scopedRegistry(
    supabaseAdmin!.from('ops_reports').select('category, status'), propertyId
  );
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = { operations: 0, guest: 0, approval: 0, executive: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({
    total: rows.length,
    ready: rows.filter((r: any) => r.status === 'Ready').length,
    scheduled: rows.filter((r: any) => r.status === 'Scheduled').length,
    failed: rows.filter((r: any) => r.status === 'Failed').length,
    byCategory,
  });
});

// GET /api/ops-portal/reports/:id — single report with last summary
router.get('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin!
    .from('ops_reports').select(OPS_REPORT_SELECT).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// POST /api/ops-portal/reports/:id/run — compute live summary + stamp
router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.body?.propertyId as string) || (req.query.propertyId as string) || null;
  try {
    const counters = await computeCounters(propertyId);
    const summary = buildSummary(req.params.id, counters);
    const { data, error } = await supabaseAdmin!
      .from('ops_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), summary, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(OPS_REPORT_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found' });
    return res.json(data);
  } catch (e: any) {
    console.error('[ops-reports] run failed:', e?.message || e);
    await supabaseAdmin!.from('ops_reports').update({ status: 'Failed', updated_at: new Date().toISOString() }).eq('id', req.params.id);
    return res.status(500).json({ error: e?.message || 'Report run failed' });
  }
});

// POST /api/ops-portal/reports/run-all — run every report
router.post('/reports/run-all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.body?.propertyId as string) || (req.query.propertyId as string) || null;
  try {
    const counters = await computeCounters(propertyId);
    const defs = await fetchRows(
      scopedRegistry(supabaseAdmin!.from('ops_reports').select('id'), propertyId), 'defs'
    );
    const now = new Date().toISOString();
    let refreshed = 0;
    for (const d of defs) {
      const { error } = await supabaseAdmin!
        .from('ops_reports')
        .update({ status: 'Ready', last_run: now, summary: buildSummary(d.id, counters), updated_at: now })
        .eq('id', d.id);
      if (!error) refreshed++;
    }
    const { data } = await scopedRegistry(
      supabaseAdmin!.from('ops_reports').select(OPS_REPORT_SELECT).order('id', { ascending: true }), propertyId
    );
    return res.json({ refreshed, reports: data || [] });
  } catch (e: any) {
    console.error('[ops-reports] run-all failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Run-all failed' });
  }
});

// PATCH /api/ops-portal/reports/:id — frequency / format / status
router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (OPS_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (OPS_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 1) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin!
    .from('ops_reports').update(updates).eq('id', req.params.id).select(OPS_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

export default router;
