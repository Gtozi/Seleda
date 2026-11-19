import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { twinWriteProcRequisition } from '../services/procurementIntegration';
import { ENG_STORE_ID, MAIN_STORE_ID } from '../config/storeIds';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);

/** Shape a uinv_items + uinv_stock_balances row into the spare_parts response format. */
function shapeSparePartFromUinv(item: any, balance: any | null) {
  return {
    id: item.id,
    property_id: item.property_id || null,
    part_number: item.item_code || null,
    part_name: item.item_name,
    category: item.subcategory || 'Other',
    manufacturer: item.brand || null,
    supplier: item.brand || null,
    compatible_assets: [],
    unit: item.unit_of_measure || 'PCS',
    min_stock: Number(item.min_stock || 0),
    max_stock: item.max_stock ? Number(item.max_stock) : 0,
    current_stock: Number(balance?.on_hand || 0),
    unit_cost: Number(item.last_cost || 0),
    location: 'Engineering Store',
    reorder_qty: Number(item.reorder_point || 0) * 2 || 10,
    reorder_point: Number(item.reorder_point || 0),
    last_reorder_date: balance?.last_movement_date || null,
    updated_at: item.updated_at,
  };
}

/** Shape a uinv_stock_ledger row into the spare_parts_transactions response format. */
function shapeSparePartTxFromLedger(row: any) {
  const qtyIn = Number(row.quantity_in || 0);
  const qtyOut = Number(row.quantity_out || 0);
  return {
    id: row.id,
    property_id: row.property_id || null,
    part_id: row.item_id,
    transaction_type: row.transaction_type,
    quantity: Math.max(qtyIn, qtyOut),
    transaction_date: row.transaction_date,
    work_order: row.reference || null,
    technician: row.performed_by || null,
    notes: row.reason || null,
    created_by: row.performed_by || 'system',
    unit_cost: Number(row.unit_cost || 0),
    total_cost: Number(row.value || 0),
    performed_by: row.performed_by || 'system',
    reason: row.reason || '',
    reference_number: row.reference || null,
    waste_type: null,
    theoretical_qty: null,
    actual_qty: null,
  };
}

/** Map a spare_parts transaction type to a uinv_stock_ledger transaction type. */
function txTypeToLedgerType(txType: string): string {
  const map: Record<string, string> = {
    'Reserve': 'Reservation',
    'Issue': 'Issue',
    'Return': 'Return',
    'Consumption': 'Consumption',
    'Restock': 'Goods Receipt',
    'Waste': 'Waste',
    'Adjustment': 'Adjustment',
    'Stock Count': 'Stock Count',
  };
  return map[txType] || txType;
}


// [REMOVED] Phase 1 IoT/Predictive/Thermostat/SLA/OSHA/Sustainability routes (lines 16-1271).
// These ~1,260 lines queried 10 non-existent tables (assets, equipment, thermostats,
// safety_incidents, etc.) and had no frontend callers. The working Equipment Registry
// routes (fixed_assets) start below. See gap analysis for details.

// =====================
// Engineering & Maintenance API
// =====================
// Equipment Registry â€” fixed_assets CRUD (authenticate only, matching HK portal pattern)
router.get('/assets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('fixed_assets').select('*').order('created_at', { ascending: false });
  const { propertyId, category, status } = req.query;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (category && category !== 'All') q = q.eq('asset_category', category);
  if (status && status !== 'All') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/assets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    assetCode, assetName, assetCategory, description, location,
    purchaseDate, purchaseCost, salvageValue, usefulLifeYears,
    depreciationMethod, serialNumber, manufacturer, modelNumber,
    warrantyStart, warrantyEnd, warrantyProvider, criticality,
    parentAssetId, propertyId,
  } = req.body;
  if (!assetCode || !assetName) {
    return res.status(400).json({ error: 'assetCode and assetName are required' });
  }
  const { data, error } = await supabaseAdmin.from('fixed_assets')
    .insert({
      asset_code: assetCode, asset_name: assetName,
      asset_category: assetCategory || 'Other', description,
      location, purchase_date: purchaseDate || new Date().toISOString().split('T')[0],
      purchase_cost: purchaseCost || 0, salvage_value: salvageValue || 0,
      useful_life_years: usefulLifeYears || 10,
      depreciation_method: depreciationMethod || 'Straight Line',
      net_book_value: (purchaseCost || 0) - (salvageValue || 0),
      serial_number: serialNumber, manufacturer, model_number: modelNumber,
      warranty_start: warrantyStart, warranty_end: warrantyEnd,
      warranty_provider: warrantyProvider,
      criticality: criticality || 'Medium', parent_asset_id: parentAssetId,
      property_id: propertyId || null,
      status: 'Active',
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, asset: data });
});

router.patch('/assets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    assetCode, assetName, assetCategory, description, location,
    purchaseDate, purchaseCost, salvageValue, usefulLifeYears,
    depreciationMethod, serialNumber, manufacturer, modelNumber,
    warrantyStart, warrantyEnd, warrantyProvider, criticality,
    parentAssetId, propertyId, status,
  } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (assetCode !== undefined) updateData.asset_code = assetCode;
  if (assetName !== undefined) updateData.asset_name = assetName;
  if (assetCategory !== undefined) updateData.asset_category = assetCategory;
  if (description !== undefined) updateData.description = description;
  if (location !== undefined) updateData.location = location;
  if (purchaseDate !== undefined) updateData.purchase_date = purchaseDate;
  if (purchaseCost !== undefined) {
    updateData.purchase_cost = purchaseCost;
    updateData.net_book_value = (purchaseCost || 0) - (salvageValue ?? 0);
  }
  if (salvageValue !== undefined) {
    updateData.salvage_value = salvageValue;
    updateData.net_book_value = (purchaseCost ?? 0) - (salvageValue || 0);
  }
  if (usefulLifeYears !== undefined) updateData.useful_life_years = usefulLifeYears;
  if (depreciationMethod !== undefined) updateData.depreciation_method = depreciationMethod;
  if (serialNumber !== undefined) updateData.serial_number = serialNumber;
  if (manufacturer !== undefined) updateData.manufacturer = manufacturer;
  if (modelNumber !== undefined) updateData.model_number = modelNumber;
  if (warrantyStart !== undefined) updateData.warranty_start = warrantyStart;
  if (warrantyEnd !== undefined) updateData.warranty_end = warrantyEnd;
  if (warrantyProvider !== undefined) updateData.warranty_provider = warrantyProvider;
  if (criticality !== undefined) updateData.criticality = criticality;
  if (parentAssetId !== undefined) updateData.parent_asset_id = parentAssetId;
  if (propertyId !== undefined) updateData.property_id = propertyId;
  if (status !== undefined) updateData.status = status;
  const { data, error } = await supabaseAdmin.from('fixed_assets').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, asset: data });
});

router.delete('/assets/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('fixed_assets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// PM Schedules
router.get('/pm-schedules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('pm_schedules')
    .select('*, fixed_assets(asset_name, asset_code, location)')
    .order('next_due_date', { ascending: true });
  const { propertyId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/pm-schedules', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { scheduleName, assetId, frequency, intervalDays, nextDueDate, checklistTemplate, assignedTechnician, priority, propertyId } = req.body;
  const { data, error } = await supabaseAdmin.from('pm_schedules')
    .insert({
      schedule_name: scheduleName, asset_id: assetId || null, frequency: frequency || 'Monthly',
      interval_days: intervalDays || 30, next_due_date: nextDueDate,
      checklist_template: checklistTemplate || [], assigned_technician: assignedTechnician || null,
      priority: priority || 'Medium', status: 'Active',
      property_id: propertyId || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, schedule: data });
});

router.patch('/pm-schedules/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, nextDueDate, lastCompletedDate, assignedTechnician, priority, frequency, intervalDays, checklistTemplate } = req.body;
  const updateData: any = { updated_at: new Date().toISOString() };
  if (status) updateData.status = status;
  if (nextDueDate) updateData.next_due_date = nextDueDate;
  if (lastCompletedDate) updateData.last_completed_date = lastCompletedDate;
  if (assignedTechnician !== undefined) updateData.assigned_technician = assignedTechnician;
  if (priority !== undefined) updateData.priority = priority;
  if (frequency !== undefined) updateData.frequency = frequency;
  if (intervalDays !== undefined) updateData.interval_days = intervalDays;
  if (checklistTemplate !== undefined) updateData.checklist_template = checklistTemplate;
  const { data, error } = await supabaseAdmin.from('pm_schedules').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, schedule: data });
});

// DELETE /api/eng-portal/pm-schedules/:id
router.delete('/pm-schedules/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('pm_schedules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// Generate PM work orders
router.post('/generate-pm-work-orders', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.rpc('generate_pm_work_orders', { p_date: new Date().toISOString().split('T')[0] });
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, generated: data || [] });
});

// Work Orders
router.get('/work-orders', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    let query = supabaseAdmin.from('work_orders')
      .select('*, fixed_assets(asset_name, asset_code, location)');
    const { propertyId, status, assignedTo } = req.query;
    if (status) query = query.eq('status', status);
    if (assignedTo) query = query.eq('assigned_to', assignedTo);
    const { data, error } = await query.order('created_date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/work-orders', authenticate, async (req, res) => {
  const { title, description, assetId, type, priority, assignedTo, roomNumber, scheduledDate, checklist, sparePartsRequired, toolsRequired, estimatedCost } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const woId = crypto.randomUUID();
    const woNumber = `WO-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabaseAdmin.from('work_orders')
      .insert({
        id: woId, wo_number: woNumber, asset_id: assetId, title, description,
        type: type || 'Corrective', priority: priority || 'Medium', status: 'Open',
        assigned_to: assignedTo, room_number: roomNumber, scheduled_date: scheduledDate,
        checklist: checklist || [], created_by: req.user!.id,
        spare_parts_used: sparePartsRequired || [],
        notes: toolsRequired && toolsRequired.length > 0 ? `Tools required: ${toolsRequired.join(', ')}` : null,
        cost_estimate: estimatedCost || 0,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, workOrder: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/work-orders/:id', authenticate, async (req, res) => {
  const { status, completedChecklist, sparePartsUsed, sparePartsRequired, toolsRequired, laborHours, actualCost, notes, startedAt, assignedTo, priority, estimatedCost, checklist } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = {};
    if (status) updateData.status = status;
    if (completedChecklist !== undefined) updateData.completed_checklist = completedChecklist;
    if (sparePartsUsed !== undefined) updateData.spare_parts_used = sparePartsUsed;
    if (sparePartsRequired) updateData.spare_parts_used = sparePartsRequired;
    if (checklist !== undefined) updateData.checklist = checklist;
    if (laborHours !== undefined) updateData.labor_hours = laborHours;
    if (actualCost !== undefined) updateData.actual_cost = actualCost;
    if (estimatedCost !== undefined) updateData.cost_estimate = estimatedCost;
    if (notes !== undefined) updateData.notes = notes;
    if (startedAt) updateData.started_at = startedAt;
    if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
    if (priority !== undefined) updateData.priority = priority;
    if (toolsRequired !== undefined) {
      const existingNotes = typeof updateData.notes === 'string' ? updateData.notes : '';
      const toolsLine = toolsRequired.length > 0 ? `Tools required: ${toolsRequired.join(', ')}` : '';
      updateData.notes = [existingNotes, toolsLine].filter(Boolean).join('\n');
    }
    if (status === 'In Progress' && !startedAt) updateData.started_at = new Date().toISOString();
    if (status === 'Completed') updateData.completed_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin.from('work_orders').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // If completed and has room number, auto-release OOO/OOS room
    if (status === 'Completed' && data.room_number) {
      const { error: releaseError } = await supabaseAdmin.rpc('release_ooo_room', { p_wo_id: req.params.id });
      if (releaseError) console.error('OOO release failed:', releaseError.message);
    }

    // Sync status back to a linked transport maintenance request (if any).
    if (status !== undefined) {
      const TO_MR: Record<string, string> = {
        'Open': 'Pending', 'In Progress': 'In Progress',
        'Completed': 'Completed', 'Cancelled': 'Cancelled', 'On Hold': 'Scheduled',
      };
      const mrStatus = TO_MR[data.status] || null;
      if (mrStatus) {
        const mrPatch: any = { status: mrStatus, updated_at: new Date().toISOString() };
        if (data.status === 'Completed') mrPatch.completed_date = new Date().toISOString().slice(0, 10);
        if (data.actual_cost != null) mrPatch.actual_cost = data.actual_cost;
        supabaseAdmin.from('transport_maintenance_requests')
          .update(mrPatch)
          .eq('work_order_id', req.params.id)
          .then(({ error: mrErr }: any) => {
            if (mrErr) console.warn('[eng→transport] maintenance sync failed:', mrErr.message);
          });
      }
    }

    return res.json({ success: true, workOrder: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// DELETE /api/eng-portal/work-orders/:id
router.delete('/work-orders/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('work_orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Spare Parts ──────────────────────────────────────────────────────────
// Backs the /erp/maintenance/spare-parts tab (SparePartsInterface.tsx).
// Uses uinv_items (category='Engineering') + uinv_stock_balances (ENG store)
// + uinv_stock_ledger as the unified inventory source of truth.
// authenticate-only (no requirePermission) to match the HK portal pattern.

// GET /api/eng-portal/spare-parts — optional ?propertyId= ?category= ?status=
router.get('/spare-parts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, category } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('uinv_items')
    .select('*')
    .eq('category', 'Engineering')
    .eq('is_active', true)
    .order('item_name', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (category) q = q.eq('subcategory', category);
  const { data: items, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch stock balances for ENG store
  const itemIds = (items || []).map((i: any) => i.id);
  let balanceMap = new Map<string, any>();
  if (itemIds.length > 0) {
    const { data: balances } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('item_id, on_hand, unit_cost, last_movement_date')
      .eq('store_id', ENG_STORE_ID)
      .in('item_id', itemIds);
    for (const b of (balances || [])) {
      balanceMap.set(b.item_id, b);
    }
  }

  return res.json((items || []).map((item: any) => shapeSparePartFromUinv(item, balanceMap.get(item.id) || null)));
});

// POST /api/eng-portal/spare-parts
router.post('/spare-parts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, partNumber, partName, category, manufacturer, supplier, unit, minStock, maxStock, currentStock, unitCost, location, reorderQty, reorderPoint } = req.body || {};
  if (!partName) return res.status(400).json({ error: 'partName is required' });

  const { data: item, error: itemError } = await supabaseAdmin.from('uinv_items').insert({
    property_id: propertyId || null,
    item_code: partNumber || `ENG-${Date.now()}`,
    item_name: partName,
    category: 'Engineering',
    subcategory: category || 'Other',
    item_type: 'Consumable',
    brand: manufacturer || supplier || null,
    unit_of_measure: unit || 'PCS',
    min_stock: minStock || 5,
    max_stock: maxStock || 50,
    reorder_point: reorderPoint || minStock || 5,
    safety_stock: 0,
    par_level: (reorderPoint || minStock || 5) * 2,
    default_store_id: ENG_STORE_ID,
    costing_method: 'Weighted Average',
    last_cost: unitCost || 0,
    avg_cost: unitCost || 0,
    standard_cost: unitCost || 0,
    is_active: true,
  }).select('*').single();
  if (itemError) return res.status(500).json({ error: itemError.message });

  // Create initial stock balance if currentStock > 0
  const initQty = Math.max(0, Number(currentStock || 0));
  if (initQty > 0) {
    const balanceId = `UINV-SB-ENG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await supabaseAdmin.from('uinv_stock_balances').insert({
      id: balanceId,
      property_id: propertyId || null,
      item_id: item.id,
      store_id: ENG_STORE_ID,
      location_id: null,
      on_hand: initQty,
      reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
      damaged: 0, quarantined: 0, expired: 0,
      status: 'Available',
      unit_cost: unitCost || 0,
      last_movement_date: new Date().toISOString(),
    });
  }

  cacheService.invalidate('eng-*');
  return res.status(201).json(shapeSparePartFromUinv(item, { on_hand: initQty, unit_cost: unitCost || 0, last_movement_date: null }));
});

// PATCH /api/eng-portal/spare-parts/:id
router.patch('/spare-parts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { partNumber, partName, category, manufacturer, supplier, unit, minStock, maxStock, currentStock, unitCost, location, reorderQty, reorderPoint, lastReorderDate } = req.body || {};
  const updates: any = {};
  if (partNumber !== undefined) updates.item_code = partNumber;
  if (partName !== undefined) updates.item_name = partName;
  if (category !== undefined) updates.subcategory = category;
  if (manufacturer !== undefined) updates.brand = manufacturer;
  if (supplier !== undefined) updates.brand = supplier;
  if (unit !== undefined) updates.unit_of_measure = unit;
  if (minStock !== undefined) updates.min_stock = minStock;
  if (maxStock !== undefined) updates.max_stock = maxStock;
  if (unitCost !== undefined) { updates.last_cost = unitCost; updates.avg_cost = unitCost; updates.standard_cost = unitCost; }
  if (reorderPoint !== undefined) { updates.reorder_point = reorderPoint; updates.par_level = Number(reorderPoint) * 2; }
  updates.updated_at = new Date().toISOString();

  const { data: item, error: itemError } = await supabaseAdmin.from('uinv_items').update(updates).eq('id', req.params.id).select('*').single();
  if (itemError) return res.status(500).json({ error: itemError.message });
  if (!item) return res.status(404).json({ error: 'Spare part not found' });

  // If currentStock is provided, update the stock balance
  let balance: any = null;
  if (currentStock !== undefined) {
    const { data: bal } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost, last_movement_date')
      .eq('item_id', item.id)
      .eq('store_id', ENG_STORE_ID)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bal) {
      await supabaseAdmin.from('uinv_stock_balances').update({
        on_hand: Math.max(0, Number(currentStock) || 0),
        updated_at: new Date().toISOString(),
      }).eq('id', bal.id);
      balance = { ...bal, on_hand: Number(currentStock) || 0 };
    }
  } else {
    const { data: bal } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost, last_movement_date')
      .eq('item_id', item.id)
      .eq('store_id', ENG_STORE_ID)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    balance = bal;
  }

  cacheService.invalidate('eng-*');
  return res.json({ success: true, sparePart: shapeSparePartFromUinv(item, balance) });
});

// DELETE /api/eng-portal/spare-parts/:id
router.delete('/spare-parts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  // Soft-delete: mark as inactive (preserves ledger history)
  const { error } = await supabaseAdmin.from('uinv_items').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Spare Parts Transactions (HK-inspired, maintenance-optimized) ───────
// Backs the /erp/maintenance/spare-parts tab transaction log.
// Transaction types: Reserve / Issue / Return / Consumption / Restock /
//                    Waste / Adjustment / Stock Count
// Stock deltas:
//   Reserve/Issue/Consumption/Waste → decrease
//   Return/Restock                  → increase
//   Adjustment                       → signed delta
//   Stock Count                      → set to actual_qty, log variance

// Central stock adjustment function — uses uinv_stock_balances + uinv_stock_ledger.
// Returns a typed result so callers can surface warnings.
type SparePartStockResult =
  | { ok: true; itemId: string; newQuantity: number; transactionId: string }
  | { ok: false; reason: string; warning?: string };

async function adjustSparePartStock(
  partId: string,
  transactionType: string,
  qty: number,
  opts: {
    propertyId?: string;
    workOrder?: string;
    technician?: string;
    notes?: string;
    referenceNumber?: string;
    wasteType?: string;
    theoreticalQty?: number;
    actualQty?: number;
    performedBy?: string;
  } = {}
): Promise<SparePartStockResult> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return { ok: false, reason: 'DB not configured' };
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, reason: 'invalid quantity' };

  // Fetch the stock balance for this item in the ENG store
  const { data: balance, error: fetchErr } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('id, on_hand, unit_cost, property_id, item_id')
    .eq('item_id', partId)
    .eq('store_id', ENG_STORE_ID)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fetchErr) return { ok: false, reason: fetchErr.message };
  if (!balance) return { ok: false, reason: 'Part not found in Engineering store' };

  const currentStock = Number(balance.on_hand) || 0;
  const unitCost = Number(balance.unit_cost) || 0;
  let newStock: number;
  let loggedQty: number;
  let qtyIn = 0;
  let qtyOut = 0;

  if (transactionType === 'Stock Count') {
    const actual = opts.actualQty !== undefined ? Number(opts.actualQty) : currentStock;
    newStock = Math.max(0, actual);
    loggedQty = Math.abs(actual - currentStock);
    if (actual > currentStock) qtyIn = loggedQty; else qtyOut = loggedQty;
  } else if (transactionType === 'Adjustment') {
    newStock = Math.max(0, currentStock + qty);
    loggedQty = Math.abs(qty);
    if (qty > 0) qtyIn = loggedQty; else qtyOut = loggedQty;
  } else {
    const decreases = ['Reserve', 'Issue', 'Consumption', 'Waste'];
    const increases = ['Return', 'Restock'];
    const signedDelta = increases.includes(transactionType) ? qty : -qty;
    newStock = Math.max(0, currentStock + signedDelta);
    loggedQty = qty;
    if (signedDelta > 0) qtyIn = qty; else qtyOut = qty;
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from('uinv_stock_balances')
    .update({ on_hand: newStock, last_movement_date: now, updated_at: now })
    .eq('id', balance.id);
  if (updateErr) return { ok: false, reason: updateErr.message };

  // Log to uinv_stock_ledger
  const ledgerType = txTypeToLedgerType(transactionType);
  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin.from('uinv_stock_ledger').insert({
    property_id: opts.propertyId || balance.property_id || null,
    item_id: partId,
    store_id: ENG_STORE_ID,
    transaction_type: ledgerType,
    reference: opts.referenceNumber || opts.workOrder || null,
    quantity_in: qtyIn,
    quantity_out: qtyOut,
    balance: newStock,
    unit_cost: unitCost,
    value: loggedQty * unitCost,
    performed_by: opts.performedBy || opts.technician || 'system',
    reason: opts.notes || `${transactionType} — ${loggedQty}`,
    transaction_date: now,
  }).select().single();
  if (ledgerErr) return { ok: false, reason: ledgerErr.message };

  cacheService.invalidate('eng-*');
  return { ok: true, itemId: partId, newQuantity: newStock, transactionId: ledgerRow.id };
}

// GET /api/eng-portal/spare-parts-transactions — optional ?propertyId= ?partId=
router.get('/spare-parts-transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin
    .from('uinv_stock_ledger')
    .select('*')
    .eq('store_id', ENG_STORE_ID)
    .order('transaction_date', { ascending: false });
  const { propertyId, partId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (partId) q = q.eq('item_id', partId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map(shapeSparePartTxFromLedger));
});

