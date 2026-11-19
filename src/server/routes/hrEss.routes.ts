/**
 * HR Employee Self-Service (ESS) API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for the HR > ESS module. Powers the
 * EmployeeSelfService.tsx component (replacing the hardcoded placeholder
 * data). Reuses existing tables where possible:
 *
 *   employees            — profile
 *   payslips             — payslips
 *   staff_attendance     — attendance
 *   expense_claims       — expense claims
 *   hr_leave_balances    — leave balances (migration 415)
 *   hr_leave_requests    — leave requests (migration 415)
 *   hr_training_requests — training requests (migration 415)
 *   hr_company_documents — company documents (migration 415)
 *
 * Mounted at /api/hr-portal/ess.
 * Pattern mirrors the HR Onboarding / Recruitment / ATS routes
 * (property-scoped, service-role supabaseAdmin, cacheService invalidation).
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-ess:';

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}:${employeeId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [leaveRes, pendingLeaveRes, payslipRes, trainingRes] = await Promise.all([
    supabaseAdmin.from('hr_leave_balances').select('total_days,used_days').eq('property_id', propertyId).eq('employee_id', employeeId),
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('employee_id', employeeId).eq('status', 'Pending'),
    supabaseAdmin.from('payslips').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('employee_id', employeeId),
    supabaseAdmin.from('hr_training_requests').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('employee_id', employeeId).eq('status', 'Pending'),
  ]);

  const balances = (leaveRes.data || []) as { total_days: number; used_days: number }[];
  const totalLeave = balances.reduce((s, b) => s + (Number(b.total_days) || 0), 0);
  const usedLeave = balances.reduce((s, b) => s + (Number(b.used_days) || 0), 0);

  const stats = {
    leaveRemaining: Math.max(0, totalLeave - usedLeave),
    pendingLeaveRequests: pendingLeaveRes.count ?? 0,
    payslipsAvailable: payslipRes.count ?? 0,
    pendingTraining: trainingRes.count ?? 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Profile ───────────────────────────────────────────────────────────────
router.get('/profile/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;

  const cacheKey = `${CACHE_PREFIX}profile:${propertyId}:${employeeId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('property_id', propertyId)
    .eq('id', employeeId)
    .single();
  if (error) return res.status(404).json({ error: 'Employee not found' });

  cacheService.set(cacheKey, data, 60 * 1000);
  return res.json(data);
});

router.put('/profile/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { phone, address, bank_account, pension_number, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (phone !== undefined) patch.phone = phone;
  if (bank_account !== undefined) patch.bank_account = bank_account;
  if (pension_number !== undefined) patch.pension_number = pension_number;

  const { data, error } = await supabaseAdmin.from('employees').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Payslips ──────────────────────────────────────────────────────────────
router.get('/payslips/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('payslips')
    .select('*')
    .eq('property_id', propertyId)
    .eq('employee_id', employeeId)
    .order('paid_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ payslips: data || [] });
});

// ── Leave balances ───────────────────────────────────────────────────────
router.get('/leave-balances/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('hr_leave_balances')
    .select('*')
    .eq('property_id', propertyId)
    .eq('employee_id', employeeId)
    .order('leave_type', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ balances: data || [] });
});

// ── Leave requests ────────────────────────────────────────────────────────
router.get('/leave-requests/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;
  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_leave_requests')
    .select('*')
    .eq('property_id', propertyId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ requests: data || [] });
});

router.post('/leave-requests', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, leaveType, startDate, endDate, days, reason } = req.body || {};
  if (!propertyId || !employeeId || !leaveType?.trim() || !startDate || !endDate) {
    return res.status(400).json({ error: 'propertyId, employeeId, leaveType, startDate and endDate are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    leave_type: leaveType.trim(),
    start_date: startDate,
    end_date: endDate,
    days: Number(days) || 1,
    reason: reason?.trim() || null,
    status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/leave-requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { leaveType, startDate, endDate, days, reason, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (leaveType !== undefined) patch.leave_type = leaveType;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (days !== undefined) patch.days = Number(days);
  if (reason !== undefined) patch.reason = reason || null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/leave-requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_leave_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Attendance ────────────────────────────────────────────────────────────
router.get('/attendance/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance')
    .select('*')
    .eq('property_id', propertyId)
    .eq('employee_id', employeeId)
    .order('attendance_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ attendance: data || [] });
});

// ── Expense claims ────────────────────────────────────────────────────────
router.get('/expenses/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;
  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('expense_claims')
    .select('*')
    .eq('property_id', propertyId)
    .eq('employee_id', employeeId)
    .order('submitted_date', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ expenses: data || [] });
});

router.post('/expenses', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, type, amount, date, description } = req.body || {};
  if (!propertyId || !employeeId || !type?.trim() || amount === undefined) {
    return res.status(400).json({ error: 'propertyId, employeeId, type and amount are required' });
  }

  // expense_claims.status check constraint requires lowercase values.
  const { data, error } = await supabaseAdmin.from('expense_claims').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    amount: Number(amount) || 0,
    category: type.trim(),
    description: description?.trim() || null,
    status: 'pending',
    submitted_date: date || new Date().toISOString().slice(0, 10),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/expenses/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, amount, date, description, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (type !== undefined) patch.category = type;
  if (amount !== undefined) patch.amount = Number(amount);
  if (date !== undefined) patch.submitted_date = date;
  if (description !== undefined) patch.description = description || null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('expense_claims').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/expenses/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('expense_claims').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Training requests ─────────────────────────────────────────────────────
router.get('/training/:propertyId/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId } = req.params;
  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_training_requests')
    .select('*')
    .eq('property_id', propertyId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ training: data || [] });
});

router.post('/training', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, course, startDate, endDate } = req.body || {};
  if (!propertyId || !employeeId || !course?.trim()) {
    return res.status(400).json({ error: 'propertyId, employeeId and course are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_training_requests').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    course: course.trim(),
    start_date: startDate || null,
    end_date: endDate || null,
    status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/training/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { course, startDate, endDate, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (course !== undefined) patch.course = course;
  if (startDate !== undefined) patch.start_date = startDate || null;
  if (endDate !== undefined) patch.end_date = endDate || null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_training_requests').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/training/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_training_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Company documents ─────────────────────────────────────────────────────
router.get('/documents/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_company_documents')
    .select('*')
    .eq('property_id', propertyId)
    .order('document_date', { ascending: false });
  if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ documents: data || [] });
});

router.post('/documents', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, type, documentDate, status } = req.body || {};
  if (!propertyId || !name?.trim() || !type?.trim()) {
    return res.status(400).json({ error: 'propertyId, name and type are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_company_documents').insert({
    property_id: propertyId,
    name: name.trim(),
    type: type.trim(),
    document_date: documentDate || new Date().toISOString().slice(0, 10),
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/documents/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, documentDate, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (type !== undefined) patch.type = type;
  if (documentDate !== undefined) patch.document_date = documentDate;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_company_documents').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/documents/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_company_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
