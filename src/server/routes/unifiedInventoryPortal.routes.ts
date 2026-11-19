/**
 * Unified Inventory & Stores Portal Routes
 * Mounted at /api/uinv-portal
 *
 * Implements the API for the Unified Inventory & Stores Portal per
 * docs/unified_inventory_stores_portal.md. Uses the `uinv_*` table
 * namespace (migration 346).
 *
 * Routes use `authenticate` only (no `requirePermission`) to match
 * the HK/Engineering portal pattern.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { getDepartmentCategories } from '../../config/departmentCategories';
import { MAIN_STORE_ID, FB_FOOD_STORE_ID, FB_BEV_STORE_ID, HK_STORE_ID, HK_LINEN_STORE_ID, ENG_STORE_ID, DEPARTMENT_STORE_CODES, getInventoryCachePattern, getInventoryCachePatternForStore } from '../config/storeIds';
import { cacheService } from '../services/cacheService';
import { twinWriteProcRequisition } from '../services/procurementIntegration';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

function ensureDb(res: any) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    dbNotConfigured(res);
    return null;
  }
  return supabaseAdmin;
}

/** Append an audit-log entry. Best-effort � failures are logged, not thrown. */
async function appendAudit(client: any, entry: Record<string, any>) {
  try {
    await client.from('uinv_audit_logs').insert({
      property_id: entry.property_id ?? null,
      department: entry.department ?? null,
      user_id: entry.user_id ?? null,
      user_name: entry.user_name ?? 'system',
      transaction_type: entry.transaction_type,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      item_or_asset: entry.item_or_asset ?? null,
      quantity: entry.quantity ?? null,
      value: entry.value ?? null,
      location: entry.location ?? null,
      batch_serial: entry.batch_serial ?? null,
      reason: entry.reason ?? null,
      approval_ref: entry.approval_ref ?? null,
      previous_state: entry.previous_state ?? null,
      new_state: entry.new_state ?? null,
      related_document: entry.related_document ?? null,
    });
  } catch (e) {
    console.error('[uinv] audit insert failed:', e);
  }
}

/** Append an immutable ledger entry. Best-effort � failures are logged, not thrown. */
async function appendLedger(client: any, entry: Record<string, any>) {
  try {
    const insertPayload: Record<string, any> = {
      property_id: entry.property_id ?? null,
      item_id: entry.item_id,
      store_id: entry.store_id ?? null,
      location_id: entry.location_id ?? null,
      batch_id: entry.batch_id ?? null,
      transaction_type: entry.transaction_type,
      reference: entry.reference ?? null,
      quantity_in: entry.quantity_in ?? 0,
      quantity_out: entry.quantity_out ?? 0,
      balance: entry.balance ?? 0,
      unit_cost: entry.unit_cost ?? 0,
      value: entry.value ?? 0,
      performed_by: entry.performed_by ?? 'system',
      reason: entry.reason ?? null,
      transaction_date: entry.transaction_date ?? new Date().toISOString(),
    };
    // Optional variance columns (migration 374). Only set for variance events
    // (Consumption, Cycle Count, Stock Count, Adjustment, Waste) where
    // theoretical vs actual quantities are meaningful.
    if (entry.theoretical_qty != null) insertPayload.theoretical_qty = entry.theoretical_qty;
    if (entry.actual_qty != null) insertPayload.actual_qty = entry.actual_qty;
    await client.from('uinv_stock_ledger').insert(insertPayload);
  } catch (e) {
    console.error('[uinv] ledger insert failed:', e);
  }
}

/** Recompute on_hand for an item/store/location balance row and return the new value. */
async function recomputeBalance(client: any, itemId: string, storeId: string, locationId: string | null) {
  // First try exact match: item + store + specific location (or NULL location)
  let q = client
    .from('uinv_stock_balances')
    .select('id, on_hand, location_id')
    .eq('item_id', itemId)
    .eq('store_id', storeId);
  if (locationId) q = q.eq('location_id', locationId);
  else q = q.is('location_id', null);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data;

  // Fallback: if no exact match and locationId was null/not provided,
  // try matching any balance row for this item+store (regardless of location).
  // This handles issue lines that don't carry a locationId but the balance
  // row was created with a specific location_id.
  if (!locationId) {
    const { data: fallback, error: fe } = await client
      .from('uinv_stock_balances')
      .select('id, on_hand, location_id')
      .eq('item_id', itemId)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fe) throw fe;
    return fallback;
  }
  return null;
}

/**
 * Find the department store for a given department name.
 * Primary lookup: child of Main Warehouse (parent_store_id = MAIN) with
 * matching department.
 * Fallback: any active store with matching department (excluding MAIN
 * itself). This handles seeded stores that don't have parent_store_id set
 * (pre-migration 377) and stores created via the portal without a parent.
 */