// POST /api/eng-portal/spare-parts-transactions
// Universal transaction endpoint — handles all 8 transaction types.
router.post('/spare-parts-transactions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, partId, transactionType, quantity, workOrder, technician, notes, referenceNumber, wasteType, theoreticalQty, actualQty } = req.body || {};
  if (!partId || !transactionType) return res.status(400).json({ error: 'partId and transactionType are required' });
  const validTypes = ['Reserve', 'Issue', 'Return', 'Consumption', 'Restock', 'Waste', 'Adjustment', 'Stock Count'];
  if (!validTypes.includes(transactionType)) return res.status(400).json({ error: `Invalid transactionType: ${transactionType}` });
  if (transactionType === 'Waste' && !wasteType) return res.status(400).json({ error: 'wasteType is required for Waste transactions' });
  if (transactionType === 'Stock Count' && actualQty === undefined) return res.status(400).json({ error: 'actualQty is required for Stock Count' });
  const qty = transactionType === 'Stock Count' ? 0 : Math.abs(Number(quantity) || 0);
  if (transactionType !== 'Stock Count' && qty <= 0) return res.status(400).json({ error: 'quantity must be positive' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';
  const result = await adjustSparePartStock(partId, transactionType, qty, {
    propertyId, workOrder, technician, notes, referenceNumber, wasteType,
    theoreticalQty, actualQty, performedBy,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason, warning: result.warning });
  // Fetch the created ledger row to return.
  const { data: tx } = await supabaseAdmin.from('uinv_stock_ledger').select('*').eq('id', result.transactionId).single();
  return res.status(201).json(shapeSparePartTxFromLedger(tx));
});

// POST /api/eng-portal/spare-parts/:id/waste
// Dedicated waste endpoint (maintenance-optimized: parts get damaged/expired).
router.post('/spare-parts/:id/waste', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { wasteType, quantity, reason, referenceNumber } = req.body || {};
  if (!wasteType) return res.status(400).json({ error: 'wasteType is required' });
  const validWasteTypes = ['damaged', 'expired', 'lost', 'obsolete', 'other'];
  if (!validWasteTypes.includes(wasteType)) return res.status(400).json({ error: `Invalid wasteType: ${wasteType}` });
  const qty = Math.abs(Number(quantity) || 0);
  if (qty <= 0) return res.status(400).json({ error: 'quantity must be positive' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';
  const result = await adjustSparePartStock(req.params.id, 'Waste', qty, {
    wasteType, notes: reason, referenceNumber, performedBy,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const { data: tx } = await supabaseAdmin.from('uinv_stock_ledger').select('*').eq('id', result.transactionId).single();
  return res.status(201).json(shapeSparePartTxFromLedger(tx));
});

// POST /api/eng-portal/spare-parts/:id/restock
// Dedicated restock endpoint with supplier PO reference.
router.post('/spare-parts/:id/restock', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { quantity, referenceNumber, supplier, notes } = req.body || {};
  const qty = Math.abs(Number(quantity) || 0);
  if (qty <= 0) return res.status(400).json({ error: 'quantity must be positive' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';
  // Update supplier (brand) if provided.
  if (supplier) {
    await supabaseAdmin.from('uinv_items').update({ brand: supplier, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  }
  const result = await adjustSparePartStock(req.params.id, 'Restock', qty, {
    referenceNumber, notes, performedBy,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const { data: tx } = await supabaseAdmin.from('uinv_stock_ledger').select('*').eq('id', result.transactionId).single();
  return res.status(201).json(shapeSparePartTxFromLedger(tx));
});

// POST /api/eng-portal/spare-parts/:id/stock-count
// Stock count reconciliation — sets actual stock and logs variance.
router.post('/spare-parts/:id/stock-count', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { actualQty, notes } = req.body || {};
  if (actualQty === undefined || actualQty === null) return res.status(400).json({ error: 'actualQty is required' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';
  const result = await adjustSparePartStock(req.params.id, 'Stock Count', 0, {
    actualQty: Number(actualQty), notes, performedBy,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const { data: tx } = await supabaseAdmin.from('uinv_stock_ledger').select('*').eq('id', result.transactionId).single();
  return res.status(201).json(shapeSparePartTxFromLedger(tx));
});

// GET /api/eng-portal/spare-parts/reorder-recommendations?propertyId=
// Returns parts at or below reorder_point with suggested order quantities and costs.
router.get('/spare-parts/reorder-recommendations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('uinv_items')
    .select('*')
    .eq('category', 'Engineering')
    .eq('is_active', true)
    .order('item_name', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data: items, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch ENG store balances
  const itemIds = (items || []).map((i: any) => i.id);
  let balanceMap = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data: balances } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('item_id, on_hand')
      .eq('store_id', ENG_STORE_ID)
      .in('item_id', itemIds);
    for (const b of (balances || [])) {
      balanceMap.set(b.item_id, (balanceMap.get(b.item_id) || 0) + Number(b.on_hand));
    }
  }

  const recommendations = (items || [])
    .filter((i: any) => (balanceMap.get(i.id) || 0) <= (Number(i.reorder_point) || Number(i.min_stock) || 0))
    .map((i: any) => {
      const current = balanceMap.get(i.id) || 0;
      const reorderPoint = Number(i.reorder_point) || Number(i.min_stock) || 0;
      const reorderQty = Number(i.reorder_point || 0) * 2 || 10;
      const suggestedQty = Math.max(reorderQty, reorderPoint * 2 - current);
      const unitCost = Number(i.last_cost || 0);
      return {
        id: i.id,
        partName: i.item_name,
        partNumber: i.item_code,
        category: i.subcategory || 'Other',
        currentStock: current,
        reorderPoint,
        minStock: Number(i.min_stock || 0),
        suggestedOrderQuantity: suggestedQty,
        estimatedCost: suggestedQty * unitCost,
        unitCost,
        supplier: i.brand,
        location: 'Engineering Store',
      };
    });
  return res.json(recommendations);
});

// DELETE /api/eng-portal/spare-parts-transactions/:id
router.delete('/spare-parts-transactions/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  // Soft-delete: ledger entries should be preserved for audit.
  // Instead of deleting, return success (ledger is immutable).
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Spare Parts Requisitions ─────────────────────────────────────────────
// Uses uinv_issues with source='Requisition' and department='Engineering'.
// Workflow: pending → approved → issued (moves stock from Main Warehouse to
// ENG store via uinv_stock_balances + uinv_stock_ledger) | rejected.
// Backs the Requisitions tab in SparePartsInterface.tsx.

// GET /api/eng-portal/spare-parts/main-store-items — items available to request
router.get('/spare-parts/main-store-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: balances, error: balError } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('item_id, on_hand, unit_cost, item:uinv_items(id, item_name, unit_of_measure, is_active)')
    .eq('store_id', MAIN_STORE_ID)
    .gt('on_hand', 0)
    .limit(200);
  if (balError) return res.status(500).json({ error: balError.message });

  const items = (balances || [])
    .filter((b: any) => b.item && b.item.is_active)
    .map((b: any) => ({
      id: b.item.id,
      name: b.item.item_name,
      currentQuantity: Number(b.on_hand || 0),
      unitOfMeasure: b.item.unit_of_measure || '',
      unitCost: Number(b.unit_cost || 0),
    }));
  return res.json({ items });
});

// GET /api/eng-portal/spare-parts/requisitions?propertyId=
router.get('/spare-parts/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin
    .from('uinv_issues')
    .select('*, store:uinv_stores(*)')
    .eq('department', 'Engineering')
    .order('created_at', { ascending: false })
    .limit(100);
  const { propertyId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data || []).map((r: any) => ({
    id: r.id,
    number: r.issue_number,
    department: r.department,
    requestedBy: r.requester,
    requestDate: r.created_at ? String(r.created_at).slice(0, 10) : '',
    fromLocation: 'Main Store',
    toLocation: r.store?.store_name || 'Engineering Store',
    status: r.approval_status === 'Issued' ? 'completed' :
            r.approval_status === 'Rejected' ? 'rejected' :
            r.approval_status === 'Approved' ? 'approved' :
            r.approval_status?.toLowerCase() || 'pending',
    totalCost: (r.lines || []).reduce((sum: number, l: any) => sum + Number(l.issuedQty || l.requestedQty || 0) * Number(l.unitCost || l.cost || 0), 0),
    notes: r.notes,
    items: (r.lines || []).map((l: any, idx: number) => ({
      id: `${r.id}-line-${idx}`,
      itemId: l.itemId,
      itemName: l.itemName,
      requestedQuantity: Number(l.requestedQty || 0),
      approvedQuantity: l.approvedQty !== undefined ? Number(l.approvedQty) : null,
      unit: l.unit || 'PCS',
      unitCost: Number(l.unitCost || l.cost || 0),
      reason: l.notes || null,
    })),
  }));
  return res.json({ requisitions: result });
});

// POST /api/eng-portal/spare-parts/requisitions — create a requisition
router.post('/spare-parts/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, requestedBy, notes, items } = req.body || {};
  if (!propertyId || !requestedBy) return res.status(400).json({ error: 'propertyId and requestedBy are required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

  const { count } = await supabaseAdmin
    .from('uinv_issues')
    .select('id', { count: 'exact', head: true })
    .like('issue_number', 'ENG-REQ-%');
  const issueNumber = `ENG-REQ-${String((count || 0) + 1).padStart(6, '0')}`;

  const lines = items.map((it: any) => ({
    itemId: it.itemId,
    itemName: it.itemName,
    requestedQty: Number(it.requestedQuantity || 0),
    approvedQty: null,
    issuedQty: 0,
    unit: it.unit || 'PCS',
    unitCost: Number(it.unitCost || 0),
    cost: Number(it.unitCost || 0),
    notes: it.reason || null,
  }));

  const totalCost = lines.reduce((sum: number, l: any) => sum + l.requestedQty * l.unitCost, 0);

  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .insert({
      property_id: propertyId,
      issue_number: issueNumber,
      department: 'Engineering',
      requester: requestedBy,
      priority: 'Normal',
      approval_status: 'Pending',
      source: 'Requisition',
      store_id: ENG_STORE_ID,
      lines,
      notes: notes || null,
      created_by: isUuid(req.user?.id) ? req.user!.id : requestedBy,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ id: data.id, number: data.issue_number, status: data.approval_status, totalCost });
});

// PUT /api/eng-portal/spare-parts/requisitions/:id/approve
router.put('/spare-parts/requisitions/:id/approve', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { approvedQuantities } = req.body || {};

  const { data: existing } = await supabaseAdmin
    .from('uinv_issues')
    .select('lines')
    .eq('id', req.params.id)
    .single();

  let updatedLines = existing?.lines || [];
  if (Array.isArray(approvedQuantities)) {
    updatedLines = updatedLines.map((line: any, idx: number) => {
      const aq = approvedQuantities.find((a: any) => a.id === `${req.params.id}-line-${idx}` || a.lineIndex === idx);
      if (aq) return { ...line, approvedQty: Number(aq.approvedQuantity) };
      return line;
    });
  }

  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .update({ approval_status: 'Approved', lines: updatedLines, approved_by: req.user?.name || 'system', approved_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: data.id, status: data.approval_status });
});

// PUT /api/eng-portal/spare-parts/requisitions/:id/issue
// Issues a requisition: moves stock from Main Warehouse to ENG store.
router.put('/spare-parts/requisitions/:id/issue', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: reqRow, error: reqError } = await supabaseAdmin
    .from('uinv_issues')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (reqError) return res.status(500).json({ error: reqError.message });
  if (!reqRow) return res.status(404).json({ error: 'Requisition not found' });
  if (reqRow.approval_status !== 'Approved') return res.status(400).json({ error: `Requisition must be approved first (current: ${reqRow.approval_status})` });

  const propertyId = reqRow.property_id;
  if (!propertyId) return res.status(400).json({ error: 'Requisition has no property_id' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';
  const now = new Date().toISOString();

  for (const line of (reqRow.lines || [])) {
    const issueQty = line.approvedQty !== null && line.approvedQty !== undefined
      ? Number(line.approvedQty)
      : Number(line.requestedQty || 0);
    if (issueQty <= 0) continue;

    const itemId = line.itemId;
    if (!itemId) continue;

    // Deduct from Main Warehouse
    const { data: mainBalance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', itemId)
      .eq('store_id', MAIN_STORE_ID)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mainBalance) {
      const newMainQty = Math.max(0, Number(mainBalance.on_hand) - issueQty);
      await supabaseAdmin.from('uinv_stock_balances').update({
        on_hand: newMainQty, last_movement_date: now, updated_at: now,
      }).eq('id', mainBalance.id);

      await supabaseAdmin.from('uinv_stock_ledger').insert({
        property_id: propertyId,
        item_id: itemId,
        store_id: MAIN_STORE_ID,
        transaction_type: 'Transfer Out',
        reference: `Req ${reqRow.issue_number}: Main → ENG`,
        quantity_in: 0,
        quantity_out: issueQty,
        balance: newMainQty,
        unit_cost: Number(mainBalance.unit_cost || 0),
        value: issueQty * Number(mainBalance.unit_cost || 0),
        performed_by: performedBy,
        reason: `Requisition ${reqRow.issue_number} issued to Engineering`,
        transaction_date: now,
      });
    }

    // Add to ENG store
    const { data: engBalance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', itemId)
      .eq('store_id', ENG_STORE_ID)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (engBalance) {
      const newEngQty = Number(engBalance.on_hand) + issueQty;
      await supabaseAdmin.from('uinv_stock_balances').update({
        on_hand: newEngQty, last_movement_date: now, updated_at: now,
      }).eq('id', engBalance.id);
    } else {
      const newBalanceId = `UINV-SB-ENG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await supabaseAdmin.from('uinv_stock_balances').insert({
        id: newBalanceId,
        property_id: propertyId,
        item_id: itemId,
        store_id: ENG_STORE_ID,
        location_id: null,
        on_hand: issueQty,
        reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
        damaged: 0, quarantined: 0, expired: 0,
        status: 'Available',
        unit_cost: Number(mainBalance?.unit_cost || line.unitCost || 0),
        last_movement_date: now,
      });
    }

    // Log ENG in
    await supabaseAdmin.from('uinv_stock_ledger').insert({
      property_id: propertyId,
      item_id: itemId,
      store_id: ENG_STORE_ID,
      transaction_type: 'Transfer In',
      reference: `Req ${reqRow.issue_number}: Main → ENG`,
      quantity_in: issueQty,
      quantity_out: 0,
      balance: Number(engBalance?.on_hand || 0) + issueQty,
      unit_cost: Number(mainBalance?.unit_cost || line.unitCost || 0),
      value: issueQty * Number(mainBalance?.unit_cost || line.unitCost || 0),
      performed_by: performedBy,
      reason: `Requisition ${reqRow.issue_number} received from Main`,
      transaction_date: now,
    });
  }

  // Mark requisition as Issued
  const { error: updateError } = await supabaseAdmin
    .from('uinv_issues')
    .update({ approval_status: 'Issued', issued_by: req.user?.name || 'system', issued_at: now })
    .eq('id', req.params.id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  cacheService.invalidate('eng-*');
  return res.json({ success: true, id: req.params.id, status: 'Issued' });
});

// PUT /api/eng-portal/spare-parts/requisitions/:id/reject
router.put('/spare-parts/requisitions/:id/reject', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('uinv_issues')
    .update({ approval_status: 'Rejected' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: data.id, status: data.approval_status });
});

// ── Tools Registry & Checkout ────────────────────────────────────────────
// Backs the "Tools" sub-tab of the /erp/maintenance/spare-parts tab
// (renamed "Spare Parts & Tools"). Tools are durable, trackable assets —
// each tool is a unique item with a status lifecycle and a checkout/return
// history to technicians.
// Uses eng_tools + eng_tool_checkouts (migration 344).
// authenticate-only (no requirePermission) to match the HK portal pattern.
//
// Tool status lifecycle:
//   Available → Checked Out → Available (return)
//   Available → In Repair → Available
//   Available → Lost | Retired (terminal)
//
// Checkout workflow:
//   Active (checked out) → Returned
//   Overdue is auto-derived: Active rows past expected_return_at.

// GET /api/eng-portal/tools — optional ?propertyId= ?status= ?category=
router.get('/tools', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_tools').select('*').order('tool_name', { ascending: true });
  const { propertyId, status, category } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/tools
router.post('/tools', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    propertyId, toolNumber, toolName, category, manufacturer, model,
    serialNumber, location, status, condition, assignedTo, purchaseDate,
    purchaseCost, calibrationDueDate, notes,
  } = req.body || {};
  if (!toolName || !toolNumber) return res.status(400).json({ error: 'toolNumber and toolName are required' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';
  const { data, error } = await supabaseAdmin.from('eng_tools').insert({
    id: `ENG-TL-${Date.now()}`,
    property_id: propertyId || null,
    tool_number: toolNumber,
    tool_name: toolName,
    category, manufacturer, model, serial_number: serialNumber, location,
    status: status || 'Available',
    condition: condition || 'Good',
    assigned_to: assignedTo || null,
    purchase_date: purchaseDate || null,
    purchase_cost: purchaseCost || 0,
    calibration_due_date: calibrationDueDate || null,
    notes,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/tools/:id — update tool fields / status
router.patch('/tools/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const {
    toolNumber, toolName, category, manufacturer, model, serialNumber,
    location, status, condition, assignedTo, purchaseDate, purchaseCost,
    calibrationDueDate, notes,
  } = req.body || {};
  const updateData: any = {};
  if (toolNumber !== undefined) updateData.tool_number = toolNumber;
  if (toolName !== undefined) updateData.tool_name = toolName;
  if (category !== undefined) updateData.category = category;
  if (manufacturer !== undefined) updateData.manufacturer = manufacturer;
  if (model !== undefined) updateData.model = model;
  if (serialNumber !== undefined) updateData.serial_number = serialNumber;
  if (location !== undefined) updateData.location = location;
  if (status !== undefined) updateData.status = status;
  if (condition !== undefined) updateData.condition = condition;
  if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
  if (purchaseDate !== undefined) updateData.purchase_date = purchaseDate;
  if (purchaseCost !== undefined) updateData.purchase_cost = purchaseCost;
  if (calibrationDueDate !== undefined) updateData.calibration_due_date = calibrationDueDate;
  if (notes !== undefined) updateData.notes = notes;
  const { data, error } = await supabaseAdmin.from('eng_tools').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, tool: data });
});

// DELETE /api/eng-portal/tools/:id
router.delete('/tools/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_tools').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// POST /api/eng-portal/tools/:id/checkout
// Checks a tool out to a technician: sets tool status=Checked Out,
// assigned_to=technician, and creates an Active eng_tool_checkouts row.
router.post('/tools/:id/checkout', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { technician, workOrder, expectedReturnAt, notes, propertyId } = req.body || {};
  if (!technician) return res.status(400).json({ error: 'technician is required' });
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';

  const { data: tool, error: fetchErr } = await supabaseAdmin
    .from('eng_tools').select('id, status, property_id').eq('id', req.params.id).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  if (tool.status !== 'Available') return res.status(400).json({ error: `Tool is ${tool.status}, cannot check out` });

  const now = new Date().toISOString();
  const { error: toolUpdErr } = await supabaseAdmin.from('eng_tools')
    .update({ status: 'Checked Out', assigned_to: technician, updated_at: now })
    .eq('id', req.params.id);
  if (toolUpdErr) return res.status(500).json({ error: toolUpdErr.message });

  const { data: coRow, error: coErr } = await supabaseAdmin.from('eng_tool_checkouts').insert({
    property_id: propertyId || tool.property_id || null,
    tool_id: req.params.id,
    technician,
    work_order: workOrder || null,
    checked_out_at: now,
    expected_return_at: expectedReturnAt || null,
    status: 'Active',
    checkout_notes: notes || null,
    created_by: performedBy,
  }).select().single();
  if (coErr) return res.status(500).json({ error: coErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, checkout: coRow });
});

// POST /api/eng-portal/tools/:id/return
// Returns a checked-out tool: closes the Active checkout row, sets tool
// status back to Available, clears assigned_to.
router.post('/tools/:id/return', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { notes, condition } = req.body || {};
  const performedBy = (req.user?.id && isUuid(req.user.id)) ? req.user.id : 'system';

  const { data: tool, error: fetchErr } = await supabaseAdmin
    .from('eng_tools').select('id, status').eq('id', req.params.id).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  if (tool.status !== 'Checked Out') return res.status(400).json({ error: `Tool is ${tool.status}, cannot return` });

  const now = new Date().toISOString();
  const toolUpdate: any = { status: 'Available', assigned_to: null, updated_at: now };
  if (condition) toolUpdate.condition = condition;
  const { error: toolUpdErr } = await supabaseAdmin.from('eng_tools').update(toolUpdate).eq('id', req.params.id);
  if (toolUpdErr) return res.status(500).json({ error: toolUpdErr.message });

  const { data: coRow, error: coErr } = await supabaseAdmin.from('eng_tool_checkouts')
    .update({ status: 'Returned', returned_at: now, return_notes: notes || null })
    .eq('tool_id', req.params.id)
    .eq('status', 'Active')
    .select()
    .single();
  if (coErr) return res.status(500).json({ error: coErr.message });

  cacheService.invalidate('eng-*');
  return res.json({ success: true, checkout: coRow });
});

// GET /api/eng-portal/tool-checkouts — optional ?propertyId= ?toolId= ?status= ?technician=
// Overdue is auto-derived: Active rows past expected_return_at are flipped
// to Overdue server-side on each GET.
router.get('/tool-checkouts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const nowIso = new Date().toISOString();
  // Flip overdue: Active rows past expected_return_at → Overdue.
  await supabaseAdmin.from('eng_tool_checkouts')
    .update({ status: 'Overdue' })
    .eq('status', 'Active')
    .lt('expected_return_at', nowIso);

  let q = supabaseAdmin.from('eng_tool_checkouts').select('*').order('checked_out_at', { ascending: false });
  const { propertyId, toolId, status, technician } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (toolId) q = q.eq('tool_id', toolId);
  if (status) q = q.eq('status', status);
  if (technician) q = q.eq('technician', technician);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// DELETE /api/eng-portal/tool-checkouts/:id
router.delete('/tool-checkouts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_tool_checkouts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Supply & Procurement ───────────────────────────────────────────────
// Mirrors the HK Supply & Procurement pattern. Backs the
// /erp/maintenance/vendor-contractor tab (SupplyProcurementModule.tsx).
// Uses eng_purchase_orders + eng_purchase_order_lines + shared fb_suppliers.

// Map eng_purchase_orders.status to the UI requisition status.
function engPoStatusToRequisitionStatus(status: string): string {
  switch (status) {
    case 'draft': return 'draft';
    case 'submitted': return 'submitted';
    case 'acknowledged': return 'approved';
    case 'partial': return 'processing';
    case 'received': return 'processing';
    case 'closed': return 'approved';
    case 'cancelled': return 'rejected';
    default: return status;
  }
}

// GET /api/eng-portal/supply-procurement/forecast
// Returns unified Engineering items at/below reorder point — the Engineering
// replenishment demand. Each row includes shortage and any linked PO.
router.get('/supply-procurement/forecast', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { propertyId } = req.query as Record<string, string>;
    let q = supabaseAdmin
      .from('uinv_items')
      .select('*')
      .eq('category', 'Engineering')
      .eq('is_active', true);
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data: items, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Fetch ENG store balances
    const itemIds = (items || []).map((i: any) => i.id);
    let balanceMap = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data: balances } = await supabaseAdmin
        .from('uinv_stock_balances')
        .select('item_id, on_hand')
        .eq('store_id', ENG_STORE_ID)
        .in('item_id', itemIds);
      for (const b of (balances || [])) {
        balanceMap.set(b.item_id, (balanceMap.get(b.item_id) || 0) + Number(b.on_hand));
      }
    }

    // Fetch recent eng POs to link back.
    let poQ = supabaseAdmin.from('eng_purchase_orders').select('id, po_number, status, created_at').order('created_at', { ascending: false });
    if (propertyId) poQ = poQ.eq('property_id', propertyId);
    const { data: pos } = await poQ;
    const recentPoByPartName: Record<string, { po_number: string; status: string }> = {};
    if (pos && pos.length > 0) {
      const poIds = pos.map((p: any) => p.id);
      const { data: lines } = await supabaseAdmin
        .from('eng_purchase_order_lines').select('po_id, description').in('po_id', poIds);
      (lines || []).forEach((l: any) => {
        const name = (l.description || '').toLowerCase().trim();
        if (name && !recentPoByPartName[name]) {
          const po = pos.find((p: any) => p.id === l.po_id);
          if (po) recentPoByPartName[name] = { po_number: po.po_number, status: engPoStatusToRequisitionStatus(po.status) };
        }
      });
    }

    const rows = (items || [])
      .filter((i: any) => {
        const cur = balanceMap.get(i.id) || 0;
        const reorder = Number(i.reorder_point) || Number(i.min_stock) || 0;
        return cur <= reorder;
      })
      .map((i: any) => {
        const cur = balanceMap.get(i.id) || 0;
        const max = Number(i.max_stock) || 0;
        const reorderQty = (max > cur ? max - cur : 0) || (Number(i.reorder_point || 0) * 2);
        const linked = recentPoByPartName[(i.item_name || '').toLowerCase().trim()];
        return {
          id: i.id,
          part_name: i.item_name,
          part_number: i.item_code || '',
          category: i.subcategory || 'General',
          unit: i.unit_of_measure || 'pcs',
          current_stock: cur,
          reorder_point: Number(i.reorder_point) || Number(i.min_stock) || 0,
          shortage: Math.max(0, reorderQty),
          reorder_qty: reorderQty,
          unit_cost: Number(i.last_cost || 0),
          supplier: i.brand || '',
          requisition_id: linked?.po_number || null,
          requisition_status: linked?.status || null,
        };
      });

    return res.json(rows);
  } catch (err) {
    console.error('supply-procurement/forecast error:', err);
    return res.status(500).json({ error: 'Failed to load replenishment demand' });
  }
});

// GET /api/eng-portal/supply-procurement/requisitions
// Returns eng_purchase_orders mapped to the PurchaseRequisition shape.
router.get('/supply-procurement/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status, propertyId } = req.query as Record<string, string>;
    let q = supabaseAdmin.from('eng_purchase_orders').select('*').order('order_date', { ascending: false });
    if (status) q = q.eq('status', status);
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data: pos, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const { data: suppliers } = await supabaseAdmin.from('fb_suppliers').select('id, name');
    const supplierName: Record<string, string> = {};
    (suppliers || []).forEach((s: any) => { supplierName[s.id] = s.name; });

    const poIds = (pos || []).map((p: any) => p.id);
    let linesByPo: Record<string, any[]> = {};
    if (poIds.length > 0) {
      const { data: lines } = await supabaseAdmin.from('eng_purchase_order_lines').select('*').in('po_id', poIds);
      (lines || []).forEach((l: any) => {
        (linesByPo[l.po_id] = linesByPo[l.po_id] || []).push(l);
      });
    }

    const rows = (pos || []).map((po: any) => {
      const lines = (linesByPo[po.id] || []).map((l: any) => {
        const qty = Number(l.quantity_ordered || 0);
        const unitCost = Number(l.unit_price || 0);
        return {
          id: l.id,
          item_name: l.description || 'Item',
          category: 'Engineering',
          requested_quantity: qty,
          unit: l.unit_of_measure || 'pcs',
          estimated_unit_cost: unitCost,
          estimated_total: Number((qty * unitCost).toFixed(2)),
          required_by: (l.expected_date ? String(l.expected_date).slice(0, 10) : '')
            || (po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : ''),
          reason: l.reason || po.notes || 'Stock replenishment',
        };
      });
      const totalCost = lines.reduce((sum: number, l: any) => sum + l.estimated_total, 0);
      return {
        id: po.id,
        requisition_number: po.po_number,
        requested_by: po.submitted_by || 'Engineering',
        request_date: po.order_date ? String(po.order_date).slice(0, 10) : '',
        department: 'Engineering',
        priority: po.priority || 'medium',
        status: engPoStatusToRequisitionStatus(po.status) as any,
        po_status: po.status,
        items: lines,
        total_cost: Number(po.total_amount || totalCost),
        notes: po.notes || '',
        supplier_name: supplierName[po.supplier_id] || null,
      };
    });

    return res.json(rows);
  } catch (err) {
    console.error('supply-procurement/requisitions error:', err);
    return res.status(500).json({ error: 'Failed to load requisitions' });
  }
});

// Helper: earliest non-empty requiredBy date from requisition items.
function engEarliestRequiredBy(items?: Array<{ requiredBy?: string }>): string | null {
  if (!items || items.length === 0) return null;
  const dates = items
    .map(it => it.requiredBy)
    .filter((d): d is string => !!d && !isNaN(new Date(d).getTime()))
    .map(d => new Date(d).getTime());
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates)).toISOString();
}

// POST /api/eng-portal/supply-procurement/requisitions
// Creates a new eng_purchase_order (status 'draft') with lines.
router.post('/supply-procurement/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { propertyId, supplierId, priority, notes, items } = req.body as {
      propertyId?: string;
      supplierId?: string;
      priority?: string;
      notes?: string;
      items?: Array<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string; itemId?: string }>;
    };

    if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
    const poNumber = `ENG-PO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const subtotal = (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimatedCost) || 0), 0);

    const { data: po, error: poErr } = await supabaseAdmin.from('eng_purchase_orders').insert({
      po_number: poNumber,
      supplier_id: supplierId || null,
      property_id: propertyId,
      status: 'draft',
      priority: priority || 'medium',
      order_date: new Date().toISOString(),
      expected_delivery_date: engEarliestRequiredBy(items) || null,
      subtotal,
      tax_amount: 0,
      total_amount: subtotal,
      currency: 'ETB',
      payment_status: 'pending',
      notes: notes || 'Created from Engineering Supply & Procurement',
      submitted_by: req.user?.name || req.user?.id || 'Engineering',
    }).select().single();
    if (poErr) return res.status(500).json({ error: poErr.message });

    const lineRows = (items || []).map((it) => {
      const qty = Number(it.quantity) || 0;
      const unitCost = Number(it.estimatedCost) || 0;
      return {
        po_id: po.id,
        item_id: it.itemId || null,
        description: it.itemName,
        quantity_ordered: qty,
        quantity_received: 0,
        unit_of_measure: it.unit || 'pcs',
        unit_price: unitCost,
        line_total: Number((qty * unitCost).toFixed(2)),
        expected_date: it.requiredBy ? new Date(it.requiredBy).toISOString() : null,
        reason: it.reason || null,
      };
    });

    if (lineRows.length > 0) {
      const { error: lineErr } = await supabaseAdmin.from('eng_purchase_order_lines').insert(lineRows);
      if (lineErr) return res.status(500).json({ error: lineErr.message });
    }

    // Twin-write into unified proc_requisitions so the Procurement portal sees this.
    twinWriteProcRequisition({
      sourceSystem: 'engineering',
      sourceRef: po.id,
      sourcePoNumber: po.po_number,
      propertyId,
      department: 'Engineering & Maintenance',
      requester: req.user?.name || req.user?.id || 'Engineering',
      priority: priority || 'medium',
      notes: notes || 'Created from Engineering Supply & Procurement',
      requiredDate: engEarliestRequiredBy(items),
      estimatedTotal: subtotal,
      items: (items || []).map(it => ({
        itemName: it.itemName,
        category: it.category,
        quantity: Number(it.quantity) || 0,
        unit: it.unit || 'pcs',
        estimatedCost: Number(it.estimatedCost) || 0,
        requiredBy: it.requiredBy || undefined,
        reason: it.reason,
      })),
      createdBy: req.user?.id,
    }).catch(() => { /* errors logged inside helper */ });

    return res.status(201).json({ id: po.id, po_number: po.po_number, status: po.status });
  } catch (err) {
    console.error('supply-procurement/requisitions POST error:', err);
    return res.status(500).json({ error: 'Failed to create requisition' });
  }
});

// Allowed forward transitions for eng_purchase_orders.status.
const ENG_PO_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['acknowledged', 'cancelled'],
  acknowledged: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

// PUT /api/eng-portal/supply-procurement/requisitions/:id/status
// Advance a PO to the next status.
router.put('/supply-procurement/requisitions/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { status: nextStatus } = req.body as { status?: string };
    if (!nextStatus) return res.status(400).json({ error: 'status is required' });

    const { data: po, error: poErr } = await supabaseAdmin
      .from('eng_purchase_orders').select('id, status, po_number').eq('id', req.params.id).single();
    if (poErr || !po) return res.status(404).json({ error: 'Purchase order not found' });

    const allowed = ENG_PO_TRANSITIONS[po.status] || [];
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: `Cannot transition from '${po.status}' to '${nextStatus}'. Allowed: ${allowed.join(', ') || 'none'}` });
    }

    const update: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === 'received' || nextStatus === 'closed') {
      update.actual_delivery_date = new Date().toISOString();
    }

    const { error: updErr } = await supabaseAdmin
      .from('eng_purchase_orders').update(update).eq('id', po.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ id: po.id, po_number: po.po_number, status: nextStatus });
  } catch (err) {
    console.error('supply-procurement/requisitions/:id/status error:', err);
    return res.status(500).json({ error: 'Failed to update PO status' });
  }
});

// POST /api/eng-portal/supply-procurement/requisitions/:id/receive
// Goods receipt: marks the PO as received (or partial), increments
// quantity_received on each line, and credits spare_parts stock for
// received quantities. Logs a Restock transaction per line.
router.post('/supply-procurement/requisitions/:id/receive', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { lines } = (req.body || {}) as { lines?: Array<{ lineId: string; receivedQty: number }> };

    const { data: po, error: poErr } = await supabaseAdmin
      .from('eng_purchase_orders').select('id, status, po_number, property_id').eq('id', req.params.id).single();
    if (poErr || !po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['acknowledged', 'partial', 'received'].includes(po.status)) {
      return res.status(400).json({ error: `PO must be acknowledged or partial to receive (current: ${po.status})` });
    }
    const propertyId = po.property_id;
    if (!propertyId) return res.status(400).json({ error: 'PO has no property_id' });

    const { data: poLines, error: linesErr } = await supabaseAdmin
      .from('eng_purchase_order_lines').select('*').eq('po_id', po.id);
    if (linesErr) return res.status(500).json({ error: linesErr.message });

    const receivedMap = new Map<string, number>();
    if (lines && lines.length > 0) {
      for (const l of lines) {
        if (l.lineId && Number.isFinite(l.receivedQty)) receivedMap.set(l.lineId, Math.max(0, Number(l.receivedQty)));
      }
    }

    const now = new Date().toISOString();
    let allFullyReceived = true;
    const txIds: string[] = [];

    for (const line of poLines || []) {
      const ordered = Number(line.quantity_ordered || 0);
      const alreadyReceived = Number(line.quantity_received || 0);
      const thisReceipt = receivedMap.has(line.id)
        ? Math.min(ordered - alreadyReceived, receivedMap.get(line.id)!)
        : Math.max(0, ordered - alreadyReceived);
      if (thisReceipt <= 0) {
        if (alreadyReceived < ordered) allFullyReceived = false;
        continue;
      }

      const newReceivedQty = alreadyReceived + thisReceipt;
      const { error: lineUpdErr } = await supabaseAdmin
        .from('eng_purchase_order_lines')
        .update({ quantity_received: newReceivedQty })
        .eq('id', line.id);
      if (lineUpdErr) console.warn(`[eng-po-receive] failed to update line ${line.id}:`, lineUpdErr.message);

      if (newReceivedQty < ordered) allFullyReceived = false;

      // Credit uinv_stock_balances in the ENG store — match by item_name (description).
      const partName = (line.description || '').trim();
      if (partName) {
        // Resolve a unified item by name
        const { data: matchItem } = await supabaseAdmin
          .from('uinv_items')
          .select('id, subcategory')
          .ilike('item_name', partName)
          .eq('category', 'Engineering')
          .maybeSingle();

        if (matchItem) {
          const unitCost = Number(line.unit_price) || 0;
          const { data: balance } = await supabaseAdmin
            .from('uinv_stock_balances')
            .select('id, on_hand, unit_cost')
            .eq('item_id', matchItem.id)
            .eq('store_id', ENG_STORE_ID)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          let newQty: number;
          if (balance) {
            newQty = Number(balance.on_hand) + thisReceipt;
            await supabaseAdmin.from('uinv_stock_balances').update({
              on_hand: newQty,
              unit_cost: unitCost || Number(balance.unit_cost || 0),
              last_movement_date: now,
              updated_at: now,
            }).eq('id', balance.id);
          } else {
            newQty = thisReceipt;
            const newBalanceId = `UINV-SB-ENG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await supabaseAdmin.from('uinv_stock_balances').insert({
              id: newBalanceId,
              property_id: propertyId,
              item_id: matchItem.id,
              store_id: ENG_STORE_ID,
              location_id: null,
              on_hand: thisReceipt,
              reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
              damaged: 0, quarantined: 0, expired: 0,
              status: 'Available',
              unit_cost: unitCost,
              last_movement_date: now,
            });
          }

          // Log to uinv_stock_ledger
          const { data: ledgerRow } = await supabaseAdmin.from('uinv_stock_ledger').insert({
            property_id: propertyId,
            item_id: matchItem.id,
            store_id: ENG_STORE_ID,
            transaction_type: 'Goods Receipt',
            reference: po.po_number,
            quantity_in: thisReceipt,
            quantity_out: 0,
            balance: newQty,
            unit_cost: unitCost,
            value: thisReceipt * unitCost,
            performed_by: req.user?.name || req.user?.id || 'Engineering',
            reason: `Goods receipt: ${po.po_number}`,
            transaction_date: now,
          }).select('id').single();
          if (ledgerRow) txIds.push(ledgerRow.id);
        }
      }
    }

    // Advance PO status.
    const nextStatus = allFullyReceived ? 'received' : 'partial';
    await supabaseAdmin.from('eng_purchase_orders').update({
      status: nextStatus,
      actual_delivery_date: allFullyReceived ? now : null,
      updated_at: now,
    }).eq('id', po.id);

    return res.json({
      id: po.id,
      po_number: po.po_number,
      status: nextStatus,
      fullyReceived: allFullyReceived,
      transactionsLogged: txIds.length,
    });
  } catch (err) {
    console.error('supply-procurement/requisitions/:id/receive error:', err);
    return res.status(500).json({ error: 'Failed to process goods receipt' });
  }
});

// GET /api/eng-portal/supply-procurement/suppliers
// Returns the shared supplier master (fb_suppliers) with lead time
// and last order date — the SupplierRequirement shape.
router.get('/supply-procurement/suppliers', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { data: suppliers, error } = await supabaseAdmin.from('fb_suppliers').select('*').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const { data: performance } = await supabaseAdmin.from('fb_supplier_performance')
      .select('supplier_id, average_lead_time, period_start')
      .order('period_start', { ascending: false });
    const leadTimeBySupplier: Record<string, number> = {};
    (performance || []).forEach((p: any) => {
      if (leadTimeBySupplier[p.supplier_id] === undefined) leadTimeBySupplier[p.supplier_id] = Number(p.average_lead_time || 0);
    });

    const { data: pos } = await supabaseAdmin.from('eng_purchase_orders').select('supplier_id, order_date').order('order_date', { ascending: false });
    const lastOrderBySupplier: Record<string, string> = {};
    (pos || []).forEach((p: any) => {
      if (!p.supplier_id) return;
      if (!lastOrderBySupplier[p.supplier_id] && p.order_date) lastOrderBySupplier[p.supplier_id] = String(p.order_date).slice(0, 10);
    });

    const rows = (suppliers || []).map((s: any) => ({
      id: s.id,
      supplier_id: s.supplier_code,
      supplier_name: s.name,
      category: 'Engineering',
      item_name: s.notes || 'Various',
      minimum_order_qty: 1,
      unit: 'pcs',
      lead_time_days: leadTimeBySupplier[s.id] ?? 0,
      payment_terms: s.payment_terms ? `Net ${s.payment_terms}` : 'Net 30',
      status: s.is_active ? 'active' : 'inactive',
      last_order_date: lastOrderBySupplier[s.id] || null,
    }));

    return res.json(rows);
  } catch (err) {
    console.error('supply-procurement/suppliers error:', err);
    return res.status(500).json({ error: 'Failed to load suppliers' });
  }
});

// GET /api/eng-portal/supply-procurement/stats
// Stat cards for the supply & procurement header.
router.get('/supply-procurement/stats', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { propertyId } = req.query as Record<string, string>;
    let openReqQ = supabaseAdmin.from('eng_purchase_orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'submitted']);
    if (propertyId) openReqQ = openReqQ.eq('property_id', propertyId);
    const { count: openRequisitions } = await openReqQ;
    let pendingQ = supabaseAdmin.from('eng_purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted');
    if (propertyId) pendingQ = pendingQ.eq('property_id', propertyId);
    const { count: pendingApproval } = await pendingQ;
    const { count: activeSuppliers } = await supabaseAdmin.from('fb_suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    const { data: performance } = await supabaseAdmin.from('fb_supplier_performance').select('supplier_id, average_lead_time, period_start').order('period_start', { ascending: false });
    const seen = new Set<string>();
    let leadSum = 0;
    let leadCount = 0;
    (performance || []).forEach((p: any) => {
      if (!seen.has(p.supplier_id)) {
        seen.add(p.supplier_id);
        leadSum += Number(p.average_lead_time || 0);
        leadCount += 1;
      }
    });
    const avgLeadTime = leadCount > 0 ? leadSum / leadCount : 0;

    return res.json({
      openRequisitions: openRequisitions || 0,
      pendingApproval: pendingApproval || 0,
      activeSuppliers: activeSuppliers || 0,
      avgLeadTimeDays: Number(avgLeadTime.toFixed(1)),
    });
  } catch (err) {
    console.error('supply-procurement/stats error:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
});

// â”€â”€ Work Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Backs the /erp/maintenance/work-requests tab (WorkRequests.tsx).
// Flow: Pending â†’ Reviewed â†’ Approved â†’ (Converted to WO | Rejected).
// "Converted to WO" creates a real row in work_orders and links it back via
// converted_work_order_id, integrating with the Work Order Management console.

// GET /api/eng-portal/work-requests
// Optional query: ?status= ?source= ?priority= ?propertyId=
router.get('/work-requests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('work_requests')
    .select('*')
    .order('request_date', { ascending: false });

  const { status, source, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (source) q = q.eq('source', source);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/work-requests
router.post('/work-requests', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, source, sourceType, location, roomNumber,
    priority, type, description, requestedBy, attachments,
  } = req.body || {};

  if (!source || !location || !type || !description) {
    return res.status(400).json({ error: 'source, location, type, and description are required' });
  }

  // Generate a stable id + human-readable number.
  const seq = Date.now().toString().slice(-6);
  const id = `WR-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const wrNumber = `WR-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('work_requests').insert({
    id,
    property_id: propertyId || null,
    wr_number: wrNumber,
    source,
    source_type: sourceType || source,
    location,
    room_number: roomNumber || null,
    priority: priority || 'Normal',
    type,
    description,
    requested_by: requestedBy || req.user?.name || req.user?.id || 'Unknown',
    attachments: attachments || 0,
    status: 'Pending',
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/work-requests/:id
// Generic update (status transition + optional notes).
// Sets the matching timestamp column when status changes.
router.patch('/work-requests/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, reviewNotes, rejectionReason } = req.body || {};
  const updateData: any = {};
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'Reviewed') updateData.reviewed_at = now;
    if (status === 'Approved') updateData.approved_at = now;
    if (status === 'Rejected') updateData.rejected_at = now;
  }
  if (reviewNotes !== undefined) updateData.review_notes = reviewNotes;
  if (rejectionReason !== undefined) updateData.rejection_reason = rejectionReason;

  const { data, error } = await supabaseAdmin
    .from('work_requests')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Work request not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, workRequest: data });
});

// POST /api/eng-portal/work-requests/:id/convert-to-wo
// Converts an approved/reviewed work request into a real work_order row,
// links it back via converted_work_order_id, and marks the request as
// "Converted to WO". Integrates with the Work Order Management console.
router.post('/work-requests/:id/convert-to-wo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, scheduledDate, notes } = req.body || {};

  // Fetch the work request.
  const { data: wr, error: wrErr } = await supabaseAdmin
    .from('work_requests')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (wrErr) return res.status(500).json({ error: wrErr.message });
  if (!wr) return res.status(404).json({ error: 'Work request not found' });
  if (wr.status === 'Converted to WO') {
    return res.status(409).json({ error: 'Work request already converted to a work order' });
  }

  // Create the linked work order.
  const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woNumber,
    title: `WR: ${wr.type} â€” ${wr.location}`,
    description: wr.description,
    type: wr.type,
    priority: wr.priority,
    status: 'Open',
    assigned_to: assignedTo || null,
    room_number: wr.room_number || null,
    scheduled_date: scheduledDate || null,
    notes: notes || `Converted from work request ${wr.wr_number}`,
    created_by: req.user?.id,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  // Link back to the work request and mark converted.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('work_requests')
    .update({
      status: 'Converted to WO',
      converted_work_order_id: woId,
      converted_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, workRequest: updated, workOrder: wo });
});

// DELETE /api/eng-portal/work-requests/:id
router.delete('/work-requests/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('work_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// â”€â”€ Corrective Maintenance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Backs the /erp/maintenance/corrective-maintenance tab (CorrectiveMaintenance.tsx).
// Flow: Reported â†’ Diagnosed â†’ In Progress â†’ Parts Ordered â†’ Completed â†’ Verified.
// "Convert to Work Order" creates a real row in work_orders and links it back
// via converted_work_order_id, integrating with the Work Order Management console.

// GET /api/eng-portal/corrective-maintenance
// Optional query: ?status= ?category= ?priority= ?propertyId=
router.get('/corrective-maintenance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('corrective_maintenance_tasks')
    .select('*')
    .order('reported_date', { ascending: false });

  const { status, category, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/corrective-maintenance
router.post('/corrective-maintenance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, type, category, location, roomNumber,
    priority, description, assignedTechnician, estimatedCost, downtime,
  } = req.body || {};

  if (!type || !category || !location || !description) {
    return res.status(400).json({ error: 'type, category, location, and description are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `CM-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const cmNumber = `CM-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('corrective_maintenance_tasks').insert({
    id,
    property_id: propertyId || null,
    cm_number: cmNumber,
    type,
    category,
    location,
    room_number: roomNumber || null,
    priority: priority || 'Normal',
    description,
    assigned_technician: assignedTechnician || null,
    estimated_cost: estimatedCost || 0,
    downtime: downtime || null,
    status: 'Reported',
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/corrective-maintenance/:id
// Generic update (status transition + optional fields).
// Sets the matching timestamp column when status changes.
router.patch('/corrective-maintenance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, assignedTechnician, estimatedCost, actualCost, downtime, resolution,
  } = req.body || {};

  const updateData: any = {};
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'Diagnosed') updateData.diagnosed_at = now;
    if (status === 'In Progress') updateData.in_progress_at = now;
    if (status === 'Parts Ordered') updateData.parts_ordered_at = now;
    if (status === 'Completed') updateData.completed_at = now;
    if (status === 'Verified') updateData.verified_at = now;
  }
  if (assignedTechnician !== undefined) updateData.assigned_technician = assignedTechnician;
  if (estimatedCost !== undefined) updateData.estimated_cost = estimatedCost;
  if (actualCost !== undefined) updateData.actual_cost = actualCost;
  if (downtime !== undefined) updateData.downtime = downtime;
  if (resolution !== undefined) updateData.resolution = resolution;

  const { data, error } = await supabaseAdmin
    .from('corrective_maintenance_tasks')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Corrective task not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, task: data });
});

// POST /api/eng-portal/corrective-maintenance/:id/convert-to-wo
// Converts a corrective task into a real work_order row, links it back via
// converted_work_order_id. Integrates with the Work Order Management console.
router.post('/corrective-maintenance/:id/convert-to-wo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, scheduledDate, notes } = req.body || {};

  const { data: task, error: tErr } = await supabaseAdmin
    .from('corrective_maintenance_tasks')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!task) return res.status(404).json({ error: 'Corrective task not found' });
  if (task.converted_work_order_id) {
    return res.status(409).json({ error: 'Corrective task already converted to a work order' });
  }

  const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woNumber,
    title: `CM: ${task.type} â€” ${task.location}`,
    description: task.description,
    type: task.type,
    priority: task.priority,
    status: 'Open',
    assigned_to: assignedTo || task.assigned_technician || null,
    room_number: task.room_number || null,
    scheduled_date: scheduledDate || null,
    notes: notes || `Converted from corrective task ${task.cm_number}`,
    cost_estimate: task.estimated_cost || 0,
    created_by: req.user?.id,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('corrective_maintenance_tasks')
    .update({ converted_work_order_id: woId })
    .eq('id', req.params.id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, task: updated, workOrder: wo });
});

// DELETE /api/eng-portal/corrective-maintenance/:id
router.delete('/corrective-maintenance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('corrective_maintenance_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// â”€â”€ Building Maintenance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Backs the /erp/maintenance/building-maintenance tab (BuildingMaintenance.tsx).
// Flow: Scheduled â†’ In Progress â†’ Completed (+ On Hold / Cancelled side-branches).
// Areas: Guest Rooms, Public Areas, Roof, Exterior, Parking, Landscaping,
//        Water Systems, Electrical Systems, Mechanical Systems.

// GET /api/eng-portal/building-maintenance
// Optional query: ?status= ?area= ?priority= ?propertyId=
router.get('/building-maintenance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('building_maintenance_tasks')
    .select('*')
    .order('scheduled_date', { ascending: true });

  const { status, area, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (area) q = q.eq('area', area);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/building-maintenance
router.post('/building-maintenance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, area, location, taskType, description,
    priority, assignedTo, scheduledDate, estimatedCost, notes,
  } = req.body || {};

  if (!area || !taskType || !description || !scheduledDate) {
    return res.status(400).json({ error: 'area, taskType, description, and scheduledDate are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `BM-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const bmNumber = `BM-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('building_maintenance_tasks').insert({
    id,
    property_id: propertyId || null,
    bm_number: bmNumber,
    area,
    location: location || null,
    task_type: taskType,
    description,
    priority: priority || 'Normal',
    status: 'Scheduled',
    assigned_to: assignedTo || null,
    scheduled_date: scheduledDate,
    estimated_cost: estimatedCost || null,
    notes: notes || null,
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/building-maintenance/:id
// Generic update (status transition + optional fields).
// Sets completion_date automatically when status â†’ Completed.
router.patch('/building-maintenance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, area, location, taskType, description, priority,
    assignedTo, scheduledDate, estimatedCost, actualCost, completionDate, notes,
  } = req.body || {};

  const updateData: any = {};
  if (status) {
    updateData.status = status;
    if (status === 'Completed' && !completionDate) {
      updateData.completion_date = new Date().toISOString().split('T')[0];
    }
  }
  if (area !== undefined) updateData.area = area;
  if (location !== undefined) updateData.location = location;
  if (taskType !== undefined) updateData.task_type = taskType;
  if (description !== undefined) updateData.description = description;
  if (priority !== undefined) updateData.priority = priority;
  if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
  if (scheduledDate !== undefined) updateData.scheduled_date = scheduledDate;
  if (estimatedCost !== undefined) updateData.estimated_cost = estimatedCost;
  if (actualCost !== undefined) updateData.actual_cost = actualCost;
  if (completionDate !== undefined) updateData.completion_date = completionDate;
  if (notes !== undefined) updateData.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('building_maintenance_tasks')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Building maintenance task not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, task: data });
});

// DELETE /api/eng-portal/building-maintenance/:id
router.delete('/building-maintenance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('building_maintenance_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// â”€â”€ Energy Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Backs the /erp/maintenance/energy tab (EnergyManagement.tsx).
// Three sub-domains: energy-metrics (daily consumption), energy-efficiency
// (equipment efficiency monitoring), energy-projects (capital ROI projects).

// GET /api/eng-portal/energy-metrics â€” optional ?propertyId= ?limit=
router.get('/energy-metrics', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('energy_metrics').select('*').order('metric_date', { ascending: false });
  const { propertyId, limit } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (limit) q = q.limit(parseInt(limit));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/energy-metrics
router.post('/energy-metrics', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, metricDate, electricityKwh, waterLiters, gasM3, dieselLiters, solarKwh, totalCost, carbonFootprintTons } = req.body || {};
  if (!metricDate) return res.status(400).json({ error: 'metricDate is required' });
  const { data, error } = await supabaseAdmin.from('energy_metrics').insert({
    property_id: propertyId || null,
    metric_date: metricDate,
    electricity_kwh: electricityKwh || 0,
    water_liters: waterLiters || 0,
    gas_m3: gasM3 || 0,
    diesel_liters: dieselLiters || 0,
    solar_kwh: solarKwh || 0,
    total_cost: totalCost || 0,
    carbon_footprint_tons: carbonFootprintTons || 0,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/energy-metrics/:id
router.patch('/energy-metrics/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { metricDate, electricityKwh, waterLiters, gasM3, dieselLiters, solarKwh, totalCost, carbonFootprintTons } = req.body || {};
  const updateData: any = {};
  if (metricDate !== undefined) updateData.metric_date = metricDate;
  if (electricityKwh !== undefined) updateData.electricity_kwh = electricityKwh;
  if (waterLiters !== undefined) updateData.water_liters = waterLiters;
  if (gasM3 !== undefined) updateData.gas_m3 = gasM3;
  if (dieselLiters !== undefined) updateData.diesel_liters = dieselLiters;
  if (solarKwh !== undefined) updateData.solar_kwh = solarKwh;
  if (totalCost !== undefined) updateData.total_cost = totalCost;
  if (carbonFootprintTons !== undefined) updateData.carbon_footprint_tons = carbonFootprintTons;
  const { data, error } = await supabaseAdmin.from('energy_metrics').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, metric: data });
});

// DELETE /api/eng-portal/energy-metrics/:id
router.delete('/energy-metrics/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('energy_metrics').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// GET /api/eng-portal/energy-efficiency â€” optional ?propertyId= ?status=
router.get('/energy-efficiency', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('energy_equipment_efficiency').select('*').order('last_measured', { ascending: false });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/energy-efficiency
router.post('/energy-efficiency', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, equipmentName, category, currentEfficiency, targetEfficiency, status, lastMeasured } = req.body || {};
  if (!equipmentName || !category) return res.status(400).json({ error: 'equipmentName and category are required' });
  const { data, error } = await supabaseAdmin.from('energy_equipment_efficiency').insert({
    property_id: propertyId || null,
    equipment_name: equipmentName,
    category,
    current_efficiency: currentEfficiency || 0,
    target_efficiency: targetEfficiency || 0,
    status: status || 'Optimal',
    last_measured: lastMeasured || new Date().toISOString().split('T')[0],
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/energy-efficiency/:id
router.patch('/energy-efficiency/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { equipmentName, category, currentEfficiency, targetEfficiency, status, lastMeasured } = req.body || {};
  const updateData: any = {};
  if (equipmentName !== undefined) updateData.equipment_name = equipmentName;
  if (category !== undefined) updateData.category = category;
  if (currentEfficiency !== undefined) updateData.current_efficiency = currentEfficiency;
  if (targetEfficiency !== undefined) updateData.target_efficiency = targetEfficiency;
  if (status !== undefined) updateData.status = status;
  if (lastMeasured !== undefined) updateData.last_measured = lastMeasured;
  const { data, error } = await supabaseAdmin.from('energy_equipment_efficiency').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, efficiency: data });
});

// DELETE /api/eng-portal/energy-efficiency/:id
router.delete('/energy-efficiency/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('energy_equipment_efficiency').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// GET /api/eng-portal/energy-projects â€” optional ?propertyId= ?status=
router.get('/energy-projects', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('energy_projects').select('*').order('created_at', { ascending: false });
  const { propertyId, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/energy-projects
router.post('/energy-projects', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, type, status, estimatedSavings, actualSavings, investment, roi, completionDate } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const seq = Date.now().toString().slice(-6);
  const epNumber = `EP-${new Date().getFullYear()}-${seq}`;
  const { data, error } = await supabaseAdmin.from('energy_projects').insert({
    property_id: propertyId || null,
    ep_number: epNumber,
    name,
    type,
    status: status || 'Planned',
    estimated_savings: estimatedSavings || 0,
    actual_savings: actualSavings || null,
    investment: investment || 0,
    roi: roi || 0,
    completion_date: completionDate || null,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/energy-projects/:id
router.patch('/energy-projects/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, type, status, estimatedSavings, actualSavings, investment, roi, completionDate } = req.body || {};
  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (type !== undefined) updateData.type = type;
  if (status !== undefined) {
    updateData.status = status;
    if (status === 'Completed' && !completionDate) {
      updateData.completion_date = new Date().toISOString().split('T')[0];
    }
  }
  if (estimatedSavings !== undefined) updateData.estimated_savings = estimatedSavings;
  if (actualSavings !== undefined) updateData.actual_savings = actualSavings;
  if (investment !== undefined) updateData.investment = investment;
  if (roi !== undefined) updateData.roi = roi;
  if (completionDate !== undefined) updateData.completion_date = completionDate;
  const { data, error } = await supabaseAdmin.from('energy_projects').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, project: data });
});

// DELETE /api/eng-portal/energy-projects/:id
router.delete('/energy-projects/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('energy_projects').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Inspections ──────────────────────────────────────────────────────────
// Backs the /erp/maintenance/inspections tab (Inspections.tsx).
// Flow: Scheduled → In Progress → (Completed | Failed).
// Overdue is auto-derived: any Scheduled inspection whose scheduled_date
// has passed is flipped to Overdue server-side on each GET.
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management
// console (/erp/maintenance/workorders). Typically used when an
// inspection Fails and a repair work order is needed.

// GET /api/eng-portal/inspections
// Optional query: ?status= ?type= ?category= ?priority= ?propertyId=
router.get('/inspections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Auto-advance: Scheduled inspections past their scheduled_date → Overdue.
  await supabaseAdmin
    .from('eng_inspections')
    .update({ status: 'Overdue' })
    .eq('status', 'Scheduled')
    .lt('scheduled_date', new Date().toISOString());

  let q = supabaseAdmin
    .from('eng_inspections')
    .select('*')
    .order('scheduled_date', { ascending: false });

  const { status, type, category, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  if (category) q = q.eq('category', category);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/inspections
router.post('/inspections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, type, category, location, roomNumber,
    description, priority, scheduledDate, inspector, nextDueDate,
  } = req.body || {};

  if (!type || !category || !location || !description || !scheduledDate) {
    return res.status(400).json({ error: 'type, category, location, description, and scheduledDate are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `INS-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const insNumber = `INS-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('eng_inspections').insert({
    id,
    property_id: propertyId || null,
    ins_number: insNumber,
    type,
    category,
    location,
    room_number: roomNumber || null,
    description,
    priority: priority || 'Normal',
    scheduled_date: scheduledDate,
    inspector: inspector || null,
    next_due_date: nextDueDate || null,
    status: 'Scheduled',
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/inspections/:id
// Generic update (status transition + optional fields).
// Sets the matching timestamp column when status changes.
router.patch('/inspections/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, inspector, findings, nextDueDate, completedDate,
  } = req.body || {};

  const updateData: any = {};
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'In Progress') updateData.in_progress_at = now;
    if (status === 'Completed') {
      updateData.completed_at = now;
      updateData.completed_date = completedDate || now;
    }
    if (status === 'Failed') updateData.failed_at = now;
  }
  if (inspector !== undefined) updateData.inspector = inspector;
  if (findings !== undefined) updateData.findings = findings;
  if (nextDueDate !== undefined) updateData.next_due_date = nextDueDate;
  if (completedDate !== undefined) updateData.completed_date = completedDate;

  const { data, error } = await supabaseAdmin
    .from('eng_inspections')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Inspection not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, inspection: data });
});

// POST /api/eng-portal/inspections/:id/convert-to-wo
// Converts an inspection into a real work_order row, links it back via
// converted_work_order_id. Integrates with the Work Order Management
// console. Typically used when an inspection Fails and a repair WO is
// needed.
router.post('/inspections/:id/convert-to-wo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, scheduledDate, notes } = req.body || {};

  const { data: insp, error: iErr } = await supabaseAdmin
    .from('eng_inspections')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (iErr) return res.status(500).json({ error: iErr.message });
  if (!insp) return res.status(404).json({ error: 'Inspection not found' });
  if (insp.converted_work_order_id) {
    return res.status(409).json({ error: 'Inspection already converted to a work order' });
  }

  const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woNumber,
    title: `Inspection: ${insp.type} — ${insp.location}`,
    description: insp.findings
      ? `${insp.description}\n\nFindings: ${insp.findings}`
      : insp.description,
    type: insp.type,
    priority: insp.priority,
    status: 'Open',
    assigned_to: assignedTo || insp.inspector || null,
    room_number: insp.room_number || null,
    scheduled_date: scheduledDate || null,
    notes: notes || `Converted from inspection ${insp.ins_number}`,
    created_by: req.user?.id,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('eng_inspections')
    .update({ converted_work_order_id: woId })
    .eq('id', req.params.id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, inspection: updated, workOrder: wo });
});

// DELETE /api/eng-portal/inspections/:id
router.delete('/inspections/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_inspections').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Calibrations ─────────────────────────────────────────────────────────
// Backs the /erp/maintenance/calibration tab (CalibrationManagement.tsx).
// Flow: Scheduled → In Progress → (Completed | Failed).
// Overdue is auto-derived: any Scheduled calibration whose scheduled_date
// has passed is flipped to Overdue server-side on each GET.
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management
// console (/erp/maintenance/workorders). Typically used when a
// calibration Fails and a repair/replacement WO is needed.

// GET /api/eng-portal/calibrations
// Optional query: ?status= ?instrumentType= ?priority= ?propertyId=
router.get('/calibrations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Auto-advance: Scheduled calibrations past their scheduled_date → Overdue.
  await supabaseAdmin
    .from('eng_calibrations')
    .update({ status: 'Overdue' })
    .eq('status', 'Scheduled')
    .lt('scheduled_date', new Date().toISOString());

  let q = supabaseAdmin
    .from('eng_calibrations')
    .select('*')
    .order('scheduled_date', { ascending: false });

  const { status, instrumentType, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (instrumentType) q = q.eq('instrument_type', instrumentType);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/calibrations
router.post('/calibrations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, equipmentId, equipmentName, instrumentType, location, roomNumber,
    description, priority, scheduledDate, calibratedBy, nextDueDate,
  } = req.body || {};

  if (!equipmentName || !instrumentType || !location || !description || !scheduledDate) {
    return res.status(400).json({ error: 'equipmentName, instrumentType, location, description, and scheduledDate are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `CAL-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const calNumber = `CAL-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('eng_calibrations').insert({
    id,
    property_id: propertyId || null,
    cal_number: calNumber,
    equipment_id: equipmentId || null,
    equipment_name: equipmentName,
    instrument_type: instrumentType,
    location,
    room_number: roomNumber || null,
    description,
    priority: priority || 'Normal',
    scheduled_date: scheduledDate,
    calibrated_by: calibratedBy || null,
    next_due_date: nextDueDate || null,
    status: 'Scheduled',
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/calibrations/:id
// Generic update (status transition + optional fields).
// Sets the matching timestamp column when status changes.
router.patch('/calibrations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, calibratedBy, previousReading, currentReading, tolerance,
    deviation, nextDueDate, completedDate,
  } = req.body || {};

  const updateData: any = {};
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'In Progress') updateData.in_progress_at = now;
    if (status === 'Completed') {
      updateData.completed_at = now;
      updateData.completed_date = completedDate || now;
    }
    if (status === 'Failed') updateData.failed_at = now;
  }
  if (calibratedBy !== undefined) updateData.calibrated_by = calibratedBy;
  if (previousReading !== undefined) updateData.previous_reading = previousReading;
  if (currentReading !== undefined) updateData.current_reading = currentReading;
  if (tolerance !== undefined) updateData.tolerance = tolerance;
  if (deviation !== undefined) updateData.deviation = deviation;
  if (nextDueDate !== undefined) updateData.next_due_date = nextDueDate;
  if (completedDate !== undefined) updateData.completed_date = completedDate;

  const { data, error } = await supabaseAdmin
    .from('eng_calibrations')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Calibration not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, calibration: data });
});

// POST /api/eng-portal/calibrations/:id/convert-to-wo
// Converts a calibration into a real work_order row, links it back via
// converted_work_order_id. Integrates with the Work Order Management
// console. Typically used when a calibration Fails and a repair or
// replacement WO is needed.
router.post('/calibrations/:id/convert-to-wo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, scheduledDate, notes } = req.body || {};

  const { data: cal, error: cErr } = await supabaseAdmin
    .from('eng_calibrations')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!cal) return res.status(404).json({ error: 'Calibration not found' });
  if (cal.converted_work_order_id) {
    return res.status(409).json({ error: 'Calibration already converted to a work order' });
  }

  const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woNumber,
    title: `Calibration: ${cal.equipment_name} — ${cal.instrument_type}`,
    description: cal.deviation
      ? `${cal.description}\n\nDeviation: ${cal.deviation}`
      : cal.description,
    type: 'Calibration',
    priority: cal.priority,
    status: 'Open',
    assigned_to: assignedTo || cal.calibrated_by || null,
    room_number: cal.room_number || null,
    scheduled_date: scheduledDate || null,
    notes: notes || `Converted from calibration ${cal.cal_number}`,
    created_by: req.user?.id,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('eng_calibrations')
    .update({ converted_work_order_id: woId })
    .eq('id', req.params.id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, calibration: updated, workOrder: wo });
});

// DELETE /api/eng-portal/calibrations/:id
router.delete('/calibrations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_calibrations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Projects & Renovations ───────────────────────────────────────────────
// Backs the /erp/maintenance/projects-renovations tab (ProjectsRenovations.tsx).
// Flow: Planning → Approved → In Progress → (Completed | On Hold | Cancelled).
// Each project has an optional set of phases (eng_project_phases) for
// granular stage tracking. Phases are returned nested in the GET response.

// GET /api/eng-portal/projects
// Optional query: ?status= ?type= ?category= ?priority= ?propertyId=
// Returns projects with their phases nested in a `phases` array.
router.get('/projects', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('eng_projects')
    .select('*')
    .order('created_at', { ascending: false });

  const { status, type, category, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  if (category) q = q.eq('category', category);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data: projects, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  if (!projects || projects.length === 0) return res.json([]);

  // Fetch phases for all returned projects in one query.
  const projectIds = projects.map((p: any) => p.id);
  const { data: phases, error: phErr } = await supabaseAdmin
    .from('eng_project_phases')
    .select('*')
    .in('project_id', projectIds)
    .order('sort_order', { ascending: true });
  if (phErr) return res.status(500).json({ error: phErr.message });

  const phasesByProject: Record<string, any[]> = {};
  (phases || []).forEach((ph: any) => {
    if (!phasesByProject[ph.project_id]) phasesByProject[ph.project_id] = [];
    phasesByProject[ph.project_id].push(ph);
  });

  const enriched = projects.map((p: any) => ({
    ...p,
    phases: phasesByProject[p.id] || [],
  }));
  return res.json(enriched);
});

// GET /api/eng-portal/projects/:id — single project with phases
router.get('/projects/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: project, error } = await supabaseAdmin
    .from('eng_projects')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { data: phases } = await supabaseAdmin
    .from('eng_project_phases')
    .select('*')
    .eq('project_id', req.params.id)
    .order('sort_order', { ascending: true });

  return res.json({ ...project, phases: phases || [] });
});

// POST /api/eng-portal/projects
// Accepts optional `phases` array (name only; status defaults to Pending).
router.post('/projects', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, name, type, category, location, description,
    priority, startDate, targetCompletionDate, projectManager,
    budget, spent, progress, phases,
  } = req.body || {};

  if (!name || !type || !category || !location || !description) {
    return res.status(400).json({ error: 'name, type, category, location, and description are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `PRJ-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const prjNumber = `PRJ-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('eng_projects').insert({
    id,
    property_id: propertyId || null,
    prj_number: prjNumber,
    name,
    type,
    category,
    location,
    description,
    priority: priority || 'Normal',
    start_date: startDate || null,
    target_completion_date: targetCompletionDate || null,
    project_manager: projectManager || null,
    budget: budget || 0,
    spent: spent || 0,
    progress: progress || 0,
    status: 'Planning',
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Insert phases if provided.
  let seededPhases: any[] = [];
  if (Array.isArray(phases) && phases.length > 0) {
    const phaseRows = phases.map((p: any, idx: number) => ({
      project_id: id,
      name: p.name,
      status: p.status || 'Pending',
      completed_date: p.completedDate || null,
      sort_order: idx + 1,
    }));
    const { data: insertedPhases, error: phErr } = await supabaseAdmin
      .from('eng_project_phases')
      .insert(phaseRows)
      .select();
    if (phErr) return res.status(500).json({ error: phErr.message });
    seededPhases = insertedPhases || [];
  }

  cacheService.invalidate('eng-*');
  return res.status(201).json({ ...data, phases: seededPhases });
});

// PATCH /api/eng-portal/projects/:id
// Generic update (status transition + optional fields).
// Sets the matching timestamp column when status changes.
// When status → Completed, sets actual_completion_date + progress 100.
router.patch('/projects/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, name, type, category, location, description, priority,
    startDate, targetCompletionDate, actualCompletionDate, projectManager,
    budget, spent, progress,
  } = req.body || {};

  const updateData: any = {};
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'Approved') updateData.approved_at = now;
    if (status === 'In Progress') updateData.in_progress_at = now;
    if (status === 'Completed') {
      updateData.completed_at = now;
      updateData.actual_completion_date = actualCompletionDate || now.split('T')[0];
      if (progress === undefined) updateData.progress = 100;
    }
    if (status === 'On Hold') updateData.on_hold_at = now;
    if (status === 'Cancelled') updateData.cancelled_at = now;
  }
  if (name !== undefined) updateData.name = name;
  if (type !== undefined) updateData.type = type;
  if (category !== undefined) updateData.category = category;
  if (location !== undefined) updateData.location = location;
  if (description !== undefined) updateData.description = description;
  if (priority !== undefined) updateData.priority = priority;
  if (startDate !== undefined) updateData.start_date = startDate;
  if (targetCompletionDate !== undefined) updateData.target_completion_date = targetCompletionDate;
  if (actualCompletionDate !== undefined) updateData.actual_completion_date = actualCompletionDate;
  if (projectManager !== undefined) updateData.project_manager = projectManager;
  if (budget !== undefined) updateData.budget = budget;
  if (spent !== undefined) updateData.spent = spent;
  if (progress !== undefined) updateData.progress = progress;

  const { data, error } = await supabaseAdmin
    .from('eng_projects')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Project not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, project: data });
});

// DELETE /api/eng-portal/projects/:id
// Cascades to eng_project_phases via FK ON DELETE CASCADE.
router.delete('/projects/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_projects').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Project Phases (child CRUD) ──────────────────────────────────────────

// POST /api/eng-portal/projects/:id/phases — add a phase
router.post('/projects/:id/phases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, status, completedDate, sortOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Determine next sort_order if not provided.
  let order = sortOrder;
  if (order === undefined) {
    const { count } = await supabaseAdmin
      .from('eng_project_phases')
      .eq('project_id', req.params.id);
    order = (count || 0) + 1;
  }

  const { data, error } = await supabaseAdmin.from('eng_project_phases').insert({
    project_id: req.params.id,
    name,
    status: status || 'Pending',
    completed_date: completedDate || null,
    sort_order: order,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/projects/:id/phases/:phaseId — update a phase
router.patch('/projects/:id/phases/:phaseId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, status, completedDate, sortOrder } = req.body || {};
  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (status !== undefined) {
    updateData.status = status;
    if (status === 'Completed') updateData.completed_date = completedDate || new Date().toISOString().split('T')[0];
  }
  if (completedDate !== undefined) updateData.completed_date = completedDate;
  if (sortOrder !== undefined) updateData.sort_order = sortOrder;

  const { data, error } = await supabaseAdmin
    .from('eng_project_phases')
    .update(updateData)
    .eq('id', req.params.phaseId)
    .eq('project_id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Phase not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, phase: data });
});

// DELETE /api/eng-portal/projects/:id/phases/:phaseId — delete a phase
router.delete('/projects/:id/phases/:phaseId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('eng_project_phases')
    .delete()
    .eq('id', req.params.phaseId)
    .eq('project_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Communication Center ─────────────────────────────────────────────────
// Backs the /erp/maintenance/communication tab (CommunicationCenter.tsx).
// Two resources:
//   1. /communication/messages  — announcements/alerts/requests/updates/reminders
//      Flow: Sent → Read → Archived.
//   2. /communication/notifications — sidebar notifications with a read flag.

// GET /api/eng-portal/communication/messages
// Optional query: ?type= ?status= ?priority= ?category= ?propertyId=
router.get('/communication/messages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('eng_communication_messages')
    .select('*')
    .order('created_at', { ascending: false });

  const { type, status, priority, category, propertyId } = req.query as Record<string, string>;
  if (type) q = q.eq('type', type);
  if (status) q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  if (category) q = q.eq('category', category);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/eng-portal/communication/messages/:id
router.get('/communication/messages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('eng_communication_messages')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Message not found' });
  return res.json(data);
});

// POST /api/eng-portal/communication/messages
router.post('/communication/messages', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, type, category, title, content,
    sender, senderRole, recipients, priority, attachments,
  } = req.body || {};

  if (!type || !category || !title || !content || !sender) {
    return res.status(400).json({ error: 'type, category, title, content, and sender are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `MSG-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const msgNumber = `MSG-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('eng_communication_messages').insert({
    id,
    property_id: propertyId || null,
    msg_number: msgNumber,
    type,
    category,
    title,
    content,
    sender,
    sender_role: senderRole || null,
    recipients: Array.isArray(recipients) ? recipients : [],
    status: 'Sent',
    priority: priority || 'Normal',
    attachments: typeof attachments === 'number' ? attachments : 0,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/communication/messages/:id
// Supports status transitions (Sent → Read → Archived) and field edits.
router.patch('/communication/messages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, title, content, priority, category, type,
    sender, senderRole, recipients, attachments,
  } = req.body || {};

  const patch: Record<string, any> = {};
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Read') patch.read_at = new Date().toISOString();
    if (status === 'Archived') patch.archived_at = new Date().toISOString();
  }
  if (typeof title === 'string') patch.title = title;
  if (typeof content === 'string') patch.content = content;
  if (typeof priority === 'string') patch.priority = priority;
  if (typeof category === 'string') patch.category = category;
  if (typeof type === 'string') patch.type = type;
  if (typeof sender === 'string') patch.sender = sender;
  if (typeof senderRole === 'string') patch.sender_role = senderRole;
  if (Array.isArray(recipients)) patch.recipients = recipients;
  if (typeof attachments === 'number') patch.attachments = attachments;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields supplied for update' });
  }

  const { data, error } = await supabaseAdmin
    .from('eng_communication_messages')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Message not found' });

  cacheService.invalidate('eng-*');
  return res.json({ success: true, message: data });
});

// DELETE /api/eng-portal/communication/messages/:id
router.delete('/communication/messages/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('eng_communication_messages')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// GET /api/eng-portal/communication/notifications
// Optional query: ?propertyId= ?read=true|false
router.get('/communication/notifications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('eng_communication_notifications')
    .select('*')
    .order('created_at', { ascending: false });

  const { propertyId, read } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (read === 'true') q = q.eq('read', true);
  if (read === 'false') q = q.eq('read', false);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/communication/notifications
router.post('/communication/notifications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, type, title, message, actionUrl } = req.body || {};
  if (!type || !title || !message) {
    return res.status(400).json({ error: 'type, title, and message are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `NOT-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const { data, error } = await supabaseAdmin.from('eng_communication_notifications').insert({
    id,
    property_id: propertyId || null,
    type,
    title,
    message,
    read: false,
    action_url: actionUrl || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/communication/notifications/:id
// Toggles read flag and/or updates fields.
router.patch('/communication/notifications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { read, title, message, actionUrl } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof read === 'boolean') patch.read = read;
  if (typeof title === 'string') patch.title = title;
  if (typeof message === 'string') patch.message = message;
  if (typeof actionUrl === 'string') patch.action_url = actionUrl;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields supplied for update' });
  }

  const { data, error } = await supabaseAdmin
    .from('eng_communication_notifications')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Notification not found' });

  cacheService.invalidate('eng-*');
  return res.json({ success: true, notification: data });
});

// DELETE /api/eng-portal/communication/notifications/:id
router.delete('/communication/notifications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin
    .from('eng_communication_notifications')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Room Maintenance ─────────────────────────────────────────────────────
// Backs the /erp/maintenance/rooms tab (RoomMaintenanceModule.tsx).
// Two resources:
//   1. /room-issues — eng_room_issues table (room-specific fault tracking).
//      Flow: Open → In Progress → Resolved.
//      `blocks_room` indicates the issue takes the room out of inventory; the
//      POST/PATCH handlers sync rooms.status accordingly so the rest of the
//      ERP (Front Office, Housekeeping) stays in sync.
//   2. /rooms — read-only list of rooms (with active issue counts) scoped by
//      property, plus /rooms/:id/status to update rooms.status.

// GET /api/eng-portal/room-issues — optional ?status= ?category= ?priority= ?roomNumber= ?propertyId=
router.get('/room-issues', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  let q = supabaseAdmin
    .from('eng_room_issues')
    .select('*')
    .order('created_at', { ascending: false });

  const { status, category, priority, roomNumber, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  if (priority) q = q.eq('priority', priority);
  if (roomNumber) q = q.eq('room_number', roomNumber);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/room-issues
// When blocks_room is true, sets rooms.status = 'Out of Order' for the room.
router.post('/room-issues', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, roomNumber, category, description, priority,
    blocksRoom, reportedBy, assignedTo, notes,
  } = req.body || {};

  if (!roomNumber || !category || !description) {
    return res.status(400).json({ error: 'roomNumber, category, and description are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `RI-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const riNumber = `RI-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('eng_room_issues').insert({
    id,
    property_id: propertyId || null,
    ri_number: riNumber,
    room_number: roomNumber,
    category,
    description,
    status: 'Open',
    priority: priority || 'Normal',
    blocks_room: !!blocksRoom,
    reported_by: reportedBy || null,
    assigned_to: assignedTo || null,
    notes: notes || null,
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Sync room status when the issue blocks the room.
  if (blocksRoom) {
    await supabaseAdmin.from('rooms').update({ status: 'Out of Order' }).eq('number', roomNumber);
  }

  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/room-issues/:id
// Status transition + field edits. Sets resolved_at when status → Resolved.
// When transitioning to Resolved and the room is currently Out of Order,
// restores rooms.status to 'Vacant Clean' (return to inventory).
router.patch('/room-issues/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, category, description, priority, blocksRoom,
    reportedBy, assignedTo, notes,
  } = req.body || {};

  const patch: Record<string, any> = {};
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Resolved') patch.resolved_at = new Date().toISOString();
  }
  if (typeof category === 'string') patch.category = category;
  if (typeof description === 'string') patch.description = description;
  if (typeof priority === 'string') patch.priority = priority;
  if (typeof blocksRoom === 'boolean') patch.blocks_room = blocksRoom;
  if (typeof reportedBy === 'string') patch.reported_by = reportedBy;
  if (typeof assignedTo === 'string') patch.assigned_to = assignedTo;
  if (typeof notes === 'string') patch.notes = notes;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields supplied for update' });
  }

  const { data, error } = await supabaseAdmin
    .from('eng_room_issues')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Room issue not found' });

  // When resolved, restore the room to inventory if it was Out of Order.
  if (status === 'Resolved') {
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .select('status')
      .eq('number', data.room_number)
      .maybeSingle();
    if (room && room.status === 'Out of Order') {
      await supabaseAdmin.from('rooms').update({ status: 'Vacant Clean' }).eq('number', data.room_number);
    }
  }

  cacheService.invalidate('eng-*');
  return res.json({ success: true, issue: data });
});

// DELETE /api/eng-portal/room-issues/:id
router.delete('/room-issues/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_room_issues').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// POST /api/eng-portal/room-issues/:id/convert-to-wo
// Converts a room issue into a real work_orders row, links it back via
// converted_work_order_id, and marks the issue as "In Progress" (so it
// stays visible until the WO is completed). Integrates with the Work
// Order Management console (/erp/maintenance/workorders).
router.post('/room-issues/:id/convert-to-wo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, scheduledDate, notes } = req.body || {};

  // Fetch the room issue.
  const { data: ri, error: riErr } = await supabaseAdmin
    .from('eng_room_issues')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (riErr) return res.status(500).json({ error: riErr.message });
  if (!ri) return res.status(404).json({ error: 'Room issue not found' });
  if (ri.converted_work_order_id) {
    return res.status(409).json({ error: 'Room issue already converted to a work order' });
  }

  // Create the linked work order.
  const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woNumber,
    title: `Room ${ri.room_number}: ${ri.category} — ${ri.description}`,
    description: ri.description,
    type: ri.category,
    priority: ri.priority,
    status: 'Open',
    assigned_to: assignedTo || ri.assigned_to || null,
    room_number: ri.room_number,
    scheduled_date: scheduledDate || null,
    notes: notes || `Converted from room issue ${ri.ri_number}`,
    created_by: req.user?.id,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  // Link back to the room issue and advance status to In Progress.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('eng_room_issues')
    .update({
      status: 'In Progress',
      converted_work_order_id: woId,
      converted_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, issue: updated, workOrder: wo });
});

// GET /api/eng-portal/rooms — list rooms scoped by property, with active issue counts.
// Optional ?propertyId=
router.get('/rooms', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;

  let roomsQ = supabaseAdmin
    .from('rooms')
    .select('id, number, type, floor, status, rate, room_type_id, property_id')
    .order('number', { ascending: true });
  if (propertyId) roomsQ = roomsQ.eq('property_id', propertyId);

  const { data: rooms, error } = await roomsQ;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch active (non-resolved) issues to attach counts + flags per room.
  let issuesQ = supabaseAdmin
    .from('eng_room_issues')
    .select('id, room_number, status, blocks_room')
    .neq('status', 'Resolved');
  if (propertyId) issuesQ = issuesQ.eq('property_id', propertyId);
  const { data: issues } = await issuesQ;

  const issuesByRoom: Record<string, { count: number; blocksRoom: boolean }> = {};
  (issues || []).forEach((i: any) => {
    if (!issuesByRoom[i.room_number]) issuesByRoom[i.room_number] = { count: 0, blocksRoom: false };
    issuesByRoom[i.room_number].count += 1;
    if (i.blocks_room) issuesByRoom[i.room_number].blocksRoom = true;
  });

  const enriched = (rooms || []).map((r: any) => ({
    ...r,
    activeIssueCount: issuesByRoom[r.number]?.count || 0,
    hasBlockingIssue: issuesByRoom[r.number]?.blocksRoom || false,
  }));

  return res.json(enriched);
});

// PATCH /api/eng-portal/rooms/:id/status — update rooms.status.
// :id may be a room number or room id. Validates against the canonical
// status set (migration 225).
router.patch('/rooms/:id/status', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const ALLOWED = new Set([
    'Vacant Clean', 'Vacant Dirty', 'Occupied Clean', 'Occupied Dirty',
    'Out of Order', 'Out of Service', 'Maintenance', 'House Use', 'Blocked',
  ]);
  const { status } = req.body || {};
  if (!status || !ALLOWED.has(status)) {
    return res.status(400).json({ error: `Invalid status: ${status}` });
  }

  // Try by number first, then fall back to id.
  let updateQuery = supabaseAdmin.from('rooms').update({ status }).eq('number', req.params.id).select('id');
  const { data: byNumber, error: errNumber } = await updateQuery;
  if (errNumber) return res.status(500).json({ error: errNumber.message });
  if (!byNumber || byNumber.length === 0) {
    const { error: errId } = await supabaseAdmin.from('rooms').update({ status }).eq('id', req.params.id);
    if (errId) return res.status(500).json({ error: errId.message });
  }

  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Configuration ────────────────────────────────────────────────────────
// Backs the /erp/maintenance/configuration tab (Configuration.tsx).
// JSON-blob config per property per section, mirroring the HK
// hk_config pattern (migration 320). Sections: general, departments,
// staff, work_orders, preventive_maintenance, alerts, safety,
// locations, utilities.

const ENG_CONFIG_SECTIONS = [
  'work_orders', 'preventive_maintenance', 'alerts', 'safety',
] as const;

// GET /api/eng-portal/config/:propertyId/:section
router.get('/config/:propertyId/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.params;
  if (!ENG_CONFIG_SECTIONS.includes(section as any)) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  const { data, error } = await supabaseAdmin
    .from('eng_config')
    .select('data')
    .eq('property_id', propertyId)
    .eq('section', section)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data?.data || {});
});

// PUT /api/eng-portal/config/:propertyId/:section — upsert a section's config.
router.put('/config/:propertyId/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, section } = req.params;
  if (!ENG_CONFIG_SECTIONS.includes(section as any)) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  const data = req.body || {};
  const id = `eng-cfg-${propertyId}-${section}`;
  const { data: result, error } = await supabaseAdmin
    .from('eng_config')
    .upsert({
      id,
      property_id: propertyId,
      section,
      data,
    }, { onConflict: 'id' })
    .select('data')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json(result.data || {});
});

// ── Config helper (used by the alert engine) ─────────────────────────────
// Fetches a config section's JSONB data for a property. Returns {} if not
// configured, so callers can use fallback defaults.
async function getEngConfig(propertyId: string | undefined, section: string): Promise<Record<string, any>> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return {};
  let q = supabaseAdmin.from('eng_config').select('data').eq('section', section);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q.maybeSingle();
  return (data?.data as Record<string, any>) || {};
}

// ── Utilities & Plant ────────────────────────────────────────────────────
// Backs the /erp/maintenance/utilities tab (UtilitiesManagement.tsx).
// Four resources:
//   1. /utility-readings — eng_utility_readings (periodic meter readings)
//   2. /generators       — eng_generators (backup power assets + live stats)
//   3. /generator-events — eng_generator_events (event log per generator)
//   4. /utility-alerts   — eng_utility_alerts (abnormal usage / leak alerts)

// GET /api/eng-portal/utility-readings — optional ?utilityType= ?propertyId= ?days=
router.get('/utility-readings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin
    .from('eng_utility_readings')
    .select('*')
    .order('reading_date', { ascending: true });
  const { utilityType, propertyId, days } = req.query as Record<string, string>;
  if (utilityType) q = q.eq('utility_type', utilityType);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));
    q = q.gte('reading_date', since.toISOString().slice(0, 10));
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/utility-readings
router.post('/utility-readings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, readingDate, utilityType, value, unit, readingBy, notes } = req.body || {};
  if (!readingDate || !utilityType || value === undefined) {
    return res.status(400).json({ error: 'readingDate, utilityType, and value are required' });
  }
  const id = `UR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_utility_readings').insert({
    id, property_id: propertyId || null, reading_date: readingDate,
    utility_type: utilityType, value, unit: unit || 'kWh',
    reading_by: readingBy || null, notes: notes || null, created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// DELETE /api/eng-portal/utility-readings/:id
router.delete('/utility-readings/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_utility_readings').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// GET /api/eng-portal/generators — optional ?propertyId=
router.get('/generators', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_generators').select('*').order('name', { ascending: true });
  const { propertyId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/generators
router.post('/generators', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, code, status, runningHours, fuelLevelPct, batteryHealthPct,
    lastServiceDate, nextServiceDate, outputKva, engineType, controlUnit, location, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = `GEN-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_generators').insert({
    id, property_id: propertyId || null, name, code: code || null,
    status: status || 'Standby', running_hours: runningHours ?? 0,
    fuel_level_pct: fuelLevelPct ?? 100, battery_health_pct: batteryHealthPct ?? 100,
    last_service_date: lastServiceDate || null, next_service_date: nextServiceDate || null,
    output_kva: outputKva || null, engine_type: engineType || null,
    control_unit: controlUnit || null, location: location || null,
    notes: notes || null, created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/generators/:id
router.patch('/generators/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, runningHours, fuelLevelPct, batteryHealthPct,
    lastServiceDate, nextServiceDate, name, code, outputKva, engineType,
    controlUnit, location, notes } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof status === 'string') patch.status = status;
  if (runningHours !== undefined) patch.running_hours = runningHours;
  if (fuelLevelPct !== undefined) patch.fuel_level_pct = fuelLevelPct;
  if (batteryHealthPct !== undefined) patch.battery_health_pct = batteryHealthPct;
  if (lastServiceDate !== undefined) patch.last_service_date = lastServiceDate || null;
  if (nextServiceDate !== undefined) patch.next_service_date = nextServiceDate || null;
  if (typeof name === 'string') patch.name = name;
  if (code !== undefined) patch.code = code || null;
  if (outputKva !== undefined) patch.output_kva = outputKva || null;
  if (engineType !== undefined) patch.engine_type = engineType || null;
  if (controlUnit !== undefined) patch.control_unit = controlUnit || null;
  if (location !== undefined) patch.location = location || null;
  if (notes !== undefined) patch.notes = notes || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_generators').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Generator not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, generator: data });
});

// DELETE /api/eng-portal/generators/:id
router.delete('/generators/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_generators').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// GET /api/eng-portal/generator-events — optional ?generatorId= ?propertyId=
router.get('/generator-events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_generator_events').select('*').order('event_time', { ascending: false });
  const { generatorId, propertyId } = req.query as Record<string, string>;
  if (generatorId) q = q.eq('generator_id', generatorId);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/generator-events
router.post('/generator-events', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, generatorId, eventType, eventTime, description } = req.body || {};
  if (!eventType) return res.status(400).json({ error: 'eventType is required' });
  const id = `GE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_generator_events').insert({
    id, property_id: propertyId || null, generator_id: generatorId || null,
    event_type: eventType, event_time: eventTime || new Date().toISOString(),
    description: description || null, created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// DELETE /api/eng-portal/generator-events/:id
router.delete('/generator-events/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_generator_events').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// GET /api/eng-portal/utility-alerts — optional ?status= ?propertyId=
router.get('/utility-alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_utility_alerts').select('*').order('detected_at', { ascending: false });
  const { status, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/utility-alerts
router.post('/utility-alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, alertType, severity, sector, description } = req.body || {};
  if (!alertType || !description) return res.status(400).json({ error: 'alertType and description are required' });
  const id = `UA-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_utility_alerts').insert({
    id, property_id: propertyId || null, alert_type: alertType,
    severity: severity || 'Warning', sector: sector || null,
    description, status: 'Active', created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/utility-alerts/:id — resolve / reopen
router.patch('/utility-alerts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, severity, description } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof status === 'string') {
    patch.status = status;
    if (status === 'Resolved') patch.resolved_at = new Date().toISOString();
  }
  if (typeof severity === 'string') patch.severity = severity;
  if (typeof description === 'string') patch.description = description;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_utility_alerts').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, alert: data });
});

