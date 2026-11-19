/**
 * Daily Flash Reports routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/flash-reports tab (DailyFlashReports.tsx).
 * Generated reports are persisted snapshots in `ops_flash_reports`
 * (migration 641) — each POST computes a live cross-portal operational
 * snapshot and stores the section subset for the chosen report type.
 *
 *   GET    /flash-reports?propertyId=          — report list + today's
 *          live headline metrics (occupancy, revenue, open issues).
 *   GET    /flash-reports/:id                  — full stored payload.
 *   POST   /flash-reports                      — generate: computes the
 *          live snapshot from rooms/reservations/housekeeping/work_orders/
 *          guest_requests/sec_incidents/sec_emergency_notifications/
 *          banquet_events/group_blocks/ops_escalations/ops_recovery_cases/
 *          guest_feedback and persists the typed section subset.
 *   DELETE /flash-reports/:id                  — remove a stored report.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

export const REPORT_TYPES = [
  { key: 'daily-operations', name: 'Daily Operations Report' },
  { key: 'morning-flash', name: 'Morning Flash Report' },
  { key: 'evening-summary', name: 'Evening Summary' },
  { key: 'executive-briefing', name: 'Executive Briefing' },
  { key: 'duty-manager', name: 'Duty Manager Report' },
  { key: 'guest-complaints', name: 'Guest Complaint Summary' },
  { key: 'occupancy', name: 'Occupancy Summary' },
  { key: 'revenue', name: 'Revenue Snapshot' },
  { key: 'incidents', name: 'Incident Summary' },
] as const;

type ReportTypeKey = typeof REPORT_TYPES[number]['key'];

const SECTIONS_BY_TYPE: Record<ReportTypeKey, string[]> = {
  'daily-operations': ['occupancy', 'revenue', 'housekeeping', 'maintenance', 'guestExperience', 'safety', 'events', 'escalations'],
  'morning-flash': ['occupancy', 'safety', 'escalations', 'events'],
  'evening-summary': ['occupancy', 'revenue', 'guestExperience', 'events'],
  'executive-briefing': ['occupancy', 'revenue', 'escalations', 'safety'],
  'duty-manager': ['housekeeping', 'maintenance', 'guestExperience', 'escalations'],
  'guest-complaints': ['guestExperience'],
  'occupancy': ['occupancy', 'events'],
  'revenue': ['revenue', 'occupancy'],
  'incidents': ['safety', 'maintenance'],
};

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-flash] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-flash] ${tag}: ${e?.message || e}`);
    return [];
  }
}

function scoped(query: any, propertyId: string | null) {
  return propertyId ? query.eq('property_id', propertyId) : query;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const OPEN_WO = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor'];
const OPEN_INCIDENT = ['Draft', 'Reported', 'Classified', 'Assigned', 'In Progress', 'Investigation', 'Corrective Action', 'Active', 'Pending'];
const OPEN_REQ = ['Open', 'In Progress', 'Assigned'];

type Metric = { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' };
type Section = { label: string; metrics: Metric[]; highlights: string[] };

/** Computes the full live cross-portal snapshot once; report types pick sections. */
async function computeSnapshot(propertyId: string | null): Promise<Record<string, Section>> {
  const today = todayStr();
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    rooms, reservations, vipGuests, hkTasks, workOrders, guestRequests,
    incidents, emergencies, events, groupBlocks, escalations,
    recoveryCases, feedback,
  ] = await Promise.all([
    fetchRows(scoped(supabaseAdmin!.from('rooms').select('id, number, status, rate'), propertyId), 'rooms'),
    fetchRows(scoped(supabaseAdmin!.from('reservations')
      .select('id, guest_name, check_in_date, check_out_date, status, rate, total_amount'), propertyId), 'reservations'),
    fetchRows(scoped(supabaseAdmin!.from('guests').select('id, name').in('status', ['VIP', 'Loyalty Member']), propertyId), 'vip_guests'),
    fetchRows(scoped(supabaseAdmin!.from('housekeeping_task_mgmt').select('id, status, type, created_at'), propertyId), 'hk_tasks'),
    fetchRows(scoped(supabaseAdmin!.from('work_orders').select('id, status, priority, created_date, completed_at'), propertyId), 'work_orders'),
    fetchRows(scoped(supabaseAdmin!.from('guest_requests').select('id, status, priority, created_at'), propertyId), 'guest_requests'),
    fetchRows(scoped(supabaseAdmin!.from('sec_incidents').select('id, status, priority, reported_at'), propertyId), 'sec_incidents'),
    fetchRows(scoped(supabaseAdmin!.from('sec_emergency_notifications').select('id, status, priority'), propertyId), 'emergencies'),
    fetchRows(scoped(supabaseAdmin!.from('banquet_events').select('id, event_name, event_date, guest_count, expected_attendees, estimated_revenue, status'), propertyId), 'events'),
    fetchRows(scoped(supabaseAdmin!.from('group_blocks').select('id, block_name, arrival_date, departure_date, blocked_rooms, status'), propertyId), 'group_blocks'),
    fetchRows(scoped(supabaseAdmin!.from('ops_escalations').select('id, status, severity'), propertyId), 'escalations'),
    fetchRows(scoped(supabaseAdmin!.from('ops_recovery_cases').select('id, status, compensation_amount'), propertyId), 'recovery'),
    fetchRows(supabaseAdmin!.from('guest_feedback').select('id, rating, created_at').gte('created_at', monthAgo), 'feedback'),
  ]);

  // ── Occupancy ──
  const occupiedRooms = rooms.filter(r => /^occupied/i.test(r.status || ''));
  const oooRooms = rooms.filter(r => /out.?of.?(order|service)|maintenance/i.test(r.status || ''));
  const sellable = Math.max(rooms.length - oooRooms.length, 0);
  const activeRes = reservations.filter(r => ['Confirmed', 'CheckedIn', 'Booked', 'InHouse'].includes(r.status));
  const arrivals = activeRes.filter(r => r.check_in_date === today);
  const departures = activeRes.filter(r => r.check_out_date === today);
  const vipNames = new Set(vipGuests.map(g => String(g.name || '').toLowerCase()));
  const vipArrivals = arrivals.filter(r => vipNames.has(String(r.guest_name || '').toLowerCase()));
  const occPct = sellable ? Math.round((occupiedRooms.length / sellable) * 100) : 0;

  // ── Revenue ──
  const roomRevenue = departures.concat(arrivals).length
    ? activeRes
        .filter(r => r.check_in_date <= today && r.check_out_date > today)
        .reduce((n, r) => {
          const nights = Math.max(1, Math.round((new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000));
          const rate = r.rate > 0 ? Number(r.rate) : (r.total_amount > 0 ? Number(r.total_amount) / nights : 0);
          return n + rate;
        }, 0)
    : activeRes
        .filter(r => r.check_in_date <= today && r.check_out_date > today)
        .reduce((n, r) => n + (Number(r.rate) || 0), 0);
  const inhouseRates = activeRes.filter(r => r.check_in_date <= today && r.check_out_date > today)
    .map(r => Number(r.rate) || 0).filter(v => v > 0);
  const adr = inhouseRates.length ? Math.round(inhouseRates.reduce((a, b) => a + b, 0) / inhouseRates.length) : 0;
  const eventsToday = events.filter(e => e.event_date === today);
  const eventRevenue = eventsToday.reduce((n, e) => n + (Number(e.estimated_revenue) || 0), 0);

  // ── Housekeeping ──
  const hkToday = hkTasks.filter(t => String(t.created_at || '').slice(0, 10) === today);
  const hkPending = hkTasks.filter(t => /pending|open|assigned/i.test(t.status || '')).length;
  const hkInProg = hkTasks.filter(t => /in.?progress/i.test(t.status || '')).length;
  const hkDone = hkToday.filter(t => /completed|verified|inspected/i.test(t.status || '')).length;

  // ── Maintenance ──
  const openWOs = workOrders.filter(w => OPEN_WO.includes(w.status));
  const emergencyWOs = openWOs.filter(w => w.priority === 'Emergency');
  const woDoneToday = workOrders.filter(w => /completed|closed|verified/i.test(w.status || '') && String(w.completed_at || '').slice(0, 10) === today).length;

  // ── Guest experience ──
  const openReqs = guestRequests.filter(r => OPEN_REQ.includes(r.status));
  const urgentReqs = openReqs.filter(r => /urgent|critical|high/i.test(r.priority || ''));
  const openRecovery = recoveryCases.filter(r => r.status !== 'closed');
  const rated = feedback.map(f => Number(f.rating)).filter(v => v > 0);
  const avgRating = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null;

  // ── Safety ──
  const incidentsToday = incidents.filter(i => String(i.reported_at || '').slice(0, 10) === today);
  const openCritical = incidents.filter(i => OPEN_INCIDENT.includes(i.status) && ['Critical', 'High'].includes(i.priority));
  const activeEmerg = emergencies.filter(e => ['Active', 'In Progress'].includes(e.status));

  // ── Events / groups ──
  const upcomingEvents = events.filter(e => e.event_date > today && e.event_date <= in7 && !/cancelled|completed/i.test(e.status || ''));
  const groupsIn = groupBlocks.filter(g => g.arrival_date === today);
  const attendeesToday = eventsToday.reduce((n, e) => n + (e.guest_count || e.expected_attendees || 0), 0);

  // ── Escalations ──
  const openEsc = escalations.filter(e => e.status !== 'resolved');
  const critEsc = openEsc.filter(e => e.severity === 'critical');

  return {
    occupancy: {
      label: 'Occupancy',
      metrics: [
        { label: 'Occupancy', value: `${occPct}%`, tone: occPct >= 80 ? 'good' : occPct >= 50 ? 'warn' : 'bad' },
        { label: 'Rooms Occupied', value: `${occupiedRooms.length}/${rooms.length}` },
        { label: 'Arrivals Today', value: arrivals.length },
        { label: 'Departures Today', value: departures.length },
        { label: 'VIP Arrivals', value: vipArrivals.length, tone: vipArrivals.length ? 'warn' : 'good' },
        { label: 'Out of Order', value: oooRooms.length, tone: oooRooms.length ? 'warn' : 'good' },
      ],
      highlights: [
        ...arrivals.slice(0, 5).map(r => `Arrival: ${r.guest_name} (${r.check_in_date})`),
        ...groupsIn.map(g => `Group check-in: ${g.block_name} (${g.blocked_rooms} rooms)`),
      ],
    },
    revenue: {
      label: 'Revenue',
      metrics: [
        { label: 'Room Revenue (in-house)', value: Math.round(roomRevenue) },
        { label: 'ADR', value: adr },
        { label: 'Event Revenue Today', value: Math.round(eventRevenue) },
        { label: 'Est. Total Today', value: Math.round(roomRevenue + eventRevenue) },
      ],
      highlights: eventsToday.filter(e => e.estimated_revenue).slice(0, 5).map(e => `${e.event_name}: est. ${e.estimated_revenue}`),
    },
    housekeeping: {
      label: 'Housekeeping',
      metrics: [
        { label: 'Tasks Today', value: hkToday.length },
        { label: 'Pending', value: hkPending, tone: hkPending > 10 ? 'warn' : 'good' },
        { label: 'In Progress', value: hkInProg },
        { label: 'Completed Today', value: hkDone },
      ],
      highlights: [],
    },
    maintenance: {
      label: 'Maintenance',
      metrics: [
        { label: 'Open Work Orders', value: openWOs.length, tone: openWOs.length > 15 ? 'warn' : 'good' },
        { label: 'Emergency WOs', value: emergencyWOs.length, tone: emergencyWOs.length ? 'bad' : 'good' },
        { label: 'Completed Today', value: woDoneToday },
      ],
      highlights: emergencyWOs.slice(0, 5).map(w => `Emergency WO open: ${w.id}`),
    },
    guestExperience: {
      label: 'Guest Experience',
      metrics: [
        { label: 'Open Requests', value: openReqs.length, tone: openReqs.length > 10 ? 'warn' : 'good' },
        { label: 'Urgent Requests', value: urgentReqs.length, tone: urgentReqs.length ? 'bad' : 'good' },
        { label: 'Open Recovery Cases', value: openRecovery.length, tone: openRecovery.length ? 'warn' : 'good' },
        { label: 'Avg Feedback (30d)', value: avgRating != null ? `${avgRating}/5` : 'n/a', tone: avgRating == null ? 'good' : avgRating >= 4 ? 'good' : avgRating >= 3 ? 'warn' : 'bad' },
        { label: 'Feedback Responses (30d)', value: feedback.length },
      ],
      highlights: [],
    },
    safety: {
      label: 'Safety & Security',
      metrics: [
        { label: 'Incidents Today', value: incidentsToday.length },
        { label: 'Open Critical/High', value: openCritical.length, tone: openCritical.length ? 'bad' : 'good' },
        { label: 'Active Emergencies', value: activeEmerg.length, tone: activeEmerg.length ? 'bad' : 'good' },
      ],
      highlights: [
        ...activeEmerg.map(e => `ACTIVE EMERGENCY: ${e.id}`),
        ...openCritical.slice(0, 4).map(i => `Open ${i.priority} incident: ${i.id}`),
      ],
    },
    events: {
      label: 'Events & Groups',
      metrics: [
        { label: 'Events Today', value: eventsToday.length },
        { label: 'Attendees Today', value: attendeesToday },
        { label: 'Events Next 7 Days', value: upcomingEvents.length },
        { label: 'Group Check-ins Today', value: groupsIn.length },
      ],
      highlights: eventsToday.slice(0, 5).map(e => `Today: ${e.event_name}`),
    },
    escalations: {
      label: 'Escalations',
      metrics: [
        { label: 'Open Escalations', value: openEsc.length, tone: openEsc.length ? 'warn' : 'good' },
        { label: 'Critical', value: critEsc.length, tone: critEsc.length ? 'bad' : 'good' },
      ],
      highlights: critEsc.slice(0, 5).map(e => `Critical escalation open: ${e.id}`),
    },
  };
}

