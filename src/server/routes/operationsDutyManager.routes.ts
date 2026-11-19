/**
 * Operations Duty Manager routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/duty-manager tab (DutyManagerWorkspace.tsx).
 *
 *   GET  /duty-manager?propertyId=&shift=&date=
 *        Shift-scoped workspace: logbook entries + walkthrough checklist
 *        for the selected shift/date (migration 633), cross-shift live
 *        views of Guest Issues (real `guest_requests` — same records the
 *        Front Office portal manages) and Incidents (real `sec_incidents`
 *        — the Security portal's records), plus recent shift handovers.
 *
 *   POST /duty-manager/log                       — append a logbook entry
 *   PATCH /duty-manager/walkthrough/:id          — check item status/notes
 *   POST /duty-manager/handovers                 — create handover
 *        (open_items auto-collected from open guest requests, unresolved
 *        incidents, and walkthrough items flagged as issues)
 *   POST /duty-manager/handovers/:id/acknowledge — incoming manager ack
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

const CACHE_TTL_MS = 15 * 1000;
const SHIFTS = ['Morning', 'Afternoon', 'Evening', 'Night'] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-duty-manager] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-duty-manager] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// Standard walkthrough checklist — auto-seeded per property+shift+date
// (deterministic ids, ignoreDuplicates → concurrency-safe), same pattern
// as the morning-meeting template agenda.
const WALKTHROUGH_TEMPLATE: Array<{ area: string; item: string }> = [
  { area: 'Lobby', item: 'Front desk cleanliness' },
  { area: 'Lobby', item: 'Entrance doors condition' },
  { area: 'Lobby', item: 'Seating area arrangement' },
  { area: 'Restaurant', item: 'Buffet setup readiness' },
  { area: 'Restaurant', item: 'Kitchen cleanliness' },
  { area: 'Pool Area', item: 'Water quality check' },
  { area: 'Pool Area', item: 'Safety equipment inspection' },
  { area: 'Parking', item: 'Lighting check' },
  { area: 'Parking', item: 'Security patrol log' },
];

// guest_requests.status → open | in-progress | resolved
const normIssueStatus = (s: any): 'open' | 'in-progress' | 'resolved' => {
  const v = String(s || '').toLowerCase();
  if (v === 'completed' || v === 'resolved' || v === 'closed') return 'resolved';
  if (v === 'in progress' || v === 'assigned') return 'in-progress';
  return 'open';
};

const normIssuePriority = (p: any): 'low' | 'medium' | 'high' => {
  const v = String(p || '').toLowerCase();
  if (v === 'urgent' || v === 'high' || v === 'critical') return 'high';
  if (v === 'low') return 'low';
  return 'medium';
};

// sec_incidents.status → open | investigating | resolved
const normIncidentStatus = (s: any): 'open' | 'investigating' | 'resolved' => {
  const v = String(s || '').toLowerCase();
  if (v === 'resolved' || v === 'closed') return 'resolved';
  if (v === 'investigation' || v === 'in progress' || v === 'corrective action') return 'investigating';
  return 'open';
};

// sec_incidents.priority → minor | moderate | major | critical
const normSeverity = (p: any): 'minor' | 'moderate' | 'major' | 'critical' => {
  const v = String(p || '').toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high' || v === 'urgent') return 'major';
  if (v === 'low') return 'minor';
  return 'moderate';
};

// GET /api/ops-portal/duty-manager — full workspace snapshot.
router.get('/duty-manager', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const shift = SHIFTS.includes(req.query.shift as any) ? String(req.query.shift) : 'Morning';
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const cacheKey = `ops-duty:${propertyId || 'all'}:${shift}:${date}`;

  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  const eqProp = (q: any): any => propertyId ? q.eq('property_id', propertyId) : q;

  try {
    // Seed the standard walkthrough checklist only if this shift+date has
    // no items yet (avoids duplicating alongside seeded/other rows).
    const { count: walkCount } = await eqProp(supabaseAdmin
      .from('ops_walkthrough_items')
      .select('id', { count: 'exact', head: true })
      .eq('shift_date', date).eq('shift', shift));
    if ((walkCount ?? 0) === 0) {
      const tplRows = WALKTHROUGH_TEMPLATE.map((t, i) => ({
        id: `ops-walk-${propertyId || 'global'}-${date}-${shift}-${i}`,
        property_id: propertyId || null,
        shift_date: date,
        shift,
        area: t.area,
        item: t.item,
        sort_order: i,
      }));
      const { error: seedErr } = await supabaseAdmin
        .from('ops_walkthrough_items')
        .upsert(tplRows, { onConflict: 'id', ignoreDuplicates: true });
      if (seedErr) console.warn(`[ops-duty-manager] walkthrough seed: ${seedErr.message}`);
    }

    const [logRows, issueRows, incidentRows, walkRows, handoverRows] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('ops_shift_log_entries')
        .select('*').eq('shift_date', date).eq('shift', shift)
        .order('created_at', { ascending: false })), 'ops_shift_log_entries'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
        .select('id, request_number, room_number, guest_name, request_type, description, priority, status, assigned_to, assigned_department, submitted_at')
        .order('submitted_at', { ascending: false })), 'guest_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
        .select('id, incident_type, description, location, priority, status, reported_at, reported_by')
        .order('reported_at', { ascending: false })), 'sec_incidents'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_walkthrough_items')
        .select('*').eq('shift_date', date).eq('shift', shift)
        .order('sort_order', { ascending: true })), 'ops_walkthrough_items'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_shift_handovers')
        .select('*').order('created_at', { ascending: false }).limit(20)), 'ops_shift_handovers'),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      shift,
      date,
      shiftLogs: logRows.map((r: any) => ({
        id: r.id, timestamp: r.created_at, category: r.category,
        description: r.description, author: r.author, priority: r.priority,
      })),
      guestIssues: issueRows.map((r: any) => ({
        id: r.id, roomNumber: r.room_number, guestName: r.guest_name,
        issue: r.description || r.request_type,
        type: r.request_type,
        status: normIssueStatus(r.status),
        priority: normIssuePriority(r.priority),
        reportedAt: r.submitted_at,
        assignedTo: r.assigned_to || r.assigned_department || undefined,
      })),
      incidents: incidentRows.map((r: any) => ({
        id: r.id, type: r.incident_type, description: r.description,
        location: r.location, severity: normSeverity(r.priority),
        status: normIncidentStatus(r.status),
        reportedAt: r.reported_at, reportedBy: r.reported_by,
      })),
      walkthrough: walkRows.map((r: any) => ({
        id: r.id, area: r.area, item: r.item, status: r.status,
        notes: r.notes, completedAt: r.completed_at, completedBy: r.completed_by,
      })),
      handovers: handoverRows.map((r: any) => ({
        id: r.id, fromManager: r.from_manager, toManager: r.to_manager,
        shiftDate: r.shift_date, shiftPeriod: `${r.from_shift} to ${r.to_shift}`,
        summary: r.summary, openItems: r.open_items || [],
        acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
        createdAt: r.created_at, createdBy: r.created_by,
      })),
      stats: {
        openIssues: issueRows.filter(r => normIssueStatus(r.status) !== 'resolved').length,
        openIncidents: incidentRows.filter(r => normIncidentStatus(r.status) !== 'resolved').length,
        walkthroughDone: walkRows.filter(r => r.status === 'completed').length,
        walkthroughTotal: walkRows.length,
      },
    };

    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load duty manager workspace' });
  }
});

// POST /api/ops-portal/duty-manager/log — append a logbook entry.
router.post('/duty-manager/log', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, shift, date, category, description, priority } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
  if (!SHIFTS.includes(shift)) return res.status(400).json({ error: 'invalid shift' });
  if (!['low', 'medium', 'high'].includes(priority)) return res.status(400).json({ error: 'invalid priority' });

  const { data, error } = await supabaseAdmin.from('ops_shift_log_entries').insert({
    id: crypto.randomUUID(),
    property_id: propertyId || null,
    shift_date: date || new Date().toISOString().slice(0, 10),
    shift,
    category: category || 'General',
    description: description.trim(),
    author: req.user?.name || 'Duty Manager',
    priority,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-duty:*');
  return res.status(201).json({ ok: true, entry: data });
});

// PATCH /api/ops-portal/duty-manager/walkthrough/:id — set status/notes.
router.patch('/duty-manager/walkthrough/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, notes } = req.body || {};
  if (!['pending', 'completed', 'issue'].includes(status)) {
    return res.status(400).json({ error: "status must be 'pending', 'completed' or 'issue'" });
  }

  const update: Record<string, any> = { status };
  if (notes !== undefined) update.notes = notes;
  if (status === 'completed') {
    update.completed_at = new Date().toISOString();
    update.completed_by = req.user?.name || 'Duty Manager';
  } else {
    update.completed_at = null;
    update.completed_by = null;
  }

  const { error } = await supabaseAdmin
    .from('ops_walkthrough_items').update(update).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-duty:*');
  return res.json({ ok: true });
});

// POST /api/ops-portal/duty-manager/handovers — create a handover with
// open_items auto-collected from live data.
router.post('/duty-manager/handovers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, date, fromShift, toShift, toManager, summary } = req.body || {};
  if (!SHIFTS.includes(fromShift) || !SHIFTS.includes(toShift)) {
    return res.status(400).json({ error: 'invalid shift' });
  }
  if (!toManager?.trim()) return res.status(400).json({ error: 'toManager is required' });

  const eqProp = (q: any): any => propertyId ? q.eq('property_id', propertyId) : q;
  const theDate = date || new Date().toISOString().slice(0, 10);

  // Auto-collect open items: open guest requests, unresolved incidents,
  // walkthrough issues for this shift/date.
  const [openIssues, openIncidents, walkIssues] = await Promise.all([
    fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
      .select('room_number, request_type, description')
      .not('status', 'in', '("Completed","Resolved","Closed")')
      .limit(10)), 'open guest requests'),
    fetchRows(eqProp(supabaseAdmin!.from('sec_incidents')
      .select('incident_type, location')
      .not('status', 'in', '("Resolved","Closed")')
      .limit(10)), 'open incidents'),
    fetchRows(eqProp(supabaseAdmin!.from('ops_walkthrough_items')
      .select('area, item').eq('shift_date', theDate).eq('shift', fromShift).eq('status', 'issue')), 'walkthrough issues'),
  ]);

  const openItems = [
    ...openIssues.map(r => `Guest request — Room ${r.room_number || '?'}: ${r.description || r.request_type}`),
    ...openIncidents.map(r => `Incident — ${r.incident_type} @ ${r.location || '?'}`),
    ...walkIssues.map(r => `Walkthrough issue — ${r.area}: ${r.item}`),
  ];

  const fromManager = req.user?.name || 'Duty Manager';
  const { data, error } = await supabaseAdmin.from('ops_shift_handovers').insert({
    id: crypto.randomUUID(),
    property_id: propertyId || null,
    shift_date: theDate,
    from_shift: fromShift,
    to_shift: toShift,
    from_manager: fromManager,
    to_manager: toManager.trim(),
    summary: summary || `${openItems.length} open item(s) carried forward.`,
    open_items: openItems,
    created_by: fromManager,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-duty:*');
  return res.status(201).json({ ok: true, handover: data });
});

// POST /api/ops-portal/duty-manager/handovers/:id/acknowledge
router.post('/duty-manager/handovers/:id/acknowledge', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('ops_shift_handovers')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: req.user?.name || 'Duty Manager',
    })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-duty:*');
  return res.json({ ok: true });
});

export default router;