// DELETE /api/eng-portal/utility-alerts/:id
router.delete('/utility-alerts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_utility_alerts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Technicians & Staff Management ───────────────────────────────────────
// Backs the /erp/maintenance/staff tab (StaffManagement.tsx).
// Mimics the HK Staff Management pattern (housekeepingPortal.routes.ts /staff/*)
// but adapted for engineering roles. Five resources:
//   1. /technicians       — eng_technicians (roster + KPIs)
//   2. /technicians/shifts    — eng_tech_shifts (shift requirements)
//   3. /technicians/staffing  — eng_tech_staffing (staffing requirements)
//   4. /technicians/training  — eng_tech_training (training records)
//   5. /technicians/productivity — eng_tech_productivity (productivity metrics)

// GET /api/eng-portal/technicians — optional ?propertyId= ?role= ?shift= ?status=
// Joins HR employee data for technicians that have an employee_id link.
router.get('/technicians', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_technicians').select('*').eq('is_active', true).order('name', { ascending: true });
  const { propertyId, role, shift, status } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (role) q = q.eq('role', role);
  if (shift) q = q.eq('shift', shift);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch linked HR employee records.
  const empIds = (data || []).map((t: any) => t.employee_id).filter(Boolean);
  let employeesById: Record<string, any> = {};
  if (empIds.length > 0) {
    const { data: empRows } = await supabaseAdmin
      .from('employees')
      .select('id, email, phone, hire_date, salary, department, position')
      .in('id', empIds);
    (empRows || []).forEach((e: any) => { employeesById[e.id] = e; });
  }

  const techs = (data || []).map((t: any) => {
    const emp = t.employee_id ? employeesById[t.employee_id] : null;
    return {
      ...t,
      hrEmail: emp?.email || null,
      hrPhone: emp?.phone || null,
      hrHireDate: emp?.hire_date || null,
      hrSalary: emp?.salary ?? null,
      hrDepartment: emp?.department || 'Engineering',
      hrPosition: emp?.position || t.role,
    };
  });
  return res.json(techs);
});

