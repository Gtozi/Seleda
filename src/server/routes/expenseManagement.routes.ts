import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Expense Requests (uses existing expense_requests table) ────────────────
router.get('/expenses', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('expense_requests')
    .select('*, properties!expense_requests_property_id_fkey(property_name)')
    .order('request_date', { ascending: false })
    .limit(100);
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

router.patch('/expenses/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (status === 'Approved') patch.approved_by = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin
    .from('expense_requests')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Expense Claims ─────────────────────────────────────────────────────────
router.get('/claims', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('expense_claims')
    .select('*, properties!expense_claims_property_id_fkey(property_name)')
    .order('submitted_date', { ascending: false });
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

router.patch('/claims/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (status === 'approved') {
    patch.approved_by = (req as any).user?.id || null;
    patch.approved_date = new Date().toISOString().split('T')[0];
  }
  const { data, error } = await supabaseAdmin
    .from('expense_claims')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Approval Workflows ─────────────────────────────────────────────────────
router.get('/approval-workflows', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('expense_approval_workflows')
    .select('*, properties!expense_approval_workflows_property_id_fkey(property_name)')
    .order('workflow_name');
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

// ── Recurring Expenses ─────────────────────────────────────────────────────
router.get('/recurring', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('recurring_expenses')
    .select('*, properties!recurring_expenses_property_id_fkey(property_name)')
    .order('next_date', { ascending: true });
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

export default router;
