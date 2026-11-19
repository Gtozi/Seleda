/**
 * HR Recruitment API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for job openings (vacancies) and candidates (applicants),
 * plus pipeline statistics and a shortlisted-candidates view. Powers the
 * HR > Recruitment module (replacing the hardcoded placeholder data in
 * RecruitmentFlow.tsx).
 *
 * Mounted at /api/hr-portal/recruitment.
 * Pattern mirrors the HR Organization / Employees routes (property-scoped,
 * service-role supabaseAdmin, cacheService invalidation).
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-recruit:';

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [openRes, appRes, intRes, hiredRes] = await Promise.all([
    supabaseAdmin.from('hr_job_openings').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Open'),
    supabaseAdmin.from('hr_candidates').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    supabaseAdmin.from('hr_candidates').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('stage', 'Interview'),
    supabaseAdmin.from('hr_candidates').select('id, applied_date', { count: 'exact', head: false }).eq('property_id', propertyId).eq('stage', 'Hired'),
  ]);

  // Avg hire cycle (days from applied_date to now) for hired candidates.
  let avgHireCycleDays = 0;
  const hiredRows = (hiredRes.data as any[]) || [];
  if (hiredRows.length > 0) {
    const now = Date.now();
    const totalDays = hiredRows.reduce((sum, r) => {
      const d = new Date(r.applied_date).getTime();
      return sum + Math.max(1, Math.round((now - d) / (1000 * 60 * 60 * 24)));
    }, 0);
    avgHireCycleDays = Math.round(totalDays / hiredRows.length);
  }

  const stats = {
    activeOpenings: openRes.count ?? 0,
    totalApplications: appRes.count ?? 0,
    interviewsToday: intRes.count ?? 0,
    avgHireCycleDays,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Pipeline distribution ─────────────────────────────────────────────────
router.get('/pipeline/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}pipeline:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('hr_candidates')
    .select('stage')
    .eq('property_id', propertyId);

  if (error) return res.status(500).json({ error: error.message });

  const counts: Record<string, number> = {};
  for (const r of (data || []) as any[]) {
    counts[r.stage] = (counts[r.stage] || 0) + 1;
  }

  const stages = ['Application Received', 'Screening', 'Interview', 'Assessment', 'Background Check', 'Offer', 'Hired', 'Rejected'];
  const pipeline = stages.map((s) => ({ stage: s, count: counts[s] || 0 }));

  cacheService.set(cacheKey, pipeline, 60 * 1000);
  return res.json({ pipeline });
});

// ── Job openings ──────────────────────────────────────────────────────────
router.get('/openings/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, priority, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_job_openings')
    .select('*')
    .eq('property_id', propertyId)
    .order('posted_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  if (search?.trim()) q = q.ilike('title', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Attach live applicant + interview counts per opening.
  const openings = (data || []) as any[];
  if (openings.length === 0) return res.json({ openings: [] });

  const ids = openings.map((o) => o.id);
  const [appRes, intRes] = await Promise.all([
    supabaseAdmin.from('hr_candidates').select('job_opening_id').in('job_opening_id', ids).eq('property_id', propertyId),
    supabaseAdmin.from('hr_candidates').select('job_opening_id').in('job_opening_id', ids).eq('property_id', propertyId).eq('stage', 'Interview'),
  ]);

  const appCount: Record<string, number> = {};
  for (const r of (appRes.data || []) as any[]) {
    if (r.job_opening_id) appCount[r.job_opening_id] = (appCount[r.job_opening_id] || 0) + 1;
  }
  const intCount: Record<string, number> = {};
  for (const r of (intRes.data || []) as any[]) {
    if (r.job_opening_id) intCount[r.job_opening_id] = (intCount[r.job_opening_id] || 0) + 1;
  }

  const enriched = openings.map((o) => ({
    ...o,
    applicants: appCount[o.id] || 0,
    interviews: intCount[o.id] || 0,
  }));

  return res.json({ openings: enriched });
});

router.post('/openings', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, department, positionId, priority, status, description, postedAt } = req.body || {};
  if (!propertyId || !title?.trim()) return res.status(400).json({ error: 'propertyId and title are required' });

  const { data, error } = await supabaseAdmin.from('hr_job_openings').insert({
    property_id: propertyId,
    title: title.trim(),
    department: department?.trim() || null,
    position_id: positionId || null,
    priority: priority || 'Medium',
    status: status || 'Open',
    description: description?.trim() || null,
    posted_at: postedAt || new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/openings/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { title, department, positionId, priority, status, description } = req.body || {};
  if (title !== undefined) patch.title = title;
  if (department !== undefined) patch.department = department || null;
  if (positionId !== undefined) patch.position_id = positionId || null;
  if (priority !== undefined) patch.priority = priority;
  if (status !== undefined) patch.status = status;
  if (description !== undefined) patch.description = description || null;

  const { data, error } = await supabaseAdmin.from('hr_job_openings').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/openings/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { hard } = req.query as Record<string, string>;
  if (hard === 'true') {
    const { error } = await supabaseAdmin.from('hr_job_openings').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin.from('hr_job_openings').update({ status: 'Closed', updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Candidates ───────────────────────────────────────────────────────────
router.get('/candidates/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { jobOpeningId, stage, status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_candidates')
    .select('*')
    .eq('property_id', propertyId)
    .order('applied_date', { ascending: false });

  if (jobOpeningId) q = q.eq('job_opening_id', jobOpeningId);
  if (stage) q = q.eq('stage', stage);
  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ candidates: data || [] });
});

// Shortlisted = candidates in Offer / Interview / Hired stages (high signal).
router.get('/shortlisted/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}shortlist:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('hr_candidates')
    .select('*')
    .eq('property_id', propertyId)
    .in('stage', ['Interview', 'Offer', 'Hired'])
    .order('rating', { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.set(cacheKey, { candidates: data || [] }, 60 * 1000);
  return res.json({ candidates: data || [] });
});

router.post('/candidates', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    propertyId, jobOpeningId, name, email, phone, location,
    position, department, stage, rating, status, appliedDate,
  } = req.body || {};
  if (!propertyId || !name?.trim()) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_candidates').insert({
    property_id: propertyId,
    job_opening_id: jobOpeningId || null,
    name: name.trim(),
    email: email?.trim() || null,
    phone: phone?.trim() || null,
    location: location?.trim() || null,
    position: position?.trim() || null,
    department: department?.trim() || null,
    stage: stage || 'Application Received',
    rating: Number(rating) || 0,
    status: status || 'Active',
    applied_date: appliedDate || new Date().toISOString().slice(0, 10),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/candidates/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const {
    jobOpeningId, name, email, phone, location,
    position, department, stage, rating, status,
  } = req.body || {};
  if (jobOpeningId !== undefined) patch.job_opening_id = jobOpeningId || null;
  if (name !== undefined) patch.name = name;
  if (email !== undefined) patch.email = email || null;
  if (phone !== undefined) patch.phone = phone || null;
  if (location !== undefined) patch.location = location || null;
  if (position !== undefined) patch.position = position || null;
  if (department !== undefined) patch.department = department || null;
  if (stage !== undefined) patch.stage = stage;
  if (rating !== undefined) patch.rating = Number(rating) || 0;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_candidates').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // If a candidate is moved to Hired, mark the opening as Filled.
  if (stage === 'Hired' && data?.job_opening_id) {
    await supabaseAdmin.from('hr_job_openings').update({ status: 'Filled', updated_at: new Date().toISOString() }).eq('id', data.job_opening_id);
  }

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/candidates/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_candidates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
