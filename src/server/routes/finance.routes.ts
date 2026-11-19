import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { currencyService } from '../services/currencyService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── API Version Header Middleware ─────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('API-Version', '1.0');
  next();
});

// ── Chart of Accounts ─────────────────────────────────────────
router.get('/chart-of-accounts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, category } = req.query as Record<string, string>;

  const cacheKey = `chart-of-accounts:${propertyId || 'all'}:${category || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('usali_chart_of_accounts')
    .select('*, properties!usali_chart_of_accounts_property_id_fkey(property_name)')
    .order('code');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data || []).map((a: any) => ({
    ...a,
    property_name: a.properties?.property_name || null,
    properties: undefined,
  }));
  cacheService.set(cacheKey, result, 10 * 60 * 1000);
  return res.json(result);
});

// ── Chart of Accounts CRUD ─────────────────────────────────────
router.post('/chart-of-accounts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { code, name, category, subcategory, department, accountType, parentCode, description, normalBalance, currency, isControlAccount, propertyId } = req.body || {};
  if (!code || !name || !category) return res.status(400).json({ error: 'code, name and category are required' });
  const { data, error } = await supabaseAdmin.from('usali_chart_of_accounts').insert({
    code, name, category,
    subcategory: subcategory || null,
    department: department || null,
    account_type: accountType || category,
    is_active: true,
    parent_code: parentCode || null,
    description: description || null,
    normal_balance: normalBalance || (category === 'Asset' || category === 'Expense' ? 'Debit' : 'Credit'),
    currency: currency || 'ETB',
    is_control_account: !!isControlAccount,
    balance: 0,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('chart-of-accounts:*');
  return res.status(201).json(data);
});

router.patch('/chart-of-accounts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) update.name = body.name;
  if (body.subcategory !== undefined) update.subcategory = body.subcategory;
  if (body.department !== undefined) update.department = body.department;
  if (body.description !== undefined) update.description = body.description;
  if (body.normalBalance !== undefined) update.normal_balance = body.normalBalance;
  if (body.currency !== undefined) update.currency = body.currency;
  if (body.isControlAccount !== undefined) update.is_control_account = body.isControlAccount;
  if (body.isActive !== undefined) update.is_active = body.isActive;
  if (body.propertyId !== undefined) update.property_id = body.propertyId || null;
  if (body.balance !== undefined) update.balance = body.balance;
  const { data, error } = await supabaseAdmin.from('usali_chart_of_accounts').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('chart-of-accounts:*');
  return res.json(data);
});

router.delete('/chart-of-accounts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('usali_chart_of_accounts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern('chart-of-accounts:*');
  return res.json({ success: true });
});

// ── Journal Entries ─────────────────────────────────────────────
router.get('/journal-entries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { period, status, page = '1', limit = '50' } = req.query as Record<string, string>;
  
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 50;
  const offset = (pageNum - 1) * limitNum;
  
  let q = supabaseAdmin
    .from('journal_entries')
    .select('*, journal_lines(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);
  
  if (period) q = q.eq('period', period);
  if (status) q = q.eq('status', status);
  
  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  
  return res.json({
    data: data || [],
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limitNum),
    },
  });
});

router.get('/journal-entries/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('journal_entries')
    .select('*, journal_lines(*)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/journal-entries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, period, source, reference, description, department, lines } = req.body || {};
  if (!date || !period || !description || !Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ error: 'date, period, description and at least two lines are required' });
  }

  const totalDebit = lines.reduce((sum: number, l: any) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum: number, l: any) => sum + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    return res.status(400).json({ error: 'Journal entry is out of balance', totalDebit, totalCredit });
  }

  const id = `je_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const userId = req.user?.id || null;

  const { data: entry, error: entryError } = await supabaseAdmin.from('journal_entries').insert({
    id,
    date,
    period,
    source: source || 'Manual',
    reference: reference || null,
    description,
    status: 'Draft',
    total_debit: totalDebit,
    total_credit: totalCredit,
    department: department || null,
    created_by: userId,
  }).select().single();

  if (entryError) return res.status(500).json({ error: entryError.message });

  const lineRows = lines.map((l: any, idx: number) => ({
    journal_id: id,
    account_code: l.accountCode || l.account_code,
    account_name: l.accountName || l.account_name || '',
    description: l.description || '',
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    currency: l.currency || 'ETB',
    exchange_rate: l.exchangeRate || l.exchange_rate || 1.0,
    cost_center: l.costCenter || l.cost_center || null,
    tax_code: l.taxCode || l.tax_code || null,
    memo: l.memo || null,
    line_number: idx + 1,
  }));

  const { error: linesError } = await supabaseAdmin.from('journal_lines').insert(lineRows);
  if (linesError) return res.status(500).json({ error: linesError.message });

  // Invalidate journal entries cache
  cacheService.invalidatePattern('journal-entries:*');

  return res.status(201).json({ success: true, entry });
});