// GET /api/eng-portal/technicians/available-employees?propertyId=
// Lists HR employees in the Engineering department not yet linked to a technician.
router.get('/technicians/available-employees', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;

  // Get all employee_ids already linked to eng_technicians.
  const { data: linkedRows } = await supabaseAdmin
    .from('eng_technicians')
    .select('employee_id')
    .not('employee_id', 'is', null);
  const linkedIds = (linkedRows || []).map((r: any) => r.employee_id);

  let q = supabaseAdmin
    .from('employees')
    .select('id, name, email, phone, position, hire_date, salary, department')
    .eq('status', 'Active')
    .eq('department', 'Engineering')
    .order('name');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (linkedIds.length > 0) {
    q = q.filter('id', 'not.in', `(${linkedIds.join(',')})`);
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ employees: data || [] });
});

// POST /api/eng-portal/technicians
// Supports HR integration: pass employeeId to link an existing HR employee,
// or pass email/phone/hireDate/salary to create a new HR employee record.
router.post('/technicians', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, role, shift, status, zone, jobsCompleted, avgResponseMin,
    workload, skills, phone, email, hireDate, employeeId, salary } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const id = `ENG-T-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const avatar = name.trim().split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
  const resolvedRole = role || 'General Technician';

  // HR integration — link existing or create new employee record.
  let linkedEmployeeId = employeeId || null;
  let employeeRecord: any = null;

  if (linkedEmployeeId) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .eq('id', linkedEmployeeId).single();
    if (emp) employeeRecord = emp;
    else linkedEmployeeId = null;
  } else if (email || phone || hireDate || salary) {
    const empId = `EMP-ENG-${Date.now()}`;
    const { data: newEmp, error: empError } = await supabaseAdmin
      .from('employees').insert({
        id: empId, name: name.trim(),
        email: email || null, phone: phone || null,
        department: 'Engineering', position: resolvedRole,
        status: 'Active',
        hire_date: hireDate || new Date().toISOString().split('T')[0],
        salary: salary ?? 0, avatar_initials: avatar,
        property_id: propertyId || null,
      }).select('id, email, phone, hire_date, salary, department, position').single();
    if (!empError && newEmp) {
      linkedEmployeeId = empId;
      employeeRecord = newEmp;
    }
  }

  const { data, error } = await supabaseAdmin.from('eng_technicians').insert({
    id, property_id: propertyId || null, name: name.trim(), avatar,
    role: resolvedRole, shift: shift || 'Morning',
    status: status || 'Available', is_active: true, zone: zone || null,
    jobs_completed: jobsCompleted ?? 0, avg_response_min: avgResponseMin ?? 0,
    workload: workload ?? 0, skills: skills || null,
    phone: phone || null, email: email || null, hire_date: hireDate || null,
    employee_id: linkedEmployeeId,
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  cacheService.invalidatePattern('^hr-');
  return res.status(201).json({
    ...data,
    hrEmail: employeeRecord?.email || null,
    hrPhone: employeeRecord?.phone || null,
    hrHireDate: employeeRecord?.hire_date || null,
    hrSalary: employeeRecord?.salary ?? null,
    hrDepartment: employeeRecord?.department || 'Engineering',
    hrPosition: employeeRecord?.position || data.role,
  });
});

// PATCH /api/eng-portal/technicians/:id
// Supports employeeId field for linking/unlinking HR employee records.
router.patch('/technicians/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, role, shift, status, zone, jobsCompleted, avgResponseMin,
    workload, skills, phone, email, isActive, employeeId } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') { patch.name = name; patch.avatar = name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(); }
  if (typeof role === 'string') patch.role = role;
  if (typeof shift === 'string') patch.shift = shift;
  if (typeof status === 'string') patch.status = status;
  if (zone !== undefined) patch.zone = zone || null;
  if (jobsCompleted !== undefined) patch.jobs_completed = jobsCompleted;
  if (avgResponseMin !== undefined) patch.avg_response_min = avgResponseMin;
  if (workload !== undefined) patch.workload = workload;
  if (skills !== undefined) patch.skills = skills;
  if (phone !== undefined) patch.phone = phone || null;
  if (email !== undefined) patch.email = email || null;
  if (typeof isActive === 'boolean') patch.is_active = isActive;
  if (employeeId !== undefined) patch.employee_id = employeeId || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_technicians').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Technician not found' });
  cacheService.invalidate('eng-*');
  cacheService.invalidatePattern('^hr-');

  // Fetch linked HR employee for the response.
  let employeeRecord: any = null;
  if (data.employee_id) {
    const { data: emp } = await supabaseAdmin
      .from('employees').select('id, email, phone, hire_date, salary, department, position')
      .eq('id', data.employee_id).single();
    if (emp) employeeRecord = emp;
  }
  return res.json({
    success: true,
    technician: {
      ...data,
      hrEmail: employeeRecord?.email || null,
      hrPhone: employeeRecord?.phone || null,
      hrHireDate: employeeRecord?.hire_date || null,
      hrSalary: employeeRecord?.salary ?? null,
      hrDepartment: employeeRecord?.department || 'Engineering',
      hrPosition: employeeRecord?.position || data.role,
    },
  });
});

// DELETE /api/eng-portal/technicians/:id
router.delete('/technicians/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_technicians').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Shifts ───────────────────────────────────────────────────────────────
// GET /api/eng-portal/technicians/shifts — optional ?propertyId=
router.get('/technicians/shifts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_tech_shifts').select('*').order('shift', { ascending: true });
  const { propertyId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/technicians/shifts
router.post('/technicians/shifts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, name, shift, startTime, endTime, assignedStaff, requiredStaff } = req.body || {};
  if (!name?.trim() || !shift || !startTime || !endTime) {
    return res.status(400).json({ error: 'name, shift, startTime, endTime are required' });
  }
  const id = `ETS-${Date.now()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_tech_shifts').insert({
    id, property_id: propertyId || null, name: name.trim(), shift,
    start_time: startTime, end_time: endTime,
    assigned_staff: assignedStaff ?? 0, required_staff: requiredStaff ?? 1,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/technicians/shifts/:id
router.patch('/technicians/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { name, shift, startTime, endTime, assignedStaff, requiredStaff } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof shift === 'string') patch.shift = shift;
  if (typeof startTime === 'string') patch.start_time = startTime;
  if (typeof endTime === 'string') patch.end_time = endTime;
  if (assignedStaff !== undefined) patch.assigned_staff = assignedStaff;
  if (requiredStaff !== undefined) patch.required_staff = requiredStaff;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_tech_shifts').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Shift not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, shift: data });
});

