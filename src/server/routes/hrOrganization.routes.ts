/**
 * HR Organization Management API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for departments, teams, and positions, plus a combined
 * hierarchy tree and dashboard statistics. Powers the HR > Organization
 * module (replacing the hardcoded placeholder data).
 *
 * Mounted at /api/hr-portal/organization.
 * Pattern mirrors the Housekeeping & F&B portal routes (property-scoped,
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

const CACHE_PREFIX = 'hr-org:';

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [deptRes, teamRes, posRes, vacantRes] = await Promise.all([
    supabaseAdmin.from('hr_departments').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('is_active', true),
    supabaseAdmin.from('hr_teams').select('id, department_id!inner(property_id)', { count: 'exact', head: true }).eq('department_id.property_id', propertyId).eq('is_active', true),
    supabaseAdmin.from('hr_positions').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('is_active', true),
    supabaseAdmin.from('hr_positions').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('is_active', true).gt('vacancies', 0),
  ]);

  const stats = {
    totalDepartments: deptRes.count ?? 0,
    totalTeams: teamRes.count ?? 0,
    totalPositions: posRes.count ?? 0,
    vacantPositions: vacantRes.count ?? 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Organization tree (departments → teams + headcount) ───────────────────
router.get('/tree/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}tree:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [deptRes, teamRes] = await Promise.all([
    supabaseAdmin
      .from('hr_departments')
      .select('id, name, code, parent_id, head_employee_id, cost_center, description, is_active, employees!head_employee_id(name)')
      .eq('property_id', propertyId)
      .order('name'),
    supabaseAdmin
      .from('hr_teams')
      .select('id, department_id, name, head_employee_id, is_active, employees!head_employee_id(name)')
      .order('name'),
  ]);

  if (deptRes.error) return res.status(500).json({ error: deptRes.error.message });
  if (teamRes.error) return res.status(500).json({ error: teamRes.error.message });

  // Headcount per department/property from employees.
  const empRes = await supabaseAdmin
    .from('employees')
    .select('department')
    .eq('property_id', propertyId)
    .eq('status', 'Active');

  const headcountByDeptName: Record<string, number> = {};
  for (const e of empRes.data || []) {
    const d = (e.department || '').trim();
    if (d) headcountByDeptName[d] = (headcountByDeptName[d] || 0) + 1;
  }

  const departments = (deptRes.data || []).map((d: any) => ({
    ...d,
    headName: d.employees?.name ?? null,
    headcount: headcountByDeptName[d.name] ?? 0,
    teams: (teamRes.data || []).filter((t: any) => t.department_id === d.id).map((t: any) => ({
      id: t.id,
      name: t.name,
      headName: t.employees?.name ?? null,
      isActive: t.is_active,
    })),
  }));

  const tree = { departments };
  cacheService.set(cacheKey, tree, 60 * 1000);
  return res.json(tree);
});

// ── Departments CRUD ──────────────────────────────────────────────────────
router.get('/departments/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hr_departments')
    .select('*, employees!head_employee_id(name)')
    .eq('property_id', req.params.propertyId)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ departments: data || [] });
});

router.post('/departments', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, code, parentId, headEmployeeId, costCenter, description } = req.body || {};
  if (!propertyId || !name?.trim()) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_departments').insert({
    property_id: propertyId,
    name: name.trim(),
    code: code?.trim() || null,
    parent_id: parentId || null,
    head_employee_id: headEmployeeId || null,
    cost_center: costCenter?.trim() || null,
    description: description?.trim() || null,
    is_active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/departments/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { name, code, parentId, headEmployeeId, costCenter, description, isActive } = req.body || {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code || null;
  if (parentId !== undefined) patch.parent_id = parentId || null;
  if (headEmployeeId !== undefined) patch.head_employee_id = headEmployeeId || null;
  if (costCenter !== undefined) patch.cost_center = costCenter || null;
  if (description !== undefined) patch.description = description || null;
  if (isActive !== undefined) patch.is_active = isActive;

  const { data, error } = await supabaseAdmin.from('hr_departments').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/departments/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { hard } = req.query as Record<string, string>;
  if (hard === 'true') {
    const { error } = await supabaseAdmin.from('hr_departments').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin.from('hr_departments').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Teams CRUD ────────────────────────────────────────────────────────────
router.get('/teams/:departmentId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hr_teams')
    .select('*, employees!head_employee_id(name)')
    .eq('department_id', req.params.departmentId)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ teams: data || [] });
});

router.post('/teams', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { departmentId, name, headEmployeeId } = req.body || {};
  if (!departmentId || !name?.trim()) return res.status(400).json({ error: 'departmentId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_teams').insert({
    department_id: departmentId,
    name: name.trim(),
    head_employee_id: headEmployeeId || null,
    is_active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/teams/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { name, headEmployeeId, isActive } = req.body || {};
  if (name !== undefined) patch.name = name;
  if (headEmployeeId !== undefined) patch.head_employee_id = headEmployeeId || null;
  if (isActive !== undefined) patch.is_active = isActive;

  const { data, error } = await supabaseAdmin.from('hr_teams').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/teams/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { hard } = req.query as Record<string, string>;
  if (hard === 'true') {
    const { error } = await supabaseAdmin.from('hr_teams').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin.from('hr_teams').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Positions CRUD ────────────────────────────────────────────────────────
router.get('/positions/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('hr_positions')
    .select('*, hr_departments(name), parent:hr_positions!reports_to_position_id(title)')
    .eq('property_id', req.params.propertyId)
    .order('title');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ positions: data || [] });
});

router.post('/positions', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, departmentId, title, code, grade, reportsToPositionId, reportsToLabel, vacancies, budget } = req.body || {};
  if (!propertyId || !title?.trim()) return res.status(400).json({ error: 'propertyId and title are required' });

  const { data, error } = await supabaseAdmin.from('hr_positions').insert({
    property_id: propertyId,
    department_id: departmentId || null,
    title: title.trim(),
    code: code?.trim() || null,
    grade: grade?.trim() || 'Staff',
    reports_to_position_id: reportsToPositionId || null,
    reports_to_label: reportsToLabel?.trim() || null,
    vacancies: Number(vacancies) || 0,
    budget: Number(budget) || 0,
    is_active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/positions/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const { departmentId, title, code, grade, reportsToPositionId, reportsToLabel, vacancies, budget, isActive } = req.body || {};
  if (departmentId !== undefined) patch.department_id = departmentId || null;
  if (title !== undefined) patch.title = title;
  if (code !== undefined) patch.code = code || null;
  if (grade !== undefined) patch.grade = grade;
  if (reportsToPositionId !== undefined) patch.reports_to_position_id = reportsToPositionId || null;
  if (reportsToLabel !== undefined) patch.reports_to_label = reportsToLabel || null;
  if (vacancies !== undefined) patch.vacancies = Number(vacancies) || 0;
  if (budget !== undefined) patch.budget = Number(budget) || 0;
  if (isActive !== undefined) patch.is_active = isActive;

  const { data, error } = await supabaseAdmin.from('hr_positions').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/positions/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { hard } = req.query as Record<string, string>;
  if (hard === 'true') {
    const { error } = await supabaseAdmin.from('hr_positions').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin.from('hr_positions').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Employees (for department head / position assignment dropdowns) ───────
router.get('/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, department, position, status')
    .eq('property_id', req.params.propertyId)
    .eq('status', 'Active')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

export default router;
