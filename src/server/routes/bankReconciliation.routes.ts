import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Bank Accounts ───────────────────────────────────────────────
router.get('/accounts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('bank_accounts')
    .select('*, properties!bank_accounts_property_id_fkey(property_name)')
    .order('account_name');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((b: any) => ({
    ...b,
    property_name: b.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/accounts', authenticate, requirePermission('finance:bank:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { accountNumber, accountName, bankName, currency, propertyId } = req.body || {};
  if (!accountNumber || !accountName || !bankName) {
    return res.status(400).json({ error: 'accountNumber, accountName and bankName are required' });
  }

  const { data, error } = await supabaseAdmin.from('bank_accounts').insert({
    account_number: accountNumber,
    account_name: accountName,
    bank_name: bankName,
    currency: currency || 'ETB',
    account_type: 'Operating',
    is_active: true,
    is_default_for_sales: false,
    is_default_for_expenses: false,
    opening_balance: 0,
    current_balance: 0,
    balance: 0,
    status: 'Active',
    property_id: propertyId || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Statement Lines ──────────────────────────────────────────────
router.get('/statement-lines', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { bankAccountId, status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('bank_statement_lines')
    .select('*, bank_accounts(account_name, account_number), properties!bank_statement_lines_property_id_fkey(property_name)')
    .order('statement_date', { ascending: false });
  if (bankAccountId) q = q.eq('bank_account_id', bankAccountId);
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((l: any) => ({
    ...l,
    bank_account_name: l.bank_accounts?.account_name || null,
    property_name: l.properties?.property_name || null,
    bank_accounts: undefined,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/statement-lines/import', authenticate, requirePermission('finance:bank:import'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { bankAccountId, lines } = req.body || {};
  if (!bankAccountId || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'bankAccountId and lines array are required' });
  }

  const { data, error } = await supabaseAdmin.rpc('import_bank_statement_lines', {
    p_bank_account_id: bankAccountId,
    p_lines: JSON.stringify(lines),
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

router.post('/statement-lines/:id/match', authenticate, requirePermission('finance:bank:match'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { journalLineId } = req.body || {};
  if (!journalLineId) {
    return res.status(400).json({ error: 'journalLineId is required' });
  }

  const { data, error } = await supabaseAdmin.rpc('match_statement_line', {
    p_statement_line_id: req.params.id,
    p_journal_line_id: journalLineId,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

// ── Reconciliation Batches ───────────────────────────────────────
router.get('/batches', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { bankAccountId, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('reconciliation_batches')
    .select('*, bank_accounts(account_name, account_number)')
    .order('period_start', { ascending: false });
  if (bankAccountId) q = q.eq('bank_account_id', bankAccountId);
  if (propertyId) q = q.eq('bank_account_id', `in (select id from bank_accounts where property_id = '${propertyId}')`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((b: any) => ({
    ...b,
    bank_accounts: b.bank_accounts,
  }));
  return res.json(rows);
});

router.post('/batches', authenticate, requirePermission('finance:bank:reconcile'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { bankAccountId, periodStart, periodEnd, openingBalance, closingBalance } = req.body || {};
  if (!bankAccountId || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'bankAccountId, periodStart and periodEnd are required' });
  }

  const { data, error } = await supabaseAdmin.from('reconciliation_batches').insert({
    bank_account_id: bankAccountId,
    period_start: periodStart,
    period_end: periodEnd,
    opening_balance: Number(openingBalance) || 0,
    closing_balance: Number(closingBalance) || 0,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Petty Cash Floats ────────────────────────────────────────────
router.get('/petty-cash', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('petty_cash_floats')
    .select('*, properties!petty_cash_floats_property_id_fkey(property_name)')
    .order('department');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((p: any) => ({
    ...p,
    property_name: p.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/petty-cash', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { department, floatCode, floatAmount, currentBalance, custodian, propertyId } = req.body || {};
  if (!department) return res.status(400).json({ error: 'department is required' });
  const id = `pcf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabaseAdmin.from('petty_cash_floats').insert({
    id,
    department,
    float_code: floatCode || null,
    float_amount: Number(floatAmount) || 0,
    current_balance: Number(currentBalance) || Number(floatAmount) || 0,
    custodian: custodian || null,
    status: 'Active',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/petty-cash/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { currentBalance, status, custodian, department, floatCode, floatAmount } = req.body || {};
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (currentBalance !== undefined) update.current_balance = currentBalance;
  if (status !== undefined) update.status = status;
  if (custodian !== undefined) update.custodian = custodian;
  if (department !== undefined) update.department = department;
  if (floatCode !== undefined) update.float_code = floatCode;
  if (floatAmount !== undefined) update.float_amount = floatAmount;
  const { data, error } = await supabaseAdmin.from('petty_cash_floats').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/petty-cash/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('petty_cash_floats').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Cash Transactions ────────────────────────────────────────────
router.get('/cash-transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('cash_transactions')
    .select('*, properties!cash_transactions_property_id_fkey(property_name)')
    .order('transaction_date', { ascending: false });
  if (type) q = q.eq('type', type);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((t: any) => ({
    ...t,
    property_name: t.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/cash-transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, description, amount, transactionDate, reference, department, propertyId } = req.body || {};
  if (!type || amount === undefined) return res.status(400).json({ error: 'type and amount are required' });
  const id = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabaseAdmin.from('cash_transactions').insert({
    id,
    type,
    description: description || null,
    amount: Number(amount),
    transaction_date: transactionDate || new Date().toISOString().split('T')[0],
    reference: reference || null,
    department: department || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

export default router;