router.post('/journal-entries/:id/post', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: entry, error: entryError } = await supabaseAdmin
    .from('journal_entries')
    .select('*, journal_lines(*)')
    .eq('id', req.params.id)
    .single();
  if (entryError || !entry) return res.status(404).json({ error: entryError?.message || 'Journal entry not found' });
  if (entry.status !== 'Draft') return res.status(409).json({ error: `Entry is already ${entry.status}` });

  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from('usali_chart_of_accounts')
    .select('code, normal_balance, balance')
    .in('code', (entry.journal_lines as any[]).map(l => l.account_code));
  if (accountsError) return res.status(500).json({ error: accountsError.message });

  const balanceMap = new Map((accounts || []).map(a => [a.code, Number(a.balance) || 0]));
  const normalMap = new Map((accounts || []).map(a => [a.code, a.normal_balance]));

  for (const line of entry.journal_lines as any[]) {
    const normal = normalMap.get(line.account_code);
    let delta = Number(line.debit) - Number(line.credit);
    if (normal === 'Credit') delta = -delta;
    balanceMap.set(line.account_code, (balanceMap.get(line.account_code) || 0) + delta);
  }

  const updates = Array.from(balanceMap.entries()).map(([code, balance]) =>
    supabaseAdmin.from('usali_chart_of_accounts').update({ balance }).eq('code', code)
  );

  const { error: postError } = await supabaseAdmin.from('journal_entries').update({
    status: 'Posted',
    posted_at: new Date().toISOString(),
    approved_by: req.user?.id || null,
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id);
  if (postError) return res.status(500).json({ error: postError.message });

  await Promise.all(updates);

  // Invalidate chart of accounts cache since balances changed
  cacheService.invalidate('chart-of-accounts:all');
  cacheService.invalidatePattern('journal-entries:*');

  return res.json({ success: true, posted: true });
});