async function findDeptStore(client: any, department: string): Promise<string | null> {
  if (!department) return null;
  // Primary: child of Main Warehouse with matching department
  const { data, error } = await client
    .from('uinv_stores')
    .select('id')
    .eq('parent_store_id', MAIN_STORE_ID)
    .eq('department', department)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[uinv] findDeptStore error:', error.message); }
  if (data?.id) return data.id;
  // Fallback: any active store with matching department (excluding MAIN)
  const { data: fallback, error: fe } = await client
    .from('uinv_stores')
    .select('id')
    .eq('department', department)
    .eq('is_active', true)
    .neq('store_code', 'MAIN')
    .order('parent_store_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (fe) { console.error('[uinv] findDeptStore fallback error:', fe.message); return null; }
  return fallback?.id || null;
}

/**
 * Add quantity to a department store's balance (upsert).
 * If no balance row exists for item+store, create one.
 */
async function addToStoreBalance(client: any, opts: {
  propertyId: string | null;
  itemId: string;
  storeId: string;
  qty: number;
  unitCost?: number;
}): Promise<void> {
  const { propertyId, itemId, storeId, qty, unitCost = 0 } = opts;
  if (qty <= 0) return;

  // Try to find existing balance (any location in that store)
  const { data: existing, error: fe } = await client
    .from('uinv_stock_balances')
    .select('id, on_hand')
    .eq('item_id', itemId)
    .eq('store_id', storeId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fe) { console.error('[uinv] addToStoreBalance query error:', fe.message); return; }

  if (existing) {
    const newOnHand = Number(existing.on_hand) + qty;
    await client.from('uinv_stock_balances').update({
      on_hand: newOnHand,
      last_movement_date: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    // Create new balance row
    await client.from('uinv_stock_balances').insert({
      id: `UINV-SB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      property_id: propertyId,
      item_id: itemId,
      store_id: storeId,
      location_id: null,
      on_hand: qty,
      reserved: 0,
      allocated: 0,
      on_order: 0,
      in_transit: 0,
      damaged: 0,
      quarantined: 0,
      expired: 0,
      status: 'Available',
      unit_cost: unitCost,
      last_movement_date: new Date().toISOString(),
    });
  }
}

/**
 * Apply a stock movement atomically via the `uinv_apply_stock_movement` RPC
 * (migration 387). In ONE database transaction the RPC:
 *   - enforces the inventory period lock (Frozen/Closed),
 *   - locks the exact (item, store, location) balance row,
 *   - validates availability = on_hand - reserved - allocated - damaged -
 *     quarantined - expired against qtyOut (rejects over-issue),
 *   - blends weighted-average unit cost on inbound movements,
 *   - optionally deducts batches (specific batchId, or a FEFO/FIFO plan),
 *   - appends the immutable ledger row with the correct running balance.
 * Throws on failure so callers can map the error to a 4xx response �
 * unlike the old inline SELECT-then-UPDATE chains, the balance and the
 * ledger can never diverge.
 */
async function applyStockMovement(client: any, args: {
  propertyId?: string | null;
  itemId: string;
  storeId: string;
  transactionType: string;
  qtyIn?: number;
  qtyOut?: number;
  locationId?: string | null;
  reference?: string | null;
  reservedDelta?: number;
  allocatedDelta?: number;
  unitCost?: number | null;
  batchId?: string | null;
  deductBatches?: 'FEFO' | 'FIFO' | null;
  performedBy?: string;
  reason?: string | null;
  allowNegative?: boolean;
  skipPeriodCheck?: boolean;
  theoreticalQty?: number | null;
  actualQty?: number | null;
}): Promise<any> {
  const { data, error } = await client.rpc('uinv_apply_stock_movement', {
    p_property_id: args.propertyId ?? null,
    p_item_id: args.itemId,
    p_store_id: args.storeId,
    p_transaction_type: args.transactionType,
    p_qty_in: args.qtyIn ?? 0,
    p_qty_out: args.qtyOut ?? 0,
    p_location_id: args.locationId ?? null,
    p_reference: args.reference ?? null,
    p_reserved_delta: args.reservedDelta ?? 0,
    p_allocated_delta: args.allocatedDelta ?? 0,
    p_unit_cost: args.unitCost ?? null,
    p_batch_id: args.batchId ?? null,
    p_deduct_batches: args.deductBatches ?? null,
    p_performed_by: args.performedBy ?? 'system',
    p_reason: args.reason ?? null,
    p_allow_negative: args.allowNegative ?? false,
    p_skip_period_check: args.skipPeriodCheck ?? false,
    p_theoretical_qty: args.theoreticalQty ?? null,
    p_actual_qty: args.actualQty ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Map a movement/RPC failure to a 4xx response when it is a business-rule
 * violation (insufficient stock, period lock, missing balance/batch).
 */
function movementErrorResponse(res: any, e: any) {
  const msg = String((e as any)?.message || e || 'Stock movement failed');
  const isBusiness = /Insufficient stock|No stock balance|is Frozen|is Closed|Batch .* not found|period/i.test(msg);
  return res.status(isBusiness ? 409 : 500).json({ error: msg });
}

/** Create a cross-department notification for requisition status changes. */
async function notifyDepartment(client: any, opts: {
  property_id?: string | null;
  department: string;
  issue_id?: string;
  issue_number?: string;
  notification_type: string;
  message: string;
  created_by?: string;
}) {
  try {
    await client.from('uinv_notifications').insert({
      property_id: opts.property_id ?? null,
      department: opts.department,
      issue_id: opts.issue_id ?? null,
      issue_number: opts.issue_number ?? null,
      notification_type: opts.notification_type,
      message: opts.message,
      created_by: opts.created_by ?? 'system',
    });
  } catch (e) {
    console.error('[uinv] notification insert failed:', e);
  }
}

// ----------------------------------------------------------------
// DASHBOARD
// ----------------------------------------------------------------
router.get('/dashboard', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId } = req.query as Record<string, string>;

  const filter = propertyId ? { property_id: propertyId } : {};
  const [
    itemsRes, stockRes, grnRes, issuesRes, transfersRes, wasteRes, countsRes, batchesRes,
  ] = await Promise.all([
    client.from('uinv_items').select('id, is_active, last_cost, avg_cost').match(filter),
    client.from('uinv_stock_balances').select('id, on_hand, reserved, allocated, damaged, quarantined, expired, unit_cost, item_id').match(filter),
    client.from('uinv_goods_receipts').select('id, status, total_value').match(filter),
    client.from('uinv_issues').select('id, approval_status').match(filter),
    client.from('uinv_transfers').select('id, status').match(filter),
    client.from('uinv_waste').select('id, status, total_cost').match(filter),
    client.from('uinv_counts').select('id, status, total_variance').match(filter),
    client.from('uinv_batches').select('id, expiry_date, quantity, status').match(filter),
  ]);

  const items = itemsRes.data || [];
  const stock = stockRes.data || [];
  const grns = grnRes.data || [];
  const issues = issuesRes.data || [];
  const transfers = transfersRes.data || [];
  const waste = wasteRes.data || [];
  const counts = countsRes.data || [];
  const batches = batchesRes.data || [];

  const totalValue = stock.reduce((s: number, r: any) => s + Number(r.on_hand) * Number(r.unit_cost), 0);
  const totalSkus = items.filter((i: any) => i.is_active).length;
  const onHand = stock.reduce((s: number, r: any) => s + Number(r.on_hand), 0);
  const reserved = stock.reduce((s: number, r: any) => s + Number(r.reserved), 0);
  const available = stock.reduce((s: number, r: any) => s + (Number(r.on_hand) - Number(r.reserved) - Number(r.allocated) - Number(r.quarantined)), 0);

  // Low stock: items whose on_hand <= reorder_point
  const stockByItem = new Map<string, number>();
  for (const s of stock) stockByItem.set(s.item_id, (stockByItem.get(s.item_id) || 0) + Number(s.on_hand));
  const { data: lowStockItems } = await client.from('uinv_items').select('id, item_name, reorder_point, unit_of_measure').match(filter);
  const lowStock = (lowStockItems || []).filter((i: any) => (stockByItem.get(i.id) || 0) <= Number(i.reorder_point));

  // Expiry tracking
  const today = new Date();
  const expiringSoon: any[] = [];
  const expired: any[] = [];
  for (const b of batches) {
    if (!b.expiry_date || b.status !== 'Available') continue;
    const exp = new Date(b.expiry_date);
    const days = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) expired.push(b);
    else if (days <= 30) expiringSoon.push({ ...b, daysUntilExpiry: days });
  }

  const pendingReceipts = grns.filter((g: any) => g.status === 'Received' || g.status === 'Pending').length;
  const pendingIssues = issues.filter((i: any) => i.approval_status === 'Pending' || i.approval_status === 'Approved').length;
  const pendingTransfers = transfers.filter((t: any) => t.status === 'Pending' || t.status === 'In Transit').length;
  const inventoryVariance = counts.filter((c: any) => c.status === 'Completed').reduce((s: number, c: any) => s + Number(c.total_variance), 0);
  const wasteValue = waste.reduce((s: number, w: any) => s + Number(w.total_cost), 0);
  const outOfStock = Array.from(stockByItem.entries()).filter(([, q]) => q <= 0).length;

  // Expanded: fixed-asset register KPIs (migration 365)
  let assetQ = client.from('uinv_assets').select('id, acquisition_cost, status, is_active');
  if (propertyId) assetQ = assetQ.eq('property_id', propertyId);
  const { data: assetRows } = await assetQ;
  const activeAssets = (assetRows || []).filter((a: any) => a.is_active);
  const totalAssets = activeAssets.length;
  const missingAssets = activeAssets.filter((a: any) => a.status === 'Lost' || a.status === 'Stolen').length;
  const assetValue = activeAssets.reduce((s: number, a: any) => s + Number(a.acquisition_cost || 0), 0);

  // Store count
  let storeQ = client.from('uinv_stores').select('id');
  if (propertyId) storeQ = storeQ.eq('property_id', propertyId);
  const { count: totalStores } = await storeQ;

  return res.json({
    totalValue,
    totalSkus,
    onHand,
    available,
    reserved,
    lowStockCount: lowStock.length,
    outOfStockCount: outOfStock,
    expiringCount: expiringSoon.length,
    expiredCount: expired.length,
    pendingReceipts,
    pendingIssues,
    pendingTransfers,
    inventoryVariance,
    wasteValue,
    lowStockItems: lowStock.slice(0, 10),
    expiringItems: expiringSoon.slice(0, 10),
    expiredItems: expired.slice(0, 10),
    // Expanded fields
    totalItems: totalSkus,
    totalStores: totalStores || 0,
    totalAssets,
    missingAssets,
    inventoryValue: totalValue,
    assetValue,
  });
});

// ----------------------------------------------------------------
// ITEMS (Item Master)
// ----------------------------------------------------------------
router.get('/items', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, category, search, active, department } = req.query as Record<string, string>;
  let q = client.from('uinv_items').select('*').order('item_name');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (category) q = q.or(`category.eq.${category},secondary_categories.cs.{${category}}`);
  if (active === 'true') q = q.eq('is_active', true);
  if (active === 'false') q = q.eq('is_active', false);
  if (search) q = q.or(`item_name.ilike.%${search}%,item_code.ilike.%${search}%,sku.ilike.%${search}%`);
  // Department filter: items whose default_store_id belongs to the department's stores
  if (department && department !== 'All') {
    const storeIds = await resolveDepartmentStoreIds(client, department);
    if (storeIds && storeIds.length > 0) {
      q = q.in('default_store_id', storeIds);
    }
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/items', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/items/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/items/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STORES
// Inventory portal manages its own stores (MAIN, GEN, and any it creates).
// Department stores are read-only from the inventory portal � they are
// scoped to their respective departments via the `department` column.
// The inventory portal CAN create new department stores (assigning them
// to a department), but cannot edit or delete them after creation.
// ----------------------------------------------------------------

/** Departments that can be assigned to a store. */
const ASSIGNABLE_DEPARTMENTS = [
  'Food & Beverage',
  'Housekeeping',
  'Engineering',
  'Front Office',
  'Finance',
  'Human Resources',
  'Security',
  'Procurement',
  'Sales',
  'Transportation',
  'Concierge',
  'Spa & Wellness',
  'Banquet & Events',
  'Operations',
  'Admin',
  'Executive',
  'Revenue Management',
];

/** Check if a store is a department store (has a department assigned, excluding Inventory itself). */
function isDepartmentStore(store: any): boolean {
  return !!(store && store.department && store.department !== 'Inventory');
}

router.get('/stores', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, active } = req.query as Record<string, string>;
  let q = client.from('uinv_stores').select('*').order('store_name');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (active === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Tag each store with is_department_store so the frontend knows which are read-only
  const tagged = (data || []).map((s: any) => ({
    ...s,
    is_department_store: isDepartmentStore(s),
  }));
  return res.json(tagged);
});

router.post('/stores', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  // Validate department if provided
  if (req.body?.department && !ASSIGNABLE_DEPARTMENTS.includes(req.body.department)) {
    return res.status(400).json({ error: `Invalid department: "${req.body.department}".` });
  }
  const { data, error } = await client.from('uinv_stores').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ ...data, is_department_store: isDepartmentStore(data) });
});

router.patch('/stores/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  // Block editing department stores
  const { data: existing } = await client.from('uinv_stores').select('store_code, department').eq('id', req.params.id).single();
  if (existing && isDepartmentStore(existing)) {
    return res.status(403).json({ error: 'Department stores are read-only from the inventory portal. They are managed by their respective departments.' });
  }
  const { data, error } = await client.from('uinv_stores').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ...data, is_department_store: isDepartmentStore(data) });
});

router.delete('/stores/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  // Block deleting department stores
  const { data: existing } = await client.from('uinv_stores').select('store_code, department').eq('id', req.params.id).single();
  if (existing && isDepartmentStore(existing)) {
    return res.status(403).json({ error: 'Department stores cannot be deleted from the inventory portal. They are managed by their respective departments.' });
  }
  const { error } = await client.from('uinv_stores').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

/**
 * Transfer stock from Main Warehouse ? a department store.
 * Body: { itemId, toStoreId, quantity, reason? }
 * Deducts from MAIN, adds to the target department store, writes ledger entries.
 */
router.post('/stores/transfer-stock', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { itemId, toStoreId, quantity, reason } = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  if (!itemId || !toStoreId || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ error: 'itemId, toStoreId, and a positive quantity are required.' });
  }
  const qty = Number(quantity);

  // Validate target store exists and is a department store.
  // A department store is identified by having a `department` column set
  // (excluding 'Inventory'), OR being a child of Main Warehouse. This
  // accepts both pre-migration-377 seeded stores (no parent_store_id) and
  // properly linked stores.
  const { data: targetStore } = await client.from('uinv_stores').select('id, store_name, store_code, department, parent_store_id').eq('id', toStoreId).maybeSingle();
  if (!targetStore) return res.status(404).json({ error: 'Target store not found.' });
  const isDeptStore = isDepartmentStore(targetStore) || targetStore.parent_store_id === MAIN_STORE_ID;
  if (!isDeptStore || targetStore.store_code === 'MAIN') {
    return res.status(400).json({ error: 'Target store must be a department store (has a department assigned or is a child of Main Warehouse).' });
  }

  // Check Main Warehouse has enough stock
  const mainBal = await recomputeBalance(client, itemId, MAIN_STORE_ID, null);
  if (!mainBal || Number(mainBal.on_hand) < qty) {
    return res.status(400).json({ error: `Insufficient stock in Main Warehouse. Available: ${mainBal?.on_hand || 0}, requested: ${qty}.` });
  }

  // 1. Deduct from Main
  const newMainOnHand = Number(mainBal.on_hand) - qty;
  await client.from('uinv_stock_balances').update({
    on_hand: newMainOnHand,
    last_movement_date: new Date().toISOString(),
  }).eq('id', mainBal.id);

  await appendLedger(client, {
    property_id: targetStore.property_id || null,
    item_id: itemId,
    store_id: MAIN_STORE_ID,
    location_id: mainBal.location_id || null,
    transaction_type: 'Transfer Out',
    reference: `TRF?${targetStore.store_name}`,
    quantity_in: 0,
    quantity_out: qty,
    balance: newMainOnHand,
    unit_cost: 0,
    value: 0,
    performed_by: performedBy,
    reason: reason || `Manual transfer to ${targetStore.store_name}`,
  });

  // 2. Add to department store
  await addToStoreBalance(client, {
    propertyId: targetStore.property_id || null,
    itemId,
    storeId: toStoreId,
    qty,
  });

  await appendLedger(client, {
    property_id: targetStore.property_id || null,
    item_id: itemId,
    store_id: toStoreId,
    location_id: null,
    transaction_type: 'Transfer In',
    reference: `TRF?Main Warehouse`,
    quantity_in: qty,
    quantity_out: 0,
    balance: 0,
    unit_cost: 0,
    value: 0,
    performed_by: performedBy,
    reason: reason || `Received from Main Warehouse`,
  });

  // Invalidate the receiving department's inventory cache (e.g. HK 15s cache).
  if (targetStore.department) {
    const cachePattern = getInventoryCachePattern(targetStore.department);
    if (cachePattern) cacheService.invalidatePattern(cachePattern);
  }

  return res.json({ success: true, message: `Transferred ${qty} units to ${targetStore.store_name}.` });
});

/** Expose assignable departments for frontend dropdowns. */
router.get('/stores/departments', authenticate, (_req, res) => {
  return res.json(ASSIGNABLE_DEPARTMENTS);
});

// ----------------------------------------------------------------
// LOCATIONS
// ----------------------------------------------------------------
router.get('/locations', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { storeId, active } = req.query as Record<string, string>;
  let q = client.from('uinv_locations').select('*').order('location_name');
  if (storeId) q = q.eq('store_id', storeId);
  if (active === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/locations', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_locations').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/locations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_locations').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/locations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_locations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// DEPARTMENT ? STORE MAPPING
// DEPARTMENT_STORE_CODES is imported from ../config/storeIds (single
// source of truth). resolveDepartmentStoreIds() below queries both the
// legacy store_code mapping AND the `department` column on uinv_stores
// so newly created department stores are included.
// ----------------------------------------------------------------

/** Resolve a department name to its store IDs.
 *  Looks up both by the legacy store_code mapping AND by the `department`
 *  column on uinv_stores (so newly created department stores are included). */
async function resolveDepartmentStoreIds(client: any, department: string): Promise<string[] | null> {
  if (department === 'Inventory') {
    // Inventory portal sees all stores
    const { data, error } = await client.from('uinv_stores').select('id');
    if (error) return null;
    return (data || []).map((s: any) => s.id);
  }
  const codes = DEPARTMENT_STORE_CODES[department];
  const ids = new Set<string>();
  // 1. Legacy store_code mapping
  if (codes && codes.length > 0) {
    const { data, error } = await client
      .from('uinv_stores')
      .select('id, store_code')
      .in('store_code', codes);
    if (!error) (data || []).forEach((s: any) => ids.add(s.id));
  }
  // 2. New department column on uinv_stores
  const { data: deptStores, error: deptErr } = await client
    .from('uinv_stores')
    .select('id')
    .eq('department', department);
  if (!deptErr) (deptStores || []).forEach((s: any) => ids.add(s.id));
  return ids.size > 0 ? Array.from(ids) : null;
}

// ----------------------------------------------------------------
// STOCK BALANCES (Inventory) � single source of truth
// Supports: propertyId, storeId, itemId, status, lowStock, department
// ----------------------------------------------------------------
router.get('/stock', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, storeId, itemId, status, lowStock, department, category } = req.query as Record<string, string>;
  let q = client
    .from('uinv_stock_balances')
    .select('*, item:uinv_items(*), store:uinv_stores(*), location:uinv_locations(*)')
    .order('updated_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (storeId) q = q.eq('store_id', storeId);
  if (itemId) q = q.eq('item_id', itemId);
  if (status) q = q.eq('status', status);

  // Department filter: resolve department ? store IDs and filter
  let deptStoreIds: string[] | null = null;
  if (department && department !== 'All') {
    deptStoreIds = await resolveDepartmentStoreIds(client, department);
    if (deptStoreIds && deptStoreIds.length > 0) {
      q = q.in('store_id', deptStoreIds);
    }
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];

  // Category filter (client-side since category lives on the joined item)
  if (category && category !== 'All') {
    rows = rows.filter((r: any) => r.item && r.item.category === category);
  }

  if (lowStock === 'true') {
    rows = rows.filter((r: any) => r.item && Number(r.on_hand) <= Number(r.item.reorder_point));
  }
  return res.json(rows);
});

router.patch('/stock/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_stock_balances').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ----------------------------------------------------------------
// BATCHES
// ----------------------------------------------------------------
router.get('/batches', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { itemId, storeId, expiring } = req.query as Record<string, string>;
  let q = client.from('uinv_batches').select('*, item:uinv_items(*), store:uinv_stores(*)').order('expiry_date', { ascending: true, nullsFirst: false });
  if (itemId) q = q.eq('item_id', itemId);
  if (storeId) q = q.eq('store_id', storeId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (expiring === 'true') {
    const today = new Date();
    const limit = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    rows = rows.filter((r: any) => r.expiry_date && new Date(r.expiry_date) <= limit && r.status === 'Available');
  }
  return res.json(rows);
});

// ----------------------------------------------------------------
// GOODS RECEIPTS (Receiving)
// ----------------------------------------------------------------
router.get('/receipts', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status, supplier } = req.query as Record<string, string>;
  let q = client.from('uinv_goods_receipts').select('*, store:uinv_stores(*)').order('receiving_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (supplier) q = q.ilike('supplier', `%${supplier}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/receipts', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Build insert payload with only known columns
  const storeId = body.store_id || body.storeId;
  const receivingDate = body.receiving_date || body.receivingDate;
  const insertPayload: Record<string, any> = {
    supplier: body.supplier,
    store_id: storeId,
    receiving_date: receivingDate || new Date().toISOString().slice(0, 10),
    lines: body.lines || [],
    status: body.status || 'Received',
    inspection_status: body.inspection_status || body.inspectionStatus || 'Pending',
    created_by: performedBy,
  };
  if (body.property_id) insertPayload.property_id = body.property_id;
  if (body.purchase_order) insertPayload.purchase_order = body.purchase_order;
  if (body.vehicle_reference) insertPayload.vehicle_reference = body.vehicle_reference;
  if (body.notes) insertPayload.notes = body.notes;
  if (body.total_value != null) insertPayload.total_value = body.total_value;

  // Auto-generate grn_number if not provided
  if (!body.grn_number) {
    const { count } = await client.from('uinv_goods_receipts').select('id', { count: 'exact', head: true });
    insertPayload.grn_number = `GRN-${String((count || 0) + 1).padStart(6, '0')}`;
  } else {
    insertPayload.grn_number = body.grn_number;
  }

  const { data, error } = await client.from('uinv_goods_receipts').insert(insertPayload).select().single();
  if (error) {
    console.error('[uinv-portal] POST /receipts error:', error.message, 'payload:', JSON.stringify(insertPayload));
    return res.status(500).json({ error: error.message });
  }

  // Update stock balances for each accepted line + ledger entries.
  // All movements go through the atomic uinv_apply_stock_movement RPC
  // (migration 387): exact-row lock, weighted-average cost blend, and the
  // ledger append happen in one DB transaction.
  const warnings: string[] = [];
  const lines = body.lines || [];
  try {
    for (const line of lines) {
      if (!line.itemId || !line.acceptedQty) continue;
      const qty = Number(line.acceptedQty);
      const unitCost = Number(line.unitCost || 0);
      await applyStockMovement(client, {
        propertyId: body.property_id || body.propertyId || null,
        itemId: line.itemId,
        storeId,
        transactionType: 'Goods Receipt',
        qtyIn: qty,
        locationId: line.locationId || null,
        reference: data.grn_number,
        unitCost,
        performedBy,
        reason: `Goods receipt ${data.grn_number}`,
      });

      // Create batch record if batch-controlled/expiry
      if (line.batchNumber) {
        const { error: bErr } = await client.from('uinv_batches').insert({
          item_id: line.itemId,
          store_id: storeId,
          batch_number: line.batchNumber,
          lot_number: line.lotNumber || null,
          manufacturing_date: line.manufacturingDate || null,
          expiry_date: line.expiryDate || null,
          received_date: receivingDate || new Date().toISOString(),
          supplier: body.supplier || null,
          quantity: qty,
          unit_cost: unitCost,
          status: insertPayload.inspection_status === 'Accepted' ? 'Available' : 'Under Inspection',
        });
        if (bErr) warnings.push(`Batch record for ${line.batchNumber} failed: ${bErr.message}`);
      }
    }
  } catch (e: any) {
    return movementErrorResponse(res, e);
  }

  // Auto-post Inventory Valuation journal entry (Gap 4)
  const totalReceiptValue = (body.lines || [])
    .filter((l: any) => l.itemId && l.acceptedQty)
    .reduce((sum: number, l: any) => sum + (Number(l.acceptedQty) * Number(l.unitCost || 0)), 0);
  if (totalReceiptValue > 0 && data) {
    const { error: jErr } = await client.rpc('post_inventory_journal', {
      p_source_entity: 'uinv_goods_receipts',
      p_source_id: data.id,
      p_posting_type: 'Inventory Valuation',
      p_amount: totalReceiptValue,
      p_description: `Goods receipt from ${body.supplier || 'Unknown'} - ${data.grn_number}`,
      p_department: null,
      p_property_id: body.property_id || body.propertyId || null,
      p_reference: data.grn_number,
      p_created_by: performedBy,
    });
    if (jErr) warnings.push(`Journal posting failed: ${jErr.message}`);
  }

  // Invalidate the department cache if goods were received directly to a dept store.
  if (storeId) {
    const cachePattern = getInventoryCachePatternForStore(storeId);
    if (cachePattern) cacheService.invalidatePattern(cachePattern);
  }

  return res.status(201).json(warnings.length ? { ...data, warnings } : data);
});

router.patch('/receipts/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const body = req.body;

  // If lines or value change on a Received GRN, reverse the original stock
  // movement and re-apply the new lines � previously the header was edited
  // with no stock/ledger reversal, leaving balances inflated.
  if (body.lines || body.total_value != null) {
    const { data: existing } = await client.from('uinv_goods_receipts').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Cancelled' && Array.isArray(existing.lines)) {
      try {
        for (const line of existing.lines) {
          if (!line.itemId || !line.acceptedQty) continue;
          await applyStockMovement(client, {
            propertyId: existing.property_id,
            itemId: line.itemId,
            storeId: existing.store_id,
            transactionType: 'Receipt Reversal (Edit)',
            qtyOut: Number(line.acceptedQty),
            locationId: line.locationId || null,
            reference: existing.grn_number,
            unitCost: Number(line.unitCost || 0),
            performedBy,
            reason: `Reversal for edit of GRN ${existing.grn_number}`,
          });
        }
        for (const line of (body.lines || [])) {
          if (!line.itemId || !line.acceptedQty) continue;
          await applyStockMovement(client, {
            propertyId: existing.property_id,
            itemId: line.itemId,
            storeId: body.store_id || existing.store_id,
            transactionType: 'Goods Receipt (Revised)',
            qtyIn: Number(line.acceptedQty),
            locationId: line.locationId || null,
            reference: existing.grn_number,
            unitCost: Number(line.unitCost || 0),
            performedBy,
            reason: `Revised GRN ${existing.grn_number}`,
          });
        }
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }
    }
  }

  const { data, error } = await client.from('uinv_goods_receipts').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/receipts/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Reverse the stock/ledger effect before deleting the header � previously
  // the delete left inventory permanently inflated.
  const { data: existing } = await client.from('uinv_goods_receipts').select('*').eq('id', req.params.id).single();
  if (existing && existing.status !== 'Cancelled' && Array.isArray(existing.lines)) {
    try {
      for (const line of existing.lines) {
        if (!line.itemId || !line.acceptedQty) continue;
        await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: line.itemId,
          storeId: existing.store_id,
          transactionType: 'Receipt Reversal',
          qtyOut: Number(line.acceptedQty),
          locationId: line.locationId || null,
          reference: existing.grn_number,
          unitCost: Number(line.unitCost || 0),
          performedBy,
          reason: `Reversal for deleted GRN ${existing.grn_number}`,
        });
      }
    } catch (e: any) {
      return movementErrorResponse(res, e);
    }
  }

  const { error } = await client.from('uinv_goods_receipts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// ISSUES (Stock Operations)
// ----------------------------------------------------------------
router.get('/issues', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status, department } = req.query as Record<string, string>;
  let q = client.from('uinv_issues').select('*, store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('approval_status', status);
  if (department) q = q.eq('department', department);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/issues', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Auto-generate issue_number if not provided � separate counters per prefix
  let issueNumber = body.issue_number;
  if (!issueNumber) {
    const source = body.source || 'Direct';
    const prefix = source === 'Requisition' ? 'REQ' : 'ISS';
    // Count only existing records with the same prefix for an independent sequence
    const { count } = await client.from('uinv_issues').select('id', { count: 'exact', head: true }).like('issue_number', `${prefix}-%`);
    issueNumber = `${prefix}-${String((count || 0) + 1).padStart(6, '0')}`;
  }

  // Build insert payload with only known columns � avoid spreading unknown fields
  const insertPayload: Record<string, any> = {
    issue_number: issueNumber,
    department: body.department,
    priority: body.priority || 'Normal',
    approval_status: body.approval_status || body.approvalStatus || 'Pending',
    source: body.source || 'Direct',
    lines: body.lines || [],
    created_by: performedBy,
  };

  // -- Category validation: only items whose category matches the department can be issued/requested --
  if (body.department && body.department !== 'Inventory' && (body.lines || []).length > 0) {
    const itemIds = (body.lines || []).map((l: any) => l.itemId).filter(Boolean);
    if (itemIds.length > 0) {
      const { data: dbItems } = await client.from('uinv_items').select('id, category, secondary_categories').in('id', itemIds);
      const allowedCats = getDepartmentCategories(body.department);
      const violations: string[] = [];
      for (const dbItem of (dbItems || [])) {
        const itemCats = [dbItem.category, ...(dbItem.secondary_categories || [])];
        if (!itemCats.some(c => allowedCats.includes(c))) {
          const line = (body.lines || []).find((l: any) => l.itemId === dbItem.id);
          violations.push(`${line?.itemName || dbItem.id} (category: ${dbItem.category})`);
        }
      }
      if (violations.length > 0) {
        return res.status(400).json({
          error: `The following items cannot be issued to ${body.department} � their category does not match the department: ${violations.join(', ')}. Allowed categories: ${allowedCats.join(', ')}.`,
        });
      }
    }
  }

  // Optional fields � only set if provided and not empty
  if (body.property_id) insertPayload.property_id = body.property_id;
  if (body.store_id) insertPayload.store_id = body.store_id;
  if (body.requester) insertPayload.requester = body.requester;
  if (body.required_date) insertPayload.required_date = body.required_date;
  if (body.cost_center) insertPayload.cost_center = body.cost_center;
  if (body.purpose) insertPayload.purpose = body.purpose;
  if (body.notes) insertPayload.notes = body.notes;
  if (body.requisition_id) insertPayload.requisition_id = body.requisition_id;

  const { data, error } = await client.from('uinv_issues').insert(insertPayload).select().single();
  if (error) {
    console.error('[uinv-portal] POST /issues error:', error.message, 'payload:', JSON.stringify(insertPayload));
    return res.status(500).json({ error: error.message });
  }

  // Notify Inventory when a department creates a requisition
  if (data.source === 'Requisition') {
    await notifyDepartment(client, {
      property_id: data.property_id,
      department: 'Inventory',
      issue_id: data.id,
      issue_number: data.issue_number,
      notification_type: 'New Requisition',
      message: `New requisition ${data.issue_number} from ${data.department} � ${(data.lines || []).length} item(s) requested.`,
      created_by: performedBy,
    });
  }

  return res.status(201).json(data);
});

router.patch('/issues/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Fetch existing issue for notification context
  const { data: existingIssue } = await client.from('uinv_issues').select('*').eq('id', req.params.id).single();

  // Handle both "Issued" and "Partially Issued" � deduct stock + ledger
  const targetStatus = body.approval_status || body.approvalStatus;
  if (targetStatus === 'Issued' || targetStatus === 'Partially Issued') {
    if (existingIssue) {
      const existingLines = existingIssue.lines || [];
      // The body.lines (if provided) contains the NEW issuedQty values for this partial issue.
      // We need to accumulate: newTotalIssued = oldIssued + thisIssueQty
      // If body.lines is not provided, use existing lines as-is (full issue).
      const incomingLines = body.lines || existingLines;
      const updatedLines = existingLines.map((line: any, idx: number) => {
        const incoming = incomingLines[idx] || {};
        // If body provides issuedQty, it's the quantity to issue NOW (partial).
        // Accumulate onto existing issuedQty.
        const qtyToIssueNow = incoming.issuedQty != null ? Number(incoming.issuedQty) : 0;
        const alreadyIssued = Number(line.issuedQty || 0);
        const newTotalIssued = alreadyIssued + qtyToIssueNow;
        return {
          ...line,
          issuedQty: newTotalIssued,
          approvedQty: incoming.approvedQty != null ? Number(incoming.approvedQty) : (line.approvedQty || line.requestedQty || 0),
        };
      });

      // Deduct stock from the MAIN WAREHOUSE (central gate) and add to the department store.
      // This implements the "main gate" model: Inventory distributes from Main to departments.
      // For non-consumable fixed assets (item_type = Asset, Non-Inventory Item, Spare Part),
      // stock is NOT deducted � instead an asset checkout record is created.
      const deptStoreId = await findDeptStore(client, existingIssue.department);

      // Fetch item types for all line items to determine consumable vs asset
      const lineItemIds = updatedLines.map((l: any) => l.itemId).filter(Boolean);
      const { data: lineItems } = await client.from('uinv_items').select('id, item_type, item_name').in('id', lineItemIds);
      const itemMap: Record<string, any> = {};
      for (const it of (lineItems || [])) itemMap[it.id] = it;
      const CONSUMABLE_TYPES = ['Consumable', 'Food', 'Beverage', 'Inventory Item'];

      // -- Phase 1: Handle non-consumable asset checkouts (app layer) --
      // Assets are not deducted from stock � they get checkout records instead.
      for (let idx = 0; idx < updatedLines.length; idx++) {
        const line = updatedLines[idx];
        const incoming = incomingLines[idx] || {};
        const qtyToIssueNow = incoming.issuedQty != null ? Number(incoming.issuedQty) : 0;
        if (!line.itemId || qtyToIssueNow <= 0) continue;

        const itemData = itemMap[line.itemId];
        const isAsset = itemData && !CONSUMABLE_TYPES.includes(itemData.item_type);

        if (isAsset) {
          for (let i = 0; i < qtyToIssueNow; i++) {
            const checkoutId = `UINV-AC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await client.from('uinv_asset_checkouts').insert({
              id: checkoutId,
              property_id: existingIssue.property_id || null,
              item_id: line.itemId,
              issue_id: existingIssue.id,
              store_id: deptStoreId || MAIN_STORE_ID,
              department: existingIssue.department,
              checked_out_to: existingIssue.requester || existingIssue.department || 'Unknown',
              checked_out_at: new Date().toISOString(),
              status: 'Active',
              checkout_condition: 'Good',
              checkout_notes: `Issued via ${existingIssue.issue_number}`,
              performed_by: performedBy,
            });
          }
          // Write a ledger entry for the asset checkout (no stock deduction)
          await appendLedger(client, {
            property_id: existingIssue.property_id,
            item_id: line.itemId,
            store_id: MAIN_STORE_ID,
            location_id: null,
            transaction_type: 'Asset Checkout',
            reference: existingIssue.issue_number,
            quantity_in: 0,
            quantity_out: 0, // Assets are not deducted from on_hand
            balance: 0,
            unit_cost: line.cost || 0,
            value: 0,
            performed_by: performedBy,
            reason: `Asset checked out to ${existingIssue.department} (${qtyToIssueNow} unit${qtyToIssueNow > 1 ? 's' : ''})`,
          });
        }
      }

      // -- Phase 2: Persist updated lines so the RPC can read them --
      // The RPC reads issue.lines from the DB row, so we write the accumulated
      // issuedQty values before calling it.
      await client.from('uinv_issues').update({ lines: updatedLines }).eq('id', existingIssue.id);

      // -- Phase 3: Distribute consumable stock atomically via RPC --
      // The issue_stock_to_department RPC deducts from MAIN warehouse and adds
      // to the department store for all consumable lines in a single database
      // transaction. If any line fails (e.g. insufficient stock), the entire
      // distribution rolls back � no partial state.
      try {
        const rpcResult = await client.rpc('issue_stock_to_department', {
          p_issue_id: existingIssue.id,
          p_performed_by: performedBy,
        });
        if (rpcResult.error) {
          console.error('[uinv-portal] issue_stock_to_department RPC failed:', rpcResult.error.message);
          return res.status(500).json({
            error: `Stock distribution failed: ${rpcResult.error.message}. No stock was moved.`,
          });
        }
        const rpcData = rpcResult.data;
        if (rpcData && rpcData.success === false) {
          const errMsg = (rpcData.errors || []).map((e: any) => e.error || JSON.stringify(e)).join('; ');
          return res.status(400).json({
            error: `Stock distribution failed: ${errMsg}. No stock was moved.`,
          });
        }
      } catch (e: any) {
        console.error('[uinv-portal] issue_stock_to_department RPC exception:', e.message);
        return res.status(500).json({
          error: `Stock distribution failed: ${e.message}. No stock was moved.`,
        });
      }

      // Auto-determine final status: if all lines fully issued ? "Issued", else "Partially Issued"
      const allFullyIssued = updatedLines.every((l: any) => Number(l.issuedQty) >= Number(l.requestedQty || 0));
      body.approval_status = allFullyIssued ? 'Issued' : 'Partially Issued';
      body.lines = updatedLines;
      body.issued_by = performedBy;
      body.issued_at = new Date().toISOString();
    }
  }

  // Build update payload with only known columns
  const updatePayload: Record<string, any> = {};
  if (body.approval_status) updatePayload.approval_status = body.approval_status;
  if (body.lines) updatePayload.lines = body.lines;
  if (body.issued_by) updatePayload.issued_by = body.issued_by;
  if (body.issued_at) updatePayload.issued_at = body.issued_at;
  if (body.approved_by) updatePayload.approved_by = body.approved_by;
  if (body.approved_at) updatePayload.approved_at = body.approved_at;
  if (body.notes) updatePayload.notes = body.notes;
  if (body.department) updatePayload.department = body.department;
  if (body.store_id) updatePayload.store_id = body.store_id;
  if (body.requester) updatePayload.requester = body.requester;
  if (body.priority) updatePayload.priority = body.priority;
  if (body.required_date) updatePayload.required_date = body.required_date;
  if (body.cost_center) updatePayload.cost_center = body.cost_center;
  if (body.purpose) updatePayload.purpose = body.purpose;
  if (body.source) updatePayload.source = body.source;
  if (body.requisition_id !== undefined) updatePayload.requisition_id = body.requisition_id;

  const { data, error } = await client.from('uinv_issues').update(updatePayload).eq('id', req.params.id).select().single();
  if (error) {
    console.error('[uinv-portal] PATCH /issues/:id error:', error.message, 'payload:', JSON.stringify(updatePayload));
    return res.status(500).json({ error: error.message });
  }

  // -- Invalidate the receiving department's inventory cache --------------
  // When stock is distributed to a department store (Issued / Partially Issued),
  // the department's cached inventory list would otherwise be stale for up to
  // its TTL (15s for HK). Invalidate the matching cache pattern so the next
  // read sees the new balance. No-op for departments that don't cache.
  if (existingIssue && (targetStatus === 'Issued' || targetStatus === 'Partially Issued') && existingIssue.department) {
    const cachePattern = getInventoryCachePattern(existingIssue.department);
    if (cachePattern) cacheService.invalidatePattern(cachePattern);
  }

  // Notify the originating department about status changes on their requisition
  if (existingIssue && existingIssue.source === 'Requisition' && existingIssue.department && existingIssue.department !== 'Inventory') {
    const newStatus = data.approval_status;
    const oldStatus = existingIssue.approval_status;
    if (newStatus !== oldStatus) {
      let msg = '';
      let ntype = '';
      if (newStatus === 'Approved') { msg = `Requisition ${data.issue_number} has been approved by Inventory.`; ntype = 'Requisition Approved'; }
      else if (newStatus === 'Rejected') { msg = `Requisition ${data.issue_number} has been rejected by Inventory.`; ntype = 'Requisition Rejected'; }
      else if (newStatus === 'Partially Issued') { msg = `Requisition ${data.issue_number} has been partially issued. Remaining items are pending.`; ntype = 'Requisition Partially Issued'; }
      else if (newStatus === 'Issued') { msg = `Requisition ${data.issue_number} has been fully issued by Inventory.`; ntype = 'Requisition Issued'; }
      else if (newStatus === 'Cancelled') { msg = `Requisition ${data.issue_number} has been cancelled.`; ntype = 'Requisition Cancelled'; }
      if (msg) {
        await notifyDepartment(client, {
          property_id: data.property_id,
          department: existingIssue.department,
          issue_id: data.id,
          issue_number: data.issue_number,
          notification_type: ntype,
          message: msg,
          created_by: performedBy,
        });
      }
    }
  }

  return res.json(data);
});

router.delete('/issues/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_issues').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// NOTIFICATIONS (cross-department communication for requisitions)
// ----------------------------------------------------------------
router.get('/notifications', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { department, propertyId, unreadOnly } = req.query as Record<string, string>;
  let q = client.from('uinv_notifications').select('*').order('created_at', { ascending: false });
  if (department) q = q.eq('department', department);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (unreadOnly === 'true') q = q.eq('is_read', false);
  const { data, error } = await q.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.patch('/notifications/:id/read', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_notifications').update({ is_read: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.patch('/notifications/read-all', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { department, propertyId } = req.body as Record<string, string>;
  let q = client.from('uinv_notifications').update({ is_read: true }).eq('is_read', false);
  if (department) q = q.eq('department', department);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// TRANSFERS
// ----------------------------------------------------------------
router.get('/transfers', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_transfers').select('*, from_store:uinv_stores!from_store_id(*), to_store:uinv_stores!to_store_id(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/transfers', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  const fromStoreId = body.from_store_id;
  const toStoreId = body.to_store_id;

  // -- Two-leg routing: if neither store is Central (Main Warehouse),
  //    split into Leg 1 (Dept A ? Central) + Leg 2 (Central ? Dept B) --
  const isDeptToDept = fromStoreId && toStoreId
    && fromStoreId !== MAIN_STORE_ID
    && toStoreId !== MAIN_STORE_ID
    && fromStoreId !== toStoreId;

  if (isDeptToDept) {
    // Generate transfer numbers for both legs
    const year = new Date().getFullYear();
    const { data: existing } = await client.from('uinv_transfers')
      .select('transfer_number')
      .like('transfer_number', `TRF-${year}-%`)
      .order('transfer_number', { ascending: false })
      .limit(1);
    let seq = 1;
    if (existing && existing.length > 0) {
      const match = (existing[0].transfer_number || '').match(/TRF-\d{4}-(\d+)/);
      if (match) seq = parseInt(match[1], 10) + 1;
    }
    const leg1Number = `TRF-${year}-${String(seq).padStart(5, '0')}`;
    const leg2Number = `TRF-${year}-${String(seq + 1).padStart(5, '0')}`;

    const transferValue = Number(body.transfer_value || 0);
    const lines = body.lines || [];
    const reason = body.reason || 'Department-to-department transfer via Central';
    const notes = (body.notes || '') + ' | Auto-routed through Central Warehouse (two-leg transfer)';

    // Create Leg 1: From Department ? Central
    const leg1Id = crypto.randomUUID();
    const { data: leg1, error: leg1Err } = await client.from('uinv_transfers').insert({
      id: leg1Id,
      property_id: body.property_id,
      transfer_number: leg1Number,
      from_store_id: fromStoreId,
      to_store_id: MAIN_STORE_ID,
      via_store_id: MAIN_STORE_ID,
      lines: lines,
      transfer_value: transferValue,
      status: 'Pending',
      priority: body.priority || 'Normal',
      reason,
      notes,
      leg: 1,
      created_by: performedBy,
    }).select().single();
    if (leg1Err) return res.status(500).json({ error: leg1Err.message });

    // Create Leg 2: Central ? To Department (linked to Leg 1)
    const leg2Id = crypto.randomUUID();
    const { data: leg2, error: leg2Err } = await client.from('uinv_transfers').insert({
      id: leg2Id,
      property_id: body.property_id,
      transfer_number: leg2Number,
      from_store_id: MAIN_STORE_ID,
      to_store_id: toStoreId,
      via_store_id: MAIN_STORE_ID,
      lines: lines,
      transfer_value: transferValue,
      status: 'Pending',
      priority: body.priority || 'Normal',
      reason,
      notes: notes + ` | Linked to Leg 1: ${leg1Number}`,
      leg: 2,
      parent_transfer_id: leg1Id,
      created_by: performedBy,
    }).select().single();
    if (leg2Err) return res.status(500).json({ error: leg2Err.message });

    return res.status(201).json({
      ...leg1,
      _twoLeg: true,
      _leg1: leg1,
      _leg2: leg2,
      _message: `Two-leg transfer created: ${leg1Number} (Dept?Central) + ${leg2Number} (Central?Dept)`,
    });
  }

  // -- Normal single-leg transfer (involves Central or same-store) --
  const { data, error } = await client.from('uinv_transfers').insert({
    ...body,
    status: body.status || 'Pending',
    leg: 1,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/transfers/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Handle status transitions with stock movements.
  // All legs route through the atomic uinv_apply_stock_movement RPC
  // (migration 387): exact-row locking, availability validation (no more
  // silent Math.max(0, �) clamping on over-dispatch), and ledger rows
  // appended in the same transaction.
  try {
    if (body.status === 'Dispatched' || body.status === 'In Transit') {
      const { data: existing } = await client.from('uinv_transfers').select('*').eq('id', req.params.id).single();
      if (existing && (existing.status === 'Pending' || existing.status === 'Approved')) {
        // Deduct from source store (validated against available stock)
        for (const line of (existing.lines || [])) {
          if (!line.itemId || !line.quantity) continue;
          await applyStockMovement(client, {
            propertyId: existing.property_id,
            itemId: line.itemId,
            storeId: existing.from_store_id,
            transactionType: 'Store Transfer',
            qtyOut: Number(line.quantity),
            reference: existing.transfer_number,
            unitCost: Number(line.unitCost || 0),
            performedBy,
            reason: `Transfer dispatched to ${existing.to_store_id}`,
          });
        }
        body.dispatched_by = performedBy;
        body.dispatched_at = new Date().toISOString();
      }
    }

    if (body.status === 'Received') {
      const { data: existing } = await client.from('uinv_transfers').select('*').eq('id', req.params.id).single();
      if (existing && (existing.status === 'In Transit' || existing.status === 'Dispatched')) {
        // Add to destination store
        for (const line of (existing.lines || [])) {
          if (!line.itemId || !line.quantity) continue;
          await applyStockMovement(client, {
            propertyId: existing.property_id,
            itemId: line.itemId,
            storeId: existing.to_store_id,
            transactionType: 'Store Transfer',
            qtyIn: Number(line.quantity),
            reference: existing.transfer_number,
            unitCost: Number(line.unitCost || 0),
            performedBy,
            reason: `Transfer received from ${existing.from_store_id}`,
          });
        }
        body.received_by = performedBy;
        body.received_at = new Date().toISOString();

        // -- Two-leg auto-advancement: when Leg 1 (Dept?Central) is received,
        //    auto-dispatch Leg 2 (Central?Dept) from Central --
        if (existing.leg === 1 && existing.parent_transfer_id === null) {
          const { data: leg2 } = await client.from('uinv_transfers')
            .select('*')
            .eq('parent_transfer_id', existing.id)
            .eq('leg', 2)
            .single();
          if (leg2 && leg2.status === 'Pending') {
            // Auto-dispatch Leg 2: deduct from Central (validated � Central can
            // no longer be silently overdrawn), add to destination.
            for (const line of (leg2.lines || [])) {
              if (!line.itemId || !line.quantity) continue;
              await applyStockMovement(client, {
                propertyId: leg2.property_id,
                itemId: line.itemId,
                storeId: MAIN_STORE_ID,
                transactionType: 'Store Transfer',
                qtyOut: Number(line.quantity),
                reference: leg2.transfer_number,
                unitCost: Number(line.unitCost || 0),
                performedBy,
                reason: `Leg 2 dispatched to ${leg2.to_store_id} (auto-triggered by Leg 1 receipt)`,
              });
              await applyStockMovement(client, {
                propertyId: leg2.property_id,
                itemId: line.itemId,
                storeId: leg2.to_store_id,
                transactionType: 'Store Transfer',
                qtyIn: Number(line.quantity),
                reference: leg2.transfer_number,
                unitCost: Number(line.unitCost || 0),
                performedBy,
                reason: `Leg 2 received from Central (auto-triggered by Leg 1: ${existing.transfer_number})`,
              });
            }
            // Mark Leg 2 as Received (completed)
            await client.from('uinv_transfers').update({
              status: 'Received',
              dispatched_by: performedBy,
              dispatched_at: new Date().toISOString(),
              received_by: performedBy,
              received_at: new Date().toISOString(),
              notes: (leg2.notes || '') + ` | Auto-completed when Leg 1 (${existing.transfer_number}) was received by Central.`,
            }).eq('id', leg2.id);
          }
        }
      }
    }
  } catch (e: any) {
    return movementErrorResponse(res, e);
  }

  const { data, error } = await client.from('uinv_transfers').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Invalidate caches for both the source and destination stores.
  if (data?.from_store_id) {
    const p = getInventoryCachePatternForStore(data.from_store_id);
    if (p) cacheService.invalidatePattern(p);
  }
  if (data?.to_store_id) {
    const p = getInventoryCachePatternForStore(data.to_store_id);
    if (p) cacheService.invalidatePattern(p);
  }
  // Also invalidate Central if this was a two-leg transfer
  if (data?.leg === 1 || data?.parent_transfer_id) {
    const p = getInventoryCachePatternForStore(MAIN_STORE_ID);
    if (p) cacheService.invalidatePattern(p);
  }

  return res.json(data);
});

router.delete('/transfers/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Guard: deleting a dispatched-but-not-received transfer would strand the
  // deducted stock. Reverse it back to the source store first; reject delete
  // of fully Received transfers (the ledger is immutable history).
  const { data: existing } = await client.from('uinv_transfers').select('*').eq('id', req.params.id).single();
  if (existing && existing.status === 'Received') {
    return res.status(409).json({ error: 'Cannot delete a completed (Received) transfer � cancel or reverse it via a counter-transfer instead.' });
  }
  if (existing && (existing.status === 'Dispatched' || existing.status === 'In Transit')) {
    try {
      for (const line of (existing.lines || [])) {
        if (!line.itemId || !line.quantity) continue;
        await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: line.itemId,
          storeId: existing.from_store_id,
          transactionType: 'Transfer Cancellation',
          qtyIn: Number(line.quantity),
          reference: existing.transfer_number,
          unitCost: Number(line.unitCost || 0),
          performedBy,
          reason: `Stock returned for deleted transfer ${existing.transfer_number}`,
        });
      }
    } catch (e: any) {
      return movementErrorResponse(res, e);
    }
  }

  const { error } = await client.from('uinv_transfers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// ADJUSTMENTS
// ----------------------------------------------------------------
router.get('/adjustments', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_adjustments').select('*, item:uinv_items(*), store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/adjustments', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Generate adjustment_number: ADJ-YYYY-NNNN
  const year = new Date().getFullYear();
  const { data: existing } = await client.from('uinv_adjustments')
    .select('adjustment_number')
    .like('adjustment_number', `ADJ-${year}-%`)
    .order('adjustment_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (existing && existing.length > 0) {
    const match = (existing[0].adjustment_number || '').match(/ADJ-\d{4}-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  const adjustmentNumber = `ADJ-${year}-${String(seq).padStart(4, '0')}`;

  const { data, error } = await client.from('uinv_adjustments').insert({
    adjustment_number: adjustmentNumber,
    property_id: body.property_id || null,
    item_id: body.item_id,
    store_id: body.store_id || null,
    location_id: body.location_id || null,
    batch_id: body.batch_id || null,
    adjustment_type: body.adjustment_type || 'Quantity Increase',
    reason: body.reason || 'System Correction',
    quantity_delta: body.quantity_delta || 0,
    unit_cost: body.unit_cost || 0,
    value_delta: body.value_delta || (Number(body.quantity_delta || 0) * Number(body.unit_cost || 0)),
    status: body.status || 'Pending',
    reference: body.reference || null,
    notes: body.notes || null,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// Bulk adjustments � create multiple adjustments in one request
// Body: { store_id, reason, adjustment_type, adjustment_date, notes, property_id, lines: [{ item_id, quantity_delta, unit_cost, adjustment_type?, reason? }] }
router.post('/adjustments/bulk', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) return res.status(400).json({ error: 'No adjustment lines provided.' });
  if (!body.store_id) return res.status(400).json({ error: 'Store is required.' });

  const year = new Date().getFullYear();
  const { data: existing } = await client.from('uinv_adjustments')
    .select('adjustment_number')
    .like('adjustment_number', `ADJ-${year}-%`)
    .order('adjustment_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (existing && existing.length > 0) {
    const match = (existing[0].adjustment_number || '').match(/ADJ-\d{4}-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }

  const inserts = [];
  for (const line of lines) {
    if (!line.item_id || !Number(line.quantity_delta)) continue;
    const adjustmentNumber = `ADJ-${year}-${String(seq).padStart(4, '0')}`;
    seq++;
    const delta = Number(line.quantity_delta);
    const unitCost = Number(line.unit_cost || 0);
    inserts.push({
      adjustment_number: adjustmentNumber,
      property_id: body.property_id || null,
      item_id: line.item_id,
      store_id: body.store_id,
      location_id: null,
      batch_id: null,
      adjustment_type: line.adjustment_type || body.adjustment_type || 'Quantity Increase',
      reason: line.reason || body.reason || 'System Correction',
      quantity_delta: delta,
      unit_cost: unitCost,
      value_delta: delta * unitCost,
      status: 'Pending',
      reference: body.reference || null,
      notes: body.notes || null,
      created_by: performedBy,
    });
  }

  if (inserts.length === 0) return res.status(400).json({ error: 'No valid adjustment lines (each needs item + non-zero qty).' });

  const { data, error } = await client.from('uinv_adjustments').insert(inserts).select();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/adjustments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const movementWarnings: string[] = [];

  // On approval, apply the quantity delta to stock + ledger.
  // Routed through the atomic RPC: negative deltas are validated against
  // available stock (previously clamped to 0), and the ledger row is
  // appended in the same transaction.
  if (body.status === 'Approved') {
    const { data: existing } = await client.from('uinv_adjustments').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Approved') {
      const delta = Number(existing.quantity_delta);
      const theoretical = await recomputeBalance(client, existing.item_id, existing.store_id, existing.location_id || null);
      try {
        await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: existing.item_id,
          storeId: existing.store_id,
          transactionType: 'Adjustment',
          qtyIn: delta > 0 ? delta : 0,
          qtyOut: delta < 0 ? Math.abs(delta) : 0,
          locationId: existing.location_id || null,
          batchId: existing.batch_id || null,
          reference: existing.adjustment_number,
          unitCost: Number(existing.unit_cost || 0),
          performedBy,
          reason: existing.reason,
          theoreticalQty: theoretical ? Number(theoretical.on_hand) : null,
          actualQty: (theoretical ? Number(theoretical.on_hand) : 0) + delta,
        });
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }

      // Auto-post Variance journal entry (Gap 4) � surfaced as a warning
      // instead of being silently swallowed.
      const adjValue = Number(existing.value_delta || 0);
      if (adjValue !== 0) {
        const { error: jErr } = await client.rpc('post_inventory_journal', {
          p_source_entity: 'uinv_adjustments',
          p_source_id: existing.id,
          p_posting_type: 'Variance',
          p_amount: adjValue,
          p_description: `Adjustment: ${existing.reason || 'System Correction'} - ${existing.adjustment_number}`,
          p_department: existing.department || null,
          p_property_id: existing.property_id || null,
          p_reference: existing.adjustment_number,
          p_created_by: performedBy,
        });
        if (jErr) movementWarnings.push(`Journal posting failed: ${jErr.message}`);
      }
      body.approved_by = performedBy;
      body.approved_at = new Date().toISOString();
    }
  }

  const { data, error } = await client.from('uinv_adjustments').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Invalidate the department cache for the adjusted store.
  if (data?.store_id) {
    const cachePattern = getInventoryCachePatternForStore(data.store_id);
    if (cachePattern) cacheService.invalidatePattern(cachePattern);
  }

  return res.json(movementWarnings.length ? { ...data, warnings: movementWarnings } : data);
});

router.delete('/adjustments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_adjustments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// RESERVATIONS
// ----------------------------------------------------------------
router.get('/reservations', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status, itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_reservations').select('*, item:uinv_items(*), store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/reservations', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_reservations').insert({
    ...body,
    status: body.status || 'Active',
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Increment reserved on the stock balance via the atomic RPC � the
  // reservation is rejected when it exceeds unreserved on-hand stock, and
  // the ledger row carries the correct running balance.
  if (body.itemId && body.storeId && body.quantity && (body.status || 'Active') === 'Active') {
    try {
      await applyStockMovement(client, {
        propertyId: body.propertyId || body.property_id || null,
        itemId: body.itemId,
        storeId: body.storeId,
        transactionType: 'Reservation',
        reservedDelta: Number(body.quantity),
        reference: data.reservation_number,
        performedBy,
        reason: `Reservation for ${body.department || 'department'}`,
      });
    } catch (e: any) {
      // Reservation record exists but stock could not be reserved � remove
      // it so the reservation list never shows stock that isn't held.
      await client.from('uinv_reservations').delete().eq('id', data.id);
      return movementErrorResponse(res, e);
    }
  }
  return res.status(201).json(data);
});

router.patch('/reservations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Any terminal transition (Released / Cancelled / FULFILLED � previously
  // missing, leaking reserved stock forever) releases the reservation hold.
  if (['Released', 'Cancelled', 'Fulfilled', 'Expired'].includes(body.status)) {
    const { data: existing } = await client.from('uinv_reservations').select('*').eq('id', req.params.id).single();
    if (existing && existing.status === 'Active') {
      try {
        await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: existing.item_id,
          storeId: existing.store_id,
          transactionType: 'Reservation Release',
          reservedDelta: -Number(existing.quantity),
          reference: existing.reservation_number,
          performedBy,
          reason: `Reservation ${body.status.toLowerCase()} � ${existing.reservation_number}`,
        });
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }
    }
  }

  const { data, error } = await client.from('uinv_reservations').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/reservations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Restore reserved stock before deleting � previously the delete left the
  // reserved quantity permanently held.
  const { data: existing } = await client.from('uinv_reservations').select('*').eq('id', req.params.id).single();
  if (existing && existing.status === 'Active') {
    try {
      await applyStockMovement(client, {
        propertyId: existing.property_id,
        itemId: existing.item_id,
        storeId: existing.store_id,
        transactionType: 'Reservation Release',
        reservedDelta: -Number(existing.quantity),
        reference: existing.reservation_number,
        performedBy,
        reason: `Reservation deleted � ${existing.reservation_number}`,
      });
    } catch (e: any) {
      return movementErrorResponse(res, e);
    }
  }

  const { error } = await client.from('uinv_reservations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// COUNTS (Stock Counts)
// ----------------------------------------------------------------
router.get('/counts', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_counts').select('*, store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/counts', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Generate count_number: CNT-YYYY-NNNN
  const year = new Date().getFullYear();
  const { data: existing } = await client.from('uinv_counts')
    .select('count_number')
    .like('count_number', `CNT-${year}-%`)
    .order('count_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (existing && existing.length > 0) {
    const match = (existing[0].count_number || '').match(/CNT-\d{4}-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  const countNumber = `CNT-${year}-${String(seq).padStart(4, '0')}`;

  const { data, error } = await client.from('uinv_counts').insert({
    count_number: countNumber,
    property_id: body.property_id || null,
    count_type: body.count_type || 'Cycle Count',
    store_id: body.store_id || null,
    is_blind: body.is_blind || false,
    lines: [],
    total_variance: 0,
    status: body.status || 'Draft',
    notes: body.notes || null,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/counts/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Build update object with only valid columns
  const update: Record<string, any> = {};
  if (body.count_type !== undefined) update.count_type = body.count_type;
  if (body.store_id !== undefined) update.store_id = body.store_id || null;
  if (body.is_blind !== undefined) update.is_blind = body.is_blind;
  if (body.lines !== undefined) update.lines = body.lines;
  if (body.total_variance !== undefined) update.total_variance = body.total_variance;
  if (body.status !== undefined) update.status = body.status;
  if (body.notes !== undefined) update.notes = body.notes;

  // Set timestamps on status transitions
  if (body.status === 'In Progress') {
    update.started_at = new Date().toISOString();
  } else if (body.status === 'Reconciled') {
    // Recalculate variance from lines if not provided
    if (body.lines && body.total_variance === undefined) {
      let totalVariance = 0;
      for (const line of body.lines) {
        const variance = Number(line.physicalQty) - Number(line.systemQty);
        const varianceValue = variance * Number(line.unitCost || 0);
        line.variance = variance;
        line.varianceValue = varianceValue;
        totalVariance += varianceValue;
      }
      update.lines = body.lines;
      update.total_variance = totalVariance;
    }
  } else if (body.status === 'Approved') {
    update.approved_by = performedBy;
    update.approved_at = new Date().toISOString();
    update.completed_at = new Date().toISOString();

    // On approval, create adjustments for variances + apply to stock
    const { data: existing } = await client.from('uinv_counts').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Approved') {
      const lines = update.lines || existing.lines || [];
      for (const line of lines) {
        if (!line.itemId) continue;
        const variance = Number(line.variance ?? (Number(line.physicalQty) - Number(line.systemQty)));
        if (variance === 0) continue;
        const varianceValue = Number(line.varianceValue ?? (variance * Number(line.unitCost || 0)));

        // Create an adjustment
        await client.from('uinv_adjustments').insert({
          property_id: existing.property_id,
          adjustment_number: `ADJ-CNT-${existing.count_number}-${line.itemId.slice(-4)}`,
          item_id: line.itemId,
          store_id: existing.store_id,
          adjustment_type: 'Count Variance',
          reason: `Count variance from ${existing.count_number}`,
          quantity_delta: variance,
          unit_cost: line.unitCost || 0,
          value_delta: varianceValue,
          status: 'Approved',
          reference: existing.count_number,
          approved_by: performedBy,
          approved_at: new Date().toISOString(),
          created_by: performedBy,
        });
        // Apply to stock via the atomic RPC — no silent clamping. A
        // negative variance that exceeds on-hand is rejected (the count
        // must be corrected rather than silently zeroing stock).
        try {
          await applyStockMovement(client, {
            propertyId: existing.property_id,
            itemId: line.itemId,
            storeId: existing.store_id,
            transactionType: 'Count Adjustment',
            qtyIn: variance > 0 ? variance : 0,
            qtyOut: variance < 0 ? Math.abs(variance) : 0,
            reference: existing.count_number,
            performedBy,
            reason: 'Count variance',
            theoreticalQty: Number(line.systemQty || 0),
            actualQty: Number(line.physicalQty || 0),
          });
        } catch (e: any) {
          return movementErrorResponse(res, e);
        }
      }
    }
  }

  const { data, error } = await client.from('uinv_counts').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Invalidate the department cache for the store that was counted.
  if (data?.store_id) {
    const cachePattern = getInventoryCachePatternForStore(data.store_id);
    if (cachePattern) cacheService.invalidatePattern(cachePattern);
  }

  return res.json(data);
});

router.delete('/counts/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_counts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// WASTE
// ----------------------------------------------------------------
router.get('/waste', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_waste').select('*, item:uinv_items(*), store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/waste', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Generate waste_number: WST-YYYY-NNNN
  const year = new Date().getFullYear();
  const { data: existing } = await client.from('uinv_waste')
    .select('waste_number')
    .like('waste_number', `WST-${year}-%`)
    .order('waste_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (existing && existing.length > 0) {
    const match = (existing[0].waste_number || '').match(/WST-\d{4}-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  const wasteNumber = `WST-${year}-${String(seq).padStart(4, '0')}`;

  const totalCost = Number(body.quantity || 0) * Number(body.unit_cost || body.unitCost || 0);
  const { data, error } = await client.from('uinv_waste').insert({
    waste_number: wasteNumber,
    property_id: body.property_id || null,
    item_id: body.item_id,
    store_id: body.store_id || null,
    batch_id: body.batch_id || null,
    quantity: body.quantity || 0,
    unit_cost: body.unit_cost || body.unitCost || 0,
    total_cost: totalCost,
    waste_type: body.waste_type || 'Spoilage',
    reason: body.reason || 'Spoilage',
    department: body.department || null,
    status: body.status || 'Draft',
    notes: body.notes || null,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Auto-post shrinkage journal entry (Gap 4)
  if (totalCost > 0 && data) {
    try {
      await client.rpc('post_inventory_journal', {
        p_source_entity: 'uinv_waste',
        p_source_id: data.id,
        p_posting_type: 'Shrinkage',
        p_amount: totalCost,
        p_description: `Waste: ${body.reason || 'Spoilage'} - ${wasteNumber}`,
        p_department: body.department || null,
        p_property_id: body.property_id || null,
        p_reference: wasteNumber,
        p_created_by: performedBy,
      });
    } catch (e) {
      console.error('[uinv] waste journal posting failed:', e);
    }
  }

  return res.status(201).json(data);
});

// Bulk waste � create multiple waste records in one request
// Body: { store_id, waste_type, reason, waste_date, notes, property_id, lines: [{ item_id, quantity, unit_cost, waste_type?, reason? }] }
router.post('/waste/bulk', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) return res.status(400).json({ error: 'No waste lines provided.' });
  if (!body.store_id) return res.status(400).json({ error: 'Store is required.' });

  const year = new Date().getFullYear();
  const { data: existing } = await client.from('uinv_waste')
    .select('waste_number')
    .like('waste_number', `WST-${year}-%`)
    .order('waste_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (existing && existing.length > 0) {
    const match = (existing[0].waste_number || '').match(/WST-\d{4}-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }

  const inserts = [];
  for (const line of lines) {
    if (!line.item_id || !Number(line.quantity)) continue;
    const wasteNumber = `WST-${year}-${String(seq).padStart(4, '0')}`;
    seq++;
    const qty = Number(line.quantity);
    const unitCost = Number(line.unit_cost || 0);
    inserts.push({
      waste_number: wasteNumber,
      property_id: body.property_id || null,
      item_id: line.item_id,
      store_id: body.store_id,
      batch_id: null,
      quantity: qty,
      unit_cost: unitCost,
      total_cost: qty * unitCost,
      waste_type: line.waste_type || body.waste_type || 'Spoilage',
      reason: line.reason || body.reason || 'Spoilage',
      department: body.department || null,
      status: 'Draft',
      notes: body.notes || null,
      created_by: performedBy,
    });
  }

  if (inserts.length === 0) return res.status(400).json({ error: 'No valid waste lines (each needs item + non-zero quantity).' });

  const { data, error } = await client.from('uinv_waste').insert(inserts).select();
  if (error) return res.status(500).json({ error: error.message });

  // Auto-post shrinkage journal entries for each waste record (Gap 4)
  for (const wasteRow of (data || [])) {
    const wasteCost = Number(wasteRow.total_cost || 0);
    if (wasteCost > 0) {
      try {
        await client.rpc('post_inventory_journal', {
          p_source_entity: 'uinv_waste',
          p_source_id: wasteRow.id,
          p_posting_type: 'Shrinkage',
          p_amount: wasteCost,
          p_description: `Bulk waste: ${wasteRow.reason || wasteRow.waste_type} - ${wasteRow.waste_number}`,
          p_department: body.department || null,
          p_property_id: body.property_id || null,
          p_reference: wasteRow.waste_number,
          p_created_by: performedBy,
        });
      } catch (e) {
        console.error('[uinv] bulk waste journal posting failed:', e);
      }
    }
  }

  return res.status(201).json(data);
});

router.patch('/waste/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // On approval, deduct stock + ledger via the atomic RPC � over-waste is
  // rejected (previously clamped to 0), batch quantity is deducted when the
  // waste row carries a batch_id, and the ledger row lands in the same
  // transaction.
  if (body.status === 'Approved') {
    const { data: existing } = await client.from('uinv_waste').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Approved') {
      const bal = await recomputeBalance(client, existing.item_id, existing.store_id, null);
      try {
        await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: existing.item_id,
          storeId: existing.store_id,
          transactionType: 'Waste',
          qtyOut: Number(existing.quantity),
          batchId: existing.batch_id || null,
          reference: existing.waste_number,
          unitCost: Number(existing.unit_cost || 0),
          performedBy,
          reason: existing.reason || existing.waste_type,
          theoreticalQty: bal ? Number(bal.on_hand) : null,
          actualQty: (bal ? Number(bal.on_hand) : 0) - Number(existing.quantity),
        });
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }
      body.approved_by = performedBy;
      body.approved_at = new Date().toISOString();
    }
  }

  const { data, error } = await client.from('uinv_waste').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Invalidate the department cache for the store that lost stock to waste.
  if (data?.store_id) {
    const cachePattern = getInventoryCachePatternForStore(data.store_id);
    if (cachePattern) cacheService.invalidatePattern(cachePattern);
  }

  return res.json(data);
});

router.delete('/waste/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_waste').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOCK LEDGER
// ----------------------------------------------------------------
router.get('/stock-ledger', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, itemId, storeId, transactionType, startDate, endDate } = req.query as Record<string, string>;
  let q = client.from('uinv_stock_ledger').select('*, item:uinv_items(*), store:uinv_stores(*)').order('transaction_date', { ascending: false }).limit(500);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (itemId) q = q.eq('item_id', itemId);
  if (storeId) q = q.eq('store_id', storeId);
  if (transactionType) q = q.eq('transaction_type', transactionType);
  if (startDate) q = q.gte('transaction_date', startDate);
  if (endDate) q = q.lte('transaction_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ----------------------------------------------------------------
// VALUATION
// ----------------------------------------------------------------
router.get('/valuation', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, storeId } = req.query as Record<string, string>;
  let q = client.from('uinv_stock_balances').select('*, item:uinv_items(*), store:uinv_stores(*)');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (storeId) q = q.eq('store_id', storeId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byItem = new Map<string, any>();
  for (const r of rows) {
    const key = r.item_id;
    if (!byItem.has(key)) byItem.set(key, {
      itemId: r.item_id,
      itemName: r.item?.item_name || 'Unknown',
      category: r.item?.category || 'Uncategorized',
      unitOfMeasure: r.item?.unit_of_measure || '',
      costingMethod: r.item?.costing_method || 'Weighted Average',
      totalQuantity: 0,
      totalValue: 0,
      avgUnitCost: 0,
      byStore: [],
    });
    const entry = byItem.get(key);
    entry.totalQuantity += Number(r.on_hand);
    entry.totalValue += Number(r.on_hand) * Number(r.unit_cost);
    entry.byStore.push({
      storeId: r.store_id,
      storeName: r.store?.store_name || 'Unknown',
      quantity: Number(r.on_hand),
      unitCost: Number(r.unit_cost),
      value: Number(r.on_hand) * Number(r.unit_cost),
    });
  }
  const valuation = Array.from(byItem.values()).map((v) => ({
    ...v,
    avgUnitCost: v.totalQuantity > 0 ? v.totalValue / v.totalQuantity : 0,
  }));
  const grandTotal = valuation.reduce((s, v) => s + v.totalValue, 0);
  const byCategory: Record<string, number> = {};
  for (const v of valuation) byCategory[v.category] = (byCategory[v.category] || 0) + v.totalValue;
  return res.json({
    grandTotal,
    totalItems: valuation.length,
    valuation,
    byCategory,
  });
});

// ----------------------------------------------------------------
// REPORTS � standard inventory reports (spec �17)
// GET /reports/:reportId?propertyId=&startDate=&endDate=
// ----------------------------------------------------------------
router.get('/reports/:reportId', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { reportId } = req.params;
  const { propertyId, startDate, endDate } = req.query as Record<string, string>;
  const propFilter = propertyId ? { property_id: propertyId } : {};

  try {
    let rows: Record<string, any>[] = [];
    let summary: Record<string, any> | undefined;

    switch (reportId) {
      // -- Stock Summary: on-hand value by store and category --
      case 'stock-summary': {
        let q = client.from('uinv_stock_balances')
          .select('*, item:uinv_items(item_name, item_code, category, unit_of_measure), store:uinv_stores(store_name, store_code, department)');
        if (propertyId) q = q.eq('property_id', propertyId);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        const map = new Map<string, any>();
        for (const r of data || []) {
          const key = `${r.store?.store_name || r.store_id}||${r.item?.category || 'Uncategorized'}`;
          if (!map.has(key)) map.set(key, {
            store: r.store?.store_name || 'Unknown',
            category: r.item?.category || 'Uncategorized',
            items: 0,
            quantity: 0,
            value: 0,
          });
          const e = map.get(key);
          e.items += 1;
          e.quantity += Number(r.on_hand || 0);
          e.value += Number(r.on_hand || 0) * Number(r.unit_cost || 0);
        }
        rows = Array.from(map.values()).sort((a, b) => b.value - a.value);
        summary = { totalValue: rows.reduce((s, r) => s + r.value, 0), totalItems: rows.reduce((s, r) => s + r.items, 0) };
        break;
      }

      // -- Movement Analysis: in/out flows over a period --
      case 'movement-analysis': {
        let q = client.from('uinv_stock_ledger')
          .select('*, item:uinv_items(item_name, item_code), store:uinv_stores(store_name)')
          .order('transaction_date', { ascending: false })
          .limit(1000);
        if (propertyId) q = q.eq('property_id', propertyId);
        if (startDate) q = q.gte('transaction_date', startDate);
        if (endDate) q = q.lte('transaction_date', endDate + 'T23:59:59');
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        rows = (data || []).map((r: any) => ({
          date: r.transaction_date,
          item: r.item?.item_name || r.item_id,
          code: r.item?.item_code || '',
          store: r.store?.store_name || r.store_id,
          type: r.transaction_type,
          quantity_in: r.quantity_in || 0,
          quantity_out: r.quantity_out || 0,
          balance: r.balance,
          reference: r.reference || '�',
        }));
        const totalIn = rows.reduce((s, r) => s + Number(r.quantity_in || 0), 0);
        const totalOut = rows.reduce((s, r) => s + Number(r.quantity_out || 0), 0);
        summary = { totalMovements: rows.length, totalIn, totalOut };
        break;
      }

      // -- Slow-Moving: no movement in 90+ days --
      case 'slow-moving': {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        let q = client.from('uinv_stock_balances')
          .select('*, item:uinv_items(item_name, item_code, category, unit_of_measure), store:uinv_stores(store_name)')
          .lt('last_movement_date', cutoff.toISOString());
        if (propertyId) q = q.eq('property_id', propertyId);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        rows = (data || []).map((r: any) => ({
          item: r.item?.item_name || 'Unknown',
          code: r.item?.item_code || '',
          store: r.store?.store_name || 'Unknown',
          category: r.item?.category || '�',
          on_hand: r.on_hand,
          value: Number(r.on_hand || 0) * Number(r.unit_cost || 0),
          last_movement: r.last_movement_date || 'Never',
        }));
        summary = { totalItems: rows.length, totalValue: rows.reduce((s, r) => s + r.value, 0) };
        break;
      }

      // -- Dead Stock: no movement in 180+ days --
      case 'dead-stock': {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 180);
        let q = client.from('uinv_stock_balances')
          .select('*, item:uinv_items(item_name, item_code, category, unit_of_measure), store:uinv_stores(store_name)')
          .lt('last_movement_date', cutoff.toISOString());
        if (propertyId) q = q.eq('property_id', propertyId);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        rows = (data || []).map((r: any) => ({
          item: r.item?.item_name || 'Unknown',
          code: r.item?.item_code || '',
          store: r.store?.store_name || 'Unknown',
          category: r.item?.category || '�',
          on_hand: r.on_hand,
          value: Number(r.on_hand || 0) * Number(r.unit_cost || 0),
          last_movement: r.last_movement_date || 'Never',
        }));
        summary = { totalItems: rows.length, totalValue: rows.reduce((s, r) => s + r.value, 0) };
        break;
      }

      // -- Consumption by Department --
      case 'consumption-by-dept': {
        let q = client.from('uinv_stock_ledger')
          .select('quantity_out, transaction_type, item:uinv_items(item_name, item_code), store:uinv_stores(store_name, department)')
          .eq('transaction_type', 'Consumption');
        if (propertyId) q = q.eq('property_id', propertyId);
        if (startDate) q = q.gte('transaction_date', startDate);
        if (endDate) q = q.lte('transaction_date', endDate + 'T23:59:59');
        const { data, error } = await q.limit(1000);
        if (error) return res.status(500).json({ error: error.message });
        const map = new Map<string, any>();
        for (const r of data || []) {
          const dept = r.store?.department || 'Unknown';
          if (!map.has(dept)) map.set(dept, { department: dept, items_consumed: 0, total_quantity: 0 });
          const e = map.get(dept);
          e.items_consumed += 1;
          e.total_quantity += Math.abs(Number(r.quantity_out || 0));
        }
        rows = Array.from(map.values()).sort((a, b) => b.total_quantity - a.total_quantity);
        summary = { totalDepartments: rows.length, totalConsumed: rows.reduce((s, r) => s + r.total_quantity, 0) };
        break;
      }

      // -- Valuation Summary --
      case 'valuation-summary': {
        let q = client.from('uinv_stock_balances')
          .select('*, item:uinv_items(item_name, item_code, category, costing_method), store:uinv_stores(store_name)');
        if (propertyId) q = q.eq('property_id', propertyId);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        const map = new Map<string, any>();
        for (const r of data || []) {
          const method = r.item?.costing_method || 'Weighted Average';
          if (!map.has(method)) map.set(method, { costing_method: method, items: 0, quantity: 0, value: 0 });
          const e = map.get(method);
          e.items += 1;
          e.quantity += Number(r.on_hand || 0);
          e.value += Number(r.on_hand || 0) * Number(r.unit_cost || 0);
        }
        rows = Array.from(map.values());
        summary = { grandTotal: rows.reduce((s, r) => s + r.value, 0) };
        break;
      }

      // -- Count Variance Report (lines are a JSONB array on uinv_counts) --
      case 'variance-report': {
        let q = client.from('uinv_counts')
          .select('*, store:uinv_stores(store_name)')
          .order('created_at', { ascending: false });
        if (propertyId) q = q.eq('property_id', propertyId);
        const { data, error } = await q.limit(200);
        if (error) return res.status(500).json({ error: error.message });
        // Fetch item names in bulk
        const itemIds = new Set<string>();
        for (const c of data || []) {
          for (const line of (c.lines || [])) {
            if (line.itemId) itemIds.add(line.itemId);
          }
        }
        const itemMap = new Map<string, any>();
        if (itemIds.size > 0) {
          const { data: items } = await client.from('uinv_items')
            .select('id, item_name, item_code')
            .in('id', Array.from(itemIds));
          for (const it of items || []) itemMap.set(it.id, it);
        }
        rows = [];
        for (const c of data || []) {
          for (const line of (c.lines || [])) {
            const variance = Number(line.variance ?? (Number(line.physicalQty) - Number(line.systemQty)));
            if (variance === 0) continue;
            const it = itemMap.get(line.itemId);
            rows.push({
              count_number: c.count_number || '�',
              store: c.store?.store_name || '�',
              item: it?.item_name || line.itemId,
              code: it?.item_code || '',
              expected: line.systemQty,
              counted: line.physicalQty,
              variance,
              variance_value: line.varianceValue ?? (variance * Number(line.unitCost || 0)),
            });
          }
        }
        summary = { totalVariances: rows.length, netVarianceValue: rows.reduce((s, r) => s + Number(r.variance_value || 0), 0) };
        break;
      }

      // -- Waste Summary --
      case 'waste-summary': {
        let q = client.from('uinv_waste')
          .select('*, item:uinv_items(item_name, item_code), store:uinv_stores(store_name)');
        if (propertyId) q = q.eq('property_id', propertyId);
        if (startDate) q = q.gte('created_at', startDate);
        if (endDate) q = q.lte('created_at', endDate + 'T23:59:59');
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        const map = new Map<string, any>();
        for (const r of data || []) {
          const reason = r.reason || r.waste_type || 'Unknown';
          if (!map.has(reason)) map.set(reason, { reason, count: 0, total_cost: 0 });
          const e = map.get(reason);
          e.count += 1;
          e.total_cost += Number(r.total_cost || 0);
        }
        rows = Array.from(map.values()).sort((a, b) => b.total_cost - a.total_cost);
        summary = { totalRecords: rows.reduce((s, r) => s + r.count, 0), totalCost: rows.reduce((s, r) => s + r.total_cost, 0) };
        break;
      }

      // -- Expiry Report --
      case 'expiry-report': {
        let q = client.from('uinv_batches')
          .select('*, item:uinv_items(item_name, item_code, unit_of_measure), store:uinv_stores(store_name, property_id)')
          .not('expiry_date', 'is', null)
          .order('expiry_date', { ascending: true });
        const { data, error } = await q.limit(500);
        if (error) return res.status(500).json({ error: error.message });
        // Filter by property via the joined store (uinv_batches has no property_id column)
        const filtered = propertyId
          ? (data || []).filter((r: any) => r.store?.property_id === propertyId)
          : (data || []);
        const now = new Date();
        const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30);
        rows = filtered.map((r: any) => {
          const exp = new Date(r.expiry_date);
          const expired = exp < now;
          const expiringSoon = !expired && exp <= thirtyDays;
          return {
            item: r.item?.item_name || 'Unknown',
            code: r.item?.item_code || '',
            batch: r.batch_number || '�',
            store: r.store?.store_name || '�',
            expiry_date: r.expiry_date,
            quantity: r.quantity_on_hand || r.quantity || 0,
            status: expired ? 'Expired' : expiringSoon ? 'Expiring Soon' : 'OK',
          };
        });
        summary = {
          totalBatches: rows.length,
          expired: rows.filter(r => r.status === 'Expired').length,
          expiringSoon: rows.filter(r => r.status === 'Expiring Soon').length,
        };
        break;
      }

      // -- Stock Ledger Audit --
      case 'ledger-audit': {
        let q = client.from('uinv_stock_ledger')
          .select('*, item:uinv_items(item_name, item_code), store:uinv_stores(store_name)')
          .order('transaction_date', { ascending: false })
          .limit(500);
        if (propertyId) q = q.eq('property_id', propertyId);
        if (startDate) q = q.gte('transaction_date', startDate);
        if (endDate) q = q.lte('transaction_date', endDate + 'T23:59:59');
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        rows = (data || []).map((r: any) => ({
          date: r.transaction_date,
          item: r.item?.item_name || r.item_id,
          code: r.item?.item_code || '',
          store: r.store?.store_name || r.store_id,
          type: r.transaction_type,
          quantity_in: r.quantity_in || 0,
          quantity_out: r.quantity_out || 0,
          balance: r.balance,
          unit_cost: r.unit_cost,
          reference: r.reference || '�',
          created_by: r.created_by || '�',
        }));
        summary = { totalEntries: rows.length };
        break;
      }

      default:
        return res.status(404).json({ error: `Unknown report: ${reportId}` });
    }

    return res.json({ reportId, rows, summary });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to generate report' });
  }
});

// ----------------------------------------------------------------
// REPLENISHMENT
// ----------------------------------------------------------------
router.get('/replenishment', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_replenishment').select('*, item:uinv_items(*), store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/** Create a single replenishment request (manual). */
router.post('/replenishment', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_replenishment').insert({
    ...req.body,
    status: req.body.status || 'Open',
    created_by: performedBy,
  }).select('*, item:uinv_items(*), store:uinv_stores(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

/** Recalculate replenishment requirements from live stock data. */
router.post('/replenishment/recalculate', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId } = req.body || {};
  const { data: stock } = await client.from('uinv_stock_balances').select('item_id, store_id, on_hand').match(propertyId ? { property_id: propertyId } : {});
  const { data: items } = await client.from('uinv_items').select('id, item_name, reorder_point, par_level, max_stock, min_stock').match(propertyId ? { property_id: propertyId } : {});

  const stockByItemStore = new Map<string, number>();
  for (const s of (stock || [])) {
    const key = `${s.item_id}:${s.store_id}`;
    stockByItemStore.set(key, (stockByItemStore.get(key) || 0) + Number(s.on_hand));
  }

  const requirements: any[] = [];
  for (const item of (items || [])) {
    // Aggregate stock across stores for this item
    let totalStock = 0;
    for (const [key, qty] of stockByItemStore.entries()) {
      if (key.startsWith(`${item.id}:`)) totalStock += qty;
    }
    const reorderPoint = Number(item.reorder_point || 0);
    const parLevel = Number(item.par_level || 0);
    const maxStock = Number(item.max_stock || 0);
    if (totalStock <= reorderPoint) {
      const suggested = Math.max(0, (parLevel || maxStock || reorderPoint * 2) - totalStock);
      const urgency = totalStock <= Number(item.min_stock || 0) ? 'Urgent' : totalStock <= reorderPoint ? 'High' : 'Normal';
      requirements.push({
        property_id: propertyId,
        item_id: item.id,
        store_id: null,
        current_stock: totalStock,
        reorder_point: reorderPoint,
        par_level: parLevel,
        suggested_qty: suggested,
        urgency,
        status: 'Open',
      });
    }
  }

  // Upsert requirements (delete existing Open ones first for this property)
  if (propertyId) {
    await client.from('uinv_replenishment').delete().eq('property_id', propertyId).eq('status', 'Open');
  }
  if (requirements.length > 0) {
    await client.from('uinv_replenishment').insert(requirements);
  }
  return res.json({ generated: requirements.length, requirements });
});

router.patch('/replenishment/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_replenishment').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/replenishment/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_replenishment').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// AUTO-REPLENISHMENT (Central ? Department Stores)
// ----------------------------------------------------------------

/**
 * POST /replenishment/auto-replenish
 * Triggers the auto_replenish_department_stores() DB function.
 * Scans all department store balances where on_hand <= replenish_min,
 * creates transfers from Main Warehouse, moves stock, and logs to ledger.
 *
 * Body: { propertyId?: string }
 * Returns: { generated: number, transfers: [...] }
 */
router.post('/replenishment/auto-replenish', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId } = req.body || {};
  try {
    const { data, error } = await client.rpc('auto_replenish_department_stores', {
      p_property_id: propertyId || null,
    });
    if (error) {
      console.error('[uinv] auto-replenish RPC error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    const transfers = data || [];
    return res.json({ generated: transfers.length, transfers });
  } catch (e: any) {
    console.error('[uinv] auto-replenish exception:', e?.message);
    return res.status(500).json({ error: e?.message || 'Auto-replenish failed' });
  }
});

// ----------------------------------------------------------------
// REQUEST-DRIVEN REPLENISHMENT (Department requests ? Central fulfills)
// ----------------------------------------------------------------

/**
 * POST /replenishment/generate-requests
 * Scans department store balances where on_hand <= replenish_min and creates
 * uinv_replenishment rows with status 'Suggested' (request-driven model).
 * Departments review these suggestions, approve them, and then Central
 * fulfills via POST /replenishment/:id/fulfill.
 *
 * Body: { propertyId?: string }
 * Returns: { generated: number, requests: [...] }
 */
router.post('/replenishment/generate-requests', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId } = req.body || {};
  const performedBy = req.user?.name || req.user?.id || 'system';

  try {
    // Fetch all dept store balances � trigger when on_hand <= reorder_point
    let q = client.from('uinv_stock_balances')
      .select('id, store_id, item_id, on_hand, replenish_min, replenish_max, unit_cost, property_id, item:uinv_items(id, item_name, item_code, unit_of_measure, reorder_point, par_level, max_stock, min_stock), store:uinv_stores(id, store_name, store_code, department)')
      .neq('store_id', MAIN_STORE_ID);
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data: balances, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Trigger threshold = reorder_point (item-level).
    // Target = par_level (fall back to max_stock, then replenish_max).
    const candidates = (balances || []).map((r: any) => {
      const reorderPoint = Number(r.item?.reorder_point) || 0;
      const parLevel = Number(r.item?.par_level) || 0;
      const maxStock = Number(r.item?.max_stock) || 0;
      const replenishMax = Number(r.replenish_max) || 0;
      const effTarget = parLevel > 0 ? parLevel : (maxStock > 0 ? maxStock : replenishMax);
      return { r, reorderPoint, effTarget };
    }).filter(e => e.reorderPoint > 0 && Number(e.r.on_hand) <= e.reorderPoint);

    // Fetch existing open requests (Draft or Requested) to avoid duplicates
    let existingQ = client.from('uinv_replenishment')
      .select('item_id, store_id, status')
      .in('status', ['Draft', 'Requested']);
    if (propertyId) existingQ = existingQ.eq('property_id', propertyId);
    const { data: existing } = await existingQ;
    const existingKeys = new Set((existing || []).map((e: any) => `${e.item_id}:${e.store_id}`));

    const requests: any[] = [];
    for (const c of candidates) {
      const key = `${c.r.item_id}:${c.r.store_id}`;
      if (existingKeys.has(key)) continue; // Skip duplicates

      const suggestedQty = Math.max(0, c.effTarget - Number(c.r.on_hand));
      if (suggestedQty <= 0) continue;

      // Urgency: at/below min_stock = Urgent, below half of reorder = High, else Normal
      const minStock = Number(c.r.item?.min_stock) || 0;
      const urgency = minStock > 0 && Number(c.r.on_hand) <= minStock ? 'Urgent'
        : Number(c.r.on_hand) <= c.reorderPoint * 0.5 ? 'High'
        : 'Normal';

      const deptName = c.r.store?.department || c.r.store?.store_name || 'Department';
      requests.push({
        property_id: c.r.property_id || propertyId || null,
        item_id: c.r.item_id,
        store_id: c.r.store_id,
        current_stock: Number(c.r.on_hand),
        reorder_point: c.reorderPoint,
        par_level: c.effTarget,
        suggested_qty: suggestedQty,
        urgency,
        status: 'Draft',
        notes: `Auto-calculated for ${deptName} � stock at/below reorder point. On hand: ${c.r.on_hand}, Reorder: ${c.reorderPoint}, Par: ${c.effTarget}. Approve to send to Central Inventory.`,
      });
    }

    if (requests.length > 0) {
      const { data: inserted, error: insertErr } = await client.from('uinv_replenishment')
        .insert(requests).select();
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      return res.json({ generated: inserted.length, requests: inserted });
    }
    return res.json({ generated: 0, requests: [] });
  } catch (e: any) {
    console.error('[uinv] generate-requests error:', e?.message);
    return res.status(500).json({ error: e?.message || 'Failed to generate replenishment requests' });
  }
});

/**
 * POST /replenishment/:id/fulfill
 * Fulfills a replenishment request by creating a transfer from Main Warehouse
 * to the requesting department store, moving stock, and logging to ledger.
 * Marks the request status as 'Received'.
 *
 * Body: { quantity?: number (defaults to suggested_qty) }
 */
router.post('/replenishment/:id/fulfill', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { id } = req.params;
  const fulfillQty = req.body?.quantity ? Number(req.body.quantity) : null;

  try {
    // Fetch the replenishment request
    const { data: reqRow, error: reqErr } = await client.from('uinv_replenishment')
      .select('*, item:uinv_items(*), store:uinv_stores(*)')
      .eq('id', id).single();
    if (reqErr || !reqRow) return res.status(404).json({ error: 'Replenishment request not found' });

    if (reqRow.status === 'Received' || reqRow.status === 'Fulfilled' || reqRow.status === 'Cancelled') {
      return res.status(400).json({ error: `Cannot fulfill a request with status '${reqRow.status}'` });
    }

    const qty = fulfillQty || Number(reqRow.suggested_qty);
    if (qty <= 0) return res.status(400).json({ error: 'Fulfillment quantity must be positive' });

    const itemId = reqRow.item_id;
    const deptStoreId = reqRow.store_id;
    if (!deptStoreId) return res.status(400).json({ error: 'Request has no target store' });

    // Check Main Warehouse has enough stock
    const { data: mainBal } = await client.from('uinv_stock_balances')
      .select('id, on_hand, unit_cost, location_id')
      .eq('item_id', itemId)
      .eq('store_id', MAIN_STORE_ID)
      .maybeSingle();

    if (!mainBal || Number(mainBal.on_hand) <= 0) {
      // Central has no stock � keep request as Requested, add note
      await client.from('uinv_replenishment').update({
        notes: (reqRow.notes || '') + ` | Fulfillment attempted but Main Warehouse has no stock. By: ${performedBy}`,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      return res.status(400).json({ error: 'Main Warehouse has no stock for this item. Request remains pending � procurement needed.' });
    }

    const transferQty = Math.min(qty, Number(mainBal.on_hand));
    const unitCost = Number(mainBal.unit_cost || reqRow.item?.last_cost || 0);

    // Generate transfer number
    const { count } = await client.from('uinv_transfers').select('*', { count: 'exact', head: true });
    const transferNumber = `TR-REPL-${String((count || 0) + 1).padStart(6, '0')}`;

    // Create the transfer record
    const transferId = `UINV-TX-REPL-${Date.now()}`;
    const { error: transferErr } = await client.from('uinv_transfers').insert({
      id: transferId,
      property_id: reqRow.property_id,
      transfer_number: transferNumber,
      from_store_id: MAIN_STORE_ID,
      to_store_id: deptStoreId,
      lines: [{
        itemId,
        itemName: reqRow.item?.item_name || '',
        quantity: transferQty,
        unit: reqRow.item?.unit_of_measure || '',
        unitCost,
      }],
      transfer_value: transferQty * unitCost,
      status: 'Completed',
      priority: reqRow.urgency === 'Urgent' ? 'High' : 'Normal',
      replenishment_source: 'request',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (transferErr) {
      console.error('[uinv] fulfill: transfer insert error:', transferErr.message);
      return res.status(500).json({ error: transferErr.message });
    }

    // Deduct from Main Warehouse
    await client.from('uinv_stock_balances').update({
      on_hand: Number(mainBal.on_hand) - transferQty,
      last_movement_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', mainBal.id);

    // Add to department store
    const { data: deptBal } = await client.from('uinv_stock_balances')
      .select('id, on_hand')
      .eq('item_id', itemId)
      .eq('store_id', deptStoreId)
      .maybeSingle();

    if (deptBal) {
      await client.from('uinv_stock_balances').update({
        on_hand: Number(deptBal.on_hand) + transferQty,
        last_movement_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', deptBal.id);
    } else {
      // Create balance row if it doesn't exist
      await client.from('uinv_stock_balances').insert({
        item_id: itemId,
        store_id: deptStoreId,
        property_id: reqRow.property_id,
        on_hand: transferQty,
        unit_cost: unitCost,
        last_movement_date: new Date().toISOString(),
      });
    }

    // Log to stock ledger (Main out)
    await appendLedger(client, {
      property_id: reqRow.property_id,
      item_id: itemId,
      store_id: MAIN_STORE_ID,
      transaction_type: 'Transfer Out',
      reference: transferNumber,
      quantity_in: 0,
      quantity_out: transferQty,
      balance: Number(mainBal.on_hand) - transferQty,
      unit_cost: unitCost,
      value: transferQty * unitCost,
      performed_by: performedBy,
      reason: `Fulfilling replenishment request for ${reqRow.store?.store_name || deptStoreId}`,
    });

    // Log to stock ledger (department in)
    await appendLedger(client, {
      property_id: reqRow.property_id,
      item_id: itemId,
      store_id: deptStoreId,
      transaction_type: 'Transfer In',
      reference: transferNumber,
      quantity_in: transferQty,
      quantity_out: 0,
      balance: Number(deptBal?.on_hand || 0) + transferQty,
      unit_cost: unitCost,
      value: transferQty * unitCost,
      performed_by: performedBy,
      reason: `Replenishment from Main Warehouse (request fulfilled)`,
    });

    // Mark request as Fulfilled
    const { data: updated, error: updErr } = await client.from('uinv_replenishment').update({
      status: 'Fulfilled',
      notes: (reqRow.notes || '') + ` | Fulfilled by ${performedBy}: ${transferQty} units via ${transferNumber}`,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single();
    if (updErr) return res.status(500).json({ error: updErr.message });

    // -- Auto-trigger procurement if Main Warehouse dropped to/below reorder point --
    let procurementTriggered = false;
    let procurementMessage = '';
    try {
      const { data: mainBalAfter } = await client.from('uinv_stock_balances')
        .select('on_hand, item:uinv_items(id, reorder_point, min_stock, max_stock, item_name, item_code)')
        .eq('item_id', itemId)
        .eq('store_id', MAIN_STORE_ID)
        .maybeSingle();

      const afterOnHand = Number(mainBalAfter?.on_hand || 0);
      const item = mainBalAfter?.item as any;
      const reorderPoint = Number(item?.reorder_point || 0);
      if (reorderPoint > 0 && afterOnHand <= reorderPoint) {
        // Main Warehouse reached reorder point � generate procurement requisition
        const { data: procResult, error: procErr } = await client.rpc('generate_procurement_requisition_from_low_stock', {
          p_property_id: reqRow.property_id || null,
          p_created_by: performedBy,
        });
        if (!procErr && procResult && (Array.isArray(procResult) ? procResult.length > 0 : true)) {
          procurementTriggered = true;
          procurementMessage = `Main Warehouse stock for ${item?.item_name || itemId} reached reorder point (${afterOnHand}/${reorderPoint}). Procurement requisition auto-generated.`;
        } else if (procErr) {
          console.error('[uinv] auto-procurement trigger error:', procErr.message);
        }
      }
    } catch (procEx: any) {
      console.error('[uinv] auto-procurement check failed:', procEx?.message);
    }

    return res.json({
      success: true,
      transferNumber,
      transferId,
      quantity: transferQty,
      request: updated,
      procurementTriggered,
      procurementMessage,
    });
  } catch (e: any) {
    console.error('[uinv] fulfill error:', e?.message);
    return res.status(500).json({ error: e?.message || 'Failed to fulfill replenishment request' });
  }
});

/**
 * GET /replenishment/rules
 * List auto-replenishment rules (per store / per item).
 */
router.get('/replenishment/rules', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, storeId, active } = req.query as Record<string, string>;
  let q = client.from('uinv_replenishment_rules')
    .select('*, store:uinv_stores(*), item:uinv_items(*)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (storeId) q = q.eq('store_id', storeId);
  if (active !== undefined) q = q.eq('is_active', active === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/**
 * POST /replenishment/rules
 * Create or update an auto-replenishment rule.
 */
router.post('/replenishment/rules', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const { data, error } = await client.from('uinv_replenishment_rules').insert({
    property_id: body.property_id || null,
    store_id: body.store_id,
    item_id: body.item_id || null,
    replenish_min: body.replenish_min || 0,
    replenish_max: body.replenish_max || 0,
    source_store_id: body.source_store_id || MAIN_STORE_ID,
    is_active: body.is_active !== false,
    rule_type: body.rule_type || 'Manual',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

/**
 * PATCH /replenishment/rules/:id
 */
router.patch('/replenishment/rules/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_replenishment_rules')
    .update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

/**
 * DELETE /replenishment/rules/:id
 */
router.delete('/replenishment/rules/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_replenishment_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

/**
 * GET /replenishment/auto-replenish/preview
 * Preview which department store balances are below their replenish_min
 * without actually creating transfers. Useful for dashboards.
 */
router.get('/replenishment/auto-replenish/preview', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId } = req.query as Record<string, string>;
  // Fetch all dept store balances with item master (reorder_point, par_level, max_stock)
  let q = client.from('uinv_stock_balances')
    .select('id, store_id, on_hand, replenish_min, replenish_max, unit_cost, item:uinv_items(id, item_name, item_code, unit_of_measure, reorder_point, par_level, max_stock), store:uinv_stores(id, store_name, department)')
    .neq('store_id', MAIN_STORE_ID);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Compute effective min/max using the same precedence as effective_par_level():
  //   replenish_min on balance ? if 0/NULL, fall back to item.reorder_point
  //   replenish_max on balance ? if 0/NULL, fall back to item.par_level (or max_stock)
  const enriched = (data || []).map((r: any) => {
    const itemMin = Number(r.replenish_min) || 0;
    const itemMax = Number(r.replenish_max) || 0;
    const reorderPoint = Number(r.item?.reorder_point) || 0;
    const parLevel = Number(r.item?.par_level) || 0;
    const maxStock = Number(r.item?.max_stock) || 0;
    const effMin = itemMin > 0 ? itemMin : reorderPoint;
    const effMax = itemMax > 0 ? itemMax : (parLevel > 0 ? parLevel : maxStock);
    return { r, effMin, effMax };
  });

  const belowMin = enriched.filter(e => e.effMin > 0 && Number(e.r.on_hand) <= e.effMin);
  return res.json({
    totalChecked: (data || []).length,
    belowMin: belowMin.length,
    items: belowMin.map(e => ({
      balanceId: e.r.id,
      storeId: e.r.store_id,
      storeName: e.r.store?.store_name,
      department: e.r.store?.department,
      itemId: e.r.item?.id,
      itemName: e.r.item?.item_name,
      itemCode: e.r.item?.item_code,
      onHand: Number(e.r.on_hand),
      replenishMin: e.effMin,
      replenishMax: e.effMax,
      suggestedQty: Math.max(0, e.effMax - Number(e.r.on_hand)),
      unitCost: Number(e.r.unit_cost),
    })),
  });
});

// ----------------------------------------------------------------
// DYNAMIC PAR LEVELS (based on historical consumption)
// ----------------------------------------------------------------

/**
 * POST /replenishment/calculate-dynamic-par
 * Triggers the refresh_consumption_stats() DB function which:
 *   1. Analyzes historical consumption from uinv_stock_ledger
 *   2. Calculates dynamic par levels, replenish_min, replenish_max
 *   3. Updates uinv_stock_balances and uinv_items with the new values
 *
 * Body: { lookbackDays?: number (default 30), propertyId?: string }
 * Returns: { generated: number, results: [...] }
 */
router.post('/replenishment/calculate-dynamic-par', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { lookbackDays, propertyId } = req.body || {};
  try {
    const { data, error } = await client.rpc('refresh_consumption_stats', {
      p_lookback_days: lookbackDays || 30,
      p_property_id: propertyId || null,
    });
    if (error) {
      console.error('[uinv] dynamic par calc RPC error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    const results = data || [];
    return res.json({
      generated: results.length,
      lookbackDays: lookbackDays || 30,
      results: results.map((r: any) => ({
        itemId: r.item_id,
        storeId: r.store_id,
        avgDaily: Number(r.avg_daily || 0),
        dynamicPar: Number(r.dynamic_par || 0),
        dynamicMin: Number(r.dynamic_min || 0),
        dynamicMax: Number(r.dynamic_max || 0),
      })),
    });
  } catch (e: any) {
    console.error('[uinv] dynamic par calc exception:', e?.message);
    return res.status(500).json({ error: e?.message || 'Dynamic par calculation failed' });
  }
});

/**
 * GET /replenishment/consumption-stats
 * Returns cached consumption statistics per item+store.
 * Query: ?propertyId= ?storeId= ?itemId= ?lookbackDays= (default 30)
 */
router.get('/replenishment/consumption-stats', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, storeId, itemId, lookbackDays } = req.query as Record<string, string>;
  let q = client.from('uinv_consumption_stats')
    .select('*, item:uinv_items(id, item_name, item_code, unit_of_measure, category, subcategory), store:uinv_stores(id, store_name, department)')
    .order('calculated_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (storeId) q = q.eq('store_id', storeId);
  if (itemId) q = q.eq('item_id', itemId);
  if (lookbackDays) q = q.eq('lookback_days', Number(lookbackDays));
  else q = q.eq('lookback_days', 30);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/**
 * GET /replenishment/dynamic-par-config
 * Returns dynamic par configuration (global, store-level, item-level).
 * Query: ?storeId= ?itemId=
 */
router.get('/replenishment/dynamic-par-config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { storeId, itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_dynamic_par_config')
    .select('*, store:uinv_stores(id, store_name), item:uinv_items(id, item_name, item_code)')
    .order('created_at', { ascending: false });
  if (storeId) q = q.eq('store_id', storeId);
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/**
 * POST /replenishment/dynamic-par-config
 * Create or update a dynamic par configuration.
 */
router.post('/replenishment/dynamic-par-config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  // Upsert: if store_id + item_id combo exists, update; otherwise insert
  const { data: existing } = await client.from('uinv_dynamic_par_config')
    .select('id')
    .eq('store_id', body.store_id || null)
    .eq('item_id', body.item_id || null)
    .maybeSingle();

  if (existing) {
    const { data, error } = await client.from('uinv_dynamic_par_config')
      .update({
        lookback_days: body.lookback_days,
        lead_time_days: body.lead_time_days,
        safety_stock_days: body.safety_stock_days,
        reorder_cycle_days: body.reorder_cycle_days,
        service_level: body.service_level,
        is_enabled: body.is_enabled,
        min_replenish_threshold: body.min_replenish_threshold,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await client.from('uinv_dynamic_par_config').insert({
    property_id: body.property_id || null,
    store_id: body.store_id || null,
    item_id: body.item_id || null,
    lookback_days: body.lookback_days || 30,
    lead_time_days: body.lead_time_days || 2,
    safety_stock_days: body.safety_stock_days || 3,
    reorder_cycle_days: body.reorder_cycle_days || 7,
    service_level: body.service_level || 0.95,
    is_enabled: body.is_enabled !== false,
    min_replenish_threshold: body.min_replenish_threshold || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

/**
 * PATCH /replenishment/dynamic-par-config/:id
 */
router.patch('/replenishment/dynamic-par-config/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { data, error } = await client.from('uinv_dynamic_par_config')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

/**
 * DELETE /replenishment/dynamic-par-config/:id
 */
router.delete('/replenishment/dynamic-par-config/:id', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { error } = await client.from('uinv_dynamic_par_config').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// DEPARTMENT-SCOPED DYNAMIC PAR + CONSUMPTION STATS
// Convenience endpoints that resolve a department name to its store
// IDs and return consumption stats / dynamic par levels filtered to
// those stores. Used by department inventory UIs (Eng, HK, F&B).
// ----------------------------------------------------------------

/**
 * GET /replenishment/department-consumption-stats?department=...&lookbackDays=30
 * Returns consumption statistics for all stores belonging to the department.
 */
router.get('/replenishment/department-consumption-stats', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { department, propertyId, lookbackDays } = req.query as Record<string, string>;
  if (!department) return res.status(400).json({ error: 'department query param is required' });

  const storeIds = await resolveDepartmentStoreIds(client, department);
  if (!storeIds || storeIds.length === 0) {
    return res.json([]);
  }

  let q = client.from('uinv_consumption_stats')
    .select('*, item:uinv_items(id, item_name, item_code, unit_of_measure, category, subcategory), store:uinv_stores(id, store_name, department)')
    .in('store_id', storeIds)
    .order('calculated_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (lookbackDays) q = q.eq('lookback_days', Number(lookbackDays));
  else q = q.eq('lookback_days', 30);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/**
 * POST /replenishment/department-calculate-dynamic-par
 * Body: { department, lookbackDays?, propertyId? }
 * Recalculates consumption stats for all stores, then returns only the
 * rows belonging to the specified department's stores.
 */
router.post('/replenishment/department-calculate-dynamic-par', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { department, lookbackDays, propertyId } = req.body || {};
  if (!department) return res.status(400).json({ error: 'department is required' });

  try {
    const { data, error } = await client.rpc('refresh_consumption_stats', {
      p_lookback_days: lookbackDays || 30,
      p_property_id: propertyId || null,
    });
    if (error) {
      console.error('[uinv] department dynamic par RPC error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    const allResults = data || [];
    const storeIds = await resolveDepartmentStoreIds(client, department);
    const storeIdSet = new Set(storeIds || []);
    const deptResults = storeIdSet.size > 0
      ? allResults.filter((r: any) => storeIdSet.has(r.store_id))
      : [];
    return res.json({
      generated: deptResults.length,
      lookbackDays: lookbackDays || 30,
      department,
      results: deptResults.map((r: any) => ({
        itemId: r.item_id,
        storeId: r.store_id,
        avgDaily: Number(r.avg_daily || 0),
        dynamicPar: Number(r.dynamic_par || 0),
        dynamicMin: Number(r.dynamic_min || 0),
        dynamicMax: Number(r.dynamic_max || 0),
      })),
    });
  } catch (e: any) {
    console.error('[uinv] department dynamic par exception:', e?.message);
    return res.status(500).json({ error: e?.message || 'Dynamic par calculation failed' });
  }
});

/**
 * GET /replenishment/department-dynamic-par-config?department=...
 * Returns dynamic par config rows for the department's stores.
 */
router.get('/replenishment/department-dynamic-par-config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { department } = req.query as Record<string, string>;
  if (!department) return res.status(400).json({ error: 'department query param is required' });

  const storeIds = await resolveDepartmentStoreIds(client, department);
  if (!storeIds || storeIds.length === 0) return res.json([]);

  const { data, error } = await client.from('uinv_dynamic_par_config')
    .select('*, store:uinv_stores(id, store_name), item:uinv_items(id, item_name, item_code)')
    .in('store_id', storeIds)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ----------------------------------------------------------------
// CENTRAL STORE DYNAMIC PAR (Migration 376)
// ROP_Central = (D_Total � LT_Vendor) + SS_Central
// D_Total = combined avg daily usage across all department stores.
// SS_Central: 'bulletproof' (S dept order qty) or 'statistical' (Z�v(...)).
// ----------------------------------------------------------------

/**
 * GET /replenishment/central-store-stats
 * Returns cached central store dynamic par calculations per item.
 * Query: ?propertyId= ?lookbackDays= (default 30) ?itemId=
 */
router.get('/replenishment/central-store-stats', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, lookbackDays, itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_central_store_stats')
    .select('*, item:uinv_items(id, item_name, item_code, unit_of_measure, category, reorder_point, par_level, min_stock, last_cost), balance:uinv_stock_balances!inner(item_id, store_id, on_hand)')
    .eq('balance.store_id', MAIN_STORE_ID)
    .order('calculated_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (itemId) q = q.eq('item_id', itemId);
  if (lookbackDays) q = q.eq('lookback_days', Number(lookbackDays));
  else q = q.eq('lookback_days', 30);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/**
 * POST /replenishment/central-calculate-dynamic-par
 * Body: { lookbackDays?, propertyId? }
 * Triggers refresh_central_store_stats() which:
 *   1. Refreshes department consumption stats
 *   2. Aggregates D_Total across department stores
 *   3. Computes SS_Central (bulletproof or statistical)
 *   4. Sets Central Min/ROP/Par on stock balances + item master
 */
router.post('/replenishment/central-calculate-dynamic-par', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { lookbackDays, propertyId } = req.body || {};
  try {
    const { data, error } = await client.rpc('refresh_central_store_stats', {
      p_lookback_days: lookbackDays || 30,
      p_property_id: propertyId || null,
    });
    if (error) {
      console.error('[uinv] central dynamic par RPC error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    const results = data || [];
    return res.json({
      generated: results.length,
      lookbackDays: lookbackDays || 30,
      results: results.map((r: any) => ({
        itemId: r.item_id,
        dTotal: Number(r.d_total || 0),
        centralMin: Number(r.central_min || 0),
        centralRop: Number(r.central_rop || 0),
        centralPar: Number(r.central_par || 0),
        ssMethod: r.ss_method,
        deptCount: r.dept_count,
      })),
    });
  } catch (e: any) {
    console.error('[uinv] central dynamic par exception:', e?.message);
    return res.status(500).json({ error: e?.message || 'Central dynamic par calculation failed' });
  }
});

/**
 * GET /replenishment/central-store-config
 * Returns dynamic par config rows scoped to the Main Warehouse
 * (store_id = UINV-ST-MAIN), plus the global default.
 */
router.get('/replenishment/central-store-config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_dynamic_par_config')
    .select('*, store:uinv_stores(id, store_name), item:uinv_items(id, item_name, item_code)')
    .or(`store_id.eq.${MAIN_STORE_ID},store_id.is.null`)
    .order('created_at', { ascending: false });
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/**
 * POST /replenishment/central-store-config
 * Create or update a central store dynamic par config (scoped to MAIN).
 * Body: { item_id?, lead_time_days, safety_stock_method, reorder_cycle_days,
 *         service_level, lead_time_stddev_days, is_enabled }
 */
router.post('/replenishment/central-store-config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const body = req.body;
  const storeId = MAIN_STORE_ID;
  // Upsert by (store_id, item_id)
  const { data: existing } = await client.from('uinv_dynamic_par_config')
    .select('id')
    .eq('store_id', storeId)
    .eq('item_id', body.item_id || null)
    .maybeSingle();

  const fields = {
    lookback_days: body.lookback_days ?? 30,
    lead_time_days: body.lead_time_days,
    safety_stock_days: body.safety_stock_days,
    reorder_cycle_days: body.reorder_cycle_days,
    service_level: body.service_level,
    is_enabled: body.is_enabled,
    min_replenish_threshold: body.min_replenish_threshold,
    safety_stock_method: body.safety_stock_method,
    lead_time_stddev_days: body.lead_time_stddev_days,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await client.from('uinv_dynamic_par_config')
      .update(fields).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await client.from('uinv_dynamic_par_config').insert({
    ...fields,
    property_id: body.property_id || null,
    store_id: storeId,
    item_id: body.item_id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ----------------------------------------------------------------
// CONFIG
// ----------------------------------------------------------------
router.get('/config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, section } = req.query as Record<string, string>;
  let q = client.from('uinv_config').select('*').order('section');
  if (propertyId) q = q.eq('property_id', propertyId);
  if (section) q = q.eq('section', section);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.put('/config', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { propertyId, section, config } = req.body || {};
  if (!section) return res.status(400).json({ error: 'section is required' });
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data: existing } = await client.from('uinv_config').select('id').match({
    property_id: propertyId || null,
    section,
  }).maybeSingle();
  if (existing) {
    const { data, error } = await client.from('uinv_config').update({
      config,
      updated_by: performedBy,
    }).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const { data, error } = await client.from('uinv_config').insert({
    property_id: propertyId || null,
    section,
    config,
    updated_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ----------------------------------------------------------------
// CROSS-DEPARTMENT INVENTORY VIEW
// Returns stock balances + recent issues for a specific department.
// Enables department inventory modules to surface unified uinv_* data
// alongside their department-specific workflows.
// ----------------------------------------------------------------
router.get('/department-stock/:department', authenticate, async (req, res) => {
  const client = ensureDb(res);
  if (!client) return;
  const { department } = req.params;
  const { propertyId } = req.query as Record<string, string>;

  // Recent issues to this department (last 30)
  let issueQ = client
    .from('uinv_issues')
    .select('*, store:uinv_stores!store_id(store_name), item_lines:lines')
    .ilike('department', department)
    .order('created_at', { ascending: false })
    .limit(30);
  if (propertyId) issueQ = issueQ.eq('property_id', propertyId);
  const { data: issues, error: issueErr } = await issueQ;
  if (issueErr) return res.status(500).json({ error: issueErr.message });

  // Aggregate the most-issued items for this department from issue lines
  const itemMap: Record<string, { itemId: string; itemName: string; unit: string; totalIssued: number; unitCost: number }> = {};
  for (const iss of (issues || [])) {
    for (const line of (iss.lines || [])) {
      if (!line.itemId) continue;
      const key = line.itemId;
      if (!itemMap[key]) {
        itemMap[key] = {
          itemId: line.itemId,
          itemName: line.itemName || line.item_name || 'Unknown',
          unit: line.unit || 'pcs',
          totalIssued: 0,
          unitCost: Number(line.unitCost || line.unit_cost || 0),
        };
      }
      itemMap[key].totalIssued += Number(line.issuedQty || line.requestedQty || 0);
    }
  }

  // Current stock balances for those items � scoped to the department's own stores only
  // (so departments see their received stock, not Main Warehouse stock)
  const itemIds = Object.keys(itemMap);
  let stockByItem: Record<string, any[]> = {};
  if (itemIds.length > 0) {
    // Resolve this department's store IDs
    const deptStoreIds = await resolveDepartmentStoreIds(client, department);
    let balQ = client
      .from('uinv_stock_balances')
      .select('*, store:uinv_stores!store_id(store_name), item:uinv_items(item_name, item_code, unit_of_measure)')
      .in('item_id', itemIds);
    if (propertyId) balQ = balQ.eq('property_id', propertyId);
    // Filter to department's own stores only (exclude Main Warehouse)
    if (deptStoreIds && deptStoreIds.length > 0) {
      balQ = balQ.in('store_id', deptStoreIds);
    } else {
      // No department stores found � return empty balances
      balQ = balQ.eq('store_id', '__none__');
    }
    const { data: balances, error: balErr } = await balQ;
    if (balErr) return res.status(500).json({ error: balErr.message });
    for (const b of (balances || [])) {
      if (!stockByItem[b.item_id]) stockByItem[b.item_id] = [];
      stockByItem[b.item_id].push(b);
    }
  }

  const items = itemIds.map(id => ({
    ...itemMap[id],
    balances: stockByItem[id] || [],
    totalOnHand: (stockByItem[id] || []).reduce((s, b) => s + Number(b.on_hand || 0), 0),
    totalReserved: (stockByItem[id] || []).reduce((s, b) => s + Number(b.reserved || 0), 0),
  }));

  return res.json({
    department,
    issues: issues || [],
    items,
    summary: {
      totalItemsTracked: items.length,
      totalIssuedLast30: items.reduce((s, i) => s + i.totalIssued, 0),
      totalOnHand: items.reduce((s, i) => s + i.totalOnHand, 0),
      pendingIssues: (issues || []).filter((i: any) => i.approval_status === 'Pending' || i.approval_status === 'Approved').length,
    },
  });
});

// ----------------------------------------------------------------
// STOREKEEPING � PUT-AWAY TASKS (migration 364)
// ----------------------------------------------------------------
router.get('/putaway-tasks', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, grnId } = req.query as Record<string, string>;
  let q = client.from('uinv_putaway_tasks').select('*, item:uinv_items(*), store:uinv_stores(*), to_location:uinv_locations!to_location_id(*), grn:uinv_goods_receipts(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (grnId) q = q.eq('grn_id', grnId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/putaway-tasks', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_putaway_tasks').insert({
    ...body, status: body.status || 'Pending', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/putaway-tasks/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  // On "Put Away", move stock to the destination location + ledger.
  // Routed through the atomic RPC � this also fixes the bug where the
  // ledger row recorded balance = task quantity instead of the new
  // running balance.
  if (body.status === 'Put Away') {
    const { data: existing } = await client.from('uinv_putaway_tasks').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Put Away') {
      try {
        await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: existing.item_id,
          storeId: existing.store_id,
          transactionType: 'Put Away',
          qtyIn: Number(existing.quantity),
          locationId: existing.to_location_id || null,
          batchId: existing.batch_id || null,
          reference: existing.putaway_number,
          performedBy,
          reason: 'Put away from receiving',
        });
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }
      body.putaway_by = performedBy;
      body.putaway_at = new Date().toISOString();
    }
  }
  const { data, error } = await client.from('uinv_putaway_tasks').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/putaway-tasks/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_putaway_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � PICKING TASKS
// ----------------------------------------------------------------
router.get('/picking-tasks', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, sourceId } = req.query as Record<string, string>;
  let q = client.from('uinv_picking_tasks').select('*, item:uinv_items(*), store:uinv_stores(*), location:uinv_locations(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (sourceId) q = q.eq('source_id', sourceId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/picking-tasks', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_picking_tasks').insert({
    ...body, status: body.status || 'Pending', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/picking-tasks/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  if (body.status === 'Picked') {
    const { data: existing } = await client.from('uinv_picking_tasks').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Picked') {
      // Execute the pick atomically: deduct stock (validated against
      // available quantity) and deduct batches per the task's pick
      // strategy � FEFO (expiry-first) or FIFO (oldest-received-first).
      // Previously "Picked" only flipped the status: no stock moved and
      // no batch was ever consumed.
      const strategy = (body.pickStrategy || existing.pick_strategy || 'FIFO') as 'FEFO' | 'FIFO';
      // pickStrategy is not a table column � resolve it here, never persist it.
      delete body.pickStrategy;
      try {
        const result = await applyStockMovement(client, {
          propertyId: existing.property_id,
          itemId: existing.item_id,
          storeId: existing.store_id,
          transactionType: 'Pick',
          qtyOut: Number(existing.quantity),
          locationId: existing.location_id || null,
          batchId: existing.batch_id || null,
          deductBatches: existing.batch_id ? null : strategy,
          reference: existing.picking_number || existing.id,
          performedBy,
          reason: `Picking task (${strategy})`,
        });
        if (result?.batches_short) {
          body.notes = `${existing.notes || ''} | Warning: batch quantities did not cover the picked quantity (balance deducted in full).`.trim();
        }
        if (Array.isArray(result?.batch_deductions) && result.batch_deductions.length) {
          body.picked_batches = result.batch_deductions;
        }
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }
      body.picked_by = performedBy;
      body.picked_at = new Date().toISOString();
    }
  }
  const { data, error } = await client.from('uinv_picking_tasks').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// FEFO/FIFO picking plan for a task (pure recommendation � no mutation).
// The picking UI uses this to show which batches the pick will consume
// before the storekeeper confirms.
router.get('/picking-tasks/:id/batch-plan', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data: existing, error } = await client.from('uinv_picking_tasks').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  if (!existing) return res.status(404).json({ error: 'Picking task not found' });
  const strategy = (req.query.strategy || existing.pick_strategy || 'FEFO') as string;
  const { data: plan, error: rErr } = await client.rpc('uinv_recommend_batches', {
    p_item_id: existing.item_id,
    p_store_id: existing.store_id,
    p_qty: Number(existing.quantity),
    p_strategy: strategy,
  });
  if (rErr) return res.status(500).json({ error: rErr.message });
  return res.json({ strategy, plan: plan || [] });
});

router.delete('/picking-tasks/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_picking_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � RETURNS
// ----------------------------------------------------------------
router.get('/returns', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, issueId } = req.query as Record<string, string>;
  let q = client.from('uinv_returns').select('*, store:uinv_stores(*), issue:uinv_issues(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (issueId) q = q.eq('issue_id', issueId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/returns', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_returns').insert({
    ...body, status: body.status || 'Pending', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/returns/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  // On "Restocked", add returned good-condition stock back via the atomic RPC
  if (body.status === 'Restocked') {
    const { data: existing } = await client.from('uinv_returns').select('*').eq('id', req.params.id).single();
    if (existing && existing.status !== 'Restocked') {
      try {
        for (const line of (existing.lines || [])) {
          if (!line.itemId || line.condition !== 'Good') continue;
          await applyStockMovement(client, {
            propertyId: existing.property_id,
            itemId: line.itemId,
            storeId: existing.store_id,
            transactionType: 'Return',
            qtyIn: Number(line.quantity),
            reference: existing.return_number,
            unitCost: Number(line.unitCost || 0),
            performedBy,
            reason: `Return from ${existing.department || 'department'}`,
          });
        }
      } catch (e: any) {
        return movementErrorResponse(res, e);
      }
      body.received_by = performedBy;
    }
  }
  const { data, error } = await client.from('uinv_returns').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/returns/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_returns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � QUARANTINE
// ----------------------------------------------------------------
router.get('/quarantine', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_quarantine').select('*, item:uinv_items(*), store:uinv_stores(*)').order('quarantined_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/quarantine', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_quarantine').insert({
    ...body, status: body.status || 'Held', quarantined_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/quarantine/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  // On "Released", return stock to available
  if (body.status === 'Released') {
    const { data: existing } = await client.from('uinv_quarantine').select('*').eq('id', req.params.id).single();
    if (existing && existing.status === 'Held') {
      const bal = await recomputeBalance(client, existing.item_id, existing.store_id, null);
      if (bal) {
        const newOnHand = Number(bal.on_hand) + Number(existing.quantity);
        await client.from('uinv_stock_balances').update({ on_hand: newOnHand, quarantined: Math.max(0, Number(bal.quarantined) - Number(existing.quantity)), last_movement_date: new Date().toISOString() }).eq('id', bal.id);
      }
      body.released_by = performedBy;
      body.released_at = new Date().toISOString();
    }
  }
  const { data, error } = await client.from('uinv_quarantine').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/quarantine/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_quarantine').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � SERIALS
// ----------------------------------------------------------------
router.get('/serials', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, itemId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_serials').select('*, item:uinv_items(*), store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (itemId) q = q.eq('item_id', itemId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/serials', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_serials').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/serials/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_serials').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/serials/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_serials').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � LOTS
// ----------------------------------------------------------------
router.get('/lots', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_lots').select('*, item:uinv_items(*), store:uinv_stores(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/lots', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_lots').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/lots/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_lots').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/lots/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_lots').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � TEMPERATURE LOGS
// ----------------------------------------------------------------
router.get('/temperature-logs', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, storeId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_temperature_logs').select('*, store:uinv_stores(*)').order('reading_time', { ascending: false }).limit(200);
  if (storeId) q = q.eq('store_id', storeId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/temperature-logs', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_temperature_logs').insert({ ...body, recorded_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/temperature-logs/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_temperature_logs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � CHEMICALS
// ----------------------------------------------------------------
router.get('/chemicals', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_chemicals').select('*, item:uinv_items(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/chemicals', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_chemicals').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/chemicals/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_chemicals').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/chemicals/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_chemicals').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STOREKEEPING � EXPIRY ALERTS (view)
// ----------------------------------------------------------------
router.get('/expiry-alerts', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, bucket } = req.query as Record<string, string>;
  let q = client.from('v_uinv_expiry_alerts').select('*').order('expiry_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (bucket) q = q.eq('alert_bucket', bucket);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ----------------------------------------------------------------
// FIXED ASSETS � CLASSES (migration 365)
// ----------------------------------------------------------------
router.get('/asset-classes', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_classes').select('*').order('class_name');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-classes', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_classes').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/asset-classes/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_classes').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/asset-classes/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_classes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � REGISTER (uinv_assets)
// ----------------------------------------------------------------
router.get('/assets', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, classId, custodian, department } = req.query as Record<string, string>;
  let q = client.from('uinv_assets').select('*, class:uinv_asset_classes(*), parent:uinv_assets(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (classId) q = q.eq('class_id', classId);
  if (custodian) q = q.ilike('custodian', custodian);
  if (department) q = q.ilike('department', department);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/assets/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_assets')
    .select('*, class:uinv_asset_classes(*), parent:uinv_assets(*), components:uinv_asset_components(child_asset_id), assignments:uinv_asset_assignments(*), transfers:uinv_asset_transfers(*), warranties:uinv_asset_warranties(*), insurance:uinv_asset_insurance(*), disposals:uinv_asset_disposals(*), documents:uinv_asset_documents(*)')
    .eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/assets', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_assets').insert({
    ...body, status: body.status || 'Received', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await appendAudit(client, {
    property_id: body.property_id, department: body.department, user_name: performedBy,
    transaction_type: 'Asset Created', entity_type: 'asset', entity_id: data.id,
    item_or_asset: body.asset_name, value: Number(body.acquisition_cost || 0),
    location: body.location, new_state: data,
  });
  return res.status(201).json(data);
});

router.patch('/assets/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data: prev } = await client.from('uinv_assets').select('*').eq('id', req.params.id).single();
  const { data, error } = await client.from('uinv_assets').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await appendAudit(client, {
    property_id: data.property_id, department: data.department, user_name: performedBy,
    transaction_type: 'Asset Updated', entity_type: 'asset', entity_id: data.id,
    item_or_asset: data.asset_name, location: data.location,
    previous_state: prev, new_state: data,
  });
  return res.json(data);
});

router.delete('/assets/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_assets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � COMPONENTS
// ----------------------------------------------------------------
router.get('/asset-components', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { parentAssetId } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_components').select('*, parent:uinv_assets!parent_asset_id(*), child:uinv_assets!child_asset_id(*)');
  if (parentAssetId) q = q.eq('parent_asset_id', parentAssetId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-components', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_components').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/asset-components/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_components').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � ASSIGNMENTS
// ----------------------------------------------------------------
router.get('/asset-assignments', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, assetId, status, employee } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_assignments').select('*, asset:uinv_assets(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (assetId) q = q.eq('asset_id', assetId);
  if (status) q = q.eq('status', status);
  if (employee) q = q.ilike('employee', employee);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-assignments', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_asset_assignments').insert({
    ...body, status: body.status || 'Active', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Update asset status to Assigned + custodian
  await client.from('uinv_assets').update({ status: 'Assigned', custodian: body.employee, department: body.department, location: body.location }).eq('id', body.asset_id);
  await appendAudit(client, {
    property_id: body.property_id, department: body.department, user_name: performedBy,
    transaction_type: 'Asset Assigned', entity_type: 'asset', entity_id: body.asset_id,
    location: body.location, new_state: data,
  });
  return res.status(201).json(data);
});

router.patch('/asset-assignments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  // On return, free the asset
  if (body.status === 'Returned') {
    const { data: existing } = await client.from('uinv_asset_assignments').select('*').eq('id', req.params.id).single();
    if (existing && existing.status === 'Active') {
      body.return_date = body.return_date || new Date().toISOString().slice(0, 10);
      await client.from('uinv_assets').update({ status: 'Available', custodian: null }).eq('id', existing.asset_id);
    }
  }
  const { data, error } = await client.from('uinv_asset_assignments').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/asset-assignments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_assignments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � TRANSFERS
// ----------------------------------------------------------------
router.get('/asset-transfers', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, assetId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_transfers').select('*, asset:uinv_assets(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (assetId) q = q.eq('asset_id', assetId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-transfers', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_asset_transfers').insert({
    ...body, status: body.status || 'Pending', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/asset-transfers/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  // On "Received", apply new location/custodian/department to the asset
  if (body.status === 'Received') {
    const { data: existing } = await client.from('uinv_asset_transfers').select('*').eq('id', req.params.id).single();
    if (existing && (existing.status === 'In Transit' || existing.status === 'Dispatched' || existing.status === 'Approved')) {
      const update: Record<string, any> = { status: 'In Service' };
      if (existing.to_location) update.location = existing.to_location;
      if (existing.to_custodian) update.custodian = existing.to_custodian;
      if (existing.to_department) update.department = existing.to_department;
      if (existing.to_property_id) update.property_id = existing.to_property_id;
      await client.from('uinv_assets').update(update).eq('id', existing.asset_id);
      body.received_at = new Date().toISOString();
      await appendAudit(client, {
        property_id: existing.property_id, user_name: performedBy,
        transaction_type: 'Asset Transferred', entity_type: 'asset', entity_id: existing.asset_id,
        location: existing.to_location, previous_state: { location: existing.from_location, custodian: existing.from_custodian },
        new_state: update, related_document: existing.transfer_number,
      });
    }
  }
  if (body.status === 'Approved') body.approved_at = new Date().toISOString();
  if (body.status === 'Dispatched') body.dispatched_at = new Date().toISOString();
  const { data, error } = await client.from('uinv_asset_transfers').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/asset-transfers/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_transfers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � VERIFICATION CAMPAIGNS + LINES
// ----------------------------------------------------------------
router.get('/asset-verification-campaigns', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_verification_campaigns').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-verification-campaigns', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';

  // Generate campaign_number: VER-YYYY-NNNN
  const year = new Date().getFullYear();
  const { data: existing } = await client.from('uinv_asset_verification_campaigns')
    .select('campaign_number')
    .like('campaign_number', `VER-${year}-%`)
    .order('campaign_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (existing && existing.length > 0) {
    const match = (existing[0].campaign_number || '').match(/VER-\d{4}-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  const campaignNumber = `VER-${year}-${String(seq).padStart(4, '0')}`;

  const { data, error } = await client.from('uinv_asset_verification_campaigns').insert({
    campaign_number: campaignNumber,
    property_id: body.property_id || body.propertyId || null,
    campaign_name: body.campaign_name || body.name || `Verification ${campaignNumber}`,
    scope: body.scope || 'Full',
    scope_filter: body.scope_filter || {},
    start_date: body.start_date || new Date().toISOString().slice(0, 10),
    end_date: body.end_date || null,
    status: body.status || 'Open',
    notes: body.notes || null,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Auto-generate verification lines for assets matching the scope
  let assetQ = client.from('uinv_assets').select('id, location, custodian, department, class_id, class, status').eq('is_active', true);
  if (body.property_id || body.propertyId) assetQ = assetQ.eq('property_id', body.property_id || body.propertyId);
  const { data: assets } = await assetQ;
  const lines = (assets || []).map((a: any) => ({
    property_id: body.property_id || body.propertyId || null, campaign_id: data.id, asset_id: a.id,
    expected_location: a.location, expected_custodian: a.custodian,
    result: 'Found', status: 'Open',
  }));
  if (lines.length > 0) await client.from('uinv_asset_verifications').insert(lines);
  return res.status(201).json(data);
});

router.patch('/asset-verification-campaigns/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_verification_campaigns').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/asset-verification-campaigns/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_verification_campaigns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/asset-verifications', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { campaignId, result, status } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_verifications').select('*, asset:uinv_assets(*), campaign:uinv_asset_verification_campaigns(*)').order('created_at', { ascending: false });
  if (campaignId) q = q.eq('campaign_id', campaignId);
  if (result) q = q.eq('result', result);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.patch('/asset-verifications/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  if (body.result || body.confirmedLocation || body.confirmedCustodian) {
    body.scanned_by = performedBy;
    body.scanned_at = new Date().toISOString();
  }
  // If result is Missing, mark asset status Lost
  if (body.result === 'Missing') {
    const { data: existing } = await client.from('uinv_asset_verifications').select('asset_id').eq('id', req.params.id).single();
    if (existing) await client.from('uinv_assets').update({ status: 'Lost' }).eq('id', existing.asset_id);
  }
  const { data, error } = await client.from('uinv_asset_verifications').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ----------------------------------------------------------------
// FIXED ASSETS � WARRANTIES
// ----------------------------------------------------------------
router.get('/asset-warranties', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, assetId } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_warranties').select('*, asset:uinv_assets(*)').order('end_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (assetId) q = q.eq('asset_id', assetId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-warranties', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_warranties').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Link warranty to asset
  if (req.body.asset_id) await client.from('uinv_assets').update({ warranty_id: data.id }).eq('id', req.body.asset_id);
  return res.status(201).json(data);
});

router.patch('/asset-warranties/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_warranties').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/asset-warranties/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_warranties').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � INSURANCE
// ----------------------------------------------------------------
router.get('/asset-insurance', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, assetId } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_insurance').select('*, asset:uinv_assets(*)').order('expiry_date', { ascending: true });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (assetId) q = q.eq('asset_id', assetId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-insurance', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_insurance').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (req.body.asset_id) await client.from('uinv_assets').update({ insurance_id: data.id }).eq('id', req.body.asset_id);
  return res.status(201).json(data);
});

router.patch('/asset-insurance/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_asset_insurance').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/asset-insurance/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_insurance').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � DISPOSALS
// ----------------------------------------------------------------
router.get('/asset-disposals', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, assetId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_disposals').select('*, asset:uinv_assets(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (assetId) q = q.eq('asset_id', assetId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-disposals', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_asset_disposals').insert({
    ...body, status: body.status || 'Requested', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/asset-disposals/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const warnings: string[] = [];
  // On "Disposed", mark asset as Disposed + inactive AND post the disposal
  // journal (gain/loss) to Finance � previously no accounting handoff existed.
  if (body.status === 'Disposed') {
    const { data: existing } = await client.from('uinv_asset_disposals').select('asset_id, disposal_value, disposal_number, property_id').eq('id', req.params.id).single();
    if (existing) await client.from('uinv_assets').update({ status: 'Disposed', is_active: false }).eq('id', existing.asset_id);
    body.disposal_date = body.disposal_date || new Date().toISOString().slice(0, 10);
    const { error: jErr, data: journalId } = await client.rpc('post_asset_disposal_journal', {
      p_disposal_id: req.params.id,
      p_performed_by: performedBy,
    });
    if (jErr) warnings.push(`Disposal journal posting failed: ${jErr.message}`);
    if (journalId) body.finance_reference = journalId;
    await appendAudit(client, {
      property_id: existing?.property_id,
      user_name: performedBy, transaction_type: 'Asset Disposed', entity_type: 'asset',
      entity_id: existing?.asset_id, value: Number(body.disposal_value ?? existing?.disposal_value ?? 0),
      related_document: journalId || undefined,
    });
  }
  if (body.status === 'Approved') { body.approved_by = performedBy; body.approved_at = new Date().toISOString(); }
  if (body.status === 'Finance Reviewed') { body.finance_reviewed_by = performedBy; body.finance_reviewed_at = new Date().toISOString(); }
  const { data, error } = await client.from('uinv_asset_disposals').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(warnings.length ? { ...data, warnings } : data);
});

router.delete('/asset-disposals/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_disposals').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// FIXED ASSETS � DOCUMENTS
// ----------------------------------------------------------------
router.get('/asset-documents', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { assetId } = req.query as Record<string, string>;
  let q = client.from('uinv_asset_documents').select('*').order('created_at', { ascending: false });
  if (assetId) q = q.eq('asset_id', assetId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/asset-documents', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_asset_documents').insert({ ...req.body, uploaded_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/asset-documents/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_asset_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// FIXED ASSETS — RETIREMENT (spec §59; migration 388)
// Retirement is distinct from disposal: no proceeds, full write-off.
// ════════════════════════════════════════════════════════════════
router.post('/assets/:id/retire', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { reason, reference } = req.body || {};
  const { data: existing, error: fe } = await client.from('uinv_assets').select('*').eq('id', req.params.id).single();
  if (fe) return res.status(500).json({ error: fe.message });
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  if (existing.status === 'Retired') return res.status(409).json({ error: 'Asset is already retired' });
  if (existing.status === 'Disposed') return res.status(409).json({ error: 'Asset is disposed — use the disposal workflow' });

  // Post the retirement journal first (full NBV write-off); if it fails the
  // asset is not retired.
  const { data: journalId, error: jErr } = await client.rpc('post_asset_retirement_journal', {
    p_asset_id: req.params.id,
    p_reason: reason || null,
    p_performed_by: performedBy,
  });
  if (jErr) return res.status(500).json({ error: `Retirement journal failed: ${jErr.message}` });

  const { data, error } = await client.from('uinv_assets').update({
    status: 'Retired',
    is_active: false,
    retired_at: new Date().toISOString(),
    retirement_reason: reason || null,
    retirement_reference: journalId || reference || null,
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await appendAudit(client, {
    property_id: existing.property_id, department: existing.department,
    user_name: performedBy, transaction_type: 'Asset Retired', entity_type: 'asset',
    entity_id: existing.id, item_or_asset: existing.asset_name,
    value: Number(existing.acquisition_cost || 0),
    reason: reason || null, related_document: journalId || undefined,
  });
  return res.json(journalId ? { ...data, journal_id: journalId } : data);
});

// ════════════════════════════════════════════════════════════════
// FIXED ASSETS — WARRANTY CLAIMS (spec §40; migration 388)
// ════════════════════════════════════════════════════════════════
router.get('/warranty-claims', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, assetId, warrantyId } = req.query as Record<string, string>;
  let q = client.from('uinv_warranty_claims').select('*, asset:uinv_assets(asset_number, asset_name), warranty:uinv_asset_warranties(warranty_number, provider)').order('claim_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (assetId) q = q.eq('asset_id', assetId);
  if (warrantyId) q = q.eq('warranty_id', warrantyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/warranty-claims', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const body = req.body;
  if (!body.asset_id) return res.status(400).json({ error: 'asset_id is required' });
  if (!body.claim_number) {
    const { count } = await client.from('uinv_warranty_claims').select('id', { count: 'exact', head: true });
    body.claim_number = `WC-${String((count || 0) + 1).padStart(6, '0')}`;
  }
  const { data, error } = await client.from('uinv_warranty_claims').insert({ ...body, created_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/warranty-claims/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  if (body.status && ['Resolved - Repaired', 'Resolved - Replaced', 'Closed'].includes(body.status) && !body.resolved_at) {
    body.resolved_at = new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await client.from('uinv_warranty_claims').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/warranty-claims/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_warranty_claims').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// FIXED ASSETS — INSURANCE CLAIMS (spec §41; migration 388)
// ════════════════════════════════════════════════════════════════
router.get('/insurance-claims', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, assetId, insuranceId } = req.query as Record<string, string>;
  let q = client.from('uinv_insurance_claims').select('*, asset:uinv_assets(asset_number, asset_name), insurance:uinv_asset_insurance(policy_number, insurer)').order('incident_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (assetId) q = q.eq('asset_id', assetId);
  if (insuranceId) q = q.eq('insurance_id', insuranceId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/insurance-claims', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const body = req.body;
  if (!body.asset_id) return res.status(400).json({ error: 'asset_id is required' });
  if (!body.claim_number) {
    const { count } = await client.from('uinv_insurance_claims').select('id', { count: 'exact', head: true });
    body.claim_number = `IC-${String((count || 0) + 1).padStart(6, '0')}`;
  }
  const { data, error } = await client.from('uinv_insurance_claims').insert({ ...body, created_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/insurance-claims/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  if (body.status && ['Paid', 'Closed'].includes(body.status) && !body.settled_at) {
    body.settled_at = new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await client.from('uinv_insurance_claims').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/insurance-claims/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_insurance_claims').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// VARIANCE INVESTIGATIONS (spec §23/§50; migration 388)
// Bridge between count variance detection and resolution.
// ════════════════════════════════════════════════════════════════
router.get('/variance-investigations', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, countId, itemId } = req.query as Record<string, string>;
  let q = client.from('uinv_variance_investigations')
    .select('*, item:uinv_items(item_name, item_code), store:uinv_stores(store_name), count:uinv_counts(count_number, count_type)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (countId) q = q.eq('count_id', countId);
  if (itemId) q = q.eq('item_id', itemId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/variance-investigations', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const body = req.body;
  if (!body.item_id) return res.status(400).json({ error: 'item_id is required' });
  if (!body.investigation_number) {
    const { count } = await client.from('uinv_variance_investigations').select('id', { count: 'exact', head: true });
    body.investigation_number = `VI-${String((count || 0) + 1).padStart(6, '0')}`;
  }
  const { data, error } = await client.from('uinv_variance_investigations').insert({ ...body, created_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// Bulk-create investigations from a completed count's variance lines.
// Skips lines with zero variance and items that already have an open
// investigation for the same count.
router.post('/variance-investigations/from-count/:countId', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data: countRow, error: ce } = await client.from('uinv_counts').select('*').eq('id', req.params.countId).single();
  if (ce) return res.status(500).json({ error: ce.message });
  if (!countRow) return res.status(404).json({ error: 'Count not found' });
  if (countRow.status !== 'Completed' && countRow.status !== 'Approved') {
    return res.status(409).json({ error: `Count must be Completed or Approved before investigating variances (current: ${countRow.status})` });
  }

  const { data: existing } = await client.from('uinv_variance_investigations').select('item_id, status').eq('count_id', req.params.countId);
  const openByItem = new Map<string, boolean>();
  for (const inv of (existing || [])) {
    if (!['Closed', 'Resolved - Adjusted', 'Resolved - Accepted'].includes(inv.status)) openByItem.set(inv.item_id, true);
  }

  const { count } = await client.from('uinv_variance_investigations').select('id', { count: 'exact', head: true });
  let seq = (count || 0) + 1;
  const created: any[] = [];
  const skipped: any[] = [];
  for (const line of (countRow.lines || [])) {
    const variance = Number(line.variance ?? line.varianceQty ?? 0);
    if (!line.itemId || variance === 0) continue;
    if (openByItem.has(line.itemId)) { skipped.push({ item_id: line.itemId, reason: 'open investigation exists' }); continue; }
    const { data: created0, error } = await client.from('uinv_variance_investigations').insert({
      property_id: countRow.property_id,
      investigation_number: `VI-${String(seq++).padStart(6, '0')}`,
      count_id: req.params.countId,
      item_id: line.itemId,
      store_id: countRow.store_id,
      batch_id: line.batchId || null,
      source: 'Stock Count',
      variance_quantity: variance,
      variance_value: Number(line.varianceValue ?? (variance * Number(line.unitCost || 0))),
      status: 'Open',
      notes: `Auto-created from count ${countRow.count_number}${line.notes ? ` — ${line.notes}` : ''}`,
      created_by: performedBy,
    }).select().single();
    if (error) { skipped.push({ item_id: line.itemId, reason: error.message }); continue; }
    created.push(created0);
  }
  return res.status(201).json({ created, skipped, count_id: req.params.countId });
});

router.patch('/variance-investigations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  if (body.status && String(body.status).startsWith('Resolved') && !body.resolved_at) {
    body.resolved_at = new Date().toISOString();
    body.resolved_by = performedBy;
  }
  const { data, error } = await client.from('uinv_variance_investigations').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await appendAudit(client, {
    property_id: data?.property_id,
    user_name: performedBy, transaction_type: 'Variance Investigation Updated',
    entity_type: 'variance_investigation', entity_id: data?.id,
    quantity: Number(data?.variance_quantity || 0), value: Number(data?.variance_value || 0),
    new_state: data,
  });
  return res.json(data);
});

router.delete('/variance-investigations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_variance_investigations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// TOOLS & EQUIPMENT (migration 366)
// ----------------------------------------------------------------
router.get('/tools', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, custodian } = req.query as Record<string, string>;
  let q = client.from('uinv_tools').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (custodian) q = q.ilike('custodian', custodian);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/tools', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_tools').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/tools/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_tools').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tools/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_tools').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/tool-assignments', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, toolId, status, employee } = req.query as Record<string, string>;
  let q = client.from('uinv_tool_assignments').select('*, tool:uinv_tools(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (toolId) q = q.eq('tool_id', toolId);
  if (status) q = q.eq('status', status);
  if (employee) q = q.ilike('employee', employee);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/tool-assignments', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_tool_assignments').insert({
    ...body, status: body.status || 'Active', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await client.from('uinv_tools').update({ status: 'Issued', custodian: body.employee }).eq('id', body.tool_id);
  return res.status(201).json(data);
});

router.patch('/tool-assignments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  if (body.status === 'Returned') {
    const { data: existing } = await client.from('uinv_tool_assignments').select('tool_id').eq('id', req.params.id).single();
    if (existing) await client.from('uinv_tools').update({ status: 'In Stock', custodian: null }).eq('id', existing.tool_id);
    body.return_date = body.return_date || new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await client.from('uinv_tool_assignments').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tool-assignments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_tool_assignments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/tool-calibrations', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { toolId } = req.query as Record<string, string>;
  let q = client.from('uinv_tool_calibrations').select('*, tool:uinv_tools(*)').order('calibration_date', { ascending: false });
  if (toolId) q = q.eq('tool_id', toolId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/tool-calibrations', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const { data, error } = await client.from('uinv_tool_calibrations').insert(body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Update tool's calibration dates
  await client.from('uinv_tools').update({
    last_calibration_date: body.calibration_date,
    next_calibration_date: body.next_calibration_date || null,
  }).eq('id', body.tool_id);
  return res.status(201).json(data);
});

router.delete('/tool-calibrations/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_tool_calibrations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// LINEN MANAGEMENT
// ----------------------------------------------------------------
router.get('/linen', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, category } = req.query as Record<string, string>;
  let q = client.from('uinv_linen_items').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/linen', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_linen_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/linen/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_linen_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/linen/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_linen_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/linen-movements', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { linenId } = req.query as Record<string, string>;
  let q = client.from('uinv_linen_movements').select('*, linen:uinv_linen_items(*)').order('movement_date', { ascending: false }).limit(200);
  if (linenId) q = q.eq('linen_id', linenId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/linen-movements', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_linen_movements').insert({ ...body, performed_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Apply movement to linen item quantities
  const { data: linen } = await client.from('uinv_linen_items').select('*').eq('id', body.linen_id).single();
  if (linen) {
    const update: Record<string, number> = {};
    const qty = Number(body.quantity || 0);
    switch (body.movement_type) {
      case 'Issue': update.department_quantity = (linen.department_quantity || 0) + qty; update.store_quantity = Math.max(0, (linen.store_quantity || 0) - qty); break;
      case 'Laundry Out': update.dirty_quantity = (linen.dirty_quantity || 0) + qty; update.department_quantity = Math.max(0, (linen.department_quantity || 0) - qty); update.laundry_quantity = (linen.laundry_quantity || 0) + qty; break;
      case 'Laundry Return': update.clean_quantity = (linen.clean_quantity || 0) + qty; update.laundry_quantity = Math.max(0, (linen.laundry_quantity || 0) - qty); update.dirty_quantity = Math.max(0, (linen.dirty_quantity || 0) - qty); break;
      case 'Damage': update.damaged_quantity = (linen.damaged_quantity || 0) + qty; update.clean_quantity = Math.max(0, (linen.clean_quantity || 0) - qty); break;
      case 'Loss': update.lost_quantity = (linen.lost_quantity || 0) + qty; update.clean_quantity = Math.max(0, (linen.clean_quantity || 0) - qty); break;
      case 'Retirement': update.retired_quantity = (linen.retired_quantity || 0) + qty; update.clean_quantity = Math.max(0, (linen.clean_quantity || 0) - qty); break;
    }
    await client.from('uinv_linen_items').update(update).eq('id', body.linen_id);
  }
  return res.status(201).json(data);
});

// ----------------------------------------------------------------
// UNIFORM MANAGEMENT
// ----------------------------------------------------------------
router.get('/uniforms', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, department } = req.query as Record<string, string>;
  let q = client.from('uinv_uniform_items').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (department) q = q.ilike('department', department);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/uniforms', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_uniform_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/uniforms/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_uniform_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/uniforms/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_uniform_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/uniform-assignments', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, employee, status } = req.query as Record<string, string>;
  let q = client.from('uinv_uniform_assignments').select('*, uniform:uinv_uniform_items(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (employee) q = q.ilike('employee', employee);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/uniform-assignments', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_uniform_assignments').insert({
    ...body, status: body.status || 'Issued', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Increment issued_quantity on the uniform item
  const { data: uniform } = await client.from('uinv_uniform_items').select('issued_quantity, stock_quantity').eq('id', body.uniform_id).single();
  if (uniform) {
    await client.from('uinv_uniform_items').update({
      issued_quantity: (uniform.issued_quantity || 0) + Number(body.quantity || 1),
      stock_quantity: Math.max(0, (uniform.stock_quantity || 0) - Number(body.quantity || 1)),
    }).eq('id', body.uniform_id);
  }
  return res.status(201).json(data);
});

router.patch('/uniform-assignments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_uniform_assignments').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/uniform-assignments/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_uniform_assignments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// RETURNABLES & CONSIGNMENT
// ----------------------------------------------------------------
router.get('/returnables', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, owner } = req.query as Record<string, string>;
  let q = client.from('uinv_returnable_items').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (owner) q = q.eq('owner', owner);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/returnables', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_returnable_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/returnables/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_returnable_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/returnables/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_returnable_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/returnable-movements', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { returnableId } = req.query as Record<string, string>;
  let q = client.from('uinv_returnable_movements').select('*, returnable:uinv_returnable_items(*)').order('movement_date', { ascending: false }).limit(200);
  if (returnableId) q = q.eq('returnable_id', returnableId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/returnable-movements', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_returnable_movements').insert({ ...body, performed_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Apply movement to returnable item quantities
  const { data: item } = await client.from('uinv_returnable_items').select('*').eq('id', body.returnable_id).single();
  if (item) {
    const qty = Number(body.quantity || 0);
    const update: Record<string, number> = {};
    switch (body.movement_type) {
      case 'Receive': update.quantity_on_hand = (item.quantity_on_hand || 0) + qty; break;
      case 'Issue to Supplier': update.quantity_on_hand = Math.max(0, (item.quantity_on_hand || 0) - qty); update.quantity_out = (item.quantity_out || 0) + qty; break;
      case 'Return from Supplier': update.quantity_out = Math.max(0, (item.quantity_out || 0) - qty); break;
      case 'Receive from Dept': update.quantity_on_hand = (item.quantity_on_hand || 0) + qty; update.quantity_out = Math.max(0, (item.quantity_out || 0) - qty); break;
      case 'Scrap': update.quantity_on_hand = Math.max(0, (item.quantity_on_hand || 0) - qty); break;
    }
    await client.from('uinv_returnable_items').update(update).eq('id', body.returnable_id);
  }
  return res.status(201).json(data);
});

// ----------------------------------------------------------------
// LOANABLE EQUIPMENT
// ----------------------------------------------------------------
router.get('/loanable-items', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, type } = req.query as Record<string, string>;
  let q = client.from('uinv_loanable_items').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/loanable-items', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_loanable_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/loanable-items/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_loanable_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/loanable-items/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_loanable_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/loan-transactions', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, loanableId, status, borrower } = req.query as Record<string, string>;
  let q = client.from('uinv_loan_transactions').select('*, loanable:uinv_loanable_items(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (loanableId) q = q.eq('loanable_id', loanableId);
  if (status) q = q.eq('status', status);
  if (borrower) q = q.ilike('borrower', borrower);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/loan-transactions', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_loan_transactions').insert({
    ...body, status: body.status || 'Active', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Decrement available_quantity
  const { data: item } = await client.from('uinv_loanable_items').select('available_quantity').eq('id', body.loanable_id).single();
  if (item) await client.from('uinv_loanable_items').update({ available_quantity: Math.max(0, (item.available_quantity || 0) - 1) }).eq('id', body.loanable_id);
  return res.status(201).json(data);
});

router.patch('/loan-transactions/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  if (body.status === 'Returned') {
    const { data: existing } = await client.from('uinv_loan_transactions').select('loanable_id').eq('id', req.params.id).single();
    if (existing) {
      const { data: item } = await client.from('uinv_loanable_items').select('available_quantity').eq('id', existing.loanable_id).single();
      if (item) await client.from('uinv_loanable_items').update({ available_quantity: (item.available_quantity || 0) + 1 }).eq('id', existing.loanable_id);
    }
    body.return_date = body.return_date || new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await client.from('uinv_loan_transactions').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/loan-transactions/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_loan_transactions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// GOVERNANCE � INVENTORY PERIODS (migration 367)
// ----------------------------------------------------------------
router.get('/inventory-periods', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_inventory_periods').select('*').order('start_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/inventory-periods', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_inventory_periods').insert({
    ...body, status: body.status || 'Open', created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/inventory-periods/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  if (body.status === 'Frozen') body.frozen_at = new Date().toISOString();
  if (body.status === 'Closed') { body.closed_at = new Date().toISOString(); body.closed_by = performedBy; }
  const { data, error } = await client.from('uinv_inventory_periods').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/inventory-periods/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_inventory_periods').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// GOVERNANCE � AUDIT LOGS
// ----------------------------------------------------------------
router.get('/audit-logs', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, entityType, entityId, userId, startDate, endDate } = req.query as Record<string, string>;
  let q = client.from('uinv_audit_logs').select('*').order('timestamp', { ascending: false }).limit(500);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (entityType) q = q.eq('entity_type', entityType);
  if (entityId) q = q.eq('entity_id', entityId);
  if (userId) q = q.eq('user_id', userId);
  if (startDate) q = q.gte('timestamp', startDate);
  if (endDate) q = q.lte('timestamp', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ----------------------------------------------------------------
// GOVERNANCE � APPROVAL REQUESTS (SoD)
// ----------------------------------------------------------------
router.get('/approval-requests', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, approvalType } = req.query as Record<string, string>;
  let q = client.from('uinv_approval_requests').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (approvalType) q = q.eq('approval_type', approvalType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/approval-requests', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_approval_requests').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/approval-requests/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  if (body.status === 'Approved' || body.status === 'Rejected') {
    // Segregation of duties (spec �71/�85): the requester must never be
    // able to approve or reject their own request.
    const { data: existing } = await client.from('uinv_approval_requests').select('requester, status').eq('id', req.params.id).single();
    if (existing && existing.status === 'Pending') {
      const requester = String(existing.requester || '').trim().toLowerCase();
      const actor = String(performedBy || '').trim().toLowerCase();
      if (requester && requester === actor) {
        return res.status(403).json({ error: 'Segregation of duties: you cannot approve or reject your own request.' });
      }
    }
    body.approver = performedBy;
    body.approved_at = new Date().toISOString();
  }
  const { data, error } = await client.from('uinv_approval_requests').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/approval-requests/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_approval_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// DASHBOARD � role-based KPIs are served by the /dashboard route
// defined earlier in this file (extended with asset fields).
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// CRITICAL SPARES (spec S51)
// ----------------------------------------------------------------
router.get('/critical-spares', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, criticality } = req.query as Record<string, string>;
  let q = client.from('uinv_critical_spares').select('*, item:uinv_items!item_id(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (criticality) q = q.eq('criticality', criticality);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/critical-spares', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_critical_spares').insert({ ...body, created_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/critical-spares/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_critical_spares').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/critical-spares/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_critical_spares').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// EQUIPMENT COMPATIBILITY (spec S52)
// ----------------------------------------------------------------
router.get('/equipment-compatibility', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, itemId, assetId } = req.query as Record<string, string>;
  let q = client.from('uinv_equipment_compatibility').select('*, item:uinv_items(*), asset:uinv_assets(*)').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (itemId) q = q.eq('item_id', itemId);
  if (assetId) q = q.eq('asset_id', assetId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/equipment-compatibility', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_equipment_compatibility').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/equipment-compatibility/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_equipment_compatibility').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// GUEST CUSTODY (spec S49)
// ----------------------------------------------------------------
router.get('/guest-custody', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, ownerType } = req.query as Record<string, string>;
  let q = client.from('uinv_guest_custody').select('*').order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (ownerType) q = q.eq('owner_type', ownerType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/guest-custody', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_guest_custody').insert({ ...body, created_by: performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/guest-custody/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  if (body.status === 'Released') {
    body.released_by = performedBy;
    if (!body.release_date) body.release_date = new Date().toISOString().split('T')[0];
  }
  const { data, error } = await client.from('uinv_guest_custody').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/guest-custody/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_guest_custody').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// STORE SESSIONS � Opening & Closing (spec S75)
// ----------------------------------------------------------------
router.get('/store-sessions', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, storeId, sessionType } = req.query as Record<string, string>;
  let q = client.from('uinv_store_sessions').select('*, store:uinv_stores(*)').order('session_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (storeId) q = q.eq('store_id', storeId);
  if (sessionType) q = q.eq('session_type', sessionType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/store-sessions', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_store_sessions').insert({ ...body, performed_by: body.performed_by || performedBy }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/store-sessions/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_store_sessions').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/store-sessions/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_store_sessions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// GLOBAL RESOURCE SEARCH (spec S55)
// ----------------------------------------------------------------
router.get('/global-search', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const q = (req.query.q as string || '').trim();
  const propertyId = req.query.propertyId as string;
  if (!q || q.length < 2) return res.json([]);

  const like = `%${q}%`;
  const results: any[] = [];

  // Search items
  let itemQ = client.from('uinv_items').select('id, item_code, item_name, category, status, default_store_id').ilike('item_name', like);
  if (propertyId) itemQ = itemQ.eq('property_id', propertyId);
  const { data: items } = await itemQ.limit(10);
  (items || []).forEach((r: any) => results.push({
    type: 'Item', id: r.id, label: r.item_name, subtitle: r.item_code || '',
    location: null, status: r.status, reference: r.item_code,
  }));

  // Search assets
  let assetQ = client.from('uinv_assets').select('id, asset_number, asset_name, location, status, asset_tag, serial_number').ilike('asset_name', like);
  if (propertyId) assetQ = assetQ.eq('property_id', propertyId);
  const { data: assets } = await assetQ.limit(10);
  (assets || []).forEach((r: any) => results.push({
    type: 'Asset', id: r.id, label: r.asset_name, subtitle: r.asset_number || '',
    location: r.location, status: r.status, reference: r.asset_number,
  }));

  // Search serials
  let serialQ = client.from('uinv_serials').select('id, serial_number, item_id, store_id, status').ilike('serial_number', like);
  if (propertyId) serialQ = serialQ.eq('property_id', propertyId);
  const { data: serials } = await serialQ.limit(10);
  (serials || []).forEach((r: any) => results.push({
    type: 'Serial', id: r.id, label: r.serial_number, subtitle: 'Serial Number',
    location: null, status: r.status, reference: r.serial_number,
  }));

  // Search batches
  let batchQ = client.from('uinv_batches').select('id, batch_number, item_id, status').ilike('batch_number', like);
  if (propertyId) batchQ = batchQ.eq('property_id', propertyId);
  const { data: batches } = await batchQ.limit(10);
  (batches || []).forEach((r: any) => results.push({
    type: 'Batch', id: r.id, label: r.batch_number, subtitle: 'Batch Number',
    location: null, status: r.status, reference: r.batch_number,
  }));

  // Search stores
  let storeQ = client.from('uinv_stores').select('id, store_name, store_code, store_type, status').ilike('store_name', like);
  if (propertyId) storeQ = storeQ.eq('property_id', propertyId);
  const { data: stores } = await storeQ.limit(5);
  (stores || []).forEach((r: any) => results.push({
    type: 'Store', id: r.id, label: r.store_name, subtitle: r.store_code || '',
    location: null, status: r.status, reference: r.store_code,
  }));

  // Search tools
  let toolQ = client.from('uinv_tools').select('id, tool_name, serial_number, status, location').ilike('tool_name', like);
  if (propertyId) toolQ = toolQ.eq('property_id', propertyId);
  const { data: tools } = await toolQ.limit(10);
  (tools || []).forEach((r: any) => results.push({
    type: 'Tool', id: r.id, label: r.tool_name, subtitle: r.serial_number || '',
    location: r.location, status: r.status, reference: r.serial_number,
  }));

  return res.json(results);
});

// ----------------------------------------------------------------
// DEPARTMENT CONSUMPTION (spec �61��66)
// Lets any department post consumption against their department
// store stock. Covers spa treatments, FO amenities, banquet events,
// HK supplies, engineering materials, etc.
// ----------------------------------------------------------------
router.post('/department-consumption', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const {
    property_id, department, consumed_by, consumption_date,
    reference_type, reference_id, reference_number,
    cost_center, notes, lines,
  } = req.body || {};

  if (!department || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'department and lines[] are required' });
  }

  const user = (req as any).user;
  let deptStoreId = await findDeptStore(client, department);
  // Fallback: if no dedicated department store, use the first mapped store code
  if (!deptStoreId) {
    const codes = DEPARTMENT_STORE_CODES[department];
    if (codes && codes.length > 0) {
      for (const code of codes) {
        const { data: storeByCode } = await client
          .from('uinv_stores').select('id').eq('store_code', code).eq('is_active', true).maybeSingle();
        if (storeByCode?.id) { deptStoreId = storeByCode.id; break; }
      }
    }
  }
  if (!deptStoreId) {
    return res.status(400).json({ error: `No active department store found for "${department}"` });
  }

  const results: any[] = [];
  const consumptionNumber = `CON-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

  for (const line of lines) {
    const { item_id, quantity, unit_cost = 0, reason } = line;
    if (!item_id || !quantity || quantity <= 0) {
      results.push({ item_id, success: false, error: 'Invalid item_id or quantity' });
      continue;
    }

    // Atomic movement via the RPC: locks the balance row, validates
    // availability INCLUDING reserved/allocated/quarantined (previously
    // only on_hand was checked, so reserved stock could be consumed), and
    // appends the ledger row in the same transaction.
    let move: any;
    try {
      move = await applyStockMovement(client, {
        propertyId: property_id ?? null,
        itemId: item_id,
        storeId: deptStoreId,
        transactionType: 'Consumption',
        qtyOut: quantity,
        reference: consumptionNumber,
        unitCost: Number(unit_cost || 0) || null,
        performedBy: consumed_by || user?.name || 'system',
        reason: reason || `Consumption by ${department}`,
      });
    } catch (e: any) {
      results.push({ item_id, success: false, error: String(e?.message || e) });
      continue;
    }

    // Audit (best-effort is acceptable here � the movement + ledger are atomic)
    await appendAudit(client, {
      property_id: property_id ?? null,
      department,
      user_id: user?.id,
      user_name: consumed_by || user?.name || 'system',
      transaction_type: 'Consumption',
      entity_type: 'Stock Balance',
      entity_id: move?.balance_id,
      item_or_asset: item_id,
      quantity,
      value: quantity * Number(unit_cost || move?.unit_cost || 0),
      location: department,
      reason: reason || `Consumption by ${department}`,
      related_document: reference_number || consumptionNumber,
    });

    // Auto-post COGS journal entry (Gap 4) � failure is surfaced per-line
    // instead of being silently swallowed.
    const lineCost = quantity * Number(unit_cost || move?.unit_cost || 0);
    const lineWarnings: string[] = [];
    if (lineCost > 0) {
      const { error: jErr } = await client.rpc('post_inventory_journal', {
        p_source_entity: 'uinv_department_consumption',
        p_source_id: `${consumptionNumber}-${item_id}`,
        p_posting_type: 'COGS',
        p_amount: lineCost,
        p_description: `Consumption by ${department} - ${consumptionNumber} - item ${item_id}`,
        p_department: department,
        p_property_id: property_id ?? null,
        p_reference: consumptionNumber,
        p_created_by: consumed_by || user?.name || 'system',
      });
      if (jErr) lineWarnings.push(`Journal posting failed: ${jErr.message}`);
    }

    results.push({ item_id, success: true, new_on_hand: move?.on_hand, warnings: lineWarnings.length ? lineWarnings : undefined });
  }

  // Notify inventory department of consumption
  await notifyDepartment(client, {
    property_id: property_id ?? null,
    department: 'Inventory',
    notification_type: 'Consumption',
    message: `${department} consumed ${lines.length} item(s) � ref ${consumptionNumber}`,
    created_by: consumed_by || user?.name || 'system',
  });

  return res.json({
    success: true,
    consumption_number: consumptionNumber,
    department,
    store_id: deptStoreId,
    reference_type: reference_type || null,
    reference_id: reference_id || null,
    reference_number: reference_number || null,
    cost_center: cost_center || null,
    notes: notes || null,
    results,
  });
});

// Get consumption history for a department
router.get('/department-consumption/:department', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { department } = req.params;
  const { propertyId, startDate, endDate, limit } = req.query as Record<string, string>;

  let q = client.from('uinv_stock_ledger')
    .select('*, uinv_items:item_id(item_name, item_code, unit_of_measure)')
    .eq('transaction_type', 'Consumption')
    .order('transaction_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (startDate) q = q.gte('transaction_date', startDate);
  if (endDate) q = q.lte('transaction_date', endDate);

  const { data, error } = await q.limit(Number(limit) || 200);
  if (error) return res.status(500).json({ error: error.message });

  // Filter by department via the reason field or store's department
  // Since ledger doesn't have department directly, we filter by store_id matching dept store
  const deptStoreId = await findDeptStore(client, department);
  const filtered = deptStoreId ? (data || []).filter((r: any) => r.store_id === deptStoreId) : (data || []);
  return res.json(filtered);
});

/**
 * GET /consumption � cross-department consumption history.
 * Returns Consumption ledger entries across ALL department stores, joined
 * with the item master and the store (so the department is visible).
 *
 * Query: ?propertyId= ?startDate= ?endDate= ?department= ?storeId= ?limit=200
 *
 * Used by the Inventory portal's Consumption tab to see consumption across
 * all departments in one view.
 */
router.get('/consumption', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, startDate, endDate, department, storeId, limit } = req.query as Record<string, string>;

  let q = client.from('uinv_stock_ledger')
    .select('*, item:uinv_items(item_name, item_code, unit_of_measure, category), store:uinv_stores(store_name, store_code, department)')
    .eq('transaction_type', 'Consumption')
    .order('transaction_date', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (startDate) q = q.gte('transaction_date', startDate);
  if (endDate) q = q.lte('transaction_date', endDate);
  if (storeId) q = q.eq('store_id', storeId);

  const { data, error } = await q.limit(Number(limit) || 500);
  if (error) return res.status(500).json({ error: error.message });

  // Optional department filter (client-side since department lives on the joined store)
  let rows = data || [];
  if (department && department !== 'All') {
    rows = rows.filter((r: any) => r.store?.department === department);
  }
  return res.json(rows);
});

// ----------------------------------------------------------------
// FINANCE BRIDGE (spec �60)
// Syncs uinv_assets to the Finance fixed_assets register and
// provides a unified asset register view for Finance.
// ----------------------------------------------------------------
router.post('/finance/sync-assets', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { property_id } = req.body || {};
  const user = (req as any).user;

  // Fetch all uinv_assets that haven't been synced yet (no matching fixed_assets row)
  let assetQ = client.from('uinv_assets').select('*')
    .in('status', ['Received', 'Tagged', 'Available', 'Assigned', 'In Service', 'Under Maintenance', 'Damaged', 'Lost', 'Stolen', 'Impaired']);
  if (property_id) assetQ = assetQ.eq('property_id', property_id);
  const { data: uinvAssets, error: ae } = await assetQ;
  if (ae) return res.status(500).json({ error: ae.message });

  let synced = 0;
  let skipped = 0;
  const errors: any[] = [];

  for (const asset of uinvAssets || []) {
    // Check if a fixed_assets row already exists for this uinv_asset
    const { data: existing } = await client.from('fixed_assets')
      .select('id').eq('asset_code', asset.asset_number).maybeSingle();

    if (existing) { skipped++; continue; }

    // Map uinv_asset ? fixed_assets
    const purchaseCost = Number(asset.acquisition_cost) || 0;
    const salvageValue = 0;
    const netBookValue = purchaseCost - salvageValue;

    const { error: ie } = await client.from('fixed_assets').insert({
      asset_code: asset.asset_number,
      asset_name: asset.asset_name,
      asset_category: asset.category || asset.class || 'General',
      description: asset.description || `Synced from inventory asset ${asset.asset_number}`,
      location: asset.location || asset.department || '',
      purchase_date: asset.purchase_date || asset.acquisition_date || new Date().toISOString().split('T')[0],
      purchase_cost: purchaseCost,
      salvage_value: salvageValue,
      useful_life_years: asset.useful_life_years || 5,
      depreciation_method: 'Straight Line',
      net_book_value: netBookValue,
      status: 'Active',
    });

    if (ie) {
      errors.push({ asset_number: asset.asset_number, error: ie.message });
    } else {
      synced++;
      await appendAudit(client, {
        property_id: asset.property_id,
        department: 'Finance',
        user_id: user?.id,
        user_name: user?.name || 'system',
        transaction_type: 'Finance Sync',
        entity_type: 'Asset',
        entity_id: asset.id,
        item_or_asset: asset.asset_number,
        value: purchaseCost,
        reason: 'Asset synced to Finance fixed_assets register',
      });
    }
  }

  return res.json({
    success: true,
    total_uinv_assets: (uinvAssets || []).length,
    synced,
    skipped,
    errors,
  });
});

// Unified asset register view for Finance
router.get('/finance/asset-register', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status, department } = req.query as Record<string, string>;

  // Join uinv_assets with fixed_assets on asset_code = asset_number
  let q = client.from('uinv_assets').select(`
    id, asset_number, asset_name, asset_tag, serial_number, category, class,
    department, location, custodian, condition, status,
    acquisition_cost, acquisition_date, purchase_date, in_service_date,
    property_id, created_at, updated_at
  `).order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (status) q = q.eq('status', status);
  if (department) q = q.eq('department', department);

  const { data: uinvAssets, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with Finance fixed_assets data
  const assetNumbers = (uinvAssets || []).map((a: any) => a.asset_number);
  let faQ = client.from('fixed_assets').select('id, asset_code, asset_name, asset_category, purchase_cost, salvage_value, net_book_value, useful_life_years, depreciation_method, status, purchase_date')
    .in('asset_code', assetNumbers.length > 0 ? assetNumbers : ['__none__']);
  const { data: faAssets } = await faQ;
  const faMap = new Map((faAssets || []).map((f: any) => [f.asset_code, f]));

  const result = (uinvAssets || []).map((a: any) => ({
    ...a,
    finance: faMap.get(a.asset_number) || null,
  }));

  return res.json(result);
});

// ----------------------------------------------------------------
// SECURITY ALERTS (spec �67)
// Generates and lists security alerts for missing assets, suspected
// theft, high-value unexplained loss, unauthorized after-hours
// transactions, and suspicious adjustments.
// ----------------------------------------------------------------
router.get('/security/alerts', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, severity, status } = req.query as Record<string, string>;

  const alerts: any[] = [];

  // 1. Missing assets from verification campaigns
  let missQ = client.from('uinv_asset_verifications')
    .select('id, asset_id, campaign_id, result, expected_location, confirmed_location, expected_custodian, confirmed_custodian, notes, created_at, status')
    .in('result', ['Missing', 'Wrong Location', 'Wrong Custodian', 'Duplicate', 'Unidentified']);
  if (propertyId) missQ = missQ.eq('property_id', propertyId);
  if (status) missQ = missQ.eq('status', status);
  const { data: missingAssets } = await missQ.order('created_at', { ascending: false }).limit(50);
  (missingAssets || []).forEach((m: any) => {
    alerts.push({
      id: `sec-missing-${m.id}`,
      type: 'Missing Asset',
      severity: m.result === 'Missing' ? 'Critical' : 'High',
      entity_type: 'Asset',
      entity_id: m.asset_id,
      description: `Asset verification result: ${m.result}. Expected location: ${m.expected_location || '�'}. Confirmed: ${m.confirmed_location || '�'}.`,
      status: m.status,
      created_at: m.created_at,
      reference: `Verification ${m.campaign_id?.slice(0, 8) || ''}`,
    });
  });

  // 2. High-value waste/loss records (>$500)
  let wasteQ = client.from('uinv_waste')
    .select('id, waste_number, waste_type, reason, total_cost, status, store_id, created_at')
    .gte('total_cost', 500);
  if (propertyId) wasteQ = wasteQ.eq('property_id', propertyId);
  const { data: highValueWaste } = await wasteQ.order('created_at', { ascending: false }).limit(50);
  (highValueWaste || []).forEach((w: any) => {
    alerts.push({
      id: `sec-waste-${w.id}`,
      type: 'High-Value Loss',
      severity: Number(w.total_cost) >= 5000 ? 'Critical' : 'High',
      entity_type: 'Waste Record',
      entity_id: w.id,
      description: `Waste record ${w.waste_number} � ${w.waste_type}: ${w.reason || '�'}. Value: $${Number(w.total_cost).toFixed(2)}.`,
      status: w.status,
      created_at: w.created_at,
      reference: w.waste_number,
    });
  });

  // 3. Suspicious adjustments (large quantity changes)
  let adjQ = client.from('uinv_adjustments')
    .select('id, adjustment_number, adjustment_type, reason, quantity_delta, value_impact, status, created_at')
    .or('quantity_delta.gte.100,quantity_delta.lte.-100,value_impact.gte.1000,value_impact.lte.-1000');
  if (propertyId) adjQ = adjQ.eq('property_id', propertyId);
  const { data: suspiciousAdj } = await adjQ.order('created_at', { ascending: false }).limit(50);
  (suspiciousAdj || []).forEach((a: any) => {
    alerts.push({
      id: `sec-adj-${a.id}`,
      type: 'Suspicious Adjustment',
      severity: Math.abs(Number(a.value_impact || 0)) >= 5000 ? 'Critical' : 'High',
      entity_type: 'Adjustment',
      entity_id: a.id,
      description: `Adjustment ${a.adjustment_number} � ${a.adjustment_type}: ${a.reason || '�'}. Qty delta: ${a.quantity_delta}. Value impact: $${Number(a.value_impact || 0).toFixed(2)}.`,
      status: a.status,
      created_at: a.created_at,
      reference: a.adjustment_number,
    });
  });

  // 4. After-hours transactions (created between 22:00 and 06:00)
  const { data: afterHours } = await client.rpc('get_after_hours_inventory_transactions', { p_property_id: propertyId || null }).maybeSingle().then((r: any) => r);
  // Fallback: query ledger for after-hours entries
  if (!afterHours) {
    let ledgerQ = client.from('uinv_stock_ledger')
      .select('id, transaction_type, reference, quantity_out, value, performed_by, transaction_date')
      .order('transaction_date', { ascending: false })
      .limit(200);
    if (propertyId) ledgerQ = ledgerQ.eq('property_id', propertyId);
    const { data: ledger } = await ledgerQ;
    (ledger || []).forEach((l: any) => {
      const hour = new Date(l.transaction_date).getHours();
      if (hour >= 22 || hour < 6) {
        alerts.push({
          id: `sec-afterhrs-${l.id}`,
          type: 'After-Hours Transaction',
          severity: 'Medium',
          entity_type: 'Ledger Entry',
          entity_id: l.id,
          description: `After-hours ${l.transaction_type} � ref: ${l.reference || '�'}. Qty out: ${l.quantity_out}. Value: $${Number(l.value || 0).toFixed(2)}. By: ${l.performed_by}.`,
          status: 'Open',
          created_at: l.transaction_date,
          reference: l.reference,
        });
      }
    });
  }

  // Filter by severity if requested
  const filtered = alerts.filter(a =>
    (!severity || a.severity === severity) &&
    (!status || a.status === status)
  );

  return res.json(filtered);
});

// ----------------------------------------------------------------
// PROCUREMENT PO LINKAGE (spec �8)
// Links uinv_goods_receipts to actual procurement purchase orders
// and provides a list of open POs for receiving.
// ----------------------------------------------------------------
router.get('/procurement/purchase-orders', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, status } = req.query as Record<string, string>;

  // Fetch from both proc_requisitions and purchase_orders
  let poQ = client.from('purchase_orders')
    .select('id, po_number, supplier_name, status, total_amount, order_date, expected_delivery_date, property_id')
    .order('order_date', { ascending: false });
  if (propertyId) poQ = poQ.eq('property_id', propertyId);
  if (status) poQ = poQ.eq('status', status);
  else poQ = poQ.in('status', ['Approved', 'Sent', 'Partially Received']);

  const { data: pos, error } = await poQ.limit(100);
  if (error) return res.status(500).json({ error: error.message });

  // Also fetch proc_requisitions that are approved (potential POs)
  let reqQ = client.from('proc_requisitions')
    .select('id, requisition_number, source_system, status, total_estimated, property_id, created_at')
    .eq('status', 'Approved')
    .order('created_at', { ascending: false });
  if (propertyId) reqQ = reqQ.eq('property_id', propertyId);
  const { data: reqs } = await reqQ.limit(50);

  return res.json({
    purchase_orders: pos || [],
    approved_requisitions: reqs || [],
  });
});

