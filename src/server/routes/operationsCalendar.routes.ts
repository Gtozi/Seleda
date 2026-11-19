/**
 * Operations Calendar routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/calandar tab (OperationalCalendar.tsx).
 *
 *   GET    /operational-calendar?propertyId=&from=&to=
 *          Aggregates calendar events across all portals into one
 *          normalized feed for the window [from, to]:
 *            banquet_events          → wedding | conference | event
 *            reservations (VIP)      → vip        (Front Office)
 *            pm_schedules            → maintenance (Engineering)
 *            hr_training_sessions    → training   (HR)
 *            fb/rms/sales promotions → promotion  (F&B, Revenue, Sales)
 *            sec_compliance_audits   → audit      (Security)
 *            fin_external_audits     → audit      (Finance)
 *            group_blocks            → group      (Front Office)
 *            ops_cross_dept_tasks    → task       (Operations)
 *            ops_calendar_events     → holidays, drills, manual items
 *          Rows from ops_calendar_events are `editable` (migration 635);
 *          portal-sourced rows are read-only projections.
 *
 *   POST   /operational-calendar/events       — create an ops event
 *   PATCH  /operational-calendar/events/:id   — update an ops event
 *   DELETE /operational-calendar/events/:id   — delete an ops event
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

const CACHE_TTL_MS = 20 * 1000;
const EVENT_TYPES = [
  'conference', 'wedding', 'holiday', 'vip', 'maintenance',
  'promotion', 'drill', 'training', 'audit', 'event', 'group', 'task',
] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-calendar] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-calendar] ${tag}: ${e?.message || e}`);
    return [];
  }
}

const eventTypeMap = (et: any): string => {
  const v = String(et || '').toLowerCase();
  if (v.includes('wedding')) return 'wedding';
  if (['conference', 'meeting', 'corporateevent', 'productlaunch', 'exhibition'].includes(v)) return 'conference';
  return 'event';
};

// GET /api/ops-portal/operational-calendar
router.get('/operational-calendar', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;

  // Default window: the month containing `date` (or today), padded a week.
  const anchor = String(req.query.date || new Date().toISOString().slice(0, 10));
  const firstOfMonth = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
  const from = req.query.from
    ? String(req.query.from)
    : new Date(firstOfMonth.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const to = req.query.to
    ? String(req.query.to)
    : new Date(new Date(firstOfMonth.getFullYear(), firstOfMonth.getUTCMonth() + 1, 0).getTime() + 7 * 864e5)
        .toISOString().slice(0, 10);

  const cacheKey = `ops-calendar:${propertyId || 'all'}:${from}:${to}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  const eqProp = (q: any): any => propertyId ? q.eq('property_id', propertyId) : q;
  const inRange = (col: string) => (q: any) => q.gte(col, from).lte(col, to);

  try {
    const [opsEvents, banquets, venues, vipGuests, vipRes, pmRows, trainings,
      fbPromos, rmsPromos, salesPromos, secAudits, finAudits, groups, tasks] = await Promise.all([
      fetchRows(eqProp(inRange('event_date')(supabaseAdmin!.from('ops_calendar_events')
        .select('*'))), 'ops_calendar_events'),
      fetchRows(eqProp(supabaseAdmin!.from('banquet_events')
        .select('id, event_name, event_type, event_date, end_date, guest_count, client_name, status, venue_ids')
        .not('status', 'in', '("Cancelled")')
        .lte('event_date', to).gte('end_date', from)), 'banquet_events'),
      fetchRows(supabaseAdmin!.from('banquet_venues').select('id, venue_name'), 'banquet_venues'),
      fetchRows(supabaseAdmin!.from('guests').select('id').eq('status', 'VIP'), 'vip guests'),
      fetchRows(eqProp(supabaseAdmin!.from('reservations')
        .select('id, guest_id, guest_name, check_in_date, room_type')
        .gte('check_in_date', from).lte('check_in_date', to)
        .not('status', 'in', '("Cancelled","NoShow","CheckedOut")')), 'vip reservations'),
      fetchRows(eqProp(supabaseAdmin!.from('pm_schedules')
        .select('id, schedule_name, frequency, next_due_date, assigned_technician, priority, status')
        .eq('status', 'Active')
        .gte('next_due_date', from).lte('next_due_date', to)), 'pm_schedules'),
      fetchRows(eqProp(supabaseAdmin!.from('hr_training_sessions')
        .select('id, title, type, staff_count, session_date, status')
        .gte('session_date', from).lte('session_date', to)), 'hr_training_sessions'),
      fetchRows(supabaseAdmin!.from('fb_promotions')
        .select('id, name, type, discount_description, start_date, end_date, status')
        .lte('start_date', to).gte('end_date', from), 'fb_promotions'),
      fetchRows(eqProp(supabaseAdmin!.from('rms_promotions')
        .select('id, name, code, promo_type, start_date, end_date, status')
        .lte('start_date', to).gte('end_date', from)), 'rms_promotions'),
      fetchRows(eqProp(supabaseAdmin!.from('sales_promotions')
        .select('id, name, type, code, start_date, end_date, status')
        .lte('start_date', to).gte('end_date', from)), 'sales_promotions'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_compliance_audits')
        .select('id, title, audit_type, auditor, scheduled_at, status')
        .gte('scheduled_at', `${from}T00:00:00Z`).lte('scheduled_at', `${to}T23:59:59Z`)), 'sec_compliance_audits'),
      fetchRows(eqProp(supabaseAdmin!.from('fin_external_audits')
        .select('id, audit_number, firm, audit_type, start_date, end_date, status')
        .lte('start_date', to).gte('end_date', from)), 'fin_external_audits'),
      fetchRows(eqProp(supabaseAdmin!.from('group_blocks')
        .select('id, block_name, arrival_date, departure_date, blocked_rooms, total_rooms, status')
        .gte('arrival_date', from).lte('arrival_date', to)
        .not('status', 'in', '("Closed","Cancelled","Released")')), 'group_blocks'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_cross_dept_tasks')
        .select('id, title, description, type, start_at, end_at, status')
        .gte('start_at', `${from}T00:00:00Z`).lte('start_at', `${to}T23:59:59Z`)), 'ops_cross_dept_tasks'),
    ]);

    const venueName = new Map(venues.map((v: any) => [v.id, v.venue_name]));
    const vipIds = new Set(vipGuests.map((g: any) => g.id));
    const events: any[] = [];

    for (const r of opsEvents) {
      events.push({
        id: `cal-${r.id}`, sourceId: r.id, title: r.title,
        date: r.event_date, endDate: r.end_date || undefined,
        type: r.type, location: r.location, attendees: r.attendees,
        description: r.description, source: 'Operations', editable: true,
      });
    }

    for (const e of banquets) {
      const loc = (e.venue_ids || []).map((id: string) => venueName.get(id)).filter(Boolean).join(', ');
      events.push({
        id: `be-${e.id}`, title: e.event_name,
        date: e.event_date, endDate: e.end_date || undefined,
        type: eventTypeMap(e.event_type),
        location: loc || undefined,
        attendees: e.guest_count || e.expected_attendees || undefined,
        description: `${e.event_type || 'Event'} for ${e.client_name || 'client'} — status ${e.status}`,
        source: 'Events portal', editable: false,
      });
    }

    for (const r of vipRes) {
      if (!vipIds.has(r.guest_id)) continue;
      events.push({
        id: `vip-${r.id}`, title: `VIP Arrival — ${r.guest_name || 'Guest'}`,
        date: r.check_in_date, type: 'vip',
        location: r.room_type || undefined,
        description: 'VIP guest arrival — coordinate room readiness, amenities and security.',
        source: 'Front Office', editable: false,
      });
    }

    for (const p of pmRows) {
      events.push({
        id: `pm-${p.id}`, title: `PM — ${p.schedule_name}`,
        date: p.next_due_date, type: 'maintenance',
        description: `${p.frequency || 'Scheduled'} preventive maintenance${p.assigned_technician ? ` · ${p.assigned_technician}` : ''}`,
        source: 'Engineering portal', editable: false,
      });
    }

    for (const t of trainings) {
      events.push({
        id: `tr-${t.id}`, title: t.title,
        date: t.session_date, type: 'training',
        attendees: t.staff_count || undefined,
        description: `${t.type || 'Training'} session — status ${t.status}`,
        source: 'HR portal', editable: false,
      });
    }

    for (const [rows, source] of [
      [fbPromos, 'F&B portal'], [rmsPromos, 'Revenue'], [salesPromos, 'Sales'],
    ] as Array<[any[], string]>) {
      for (const p of rows) {
        events.push({
          id: `promo-${source}-${p.id}`, title: p.name,
          date: p.start_date, endDate: p.end_date || undefined, type: 'promotion',
          description: p.discount_description || `${p.type || p.promo_type || 'Promotion'}${p.code ? ` · code ${p.code}` : ''} — ${p.status}`,
          source, editable: false,
        });
      }
    }

    for (const a of secAudits) {
      events.push({
        id: `sec-audit-${a.id}`, title: a.title || `${a.audit_type || 'Compliance'} audit`,
        date: String(a.scheduled_at).slice(0, 10), type: 'audit',
        description: `${a.audit_type || 'Audit'}${a.auditor ? ` · auditor ${a.auditor}` : ''} — ${a.status}`,
        source: 'Security portal', editable: false,
      });
    }

    for (const a of finAudits) {
      events.push({
        id: `fin-audit-${a.id}`, title: `${a.firm || 'External'} ${a.audit_type || 'audit'} (${a.audit_number || ''})`.trim(),
        date: a.start_date, endDate: a.end_date || undefined, type: 'audit',
        description: `${a.scope || 'External audit'} — ${a.status}`,
        source: 'Finance portal', editable: false,
      });
    }

    for (const g of groups) {
      events.push({
        id: `grp-${g.id}`, title: `Group Check-in — ${g.block_name}`,
        date: g.arrival_date, endDate: g.departure_date || undefined, type: 'group',
        attendees: g.blocked_rooms || g.total_rooms || undefined,
        description: `${g.blocked_rooms || g.total_rooms || '?'} rooms · status ${g.status}`,
        source: 'Front Office', editable: false,
      });
    }

    for (const t of tasks) {
      events.push({
        id: `task-${t.id}`, title: t.title,
        date: String(t.start_at).slice(0, 10), endDate: t.end_at ? String(t.end_at).slice(0, 10) : undefined,
        type: 'task',
        description: t.description || `Cross-department task — ${t.status}`,
        source: 'Operations', editable: false,
      });
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      from, to,
      events: events.sort((a, b) => String(a.date).localeCompare(String(b.date))),
      stats: {
        total: events.length,
        byType: events.reduce((m: Record<string, number>, e) => {
          m[e.type] = (m[e.type] || 0) + 1; return m;
        }, {}),
      },
    };

    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load calendar' });
  }
});

// POST /api/ops-portal/operational-calendar/events — create ops event.
router.post('/operational-calendar/events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.title?.trim() || !b.date) return res.status(400).json({ error: 'title and date are required' });
  if (b.type && !EVENT_TYPES.includes(b.type)) return res.status(400).json({ error: 'invalid type' });

  const { data, error } = await supabaseAdmin.from('ops_calendar_events').insert({
    id: crypto.randomUUID(),
    property_id: b.propertyId || null,
    title: b.title.trim(),
    event_date: b.date,
    end_date: b.endDate || null,
    type: b.type || 'event',
    location: b.location || null,
    attendees: b.attendees != null ? Number(b.attendees) : null,
    description: b.description || null,
    created_by: req.user?.name || 'manager',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-calendar:*');
  return res.status(201).json({ ok: true, event: data });
});

// PATCH /api/ops-portal/operational-calendar/events/:id
router.patch('/operational-calendar/events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const update: Record<string, any> = {};
  if (b.title !== undefined) update.title = b.title;
  if (b.date !== undefined) update.event_date = b.date;
  if (b.endDate !== undefined) update.end_date = b.endDate;
  if (b.type !== undefined) {
    if (!EVENT_TYPES.includes(b.type)) return res.status(400).json({ error: 'invalid type' });
    update.type = b.type;
  }
  if (b.location !== undefined) update.location = b.location;
  if (b.attendees !== undefined) update.attendees = b.attendees;
  if (b.description !== undefined) update.description = b.description;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'nothing to update' });

  const { data, error } = await supabaseAdmin
    .from('ops_calendar_events').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-calendar:*');
  return res.json({ ok: true, event: data });
});

// DELETE /api/ops-portal/operational-calendar/events/:id
router.delete('/operational-calendar/events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('ops_calendar_events').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-calendar:*');
  return res.json({ ok: true });
});

export default router;
