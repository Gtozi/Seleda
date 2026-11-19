/**
 * HR Onboarding API
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed CRUD for onboarding checklists (with JSONB task list), document
 * collection, orientation sessions, and probation tracking. Powers the
 * HR > Onboarding module (replacing the hardcoded placeholder data in
 * Onboarding.tsx).
 *
 * Mounted at /api/hr-portal/onboarding.
 * Pattern mirrors the HR Recruitment / ATS routes (property-scoped,
 * service-role supabaseAdmin, cacheService invalidation).
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-onb:';

interface Task { item: string; completed: boolean; }

function computeProgress(tasks: Task[] | any[]): number {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  const done = tasks.filter((t) => t && t.completed).length;
  return Math.round((done / tasks.length) * 100);
}

function deriveStatus(tasks: Task[] | any[]): string {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'Pending';
  const done = tasks.filter((t) => t && t.completed).length;
  if (done === 0) return 'Pending';
  if (done === tasks.length) return 'Completed';
  return 'In Progress';
}

// ── Statistics ────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [activeRes, completedRes, pendingDocRes, probationRes] = await Promise.all([
    supabaseAdmin.from('hr_onboarding_checklists').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).in('status', ['Pending', 'In Progress']),
    supabaseAdmin.from('hr_onboarding_checklists').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Completed'),
    supabaseAdmin.from('hr_onboarding_documents').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('status', 'Pending'),
    supabaseAdmin.from('hr_probation_tracking').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).in('status', ['Active', 'Review Due']),
  ]);

  const stats = {
    activeOnboarding: activeRes.count ?? 0,
    completedThisMonth: completedRes.count ?? 0,
    pendingDocuments: pendingDocRes.count ?? 0,
    probationEnding: probationRes.count ?? 0,
  };

  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Onboarding checklists ────────────────────────────────────────────────
router.get('/checklists/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_onboarding_checklists')
    .select('*')
    .eq('property_id', propertyId)
    .order('start_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const enriched = (data || []).map((c: any) => ({
    ...c,
    progress: computeProgress(c.tasks),
  }));

  return res.json({ checklists: enriched });
});

router.post('/checklists', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeName, position, department, startDate, assignedTo, tasks } = req.body || {};
  if (!propertyId || !employeeName?.trim()) return res.status(400).json({ error: 'propertyId and employeeName are required' });

  const taskList = Array.isArray(tasks) ? tasks : [
    { item: 'Employment Contract', completed: false },
    { item: 'ID Card Issued', completed: false },
    { item: 'Uniform Assigned', completed: false },
    { item: 'System Access', completed: false },
    { item: 'Orientation Completed', completed: false },
    { item: 'Department Training', completed: false },
  ];

  const { data, error } = await supabaseAdmin.from('hr_onboarding_checklists').insert({
    property_id: propertyId,
    employee_name: employeeName.trim(),
    position: position?.trim() || null,
    department: department?.trim() || null,
    start_date: startDate || new Date().toISOString().slice(0, 10),
    status: deriveStatus(taskList),
    assigned_to: assignedTo?.trim() || null,
    tasks: taskList,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json({ ...data, progress: computeProgress((data as any).tasks) });
});

router.put('/checklists/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeName, position, department, startDate, assignedTo, tasks, status } = req.body || {};

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (employeeName !== undefined) patch.employee_name = employeeName;
  if (position !== undefined) patch.position = position || null;
  if (department !== undefined) patch.department = department || null;
  if (startDate !== undefined) patch.start_date = startDate;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (tasks !== undefined) {
    patch.tasks = tasks;
    patch.status = status || deriveStatus(tasks);
  } else if (status !== undefined) {
    patch.status = status;
  }

  const { data, error } = await supabaseAdmin.from('hr_onboarding_checklists').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ ...data, progress: computeProgress((data as any).tasks) });
});

// Toggle a single task in a checklist
router.put('/checklists/:id/toggle-task', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { taskIndex, completed } = req.body || {};
  if (typeof taskIndex !== 'number' || typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'taskIndex (number) and completed (boolean) are required' });
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('hr_onboarding_checklists')
    .select('tasks')
    .eq('id', req.params.id)
    .single();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const tasks = (existing?.tasks || []) as Task[];
  if (taskIndex < 0 || taskIndex >= tasks.length) return res.status(400).json({ error: 'taskIndex out of range' });
  tasks[taskIndex] = { ...tasks[taskIndex], completed };

  const { data, error } = await supabaseAdmin.from('hr_onboarding_checklists')
    .update({ tasks, status: deriveStatus(tasks), updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ ...data, progress: computeProgress((data as any).tasks) });
});

router.delete('/checklists/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_onboarding_checklists').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Onboarding documents ─────────────────────────────────────────────────
router.get('/documents/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_onboarding_documents')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ documents: data || [] });
});

router.post('/documents', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeName, documentName, status, receivedDate, verifiedBy } = req.body || {};
  if (!propertyId || !employeeName?.trim() || !documentName?.trim()) {
    return res.status(400).json({ error: 'propertyId, employeeName and documentName are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_onboarding_documents').insert({
    property_id: propertyId,
    employee_name: employeeName.trim(),
    document_name: documentName.trim(),
    status: status || 'Pending',
    received_date: receivedDate || null,
    verified_by: verifiedBy?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/documents/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeName, documentName, status, receivedDate, verifiedBy } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (employeeName !== undefined) patch.employee_name = employeeName;
  if (documentName !== undefined) patch.document_name = documentName;
  if (status !== undefined) patch.status = status;
  if (receivedDate !== undefined) patch.received_date = receivedDate || null;
  if (verifiedBy !== undefined) patch.verified_by = verifiedBy || null;

  const { data, error } = await supabaseAdmin.from('hr_onboarding_documents').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/documents/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_onboarding_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Orientation sessions ─────────────────────────────────────────────────
router.get('/orientation/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_orientation_sessions')
    .select('*')
    .eq('property_id', propertyId)
    .order('session_date', { ascending: true });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('title', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ sessions: data || [] });
});

router.post('/orientation', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, sessionDate, sessionTime, location, facilitator, attendees, status } = req.body || {};
  if (!propertyId || !title?.trim() || !sessionDate || !sessionTime?.trim()) {
    return res.status(400).json({ error: 'propertyId, title, sessionDate and sessionTime are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_orientation_sessions').insert({
    property_id: propertyId,
    title: title.trim(),
    session_date: sessionDate,
    session_time: sessionTime.trim(),
    location: location?.trim() || null,
    facilitator: facilitator?.trim() || null,
    attendees: Number(attendees) || 0,
    status: status || 'Scheduled',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/orientation/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { title, sessionDate, sessionTime, location, facilitator, attendees, status } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (sessionDate !== undefined) patch.session_date = sessionDate;
  if (sessionTime !== undefined) patch.session_time = sessionTime;
  if (location !== undefined) patch.location = location || null;
  if (facilitator !== undefined) patch.facilitator = facilitator || null;
  if (attendees !== undefined) patch.attendees = Number(attendees) || 0;
  if (status !== undefined) patch.status = status;

  const { data, error } = await supabaseAdmin.from('hr_orientation_sessions').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/orientation/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_orientation_sessions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Probation tracking ───────────────────────────────────────────────────
router.get('/probation/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { status, search } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('hr_probation_tracking')
    .select('*')
    .eq('property_id', propertyId)
    .order('start_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (search?.trim()) q = q.ilike('employee_name', `%${search.trim()}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Compute progress from date range.
  const enriched = (data || []).map((p: any) => {
    const start = new Date(p.start_date).getTime();
    const end = new Date(p.end_date).getTime();
    const now = Date.now();
    let progress = 0;
    if (now >= end) progress = 100;
    else if (now <= start) progress = 0;
    else progress = Math.round(((now - start) / (end - start)) * 100);
    return { ...p, progress };
  });

  return res.json({ probation: enriched });
});

router.post('/probation', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, employeeName, position, startDate, endDate, reviewDate, status, supervisor } = req.body || {};
  if (!propertyId || !employeeName?.trim() || !startDate || !endDate) {
    return res.status(400).json({ error: 'propertyId, employeeName, startDate and endDate are required' });
  }

  const { data, error } = await supabaseAdmin.from('hr_probation_tracking').insert({
    property_id: propertyId,
    employee_name: employeeName.trim(),
    position: position?.trim() || null,
    start_date: startDate,
    end_date: endDate,
    review_date: reviewDate || null,
    status: status || 'Active',
    supervisor: supervisor?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/probation/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employeeName, position, startDate, endDate, reviewDate, status, supervisor } = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (employeeName !== undefined) patch.employee_name = employeeName;
  if (position !== undefined) patch.position = position || null;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (reviewDate !== undefined) patch.review_date = reviewDate || null;
  if (status !== undefined) patch.status = status;
  if (supervisor !== undefined) patch.supervisor = supervisor || null;

  const { data, error } = await supabaseAdmin.from('hr_probation_tracking').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/probation/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_probation_tracking').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
