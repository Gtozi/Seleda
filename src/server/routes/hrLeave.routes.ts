/**
 * HR Leave Management API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for leave requests and leave balances.
 *
 * Mounted at /api/hr-portal/leave.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { hrAudit, hrNotify } from '../services/hrNotifications';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-leave:';

// ── Dashboard statistics ─────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const today = new Date().toISOString().slice(0, 10);

  const [activeRes, pendingRes, sickRes] = await Promise.all([
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).eq('status', 'Approved').lte('start_date', today).gte('end_date', today),
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).eq('status', 'Pending'),
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).eq('leave_type', 'Sick').gte('start_date', addDays(today, -30)),
  ]);

  const { data: totalBal, error: balErr } = await supabaseAdmin.from('hr_leave_balances')
    .select('total_days, used_days')
    .eq('property_id', propertyId);
  if (balErr) return res.status(500).json({ error: balErr.message });

  const total = (totalBal || []).reduce((s, r) => s + (Number(r.total_days) || 0), 0);
  const used  = (totalBal || []).reduce((s, r) => s + (Number(r.used_days)  || 0), 0);
  const utilization = total > 0 ? Math.round((used / total) * 100) : 0;

  const stats = {
    activeOnLeave: activeRes.count ?? 0,
    pendingApplications: pendingRes.count ?? 0,
    sickLeaves: sickRes.count ?? 0,
    leaveUtilization: utilization,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Leave Requests ───────────────────────────────────────────────────────
router.get('/requests/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_leave_requests')
    .select('id, property_id, employee_id, employee_name, leave_type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at, created_at, updated_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

router.post('/requests', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, leaveType, startDate, endDate, days, reason } = req.body || {};
  if (!propertyId || !employeeId || !leaveType || !startDate || !endDate) {
    return res.status(400).json({ error: 'propertyId, employeeId, leaveType, startDate and endDate are required' });
  }

  const requestedDays = days !== undefined ? Number(days) : diffDays(startDate, endDate) + 1;
  const { data, error } = await supabaseAdmin.from('hr_leave_requests').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    leave_type: leaveType,
    start_date: startDate,
    end_date: endDate,
    days: requestedDays,
    reason: reason?.trim() || null,
    status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'leave.request.submitted', entityType: 'leave_request', entityId: data?.id, details: { employeeId, leaveType, startDate, endDate, days: requestedDays } });
  hrNotify({ propertyId, message: `Leave request submitted by ${employeeName || employeeId} — ${leaveType}, ${startDate} to ${endDate}` });
  return res.status(201).json(data);
});

router.put('/requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { leaveType, startDate, endDate, days, reason, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (leaveType !== undefined) patch.leave_type = leaveType;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (days !== undefined) patch.days = Number(days);
  if (reason !== undefined) patch.reason = reason?.trim() || null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.put('/requests/:id/approve', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, reviewedBy } = req.body || {};
  if (!status || !['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be Approved or Rejected' });
  }

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').update({
    status,
    reviewed_by: reviewedBy || null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: `leave.request.${status.toLowerCase()}`, entityType: 'leave_request', entityId: req.params.id, details: { employeeName: data?.employee_name, leaveType: data?.leave_type, reviewedBy } });
  hrNotify({ propertyId: data?.property_id || '', message: `Leave request ${status.toLowerCase()} — ${data?.employee_name} (${data?.leave_type})` });
  return res.json(data);
});

router.delete('/requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_leave_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Leave Balances ───────────────────────────────────────────────────────
router.get('/balances/:propertyId/:department?', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, department } = req.params;

  let q = supabaseAdmin.from('hr_leave_balances')
    .select('id, property_id, employee_id, employee_name, department, leave_type, total_days, used_days, created_at, updated_at')
    .eq('property_id', propertyId)
    .order('employee_name', { ascending: true });

  if (department && department !== 'All') q = q.eq('department', department);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ balances: data || [] });
});

// ── Employees eligible for leave entry ────────────────────────────────────
router.get('/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const { data, error } = await supabaseAdmin.from('employees')
    .select('id, name, department, position, employee_number')
    .eq('property_id', propertyId)
    .eq('status', 'Active')
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// ── Helpers ──────────────────────────────────────────────────────────────
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export default router;