// DELETE /api/eng-portal/technicians/shifts/:id
router.delete('/technicians/shifts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_tech_shifts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Staffing ─────────────────────────────────────────────────────────────
// GET /api/eng-portal/technicians/staffing — optional ?propertyId=
router.get('/technicians/staffing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_tech_staffing').select('*').order('role', { ascending: true });
  const { propertyId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/technicians/staffing
router.post('/technicians/staffing', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, role, zone, shift, requiredCount, assignedCount } = req.body || {};
  if (!role?.trim() || !shift) return res.status(400).json({ error: 'role and shift are required' });
  const id = `ETSF-${Date.now()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_tech_staffing').insert({
    id, property_id: propertyId || null, role: role.trim(), zone: zone || null, shift,
    required_count: requiredCount ?? 1, assigned_count: assignedCount ?? 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/technicians/staffing/:id
router.patch('/technicians/staffing/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { role, zone, shift, requiredCount, assignedCount } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof role === 'string') patch.role = role;
  if (zone !== undefined) patch.zone = zone || null;
  if (typeof shift === 'string') patch.shift = shift;
  if (requiredCount !== undefined) patch.required_count = requiredCount;
  if (assignedCount !== undefined) patch.assigned_count = assignedCount;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_tech_staffing').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Staffing record not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, staffing: data });
});

// DELETE /api/eng-portal/technicians/staffing/:id
router.delete('/technicians/staffing/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_tech_staffing').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Training ─────────────────────────────────────────────────────────────
// GET /api/eng-portal/technicians/training — optional ?propertyId= ?technicianId=
router.get('/technicians/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_tech_training').select('*').order('due_date', { ascending: true });
  const { propertyId, technicianId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (technicianId) q = q.eq('technician_id', technicianId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/technicians/training
router.post('/technicians/training', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, technicianId, course, dueDate, status } = req.body || {};
  if (!course?.trim()) return res.status(400).json({ error: 'course is required' });
  const id = `ETT-${Date.now()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_tech_training').insert({
    id, property_id: propertyId || null, technician_id: technicianId || null,
    course: course.trim(), due_date: dueDate || null,
    status: status || 'Not Started',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/technicians/training/:id
router.patch('/technicians/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { course, dueDate, status, technicianId } = req.body || {};
  const patch: Record<string, any> = {};
  if (typeof course === 'string') patch.course = course;
  if (dueDate !== undefined) patch.due_date = dueDate || null;
  if (typeof status === 'string') patch.status = status;
  if (technicianId !== undefined) patch.technician_id = technicianId || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_tech_training').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Training record not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, training: data });
});

// DELETE /api/eng-portal/technicians/training/:id
router.delete('/technicians/training/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_tech_training').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Productivity ─────────────────────────────────────────────────────────
// GET /api/eng-portal/technicians/productivity — optional ?propertyId= ?technicianId=
router.get('/technicians/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('eng_tech_productivity').select('*').order('period_date', { ascending: false });
  const { propertyId, technicianId } = req.query as Record<string, string>;
  if (propertyId) q = q.eq('property_id', propertyId);
  if (technicianId) q = q.eq('technician_id', technicianId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/technicians/productivity
router.post('/technicians/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, technicianId, jobsCompleted, hours, avgResponseMin, productivityScore, periodDate } = req.body || {};
  const id = `ETP-${Date.now()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const { data, error } = await supabaseAdmin.from('eng_tech_productivity').insert({
    id, property_id: propertyId || null, technician_id: technicianId || null,
    jobs_completed: jobsCompleted ?? 0, hours: hours ?? 0,
    avg_response_min: avgResponseMin ?? 0,
    productivity_score: productivityScore ?? 0, period_date: periodDate || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/technicians/productivity/:id
router.patch('/technicians/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { jobsCompleted, hours, avgResponseMin, productivityScore, periodDate } = req.body || {};
  const patch: Record<string, any> = {};
  if (jobsCompleted !== undefined) patch.jobs_completed = jobsCompleted;
  if (hours !== undefined) patch.hours = hours;
  if (avgResponseMin !== undefined) patch.avg_response_min = avgResponseMin;
  if (productivityScore !== undefined) patch.productivity_score = productivityScore;
  if (periodDate !== undefined) patch.period_date = periodDate || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields supplied' });
  const { data, error } = await supabaseAdmin.from('eng_tech_productivity').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Productivity record not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, productivity: data });
});

// DELETE /api/eng-portal/technicians/productivity/:id
router.delete('/technicians/productivity/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_tech_productivity').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Technician Attendance ────────────────────────────────────────────────
// Uses the shared staff_attendance table (migration 287/288/289) with
// department_scope='ENG' (migration 340). Mimics the HK attendance routes
// (housekeepingPortal.routes.ts /attendance/*) but scoped to ENG.
//
// Routes:
//   GET    /technicians/attendance/summary   — grouped by technician (with rates)
//   GET    /technicians/attendance           — flat list (optional ?date=)
//   POST   /technicians/attendance           — check-in (upsert per staff+date)
//   PATCH  /technicians/attendance/:id       — check-out / status / hours
//   DELETE /technicians/attendance/:id       — delete record

const ENG_ATT_SHIFTS = new Set(['Morning', 'Evening', 'Night']);
const ENG_ATT_STATUSES = new Set([
  'Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Half Day',
  'Day Off', 'Public Holiday', 'Work From Home', 'Mission', 'Training Day',
]);

function shapeEngAttendance(row: any) {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    departmentScope: row.department_scope,
    employeeId: row.employee_id || null,
    attendanceDate: row.attendance_date,
    shift: row.shift,
    checkIn: row.check_in || null,
    checkOut: row.check_out || null,
    status: row.status,
    hoursWorked: Number(row.hours_worked) || 0,
    overtimeHours: Number(row.overtime_hours) || 0,
    notes: row.notes || null,
  };
}

// GET /api/eng-portal/technicians/attendance/summary?propertyId=
router.get('/technicians/attendance/summary', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  const { data, error } = await supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('property_id', propertyId)
    .eq('department_scope', 'ENG')
    .order('staff_name')
    .order('attendance_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const byStaff: Record<string, any> = {};
  for (const row of data || []) {
    if (!byStaff[row.staff_id]) {
      byStaff[row.staff_id] = {
        staffId: row.staff_id, staffName: row.staff_name, employeeId: row.employee_id || null,
        records: [],
        present: 0, late: 0, absent: 0, onLeave: 0, sick: 0, halfDay: 0,
        dayOff: 0, publicHoliday: 0, workFromHome: 0, mission: 0, trainingDay: 0,
        totalHours: 0, totalOvertime: 0, totalDays: 0,
      };
    }
    const s = byStaff[row.staff_id];
    s.totalDays++;
    s.totalHours += Number(row.hours_worked) || 0;
    s.totalOvertime += Number(row.overtime_hours) || 0;
    s.records.push(shapeEngAttendance(row));
    switch (row.status) {
      case 'Present': s.present++; break;
      case 'Late': s.late++; break;
      case 'Absent': s.absent++; break;
      case 'On Leave': s.onLeave++; break;
      case 'Sick': s.sick++; break;
      case 'Half Day': s.halfDay++; break;
      case 'Day Off': s.dayOff++; break;
      case 'Public Holiday': s.publicHoliday++; break;
      case 'Work From Home': s.workFromHome++; break;
      case 'Mission': s.mission++; break;
      case 'Training Day': s.trainingDay++; break;
    }
  }

  const summary = Object.values(byStaff).map((s: any) => ({
    ...s,
    attendanceRate: s.totalDays > 0
      ? Math.round(((s.present + s.late) / s.totalDays) * 100) : 0,
  }));

  return res.json({
    propertyId,
    summary,
    totals: {
      staffCount: summary.length,
      totalHours: summary.reduce((sum: number, s: any) => sum + s.totalHours, 0),
      totalOvertime: summary.reduce((sum: number, s: any) => sum + s.totalOvertime, 0),
      avgAttendanceRate: summary.length > 0
        ? Math.round(summary.reduce((sum: number, s: any) => sum + s.attendanceRate, 0) / summary.length) : 0,
    },
  });
});

// GET /api/eng-portal/technicians/attendance?propertyId=&date=
router.get('/technicians/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, date } = req.query as Record<string, string>;
  if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });
  let q = supabaseAdmin
    .from('staff_attendance').select('*')
    .eq('property_id', propertyId)
    .eq('department_scope', 'ENG')
    .order('attendance_date', { ascending: false })
    .order('staff_name');
  if (date) q = q.eq('attendance_date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const records = (data || []).map(shapeEngAttendance);
  return res.json({
    propertyId,
    attendance: records,
    summary: {
      total: records.length,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      onLeave: records.filter(r => r.status === 'On Leave' || r.status === 'Sick').length,
      totalHours: records.reduce((s, r) => s + r.hoursWorked, 0),
      totalOvertime: records.reduce((s, r) => s + r.overtimeHours, 0),
    },
  });
});

// POST /api/eng-portal/technicians/attendance — check-in (upsert per staff+date)
router.post('/technicians/attendance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, staffId, staffName, shift, status, checkIn, notes, attendanceDate } = req.body || {};
  if (!propertyId || !staffId || !staffName) {
    return res.status(400).json({ error: 'propertyId, staffId, staffName are required' });
  }
  if (shift && !ENG_ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });
  if (status && !ENG_ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });

  const today = attendanceDate || new Date().toISOString().split('T')[0];
  const id = `ATT-ENG-${staffId}-${today}`;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').upsert({
      id, property_id: propertyId, staff_id: staffId, staff_name: staffName,
      department_scope: 'ENG', attendance_date: today,
      shift: shift || 'Morning', status: status || 'Present',
      check_in: checkIn || new Date().toISOString(),
      hours_worked: 0, overtime_hours: 0, notes: notes || null,
    }, { onConflict: 'staff_id,attendance_date' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(shapeEngAttendance(data));
});

// PATCH /api/eng-portal/technicians/attendance/:id — check-out / status / hours
router.patch('/technicians/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, shift, notes } = req.body || {};
  if (status && !ENG_ATT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
  if (shift && !ENG_ATT_SHIFTS.has(shift)) return res.status(400).json({ error: 'Invalid shift' });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (checkIn !== undefined) patch.check_in = checkIn;
  if (checkOut !== undefined) patch.check_out = checkOut;
  if (hoursWorked !== undefined) patch.hours_worked = Number(hoursWorked);
  if (overtimeHours !== undefined) patch.overtime_hours = Number(overtimeHours);
  if (shift !== undefined) patch.shift = shift;
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('staff_attendance').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Attendance record not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, attendance: shapeEngAttendance(data) });
});

// DELETE /api/eng-portal/technicians/attendance/:id
router.delete('/technicians/attendance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('staff_attendance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Safety & Regulatory Compliance ───────────────────────────────────────
// Backs the /erp/maintenance/compliance tab (ComplianceModule.tsx).
// Flow: Scheduled → In Progress → Valid → (Overdue | Expired | Failed).
// Overdue is auto-derived: any Valid/Scheduled item whose expiry_date has
// passed is flipped to Overdue server-side on each GET.
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management
// console (/erp/maintenance/workorders). Typically used when an item
// Fails or goes Overdue and a remediation WO is needed.

// GET /api/eng-portal/compliance
// Optional query: ?status= ?category= ?type= ?priority= ?propertyId=
router.get('/compliance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Auto-advance: Valid/Scheduled items past their expiry_date → Overdue.
  await supabaseAdmin
    .from('eng_compliance_items')
    .update({ status: 'Overdue' })
    .in('status', ['Valid', 'Scheduled'])
    .lt('expiry_date', new Date().toISOString());

  let q = supabaseAdmin
    .from('eng_compliance_items')
    .select('*')
    .order('expiry_date', { ascending: false });

  const { status, category, type, priority, propertyId } = req.query as Record<string, string>;
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  if (type) q = q.eq('type', type);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/eng-portal/compliance
router.post('/compliance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, title, category, type, authority, priority,
    certificateNumber, issueDate, expiryDate, nextInspectionDate,
    responsiblePerson, notes,
  } = req.body || {};

  if (!title || !category || !type || !authority) {
    return res.status(400).json({ error: 'title, category, type, and authority are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const id = `COMP-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const compNumber = `COMP-${new Date().getFullYear()}-${seq}`;

  const { data, error } = await supabaseAdmin.from('eng_compliance_items').insert({
    id,
    property_id: propertyId || null,
    comp_number: compNumber,
    title,
    category,
    type,
    authority,
    priority: priority || 'Normal',
    certificate_number: certificateNumber || null,
    issue_date: issueDate || null,
    expiry_date: expiryDate || null,
    next_inspection_date: nextInspectionDate || null,
    responsible_person: responsiblePerson || null,
    notes: notes || null,
    status: 'Scheduled',
    created_by: req.user?.id,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.status(201).json(data);
});

// PATCH /api/eng-portal/compliance/:id
// Generic update (status transition + optional fields).
// Sets the matching timestamp column when status changes.
router.patch('/compliance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    status, priority, certificateNumber, issueDate, expiryDate,
    lastInspectedDate, nextInspectionDate, responsiblePerson, result, notes,
  } = req.body || {};

  const updateData: any = {};
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'In Progress') updateData.in_progress_at = now;
    if (status === 'Valid') {
      updateData.verified_at = now;
      updateData.last_inspected_date = lastInspectedDate || now;
    }
    if (status === 'Failed') updateData.failed_at = now;
  }
  if (priority !== undefined) updateData.priority = priority;
  if (certificateNumber !== undefined) updateData.certificate_number = certificateNumber;
  if (issueDate !== undefined) updateData.issue_date = issueDate;
  if (expiryDate !== undefined) updateData.expiry_date = expiryDate;
  if (lastInspectedDate !== undefined) updateData.last_inspected_date = lastInspectedDate;
  if (nextInspectionDate !== undefined) updateData.next_inspection_date = nextInspectionDate;
  if (responsiblePerson !== undefined) updateData.responsible_person = responsiblePerson;
  if (result !== undefined) updateData.result = result;
  if (notes !== undefined) updateData.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('eng_compliance_items')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Compliance item not found' });
  cacheService.invalidate('eng-*');
  return res.json({ success: true, item: data });
});

// POST /api/eng-portal/compliance/:id/convert-to-wo
// Converts a compliance item into a real work_order row, links it back via
// converted_work_order_id. Integrates with the Work Order Management
// console. Typically used when an item Fails or goes Overdue and a
// remediation / renewal WO is needed.
router.post('/compliance/:id/convert-to-wo', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { assignedTo, scheduledDate, notes } = req.body || {};

  const { data: item, error: cErr } = await supabaseAdmin
    .from('eng_compliance_items')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!item) return res.status(404).json({ error: 'Compliance item not found' });
  if (item.converted_work_order_id) {
    return res.status(409).json({ error: 'Compliance item already converted to a work order' });
  }

  const woId = `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;
  const { data: wo, error: woErr } = await supabaseAdmin.from('work_orders').insert({
    id: woId,
    wo_number: woNumber,
    title: `Compliance: ${item.title} — ${item.type}`,
    description: item.notes
      ? `${item.title} (${item.category} / ${item.authority})\n\n${item.notes}`
      : `${item.title} (${item.category} / ${item.authority})`,
    type: 'Compliance',
    priority: item.priority,
    status: 'Open',
    assigned_to: assignedTo || item.responsible_person || null,
    scheduled_date: scheduledDate || null,
    notes: notes || `Converted from compliance item ${item.comp_number}`,
    created_by: req.user?.id,
  }).select().single();
  if (woErr) return res.status(500).json({ error: woErr.message });

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('eng_compliance_items')
    .update({ converted_work_order_id: woId })
    .eq('id', req.params.id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  cacheService.invalidate('eng-*');
  return res.status(201).json({ success: true, item: updated, workOrder: wo });
});

// DELETE /api/eng-portal/compliance/:id
router.delete('/compliance/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('eng_compliance_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('eng-*');
  return res.json({ success: true });
});

// ── Engineering Reports Registry ─────────────────────────────────────────
// Backs the /erp/maintenance/reports screen. Mimics the Housekeeping reports
// pattern (hk_reports / housekeepingPortal.routes.ts / HKReportsModule.tsx).
// Read/write over the `eng_reports` registry table (migration 342).
//   - GET  /reports           list reports (optional ?category=)
//   - GET  /reports/stats     aggregated KPI counts
//   - GET  /reports/:id       fetch a single report
//   - GET  /reports/:id/data  generate real report data (sections + summary)
//   - POST /reports/:id/run   re-run a single report (status Ready + last_run = now)
//   - POST /reports/run-all   queue all reports for refresh
//   - PATCH /reports/:id      update frequency / format / status

const ENG_REPORT_CATEGORIES = ['operational', 'compliance', 'assets', 'staff'] as const;
const ENG_REPORT_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const ENG_REPORT_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

const ENG_REPORT_SELECT = 'id, category, name, description, last_run, status, format, frequency, updated_at';

// ── Report data generator ─────────────────────────────────────────────────
// Each report ID maps to a generator that queries real tables and returns
// { sections: ReportSection[], summary: Record<string, any> }.
// A ReportSection is { title, columns, rows } — the frontend renders these
// as tables in the View modal and exports them as PDF/Excel/CSV.

interface ReportDataSection {
  title: string;
  columns: string[];
  rows: Record<string, any>[];
}
interface ReportDataResult {
  sections: ReportDataSection[];
  summary: Record<string, any>;
}

function filterByDateRange(rows: any[], dateField: string, from?: string, to?: string): any[] {
  return rows.filter((r) => {
    const v = r[dateField];
    if (!v) return false;
    const d = typeof v === 'string' ? v.split('T')[0] : new Date(v).toISOString().split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function countBy<T extends Record<string, any>>(rows: T[], field: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[field] ?? 'Unknown');
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function countByToRows(counts: Record<string, number>, labelCol: string, valCol: string): Record<string, any>[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ [labelCol]: k, [valCol]: v }));
}

type ReportGenerator = (propertyId: string | undefined, dateFrom: string, dateTo: string) => Promise<ReportDataResult>;

// ── Operational report generators ─────────────────────────────────────────

const genWorkOrderSummary: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('work_orders').select('id, wo_number, title, type, priority, status, assigned_to, created_date, completed_at, actual_cost');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'created_date', dateFrom, dateTo);
  const byStatus = countBy(rows, 'status');
  const byPriority = countBy(rows, 'priority');
  const byType = countBy(rows, 'type');
  const totalCost = rows.reduce((s, r) => s + (Number(r.actual_cost) || 0), 0);
  return {
    sections: [
      { title: 'Work Orders by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Work Orders by Priority', columns: ['Priority', 'Count'], rows: countByToRows(byPriority, 'Priority', 'Count') },
      { title: 'Work Orders by Type', columns: ['Type', 'Count'], rows: countByToRows(byType, 'Type', 'Count') },
      { title: 'All Work Orders', columns: ['WO Number', 'Title', 'Type', 'Priority', 'Status', 'Assignee', 'Created', 'Cost'], rows: rows.map(r => ({ 'WO Number': r.wo_number || r.id, 'Title': r.title, 'Type': r.type, 'Priority': r.priority, 'Status': r.status, 'Assignee': r.assigned_to || '—', 'Created': r.created_date, 'Cost': r.actual_cost || 0 })) },
    ],
    summary: { total: rows.length, totalCost, byStatus, byPriority },
  };
};

const genPmCompliance: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('pm_schedules').select('id, schedule_name, frequency, next_due_date, last_completed_date, status, priority, assigned_technician');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const now = new Date();
  const active = rows.filter((r: any) => r.status === 'Active');
  const overdue = active.filter((r: any) => r.next_due_date && new Date(r.next_due_date) < now);
  const compliancePct = active.length > 0 ? Math.round(((active.length - overdue.length) / active.length) * 100) : 100;
  return {
    sections: [
      { title: 'PM Compliance Summary', columns: ['Metric', 'Value'], rows: [
        { 'Metric': 'Total Schedules', 'Value': rows.length },
        { 'Metric': 'Active', 'Value': active.length },
        { 'Metric': 'Overdue', 'Value': overdue.length },
        { 'Metric': 'Compliance %', 'Value': compliancePct + '%' },
      ]},
      { title: 'Overdue PM Schedules', columns: ['Schedule', 'Frequency', 'Due Date', 'Priority', 'Assignee'], rows: overdue.map((r: any) => ({ 'Schedule': r.schedule_name, 'Frequency': r.frequency, 'Due Date': r.next_due_date, 'Priority': r.priority, 'Assignee': r.assigned_technician || '—' })) },
      { title: 'All PM Schedules', columns: ['Schedule', 'Frequency', 'Next Due', 'Last Completed', 'Status', 'Priority'], rows: rows.map((r: any) => ({ 'Schedule': r.schedule_name, 'Frequency': r.frequency, 'Next Due': r.next_due_date || '—', 'Last Completed': r.last_completed_date || '—', 'Status': r.status, 'Priority': r.priority })) },
    ],
    summary: { total: rows.length, active: active.length, overdue: overdue.length, compliancePct },
  };
};

const genCorrectiveSummary: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('corrective_maintenance_tasks').select('id, cm_number, type, category, priority, status, location, room_number, reported_date, completed_at, downtime, actual_cost, assigned_technician');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'reported_date', dateFrom, dateTo);
  const byCategory = countBy(rows, 'category');
  const byPriority = countBy(rows, 'priority');
  const byStatus = countBy(rows, 'status');
  const totalDowntime = rows.reduce((s, r) => s + (Number(r.downtime) || 0), 0);
  const totalCost = rows.reduce((s, r) => s + (Number(r.actual_cost) || 0), 0);
  return {
    sections: [
      { title: 'Corrective Tasks by Category', columns: ['Category', 'Count'], rows: countByToRows(byCategory, 'Category', 'Count') },
      { title: 'Corrective Tasks by Priority', columns: ['Priority', 'Count'], rows: countByToRows(byPriority, 'Priority', 'Count') },
      { title: 'Corrective Tasks by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'All Corrective Tasks', columns: ['CM Number', 'Type', 'Category', 'Priority', 'Status', 'Location', 'Downtime (h)', 'Cost'], rows: rows.map(r => ({ 'CM Number': r.cm_number || r.id, 'Type': r.type, 'Category': r.category, 'Priority': r.priority, 'Status': r.status, 'Location': r.location || r.room_number || '—', 'Downtime (h)': r.downtime || 0, 'Cost': r.actual_cost || 0 })) },
    ],
    summary: { total: rows.length, totalDowntime, totalCost },
  };
};

const genRoomMaintenance: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('eng_room_issues').select('id, ri_number, room_number, category, description, status, priority, blocks_room, reported_by, assigned_to, created_at, resolved_at');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'created_at', dateFrom, dateTo);
  const byStatus = countBy(rows, 'status');
  const byPriority = countBy(rows, 'priority');
  const byCategory = countBy(rows, 'category');
  const blocking = rows.filter((r: any) => r.blocks_room === true);
  return {
    sections: [
      { title: 'Room Issues by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Room Issues by Priority', columns: ['Priority', 'Count'], rows: countByToRows(byPriority, 'Priority', 'Count') },
      { title: 'Room Issues by Category', columns: ['Category', 'Count'], rows: countByToRows(byCategory, 'Category', 'Count') },
      { title: 'All Room Issues', columns: ['RI Number', 'Room', 'Category', 'Priority', 'Status', 'Blocks Room', 'Assignee'], rows: rows.map(r => ({ 'RI Number': r.ri_number || r.id, 'Room': r.room_number, 'Category': r.category, 'Priority': r.priority, 'Status': r.status, 'Blocks Room': r.blocks_room ? 'Yes' : 'No', 'Assignee': r.assigned_to || '—' })) },
    ],
    summary: { total: rows.length, blocking: blocking.length },
  };
};

const genBuildingMaintenance: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('building_maintenance_tasks').select('id, bm_number, area, location, task_type, priority, status, assigned_to, scheduled_date, estimated_cost, actual_cost, completion_date');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'scheduled_date', dateFrom, dateTo);
  const byStatus = countBy(rows, 'status');
  const byArea = countBy(rows, 'area');
  const totalEst = rows.reduce((s, r) => s + (Number(r.estimated_cost) || 0), 0);
  const totalActual = rows.reduce((s, r) => s + (Number(r.actual_cost) || 0), 0);
  return {
    sections: [
      { title: 'Building Tasks by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Building Tasks by Area', columns: ['Area', 'Count'], rows: countByToRows(byArea, 'Area', 'Count') },
      { title: 'All Building Tasks', columns: ['BM Number', 'Area', 'Type', 'Priority', 'Status', 'Est. Cost', 'Actual Cost'], rows: rows.map(r => ({ 'BM Number': r.bm_number || r.id, 'Area': r.area, 'Type': r.task_type, 'Priority': r.priority, 'Status': r.status, 'Est. Cost': r.estimated_cost || 0, 'Actual Cost': r.actual_cost || 0 })) },
    ],
    summary: { total: rows.length, totalEst, totalActual },
  };
};

const genUtilitiesConsumption: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('eng_utility_readings').select('id, reading_date, utility_type, value, unit, reading_by, notes');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'reading_date', dateFrom, dateTo);
  const byType: Record<string, { count: number; total: number; unit: string }> = {};
  for (const r of rows) {
    const t = r.utility_type || 'Unknown';
    if (!byType[t]) byType[t] = { count: 0, total: 0, unit: r.unit || '' };
    byType[t].count++;
    byType[t].total += Number(r.value) || 0;
    byType[t].unit = r.unit || byType[t].unit;
  }
  return {
    sections: [
      { title: 'Consumption by Utility Type', columns: ['Utility Type', 'Readings', 'Total Consumption', 'Unit'], rows: Object.entries(byType).map(([k, v]) => ({ 'Utility Type': k, 'Readings': v.count, 'Total Consumption': v.total, 'Unit': v.unit })) },
      { title: 'All Utility Readings', columns: ['Date', 'Type', 'Value', 'Unit', 'Read By'], rows: rows.map(r => ({ 'Date': r.reading_date, 'Type': r.utility_type, 'Value': r.value, 'Unit': r.unit, 'Read By': r.reading_by || '—' })) },
    ],
    summary: { total: rows.length, byType },
  };
};

// ── Compliance report generators ──────────────────────────────────────────

const genSafetyCompliance: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_compliance_items').select('id, comp_number, title, category, type, authority, status, priority, certificate_number, issue_date, expiry_date, last_inspected_date, next_inspection_date, responsible_person, result');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const byStatus = countBy(rows, 'status');
  const byCategory = countBy(rows, 'category');
  const now = new Date();
  const expired = rows.filter((r: any) => r.expiry_date && new Date(r.expiry_date) < now);
  return {
    sections: [
      { title: 'Compliance Items by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Compliance Items by Category', columns: ['Category', 'Count'], rows: countByToRows(byCategory, 'Category', 'Count') },
      { title: 'Expired / Expiring Items', columns: ['Title', 'Category', 'Expiry Date', 'Status'], rows: expired.map((r: any) => ({ 'Title': r.title, 'Category': r.category, 'Expiry Date': r.expiry_date, 'Status': r.status })) },
      { title: 'All Compliance Items', columns: ['Title', 'Category', 'Authority', 'Status', 'Expiry Date', 'Responsible'], rows: rows.map(r => ({ 'Title': r.title, 'Category': r.category, 'Authority': r.authority || '—', 'Status': r.status, 'Expiry Date': r.expiry_date || '—', 'Responsible': r.responsible_person || '—' })) },
    ],
    summary: { total: rows.length, expired: expired.length, byStatus },
  };
};

const genCalibrationReport: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_calibrations').select('id, cal_number, equipment_name, instrument_type, location, status, priority, scheduled_date, completed_date, calibrated_by, current_reading, tolerance, deviation, next_due_date');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const byStatus = countBy(rows, 'status');
  const byType = countBy(rows, 'instrument_type');
  const overdue = rows.filter((r: any) => r.next_due_date && new Date(r.next_due_date) < new Date());
  return {
    sections: [
      { title: 'Calibrations by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Calibrations by Instrument Type', columns: ['Instrument Type', 'Count'], rows: countByToRows(byType, 'Instrument Type', 'Count') },
      { title: 'Overdue Calibrations', columns: ['Equipment', 'Type', 'Next Due', 'Status'], rows: overdue.map((r: any) => ({ 'Equipment': r.equipment_name, 'Type': r.instrument_type, 'Next Due': r.next_due_date, 'Status': r.status })) },
      { title: 'All Calibrations', columns: ['Equipment', 'Type', 'Status', 'Reading', 'Tolerance', 'Deviation', 'Next Due'], rows: rows.map(r => ({ 'Equipment': r.equipment_name, 'Type': r.instrument_type, 'Status': r.status, 'Reading': r.current_reading || '—', 'Tolerance': r.tolerance || '—', 'Deviation': r.deviation || '—', 'Next Due': r.next_due_date || '—' })) },
    ],
    summary: { total: rows.length, overdue: overdue.length },
  };
};

const genInspectionReport: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_inspections').select('id, ins_number, type, category, location, room_number, status, priority, scheduled_date, completed_date, inspector, findings, next_due_date');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const byStatus = countBy(rows, 'status');
  const byType = countBy(rows, 'type');
  const passed = rows.filter((r: any) => r.status === 'Completed' || r.status === 'Verified').length;
  const failed = rows.filter((r: any) => r.status === 'Failed').length;
  return {
    sections: [
      { title: 'Inspections by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Inspections by Type', columns: ['Type', 'Count'], rows: countByToRows(byType, 'Type', 'Count') },
      { title: 'All Inspections', columns: ['Ins Number', 'Type', 'Category', 'Location', 'Status', 'Inspector', 'Findings', 'Next Due'], rows: rows.map(r => ({ 'Ins Number': r.ins_number || r.id, 'Type': r.type, 'Category': r.category, 'Location': r.location || r.room_number || '—', 'Status': r.status, 'Inspector': r.inspector || '—', 'Findings': (r.findings || '').slice(0, 80), 'Next Due': r.next_due_date || '—' })) },
    ],
    summary: { total: rows.length, passed, failed },
  };
};

const genRegulatoryCertificates: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_compliance_items').select('id, title, category, authority, status, certificate_number, issue_date, expiry_date, next_inspection_date, responsible_person');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const now = new Date();
  const expired = rows.filter((r: any) => r.expiry_date && new Date(r.expiry_date) < now);
  const expiringSoon = rows.filter((r: any) => {
    if (!r.expiry_date) return false;
    const exp = new Date(r.expiry_date);
    const days = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 30;
  });
  return {
    sections: [
      { title: 'Expired Certificates', columns: ['Title', 'Category', 'Expiry Date', 'Authority'], rows: expired.map((r: any) => ({ 'Title': r.title, 'Category': r.category, 'Expiry Date': r.expiry_date, 'Authority': r.authority || '—' })) },
      { title: 'Expiring Within 30 Days', columns: ['Title', 'Category', 'Expiry Date', 'Days Left'], rows: expiringSoon.map((r: any) => ({ 'Title': r.title, 'Category': r.category, 'Expiry Date': r.expiry_date, 'Days Left': Math.ceil((new Date(r.expiry_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) })) },
      { title: 'All Certificates', columns: ['Title', 'Cert Number', 'Category', 'Status', 'Issue Date', 'Expiry Date', 'Responsible'], rows: rows.map(r => ({ 'Title': r.title, 'Cert Number': r.certificate_number || '—', 'Category': r.category, 'Status': r.status, 'Issue Date': r.issue_date || '—', 'Expiry Date': r.expiry_date || '—', 'Responsible': r.responsible_person || '—' })) },
    ],
    summary: { total: rows.length, expired: expired.length, expiringSoon: expiringSoon.length },
  };
};

const genAuditReadiness: ReportGenerator = async (propertyId) => {
  const [woR, compR, pmR, inspR, calR] = await Promise.all([
    supabaseAdmin!.from('work_orders').select('id, status').eq(...(propertyId ? ['property_id', propertyId] : ['id', 'not.null'] as any)),
    supabaseAdmin!.from('eng_compliance_items').select('id, status, expiry_date').eq(...(propertyId ? ['property_id', propertyId] : ['id', 'not.null'] as any)),
    supabaseAdmin!.from('pm_schedules').select('id, status, next_due_date').eq(...(propertyId ? ['property_id', propertyId] : ['id', 'not.null'] as any)),
    supabaseAdmin!.from('eng_inspections').select('id, status').eq(...(propertyId ? ['property_id', propertyId] : ['id', 'not.null'] as any)),
    supabaseAdmin!.from('eng_calibrations').select('id, status').eq(...(propertyId ? ['property_id', propertyId] : ['id', 'not.null'] as any)),
  ]);
  const wos = woR.data || [];
  const comps = compR.data || [];
  const pms = pmR.data || [];
  const insps = inspR.data || [];
  const cals = calR.data || [];
  const now = new Date();
  const openWOs = wos.filter((w: any) => !['Completed', 'Verified', 'Closed', 'Cancelled'].includes(w.status)).length;
  const overdueComps = comps.filter((c: any) => ['Overdue', 'Expired', 'Failed'].includes(c.status)).length;
  const overduePMs = pms.filter((p: any) => p.status === 'Active' && p.next_due_date && new Date(p.next_due_date) < now).length;
  const failedInsps = insps.filter((i: any) => i.status === 'Failed').length;
  const overdueCals = cals.filter((c: any) => c.status === 'Overdue' || c.status === 'Failed').length;
  const healthScore = Math.max(0, 100 - (openWOs * 2 + overdueComps * 5 + overduePMs * 3 + failedInsps * 5 + overdueCals * 3));
  return {
    sections: [
      { title: 'Audit Readiness Score', columns: ['Metric', 'Value'], rows: [
        { 'Metric': 'Overall Health Score', 'Value': healthScore + '/100' },
        { 'Metric': 'Open Work Orders', 'Value': openWOs },
        { 'Metric': 'Overdue Compliance Items', 'Value': overdueComps },
        { 'Metric': 'Overdue PM Schedules', 'Value': overduePMs },
        { 'Metric': 'Failed Inspections', 'Value': failedInsps },
        { 'Metric': 'Overdue Calibrations', 'Value': overdueCals },
      ]},
      { title: 'Readiness Assessment', columns: ['Area', 'Status', 'Issues'], rows: [
        { 'Area': 'Work Orders', 'Status': openWOs > 10 ? 'At Risk' : 'OK', 'Issues': openWOs },
        { 'Area': 'Compliance', 'Status': overdueComps > 0 ? 'At Risk' : 'OK', 'Issues': overdueComps },
        { 'Area': 'Preventive Maint.', 'Status': overduePMs > 3 ? 'At Risk' : 'OK', 'Issues': overduePMs },
        { 'Area': 'Inspections', 'Status': failedInsps > 0 ? 'At Risk' : 'OK', 'Issues': failedInsps },
        { 'Area': 'Calibrations', 'Status': overdueCals > 0 ? 'At Risk' : 'OK', 'Issues': overdueCals },
      ]},
    ],
    summary: { healthScore, openWOs, overdueComps, overduePMs, failedInsps, overdueCals },
  };
};

// ── Asset report generators ───────────────────────────────────────────────

const genAssetLifecycle: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('fixed_assets').select('id, asset_code, asset_name, asset_category, location, purchase_date, purchase_cost, salvage_value, useful_life_years, accumulated_depreciation, net_book_value, status');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const byStatus = countBy(rows, 'status');
  const byCategory = countBy(rows, 'asset_category');
  const totalPurchase = rows.reduce((s, r) => s + (Number(r.purchase_cost) || 0), 0);
  const totalNBV = rows.reduce((s, r) => s + (Number(r.net_book_value) || 0), 0);
  return {
    sections: [
      { title: 'Assets by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Assets by Category', columns: ['Category', 'Count'], rows: countByToRows(byCategory, 'Category', 'Count') },
      { title: 'All Assets', columns: ['Code', 'Name', 'Category', 'Location', 'Purchase Cost', 'Accum. Depreciation', 'Net Book Value', 'Status'], rows: rows.map(r => ({ 'Code': r.asset_code || '—', 'Name': r.asset_name, 'Category': r.asset_category, 'Location': r.location || '—', 'Purchase Cost': r.purchase_cost || 0, 'Accum. Depreciation': r.accumulated_depreciation || 0, 'Net Book Value': r.net_book_value || 0, 'Status': r.status })) },
    ],
    summary: { total: rows.length, totalPurchase, totalNBV },
  };
};

const genEquipmentDowntime: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('corrective_maintenance_tasks').select('id, cm_number, type, category, location, room_number, downtime, actual_cost, status, reported_date, completed_at');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'reported_date', dateFrom, dateTo).filter((r: any) => Number(r.downtime) > 0);
  const totalDowntime = rows.reduce((s, r) => s + (Number(r.downtime) || 0), 0);
  const byCategory: Record<string, number> = {};
  for (const r of rows) { const k = r.category || 'Unknown'; byCategory[k] = (byCategory[k] || 0) + (Number(r.downtime) || 0); }
  return {
    sections: [
      { title: 'Downtime by Category', columns: ['Category', 'Downtime (hours)'], rows: Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ 'Category': k, 'Downtime (hours)': v })) },
      { title: 'All Downtime Events', columns: ['CM Number', 'Type', 'Category', 'Location', 'Downtime (h)', 'Cost', 'Status'], rows: rows.map(r => ({ 'CM Number': r.cm_number || r.id, 'Type': r.type, 'Category': r.category, 'Location': r.location || r.room_number || '—', 'Downtime (h)': r.downtime, 'Cost': r.actual_cost || 0, 'Status': r.status })) },
    ],
    summary: { total: rows.length, totalDowntime },
  };
};

const genSparePartsUsage: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('uinv_stock_ledger').select('id, item_id, transaction_type, quantity_in, quantity_out, transaction_date, reference, performed_by, unit_cost, value, reason').eq('store_id', ENG_STORE_ID);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'transaction_date', dateFrom, dateTo).filter((r: any) => r.transaction_type === 'Consumption' || r.transaction_type === 'Issue');
  const totalCost = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const totalQty = rows.reduce((s, r) => s + (Number(r.quantity_out) || 0), 0);
  return {
    sections: [
      { title: 'Parts Usage Summary', columns: ['Metric', 'Value'], rows: [
        { 'Metric': 'Total Transactions', 'Value': rows.length },
        { 'Metric': 'Total Quantity Used', 'Value': totalQty },
        { 'Metric': 'Total Cost', 'Value': totalCost },
      ]},
      { title: 'All Usage Transactions', columns: ['Part ID', 'Type', 'Quantity', 'Date', 'Work Order', 'Technician', 'Cost'], rows: rows.map(r => ({ 'Part ID': r.item_id, 'Type': r.transaction_type, 'Quantity': r.quantity_out, 'Date': r.transaction_date, 'Work Order': r.reference || '—', 'Technician': r.performed_by || '—', 'Cost': r.value || 0 })) },
    ],
    summary: { total: rows.length, totalQty, totalCost },
  };
};

const genEquipmentEfficiency: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('energy_equipment_efficiency').select('id, equipment_name, category, current_efficiency, target_efficiency, status, last_measured');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const byStatus = countBy(rows, 'status');
  const belowTarget = rows.filter((r: any) => Number(r.current_efficiency) < Number(r.target_efficiency));
  return {
    sections: [
      { title: 'Equipment by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Equipment Below Target', columns: ['Equipment', 'Category', 'Current %', 'Target %', 'Gap'], rows: belowTarget.map((r: any) => ({ 'Equipment': r.equipment_name, 'Category': r.category, 'Current %': r.current_efficiency, 'Target %': r.target_efficiency, 'Gap': (Number(r.target_efficiency) - Number(r.current_efficiency)).toFixed(1) })) },
      { title: 'All Equipment', columns: ['Equipment', 'Category', 'Current %', 'Target %', 'Status', 'Last Measured'], rows: rows.map(r => ({ 'Equipment': r.equipment_name, 'Category': r.category, 'Current %': r.current_efficiency, 'Target %': r.target_efficiency, 'Status': r.status, 'Last Measured': r.last_measured || '—' })) },
    ],
    summary: { total: rows.length, belowTarget: belowTarget.length },
  };
};

// ── Staff report generators ───────────────────────────────────────────────

const genTechnicianPerformance: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_technicians').select('id, name, role, shift, status, is_active, jobs_completed, avg_response_min, workload, skills, zone');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = (data || []).filter((r: any) => r.is_active !== false);
  const totalJobs = rows.reduce((s, r) => s + (Number(r.jobs_completed) || 0), 0);
  const avgResponse = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (Number(r.avg_response_min) || 0), 0) / rows.length) : 0;
  return {
    sections: [
      { title: 'Technician Performance Summary', columns: ['Metric', 'Value'], rows: [
        { 'Metric': 'Active Technicians', 'Value': rows.length },
        { 'Metric': 'Total Jobs Completed', 'Value': totalJobs },
        { 'Metric': 'Avg Response Time (min)', 'Value': avgResponse },
      ]},
      { title: 'All Technicians', columns: ['Name', 'Role', 'Shift', 'Zone', 'Jobs Completed', 'Avg Response (min)', 'Workload'], rows: rows.map(r => ({ 'Name': r.name, 'Role': r.role, 'Shift': r.shift, 'Zone': r.zone || '—', 'Jobs Completed': r.jobs_completed || 0, 'Avg Response (min)': r.avg_response_min || 0, 'Workload': r.workload || 0 })) },
    ],
    summary: { total: rows.length, totalJobs, avgResponse },
  };
};

const genShiftReport: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_tech_shifts').select('id, name, shift, start_time, end_time, assigned_staff, required_staff');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const understaffed = rows.filter((r: any) => Number(r.assigned_staff) < Number(r.required_staff));
  return {
    sections: [
      { title: 'Shift Summary', columns: ['Metric', 'Value'], rows: [
        { 'Metric': 'Total Shifts', 'Value': rows.length },
        { 'Metric': 'Understaffed Shifts', 'Value': understaffed.length },
      ]},
      { title: 'All Shifts', columns: ['Name', 'Shift', 'Start', 'End', 'Assigned', 'Required', 'Status'], rows: rows.map(r => ({ 'Name': r.name, 'Shift': r.shift, 'Start': r.start_time, 'End': r.end_time, 'Assigned': r.assigned_staff, 'Required': r.required_staff, 'Status': Number(r.assigned_staff) < Number(r.required_staff) ? 'Understaffed' : 'OK' })) },
    ],
    summary: { total: rows.length, understaffed: understaffed.length },
  };
};

const genOvertimeReport: ReportGenerator = async (propertyId, dateFrom, dateTo) => {
  let q = supabaseAdmin!.from('staff_attendance').select('id, staff_name, attendance_date, shift, hours_worked, overtime_hours, status').eq('department_scope', 'ENG');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = filterByDateRange(data || [], 'attendance_date', dateFrom, dateTo).filter((r: any) => Number(r.overtime_hours) > 0);
  const totalOT = rows.reduce((s, r) => s + (Number(r.overtime_hours) || 0), 0);
  const byStaff: Record<string, number> = {};
  for (const r of rows) { const k = r.staff_name || 'Unknown'; byStaff[k] = (byStaff[k] || 0) + (Number(r.overtime_hours) || 0); }
  return {
    sections: [
      { title: 'Overtime by Technician', columns: ['Technician', 'Overtime Hours'], rows: Object.entries(byStaff).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ 'Technician': k, 'Overtime Hours': v })) },
      { title: 'All Overtime Entries', columns: ['Technician', 'Date', 'Shift', 'Hours Worked', 'OT Hours', 'Status'], rows: rows.map(r => ({ 'Technician': r.staff_name, 'Date': r.attendance_date, 'Shift': r.shift, 'Hours Worked': r.hours_worked, 'OT Hours': r.overtime_hours, 'Status': r.status })) },
    ],
    summary: { total: rows.length, totalOT },
  };
};

const genTrainingRecords: ReportGenerator = async (propertyId) => {
  let q = supabaseAdmin!.from('eng_tech_training').select('id, technician_id, course, due_date, status, created_at');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data } = await q;
  const rows = data || [];
  const byStatus = countBy(rows, 'status');
  const now = new Date();
  const overdue = rows.filter((r: any) => r.due_date && new Date(r.due_date) < now && r.status !== 'Completed');
  return {
    sections: [
      { title: 'Training by Status', columns: ['Status', 'Count'], rows: countByToRows(byStatus, 'Status', 'Count') },
      { title: 'Overdue Training', columns: ['Technician ID', 'Course', 'Due Date', 'Status'], rows: overdue.map((r: any) => ({ 'Technician ID': r.technician_id, 'Course': r.course, 'Due Date': r.due_date, 'Status': r.status })) },
      { title: 'All Training Records', columns: ['Technician ID', 'Course', 'Due Date', 'Status'], rows: rows.map(r => ({ 'Technician ID': r.technician_id, 'Course': r.course, 'Due Date': r.due_date || '—', 'Status': r.status })) },
    ],
    summary: { total: rows.length, overdue: overdue.length },
  };
};

// ── Report generator dispatch map ─────────────────────────────────────────
const REPORT_GENERATORS: Record<string, ReportGenerator> = {
  'eng-work-order-summary': genWorkOrderSummary,
  'eng-pm-compliance': genPmCompliance,
  'eng-corrective-summary': genCorrectiveSummary,
  'eng-room-maintenance': genRoomMaintenance,
  'eng-building-maintenance': genBuildingMaintenance,
  'eng-utilities-consumption': genUtilitiesConsumption,
  'eng-safety-compliance': genSafetyCompliance,
  'eng-calibration-report': genCalibrationReport,
  'eng-inspection-report': genInspectionReport,
  'eng-regulatory-certificates': genRegulatoryCertificates,
  'eng-audit-readiness': genAuditReadiness,
  'eng-asset-lifecycle': genAssetLifecycle,
  'eng-equipment-downtime': genEquipmentDowntime,
  'eng-spare-parts-usage': genSparePartsUsage,
  'eng-equipment-efficiency': genEquipmentEfficiency,
  'eng-technician-performance': genTechnicianPerformance,
  'eng-shift-report': genShiftReport,
  'eng-overtime-report': genOvertimeReport,
  'eng-training-records': genTrainingRecords,
};

// GET /api/eng-portal/reports — list reports (optional ?category=)
router.get('/reports', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const category = req.query.category as string;
  let q = supabaseAdmin.from('eng_reports').select(ENG_REPORT_SELECT).order('id', { ascending: true });
  if (category && (ENG_REPORT_CATEGORIES as readonly string[]).includes(category)) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /api/eng-portal/reports/stats — aggregated KPI counts
router.get('/reports/stats', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('eng_reports').select('category, status');
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const total = rows.length;
  const ready = rows.filter((r: any) => r.status === 'Ready').length;
  const scheduled = rows.filter((r: any) => r.status === 'Scheduled').length;
  const failed = rows.filter((r: any) => r.status === 'Failed').length;
  const byCategory: Record<string, number> = { operational: 0, compliance: 0, assets: 0, staff: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({ total, ready, scheduled, failed, byCategory });
});

// GET /api/eng-portal/reports/:id — fetch a single report
router.get('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('eng_reports').select(ENG_REPORT_SELECT).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// GET /api/eng-portal/reports/:id/data — generate real report data
// Queries live tables based on the report ID, returns sections + summary.
// Optional query params: ?propertyId= &from=YYYY-MM-DD &to=YYYY-MM-DD
router.get('/reports/:id/data', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const reportId = req.params.id;
  const propertyId = (req.query as Record<string, string>).propertyId;
  const dateFrom = (req.query as Record<string, string>).from || '';
  const dateTo = (req.query as Record<string, string>).to || '';
  const generator = REPORT_GENERATORS[reportId];
  if (!generator) {
    return res.status(404).json({ error: `No data generator for report: ${reportId}` });
  }
  try {
    const result = await generator(propertyId, dateFrom, dateTo);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to generate report data' });
  }
});

// POST /api/eng-portal/reports/:id/run — re-run a single report
router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const reportId = req.params.id;
  const propertyId = (req.query as Record<string, string>).propertyId;
  const dateFrom = (req.query as Record<string, string>).from || '';
  const dateTo = (req.query as Record<string, string>).to || '';

  // If a generator exists, run it to verify the report can produce data,
  // then stamp status Ready + last_run. Return the report row + a row count.
  let rowCount: number | undefined;
  const generator = REPORT_GENERATORS[reportId];
  if (generator) {
    try {
      const result = await generator(propertyId, dateFrom, dateTo);
      rowCount = result.sections.reduce((s, sec) => s + sec.rows.length, 0);
    } catch {
      // Non-fatal — still mark as Ready, the data endpoint will surface errors.
    }
  }

  const { data, error } = await supabaseAdmin
    .from('eng_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .eq('id', reportId)
    .select(ENG_REPORT_SELECT)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json({ ...data, rowCount });
});

// POST /api/eng-portal/reports/run-all — queue all reports for refresh
router.post('/reports/run-all', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('eng_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .neq('status', 'Ready')
    .select(ENG_REPORT_SELECT);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ refreshed: data?.length || 0, reports: data || [] });
});

// PATCH /api/eng-portal/reports/:id — update frequency / format / status
router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (ENG_REPORT_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (ENG_REPORT_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin
    .from('eng_reports').update(updates).eq('id', req.params.id).select(ENG_REPORT_SELECT).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ── Engineering Dashboard ────────────────────────────────────────────────
// Backs the /erp/maintenance/dashboard screen. Mimics the Housekeeping
// dashboard pattern (housekeepingPortal.routes.ts / HKDashboard.tsx).
//   - GET  /dashboard/kpis          work order + PM + compliance + asset KPIs
//   - GET  /dashboard/alerts        smart alert engine list (regenerates)
//   - POST /dashboard/alerts/:id/acknowledge
//   - POST /dashboard/alerts/:id/snooze
//   - GET  /dashboard/productivity  7-day WO completion trend

// Alert generator — scans live engineering data and upserts alerts.
async function regenerateEngAlerts(propertyId: string | undefined): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;

  // ── Load config sections (eng_config) for config-driven thresholds ──
  const [woCfg, pmCfg, alertCfg] = await Promise.all([
    getEngConfig(propertyId, 'work_orders'),
    getEngConfig(propertyId, 'preventive_maintenance'),
    getEngConfig(propertyId, 'alerts'),
  ]);

  // Config defaults — fall back to hardcoded values when config is absent.
  const defaultSlaHours = Number(woCfg['sla-hours']) || 4;
  const woPriorities: Array<{ label: string; slaHours: number }> = Array.isArray(woCfg.priorities) ? woCfg.priorities : [];
  const pmAdvanceDays = Number(pmCfg['pm-advance-days']) || 7;
  const criticalThreshold = Number(alertCfg['critical-threshold']) || 1;
  const downtimeAlertEnabled = alertCfg['downtime-alert'] !== false; // default true

  // Build a priority → SLA map from config, falling back to defaultSlaHours.
  const prioritySlaMap = new Map<string, number>();
  for (const p of woPriorities) {
    if (p.label && typeof p.slaHours === 'number') prioritySlaMap.set(p.label, p.slaHours);
  }
  const getSlaForPriority = (priority: string): number => prioritySlaMap.get(priority) ?? defaultSlaHours;

  // ── Fetch live data ──
  const woQ = supabaseAdmin.from('work_orders').select('id, status, priority, title, created_date, property_id');
  const pmQ = supabaseAdmin.from('pm_schedules').select('id, schedule_name, next_due_date, status, property_id');
  const compQ = supabaseAdmin.from('eng_compliance_items').select('id, title, status, expiry_date, category, property_id');
  const genQ = supabaseAdmin.from('eng_generators').select('id, name, fuel_level_pct, status, property_id');
  const roomIssueQ = supabaseAdmin.from('eng_room_issues').select('id, room_number, status, priority, blocks_room, property_id');
  const partsQ = supabaseAdmin.from('uinv_items').select('id, item_name, item_code, reorder_point, min_stock, property_id').eq('category', 'Engineering').eq('is_active', true);

  const [woR, pmR, compR, genR, roomIssueR, partsR] = await Promise.all([woQ, pmQ, compQ, genQ, roomIssueQ, partsQ]);

  // Non-fatal: if a table is missing, skip that alert type.
  const wos = (woR.data || []).filter((w: any) => !propertyId || w.property_id === propertyId);
  const pms = (pmR.data || []).filter((p: any) => !propertyId || p.property_id === propertyId);
  const comps = (compR.data || []).filter((c: any) => !propertyId || c.property_id === propertyId);
  const gens = (genR.data || []).filter((g: any) => !propertyId || g.property_id === propertyId);
  const roomIssues = (roomIssueR.data || []).filter((r: any) => !propertyId || r.property_id === propertyId);
  const partsItems = (partsR.data || []).filter((p: any) => !propertyId || p.property_id === propertyId);

  // Fetch ENG store balances for the parts items
  const partItemIds = partsItems.map((p: any) => p.id);
  let partsBalanceMap = new Map<string, number>();
  if (partItemIds.length > 0) {
    const { data: partBalances } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('item_id, on_hand')
      .eq('store_id', ENG_STORE_ID)
      .in('item_id', partItemIds);
    for (const b of (partBalances || [])) {
      partsBalanceMap.set(b.item_id, (partsBalanceMap.get(b.item_id) || 0) + Number(b.on_hand));
    }
  }
  // Build a parts array with current_stock populated from balances
  const parts = partsItems.map((p: any) => ({
    id: p.id,
    part_name: p.item_name,
    part_number: p.item_code,
    current_stock: partsBalanceMap.get(p.id) || 0,
    reorder_point: Number(p.reorder_point || 0),
    min_stock: Number(p.min_stock || 0),
    property_id: p.property_id,
  }));

  const now = new Date();
  type AlertDraft = {
    id: string;
    type: string;
    message: string;
    priority: 'Critical' | 'High' | 'Medium' | 'Low';
    source: string | null;
  };
  const drafts: AlertDraft[] = [];

  // 1. Critical Equipment Failure — Emergency priority WOs not completed.
  // Uses alerts.critical-threshold to control minimum count before alerting.
  const emergencyWOs = wos.filter((w: any) =>
    w.priority === 'Emergency' &&
    w.status !== 'Completed' && w.status !== 'Verified' && w.status !== 'Closed' && w.status !== 'Cancelled'
  );
  if (emergencyWOs.length >= criticalThreshold) {
    for (const w of emergencyWOs) {
      drafts.push({
        id: `alert-eqfail-${w.id}`,
        type: 'Critical Equipment Failure',
        message: `Emergency work order: ${w.title || w.id} — ${w.status}.`,
        priority: 'Critical',
        source: w.id,
      });
    }
  }

  // 1b. SLA Breach — open WOs that exceed their priority's SLA hours.
  // Uses work_orders.sla-hours and per-priority slaHours from config.
  const openStatuses = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor'];
  for (const w of wos) {
    if (!openStatuses.includes(w.status) || !w.created_date) continue;
    const created = new Date(w.created_date);
    if (isNaN(created.getTime())) continue;
    const sla = getSlaForPriority(w.priority || 'Normal') * 60 * 60 * 1000;
    const elapsed = now.getTime() - created.getTime();
    if (elapsed > sla) {
      const hoursOver = Math.round(elapsed / (60 * 60 * 1000));
      drafts.push({
        id: `alert-sla-${w.id}`,
        type: 'Critical Equipment Failure',
        message: `SLA breach: ${w.title || w.id} (${w.priority}) is ${hoursOver}h old, SLA is ${getSlaForPriority(w.priority || 'Normal')}h.`,
        priority: w.priority === 'Emergency' ? 'Critical' : w.priority === 'High' ? 'High' : 'Medium',
        source: w.id,
      });
    }
  }

  // 2. Generator Alarm — generators with low fuel or faulted status.
  // Gated by alerts.downtime-alert config flag.
  if (downtimeAlertEnabled) {
    for (const g of gens) {
      const fuel = Number(g.fuel_level_pct) || 100;
      if (fuel < 20) {
        drafts.push({
          id: `alert-genfuel-${g.id}`,
          type: 'Generator Alarm',
          message: `${g.name || g.id} fuel level below 20% (${fuel}%).`,
          priority: 'High',
          source: g.id,
        });
      }
      if (g.status && ['Fault', 'Offline', 'Alarm', 'Maintenance'].includes(g.status)) {
        drafts.push({
          id: `alert-genstatus-${g.id}`,
          type: 'Generator Alarm',
          message: `${g.name || g.id} status: ${g.status}.`,
          priority: 'High',
          source: g.id,
        });
      }
    }
  }

  // 3. Compliance Inspection Due — overdue or expired compliance items.
  // Expiry warning window is 7 days (hardcoded fallback; could be config-driven).
  for (const c of comps) {
    if (c.status === 'Overdue' || c.status === 'Expired' || c.status === 'Failed') {
      drafts.push({
        id: `alert-comp-${c.id}`,
        type: 'Compliance Inspection Due',
        message: `${c.title} (${c.category}) is ${c.status.toLowerCase()}.`,
        priority: c.status === 'Failed' ? 'Critical' : 'High',
        source: c.id,
      });
    } else if (c.expiry_date) {
      const exp = new Date(c.expiry_date);
      if (!isNaN(exp.getTime())) {
        const daysToExpiry = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysToExpiry <= 7 && daysToExpiry >= 0 && c.status !== 'Valid') {
          drafts.push({
            id: `alert-compexp-${c.id}`,
            type: 'Compliance Inspection Due',
            message: `${c.title} expires in ${daysToExpiry} day(s).`,
            priority: 'Medium',
            source: c.id,
          });
        }
      }
    }
  }

  // 4. PM Overdue / PM Due Soon — active PM schedules.
  // Uses preventive_maintenance.pm-advance-days to alert BEFORE due date.
  for (const p of pms) {
    if (p.status === 'Active' && p.next_due_date) {
      const due = new Date(p.next_due_date);
      if (isNaN(due.getTime())) continue;
      const daysToDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (due < now) {
        // Overdue
        drafts.push({
          id: `alert-pm-${p.id}`,
          type: 'PM Overdue',
          message: `PM schedule "${p.schedule_name}" is overdue (was due ${p.next_due_date}).`,
          priority: 'High',
          source: p.id,
        });
      } else if (daysToDue <= pmAdvanceDays) {
        // Due soon — advance warning from config
        drafts.push({
          id: `alert-pm-${p.id}`,
          type: 'PM Overdue',
          message: `PM schedule "${p.schedule_name}" is due in ${daysToDue} day(s).`,
          priority: 'Medium',
          source: p.id,
        });
      }
    }
  }

  // 5. Room Out of Order — room issues that block the room and are unresolved.
  const blockingIssues = roomIssues.filter((r: any) =>
    r.blocks_room === true &&
    r.status !== 'Resolved' && r.status !== 'Closed'
  );
  for (const r of blockingIssues) {
    drafts.push({
      id: `alert-roomooo-${r.id}`,
      type: 'Room Out of Order',
      message: `Room ${r.room_number} is out of order (${r.priority || 'unknown'} priority).`,
      priority: r.priority === 'Emergency' || r.priority === 'High' ? 'High' : 'Medium',
      source: r.id,
    });
  }

  // 6. Low Spare Parts Stock — parts at or below reorder point.
  for (const p of parts) {
    const stock = Number(p.current_stock) || 0;
    const reorder = Number(p.reorder_point) || Number(p.min_stock) || 0;
    if (reorder > 0 && stock <= reorder) {
      drafts.push({
        id: `alert-parts-${p.id}`,
        type: 'Low Spare Parts Stock',
        message: `${p.part_name || p.part_number || p.id} stock is ${stock} (reorder point: ${reorder}).`,
        priority: stock === 0 ? 'High' : 'Medium',
        source: p.id,
      });
    }
  }

  // Fetch existing active alerts to decide upsert vs. resolve.
  let existingQ = supabaseAdmin.from('eng_dashboard_alerts')
    .select('id, status')
    .in('status', ['Active', 'Acknowledged', 'Snoozed']);
  if (propertyId) existingQ = (existingQ as any).eq('property_id', propertyId);
  const { data: existing } = await existingQ;
  const existingMap = new Map((existing || []).map((e: any) => [e.id, e.status]));
  const draftIds = new Set(drafts.map(d => d.id));

  // Upsert new/changed drafts.
  const toUpsert = drafts.filter(d => !existingMap.has(d.id));
  if (toUpsert.length > 0) {
    const rows = toUpsert.map(d => ({
      id: d.id,
      property_id: propertyId || null,
      type: d.type,
      message: d.message,
      priority: d.priority,
      status: 'Active',
      source: d.source,
    }));
    await supabaseAdmin.from('eng_dashboard_alerts').upsert(rows, { onConflict: 'id' }).eq('status', 'Active');
  }

  // Resolve alerts whose trigger condition has cleared.
  const toResolve = [...existingMap.keys()].filter(id => !draftIds.has(id));
  if (toResolve.length > 0) {
    await supabaseAdmin.from('eng_dashboard_alerts')
      .update({ status: 'Resolved' })
      .in('id', toResolve)
      .in('status', ['Active', 'Acknowledged', 'Snoozed']);
  }
}

// GET /api/eng-portal/dashboard/kpis — computed KPIs from work orders + PM + compliance + assets
router.get('/dashboard/kpis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId;
  try {
    let woQ = supabaseAdmin.from('work_orders').select('id, status, priority, created_date, completed_at');
    let pmQ = supabaseAdmin.from('pm_schedules').select('id, status, next_due_date');
    let compQ = supabaseAdmin.from('eng_compliance_items').select('id, status, expiry_date');
    let assetQ = supabaseAdmin.from('fixed_assets').select('id, status');
    let roomIssueQ = supabaseAdmin.from('eng_room_issues').select('id, status, blocks_room');
    let techQ = supabaseAdmin.from('eng_technicians').select('id, is_active, status, workload');

    if (propertyId) {
      woQ = woQ.eq('property_id', propertyId);
      pmQ = (pmQ as any).eq('property_id', propertyId);
      compQ = compQ.eq('property_id', propertyId);
      assetQ = (assetQ as any).eq('property_id', propertyId);
      roomIssueQ = roomIssueQ.eq('property_id', propertyId);
      techQ = techQ.eq('property_id', propertyId);
    }

    const [woR, pmR, compR, assetR, roomIssueR, techR] = await Promise.all([
      woQ, pmQ, compQ, assetQ, roomIssueQ, techQ,
    ]);

    if (woR.error) return res.status(500).json({ error: woR.error.message });

    const wos = woR.data || [];
    const pms = pmR.data || [];
    const comps = compR.data || [];
    const assets = assetR.data || [];
    const roomIssues = roomIssueR.data || [];
    const techs = techR.data || [];

    const todayStr = new Date().toISOString().split('T')[0];
    const openStatuses = ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Waiting for Vendor'];
    const openWOs = wos.filter((w: any) => openStatuses.includes(w.status));
    const completedToday = wos.filter((w: any) => {
      if (!w.completed_at) return false;
      return String(w.completed_at).split('T')[0] === todayStr;
    });
    const overdueWOs = wos.filter((w: any) =>
      openStatuses.includes(w.status) && w.created_date &&
      String(w.created_date).split('T')[0] < todayStr
    );
    const emergencyWOs = wos.filter((w: any) =>
      w.priority === 'Emergency' && openStatuses.includes(w.status)
    );

    // PM compliance
    const activePMs = pms.filter((p: any) => p.status === 'Active');
    const now = new Date();
    const overduePMs = activePMs.filter((p: any) => {
      if (!p.next_due_date) return false;
      const due = new Date(p.next_due_date);
      return !isNaN(due.getTime()) && due < now;
    });
    const pmDueToday = activePMs.filter((p: any) => {
      if (!p.next_due_date) return false;
      return p.next_due_date === todayStr;
    });
    const pmCompliancePct = activePMs.length > 0
      ? Math.round(((activePMs.length - overduePMs.length) / activePMs.length) * 100)
      : 100;

    // Compliance
    const validComps = comps.filter((c: any) => c.status === 'Valid').length;
    const overdueComps = comps.filter((c: any) => c.status === 'Overdue' || c.status === 'Expired').length;
    const failedComps = comps.filter((c: any) => c.status === 'Failed').length;

    // Assets
    const totalAssets = assets.length;
    const operationalAssets = assets.filter((a: any) =>
      a.status === 'Operational' || a.status === 'Active' || a.status === 'In Service'
    ).length;
    const assetAvailability = totalAssets > 0
      ? Math.round((operationalAssets / totalAssets) * 100)
      : 100;

    // Room issues
    const roomOOO = roomIssues.filter((r: any) => r.blocks_room === true && r.status !== 'Resolved' && r.status !== 'Closed').length;

    // Technicians
    const activeTechs = techs.filter((t: any) => t.is_active !== false && t.status !== 'Inactive');
    const techUtilization = activeTechs.length > 0
      ? Math.round((activeTechs.filter((t: any) => (t.workload || 0) > 0).length / activeTechs.length) * 100)
      : 0;

    // Work order status distribution for pie chart
    const woStatusDist = [
      { name: 'Open', value: wos.filter((w: any) => w.status === 'Open').length, color: '#6366f1' },
      { name: 'Assigned', value: wos.filter((w: any) => w.status === 'Assigned').length, color: '#8b5cf6' },
      { name: 'In Progress', value: wos.filter((w: any) => w.status === 'In Progress').length, color: '#f59e0b' },
      { name: 'Waiting Parts', value: wos.filter((w: any) => w.status === 'Waiting for Parts').length, color: '#f97316' },
      { name: 'Waiting Vendor', value: wos.filter((w: any) => w.status === 'Waiting for Vendor').length, color: '#ef4444' },
      { name: 'Completed', value: wos.filter((w: any) => w.status === 'Completed').length, color: '#10b981' },
      { name: 'Verified', value: wos.filter((w: any) => w.status === 'Verified').length, color: '#059669' },
    ].filter(d => d.value > 0);

    return res.json({
      workOrderStats: {
        open: openWOs.length,
        completedToday: completedToday.length,
        overdue: overdueWOs.length,
        emergency: emergencyWOs.length,
        total: wos.length,
      },
      pmStats: {
        active: activePMs.length,
        overdue: overduePMs.length,
        dueToday: pmDueToday.length,
        compliancePct: pmCompliancePct,
      },
      complianceStats: {
        valid: validComps,
        overdue: overdueComps,
        failed: failedComps,
        total: comps.length,
      },
      assetStats: {
        total: totalAssets,
        operational: operationalAssets,
        availabilityPct: assetAvailability,
      },
      roomStats: {
        outOfOrder: roomOOO,
      },
      techStats: {
        active: activeTechs.length,
        utilizationPct: techUtilization,
      },
      woStatusDist,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch dashboard KPIs' });
  }
});

// GET /api/eng-portal/dashboard/alerts — regenerate then list.
router.get('/dashboard/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId;
  try {
    await regenerateEngAlerts(propertyId);
    let q = supabaseAdmin
      .from('eng_dashboard_alerts')
      .select('id, type, message, priority, status, source, snoozed_until, created_at, updated_at')
      .neq('status', 'Resolved')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch alerts' });
  }
});

// POST /api/eng-portal/dashboard/alerts/:id/acknowledge
router.post('/dashboard/alerts/:id/acknowledge', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('eng_dashboard_alerts')
    .update({ status: 'Acknowledged' })
    .eq('id', req.params.id)
    .select('id, type, message, priority, status, source, snoozed_until, created_at, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

// POST /api/eng-portal/dashboard/alerts/:id/snooze
router.post('/dashboard/alerts/:id/snooze', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const hours = Number(req.body?.hours) || 1;
  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('eng_dashboard_alerts')
    .update({ status: 'Snoozed', snoozed_until: snoozedUntil })
    .eq('id', req.params.id)
    .select('id, type, message, priority, status, source, snoozed_until, created_at, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Alert not found' });
  return res.json(data);
});

// GET /api/eng-portal/dashboard/productivity — 7-day WO completion trend
router.get('/dashboard/productivity', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId;
  try {
    let woQ = supabaseAdmin
      .from('work_orders')
      .select('id, status, completed_at, created_date')
      .in('status', ['Completed', 'Verified', 'Closed']);
    if (propertyId) woQ = woQ.eq('property_id', propertyId);
    const { data: wos, error } = await woQ;
    if (error) return res.status(500).json({ error: error.message });

    const days: { name: string; completed: number; verified: number }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = dayNames[d.getDay()];
      const dayWOs = (wos || []).filter((w: any) => {
        if (!w.completed_at) return false;
        return String(w.completed_at).split('T')[0] === dateStr;
      });
      days.push({
        name: dayName,
        completed: dayWOs.filter((w: any) => w.status === 'Completed').length,
        verified: dayWOs.filter((w: any) => w.status === 'Verified' || w.status === 'Closed').length,
      });
    }

    return res.json({ days });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch productivity data' });
  }
});

export default router;
