/**
 * HR Staff Source of Truth — cross-department aggregator
 * ──────────────────────────────────────────────────────────────────────────
 * Returns a single property-scoped payload with HR employees, attendance,
 * and performance reviews so all department portals can use HR as the
 * canonical staff registry.
 * Mounted at /api/hr-portal/staff.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-staff:';

// ── Aggregated staff snapshot for a property ─────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}s:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [employeesRes, attendanceRes, performanceRes, reviewsRes] = await Promise.all([
    supabaseAdmin.from('employees').select('*').eq('property_id', propertyId).order('name'),
    supabaseAdmin.from('staff_attendance').select('*').eq('property_id', propertyId).order('attendance_date', { ascending: false }).limit(50),
    supabaseAdmin.from('hr_performance_reviews').select('*').eq('property_id', propertyId).order('period', { ascending: false }).limit(50),
    supabaseAdmin.from('hr_approval_requests').select('*').eq('property_id', propertyId).order('submitted_date', { ascending: false }).limit(50),
  ]);

  const result = {
    employees: employeesRes.data || [],
    attendance: attendanceRes.data || [],
    performance: performanceRes.data || [],
    approvals: reviewsRes.data || [],
  };

  cacheService.set(cacheKey, result, 60 * 1000);
  return res.json(result);
});

// ── Employees only ───────────────────────────────────────────────────────────
router.get('/employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { department } = req.query as Record<string, string>;
  let query = supabaseAdmin.from('employees').select('*').eq('property_id', propertyId).order('name');
  if (department) query = query.eq('department', department);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// ── Attendance only ──────────────────────────────────────────────────────────
router.get('/attendance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { from, to, staffId } = req.query as Record<string, string>;
  let query = supabaseAdmin.from('staff_attendance').select('*').eq('property_id', propertyId).order('attendance_date', { ascending: false });
  if (from) query = query.gte('attendance_date', from);
  if (to) query = query.lte('attendance_date', to);
  if (staffId) query = query.eq('staff_id', staffId);
  const { data, error } = await query.limit(200);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ attendance: data || [] });
});

// ── Performance only ─────────────────────────────────────────────────────────
router.get('/performance/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { employeeId } = req.query as Record<string, string>;
  let query = supabaseAdmin.from('hr_performance_reviews').select('*').eq('property_id', propertyId).order('period', { ascending: false });
  if (employeeId) query = query.eq('employee_id', employeeId);
  const { data, error } = await query.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ performance: data || [] });
});

export default router;
