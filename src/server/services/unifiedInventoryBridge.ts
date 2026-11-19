/**
 * unifiedInventoryBridge.ts
 *
 * Shared helper that mirrors F&B (and other department) stock movements
 * into the unified `uinv_*` system so that dynamic-par calculations,
 * Central Warehouse replenishment, and the Inventory & Stores portal
 * see real consumption/production data.
 *
 * Design goals (closes gaps identified in the F&B ↔ unified inventory audit):
 *   1. Single source of truth for the dual-write logic — reused by
 *      inventory.routes.ts AND foodBeverage.routes.ts (no inline duplicates).
 *   2. Explicit linkage via `inventory_items.uinv_item_id` (migration 372)
 *      with a case-insensitive name match fallback for un-linked rows.
 *   3. Data-driven store routing via `outlets.default_store_id` (migration 372)
 *      with the legacy name heuristic as a fallback.
 *   4. Failure tracking — every dual-write attempt records success/failure
 *      into a returned `DualWriteResult` so callers can surface warnings
 *      in API responses instead of silently diverging.
 *
 * Failures are still logged, not thrown — the legacy write is the
 * system of record for the F&B portal UI and must remain authoritative.
 */
import { supabaseAdmin, hasSupabaseAdminConfig } from '../supabaseAdmin';
import { FB_FOOD_STORE_ID, FB_BEV_STORE_ID } from '../config/storeIds';

// Re-export for backward compatibility — existing imports from this module still work.
export { FB_FOOD_STORE_ID, FB_BEV_STORE_ID };

export interface DualWriteFailure {
  itemId: string;
  itemName: string;
  reason: string;
  stage: 'resolve-item' | 'resolve-store' | 'consume' | 'produce';
}

export interface DualWriteResult {
  successes: number;
  failures: DualWriteFailure[];
}

/** Empty result for callers that don't track per-line outcomes. */
export const emptyResult = (): DualWriteResult => ({ successes: 0, failures: [] });

/**
 * Resolve a legacy `inventory_items` row (by id) to its unified
 * `uinv_items` counterpart. Uses the explicit `uinv_item_id` FK
 * (migration 372) first, falling back to a case-insensitive name
 * match within the Food & Beverage category for un-linked rows.
 *
 * Returns `{ id, item_name }` or null.
 */
export async function resolveUinvItemByLegacyId(
  legacyItemId: string,
): Promise<{ id: string; item_name: string } | null> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !legacyItemId) return null;

  // 1. Explicit FK link (preferred)
  const { data: legacy } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, uinv_item_id')
    .eq('id', legacyItemId)
    .maybeSingle();
  if (!legacy) return null;

  if (legacy.uinv_item_id) {
    const { data: uinv } = await supabaseAdmin
      .from('uinv_items')
      .select('id, item_name')
      .eq('id', legacy.uinv_item_id)
      .maybeSingle();
    if (uinv) return uinv;
  }

  // 2. Fallback: case-insensitive name match within F&B category
  return resolveUinvItemByName(legacy.name);
}

/**
 * Resolve a unified `uinv_items` row by case-insensitive name match
 * within the Food & Beverage category. Used as a fallback when no
 * explicit `uinv_item_id` link exists, and for non-inventory_items
 * sources (e.g. sub-recipe / ingredient names).
 */
export async function resolveUinvItemByName(
  name: string,
): Promise<{ id: string; item_name: string } | null> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !name) return null;
  const { data, error } = await supabaseAdmin
    .from('uinv_items')
    .select('id, item_name')
    .ilike('item_name', name.trim())
    .eq('category', 'Food & Beverage')
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Determine which F&B unified store to use for a given outlet.
 * Uses the explicit `outlets.default_store_id` (migration 372) first,
 * falling back to the legacy name heuristic for outlets without a
 * configured default.
 */
export async function resolveFbStoreForOutlet(
  outletId: string,
): Promise<string> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !outletId) return FB_FOOD_STORE_ID;

  // 1. Explicit outlet.default_store_id (preferred)
  const { data: outlet } = await supabaseAdmin
    .from('outlets')
    .select('id, name, default_store_id')
    .eq('id', outletId)
    .maybeSingle();
  if (outlet?.default_store_id) return outlet.default_store_id;

  // 2. Fallback: name heuristic (legacy behavior)
  const name = (outlet?.name || '').toLowerCase();
  if (name.includes('bar') || name.includes('bev') || name.includes('lounge')) {
    return FB_BEV_STORE_ID;
  }
  return FB_FOOD_STORE_ID;
}

interface MovementOpts {
  propertyId?: string | null;
  itemId: string;
  storeId: string;
  qty: number;
  unitCost?: number;
  reference?: string;
  reason?: string;
  performedBy?: string;
  txDate?: string;
}

/**
 * Debit (consume) qty from a unified store balance and append a ledger row.
 * Best-effort — returns true on success, false on failure (caller decides
 * whether to surface a warning). Failures are logged.
 */
