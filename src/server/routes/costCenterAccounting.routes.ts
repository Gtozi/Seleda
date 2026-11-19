import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Cost Centers ────────────────────────────────────────────────────────────
router.get('/cost-centers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('cost_centers')
    .select('*, properties!cost_centers_property_id_fkey(property_name)')
    .order('code');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

// ── Department P&L ──────────────────────────────────────────────────────────
router.get('/department-pl', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('department_profit_loss')
    .select('*, properties!department_profit_loss_property_id_fkey(property_name)')
    .order('department');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

// ── Profit Centers ──────────────────────────────────────────────────────────
router.get('/profit-centers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('profit_centers')
    .select('*, properties!profit_centers_property_id_fkey(property_name)')
    .order('code');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

// ── Profitability Analysis ──────────────────────────────────────────────────
router.get('/profitability-analysis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('profitability_analysis')
    .select('*, properties!profitability_analysis_property_id_fkey(property_name)')
    .order('department');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

// ── Cost Centers CRUD ───────────────────────────────────────────────────────
router.post('/cost-centers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { code, name, department, manager, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('cost_centers')
    .insert({
      code, name,
      department: department || null,
      manager: manager || null,
      status: status || 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/cost-centers/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('cost_centers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Profit Centers CRUD ─────────────────────────────────────────────────────
router.post('/profit-centers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { code, name, department, manager, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('profit_centers')
    .insert({
      code, name,
      department: department || null,
      manager: manager || null,
      status: status || 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/profit-centers/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('profit_centers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Revenue Allocation Rules ────────────────────────────────────────────────
router.get('/revenue-allocation-rules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('cost_center_revenue_allocations')
    .select('*, properties!cost_center_revenue_allocations_property_id_fkey(property_name)')
    .order('period', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/revenue-allocation-rules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { costCenter, revenueSource, allocationPct, allocatedAmount, period, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('cost_center_revenue_allocations')
    .insert({
      cost_center: costCenter,
      revenue_source: revenueSource,
      allocation_pct: Number(allocationPct || 0),
      allocated_amount: Number(allocatedAmount || 0),
      period: period || null,
      status: status || 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/revenue-allocation-rules/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('cost_center_revenue_allocations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Rates ───────────────────────────────────────────────────────────────
router.get('/tax-rates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fin_tax_rates')
    .select('*, properties!fin_tax_rates_property_id_fkey(property_name)')
    .order('effective_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/tax-rates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { taxCode, rate, effectiveDate, jurisdiction, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('fin_tax_rates')
    .insert({
      tax_code: taxCode,
      rate: Number(rate || 0),
      effective_date: effectiveDate || new Date().toISOString(),
      jurisdiction: jurisdiction || null,
      status: status || 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tax-rates/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fin_tax_rates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Spending Limits ─────────────────────────────────────────────────────────
router.get('/spending-limits', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fin_spending_limits')
    .select('*, properties!fin_spending_limits_property_id_fkey(property_name)')
    .order('role');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r: any) => ({
    ...r,
    property_name: r.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/spending-limits', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { role, limitAmount, approvalLevel, currency, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('fin_spending_limits')
    .insert({
      role,
      limit_amount: Number(limitAmount || 0),
      approval_level: approvalLevel || null,
      currency: currency || 'ETB',
      status: status || 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/spending-limits/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fin_spending_limits').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
