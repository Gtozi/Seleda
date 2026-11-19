/**
 * HR Learning & Development API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for learning plans, mandatory training, leadership
 * programs, and learning history. Mounted at /api/hr-portal/learning.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-learning:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [plansRes, mandatoryRes, leadershipRes, historyRes] = await Promise.all([
    supabaseAdmin.from('hr_learning_plans').select('status').eq('property_id', propertyId),
    supabaseAdmin.from('hr_mandatory_training').select('completion_rate, total_employees, completed_employees').eq('property_id', propertyId).eq('status', 'Active'),
    supabaseAdmin.from('hr_leadership_programs').select('status').eq('property_id', propertyId),
    supabaseAdmin.from('hr_learning_history').select('status, score').eq('property_id', propertyId),
  ]);

  const plans = plansRes.data || [];
  const mandatory = mandatoryRes.data || [];
  const leadership = leadershipRes.data || [];
  const history = historyRes.data || [];

  const activePlans = plans.filter((p) => p.status === 'In Progress' || p.status === 'Pending').length;
  const mandatoryCount = mandatory.length;
  const leadershipCount = leadership.filter((l) => l.status === 'Active').length;
  const completedHistory = history.filter((h) => h.status === 'Completed');
  const completionRate = history.length > 0 ? Math.round((completedHistory.length / history.length) * 100) : 0;
  const avgScore = completedHistory.length > 0
    ? Math.round(completedHistory.reduce((s, h) => s + (Number(h.score) || 0), 0) / completedHistory.length)
    : 0;

  const stats = {
    activePlans,
    mandatoryCount,
    leadershipCount,
    completionRate,
    avgScore,
    historyCount: history.length,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Learning Plans ─────────────────────────────────────────────────────────
router.get('/plans/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_learning_plans')
    .select('*').eq('property_id', req.params.propertyId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ plans: data || [] });
});

router.post('/plans', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, position, department, planName, startDate, endDate, status, progress, totalCourses, completedCourses, assignedBy } = req.body || {};
  if (!propertyId || !employee || !planName) return res.status(400).json({ error: 'propertyId, employee and planName are required' });

  const { data, error } = await supabaseAdmin.from('hr_learning_plans').insert({
    property_id: propertyId, employee, position: position || null, department: department || null, plan_name: planName,
    start_date: startDate || null, end_date: endDate || null,
    status: status || 'In Progress', progress: Number(progress) || 0,
    total_courses: Number(totalCourses) || 0, completed_courses: Number(completedCourses) || 0,
    assigned_by: assignedBy || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/plans/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, position, department, planName, startDate, endDate, status, progress, totalCourses, completedCourses, assignedBy } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (position !== undefined) patch.position = position;
  if (department !== undefined) patch.department = department;
  if (planName !== undefined) patch.plan_name = planName;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (status !== undefined) patch.status = status;
  if (progress !== undefined) patch.progress = Number(progress);
  if (totalCourses !== undefined) patch.total_courses = Number(totalCourses);
  if (completedCourses !== undefined) patch.completed_courses = Number(completedCourses);
  if (assignedBy !== undefined) patch.assigned_by = assignedBy;

  const { data, error } = await supabaseAdmin.from('hr_learning_plans').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/plans/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_learning_plans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Mandatory Training ────────────────────────────────────────────────────
router.get('/mandatory/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_mandatory_training')
    .select('*').eq('property_id', req.params.propertyId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ training: data || [] });
});

router.post('/mandatory', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, category, duration, frequency, dueDate, status, completionRate, totalEmployees, completedEmployees } = req.body || {};
  if (!propertyId || !name || !category) return res.status(400).json({ error: 'propertyId, name and category are required' });

  const { data, error } = await supabaseAdmin.from('hr_mandatory_training').insert({
    property_id: propertyId, name, category,
    duration: duration || null, frequency: frequency || null, due_date: dueDate || null,
    status: status || 'Active',
    completion_rate: Number(completionRate) || 0,
    total_employees: Number(totalEmployees) || 0,
    completed_employees: Number(completedEmployees) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/mandatory/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, category, duration, frequency, dueDate, status, completionRate, totalEmployees, completedEmployees } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (category !== undefined) patch.category = category;
  if (duration !== undefined) patch.duration = duration;
  if (frequency !== undefined) patch.frequency = frequency;
  if (dueDate !== undefined) patch.due_date = dueDate;
  if (status !== undefined) patch.status = status;
  if (completionRate !== undefined) patch.completion_rate = Number(completionRate);
  if (totalEmployees !== undefined) patch.total_employees = Number(totalEmployees);
  if (completedEmployees !== undefined) patch.completed_employees = Number(completedEmployees);

  const { data, error } = await supabaseAdmin.from('hr_mandatory_training').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/mandatory/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_mandatory_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Leadership Programs ───────────────────────────────────────────────────
router.get('/leadership/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_leadership_programs')
    .select('*').eq('property_id', req.params.propertyId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ programs: data || [] });
});

router.post('/leadership', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, description, duration, participants, status, startDate, endDate, modules } = req.body || {};
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_leadership_programs').insert({
    property_id: propertyId, name,
    description: description || null, duration: duration || null,
    participants: Number(participants) || 0, status: status || 'Active',
    start_date: startDate || null, end_date: endDate || null,
    modules: Number(modules) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/leadership/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, duration, participants, status, startDate, endDate, modules } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (duration !== undefined) patch.duration = duration;
  if (participants !== undefined) patch.participants = Number(participants);
  if (status !== undefined) patch.status = status;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (modules !== undefined) patch.modules = Number(modules);

  const { data, error } = await supabaseAdmin.from('hr_leadership_programs').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/leadership/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_leadership_programs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Learning History ──────────────────────────────────────────────────────
router.get('/history/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_learning_history')
    .select('*').eq('property_id', req.params.propertyId).order('completion_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ history: data || [] });
});

router.post('/history', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employee, course, category, completionDate, status, score, certificate } = req.body || {};
  if (!propertyId || !employee || !course) return res.status(400).json({ error: 'propertyId, employee and course are required' });

  const { data, error } = await supabaseAdmin.from('hr_learning_history').insert({
    property_id: propertyId, employee, course,
    category: category || null, completion_date: completionDate || null,
    status: status || 'Completed',
    score: Number(score) || 0,
    certificate: Boolean(certificate),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/history/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, course, category, completionDate, status, score, certificate } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (course !== undefined) patch.course = course;
  if (category !== undefined) patch.category = category;
  if (completionDate !== undefined) patch.completion_date = completionDate;
  if (status !== undefined) patch.status = status;
  if (score !== undefined) patch.score = Number(score);
  if (certificate !== undefined) patch.certificate = Boolean(certificate);

  const { data, error } = await supabaseAdmin.from('hr_learning_history').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/history/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_learning_history').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
