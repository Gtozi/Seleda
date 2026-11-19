/**
 * Guest Recovery routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/guest-recovery tab (GuestRecovery.tsx).
 *
 *   GET    /guest-recovery?propertyId=
 *          Returns persisted recovery cases (ops_recovery_cases, mig. 637)
 *          plus a live "feedback intake" queue: guest_feedback rows with
 *          rating <= 3 that have no case yet — so complaints submitted via
 *          the FO feedback flow surface here automatically.
 *
 *   POST   /guest-recovery                    — create a case
 *   POST   /guest-recovery/from-feedback      — open a case from a feedback row
 *   PATCH  /guest-recovery/:id                — status/assignee/comp/action updates
 *   POST   /guest-recovery/:id/work-order     — create a real work_orders row
 *                                               (Engineering portal) and link it
 *   DELETE /guest-recovery/:id
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 15 * 1000;

const STATUSES = ['logged', 'investigating', 'compensation-pending', 'corrective-action', 'follow-up', 'guest-confirmation', 'closed'] as const;
const CATEGORIES = ['Maintenance', 'Housekeeping', 'F&B', 'Facilities', 'Front Office', 'Security', 'Spa', 'Other'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-recovery] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-recovery] ${tag}: ${e?.message || e}`);
    return [];
  }
}

const feedbackCategory = (c: any): string => {
  const v = String(c || '').toLowerCase();
  if (v.includes('maintenance') || v.includes('room') || v.includes('facilit')) return 'Maintenance';
  if (v.includes('clean') || v.includes('housekeep')) return 'Housekeeping';
  if (v.includes('food') || v.includes('dining') || v.includes('restaurant') || v.includes('f&b')) return 'F&B';
  if (v.includes('spa')) return 'Spa';
  if (v.includes('secur')) return 'Security';
  if (v.includes('service') || v.includes('staff') || v.includes('front')) return 'Front Office';
  return 'Other';
};

const normCase = (r: any) => ({
  id: r.id,
  guestName: r.guest_name,
  roomNumber: r.room_number,
  complaint: r.complaint,
  category: r.category,
  status: r.status,
  priority: r.priority,
  loggedAt: r.created_at,
  assignedTo: r.assigned_to || undefined,
  compensationAmount: r.compensation_amount != null ? Number(r.compensation_amount) : undefined,
  correctiveAction: r.corrective_action || undefined,
  followUpDate: r.follow_up_date || undefined,
  feedbackId: r.feedback_id || undefined,
  workOrderId: r.work_order_id || undefined,
  notes: r.notes || undefined,
  loggedBy: r.logged_by || undefined,
  closedAt: r.closed_at || undefined,
});

// GET /api/ops-portal/guest-recovery
router.get('/guest-recovery', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-recovery:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [cases, negativeFeedback] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('ops_recovery_cases')
        .select('*').order('created_at', { ascending: false })), 'cases'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_feedback')
        .select('id, property_id, reservation_id, guest_id, category, rating, comments, submitted_at')
        .lte('rating', 3)
        .order('submitted_at', { ascending: false })), 'feedback'),
    ]);

    const linkedFeedback = new Set(cases.map((c) => c.feedback_id).filter(Boolean));

    // Resolve guest names / room numbers for feedback rows.
    const guestIds = [...new Set(negativeFeedback.map((f) => f.guest_id).filter(Boolean))];
    const resIds = [...new Set(negativeFeedback.map((f) => f.reservation_id).filter(Boolean))];
    const [guestRows, resRows, woRows] = await Promise.all([
      guestIds.length
        ? fetchRows(supabaseAdmin!.from('guests').select('id, name').in('id', guestIds), 'fb guests')
        : Promise.resolve([]),
      resIds.length
        ? fetchRows(supabaseAdmin!.from('reservations').select('id, room_number').in('id', resIds), 'fb reservations')
        : Promise.resolve([]),
      fetchRows(supabaseAdmin!.from('work_orders')
        .select('id, title, status, assigned_to')
        .in('id', cases.map((c) => c.work_order_id).filter(Boolean)), 'linked WOs'),
    ]);
    const guestName = new Map(guestRows.map((g: any) => [g.id, g.name]));
    const resRoom = new Map(resRows.map((r: any) => [r.id, r.room_number]));
    const woInfo = new Map(woRows.map((w: any) => [w.id, w]));

    const feedbackQueue = negativeFeedback
      .filter((f) => !linkedFeedback.has(f.id))
      .map((f) => ({
        id: f.id,
        guestName: guestName.get(f.guest_id) || 'Guest',
        roomNumber: resRoom.get(f.reservation_id) || undefined,
        rating: f.rating,
        category: feedbackCategory(f.category),
        sourceCategory: f.category,
        comments: f.comments,
        submittedAt: f.submitted_at,
      }));

    const out = cases.map((c) => ({
      ...normCase(c),
      workOrder: c.work_order_id ? woInfo.get(c.work_order_id) || undefined : undefined,
    }));

    const open = out.filter((c) => c.status !== 'closed');
    const payload = {
      generatedAt: new Date().toISOString(),
      cases: out,
      feedbackQueue,
      stats: {
        total: out.length,
        open: open.length,
        compensationPending: out.filter((c) => c.status === 'compensation-pending').length,
        compensationTotal: open.reduce((n, c) => n + (c.compensationAmount || 0), 0),
        awaitingFeedbackTriage: feedbackQueue.length,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load recovery cases' });
  }
});

// POST /api/ops-portal/guest-recovery — create a case.
router.post('/guest-recovery', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.guestName?.trim() || !b.complaint?.trim()) {
    return res.status(400).json({ error: 'guestName and complaint are required' });
  }
  if (b.category && !CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'invalid category' });
  if (b.priority && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'invalid priority' });

  const { data, error } = await supabaseAdmin.from('ops_recovery_cases').insert({
    id: `rc-${Date.now()}`,
    property_id: b.propertyId || null,
    guest_name: b.guestName.trim(),
    room_number: b.roomNumber || null,
    complaint: b.complaint.trim(),
    category: b.category || 'Other',
    priority: b.priority || 'medium',
    assigned_to: b.assignedTo || null,
    feedback_id: b.feedbackId || null,
    logged_by: req.user?.name || 'manager',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-recovery:*');
  return res.status(201).json({ ok: true, case: normCase(data) });
});

// POST /api/ops-portal/guest-recovery/from-feedback — open a case from a
// guest_feedback row (dedup by feedback_id).
router.post('/guest-recovery/from-feedback', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const feedbackId = req.body?.feedbackId;
  if (!feedbackId) return res.status(400).json({ error: 'feedbackId is required' });

  const { data: existing } = await supabaseAdmin
    .from('ops_recovery_cases').select('id').eq('feedback_id', feedbackId).maybeSingle();
  if (existing) return res.status(409).json({ error: 'A case already exists for this feedback', caseId: existing.id });

  const { data: fb, error: fbErr } = await supabaseAdmin
    .from('guest_feedback').select('*').eq('id', feedbackId).single();
  if (fbErr || !fb) return res.status(404).json({ error: 'feedback not found' });

  const [gName, room] = await Promise.all([
    fb.guest_id
      ? supabaseAdmin.from('guests').select('name').eq('id', fb.guest_id).maybeSingle().then((r) => r.data?.name)
      : Promise.resolve(null),
    fb.reservation_id
      ? supabaseAdmin.from('reservations').select('room_number').eq('id', fb.reservation_id).maybeSingle().then((r) => r.data?.room_number)
      : Promise.resolve(null),
  ]);

  const { data, error } = await supabaseAdmin.from('ops_recovery_cases').insert({
    id: `rc-${Date.now()}`,
    property_id: req.body?.propertyId || fb.property_id || null,
    guest_name: gName || 'Guest',
    room_number: room || null,
    complaint: fb.comments || `Negative feedback (${fb.rating}/5) — ${fb.category || 'general'}`,
    category: feedbackCategory(fb.category),
    priority: fb.rating <= 2 ? 'high' : 'medium',
    feedback_id: fb.id,
    logged_by: req.user?.name || 'manager',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-recovery:*');
  return res.status(201).json({ ok: true, case: normCase(data) });
});

// PATCH /api/ops-portal/guest-recovery/:id
router.patch('/guest-recovery/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  const update: Record<string, any> = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'invalid status' });
    update.status = b.status;
    if (b.status === 'closed') update.closed_at = new Date().toISOString();
  }
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'invalid priority' });
    update.priority = b.priority;
  }
  if (b.category !== undefined) {
    if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'invalid category' });
    update.category = b.category;
  }
  if (b.assignedTo !== undefined) update.assigned_to = b.assignedTo;
  if (b.compensationAmount !== undefined) update.compensation_amount = b.compensationAmount;
  if (b.correctiveAction !== undefined) update.corrective_action = b.correctiveAction;
  if (b.followUpDate !== undefined) update.follow_up_date = b.followUpDate;
  if (b.notes !== undefined) update.notes = b.notes;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'nothing to update' });

  const { data, error } = await supabaseAdmin
    .from('ops_recovery_cases').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-recovery:*');
  return res.json({ ok: true, case: normCase(data) });
});

// POST /api/ops-portal/guest-recovery/:id/work-order — create a real
// work_orders row (Engineering portal) for corrective maintenance and link it.
router.post('/guest-recovery/:id/work-order', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};

  const { data: rc, error: rcErr } = await supabaseAdmin
    .from('ops_recovery_cases').select('*').eq('id', req.params.id).single();
  if (rcErr || !rc) return res.status(404).json({ error: 'case not found' });
  if (rc.work_order_id) return res.status(409).json({ error: 'work order already linked', workOrderId: rc.work_order_id });

  const woId = `WO-REC-${Date.now()}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woId,
    title: b.title?.trim() || `Guest recovery — ${rc.complaint.slice(0, 80)}`,
    description: b.description?.trim() || `Recovery case ${rc.id} (${rc.guest_name}, room ${rc.room_number || 'n/a'}): ${rc.complaint}`,
    type: 'Corrective',
    priority: rc.priority === 'high' ? 'High' : rc.priority === 'low' ? 'Low' : 'Medium',
    status: 'Open',
    room_number: rc.room_number,
    created_by: req.user?.name || 'manager',
    created_date: new Date().toISOString(),
    property_id: rc.property_id || b.propertyId || null,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  const { error: linkErr } = await supabaseAdmin
    .from('ops_recovery_cases')
    .update({ work_order_id: woId, status: rc.status === 'logged' || rc.status === 'investigating' ? 'corrective-action' : rc.status })
    .eq('id', rc.id);
  if (linkErr) console.warn(`[ops-recovery] link WO: ${linkErr.message}`);

  cacheService.invalidate('ops-recovery:*');
  return res.status(201).json({ ok: true, workOrder: wo });
});

// DELETE /api/ops-portal/guest-recovery/:id
router.delete('/guest-recovery/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('ops_recovery_cases').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-recovery:*');
  return res.json({ ok: true });
});

export default router;
