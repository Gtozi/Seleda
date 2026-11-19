/**
 * HR Health & Safety API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for incidents, safety training, medical exams, PPE
 * and risk assessments. Mounted at /api/hr-portal/health.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-health:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [incidentsRes, trainingRes, examsRes] = await Promise.all([
    supabaseAdmin.from('hr_incidents').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_safety_training').select('completion_rate, total_employees').eq('property_id', propertyId).eq('status', 'Active'),
    supabaseAdmin.from('hr_medical_exams').select('*').eq('property_id', propertyId),
  ]);

  const incidents = incidentsRes.data || [];
  const training = trainingRes.data || [];
  const exams = examsRes.data || [];

  const ytdIncidents = incidents.length;
  const daysLost = incidents.reduce((s, i) => s + (Number(i.days_lost) || 0), 0);
  const trainingCompliance = training.length > 0
    ? Math.round(training.reduce((s, t) => s + (Number(t.completion_rate) || 0), 0) / training.length)
    : 0;
  const medicalValid = exams.filter((e) => e.status === 'Valid').length;

  const stats = { ytdIncidents, daysLost, trainingCompliance, medicalValid };
  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Incidents ──────────────────────────────────────────────────────────────
router.get('/incidents/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_incidents')
    .select('*').eq('property_id', req.params.propertyId).order('incident_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ incidents: data || [] });
});

router.post('/incidents', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, type, severity, location, incidentDate, employee, description, status, daysLost } = req.body || {};
  if (!propertyId || !type) return res.status(400).json({ error: 'propertyId and type are required' });

  const { data, error } = await supabaseAdmin.from('hr_incidents').insert({
    property_id: propertyId, type,
    severity: severity || 'Minor', location: location || null, incident_date: incidentDate || null,
    employee: employee || null, description: description || null,
    status: status || 'Investigating', days_lost: Number(daysLost) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/incidents/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, severity, location, incidentDate, employee, description, status, daysLost } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (type !== undefined) patch.type = type;
  if (severity !== undefined) patch.severity = severity;
  if (location !== undefined) patch.location = location;
  if (incidentDate !== undefined) patch.incident_date = incidentDate;
  if (employee !== undefined) patch.employee = employee;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  if (daysLost !== undefined) patch.days_lost = Number(daysLost);

  const { data, error } = await supabaseAdmin.from('hr_incidents').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/incidents/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_incidents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Safety Training ────────────────────────────────────────────────────────
router.get('/training/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_safety_training')
    .select('*').eq('property_id', req.params.propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ training: data || [] });
});

router.post('/training', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, trainingType, category, duration, frequency, lastCompleted, nextDue, completionRate, totalEmployees, status } = req.body || {};
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_safety_training').insert({
    property_id: propertyId, name,
    training_type: trainingType || 'Mandatory', category: category || null, duration: duration || null, frequency: frequency || null,
    last_completed: lastCompleted || null, next_due: nextDue || null,
    completion_rate: Number(completionRate) || 0, total_employees: Number(totalEmployees) || 0,
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/training/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, trainingType, category, duration, frequency, lastCompleted, nextDue, completionRate, totalEmployees, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (trainingType !== undefined) patch.training_type = trainingType;
  if (category !== undefined) patch.category = category;
  if (duration !== undefined) patch.duration = duration;
  if (frequency !== undefined) patch.frequency = frequency;
  if (lastCompleted !== undefined) patch.last_completed = lastCompleted;
  if (nextDue !== undefined) patch.next_due = nextDue;
  if (completionRate !== undefined) patch.completion_rate = Number(completionRate);
  if (totalEmployees !== undefined) patch.total_employees = Number(totalEmployees);
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_safety_training').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/training/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_safety_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Medical Exams ──────────────────────────────────────────────────────────
router.get('/exams/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_medical_exams')
    .select('*').eq('property_id', req.params.propertyId).order('exam_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ exams: data || [] });
});

router.post('/exams', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, examType, examDate, result, nextExam, status } = req.body || {};
  if (!propertyId || !employee) return res.status(400).json({ error: 'propertyId and employee are required' });

  const { data, error } = await supabaseAdmin.from('hr_medical_exams').insert({
    property_id: propertyId, employee,
    exam_type: examType || null, exam_date: examDate || null, result: result || null,
    next_exam: nextExam || null, status: status || 'Valid',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/exams/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, examType, examDate, result, nextExam, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (examType !== undefined) patch.exam_type = examType;
  if (examDate !== undefined) patch.exam_date = examDate;
  if (result !== undefined) patch.result = result;
  if (nextExam !== undefined) patch.next_exam = nextExam;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_medical_exams').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/exams/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_medical_exams').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── PPE ────────────────────────────────────────────────────────────────────
router.get('/ppe/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_ppe')
    .select('*').eq('property_id', req.params.propertyId).order('item', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ppe: data || [] });
});

router.post('/ppe', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, item, category, totalIssued, inUse, needsReplacement, lastInspection, status } = req.body || {};
  if (!propertyId || !item) return res.status(400).json({ error: 'propertyId and item are required' });

  const { data, error } = await supabaseAdmin.from('hr_ppe').insert({
    property_id: propertyId, item,
    category: category || null,
    total_issued: Number(totalIssued) || 0, in_use: Number(inUse) || 0, needs_replacement: Number(needsReplacement) || 0,
    last_inspection: lastInspection || null,
    status: status || 'Good',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/ppe/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { item, category, totalIssued, inUse, needsReplacement, lastInspection, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (item !== undefined) patch.item = item;
  if (category !== undefined) patch.category = category;
  if (totalIssued !== undefined) patch.total_issued = Number(totalIssued);
  if (inUse !== undefined) patch.in_use = Number(inUse);
  if (needsReplacement !== undefined) patch.needs_replacement = Number(needsReplacement);
  if (lastInspection !== undefined) patch.last_inspection = lastInspection;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_ppe').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/ppe/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_ppe').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Risk Assessments ───────────────────────────────────────────────────────
router.get('/risk/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_risk_assessments')
    .select('*').eq('property_id', req.params.propertyId).order('area', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ risks: data || [] });
});

router.post('/risk', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, area, hazardLevel, lastAssessment, nextAssessment, status, controls } = req.body || {};
  if (!propertyId || !area) return res.status(400).json({ error: 'propertyId and area are required' });

  const { data, error } = await supabaseAdmin.from('hr_risk_assessments').insert({
    property_id: propertyId, area,
    hazard_level: hazardLevel || 'Low',
    last_assessment: lastAssessment || null, next_assessment: nextAssessment || null,
    status: status || 'Valid',
    controls: Number(controls) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/risk/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { area, hazardLevel, lastAssessment, nextAssessment, status, controls } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (area !== undefined) patch.area = area;
  if (hazardLevel !== undefined) patch.hazard_level = hazardLevel;
  if (lastAssessment !== undefined) patch.last_assessment = lastAssessment;
  if (nextAssessment !== undefined) patch.next_assessment = nextAssessment;
  if (status !== undefined) patch.status = status;
  if (controls !== undefined) patch.controls = Number(controls);

  const { data, error } = await supabaseAdmin.from('hr_risk_assessments').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/risk/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_risk_assessments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