export async function uinvConsumeFromStore(opts: MovementOpts): Promise<boolean> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return false;
  const { propertyId, itemId, storeId, qty, unitCost = 0, reference, reason, performedBy = 'system', txDate } = opts;
  if (!itemId || !storeId || qty <= 0) return false;

  try {
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', itemId)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = txDate || new Date().toISOString();
    let newOnHand: number;
    let effectiveCost = unitCost;

    if (balance) {
      newOnHand = Math.max(0, Number(balance.on_hand) - qty);
      effectiveCost = unitCost || Number(balance.unit_cost || 0);
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: newOnHand, last_movement_date: now, updated_at: now })
        .eq('id', balance.id);
    } else {
      // No balance row — create one at zero then record the consumption (goes to 0)
      newOnHand = 0;
      const newBalanceId = `UINV-SB-FB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await supabaseAdmin.from('uinv_stock_balances').insert({
        id: newBalanceId,
        property_id: propertyId || null,
        item_id: itemId,
        store_id: storeId,
        location_id: null,
        on_hand: 0,
        reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
        damaged: 0, quarantined: 0, expired: 0,
        status: 'Available',
        unit_cost: effectiveCost,
        last_movement_date: now,
      });
    }

    await supabaseAdmin.from('uinv_stock_ledger').insert({
      property_id: propertyId || null,
      item_id: itemId,
      store_id: storeId,
      transaction_type: 'Consumption',
      reference: reference || null,
      quantity_in: 0,
      quantity_out: qty,
      balance: newOnHand,
      unit_cost: effectiveCost,
      value: qty * effectiveCost,
      performed_by: performedBy,
      reason: reason || 'F&B consumption',
      transaction_date: now,
    });
    return true;
  } catch (e) {
    console.error('[uinvBridge] uinvConsumeFromStore failed:', e);
    return false;
  }
}

/**
 * Credit (produce/receive) qty to a unified store balance and append a ledger row.
 * Best-effort — returns true on success, false on failure.
 */
export async function uinvProduceToStore(opts: MovementOpts): Promise<boolean> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return false;
  const { propertyId, itemId, storeId, qty, unitCost = 0, reference, reason, performedBy = 'system', txDate } = opts;
  if (!itemId || !storeId || qty <= 0) return false;

  try {
    const { data: balance } = await supabaseAdmin
      .from('uinv_stock_balances')
      .select('id, on_hand, unit_cost')
      .eq('item_id', itemId)
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = txDate || new Date().toISOString();
    let newOnHand: number;
    let effectiveCost = unitCost;

    if (balance) {
      newOnHand = Number(balance.on_hand) + qty;
      effectiveCost = unitCost || Number(balance.unit_cost || 0);
      await supabaseAdmin
        .from('uinv_stock_balances')
        .update({ on_hand: newOnHand, unit_cost: effectiveCost, last_movement_date: now, updated_at: now })
        .eq('id', balance.id);
    } else {
      newOnHand = qty;
      const newBalanceId = `UINV-SB-FB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await supabaseAdmin.from('uinv_stock_balances').insert({
        id: newBalanceId,
        property_id: propertyId || null,
        item_id: itemId,
        store_id: storeId,
        location_id: null,
        on_hand: qty,
        reserved: 0, allocated: 0, on_order: 0, in_transit: 0,
        damaged: 0, quarantined: 0, expired: 0,
        status: 'Available',
        unit_cost: effectiveCost,
        last_movement_date: now,
      });
    }

    await supabaseAdmin.from('uinv_stock_ledger').insert({
      property_id: propertyId || null,
      item_id: itemId,
      store_id: storeId,
      transaction_type: 'Production Output',
      reference: reference || null,
      quantity_in: qty,
      quantity_out: 0,
      balance: newOnHand,
      unit_cost: effectiveCost,
      value: qty * effectiveCost,
      performed_by: performedBy,
      reason: reason || 'F&B production output',
      transaction_date: now,
    });
    return true;
  } catch (e) {
    console.error('[uinvBridge] uinvProduceToStore failed:', e);
    return false;
  }
}

/**
 * Convenience: consume a legacy inventory_items row into the unified
 * system, resolving the unified item via the explicit FK / name fallback.
 * Records the outcome into the provided `result` accumulator.
 */
export async function consumeLegacyItemToUnified(opts: {
  propertyId?: string | null;
  legacyItemId: string;
  legacyItemName: string;
  storeId: string;
  qty: number;
  unitCost?: number;
  reference?: string;
  reason?: string;
  performedBy?: string;
  txDate?: string;
  result: DualWriteResult;
}): Promise<void> {
  const { propertyId, legacyItemId, legacyItemName, storeId, qty, unitCost, reference, reason, performedBy, txDate, result } = opts;

  const uinvItem = await resolveUinvItemByLegacyId(legacyItemId).catch(() => null);
  if (!uinvItem) {
    result.failures.push({ itemId: legacyItemId, itemName: legacyItemName, reason: 'No matching uinv_items row', stage: 'resolve-item' });
    return;
  }

  const ok = await uinvConsumeFromStore({
    propertyId,
    itemId: uinvItem.id,
    storeId,
    qty,
    unitCost,
    reference,
    reason,
    performedBy,
    txDate,
  });
  if (ok) result.successes += 1;
  else result.failures.push({ itemId: uinvItem.id, itemName: uinvItem.item_name, reason: 'Ledger/balance write failed', stage: 'consume' });
}