router.get('/flash-reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query.propertyId as string) || null;
  const cacheKey = `ops-flash:${propertyId || 'all'}`;

  try {
    const cached = cacheService.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const reports = await fetchRows(
      scoped(
        supabaseAdmin!.from('ops_flash_reports')
          .select('id, name, type, period_date, generated_by, status, created_at')
          .order('created_at', { ascending: false })
          .limit(50),
        propertyId
      ),
      'reports'
    );

    const payload = {
      reports: reports.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        periodDate: r.period_date,
        generatedAt: r.created_at,
        generatedBy: r.generated_by,
        status: r.status,
      })),
      reportTypes: REPORT_TYPES,
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (e: any) {
    console.error('[ops-flash] GET failed:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load flash reports' });
  }
});

router.get('/flash-reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { data, error } = await supabaseAdmin!
      .from('ops_flash_reports')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Report not found' });
    return res.json({ report: data });
  } catch (e: any) {
    console.error('[ops-flash] GET one failed:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load report' });
  }
});

router.post('/flash-reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const user = (req as any).user;
  const body = req.body || {};
  const propertyId = body.propertyId || (req.query.propertyId as string) || null;

  const typeDef = REPORT_TYPES.find(t => t.key === body.type) || REPORT_TYPES[0];
  const sections = SECTIONS_BY_TYPE[typeDef.key];

  try {
    const snapshot = await computeSnapshot(propertyId);
    const payload = {
      generatedAt: new Date().toISOString(),
      periodDate: todayStr(),
      sections: Object.fromEntries(sections.map(k => [k, snapshot[k]])),
    };

    const row: Record<string, any> = {
      id: `fr-${Date.now()}`,
      name: typeDef.name,
      type: typeDef.key,
      period_date: todayStr(),
      generated_by: user?.name || user?.username || 'system',
      status: 'ready',
      payload,
    };
    if (propertyId) row.property_id = propertyId;

    const { data, error } = await supabaseAdmin!
      .from('ops_flash_reports')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ ok: true, report: data });
  } catch (e: any) {
    console.error('[ops-flash] POST failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to generate report' });
  }
});

router.delete('/flash-reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { error } = await supabaseAdmin!
      .from('ops_flash_reports')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[ops-flash] DELETE failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to delete report' });
  }
});

export default router;
