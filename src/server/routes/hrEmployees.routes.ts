/**
 * HR Employee Directory API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for the employees table, scoped to a property. Powers the
 * HR > Employee Directory module (replacing the hardcoded placeholder data).
 *
 * Mounted at /api/hr-portal/employees.
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

const CACHE_PREFIX = 'hr-emp:';

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [totalRes, activeRes, onLeaveRes, deptRes] = await Promise.all([
    supabaseAdmin.from('employees').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    supabaseAdmin.from('employees').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Active'),
    supabaseAdmin.from('employees').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'On Leave'),
    supabaseAdmin.from('employees').select('department').eq('property_id', propertyId).eq('status', 'Active'),
  ]);

  const departments = new Set<string>();
  for (const row of deptRes.data || []) {
    if (row.department) departments.add(row.department);
  }

  const stats = {
    totalEmployees: totalRes.count ?? 0,
    activeEmployees: activeRes.count ?? 0,
    onLeave: onLeaveRes.count ?? 0,
    departments: departments.size,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── List employees (property-scoped, with search & filters) ───────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { search, department, status, employmentType } = req.query as Record<string, string>;

  let query = supabaseAdmin
    .from('employees')
    .select('*')
    .eq('property_id', propertyId)
    .order('name');

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,position.ilike.%${search}%,employee_number.ilike.%${search}%`);
  }
  if (department && department !== 'all') query = query.eq('department', department);
  if (status && status !== 'all') query = query.eq('status', status);
  if (employmentType && employmentType !== 'all') query = query.eq('employment_type', employmentType);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// ── Departments list (for filter dropdown) ────────────────────────────────
router.get('/meta/departments/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('department')
    .eq('property_id', req.params.propertyId)
    .not('department', 'is', null)
    .order('department');
  if (error) return res.status(500).json({ error: error.message });
  const departments = [...new Set((data || []).map((d: any) => d.department).filter(Boolean))];
  return res.json({ departments });
});

// ── Create employee ───────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    propertyId, name, email, phone, department, position, status,
    hireDate, salary, gender, dateOfBirth, nationality, employmentType,
    employeeNumber, avatarInitials,
  } = req.body || {};

  if (!propertyId || !name?.trim()) {
    return res.status(400).json({ error: 'propertyId and name are required' });
  }

  const insertData: Record<string, any> = {
    property_id: propertyId,
    name: name.trim(),
    email: email?.trim() || null,
    phone: phone?.trim() || null,
    department: department?.trim() || null,
    position: position?.trim() || null,
    status: status || 'Active',
    hire_date: hireDate || null,
    salary: Number(salary) || 0,
    gender: gender || null,
    date_of_birth: dateOfBirth || null,
    nationality: nationality?.trim() || null,
    employment_type: employmentType || 'Full-time',
    employee_number: employeeNumber?.trim() || null,
    avatar_initials: avatarInitials || name.trim().split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
  };

  const { data, error } = await supabaseAdmin.from('employees').insert(insertData).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update employee ───────────────────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const {
    name, email, phone, department, position, status,
    hireDate, salary, gender, dateOfBirth, nationality, employmentType,
    employeeNumber, avatarInitials,
  } = req.body || {};

  if (name !== undefined) patch.name = name;
  if (email !== undefined) patch.email = email || null;
  if (phone !== undefined) patch.phone = phone || null;
  if (department !== undefined) patch.department = department || null;
  if (position !== undefined) patch.position = position || null;
  if (status !== undefined) patch.status = status;
  if (hireDate !== undefined) patch.hire_date = hireDate || null;
  if (salary !== undefined) patch.salary = Number(salary) || 0;
  if (gender !== undefined) patch.gender = gender || null;
  if (dateOfBirth !== undefined) patch.date_of_birth = dateOfBirth || null;
  if (nationality !== undefined) patch.nationality = nationality || null;
  if (employmentType !== undefined) patch.employment_type = employmentType || null;
  if (employeeNumber !== undefined) patch.employee_number = employeeNumber || null;
  if (avatarInitials !== undefined) patch.avatar_initials = avatarInitials || null;

  const { data, error } = await supabaseAdmin.from('employees').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete employee ───────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { hard } = req.query as Record<string, string>;
  if (hard === 'true') {
    const { error } = await supabaseAdmin.from('employees').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin.from('employees').update({ status: 'Terminated', updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
