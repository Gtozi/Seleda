/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Financial Control routes — backs the /erp/fb/financial-control screen.
 *
 * Owns eight resources that mirror the FinancialControl.tsx sub-tabs:
 *   - revenue          (fb_revenue_records)
 *   - cogs             (fb_cogs_records)
 *   - labor            (fb_labor_records)
 *   - discounts        (fb_discount_records)
 *   - waste            (fb_waste_records)
 *   - production       (fb_production_batches)
 *   - journal-entries  (fb_journal_entries)
 *   - reconciliation   (fb_reconciliation_records)
 *
 * All writes gated by `fb:financial_control:manage`; reads gated by `authenticate`.
 * Responses join outlets(name) for human-readable labels.
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const MANAGE = 'fb:financial_control:manage';

// Helper: build a generic CRUD router for a single table with outlet join.
// dateCol is the per-table date column used for default ordering.
function crudForResource(resource: string, tableName: string, fkName: string, dateCol: string) {
  router.get(`/${resource}`, authenticate, async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { outletId, startDate, endDate } = req.query as Record<string, string>;
    let q = supabaseAdmin
      .from(tableName)
      .select(`*, outlets!${fkName}(name)`)
      .order(dateCol, { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    if (startDate) q = q.gte(dateCol, startDate);
    if (endDate) q = q.lte(dateCol, endDate);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  });

  router.post(`/${resource}`, authenticate, requirePermission(MANAGE), async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .insert(req.body)
      .select(`*, outlets!${fkName}(name)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  });

  router.put(`/${resource}/:id`, authenticate, requirePermission(MANAGE), async (req, res) => {
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

  router.delete(`/${resource}/:id`, authenticate, requirePermission(MANAGE), async (req, res) => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
    const { error } = await supabaseAdmin.from(tableName).delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  });
}

crudForResource('revenue', 'fb_revenue_records', 'fb_revenue_records_outlet_id_fkey', 'record_date');
crudForResource('cogs', 'fb_cogs_records', 'fb_cogs_records_outlet_id_fkey', 'record_date');
crudForResource('labor', 'fb_labor_records', 'fb_labor_records_outlet_id_fkey', 'record_date');
crudForResource('discounts', 'fb_discount_records', 'fb_discount_records_outlet_id_fkey', 'record_date');

// ── Waste: sourced from inventory wastage_logs ─────────────────────
// Waste records are mirrored from wastage_logs via a trigger.
// The POST/PUT/DELETE handlers operate on the wastage_log and let the
// trigger keep fb_waste_records in sync, then enrich the financial fields.

router.get('/waste', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fb_waste_records')
    .select(`*, outlets!fb_waste_records_outlet_id_fkey(name), wastage_logs!fb_waste_records_wastage_log_id_fkey(*)`)
    .order('record_date', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (startDate) q = q.gte('record_date', startDate);
  if (endDate) q = q.lte('record_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/waste', authenticate, requirePermission(MANAGE), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    outlet_id, record_date, type,
    ingredient_id, location_id, quantity, unit, cost, reason,
    logged_by, approved_by, notes,
  } = req.body as any;

  if (!ingredient_id || !location_id || !quantity || !unit) {
    return res.status(400).json({ error: 'ingredient_id, location_id, quantity, and unit are required for the wastage log' });
  }

  const { data: log, error: logError } = await supabaseAdmin
    .from('wastage_logs')
    .insert({
      ingredient_id,
      location_id,
      quantity,
      unit,
      reason: reason || 'Other',
      cost_value: cost ?? 0,
      logged_by: logged_by || 'system',
      approved_by: approved_by || null,
      notes: notes || null,
    })
    .select('id')
    .single();
  if (logError) return res.status(500).json({ error: logError.message });

  const { data: record, error: recordError } = await supabaseAdmin
    .from('fb_waste_records')
    .update({
      outlet_id: outlet_id || null,
      record_date,
      type: type || 'other',
    })
    .eq('wastage_log_id', log.id)
    .select(`*, outlets!fb_waste_records_outlet_id_fkey(name), wastage_logs!fb_waste_records_wastage_log_id_fkey(*)`)
    .single();
  if (recordError) return res.status(500).json({ error: recordError.message });
  return res.status(201).json(record);
});

router.put('/waste/:id', authenticate, requirePermission(MANAGE), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('fb_waste_records')
    .select('wastage_log_id')
    .eq('id', req.params.id)
    .single();

  if (!existing?.wastage_log_id) {
    return res.status(400).json({ error: 'Cannot update: this waste record is not linked to a wastage log' });
  }

  const {
    outlet_id, record_date, type,
    ingredient_id, location_id, quantity, unit, cost, reason,
    logged_by, approved_by, notes,
  } = req.body as any;

  const { error: logError } = await supabaseAdmin
    .from('wastage_logs')
    .update({
      ...(ingredient_id !== undefined ? { ingredient_id } : {}),
      ...(location_id !== undefined ? { location_id } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(cost !== undefined ? { cost_value: cost } : {}),
      ...(logged_by !== undefined ? { logged_by } : {}),
      ...(approved_by !== undefined ? { approved_by } : {}),
      ...(notes !== undefined ? { notes } : {}),
    })
    .eq('id', existing.wastage_log_id);
  if (logError) return res.status(500).json({ error: logError.message });

  const { data: record, error: recordError } = await supabaseAdmin
    .from('fb_waste_records')
    .update({
      ...(outlet_id !== undefined ? { outlet_id } : {}),
      ...(record_date !== undefined ? { record_date } : {}),
      ...(type !== undefined ? { type } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select(`*, outlets!fb_waste_records_outlet_id_fkey(name), wastage_logs!fb_waste_records_wastage_log_id_fkey(*)`)
    .single();
  if (recordError) return res.status(500).json({ error: recordError.message });
  return res.json(record);
});

router.delete('/waste/:id', authenticate, requirePermission(MANAGE), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('fb_waste_records')
    .select('wastage_log_id')
    .eq('id', req.params.id)
    .single();

  if (existing?.wastage_log_id) {
    const { error: logError } = await supabaseAdmin.from('wastage_logs').delete().eq('id', existing.wastage_log_id);
    if (logError) return res.status(500).json({ error: logError.message });
  } else {
    const { error } = await supabaseAdmin.from('fb_waste_records').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
});

// ── Production: sourced from production-coordination fb_batch_production ─
// A trigger creates/updates the financial production batch from each batch
// in production coordination. POST/PUT/DELETE operate on the source table.

router.get('/production', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outletId, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fb_production_batches')
    .select(`*, outlets!fb_production_batches_outlet_id_fkey(name), fb_batch_production!fb_production_batches_batch_production_id_fkey(*)`)
    .order('batch_date', { ascending: false });
  if (outletId) q = q.eq('outlet_id', outletId);
  if (startDate) q = q.gte('batch_date', startDate);
  if (endDate) q = q.lte('batch_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/production', authenticate, requirePermission(MANAGE), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    outlet_id, batch_date, batch_number, status,
    name, batch_type, yield_qty, yield_unit, prepared_by, batch_status,
    raw_cost, labor_cost, overhead_cost, notes,
  } = req.body as any;

  if (!name || !batch_type || !yield_qty || !yield_unit) {
    return res.status(400).json({ error: 'name, batch_type, yield_qty, and yield_unit are required for the source batch' });
  }

  const { data: batch, error: batchError } = await supabaseAdmin
    .from('fb_batch_production')
    .insert({
      name,
      outlet_id,
      batch_type,
      yield_qty,
      yield_unit,
      prepared_by: prepared_by || 'system',
      status: batch_status || 'Scheduled',
    })
    .select('id')
    .single();
  if (batchError) return res.status(500).json({ error: batchError.message });

  const total = (raw_cost ?? 0) + (labor_cost ?? 0) + (overhead_cost ?? 0);
  const unitCost = Number(yield_qty) > 0 ? Number((total / Number(yield_qty)).toFixed(2)) : 0;

  const { data: record, error: recordError } = await supabaseAdmin
    .from('fb_production_batches')
    .update({
      outlet_id: outlet_id || null,
      batch_date,
      batch_number: batch_number || ('BATCH-' + batch.id),
      raw_cost: raw_cost ?? 0,
      labor_cost: labor_cost ?? 0,
      overhead_cost: overhead_cost ?? 0,
      total_cost: total,
      unit_cost: unitCost,
      status: status || 'draft',
      notes: notes || 'Sourced from batch production',
    })
    .eq('batch_production_id', batch.id)
    .select(`*, outlets!fb_production_batches_outlet_id_fkey(name), fb_batch_production!fb_production_batches_batch_production_id_fkey(*)`)
    .single();
  if (recordError) return res.status(500).json({ error: recordError.message });
  return res.status(201).json(record);
});

router.put('/production/:id', authenticate, requirePermission(MANAGE), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('fb_production_batches')
    .select('batch_production_id')
    .eq('id', req.params.id)
    .single();

  if (!existing?.batch_production_id) {
    return res.status(400).json({ error: 'Cannot update: this production record is not linked to a source batch' });
  }

  const {
    outlet_id, batch_date, batch_number, status,
    name, batch_type, yield_qty, yield_unit, prepared_by, batch_status,
    raw_cost, labor_cost, overhead_cost, notes,
  } = req.body as any;

  const { error: batchError } = await supabaseAdmin
    .from('fb_batch_production')
    .update({
      ...(name !== undefined ? { name } : {}),
      ...(outlet_id !== undefined ? { outlet_id } : {}),
      ...(batch_type !== undefined ? { batch_type } : {}),
      ...(yield_qty !== undefined ? { yield_qty } : {}),
      ...(yield_unit !== undefined ? { yield_unit } : {}),
      ...(prepared_by !== undefined ? { prepared_by } : {}),
      ...(batch_status !== undefined ? { status: batch_status } : {}),
    })
    .eq('id', existing.batch_production_id);
  if (batchError) return res.status(500).json({ error: batchError.message });

  const total = ((raw_cost ?? 0) + (labor_cost ?? 0) + (overhead_cost ?? 0));
  const unitCost = Number(yield_qty) > 0 ? Number((total / Number(yield_qty)).toFixed(2)) : 0;

  const { data: record, error: recordError } = await supabaseAdmin
    .from('fb_production_batches')
    .update({
      ...(outlet_id !== undefined ? { outlet_id } : {}),
      ...(batch_date !== undefined ? { batch_date } : {}),
      ...(batch_number !== undefined ? { batch_number } : {}),
      ...(raw_cost !== undefined ? { raw_cost } : {}),
      ...(labor_cost !== undefined ? { labor_cost } : {}),
      ...(overhead_cost !== undefined ? { overhead_cost } : {}),
      ...(yield_qty !== undefined || yield_qty !== undefined ? {
        total_cost: total,
        unit_cost: unitCost,
      } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select(`*, outlets!fb_production_batches_outlet_id_fkey(name), fb_batch_production!fb_production_batches_batch_production_id_fkey(*)`)
    .single();
  if (recordError) return res.status(500).json({ error: recordError.message });
  return res.json(record);
});

router.delete('/production/:id', authenticate, requirePermission(MANAGE), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('fb_production_batches')
    .select('batch_production_id')
    .eq('id', req.params.id)
    .single();

  if (existing?.batch_production_id) {
    const { error: batchError } = await supabaseAdmin.from('fb_batch_production').delete().eq('id', existing.batch_production_id);
    if (batchError) return res.status(500).json({ error: batchError.message });
  } else {
    const { error } = await supabaseAdmin.from('fb_production_batches').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
});

crudForResource('journal-entries', 'fb_journal_entries', 'fb_journal_entries_outlet_id_fkey', 'entry_date');
crudForResource('reconciliation', 'fb_reconciliation_records', 'fb_reconciliation_records_outlet_id_fkey', 'reconciliation_date');

// ── Outlets (lightweight list for dropdowns) ───────────────────────
router.get('/outlets', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('outlets')
    .select('id, name, type')
    .eq('is_active', true)
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── KPI summary (computed from waste + production only) ─────────────
// Revenue, COGS, labor, and discounts come from POS, inventory, and HR
// respectively and are no longer tracked as F&B financial-control records.
router.get('/summary', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const [waste, prod] = await Promise.all([
    supabaseAdmin.from('fb_waste_records').select('cost'),
    supabaseAdmin.from('fb_production_batches').select('total_cost'),
  ]);

  if (waste.error || prod.error) {
    return res.status(500).json({ error: 'Failed to load summary' });
  }

  const sum = (rows: any[], col: string) =>
    (rows || []).reduce((acc, r) => acc + Number(r[col] || 0), 0);

  return res.json({
    totalWaste: sum(waste.data, 'cost'),
    totalProductionCost: sum(prod.data, 'total_cost'),
  });
});

export default router;
