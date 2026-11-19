/**
 * Operations Command Center routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/command-center tab (OperationsCommandCenter.tsx).
 *
 * Two endpoints:
 *   GET  /command-center?propertyId=          live cross-department overview
 *   POST /command-center/alerts/:id/acknowledge
 *
 * The overview is computed live from the *real* tables of the other portals —
 * housekeeping tasks, engineering work orders, security incidents, transport,
 * spa, F&B orders, laundry, banquet events, guest requests, inventory stock —
 * so the command center reflects the whole system instead of a static fixture.
 *
 * The alert feed is persisted in public.ops_command_alerts (migration 627):
 * the GET endpoint runs a generator (same pattern as the HK dashboard alert
 * engine in housekeepingPortal.routes.ts) that upserts deterministic
 * 'ops-gen-*' rows and auto-resolves generated alerts whose trigger cleared.
 * Seed rows ('ops-seed-*', source='seed') are never auto-resolved.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

const CACHE_TTL_MS = 20 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Types ────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'info';
type DeptStatus = 'operational' | 'degraded' | 'critical' | 'offline';

interface DeptCard {
  key: string;
  deptKey: string;
  name: string;
  status: DeptStatus;
  statusText: string;
  activeIssues: number;
  lastUpdate: string | null;
}

interface AlertDraft {
  id: string;
  severity: Severity;
  category: string;
  message: string;
  department: string;
}

// ── Fetch helper — a missing/renamed table is non-fatal ──────────────────

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-command-center] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-command-center] ${tag}: ${e?.message || e}`);
    return [];
  }
}

interface Sources {
  guestRequests: any[];
  reservations: any[];
  hkTasks: any[];
  hkMaintIssues: any[];
  workOrders: any[];
  correctiveTasks: any[];
  fbOrders: any[];
  laundryJobs: any[];
  spaAppointments: any[];
  spaAlerts: any[];
  secIncidents: any[];
  transMaintRequests: any[];
  transIncidents: any[];
  banquetEvents: any[];
  inventoryItems: any[];
}

// Load every source table in one parallel batch. Tables that carry a
// property_id column are scoped when ?propertyId= is given; global tables
// (orders, banquet_events) are not scoped.
async function loadSources(propertyId: string | undefined): Promise<Sources> {
  const eqProp = <T extends { eq: (c: string, v: string) => T }>(q: T, hasCol = true): T =>
    propertyId && hasCol ? q.eq('property_id', propertyId) : q;

  const [
    guestRequests, reservations, hkTasks, hkMaintIssues, workOrders,
    correctiveTasks, fbOrders, laundryJobs, spaAppointments, spaAlerts,
    secIncidents, transMaintRequests, transIncidents, banquetEvents,
    inventoryItems,
  ] = await Promise.all([
    fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('id, request_number, guest_name, room_number, request_type, description, priority, status, assigned_department, property_id, created_at')), 'guest_requests'),
    fetchRows(eqProp(supabaseAdmin!.from('reservations')
      .select('id, check_in_date, status, property_id')), 'reservations'),
    fetchRows(eqProp(supabaseAdmin!.from('housekeeping_task_mgmt')
      .select('id, type, status, location, due_date, priority, property_id, updated_at')), 'housekeeping_task_mgmt'),
    fetchRows(eqProp(supabaseAdmin!.from('housekeeping_maintenance_issues')
      .select('id, type, stage, room, property_id, updated_at')), 'housekeeping_maintenance_issues'),
    fetchRows(eqProp(supabaseAdmin!.from('work_orders')
      .select('id, wo_number, title, status, priority, room_number, property_id, created_date')), 'work_orders'),
    fetchRows(eqProp(supabaseAdmin!.from('corrective_maintenance_tasks')
      .select('id, cm_number, status, priority, location, property_id, updated_at')), 'corrective_maintenance_tasks'),
    fetchRows(supabaseAdmin!.from('orders')
      .select('id, status, created_at'), 'orders'),
    fetchRows(eqProp(supabaseAdmin!.from('hk_laundry_jobs')
      .select('id, status, property_id, updated_at')), 'hk_laundry_jobs'),
    fetchRows(eqProp(supabaseAdmin!.from('spa_appointments')
      .select('id, status, appointment_date, property_id')), 'spa_appointments'),
    fetchRows(eqProp(supabaseAdmin!.from('spa_alerts')
      .select('id, alert_type, message, severity, is_read, property_id, created_at')), 'spa_alerts'),
    fetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
      .select('id, incident_type, status, priority, location, property_id, reported_at')), 'sec_incidents'),
    fetchRows(eqProp(supabaseAdmin!.from('transport_maintenance_requests')
      .select('id, request_number, type, status, priority, property_id')), 'transport_maintenance_requests'),
    fetchRows(eqProp(supabaseAdmin!.from('transport_incidents')
      .select('id, incident_number, type, severity, status, property_id, occurred_at')), 'transport_incidents'),
    fetchRows(supabaseAdmin!.from('banquet_events')
      .select('id, event_name, event_date, status'), 'banquet_events'),
    fetchRows(eqProp(supabaseAdmin!.from('inventory_items')
      .select('id, name, current_quantity, reorder_point, property_id, is_active')), 'inventory_items'),
  ]);

  return {
    guestRequests, reservations, hkTasks, hkMaintIssues, workOrders,
    correctiveTasks, fbOrders, laundryJobs, spaAppointments, spaAlerts,
    secIncidents, transMaintRequests, transIncidents, banquetEvents,
    inventoryItems,
  };
}

// ── Small shared predicates ──────────────────────────────────────────────

const WO_CLOSED = new Set(['Completed', 'Verified', 'Closed', 'Cancelled']);
const CM_CLOSED = new Set(['Completed', 'Verified']);
const HK_TASK_CLOSED = new Set(['Completed', 'Verified']);
const HK_MAINT_CLOSED = new Set(['Completed', 'Verified', 'Room Released']);
const GREQ_CLOSED = new Set(['completed', 'cancelled', 'closed', 'resolved']);
const SEC_CLOSED = new Set(['Resolved', 'Closed']);
const TRANS_INC_CLOSED = new Set(['Resolved', 'Closed']);
const TRANS_MAINT_CLOSED = new Set(['Completed', 'Cancelled']);
const LAUNDRY_CLOSED = new Set(['Delivered', 'Cancelled']);
const ORDER_OPEN = new Set(['Open', 'Sent']);
const HIGH_PRI = new Set(['high', 'urgent', 'emergency', 'critical']);
const CRIT_PRI = new Set(['urgent', 'emergency', 'critical']);

const isOpenGuestRequest = (g: any) => !GREQ_CLOSED.has(String(g.status || '').toLowerCase());
const isHighPriority = (p: any) => HIGH_PRI.has(String(p || '').toLowerCase());
const isCriticalPriority = (p: any) => CRIT_PRI.has(String(p || '').toLowerCase());

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function latestStamp(rows: any[], fields: string[]): string | null {
  let best = 0;
  for (const r of rows) {
    for (const f of fields) {
      const t = r?.[f] ? new Date(r[f]).getTime() : NaN;
      if (!isNaN(t) && t > best) best = t;
    }
  }
  return best > 0 ? new Date(best).toISOString() : null;
}

// ── Alert generator — scans live sources, upserts ops-gen-* rows, resolves
//    generated alerts whose trigger condition cleared. ────────────────────

async function regenerateOpsAlerts(src: Sources, propertyId: string | undefined): Promise<void> {
  if (!supabaseAdmin) return;

  const drafts: AlertDraft[] = [];
  const now = Date.now();
  const MAX_PER_KIND = 10;

  // Engineering — open work orders at Emergency/Critical/High priority.
  const urgentWOs = src.workOrders
    .filter(w => !WO_CLOSED.has(w.status) && isHighPriority(w.priority))
    .slice(0, MAX_PER_KIND);
  for (const w of urgentWOs) {
    drafts.push({
      id: `ops-gen-eng-wo-${w.id}`,
      severity: isCriticalPriority(w.priority) ? 'critical' : 'warning',
      category: 'Work Order',
      message: `${w.wo_number || w.id}: ${w.title || 'Work order'} (${w.status})${w.room_number ? ` — room ${w.room_number}` : ''}`,
      department: 'Engineering',
    });
  }

  // Engineering — active corrective maintenance at Emergency priority.
  const urgentCMs = src.correctiveTasks
    .filter(c => !CM_CLOSED.has(c.status) && isCriticalPriority(c.priority))
    .slice(0, MAX_PER_KIND);
  for (const c of urgentCMs) {
    drafts.push({
      id: `ops-gen-eng-cm-${c.id}`,
      severity: 'critical',
      category: 'Corrective Maintenance',
      message: `${c.cm_number || c.id}: ${c.location || 'unlocated'} — ${c.status}`,
      department: 'Engineering',
    });
  }

  // Housekeeping — overdue tasks.
  const overdueTasks = src.hkTasks
    .filter(t => !HK_TASK_CLOSED.has(t.status) && t.due_date && !isNaN(new Date(t.due_date).getTime()) && new Date(t.due_date).getTime() < now)
    .slice(0, MAX_PER_KIND);
  for (const t of overdueTasks) {
    drafts.push({
      id: `ops-gen-hk-task-${t.id}`,
      severity: 'warning',
      category: 'Task Overdue',
      message: `${t.type || 'Housekeeping task'} at ${t.location || 'unlocated'} overdue (due ${t.due_date})`,
      department: 'Housekeeping',
    });
  }

  // Housekeeping — maintenance issues waiting on engineering.
  const hkMaint = src.hkMaintIssues
    .filter(m => m.stage === 'Reported' || m.stage === 'Assigned to Engineering')
    .slice(0, MAX_PER_KIND);
  for (const m of hkMaint) {
    drafts.push({
      id: `ops-gen-hk-maint-${m.id}`,
      severity: 'warning',
      category: 'Maintenance Coordination',
      message: `${m.type || 'Maintenance'} issue in room ${m.room || '?'} (${m.stage})`,
      department: 'Housekeeping',
    });
  }

  // Front Office / assigned departments — urgent open guest requests.
  const urgentGreqs = src.guestRequests
    .filter(g => isOpenGuestRequest(g) && isHighPriority(g.priority))
    .slice(0, MAX_PER_KIND);
  for (const g of urgentGreqs) {
    drafts.push({
      id: `ops-gen-fo-greq-${g.id}`,
      severity: isCriticalPriority(g.priority) ? 'critical' : 'warning',
      category: 'Guest Escalation',
      message: `${g.request_type || 'Guest request'}${g.room_number ? ` — room ${g.room_number}` : ''}: ${g.description || g.guest_name || 'open request'}`,
      department: g.assigned_department || 'Front Office',
    });
  }

  // Security — active incidents.
  const activeSec = src.secIncidents
    .filter(i => !SEC_CLOSED.has(i.status))
    .slice(0, MAX_PER_KIND);
  for (const i of activeSec) {
    drafts.push({
      id: `ops-gen-sec-inc-${i.id}`,
      severity: isCriticalPriority(i.priority) ? 'critical' : 'warning',
      category: 'Security Incident',
      message: `${i.incident_type || 'Security incident'} at ${i.location || 'unlocated'} (${i.status})`,
      department: 'Security',
    });
  }

  // Transportation — unresolved incidents + open maintenance requests.
  const transInc = src.transIncidents
    .filter(i => !TRANS_INC_CLOSED.has(i.status))
    .slice(0, MAX_PER_KIND);
  for (const i of transInc) {
    drafts.push({
      id: `ops-gen-trn-inc-${i.id}`,
      severity: String(i.severity || '') === 'Critical' ? 'critical' : 'warning',
      category: 'Transport Incident',
      message: `${i.type || 'Transport incident'} (${i.status})${i.incident_number ? ` — ${i.incident_number}` : ''}`,
      department: 'Transportation',
    });
  }
  const transMaint = src.transMaintRequests
    .filter(m => !TRANS_MAINT_CLOSED.has(m.status))
    .slice(0, MAX_PER_KIND);
  for (const m of transMaint) {
    drafts.push({
      id: `ops-gen-trn-maint-${m.id}`,
      severity: 'warning',
      category: 'Vehicle Maintenance',
      message: `${m.type || 'Vehicle maintenance'} (${m.status})${m.request_number ? ` — ${m.request_number}` : ''}`,
      department: 'Transportation',
    });
  }

  // Spa — unread alerts raised by the spa portal itself.
  const unreadSpa = src.spaAlerts
    .filter(a => !a.is_read && String(a.severity || '') !== 'Info')
    .slice(0, MAX_PER_KIND);
  for (const a of unreadSpa) {
    drafts.push({
      id: `ops-gen-spa-${a.id}`,
      severity: String(a.severity || '') === 'Critical' ? 'critical' : 'warning',
      category: 'Spa Alert',
      message: a.message || a.alert_type || 'Spa alert',
      department: 'Spa',
    });
  }

  // F&B — orders fired to the kitchen and still unserved after 45 min.
  const staleOrders = src.fbOrders
    .filter(o => o.status === 'Sent' && o.created_at && now - new Date(o.created_at).getTime() > 45 * 60 * 1000)
    .slice(0, MAX_PER_KIND);
  for (const o of staleOrders) {
    drafts.push({
      id: `ops-gen-fb-order-${o.id}`,
      severity: 'warning',
      category: 'Kitchen Delay',
      message: `Order ${o.id} in prep for over 45 minutes`,
      department: 'Food & Beverage',
    });
  }

  // Inventory — items at/below reorder level (single aggregate alert).
  const lowStock = src.inventoryItems
    .filter(i => i.is_active !== false && Number(i.reorder_point) > 0 && Number(i.current_quantity) <= Number(i.reorder_point));
  if (lowStock.length > 0) {
    drafts.push({
      id: 'ops-gen-inv-lowstock',
      severity: 'warning',
      category: 'Low Stock',
      message: `${lowStock.length} inventory item${lowStock.length === 1 ? '' : 's'} at or below reorder level`,
      department: 'Inventory',
    });
  }

  // Fetch existing generated rows to decide upsert vs. resolve. Seed rows
  // (source='seed') are never touched by the generator.
  let existingQ = supabaseAdmin.from('ops_command_alerts')
    .select('id, status')
    .eq('source', 'generated')
    .in('status', ['Active', 'Acknowledged']);
  if (propertyId) existingQ = existingQ.eq('property_id', propertyId);
  const { data: existing } = await existingQ;
  const existingIds = new Set((existing || []).map((e: any) => e.id));
  const draftIds = new Set(drafts.map(d => d.id));

  const toUpsert = drafts.filter(d => !existingIds.has(d.id));
  if (toUpsert.length > 0) {
    await supabaseAdmin.from('ops_command_alerts').upsert(
      toUpsert.map(d => ({
        id: d.id,
        property_id: propertyId || null,
        severity: d.severity,
        category: d.category,
        message: d.message,
        department: d.department,
        status: 'Active',
        source: 'generated',
      })),
      { onConflict: 'id' }
    );
  }

  const toResolve = [...existingIds].filter(id => !draftIds.has(id));
  if (toResolve.length > 0) {
    await supabaseAdmin.from('ops_command_alerts')
      .update({ status: 'Resolved' })
      .in('id', toResolve)
      .eq('source', 'generated');
  }
}

// ── Department status computation ────────────────────────────────────────

function computeDepartments(src: Sources): DeptCard[] {
  const today = todayStr();
  const now = Date.now();

  const openGreqs = src.guestRequests.filter(isOpenGuestRequest);
  const foGreqs = openGreqs.filter(g =>
    !g.assigned_department ||
    ['fo', 'front office', 'frontoffice'].includes(String(g.assigned_department).toLowerCase()));
  const conciergeGreqs = openGreqs.filter(g =>
    String(g.assigned_department || '').toLowerCase().includes('concierge'));
  const arrivalsToday = src.reservations.filter(r =>
    r.check_in_date === today && String(r.status || '').toLowerCase() !== 'cancelled');

  const openHkTasks = src.hkTasks.filter(t => !HK_TASK_CLOSED.has(t.status));
  const overdueHkTasks = openHkTasks.filter(t =>
    t.due_date && !isNaN(new Date(t.due_date).getTime()) && new Date(t.due_date).getTime() < now);
  const openHkMaint = src.hkMaintIssues.filter(m => !HK_MAINT_CLOSED.has(m.stage));

  const openWOs = src.workOrders.filter(w => !WO_CLOSED.has(w.status));
  const critWOs = openWOs.filter(w => isCriticalPriority(w.priority));
  const highWOs = openWOs.filter(w => isHighPriority(w.priority));
  const activeCMs = src.correctiveTasks.filter(c => !CM_CLOSED.has(c.status));
  const critCMs = activeCMs.filter(c => isCriticalPriority(c.priority));

  const openOrders = src.fbOrders.filter(o => ORDER_OPEN.has(o.status));
  const kitchenTickets = src.fbOrders.filter(o => o.status === 'Sent');

  const activeLaundry = src.laundryJobs.filter(j => !LAUNDRY_CLOSED.has(j.status));

  const todaySpa = src.spaAppointments.filter(a =>
    a.appointment_date === today && String(a.status || '') !== 'Cancelled');
  const unreadSpaAlerts = src.spaAlerts.filter(a => !a.is_read);
  const critSpaAlerts = unreadSpaAlerts.filter(a => String(a.severity || '') === 'Critical');

  const activeSec = src.secIncidents.filter(i => !SEC_CLOSED.has(i.status));
  const critSec = activeSec.filter(i => isCriticalPriority(i.priority));

  const openTransMaint = src.transMaintRequests.filter(m => !TRANS_MAINT_CLOSED.has(m.status));
  const openTransInc = src.transIncidents.filter(i => !TRANS_INC_CLOSED.has(i.status));
  const critTransInc = openTransInc.filter(i => String(i.severity || '') === 'Critical');

  const todayEvents = src.banquetEvents.filter(e =>
    e.event_date === today && ['Confirmed', 'InProgress'].includes(e.status));

  const lowStock = src.inventoryItems.filter(i =>
    i.is_active !== false && Number(i.reorder_point) > 0 && Number(i.current_quantity) <= Number(i.reorder_point));

  const card = (
    key: string, deptKey: string, name: string,
    opts: { issues: number; critical?: boolean; activity?: number; activityText?: string; lastUpdate?: string | null },
  ): DeptCard => ({
    key,
    deptKey,
    name,
    status: opts.critical ? 'critical' : opts.issues > 0 ? 'degraded' : 'operational',
    statusText:
      opts.issues > 0
        ? `${opts.issues} open issue${opts.issues === 1 ? '' : 's'}`
        : opts.activity && opts.activity > 0
          ? `${opts.activity} ${opts.activityText || 'active'}`
          : 'Normal Operations',
    activeIssues: opts.issues,
    lastUpdate: opts.lastUpdate ?? null,
  });

  return [
    card('frontoffice', 'frontoffice', 'Front Office', {
      issues: foGreqs.length,
      critical: foGreqs.some(g => isCriticalPriority(g.priority)),
      activity: arrivalsToday.length,
      activityText: `arrival${arrivalsToday.length === 1 ? '' : 's'} today`,
      lastUpdate: latestStamp(src.guestRequests, ['created_at']),
    }),
    card('housekeeping', 'housekeeping', 'Housekeeping', {
      issues: overdueHkTasks.length + openHkMaint.length,
      critical: overdueHkTasks.some(t => t.priority === 'Critical'),
      activity: openHkTasks.length,
      activityText: 'tasks in flight',
      lastUpdate: latestStamp(src.hkTasks, ['updated_at']),
    }),
    card('engineering', 'maintenance', 'Engineering', {
      issues: highWOs.length + activeCMs.length,
      critical: critWOs.length + critCMs.length > 0,
      activity: openWOs.length,
      activityText: 'work orders open',
      lastUpdate: latestStamp(src.workOrders, ['created_date']),
    }),
    card('fnb', 'f&b', 'Food & Beverage', {
      issues: 0,
      activity: openOrders.length,
      activityText: 'open orders',
      lastUpdate: latestStamp(src.fbOrders, ['created_at']),
    }),
    card('kitchen', 'f&b', 'Kitchen', {
      issues: 0,
      activity: kitchenTickets.length,
      activityText: 'tickets in prep',
      lastUpdate: latestStamp(kitchenTickets, ['created_at']),
    }),
    card('laundry', 'housekeeping', 'Laundry', {
      issues: 0,
      activity: activeLaundry.length,
      activityText: 'active jobs',
      lastUpdate: latestStamp(src.laundryJobs, ['updated_at']),
    }),
    card('spa', 'spa-wellness', 'Spa', {
      issues: unreadSpaAlerts.length,
      critical: critSpaAlerts.length > 0,
      activity: todaySpa.length,
      activityText: 'appointments today',
      lastUpdate: latestStamp(src.spaAlerts, ['created_at']),
    }),
    card('security', 'security', 'Security', {
      issues: activeSec.length,
      critical: critSec.length > 0,
      lastUpdate: latestStamp(src.secIncidents, ['reported_at']),
    }),
    card('transportation', 'transportation', 'Transportation', {
      issues: openTransMaint.length + openTransInc.length,
      critical: critTransInc.length > 0,
      lastUpdate: latestStamp([...src.transIncidents, ...src.transMaintRequests], ['occurred_at']),
    }),
    card('events', 'banquet-events', 'Events', {
      issues: 0,
      activity: todayEvents.length,
      activityText: `event${todayEvents.length === 1 ? '' : 's'} today`,
    }),
    card('concierge', 'concierge', 'Concierge', {
      issues: conciergeGreqs.length,
      activity: conciergeGreqs.length,
      activityText: 'open requests',
      lastUpdate: latestStamp(src.guestRequests, ['created_at']),
    }),
    card('inventory', 'inventory', 'Inventory', {
      issues: lowStock.length,
      activity: 0,
      lastUpdate: null,
    }),
  ];
}

// ── Routes ───────────────────────────────────────────────────────────────

// GET /api/ops-portal/command-center — live cross-department overview.
router.get('/command-center', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const cacheKey = `ops-command-center:${propertyId || 'all'}`;

  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const src = await loadSources(propertyId);

    // Alert generator first so the feed reflects this scan.
    await regenerateOpsAlerts(src, propertyId);

    let alertsQ = supabaseAdmin.from('ops_command_alerts')
      .select('id, severity, category, message, department, status, acknowledged_by, acknowledged_at, source, created_at')
      .neq('status', 'Resolved')
      .order('created_at', { ascending: false });
    if (propertyId) alertsQ = alertsQ.eq('property_id', propertyId);
    const { data: alertRows, error: alertsErr } = await alertsQ;
    if (alertsErr) return res.status(500).json({ error: alertsErr.message });

    const sevRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const alerts = (alertRows || [])
      .map((a: any) => ({
        id: a.id,
        type: a.severity as Severity,
        category: a.category,
        message: a.message,
        department: a.department,
        acknowledged: a.status === 'Acknowledged',
        acknowledgedBy: a.acknowledged_by || null,
        timestamp: a.created_at,
        source: a.source,
      }))
      .sort((a, b) =>
        (sevRank[a.type] ?? 3) - (sevRank[b.type] ?? 3) ||
        String(b.timestamp).localeCompare(String(a.timestamp)));

    const overview = {
      generatedAt: new Date().toISOString(),
      departments: computeDepartments(src),
      alerts,
    };

    cacheService.set(cacheKey, overview, CACHE_TTL_MS);
    return res.json(overview);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to build command center overview' });
  }
});

// POST /api/ops-portal/command-center/alerts/:id/acknowledge
router.post('/command-center/alerts/:id/acknowledge', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { data, error } = await supabaseAdmin
      .from('ops_command_alerts')
      .update({
        status: 'Acknowledged',
        acknowledged_by: req.user?.name || req.user?.id || null,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .neq('status', 'Resolved')
      .select('id, severity, category, message, department, status, acknowledged_by, acknowledged_at, source, created_at')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Alert not found' });

    cacheService.invalidate('ops-command-center:*');

    return res.json({
      id: data.id,
      type: data.severity,
      category: data.category,
      message: data.message,
      department: data.department,
      acknowledged: true,
      acknowledgedBy: data.acknowledged_by || null,
      timestamp: data.created_at,
      source: data.source,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to acknowledge alert' });
  }
});

export default router;
