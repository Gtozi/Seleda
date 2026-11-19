/**
 * HR Employee Relations API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for disciplinary actions, grievances, recognition
 * programs, recent recognition, and employee surveys. Mounted at
 * /api/hr-portal/relations.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-relations:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [disciplinaryRes, grievancesRes, recognitionRes, surveysRes] = await Promise.all([
    supabaseAdmin.from('hr_disciplinary_actions').select('status').eq('property_id', propertyId),
    supabaseAdmin.from('hr_grievances').select('status').eq('property_id', propertyId),
    supabaseAdmin.from('hr_recent_recognition').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_employee_surveys').select('*').eq('property_id', propertyId),
  ]);

  const disciplinary = disciplinaryRes.data || [];
  const grievances = grievancesRes.data || [];
  const recognition = recognitionRes.data || [];
  const surveys = surveysRes.data || [];

  const activeDisciplinary = disciplinary.filter((d) => d.status === 'Active').length;
  const openGrievances = grievances.filter((g) => g.status === 'Under Investigation' || g.status === 'Investigation Complete').length;
  const recognitionAwards = recognition.length;
  const avgResponse = surveys.length > 0
    ? Math.round(surveys.reduce((s, r) => s + (Number(r.response_rate) || 0), 0) / surveys.length)
    : 0;

  const stats = {
    activeDisciplinary,
    openGrievances,
    recognitionAwards,
    surveyResponse: avgResponse,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// Resolve employee_id from a free-text employee name for a given property.
async function resolveEmployeeId(propertyId: string, name: string | undefined | null): Promise<string | null> {
  if (!name || !hasSupabaseAdminConfig || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from('employees')
    .select('id').eq('property_id', propertyId).ilike('name', name.trim())
    .maybeSingle();
  return data?.id || null;
}

// ── Disciplinary Actions ───────────────────────────────────────────────────
router.get('/disciplinary/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_disciplinary_actions')
    .select('*').eq('property_id', req.params.propertyId).order('action_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ disciplinary: data || [] });
});

router.post('/disciplinary', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, employeeId, scoreImpact, actionType, category, actionDate, issuedBy, description, status, expiryDate } = req.body || {};
  if (!propertyId || !employee || !actionType) return res.status(400).json({ error: 'propertyId, employee and actionType are required' });

  const resolvedEmployeeId = employeeId || await resolveEmployeeId(propertyId, employee);

  const { data, error } = await supabaseAdmin.from('hr_disciplinary_actions').insert({
    property_id: propertyId, employee, employee_id: resolvedEmployeeId,
    score_impact: scoreImpact != null ? Number(scoreImpact) : 0,
    action_type: actionType, category: category || null,
    action_date: actionDate || null, issued_by: issuedBy || null, description: description || null,
    status: status || 'Active', expiry_date: expiryDate || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/disciplinary/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, employeeId, scoreImpact, actionType, category, actionDate, issuedBy, description, status, expiryDate } = req.body || {};

  // Need the property_id to resolve employee_id when the name changes.
  const { data: existing } = await supabaseAdmin.from('hr_disciplinary_actions')
    .select('property_id, employee_id').eq('id', req.params.id).maybeSingle();
  const propertyId = existing?.property_id;

  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) {
    patch.employee = employee;
    patch.employee_id = employeeId || existing?.employee_id || await resolveEmployeeId(propertyId, employee);
  }
  if (scoreImpact !== undefined) patch.score_impact = scoreImpact != null ? Number(scoreImpact) : 0;
  if (actionType !== undefined) patch.action_type = actionType;
  if (category !== undefined) patch.category = category;
  if (actionDate !== undefined) patch.action_date = actionDate;
  if (issuedBy !== undefined) patch.issued_by = issuedBy;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  if (expiryDate !== undefined) patch.expiry_date = expiryDate;

  const { data, error } = await supabaseAdmin.from('hr_disciplinary_actions').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/disciplinary/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_disciplinary_actions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Grievances ─────────────────────────────────────────────────────────────
router.get('/grievances/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_grievances')
    .select('*').eq('property_id', req.params.propertyId).order('grievance_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ grievances: data || [] });
});

router.post('/grievances', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, type, category, grievanceDate, description, status, assignedTo, priority } = req.body || {};
  if (!propertyId || !employee) return res.status(400).json({ error: 'propertyId and employee are required' });

  const { data, error } = await supabaseAdmin.from('hr_grievances').insert({
    property_id: propertyId, employee, type: type || null, category: category || null,
    grievance_date: grievanceDate || null, description: description || null,
    status: status || 'Under Investigation', assigned_to: assignedTo || null,
    priority: priority || 'Medium',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/grievances/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, type, category, grievanceDate, description, status, assignedTo, priority } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (type !== undefined) patch.type = type;
  if (category !== undefined) patch.category = category;
  if (grievanceDate !== undefined) patch.grievance_date = grievanceDate;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo;
  if (priority !== undefined) patch.priority = priority;

  const { data, error } = await supabaseAdmin.from('hr_grievances').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/grievances/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_grievances').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Recognition Programs ───────────────────────────────────────────────────
router.get('/programs/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_recognition_programs')
    .select('*').eq('property_id', req.params.propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ programs: data || [] });
});

router.post('/programs', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, programType, description, currentWinner, lastAwarded, nextNomination, status } = req.body || {};
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_recognition_programs').insert({
    property_id: propertyId, name, program_type: programType || null,
    description: description || null, current_winner: currentWinner || null,
    last_awarded: lastAwarded || null, next_nomination: nextNomination || null,
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/programs/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, programType, description, currentWinner, lastAwarded, nextNomination, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (programType !== undefined) patch.program_type = programType;
  if (description !== undefined) patch.description = description;
  if (currentWinner !== undefined) patch.current_winner = currentWinner;
  if (lastAwarded !== undefined) patch.last_awarded = lastAwarded;
  if (nextNomination !== undefined) patch.next_nomination = nextNomination;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_recognition_programs').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/programs/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_recognition_programs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Recent Recognition ─────────────────────────────────────────────────────
router.get('/recognition/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_recent_recognition')
    .select('*').eq('property_id', req.params.propertyId).order('award_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ recognition: data || [] });
});

router.post('/recognition', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, award, category, awardDate, recognizedBy, reason } = req.body || {};
  if (!propertyId || !employee) return res.status(400).json({ error: 'propertyId and employee are required' });

  const { data, error } = await supabaseAdmin.from('hr_recent_recognition').insert({
    property_id: propertyId, employee, award: award || null,
    category: category || null, award_date: awardDate || null,
    recognized_by: recognizedBy || null, reason: reason || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/recognition/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, award, category, awardDate, recognizedBy, reason } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (award !== undefined) patch.award = award;
  if (category !== undefined) patch.category = category;
  if (awardDate !== undefined) patch.award_date = awardDate;
  if (recognizedBy !== undefined) patch.recognized_by = recognizedBy;
  if (reason !== undefined) patch.reason = reason;

  const { data, error } = await supabaseAdmin.from('hr_recent_recognition').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/recognition/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_recent_recognition').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Employee Surveys ───────────────────────────────────────────────────────
router.get('/surveys/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_employee_surveys')
    .select('*').eq('property_id', req.params.propertyId).order('survey_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ surveys: data || [] });
});

router.post('/surveys', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, surveyType, surveyDate, responseRate, participants, status, overallScore } = req.body || {};
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_employee_surveys').insert({
    property_id: propertyId, name, survey_type: surveyType || null,
    survey_date: surveyDate || null, response_rate: Number(responseRate) || 0,
    participants: Number(participants) || 0,
    status: status || 'In Progress',
    overall_score: overallScore != null ? Number(overallScore) : null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/surveys/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, surveyType, surveyDate, responseRate, participants, status, overallScore } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (surveyType !== undefined) patch.survey_type = surveyType;
  if (surveyDate !== undefined) patch.survey_date = surveyDate;
  if (responseRate !== undefined) patch.response_rate = Number(responseRate);
  if (participants !== undefined) patch.participants = Number(participants);
  if (status !== undefined) patch.status = status;
  if (overallScore !== undefined) patch.overall_score = overallScore != null ? Number(overallScore) : null;

  const { data, error } = await supabaseAdmin.from('hr_employee_surveys').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/surveys/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_employee_surveys').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
