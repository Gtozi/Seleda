import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Vendors ─────────────────────────────────────────────────────
// Reads from ap_vendors (canonical) and joins properties for property_name.
router.get('/vendors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('ap_vendors')
    .select('*, properties!ap_vendors_property_id_fkey(property_name)')
    .order('name');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((v: any) => ({
    ...v,
    property_name: v.properties?.property_name || null,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/vendors', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, contactName, email, phone, address, taxId, withholdingRate, category, propertyId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Vendor name is required' });

  const vendorCode = `VND-${Date.now().toString().slice(-6)}`;
  const id = `vendor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const { data, error } = await supabaseAdmin.from('ap_vendors').insert({
    id,
    vendor_code: vendorCode,
    name,
    contact_person: contactName || null,
    email: email || null,
    phone: phone || null,
    address: address || null,
    tin: taxId || null,
    withholding_rate: withholdingRate || 0,
    category: category || 'Operations',
    is_withholding_agent: (withholdingRate || 0) > 0,
    is_active: true,
    current_balance: 0,
    property_id: propertyId || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Mirror into legacy vendors table
  await supabaseAdmin.from('vendors').upsert({
    id: data.id,
    name: data.name,
    contact_name: data.contact_person,
    email: data.email,
    phone: data.phone,
    address: data.address,
    tax_id: data.tin,
    withholding_rate: data.withholding_rate,
    category: data.category,
    status: 'Active',
    balance: 0,
    property_id: data.property_id,
  });

  return res.status(201).json(data);
});

// ── Bills ───────────────────────────────────────────────────────
// DB schema: bill_number, bill_date, subtotal, tax_amount, withholding_amount,
// total_amount, paid_amount. We map to the frontend's expected shape.
router.get('/bills', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, vendor_id, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('ap_bills')
    .select('*, ap_vendors(name), properties!ap_bills_property_id_fkey(property_name)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (vendor_id) q = q.eq('vendor_id', vendor_id);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((b: any) => ({
    ...b,
    vendor_name: b.ap_vendors?.name || null,
    property_name: b.properties?.property_name || null,
    ap_vendors: undefined,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/bills', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { vendorId, invoiceNumber, invoiceDate, dueDate, category, amount, taxAmount, withholdingAmount, lines, propertyId } = req.body || {};
  if (!vendorId || !invoiceNumber || !invoiceDate || !dueDate || amount === undefined) {
    return res.status(400).json({ error: 'vendorId, invoiceNumber, invoiceDate, dueDate and amount are required' });
  }

  const subtotal = Number(amount);
  const tax = Number(taxAmount || 0);
  const wh = Number(withholdingAmount || 0);
  const totalAmount = subtotal + tax; // gross
  const netPayable = totalAmount - wh;
  const id = `bill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const { data: bill, error } = await supabaseAdmin.from('ap_bills').insert({
    id,
    bill_number: invoiceNumber,
    vendor_id: vendorId,
    bill_date: invoiceDate,
    due_date: dueDate,
    category: category || null,
    subtotal,
    tax_amount: tax,
    withholding_amount: wh,
    total_amount: totalAmount,
    paid_amount: 0,
    status: 'Approved', // use constraint-permitted value (Pending not allowed)
    currency: 'ETB',
    property_id: propertyId || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Update vendor balance (legacy vendors table)
  await supabaseAdmin.from('vendors').update({ balance: netPayable }).eq('id', vendorId);
  // Update ap_vendors current_balance
  await supabaseAdmin.from('ap_vendors').update({ current_balance: netPayable }).eq('id', vendorId);

  return res.status(201).json(bill);
});

// ── Payments ──────────────────────────────────────────────────────
router.get('/payments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('ap_payments')
    .select('*, ap_vendors(name), properties!ap_payments_property_id_fkey(property_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((p: any) => ({
    ...p,
    vendor_name: p.ap_vendors?.name || null,
    property_name: p.properties?.property_name || null,
    ap_vendors: undefined,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/bills/:id/pay', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { amount, paymentDate, paymentMethod, reference } = req.body || {};
  if (!amount || !paymentDate) {
    return res.status(400).json({ error: 'amount and paymentDate are required' });
  }

  // Map frontend payment methods to DB constraint values (Cash, Bank, Mobile Money, Card, Check)
  const methodMap: Record<string, string> = {
    'Bank Transfer': 'Bank',
    'Bank': 'Bank',
    'Cash': 'Cash',
    'Check': 'Check',
    'Cheque': 'Check',
    'Card': 'Card',
    'Mobile Money': 'Mobile Money',
    'Wire': 'Bank',
  };
  const dbMethod = methodMap[paymentMethod || 'Bank Transfer'] || 'Bank';

  const { data, error } = await supabaseAdmin.rpc('record_ap_payment', {
    p_bill_id: req.params.id,
    p_amount: Number(amount),
    p_payment_date: paymentDate,
    p_payment_method: dbMethod,
    p_reference: reference || null,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

// ── Three-Way Matching ──────────────────────────────────────────
router.get('/matching', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('ap_three_way_matches')
    .select('*, ap_vendors(name), properties!ap_three_way_matches_property_id_fkey(property_name)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((m: any) => ({
    ...m,
    vendor_name: m.ap_vendors?.name || null,
    property_name: m.properties?.property_name || null,
    ap_vendors: undefined,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/matching/:id/approve', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('ap_three_way_matches')
    .update({ status: 'Approved', approved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/matching/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { invoiceMatch, receiptMatch, status, notes } = req.body || {};
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (invoiceMatch !== undefined) update.invoice_match = invoiceMatch;
  if (receiptMatch !== undefined) update.receipt_match = receiptMatch;
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes;
  const { data, error } = await supabaseAdmin
    .from('ap_three_way_matches')
    .update(update)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Payment Scheduling ──────────────────────────────────────────
router.get('/scheduling', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('ap_payment_schedules')
    .select('*, ap_vendors(name), properties!ap_payment_schedules_property_id_fkey(property_name)')
    .order('scheduled_date', { ascending: true });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((s: any) => ({
    ...s,
    vendor_name: s.ap_vendors?.name || null,
    property_name: s.properties?.property_name || null,
    ap_vendors: undefined,
    properties: undefined,
  }));
  return res.json(rows);
});

router.post('/scheduling', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { vendorId, billId, billNumber, scheduledDate, amount, paymentMethod, frequency, autoPay, propertyId } = req.body || {};
  if (!vendorId || !scheduledDate || amount === undefined) {
    return res.status(400).json({ error: 'vendorId, scheduledDate and amount are required' });
  }
  const id = `aps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabaseAdmin.from('ap_payment_schedules').insert({
    id,
    vendor_id: vendorId,
    bill_id: billId || null,
    bill_number: billNumber || null,
    scheduled_date: scheduledDate,
    amount: Number(amount),
    payment_method: paymentMethod || 'Bank',
    frequency: frequency || 'One-time',
    auto_pay: !!autoPay,
    status: 'Pending',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/scheduling/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, scheduledDate, autoPay, paymentMethod } = req.body || {};
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) update.status = status;
  if (scheduledDate !== undefined) update.scheduled_date = scheduledDate;
  if (autoPay !== undefined) update.auto_pay = autoPay;
  if (paymentMethod !== undefined) update.payment_method = paymentMethod;
  const { data, error } = await supabaseAdmin
    .from('ap_payment_schedules')
    .update(update)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/scheduling/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('ap_payment_schedules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
