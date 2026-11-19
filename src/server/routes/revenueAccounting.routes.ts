import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Revenue Entries ────────────────────────────────────────────────────────
router.get('/entries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('revenue_entries')
    .select('*, properties!revenue_entries_property_id_fkey(property_name)')
    .order('date', { ascending: false })
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

router.post('/entries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { date, source, amount, taxAmount, serviceCharge, netAmount, accountCode, department, status, description, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('revenue_entries')
    .insert({
      date: date || new Date().toISOString().split('T')[0],
      source: source || 'misc',
      amount: Number(amount || 0),
      tax_amount: Number(taxAmount || 0),
      service_charge: Number(serviceCharge || 0),
      net_amount: Number(netAmount || (Number(amount || 0) - Number(taxAmount || 0) - Number(serviceCharge || 0))),
      account_code: accountCode || null,
      department: department || null,
      status: status || 'recognized',
      description: description || null,
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/entries/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, description } = req.body;
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (description !== undefined) patch.description = description;
  const { data, error } = await supabaseAdmin
    .from('revenue_entries')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Deferred Revenue ───────────────────────────────────────────────────────
router.get('/deferred', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('deferred_revenue')
    .select('*, properties!deferred_revenue_property_id_fkey(property_name)')
    .order('recognition_start', { ascending: false });
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

router.post('/deferred', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { description, originalAmount, recognitionStart, recognitionEnd, recognitionSchedule, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('deferred_revenue')
    .insert({
      description: description || null,
      original_amount: Number(originalAmount || 0),
      recognized_amount: 0,
      remaining_amount: Number(originalAmount || 0),
      recognition_start: recognitionStart || new Date().toISOString().split('T')[0],
      recognition_end: recognitionEnd || null,
      recognition_schedule: recognitionSchedule || null,
      status: 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/deferred/:id/recognize', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { amount } = req.body;
  // Fetch current, then update recognized/remaining
  const { data: cur } = await supabaseAdmin.from('deferred_revenue').select('*').eq('id', req.params.id).single();
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const newRecognized = Number(cur.recognized_amount || 0) + Number(amount || 0);
  const newRemaining = Math.max(0, Number(cur.original_amount || 0) - newRecognized);
  const newStatus = newRemaining <= 0 ? 'Fully Recognized' : 'Active';
  const { data, error } = await supabaseAdmin
    .from('deferred_revenue')
    .update({
      recognized_amount: newRecognized,
      remaining_amount: newRemaining,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Daily Postings ─────────────────────────────────────────────────────────
router.get('/daily-postings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('daily_posting_summaries')
    .select('*, properties!daily_posting_summaries_property_id_fkey(property_name)')
    .order('posting_date', { ascending: false });
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

router.post('/daily-postings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { postingDate, totalRevenue, totalTax, totalServiceCharge, totalNet, entryCount, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('daily_posting_summaries')
    .insert({
      posting_date: postingDate || new Date().toISOString().split('T')[0],
      total_revenue: Number(totalRevenue || 0),
      total_tax: Number(totalTax || 0),
      total_service_charge: Number(totalServiceCharge || 0),
      total_net: Number(totalNet || 0),
      entry_count: Number(entryCount || 0),
      status: 'Posted',
      posted_by: (req as any).user?.id || null,
      posted_at: new Date().toISOString(),
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/daily-postings/:id/post', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('daily_posting_summaries')
    .update({
      status: 'Posted',
      posted_by: (req as any).user?.id || null,
      posted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Package Allocations ────────────────────────────────────────────────────
router.get('/package-allocations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('package_allocations')
    .select('*, properties!package_allocations_property_id_fkey(property_name)')
    .order('package_name');
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

router.post('/package-allocations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { packageName, totalAmount, roomPortion, fbPortion, spaPortion, otherPortion, allocationMethod, propertyId } = req.body;
  const { data, error } = await supabaseAdmin
    .from('package_allocations')
    .insert({
      package_name: packageName,
      total_amount: Number(totalAmount || 0),
      room_portion: Number(roomPortion || 0),
      fb_portion: Number(fbPortion || 0),
      spa_portion: Number(spaPortion || 0),
      other_portion: Number(otherPortion || 0),
      allocation_method: allocationMethod || 'relative',
      status: 'Active',
      property_id: propertyId || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/package-allocations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { packageName, totalAmount, roomPortion, fbPortion, spaPortion, otherPortion, allocationMethod, status } = req.body;
  const patch: any = { updated_at: new Date().toISOString() };
  if (packageName !== undefined) patch.package_name = packageName;
  if (totalAmount !== undefined) patch.total_amount = Number(totalAmount || 0);
  if (roomPortion !== undefined) patch.room_portion = Number(roomPortion || 0);
  if (fbPortion !== undefined) patch.fb_portion = Number(fbPortion || 0);
  if (spaPortion !== undefined) patch.spa_portion = Number(spaPortion || 0);
  if (otherPortion !== undefined) patch.other_portion = Number(otherPortion || 0);
  if (allocationMethod !== undefined) patch.allocation_method = allocationMethod;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin
    .from('package_allocations')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

export default router;
