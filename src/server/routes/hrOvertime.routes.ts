/**
 * HR Time & Overtime API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for overtime requests, TOIL records, overtime
 * history, and labor cost analysis.
 *
 * Mounted at /api/hr-portal/overtime.
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

const CACHE_PREFIX = 'hr-overtime:';

// ── Dashboard statistics ─────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const monthEnd = today.slice(0, 8) + new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

  const [pendingRes, hoursRes, costRes, toilRes] = await Promise.all([
    supabaseAdmin.from('hr_overtime_requests').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Pending'),
    supabaseAdmin.from('hr_overtime_requests').select('hours', { head: false }).eq('property_id', propertyId).eq('status', 'Approved').gte('overtime_date', monthStart).lte('overtime_date', monthEnd),
    supabaseAdmin.from('hr_labor_cost_analysis').select('overtime_cost', { head: false }).eq('property_id', propertyId),
    supabaseAdmin.from('hr_toil_records').select('balance', { head: false }).eq('property_id', propertyId),
  ]);

  const hours = (hoursRes.data || []).reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const cost  = (costRes.data  || []).reduce((s, r) => s + (Number(r.overtime_cost) || 0), 0);
  const toil  = (toilRes.data  || []).reduce((s, r) => s + (Number(r.balance) || 0), 0);

  const stats = {
    pendingRequests: pendingRes.count ?? 0,
    overtimeHoursMtd: `${hours}h`,
    overtimeCostMtd: `$${cost.toLocaleString()}`,
    toilBalance: `${toil}h`,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Overtime Requests ────────────────────────────────────────────────────
router.get('/requests/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_overtime_requests')
    .select('*')
    .eq('property_id', propertyId)
    .order('overtime_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

router.post('/requests', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, department, type, date, startTime, endTime, hours, rate, reason } = req.body || {};
  if (!propertyId || !employeeId || !date || !hours) {
    return res.status(400).json({ error: 'propertyId, employeeId, date and hours are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_overtime_requests').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    department: department || 'Front Office',
    type: type || 'Regular Overtime',
    overtime_date: date,
    start_time: startTime || null,
    end_time: endTime || null,
    hours: Number(hours) || 0,
    rate: rate || '1.5x',
    reason: reason?.trim() || null,
    status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, date, startTime, endTime, hours, rate, reason, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (type !== undefined) patch.type = type;
  if (date !== undefined) patch.overtime_date = date;
  if (startTime !== undefined) patch.start_time = startTime;
  if (endTime !== undefined) patch.end_time = endTime;
  if (hours !== undefined) patch.hours = Number(hours);
  if (rate !== undefined) patch.rate = rate;
  if (reason !== undefined) patch.reason = reason?.trim() || null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_overtime_requests').update(patch).eq('id', req.params.id).select().single();
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

  const { data, error } = await supabaseAdmin.from('hr_overtime_requests').update({
    status,
    reviewed_by: reviewedBy || null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: `overtime.request.${status.toLowerCase()}`, entityType: 'overtime_request', entityId: req.params.id, details: { employeeName: data?.employee_name, hours: data?.hours, reviewedBy } });
  hrNotify({ propertyId: data?.property_id || '', message: `Overtime request ${status.toLowerCase()} — ${data?.employee_name} (${data?.hours}h)` });
  return res.json(data);
});

router.delete('/requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_overtime_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── TOIL Records ─────────────────────────────────────────────────────────
router.get('/toil/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const { data, error } = await supabaseAdmin.from('hr_toil_records')
    .select('*')
    .eq('property_id', propertyId)
    .order('employee_name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ toil: data || [] });
});

router.post('/toil', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, department, hoursEarned, hoursUsed, expiryDate, status } = req.body || {};
  if (!propertyId || !employeeId) return res.status(400).json({ error: 'propertyId and employeeId are required' });

  const { data, error } = await supabaseAdmin.from('hr_toil_records').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName?.trim() || employeeId,
    department: department || 'Front Office',
    hours_earned: Number(hoursEarned) || 0,
    hours_used: Number(hoursUsed) || 0,
    expiry_date: expiryDate || null,
    status: status || 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/toil/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { hoursEarned, hoursUsed, expiryDate, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (hoursEarned !== undefined) patch.hours_earned = Number(hoursEarned);
  if (hoursUsed !== undefined) patch.hours_used = Number(hoursUsed);
  if (expiryDate !== undefined) patch.expiry_date = expiryDate || null;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_toil_records').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/toil/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_toil_records').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Overtime History ─────────────────────────────────────────────────────
router.get('/history/:propertyId/:range?', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, range = '6months' } = req.params;

  const { data, error } = await supabaseAdmin.from('hr_overtime_history')
    .select('*')
    .eq('property_id', propertyId)
    .order('period', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  let periods = data || [];
  if (range === '6months') periods = periods.slice(0, 6);
  if (range === '1year') periods = periods.slice(0, 12);

  return res.json({ history: periods });
});

// ── Labor Cost Analysis ──────────────────────────────────────────────────
router.get('/analysis/:propertyId/:period?', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, period = 'June 2024' } = req.params;

  const { data, error } = await supabaseAdmin.from('hr_labor_cost_analysis')
    .select('*')
    .eq('property_id', propertyId)
    .eq('period', period)
    .order('department', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ analysis: data || [] });
});

// ── CSV Export ───────────────────────────────────────────────────────────
router.get('/export/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const { data, error } = await supabaseAdmin.from('hr_overtime_requests')
    .select('*')
    .eq('property_id', propertyId)
    .order('overtime_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const headers = ['Employee', 'Department', 'Date', 'Type', 'Start', 'End', 'Hours', 'Rate', 'Reason', 'Status'];
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r: any) => [
      escape(r.employee_name),
      escape(r.department),
      escape(r.overtime_date),
      escape(r.type),
      escape(r.start_time),
      escape(r.end_time),
      escape(r.hours),
      escape(r.rate),
      escape(r.reason),
      escape(r.status),
    ].join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="overtime_export.csv"`);
  return res.send(csv);
});

// ── Employees ────────────────────────────────────────────────────────────
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

export default router;
