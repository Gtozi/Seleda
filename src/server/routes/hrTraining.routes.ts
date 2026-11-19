/**
 * HR Training & Development API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for training sessions and certification compliance.
 * Mounted at /api/hr-portal/training.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-training:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [sessionsRes, certsRes] = await Promise.all([
    supabaseAdmin.from('hr_training_sessions').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_certifications').select('*').eq('property_id', propertyId),
  ]);

  const sessions = sessionsRes.data || [];
  const certs = certsRes.data || [];

  const activeSessions = sessions.filter((s) => ['Upcoming', 'Open', 'Full'].includes(s.status)).length;
  const completedSessions = sessions.filter((s) => s.status === 'Completed').length;
  const staffCertified = sessions.reduce((s, r) => s + (Number(r.staff_count) || 0), 0);
  const certificationsDue = certs.filter((c) => c.rate != null && c.target != null && c.rate < c.target).length;
  const avgSkillIndex = certs.length > 0
    ? (certs.reduce((s, c) => s + (Number(c.rate) || 0), 0) / certs.length / 20).toFixed(1)
    : '0.0';

  const stats = {
    coursesActive: activeSessions,
    coursesCompleted: completedSessions,
    staffCertified,
    certificationsDue,
    skillsIndex: `${avgSkillIndex}/5`,
    sessionCount: sessions.length,
    certCount: certs.length,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Training Sessions ──────────────────────────────────────────────────────
router.get('/sessions/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_training_sessions')
    .select('*').eq('property_id', propertyId).order('session_date', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ sessions: data || [] });
});

router.post('/sessions', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, type, staffCount, sessionDate, status } = req.body || {};
  if (!propertyId || !title || !type) return res.status(400).json({ error: 'propertyId, title and type are required' });

  const { data, error } = await supabaseAdmin.from('hr_training_sessions').insert({
    property_id: propertyId, title, type,
    staff_count: Number(staffCount) || 0,
    session_date: sessionDate || null,
    status: status || 'Upcoming',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/sessions/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, type, staffCount, sessionDate, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (type !== undefined) patch.type = type;
  if (staffCount !== undefined) patch.staff_count = Number(staffCount);
  if (sessionDate !== undefined) patch.session_date = sessionDate;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_training_sessions').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/sessions/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_training_sessions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Certifications ─────────────────────────────────────────────────────────
router.get('/certifications/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_certifications')
    .select('*').eq('property_id', req.params.propertyId).order('label', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ certifications: data || [] });
});

router.post('/certifications', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, label, statusText, rate, target, color } = req.body || {};
  if (!propertyId || !label || !statusText) return res.status(400).json({ error: 'propertyId, label and statusText are required' });

  const { data, error } = await supabaseAdmin.from('hr_certifications').insert({
    property_id: propertyId, label, status_text: statusText,
    rate: rate != null ? Number(rate) : null,
    target: target != null ? Number(target) : null,
    color: color || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/certifications/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { label, statusText, rate, target, color } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (label !== undefined) patch.label = label;
  if (statusText !== undefined) patch.status_text = statusText;
  if (rate !== undefined) patch.rate = rate != null ? Number(rate) : null;
  if (target !== undefined) patch.target = target != null ? Number(target) : null;
  if (color !== undefined) patch.color = color;

  const { data, error } = await supabaseAdmin.from('hr_certifications').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/certifications/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_certifications').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
