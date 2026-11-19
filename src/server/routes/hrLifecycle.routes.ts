/**
 * HR Lifecycle API — Offboarding, Leave Accrual, Contract-Expiry alerts
 * ──────────────────────────────────────────────────────────────────────────
 * Mounted at /api/hr-portal/lifecycle.
 *
 *   /offboarding/*          — exit clearance workflow + final settlement
 *   /accrual/*               — leave accrual rules + monthly accrual run
 *   /contract-expiry/*      — employees with contracts expiring within N days
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

const CACHE_PREFIX = 'hr-lifecycle:';

// ════════════════════════════════════════════════════════════════════════════
// OFFBOARDING
// ════════════════════════════════════════════════════════════════════════════

// List offboarding cases
router.get('/offboarding/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_offboarding_cases').select('*')
    .eq('property_id', propertyId).order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ cases: data || [] });
});

// Create offboarding case — also marks the employee as Terminated
router.post('/offboarding', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, department, position, terminationDate, reason, finalSettlement, exitInterviewNotes, createdBy } = req.body || {};
  if (!propertyId || !employeeId || !terminationDate) {
    return res.status(400).json({ error: 'propertyId, employeeId and terminationDate are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_offboarding_cases').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName || '',
    department: department || null,
    position: position || null,
    termination_date: terminationDate,
    reason: reason || 'Resignation',
    final_settlement: Number(finalSettlement) || 0,
    exit_interview_notes: exitInterviewNotes || null,
    created_by: createdBy || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Mark the employee as Terminated
  await supabaseAdmin.from('employees').update({
    status: 'Terminated',
    termination_date: terminationDate,
    termination_reason: reason || 'Resignation',
    terminated_by: createdBy || null,
    updated_at: new Date().toISOString(),
  }).eq('id', employeeId);

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'offboarding.case_created', entityType: 'employee', entityId: employeeId, details: { terminationDate, reason, finalSettlement } });
  hrNotify({ propertyId, message: `Offboarding case opened — ${employeeName || employeeId} (${reason}), effective ${terminationDate}` });
  return res.status(201).json({ case: data });
});

// Update offboarding case (clearance checklist, settlement, exit interview)
router.patch('/offboarding/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { clearanceStatus, finalSettlement, settlementPaid, exitInterview, exitInterviewNotes, checklist, status } = req.body || {};

  const patch: any = { updated_at: new Date().toISOString() };
  if (clearanceStatus !== undefined) patch.clearance_status = clearanceStatus;
  if (finalSettlement !== undefined) patch.final_settlement = Number(finalSettlement);
  if (settlementPaid !== undefined) patch.settlement_paid = Boolean(settlementPaid);
  if (exitInterview !== undefined) patch.exit_interview = Boolean(exitInterview);
  if (exitInterviewNotes !== undefined) patch.exit_interview_notes = exitInterviewNotes;
  if (checklist !== undefined) patch.checklist = checklist;
  if (status !== undefined) patch.status = status;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabaseAdmin.from('hr_offboarding_cases')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'offboarding.case_updated', entityType: 'offboarding_case', entityId: req.params.id, details: patch });
  // If a case is cancelled, re-activate the employee so they are not left Terminated.
  if (data?.status === 'Cancelled' && data?.employee_id) {
    await supabaseAdmin.from('employees').update({
      status: 'Active',
      termination_date: null,
      termination_reason: null,
      terminated_by: null,
      updated_at: new Date().toISOString(),
    }).eq('id', data.employee_id).eq('property_id', data.property_id);
  }

  return res.json({ case: data });
});

// ════════════════════════════════════════════════════════════════════════════
// LEAVE ACCRUAL
// ════════════════════════════════════════════════════════════════════════════

// List accrual rules
router.get('/accrual/rules/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_leave_accrual_rules')
    .select('*').eq('property_id', propertyId).order('leave_type');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ rules: data || [] });
});

// Upsert accrual rule
router.put('/accrual/rules/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { monthlyAccrualDays, maxCarryForward, encashable, isActive } = req.body || {};

  const patch: any = { updated_at: new Date().toISOString() };
  if (monthlyAccrualDays !== undefined) patch.monthly_accrual_days = Number(monthlyAccrualDays);
  if (maxCarryForward !== undefined) patch.max_carry_forward = Number(maxCarryForward);
  if (encashable !== undefined) patch.encashable = Boolean(encashable);
  if (isActive !== undefined) patch.is_active = Boolean(isActive);

  const { data, error } = await supabaseAdmin.from('hr_leave_accrual_rules')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ rule: data });
});

// Create accrual rule
router.post('/accrual/rules', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, leaveType, employmentType, monthlyAccrualDays, maxCarryForward, encashable } = req.body || {};
  if (!propertyId || !leaveType || !employmentType) {
    return res.status(400).json({ error: 'propertyId, leaveType and employmentType are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_leave_accrual_rules').insert({
    property_id: propertyId,
    leave_type: leaveType,
    employment_type: employmentType,
    monthly_accrual_days: Number(monthlyAccrualDays) || 0,
    max_carry_forward: Number(maxCarryForward) || 0,
    encashable: Boolean(encashable),
    is_active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\:')}`);
  return res.status(201).json({ rule: data });
});

// Run monthly accrual for a period ('YYYY-MM')
// For each active employee × accrual rule, adds monthly_accrual_days to the
// matching leave balance (respecting max_carry_forward on year-end), and
// logs the change. Idempotent: skips if a log row already exists for the
// period + employee + leave_type.
router.post('/accrual/run', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, period } = req.body || {};
  if (!propertyId || !period) return res.status(400).json({ error: 'propertyId and period are required' });

  const periodMatch = /^(\d{4})-(\d{2})/.exec(String(period));
  if (!periodMatch) return res.status(400).json({ error: "period must be 'YYYY-MM'" });
  const isYearEnd = periodMatch[2] === '12';

  const [rulesRes, employeesRes] = await Promise.all([
    supabaseAdmin.from('hr_leave_accrual_rules').select('*').eq('property_id', propertyId).eq('is_active', true),
    supabaseAdmin.from('employees').select('id, employment_type').eq('property_id', propertyId).eq('status', 'Active'),
  ]);

  const rules = rulesRes.data || [];
  const employees = employeesRes.data || [];
  if (rules.length === 0 || employees.length === 0) {
    return res.json({ success: true, period, processed: 0 });
  }

  const employeeIds = employees.map((e) => e.id);
  const leaveTypes = [...new Set(rules.map((r) => r.leave_type))];

  // Batch: fetch all relevant balances and all existing log rows for this period.
  const [balancesRes, logsRes] = await Promise.all([
    supabaseAdmin.from('hr_leave_balances')
      .select('*')
      .eq('property_id', propertyId)
      .in('employee_id', employeeIds)
      .in('leave_type', leaveTypes),
    supabaseAdmin.from('hr_leave_accrual_log')
      .select('employee_id, leave_type')
      .eq('property_id', propertyId)
      .eq('period', period)
      .in('employee_id', employeeIds),
  ]);

  const balances = balancesRes.data || [];
  const logs = logsRes.data || [];

  const balanceByKey: Record<string, any> = {};
  for (const b of balances) balanceByKey[`${b.employee_id}|${b.leave_type}`] = b;

  const existingKeys = new Set<string>();
  for (const l of logs) existingKeys.add(`${l.employee_id}|${l.leave_type}`);

  let processed = 0;
  const logRows: any[] = [];

  for (const emp of employees) {
    for (const rule of rules) {
      if (rule.employment_type !== 'All' && rule.employment_type !== emp.employment_type) continue;

      const key = `${emp.id}|${rule.leave_type}`;
      if (existingKeys.has(key)) continue;

      const balance = balanceByKey[key];
      if (!balance) continue; // no balance row for this leave type

      const balanceBefore = Number(balance.total_days) - Number(balance.used_days);
      let accrued = Number(rule.monthly_accrual_days) || 0;

      // Year-end carry-forward cap: if the remaining balance exceeds
      // max_carry_forward, the excess is forfeited (not added to accrual).
      let balanceAfter = balanceBefore + accrued;
      if (isYearEnd && rule.max_carry_forward > 0 && balanceAfter > Number(rule.max_carry_forward)) {
        balanceAfter = Number(rule.max_carry_forward);
        accrued = balanceAfter - balanceBefore; // may be negative (forfeiture)
      }

      const newTotal = Number(balance.used_days) + balanceAfter;
      await supabaseAdmin.from('hr_leave_balances').update({
        total_days: newTotal,
        updated_at: new Date().toISOString(),
      }).eq('id', balance.id);

      logRows.push({
        property_id: propertyId,
        period,
        employee_id: emp.id,
        leave_type: rule.leave_type,
        days_accrued: accrued,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      });
      processed++;
    }
  }

  if (logRows.length) {
    await supabaseAdmin.from('hr_leave_accrual_log').insert(logRows);
  }

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'leave.accrual_run', details: { period, processed } });
  hrNotify({ propertyId, message: `Leave accrual run for ${period} — ${processed} balances updated` });
  return res.json({ success: true, period, processed });
});

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT-EXPIRY ALERTS
// ════════════════════════════════════════════════════════════════════════════

// Employees with contracts expiring within N days (default 30)
router.get('/contract-expiry/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const days = Number(req.query.days) || 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const { data, error } = await supabaseAdmin.from('employees')
    .select('id, name, department, position, employment_type, contract_end_date, email, phone')
    .eq('property_id', propertyId).eq('status', 'Active')
    .not('contract_end_date', 'is', null)
    .lte('contract_end_date', cutoff.toISOString().slice(0, 10))
    .order('contract_end_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [], days });
});

export default router;
