/**
 * HR Applicant Tracking System (ATS) API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for interviews and offers, plus pipeline statistics and a
 * candidates view. Powers the HR > ATS module (replacing the hardcoded
 * placeholder data in ApplicantTracking.tsx).
 *
 * Candidates themselves are served by /api/hr-portal/recruitment/candidates;
 * this router focuses on the interviews + offers tabs and the pipeline
 * distribution. Mounted at /api/hr-portal/ats.
 *
 * Pattern mirrors the HR Recruitment / Organization routes (property-scoped,
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

const CACHE_PREFIX = 'hr-ats:';

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [candRes, intRes, offerRes, hiredRes] = await Promise.all([
    supabaseAdmin.from('hr_candidates').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    supabaseAdmin.from('hr_interviews').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Scheduled'),
    supabaseAdmin.from('hr_offers').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    supabaseAdmin.from('hr_candidates').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('stage', 'Hired'),
  ]);

  const stats = {
    totalCandidates: candRes.count ?? 0,
    activeInterviews: intRes.count ?? 0,
    offersSent: offerRes.count ?? 0,
    hiredThisMonth: hiredRes.count ?? 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Pipeline distribution (reuses hr_candidates) ─────────────────────────
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
  for (const r of (data || []) as any[]) counts[r.stage] = (counts[r.stage] || 0) + 1;

  const stages = ['Application Received', 'Screening', 'Interview', 'Assessment', 'Background Check', 'Offer', 'Hired'];
  const colors = ['bg-slate-400', 'bg-blue-400', 'bg-indigo-400', 'bg-purple-400', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-600'];
  const pipeline = stages.map((s, i) => ({ stage: s, count: counts[s] || 0, color: colors[i] }));

  cacheService.set(cacheKey, pipeline, 60 * 1000);
  return res.json({ pipeline });
});

// ── Candidates (proxy to hr_candidates, ATS-flavored response) ───────────
router.get('/candidates/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { stage, status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_candidates')
    .select('*')
    .eq('property_id', propertyId)
    .order('applied_date', { ascending: false });

  if (stage) q = q.eq('stage', stage);
  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ candidates: data || [] });
});

// ── Interviews ───────────────────────────────────────────────────────────
router.get('/interviews/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_interviews')
    .select('*')
    .eq('property_id', propertyId)
    .order('scheduled_date', { ascending: true });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('candidate_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ interviews: data || [] });
});

router.post('/interviews', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    propertyId, candidateId, candidateName, position, type,
    scheduledDate, scheduledTime, interviewer, location, status, notes,
  } = req.body || {};
  if (!propertyId || !candidateName?.trim() || !scheduledDate || !scheduledTime?.trim()) {
    return res.status(400).json({ error: 'propertyId, candidateName, scheduledDate and scheduledTime are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_interviews').insert({
    property_id: propertyId,
    candidate_id: candidateId || null,
    candidate_name: candidateName.trim(),
    position: position?.trim() || null,
    type: type || 'HR Interview',
    scheduled_date: scheduledDate,
    scheduled_time: scheduledTime.trim(),
    interviewer: interviewer?.trim() || null,
    location: location?.trim() || null,
    status: status || 'Scheduled',
    notes: notes?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/interviews/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const {
    candidateId, candidateName, position, type,
    scheduledDate, scheduledTime, interviewer, location, status, notes,
  } = req.body || {};
  if (candidateId !== undefined) patch.candidate_id = candidateId || null;
  if (candidateName !== undefined) patch.candidate_name = candidateName;
  if (position !== undefined) patch.position = position || null;
  if (type !== undefined) patch.type = type;
  if (scheduledDate !== undefined) patch.scheduled_date = scheduledDate;
  if (scheduledTime !== undefined) patch.scheduled_time = scheduledTime;
  if (interviewer !== undefined) patch.interviewer = interviewer || null;
  if (location !== undefined) patch.location = location || null;
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes || null;

  const { data, error } = await supabaseAdmin.from('hr_interviews').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/interviews/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_interviews').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Offers ───────────────────────────────────────────────────────────────
router.get('/offers/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_offers')
    .select('*')
    .eq('property_id', propertyId)
    .order('sent_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('candidate_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ offers: data || [] });
});

router.post('/offers', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    propertyId, candidateId, candidateName, position, department,
    salary, startDate, status, sentDate, responseDate,
  } = req.body || {};
  if (!propertyId || !candidateName?.trim()) {
    return res.status(400).json({ error: 'propertyId and candidateName are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_offers').insert({
    property_id: propertyId,
    candidate_id: candidateId || null,
    candidate_name: candidateName.trim(),
    position: position?.trim() || null,
    department: department?.trim() || null,
    salary: Number(salary) || 0,
    start_date: startDate || null,
    status: status || 'Pending',
    sent_date: sentDate || new Date().toISOString().slice(0, 10),
    response_date: responseDate || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/offers/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const {
    candidateId, candidateName, position, department,
    salary, startDate, status, sentDate, responseDate,
  } = req.body || {};
  if (candidateId !== undefined) patch.candidate_id = candidateId || null;
  if (candidateName !== undefined) patch.candidate_name = candidateName;
  if (position !== undefined) patch.position = position || null;
  if (department !== undefined) patch.department = department || null;
  if (salary !== undefined) patch.salary = Number(salary) || 0;
  if (startDate !== undefined) patch.start_date = startDate || null;
  if (status !== undefined) patch.status = status;
  if (sentDate !== undefined) patch.sent_date = sentDate;
  if (responseDate !== undefined) patch.response_date = responseDate || null;

  const { data, error } = await supabaseAdmin.from('hr_offers').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // If an offer is accepted, advance the linked candidate to Hired.
  if (status === 'Accepted' && data?.candidate_id) {
    await supabaseAdmin.from('hr_candidates').update({ stage: 'Hired', status: 'Hired', updated_at: new Date().toISOString() }).eq('id', data.candidate_id);
  }

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/offers/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_offers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