router.post('/journal-entries/:id/reverse', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: entry, error: entryError } = await supabaseAdmin
    .from('journal_entries')
    .select('*, journal_lines(*)')
    .eq('id', req.params.id)
    .single();
  if (entryError || !entry) return res.status(404).json({ error: entryError?.message || 'Journal entry not found' });
  if (entry.status !== 'Posted') return res.status(409).json({ error: 'Only posted entries can be reversed' });

  const reverseId = `je_rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data: newEntry, error: createError } = await supabaseAdmin.from('journal_entries').insert({
    id: reverseId,
    date: new Date().toISOString().split('T')[0],
    period: entry.period,
    source: 'Manual',
    reference: `Reversal of ${entry.reference || entry.id}`,
    description: `Reversal: ${entry.description}`,
    status: 'Draft',
    total_debit: entry.total_credit,
    total_credit: entry.total_debit,
    department: entry.department,
    created_by: req.user?.id || null,
  }).select().single();
  if (createError) return res.status(500).json({ error: createError.message });

  const reverseLines = (entry.journal_lines as any[]).map((l: any, idx: number) => ({
    journal_id: reverseId,
    account_code: l.account_code,
    account_name: l.account_name,
    description: `Reversal: ${l.description || ''}`,
    debit: Number(l.credit) || 0,
    credit: Number(l.debit) || 0,
    currency: l.currency || 'ETB',
    exchange_rate: l.exchange_rate || 1.0,
    cost_center: l.cost_center || null,
    tax_code: l.tax_code || null,
    memo: l.memo || null,
    line_number: idx + 1,
  }));

  const { error: linesError } = await supabaseAdmin.from('journal_lines').insert(reverseLines);
  if (linesError) return res.status(500).json({ error: linesError.message });

  await supabaseAdmin.from('journal_entries').update({ status: 'Reversed', updated_at: new Date().toISOString() }).eq('id', req.params.id);

  // Optionally auto-post the reversing entry
  await supabaseAdmin.from('journal_entries').update({ status: 'Posted', posted_at: new Date().toISOString(), approved_by: req.user?.id || null }).eq('id', reverseId);

  // Invalidate caches
  cacheService.invalidate('chart-of-accounts:all');
  cacheService.invalidatePattern('journal-entries:*');

  return res.json({ success: true, reversedEntryId: reverseId, newEntry });
});

// ── Currency Management ─────────────────────────────────────────
router.get('/currencies', authenticate, async (req, res) => {
  const currencies = currencyService.getCurrencies();
  return res.json(currencies);
});

router.get('/currencies/:code', authenticate, async (req, res) => {
  const currency = currencyService.getCurrency(req.params.code);
  if (!currency) {
    return res.status(404).json({ error: 'Currency not found' });
  }
  return res.json(currency);
});

router.get('/exchange-rates', authenticate, async (req, res) => {
  const rates = currencyService.getExchangeRates();
  return res.json(rates);
});

router.post('/exchange-rates', authenticate, async (req, res) => {
  const { rates, effectiveDate } = req.body || {};
  if (!rates || typeof rates !== 'object') {
    return res.status(400).json({ error: 'rates object is required' });
  }

  currencyService.updateExchangeRates(rates, effectiveDate);

  // Invalidate any cached financial data that depends on exchange rates
  cacheService.invalidatePattern('chart-of-accounts:*');
  cacheService.invalidatePattern('journal-entries:*');

  return res.json({ 
    success: true, 
    rates: currencyService.getExchangeRates(),
    effectiveDate: effectiveDate || currencyService['effectiveDate'],
  });
});

router.post('/convert', authenticate, async (req, res) => {
  const { amount, fromCurrency, toCurrency } = req.body || {};
  if (!amount || !fromCurrency || !toCurrency) {
    return res.status(400).json({ error: 'amount, fromCurrency, and toCurrency are required' });
  }

  if (!currencyService.isCurrencySupported(fromCurrency)) {
    return res.status(400).json({ error: `Currency ${fromCurrency} is not supported` });
  }

  if (!currencyService.isCurrencySupported(toCurrency)) {
    return res.status(400).json({ error: `Currency ${toCurrency} is not supported` });
  }

  const converted = currencyService.convert(Number(amount), fromCurrency, toCurrency);
  const rate = currencyService.getExchangeRate(fromCurrency, toCurrency);

  return res.json({
    amount: Number(amount),
    fromCurrency,
    toCurrency,
    convertedAmount: converted,
    exchangeRate: rate,
    formattedOriginal: currencyService.format(Number(amount), fromCurrency),
    formattedConverted: currencyService.format(converted, toCurrency),
  });
});

// ── Bank Accounts ───────────────────────────────────────────────
router.get('/bank-accounts', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('bank_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, bankAccounts: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/bank-accounts/:id', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('bank_accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Bank account not found' });
    return res.json({ success: true, bankAccount: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/bank-accounts/:id/summary', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('get_bank_account_summary', {
      p_bank_account_id: req.params.id
    });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/bank-accounts', authenticate, async (req, res) => {
  const {
    accountName,
    bankName,
    accountNumber,
    accountType,
    currency,
    swiftBicCode,
    branchName,
    branchAddress,
    description,
    openingBalance,
    isDefaultForSales,
    isDefaultForExpenses
  } = req.body;

  if (!accountName || !bankName || !accountNumber || !accountType) {
    return res.status(400).json({ error: 'accountName, bankName, accountNumber, and accountType are required' });
  }

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const bankAccountId = crypto.randomUUID();
    const insertData: any = {
      id: bankAccountId,
      account_name: accountName,
      bank_name: bankName,
      account_number: accountNumber,
      account_type: accountType,
      currency: currency || 'ETB',
      swift_bic_code: swiftBicCode,
      branch_name: branchName,
      branch_address: branchAddress,
      description,
      opening_balance: openingBalance || 0,
      current_balance: openingBalance || 0,
      is_default_for_sales: isDefaultForSales || false,
      is_default_for_expenses: isDefaultForExpenses || false,
      created_by: req.user!.id
    };

    const { data, error } = await supabaseAdmin
      .from('bank_accounts')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, bankAccount: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.put('/bank-accounts/:id', authenticate, async (req, res) => {
  const {
    accountName,
    bankName,
    accountNumber,
    accountType,
    currency,
    isActive,
    isDefaultForSales,
    isDefaultForExpenses,
    swiftBicCode,
    branchName,
    branchAddress,
    description
  } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (accountName !== undefined) updateData.account_name = accountName;
    if (bankName !== undefined) updateData.bank_name = bankName;
    if (accountNumber !== undefined) updateData.account_number = accountNumber;
    if (accountType !== undefined) updateData.account_type = accountType;
    if (currency !== undefined) updateData.currency = currency;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (isDefaultForSales !== undefined) updateData.is_default_for_sales = isDefaultForSales;
    if (isDefaultForExpenses !== undefined) updateData.is_default_for_expenses = isDefaultForExpenses;
    if (swiftBicCode !== undefined) updateData.swift_bic_code = swiftBicCode;
    if (branchName !== undefined) updateData.branch_name = branchName;
    if (branchAddress !== undefined) updateData.branch_address = branchAddress;
    if (description !== undefined) updateData.description = description;

    const { data, error } = await supabaseAdmin
      .from('bank_accounts')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Bank account not found' });
    return res.json({ success: true, bankAccount: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/bank-accounts/:id', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from('bank_accounts')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, message: 'Bank account deleted' });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Expense Payment ─────────────────────────────────────────────
// Expense payment with bank account tracking
router.post('/expenses/:id/payment', authenticate, async (req, res) => {
  const { bankAccountId, paymentMethod, paymentReference } = req.body;

  if (!paymentMethod) {
    return res.status(400).json({ error: 'paymentMethod is required' });
  }

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('update_expense_payment', {
      p_expense_id: req.params.id,
      p_bank_account_id: bankAccountId || null,
      p_payment_method: paymentMethod,
      p_payment_reference: paymentReference || null,
      p_user_id: req.user!.id
    });

    if (error) return res.status(500).json({ error: error.message });
    if (!data?.success) return res.status(400).json({ error: data?.error || 'Payment failed' });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── General Ledger (journal-entries PUT) ────────────────────────
router.put('/journal-entries/:id', authenticate, async (req, res) => {
  const { status } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .update({
        status,
        posted_at: status === 'Posted' ? new Date().toISOString() : null
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, entry: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Accounts Payable ────────────────────────────────────────────
router.get('/ap/vendors', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('ap_vendors')
      .select('*')
      .order('name');

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/ap/vendors', authenticate, async (req, res) => {
  const { name, contactEmail, contactPhone, address, taxId, withholdingTaxRate, paymentTerms } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('ap_vendors')
      .insert({
        name,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        address,
        tax_id: taxId,
        withholding_tax_rate: withholdingTaxRate,
        payment_terms: paymentTerms,
        created_by: req.user!.id
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, vendor: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/ap/bills', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('ap_bills')
      .select(`
        *,
        ap_vendors(name),
        ap_bill_lines(*)
      `)
      .order('invoice_date', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/ap/bills', authenticate, async (req, res) => {
  const { vendorId, invoiceNumber, invoiceDate, dueDate, subtotal, taxAmount, withholdingAmount, totalAmount, lines } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data: bill, error: billError } = await supabaseAdmin
      .from('ap_bills')
      .insert({
        vendor_id: vendorId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        subtotal,
        tax_amount: taxAmount,
        withholding_amount: withholdingAmount,
        total_amount: totalAmount,
        status: 'Open',
        created_by: req.user!.id
      })
      .select()
      .single();

    if (billError) return res.status(500).json({ error: billError.message });

    if (lines && Array.isArray(lines)) {
      const { error: linesError } = await supabaseAdmin
        .from('ap_bill_lines')
        .insert(lines.map((line: any) => ({
          bill_id: bill.id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: line.lineTotal
        })));

      if (linesError) return res.status(500).json({ error: linesError.message });
    }

    return res.json({ success: true, bill });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Accounts Receivable ─────────────────────────────────────────
router.get('/ar/customers', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('ar_customers')
      .select('*')
      .order('name');

    if (error) return res.status(500).json({ error: error.message });
    // Attach property_name from properties table
    const { data: props } = await supabaseAdmin.from('properties').select('id, property_name');
    const nameMap = new Map((props || []).map((p: any) => [p.id, p.property_name]));
    const enriched = (data || []).map((c: any) => ({ ...c, property_name: c.property_id ? (nameMap.get(c.property_id) || null) : null }));
    return res.json(enriched);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/ar/customers', authenticate, async (req, res) => {
  const { name, contactEmail, contactPhone, address, taxId, creditLimit, category,
          email, phone, tin, credit_limit, customer_type, customer_code,
          city, country, payment_terms, propertyId, property_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const insertRow: Record<string, any> = {
      id: `ar_cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      email: contactEmail || email || null,
      phone: contactPhone || phone || null,
      address: address || null,
      tin: taxId || tin || null,
      credit_limit: creditLimit ?? credit_limit ?? 0,
      customer_type: category || customer_type || 'Corporate',
      customer_code: customer_code || `CUST-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
      city: city || null,
      country: country || null,
      payment_terms: payment_terms || null,
      is_active: true,
      property_id: propertyId || property_id || null,
    };
    const { data, error } = await supabaseAdmin
      .from('ar_customers')
      .insert(insertRow)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, customer: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/ar/invoices', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('ar_invoices')
      .select(`
        *,
        ar_customers(name),
        ar_invoice_lines(*)
      `)
      .order('invoice_date', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Guest folios with aging buckets
router.get('/ar/folios', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('folios')
      .select(`
        id, reservation_id, status, balance, total_charges, total_payments,
        opened_at, closed_at, currency, property_id
      `)
      .order('opened_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Fetch reservation details for guest name / room
    const reservationIds = (data || []).map((f: any) => f.reservation_id).filter(Boolean);
    let reservationMap: Record<string, any> = {};
    if (reservationIds.length > 0) {
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('id, guest_name, room_number, check_in_date, check_out_date, payment_status')
        .in('id', reservationIds);
      (reservations || []).forEach((r: any) => { reservationMap[r.id] = r; });
    }

    // Fetch property names
    const { data: props } = await supabaseAdmin.from('properties').select('id, property_name');
    const propNameMap = new Map((props || []).map((p: any) => [p.id, p.property_name]));

    const now = new Date();
    const foliosWithAging = (data || []).map((f: any) => {
      const openedDate = f.opened_at ? new Date(f.opened_at) : now;
      const daysOutstanding = Math.floor((now.getTime() - openedDate.getTime()) / (1000 * 60 * 60 * 24));
      const balance = Number(f.balance) || 0;
      let agingBucket = '0-30';
      if (daysOutstanding > 90) agingBucket = '90+';
      else if (daysOutstanding > 60) agingBucket = '61-90';
      else if (daysOutstanding > 30) agingBucket = '31-60';

      const reservation = f.reservation_id ? reservationMap[f.reservation_id] : null;
      return {
        id: f.id,
        reservation_id: f.reservation_id,
        guest_name: reservation?.guest_name || 'Unknown',
        room_number: reservation?.room_number || null,
        check_in_date: reservation?.check_in_date || null,
        check_out_date: reservation?.check_out_date || null,
        status: f.status,
        balance,
        total_charges: Number(f.total_charges) || 0,
        total_payments: Number(f.total_payments) || 0,
        opened_at: f.opened_at,
        closed_at: f.closed_at,
        payment_status: reservation?.payment_status || null,
        days_outstanding: daysOutstanding,
        aging_bucket: agingBucket,
        property_id: f.property_id || null,
        property_name: f.property_id ? (propNameMap.get(f.property_id) || null) : null,
      };
    });

    return res.json(foliosWithAging);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── AR Credit/Debit Notes ─────────────────────────────────────────
router.get('/ar/credit-notes', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { noteType, status, propertyId } = req.query as Record<string, string>;
    let q = supabaseAdmin.from('ar_credit_notes').select('*').order('created_at', { ascending: false });
    if (noteType) q = q.eq('note_type', noteType);
    if (status) q = q.eq('status', status);
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Attach customer name and property name
    const customerIds = (data || []).map((n: any) => n.customer_id).filter(Boolean);
    let customerMap: Record<string, string> = {};
    if (customerIds.length > 0) {
      const { data: customers } = await supabaseAdmin.from('ar_customers').select('id, name').in('id', customerIds);
      (customers || []).forEach((c: any) => { customerMap[c.id] = c.name; });
    }
    const { data: props } = await supabaseAdmin.from('properties').select('id, property_name');
    const propNameMap = new Map((props || []).map((p: any) => [p.id, p.property_name]));

    const enriched = (data || []).map((n: any) => ({
      ...n,
      customer_name: n.customer_id ? (customerMap[n.customer_id] || null) : null,
      property_name: n.property_id ? (propNameMap.get(n.property_id) || null) : null,
    }));
    return res.json(enriched);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/ar/credit-notes', authenticate, async (req, res) => {
  const { noteType, customerId, invoiceId, reason, amount, status, propertyId } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const noteNumber = `${noteType === 'Credit' ? 'CN' : 'DN'}-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabaseAdmin.from('ar_credit_notes').insert({
      note_number: noteNumber,
      note_type: noteType,
      customer_id: customerId || null,
      invoice_id: invoiceId || null,
      reason: reason || null,
      amount: Number(amount) || 0,
      status: status || 'Pending',
      property_id: propertyId || null,
      created_by: req.user!.id,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/ar/credit-notes/:id', authenticate, async (req, res) => {
  const { status, reason, amount } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const patch: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) {
      patch.status = status;
      if (status === 'Applied') patch.applied_at = new Date().toISOString();
    }
    if (reason !== undefined) patch.reason = reason;
    if (amount !== undefined) patch.amount = Number(amount) || 0;
    const { data, error } = await supabaseAdmin.from('ar_credit_notes')
      .update(patch).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/ar/credit-notes/:id', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('ar_credit_notes').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── AR Collections ────────────────────────────────────────────────
router.get('/ar/collections', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { status, propertyId } = req.query as Record<string, string>;
    let q = supabaseAdmin.from('ar_collections').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Attach customer name and property name
    const customerIds = (data || []).map((c: any) => c.customer_id).filter(Boolean);
    let customerMap: Record<string, string> = {};
    if (customerIds.length > 0) {
      const { data: customers } = await supabaseAdmin.from('ar_customers').select('id, name').in('id', customerIds);
      (customers || []).forEach((c: any) => { customerMap[c.id] = c.name; });
    }
    const { data: props } = await supabaseAdmin.from('properties').select('id, property_name');
    const propNameMap = new Map((props || []).map((p: any) => [p.id, p.property_name]));

    const enriched = (data || []).map((c: any) => ({
      ...c,
      customer_name: c.customer_id ? (customerMap[c.customer_id] || null) : null,
      property_name: c.property_id ? (propNameMap.get(c.property_id) || null) : null,
    }));
    return res.json(enriched);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/ar/collections', authenticate, async (req, res) => {
  const { customerId, folioId, amount, daysOverdue, lastContact, nextAction, nextActionDate, status, notes, propertyId } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('ar_collections').insert({
      customer_id: customerId || null,
      folio_id: folioId || null,
      amount: Number(amount) || 0,
      days_overdue: Number(daysOverdue) || 0,
      last_contact: lastContact || null,
      next_action: nextAction || null,
      next_action_date: nextActionDate || null,
      status: status || 'In Progress',
      notes: notes || null,
      property_id: propertyId || null,
      created_by: req.user!.id,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/ar/collections/:id', authenticate, async (req, res) => {
  const { status, nextAction, nextActionDate, lastContact, notes, amount, daysOverdue } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const patch: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) patch.status = status;
    if (nextAction !== undefined) patch.next_action = nextAction;
    if (nextActionDate !== undefined) patch.next_action_date = nextActionDate;
    if (lastContact !== undefined) patch.last_contact = lastContact;
    if (notes !== undefined) patch.notes = notes;
    if (amount !== undefined) patch.amount = Number(amount) || 0;
    if (daysOverdue !== undefined) patch.days_overdue = Number(daysOverdue) || 0;
    const { data, error } = await supabaseAdmin.from('ar_collections')
      .update(patch).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/ar/collections/:id', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('ar_collections').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Fixed Assets ────────────────────────────────────────────────
router.get('/fixed-assets', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('fixed_assets')
      .select('*')
      .order('acquisition_date', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/fixed-assets', authenticate, async (req, res) => {
  const { assetCode, name, description, category, acquisitionDate, acquisitionCost, usefulLife, depreciationMethod, salvageValue } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('fixed_assets')
      .insert({
        asset_code: assetCode,
        name,
        description,
        category,
        acquisition_date: acquisitionDate,
        acquisition_cost: acquisitionCost,
        useful_life: usefulLife,
        depreciation_method: depreciationMethod,
        salvage_value: salvageValue,
        current_book_value: acquisitionCost,
        accumulated_depreciation: 0,
        status: 'Active',
        created_by: req.user!.id
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, asset: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Tax Codes ───────────────────────────────────────────────────
router.get('/tax-codes', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('tax_codes')
      .select('*')
      .order('code');

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Budget vs Actual ────────────────────────────────────────────
router.get('/budget-actual', authenticate, async (req, res) => {
  const { period, accountCode } = req.query;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    let query = supabaseAdmin.from('budgets').select('*');

    if (period) query = query.eq('period', period);
    if (accountCode) query = query.eq('account_code', accountCode);

    const { data, error } = await query.order('period', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/budget-actual', authenticate, async (req, res) => {
  const { budgetName, period, accountCode, department, budgetedAmount } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('budgets')
      .insert({
        budget_name: budgetName,
        period,
        account_code: accountCode,
        department,
        budgeted_amount: budgetedAmount,
        actual_amount: 0,
        variance: 0,
        variance_percent: 0,
        version: 'Draft',
        created_by: req.user!.id,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, budget: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Period Close ────────────────────────────────────────────────
router.get('/period-close', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('period_close_workflow')
      .select('*')
      .order('period', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/period-close', authenticate, async (req, res) => {
  const { period, lockType, notes } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('period_close_workflow')
      .insert({
        period,
        lock_type: lockType,
        status: 'In Progress',
        notes,
        initiated_by: req.user!.id
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, workflow: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.put('/period-close/:id', authenticate, async (req, res) => {
  const { status, notes } = req.body;

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('period_close_workflow')
      .update({
        status,
        notes,
        completed_at: status === 'Closed' ? new Date().toISOString() : null
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, workflow: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

export default router;
