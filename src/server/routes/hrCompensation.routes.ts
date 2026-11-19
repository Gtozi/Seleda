/**
 * HR Compensation & Benefits API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for salary grades, benefit plans, allowances, and
 * additional benefits. Mounted at /api/hr-portal/compensation.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-compensation:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [gradesRes, benefitsRes, allowancesRes] = await Promise.all([
    supabaseAdmin.from('hr_salary_grades').select('midpoint, employees').eq('property_id', propertyId),
    supabaseAdmin.from('hr_benefit_plans').select('enrolled, eligible, employer_contribution').eq('property_id', propertyId).eq('status', 'Active'),
    supabaseAdmin.from('hr_allowances').select('amount, eligible_employees').eq('property_id', propertyId),
  ]);

  const grades = gradesRes.data || [];
  const benefits = benefitsRes.data || [];
  const allowances = allowancesRes.data || [];

  const totalEmployees = grades.reduce((s, g) => s + (Number(g.employees) || 0), 0);
  const totalMidpoint = grades.reduce((s, g) => s + (Number(g.midpoint) || 0) * (Number(g.employees) || 0), 0);
  const avgSalary = totalEmployees > 0 ? totalMidpoint / totalEmployees : 0;

  const totalEnrolled = benefits.reduce((s, b) => s + (Number(b.enrolled) || 0), 0);
  const totalEligible = benefits.reduce((s, b) => s + (Number(b.eligible) || 0), 0);
  const enrollmentRate = totalEligible > 0 ? Math.round((totalEnrolled / totalEligible) * 100) : 0;

  const benefitsCost = benefits.reduce((s, b) => s + (Number(b.employer_contribution) || 0) * (Number(b.enrolled) || 0) * 0.01 * avgSalary / 100, 0);
  const totalPayroll = totalMidpoint;

  const stats = {
    totalPayroll,
    enrollmentRate,
    avgSalary,
    benefitsCost,
    gradeCount: grades.length,
    benefitPlanCount: benefits.length,
    allowanceCount: allowances.length,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Salary Grades ──────────────────────────────────────────────────────────
router.get('/salary-grades/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_salary_grades')
    .select('*').eq('property_id', propertyId).order('min_salary', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ grades: data || [] });
});

router.post('/salary-grades', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, grade, level, minSalary, maxSalary, midpoint, positions, employees } = req.body || {};
  if (!propertyId || !grade || !level) return res.status(400).json({ error: 'propertyId, grade and level are required' });

  const { data, error } = await supabaseAdmin.from('hr_salary_grades').insert({
    property_id: propertyId, grade, level,
    min_salary: Number(minSalary) || 0, max_salary: Number(maxSalary) || 0, midpoint: Number(midpoint) || 0,
    positions: Number(positions) || 0, employees: Number(employees) || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/salary-grades/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { grade, level, minSalary, maxSalary, midpoint, positions, employees } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (grade !== undefined) patch.grade = grade;
  if (level !== undefined) patch.level = level;
  if (minSalary !== undefined) patch.min_salary = Number(minSalary);
  if (maxSalary !== undefined) patch.max_salary = Number(maxSalary);
  if (midpoint !== undefined) patch.midpoint = Number(midpoint);
  if (positions !== undefined) patch.positions = Number(positions);
  if (employees !== undefined) patch.employees = Number(employees);

  const { data, error } = await supabaseAdmin.from('hr_salary_grades').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/salary-grades/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_salary_grades').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Benefit Plans ─────────────────────────────────────────────────────────
router.get('/benefit-plans/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_benefit_plans')
    .select('*').eq('property_id', propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ plans: data || [] });
});

router.post('/benefit-plans', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, type, description, coverage, employerContribution, employeeContribution, enrolled, eligible, status } = req.body || {};
  if (!propertyId || !name || !type) return res.status(400).json({ error: 'propertyId, name and type are required' });

  const { data, error } = await supabaseAdmin.from('hr_benefit_plans').insert({
    property_id: propertyId, name, type,
    description: description || null, coverage: coverage || null,
    employer_contribution: Number(employerContribution) || 0, employee_contribution: Number(employeeContribution) || 0,
    enrolled: Number(enrolled) || 0, eligible: Number(eligible) || 0,
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/benefit-plans/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, description, coverage, employerContribution, employeeContribution, enrolled, eligible, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (type !== undefined) patch.type = type;
  if (description !== undefined) patch.description = description;
  if (coverage !== undefined) patch.coverage = coverage;
  if (employerContribution !== undefined) patch.employer_contribution = Number(employerContribution);
  if (employeeContribution !== undefined) patch.employee_contribution = Number(employeeContribution);
  if (enrolled !== undefined) patch.enrolled = Number(enrolled);
  if (eligible !== undefined) patch.eligible = Number(eligible);
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_benefit_plans').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/benefit-plans/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_benefit_plans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Allowances ────────────────────────────────────────────────────────────
router.get('/allowances/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_allowances')
    .select('*').eq('property_id', propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ allowances: data || [] });
});

router.post('/allowances', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, type, amount, eligibleEmployees, description } = req.body || {};
  if (!propertyId || !name || !type) return res.status(400).json({ error: 'propertyId, name and type are required' });

  const { data, error } = await supabaseAdmin.from('hr_allowances').insert({
    property_id: propertyId, name, type,
    amount: Number(amount) || 0, eligible_employees: Number(eligibleEmployees) || 0,
    description: description || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/allowances/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, amount, eligibleEmployees, description } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (type !== undefined) patch.type = type;
  if (amount !== undefined) patch.amount = Number(amount);
  if (eligibleEmployees !== undefined) patch.eligible_employees = Number(eligibleEmployees);
  if (description !== undefined) patch.description = description;

  const { data, error } = await supabaseAdmin.from('hr_allowances').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/allowances/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_allowances').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Additional Benefits ──────────────────────────────────────────────────
router.get('/additional-benefits/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_additional_benefits')
    .select('*').eq('property_id', propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ benefits: data || [] });
});

router.post('/additional-benefits', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, type, description, coverage, available, occupied, waitingList, status } = req.body || {};
  if (!propertyId || !name || !type) return res.status(400).json({ error: 'propertyId, name and type are required' });

  const { data, error } = await supabaseAdmin.from('hr_additional_benefits').insert({
    property_id: propertyId, name, type,
    description: description || null, coverage: coverage || null,
    available: available != null ? Number(available) : null,
    occupied: occupied != null ? Number(occupied) : null,
    waiting_list: waitingList != null ? Number(waitingList) : null,
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/additional-benefits/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, description, coverage, available, occupied, waitingList, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (type !== undefined) patch.type = type;
  if (description !== undefined) patch.description = description;
  if (coverage !== undefined) patch.coverage = coverage;
  if (available !== undefined) patch.available = available != null ? Number(available) : null;
  if (occupied !== undefined) patch.occupied = occupied != null ? Number(occupied) : null;
  if (waitingList !== undefined) patch.waiting_list = waitingList != null ? Number(waitingList) : null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_additional_benefits').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/additional-benefits/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_additional_benefits').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
