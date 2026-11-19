/**
 * HR Manager Self-Service (MSS) API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for manager approvals, team roster, performance
 * reviews, and recruitment requests. Powers the HR > MSS module
 * (replacing the hardcoded placeholder data in ManagerSelfService.tsx).
 *
 * Mounted at /api/hr-portal/mss.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-mss:';

// ── Dashboard statistics ────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [pendingRes, teamRes, onLeaveRes, reviewRes] = await Promise.all([
    supabaseAdmin.from('hr_manager_approvals').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Pending'),
    supabaseAdmin.from('employees').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Approved'),
    supabaseAdmin.from('hr_performance_reviews').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).in('status', ['Pending', 'In Progress']),
  ]);

  const stats = {
    pendingApprovals: pendingRes.count ?? 0,
    teamMembers: teamRes.count ?? 0,
    onLeaveToday: onLeaveRes.count ?? 0,
    performanceReviews: reviewRes.count ?? 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Approvals queue ─────────────────────────────────────────────────────
router.get('/approvals/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, type, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_manager_approvals')
    .select('*')
    .eq('property_id', propertyId)
    .order('request_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ approvals: data || [] });
});

router.post('/approvals', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, type, details, requestDate, priority } = req.body || {};
  if (!propertyId || !employeeId || !type || !details?.trim()) {
    return res.status(400).json({ error: 'propertyId, employeeId, type and details are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_manager_approvals').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    type,
    details: details.trim(),
    request_date: requestDate || new Date().toISOString().slice(0, 10),
    priority: priority || 'Normal',
    status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/approvals/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.body || {};
  if (!status || !['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be Approved or Rejected' });
  }

  const { data, error } = await supabaseAdmin.from('hr_manager_approvals')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── My Team ─────────────────────────────────────────────────────────────
router.get('/team/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { department, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('employees')
    .select('id, name, email, phone, department, position, status, employee_number, avatar_initials')
    .eq('property_id', propertyId)
    .order('name', { ascending: true });

  if (department) q = q.eq('department', department);
  if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ team: data || [] });
});

// ── Team schedule / roster ──────────────────────────────────────────────
router.get('/schedule/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { date, department, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_team_roster')
    .select('*')
    .eq('property_id', propertyId)
    .order('roster_date', { ascending: true });

  if (date) q = q.eq('roster_date', date);
  if (department) q = q.eq('department', department);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ roster: data || [] });
});

router.post('/schedule', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, department, rosterDate, shift, role } = req.body || {};
  if (!propertyId || !employeeId || !rosterDate || !department) {
    return res.status(400).json({ error: 'propertyId, employeeId, rosterDate and department are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_team_roster').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    department,
    roster_date: rosterDate,
    shift: shift || 'Morning',
    role: role?.trim() || '-',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/schedule/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { rosterDate, shift, role } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (rosterDate !== undefined) patch.roster_date = rosterDate;
  if (shift !== undefined) patch.shift = shift;
  if (role !== undefined) patch.role = role;

  const { data, error } = await supabaseAdmin.from('hr_team_roster').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/schedule/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_team_roster').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Performance reviews ─────────────────────────────────────────────────
router.get('/performance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_performance_reviews')
    .select('*')
    .eq('property_id', propertyId)
    .order('due_date', { ascending: true });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ reviews: data || [] });
});

router.post('/performance', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, period, dueDate, goals, reviewer } = req.body || {};
  if (!propertyId || !employeeId || !period?.trim() || !dueDate) {
    return res.status(400).json({ error: 'propertyId, employeeId, period and dueDate are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_performance_reviews').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    period: period.trim(),
    due_date: dueDate,
    goals: Number(goals) || 5,
    completed: 0,
    status: 'Pending',
    reviewer: reviewer?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/performance/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { period, dueDate, status, goals, completed, reviewer } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (period !== undefined) patch.period = period;
  if (dueDate !== undefined) patch.due_date = dueDate;
  if (status !== undefined) patch.status = status;
  if (goals !== undefined) patch.goals = Number(goals);
  if (completed !== undefined) patch.completed = Number(completed);
  if (reviewer !== undefined) patch.reviewer = reviewer || null;

  const { data, error } = await supabaseAdmin.from('hr_performance_reviews').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/performance/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_performance_reviews').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Recruitment requests ────────────────────────────────────────────────
router.get('/recruitment/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_recruitment_requests')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('position', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ recruitment: data || [] });
});

router.post('/recruitment', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, position, department, requestType, priority, vacancies, requestedBy } = req.body || {};
  if (!propertyId || !position?.trim() || !department?.trim()) {
    return res.status(400).json({ error: 'propertyId, position and department are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_recruitment_requests').insert({
    property_id: propertyId,
    position: position.trim(),
    department: department.trim(),
    request_type: requestType || 'New Position',
    priority: priority || 'Normal',
    status: 'Pending',
    vacancies: Number(vacancies) || 1,
    requested_by: requestedBy?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/recruitment/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { position, department, requestType, priority, status, vacancies } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (position !== undefined) patch.position = position;
  if (department !== undefined) patch.department = department;
  if (requestType !== undefined) patch.request_type = requestType;
  if (priority !== undefined) patch.priority = priority;
  if (status !== undefined) patch.status = status;
  if (vacancies !== undefined) patch.vacancies = Number(vacancies);

  const { data, error } = await supabaseAdmin.from('hr_recruitment_requests').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/recruitment/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_recruitment_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
