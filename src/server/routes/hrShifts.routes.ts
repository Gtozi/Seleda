/**
 * HR Shift & Rostering API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for shift types, shift templates, shift swap
 * requests, and the weekly roster grid (hr_team_roster).
 *
 * Mounted at /api/hr-portal/shifts.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-shifts:';

// ── Dashboard statistics ────────────────────────────────────────────────
router.get('/statistics/:propertyId/:weekStart?', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const weekStart = req.params.weekStart || '2024-06-24';
  const weekEnd = addDays(weekStart, 6);

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}:${weekStart}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [scheduledRes, swapsRes, openRes] = await Promise.all([
    supabaseAdmin.from('hr_team_roster').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).gte('roster_date', weekStart).lte('roster_date', weekEnd).neq('shift', 'Off'),
    supabaseAdmin.from('hr_shift_swaps').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Pending'),
    supabaseAdmin.from('hr_team_roster').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).gte('roster_date', weekStart).lte('roster_date', weekEnd).eq('shift', 'Off'),
  ]);

  const scheduled = scheduledRes.count ?? 0;
  const openShifts = openRes.count ?? 0;
  const total = scheduled + openShifts;
  const coverageRate = total > 0 ? Math.round((scheduled / total) * 100) : 0;

  const stats = {
    scheduledThisWeek: scheduled,
    shiftChanges: swapsRes.count ?? 0,
    openShifts,
    coverageRate,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Shift Types ──────────────────────────────────────────────────────────
router.get('/types/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { active } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_shift_types').select('*').eq('property_id', propertyId).order('name', { ascending: true });
  if (active === 'true') q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ types: data || [] });
});

router.post('/types', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, startTime, endTime, color, isActive } = req.body || {};
  if (!propertyId || !name?.trim()) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_shift_types').insert({
    property_id: propertyId,
    name: name.trim(),
    start_time: startTime || null,
    end_time: endTime || null,
    color: color || 'bg-slate-500',
    is_active: isActive !== undefined ? Boolean(isActive) : true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/types/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, startTime, endTime, color, isActive } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (startTime !== undefined) patch.start_time = startTime;
  if (endTime !== undefined) patch.end_time = endTime;
  if (color !== undefined) patch.color = color;
  if (isActive !== undefined) patch.is_active = Boolean(isActive);

  const { data, error } = await supabaseAdmin.from('hr_shift_types').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/types/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_shift_types').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Shift Templates ─────────────────────────────────────────────────────
router.get('/templates/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const { data, error } = await supabaseAdmin.from('hr_shift_templates')
    .select('*').eq('property_id', propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ templates: data || [] });
});

router.post('/templates', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, description, departments, isActive } = req.body || {};
  if (!propertyId || !name?.trim()) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_shift_templates').insert({
    property_id: propertyId,
    name: name.trim(),
    description: description?.trim() || null,
    departments: Array.isArray(departments) ? departments : [],
    is_active: isActive !== undefined ? Boolean(isActive) : true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/templates/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, departments, isActive } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (departments !== undefined) patch.departments = Array.isArray(departments) ? departments : [];
  if (isActive !== undefined) patch.is_active = Boolean(isActive);

  const { data, error } = await supabaseAdmin.from('hr_shift_templates').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/templates/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_shift_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Weekly Roster ────────────────────────────────────────────────────────
router.get('/roster/:propertyId/:weekStart?', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const weekStart = req.params.weekStart || '2024-06-24';
  const weekEnd = addDays(weekStart, 6);
  const { department } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_team_roster')
    .select('id, property_id, employee_id, employee_name, department, roster_date, shift, role, is_published, shift_type_id, created_at, updated_at')
    .eq('property_id', propertyId)
    .gte('roster_date', weekStart)
    .lte('roster_date', weekEnd)
    .order('employee_name', { ascending: true });

  if (department && department !== 'All') q = q.eq('department', department);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ roster: data || [] });
});

router.post('/roster', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, department, rosterDate, shift, role, shiftTypeId, isPublished } = req.body || {};
  if (!propertyId || !employeeId || !rosterDate || !department) {
    return res.status(400).json({ error: 'propertyId, employeeId, rosterDate and department are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_team_roster').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    department,
    roster_date: rosterDate,
    shift: shift || 'Off',
    role: role?.trim() || '-',
    shift_type_id: shiftTypeId || null,
    is_published: Boolean(isPublished),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/roster/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { shift, role, shiftTypeId, isPublished } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (shift !== undefined) patch.shift = shift;
  if (role !== undefined) patch.role = role;
  if (shiftTypeId !== undefined) patch.shift_type_id = shiftTypeId || null;
  if (isPublished !== undefined) patch.is_published = Boolean(isPublished);

  const { data, error } = await supabaseAdmin.from('hr_team_roster').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/roster/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_team_roster').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// Publish all roster entries for a week
router.put('/roster/publish/:propertyId/:weekStart', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, weekStart } = req.params;
  const weekEnd = addDays(weekStart, 6);

  const { data, error } = await supabaseAdmin.from('hr_team_roster')
    .update({ is_published: true, updated_at: new Date().toISOString() })
    .eq('property_id', propertyId)
    .gte('roster_date', weekStart)
    .lte('roster_date', weekEnd)
    .select();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ published: data?.length || 0 });
});

// ── Shift Swap Requests ──────────────────────────────────────────────────
router.get('/swaps/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_shift_swaps')
    .select('*').eq('property_id', propertyId).order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ swaps: data || [] });
});

router.post('/swaps', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, currentShift, requestedShift, reason } = req.body || {};
  if (!propertyId || !employeeId || !currentShift?.trim() || !requestedShift?.trim()) {
    return res.status(400).json({ error: 'propertyId, employeeId, currentShift and requestedShift are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_shift_swaps').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    current_shift: currentShift.trim(),
    requested_shift: requestedShift.trim(),
    reason: reason?.trim() || null,
    status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/swaps/:id/approve', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, reviewedBy } = req.body || {};
  if (!status || !['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be Approved or Rejected' });
  }

  const { data, error } = await supabaseAdmin.from('hr_shift_swaps').update({
    status,
    reviewed_by: reviewedBy || null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/swaps/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_shift_swaps').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Employees eligible for rostering ──────────────────────────────────────
router.get('/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { department } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('employees')
    .select('id, name, department, position, employee_number')
    .eq('property_id', propertyId)
    .eq('status', 'Active')
    .order('name', { ascending: true });

  if (department && department !== 'All') q = q.eq('department', department);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// ── Helpers ──────────────────────────────────────────────────────────────
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default router;
