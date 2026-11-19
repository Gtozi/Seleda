/**
 * HR / Finance Integration API
 * ──────────────────────────────────────────────────────────────────────────
 * Posts HR payroll runs to the finance journal. Mounted at /api/hr-portal/finance.
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

const CACHE_PREFIX = 'hr-finance:';

// ── Payroll → Finance Journal ────────────────────────────────────────────────
router.post('/post-payroll/:payrollRunId', authenticate, requirePermission('finance:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { payrollRunId } = req.params;

  // Load payroll run
  const { data: run, error: runError } = await supabaseAdmin.from('payroll_runs').select('*').eq('id', payrollRunId).single();
  if (runError || !run) return res.status(404).json({ error: runError?.message || 'Payroll run not found' });
  if (run.journal_entry_id) return res.status(409).json({ error: 'Payroll run already posted' });

  // Load payslips for this run, joined to employees for department allocation
  const { data: payslips, error: payslipError } = await supabaseAdmin.from('payslips')
    .select('*, employees!inner(department)')
    .eq('payroll_run_id', payrollRunId);
  if (payslipError) return res.status(500).json({ error: payslipError.message });

  // Load account mapping
  const { data: mapping, error: mappingError } = await supabaseAdmin.from('payroll_account_mapping').select('*').eq('property_id', run.property_id);
  if (mappingError) return res.status(500).json({ error: mappingError.message });
  const accountFor = (lineType: string) => mapping?.find((m) => m.line_type === lineType);

  const required = ['gross_pay', 'pension_employer', 'income_tax', 'pension_employee', 'pension_employer_liability', 'net_pay', 'loan_deduction'];
  const missing = required.filter((t) => !accountFor(t));
  if (missing.length) return res.status(400).json({ error: `Missing payroll account mapping for: ${missing.join(', ')}` });

  // Aggregate totals (for the header) and per-department breakdown (for
  // cost allocation on the gross + employer pension expense lines).
  const totals = (payslips || []).reduce(
    (acc, p) => ({
      gross: acc.gross + (Number(p.gross_pay) || 0),
      tax: acc.tax + (Number(p.income_tax) || 0),
      pensionEmployee: acc.pensionEmployee + (Number(p.pension_employee) || 0),
      pensionEmployer: acc.pensionEmployer + (Number(p.pension_employer) || 0),
      loan: acc.loan + (Number(p.loan_deduction) || 0),
      other: acc.other + (Number(p.other_deductions) || 0),
      net: acc.net + (Number(p.net_pay) || 0),
    }),
    { gross: 0, tax: 0, pensionEmployee: 0, pensionEmployer: 0, loan: 0, other: 0, net: 0 }
  );

  const deptExpenses = new Map<string, { gross: number; penEr: number }>();
  for (const p of payslips || []) {
    const dept = (p as any).employees?.department || 'Unassigned';
    const cur = deptExpenses.get(dept) || { gross: 0, penEr: 0 };
    cur.gross += Number(p.gross_pay) || 0;
    cur.penEr += Number(p.pension_employer) || 0;
    deptExpenses.set(dept, cur);
  }

  // Expense lines split per department; liability lines aggregated centrally.
  const lines: { type: string; amount: number; debit: number; credit: number; desc: string; department: string; costCenter: string }[] = [];
  for (const [dept, e] of deptExpenses.entries()) {
    if (e.gross > 0) lines.push({ type: 'gross_pay', amount: e.gross, debit: e.gross, credit: 0, desc: `Gross payroll expense — ${dept}`, department: dept, costCenter: dept });
    if (e.penEr > 0) lines.push({ type: 'pension_employer', amount: e.penEr, debit: e.penEr, credit: 0, desc: `Employer pension expense — ${dept}`, department: dept, costCenter: dept });
  }
  lines.push(
    { type: 'income_tax', amount: totals.tax, debit: 0, credit: totals.tax, desc: 'Income tax withheld', department: 'HR', costCenter: 'HR' },
    { type: 'pension_employee', amount: totals.pensionEmployee, debit: 0, credit: totals.pensionEmployee, desc: 'Employee pension contribution', department: 'HR', costCenter: 'HR' },
    { type: 'pension_employer_liability', amount: totals.pensionEmployer, debit: 0, credit: totals.pensionEmployer, desc: 'Employer pension liability', department: 'HR', costCenter: 'HR' },
    // other_deductions (absence/unpaid-leave) already reduce gross at calc time.
    { type: 'net_pay', amount: totals.net, debit: 0, credit: totals.net, desc: 'Net wages payable', department: 'HR', costCenter: 'HR' },
    { type: 'loan_deduction', amount: totals.loan, debit: 0, credit: totals.loan, desc: 'Loan deductions payable', department: 'HR', costCenter: 'HR' },
  );
  const booked = lines.filter((l) => l.amount > 0);

  const totalDebit = booked.reduce((s, l) => s + l.debit, 0);
  const totalCredit = booked.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    return res.status(400).json({ error: 'Journal out of balance', totalDebit, totalCredit });
  }

  const jeId = `je_payroll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const userId = (req as any).user?.id || null;

  const { data: entry, error: entryError } = await supabaseAdmin.from('journal_entries').insert({
    id: jeId,
    property_id: run.property_id,
    date: new Date().toISOString().split('T')[0],
    period: run.period,
    source: 'Payroll',
    reference: payrollRunId,
    description: `Payroll run ${run.period} - ${(payslips || []).length} employees`,
    status: 'Draft',
    total_debit: totalDebit,
    total_credit: totalCredit,
    department: 'HR',
    created_by: userId,
  }).select().single();

  if (entryError) return res.status(500).json({ error: entryError.message });

  const lineRows = booked.map((l, idx) => ({
    journal_id: jeId,
    property_id: run.property_id,
    account_code: accountFor(l.type)!.account_code,
    account_name: accountFor(l.type)!.account_name,
    description: l.desc,
    debit: l.debit,
    credit: l.credit,
    currency: 'ETB',
    exchange_rate: 1.0,
    cost_center: l.costCenter,
    department: l.department,
    tax_code: null,
    memo: `Payroll run ${run.period} - ${l.type}`,
    line_number: idx + 1,
  }));

  const { error: linesError } = await supabaseAdmin.from('journal_lines').insert(lineRows);
  if (linesError) return res.status(500).json({ error: linesError.message });

  // Mark payroll run as posted
  const { error: updateError } = await supabaseAdmin.from('payroll_runs').update({
    journal_entry_id: jeId,
    posted_by: userId,
    posted_at: new Date().toISOString(),
    status: 'Posted',
    updated_at: new Date().toISOString(),
  }).eq('id', payrollRunId);
  if (updateError) return res.status(500).json({ error: updateError.message });

  cacheService.invalidatePattern('journal-entries:*');
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'payroll.posted_to_finance', entityType: 'payroll_run', entityId: payrollRunId, details: { journalEntryId: jeId, totalDebit, totalCredit, departments: [...deptExpenses.keys()] } });
  hrNotify({ propertyId: run.property_id, message: `Payroll run ${run.period} posted to finance — JE ${jeId}, ${deptExpenses.size} cost centers` });
  return res.status(201).json({ success: true, journalEntryId: jeId, totalDebit, totalCredit });
});

// ── Reverse a posted payroll journal entry ──────────────────────────────────
// Creates a mirror entry (debits↔credits), marks the original 'Reversed',
// and un-posts the payroll run so it can be corrected and re-posted.
router.post('/reverse-payroll/:payrollRunId', authenticate, requirePermission('finance:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { payrollRunId } = req.params;

  const { data: run, error: runError } = await supabaseAdmin.from('payroll_runs').select('*').eq('id', payrollRunId).single();
  if (runError || !run) return res.status(404).json({ error: runError?.message || 'Payroll run not found' });
  if (!run.journal_entry_id) return res.status(409).json({ error: 'Payroll run has no journal entry to reverse' });

  const { data: je, error: jeError } = await supabaseAdmin.from('journal_entries').select('*').eq('id', run.journal_entry_id).single();
  if (jeError || !je) return res.status(404).json({ error: 'Journal entry not found' });
  if (je.status === 'Reversed') return res.status(409).json({ error: 'Journal entry already reversed' });

  const { data: originalLines } = await supabaseAdmin.from('journal_lines').select('*').eq('journal_id', run.journal_entry_id).order('line_number');
  if (!originalLines?.length) return res.status(404).json({ error: 'Original journal lines not found' });

  const revId = `je_payroll_rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const userId = (req as any).user?.id || null;

  const { error: revErr } = await supabaseAdmin.from('journal_entries').insert({
    id: revId,
    property_id: run.property_id,
    date: new Date().toISOString().split('T')[0],
    period: run.period,
    source: 'Payroll',
    reference: `Reversal of ${run.journal_entry_id}`,
    description: `Reversal: ${je.description}`,
    status: 'Posted',
    total_debit: je.total_credit,
    total_credit: je.total_debit,
    department: 'HR',
    posted_at: new Date().toISOString(),
    approved_by: userId,
    created_by: userId,
  });
  if (revErr) return res.status(500).json({ error: revErr.message });

  const revLines = originalLines.map((l, idx) => ({
    journal_id: revId,
    property_id: run.property_id,
    account_code: l.account_code,
    account_name: l.account_name,
    description: `Reversal: ${l.description || ''}`,
    debit: Number(l.credit) || 0,
    credit: Number(l.debit) || 0,
    currency: l.currency || 'ETB',
    exchange_rate: l.exchange_rate || 1.0,
    cost_center: l.cost_center || 'HR',
    department: l.department || 'HR',
    tax_code: l.tax_code || null,
    memo: l.memo || null,
    line_number: idx + 1,
    is_reversing: true,
    reversed_line_id: l.id,
  }));
  const { error: revLinesErr } = await supabaseAdmin.from('journal_lines').insert(revLines);
  if (revLinesErr) return res.status(500).json({ error: revLinesErr.message });

  await supabaseAdmin.from('journal_entries').update({ status: 'Reversed', updated_at: new Date().toISOString() }).eq('id', run.journal_entry_id);

  // Un-post the payroll run so it can be corrected and re-posted
  await supabaseAdmin.from('payroll_runs').update({
    journal_entry_id: null,
    posted_by: null,
    posted_at: null,
    status: 'Approved',
    updated_at: new Date().toISOString(),
  }).eq('id', payrollRunId);

  cacheService.invalidatePattern('journal-entries:*');
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'payroll.journal_reversed', entityType: 'payroll_run', entityId: payrollRunId, details: { originalJeId: run.journal_entry_id, reversalJeId: revId } });
  hrNotify({ propertyId: run.property_id, message: `Payroll run ${run.period} journal reversed — run ${payrollRunId} back to Approved` });
  return res.json({ success: true, reversedEntryId: revId, originalEntryId: run.journal_entry_id });
});

export default router;
