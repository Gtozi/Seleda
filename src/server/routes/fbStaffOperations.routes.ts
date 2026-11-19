/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Staff Operations routes — backs the /erp/fb/staff-operations screen.
 *
 * Aligned with the Housekeeping staff management architecture:
 *   - staff              (fb_staff) — dedicated roster with F&B operational
 *                        fields + optional HR employee link
 *   - assignments        (fb_staff_assignments) — daily shift assignments
 *   - staffing           (fb_staffing_requirements)
 *   - shifts             (fb_shift_requirements)
 *   - training           (fb_staff_training)
 *   - productivity       (fb_staff_productivity)
 *   - attendance         (staff_attendance, department_scope='FB')
 *
 * All routes are property-scoped (take :propertyId where applicable) and use
 * cacheService for read caching + invalidation on writes, matching HK.
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Constants ───────────────────────────────────────────────────────
const STAFF_ROLES = new Set(['Server', 'Bartender', 'Chef', 'Sous Chef', 'Host', 'Busser', 'Manager']);
const STAFF_SHIFTS = new Set(['Morning', 'Evening', 'Night']);
const ATT_SHIFTS = STAFF_SHIFTS;
const ATT_STATUSES = new Set(['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day', 'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day']);

// ── Shape helpers ───────────────────────────────────────────────────
function shapeStaff(row: any, outlet: any = null, employee: any = null) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar || (row.name || '').split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(),
    role: row.role,
    shift: row.shift,
    outletId: row.outlet_id || null,
    outletName: outlet?.name || null,
    tablesServed: row.tables_served ?? 0,
    avgServiceTimeMin: row.avg_service_time_min ?? 0,
    inspectionScore: row.inspection_score ?? 0,
    workload: row.workload ?? 0,
    status: row.status,
    isActive: row.is_active,
    employeeId: row.employee_id || null,
    email: employee?.email || null,
    phone: employee?.phone || null,
    hireDate: employee?.hire_date || null,
    salary: employee?.salary ?? null,
    department: employee?.department || 'Food & Beverage',
    position: employee?.position || row.role,
  };
}

function shapeAttendance(row: any) {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    departmentScope: row.department_scope,
    employeeId: row.employee_id || null,
    attendanceDate: row.attendance_date,
    shift: row.shift,
    checkIn: row.check_in || null,
    checkOut: row.check_out || null,
    status: row.status,
    hoursWorked: Number(row.hours_worked) || 0,
    overtimeHours: Number(row.overtime_hours) || 0,
    notes: row.notes || null,
    email: null as string | null,
    phone: null as string | null,
    department: null as string | null,
    position: null as string | null,
  };
}

// ════════════════════════════════════════════════════════════════════
// STAFF ROSTER (fb_staff) — mirrors HK's /staff routes
// ════════════════════════════════════════════════════════════════════

