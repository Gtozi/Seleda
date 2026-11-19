import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Cash Forecasts ─────────────────────────────────────────────────────────
router.get('/cash-forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_cash_forecasts')
    .select('*, properties!treasury_cash_forecasts_property_id_fkey(property_name)')
    .order('period', { ascending: true });
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

router.post('/cash-forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { period, openingBalance, inflows, outflows, closingBalance, propertyId } = req.body;
  const netCashFlow = Number(inflows || 0) - Number(outflows || 0);
  const { data, error } = await supabaseAdmin
    .from('treasury_cash_forecasts')
    .insert({
      period,
      opening_balance: Number(openingBalance || 0),
      inflows: Number(inflows || 0),
      outflows: Number(outflows || 0),
      net_cash_flow: netCashFlow,
      closing_balance: Number(closingBalance || 0),
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/cash-forecasts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('treasury_cash_forecasts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Investments ────────────────────────────────────────────────────────────
router.get('/investments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_investments')
    .select('*, properties!treasury_investments_property_id_fkey(property_name)')
    .order('maturity_date', { ascending: true });
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

router.post('/investments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, amount, maturityDate, interestRate, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('treasury_investments')
    .insert({
      name, type,
      amount: Number(amount || 0),
      maturity_date: maturityDate || null,
      interest_rate: Number(interestRate || 0),
      status: status || 'active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/investments/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('treasury_investments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Loans ──────────────────────────────────────────────────────────────────
router.get('/loans', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_loans')
    .select('*, properties!treasury_loans_property_id_fkey(property_name)')
    .order('next_payment_date', { ascending: true });
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

router.post('/loans', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { lender, principal, interestRate, outstandingBalance, nextPaymentDate, monthlyPayment, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('treasury_loans')
    .insert({
      lender,
      principal: Number(principal || 0),
      interest_rate: Number(interestRate || 0),
      outstanding_balance: Number(outstandingBalance || principal || 0),
      next_payment_date: nextPaymentDate || null,
      monthly_payment: Number(monthlyPayment || 0),
      status: status || 'active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/loans/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('treasury_loans').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── FX Rates ───────────────────────────────────────────────────────────────
router.get('/fx-rates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_fx_rates')
    .select('*, properties!treasury_fx_rates_property_id_fkey(property_name)')
    .order('currency');
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

router.post('/fx-rates', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { currency, rate, changePct, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('treasury_fx_rates')
    .insert({
      currency,
      rate: Number(rate || 0),
      change_pct: Number(changePct || 0),
      last_updated: new Date().toISOString(),
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/fx-rates/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('treasury_fx_rates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── FX Transactions ────────────────────────────────────────────────────────
router.get('/fx-transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_fx_transactions')
    .select('*, properties!treasury_fx_transactions_property_id_fkey(property_name)')
    .order('transaction_date', { ascending: false });
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

// ── Liquidity Forecasts ────────────────────────────────────────────────────
router.get('/liquidity-forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_liquidity_forecasts')
    .select('*, properties!treasury_liquidity_forecasts_property_id_fkey(property_name)')
    .order('week_label', { ascending: true });
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

router.post('/liquidity-forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { weekLabel, opening, inflows, outflows, closing, status, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('treasury_liquidity_forecasts')
    .insert({
      week_label: weekLabel,
      opening: Number(opening || 0),
      inflows: Number(inflows || 0),
      outflows: Number(outflows || 0),
      closing: Number(closing || 0),
      status: status || 'Surplus',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/liquidity-forecasts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('treasury_liquidity_forecasts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Cash Pool Participants ─────────────────────────────────────────────────
router.get('/cash-pool', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('treasury_cash_pool_participants')
    .select('*, properties!treasury_cash_pool_participants_property_id_fkey(property_name)')
    .order('account_name');
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

router.post('/cash-pool', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { accountName, entity, balance, sweepAmount, role, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('treasury_cash_pool_participants')
    .insert({
      account_name: accountName,
      entity: entity || null,
      balance: Number(balance || 0),
      sweep_amount: Number(sweepAmount || 0),
      role: role || 'Participant',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/cash-pool/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('treasury_cash_pool_participants').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
