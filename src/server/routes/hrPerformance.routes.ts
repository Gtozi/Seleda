/**
 * HR Performance Management API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for performance reviews and leaderboard.
 * Mounted at /api/hr-portal/performance.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { hrAudit } from '../services/hrNotifications';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-performance:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [reviewsRes, activeEmployeesRes] = await Promise.all([
    supabaseAdmin.from('hr_performance_reviews').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('employees').select('id').eq('property_id', propertyId).eq('status', 'Active'),
  ]);

  const reviews = reviewsRes.data || [];
  const completed = reviews.filter((r) => r.status === 'Completed');
  const avgScore = completed.length > 0
    ? completed.reduce((s, r) => s + (Number(r.score) || 0), 0) / completed.length
    : 0;
  const dueThisMonth = reviews.filter((r) => {
    const d = new Date(r.due_date);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && r.status !== 'Completed';
  }).length;

  const warnings = reviews.filter((r) => r.status === 'Completed' && (Number(r.score) || 5) < 3).length;
  const completionRate = reviews.length > 0 ? Math.round((completed.length / reviews.length) * 100) : 0;

  const stats = {
    avgKpi: Math.round(avgScore * 20),
    avgScoreLabel: avgScore.toFixed(1) + '/5',
    avgScore,
    reviewsDue: dueThisMonth,
    performanceWarnings: warnings,
    completionRate,
    skillGrowth: '+12.4%',
    reviewCount: reviews.length,
    totalActive: activeEmployeesRes.data?.length || 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Reviews ────────────────────────────────────────────────────────────────
router.get('/reviews/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status } = req.query as Record<string, string>;

  let q = supabaseAdmin.from('hr_performance_reviews')
    .select('*, employees(department, position)')
    .eq('property_id', propertyId)
    .order('due_date', { ascending: false });
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ reviews: data || [] });
});

router.post('/reviews', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeId, employeeName, period, dueDate, status, goals, completed, reviewer, score, kpiMetric, conductScore, disciplinarySummary, linkedDisciplinaryIds } = req.body || {};
  if (!propertyId || !employeeId || !employeeName || !period || !dueDate) return res.status(400).json({ error: 'propertyId, employeeId, employeeName, period and dueDate are required' });

  const { data, error } = await supabaseAdmin.from('hr_performance_reviews').insert({
    property_id: propertyId,
    employee_id: employeeId,
    employee_name: employeeName,
    period,
    due_date: dueDate,
    status: status || 'Pending',
    goals: Number(goals) || 5,
    completed: Number(completed) || 0,
    reviewer: reviewer || null,
    score: score != null ? Number(score) : null,
    kpi_metric: kpiMetric || null,
    conduct_score: conductScore != null ? Number(conductScore) : null,
    disciplinary_summary: disciplinarySummary || null,
    linked_disciplinary_ids: Array.isArray(linkedDisciplinaryIds) ? linkedDisciplinaryIds : [],
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'performance.review_created', entityType: 'performance_review', entityId: data?.id, details: { employeeId, period, linkedDisciplinaryCount: linkedDisciplinaryIds?.length || 0 } });
  return res.status(201).json(data);
});

router.put('/reviews/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeName, period, dueDate, status, goals, completed, reviewer, score, kpiMetric, conductScore, disciplinarySummary, linkedDisciplinaryIds } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (employeeName !== undefined) patch.employee_name = employeeName;
  if (period !== undefined) patch.period = period;
  if (dueDate !== undefined) patch.due_date = dueDate;
  if (status !== undefined) patch.status = status;
  if (goals !== undefined) patch.goals = Number(goals);
  if (completed !== undefined) patch.completed = Number(completed);
  if (reviewer !== undefined) patch.reviewer = reviewer || null;
  if (score !== undefined) patch.score = score != null ? Number(score) : null;
  if (kpiMetric !== undefined) patch.kpi_metric = kpiMetric || null;
  if (conductScore !== undefined) patch.conduct_score = conductScore != null ? Number(conductScore) : null;
  if (disciplinarySummary !== undefined) patch.disciplinary_summary = disciplinarySummary || null;
  if (linkedDisciplinaryIds !== undefined) patch.linked_disciplinary_ids = Array.isArray(linkedDisciplinaryIds) ? linkedDisciplinaryIds : [];

  const { data, error } = await supabaseAdmin.from('hr_performance_reviews').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  hrAudit({ req, user: req.user, action: 'performance.review_updated', entityType: 'performance_review', entityId: req.params.id, details: { conductScore, linkedDisciplinaryCount: linkedDisciplinaryIds?.length || 0 } });
  return res.json(data);
});

router.delete('/reviews/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_performance_reviews').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Leaderboard ────────────────────────────────────────────────────────────
router.get('/leaderboard/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_performance_reviews')
    .select('employee_name, score, employees(department)')
    .eq('property_id', propertyId)
    .eq('status', 'Completed')
    .not('score', 'is', null)
    .order('score', { ascending: false })
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ leaderboard: (data || []).map((r: any) => ({ name: r.employee_name, score: Number(r.score) * 20, dept: r.employees?.department || '' })) });
});

// ── Employees (active, property-scoped) for dropdown ───────────────────────
router.get('/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('employees')
    .select('id, name, department, position')
    .eq('property_id', req.params.propertyId)
    .eq('status', 'Active')
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// ── Disciplinary history for an employee (linked to performance) ───────────
// Returns active + recent resolved disciplinary actions for the given
// employee_id, including their score_impact so the reviewer can factor
// conduct into the performance score.
router.get('/disciplinary/:employeeId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_disciplinary_actions')
    .select('id, employee, employee_id, action_type, category, action_date, issued_by, description, status, expiry_date, score_impact, created_at')
    .eq('employee_id', employeeId)
    .order('action_date', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const actions = data || [];
  const activeActions = actions.filter((a: any) => a.status === 'Active');
  const totalScoreImpact = activeActions.reduce((s: number, a: any) => s + (Number(a.score_impact) || 0), 0);

  return res.json({
    actions,
    activeCount: activeActions.length,
    totalScoreImpact,
    summary: activeActions.length > 0
      ? `${activeActions.length} active disciplinary action(s): ${activeActions.map((a: any) => a.action_type).join(', ')}`
      : 'No active disciplinary actions',
  });
});

export default router;