// Link a goods receipt to a purchase order
router.patch('/receipts/:id/link-po', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { id } = req.params;
  const { po_id, po_number } = req.body || {};
  const user = (req as any).user;

  if (!po_id && !po_number) {
    return res.status(400).json({ error: 'po_id or po_number is required' });
  }

  // Verify the PO exists
  let po: any = null;
  if (po_id) {
    const { data, error } = await client.from('purchase_orders').select('id, po_number, supplier_name, status').eq('id', po_id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    po = data;
  } else if (po_number) {
    const { data, error } = await client.from('purchase_orders').select('id, po_number, supplier_name, status').eq('po_number', po_number).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    po = data;
  }

  if (!po) {
    return res.status(404).json({ error: 'Purchase order not found' });
  }

  // Update the goods receipt
  const { data: updated, error: ue } = await client.from('uinv_goods_receipts')
    .update({
      purchase_order: po.po_number,
      purchase_order_id: po.id,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single();
  if (ue) return res.status(500).json({ error: ue.message });

  await appendAudit(client, {
    transaction_type: 'PO Link',
    entity_type: 'Goods Receipt',
    entity_id: id,
    reason: `Goods receipt linked to PO ${po.po_number}`,
    related_document: po.po_number,
    user_id: user?.id,
    user_name: user?.name || 'system',
  });

  return res.json({ success: true, receipt: updated, purchase_order: po });
});

// ----------------------------------------------------------------
// F&B BAR/KITCHEN RECONCILIATION (spec �61)
// Syncs bar_inventory_items and kitchen_inventory_items with
// uinv_items so F&B stock is reconciled with the unified inventory.
// ----------------------------------------------------------------
router.get('/fb/outlet-inventory', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { outlet, propertyId } = req.query as Record<string, string>;

  const results: any = { bar: [], kitchen: [] };

  // Bar inventory
  let barQ = client.from('bar_inventory_items').select('*').order('item_name', { ascending: true });
  if (propertyId) barQ = barQ.eq('property_id', propertyId);
  const { data: barItems } = await barQ.limit(500);
  results.bar = barItems || [];

  // Kitchen inventory
  let kitQ = client.from('kitchen_inventory_items').select('*').order('item_name', { ascending: true });
  if (propertyId) kitQ = kitQ.eq('property_id', propertyId);
  const { data: kitItems } = await kitQ.limit(500);
  results.kitchen = kitItems || [];

  return res.json(results);
});

// Reconcile F&B outlet inventory with uinv_items
router.post('/fb/reconcile', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { property_id, outlet_type } = req.body || {}; // outlet_type: 'bar' | 'kitchen' | 'both'
  const user = (req as any).user;

  const tablesToSync = outlet_type === 'bar' ? ['bar'] : outlet_type === 'kitchen' ? ['kitchen'] : ['bar', 'kitchen'];
  const results: any = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const outlet of tablesToSync) {
    const tableName = outlet === 'bar' ? 'bar_inventory_items' : 'kitchen_inventory_items';

    let q = client.from(tableName).select('*');
    if (property_id) q = q.eq('property_id', property_id);
    const { data: outletItems, error } = await q;
    if (error) { results.errors.push({ outlet, error: error.message }); continue; }

    for (const item of outletItems || []) {
      // Try to find a matching uinv_item by name or code
      const itemName = item.item_name || item.name;
      const itemCode = item.item_code || item.id;

      let uinvQ = client.from('uinv_items').select('id, item_name, item_code, category, unit_of_measure').ilike('item_name', itemName).limit(1);
      if (property_id) uinvQ = uinvQ.eq('property_id', property_id);
      const { data: existing } = await uinvQ.maybeSingle();

      if (existing) {
        // Update the uinv_item's stock balance in the F&B store
        const fbStoreId = outlet === 'bar' ? FB_BEV_STORE_ID : FB_FOOD_STORE_ID;
        const currentQty = Number(item.current_quantity || item.quantity || 0);

        const { data: balance } = await client.from('uinv_stock_balances')
          .select('id, on_hand').eq('item_id', existing.id).eq('store_id', fbStoreId).maybeSingle();

        if (balance) {
          const { error: ue } = await client.from('uinv_stock_balances').update({
            on_hand: currentQty,
            last_movement_date: new Date().toISOString(),
          }).eq('id', balance.id);
          if (ue) { results.errors.push({ outlet, item: itemName, error: ue.message }); }
          else { results.updated++; }
        } else {
          const { error: ie } = await client.from('uinv_stock_balances').insert({
            id: `UINV-SB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            property_id: property_id || null,
            item_id: existing.id,
            store_id: fbStoreId,
            on_hand: currentQty,
            reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
            damaged: 0, quarantined: 0, expired: 0,
            status: 'Available',
            unit_cost: Number(item.unit_cost || 0),
            last_movement_date: new Date().toISOString(),
          });
          if (ie) { results.errors.push({ outlet, item: itemName, error: ie.message }); }
          else { results.created++; }
        }
      } else {
        // Create a new uinv_item from the outlet item
        const newItemId = `UINV-IT-FB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { data: created, error: ce } = await client.from('uinv_items').insert({
          id: newItemId,
          property_id: property_id || null,
          item_code: itemCode,
          item_name: itemName,
          category: outlet === 'bar' ? 'Beverage' : 'Food',
          item_type: 'Consumable',
          unit_of_measure: item.unit || 'PCS',
          status: 'Active',
          default_store_id: outlet === 'bar' ? FB_BEV_STORE_ID : FB_FOOD_STORE_ID,
        }).select().single();

        if (ce) { results.errors.push({ outlet, item: itemName, error: ce.message }); results.skipped++; continue; }

        // Create stock balance
        const fbStoreId = outlet === 'bar' ? FB_BEV_STORE_ID : FB_FOOD_STORE_ID;
        const { error: se } = await client.from('uinv_stock_balances').insert({
          id: `UINV-SB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          property_id: property_id || null,
          item_id: newItemId,
          store_id: fbStoreId,
          on_hand: Number(item.current_quantity || item.quantity || 0),
          reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
          damaged: 0, quarantined: 0, expired: 0,
          status: 'Available',
          unit_cost: Number(item.unit_cost || 0),
          last_movement_date: new Date().toISOString(),
        });
        if (se) { results.errors.push({ outlet, item: itemName, error: se.message }); }
        else { results.created++; }

        await appendAudit(client, {
          property_id: property_id ?? null,
          department: 'Food & Beverage',
          user_id: user?.id,
          user_name: user?.name || 'system',
          transaction_type: 'F&B Reconciliation',
          entity_type: 'Item',
          entity_id: newItemId,
          item_or_asset: itemName,
          reason: `Created from ${outlet} inventory reconciliation`,
        });
      }
    }
  }

  return res.json({ success: true, ...results });
});

// ----------------------------------------------------------------
// EXECUTIVE BI INTEGRATION (spec �68)
// Publishes inventory KPIs for the Executive BI dashboard.
// ----------------------------------------------------------------
router.get('/bi/metrics', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId } = req.query as Record<string, string>;

  const metrics: any = {};

  // Total inventory value
  let valQ = client.from('uinv_stock_balances').select('on_hand, unit_cost');
  if (propertyId) valQ = valQ.eq('property_id', propertyId);
  const { data: stock } = await valQ;
  const totalValue = (stock || []).reduce((s: number, r: any) => s + (Number(r.on_hand) * Number(r.unit_cost || 0)), 0);
  metrics.total_inventory_value = totalValue;
  metrics.total_items_in_stock = (stock || []).length;

  // Low stock count
  const lowStockItems = (stock || []).filter((r: any) => Number(r.on_hand) <= 10);
  metrics.low_stock_count = lowStockItems.length;

  // Stock accuracy (from counts)
  let countQ = client.from('uinv_counts').select('id, status, variance_value');
  if (propertyId) countQ = countQ.eq('property_id', propertyId);
  const { data: counts } = await countQ;
  const completedCounts = (counts || []).filter((c: any) => c.status === 'Completed');
  metrics.stock_accuracy = completedCounts.length > 0
    ? completedCounts.filter((c: any) => Math.abs(Number(c.variance_value || 0)) < 1).length / completedCounts.length
    : null;

  // Waste value
  let wasteQ = client.from('uinv_waste').select('total_cost, status');
  if (propertyId) wasteQ = wasteQ.eq('property_id', propertyId);
  const { data: waste } = await wasteQ;
  metrics.waste_value = (waste || []).reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);

  // Asset metrics
  let assetQ = client.from('uinv_assets').select('id, status, acquisition_cost');
  if (propertyId) assetQ = assetQ.eq('property_id', propertyId);
  const { data: assets } = await assetQ;
  metrics.total_assets = (assets || []).length;
  metrics.asset_value = (assets || []).reduce((s: number, r: any) => s + Number(r.acquisition_cost || 0), 0);
  metrics.missing_assets = (assets || []).filter((a: any) => a.status === 'Lost' || a.status === 'Stolen').length;
  metrics.damaged_assets = (assets || []).filter((a: any) => a.status === 'Damaged').length;

  // Pending requisitions
  let reqQ = client.from('uinv_issues').select('id, approval_status, department');
  if (propertyId) reqQ = reqQ.eq('property_id', propertyId);
  const { data: reqs } = await reqQ;
  metrics.pending_requisitions = (reqs || []).filter((r: any) => r.approval_status === 'Pending').length;
  metrics.total_requisitions = (reqs || []).length;

  // Department consumption (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let ledgerQ = client.from('uinv_stock_ledger').select('quantity_out, value, transaction_date')
    .eq('transaction_type', 'Consumption')
    .gte('transaction_date', thirtyDaysAgo);
  if (propertyId) ledgerQ = ledgerQ.eq('property_id', propertyId);
  const { data: consumption } = await ledgerQ;
  metrics.consumption_value_30d = (consumption || []).reduce((s: number, r: any) => s + Number(r.value || 0), 0);

  // ── Spec §68-§71 KPIs (previously missing): turnover, days on hand,
  //    stockout rate, verification coverage ──
  const consumptionValue = metrics.consumption_value_30d || 0;
  const avgInventoryValue = totalValue; // current snapshot as the average proxy
  // Annualized turnover = (30d consumption × 12) / average inventory value
  metrics.inventory_turnover_annualized = avgInventoryValue > 0
    ? Number(((consumptionValue * 12) / avgInventoryValue).toFixed(2))
    : null;
  // Days on hand = 365 / turnover (or avg inventory / daily consumption)
  metrics.days_on_hand = consumptionValue > 0
    ? Number((avgInventoryValue / (consumptionValue / 30)).toFixed(1))
    : null;

  // Stockout rate: share of items with stock rows that are at/below zero
  // on_hand (per spec, items with no balance row at all are excluded).
  const stockRows = (stock || []);
  metrics.stockout_items = stockRows.filter((r: any) => Number(r.on_hand) <= 0).length;
  metrics.stockout_rate = stockRows.length > 0
    ? Number((metrics.stockout_items / stockRows.length).toFixed(4))
    : null;

  // Asset verification coverage (share of active assets with a Found
  // result in the latest verification campaign round)
  let verQ = client.from('uinv_asset_verifications').select('asset_id, result');
  if (propertyId) verQ = verQ.eq('property_id', propertyId);
  const { data: verifications } = await verQ;
  const activeAssets = (assets || []).filter((a: any) => a.is_active !== false);
  const verifiedAssetIds = new Set((verifications || []).map((v: any) => v.asset_id));
  metrics.asset_verification_coverage = activeAssets.length > 0
    ? Number((activeAssets.filter((a: any) => verifiedAssetIds.has(a.id)).length / activeAssets.length).toFixed(4))
    : null;

  return res.json(metrics);
});

// ----------------------------------------------------------------
// GAP 1: REPLENISHMENT PULLS (Dual-ledger: Central = separate stock)
// When dept stock drops below effective par, auto-generate a pull
// request from the central warehouse (no double-counting).
// ----------------------------------------------------------------

// List replenishment pulls
router.get('/replenishment-pulls', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, deptStoreId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_replenishment_pulls')
    .select('*, dept_store:uinv_stores!dept_store_id(id,store_name), source_store:uinv_stores!source_store_id(id,store_name), item:uinv_items(id,item_name,unit_of_measure)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (deptStoreId) q = q.eq('dept_store_id', deptStoreId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// Auto-generate replenishment pulls for a department store
router.post('/replenishment-pulls/generate', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { deptStoreId, propertyId } = req.body;
  if (!deptStoreId) return res.status(400).json({ error: 'deptStoreId is required' });
  const { data, error } = await client.rpc('generate_replenishment_pulls_for_dept', {
    p_dept_store_id: deptStoreId,
    p_property_id: propertyId || null,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ generated: data || [], count: (data || []).length });
});

// Approve a replenishment pull
router.patch('/replenishment-pulls/:id/approve', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_replenishment_pulls')
    .update({ status: 'Approved', approved_by: performedBy, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('status', 'Pending').select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'Pull is not in Pending status' });
  return res.json(data);
});

// Reject a replenishment pull
router.patch('/replenishment-pulls/:id/reject', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { rejectionReason } = req.body;
  const { data, error } = await client.from('uinv_replenishment_pulls')
    .update({ status: 'Rejected', rejected_by: performedBy, rejected_at: new Date().toISOString(), rejection_reason: rejectionReason || null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Convert an approved pull into a transfer (dispatch from central)
router.post('/replenishment-pulls/:id/convert-to-transfer', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';

  const { data: pull, error: pullErr } = await client.from('uinv_replenishment_pulls')
    .select('*').eq('id', req.params.id).single();
  if (pullErr || !pull) return res.status(404).json({ error: 'Pull not found' });
  if (pull.status !== 'Approved') return res.status(409).json({ error: 'Pull must be Approved to convert' });

  // Create the transfer
  const transferNumber = `TRF-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const { data: transfer, error: transferErr } = await client.from('uinv_transfers').insert({
    transfer_number: transferNumber,
    property_id: pull.property_id,
    from_store_id: pull.source_store_id,
    to_store_id: pull.dept_store_id,
    lines: [{ itemId: pull.item_id, quantity: pull.quantity_requested, unitCost: 0 }],
    status: 'Pending',
    priority: 'Normal',
    reason: `Replenishment pull ${pull.pull_number}`,
    created_by: performedBy,
  }).select().single();
  if (transferErr) return res.status(500).json({ error: transferErr.message });

  // Link the pull to the transfer
  const { data: updated, error: updErr } = await client.from('uinv_replenishment_pulls')
    .update({ status: 'Converted to Transfer', transfer_id: transfer.id, updated_at: new Date().toISOString() })
    .eq('id', pull.id).select().single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  await appendAudit(client, {
    transaction_type: 'Replenishment Pull Converted',
    entity_type: 'uinv_replenishment_pulls',
    entity_id: pull.id,
    item_or_asset: pull.item_id,
    quantity: pull.quantity_requested,
    reason: `Converted to transfer ${transferNumber}`,
    related_document: transferNumber,
    performed_by: performedBy,
  });

  return res.json({ pull: updated, transfer });
});

// Delete a replenishment pull
router.delete('/replenishment-pulls/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_replenishment_pulls').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// GAP 2: MANUAL PAR OVERRIDES (three-tier par: manual > dynamic > standard)
// ----------------------------------------------------------------

// List manual par overrides
router.get('/manual-par-overrides', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, storeId, itemId, activeOnly } = req.query as Record<string, string>;
  let q = client.from('uinv_manual_par_overrides')
    .select('*, store:uinv_stores!store_id(id,store_name), item:uinv_items(id,item_name)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (storeId) q = q.eq('store_id', storeId);
  if (itemId) q = q.eq('item_id', itemId);
  if (activeOnly === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// Create a manual par override
router.post('/manual-par-overrides', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_manual_par_overrides').insert({
    property_id: body.propertyId || null,
    store_id: body.storeId || null,
    item_id: body.itemId,
    manual_par_level: body.manualParLevel,
    manual_replenish_min: body.manualReplenishMin,
    manual_replenish_max: body.manualReplenishMax,
    reason: body.reason || null,
    effective_from: body.effectiveFrom || new Date().toISOString(),
    effective_until: body.effectiveUntil || null,
    is_active: body.isActive !== false,
    created_by: performedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// Update a manual par override
router.patch('/manual-par-overrides/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_manual_par_overrides')
    .update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Deactivate (revert) a manual par override
router.patch('/manual-par-overrides/:id/deactivate', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_manual_par_overrides')
    .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Delete a manual par override
router.delete('/manual-par-overrides/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_manual_par_overrides').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Resolve the effective par for an item+store (three-tier)
router.get('/effective-par', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { itemId, storeId } = req.query as Record<string, string>;
  if (!itemId || !storeId) return res.status(400).json({ error: 'itemId and storeId are required' });
  const { data, error } = await client.rpc('effective_par_level', {
    p_item_id: itemId,
    p_store_id: storeId,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || null);
});

// ----------------------------------------------------------------
// GAP 3: PROCUREMENT AUTO-TRIGGER (low central stock ? purchase req)
// ----------------------------------------------------------------

// Preview low-stock items at central warehouse
router.get('/procurement-trigger/preview', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = client.from('uinv_stock_balances')
    .select('id, on_hand, item_id, property_id, item:uinv_items(id, item_name, item_code, category, unit_of_measure, reorder_point, min_stock, max_stock, last_cost, is_active)')
    .eq('store_id', MAIN_STORE_ID);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Filter to items at/below reorder point
  const lowStock = (data || []).filter((r: any) => {
    const item = r.item;
    if (!item || !item.is_active) return false;
    const threshold = item.reorder_point || item.min_stock || 0;
    return Number(r.on_hand) <= Number(threshold) && threshold > 0;
  }).map((r: any) => ({
    balanceId: r.id,
    itemId: r.item_id,
    itemName: r.item?.item_name,
    itemCode: r.item?.item_code,
    category: r.item?.category,
    onHand: Number(r.on_hand),
    reorderPoint: Number(r.item?.reorder_point || 0),
    maxStock: Number(r.item?.max_stock || 0),
    lastCost: Number(r.item?.last_cost || 0),
    suggestedOrderQty: Math.max(0, Number(r.item?.max_stock || 0) - Number(r.on_hand)) || Number(r.item?.reorder_point || 0),
    estimatedValue: Math.max(0, Number(r.item?.max_stock || 0) - Number(r.on_hand)) * Number(r.item?.last_cost || 0),
  }));

  return res.json({ lowStockItems: lowStock, count: lowStock.length });
});

// Auto-generate procurement requisitions from low central stock
router.post('/procurement-trigger/generate', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId } = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.rpc('generate_procurement_requisition_from_low_stock', {
    p_property_id: propertyId || null,
    p_created_by: performedBy,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ generated: data || [], count: (data || []).length });
});

// Generate a SINGLE draft procurement requisition with all low-stock items as lines
// The draft is editable in the Inventory portal before being submitted to Procurement.
router.post('/procurement-trigger/generate-draft', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { propertyId } = req.body;
    const performedBy = req.user?.name || req.user?.id || 'system';

    // 1. Scan Main Warehouse for low-stock items (same logic as preview)
    let balQ = client.from('uinv_stock_balances')
      .select('id, on_hand, item_id, property_id, item:uinv_items(id, item_name, item_code, category, unit_of_measure, reorder_point, min_stock, max_stock, last_cost, is_active)')
      .eq('store_id', MAIN_STORE_ID);
    if (propertyId) balQ = balQ.eq('property_id', propertyId);
    const { data: balances, error: balErr } = await balQ;
    if (balErr) return res.status(500).json({ error: balErr.message });

    const lowStock = (balances || []).filter((r: any) => {
      const item = r.item;
      if (!item || !item.is_active) return false;
      const threshold = Number(item.reorder_point) || Number(item.min_stock) || 0;
      return threshold > 0 && Number(r.on_hand) <= threshold;
    });

    if (lowStock.length === 0) {
      return res.json({ requisition: null, message: 'No low-stock items found at Main Warehouse.' });
    }

    // 2. Check if there's already an open draft from inventory (avoid duplicates)
    const { data: existingDraft } = await client.from('proc_requisitions')
      .select('id, pr_number')
      .eq('source_system', 'inventory')
      .eq('status', 'Draft')
      .order('created_at', { ascending: false })
      .limit(1);
    if (existingDraft && existingDraft.length > 0) {
      // Return the existing draft � user can edit and submit it
      const draftId = existingDraft[0].id;
      const { data: draftLines } = await client.from('proc_requisition_lines')
        .select('*')
        .eq('requisition_id', draftId)
        .order('line_number', { ascending: true });
      return res.json({
        requisition: { id: draftId, pr_number: existingDraft[0].pr_number, status: 'Draft' },
        lines: draftLines || [],
        message: 'An open draft requisition already exists. You can edit and submit it.',
      });
    }

    // 3. Generate PR number: PR-YYYY-NNNNNN
    const year = new Date().getFullYear();
    const { data: existing } = await client.from('proc_requisitions')
      .select('pr_number')
      .like('pr_number', `PR-${year}-%`)
      .order('pr_number', { ascending: false })
      .limit(1);
    let seq = 1;
    if (existing && existing.length > 0) {
      const match = (existing[0].pr_number || '').match(/PR-\d{4}-(\d+)/);
      if (match) seq = parseInt(match[1], 10) + 1;
    }
    const prNumber = `PR-${year}-${String(seq).padStart(6, '0')}`;
    const reqId = crypto.randomUUID();
    const requiredDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    // 4. Calculate totals
    let estimatedTotal = 0;
    const lineRows = lowStock.map((r: any, idx: number) => {
      const item = r.item;
      const onHand = Number(r.on_hand);
      const maxStock = Number(item.max_stock) || 0;
      const reorderPoint = Number(item.reorder_point) || 0;
      const orderQty = maxStock > 0 ? Math.max(0, maxStock - onHand) : reorderPoint;
      const unitCost = Number(item.last_cost) || 0;
      const lineTotal = Number((orderQty * unitCost).toFixed(2));
      estimatedTotal += lineTotal;
      return {
        id: crypto.randomUUID(),
        requisition_id: reqId,
        line_number: idx + 1,
        item_code: item.item_code,
        item_name: item.item_name,
        category: item.category,
        quantity: orderQty,
        unit_of_measure: item.unit_of_measure || 'pcs',
        estimated_unit_price: unitCost,
        estimated_total: lineTotal,
        required_date: requiredDate,
      };
    });

    // 5. Insert requisition header (Draft status)
    const { error: reqErr } = await client.from('proc_requisitions').insert({
      id: reqId,
      pr_number: prNumber,
      property_id: propertyId || lowStock[0].property_id || null,
      department: 'Inventory',
      requester: performedBy,
      required_date: requiredDate,
      priority: 'High',
      purpose: 'Auto-generated from central warehouse low-stock scan',
      notes: `Draft requisition with ${lineRows.length} items. Edit and submit to Procurement.`,
      status: 'Draft',
      estimated_total: Number(estimatedTotal.toFixed(2)),
      source_system: 'inventory',
      source_ref: 'UINV-ST-MAIN low-stock scan',
      created_by: performedBy,
    });
    if (reqErr) return res.status(500).json({ error: reqErr.message });

    // 6. Insert all lines
    const { error: lineErr } = await client.from('proc_requisition_lines').insert(lineRows);
    if (lineErr) return res.status(500).json({ error: lineErr.message });

    return res.status(201).json({
      requisition: { id: reqId, pr_number: prNumber, status: 'Draft', estimated_total: estimatedTotal },
      lines: lineRows,
      count: lineRows.length,
      message: `Draft requisition ${prNumber} created with ${lineRows.length} items. Review and submit to Procurement.`,
    });
  } catch (e: any) {
    console.error('[uinv] generate-draft error:', e?.message);
    return res.status(500).json({ error: e?.message || 'Failed to generate draft requisition' });
  }
});

// Get a draft procurement requisition with its lines (for editing)
router.get('/procurement-trigger/draft/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data: reqRow, error: reqErr } = await client.from('proc_requisitions')
    .select('*').eq('id', req.params.id).single();
  if (reqErr) return res.status(404).json({ error: 'Requisition not found' });
  const { data: lines, error: lineErr } = await client.from('proc_requisition_lines')
    .select('*').eq('requisition_id', req.params.id).order('line_number', { ascending: true });
  if (lineErr) return res.status(500).json({ error: lineErr.message });
  return res.json({ requisition: reqRow, lines: lines || [] });
});

// Update a draft requisition's lines (edit quantities, add/remove items)
router.put('/procurement-trigger/draft/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { lines, notes, priority } = req.body as {
      lines?: Array<{ id?: string; item_code?: string; item_name: string; category?: string; quantity: number; unit_of_measure?: string; estimated_unit_price: number; required_date?: string }>;
      notes?: string;
      priority?: string;
    };

    // Verify it's still a draft
    const { data: reqRow, error: reqErr } = await client.from('proc_requisitions')
      .select('id, status, pr_number').eq('id', req.params.id).single();
    if (reqErr) return res.status(404).json({ error: 'Requisition not found' });
    if (reqRow.status !== 'Draft') {
      return res.status(400).json({ error: `Cannot edit requisition with status "${reqRow.status}". Only Draft requisitions can be edited.` });
    }

    // Update header fields
    const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
    if (notes !== undefined) updateFields.notes = notes;
    if (priority !== undefined) updateFields.priority = priority;

    // Recalculate estimated total from lines
    let estimatedTotal = 0;
    if (lines) {
      estimatedTotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.estimated_unit_price) || 0), 0);
      updateFields.estimated_total = Number(estimatedTotal.toFixed(2));
    }

    await client.from('proc_requisitions').update(updateFields).eq('id', req.params.id);

    // If lines provided, replace all lines
    if (lines) {
      // Delete existing lines
      await client.from('proc_requisition_lines').delete().eq('requisition_id', req.params.id);
      // Insert new lines
      const lineRows = lines.map((l, idx) => ({
        id: crypto.randomUUID(),
        requisition_id: req.params.id,
        line_number: idx + 1,
        item_code: l.item_code || null,
        item_name: l.item_name,
        category: l.category || null,
        quantity: Number(l.quantity) || 0,
        unit_of_measure: l.unit_of_measure || 'pcs',
        estimated_unit_price: Number(l.estimated_unit_price) || 0,
        estimated_total: Number(((Number(l.quantity) || 0) * (Number(l.estimated_unit_price) || 0)).toFixed(2)),
        required_date: l.required_date || null,
      }));
      if (lineRows.length > 0) {
        const { error: lineErr } = await client.from('proc_requisition_lines').insert(lineRows);
        if (lineErr) return res.status(500).json({ error: lineErr.message });
      }
    }

    return res.json({ success: true, estimated_total: estimatedTotal });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to update draft' });
  }
});

