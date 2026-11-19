/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Quality & Compliance routes — backs the /erp/fb/quality-compliance screen.
 *
 * Owns seven resources that mirror the OperationsCompliance.tsx sub-tabs:
 *   - temperature-logs   (fb_temperature_logs)
 *   - haccp-checks       (fb_haccp_checks)
 *   - allergen-controls  (fb_allergen_controls)
 *   - expiry-items       (fb_expiry_items)
 *   - service-standards  (fb_quality_service_standards)
 *   - cleaning-checklists(fb_cleaning_checklists)
 *   - audits             (fb_compliance_audits)
 *
 * All writes gated by `fb:compliance:manage`; reads gated by `authenticate`.
 * Responses join outlets(name) for human-readable labels.
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// Helper: build a generic CRUD router for a single table with outlet join.
function crudForResource(resource: string, tableName: string, fkName: string, orderCol: string) {
  router.get(`/${resource}`, authenticate, async (_req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .select(`*, outlets!${fkName}(name)`)
      .order(orderCol, { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  });

  router.post(`/${resource}`, authenticate, requirePermission('fb:compliance:manage'), async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .insert(req.body)
      .select(`*, outlets!${fkName}(name)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  });

  router.put(`/${resource}/:id`, authenticate, requirePermission('fb:compliance:manage'), async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(`*, outlets!${fkName}(name)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  });

  router.delete(`/${resource}/:id`, authenticate, requirePermission('fb:compliance:manage'), async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { error } = await supabaseAdmin.from(tableName).delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  });
}

crudForResource('temperature-logs', 'fb_temperature_logs', 'fb_temperature_logs_outlet_id_fkey', 'logged_at');
crudForResource('haccp-checks', 'fb_haccp_checks', 'fb_haccp_checks_outlet_id_fkey', 'checked_at');
crudForResource('allergen-controls', 'fb_allergen_controls', 'fb_allergen_controls_outlet_id_fkey', 'last_verified');
crudForResource('expiry-items', 'fb_expiry_items', 'fb_expiry_items_outlet_id_fkey', 'expiry_date');
crudForResource('service-standards', 'fb_quality_service_standards', 'fb_quality_service_standards_outlet_id_fkey', 'last_audited');
crudForResource('cleaning-checklists', 'fb_cleaning_checklists', 'fb_cleaning_checklists_outlet_id_fkey', 'due_date');
crudForResource('audits', 'fb_compliance_audits', 'fb_compliance_audits_outlet_id_fkey', 'audit_date');

// ── Cleaning checklists: bulk create ───────────────────────────────
// Body: { items: Array<{ outlet_id, area, task, checklist_type, frequency, status, assigned_to, due_date }> }
// Inserts all rows in one call and returns the created rows (with outlet join).
router.post('/cleaning-checklists/bulk', authenticate, requirePermission('fb:compliance:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const items = Array.isArray(req.body?.items) ? req.body.items : Array.isArray(req.body) ? req.body : null;
  if (!items || items.length === 0) return res.status(400).json({ error: 'items array is required' });
  const { data, error } = await supabaseAdmin
    .from('fb_cleaning_checklists')
    .insert(items)
    .select(`*, outlets!fb_cleaning_checklists_outlet_id_fkey(name)`);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data || []);
});

// ── Cleaning checklists: inline toggle complete ────────────────────
// Flips status between 'completed' and 'pending', and sets/clears completed_at.
router.patch('/cleaning-checklists/:id/toggle-complete', authenticate, requirePermission('fb:compliance:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('fb_cleaning_checklists')
    .select('id, status')
    .eq('id', req.params.id)
    .single();
  if (findErr) return res.status(404).json({ error: findErr.message });
  const willComplete = existing.status !== 'completed';
  const patch = willComplete
    ? { status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    : { status: 'pending', completed_at: null, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin
    .from('fb_cleaning_checklists')
    .update(patch)
    .eq('id', req.params.id)
    .select(`*, outlets!fb_cleaning_checklists_outlet_id_fkey(name)`)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Outlets (lightweight list for dropdowns) ───────────────────────
router.get('/outlets', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('outlets').select('id, name, type').eq('is_active', true).order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

export default router;
