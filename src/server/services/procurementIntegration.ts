/**
 * procurementIntegration.ts
 *
 * Shared helper that "twin-writes" a department-siloed purchase order
 * (Engineering / Housekeeping / F&B) into the unified proc_requisitions
 * table so it appears in the Procurement portal's Requisitions tab.
 *
 * The department's own table remains the source of truth for the department
 * portal UI; the twin record in proc_requisitions gives the Procurement
 * portal visibility and the ability to approve / source / convert to PO.
 */

import { supabaseAdmin, hasSupabaseAdminConfig } from '../supabaseAdmin';
import { cacheService } from './cacheService';
import { ENG_STORE_ID } from '../config/storeIds';

export type DepartmentSource = 'engineering' | 'housekeeping' | 'food_beverage' | 'inventory' | 'event_bookings' | 'operations';

interface DepartmentLineItem {
  itemName: string;
  category?: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
  requiredBy?: string;
  reason?: string;
}

interface TwinWriteParams {
  sourceSystem: DepartmentSource;
  sourceRef: string;          // ID of the department's own PO record
  sourcePoNumber: string;     // The department's PO number (e.g. ENG-PO-2026-123456)
  propertyId?: string;
  department: string;          // Unified procurement department name
  requester: string;
  priority: string;            // Department priority (low/medium/high/urgent)
  notes?: string;
  requiredDate?: string | null;
  estimatedTotal: number;
  items: DepartmentLineItem[];
  createdBy?: string;
}

// Map department silo priorities to unified procurement priorities.
const PRIORITY_MAP: Record<string, string> = {
  low: 'Low',
  medium: 'Normal',
  high: 'High',
  urgent: 'Urgent',
  critical: 'Critical',
  emergency: 'Emergency',
};

/**
 * Creates a twin proc_requisitions row (with proc_requisition_lines) from a
 * department-siloed purchase order. Designed to be called AFTER the
 * department's own insert succeeds. Failures are logged but do NOT throw —
 * the department's operation should still succeed even if the twin-write
 * fails (the procurement portal simply won't see that record).
 *
 * Returns the created proc_requisitions id, or null on failure.
 */