// Submit a draft requisition (change status from Draft ? Submitted)
router.post('/procurement-trigger/draft/:id/submit', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  try {
    const { data: reqRow, error: reqErr } = await client.from('proc_requisitions')
      .select('id, status, pr_number').eq('id', req.params.id).single();
    if (reqErr) return res.status(404).json({ error: 'Requisition not found' });
    if (reqRow.status !== 'Draft') {
      return res.status(400).json({ error: `Cannot submit requisition with status "${reqRow.status}".` });
    }

    const { error: updErr } = await client.from('proc_requisitions').update({
      status: 'Submitted',
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ success: true, pr_number: reqRow.pr_number, message: `Requisition ${reqRow.pr_number} submitted to Procurement.` });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to submit draft' });
  }
});

// ----------------------------------------------------------------
// GAP 4: FINANCE JOURNAL AUTO-POSTING
// ----------------------------------------------------------------

// List journal posting log entries
router.get('/journal-posting-log', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { sourceEntity, postingType } = req.query as Record<string, string>;
  let q = client.from('uinv_journal_posting_log')
    .select('*, journal:journal_entries(id,date,period,description,status,total_debit,total_credit)')
    .order('created_at', { ascending: false });
  if (sourceEntity) q = q.eq('source_entity', sourceEntity);
  if (postingType) q = q.eq('posting_type', postingType);
  const { data, error } = await q.limit(200);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// Manually trigger a journal posting for an inventory movement
router.post('/journal-posting/post', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { sourceEntity, sourceId, postingType, amount, description, department, propertyId, reference } = req.body;
  if (!sourceEntity || !sourceId || !postingType || amount === undefined) {
    return res.status(400).json({ error: 'sourceEntity, sourceId, postingType, and amount are required' });
  }
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data: journalId, error } = await client.rpc('post_inventory_journal', {
    p_source_entity: sourceEntity,
    p_source_id: sourceId,
    p_posting_type: postingType,
    p_amount: amount,
    p_description: description || 'Manual inventory journal posting',
    p_department: department || null,
    p_property_id: propertyId || null,
    p_reference: reference || null,
    p_created_by: performedBy,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!journalId) return res.json({ success: true, journalId: null, message: 'Already posted (duplicate prevented)' });
  return res.status(201).json({ success: true, journalId });
});

