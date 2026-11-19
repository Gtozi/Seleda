import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Fixed Assets Register ───────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category, status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('fixed_assets').select('*').order('purchase_date', { ascending: false });
  if (category) q = q.eq('asset_category', category);
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    assetCode,
    assetName,
    assetCategory,
    description,
    location,
    purchaseDate,
    purchaseCost,
    salvageValue,
    usefulLifeYears,
    depreciationMethod,
    propertyId,
  } = req.body || {};
  if (!assetCode || !assetName || !assetCategory || !purchaseDate || !purchaseCost || !usefulLifeYears) {
    return res.status(400).json({ error: 'assetCode, assetName, assetCategory, purchaseDate, purchaseCost and usefulLifeYears are required' });
  }

  const netBookValue = Number(purchaseCost) - Number(salvageValue || 0);

  const { data, error } = await supabaseAdmin.from('fixed_assets').insert({
    asset_code: assetCode,
    asset_name: assetName,
    asset_category: assetCategory,
    description,
    location,
    purchase_date: purchaseDate,
    purchase_cost: Number(purchaseCost),
    salvage_value: Number(salvageValue) || 0,
    useful_life_years: Number(usefulLifeYears),
    depreciation_method: depreciationMethod || 'Straight Line',
    net_book_value: netBookValue,
    property_id: propertyId || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    assetName,
    assetCategory,
    description,
    location,
    purchaseDate,
    purchaseCost,
    salvageValue,
    usefulLifeYears,
    depreciationMethod,
    status,
  } = req.body || {};

  const update: Record<string, any> = {};
  if (assetName !== undefined) update.asset_name = assetName;
  if (assetCategory !== undefined) update.asset_category = assetCategory;
  if (description !== undefined) update.description = description;
  if (location !== undefined) update.location = location;
  if (purchaseDate !== undefined) update.purchase_date = purchaseDate;
  if (purchaseCost !== undefined) update.purchase_cost = Number(purchaseCost);
  if (salvageValue !== undefined) update.salvage_value = Number(salvageValue);
  if (usefulLifeYears !== undefined) update.useful_life_years = Number(usefulLifeYears);
  if (depreciationMethod !== undefined) update.depreciation_method = depreciationMethod;
  if (status !== undefined) update.status = status;

  if (purchaseCost !== undefined || salvageValue !== undefined) {
    const { data: asset } = await supabaseAdmin.from('fixed_assets').select('purchase_cost, salvage_value, accumulated_depreciation').eq('id', req.params.id).single();
    if (asset) {
      const cost = purchaseCost !== undefined ? Number(purchaseCost) : Number(asset.purchase_cost);
      update.net_book_value = cost - Number(asset.accumulated_depreciation);
    }
  }

  const { data, error } = await supabaseAdmin.from('fixed_assets').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fixed_assets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.post('/:id/calculate-depreciation', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { fiscalYear } = req.body || {};
  if (!fiscalYear) {
    return res.status(400).json({ error: 'fiscalYear is required' });
  }

  const { data, error } = await supabaseAdmin.rpc('calculate_depreciation', {
    p_asset_id: req.params.id,
    p_fiscal_year: Number(fiscalYear),
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

router.post('/:id/dispose', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { disposalDate, disposalValue } = req.body || {};
  if (!disposalDate) {
    return res.status(400).json({ error: 'disposalDate is required' });
  }

  const { data, error } = await supabaseAdmin.rpc('dispose_asset', {
    p_asset_id: req.params.id,
    p_disposal_date: disposalDate,
    p_disposal_value: Number(disposalValue) || 0,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

// ── Depreciation Schedules ───────────────────────────────────────
router.get('/:id/depreciation-schedule', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('depreciation_schedules')
    .select('*')
    .eq('asset_id', req.params.id)
    .order('fiscal_year', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// Generate full depreciation schedule for an asset
router.post('/:id/generate-schedule', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: asset, error: assetError } = await supabaseAdmin
    .from('fixed_assets')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (assetError || !asset) {
    return res.status(404).json({ error: assetError?.message || 'Asset not found' });
  }

  const purchaseCost = Number(asset.purchase_cost);
  const salvageValue = Number(asset.salvage_value) || 0;
  const usefulLife = Number(asset.useful_life_years);
  const method = asset.depreciation_method || 'Straight Line';
  const purchaseYear = new Date(asset.purchase_date).getFullYear();

  const schedule = [];
  let accumulatedDepreciation = 0;
  let netBookValue = purchaseCost;

  for (let year = 0; year <= usefulLife; year++) {
    const fiscalYear = purchaseYear + year;
    let depreciationExpense = 0;

    if (year < usefulLife) {
      switch (method) {
        case 'Straight Line':
          depreciationExpense = (purchaseCost - salvageValue) / usefulLife;
          break;
        case 'Double Declining Balance':
          const rate = 2 / usefulLife;
          depreciationExpense = Math.min(netBookValue * rate, netBookValue - salvageValue);
          break;
        case 'Sum of Years Digits':
          const sumOfYears = (usefulLife * (usefulLife + 1)) / 2;
          depreciationExpense = (purchaseCost - salvageValue) * (usefulLife - year) / sumOfYears;
          break;
        default:
          depreciationExpense = (purchaseCost - salvageValue) / usefulLife;
      }
    } else {
      depreciationExpense = Math.max(0, netBookValue - salvageValue);
    }

    accumulatedDepreciation += depreciationExpense;
    netBookValue = purchaseCost - accumulatedDepreciation;

    schedule.push({
      asset_id: req.params.id,
      fiscal_year: fiscalYear,
      depreciation_amount: Math.round(depreciationExpense * 100) / 100,
      accumulated_depreciation: Math.round(accumulatedDepreciation * 100) / 100,
      net_book_value: Math.round(netBookValue * 100) / 100,
    });
  }

  // Insert or update schedule
  for (const entry of schedule) {
    await supabaseAdmin
      .from('depreciation_schedules')
      .upsert(entry, { onConflict: 'asset_id,fiscal_year' });
  }

  // Update the asset's accumulated depreciation + NBV to the final values
  await supabaseAdmin
    .from('fixed_assets')
    .update({
      accumulated_depreciation: schedule[schedule.length - 1].accumulated_depreciation,
      net_book_value: schedule[schedule.length - 1].net_book_value,
    })
    .eq('id', req.params.id);

  return res.json({
    success: true,
    schedule,
    message: `Generated ${schedule.length} year depreciation schedule using ${method} method`,
  });
});

// ── Asset Transfers ──────────────────────────────────────────────
router.get('/transfers/all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fixed_asset_transfers')
    .select('*, fixed_assets(asset_code, asset_name, asset_category)')
    .order('transfer_date', { ascending: false });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/transfers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { assetId, fromDepartment, toDepartment, fromLocation, toLocation, transferDate, reason, propertyId } = req.body || {};
  if (!assetId || !toDepartment) {
    return res.status(400).json({ error: 'assetId and toDepartment are required' });
  }
  const { data, error } = await supabaseAdmin.from('fixed_asset_transfers').insert({
    asset_id: assetId,
    from_department: fromDepartment,
    to_department: toDepartment,
    from_location: fromLocation,
    to_location: toLocation,
    transfer_date: transferDate || new Date().toISOString().split('T')[0],
    reason,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/transfers/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, fromDepartment, toDepartment, fromLocation, toLocation, reason } = req.body || {};
  const update: Record<string, any> = {};
  if (status !== undefined) update.status = status;
  if (fromDepartment !== undefined) update.from_department = fromDepartment;
  if (toDepartment !== undefined) update.to_department = toDepartment;
  if (fromLocation !== undefined) update.from_location = fromLocation;
  if (toLocation !== undefined) update.to_location = toLocation;
  if (reason !== undefined) update.reason = reason;
  const { data, error } = await supabaseAdmin.from('fixed_asset_transfers').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/transfers/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fixed_asset_transfers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Asset Revaluations ───────────────────────────────────────────
router.get('/revaluations/all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fixed_asset_revaluations')
    .select('*, fixed_assets(asset_code, asset_name, asset_category)')
    .order('revaluation_date', { ascending: false });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/revaluations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { assetId, revaluationDate, originalValue, revaluedValue, reason, propertyId } = req.body || {};
  if (!assetId || revaluedValue === undefined) {
    return res.status(400).json({ error: 'assetId and revaluedValue are required' });
  }
  const orig = Number(originalValue) || 0;
  const reval = Number(revaluedValue);
  const changePercent = orig > 0 ? Math.round(((reval - orig) / orig) * 10000) / 100 : 0;
  const { data, error } = await supabaseAdmin.from('fixed_asset_revaluations').insert({
    asset_id: assetId,
    revaluation_date: revaluationDate || new Date().toISOString().split('T')[0],
    original_value: orig,
    revalued_value: reval,
    change_percent: changePercent,
    reason,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/revaluations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, revaluedValue, reason } = req.body || {};
  const update: Record<string, any> = {};
  if (status !== undefined) update.status = status;
  if (revaluedValue !== undefined) {
    update.revalued_value = Number(revaluedValue);
    const { data: rev } = await supabaseAdmin.from('fixed_asset_revaluations').select('original_value').eq('id', req.params.id).single();
    if (rev) {
      const orig = Number(rev.original_value);
      update.change_percent = orig > 0 ? Math.round(((Number(revaluedValue) - orig) / orig) * 10000) / 100 : 0;
    }
  }
  if (reason !== undefined) update.reason = reason;
  const { data, error } = await supabaseAdmin.from('fixed_asset_revaluations').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/revaluations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fixed_asset_revaluations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Asset Verifications ──────────────────────────────────────────
router.get('/verifications/all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fixed_asset_verifications')
    .select('*, fixed_assets(asset_code, asset_name, asset_category)')
    .order('verification_date', { ascending: false });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/verifications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { assetId, verificationDate, location, verifiedBy, condition, notes, propertyId } = req.body || {};
  if (!assetId) {
    return res.status(400).json({ error: 'assetId is required' });
  }
  const { data, error } = await supabaseAdmin.from('fixed_asset_verifications').insert({
    asset_id: assetId,
    verification_date: verificationDate || new Date().toISOString().split('T')[0],
    location,
    verified_by: verifiedBy,
    condition,
    notes,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/verifications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, condition, verifiedBy, location, notes } = req.body || {};
  const update: Record<string, any> = {};
  if (status !== undefined) update.status = status;
  if (condition !== undefined) update.condition = condition;
  if (verifiedBy !== undefined) update.verified_by = verifiedBy;
  if (location !== undefined) update.location = location;
  if (notes !== undefined) update.notes = notes;
  const { data, error } = await supabaseAdmin.from('fixed_asset_verifications').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/verifications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fixed_asset_verifications').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Asset Warranties ─────────────────────────────────────────────
router.get('/warranties/all', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('fixed_asset_warranties')
    .select('*, fixed_assets(asset_code, asset_name, asset_category)')
    .order('end_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/warranties', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { assetId, provider, startDate, endDate, coverage, contact, notes, propertyId } = req.body || {};
  if (!assetId || !provider) {
    return res.status(400).json({ error: 'assetId and provider are required' });
  }
  const { data, error } = await supabaseAdmin.from('fixed_asset_warranties').insert({
    asset_id: assetId,
    provider,
    start_date: startDate || new Date().toISOString().split('T')[0],
    end_date: endDate,
    coverage,
    contact,
    notes,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/warranties/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { provider, startDate, endDate, coverage, contact, notes } = req.body || {};
  const update: Record<string, any> = {};
  if (provider !== undefined) update.provider = provider;
  if (startDate !== undefined) update.start_date = startDate;
  if (endDate !== undefined) update.end_date = endDate;
  if (coverage !== undefined) update.coverage = coverage;
  if (contact !== undefined) update.contact = contact;
  if (notes !== undefined) update.notes = notes;
  const { data, error } = await supabaseAdmin.from('fixed_asset_warranties').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/warranties/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fixed_asset_warranties').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