export async function twinWriteProcRequisition(params: TwinWriteParams): Promise<string | null> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return null;

  try {
    const prNumber = `PR-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    const priority = PRIORITY_MAP[params.priority?.toLowerCase()] || 'Normal';

    const { data: req, error: reqError } = await supabaseAdmin
      .from('proc_requisitions')
      .insert({
        pr_number: prNumber,
        property_id: params.propertyId || null,
        department: params.department,
        requester: params.requester,
        request_date: new Date().toISOString(),
        required_date: params.requiredDate || null,
        priority,
        purpose: `From ${params.sourceSystem} portal: ${params.sourcePoNumber}`,
        notes: params.notes || undefined,
        status: 'Submitted', // Department POs are already "submitted" from the dept's perspective
        estimated_total: params.estimatedTotal,
        submitted_at: new Date().toISOString(),
        source_system: params.sourceSystem,
        source_ref: params.sourceRef,
        created_by: params.createdBy || null,
      })
      .select()
      .single();

    if (reqError || !req) {
      console.error(`[procurementIntegration] Failed to twin-write requisition for ${params.sourceSystem}/${params.sourcePoNumber}:`, reqError?.message);
      return null;
    }

    // Insert lines
    const lineRows = params.items.map((it, idx) => {
      const qty = Number(it.quantity) || 0;
      const unitCost = Number(it.estimatedCost) || 0;
      return {
        requisition_id: req.id,
        line_number: idx + 1,
        item_name: it.itemName,
        description: it.reason || null,
        category: it.category || 'General',
        quantity: qty,
        unit_of_measure: it.unit || 'pcs',
        estimated_unit_price: unitCost,
        estimated_total: Number((qty * unitCost).toFixed(2)),
        required_date: it.requiredBy || params.requiredDate || null,
      };
    });

    if (lineRows.length > 0) {
      const { error: lineError } = await supabaseAdmin
        .from('proc_requisition_lines')
        .insert(lineRows);

      if (lineError) {
        console.error(`[procurementIntegration] Failed to twin-write lines for ${params.sourceSystem}/${params.sourcePoNumber}:`, lineError.message);
        // Rollback the requisition header
        await supabaseAdmin.from('proc_requisitions').delete().eq('id', req.id);
        return null;
      }
    }

    cacheService.invalidate('proc-*');
    return req.id;
  } catch (err: any) {
    console.error(`[procurementIntegration] Exception twin-writing for ${params.sourceSystem}/${params.sourcePoNumber}:`, err?.message || err);
    return null;
  }
}

// ── Department Demand Sync ────────────────────────────────────────────────
//
// Syncs demand signals from department silo tables into proc_demand_forecasts
// so the unified Procurement portal's Demand Planning, Procurement Planning,
// and Dashboard can see department-originated demand.
//
// For each source system, deletes old synced forecasts and inserts fresh ones
// computed from the department's live inventory data. This is idempotent.

interface SyncedForecast {
  id: string;
  property_id: string | null;
  department: string;
  category: string;
  forecast_date: string;
  forecast_quantity: number;
  unit_of_measure: string;
  confidence_level: string;
  forecast_source: string;
  notes: string | null;
  source_system: string;
  source_ref: string;
}

/**
 * Sync Engineering spare-parts demand into proc_demand_forecasts.
 * Each unified Engineering item at/below reorder point becomes a demand forecast.
 */
async function syncEngineeringDemand(): Promise<SyncedForecast[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];

  const { data: items } = await supabaseAdmin
    .from('uinv_items')
    .select('id, item_name, subcategory, unit_of_measure, reorder_point, min_stock, max_stock, property_id, brand')
    .eq('category', 'Engineering')
    .eq('is_active', true);

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

  const rows: SyncedForecast[] = [];
  for (const p of (items || [])) {
    const cur = balanceMap.get(p.id) || 0;
    const reorder = Number(p.reorder_point) || Number(p.min_stock) || 0;
    if (cur > reorder) continue; // only below-reorder items

    const shortage = Math.max(0, (Number(p.max_stock) || 0) - cur) || (reorder * 2);
    if (shortage <= 0) continue;

    rows.push({
      id: `eng-df-${p.id}`,
      property_id: p.property_id || null,
      department: 'Engineering & Maintenance',
      category: p.subcategory || 'Maintenance',
      forecast_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      forecast_quantity: shortage,
      unit_of_measure: p.unit_of_measure || 'pcs',
      confidence_level: 'High',
      forecast_source: 'Minimum Stock',
      notes: `Spare part ${p.item_name} below reorder point (${cur}/${reorder})`,
      source_system: 'engineering',
      source_ref: p.id,
    });
  }
  return rows;
}

/**
 * Sync Housekeeping linen + amenity demand into proc_demand_forecasts.
 */
async function syncHousekeepingDemand(): Promise<SyncedForecast[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];

  const rows: SyncedForecast[] = [];

  // Linen stock
  const { data: linen } = await supabaseAdmin
    .from('hk_linen_stock')
    .select('id, type, par, in_stock, property_id');

  for (const l of (linen || [])) {
    const par = Number(l.par) || 0;
    const stock = Number(l.in_stock) || 0;
    if (stock >= par || par <= 0) continue;
    const shortage = par - stock;

    rows.push({
      id: `hk-linen-df-${l.id}`,
      property_id: l.property_id || null,
      department: 'Housekeeping',
      category: 'Linen',
      forecast_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      forecast_quantity: shortage,
      unit_of_measure: 'PCS',
      confidence_level: 'High',
      forecast_source: 'Par Level',
      notes: `Linen ${l.type} below par (${stock}/${par})`,
      source_system: 'housekeeping',
      source_ref: `linen-${l.id}`,
    });
  }

  // Amenity stock
  const { data: amenities } = await supabaseAdmin
    .from('hk_amenity_stock')
    .select('id, type, par, in_stock, property_id');

  for (const a of (amenities || [])) {
    const par = Number(a.par) || 0;
    const stock = Number(a.in_stock) || 0;
    if (stock >= par || par <= 0) continue;
    const shortage = par - stock;

    rows.push({
      id: `hk-amen-df-${a.id}`,
      property_id: a.property_id || null,
      department: 'Housekeeping',
      category: 'Guest Amenities',
      forecast_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      forecast_quantity: shortage,
      unit_of_measure: 'PCS',
      confidence_level: 'High',
      forecast_source: 'Par Level',
      notes: `Amenity ${a.type} below par (${stock}/${par})`,
      source_system: 'housekeeping',
      source_ref: `amenity-${a.id}`,
    });
  }

  return rows;
}

/**
 * Sync F&B ingredient demand into proc_demand_forecasts.
 * Uses stock_transactions to compute current stock per ingredient, then
 * flags ingredients below reorder_point.
 */
async function syncFoodBeverageDemand(): Promise<SyncedForecast[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];

  const { data: ingredients } = await supabaseAdmin
    .from('ingredients')
    .select('id, name, category, unit_of_measure, reorder_point, par_level, property_id')
    .eq('is_active', true);

  if (!ingredients || ingredients.length === 0) return [];

  // Aggregate current stock from stock_transactions
  const { data: txns } = await supabaseAdmin
    .from('stock_transactions')
    .select('ingredient_id, quantity');

  const stockByIng: Record<string, number> = {};
  (txns || []).forEach((t: any) => {
    stockByIng[t.ingredient_id] = (stockByIng[t.ingredient_id] || 0) + Number(t.quantity || 0);
  });

  const rows: SyncedForecast[] = [];
  for (const ing of ingredients) {
    const reorder = Number(ing.reorder_point) || 0;
    const par = Number(ing.par_level) || 0;
    const current = stockByIng[ing.id] || 0;
    const threshold = reorder > 0 ? reorder : par;
    if (threshold <= 0 || current >= threshold) continue;

    const shortage = Math.max(0, (par > 0 ? par : threshold * 2) - current);

    rows.push({
      id: `fb-df-${ing.id}`,
      property_id: ing.property_id || null,
      department: 'Food & Beverage',
      category: ing.category || 'Food',
      forecast_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      forecast_quantity: shortage,
      unit_of_measure: ing.unit_of_measure || 'kg',
      confidence_level: 'Medium',
      forecast_source: 'Reorder Point',
      notes: `Ingredient ${ing.name} below reorder point (${current}/${threshold})`,
      source_system: 'food_beverage',
      source_ref: ing.id,
    });
  }

  return rows;
}

/**
 * Sync Inventory (unified inventory portal) demand into proc_demand_forecasts.
 * Reads uinv_stock_balances for items at/below reorder_point and flags them.
 */
async function syncInventoryDemand(): Promise<SyncedForecast[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];

  const { data: balances } = await supabaseAdmin
    .from('uinv_stock_balances')
    .select('id, item_id, store_id, quantity_on_hand, reorder_point, reorder_qty, property_id')
    .gt('reorder_point', 0);

  const rows: SyncedForecast[] = [];
  for (const b of (balances || [])) {
    const onHand = Number(b.quantity_on_hand) || 0;
    const reorder = Number(b.reorder_point) || 0;
    if (onHand >= reorder) continue;

    const shortage = Math.max(0, (Number(b.reorder_qty) || 0) || (reorder * 2 - onHand));
    if (shortage <= 0) continue;

    rows.push({
      id: `inv-df-${b.id}`,
      property_id: b.property_id || null,
      department: 'Administration', // Inventory falls under Administration
      category: 'General Inventory',
      forecast_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      forecast_quantity: shortage,
      unit_of_measure: 'pcs',
      confidence_level: 'High',
      forecast_source: 'Minimum Stock',
      notes: `Inventory item ${b.item_id} below reorder point (${onHand}/${reorder})`,
      source_system: 'inventory',
      source_ref: b.item_id || b.id,
    });
  }
  return rows;
}

/**
 * Sync Banquet & Events demand into proc_demand_forecasts.
 * Reads upcoming event_bookings and generates demand forecasts for
 * event-related supplies (food, beverages, linens, equipment).
 */
async function syncBanquetEventsDemand(): Promise<SyncedForecast[]> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];

  const { data: events } = await supabaseAdmin
    .from('event_bookings')
    .select('id, event_name, start_date, expected_attendance, status, property_id')
    .gte('start_date', new Date().toISOString().slice(0, 10))
    .in('status', ['Confirmed', 'Tentative']);

  const rows: SyncedForecast[] = [];
  for (const ev of (events || [])) {
    const attendees = Number(ev.expected_attendance) || 0;
    if (attendees <= 0) continue;

    rows.push({
      id: `banquet-df-${ev.id}`,
      property_id: ev.property_id || null,
      department: 'Banquet & Events',
      category: 'Event Supplies',
      forecast_date: ev.start_date,
      forecast_quantity: attendees,
      unit_of_measure: 'pcs',
      confidence_level: ev.status === 'Confirmed' ? 'High' : 'Medium',
      forecast_source: 'Event Booking',
      notes: `Banquet/event ${ev.event_name} with ${attendees} attendees on ${ev.start_date}`,
      source_system: 'event_bookings',
      source_ref: ev.id,
    });
  }
  return rows;
}

const DEPARTMENT_SOURCES = ['engineering', 'housekeeping', 'food_beverage', 'inventory', 'event_bookings'] as const;

/**
 * Syncs all department demand signals into proc_demand_forecasts.
 * Deletes old synced rows for each source system, then inserts fresh ones.
 * Does NOT touch manually-created forecasts (source_system = 'procurement').
 *
 * Returns the number of forecasts synced.
 */
export async function syncDepartmentDemand(): Promise<number> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return 0;

  try {
    const [engRows, hkRows, fbRows, invRows, banquetRows] = await Promise.all([
      syncEngineeringDemand(),
      syncHousekeepingDemand(),
      syncFoodBeverageDemand(),
      syncInventoryDemand(),
      syncBanquetEventsDemand(),
    ]);

    const allRows = [...engRows, ...hkRows, ...fbRows, ...invRows, ...banquetRows];

    // Delete old synced forecasts for each source system, then insert fresh.
    for (const src of DEPARTMENT_SOURCES) {
      await supabaseAdmin
        .from('proc_demand_forecasts')
        .delete()
        .eq('source_system', src);
    }

    if (allRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('proc_demand_forecasts')
        .insert(allRows);

      if (error) {
        console.error('[procurementIntegration] syncDepartmentDemand insert error:', error.message);
        return 0;
      }
    }

    cacheService.invalidate('proc-*');
    return allRows.length;
  } catch (err: any) {
    console.error('[procurementIntegration] syncDepartmentDemand exception:', err?.message || err);
    return 0;
  }
}