// Batch-post journals for all unposted waste records
router.post('/journal-posting/batch-waste', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId } = req.body;

  // Find waste records that haven't been posted yet
  let wasteQ = client.from('uinv_waste').select('id, item_id, store_id, quantity, unit_cost, value, reason, property_id');
  if (propertyId) wasteQ = wasteQ.eq('property_id', propertyId);
  const { data: wasteRecords, error: wasteErr } = await wasteQ;
  if (wasteErr) return res.status(500).json({ error: wasteErr.message });

  // Find which ones already have postings
  const wasteIds = (wasteRecords || []).map((w: any) => w.id);
  const { data: alreadyPosted } = await client.from('uinv_journal_posting_log')
    .select('source_id').eq('source_entity', 'uinv_waste').in('source_id', wasteIds.length > 0 ? wasteIds : ['__none__']);
  const postedSet = new Set((alreadyPosted || []).map((p: any) => p.source_id));

  // Resolve store department for each waste record
  const storeIds = [...new Set((wasteRecords || []).map((w: any) => w.store_id).filter(Boolean))] as string[];
  const { data: stores } = await client.from('uinv_stores').select('id, department').in('id', storeIds.length > 0 ? storeIds : ['__none__']);
  const storeDeptMap = new Map((stores || []).map((s: any) => [s.id, s.department]));

  let posted = 0;
  const errors: any[] = [];

  for (const waste of (wasteRecords || [])) {
    if (postedSet.has(waste.id)) continue;
    const amount = Number(waste.value || (Number(waste.quantity) * Number(waste.unit_cost)));
    if (amount <= 0) continue;
    const department = storeDeptMap.get(waste.store_id) || 'General';
    const { error: postErr } = await client.rpc('post_inventory_journal', {
      p_source_entity: 'uinv_waste',
      p_source_id: waste.id,
      p_posting_type: 'Shrinkage',
      p_amount: amount,
      p_description: `Waste: ${waste.reason || 'N/A'}`,
      p_department: department,
      p_property_id: waste.property_id || null,
      p_reference: waste.id,
      p_created_by: 'system',
    });
    if (postErr) {
      errors.push({ wasteId: waste.id, error: postErr.message });
    } else {
      posted += 1;
    }
  }

  return res.json({ posted, skipped: postedSet.size, errors, totalWasteRecords: (wasteRecords || []).length });
});

