/**
 * HR Dashboard API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed HR dashboard metrics and alerts. Mounted at /api/hr-portal/dashboard.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-dashboard:';

// ── Dashboard metrics ──────────────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin.from('hr_dashboard')
    .select('*').eq('property_id', propertyId).order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const kpis = rows.filter((r) => r.metric_group === 'kpi');
  const alerts = rows.filter((r) => r.metric_group === 'alert');

  const result = { kpis, alerts };
  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Real-time dashboard computed from HR tables ────────────────────────────
router.get('/realtime/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().split('T')[0];
  const expiryCutoff = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const [
    employeesRes,
    attendanceRes,
    reviewsRes,
    approvalsRes,
    leaveRes,
    trainingRes,
    overtimeRes,
    recruitmentRes,
    payrollRes,
    payslipsRes,
    offboardingRes,
    contractsRes,
    loansRes,
    disciplinaryRes,
  ] = await Promise.all([
    supabaseAdmin.from('employees').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('staff_attendance').select('*').eq('property_id', propertyId).gte('attendance_date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]),
    supabaseAdmin.from('hr_performance_reviews').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_approval_requests').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_leave_requests').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_training_sessions').select('*').eq('property_id', propertyId).order('session_date', { ascending: false }),
    supabaseAdmin.from('hr_overtime_requests').select('*').eq('property_id', propertyId).eq('status', 'Approved'),
    supabaseAdmin.from('hr_recruitment_requests').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('payroll_runs').select('*').eq('property_id', propertyId).eq('period', currentPeriod).order('run_date', { ascending: false }),
    supabaseAdmin.from('payslips').select('*').eq('property_id', propertyId).eq('period', currentPeriod),
    supabaseAdmin.from('hr_offboarding_cases').select('*').eq('property_id', propertyId).eq('status', 'Open'),
    supabaseAdmin.from('employees').select('id').eq('property_id', propertyId).eq('status', 'Active').not('contract_end_date', 'is', null).lte('contract_end_date', expiryCutoff).gte('contract_end_date', today),
    supabaseAdmin.from('hr_employee_loans').select('*').eq('property_id', propertyId).eq('status', 'Active'),
    supabaseAdmin.from('hr_disciplinary_actions').select('*').eq('property_id', propertyId).eq('status', 'Active'),
  ]);

  if (employeesRes.error) return res.status(500).json({ error: employeesRes.error.message });

  const employees = employeesRes.data || [];
  const attendance = attendanceRes.data || [];
  const reviews = reviewsRes.data || [];
  const approvals = approvalsRes.data || [];
  const leaves = leaveRes.data || [];
  const trainings = trainingRes.data || [];
  const overtimes = overtimeRes.data || [];
  const recruitments = recruitmentRes.data || [];
  const payrollRuns = payrollRes.data || [];
  const payslips = payslipsRes.data || [];
  const offboardingCases = offboardingRes.data || [];
  const expiringContracts = contractsRes.data || [];
  const activeLoans = loansRes.data || [];
  const activeDisciplinary = disciplinaryRes.data || [];

  const total = employees.length;
  const active = employees.filter((e) => e.status === 'Active').length;
  const terminated = employees.filter((e) => e.status === 'Terminated').length;
  const turnover = total > 0 ? ((terminated / total) * 100).toFixed(1) : '0.0';
  const present = attendance.filter((a) => a.status === 'Present').length;
  const attTotal = attendance.length || 1;
  const attendanceRate = ((present / attTotal) * 100).toFixed(1);
  const overtimeHours = overtimes.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const trainingTotal = trainings.length || 1;
  const trainingCompleted = trainings.filter((t) => t.status === 'Completed').length;
  const trainingRate = ((trainingCompleted / trainingTotal) * 100).toFixed(0);
  const pendingLeaves = leaves.filter((l) => l.status === 'Pending').length;
  const pendingApprovals = approvals.filter((a) => a.request_status === 'Pending').length;
  const avgScore = reviews.length ? (reviews.reduce((s, r) => s + (Number(r.score) || 0), 0) / reviews.length).toFixed(1) : '0.0';
  const payrollCost = payslips.length
    ? Math.round(payslips.reduce((s, p) => s + (Number(p.gross_pay) || 0), 0))
    : Math.round(employees.reduce((s, e) => s + (Number(e.basic_salary) || 0) + (Number(e.allowance_amount) || 0) + (Number(e.salary) || 0), 0));
  const vacantPositions = recruitments.reduce((s, r) => s + (Number(r.vacancies) || 0), 0);

  const deptMap: Record<string, number> = {};
  for (const e of employees) { deptMap[e.department || 'Unassigned'] = (deptMap[e.department || 'Unassigned'] || 0) + 1; }
  const deptDistribution = Object.entries(deptMap).map(([name, value]) => ({ name, value }));

  const chartToday = new Date();
  const last7: { day: string; present: number; absent: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(chartToday); d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayAtt = attendance.filter((a) => a.attendance_date === iso);
    last7.push({ day: dayName, present: dayAtt.filter((a) => a.status === 'Present').length, absent: dayAtt.filter((a) => a.status === 'Absent').length });
  }

  const applications = recruitments.reduce((s, r) => s + (Number(r.vacancies) || 0) * 5, 0); // rough multiplier
  const offers = recruitments.filter((r) => r.status === 'Offer' || r.status === 'Closed - Filled').length;

  const upcomingTrainings = trainings
    .filter((t) => t.session_date && new Date(t.session_date) >= today)
    .slice(0, 3)
    .map((t) => ({ title: t.title, date: t.session_date, dept: t.type || 'General', attendees: t.staff_count }));

  const pendingLeaveList = leaves
    .filter((l) => l.status === 'Pending')
    .slice(0, 3)
    .map((l) => ({ name: l.employee_name, type: l.leave_type, dates: `${l.start_date} - ${l.end_date}`, dept: l.department }));

  const result = {
    kpis: [
      { metric_key: 'total_employees', metric_label: 'Total Employees', metric_value: String(total), sub_label: 'HR records', color_tone: 'indigo' },
      { metric_key: 'active_employees', metric_label: 'Active Employees', metric_value: String(active), sub_label: 'Active status', color_tone: 'success' },
      { metric_key: 'vacant_positions', metric_label: 'Vacant Positions', metric_value: String(vacantPositions), sub_label: 'Open requisitions', color_tone: 'warning' },
      { metric_key: 'employee_turnover', metric_label: 'Employee Turnover', metric_value: `${turnover}%`, sub_label: 'Terminated / total', color_tone: 'danger' },
      { metric_key: 'attendance_rate', metric_label: 'Attendance Rate', metric_value: `${attendanceRate}%`, sub_label: 'Last 30 days', color_tone: 'accent' },
      { metric_key: 'overtime_hours', metric_label: 'Overtime Hours', metric_value: `${overtimeHours}h`, sub_label: 'Approved requests', color_tone: 'purple' },
      { metric_key: 'leave_utilization', metric_label: 'Leave Utilization', metric_value: String(pendingLeaves), sub_label: 'Pending leave', color_tone: 'cyan' },
      { metric_key: 'training_completion', metric_label: 'Training Completion', metric_value: `${trainingRate}%`, sub_label: 'Session completion', color_tone: 'pink' },
      { metric_key: 'payroll_cost', metric_label: 'Payroll Cost', metric_value: String(payrollCost), sub_label: payrollRuns.length ? `Payslips - ${currentPeriod}` : 'Estimated from salaries', color_tone: 'success' },
      { metric_key: 'satisfaction', metric_label: 'Employee Satisfaction', metric_value: `${avgScore}/5`, sub_label: 'Average review score', color_tone: 'yellow' },
    ],
    alerts: [
      { metric_key: 'pending_approval', metric_label: 'Pending Approvals', metric_value: String(pendingApprovals), color_tone: 'amber' },
      { metric_key: 'pending_leave', metric_label: 'Pending Leave Requests', metric_value: String(pendingLeaves), color_tone: 'info' },
      { metric_key: 'overtime_requests', metric_label: 'Overtime Requests', metric_value: String(overtimes.length), color_tone: 'amber' },
      { metric_key: 'open_recruitment', metric_label: 'Open Requisitions', metric_value: String(recruitments.filter((r) => r.status === 'Open').length), color_tone: 'danger' },
      { metric_key: 'offboarding_open', metric_label: 'Offboarding Cases', metric_value: String(offboardingCases.length), color_tone: 'danger' },
      { metric_key: 'contracts_expiring', metric_label: 'Contracts Expiring ≤30d', metric_value: String(expiringContracts.length), color_tone: 'warning' },
      { metric_key: 'loans_active', metric_label: 'Active Loans', metric_value: String(activeLoans.length), color_tone: 'info' },
      { metric_key: 'disciplinary_active', metric_label: 'Active Disciplinary', metric_value: String(activeDisciplinary.length), color_tone: 'danger' },
    ],
    deptDistribution,
    attendanceTrend: last7,
    recruitmentFunnel: {
      applications: Math.max(applications, 1),
      shortlisted: Math.floor(applications * 0.25),
      interviews: Math.floor(applications * 0.1),
      offersSent: Math.max(offers, 1),
    },
    upcomingTrainings,
    pendingLeaves: pendingLeaveList,
  };

  return res.json(result);
});

router.put('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { metricValue, subLabel, trend, isPositive, sortOrder } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (metricValue !== undefined) patch.metric_value = String(metricValue);
  if (subLabel !== undefined) patch.sub_label = subLabel;
  if (trend !== undefined) patch.trend = trend;
  if (isPositive !== undefined) patch.is_positive = !!isPositive;
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  const { data, error } = await supabaseAdmin.from('hr_dashboard').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

export default router;
