/**
 * HR Workflow & Approvals API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for approval requests and workflow templates.
 * Mounted at /api/hr-portal/workflow.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-workflow:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const [requestsRes, workflowsRes] = await Promise.all([
    supabaseAdmin.from('hr_approval_requests').select('*').eq('property_id', propertyId),
    supabaseAdmin.from('hr_workflow_templates').select('*').eq('property_id', propertyId),
  ]);

  const requests = requestsRes.data || [];
  const today = new Date().toISOString().slice(0, 10);

  const pending = requests.filter((r) => r.request_status === 'Pending').length;
  const approvedToday = requests.filter((r) => r.request_status === 'Approved' && r.approved_date === today).length;
  const rejectedToday = requests.filter((r) => r.request_status === 'Rejected' && r.rejected_date === today).length;

  const durations = (workflowsRes.data || []).map((w) => {
    const match = (w.average_duration || '').match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
  }).filter(Boolean);
  const avgApprovalTime = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : '0';

  const stats = { pendingApprovals: pending, approvedToday, rejectedToday, avgApprovalTime };
  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Approval Requests ──────────────────────────────────────────────────────
router.get('/requests/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_approval_requests')
    .select('*').eq('property_id', req.params.propertyId).order('submitted_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

router.post('/requests', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, requestType, category, employee, department, details, submittedDate, priority, currentApprover, workflowStage } = req.body || {};
  if (!propertyId || !requestType || !employee) return res.status(400).json({ error: 'propertyId, requestType and employee are required' });

  const { data, error } = await supabaseAdmin.from('hr_approval_requests').insert({
    property_id: propertyId, request_type: requestType, category: category || null,
    employee, department: department || null, details: details || null,
    submitted_date: submittedDate || null, priority: priority || 'Normal',
    current_approver: currentApprover || null, workflow_stage: workflowStage || null,
    request_status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { requestType, category, employee, department, details, submittedDate, priority, currentApprover, workflowStage, requestStatus } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (requestType !== undefined) patch.request_type = requestType;
  if (category !== undefined) patch.category = category;
  if (employee !== undefined) patch.employee = employee;
  if (department !== undefined) patch.department = department;
  if (details !== undefined) patch.details = details;
  if (submittedDate !== undefined) patch.submitted_date = submittedDate;
  if (priority !== undefined) patch.priority = priority;
  if (currentApprover !== undefined) patch.current_approver = currentApprover;
  if (workflowStage !== undefined) patch.workflow_stage = workflowStage;
  if (requestStatus !== undefined) patch.request_status = requestStatus;

  const { data, error } = await supabaseAdmin.from('hr_approval_requests').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/requests/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_approval_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

// ── Workflow Templates ─────────────────────────────────────────────────────
router.get('/templates/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('hr_workflow_templates')
    .select('*').eq('property_id', req.params.propertyId).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ templates: data || [] });
});

router.post('/templates', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, description, stages, averageDuration, isActive } = req.body || {};
  if (!propertyId || !name) return res.status(400).json({ error: 'propertyId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_workflow_templates').insert({
    property_id: propertyId, name,
    description: description || null,
    stages: stages || [],
    average_duration: averageDuration || null,
    is_active: isActive !== undefined ? !!isActive : true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/templates/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, description, stages, averageDuration, isActive } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (stages !== undefined) patch.stages = stages;
  if (averageDuration !== undefined) patch.average_duration = averageDuration;
  if (isActive !== undefined) patch.is_active = !!isActive;

  const { data, error } = await supabaseAdmin.from('hr_workflow_templates').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/templates/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_workflow_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