// ----------------------------------------------------------------
// GAP 5: INTER-DEPARTMENTAL STOCK BORROWING
// Temporary loans between departments with approval + return workflow.
// ----------------------------------------------------------------

// List borrows
router.get('/dept-borrows', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { propertyId, borrowingStoreId, lendingStoreId, status } = req.query as Record<string, string>;
  let q = client.from('uinv_dept_borrows')
    .select('*, borrowing_store:uinv_stores!borrowing_store_id(id,store_name,department), lending_store:uinv_stores!lending_store_id(id,store_name,department), item:uinv_items(id,item_name,unit_of_measure)')
    .order('created_at', { ascending: false });
  if (propertyId) q = q.eq('property_id', propertyId);
  if (borrowingStoreId) q = q.eq('borrowing_store_id', borrowingStoreId);
  if (lendingStoreId) q = q.eq('lending_store_id', lendingStoreId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// Create a borrow request
router.post('/dept-borrows', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const body = req.body;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const borrowNumber = `BRW-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const { data, error } = await client.from('uinv_dept_borrows').insert({
    property_id: body.propertyId || null,
    borrow_number: borrowNumber,
    borrowing_store_id: body.borrowingStoreId,
    lending_store_id: body.lendingStoreId,
    item_id: body.itemId,
    quantity_borrowed: body.quantityBorrowed,
    expected_return_date: body.expectedReturnDate,
    purpose: body.purpose || null,
    requested_by: performedBy,
    status: 'Requested',
    notes: body.notes || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// Approve a borrow request
router.patch('/dept-borrows/:id/approve', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data, error } = await client.from('uinv_dept_borrows')
    .update({ status: 'Approved', approved_by: performedBy, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('status', 'Requested').select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'Borrow is not in Requested status' });
  return res.json(data);
});

// Reject a borrow request
router.patch('/dept-borrows/:id/reject', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { rejectionReason } = req.body;
  const { data, error } = await client.from('uinv_dept_borrows')
    .update({ status: 'Rejected', rejected_by: performedBy, rejected_at: new Date().toISOString(), rejection_reason: rejectionReason || null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Dispatch an approved borrow (create outbound transfer from lending store)
router.post('/dept-borrows/:id/dispatch', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';

  const { data: borrow, error: borrowErr } = await client.from('uinv_dept_borrows')
    .select('*').eq('id', req.params.id).single();
  if (borrowErr || !borrow) return res.status(404).json({ error: 'Borrow not found' });
  if (borrow.status !== 'Approved') return res.status(409).json({ error: 'Borrow must be Approved to dispatch' });

  // Create outbound transfer
  const transferNumber = `TRF-BRW-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const { data: transfer, error: transferErr } = await client.from('uinv_transfers').insert({
    transfer_number: transferNumber,
    property_id: borrow.property_id,
    from_store_id: borrow.lending_store_id,
    to_store_id: borrow.borrowing_store_id,
    lines: [{ itemId: borrow.item_id, quantity: borrow.quantity_borrowed, unitCost: 0 }],
    status: 'Dispatched',
    priority: 'Normal',
    reason: `Borrow dispatch ${borrow.borrow_number}`,
    created_by: performedBy,
    dispatched_by: performedBy,
    dispatched_at: new Date().toISOString(),
  }).select().single();
  if (transferErr) return res.status(500).json({ error: transferErr.message });

  // Deduct from lending store
  const bal = await recomputeBalance(client, borrow.item_id, borrow.lending_store_id, null);
  if (bal) {
    const newOnHand = Math.max(0, Number(bal.on_hand) - Number(borrow.quantity_borrowed));
    await client.from('uinv_stock_balances').update({
      on_hand: newOnHand, last_movement_date: new Date().toISOString(),
    }).eq('id', bal.id);
    await appendLedger(client, {
      property_id: borrow.property_id,
      item_id: borrow.item_id,
      store_id: borrow.lending_store_id,
      transaction_type: 'Borrow Dispatch',
      reference: borrow.borrow_number,
      quantity_out: Number(borrow.quantity_borrowed),
      balance: newOnHand,
      performed_by: performedBy,
      reason: `Borrowed by ${borrow.borrowing_store_id}`,
    });
  }

  const { data: updated, error: updErr } = await client.from('uinv_dept_borrows')
    .update({ status: 'Dispatched', dispatched_by: performedBy, dispatched_at: new Date().toISOString(), outbound_transfer_id: transfer.id, updated_at: new Date().toISOString() })
    .eq('id', borrow.id).select().single();
  if (updErr) return res.status(500).json({ error: updErr.message });
  return res.json({ borrow: updated, transfer });
});

// Mark a dispatched borrow as received by the borrowing store
router.patch('/dept-borrows/:id/receive', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { data: borrow, error: borrowErr } = await client.from('uinv_dept_borrows')
    .select('*').eq('id', req.params.id).single();
  if (borrowErr || !borrow) return res.status(404).json({ error: 'Borrow not found' });
  if (borrow.status !== 'Dispatched') return res.status(409).json({ error: 'Borrow must be Dispatched to receive' });

  // Add to borrowing store
  const bal = await recomputeBalance(client, borrow.item_id, borrow.borrowing_store_id, null);
  if (bal) {
    const newOnHand = Number(bal.on_hand) + Number(borrow.quantity_borrowed);
    await client.from('uinv_stock_balances').update({
      on_hand: newOnHand, last_movement_date: new Date().toISOString(),
    }).eq('id', bal.id);
  } else {
    await client.from('uinv_stock_balances').insert({
      id: `UINV-SB-BRW-${Date.now()}`, property_id: borrow.property_id,
      item_id: borrow.item_id, store_id: borrow.borrowing_store_id,
      on_hand: Number(borrow.quantity_borrowed), status: 'Available',
    });
  }
  await appendLedger(client, {
    property_id: borrow.property_id,
    item_id: borrow.item_id,
    store_id: borrow.borrowing_store_id,
    transaction_type: 'Borrow Receipt',
    reference: borrow.borrow_number,
    quantity_in: Number(borrow.quantity_borrowed),
    balance: Number(borrow.quantity_borrowed),
    performed_by: performedBy,
    reason: `Borrowed from ${borrow.lending_store_id}`,
  });

  const { data, error } = await client.from('uinv_dept_borrows')
    .update({ status: 'Received', received_by: performedBy, received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Return a borrowed item (full or partial)
router.post('/dept-borrows/:id/return', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const performedBy = req.user?.name || req.user?.id || 'system';
  const { quantityReturned } = req.body;
  const { data: borrow, error: borrowErr } = await client.from('uinv_dept_borrows')
    .select('*').eq('id', req.params.id).single();
  if (borrowErr || !borrow) return res.status(404).json({ error: 'Borrow not found' });
  if (!['Received', 'Partially Returned', 'Overdue'].includes(borrow.status)) {
    return res.status(409).json({ error: 'Borrow must be Received/Partially Returned/Overdue to return' });
  }

  const qtyToReturn = Number(quantityReturned || borrow.quantity_borrowed);
  const newQtyReturned = Number(borrow.quantity_returned) + qtyToReturn;
  const isFullReturn = newQtyReturned >= Number(borrow.quantity_borrowed);

  // Deduct from borrowing store
  const borrowBal = await recomputeBalance(client, borrow.item_id, borrow.borrowing_store_id, null);
  if (borrowBal) {
    const newOnHand = Math.max(0, Number(borrowBal.on_hand) - qtyToReturn);
    await client.from('uinv_stock_balances').update({
      on_hand: newOnHand, last_movement_date: new Date().toISOString(),
    }).eq('id', borrowBal.id);
    await appendLedger(client, {
      property_id: borrow.property_id, item_id: borrow.item_id,
      store_id: borrow.borrowing_store_id,
      transaction_type: 'Borrow Return',
      reference: borrow.borrow_number,
      quantity_out: qtyToReturn, balance: newOnHand,
      performed_by: performedBy, reason: `Returning to ${borrow.lending_store_id}`,
    });
  }

  // Add back to lending store
  const lendBal = await recomputeBalance(client, borrow.item_id, borrow.lending_store_id, null);
  if (lendBal) {
    const newOnHand = Number(lendBal.on_hand) + qtyToReturn;
    await client.from('uinv_stock_balances').update({
      on_hand: newOnHand, last_movement_date: new Date().toISOString(),
    }).eq('id', lendBal.id);
  }
  await appendLedger(client, {
    property_id: borrow.property_id, item_id: borrow.item_id,
    store_id: borrow.lending_store_id,
    transaction_type: 'Borrow Return Receipt',
    reference: borrow.borrow_number,
    quantity_in: qtyToReturn,
    balance: lendBal ? Number(lendBal.on_hand) + qtyToReturn : qtyToReturn,
    performed_by: performedBy, reason: `Returned from ${borrow.borrowing_store_id}`,
  });

  const update: any = {
    quantity_returned: newQtyReturned,
    updated_at: new Date().toISOString(),
  };
  if (isFullReturn) {
    update.status = 'Returned';
    update.returned_by = performedBy;
    update.returned_at = new Date().toISOString();
    update.actual_return_date = new Date().toISOString().slice(0, 10);
  } else {
    update.status = 'Partially Returned';
  }

  const { data, error } = await client.from('uinv_dept_borrows')
    .update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Cancel a borrow
router.patch('/dept-borrows/:id/cancel', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { data, error } = await client.from('uinv_dept_borrows')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id).in('status', ['Requested', 'Approved']).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'Borrow cannot be cancelled in its current status' });
  return res.json(data);
});

// Delete a borrow
router.delete('/dept-borrows/:id', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  const { error } = await client.from('uinv_dept_borrows').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ----------------------------------------------------------------
// CENTRALIZED SUPPLY & PROCUREMENT
//
// Consolidates the department-siloed supply/procurement workflows
// (Engineering eng_purchase_orders, Housekeeping hk_purchase_orders,
// F&B fb_purchase_orders) into a single Inventory-portal view.
//
// The department PO tables remain the source of truth � these endpoints
// aggregate across them so the Inventory portal can see and act on all
// department requisitions, demand, and suppliers in one place.
//
// Endpoints:
//   GET  /supply-procurement/stats
//   GET  /supply-procurement/demand
//   GET  /supply-procurement/requisitions
//   POST /supply-procurement/requisitions
//   PUT  /supply-procurement/requisitions/:id/status
//   POST /supply-procurement/requisitions/:id/receive
//   GET  /supply-procurement/suppliers
// ----------------------------------------------------------------

/** Departments that own a dedicated purchase-order table. */
const SUPPLY_DEPARTMENTS = ['Engineering', 'Housekeeping', 'Food & Beverage'] as const;
type SupplyDepartment = typeof SUPPLY_DEPARTMENTS[number];

/** Map a department to its PO table + line table + primary store IDs. */
function deptPoTable(dept: SupplyDepartment): { poTable: string; lineTable: string; storeIds: string[]; poPrefix: string } {
  switch (dept) {
    case 'Engineering':
      return { poTable: 'eng_purchase_orders', lineTable: 'eng_purchase_order_lines', storeIds: [ENG_STORE_ID], poPrefix: 'ENG-PO' };
    case 'Housekeeping':
      return { poTable: 'hk_purchase_orders', lineTable: 'hk_purchase_order_lines', storeIds: [HK_STORE_ID, HK_LINEN_STORE_ID], poPrefix: 'HK-PO' };
    case 'Food & Beverage':
      return { poTable: 'fb_purchase_orders', lineTable: 'fb_purchase_order_lines', storeIds: [FB_FOOD_STORE_ID, FB_BEV_STORE_ID], poPrefix: 'FB-PO' };
  }
}

/** Map a PO status from any department table to the unified requisition status. */
function poStatusToRequisitionStatus(status: string): string {
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

/** Allowed forward transitions for department PO status. */
const PO_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['acknowledged', 'cancelled'],
  acknowledged: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

/** Earliest non-empty requiredBy date from requisition items. */
function earliestRequiredBy(items?: Array<{ requiredBy?: string }>): string | null {
  if (!items || items.length === 0) return null;
  const dates = items
    .map(it => it.requiredBy)
    .filter((d): d is string => !!d && !isNaN(new Date(d).getTime()))
    .map(d => new Date(d).getTime());
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates)).toISOString();
}

/**
 * GET /supply-procurement/stats
 * Aggregated KPIs across all department PO tables + shared suppliers.
 * Query: ?propertyId=
 */
router.get('/supply-procurement/stats', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { propertyId } = req.query as Record<string, string>;
    let openRequisitions = 0;
    let pendingApproval = 0;

    for (const dept of SUPPLY_DEPARTMENTS) {
      const { poTable } = deptPoTable(dept);
      let openQ = client.from(poTable).select('id', { count: 'exact', head: true }).in('status', ['draft', 'submitted']);
      if (propertyId) openQ = openQ.eq('property_id', propertyId);
      const { count: openCount } = await openQ;
      openRequisitions += openCount || 0;

      let pendingQ = client.from(poTable).select('id', { count: 'exact', head: true }).eq('status', 'submitted');
      if (propertyId) pendingQ = pendingQ.eq('property_id', propertyId);
      const { count: pendingCount } = await pendingQ;
      pendingApproval += pendingCount || 0;
    }

    const { count: activeSuppliers } = await client.from('fb_suppliers')
      .select('id', { count: 'exact', head: true }).eq('is_active', true);

    const { data: performance } = await client.from('fb_supplier_performance')
      .select('supplier_id, average_lead_time, period_start')
      .order('period_start', { ascending: false });
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
      openRequisitions,
      pendingApproval,
      activeSuppliers: activeSuppliers || 0,
      avgLeadTimeDays: Number(avgLeadTime.toFixed(1)),
      departmentCount: SUPPLY_DEPARTMENTS.length,
    });
  } catch (err) {
    console.error('supply-procurement/stats error:', err);
    return res.status(500).json({ error: 'Failed to load supply & procurement stats' });
  }
});

