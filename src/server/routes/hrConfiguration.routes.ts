/**
 * HR Configuration API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed key/value settings grouped by configuration domain.
 * Mounted at /api/hr-portal/configuration.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-configuration:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin.from('hr_configuration').select('config_group, setting_type', { count: 'exact' }).eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });

  const settings = data || [];
  const stats = {
    total: settings.length,
    groups: (['organization', 'attendance', 'payroll', 'performance'] as const).reduce((acc, g) => {
      acc[g] = settings.filter((s) => s.config_group === g).length;
      return acc;
    }, {} as Record<string, number>),
    booleans: settings.filter((s) => s.setting_type === 'boolean').length,
    numbers: settings.filter((s) => s.setting_type === 'number').length,
  };
  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Settings by group ──────────────────────────────────────────────────────
router.get('/:configGroup/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { configGroup, propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_configuration')
    .select('*').eq('property_id', propertyId).eq('config_group', configGroup).order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ settings: data || [] });
});

// ── Bulk save for a group ──────────────────────────────────────────────────
router.post('/bulk', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, configGroup, settings } = req.body || {};
  if (!propertyId || !configGroup || !Array.isArray(settings)) return res.status(400).json({ error: 'propertyId, configGroup and settings[] are required' });

  const updates = settings.map((s: any) => {
    if (!s.id) return null;
    return supabaseAdmin.from('hr_configuration').update({
      setting_value: String(s.value ?? ''),
      setting_name: s.name,
      category: s.category,
      setting_type: s.type,
      sort_order: s.sort_order,
      updated_at: new Date().toISOString(),
    }).eq('id', s.id).eq('property_id', propertyId).select().single();
  }).filter(Boolean) as any[];

  const results = await Promise.all(updates);
  const errors = results.filter((r) => r.error).map((r) => r.error);
  if (errors.length) return res.status(500).json({ error: errors[0].message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true, updated: results.length });
});

// ── Add a single setting ───────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, configGroup, category, name, value, type, sortOrder } = req.body || {};
  if (!propertyId || !configGroup || !category || !name) return res.status(400).json({ error: 'propertyId, configGroup, category and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_configuration').insert({
    property_id: propertyId, config_group: configGroup, category,
    setting_name: name, setting_value: String(value ?? ''), setting_type: type || 'text',
    sort_order: sortOrder ?? 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category, name, value, type, sortOrder } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (category !== undefined) patch.category = category;
  if (name !== undefined) patch.setting_name = name;
  if (value !== undefined) patch.setting_value = String(value);
  if (type !== undefined) patch.setting_type = type;
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  const { data, error } = await supabaseAdmin.from('hr_configuration').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_configuration').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