// List all F&B staff for a property, with outlet names + HR employee data.
router.get('/staff/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const cacheKey = `fb-staff:${req.params.propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const staffRes = await supabaseAdmin
    .from('fb_staff')
    .select('*')
    .eq('property_id', req.params.propertyId)
    .eq('is_active', true)
    .order('name');

  if (staffRes.error) return res.status(500).json({ error: staffRes.error.message });

  // Fetch outlet names for all staff that have an outlet_id.
  const outletIds = (staffRes.data || []).map((s: any) => s.outlet_id).filter(Boolean);
  let outletsById: Record<string, any> = {};
  if (outletIds.length > 0) {
    const { data: outletRows } = await supabaseAdmin
      .from('outlets').select('id, name').in('id', outletIds);
    (outletRows || []).forEach((o: any) => { outletsById[o.id] = o; });
  }

  // Fetch linked HR employee records.
  const employeeIds = (staffRes.data || []).map((s: any) => s.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (employeeIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .in('id', employeeIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const staff = (staffRes.data || []).map((s: any) =>
    shapeStaff(s, s.outlet_id ? outletsById[s.outlet_id] : null, s.employee_id ? employeesById[s.employee_id] : null)
  );

  const result = {
    propertyId: req.params.propertyId,
    staff,
    summary: {
      total: staff.length,
      onDuty: staff.filter((s: any) => s.status === 'Active Duty').length,
      avgInspection: staff.length ? Math.round(staff.reduce((sum: number, s: any) => sum + s.inspectionScore, 0) / staff.length) : 0,
      avgWorkload: staff.length ? Math.round(staff.reduce((sum: number, s: any) => sum + s.workload, 0) / staff.length) : 0,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// Create a new F&B staff member. Optionally accepts employeeId to link to an
// existing HR employee, or email/phone/hireDate/salary to create a new HR
// employee record at the same time — exactly like HK's POST /staff.
router.post('/staff', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, name, role, shift, outletId,
    tablesServed, avgServiceTimeMin, inspectionScore, workload, status,
    employeeId, email, phone, hireDate, salary,
  } = req.body || {};

  if (!propertyId || !name?.trim()) {
    return res.status(400).json({ error: 'propertyId and name are required' });
  }
  if (role && !STAFF_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  if (shift && !STAFF_SHIFTS.has(shift)) {
    return res.status(400).json({ error: `shift must be one of: ${[...STAFF_SHIFTS].join(', ')}` });
  }

  const id = `FB-S-${Date.now()}`;
  const avatar = name.trim().split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
  const resolvedRole = role || 'Server';

  // If an existing HR employee is being linked, verify it exists.
  let linkedEmployeeId = employeeId || null;
  let employeeRecord: any = null;

  if (linkedEmployeeId) {
    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, email, phone, hire_date, salary, department, position')
      .eq('id', linkedEmployeeId)
      .single();
    if (emp) employeeRecord = emp;
    else linkedEmployeeId = null; // invalid link — ignore
  } else if (email || phone || hireDate || salary) {
    // Create a new HR employee record for this F&B staff member.
    const empId = `EMP-FB-${Date.now()}`;
    const { data: newEmp, error: empError } = await supabaseAdmin
      .from('employees')
      .insert({
        id: empId,
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        department: 'Food & Beverage',
        position: resolvedRole,
        status: 'Active',
        hire_date: hireDate || new Date().toISOString().split('T')[0],
        salary: salary ?? 0,
        avatar_initials: avatar,
      })
      .select('id, email, phone, hire_date, salary, department, position')
      .single();
    if (!empError && newEmp) {
      linkedEmployeeId = empId;
      employeeRecord = newEmp;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('fb_staff')
    .insert({
      id,
      property_id: propertyId,
      name: name.trim(),
      avatar,
      status: status || 'Active Duty',
      is_active: true,
      role: resolvedRole,
      shift: shift || 'Morning',
      outlet_id: outletId || null,
      tables_served: tablesServed ?? 0,
      avg_service_time_min: avgServiceTimeMin ?? 0,
      inspection_score: inspectionScore ?? 0,
      workload: workload ?? 0,
      employee_id: linkedEmployeeId,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern('^fb-staff:');

  // Fetch outlet name for the response.
  let outletRecord: any = null;
  if (data.outlet_id) {
    const { data: o } = await supabaseAdmin.from('outlets').select('id, name').eq('id', data.outlet_id).single();
    if (o) outletRecord = o;
  }

  return res.status(201).json(shapeStaff(data, outletRecord, employeeRecord));
});

// List available HR employees in the Food & Beverage department that are not
// yet linked to an fb_staff row — for the "Link Employee" dropdown.
router.get('/staff/available-employees/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: linkedRows } = await supabaseAdmin
    .from('fb_staff')
    .select('employee_id')
    .not('employee_id', 'is', null);

  const linkedIds = (linkedRows || []).map((r: any) => r.employee_id);

  let q = supabaseAdmin
    .from('employees')
    .select('id, name, email, phone, position, hire_date, salary, department')
    .eq('status', 'Active')
    .eq('department', 'Food & Beverage')
    .order('name');

  if (linkedIds.length > 0) {
    q = q.filter('id', 'not.in', `(${linkedIds.join(',')})`);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ employees: data || [] });
});

// Update a staff member (reassign outlet/shift/role, update metrics, link HR, etc.).
router.put('/staff/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    name, role, shift, outletId,
    tablesServed, avgServiceTimeMin, inspectionScore, workload, status, isActive,
    employeeId,
  } = req.body || {};

  if (role !== undefined && !STAFF_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...STAFF_ROLES].join(', ')}` });
  }
  if (shift !== undefined && !STAFF_SHIFTS.has(shift)) {
    return res.status(400).json({ error: `shift must be one of: ${[...STAFF_SHIFTS].join(', ')}` });
  }

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (role !== undefined) patch.role = role;
  if (shift !== undefined) patch.shift = shift;
  if (outletId !== undefined) patch.outlet_id = outletId || null;
  if (tablesServed !== undefined) patch.tables_served = Number(tablesServed);
  if (avgServiceTimeMin !== undefined) patch.avg_service_time_min = Number(avgServiceTimeMin);
  if (inspectionScore !== undefined) patch.inspection_score = Number(inspectionScore);
  if (workload !== undefined) patch.workload = Number(workload);
  if (status !== undefined) patch.status = status;
  if (isActive !== undefined) patch.is_active = isActive;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;

  if (Object.keys(patch).length === 1) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('fb_staff')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Staff not found' });

  cacheService.invalidatePattern('^fb-staff:');

  // Fetch outlet + employee for the response.
  let outletRecord: any = null;
  if (data.outlet_id) {
    const { data: o } = await supabaseAdmin.from('outlets').select('id, name').eq('id', data.outlet_id).single();
    if (o) outletRecord = o;
  }
  let employeeRecord: any = null;
  if (data.employee_id) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .eq('id', data.employee_id).single();
    if (emp) employeeRecord = emp;
  }

  return res.json(shapeStaff(data, outletRecord, employeeRecord));
});

// Delete (deactivate) a staff member. Soft-delete by setting is_active = false.
// Pass hard=true to remove the row entirely.
router.delete('/staff/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { hard } = req.query as Record<string, string>;

  if (hard === 'true') {
    const { error } = await supabaseAdmin
      .from('fb_staff')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabaseAdmin
      .from('fb_staff')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }

  cacheService.invalidatePattern('^fb-staff:');
  return res.json({ success: true, id: req.params.id });
});

// ════════════════════════════════════════════════════════════════════
// ASSIGNMENTS (fb_staff_assignments) — property-scoped
// ════════════════════════════════════════════════════════════════════
router.get('/assignments/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_assignments')
    .select('*, outlets!fb_staff_assignments_outlet_id_fkey(name)')
    .eq('property_id', req.params.propertyId)
    .order('date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/assignments', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_assignments')
    .insert(req.body)
    .select('*, outlets!fb_staff_assignments_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.status(201).json(data);
});

router.put('/assignments/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_assignments')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*, outlets!fb_staff_assignments_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json(data);
});

router.delete('/assignments/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_staff_assignments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// STAFFING REQUIREMENTS — property-scoped
// ════════════════════════════════════════════════════════════════════
router.get('/staffing/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staffing_requirements')
    .select('*, outlets!fb_staffing_requirements_outlet_id_fkey(name)')
    .eq('property_id', req.params.propertyId)
    .order('outlet_id');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/staffing', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staffing_requirements')
    .insert(req.body)
    .select('*, outlets!fb_staffing_requirements_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.status(201).json(data);
});

router.put('/staffing/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staffing_requirements')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*, outlets!fb_staffing_requirements_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json(data);
});

router.delete('/staffing/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_staffing_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// SHIFT REQUIREMENTS — property-scoped
// ════════════════════════════════════════════════════════════════════
router.get('/shifts/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_shift_requirements')
    .select('*, outlets!fb_shift_requirements_outlet_id_fkey(name)')
    .eq('property_id', req.params.propertyId)
    .order('start_time');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/shifts', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_shift_requirements')
    .insert(req.body)
    .select('*, outlets!fb_shift_requirements_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.status(201).json(data);
});

router.put('/shifts/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_shift_requirements')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*, outlets!fb_shift_requirements_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json(data);
});

router.delete('/shifts/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_shift_requirements').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// TRAINING — property-scoped, supports staff_id
// ════════════════════════════════════════════════════════════════════
router.get('/training/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_training')
    .select('*, outlets!fb_staff_training_outlet_id_fkey(name)')
    .eq('property_id', req.params.propertyId)
    .order('due_date');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/training', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_training')
    .insert(req.body)
    .select('*, outlets!fb_staff_training_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.status(201).json(data);
});

router.put('/training/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_training')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*, outlets!fb_staff_training_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json(data);
});

router.delete('/training/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_staff_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// PRODUCTIVITY — property-scoped, supports staff_id
// ════════════════════════════════════════════════════════════════════
router.get('/productivity/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_productivity')
    .select('*, outlets!fb_staff_productivity_outlet_id_fkey(name)')
    .eq('property_id', req.params.propertyId)
    .order('rev_per_hour', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/productivity', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_productivity')
    .insert(req.body)
    .select('*, outlets!fb_staff_productivity_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.status(201).json(data);
});

router.put('/productivity/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_staff_productivity')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('*, outlets!fb_staff_productivity_outlet_id_fkey(name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json(data);
});

router.delete('/productivity/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fb_staff_productivity').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('^fb-staff:');
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// OUTLETS (lightweight list for dropdowns)
// ════════════════════════════════════════════════════════════════════
router.get('/outlets', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('outlets').select('id, name, type').eq('is_active', true).order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ════════════════════════════════════════════════════════════════════
// ATTENDANCE (F&B) — department_scope = 'FB'
// ════════════════════════════════════════════════════════════════════

// Attendance summary grouped per employee (one row per staff).
router.get('/attendance/summary', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('department_scope', 'FB')
    .order('staff_name')
    .order('attendance_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Group by staff_id
  const byStaff: Record<string, any> = {};
  for (const row of data || []) {
    if (!byStaff[row.staff_id]) {
      byStaff[row.staff_id] = {
        staffId: row.staff_id,
        staffName: row.staff_name,
        employeeId: row.employee_id || null,
        records: [],
        present: 0, late: 0, absent: 0, onLeave: 0, sick: 0, halfDay: 0,
        dayOff: 0, publicHoliday: 0, workFromHome: 0, mission: 0, trainingDay: 0,
        totalHours: 0, totalOvertime: 0, totalDays: 0,
      };
    }
    const s = byStaff[row.staff_id];
    s.totalDays++;
    s.totalHours += Number(row.hours_worked) || 0;
    s.totalOvertime += Number(row.overtime_hours) || 0;
    s.records.push(shapeAttendance(row));
    switch (row.status) {
      case 'Present': s.present++; break;
      case 'Late': s.late++; break;
      case 'Absent': s.absent++; break;
      case 'On Leave': s.onLeave++; break;
      case 'Sick': s.sick++; break;
      case 'Half Day': s.halfDay++; break;
      case 'Day Off': s.dayOff++; break;
      case 'Public Holiday': s.publicHoliday++; break;
      case 'Work From Home': s.workFromHome++; break;
      case 'Mission': s.mission++; break;
      case 'Training Day': s.trainingDay++; break;
    }
  }

  // Join HR employee data
  const empIds = Object.values(byStaff).map((s: any) => s.employeeId).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const summary = Object.values(byStaff).map((s: any) => {
    const emp = s.employeeId ? employeesById[s.employeeId] : null;
    return {
      ...s,
      email: emp?.email || null,
      phone: emp?.phone || null,
      department: emp?.department || null,
      position: emp?.position || null,
      attendanceRate: s.totalDays > 0
        ? Math.round(((s.present + s.late) / s.totalDays) * 100) : 0,
    };
  });

  return res.json({
    summary,
    totals: {
      staffCount: summary.length,
      totalHours: summary.reduce((sum: number, s: any) => sum + s.totalHours, 0),
      totalOvertime: summary.reduce((sum: number, s: any) => sum + s.totalOvertime, 0),
      avgAttendanceRate: summary.length > 0
        ? Math.round(summary.reduce((sum: number, s: any) => sum + s.attendanceRate, 0) / summary.length) : 0,
    },
  });
});

// List attendance records (FB scope), optional date filter.
router.get('/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('department_scope', 'FB')
    .order('attendance_date', { ascending: false })
    .order('staff_name');
  if (date) q = q.eq('attendance_date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Join HR employee data
  const empIds = (data || []).map((r: any) => r.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees').select('id, email, phone, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const records = (data || []).map((row: any) => {
    const shaped = shapeAttendance(row);
    const emp = row.employee_id ? employeesById[row.employee_id] : null;
    if (emp) {
      shaped.email = emp.email || null;
      shaped.phone = emp.phone || null;
      shaped.department = emp.department || null;
      shaped.position = emp.position || null;
    }
    return shaped;
  });

  return res.json({
    attendance: records,
    summary: {
      total: records.length,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      onLeave: records.filter(r => r.status === 'On Leave' || r.status === 'Sick').length,
      totalHours: records.reduce((s, r) => s + r.hoursWorked, 0),
      totalOvertime: records.reduce((s, r) => s + r.overtimeHours, 0),
    },
  });
});

// Create / check-in an F&B staff member for today.
router.post('/attendance', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, staffId, staffName, shift, status, checkIn, notes } = req.body || {};
  if (!propertyId || !staffId || !staffName) return res.status(400).json({ error: 'propertyId, staffId, staffName are required' });
  if (shift && !ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });
  if (status && !ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });

  const today = new Date().toISOString().split('T')[0];
  const id = `ATT-FB-${staffId}-${today}`;

  // Look up the fb_staff member's HR employee_id (if linked).
  let employeeId: string | null = staffId;
  const { data: staffRow } = await supabaseAdmin
    .from('fb_staff').select('employee_id').eq('id', staffId).single();
  if (staffRow?.employee_id) employeeId = staffRow.employee_id;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').upsert({
      id, property_id: propertyId, staff_id: staffId, staff_name: staffName,
      department_scope: 'FB', attendance_date: today,
      shift: shift || 'Morning', status: status || 'Present',
      check_in: checkIn || new Date().toISOString(),
      hours_worked: 0, overtime_hours: 0, notes: notes || null,
      employee_id: employeeId,
    }, { onConflict: 'staff_id,attendance_date' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(shapeAttendance(data));
});

// Update attendance (check-out, status change, hours, notes).
router.put('/attendance/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, shift, notes } = req.body || {};
  if (status && !ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
  if (shift && !ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (checkIn !== undefined) patch.check_in = checkIn;
  if (checkOut !== undefined) patch.check_out = checkOut;
  if (hoursWorked !== undefined) patch.hours_worked = Number(hoursWorked);
  if (overtimeHours !== undefined) patch.overtime_hours = Number(overtimeHours);
  if (shift !== undefined) patch.shift = shift;
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Attendance record not found' });
  return res.json(shapeAttendance(data));
});

// Delete an attendance record.
router.delete('/attendance/:id', authenticate, requirePermission('fb:staff:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('staff_attendance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: req.params.id });
});

export default router;
