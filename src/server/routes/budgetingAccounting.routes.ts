import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Budget Entries ──────────────────────────────────────────────────────────
router.get('/entries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('budgets')
    .select('*, properties!budgets_property_id_fkey(property_name)')
    .order('period', { ascending: false })
    .limit(200);
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

router.post('/entries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { budgetName, period, accountCode, department, budgetedAmount } = req.body || {};
  if (!budgetName || !period || !accountCode) {
    return res.status(400).json({ error: 'budgetName, period, and accountCode are required' });
  }
  const { data, error } = await supabaseAdmin
    .from('budgets')
    .insert({
      budget_name: budgetName,
      period,
      account_code: accountCode,
      department: department || null,
      budgeted_amount: Number(budgetedAmount) || 0,
      actual_amount: 0,
      variance: 0,
      variance_percent: 0,
      version: 'Draft',
      created_by: req.user?.id || null,
    })
    .select('*, properties!budgets_property_id_fkey(property_name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  const row = {
    ...data,
    property_name: (data as any).properties?.property_name || null,
    properties: undefined,
  };
  return res.status(201).json(row);
});

// ── Budget Types ────────────────────────────────────────────────────────────
router.get('/types', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('budget_types')
    .select('*, properties!budget_types_property_id_fkey(property_name)')
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

// ── Budget Forecasts ────────────────────────────────────────────────────────
router.get('/forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('budget_forecasts')
    .select('*, properties!budget_forecasts_property_id_fkey(property_name)')
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

// ── Budget Transfers ────────────────────────────────────────────────────────
router.get('/transfers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('budget_transfers')
    .select('*, properties!budget_transfers_property_id_fkey(property_name)')
    .order('transfer_date', { ascending: false });
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

// ── Pending Approvals (budgets with version = 'Pending Approval') ──────────
router.get('/approvals', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('budgets')
    .select('*, properties!budgets_property_id_fkey(property_name)')
    .eq('version', 'Pending Approval')
    .order('created_at', { ascending: false });
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

// Approve or reject a budget entry
router.post('/approvals/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action } = req.body || {};
  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }
  const { data, error } = await supabaseAdmin
    .from('budgets')
    .update({
      version: action === 'approve' ? 'Approved' : 'Rejected',
    })
    .eq('id', req.params.id)
    .select('*, properties!budgets_property_id_fkey(property_name)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  const row = {
    ...data,
    property_name: (data as any).properties?.property_name || null,
    properties: undefined,
  };
  return res.json(row);
});

export default router;
