/**
 * F&B Guest Experience & CRM routes.
 *
 * Backs the /erp/fb/guest-experience tab (GuestExperienceCRM.tsx).
 * All handlers use supabaseAdmin (service role) which bypasses RLS.
 *
 * Endpoints (mounted at /api/fb/guest-experience):
 *   GET    /                       — overview + aggregate stats
 *   GET    /profiles               — list guest profiles
 *   GET    /dining-history         — list dining history rows
 *   GET    /favorites              — list guest favorites
 *   POST   /favorites              — create a favorite
 *   PUT    /favorites/:id          — update a favorite
 *   DELETE /favorites/:id          — delete a favorite
 *   GET    /allergies              — list allergies/dietary
 *   POST   /allergies              — create an allergy/dietary entry
 *   PUT    /allergies/:id          — update an allergy/dietary entry
 *   DELETE /allergies/:id          — delete an allergy/dietary entry
 *   GET    /feedback               — list guest feedback
 *   POST   /feedback               — create feedback
 *   PUT    /feedback/:id           — update feedback (status, etc.)
 *   DELETE /feedback/:id           — delete feedback
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent } from '../services/sessionService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

function newId(): string {
  return crypto.randomUUID();
}

// ── Overview / Stats ────────────────────────────────────────────────
router.get('/', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  try {
    const [profilesRes, vipRes, fbRes] = await Promise.all([
      supabaseAdmin.from('fb_guest_profiles').select('id, loyalty_points, total_spent'),
      supabaseAdmin.from('fb_guest_profiles').select('id').neq('vip_tier', 'none'),
      supabaseAdmin.from('fb_guest_feedback').select('rating'),
    ]);

    if (profilesRes.error) return res.status(500).json({ error: profilesRes.error.message });

    const profiles = profilesRes.data || [];
    const totalGuests = profiles.length;
    const vipGuests = (vipRes.data || []).length;
    const loyaltyIssued = profiles.reduce((sum: number, g: any) => sum + Number(g.loyalty_points || 0), 0);
    const ratings = (fbRes.data || []).filter((r: any) => r.rating != null).map((r: any) => Number(r.rating));
    const avgSatisfaction = ratings.length
      ? Math.round((ratings.reduce((s: number, r: number) => s + r, 0) / ratings.length) * 10) / 10
      : 0;

    return res.json({
      totalGuests,
      vipGuests,
      loyaltyPointsIssued: loyaltyIssued,
      avgSatisfaction,
    });
  } catch (error) {
    console.error('FB guest experience overview error:', error);
    return res.status(500).json({ error: 'Failed to load guest experience overview' });
  }
});

// ── Guest Profiles ──────────────────────────────────────────────────
router.get('/profiles', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_guest_profiles')
    .select('*')
    .order('guest_name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Dining History ──────────────────────────────────────────────────
router.get('/dining-history', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, outlet } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_guest_dining_history').select('*').order('date', { ascending: false });
  if (guestId) q = q.eq('guest_id', guestId);
  if (outlet && outlet !== 'all') q = q.eq('outlet', outlet);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Favorites ───────────────────────────────────────────────────────
router.get('/favorites', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, category } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_guest_favorites').select('*').order('last_ordered', { ascending: false });
  if (guestId) q = q.eq('guest_id', guestId);
  if (category && category !== 'all') q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/favorites', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guest_id, item_name, category, outlet, notes } = req.body;
  if (!guest_id || !item_name || !category || !outlet) {
    return res.status(400).json({ error: 'guest_id, item_name, category, and outlet are required' });
  }
  const row = {
    id: newId(),
    guest_id,
    item_name,
    category,
    outlet,
    times_ordered: Number(req.body.times_ordered || 1),
    last_ordered: req.body.last_ordered || new Date().toISOString().slice(0, 10),
    notes: notes || '',
  };
  const { data, error } = await supabaseAdmin.from('fb_guest_favorites').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user, action: 'fb_guest_favorite_create', entityType: 'GuestFavorite', entityId: data.id, module: 'fb_guest_experience', details: { guest_id, item_name } });
  return res.status(201).json(data);
});

router.put('/favorites/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_guest_favorites')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/favorites/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_guest_favorites').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user, action: 'fb_guest_favorite_delete', entityType: 'GuestFavorite', entityId: req.params.id, module: 'fb_guest_experience', details: {} });
  return res.json({ success: true });
});

// ── Allergies & Dietary ─────────────────────────────────────────────
router.get('/allergies', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, type } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_guest_allergies_dietary').select('*').order('name', { ascending: true });
  if (guestId) q = q.eq('guest_id', guestId);
  if (type && type !== 'all') q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/allergies', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guest_id, type, name, severity, notes } = req.body;
  if (!guest_id || !type || !name) {
    return res.status(400).json({ error: 'guest_id, type, and name are required' });
  }
  const row = {
    id: newId(),
    guest_id,
    type,
    name,
    severity: severity || 'mild',
    notes: notes || '',
  };
  const { data, error } = await supabaseAdmin.from('fb_guest_allergies_dietary').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user, action: 'fb_guest_allergy_create', entityType: 'GuestAllergy', entityId: data.id, module: 'fb_guest_experience', details: { guest_id, type, name } });
  return res.status(201).json(data);
});

router.put('/allergies/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_guest_allergies_dietary')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/allergies/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_guest_allergies_dietary').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user, action: 'fb_guest_allergy_delete', entityType: 'GuestAllergy', entityId: req.params.id, module: 'fb_guest_experience', details: {} });
  return res.json({ success: true });
});

// ── Feedback ────────────────────────────────────────────────────────
router.get('/feedback', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, type, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fb_guest_feedback').select('*').order('date', { ascending: false });
  if (guestId) q = q.eq('guest_id', guestId);
  if (type && type !== 'all') q = q.eq('type', type);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/feedback', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guest_id, type, category, description, rating, outlet } = req.body;
  if (!guest_id || !type || !category || !description) {
    return res.status(400).json({ error: 'guest_id, type, category, and description are required' });
  }
  const row = {
    id: newId(),
    guest_id,
    type,
    category,
    description,
    outlet: outlet || 'Main Restaurant',
    rating: rating == null ? null : Number(rating),
    date: req.body.date || new Date().toISOString().slice(0, 10),
    status: req.body.status || 'open',
  };
  const { data, error } = await supabaseAdmin.from('fb_guest_feedback').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user, action: 'fb_guest_feedback_create', entityType: 'GuestFeedback', entityId: data.id, module: 'fb_guest_experience', details: { guest_id, type, category } });
  return res.status(201).json(data);
});

router.put('/feedback/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_guest_feedback')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/feedback/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_guest_feedback').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user, action: 'fb_guest_feedback_delete', entityType: 'GuestFeedback', entityId: req.params.id, module: 'fb_guest_experience', details: {} });
  return res.json({ success: true });
});

export default router;