/**
 * GET /supply-procurement/demand
 * Cross-department replenishment demand � unified items at/below reorder
 * point across all department stores, enriched with on-hand stock.
 * Query: ?propertyId= ?department=
 */
router.get('/supply-procurement/demand', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { propertyId, department } = req.query as Record<string, string>;

    // Determine which departments to include.
    const depts: SupplyDepartment[] = department && (SUPPLY_DEPARTMENTS as readonly string[]).includes(department)
      ? [department as SupplyDepartment]
      : [...SUPPLY_DEPARTMENTS];

    // Department ? category filter on uinv_items.
    const deptCategory: Record<SupplyDepartment, string> = {
      Engineering: 'Engineering',
      Housekeeping: 'Housekeeping',
      'Food & Beverage': 'Food & Beverage',
    };

    const rows: any[] = [];

    for (const dept of depts) {
      const { storeIds } = deptPoTable(dept);
      let itemQ = client.from('uinv_items')
        .select('*')
        .eq('category', deptCategory[dept])
        .eq('is_active', true);
      if (propertyId) itemQ = itemQ.eq('property_id', propertyId);
      const { data: items, error } = await itemQ;
      if (error) { console.warn(`[supply-procurement/demand] ${dept} items error:`, error.message); continue; }

      const itemIds = (items || []).map((i: any) => i.id);
      let balanceMap = new Map<string, number>();
      if (itemIds.length > 0) {
        const { data: balances } = await client.from('uinv_stock_balances')
          .select('item_id, on_hand')
          .in('store_id', storeIds)
          .in('item_id', itemIds);
        for (const b of (balances || [])) {
          balanceMap.set(b.item_id, (balanceMap.get(b.item_id) || 0) + Number(b.on_hand));
        }
      }

      for (const i of (items || [])) {
        const cur = balanceMap.get(i.id) || 0;
        const reorder = Number(i.reorder_point) || Number(i.min_stock) || 0;
        if (cur > reorder) continue;
        const max = Number(i.max_stock) || 0;
        const reorderQty = (max > cur ? max - cur : 0) || (reorder * 2);
        rows.push({
          id: i.id,
          department: dept,
          item_name: i.item_name,
          item_code: i.item_code || '',
          category: i.subcategory || 'General',
          unit: i.unit_of_measure || 'pcs',
          current_stock: cur,
          reorder_point: reorder,
          shortage: Math.max(0, reorderQty),
          reorder_qty: reorderQty,
          unit_cost: Number(i.last_cost || 0),
          supplier: i.brand || '',
        });
      }
    }

    return res.json(rows);
  } catch (err) {
    console.error('supply-procurement/demand error:', err);
    return res.status(500).json({ error: 'Failed to load replenishment demand' });
  }
});

