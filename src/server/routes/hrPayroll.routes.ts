/**
 * HR Payroll API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for payroll runs, payslips, and payroll statistics.
 * Mounted at /api/hr-portal/payroll.
 *
 * Uses existing payroll_runs, payslips, tax_bands, pension_rates tables.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { hrAudit, hrNotify } from '../services/hrNotifications';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-payroll:';

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [runsRes, latestRunRes, pendingRes] = await Promise.all([
    supabaseAdmin.from('payroll_runs').select('total_net, total_gross, total_tax, total_pension_employee').eq('property_id', propertyId),
    supabaseAdmin.from('payroll_runs').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('payroll_runs').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Calculated'),
  ]);

  const runs = runsRes.data || [];
  const ytdNet = runs.reduce((s, r) => s + (Number(r.total_net) || 0), 0);
  const ytdGross = runs.reduce((s, r) => s + (Number(r.total_gross) || 0), 0);
  const ytdTax = runs.reduce((s, r) => s + (Number(r.total_tax) || 0), 0);
  const ytdPension = runs.reduce((s, r) => s + (Number(r.total_pension_employee) || 0), 0);
  const latest = latestRunRes.data?.[0] || null;
  const pendingCount = pendingRes.count ?? 0;

  const stats = {
    ytdGross: ytdGross,
    ytdNet: ytdNet,
    ytdTax: ytdTax,
    ytdPension: ytdPension,
    runCount: runs.length,
    pendingRuns: pendingCount,
    latestPeriod: latest?.period || '—',
    latestStatus: latest?.status || '—',
    latestNet: Number(latest?.total_net) || 0,
    latestGross: Number(latest?.total_gross) || 0,
    latestEmployeeCount: Number(latest?.employee_count) || 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Payroll Runs ──────────────────────────────────────────────────────────
router.get('/runs/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('payroll_runs').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ runs: data || [] });
});

// Payroll input conventions (documented assumptions):
//   - period is 'YYYY-MM'; inputs are gathered for that calendar month
//   - daily rate = monthly base gross / 30, hourly rate = monthly base gross / 240
//     (30-day standard month, 8-hour day — matches the 'Pro-rata' absence
//      deduction method in HR configuration)
//   - unpaid time = approved 'Unpaid' leave days overlapping the period
//     + 'Absent' attendance days not already covered by approved leave
//   - overtime = approved hr_overtime_requests hours x hourly rate x multiplier
//     (employees.overtime_rate overrides the computed hourly rate)
//   - loan deduction = min(monthly_installment, balance_remaining) per active loan
const DAYS_IN_MONTH = 30;
const HOURS_PER_MONTH = 240;

function parseOtMultiplier(rate: string | null | undefined): number {
  const m = parseFloat(String(rate || '').replace(/x/i, ''));
  return Number.isFinite(m) && m > 0 ? m : 1.5;
}

function overlapDays(startA: string, endA: string, startB: string, endB: string): number {
  const s = Math.max(new Date(startA).getTime(), new Date(startB).getTime());
  const e = Math.min(new Date(endA).getTime(), new Date(endB).getTime());
  return e >= s ? Math.round((e - s) / 86400000) + 1 : 0;
}

router.post('/runs', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, period, employeeIds } = req.body || {};
  if (!propertyId || !period) return res.status(400).json({ error: 'propertyId and period are required' });

  // Resolve the calendar month for this period ('YYYY-MM')
  const periodMatch = /^(\d{4})-(\d{2})/.exec(String(period));
  if (!periodMatch) return res.status(400).json({ error: "period must be in 'YYYY-MM' format" });
  const year = periodMatch[1];
  const monthStart = `${periodMatch[0]}-01`;
  const monthEnd = new Date(Number(periodMatch[1]), Number(periodMatch[2]), 0).toISOString().slice(0, 10);

  // Guard: a second run for the same period would duplicate payslips and
  // double-deduct loan installments.
  const { data: existingRun } = await supabaseAdmin.from('payroll_runs')
    .select('id, status').eq('property_id', propertyId).eq('period', period)
    .in('status', ['Calculated', 'Approved', 'Posted', 'Paid']).limit(1).maybeSingle();
  if (existingRun) {
    return res.status(409).json({ error: `A ${existingRun.status} payroll run already exists for period ${period}` });
  }

  const runId = crypto.randomUUID();
  const { error: runError } = await supabaseAdmin.from('payroll_runs').insert({
    id: runId,
    property_id: propertyId,
    period,
    run_date: new Date().toISOString().slice(0, 10),
    status: 'Draft',
    created_by: req.user?.id || 'system',
  });
  if (runError) return res.status(500).json({ error: runError.message });

  // Fetch active employees for this property
  let empQuery = supabaseAdmin.from('employees').select('*').eq('property_id', propertyId).eq('status', 'Active');
  if (employeeIds && employeeIds.length > 0) {
    empQuery = empQuery.in('id', employeeIds);
  }
  const { data: employees, error: empError } = await empQuery;
  if (empError) return res.status(500).json({ error: empError.message });

  // ── Bulk-fetch payroll inputs for the period ────────────────────────────
  const [pensionRes, leaveRes, attendanceRes, otRes, loansRes, ytdRes] = await Promise.all([
    supabaseAdmin.from('pension_rates').select('*').eq('is_active', true).order('effective_date', { ascending: false }).limit(1),
    supabaseAdmin.from('hr_leave_requests').select('employee_id, leave_type, start_date, end_date, days')
      .eq('property_id', propertyId).eq('status', 'Approved')
      .lte('start_date', monthEnd).gte('end_date', monthStart),
    supabaseAdmin.from('staff_attendance').select('employee_id')
      .eq('property_id', propertyId).eq('status', 'Absent')
      .gte('attendance_date', monthStart).lte('attendance_date', monthEnd),
    supabaseAdmin.from('hr_overtime_requests').select('employee_id, hours, rate')
      .eq('property_id', propertyId).eq('status', 'Approved')
      .gte('overtime_date', monthStart).lte('overtime_date', monthEnd),
    supabaseAdmin.from('hr_employee_loans').select('id, employee_id, monthly_installment, balance_remaining')
      .eq('property_id', propertyId).eq('status', 'Active'),
    supabaseAdmin.from('payslips').select('employee_id, gross_pay, income_tax, pension_employee, net_pay')
      .eq('property_id', propertyId).like('period', `${year}-%`),
  ]);

  const pension = pensionRes.data?.[0] || null;
  const empRate = Number(pension?.employee_rate) || 7;
  const erRate = Number(pension?.employer_rate) || 11;

  const unpaidLeaveDays = new Map<string, number>();
  const approvedLeaveDays = new Map<string, number>();
  for (const l of leaveRes.data || []) {
    const days = overlapDays(l.start_date, l.end_date, monthStart, monthEnd);
    approvedLeaveDays.set(l.employee_id, (approvedLeaveDays.get(l.employee_id) || 0) + days);
    if (/unpaid|without\s*pay/i.test(l.leave_type || '')) {
      unpaidLeaveDays.set(l.employee_id, (unpaidLeaveDays.get(l.employee_id) || 0) + days);
    }
  }

  const absentDays = new Map<string, number>();
  for (const a of attendanceRes.data || []) {
    if (!a.employee_id) continue;
    absentDays.set(a.employee_id, (absentDays.get(a.employee_id) || 0) + 1);
  }

  const otEntries = new Map<string, { hours: number; rate: string }[]>();
  for (const o of otRes.data || []) {
    const list = otEntries.get(o.employee_id) || [];
    list.push({ hours: Number(o.hours) || 0, rate: o.rate });
    otEntries.set(o.employee_id, list);
  }

  const loansByEmp = new Map<string, { id: string; installment: number; balance: number }[]>();
  for (const l of loansRes.data || []) {
    const list = loansByEmp.get(l.employee_id) || [];
    list.push({ id: l.id, installment: Number(l.monthly_installment) || 0, balance: Number(l.balance_remaining) || 0 });
    loansByEmp.set(l.employee_id, list);
  }

  const ytdByEmp = new Map<string, { gross: number; tax: number; pension: number; net: number }>();
  for (const p of ytdRes.data || []) {
    const cur = ytdByEmp.get(p.employee_id) || { gross: 0, tax: 0, pension: 0, net: 0 };
    cur.gross += Number(p.gross_pay) || 0;
    cur.tax += Number(p.income_tax) || 0;
    cur.pension += Number(p.pension_employee) || 0;
    cur.net += Number(p.net_pay) || 0;
    ytdByEmp.set(p.employee_id, cur);
  }

  let totalGross = 0, totalTax = 0, totalPensionEmp = 0, totalPensionEr = 0, totalNet = 0, totalLoans = 0;
  const payslipRows: any[] = [];

  for (const emp of employees || []) {
    const basic = Number(emp.basic_salary || emp.salary || 0);
    const allowances = Number(emp.allowance_amount || 0);
    const baseGross = basic + allowances;
    const dailyRate = baseGross / DAYS_IN_MONTH;
    const hourlyRate = Number(emp.overtime_rate) > 0 ? Number(emp.overtime_rate) : baseGross / HOURS_PER_MONTH;

    // Unpaid leave + unexcused absences (absences already on approved leave are not double-counted)
    const empApprovedLeave = approvedLeaveDays.get(emp.id) || 0;
    const empUnpaidLeave = unpaidLeaveDays.get(emp.id) || 0;
    const empAbsentRaw = absentDays.get(emp.id) || 0;
    const empAbsent = Math.max(0, empAbsentRaw - empApprovedLeave);
    const unpaidDays = Math.min(DAYS_IN_MONTH, empUnpaidLeave + empAbsent);
    const absenceDeduction = dailyRate * unpaidDays;

    // Approved overtime pay
    let overtimeHours = 0, overtimePay = 0;
    for (const o of otEntries.get(emp.id) || []) {
      overtimeHours += o.hours;
      overtimePay += o.hours * hourlyRate * parseOtMultiplier(o.rate);
    }

    const gross = baseGross + overtimePay - absenceDeduction;

    // Income tax via RPC — abort the run if the calculation fails
    const { data: taxResult, error: taxError } = await supabaseAdmin.rpc('calculate_income_tax', { p_taxable_income: gross });
    if (taxError) {
      await supabaseAdmin.from('payslips').delete().eq('payroll_run_id', runId);
      await supabaseAdmin.from('payroll_runs').delete().eq('id', runId);
      return res.status(500).json({ error: `Income tax calculation failed for ${emp.name || emp.id}: ${taxError.message}` });
    }
    const tax = Number(taxResult || 0);

    const pensionEmp = gross * empRate / 100;
    const pensionEr = gross * erRate / 100;

    // Active loan installments (capped at remaining balance)
    const loanLines: { loanId: string; amount: number }[] = [];
    let loanDeduction = 0;
    for (const loan of loansByEmp.get(emp.id) || []) {
      const amount = Math.min(loan.installment, loan.balance);
      if (amount > 0) { loanLines.push({ loanId: loan.id, amount }); loanDeduction += amount; }
    }

    // Absence already reduces gross pay — record it in other_deductions for
    // transparency but exclude it from total_deductions to avoid double-count.
    const totalDeductions = tax + pensionEmp + loanDeduction;
    const netPay = gross - totalDeductions;
    const ytd = ytdByEmp.get(emp.id) || { gross: 0, tax: 0, pension: 0, net: 0 };

    totalGross += gross;
    totalTax += tax;
    totalPensionEmp += pensionEmp;
    totalPensionEr += pensionEr;
    totalNet += netPay;
    totalLoans += loanDeduction;

    payslipRows.push({
      payroll_run_id: runId,
      property_id: propertyId,
      employee_id: emp.id,
      period,
      basic_salary: basic,
      allowances,
      overtime: overtimePay,
      gross_pay: gross,
      income_tax: tax,
      pension_employee: pensionEmp,
      pension_employer: pensionEr,
      loan_deduction: loanDeduction,
      other_deductions: absenceDeduction,
      total_deductions: totalDeductions,
      net_pay: netPay,
      ytd_gross: ytd.gross + gross,
      ytd_tax: ytd.tax + tax,
      ytd_pension: ytd.pension + pensionEmp,
      ytd_net: ytd.net + netPay,
      calc_details: {
        unpaidLeaveDays: empUnpaidLeave,
        absentDays: empAbsent,
        unpaidDays,
        overtimeHours,
        loans: loanLines,
      },
      status: 'Calculated',
    });
  }

  const { error: slipError } = await supabaseAdmin.from('payslips').insert(payslipRows);
  if (slipError) {
    await supabaseAdmin.from('payroll_runs').delete().eq('id', runId);
    return res.status(500).json({ error: slipError.message });
  }

  await supabaseAdmin.from('payroll_runs').update({
    total_gross: totalGross,
    total_tax: totalTax,
    total_pension_employee: totalPensionEmp,
    total_pension_employer: totalPensionEr,
    total_deductions: totalTax + totalPensionEmp + totalLoans,
    total_net: totalNet,
    employee_count: employees?.length || 0,
    status: 'Calculated',
  }).eq('id', runId);

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'payroll.run.calculated', entityType: 'payroll_run', entityId: runId, details: { period, employeeCount: employees?.length || 0, totalGross, totalNet } });
  hrNotify({ propertyId, message: `Payroll run for ${period} calculated — ${employees?.length || 0} employees, net ${totalNet.toFixed(2)}` });
  return res.status(201).json({
    success: true,
    runId,
    employeeCount: employees?.length || 0,
    totalGross,
    totalNet,
  });
});

router.patch('/runs/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status is required' });

  const updateData: any = { status, updated_at: new Date().toISOString() };
  if (status === 'Approved') { updateData.approved_by = req.user?.id || 'system'; updateData.approved_at = new Date().toISOString(); }
  if (status === 'Posted') { updateData.posted_by = req.user?.id || 'system'; updateData.posted_at = new Date().toISOString(); }

  // Read the current status so loan repayments are only applied on the first
  // transition into 'Posted'.
  const { data: current } = await supabaseAdmin.from('payroll_runs')
    .select('status').eq('id', req.params.id).single();

  const { data, error } = await supabaseAdmin.from('payroll_runs').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (status === 'Approved') {
    await supabaseAdmin.from('payslips').update({ status: 'Approved' }).eq('payroll_run_id', req.params.id);
  }
  if (status === 'Posted' && current?.status !== 'Posted' && current?.status !== 'Paid') {
    await supabaseAdmin.from('payslips').update({ status: 'Paid', paid_at: new Date().toISOString() }).eq('payroll_run_id', req.params.id);

    // Apply loan repayments recorded at calculation time — decrement balances
    // and mark fully repaid loans as Completed.
    const { data: slips } = await supabaseAdmin.from('payslips')
      .select('calc_details').eq('payroll_run_id', req.params.id);
    for (const slip of slips || []) {
      for (const line of slip.calc_details?.loans || []) {
        const { data: loan } = await supabaseAdmin.from('hr_employee_loans')
          .select('balance_remaining').eq('id', line.loanId).single();
        if (!loan) continue;
        const newBalance = Math.max(0, (Number(loan.balance_remaining) || 0) - (Number(line.amount) || 0));
        await supabaseAdmin.from('hr_employee_loans').update({
          balance_remaining: newBalance,
          status: newBalance <= 0 ? 'Completed' : 'Active',
        }).eq('id', line.loanId);
      }
    }
  }

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: `payroll.run.${status.toLowerCase()}`, entityType: 'payroll_run', entityId: req.params.id, details: { previousStatus: current?.status, period: data?.period } });
  if (status === 'Posted') hrNotify({ propertyId: data?.property_id || '', message: `Payroll run ${data?.period} posted — payslips marked Paid, loan balances updated` });
  return res.json({ success: true, run: data });
});

// ── Payslips ──────────────────────────────────────────────────────────────
router.get('/runs/:id/payslips', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('payslips')
    .select('*, employees(name, email, phone, department, position, bank_account, pension_number)')
    .eq('payroll_run_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ payslips: data || [] });
});

router.get('/payslips/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('payslips')
    .select('*, employees(name, email, phone, department, position, bank_account, pension_number), payroll_runs(period, status)')
    .eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Employees (active, property-scoped) ───────────────────────────────────
router.get('/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('employees')
    .select('id, name, email, phone, department, position, status, hire_date, salary, basic_salary, allowance_amount, overtime_rate, bank_account, pension_number')
    .eq('property_id', propertyId)
    .eq('status', 'Active')
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// ── Tax Bands & Pension Rates ─────────────────────────────────────────────
router.get('/tax-bands/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('tax_bands')
    .select('*').eq('is_active', true).order('band_order');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ taxBands: data || [] });
});

router.get('/pension-rates/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('pension_rates')
    .select('*').eq('is_active', true).order('effective_date', { ascending: false }).limit(1);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ pensionRate: data?.[0] || null });
});

// ── Employee Loans & Salary Advances ────────────────────────────────────────
router.get('/loans/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { employeeId, status } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_employee_loans').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
  if (employeeId) q = q.eq('employee_id', employeeId);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ loans: data || [] });
});

router.post('/loans', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, type, principal, monthlyInstallment, startDate, notes } = req.body || {};
  if (!propertyId || !employeeId || !principal || !monthlyInstallment) {
    return res.status(400).json({ error: 'propertyId, employeeId, principal and monthlyInstallment are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_employee_loans').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName || '',
    type: type === 'Salary Advance' ? 'Salary Advance' : 'Loan',
    principal: Number(principal),
    monthly_installment: Number(monthlyInstallment),
    balance_remaining: Number(principal),
    start_date: startDate || new Date().toISOString().slice(0, 10),
    notes: notes || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ loan: data });
});

router.patch('/loans/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { monthlyInstallment, balanceRemaining, status, notes } = req.body || {};

  const patch: any = {};
  if (monthlyInstallment !== undefined) patch.monthly_installment = Number(monthlyInstallment);
  if (balanceRemaining !== undefined) patch.balance_remaining = Number(balanceRemaining);
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabaseAdmin.from('hr_employee_loans')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ loan: data });
});

export default router;
