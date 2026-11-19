/**
 * HR Career & Succession API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for career paths, talent pool, succession plans, and
 * internal mobility. Mounted at /api/hr-portal/career.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-career:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [pathsRes, talentRes, successionRes, mobilityRes] = await Promise.all([
    supabaseAdmin.from('hr_career_paths').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_talent_pool').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_succession_plans').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_internal_mobility').select('*').eq('property_id', propertyId),
  ]);

  const stats = {
    careerPaths: (pathsRes.data || []).length,
    talentPool: (talentRes.data || []).length,
    successionPlans: (successionRes.data || []).length,
    internalMobility: (mobilityRes.data || []).length,
    activeHighPotential: (talentRes.data || []).filter((t: any) => t.potential === 'High').length,
    avgPerformance: (talentRes.data || []).length > 0
      ? parseFloat(((talentRes.data as any[]).reduce((s, t) => s + (Number(t.performance_rating) || 0), 0) / (talentRes.data as any[]).length).toFixed(1))
      : 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Career Paths ───────────────────────────────────────────────────────────
router.get('/paths/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_career_paths')
    .select('*').eq('property_id', req.params.propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ paths: data || [] });
});

router.post('/paths', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, department, levels, activeEmployees, totalPositions } = req.body || {};
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_career_paths').insert({
    property_id: propertyId, name,
    department: department || null,
    levels: levels || [],
    active_employees: Number(activeEmployees) || 0,
    total_positions: Number(totalPositions) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/paths/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, department, levels, activeEmployees, totalPositions } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (department !== undefined) patch.department = department;
  if (levels !== undefined) patch.levels = levels;
  if (activeEmployees !== undefined) patch.active_employees = Number(activeEmployees);
  if (totalPositions !== undefined) patch.total_positions = Number(totalPositions);

  const { data, error } = await supabaseAdmin.from('hr_career_paths').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/paths/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_career_paths').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Talent Pool ────────────────────────────────────────────────────────────
router.get('/talent/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_talent_pool')
    .select('*').eq('property_id', req.params.propertyId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ talent: data || [] });
});

router.post('/talent', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, currentPosition, department, potential, readiness, targetPosition, careerPath, performanceRating, lastReview } = req.body || {};
  if (!propertyId || !employee) return res.status(400).json({ error: 'propertyId and employee are required' });

  const { data, error } = await supabaseAdmin.from('hr_talent_pool').insert({
    property_id: propertyId, employee,
    current_position: currentPosition || null,
    department: department || null,
    potential: potential || 'Medium',
    readiness: readiness || 'Ready in 2-3 Years',
    target_position: targetPosition || null,
    career_path: careerPath || null,
    performance_rating: performanceRating != null ? Number(performanceRating) : null,
    last_review: lastReview || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/talent/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, currentPosition, department, potential, readiness, targetPosition, careerPath, performanceRating, lastReview } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (currentPosition !== undefined) patch.current_position = currentPosition;
  if (department !== undefined) patch.department = department;
  if (potential !== undefined) patch.potential = potential;
  if (readiness !== undefined) patch.readiness = readiness;
  if (targetPosition !== undefined) patch.target_position = targetPosition;
  if (careerPath !== undefined) patch.career_path = careerPath;
  if (performanceRating !== undefined) patch.performance_rating = performanceRating != null ? Number(performanceRating) : null;
  if (lastReview !== undefined) patch.last_review = lastReview;

  const { data, error } = await supabaseAdmin.from('hr_talent_pool').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/talent/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_talent_pool').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Succession Plans ───────────────────────────────────────────────────────
router.get('/succession/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_succession_plans')
    .select('*').eq('property_id', req.params.propertyId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ plans: data || [] });
});

router.post('/succession', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, position, incumbent, department, successors, riskLevel, lastUpdated } = req.body || {};
  if (!propertyId || !position) return res.status(400).json({ error: 'propertyId and position are required' });

  const { data, error } = await supabaseAdmin.from('hr_succession_plans').insert({
    property_id: propertyId, position,
    incumbent: incumbent || null,
    department: department || null,
    successors: successors || [],
    risk_level: riskLevel || 'Low',
    last_updated: lastUpdated || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/succession/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { position, incumbent, department, successors, riskLevel, lastUpdated } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (position !== undefined) patch.position = position;
  if (incumbent !== undefined) patch.incumbent = incumbent;
  if (department !== undefined) patch.department = department;
  if (successors !== undefined) patch.successors = successors;
  if (riskLevel !== undefined) patch.risk_level = riskLevel;
  if (lastUpdated !== undefined) patch.last_updated = lastUpdated;

  const { data, error } = await supabaseAdmin.from('hr_succession_plans').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/succession/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_succession_plans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Internal Mobility ──────────────────────────────────────────────────────
router.get('/mobility/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_internal_mobility')
    .select('*').eq('property_id', req.params.propertyId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ mobility: data || [] });
});

router.post('/mobility', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, fromPosition, toPosition, department, status, initiatedDate, expectedCompletion } = req.body || {};
  if (!propertyId || !employee) return res.status(400).json({ error: 'propertyId and employee are required' });

  const { data, error } = await supabaseAdmin.from('hr_internal_mobility').insert({
    property_id: propertyId, employee,
    from_position: fromPosition || null,
    to_position: toPosition || null,
    department: department || null,
    status: status || 'In Progress',
    initiated_date: initiatedDate || null,
    expected_completion: expectedCompletion || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/mobility/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, fromPosition, toPosition, department, status, initiatedDate, expectedCompletion } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (fromPosition !== undefined) patch.from_position = fromPosition;
  if (toPosition !== undefined) patch.to_position = toPosition;
  if (department !== undefined) patch.department = department;
  if (status !== undefined) patch.status = status;
  if (initiatedDate !== undefined) patch.initiated_date = initiatedDate;
  if (expectedCompletion !== undefined) patch.expected_completion = expectedCompletion;

  const { data, error } = await supabaseAdmin.from('hr_internal_mobility').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/mobility/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_internal_mobility').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
