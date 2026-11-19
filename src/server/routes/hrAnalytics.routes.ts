/**
 * HR Reports & Analytics API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed catalog for HR, Attendance, Payroll, Performance, and Executive
 * reports. Mounted at /api/hr-portal/analytics.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-analytics:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin.from('hr_reports').select('*').eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });

  const reports = data || [];
  const today = new Date().toISOString().slice(0, 10);
  const totalReports = reports.length;
  const generatedToday = reports.filter((r) => r.last_generated === today).length;
  const scheduledReports = reports.filter((r) => r.is_scheduled).length;
  const dashboards = reports.filter((r) => (r.format || '').toLowerCase().includes('dashboard')).length;

  const stats = { totalReports, generatedToday, scheduledReports, dashboards };
  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── All reports ────────────────────────────────────────────────────────────
router.get('/all/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_reports')
    .select('*').eq('property_id', propertyId).order('report_type', { ascending: true }).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ reports: data || [] });
});

// ── Reports by type ────────────────────────────────────────────────────────
router.get('/:reportType/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { reportType, propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_reports')
    .select('*').eq('property_id', propertyId).eq('report_type', reportType).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ reports: data || [] });
});

router.post('/', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, reportType, reportId, name, description, category, lastGenerated, generatedBy, format, fileUrl, isScheduled } = req.body || {};
  if (!propertyId || !reportType || !reportId || !name) return res.status(400).json({ error: 'propertyId, reportType, reportId and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_reports').insert({
    property_id: propertyId, report_type: reportType, report_id: reportId, name,
    description: description || null, category: category || null,
    last_generated: lastGenerated || null, generated_by: generatedBy || null,
    format: format || null, file_url: fileUrl || null,
    is_scheduled: isScheduled !== undefined ? !!isScheduled : false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { reportId, name, description, category, lastGenerated, generatedBy, format, fileUrl, isScheduled } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (reportId !== undefined) patch.report_id = reportId;
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (category !== undefined) patch.category = category;
  if (lastGenerated !== undefined) patch.last_generated = lastGenerated;
  if (generatedBy !== undefined) patch.generated_by = generatedBy;
  if (format !== undefined) patch.format = format;
  if (fileUrl !== undefined) patch.file_url = fileUrl;
  if (isScheduled !== undefined) patch.is_scheduled = !!isScheduled;

  const { data, error } = await supabaseAdmin.from('hr_reports').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_reports').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