/**
 * GET /supply-procurement/requisitions
 * Aggregated requisitions across all department PO tables, mapped to a
 * unified PurchaseRequisition shape. Each row is tagged with its source
 * department so the Inventory portal can filter by department.
 * Query: ?status= ?propertyId= ?department=
 */
router.get('/supply-procurement/requisitions', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { status, propertyId, department } = req.query as Record<string, string>;

    const depts: SupplyDepartment[] = department && (SUPPLY_DEPARTMENTS as readonly string[]).includes(department)
      ? [department as SupplyDepartment]
      : [...SUPPLY_DEPARTMENTS];

    const { data: suppliers } = await client.from('fb_suppliers').select('id, name');
    const supplierName: Record<string, string> = {};
    (suppliers || []).forEach((s: any) => { supplierName[s.id] = s.name; });

    const allRows: any[] = [];

    for (const dept of depts) {
      const { poTable, lineTable } = deptPoTable(dept);
      let q = client.from(poTable).select('*').order('order_date', { ascending: false });
      if (status) q = q.eq('status', status);
      if (propertyId) q = q.eq('property_id', propertyId);
      const { data: pos, error } = await q;
      if (error) { console.warn(`[supply-procurement/requisitions] ${dept} POs error:`, error.message); continue; }

      const poIds = (pos || []).map((p: any) => p.id);
      let linesByPo: Record<string, any[]> = {};
      if (poIds.length > 0) {
        const { data: lines } = await client.from(lineTable).select('*').in('po_id', poIds);
        (lines || []).forEach((l: any) => {
          (linesByPo[l.po_id] = linesByPo[l.po_id] || []).push(l);
        });
      }

      for (const po of (pos || [])) {
        const lines = (linesByPo[po.id] || []).map((l: any) => {
          const qty = Number(l.quantity_ordered || 0);
          const unitCost = Number(l.unit_price || 0);
          return {
            id: l.id,
            item_name: l.description || 'Item',
            category: deptCategoryForLine(dept, l),
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
        allRows.push({
          id: po.id,
          source_department: dept,
          source_table: poTable,
          requisition_number: po.po_number,
          requested_by: po.submitted_by || dept,
          request_date: po.order_date ? String(po.order_date).slice(0, 10) : '',
          department: dept,
          priority: po.priority || 'medium',
          status: poStatusToRequisitionStatus(po.status) as any,
          po_status: po.status,
          items: lines,
          total_cost: Number(po.total_amount || totalCost),
          notes: po.notes || '',
          supplier_name: supplierName[po.supplier_id] || null,
          supplier_id: po.supplier_id || null,
        });
      }
    }

    // Also fetch inventory-sourced procurement requisitions (draft + submitted)
    let prQ = client.from('proc_requisitions')
      .select('*')
      .eq('source_system', 'inventory')
      .order('created_at', { ascending: false });
    if (status) prQ = prQ.eq('status', status);
    if (propertyId) prQ = prQ.eq('property_id', propertyId);
    const { data: invReqs, error: prErr } = await prQ;
    if (!prErr && invReqs) {
      const prIds = invReqs.map((r: any) => r.id);
      let prLines: Record<string, any[]> = {};
      if (prIds.length > 0) {
        const { data: prl } = await client.from('proc_requisition_lines')
          .select('*').in('requisition_id', prIds);
        (prl || []).forEach((l: any) => {
          (prLines[l.requisition_id] = prLines[l.requisition_id] || []).push(l);
        });
      }
      for (const pr of invReqs) {
        const lines = (prLines[pr.id] || []).map((l: any) => {
          const qty = Number(l.quantity || 0);
          const unitCost = Number(l.estimated_unit_price || 0);
          return {
            id: l.id,
            item_name: l.item_name || 'Item',
            category: l.category || 'General',
            requested_quantity: qty,
            unit: l.unit_of_measure || 'pcs',
            estimated_unit_cost: unitCost,
            estimated_total: Number(l.estimated_total || (qty * unitCost).toFixed(2)),
            required_by: l.required_date ? String(l.required_date).slice(0, 10) : (pr.required_date ? String(pr.required_date).slice(0, 10) : ''),
            reason: pr.purpose || 'Central low-stock replenishment',
          };
        });
        allRows.push({
          id: pr.id,
          source_department: 'Inventory',
          source_table: 'proc_requisitions',
          requisition_number: pr.pr_number,
          requested_by: pr.requester || 'Inventory System',
          request_date: pr.request_date ? String(pr.request_date).slice(0, 10) : '',
          department: 'Inventory',
          priority: (pr.priority || 'High').toLowerCase(),
          status: pr.status.toLowerCase(),
          po_status: pr.status.toLowerCase(),
          items: lines,
          total_cost: Number(pr.estimated_total || 0),
          notes: pr.notes || '',
          supplier_name: null,
          supplier_id: null,
        });
      }
    }

    // Sort by request_date desc across all departments.
    allRows.sort((a, b) => (b.request_date || '').localeCompare(a.request_date || ''));
    return res.json(allRows);
  } catch (err) {
    console.error('supply-procurement/requisitions error:', err);
    return res.status(500).json({ error: 'Failed to load requisitions' });
  }
});

/** Resolve a line category based on its source department. */
function deptCategoryForLine(dept: SupplyDepartment, line: any): string {
  if (line.category) return line.category;
  if (dept === 'Engineering') return 'Engineering';
  if (dept === 'Housekeeping') return 'Housekeeping';
  return 'Food & Beverage';
}

/**
 * POST /supply-procurement/requisitions
 * Creates a new requisition in the appropriate department PO table.
 * Body: { department, propertyId, supplierId, priority, notes, items }
 */
router.post('/supply-procurement/requisitions', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { department, propertyId, supplierId, priority, notes, items } = req.body as {
      department?: string;
      propertyId?: string;
      supplierId?: string;
      priority?: string;
      notes?: string;
      items?: Array<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string; itemId?: string }>;
    };

    if (!department || !(SUPPLY_DEPARTMENTS as readonly string[]).includes(department)) {
      return res.status(400).json({ error: `department is required and must be one of: ${SUPPLY_DEPARTMENTS.join(', ')}` });
    }
    if (!propertyId) return res.status(400).json({ error: 'propertyId is required' });

    const dept = department as SupplyDepartment;
    const { poTable, lineTable, poPrefix } = deptPoTable(dept);
    const poNumber = `${poPrefix}-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const subtotal = (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimatedCost) || 0), 0);

    const poInsert: Record<string, any> = {
      po_number: poNumber,
      supplier_id: supplierId || null,
      property_id: propertyId,
      status: 'draft',
      priority: priority || 'medium',
      order_date: new Date().toISOString(),
      expected_delivery_date: earliestRequiredBy(items) || null,
      subtotal,
      tax_amount: 0,
      total_amount: subtotal,
      currency: 'ETB',
      payment_status: 'pending',
      notes: notes || `Created from centralized Inventory Supply & Procurement (${dept})`,
      submitted_by: req.user?.name || req.user?.id || 'Inventory',
    };

    const { data: po, error: poErr } = await client.from(poTable).insert(poInsert).select().single();
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
      const { error: lineErr } = await client.from(lineTable).insert(lineRows);
      if (lineErr) return res.status(500).json({ error: lineErr.message });
    }

    // Twin-write into unified proc_requisitions so the Procurement portal sees this.
    const sourceSystem = dept === 'Engineering' ? 'engineering' : dept === 'Housekeeping' ? 'housekeeping' : 'food_beverage';
    twinWriteProcRequisition({
      sourceSystem: sourceSystem as any,
      sourceRef: po.id,
      sourcePoNumber: po.po_number,
      propertyId,
      department: dept,
      requester: req.user?.name || req.user?.id || 'Inventory',
      priority: priority || 'medium',
      notes: notes || `Created from centralized Inventory Supply & Procurement (${dept})`,
      requiredDate: earliestRequiredBy(items),
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

    return res.status(201).json({ id: po.id, po_number: po.po_number, status: po.status, department: dept });
  } catch (err) {
    console.error('supply-procurement/requisitions POST error:', err);
    return res.status(500).json({ error: 'Failed to create requisition' });
  }
});

/**
 * PUT /supply-procurement/requisitions/:id/status
 * Advance a PO to the next status. The department table is determined by
 * the `department` query param or by looking up which table contains the id.
 * Body: { status, department }
 */
router.put('/supply-procurement/requisitions/:id/status', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { status: nextStatus, department } = req.body as { status?: string; department?: string };
    if (!nextStatus) return res.status(400).json({ error: 'status is required' });

    // Resolve which department table owns this PO.
    const dept = await resolvePoDepartment(client, req.params.id, department);
    if (!dept) return res.status(404).json({ error: 'Purchase order not found in any department table' });
    const { poTable } = deptPoTable(dept);

    const { data: po, error: poErr } = await client.from(poTable).select('id, status, po_number').eq('id', req.params.id).single();
    if (poErr || !po) return res.status(404).json({ error: 'Purchase order not found' });

    const allowed = PO_TRANSITIONS[po.status] || [];
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: `Cannot transition from '${po.status}' to '${nextStatus}'. Allowed: ${allowed.join(', ') || 'none'}` });
    }

    const update: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === 'received' || nextStatus === 'closed') {
      update.actual_delivery_date = new Date().toISOString();
    }

    const { error: updErr } = await client.from(poTable).update(update).eq('id', po.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ id: po.id, po_number: po.po_number, status: nextStatus, department: dept });
  } catch (err) {
    console.error('supply-procurement/requisitions/:id/status error:', err);
    return res.status(500).json({ error: 'Failed to update PO status' });
  }
});

/**
 * POST /supply-procurement/requisitions/:id/receive
 * Goods receipt: marks the PO as received (or partial), increments
 * quantity_received on each line, and credits stock in the appropriate
 * department store. Logs a Goods Receipt ledger entry per line.
 * Body: { department, lines: [{ lineId, receivedQty }] }
 */
router.post('/supply-procurement/requisitions/:id/receive', authenticate, async (req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { department, lines } = (req.body || {}) as { department?: string; lines?: Array<{ lineId: string; receivedQty: number }> };

    const dept = await resolvePoDepartment(client, req.params.id, department);
    if (!dept) return res.status(404).json({ error: 'Purchase order not found in any department table' });
    const { poTable, lineTable, storeIds } = deptPoTable(dept);

    const { data: po, error: poErr } = await client.from(poTable).select('id, status, po_number, property_id').eq('id', req.params.id).single();
    if (poErr || !po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['acknowledged', 'partial', 'received'].includes(po.status)) {
      return res.status(400).json({ error: `PO must be acknowledged or partial to receive (current: ${po.status})` });
    }
    const propertyId = po.property_id;
    if (!propertyId) return res.status(400).json({ error: 'PO has no property_id' });

    const { data: poLines, error: linesErr } = await client.from(lineTable).select('*').eq('po_id', po.id);
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
    const primaryStoreId = storeIds[0];

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
      const { error: lineUpdErr } = await client.from(lineTable)
        .update({ quantity_received: newReceivedQty })
        .eq('id', line.id);
      if (lineUpdErr) console.warn(`[supply-procurement/receive] failed to update line ${line.id}:`, lineUpdErr.message);

      if (newReceivedQty < ordered) allFullyReceived = false;

      // Credit uinv_stock_balances � resolve unified item by name.
      const itemName = (line.description || '').trim();
      if (itemName) {
        const deptCategory = dept === 'Engineering' ? 'Engineering' : dept === 'Housekeeping' ? 'Housekeeping' : 'Food & Beverage';
        const { data: matchItem } = await client.from('uinv_items')
          .select('id, subcategory')
          .ilike('item_name', itemName)
          .eq('category', deptCategory)
          .maybeSingle();

        if (matchItem) {
          const unitCost = Number(line.unit_price) || 0;
          const { data: balance } = await client.from('uinv_stock_balances')
            .select('id, on_hand, unit_cost')
            .eq('item_id', matchItem.id)
            .eq('store_id', primaryStoreId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          let newQty: number;
          if (balance) {
            newQty = Number(balance.on_hand) + thisReceipt;
            await client.from('uinv_stock_balances').update({
              on_hand: newQty,
              unit_cost: unitCost || Number(balance.unit_cost || 0),
              last_movement_date: now,
              updated_at: now,
            }).eq('id', balance.id);
          } else {
            newQty = thisReceipt;
            const newBalanceId = `UINV-SB-${primaryStoreId.slice(-3)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await client.from('uinv_stock_balances').insert({
              id: newBalanceId,
              property_id: propertyId,
              item_id: matchItem.id,
              store_id: primaryStoreId,
              location_id: null,
              on_hand: thisReceipt,
              reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
              damaged: 0, quarantined: 0, expired: 0,
              status: 'Available',
              unit_cost: unitCost,
              last_movement_date: now,
            });
          }

          const { data: ledgerRow } = await client.from('uinv_stock_ledger').insert({
            property_id: propertyId,
            item_id: matchItem.id,
            store_id: primaryStoreId,
            transaction_type: 'Goods Receipt',
            reference: po.po_number,
            quantity_in: thisReceipt,
            quantity_out: 0,
            balance: newQty,
            unit_cost: unitCost,
            value: thisReceipt * unitCost,
            performed_by: req.user?.name || req.user?.id || 'Inventory',
            reason: `Goods receipt: ${po.po_number}`,
            transaction_date: now,
          }).select('id').single();
          if (ledgerRow) txIds.push(ledgerRow.id);
        }
      }
    }

    const nextStatus = allFullyReceived ? 'received' : 'partial';
    await client.from(poTable).update({
      status: nextStatus,
      actual_delivery_date: allFullyReceived ? now : null,
      updated_at: now,
    }).eq('id', po.id);

    return res.json({
      id: po.id,
      po_number: po.po_number,
      status: nextStatus,
      department: dept,
      fullyReceived: allFullyReceived,
      transactionsLogged: txIds.length,
    });
  } catch (err) {
    console.error('supply-procurement/requisitions/:id/receive error:', err);
    return res.status(500).json({ error: 'Failed to process goods receipt' });
  }
});

/**
 * GET /supply-procurement/suppliers
 * Returns the shared supplier master (fb_suppliers) enriched with
 * lead time and last order date � the unified SupplierRequirement shape.
 */
router.get('/supply-procurement/suppliers', authenticate, async (_req, res) => {
  const client = ensureDb(res); if (!client) return;
  try {
    const { data: suppliers, error } = await client.from('fb_suppliers').select('*').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const { data: performance } = await client.from('fb_supplier_performance')
      .select('supplier_id, average_lead_time, period_start')
      .order('period_start', { ascending: false });
    const leadTimeBySupplier: Record<string, number> = {};
    (performance || []).forEach((p: any) => {
      if (leadTimeBySupplier[p.supplier_id] === undefined) leadTimeBySupplier[p.supplier_id] = Number(p.average_lead_time || 0);
    });

    // Aggregate last order date across all department PO tables.
    const lastOrderBySupplier: Record<string, string> = {};
    for (const dept of SUPPLY_DEPARTMENTS) {
      const { poTable } = deptPoTable(dept);
      const { data: pos } = await client.from(poTable).select('supplier_id, order_date').order('order_date', { ascending: false });
      (pos || []).forEach((p: any) => {
        if (!p.supplier_id) return;
        if (!lastOrderBySupplier[p.supplier_id] && p.order_date) lastOrderBySupplier[p.supplier_id] = String(p.order_date).slice(0, 10);
      });
    }

    const rows = (suppliers || []).map((s: any) => ({
      id: s.id,
      supplier_id: s.supplier_code,
      supplier_name: s.name,
      category: 'General',
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

/**
 * Resolve which department PO table owns a given PO id.
 * If `departmentHint` is provided and valid, checks that table first.
 * Otherwise scans all three department tables.
 */
async function resolvePoDepartment(client: any, poId: string, departmentHint?: string): Promise<SupplyDepartment | null> {
  if (departmentHint && (SUPPLY_DEPARTMENTS as readonly string[]).includes(departmentHint)) {
    const dept = departmentHint as SupplyDepartment;
    const { poTable } = deptPoTable(dept);
    const { data } = await client.from(poTable).select('id').eq('id', poId).maybeSingle();
    if (data) return dept;
  }
  for (const dept of SUPPLY_DEPARTMENTS) {
    const { poTable } = deptPoTable(dept);
    const { data } = await client.from(poTable).select('id').eq('id', poId).maybeSingle();
    if (data) return dept;
  }
  return null;
}

export default router;
